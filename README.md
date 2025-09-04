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

# sso-offloading

This project provides a solution for offloading Single Sign-On (SSO) authentication flows from a sandboxed client environment (like an Isolated Web App or a Chrome App) to a dedicated Chrome Extension helper.

It consists of two main parts:

**SSO offloading extension**: A Chrome Extension that processes the authentication flow in a separate, top-level tab.

**SSO Offloading Connector**: A TypeScript module used by the application to intercept auth requests and delegate them to the offloading extension.

## SSO Offloading Extension

The SSO Handler is a background service worker that acts as a trusted helper for processing authentication.

### How It Works ⚙️

1.  **Listens for Requests:** It listens for external messages from trusted applications using `chrome.runtime.onMessageExternal`.
2.  **Validates:** It checks if the request is from a allowlisted origin and that no flow is already in progress for that origin.
3.  **Opens Auth Tab:** Upon receiving a valid `sso_request`, it opens the provided authentication URL in a new, focused browser tab.
4.  **Monitors for Redirect:** It watches the tab for navigation. When the tab's URL matches the `redirect_uri` specified in the initial request, it knows the flow is complete.
5.  **Returns Result:** It captures the final redirect URL (containing the authorization code or tokens) and sends it back to the application in a `success` message.
6.  **Handles Cancellation:** If the user closes the authentication tab manually, it detects this and sends a `cancel` message back to the application.
7.  **Cleans Up:** After the flow succeeds, fails, or is canceled, it closes the auth tab and cleans up all listeners.

## SSO Offloading Connector

This is a TypeScript module designed to be used within an **Isolated Web App** or a **Chrome App**. It intercepts authentication requests and offloads them to the SSO offloading extension. It works with both the IWA's `<controlledframe>` and the Chrome App's `<webview>`.

### How It Works ⚙️

1.  **Creation:** Create a connector instance using the `createSsoOffloadingConnector` factory function. It requires the offloading extension's ID, a reference to the target view element (`<controlledframe>` or `<webview>`), and URL filters. Optional parameters include `onInterceptError` callback that will be run by the conenctor when any error occurs during offloading flow.
2.  **Handshake:** The `start()` method first "pings" the extension with a `ping` message to ensure it's installed and active before proceeding.
3.  **Listening:** If the handshake is successful, it attaches a request listener to the target view element using the appropriate platform API.
4.  **Interception & Delegation:** When a navigation request inside the view matches the URL filters, the connector cancels the request and sends the intercepted URL to the offloading extension in an `sso_request` message.
5.  **Redirection:** The connector waits for the extension to send back a `success` message containing the final redirect URL. It then programmatically sets the view's `src` attribute to this new URL, completing the authentication flow within the application.
6.  **Cleanup:** The `stop()` method removes the event listener and ceases interception.

---

## Example Usage

```typescript
import { createSsoOffloadingConnector, SsoOffloadingConnectorError } from 'sso_offloading_connector';

// Get a reference to the <controlledframe> element (or <webview>)
const cfElement = document.getElementById('auth-cf'); // Can also be a WebView element.

const SSO_EXTENSION_ID = 'abcdefghijk1234567890'; // The ID of SSO offloading extension

const requestFilter: RequestFilter = {
    urls: ['https://accounts.google.com/o/oauth2/v2/auth*','https://sso.mycompany.com/*'], // Intercept all requests to these domains.
};

const onInterceptError = (error: SsoOffloadingConnectorError): void => {
  console.log("Error occured :(, "+ error.name +": "+ error.message);
}

// Create connector instance
const ssoConnector = new SsoOffloadingConnector(
  SSO_EXTENSION_ID,
  cfElement,
  requestFilter,
  onInterceptError
);

// Start offloading SSO calls for the cf.
ssoConnector.start().catch(...);

// Stop the connector if no longer needed.
ssoConnector.stop();
```

## Dev setup

1. Build

```bash
# Build the core SSO Connector and offloading extension
npm run build

# Build the Chrome App example
npm run build:chrome-app

# Build the Isolated Web App (IWA) example (optional, .swbn can be downloaded from this repo, bundle id: yr57inu2f27fji2d2xd2lj7fjt3scdhby3bs7s4vdxh3rrujkdnaaaic, version 1.0.0)

# Note: This may require a pre-generated key.
npm run build:iwa
```

2. Packaging and force-installing extension (and Chrome App example)
   This project uses the [localExtensionHost](https://github.com/alex292/localExtensionHost/tree/main) tool to package and host locally the offloading extension and Chrome App. Mentioned repository contains detailed instructions on this step, including how to force-install packaged projects for ChromeOS.

3. Force - install IWA
   IWA bundle (`.swbn` file), as well as its `update_manifest.json` file, needs to be hosted and then the app has to be force-installed via [`IsolatedWebAppInstallForceList`](https://chromeenterprise.google/policies/#IsolatedWebAppInstallForceList) policy.
   [Getting started with Isolated Web Apps](https://chromeos.dev/en/tutorials/getting-started-with-isolated-web-apps) article for reference.

4. Test time!

This is not an officially supported Google product. This project is not
eligible for the [Google Open Source Software Vulnerability Rewards
Program](https://bughunters.google.com/open-source-security).
