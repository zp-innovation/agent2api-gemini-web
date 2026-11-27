import { normalizeBaseURL, settings, credentials, listModels, forward, UNREACHABLE_HEADER, PLUGIN_ICON } from './lib/backend.mjs';
import { ensureBackend, localBackend, localSetup } from './lib/native.mjs';
import { registerMagpieCleanup, isPluginRemovedInActiveMagpie } from './lib/cleanup.mjs';
import { parseCookieInput, parseAuthuser, importCookie, ensureProxy, validateProxyURL, requireLoginBackend } from './lib/setup.mjs';
import { usage, poolChoices, poolAccounts, accountEmail } from './lib/usage.mjs';
import { isContainerEnv, dockerProxyHint } from './lib/proc.mjs';

const ID = 'gemini-web';
const PROVIDER_NAME = 'Gemini-web-all · zp';
const GEMINI_URL = 'https://gemini.google.com/app';

// Saved macOS Task sign-ins predate removal of the native bridge. Reject them here so their
// local key is not sent to the Gemini Web backend.
function retiredTask(auth) {
  return auth?.type === 'api' && auth.metadata?.mode === 'task';
}

function retiredTaskError() {
  return Object.assign(new Error('macOS 原生 Task 已停用，请改用 Gemini Web 登录'), { signIn: 'expired' });
}

// The backend keeps the session alive by rotating its cookies, which signs the browser it came
// from out of Google. A private window that is closed afterwards gives the backend a session of
// its own.
const COOKIE_STEPS = [
  '请用浏览器的无痕 / 隐私窗口（推荐 Firefox），不要用你平时登录着 Google 的窗口：后端会定时刷新这份登录，和浏览器共用会被 Google 踢出登录。',
  `1. 在无痕窗口打开 ${GEMINI_URL} 并登录要使用的 Google 账号`,
  '确认这个窗口的目标账号索引与刚才填写的一致；无痕窗口中的索引可能和普通窗口不同。如地址是 /u/4/app，应填 4；填错请取消并重新登录。',
  '2. 按 F12（macOS 按 ⌥⌘I）打开开发者工具，切到 Network（网络）面板，刷新页面',
  '3. 点列表里任意一个 gemini.google.com 的请求 → Headers（标头）→ Request Headers（请求标头）',
  '4. 找到 cookie 那一行，复制它的值，粘贴到下面',
  '5. 直接关掉无痕窗口，不要点「退出登录」（退出会让这份 Cookie 失效）',
  'Cookie 只保存在本机的 Gemini Web 后端里，不会发到别处。'
].join('\n');

// signInFor is the Magpie sign-in for one account of the local backend's pool: the backend's
// key, with the account's id for its usage card and its Google email, which names the card and
// keeps each Google account a sign-in of its own (Magpie takes two sign-ins with one email for
// one account, and two with neither for one when their key is the same). The account is the
// pool's own entry (see poolAccounts), which says the way out to read the email by; without
// one the email isn't read.
//
// The sign-in also carries what it takes to put the account back: the backend this plugin set up
// lives in a data dir inside whatever holds Magpie, so an update of the host that replaces that
// container takes the backend, its key and its whole account pool with it. Magpie saves this
// metadata encrypted with the other credentials, so the cookie here is the one copy that survives
// — managed: true says the backend is ours to rebuild, and healManaged re-imports the cookie into
// the pool it comes back with. extra.cookie is the normalized cookie (see parseCookieInput).
async function signInFor(local, account, extra = {}) {
  const email = account.email || await accountEmail(account).catch(() => undefined);
  // A pool entry read by poolAccounts carries its cookie; 添加本地后端里已有的 Google 账号 signs
  // in with one of those, and it heals the same way.
  const cookie = extra.cookie || account.cookie;
  return {
    type: 'success',
    key: local.apiKey,
    metadata: {
      baseURL: local.baseURL, account: account.id, managed: true, ...(email ? { email } : {}),
      // The account index (/u/N) the email is for; usage takes the email only while it holds.
      ...(email && account.authuser > 0 ? { authuser: account.authuser } : {}),
      ...(cookie ? { cookie } : {}),
      ...(extra.proxy ? { proxy: extra.proxy } : {})
    }
  };
}

