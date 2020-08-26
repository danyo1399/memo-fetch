import mfetch, { reset } from '../src/mfetch'

async function sleep(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

describe('mfetch tests', () => {
  beforeEach(() => {
    reset()
  })

  it('impure state object always contains current state', async () => {
    const fn = jest.fn(() => {
      return Promise.resolve('boo')
    })
    const state = mfetch('https://aws.random.cat/meow', null, {
      fn
    })

    await sleep(10)
    expect(state.data).toEqual('boo')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('duplicate api calls within timeframe are deduped', async () => {
    let stateChanges = []
    let stateChanges2 = []
    const fn = jest.fn(() => {
      return Promise.resolve('boo')
    })
    mfetch('https://aws.random.cat/meow', x => stateChanges.push(x), {
      fn
    })

    mfetch('https://aws.random.cat/meow', x => stateChanges2.push(x), {
      fn
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
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('call api', async () => {
    let stateChanges = []
    const fn = jest.fn(() => {
      return Promise.resolve('boo')
    })
    mfetch('https://aws.random.cat/meow', x => stateChanges.push(x), {
      fn
    })
    await sleep(10)
    expect(fn).toHaveBeenCalledTimes(1)
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
