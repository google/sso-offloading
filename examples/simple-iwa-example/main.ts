import {
  createSsoOffloadingConnector,
  SsoConnectorError,
} from 'sso-offloading-connector';

console.log('Is chrome.runtime available?', chrome.runtime); 

const ssoForm = document.getElementById('ssoForm') as HTMLFormElement;
const extensionIdInput = document.getElementById(
  'extensionId'
) as HTMLInputElement;
const authUrlInput = document.getElementById('authUrl') as HTMLInputElement;
const enableSsoOffloadingButton = document.getElementById(
  'enableSsoOffloadingButton'
) as HTMLButtonElement;
const ssoCf = document.getElementById('ssoCf') as HTMLIFrameElement;

let ssoConnector: ReturnType<typeof createSsoOffloadingConnector> | null = null;

const handleSuccess = (url: string) => {
    console.log('SSO Offloading Connector started.');
    enableSsoOffloadingButton.disabled = true;
  console.log(`✅ SSO Success! Final URL: ${url}`);

  ssoCf.src = url;
};

const handleError = (error: SsoConnectorError) => {
  console.error(
    `❌ SSO Error: ${error.name} - ${error.message}`,
    error.details
  );
};

const setupSsoOffloading = async (extensionId: string, authUrl: string) => {
  if (ssoConnector) {
    ssoConnector.stop();
    ssoConnector = null;
  }

  ssoConnector = createSsoOffloadingConnector(
    extensionId,
    ssoCf as any,
    {
      urls: [authUrl],
    },
    handleSuccess,
    handleError
  );
  console.log('Is chrome.runtime available?', chrome.runtime); 

    await ssoConnector.start();
};

if (
  ssoForm &&
  extensionIdInput &&
  authUrlInput &&
  enableSsoOffloadingButton &&
  ssoCf
) {
  ssoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const extensionId = extensionIdInput.value;
    const authUrl = authUrlInput.value;
    console.log('Extension ID:', extensionId);
    console.log('Auth URL:', authUrl);
    enableSsoOffloadingButton.disabled = !(extensionId && authUrl);
  });

  enableSsoOffloadingButton.addEventListener('click', () => {
    const extensionId = extensionIdInput.value;
    const authUrl = authUrlInput.value;
    if (extensionId && authUrl) {
      setupSsoOffloading(extensionId, authUrl);
    } else {
      alert('Please enter both Extension ID and Auth URL.');
    }
  });
} else {
  console.error('One or more required elements not found in the DOM.');
}

// Initial check to enable button if values are present on load
if (extensionIdInput?.value && authUrlInput?.value) {
  enableSsoOffloadingButton.disabled = false;
}
