# Local session viewer links (v1)

`agenthub://session/<sessionUuid>` opens an indexed local session for reading only.
It never runs an Agent, resumes a CLI or uploads content. Existing
`agenthub://auth/callback` authentication links retain their separate listener.

To locate a message:

```text
agenthub://session/<sessionUuid>?message=<msgUuid>&fingerprint=<sha256>
```

Encode each identifier with `encodeURIComponent`, and build query parameters
with `URLSearchParams`. Identifiers are case-sensitive, up to 512 characters,
without slashes or control characters. Duplicate or unknown parameters,
credentials, ports, fragments and invalid percent encoding are rejected.
Do not put filesystem paths, SQLite row IDs or message content into links.

`message` is the indexed `msg_uuid`. The optional fingerprint is lowercase
SHA-256 over UTF-8 `JSON.stringify([role, timestamp, content_text])`, using the
full untruncated indexed content. Raycast always supplies it. Claude normally
uses source UUIDs; Codex currently derives IDs from source record order.
Ordinary reindexing of unchanged records preserves both. Editing, truncating
or reordering a transcript may change identities; the fingerprint prevents
opening the wrong message when a synthetic ID is reused.

If `msg_uuid` is absent, use `seq=<nonnegative integer>&fingerprint=<sha256>`
instead of `message`. A fingerprint is mandatory for sequence fallback. It
only locates exactly one record at that sequence with matching content, role
and timestamp. Changed sequences or fingerprints fail explicitly; there is no
nearest-message fallback. Duplicate UUIDs also fail explicitly.

## Delivery and UI

The main-process listener registers before Electron readiness and queues URLs.
The renderer subscribes before invoking `spool:session-links-ready`; queued
links are then delivered. macOS uses `open-url`; Windows/Linux use initial argv
and `second-instance`. The app is focused/restored, including a closed window.
The most recent link takes precedence if multiple resolves overlap.

`spool:resolve-session-link` checks the session, original record availability
(`file_path` or `.zst`), message and fingerprint, then returns the current row
ID for this view only. Deleted source files, missing sessions/messages and
malformed links produce visible errors. Index freshness still depends on sync;
an edit inside a still-existing source file is not re-parsed by opening a link.

The detail view remounts for each external navigation, scrolls to the target
and uses the existing warm-amber highlight. External targets stay highlighted
until leaving that view; ordinary search highlights last eight seconds after
entering the viewport (not while virtual layout is still loading). A session-only
link retains the normal latest-message entry behavior.

## Raycast

The companion Raycast extension is maintained separately from this repository.
Its database adapter queries `msg_uuid`, caches full-content fingerprints with
each hit and builds links without another database read. Its search command
adds the separate **在 AgentHub 查看** action. Return remains
**查看消息上下文** (full-page context); no single-message page is introduced.

Synthetic example (identifiers must exist locally to resolve):

```text
agenthub://session/example-session?message=example-message
```

All currently indexed Claude/Codex/Gemini records have message IDs. OpenCode
and Pi use the same protocol, but require actual local fixtures for runtime
verification. Hermes/OpenClaw are not added by this change.

On this Mac, the system SQLite read-only CLI cannot open the checkpointed WAL
database if its auxiliary files are absent after Spool quits. New searches may
require launching Spool first; this fails visibly rather than opening the
database writable or using an unsafe immutable fallback. Already-loaded hits
retain their fingerprints, so **在 AgentHub 查看** can cold-launch the app without
re-reading that closed database. Spool validates the cached locator on receipt.