// managedBackend is the local backend this plugin set up, when baseURL points at it.
function managedBackend(baseURL, key) {
  if (isPluginRemovedInActiveMagpie()) return null;
  const local = localBackend() || (key ? localSetup() : null);
  return local && local.baseURL === baseURL && (!key || local.apiKey === key) ? local : null;
}

// managedSignIn is the backend a sign-in made through this plugin reaches: a sign-in it didn't
// make (连接已有后端) is left to its own baseURL and key. ensureBackend is idempotent and starts
// the backend when a host update took it, which is also when the key Magpie saved stops matching
// — the setup returned here is the one to use, not the metadata's.
async function managedSignIn(auth, opts) {
  const meta = auth?.metadata || {};
  if (meta.managed !== true) return null;
  const local = await ensureBackend({ proxy: meta.proxy || opts.proxy });
  return local && local.baseURL === meta.baseURL ? local : null;
}

// healManaged puts the sign-in's account back into the pool of the backend it reaches, and says
// which entry it is now: after a host update the pool is empty, so the id the sign-in saved names
// nothing and every read of it fails. The id it saved is looked up, and the email behind that
// entry has to be the sign-in's own (a re-import numbers the pool anew, so an id can come to mean
// another Google account); the account is imported from the sign-in's own cookie when the pool
// does not have it. A backend that already has it is left alone; the lookup is throttled because
// the loader runs on every request and a healthy backend would be read for the pool each time.
const HEAL_TTL_MS = 60 * 1000;
const healedAt = new Map();

async function healManaged(local, auth) {
  const meta = auth?.metadata || {};
  const key = `${local.baseURL}|${meta.account}|${meta.email || ''}`;
  const last = healedAt.get(key);
  if (last && Date.now() - last < HEAL_TTL_MS) return null;
  const pool = await poolAccounts().catch(() => []);
  // The pool numbers an entry anew whenever it is imported again, so the id the sign-in saved may
  // name a different Google account by now — and reading that entry would show its quota. The id
  // is taken only when the account behind it is still the one the sign-in saved.
  let found = pool.find(a => a.id === meta.account) || null;
  if (found && meta.email) {
    const actual = await accountEmail(found).catch(() => undefined);
    if (actual && actual !== meta.email) found = null;
  }
  healedAt.set(key, Date.now());
  if (found) return found;
  if (!meta.cookie) return null;
  const added = await importCookie(local, parseCookieInput(meta.cookie), {
    ...(meta.authuser > 0 ? { authuser: meta.authuser } : {}),
    ...(meta.proxy ? { proxy: meta.proxy } : {})
  });
  return (await poolAccounts().catch(() => [])).find(a => a.id === added.id) || { id: added.id };
}

// forwardManaged is forward(), but when the backend this plugin manages can't be reached it
// starts the backend and tries once more.
async function forwardManaged(input, init, getAuth, opts) {
  const retryInput = input instanceof Request ? input.clone() : input;
  const res = await forward(input, init, getAuth, opts);
  if (res.headers.get(UNREACHABLE_HEADER) !== 'unreachable') return res;
  let c;
  try {
    c = credentials(await getAuth(), opts);
  } catch {
    return res;
  }
  if (!managedBackend(c.baseURL, c.key)) return res;
  try {
    await ensureBackend({ proxy: opts.proxy });
  } catch {
    return res;
  }
  return forward(retryInput, init, getAuth, opts);
}

