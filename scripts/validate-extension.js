/**
 * ChatGPT Context Monitor - Extension Validation Script
 * 
 * Validates Manifest V3 compliance, file path existence,
 * permission scoping, and security constraints.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('[Validator] Running Manifest V3 & Extension Pre-flight Verification...\n');

let errorCount = 0;
let checkCount = 0;
function assert(condition, message) {
  checkCount++;
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    errorCount++;
  } else {
    console.log(`✅ [PASS] ${message}`);
  }
}

// 1. Check manifest.json
const manifestPath = path.join(rootDir, 'manifest.json');
assert(fs.existsSync(manifestPath), 'manifest.json exists');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// 2. MV3 checks
assert(manifest.manifest_version === 3, 'manifest_version is 3');
assert(!manifest.background?.scripts, 'No MV2 background.scripts declaration');
assert(manifest.background?.service_worker, 'MV3 background.service_worker declared');

// 3. Physical file existence
const swPath = path.join(rootDir, manifest.background.service_worker);
assert(fs.existsSync(swPath), `Service worker file exists: ${manifest.background.service_worker}`);

// The toolbar icon opens the side panel
assert(manifest.action && !manifest.action.default_popup, 'No duplicate popup UI (action has no default_popup)');

if (manifest.side_panel?.default_path) {
  const panelPath = path.join(rootDir, manifest.side_panel.default_path);
  assert(fs.existsSync(panelPath), `Side panel HTML file exists: ${manifest.side_panel.default_path}`);
  const panelScript = path.join(path.dirname(panelPath), 'sidepanel.js');
  assert(fs.existsSync(panelScript), `Side panel script file exists: sidepanel/sidepanel.js`);
}

for (const [size, iconRelPath] of Object.entries(manifest.icons)) {
  const iconPath = path.join(rootDir, iconRelPath);
  assert(fs.existsSync(iconPath), `Icon file (${size}x${size}) exists: ${iconRelPath}`);
}

for (const cs of manifest.content_scripts || []) {
  for (const jsFile of cs.js || []) {
    const csPath = path.join(rootDir, jsFile);
    assert(fs.existsSync(csPath), `Content script file exists: ${jsFile}`);
  }
}

// 4. Permissions check
assert(!manifest.permissions.includes('<all_urls>'), 'Permissions do not contain broad <all_urls>');
assert(manifest.permissions.includes('storage'), 'Required "storage" permission declared');
assert(manifest.permissions.includes('unlimitedStorage'), '"unlimitedStorage" declared (saved Capsules can exceed the 10 MB storage.local quota)');
assert(manifest.permissions.every(p => ['storage', 'unlimitedStorage', 'sidePanel'].includes(p)), 'No permissions beyond storage + unlimitedStorage + sidePanel');
const SUPPORTED_HOSTS = ['https://chatgpt.com/*', 'https://chat.openai.com/*', 'https://claude.ai/*', 'https://gemini.google.com/*'];
assert(JSON.stringify([...(manifest.host_permissions || [])].sort()) === JSON.stringify([...SUPPORTED_HOSTS].sort()), 'Host permissions scoped exactly to ChatGPT, Claude and Gemini');

// 5. Config files check (inlined into content-script.js by the build)
assert(fs.existsSync(path.join(rootDir, 'config', 'model-limits.json')), 'config/model-limits.json exists');

console.log('\n--- Verification Result ---');
if (errorCount === 0) {
  console.log(`🎉 All ${checkCount} Extension Validation checks PASSED with 0 errors.\n`);
  process.exit(0);
} else {
  console.error(`💥 Extension Validation FAILED with ${errorCount} error(s).\n`);
  process.exit(1);
}
