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

const MANIFEST_PATH =
  './examples/simple-iwa-example/public/.well-known/manifest.webmanifest';
const UPDATE_JSON_PATH = './iwa-update-manifest.json';
const ARTIFACT_NAME = 'simple-iwa-example.swbn';

const releaseTag = process.env.TAG;
if (!releaseTag) {
  throw new Error('TAG environment variable not set.');
}

const newVersion = process.env.VERSION;
if(!newVersion){
  throw new Error('VERSION environment variable not set.');
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
manifest.version = newVersion;
fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`✅ Successfully bumped manifest version to ${newVersion}`);

const tagsJson = process.env.ALL_TAGS_JSON;
let allTags = [];

if (tagsJson) {
  try {
    const tagsFromApi = JSON.parse(tagsJson);
    allTags = tagsFromApi.map((tagObject) =>
      tagObject.ref.replace('refs/tags/', '')
    );
  } catch (e) {
    console.error('Failed to parse tags JSON from API:', e);
    throw new Error('Could not parse ALL_TAGS_JSON.');
  }
}

// Add the newly generated tag to the list if it's not already there
if (!allTags.includes(releaseTag)) {
  allTags.push(releaseTag);
}

const versions = allTags.map((tag) => {
  return {
    version: tag.replace('connector-', ''),
    src: `https://github.com/google/sso-offloading/releases/download/${tag}/${ARTIFACT_NAME}`,
  };
});

const updateManifest = {
  versions,
};

fs.writeFileSync(
  UPDATE_JSON_PATH,
  JSON.stringify(updateManifest, null, 2) + '\n'
);
console.log(
  `✅ Successfully generated ${UPDATE_JSON_PATH} with ${versions.length} versions.`
);
