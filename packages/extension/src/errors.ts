class InvalidRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRequestError';
  }
}

class TabCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TabCreationError';
  }
}

class UnauthorizedConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedConnectionError';
  }
}

export { InvalidRequestError, TabCreationError, UnauthorizedConnectionError };
