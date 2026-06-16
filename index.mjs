#!/usr/bin/env node
// flarelink-verify — prove that the Flarelink auth Worker deployed in YOUR
// Cloudflare account is the exact published, source-available bundle.
//
// What it does, using only your own CF API token (never Flarelink's):
//   1. Reads the deployed Worker's version from GET <url>/__flarelink.
//   2. Downloads the live Worker script via the CF Workers Scripts API.
//      Module Workers come back as multipart/form-data; we extract the module.
//   3. Fetches the published SHA-256 for that version from the public
//      flarelink-dev/auth-module repo's HASHES.md.
//   4. Hashes the deployed module and compares.
//
// PASS means the bytes Cloudflare runs for your users == the bytes published
// in the open repo (which you can independently rebuild — see the repo README).
//
// Exit codes: 0 PASS · 1 MISMATCH · 2 usage/IO error · 3 no published hash.

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REPO = 'flarelink-dev/auth-module';
const HASHES_URL = `https://raw.githubusercontent.com/${REPO}/main/HASHES.md`;

function fail(code, msg) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

function parseArgs(argv) {
  const out = { url: null, script: null, account: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--script') out.script = argv[++i];
    else if (a === '--account') out.account = argv[++i];
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('-') && !out.url) out.url = a; // positional = url
    else fail(2, `unknown argument: ${a}`);
  }
  return out;
}

const HELP = `flarelink-verify — verify the deployed Flarelink auth Worker matches the published bundle

Usage:
  CF_API_TOKEN=<token> CF_ACCOUNT_ID=<id> npx @flarelink/verify --url https://your-auth-worker.workers.dev

Options:
  --url <url>        Your auth Worker's URL (also accepted as a positional arg).
  --script <name>    Worker script name. Required only for custom domains;
                     for *.workers.dev it's derived from the URL.
  --account <id>     CF account id (or set CF_ACCOUNT_ID).
  -h, --help         Show this help.

Environment:
  CF_API_TOKEN   (required)  A token with Workers Scripts: Read on the account.
                             Never passed as a flag, so it can't leak into shell history.
  CF_ACCOUNT_ID  (required unless --account)  Your 32-hex Cloudflare account id.

The token is used only to read your own account. flarelink-verify makes no other
network calls beyond your Worker, the Cloudflare API, and raw.githubusercontent.com.`;

// Derive the workers.dev script name from a host like
// "my-auth.subdomain.workers.dev" -> "my-auth". Returns null for custom domains.
function scriptFromHost(host) {
  return host.endsWith('.workers.dev') ? host.split('.')[0] : null;
}

// Extract the main module body from CF's multipart/form-data script download.
// The part body is the bytes between the part header terminator and the closing
// boundary, minus the single CRLF/LF that belongs to the multipart framing.
function extractModule(buf, contentType) {
  const m = /boundary=([^;]+)/.exec(contentType || '');
  if (!m) return buf; // raw script (not multipart) — hash as-is
  const boundary = Buffer.from('--' + m[1].trim());
  const firstB = buf.indexOf(boundary);
  if (firstB === -1) fail(2, 'unexpected download format: boundary not found');
  const after = firstB + boundary.length;
  const hCRLF = buf.indexOf(Buffer.from('\r\n\r\n'), after);
  const hLF = buf.indexOf(Buffer.from('\n\n'), after);
  let start;
  if (hCRLF !== -1 && (hLF === -1 || hCRLF <= hLF)) start = hCRLF + 4;
  else if (hLF !== -1) start = hLF + 2;
  else fail(2, 'unexpected download format: no part header terminator');
  let end = buf.indexOf(boundary, start);
  if (end === -1) fail(2, 'unexpected download format: closing boundary not found');
  if (buf[end - 2] === 0x0d && buf[end - 1] === 0x0a) end -= 2;
  else if (buf[end - 1] === 0x0a) end -= 1;
  return buf.subarray(start, end);
}

