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
const authUrlInput = document.getElementById('authUrl');
const enableSsoOffloadingButton = document.getElementById(
  'enableSsoOffloadingButton'
);
const stopSsoOffloadingButton = document.getElementById(
  'stopSsoOffloadingButton'
);
const ssoWebview = document.getElementById('sso-webview');
const statusContainer = document.getElementById('statusContainer');

let ssoConnector = null;

const handleInterceptError = (error) => {
  statusContainer.className = 'error';
  statusContainer.innerHTML = `
    SSO Error: ${error.name},
    ${error.message}
  `;
};

const setupSsoOffloading = async (authUrl) => {
  if (ssoConnector) {
    ssoConnector.stop();
    ssoConnector = null;
  }

  statusContainer.className = 'info';
  statusContainer.textContent = 'Attempting to start SSO connector...';

  ssoConnector = createSsoOffloadingConnector(
    ssoWebview,
    {
      urls: [authUrl],
    },
    handleInterceptError
  );

  await ssoConnector.start().then(() => {
    statusContainer.className = 'success';
    statusContainer.textContent = 'SSO connector started successfully.';
  });

  stopSsoOffloadingButton.disabled = false;
  enableSsoOffloadingButton.disabled = true;
};

ssoForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const authUrl = authUrlInput.value;

  if (authUrl) {
    setupSsoOffloading(authUrl);
  } else {
    statusContainer.className = 'error';
    statusContainer.textContent =
      'Please enter both Extension ID and Auth URL.';
  }
});

stopSsoOffloadingButton.addEventListener('click', () => {
  ssoConnector.stop();
  ssoConnector = null;
});

function updateButtonState() {
  const isDisabled = !authUrlInput.value;
  enableSsoOffloadingButton.disabled = isDisabled;
  stopSsoOffloadingButton.disabled = !ssoConnector;
}

authUrlInput.addEventListener('input', updateButtonState);

updateButtonState();
