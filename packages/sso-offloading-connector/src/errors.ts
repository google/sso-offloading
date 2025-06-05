export class SsoConnectorError extends Error {
  public readonly details?: any;

  constructor(message: string, details?: any) {
    super(message);
    this.name = 'SsoConnectorError';
    this.details = details;
  }
}

/**
 * Thrown when the connector is initialized with invalid parameters.
 */
export class ConfigurationError extends SsoConnectorError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/**
 * Thrown when there is an issue communicating with the Chrome extension.
 */
export class CommunicationError extends SsoConnectorError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'CommunicationError';
  }
}

/**
 * Thrown when the extension provides a response that is malformed or invalid.
 */
export class InvalidResponseError extends SsoConnectorError {
  constructor(message: string, details?: any) {
    super(message, details);
    this.name = 'InvalidResponseError';
  }
}
