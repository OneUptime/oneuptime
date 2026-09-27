# Discord creation draft failures

Standard: googledev-style. Failure inventory for the creation workflow on the
v14 dispatcher. Written before the draft engine was ported; the tests named in
`DiscordDraftFlow.test.ts`, `DiscordDraftDispatcher.test.ts`,
`DiscordCreationActions.test.ts`, `DiscordCreationDraftPostgres.test.ts`,
`DiscordCreationDraftExpiry.test.ts`, and `CreationDraft.spec.ts` express it.

## Session and protocol boundaries

1. A draft continuation from another Discord identity, project, guild, channel, or installation generation reads or changes the draft.
2. A draft survives its fixed expiry, extends its life on every click, or hides expiry from the user.
3. An opaque token is malformed, oversized, missing, cancelled, or reused after final submission.
4. Concurrent final submissions both create a resource, including after Redis restarts empty.
5. A forged final action bypasses draft review, or a handler accepts client-supplied draft data without the core's validated session.
6. Unknown field names, duplicate fields, repeated selections, unexpected scalar/array shapes, excessive field counts, or oversized text bypass bounds.
7. Page changes discard selected items, permit more than the selection bound, or hide items after the first 25.
8. Cancel, back, search, and expired forms mutate the domain.
9. A provider failure is presented as an empty choice list or successful submission.
10. A timeout or failure after domain persistence is automatically retried.
11. A removed member or changed installation can finish a draft opened earlier.
12. Logs or error responses expose stored draft text, tokens, or credentials.

The core owns opaque session parsing, actor binding, expiry, continuation rendering, and durable final dispatch claims. The domain owns field schemas, authorized choice providers, current foreign-key permissions, and persistence. Do not treat cache availability as a durable replay guarantee.

## Dispatcher integration boundaries

1. A creation command opens a draft before the initial deferred response or before its receipt is bound to the current actor.
2. Native edit/search modals are wrapped in a message envelope, or deferred continuations execute before acknowledgement.
3. Label-wrapped modal fields or multiple selected values are dropped, or malformed selected values reach the flow.
4. A continuation bypasses fresh membership resolution or durable receipt binding.
5. An already claimed interaction runs the flow again, or an ordinary forged final action reaches a draft submission handler.
6. Receipt completion precedes the draft continuation, or a failed completion invites automatic recreation.

The isolated dispatcher contract covers these adapter boundaries. It does not replace the signed application workflow or the PostgreSQL concurrency tests.

## v14 dispatcher boundaries

1. `parseCustomAction` accepts only `Action:uuid`. An `oud:` continuation that reaches it, for a component or a modal submit, is refused as an invalid action.
2. `renderDeferred` and `renderImmediate` do not know the `draft` result kind, so a creation handler crashes the router instead of opening a draft.
3. A continuation is deferred with a new ephemeral message (type 5) and the earlier draft message keeps a live Submit button. Continuations must be a deferred update (type 6) of the message they came from.
4. A redelivered final interaction replays the draft's buttons. Receipt replay for a message carrying components or embeds must fall back to the generic completion notice.
5. Malformed select `values` (non-array, non-string members) are accepted before the initial response, or an empty select (min_values 0) is dropped.
6. The persistence migration sorts before `1795600000000-AddDiscordInteractionReceipt`, or the model, service, or worker is not registered in its index.

## Domain boundaries

1. Incident creation omits severity, title, description, selected monitors, labels, policies, or the actor.
2. Maintenance creation accepts a past date, impossible calendar date, missing timezone, or end at/before start.
3. Any submitted reference is malformed, deleted, foreign-project, or hidden by actor scope.
4. A selected policy executes without execution permission or the new incident association.
5. A monitor-status option changes monitors without update permission, or starts writing before all permissions are checked.
6. A post-create monitor update failure hides that the incident or maintenance already exists.
7. Domain creation trusts stale context props, scalar IDs supplied outside native selections, or an unregistered choice provider.
8. The final response says created when the service failed or returned no resource ID.
9. Dashboard link generation fails after creation and the response invites a second creation.

The optional monitor-status option matches existing chat behavior: update selected monitors immediately after creation. Preflight every update before creating. If a later write fails, name the existing resource and require inspection instead of replaying creation.

If the service returns no resource ID, report an uncertain outcome and require dashboard inspection. If only dashboard link generation fails, retain the known resource ID and report creation as successful. Neither case permits automatic retry. Selected on-call policies use the service's existing asynchronous processing, so the response does not claim paging success. Automatic notification rules can also run when no policy was explicitly selected.
