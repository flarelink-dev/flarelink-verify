# flarelink-verify

Prove that the [Flarelink](https://flarelink.dev) auth Worker running in **your** Cloudflare account is the exact published, source-available bundle — byte-for-byte — using only your own Cloudflare API token.

```bash
CF_API_TOKEN=<token> CF_ACCOUNT_ID=<account-id> \
  npx flarelink-verify --url https://your-auth-worker.workers.dev
```

```
Worker      : your-auth-worker (your-auth-worker.subdomain.workers.dev)
Version     : v0.3.0
Module size : 840820 bytes
Deployed    : 06c3ded7f856061c3c70ba6ea7a7bd87d3a8f3593075cee079df0a7f089ed6c9
Published   : 06c3ded7f856061c3c70ba6ea7a7bd87d3a8f3593075cee079df0a7f089ed6c9

PASS — the bundle running in your account is the published v0.3.0 bundle.
```

## Why

Flarelink deploys an open-source auth Worker onto your own Cloudflare account and walks away. The dashboard/orchestrator that does the deploying is closed source — but it doesn't need to be trusted, because everything it *produces* in your account is verifiable. This tool closes the last gap: it proves the bytes Cloudflare is actually running for your users match the published [`auth-module`](https://github.com/flarelink-dev/auth-module) source.

The chain:

1. **The published bundle is reproducible from source.** Clone [`flarelink-dev/auth-module`](https://github.com/flarelink-dev/auth-module) at the version tag, run `npm ci && npm run build`, and you get the exact bytes listed in its [`HASHES.md`](https://github.com/flarelink-dev/auth-module/blob/main/HASHES.md).
2. **The deployed bundle matches the published bundle.** That's what this tool checks — it downloads the live Worker from your account and hashes it.

Together: deployed bytes → published hash → public source you can read and rebuild. No need to trust the closed dashboard.

## How it works

1. Reads your Worker's version from `GET <url>/__flarelink`.
2. Downloads the live Worker script via the Cloudflare Workers Scripts API (module Workers return `multipart/form-data`; it extracts the module).
3. Fetches the published SHA-256 for that version from `auth-module`'s `HASHES.md`.
4. Hashes the deployed module and compares.

It makes no network calls beyond your Worker, the Cloudflare API, and `raw.githubusercontent.com`. No telemetry. Zero dependencies.

## Usage

```
flarelink-verify --url <your-auth-worker-url> [--script <name>] [--account <id>]
```

| | |
|---|---|
| `CF_API_TOKEN` (env, required) | A Cloudflare token with **Workers Scripts: Read** on the account. Passed only via env so it can't leak into shell history. |
| `CF_ACCOUNT_ID` (env, or `--account`) | Your 32-hex Cloudflare account id. |
| `--url` | Your auth Worker's URL. Also accepted as a positional argument. |
| `--script` | Worker script name. Only needed for **custom domains**; for `*.workers.dev` it's derived from the URL. |

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | **PASS** — deployed bytes match the published bundle. |
| `1` | **MISMATCH** — deployed bytes differ. Modified, different build, or tampered. |
| `2` | Usage or I/O error (missing token, network, download failed). |
| `3` | No published hash for the deployed version (e.g. you run a modified fork — rebuild and diff yourself). |

Non-zero on mismatch, so you can run it in CI.

## License

MIT. The auth Worker it verifies is source-available under FSL-1.1-MIT (it converts to MIT two years after each release); this CLI and the Flarelink SDK are MIT.
