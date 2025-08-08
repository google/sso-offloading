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

/** User manually closed the auth tab. */
class UserCanceledError extends Error {
  constructor(message = 'User canceled the authentication flow.') {
    super(message)
    this.name = 'UserCanceledError'
  }
}

export {
  InvalidRequestError,
  TabCreationError,
  UnauthorizedConnectionError,
  UserCanceledError,
}
