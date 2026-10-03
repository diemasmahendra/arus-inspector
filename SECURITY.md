# Security notes

Arus is a traffic-debugging tool. Its CA/private key, provider key, profile files, captures, and full exports are private local data and should never be published.

## AI permissions

Only the trusted inspector's main frame can call IPC. The capture browser has no preload API or Node access. Tool names and arguments are validated in the main process. Tools cannot execute shell commands, read arbitrary files, install software, or automate other OS applications. Native approval is required for AI browser navigation/reload, request replay, clearing captures, and adding memories. Approvals are not delegated to the model or to Markdown instructions. UI tools await renderer acknowledgement. Stop aborts further model/tool steps; completed actions remain effective.

AI requests use an independent connection, no capture-browser cookies, no proxy CA trust exceptions, and no redirects. Remote provider endpoints require HTTPS; loopback HTTP is permitted. API keys are encrypted with Electron safeStorage where secure storage is available, otherwise kept only in memory. The API key itself is not returned through IPC. Markdown imports are restricted to five selected names and bounded sizes. Exporting profiles requires a directory picker and confirmation before overwriting existing files.

Traffic bodies are treated as untrusted data. Known sensitive header/query/JSON fields are masked; non-JSON bodies are omitted. This is heuristic masking, not a guarantee that all personal data or unexpected secrets are removed. User prompts and profile contents are sent as entered. Users must review provider settings, traffic, and exports before sharing them.

## Known dependency advisory (checked 2026-10-03 UTC)

`npm audit --omit=dev` reports GHSA-86w9-cpqp-85rv / CVE-2026-85393 against `node-forge` 1.4.0, pulled in by Whistle 2.10.10. The advisory covers RSA PKCS#1 v1.5 signature verification and lists no patched version:
https://github.com/advisories/GHSA-86w9-cpqp-85rv

Arus's certificate trust check uses Node's `X509Certificate.verify`; upstream TLS uses the native TLS stack. Reviewing the installed Whistle `lib` finds no calls to forge signature verification or `verifyCertificateChain`; its CA module uses forge for key/certificate generation and signing. This narrows the observed exposure but does not erase the dependency advisory or establish safety for every dependency path. No automatic downgrade or audit suppression is applied. Track the upstream fix before expanding certificate-verification functionality.

The Windows installer remains unsigned. Release checks include source integration tests and tests against the actual packaged Windows executable before publishing.
