import SDK from 'hyper-sdk'
import { once } from 'events'
import makeDefer from 'promise-defer'
import net from 'net'
import getPort from 'get-port'
import makeFetch from 'hypercore-fetch'
import createEventSource from '@rangermauve/fetch-event-source'
import delay from 'delay'
import HyperGateway from 'hyper-gateway'
import fetch from 'node-fetch'
import { finished } from 'stream'

const DEFAULT_TIMEOUT = 5000

main()

async function main () {
  await testTCP()
  await testRawExtension()
  await testFetch()
  await testHTTP()
  await testGateway()
}

async function testTCP () {
  console.log('testTCP: Start')

  const port = await getPort()

  const onFinish = makeDefer()

  const server = net.createServer((connection) => {
    connection.once('data', () => {
      console.timeEnd('tcp')
      onFinish.resolve()
    })
  })

  await new Promise((resolve, reject) => {
    server.listen(port, (e) => {
      if (e) reject(e)
      else resolve()
    })
  })
  try {
    const client = net.createConnection(port)

    await once(client, 'connect')

    console.time('tcp')

    client.end('Hello World!')

    await onFinish.promise

    timeoutDeferred(onFinish)

    await onFinish.promise
  } finally {
    server.close()
  }

  console.log('testTCP: Finish')
}

async function testRawExtension () {
  console.log('testRawExtension: Start')
  const sdk1 = await SDK({ persist: false })
  const sdk2 = await SDK({ persist: false })
  try {
    const core1 = sdk1.Hypercore('example')
    await core1.ready()

    const onFinish = makeDefer()

    core1.registerExtension('example', {
      onmessage: (message, peer) => {
        console.timeEnd('extension-raw')
        onFinish.resolve()
      },
      encoding: 'utf-8'
    })

    const core2 = sdk2.Hypercore(core1.key)
    await core2.ready()

    const extension2 = core2.registerExtension('example', {
      encoding: 'utf-8'
    })

    if (!core2.peers.length) {
      await once(core2, 'peer-open')
    }

    console.time('extension-raw')
    extension2.broadcast('Hello World!')

    timeoutDeferred(onFinish)
    await onFinish.promise
  } finally {
    await Promise.all([
      sdk1.close(),
      sdk2.close()
    ])
  }
  console.log('testRawExtension: Finish')
}

async function testFetch () {
  console.log('testFetch: Start')
  const fetch1 = await makeFetch({ persist: false })
  const fetch2 = await makeFetch({ persist: false })

  try {
    const keyResp = await fetch1('hyper://example/.well-known/hyper')
    const record = await keyResp.text()
    const [key] = record.split('\n')

    const extensionURL = new URL('/$/extensions/example', key).href
    const listenURL = new URL('/$/extensions/', key).href

    await fetch1(extensionURL)
    await fetch2(extensionURL)

    // Wait for them to connect?
    await delay(1000)

    const { EventSource } = createEventSource(fetch2)

    const source = new EventSource(listenURL)

    const onFinish = makeDefer()

    source.addEventListener('example', (event) => {
      console.timeEnd('hypercore-fetch')
      onFinish.resolve()
    })
    source.addEventListener('error', (event) => {
      onFinish.reject(event.error)
    })

    await delay(1000)

    console.time('hypercore-fetch')
    const sendResponse = await fetch1(extensionURL, {
      method: 'post',
      body: 'Hello World!'
    })

    if (!sendResponse.ok) throw new Error(await sendResponse.text())

    timeoutDeferred(onFinish)
    await onFinish.promise
  } finally {
    await Promise.all([
      fetch1.close(),
      fetch2.close()
    ])
  }
  console.log('testFetch: Finish')
}

async function testHTTP () {

}

async function testGateway () {
  console.log('testGateway: Start')
  const port1 = await getPort()
  const port2 = await getPort()

  const gateway1 = await HyperGateway.create({
    silent: true,
    port: port1,
    persist: false
  })
  const gateway2 = await HyperGateway.create({
    silent: true,
    port: port2,
    persist: false
  })

  const host1 = `http://localhost:${port1}/`
  const host2 = `http://localhost:${port2}/`

  try {
    const keyResp = await fetch(`${host1}hyper/example/.well-known/hyper`)
    const record = await keyResp.text()
    const [key] = record.split('\n')
    const keySuffix = key.replace('hyper://', 'hyper/')

    const extensionURL1 = host1 + keySuffix + '/$/extensions/example'
    const extensionURL2 = host2 + keySuffix + '/$/extensions/example'
    const listenURL = host2 + keySuffix + '/$/extensions/'

    await fetch(extensionURL1)
    await fetch(extensionURL2)

    // Wait for them to connect?
    await delay(1000)

    const onFinish = makeDefer()

    // This is super janky because node-fetch doesn't implement response.body.getReader() 😭
    fetch(listenURL, {
      headers: {
        Accept: 'text/event-stream'
      }
    }).then(async (eventRequest) => {
      if (!eventRequest.ok) throw new Error(await eventRequest.text())

      eventRequest.body.on('data', (data) => {
        console.timeEnd('gateway-fetch')
        onFinish.resolve()
      })
      finished(eventRequest.body, () => {
      // noop, gets the flow going
      })
    }).catch(onFinish.error)

    await delay(1000)

    console.time('gateway-fetch')
    const sendResponse = await fetch(extensionURL1, {
      method: 'post',
      body: 'Hello World!'
    })

    if (!sendResponse.ok) throw new Error(await sendResponse.text())

    timeoutDeferred(onFinish)
    await onFinish.promise
  } finally {
    await Promise.all([
      gateway1.close(),
      gateway2.close()
    ])
  }
  console.log('testGateway: Finish')
}

async function timeoutDeferred (defer) {
  await delay(DEFAULT_TIMEOUT)
  defer.reject(new Error('Timed out'))
}
