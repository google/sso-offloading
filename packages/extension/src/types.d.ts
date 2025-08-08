// Messages received from the IWA
type SsoRequestMessage =
  | { type: 'ping' }
  | { type: 'sso_request'; url: string };

// Messages sent to the IWA
type ExtensionMessage =
  | { type: 'pong' }
  | { type: 'success'; redirect_url: string }
  | { type: 'error'; message: string }
  | { type: 'cancel'; message: string }