export const GeminiWebPlugin = async (_input, options = {}) => {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    settings(options);
  }
  const { studio: _studio, ...webOptions } = options;
  const opts = settings(webOptions);
  registerMagpieCleanup(_input);
  const inContainer = isContainerEnv();
  const proxyPrompt = {
    type: 'text',
    key: 'proxy',
    message: inContainer
      ? '访问 Google 的代理地址（容器 bridge 网络勿填 127.0.0.1，请填 http://host.docker.internal:<端口> 或宿主机局域网 IP；无需代理或已在代理池配置可留空）'
      : '访问 Google 的代理地址（无需代理或已在代理池配置可留空）',
    placeholder: opts.proxy || (inContainer ? 'http://host.docker.internal:7890' : 'http://127.0.0.1:7890'),
    validate: value => {
      try {
        validateProxyURL(value);
      } catch (e) {
        return e.message;
      }
    }
  };

  const authuserPrompt = {
    type: 'text',
    key: 'authuser',
    message: 'Google 账号索引（复制 Cookie 的同一窗口中 /u/N/app 的 N；单账号留空为 0，无痕窗口可能不同）',
    placeholder: '0',
    validate: value => {
      try {
        parseAuthuser(value);
      } catch (e) {
        return e.message;
      }
    }
  };

  // Paste the export itself rather than a callback code: whoever already has the cookies should
  // not have to open the browser again. Host inputs are one line, so lib/setup.mjs salvages a
  // flattened Cookie-Editor / EditThisCookie export.
  const cookiePrompt = {
    type: 'text',
    key: 'cookie',
    message: 'Cookie（粘贴 Cookie-Editor / EditThisCookie 导出的整份 JSON，或 gemini.google.com 请求头里 cookie 一行的值）',
    placeholder: 'SID=…; HSID=…; __Secure-1PSID=…',
    validate: value => {
      try {
        parseCookieInput(value);
      } catch (e) {
        return e.message;
      }
    }
  };

  // Bring a backend set up earlier back after Magpie or the computer restarts. Not awaited:
  // requests that arrive first start it themselves through forwardManaged.
  if (localBackend()) {
    ensureBackend({ proxy: opts.proxy })
      .then(async local => {
        if (!opts.proxy) return;
        await requireLoginBackend(local);
        await ensureProxy(local, opts.proxy);
      })
      .catch(err => console.error(`[gemini-web] could not start the local backend: ${err.message}`));
  }

  return {
    config: async cfg => {
      cfg.provider ??= {};
      const existing = cfg.provider[ID];
      cfg.provider[ID] ??= { name: PROVIDER_NAME, npm: '@ai-sdk/openai-compatible', api: opts.baseURL, models: {} };
      // Named after the fork's owner so it can be told apart from upstream's own gemini-web. A
      // name the user set themselves stays theirs; ours covers a fresh entry, an entry this fork
      // created earlier, and the 'Gemini Web' default of releases before the rename.
      if (!existing || !existing.name || existing.name === 'Gemini Web' || existing.name === PROVIDER_NAME) {
        cfg.provider[ID].name = PROVIDER_NAME;
      }
    },
    auth: {
      provider: ID,
      icon: PLUGIN_ICON,
      // Two at once per sign-in, as a person with two Gemini tabs: an agent's first turn and
      // the session title it asks for alongside no longer wait one behind the other, which
      // Gemini Web can take minutes to answer (#33). The backend still caps each way out to
      // Google (per-IP limits), and Magpie's own setting on the provider goes over this.
      maxConcurrency: 2,
      // The card reads as a credit cell (可用 97 % with a 积分明细 popover), not as the grid
      // Magpie draws for a provider that reports several windows at once: a Gemini account has
      // two of them and neither is the point on its own (see creditsOf in lib/usage.mjs).
      accountFeatures: { creditDetail: true },
      methods: [{
        type: 'oauth',
        label: '一键配置本地 Gemini Web（推荐）',
        prompts: [proxyPrompt, authuserPrompt],
        ask(inputs) {
          if (!inputs || !('proxy' in inputs)) return proxyPrompt;
          return 'authuser' in inputs ? null : authuserPrompt;
        },
        // Installs and starts the pinned backend while the user copies the Gemini cookie; the
        // callback then waits for it, configures its proxy pool when a proxy URL is given, and
        // imports the cookie (importCookie checks the backend can bind the account to a proxy).
        // The result carries the backend's own API key, so Magpie saves an API-key sign-in,
        // one for each Google account (see signInFor).
        async authorize(inputs) {
          const proxy = validateProxyURL(inputs?.proxy || opts.proxy || '');
          const authuser = parseAuthuser(inputs?.authuser);
          const loginURL = authuser ? `https://gemini.google.com/u/${authuser}/app` : GEMINI_URL;
          const ready = ensureBackend({ proxy });
          ready.catch(() => {});
          const proxyHint = dockerProxyHint(proxy);
          return {
            url: loginURL,
            method: 'code',
            instructions: COOKIE_STEPS.replaceAll(GEMINI_URL, loginURL) + (proxyHint ? `\n\n注意：${proxyHint}` : ''),
            async callback(code) {
              let local, cookie, added;
              try {
                cookie = parseCookieInput(code);
                local = await ready;
                added = await importCookie(local, cookie, { authuser, ...(proxy ? { proxy } : {}) });
              } catch (err) {
                const hint = dockerProxyHint(proxy);
                return { type: 'failed', error: hint ? `${err.message}\n${hint}` : err.message };
              }
              const account = (await poolAccounts().catch(() => [])).find(a => a.id === added.id);
              return signInFor(local, account || { id: added.id }, { cookie, proxy });
            }
          };
        }
      }, {
        type: 'oauth',
        label: '粘贴 Cookie 直接登录（Cookie-Editor 导出整份粘贴即可）',
        prompts: [cookiePrompt, proxyPrompt, authuserPrompt],
        ask(inputs) {
          if (!inputs || !('cookie' in inputs)) return cookiePrompt;
          if (!('proxy' in inputs)) return proxyPrompt;
          return 'authuser' in inputs ? null : authuserPrompt;
        },
        // Everything the one-click method asks for in a callback, answered up front: import the
        // cookie into the backend's pool, let the backend check it against Gemini, sign in.
        async authorize(inputs) {
          const proxy = validateProxyURL(inputs?.proxy || opts.proxy || '');
          const authuser = parseAuthuser(inputs?.authuser);
          const cookie = parseCookieInput(inputs?.cookie);
          try {
            const local = await ensureBackend({ proxy });
            const added = await importCookie(local, cookie, { authuser, ...(proxy ? { proxy } : {}) });
            const account = (await poolAccounts().catch(() => [])).find(a => a.id === added.id);
            return signInFor(local, account || { id: added.id }, { cookie, proxy });
          } catch (err) {
            const hint = dockerProxyHint(proxy);
            throw new Error(hint ? `${err.message}\n${hint}` : err.message);
          }
        }
      }, {
        type: 'api',
        label: '连接已有后端（自定义地址 + API key）',
        placeholder: 'Backend API key (not a Google cookie)',
        prompts: [{
          type: 'text',
          key: 'baseURL',
          message: 'Backend OpenAI base URL (blank: plugin default)',
          placeholder: opts.baseURL,
          validate: value => {
            try {
              normalizeBaseURL(value || opts.baseURL);
            } catch (e) {
              return e.message;
            }
          }
        }],
        // Magpie stores raw prompt inputs as metadata unless authorize returns its own;
        // write the resolved URL so a blank answer doesn't persist as baseURL: "".
        authorize: async inputs => ({
          type: 'success',
          metadata: { baseURL: normalizeBaseURL(inputs?.baseURL || opts.baseURL) }
        })
      }, {
        type: 'oauth',
        label: '添加本地后端里已有的 Google 账号',
        // The picker is ask()'s alone. A host reads declared prompts before it calls ask(), and
        // one rejects the whole login list over a declared select with no options (the pool only
        // exists at sign-in time), so declaring the question here would break provider setup.
        prompts: [],
        async ask(inputs) {
          if (inputs?.account) return null;
          if (!localBackend()) throw new Error('还没有本地后端：请先用「一键配置本地 Gemini Web」');
          const choices = await poolChoices();
          if (!choices.length) throw new Error('本地后端里没有启用的 Google 账号');
          return {
            type: 'select',
            key: 'account',
            message: '选择 Google 账号',
            placeholder: '',
            options: choices.map(c => ({ label: c.label, value: String(c.id), hint: c.hint }))
          };
        },
        async authorize(inputs) {
          const local = localBackend();
          if (!local) throw new Error('还没有本地后端：请先用「一键配置本地 Gemini Web」');
          if (!inputs?.account) throw new Error('还没有选择 Google 账号：本地后端里已有的账号会在这里列出来');
          const id = Number(inputs.account);
          const chosen = (await poolChoices()).find(c => c.id === id);
          if (!chosen) throw new Error(`本地后端里没有启用的账号 #${inputs.account}`);
          return {
            url: '',
            method: 'auto',
            instructions: '',
            callback: async () => {
              const account = (await poolAccounts().catch(() => [])).find(a => a.id === chosen.id) || chosen;
              return signInFor(local, account);
            }
          };
        }
      }],
      // The key and address are the backend's as it is now, not as the sign-in saved them: a host
      // update that took the backend leaves the saved key naming a backend that no longer exists,
      // and this starts it again under the key it comes back with. The pool is healed alongside so
      // the first request after the update is served by the same account it was before.
      async loader(getAuth) {
        const auth = await getAuth();
        if (retiredTask(auth)) throw retiredTaskError();
        if (auth?.type !== 'api') return {};
        const c = credentials(auth, opts);
        const local = await managedSignIn(auth, opts).catch(() => null);
        if (local) await healManaged(local, auth).catch(() => {});
        return {
          apiKey: local ? local.apiKey : c.key,
          baseURL: local ? local.baseURL : c.baseURL,
          fetch: (input, init) => forwardManaged(input, init, getAuth, opts)
        };
      },
      // Magpie's usage card: the 5-hour and weekly limits of each Google account in the local
      // backend's pool, as gemini.google.com/usage shows them. A backend this plugin doesn't
      // manage keeps its accounts out of reach. No read marks the sign-in: the Magpie key
      // belongs to the backend, not to Google.
      async usage(getAuth) {
        const auth = await getAuth();
        if (auth?.type !== 'api') return { error: 'Gemini Web 还没有登录', credits: [], signIn: 'kept' };
        if (retiredTask(auth)) return { error: retiredTaskError().message, credits: [], signIn: 'expired' };
        let c;
        try {
          c = credentials(auth, opts);
        } catch (err) {
          return { error: err.message, credits: [], signIn: 'kept' };
        }
        // A backend this plugin set up is rebuilt when a host update took it, so a saved key that
        // no longer matches is not a reason to stop reading: the card is the one thing that would
        // stay red otherwise. 连接已有后端 is still out of reach, as its pool is not ours.
        const local = await managedSignIn(auth, opts).catch(() => null);
        if (!local && !managedBackend(c.baseURL, c.key)) {
          return { error: '只能读取插件自己管理的本地后端的额度（连接已有后端时读不到）', credits: [], signIn: 'kept' };
        }
        const meta = auth.metadata || {};
        const healed = local ? await healManaged(local, auth).catch(() => null) : null;
        const account = healed && Number.isInteger(healed.id) ? healed.id : meta.account;
        const { email, authuser } = meta;
        return { ...(await usage(Number.isInteger(account) ? { account, email, authuser } : {})), signIn: 'kept' };
      }
    },
    provider: {
      id: ID,
      async models(provider, { auth } = {}) {
        if (auth?.type !== 'api') return provider.models;
        if (retiredTask(auth)) throw retiredTaskError();
        const c = credentials(auth, opts);
        const local = await managedSignIn(auth, opts).catch(() => null);
        const reach = local ? { ...c, key: local.apiKey, baseURL: local.baseURL } : c;
        try {
          return await listModels(reach, opts);
        } catch (err) {
          if (!err.unreachable || !managedBackend(reach.baseURL, reach.key)) throw err;
          await ensureBackend({ proxy: opts.proxy });
          return listModels(reach, opts);
        }
      }
    }
  };
};

export { AIStudioPlugin } from './lib/studio.mjs';
export default GeminiWebPlugin;
