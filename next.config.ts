import type { NextConfig } from 'next';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Set NEXT_PUBLIC_BASE_PATH when the site is served from a subpath
// (e.g. /Client-Time-Tracker on GitHub Pages). Empty for local dev.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
