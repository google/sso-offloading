import { createSsoOffloadingConnectorForChromeApp } from 'sso-offloading-connector';

const ssoForm = document.getElementById('ssoForm');
const extensionIdInput = document.getElementById('extensionId');
const authUrlInput = document.getElementById('authUrl');
const enableSsoOffloadingButton = document.getElementById(
  'enableSsoOffloadingButton'
);
const ssoWebview = document.getElementById('sso-webview');
const statusContainer = document.getElementById('statusContainer');

let ssoConnector = null;

const handleSuccess = (url) => {
  statusContainer.className = 'success';
  statusContainer.innerHTML = `✅ Success! The connector has redirected the webview.`;
};

const handleError = (error) => {
  statusContainer.className = 'error';
  const details = error.details
    ? `<pre>${JSON.stringify(error.details, null, 2)}</pre>`
    : '';
  statusContainer.innerHTML = `
    <p><b>❌ SSO Error: ${error.name}</b></p>
    <p>${error.message}</p>
    ${details}
  `;
};

const setupSsoOffloading = async (extensionId, authUrl) => {
  if (ssoConnector) {
    ssoConnector.stop();
    ssoConnector = null;
  }

  statusContainer.className = 'info';
  statusContainer.textContent = 'Attempting to start SSO connector...';

  try {
    ssoConnector = createSsoOffloadingConnectorForChromeApp(
      extensionId,
      ssoWebview,
      {
        urls: [authUrl],
      },
      handleSuccess,
      handleError
    );
    await ssoConnector.start();
statusContainer.textContent =
      '✅ Connector started. Navigating to auth URL to trigger interception...';

    const navigationUrl = authUrl.replace('/*', '/');
    ssoWebview.src = navigationUrl;
  } catch (error) {
    handleError(error);
  }
};

ssoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const extensionId = extensionIdInput.value;
  const authUrl = authUrlInput.value;
  if (extensionId && authUrl) {
    setupSsoOffloading(extensionId, authUrl);
  } else {
    statusContainer.className = 'error';
    statusContainer.textContent = 'Please enter both Extension ID and Auth URL.';
  }
});

function updateButtonState() {
  const isDisabled = !(extensionIdInput.value && authUrlInput.value);
  enableSsoOffloadingButton.disabled = isDisabled;
}

extensionIdInput.addEventListener('input', updateButtonState);
authUrlInput.addEventListener('input', updateButtonState);

window.addEventListener('DOMContentLoaded', () => {
  updateButtonState();
});