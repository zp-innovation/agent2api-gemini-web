import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCookieInput } from '../lib/setup.mjs';
import { parseStudioCookieInput } from '../lib/studio-native.mjs';

// A Cookie-Editor / EditThisCookie export, the shape users paste out of the browser extension.
const EXPORT = "[\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.416397,\n        \"hostOnly\": false,\n        \"httpOnly\": false,\n        \"name\": \"SAPISID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"e3U-QinN53tI8Cxo/AVuQSBsWOVFaxr67S\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.416695,\n        \"hostOnly\": false,\n        \"httpOnly\": false,\n        \"name\": \"__Secure-3PAPISID\",\n        \"path\": \"/\",\n        \"sameSite\": \"no_restriction\",\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"e3U-QinN53tI8Cxo/AVuQSBsWOVFaxr67S\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.41656,\n        \"hostOnly\": false,\n        \"httpOnly\": false,\n        \"name\": \"__Secure-1PAPISID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"e3U-QinN53tI8Cxo/AVuQSBsWOVFaxr67S\"\n    },\n    {\n        \"domain\": \"gemini.google.com\",\n        \"expirationDate\": 1830308979.42511,\n        \"hostOnly\": true,\n        \"httpOnly\": true,\n        \"name\": \"OSID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"g.a000OSIDvalue\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.416202,\n        \"hostOnly\": false,\n        \"httpOnly\": false,\n        \"name\": \"APISID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": false,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"9umiqhi4IjrpsT-m/Agal1mXRC26eJnGFS\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.415602,\n        \"hostOnly\": false,\n        \"httpOnly\": true,\n        \"name\": \"__Secure-3PSID\",\n        \"path\": \"/\",\n        \"sameSite\": \"no_restriction\",\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"g.a0003PSIDvalue\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.415474,\n        \"hostOnly\": false,\n        \"httpOnly\": true,\n        \"name\": \"__Secure-1PSID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"g.a0001PSIDvalue\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.415962,\n        \"hostOnly\": false,\n        \"httpOnly\": true,\n        \"name\": \"HSID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": false,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"A3zA8kCI36DLr9O2u\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.415191,\n        \"hostOnly\": false,\n        \"httpOnly\": false,\n        \"name\": \"SID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": false,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"g.a000SIDvalue\"\n    },\n    {\n        \"domain\": \".google.com\",\n        \"expirationDate\": 1830332106.416075,\n        \"hostOnly\": false,\n        \"httpOnly\": true,\n        \"name\": \"SSID\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": true,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"ATAei_qmwGIqc34W8\"\n    },\n    {\n        \"domain\": \"example.com\",\n        \"expirationDate\": 1830332106.416075,\n        \"hostOnly\": false,\n        \"httpOnly\": false,\n        \"name\": \"NOT_GOOGLE\",\n        \"path\": \"/\",\n        \"sameSite\": null,\n        \"secure\": false,\n        \"session\": false,\n        \"storeId\": null,\n        \"value\": \"drop-me\"\n    }\n]";

// The same export after a single-line host input swallowed every newline.
const FLATTENED = "[ { \"domain\": \".google.com\", \"expirationDate\": 1830332106.416397, \"hostOnly\": false, \"httpOnly\": false, \"name\": \"SAPISID\", \"path\": \"/\", \"sameSite\": null, \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"e3U-QinN53tI8Cxo/AVuQSBsWOVFaxr67S\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.416695, \"hostOnly\": false, \"httpOnly\": false, \"name\": \"__Secure-3PAPISID\", \"path\": \"/\", \"sameSite\": \"no_restriction\", \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"e3U-QinN53tI8Cxo/AVuQSBsWOVFaxr67S\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.41656, \"hostOnly\": false, \"httpOnly\": false, \"name\": \"__Secure-1PAPISID\", \"path\": \"/\", \"sameSite\": null, \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"e3U-QinN53tI8Cxo/AVuQSBsWOVFaxr67S\" }, { \"domain\": \"gemini.google.com\", \"expirationDate\": 1830308979.42511, \"hostOnly\": true, \"httpOnly\": true, \"name\": \"OSID\", \"path\": \"/\", \"sameSite\": null, \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"g.a000OSIDvalue\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.416202, \"hostOnly\": false, \"httpOnly\": false, \"name\": \"APISID\", \"path\": \"/\", \"sameSite\": null, \"secure\": false, \"session\": false, \"storeId\": null, \"value\": \"9umiqhi4IjrpsT-m/Agal1mXRC26eJnGFS\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.415602, \"hostOnly\": false, \"httpOnly\": true, \"name\": \"__Secure-3PSID\", \"path\": \"/\", \"sameSite\": \"no_restriction\", \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"g.a0003PSIDvalue\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.415474, \"hostOnly\": false, \"httpOnly\": true, \"name\": \"__Secure-1PSID\", \"path\": \"/\", \"sameSite\": null, \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"g.a0001PSIDvalue\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.415962, \"hostOnly\": false, \"httpOnly\": true, \"name\": \"HSID\", \"path\": \"/\", \"sameSite\": null, \"secure\": false, \"session\": false, \"storeId\": null, \"value\": \"A3zA8kCI36DLr9O2u\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.415191, \"hostOnly\": false, \"httpOnly\": false, \"name\": \"SID\", \"path\": \"/\", \"sameSite\": null, \"secure\": false, \"session\": false, \"storeId\": null, \"value\": \"g.a000SIDvalue\" }, { \"domain\": \".google.com\", \"expirationDate\": 1830332106.416075, \"hostOnly\": false, \"httpOnly\": true, \"name\": \"SSID\", \"path\": \"/\", \"sameSite\": null, \"secure\": true, \"session\": false, \"storeId\": null, \"value\": \"ATAei_qmwGIqc34W8\" }, { \"domain\": \"example.com\", \"expirationDate\": 1830332106.416075, \"hostOnly\": false, \"httpOnly\": false, \"name\": \"NOT_GOOGLE\", \"path\": \"/\", \"sameSite\": null, \"secure\": false, \"session\": false, \"storeId\": null, \"value\": \"drop-me\" } ]";

test('parseCookieInput accepts a Cookie-Editor JSON array', () => {
  const header = parseCookieInput(EXPORT);
  assert.match(header, /(^|; )SID=/);
  assert.match(header, /(^|; )__Secure-1PSID=/);
  assert.match(header, /(^|; )HSID=/);
  assert.doesNotMatch(header, /NOT_GOOGLE/);
});

test('parseCookieInput accepts the same JSON flattened onto one line', () => {
  const header = parseCookieInput(FLATTENED);
  assert.match(header, /(^|; )SID=/);
  assert.match(header, /(^|; )SAPISID=/);
  assert.doesNotMatch(header, /NOT_GOOGLE/);
});

test('parseCookieInput accepts a flattened JSON array wrapped in quotes', () => {
  const header = parseCookieInput('"' + FLATTENED + '"');
  assert.match(header, /(^|; )SSID=/);
});

test('parseStudioCookieInput accepts a Cookie-Editor JSON array', () => {
  const entries = JSON.parse(parseStudioCookieInput(EXPORT));
  const names = entries.map(c => c.name);
  assert.ok(names.includes('__Secure-1PSID'));
  assert.ok(names.includes('SAPISID'));
  assert.ok(!names.includes('NOT_GOOGLE'));
});

test('parseStudioCookieInput salvages a flattened JSON array', () => {
  const entries = JSON.parse(parseStudioCookieInput(FLATTENED));
  const names = entries.map(c => c.name);
  assert.ok(names.includes('__Secure-1PSID'));
  assert.ok(names.includes('__Secure-3PAPISID'));
});
