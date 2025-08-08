/**
 * This file is the public API entry point for the sso-offloading-connector package.
 * It exports all the necessary functions, types, and error classes for consumers.
 */

import type {
  ExtensionMessage,
  SsoRequestMessage,
  RequestFilter,
} from './types'

export {
  SsoOffloadingConnectorError,
  ConfigurationError,
  CommunicationError,
  UnsuccessfulResponseError
} from './errors'

export {
  createSsoOffloadingConnector,
  type SsoOffloadingConnector,
} from './sso_offloading_connector'

export { type ExtensionMessage, type SsoRequestMessage, type RequestFilter }
