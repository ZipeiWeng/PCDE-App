import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
};
const marker = '/*__PAWPRINT_STATIC_ASSETS__*/ {}';

// Static source files currently live in dist/. Preserve them, and do not embed
// generated server output, the hosting manifest, dotfiles, or source maps.
export async function buildWorker(projectRoot) {
  const root = resolve(projectRoot);
  const assetRoot = join(root, 'dist');
  const assets = {};
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'server') continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile()) continue;
      const type = mimeTypes[extname(entry.name).toLowerCase()];
      if (!type) continue;
      const bytes = await readFile(path);
      if (bytes.byteLength > 5 * 1024 * 1024) throw new Error(`Static asset exceeds 5 MB: ${relative(root, path)}`);
      assets['/' + relative(assetRoot, path).split('\\').join('/')] = { type, base64: bytes.toString('base64') };
    }
  }
  await walk(assetRoot);
  if (!assets['/index.html']) throw new Error('dist/index.html is required.');
  const workerSource = await readFile(join(root, 'worker/index.js'), 'utf8');
  if (workerSource.split(marker).length !== 2) throw new Error('Worker asset placeholder must appear exactly once.');
  let source = workerSource.replace(marker, JSON.stringify(assets));
  const authImport = "import { handleAuth, verifiedAccountId } from './auth.js';";
  if (source.split(authImport).length !== 2) throw new Error('Worker auth import must match the supported inliner exactly once.');
  const authSource = (await readFile(join(root, 'worker/auth.js'), 'utf8')).replace(/^export /gm, '');
  source = source.replace(authImport, () => authSource);
  const feedbackImport = "import { createVetFeedbackHandler } from './vet-feedback.js';";
  if (source.split(feedbackImport).length !== 2) throw new Error('Worker feedback import must match the supported inliner exactly once.');
  const feedbackSource = (await readFile(join(root, 'worker/vet-feedback.js'), 'utf8')).replace(/^export /gm, '');
  source = source.replace(feedbackImport, () => `const { createVetFeedbackHandler } = (() => {\n${feedbackSource}\nreturn { createVetFeedbackHandler };\n})();`);
  const healthImport = "import { createHealthDataHandler, loadHealthContext } from './health-data.js';";
  if (source.split(healthImport).length !== 2) throw new Error('Worker health import must match the supported inliner exactly once.');
  const healthSource = (await readFile(join(root, 'worker/health-data.js'), 'utf8')).replace(/^export /gm, '');
  source = source.replace(healthImport, () => `const { createHealthDataHandler, loadHealthContext } = (() => {\n${healthSource}\nreturn { createHealthDataHandler, loadHealthContext };\n})();`);
  const billingImport = "import { createBillingHandler } from './billing.js';";
  if (source.split(billingImport).length !== 2) throw new Error('Worker billing import must match the supported inliner exactly once.');
  const billingSource = (await readFile(join(root, 'worker/billing.js'), 'utf8')).replace(/^export /gm, '');
  source = source.replace(billingImport, () => `const { createBillingHandler } = (() => {\n${billingSource}\nreturn { createBillingHandler };\n})();`);
  const shopImport = "import { createShopHandler } from './shop.js';";
  if (source.split(shopImport).length !== 2) throw new Error('Worker shop import must match the supported inliner exactly once.');
  const shopSource = (await readFile(join(root, 'worker/shop.js'), 'utf8')).replace(/^export /gm, '');
  source = source.replace(shopImport, () => `const { createShopHandler } = (() => {\n${shopSource}\nreturn { createShopHandler };\n})();`);
  const manifestPath = join(root, '.openai/hosting.json');
  let manifest;
  if ((await stat(manifestPath).catch(() => null))?.isFile()) {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (manifest.static) throw new Error('Remove static configuration from .openai/hosting.json before building the Worker.');
  }
  await mkdir(join(root, 'dist/server'), { recursive: true });
  await writeFile(join(root, 'dist/server/index.js'), source);
  if (manifest) {
    await mkdir(join(root, 'dist/.openai'), { recursive: true });
    await writeFile(join(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  return { assets: Object.keys(assets).length, bytes: Buffer.byteLength(source) };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const result = await buildWorker(root);
  console.log(`Worker built: ${result.assets} embedded assets, ${result.bytes.toLocaleString('en-US')} bytes.`);
}
