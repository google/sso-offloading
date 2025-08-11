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
