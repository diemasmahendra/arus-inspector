# Arus

A focused desktop HTTP / HTTPS traffic inspector for Windows. Built with Electron and powered by [Whistle](https://github.com/avwo/whistle).

![Arus interface](docs/interface.png)

## Download

Get **Arus-Setup-VERSION.exe** from [Releases](https://github.com/diemasmahendra/arus-inspector/releases). Installers are published after the GitHub Actions build and packaged Windows tests succeed. Windows x64 is the initial supported target.

## Getting started

1. Install and open Arus.
2. Enter a website URL, select **Browser Arus** or **Camoufox**, and click **Buka browser**. Camoufox downloads its separate engine from the upstream project on first use; later launches reuse it.
3. Use that browser normally. Select a captured request to inspect its headers, body, and response.

The built-in browser trusts only the local Arus capture CA within its own session. Arus does not change your system proxy or install a system certificate automatically. The upstream proxy validates server TLS certificates.

To connect another browser: open **Panduan**, set its HTTP and HTTPS proxy to the shown loopback address, and import the exported CA into that browser's trust store for HTTPS inspection. The port may change on restart. Restore proxy settings and remove the CA when finished.

## Features

- Live HTTP / HTTPS capture through a local Whistle proxy.
- Domain, API, error, method/status/type and bookmark filters; local header/body search.
- Configurable log columns, sorting, drag/keyboard column resizing, timing waterfall, context menu and request notes.
- Request / response Raw/Pretty bodies, Query, Cookies, headers, image preview, SSL certificate metadata and WebSocket messages.
- Resizable inspector, keyboard navigation, Ctrl+K search, Space to pause/resume.
- Copy cURL (redacted by default, full copy available with confirmation).
- Edit and replay requests with a 30-second timeout and no automatic browser cookies. Redirects are not followed. Browser-managed Sec-* metadata and transport headers are rebuilt by Chromium; other explicit request headers are retained.
- HAR export. Standard export redacts known sensitive headers and query parameters, omits bodies. Full export requires confirmation. Review any export before sharing: arbitrary headers and URL path segments can contain sensitive data.
- Save full `.arus` sessions and import `.arus` / HAR 1.2.
- SSL bypass per domain, HTTP(S) Block, Map Local, request breakpoints and delay/download throttling.
- GitHub Releases update checks, download progress, and restart-to-install.
- AI chat and controlled application tools, with five editable Markdown profiles.
- Task plans and progress, pause/resume, manual browser handoff, and repeated-error/observation detection.
- Side-by-side request comparison: summary, headers, JSON fields, form fields, and text.
- Offline Geist fonts, Lucide icons, and three display sizes.

## Privacy and limits

No telemetry or account is implemented. Capture records are kept in memory, bounded to 3,000 records / 48 MiB; older records are removed. Body views are limited to 1 MiB. Whistle also maintains a bounded temporary capture cache. Its generated CA/private key and settings are stored in the app's private data directory on the machine; never commit or share that directory.

Pause stops recording into Arus; the proxy continues forwarding traffic. Closing Arus stops its proxy. Browser Arus has a tab bar, new/close tab buttons, address bar, back/forward, reload/stop, and Ctrl+T/W/L/Tab shortcuts. Every tab shares the capture session. Popup windows retain opener communication and the same captured session. Use the + button or Ctrl+T to open regular tabs. Blank-window flows, opener communication, and links/forms targeting a new window are supported. Downloads and device permissions are disabled in the capture browser. Browser sessions are temporary. **Tutup browser** closes the selected browser without allowing pages to hold it open. Camoufox uses a separate Firefox process through camoufox-js/Playwright, with the same local capture proxy, popup session, and upstream TLS verification. HTTPS certificate exceptions are confined to its temporary capture context; no system trust or proxy changes are made. This is a debugging browser, not a replacement for your daily browser.

Arus does not provide an SSE stream viewer, gRPC/protobuf decoding, Android patching, or traffic that bypasses the configured proxy. Some sites reject embedded Chromium browsers. Apps using certificate pinning may reject the proxy CA.

See [SECURITY.md](SECURITY.md) for the known upstream node-forge advisory and current exposure assessment.

The Windows installer is unsigned. Windows may show an unknown-publisher/SmartScreen message. Release assets include update metadata with SHA-512 checksums; code signing requires a signing certificate and is not configured in this repository yet. Updates are not downloaded or installed without clicking the relevant action.

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

## AI Agent (v0.2)

![Arus AI Agent using a local test provider](docs/agent.png)

[Markdown profile settings](docs/agent-settings.png)

Open **AI Agent → Pengaturan** and enter a base URL, model name, and optional API key for an OpenAI-compatible **Chat Completions endpoint with tool calling**. The base URL must include the API prefix (for example `http://127.0.0.1:20128/v1`). HTTPS is required for remote providers; HTTP is allowed only on loopback. Arus adds `/chat/completions`. No provider subscription or model is bundled.

The agent can read and operate the selected Arus/Camoufox browser (tabs, popups, iframe selection, open shadow DOM, click, fill, dropdowns, keyboard, scroll and bounded waits), then verify results against captured traffic. Browser tools use short-lived element references rather than model-supplied code or selectors. Input values are not read; common secrets and email/card patterns are masked, but arbitrary page text may contain private information. Passwords, OTP, tokens and payment fields require manual input. CAPTCHA and bot protections require manual completion. Ordinary HTTP links run directly; button clicks, action links, Enter/Space and closing tabs require local approval because handlers can have hidden effects. Stop prevents subsequent steps; an action already dispatched may complete. Canvas/image-only controls, closed shadow DOM, OS dialogs and file uploads are not supported. The agent can inspect captured JSON and form-urlencoded fields, search/filter traffic, select requests, pause/resume capture, open the Arus browser, prepare/edit/replay requests, copy redacted cURL, export the entire standard HAR, check updates, change display size, and add memories. Browser navigation, replay, clearing traffic, and memory additions request local approval. Cancelling the agent stops further steps; actions already completed remain in effect. Replays use original local headers/body, never masked placeholders. Requests are sent without automatic browser cookies.

Five editable Markdown files guide each conversation:

| File | Purpose |
| --- | --- |
| `IDENTITY.md` | Agent name, role, language |
| `SOUL.md` | Personality and communication |
| `AGENTS.md` | Goals and workflow |
| `TOOLS.md` | Guidance for Arus tools |
| `MEMORY.md` | Persistent notes |

Import one or several of these `.md` files in settings (names are case-insensitive), edit them, then save. Export writes the saved profiles as five real files into a chosen folder. Defaults ship in `src/agent-profiles/`. Each file is limited to 24 kB and the total to 80 kB. Instructions cannot enable shell commands, arbitrary filesystem access, or control other desktop apps. Memory additions by the model require confirmation; edits in settings are saved explicitly.

Provider settings and profiles remain in Electron's per-user application-data folder, not in this repository. On Windows, API keys use Electron's OS-backed safeStorage encryption. Where secure encryption is unavailable (including Linux `basic_text` storage), keys remain in session memory and are not written to disk. Empty API-key input preserves the current key; use the removal checkbox to erase it. Chats remain in session memory and reset on restart or settings changes.

**Data sent to your selected provider:** your messages, all five profiles, the selected request if enabled, and traffic requested through tools. Known sensitive header/query/JSON fields are masked, bodies other than JSON and form-urlencoded are omitted, and context is bounded. Masking is heuristic and cannot guarantee removal of secrets hidden in unexpected fields, URL paths, or free text. Review your data and provider policies before sharing private traffic. Website responses and tool outputs are treated as untrusted data. No arbitrary code or shell tools are exposed. No live commercial-model connection is required by the tests; a local mock provider verifies the actual tool loop and UI.

## Readability

Geist Sans, Geist Mono, and selected Lucide icons are bundled for offline use. **Tampilan** offers Ringkas, Nyaman (default), and Besar, remembered locally. The agent occupies a docked column on the right, with Chat and Pengaturan tabs. Drag its separator (or use Left/Right while focused) to resize; minimize to a 48px rail without stopping the agent. Width and expanded state are saved locally. On narrow workspaces, Traffic and Detail request tabs preserve readable content instead of overlapping panels.

## Task controls

The agent can create a plan with up to eight steps and update its progress while tools run. **Jeda** saves a checkpoint; **Ambil alih** pauses the agent and brings the browser forward for manual work. Use **Lanjutkan tugas** (or **Saya selesai, lanjutkan**) afterward. The agent reads the current page again and retains the original goal, completed steps, and tool results. Completed, cancelled, or uncertain identical modifying calls are blocked within that task; an action already dispatched can still finish, so verify its result before continuing.

Three repeated tool errors or four identical observations pause a task with an explanation. Execution limits also produce a resumable checkpoint. Checkpoints survive reloading the inspector, but remain in memory: closing Arus, starting a new chat, or saving agent settings clears them. Resume starts a new bounded run; it does not automatically retry an interrupted action.

## Compare requests

Select a request, click **Pakai sebagai A**, select another request, then click **Bandingkan dengan A**. The comparison highlights added, removed, and changed fields, with options to swap A/B and show unchanged fields. Header names are compared case-insensitively. JSON is compared by field rather than formatting; form-urlencoded preserves duplicate field positions. Other bodies are compared by line.

Body comparisons inspect up to 500 fields/lines and display up to 120 changed and 120 unchanged entries; long displayed values are clipped, while equality uses the full captured value. Capture truncation is indicated. The local comparison uses captured values, including raw headers. The agent's `compare_requests` tool receives masked values instead; hidden values cannot be fully compared by the model.

## Form bodies

For `application/x-www-form-urlencoded`, the Request/Response body view offers **Form** (decoded field/value table, duplicates preserved) and **Raw** (exact captured body). Form display is bounded to 500 fields; Raw includes the entire captured body within the existing 1 MiB capture limit. The agent receives up to 100 parsed fields, with known sensitive keys (including Signature, tokens, passwords, and nested JSON secrets) masked. Raw secrets remain local; they are not automatically sent to the model. Multipart file uploads and other non-JSON body formats are still omitted from AI context.

Direct chat requests take priority over conflicting saved Markdown preferences. The application sends the fixed policy separately from editable profiles, which are lower-priority user preferences. Clear requests should lead to tool execution and verification rather than an offer to act. This policy applies even to existing saved profiles; their contents are preserved. Model compliance still depends on the configured provider, and application permissions and execution limits remain enforced.

## Network workspace (v0.3)

**Log options** provides method/status/type filters, bookmark filtering, sorting, and column visibility/order. Drag a column boundary (or focus it and use Left/Right) to resize. Column settings survive restart. **Cari isi** searches captured headers, bodies, notes and WebSocket text locally; results are a snapshot, so run the search again to include new traffic. The regular search box continues to filter URL/method/status/type. Right-click a request for cURL, replay, comparison, notes or a rule for its domain.

The detail panel adds **Query**, **Cookies**, **SSL**, **WebSocket** and **Catatan**. Query duplicates remain visible. JSON/text bodies offer Raw and Pretty; captured PNG/JPEG/GIF/WebP/AVIF/BMP responses can be previewed within the 1 MiB limit. SVG and HTML responses are never executed. Timing uses proxy timestamps: DNS, connection/TLS, send, server wait and download. Missing phases are shown as unavailable, including some reused connections; the waterfall is not a browser resource-timing trace.

**SSL** shows the upstream certificate issuer/subject, validity, SAN, serial, SHA-256 fingerprint, TLS version and cipher when available from the actual upstream socket. It does not initiate a separate probe. Tunnel connections, cache, Map Local and some reused or HTTP/2 sockets may lack certificate information. Upstream TLS validation remains enabled. SSL status distinguishes inspected HTTPS, bypassed tunnels and failed connections.

**Aturan proxy → SSL Proxying** lists exact hostnames or `*.example.com` domains to pass through without HTTPS inspection. Remove an entry to inspect that domain again. This affects new TLS connections; reopen the browser to avoid reusing an existing connection. Certificate pinning is not bypassed.

HTTP(S) request rules match a literal hostname, path prefix and optional method. Rules apply to traffic through the Arus proxy, not direct replay or WebSocket upgrade handshakes. Priority is Block, then Map Local, then throttle/breakpoint; the first matching rule of each kind is used. Block returns 403. Map Local uses an explicitly chosen file (maximum 1 MiB), Content-Type and status; no target request is sent. Missing or oversized local files produce 502. Throttling delays a request by up to 30 seconds and limits response download speed in kbps; upload speed is not simulated.

Request breakpoints hold up to 16 concurrent requests before forwarding. Click the floating queue, select a request, edit method/headers/text body and choose **Teruskan request** or **Batalkan request**. Target URL stays fixed. Bodies are limited to 1 MiB; larger requests are rejected before forwarding. Binary or compressed bodies can be continued unchanged but not edited. Pending requests expire after two minutes and are cancelled, never automatically forwarded. Closing the dialog leaves the request queued. Continuing sends once with the original or edited headers/body and validates upstream TLS; redirects are returned without being followed. Rules persist locally but HTTP request rules start disabled after restarting Arus. SSL bypass preferences persist.

The WebSocket viewer retains the latest 200 frames per connection, at most 64 KiB per frame (text or base64 binary), within the existing 48 MiB session budget. Control/close frames and truncation are labelled. Messages remain local; the agent can inspect bounded JSON frames with heuristic masking, while other text/binary payloads are omitted from provider context.

**Sesi & import** saves an explicit full `.arus` file including raw headers/body, bookmarks, notes, image previews, SSL metadata and frames. It may contain credentials. There is no automatic disk capture. Import appends archived requests from `.arus` or HAR 1.2, with new local IDs so they cannot receive live engine updates. Files are limited to 64 MiB and imported data to 3,000 records / 48 MiB. HAR base64 bodies are not decoded by the importer. Captured records without an explicit save still disappear when Arus closes.

The agent can search local content, inspect masked JSON WebSocket messages, view rules, bookmark requests, and invoke local session/file dialogs. Creating SSL/block/throttle/breakpoint/Map Local rules requires local approval. Map Local only uses a file selected through the local dialog; the agent cannot supply arbitrary file paths. Breakpoint release/edit is performed manually in the local queue.
