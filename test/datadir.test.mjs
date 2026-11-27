import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { getDataDir, durableDataDir, legacyDataDir } from '../lib/datadir.mjs';

// A container throws its home directory away with the container, so a backend kept there does not
// survive a host update. agent2api mounts its data directory at /data and names it in
// AGENT2API_PROXY_HOME, which is where the backend goes when nothing is installed yet.
const HOME = '/home/magpie';

const env = (extra = {}) => ({ ...extra });
const writable = () => ({ container: true, existsSync: () => true, accessSync: () => {} });
const noRoots = () => ({ container: true, existsSync: () => false, accessSync: () => {} });

describe('datadir: where the backend lives', () => {
  it('stays in the home directory outside a container', () => {
    assert.equal(durableDataDir(env({ AGENT2API_PROXY_HOME: '/data' }), { container: false }), null);
    assert.equal(getDataDir(env({ AGENT2API_PROXY_HOME: '/data' }), { container: false, home: HOME }), legacyDataDir(HOME));
  });

  it('takes the mounted volume in a container that has nothing installed yet', () => {
    const dir = getDataDir(env({ AGENT2API_PROXY_HOME: '/data' }), { ...writable(), existsSync: p => p === '/data', home: HOME });
    assert.equal(dir, path.join('/data', 'plugin-data', 'magpie-gemini-web'));
  });

  it('reads the volume out of AGENT2API_PROXY_HOME, not a fixed /data', () => {
    const dir = durableDataDir(env({ AGENT2API_PROXY_HOME: '/srv/a2a' }), { ...writable(), existsSync: p => p === '/srv/a2a' });
    assert.equal(dir, path.join('/srv/a2a', 'plugin-data', 'magpie-gemini-web'));
  });

  it('falls back to /data when the host names no directory', () => {
    const dir = durableDataDir(env(), { ...writable(), existsSync: p => p === '/data' });
    assert.equal(dir, path.join('/data', 'plugin-data', 'magpie-gemini-web'));
  });

  it('ignores a volume it cannot write to', () => {
    const dir = durableDataDir(env({ AGENT2API_PROXY_HOME: '/data' }), {
      container: true,
      existsSync: () => true,
      accessSync: () => { throw new Error('EACCES'); }
    });
    assert.equal(dir, null);
    assert.equal(getDataDir(env({ AGENT2API_PROXY_HOME: '/data' }), { container: true, existsSync: () => true, accessSync: () => { throw new Error('EACCES'); }, home: HOME }), legacyDataDir(HOME));
  });

  it('keeps an install that already lives in the home directory where it is', () => {
    const legacy = legacyDataDir(HOME);
    const dir = getDataDir(env({ AGENT2API_PROXY_HOME: '/data' }), { ...writable(), existsSync: p => p === legacy, home: HOME });
    assert.equal(dir, legacy, 'moving it would strand the backend running from there and its pool');
  });

  it('lets GEMINI_WEB_DATA_DIR name the directory outright', () => {
    assert.equal(getDataDir(env({ GEMINI_WEB_DATA_DIR: '/tmp/x', AGENT2API_PROXY_HOME: '/data' }), { ...writable(), home: HOME }), '/tmp/x');
    assert.equal(getDataDir(env({ GEMINI_WEB_DATA_DIR: '/tmp/x' }), { container: false, home: HOME }), '/tmp/x');
  });
});
