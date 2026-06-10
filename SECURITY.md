# Security Policy

## Reporting a vulnerability

Email **hello@flarelink.dev** with `[SECURITY]` in the subject. Please include a description of the issue and its impact, steps to reproduce (or a proof of concept), and the affected version of `@flarelink/verify`.

We'll acknowledge your report, keep you updated as we investigate, and credit you if you'd like. Please give us a reasonable window to ship a fix before public disclosure.

## Scope

This repo is the **`@flarelink/verify` CLI** (MIT) — it downloads the auth Worker deployed in your own Cloudflare account, extracts the module, and compares its SHA-256 against the published hash. A bug that could make it report a false PASS (i.e. fail to detect a modified deployment) is the most serious class of issue here and is especially welcome.

More on Flarelink's security model at <https://flarelink.dev/trust>.
