#!/usr/bin/env node
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

import fs from 'fs/promises';
import path from 'path';

const target = process.argv[2];
const newVersion = process.argv[3];

if (!target || !['connector', 'extension'].includes(target)) {
  console.error(
    'Error: Please provide a valid target ("connector" or "extension") as the first argument.'
  );
  console.error(
    'Usage: node scripts/bump-version.js <connector|extension> <new-version>'
  );
  process.exit(1);
}

if (!newVersion) {
  console.error(
    'Error: Please provide a new version number as the second argument.'
  );
  console.error(
    'Usage: node scripts/bump-version.js <connector|extension> <new-version>'
  );
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error(
    `Error: Invalid version format "${newVersion}". Please use "x.y.z" format.`
  );
  process.exit(1);
}

let filesToUpdate = [];

if (target === 'connector') {
  filesToUpdate = [
    'packages/sso-offloading-connector/package.json',
    'examples/simple-iwa-example/package.json',
    'examples/simple-iwa-example/public/.well-known/manifest.webmanifest',
    'examples/chrome-app-example/package.json',
    'examples/chrome-app-example/manifest.json',
  ];
} else if (target === 'extension') {
  filesToUpdate = [
    'packages/extension/package.json',
    'packages/extension/src/manifest.json',
  ];
}

async function updateVersionInFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const fileContent = await fs.readFile(absolutePath, 'utf-8');
  const json = JSON.parse(fileContent);
  json.version = newVersion;
  await fs.writeFile(absolutePath, JSON.stringify(json, null, 2) + '\n');
  console.log(`Updated ${filePath} to version ${newVersion}`);
}

console.log(`Bumping versions for target "${target}" to ${newVersion}...`);

Promise.all(filesToUpdate.map(updateVersionInFile))
  .then(() => console.log('All versions bumped successfully!'))
  .catch((err) => console.error('An error occurred:', err));