// Pull the SHA-256 for a version out of HASHES.md. Rows look like:
//   | 0.3.0   | `v0.3.0` | `06c3...` |
function hashForVersion(hashesMd, version) {
  for (const line of hashesMd.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cols = line.split('|').map((c) => c.trim());
    if (cols[1] === version) {
      const hex = /[0-9a-f]{64}/i.exec(line);
      if (hex) return hex[0].toLowerCase();
    }
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.url) {
    process.stdout.write(HELP + '\n');
    process.exit(args.help ? 0 : 2);
  }

  const token = process.env.CF_API_TOKEN;
  const account = args.account || process.env.CF_ACCOUNT_ID;
  if (!token) fail(2, 'CF_API_TOKEN is required (a token with Workers Scripts: Read).');
  if (!account) fail(2, 'CF_ACCOUNT_ID is required (or pass --account).');

  let url = args.url;
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  const host = new URL(url).host;
  const script = args.script || scriptFromHost(host);
  if (!script) {
    fail(2, `Could not derive the Worker script name from a custom domain (${host}). Pass --script <name>.`);
  }

  // 1. Deployed version.
  let version;
  try {
    const r = await fetch(new URL('/__flarelink', url));
    if (!r.ok) fail(2, `GET ${host}/__flarelink returned HTTP ${r.status}. Is this a Flarelink auth Worker?`);
    version = (await r.json()).version;
  } catch (e) {
    fail(2, `Could not reach ${host}/__flarelink: ${e.message}`);
  }
  if (!version) fail(2, 'The /__flarelink response had no version field.');

  // 2. Published hash for that version.
  let expected;
  try {
    const r = await fetch(HASHES_URL);
    if (!r.ok) fail(2, `Could not fetch published hashes (HTTP ${r.status}).`);
    expected = hashForVersion(await r.text(), version);
  } catch (e) {
    fail(2, `Could not fetch published hashes: ${e.message}`);
  }
  if (!expected) {
    fail(
      3,
      `No published hash for v${version} in ${REPO}/HASHES.md.\n` +
        `If you deployed a modified fork, rebuild your fork (npm ci && npm run build) and\n` +
        `diff its dist/worker.mjs against your deployed script yourself.`,
    );
  }

  // 3. Download the deployed script + extract the module.
  let actual, moduleBytes;
  try {
    const r = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${script}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!r.ok) {
      const body = await r.text();
      fail(2, `Downloading the Worker script failed (HTTP ${r.status}).\n${body.slice(0, 300)}`);
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const mod = extractModule(buf, r.headers.get('content-type'));
    moduleBytes = mod.length;
    actual = createHash('sha256').update(mod).digest('hex');
  } catch (e) {
    fail(2, `Could not download/extract the Worker script: ${e.message}`);
  }

  // 4. Verdict.
  const match = actual === expected;
  process.stdout.write(
    [
      `Worker      : ${script} (${host})`,
      `Version     : v${version}`,
      `Module size : ${moduleBytes} bytes`,
      `Deployed    : ${actual}`,
      `Published   : ${expected}`,
      '',
      match
        ? `PASS — the bundle running in your account is the published v${version} bundle.`
        : `FAIL — the deployed bytes do NOT match the published v${version} bundle.\n` +
          `       This means the deployed Worker was modified, is a different build, or\n` +
          `       something tampered with it. Investigate before trusting this deployment.`,
    ].join('\n') + '\n',
  );
  process.exit(match ? 0 : 1);
}

// Run only when invoked as a CLI; importable for tests otherwise. Resolve
// argv[1] through realpath first: npm/npx invoke the bin via a symlink
// (node_modules/.bin/flarelink-verify → index.mjs), and the symlink path
// wouldn't match import.meta.url (the resolved real path) — which silently
// skipped main() and produced no output. realpath makes both sides the same.
function invokedAsCli() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}
if (invokedAsCli()) {
  main();
}

export { extractModule, hashForVersion, scriptFromHost, parseArgs };
