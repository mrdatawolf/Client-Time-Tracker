/**
 * Bundle API Server
 *
 * Uses esbuild to bundle the Hono API server + @ctt/shared package into a
 * single ESM file (dist-server/api-server.js). This resolves all workspace
 * dependencies so we don't need to ship the source tree.
 *
 * External packages (native/WASM) are NOT bundled — they're copied separately
 * by package-standalone.js into dist-server/node_modules/.
 *
 * Run with: pnpm build:server
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT_DIR, 'dist-server');

async function bundle() {
  console.log('');
  console.log('========================================');
  console.log('  Bundle API Server (esbuild)');
  console.log('========================================');
  console.log('');

  // Ensure output directory exists
  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
  }

  try {
    const result = await esbuild.build({
      entryPoints: [path.join(ROOT_DIR, 'packages', 'server', 'src', 'index.ts')],
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      outfile: path.join(OUT_DIR, 'api-server.js'),

      // These packages have native bindings or WASM files that can't be bundled.
      // They'll be copied to dist-server/node_modules/ by package-standalone.js.
      external: [
        '@electric-sql/pglite',
        'pg',
        'pg-native',
        'pdfkit',
        'sharp',
      ],

      // ESM output needs createRequire for any CJS dependencies
      banner: {
        js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
      },

      // Suppress warnings about __dirname (we use import.meta.url in the source)
      define: {
        'import.meta.dirname': 'undefined',
      },

      sourcemap: false,
      minify: false, // Keep readable for debugging
      treeShaking: true,

      logLevel: 'info',
    });

    if (result.errors.length > 0) {
      console.error('Build errors:', result.errors);
      process.exit(1);
    }

    const outFile = path.join(OUT_DIR, 'api-server.js');
    const stats = fs.statSync(outFile);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);

    console.log('');
    console.log(`  Output: dist-server/api-server.js (${sizeMB} MB)`);
    console.log('  Bundle complete!');
    console.log('');
  } catch (err) {
    console.error('esbuild failed:', err);
    process.exit(1);
  }
}

bundle();
