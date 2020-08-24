import useSWR from '../src/use-swr'

describe('swr tests', () => {
  beforeEach(() => {})
  it('test', async () => {
    let stateChanges = []
    const fetcher = jest.fn(() => {
      return Promise.resolve('boo')
    })
    useSWR('https://aws.random.cat/meow', {
      onStateChanged: x => stateChanges.push(x),
      fetcher
    })
    await Promise.resolve()
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
