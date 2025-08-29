import fs from 'fs';

const MANIFEST_PATH =
  './examples/simple-iwa-example/public/.well-known/manifest.webmanifest';
const UPDATE_JSON_PATH = './iwa-update-manifest.json';
const ARTIFACT_NAME = 'simple-iwa-example.swbn';

// Bump the version in the main manifest.webmanifest
const newVersionTag = process.env.VERSION;
if (!newVersionTag) {
  throw new Error('VERSION environment variable not set.');
}
const newVersion = newVersionTag.replace('v', '');

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
if (!allTags.includes(newVersionTag)) {
  allTags.push(newVersionTag);
}

const versions = allTags.map((tag) => {
  const version = tag.replace('v', '');
  return {
    version: version,
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
