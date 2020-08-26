export * from './mfetch'
import { default as mfetch } from './mfetch'

export { cache } from './config'
export {
  ConfigInterface,
  revalidateType,
  RevalidateOptionInterface,
  keyInterface,
  responseInterface,
  CacheInterface
} from './types'
export default mfetch
