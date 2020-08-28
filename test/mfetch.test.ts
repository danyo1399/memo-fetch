import mfetch, { mFetchOne, reset } from '../src/mfetch'
import { setGlobalConfig } from '../src'

async function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function createStaticFetcher(value: any) {
  return jest.fn(() => Promise.resolve(value))
}
function createFetcher() {
  let calls: any = []
  const fn: any = jest.fn(() => {
    const promise: any = new Promise((res, rej) => {
      calls.push([res, rej])
    })

    return promise
  })
  function resolve(value: any) {
    calls[0][0](value)
    calls = calls.slice(1)
  }

  function reject(value: any) {
    calls[0][1](value)
    calls = calls.slice(1)
  }
  fn.resolve = resolve
  fn.reject = reject
  return fn
}

describe('mfetch tests', () => {
  beforeEach(() => {
    reset()
  })

  describe('[mFetchOne]', function() {
    it('fetch one success with no cache should return api result', async function() {
      const fetcher = createStaticFetcher('api result')
      setGlobalConfig({ fetcher })
      const prom: any = mFetchOne('key', fetcher)

      const result = await prom
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(result).toEqual('api result')
    })

    it('fetch one with cached value should return api result', async function() {
      await mFetchOne('key', createStaticFetcher('cache result'))

      const fetcher = createStaticFetcher('api result')
      const result = await mFetchOne('key', fetcher)

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(result).toEqual('api result')
    })

    it('fetch one api failure should throw error', function(done) {
      const fetcher = jest.fn(() => Promise.reject('boom'))
      setGlobalConfig({ fetcher })
      const prom: any = mFetchOne('http://test')
      prom
        .then(() => fail())
        .catch(err => {
          expect(err).toEqual('boom')
          done()
        })
    })

    it('fetch one failure with cache hit should throw error', async function(done) {
      await mFetchOne('http://test', createStaticFetcher('cached value'))
      const fetcher = createFetcher()

      const prom: any = mFetchOne('http://test', fetcher)

      fetcher.reject('boom')

      prom
        .then(() => fail())
        .catch(err => {
          expect(err).toEqual('boom')
          done()
        })
    })
  })
  it('when dedup on init is false then revalidate on init does not dedup api calls', async function() {
    let state = mfetch('key', null, {
      dedupOnInit: false,
      fetcher: createStaticFetcher('cached value')
    })

    await sleep(10)
    state.dispose()
    let results: any[] = []
    const fetcher = createStaticFetcher('api call value value')
    state = mfetch(
      'key',
      ({ data, isValidating, error }) =>
        results.push({ data, isValidating, error }),
      { dedupOnInit: false, fetcher }
    )

    await sleep(10)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(results).toMatchInlineSnapshot(`
      Array [
        Object {
          "data": "cached value",
          "error": undefined,
          "isValidating": true,
        },
        Object {
          "data": "api call value value",
          "error": undefined,
          "isValidating": false,
        },
      ]
    `)
  })

  it('when dedup on init is true then revalidate on init does dedup api calls', async function() {
    let state = mfetch('key', null, {
      fetcher: createStaticFetcher('cached value')
    })

    await sleep(10)
    state.dispose()
    let results: any[] = []
    const fetcher = createStaticFetcher('api call value value')
    state = mfetch(
      'key',
      ({ data, isValidating, error }) =>
        results.push({ data, isValidating, error }),
      { dedupOnInit: true, fetcher }
    )

    await sleep(10)
    expect(fetcher).toHaveBeenCalledTimes(0)
    expect(results).toMatchInlineSnapshot(`
      Array [
        Object {
          "data": "cached value",
          "error": undefined,
          "isValidating": true,
        },
        Object {
          "data": "cached value",
          "error": undefined,
          "isValidating": false,
        },
      ]
    `)
  })

  it('api polling', async done => {
    let count = 1
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo' + count++)
    })
    const state = mfetch(
      'https://aws.random.cat/meow',
      () => {
        if (count > 3) {
          expect(fetcher).toHaveBeenCalledTimes(3)
          expect(state.data).toEqual('boo3')
          done()
        }
      },
      { refreshInterval: 100, dedupingInterval: undefined, fetcher }
    )
  })

  it('dispose unsubscribes mfetch', async () => {
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo')
    })
    const state = mfetch('https://aws.random.cat/meow', null, {
      fetcher
    })

    await sleep(10)
    state.dispose()

    const result = await state.mutate()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result).toEqual('boo')
  })

  it('when revalidateOnMount is false, and no cached value, should emit once', async function() {
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo')
    })
    const changes: any[] = []
    mfetch(
      'https://aws.random.cat/meow',
      r => {
        changes.push(r)
      },
      { revalidateOnInit: false, fetcher }
    )

    await sleep(10)
    expect(changes).toMatchInlineSnapshot(`
      Array [
        Object {
          "data": undefined,
          "dispose": [Function],
          "error": undefined,
          "isValidating": false,
          "mutate": [Function],
          "revalidate": [Function],
        },
      ]
    `)
  })

  it('impure state object always contains current state', async () => {
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo')
    })
    const state = mfetch('https://aws.random.cat/meow', null, {
      fetcher
    })

    await sleep(10)
    expect(state.data).toEqual('boo')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('duplicate api calls within timeframe are deduped', async () => {
    let stateChanges = []
    let stateChanges2 = []
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo')
    })
    mfetch('https://aws.random.cat/meow', x => stateChanges.push(x), {
      fetcher
    })

    mfetch('https://aws.random.cat/meow', x => stateChanges2.push(x), {
      fetcher
    })

    await sleep(10)
    expect(stateChanges).toMatchInlineSnapshot(`
      Array [
        Object {
          "data": undefined,
          "dispose": [Function],
          "error": undefined,
          "isValidating": true,
          "mutate": [Function],
          "revalidate": [Function],
        },
        Object {
          "data": "boo",
          "dispose": [Function],
          "error": undefined,
          "isValidating": false,
          "mutate": [Function],
          "revalidate": [Function],
        },
      ]
    `)
    expect(stateChanges2).toMatchInlineSnapshot(`
      Array [
        Object {
          "data": undefined,
          "dispose": [Function],
          "error": undefined,
          "isValidating": true,
          "mutate": [Function],
          "revalidate": [Function],
        },
        Object {
          "data": "boo",
          "dispose": [Function],
          "error": undefined,
          "isValidating": true,
          "mutate": [Function],
          "revalidate": [Function],
        },
        Object {
          "data": "boo",
          "dispose": [Function],
          "error": undefined,
          "isValidating": false,
          "mutate": [Function],
          "revalidate": [Function],
        },
      ]
    `)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('call api', async () => {
    let stateChanges = []
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo')
    })
    mfetch('https://aws.random.cat/meow', x => stateChanges.push(x), {
      fetcher
    })
    await sleep(10)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(stateChanges).toMatchInlineSnapshot(`
      Array [
        Object {
          "data": undefined,
          "dispose": [Function],
          "error": undefined,
          "isValidating": true,
          "mutate": [Function],
          "revalidate": [Function],
        },
        Object {
          "data": "boo",
          "dispose": [Function],
          "error": undefined,
          "isValidating": false,
          "mutate": [Function],
          "revalidate": [Function],
        },
      ]
    `)
  })
})
