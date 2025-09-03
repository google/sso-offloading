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
export class SsoOffloadingConnectorError extends Error {
  public readonly details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'SsoOffloadingConnectorError';
    this.details = details;
  }
}

/**
 * Thrown when the connector is initialized with invalid parameters.
 */
export class ConfigurationError extends SsoOffloadingConnectorError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Thrown when there is an issue communicating with the Chrome extension.
 */
export class CommunicationError extends SsoOffloadingConnectorError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'CommunicationError';
  }
}

/**
 * Thrown when the extension provides a response that is not expected.
 */
export class SsoOffloadingExtensionResponseError extends SsoOffloadingConnectorError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'SsoOffloadingExtensionResponseError';
  }
}
