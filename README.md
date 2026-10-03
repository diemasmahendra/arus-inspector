# Arus

A focused desktop HTTP / HTTPS traffic inspector for Windows. Built with Electron and powered by [Whistle](https://github.com/avwo/whistle).

![Arus interface](docs/interface.png)

## Download

Get **Arus-Setup-VERSION.exe** from [Releases](https://github.com/diemasmahendra/arus-inspector/releases). The first installer appears when the GitHub Actions build succeeds. Windows x64 is the initial supported target.

## Getting started

1. Install and open Arus.
2. Enter a website URL and click **Buka browser**.
3. Use that browser normally. Select a captured request to inspect its headers, body, and response.

The built-in browser trusts only the local Arus capture CA within its own session. Arus does not change your system proxy or install a system certificate automatically. The upstream proxy validates server TLS certificates.

To connect another browser: open **Panduan koneksi**, set its HTTP and HTTPS proxy to the shown loopback address, and import the exported CA into that browser's trust store for HTTPS inspection. The port may change on restart. Restore proxy settings and remove the CA when finished.

## Features

- Live HTTP / HTTPS capture through a local Whistle proxy.
- Domain, API, error, and free-text filters.
- Request / response bodies, headers, metadata, and pretty JSON.
- Resizable inspector, keyboard navigation, Ctrl+K search, Space to pause/resume.
- Copy cURL (redacted by default, full copy available with confirmation).
- Edit and replay requests with a 30-second timeout and no automatic browser cookies. Redirects are not followed. Explicit request headers are sent as entered.
- HAR export. Standard export redacts known sensitive headers and query parameters, omits bodies. Full export requires confirmation. Review any export before sharing: arbitrary headers and URL path segments can contain sensitive data.
- GitHub Releases update checks, download progress, and restart-to-install.

## Privacy and limits

No telemetry or account is implemented. Capture records are kept in memory, bounded to 3,000 records / 48 MiB; older records are removed. Body views are limited to 1 MiB. Whistle also maintains a bounded temporary capture cache. Its generated CA/private key and settings are stored in the app's private data directory on the machine; never commit or share that directory.

Pause stops recording into Arus; the proxy continues forwarding traffic. Closing Arus stops its proxy. Browser popups open in the same capture window. Downloads and device permissions are disabled in the capture browser. Browser sessions are temporary. This is a debugging browser, not a replacement for your daily browser.

This first version does not display WebSocket frames, SSE streams, gRPC/protobuf decoding, Android patching, AI analysis, or traffic that bypasses the configured proxy. Some sites reject embedded Chromium browsers. Apps using certificate pinning may reject the proxy CA.

The initial Windows installer is unsigned. Windows may show an unknown-publisher/SmartScreen message. Release assets include update metadata with SHA-512 checksums; code signing requires a signing certificate and is not configured in this repository yet. Updates are not downloaded or installed without clicking the relevant action.

## Development

Node.js 24 and npm:

```sh
npm ci
npm start
npm test
npm run check
npm run dist
```

The Windows release workflow also runs the integration tests against the packaged executable before publishing. Desktop integration tests require a graphical desktop (on headless Linux: `xvfb-run -a npm run test:e2e`). Test browsers visit local fixtures only. Traffic capture tests verify HTTP, HTTPS, rejection of untrusted upstream TLS, and clear-session behavior.

## Updates and releases

Pushes to `main` run tests, build the Windows installer, and publish a new GitHub Release **only when that version has not already been released**. To ship a change:

```sh
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release next version"
git push origin main
```

The workflow publishes the installer, blockmap, and `latest.yml` update metadata. GitHub Actions must be enabled and allowed to write repository contents. Existing versions are never silently replaced; increase the version for each release.

MIT license. See [third-party notices](THIRD_PARTY_NOTICES.md).
