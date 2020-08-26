import defaultConfig, { cache, globalConfig } from './config'
import isDocumentVisible from './libs/is-document-visible'
import isOnline from './libs/is-online'
import {
  actionType,
  broadcastStateInterface,
  ConfigInterface,
  fetcherFn,
  keyInterface,
  mutateInterface,
  responseInterface,
  RevalidateOptionInterface,
  triggerInterface,
  updaterInterface
} from './types'

const IS_SERVER = typeof window === 'undefined'

// polyfill for requestIdleCallback
const rIC = IS_SERVER
  ? null
  : window['requestIdleCallback'] || (f => setTimeout(f, 1))

// global state managers
let CONCURRENT_PROMISES = {}
let CONCURRENT_PROMISES_TS = {}
let FOCUS_REVALIDATORS = {}
let RECONNECT_REVALIDATORS = {}
let CACHE_REVALIDATORS = {}
let MUTATION_TS = {}
let MUTATION_END_TS = {}

/**
 * Use for testing
 */
function reset() {
  CONCURRENT_PROMISES = {}
  CONCURRENT_PROMISES_TS = {}
  FOCUS_REVALIDATORS = {}
  RECONNECT_REVALIDATORS = {}
  CACHE_REVALIDATORS = {}
  MUTATION_TS = {}
  MUTATION_END_TS = {}
  cache.clear()
}

// setup DOM events listeners for `focus` and `reconnect` actions
if (!IS_SERVER && window.addEventListener) {
  const revalidate = revalidators => {
    if (!isDocumentVisible() || !isOnline()) return

    for (const key in revalidators) {
      if (revalidators[key][0]) revalidators[key][0]()
    }
  }

  // focus revalidate
  window.addEventListener(
    'visibilitychange',
    () => revalidate(FOCUS_REVALIDATORS),
    false
  )
  window.addEventListener('focus', () => revalidate(FOCUS_REVALIDATORS), false)
  // reconnect revalidate
  window.addEventListener(
    'online',
    () => revalidate(RECONNECT_REVALIDATORS),
    false
  )
}

const trigger: triggerInterface = (_key, shouldRevalidate = true) => {
  // we are ignoring the second argument which correspond to the arguments
  // the fetcher will receive when key is an array
  const [key, , keyErr] = cache.serializeKey(_key)
  if (!key) return Promise.resolve()

  const updaters = CACHE_REVALIDATORS[key]

  if (key && updaters) {
    const currentData = cache.get(key)
    const currentError = cache.get(keyErr)
    const promises = []
    for (let i = 0; i < updaters.length; ++i) {
      promises.push(
        updaters[i](shouldRevalidate, currentData, currentError, i > 0)
      )
    }
    // return new updated value
    return Promise.all(promises).then(() => cache.get(key))
  }
  return Promise.resolve(cache.get(key))
}

const broadcastState: broadcastStateInterface = (key, data, error) => {
  const updaters = CACHE_REVALIDATORS[key]
  if (key && updaters) {
    for (let i = 0; i < updaters.length; ++i) {
      updaters[i](false, data, error)
    }
  }
}

const mutate: mutateInterface = async (
  _key,
  _data,
  shouldRevalidate = true
) => {
  const [key, , keyErr] = cache.serializeKey(_key)
  if (!key) return

  // if there is no new data, call revalidate against the key
  if (typeof _data === 'undefined') return trigger(_key, shouldRevalidate)

  // update timestamps
  MUTATION_TS[key] = Date.now() - 1
  MUTATION_END_TS[key] = 0

  // keep track of timestamps before await asynchronously
  const beforeMutationTs = MUTATION_TS[key]
  const beforeConcurrentPromisesTs = CONCURRENT_PROMISES_TS[key]

  let data, error

  if (_data && typeof _data === 'function') {
    // `_data` is a function, call it passing current cache value
    try {
      data = await _data(cache.get(key))
    } catch (err) {
      error = err
    }
  } else if (_data && typeof _data.then === 'function') {
    // `_data` is a promise
    try {
      data = await _data
    } catch (err) {
      error = err
    }
  } else {
    data = _data
  }

  // check if other mutations have occurred since we've started awaiting, if so then do not persist this change
  if (
    beforeMutationTs !== MUTATION_TS[key] ||
    beforeConcurrentPromisesTs !== CONCURRENT_PROMISES_TS[key]
  ) {
    if (error) throw error
    return data
  }

  if (typeof data !== 'undefined') {
    // update cached data, avoid notifying from the cache
    cache.set(key, data)
  }
  cache.set(keyErr, error)

  // reset the timestamp to mark the mutation has ended
  MUTATION_END_TS[key] = Date.now() - 1

  // enter the revalidation stage
  // update existing mfetch Hooks' state
  const updaters = CACHE_REVALIDATORS[key]
  if (updaters) {
    const promises = []
    for (let i = 0; i < updaters.length; ++i) {
      promises.push(updaters[i](!!shouldRevalidate, data, error, i > 0))
    }
    // return new updated value
    return Promise.all(promises).then(() => {
      if (error) throw error
      return cache.get(key)
    })
  }
  // throw error or return data to be used by caller of mutate
  if (error) throw error
  return data
}

