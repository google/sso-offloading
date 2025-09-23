<!--
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
 -->

# SSO Offloading Connector

This package provides a TypeScript module for offloading Single Sign-On (SSO) authentication flows from a sandboxed client environment ([Isolated Web App](https://chromeos.dev/en/web/isolated-web-apps) or a [Chrome App](https://developer.chrome.com/docs/apps/overview)) to a dedicated Chrome Extension helper.

It is designed to be used within an IWA or Chrome App, intercepting authentication requests and delegating them to the [SSO Offloading Extension](https://github.com/GoogleChromeLabs/sso-offloading/tree/main/packages/extension). It works with both the IWA's `<controlledframe>` and the Chrome App's `<webview>`.

## Installation

```bash
npm install sso-offloading-connector
# or
pnpm add sso-offloading-connector
```

## How It Works

1.  **Handshake:** The connector first "pings" the companion extension to ensure it's installed and active.
2.  **Listen:** It attaches a request listener to the target view element (`<controlledframe>` or `<webview>`).
3.  **Intercept & Delegate:** When a navigation request inside the view matches your URL filters, the connector cancels the request and sends the URL to the offloading extension.
4.  **Redirect:** The connector waits for the extension to return the final redirect URL after a successful login. It then programmatically navigates the view to this URL, completing the flow.

## API and Usage

The main entry point is the `createSsoOffloadingConnector` factory function.

```typescript
import {
  createSsoOffloadingConnector,
  SsoOffloadingConnectorError,
  RequestFilter
} from 'sso-offloading-connector';

const viewElement = document.getElementById('auth-view') as HTMLIFrameElement; 

// URL patterns to intercept.
const requestFilter: RequestFilter = {
    urls: [
        'https://accounts.google.com/o/oauth2/v2/auth*',
        'https://sso.mycompany.com/*'
    ],
};

// (Optional) An error handler for issues during the offloading flow.
const onInterceptError = (error: SsoOffloadingConnectorError): void => {
  console.error(`SSO offloading failed: ${error.name}: ${error.message}`);
};

// Create the connector instance.
const ssoConnector = createSsoOffloadingConnector(
  viewElement,
  requestFilter,
  onInterceptError
);

// Start the connector to begin intercepting requests.
ssoConnector.start().then(() => {
  console.log('SSO offloading connector is active.');
}).catch(error => {
  console.error('Failed to start SSO connector:', error);
});

// Stop the connector when it's no longer needed.
// ssoConnector.stop();
```

### Error Handling

The library exports several custom error classes to help distinguish between different failure modes:
*   `ConfigurationError`: Problem with the initial setup (e.g., invalid element).
*   `CommunicationError`: The connector failed to establish a connection with the extension.
*   `SsoOffloadingExtensionResponseError`: The extension responded with an error during the auth flow.

## License

This project is licensed under the Apache 2.0 License.
