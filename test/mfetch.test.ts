import mfetch, { mFetchOne, reset } from '../src/mfetch'
import { cache, setGlobalConfig } from '../src'

async function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
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
      const fetcher = createFetcher()
      setGlobalConfig({ fetcher })
      const prom: any = mFetchOne('key', { fetcher })

      fetcher.resolve('api result')

      const result = await prom
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(result).toEqual('api result')
    })

    it('fetch one success with cached enabled and cache hit should return cached value', async function() {
      let fetcher = jest.fn(() => Promise.resolve('cached api response'))
      await mFetchOne('key', { fetcher })
      await sleep(10)

      fetcher = jest.fn(() => Promise.resolve('api response'))
      const result = await mFetchOne('key', { fetcher })

      await sleep(10)

      expect(fetcher).toHaveBeenCalledTimes(0)
      expect(result).toEqual('cached api response')
    })

    it('fetch one success with cached enabled and cache miss due to timeout should return api call value', async function() {
      let fetcher = jest.fn(() => Promise.resolve('cached api response'))
      await mFetchOne('key', { fetcher, dedupingInterval: 400 })
      await sleep(800)

      fetcher = jest.fn(() => Promise.resolve('api response'))
      const result = await mFetchOne('key', { fetcher })

      await sleep(10)

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(result).toEqual('api response')
    })

    it('fetch one success with cached enabled and cache miss should return api response', async function() {
      const fn = createFetcher()
      setGlobalConfig({ fetcher: fn })
      const prom = mFetchOne('key')

      await sleep(10)
      fn.resolve('api response')

      const result = await prom
      expect(fn).toHaveBeenCalledTimes(1)
      expect(result).toEqual('api response')
    })

    it('fetch one success with deduping on, should dedupe api requests', async function() {
      let apiResponse = 'api response 1'
      let fetcher = jest.fn(() => Promise.resolve(apiResponse))
      const result1 = await mFetchOne('key', { fetcher })

      await sleep(10)
      apiResponse = 'api response 2'

      const result2 = await mFetchOne('key', { fetcher })

      await sleep(10)

      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(result1).toEqual('api response 1')
      expect(result2).toEqual('api response 1')
    })

    it('fetch one success with deduping off, should not dedup api requests', async function() {
      let apiResponse = 'api response 1'
      const fetcher = jest.fn(() => Promise.resolve(apiResponse))
      const result1 = await mFetchOne('key', {
        fetcher,
        dedupingInterval: undefined
      })

      await sleep(10)
      apiResponse = 'api response 2'

      const result2 = await mFetchOne('key', {
        fetcher,
        dedupingInterval: undefined
      })

      await sleep(10)

      expect(fetcher).toHaveBeenCalledTimes(2)
      expect(result1).toEqual('api response 1')
      expect(result2).toEqual('api response 2')
    })

    it('fetch one api failure with cache disabled should throw error', function(done) {
      const fetcher = createFetcher()
      setGlobalConfig({ fetcher })
      const prom: any = mFetchOne('http://test', { fetcher })

      fetcher.reject('boom')

      prom
        .then(() => fail())
        .catch(err => {
          expect(err).toEqual('boom')
          done()
        })
    })

    it('fetch one api failure with cache enabled and cache miss should throw error', function(done) {
      const fetcher = createFetcher()
      setGlobalConfig({ fetcher })
      const prom: any = mFetchOne('http://test', { fetcher })

      fetcher.reject('boom')

      prom
        .then(() => fail())
        .catch(err => {
          expect(err).toEqual('boom')
          done()
        })
    })

    it('fetch one failure with cache enabled and cache value', function(done) {
      cache.set('key', 'cached')
      const fetcher = createFetcher()
      setGlobalConfig({ fetcher })
      const prom: any = mFetchOne('http://test', { fetcher })

      fetcher.reject('boom')

      prom
        .then(() => fail())
        .catch(err => {
          expect(err).toEqual('boom')
          done()
        })
    })
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
      { revalidateOnMount: false, fetcher }
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