function mfetch<Data = any, Error = any>(
  _key: keyInterface,
  onStateChanged?: (response: responseInterface<Data, Error>) => void,
  {
    fn,
    config
  }: { fn?: fetcherFn<Data>; config?: ConfigInterface<Data, Error> } = {}
): responseInterface<Data, Error> {
  // we assume `key` as the identifier of the request
  // `key` can change but `fn` shouldn't
  // (because `revalidate` only depends on `key`)
  // `keyErr` is the cache key for error objects
  const [key, fnArgs, keyErr] = cache.serializeKey(_key)

  config = Object.assign({}, defaultConfig, globalConfig, config)

  const configRef = config

  if (typeof fn === 'undefined') {
    // use the global fetcher
    fn = config.fetcher
  }

  const initialData = cache.get(key) || config.initialData
  const initialError = cache.get(keyErr)

  // if a state is accessed (data, error or isValidating),
  // we add the state to dependencies so if the state is
  // updated in the future, we can trigger a rerender
  let stateDependencies = {
    data: false,
    error: false,
    isValidating: false
  }
  let stateRef = {
    data: initialData,
    error: initialError,
    isValidating: false
  }

  // const rerender = useState(null)[1]
  const rerender = (_: any) => null

  let dispatch = payload => {
    let shouldUpdateState = false
    for (let k in payload) {
      stateRef[k] = payload[k]
      if (stateDependencies[k]) {
        shouldUpdateState = true
      }
    }
    if (onStateChanged) {
      const newState = createResponseInterface()
      onStateChanged(newState)
    }
    if (shouldUpdateState || config.suspense) {
      if (unmountedRef) return
      rerender({})
    }
  }

  // error ref inside revalidate (is last request errored?)
  let unmountedRef = false
  let keyRef = key

  // do unmount check for callbacks
  const eventsRef = {
    emit: (event, ...params) => {
      if (unmountedRef) return
      configRef[event](...params)
    }
  }

  const boundMutate: responseInterface<Data, Error>['mutate'] = (
    data,
    shouldRevalidate
  ) => {
    return mutate(key, data, shouldRevalidate)
  }

  const addRevalidator = (revalidators, callback) => {
    if (!callback) return
    if (!revalidators[key]) {
      revalidators[key] = [callback]
    } else {
      revalidators[key].push(callback)
    }
  }

  const removeRevalidator = (revlidators, callback) => {
    if (revlidators[key]) {
      const revalidators = revlidators[key]
      const index = revalidators.indexOf(callback)
      if (index >= 0) {
        // 10x faster than splice
        // https://jsperf.com/array-remove-by-index
        revalidators[index] = revalidators[revalidators.length - 1]
        revalidators.pop()
      }
    }
  }

  // start a revalidation
  const revalidate = async (
    revalidateOpts: RevalidateOptionInterface = {}
  ): Promise<boolean> => {
    if (!key || !fn) return false
    if (unmountedRef) return false
    revalidateOpts = Object.assign({ dedupe: false }, revalidateOpts)

    let loading = true
    let shouldDeduping =
      typeof CONCURRENT_PROMISES[key] !== 'undefined' && revalidateOpts.dedupe

    // start fetching
    try {
      dispatch({
        isValidating: true
      })

      let newData
      let startAt

      if (shouldDeduping) {
        // there's already an ongoing request,
        // this one needs to be deduplicated.
        startAt = CONCURRENT_PROMISES_TS[key]
        newData = await CONCURRENT_PROMISES[key]
      } else {
        // if no cache being rendered currently (it shows a blank page),
        // we trigger the loading slow event.
        if (config.loadingTimeout && !cache.get(key)) {
          setTimeout(() => {
            if (loading) eventsRef.emit('onLoadingSlow', key, config)
          }, config.loadingTimeout)
        }

        if (fnArgs !== null) {
          CONCURRENT_PROMISES[key] = fn(...fnArgs)
        } else {
          CONCURRENT_PROMISES[key] = fn(key)
        }

        CONCURRENT_PROMISES_TS[key] = startAt = Date.now()

        newData = await CONCURRENT_PROMISES[key]

        setTimeout(() => {
          delete CONCURRENT_PROMISES[key]
          delete CONCURRENT_PROMISES_TS[key]
        }, config.dedupingInterval)

        // trigger the success event,
        // only do this for the original request.
        eventsRef.emit('onSuccess', newData, key, config)
      }

      const shouldIgnoreRequest =
        // if there're other ongoing request(s), started after the current one,
        // we need to ignore the current one to avoid possible race conditions:
        //   req1------------------>res1        (current one)
        //        req2---------------->res2
        // the request that fired later will always be kept.
        CONCURRENT_PROMISES_TS[key] > startAt ||
        // if there're other mutations(s), overlapped with the current revalidation:
        // case 1:
        //   req------------------>res
        //       mutate------>end
        // case 2:
        //         req------------>res
        //   mutate------>end
        // case 3:
        //   req------------------>res
        //       mutate-------...---------->
        // we have to ignore the revalidation result (res) because it's no longer fresh.
        // meanwhile, a new revalidation should be triggered when the mutation ends.
        (MUTATION_TS[key] &&
          // case 1
          (startAt <= MUTATION_TS[key] ||
            // case 2
            startAt <= MUTATION_END_TS[key] ||
            // case 3
            MUTATION_END_TS[key] === 0))

      if (shouldIgnoreRequest) {
        dispatch({ isValidating: false })
        return false
      }

      cache.set(key, newData)
      cache.set(keyErr, undefined)

      // new state for the reducer
      const newState: actionType<Data, Error> = {
        isValidating: false
      }

      if (typeof stateRef.error !== 'undefined') {
        // we don't have an error
        newState.error = undefined
      }
      if (!config.compare(stateRef.data, newData)) {
        // deep compare to avoid extra re-render
        // data changed
        newState.data = newData
      }

      // merge the new state
      dispatch(newState)

      if (!shouldDeduping) {
        // also update other hooks
        broadcastState(key, newData, undefined)
      }
    } catch (err) {
      delete CONCURRENT_PROMISES[key]
      delete CONCURRENT_PROMISES_TS[key]

      cache.set(keyErr, err)

      // get a new error
      // don't use deep equal for errors
      if (stateRef.error !== err) {
        // we keep the stale data
        dispatch({
          isValidating: false,
          error: err
        })

        if (!shouldDeduping) {
          // also broadcast to update other hooks
          broadcastState(key, undefined, err)
        }
      }

      // events and retry
      eventsRef.emit('onError', err, key, config)
      if (config.shouldRetryOnError) {
        // when retrying, we always enable deduping
        const retryCount = (revalidateOpts.retryCount || 0) + 1
        eventsRef.emit(
          'onErrorRetry',
          err,
          key,
          config,
          revalidate,
          Object.assign({ dedupe: true }, revalidateOpts, { retryCount })
        )
      }
    }

    loading = false
    return true
  }

  // mounted (client side rendering)
  const setupUpdater = () => {
    if (!key) return undefined

    // after `key` updates, we need to mark it as mounted
    unmountedRef = false

    // after the component is mounted (hydrated),
    // we need to update the data from the cache
    // and trigger a revalidation

    const currentHookData = stateRef.data
    const latestKeyedData = cache.get(key) || config.initialData

    // update the state if the key changed (not the inital render) or cache updated
    if (keyRef !== key) {
      keyRef = key
    }
    if (!config.compare(currentHookData, latestKeyedData)) {
      dispatch({ data: latestKeyedData })
    }

    // revalidate with deduping
    const softRevalidate = () => revalidate({ dedupe: true })

    // trigger a revalidation
    if (
      config.revalidateOnMount ||
      (!config.initialData && config.revalidateOnMount === undefined)
    ) {
      if (typeof latestKeyedData !== 'undefined') {
        // delay revalidate if there's cache
        // to not block the rendering
        rIC(softRevalidate)
      } else {
        softRevalidate()
      }
    }

    let pending = false
    const onFocus = () => {
      if (pending || !configRef.revalidateOnFocus) return
      pending = true
      softRevalidate()
      setTimeout(() => (pending = false), configRef.focusThrottleInterval)
    }

    const onReconnect = () => {
      if (configRef.revalidateOnReconnect) {
        softRevalidate()
      }
    }

    // register global cache update listener
    const onUpdate: updaterInterface<Data, Error> = (
      shouldRevalidate = true,
      updatedData,
      updatedError,
      dedupe = true
    ) => {
      // update hook state
      const newState: actionType<Data, Error> = {}
      let needUpdate = false

      if (
        typeof updatedData !== 'undefined' &&
        !config.compare(stateRef.data, updatedData)
      ) {
        newState.data = updatedData
        needUpdate = true
      }

      // always update error
      // because it can be `undefined`
      if (stateRef.error !== updatedError) {
        newState.error = updatedError
        needUpdate = true
      }

      if (needUpdate) {
        dispatch(newState)
      }

      if (shouldRevalidate) {
        if (dedupe) {
          return softRevalidate()
        } else {
          return revalidate()
        }
      }
      return false
    }

    addRevalidator(FOCUS_REVALIDATORS, onFocus)
    addRevalidator(RECONNECT_REVALIDATORS, onReconnect)
    addRevalidator(CACHE_REVALIDATORS, onUpdate)

    return () => {
      // cleanup
      //dispatch = () => null

      // mark it as unmounted
      unmountedRef = true

      removeRevalidator(FOCUS_REVALIDATORS, onFocus)
      removeRevalidator(RECONNECT_REVALIDATORS, onReconnect)
      removeRevalidator(CACHE_REVALIDATORS, onUpdate)
    }
  }

  // set up polling
  const setupPolling = () => {
    let timer = null
    const tick = async () => {
      if (
        !stateRef.error &&
        (config.refreshWhenHidden || isDocumentVisible()) &&
        (config.refreshWhenOffline || isOnline())
      ) {
        // only revalidate when the page is visible
        // if API request errored, we stop polling in this round
        // and let the error retry function handle it
        await revalidate({ dedupe: true })
      }
      if (config.refreshInterval) {
        timer = setTimeout(tick, config.refreshInterval)
      }
    }
    if (config.refreshInterval) {
      timer = setTimeout(tick, config.refreshInterval)
    }
    return () => {
      if (timer) clearTimeout(timer)
    }
  }

  let disposePolling: any
  let disposeUpdates: any
  const init = () => {
    disposePolling = setupPolling()
    disposeUpdates = setupUpdater()
  }

  const dispose = () => {
    disposePolling && disposePolling()
    disposeUpdates && disposeUpdates()
  }

  init()

  return createImpureResponseInterface()

  function createResponseInterface(): responseInterface<Data, Error> {
    const tempState = {
      revalidate,
      mutate: boundMutate,
      dispose
    } as responseInterface<Data, Error>
    return addComputedStateProperties(
      tempState,
      stateRef.error,
      stateRef.data,
      stateRef.isValidating
    )
  }

  function createImpureResponseInterface(): responseInterface<Data, Error> {
    const tempState = {
      revalidate,
      mutate: boundMutate,
      dispose
    } as responseInterface<Data, Error>
    return addImpureComputedStateProperties(tempState)
  }

  function addComputedStateProperties(state: any, error, data, isValidating) {
    Object.defineProperties(state, {
      error: {
        // `key` might be changed in the upcoming hook re-render,
        // but the previous state will stay
        // so we need to match the latest key and data (fallback to `initialData`)
        get: function() {
          stateDependencies.error = true
          return error
        },
        enumerable: true
      },
      data: {
        get: function() {
          stateDependencies.data = true
          return data
        },
        enumerable: true
      },
      isValidating: {
        get: function() {
          stateDependencies.isValidating = true
          return isValidating
        },
        enumerable: true
      }
    })
    return state
  }

  function addImpureComputedStateProperties(state: any) {
    Object.defineProperties(state, {
      error: {
        // `key` might be changed in the upcoming hook re-render,
        // but the previous state will stay
        // so we need to match the latest key and data (fallback to `initialData`)
        get: function() {
          stateDependencies.error = true
          return stateRef.error
        },
        enumerable: true
      },
      data: {
        get: function() {
          stateDependencies.data = true
          return stateRef.data
        },
        enumerable: true
      },
      isValidating: {
        get: function() {
          stateDependencies.isValidating = true
          return stateRef.isValidating
        },
        enumerable: true
      }
    })
    return state
  }
}

export { trigger, mutate, reset }
export default mfetch
