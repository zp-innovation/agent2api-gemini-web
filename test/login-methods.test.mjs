import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiWebPlugin, AIStudioPlugin } from '../index.mjs';

// Hosts read a method's declared prompts before they ever call ask(), and a host that finds a
// declared select without options refuses the provider's whole login list (agent2api answers
// 502 插件登录选择字段没有可用选项, which Magpie's setup card shows as 无法读取登录方式). A live
// account pool cannot be declared ahead of time, so a picker that depends on runtime state
// belongs to ask(); any select declared here must already carry real options.
const PLUGINS = [
  ['GeminiWebPlugin', () => GeminiWebPlugin({})],
  ['AIStudioPlugin', () => AIStudioPlugin()]
];

describe('declared login methods', () => {
  for (const [name, make] of PLUGINS) {
    it(`${name} declares only prompts a host can read and render`, async () => {
      const plugin = await make();
      assert.ok(plugin.auth.methods.length > 0, `${name} declares no login method`);
      for (const [index, method] of plugin.auth.methods.entries()) {
        const where = `${name} method ${index} (${method.label})`;
        assert.ok(['oauth', 'api'].includes(method.type), `${where}: unexpected type ${method.type}`);
        const keys = [];
        for (const prompt of method.prompts ?? []) {
          assert.ok(['text', 'select'].includes(prompt.type), `${where}: prompt type ${prompt.type}`);
          assert.equal(typeof prompt.key, 'string', `${where}: prompt without a key`);
          assert.ok(prompt.key.length > 0, `${where}: prompt with an empty key`);
          keys.push(prompt.key);
          if (prompt.type !== 'select') continue;
          assert.ok(Array.isArray(prompt.options) && prompt.options.length > 0,
            `${where}: select ${prompt.key} declares no options; hosts refuse that before ask() runs`);
          const values = prompt.options.map(option => String(option.value));
          assert.ok(values.every(value => value.length > 0), `${where}: select ${prompt.key} has an empty option value`);
          assert.equal(new Set(values).size, values.length, `${where}: select ${prompt.key} repeats an option value`);
          if (prompt.default !== undefined) {
            assert.ok(values.includes(String(prompt.default)), `${where}: select ${prompt.key} defaults outside its options`);
          }
        }
        assert.equal(new Set(keys).size, keys.length, `${where}: repeats a prompt key`);
      }
    });
  }

  it('declares a cookie-paste sign-in that needs no callback dialog', async () => {
    const methods = (await GeminiWebPlugin({})).auth.methods;
    const cookie = methods.find(m => m.label.startsWith('粘贴 Cookie 直接登录'));
    assert.ok(cookie, 'GeminiWebPlugin lost its cookie-paste sign-in');
    assert.deepEqual(cookie.prompts.map(p => p.key), ['cookie', 'proxy', 'authuser']);
    assert.ok(cookie.prompts.every(p => p.type === 'text'));
    assert.equal(cookie.ask({}), cookie.prompts[0], 'the cookie question comes first');
    assert.equal(cookie.ask({ cookie: 'x' }), cookie.prompts[1]);
    assert.equal(cookie.ask({ cookie: 'x', proxy: '' }), cookie.prompts[2]);
    assert.equal(cookie.ask({ cookie: 'x', proxy: '', authuser: '0' }), null);
    assert.match(cookie.prompts[2].validate('[{"name":"SID","value":"x","domain":".google.com"}]'), /这里只填 Google 账号索引的数字/);
  });

  it('asks for the Google account through ask(), not through a declared select', async () => {
    const web = (await GeminiWebPlugin({})).auth.methods.find(m => m.label === '添加本地后端里已有的 Google 账号');
    assert.ok(web, 'GeminiWebPlugin lost its account method');
    assert.deepEqual(web.prompts, []);
    assert.equal(typeof web.ask, 'function');
    assert.equal(typeof web.authorize, 'function');
    const studio = (await AIStudioPlugin()).auth.methods;
    const account = studio.filter(m => m.type === 'oauth' && typeof m.ask === 'function');
    assert.ok(account.length > 0, 'AIStudioPlugin lost its ask()-driven sign-in');
    assert.ok(account.every(m => !(m.prompts ?? []).some(p => p.type === 'select' && p.key === 'account')),
      'AIStudioPlugin still declares the account select it asks for at sign-in time');
  });
});
