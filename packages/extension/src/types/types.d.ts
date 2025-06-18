type WebRequestHandler = (
  details: chrome.webRequest.OnBeforeRequestDetails
) => chrome.webRequest.BlockingResponse;

type PingMessage = { type: 'ping' };
type PongMessage = { type: 'pong' };
type SsoRequestMessage = { type: 'ssoRequest'; payload: { url: string } };
type SsoSuccessMessage = { type: 'ssoSuccess'; payload: { url: string } };
type SsoErrorMessage = { type: 'ssoError'; payload: { errorMessage: string } };

type ExtensionMessage =
  | PingMessage
  | PongMessage
  | SsoRequestMessage
  | SsoSuccessMessage
  | SsoErrorMessage;
