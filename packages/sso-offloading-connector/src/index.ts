/*
 Copyright 2025 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */
/**
 * This file is the public API entry point for the sso-offloading-connector package.
 * It exports all the necessary functions, types, and error classes for consumers.
 */

import type {
  ExtensionMessage,
  SsoRequestMessage,
  RequestFilter,
} from './types';

export {
  SsoOffloadingConnectorError,
  ConfigurationError,
  CommunicationError,
  SsoOffloadingExtensionResponseError,
} from './errors';

export {
  createSsoOffloadingConnector,
  type SsoOffloadingConnector,
} from './sso_offloading_connector';

export { type ExtensionMessage, type SsoRequestMessage, type RequestFilter };
