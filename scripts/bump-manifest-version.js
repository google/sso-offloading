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

import fs from 'fs';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('Error: Manifest path not provided.');
  process.exit(1);
}

// Get version from the environment variable
const newVersionTag = process.env.VERSION;
if (!newVersionTag) {
  console.error('Error: VERSION environment variable not set.');
  process.exit(1);
}

// Remove 'v' prefix if it exists (e.g., v1.2.3 -> 1.2.3)
const newVersion = newVersionTag.replace('v', '');

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  manifest.version = newVersion;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `✅ Successfully updated version to ${newVersion} in ${manifestPath}`
  );
} catch (error) {
  console.error(`Failed to update manifest at ${manifestPath}:`, error);
  process.exit(1);
}
