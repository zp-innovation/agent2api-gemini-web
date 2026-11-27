// Where the backend, its config and its cookie pool live. Magpie keeps a plugin's home directory
// inside whatever runs it, so an update of the host that replaces the container takes the whole
// backend with it: the binary, the API key and every cookie in the pool. A container that mounts a
// volume keeps that volume, so a backend kept on the volume is still there after the update.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isContainerEnv } from './proc.mjs';

const DATA_DIR_NAME = 'magpie-gemini-web';

// agent2api mounts its own data directory at /data and names it in AGENT2API_PROXY_HOME; the
// backend goes in a subdirectory of it, beside the host's own files.
const DURABLE_ROOTS = ['AGENT2API_PROXY_HOME', '/data'];

export function legacyDataDir(home = os.homedir()) {
  return path.join(home, '.local', 'share', DATA_DIR_NAME);
}

// durableDataDir is the data dir a container can keep across host updates, or null when nothing
// durable is mounted, and outside a container.
export function durableDataDir(env = process.env, {
  container = isContainerEnv({ env }),
  existsSync = fs.existsSync,
  accessSync = fs.accessSync
} = {}) {
  if (!container) return null;
  for (const name of DURABLE_ROOTS) {
    const root = (name === '/data' ? name : String(env[name] || '')).trim();
    if (!root) continue;
    try {
      if (!existsSync(root)) continue;
      accessSync(root, fs.constants.W_OK);
    } catch {
      continue;
    }
    return path.join(root, 'plugin-data', DATA_DIR_NAME);
  }
  return null;
}

// getDataDir keeps an install that already lives in the home directory where it is — moving it
// would strand the backend running from there and the pool it serves — and gives a fresh container
// the volume, so what it sets up survives the next host update.
export function getDataDir(env = process.env, options = {}) {
  const explicit = env.GEMINI_WEB_DATA_DIR;
  if (explicit) return explicit;
  const durable = durableDataDir(env, options);
  const legacy = legacyDataDir(options.home);
  if (!durable) return legacy;
  const exists = options.existsSync || fs.existsSync;
  try {
    if (exists(legacy)) return legacy;
  } catch {}
  return durable;
}
