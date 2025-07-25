# sso-offloading
## SSO Offloading Extension
## SSO Offloading Connector
TypeScript module designed to intercept auth requests from a <cf> element and hand them off to a Chrome extension.
The `SsoOffloadingConnector` class provides a mechanism to intercept navigation requests within a `<cf>` element in IWA, cancel them, and delegate the handling to a specified Chrome extension. 
How It Works ⚙️
1. Initialization: An instance is created with the target Chrome extension's ID, a reference to the `<cf>` element (ControlledFrame), and a set of URL filters.

2. Listening: The start() method attaches an onBeforeRequest listener to the `<cf>`. This listener monitors all network requests initiated by the frame.

3. Interception & Cancellation: When a request's URL matches the provided requestFilter, the interceptRequestListener function is triggered. This function immediately returns { cancel: true }, which stops the original navigation request in its tracks.

4. Delegation: The listener then calls handleInterceptRequest, which sends the intercepted URL to the specified Chrome extension using chrome.runtime.sendMessage.

5. Redirection: The connector waits for the extension to process the SSO flow. When the extension sends a response message containing a new URL (e.g., a callback URL with an auth code), the handleMessageFromExtension method receives it. This method then programmatically sets the <cf>'s src attribute to the new URL, completing the redirection.

6. Cleanup: The `stop()` method removes the event listener, ceasing all interception activity.

## Example Usage
```typescript
// Get a reference to the <cf> element
const cfElement = document.getElementById('auth-cf') as ControlledFrame;

const SSO_EXTENSION_ID = 'abcdefghijk1234567890'; // The ID of your SSO handler extension

// 1. Define the connector options
const connectorOptions: ConnectorOptions = {
  requestFilter: {
    urls: ['https://accounts.google.com/o/oauth2/v2/auth*','https://sso.mycompany.com/*'], // Intercept all requests to these domains.
  },
};

// 2. Create a new instance of the connector
const ssoConnector = new SsoOffloadingConnector(
  SSO_EXTENSION_ID,
  cfElement,
  connectorOptions
);

// 3. Start listening for requests
ssoConnector.start();

// The user clicks a login button inside the webview, which navigates to 'https://sso.mycompany.com/login' (or Google's auth or any auth that matches the url filters).
// The connector intercepts this, sends the URL to the extension, and waits.
// The extension performs the login and sends back a new redirect URL with response codes.
// The connector receives this and sets cf's src to the new URL. The frame renders the page from that address.

// 4. Stop the connector if no longer needed.
ssoConnector.stop();
```