export class SsoOffloadingConnectorError extends Error {
  public readonly details?: any

  constructor(message: string, details?: any) {
    super(message)
    this.name = 'SsoOffloadingConnectorError'
    this.details = details
  }
}

/**
 * Thrown when the connector is initialized with invalid parameters.
 */
export class ConfigurationError extends SsoOffloadingConnectorError {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

/**
 * Thrown when there is an issue communicating with the Chrome extension.
 */
export class CommunicationError extends SsoOffloadingConnectorError {
  constructor(message: string, details?: any) {
    super(message, details)
    this.name = 'CommunicationError'
  }
}

/**
 * Thrown when the extension provides a response that is not expected.
 */
export class UnsuccessfulResponseError extends SsoOffloadingConnectorError {
  constructor(message: string, details?: any) {
    super(message, details)
    this.name = 'UnsuccessfulResponseError'
  }
}
