/**
 * This file is the public API entry point for the sso-offloading-connector package.
 * It exports all the necessary functions, types, and error classes for consumers.
 */

import type { ControlledFrame, ExtensionMessage } from './types';

export {
  SsoConnectorError,
  ConfigurationError,
  CommunicationError,
  InvalidResponseError,
} from './errors';

export { createSsoOffloadingConnector } from './sso_offloading_connector';
export { type ControlledFrame, type ExtensionMessage };
