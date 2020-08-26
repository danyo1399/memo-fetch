export * from './mfetch'
import { default as mfetch } from './mfetch'

export { cache, setGlobalConfig } from './config'
export {
  ConfigInterface,
  revalidateType,
  RevalidateOptionInterface,
  keyInterface,
  responseInterface,
  CacheInterface
} from './types'
export default mfetch
