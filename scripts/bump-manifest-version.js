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
