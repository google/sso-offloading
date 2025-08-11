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
import { createSsoOffloadingConnector } from 'sso-offloading-connector';

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
  statusContainer.innerHTML = `Success! The connector has redirected the webview to ${url}.`;
};

const handleError = (error) => {
  statusContainer.className = 'error';
  statusContainer.innerHTML = `
    SSO Error: ${error.name},
    ${error.message},
    ${ error.details}
  `;
};

const setupSsoOffloading = async (extensionId, authUrl) => {
  if (ssoConnector) {
    ssoConnector.stop();
    ssoConnector = null;
  }

  statusContainer.className = 'info';
  statusContainer.textContent = 'Attempting to start SSO connector...';

  ssoConnector = createSsoOffloadingConnector(
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
    'Connector started. Navigating to auth URL to trigger interception...';

  const navigationUrl = authUrl.replace('/*', '/');
  ssoWebview.src = navigationUrl;
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