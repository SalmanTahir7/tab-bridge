import { build } from 'vite';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
const origin = process.env.TAB_BRIDGE_ORIGIN || 'http://localhost:5173';
const url = new URL(origin);
// Firefox WebExtension match patterns do not support ports.
// Keep BRIDGE_ORIGIN as the exact origin for runtime checks and navigation.
const matchPattern = `${url.protocol}//${url.hostname}/*`;
if (url.origin !== origin || (url.protocol !== 'https:' && origin !== 'http://localhost:5173')) throw new Error('Use an exact HTTPS origin, or the default local demo origin');
await mkdir('extension-dist', { recursive: true });
for (const name of ['background', 'content', 'transfer']) await build({ configFile: false, define: { BRIDGE_ORIGIN: JSON.stringify(origin) }, build: { outDir: 'extension-dist', emptyOutDir: false, target: 'firefox128', lib: { entry: `extension/${name}.ts`, name: 'TabBridge', formats: ['iife'], fileName: () => `${name}.js` } } });
for (const name of ['popup.html', 'popup.js', 'styles.css']) await copyFile(name, `extension-dist/${name}`);
await copyFile('extension/transfer.html', 'extension-dist/transfer.html');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
manifest.version = '2.0.0';
manifest.description = 'Send selected tabs with encrypted, accountless transfers or copy URLs locally.';
manifest.permissions = [...new Set([...manifest.permissions, 'storage', 'scripting'])];
manifest.host_permissions = [matchPattern];
delete manifest.content_scripts; // MAIN-world injection replaces the fragile content-script event relay.
await writeFile('extension-dist/manifest.json', JSON.stringify(manifest, null, 2));
console.log(`Extension built for ${origin}`);
