# Discord operations acceptance

Standard: googledev-style. Author these cases before the HOM-41 implementation.

## Maintenance and monitor failures

1. A maintenance start or completion action changes no state or records the wrong actor.
2. A custom maintenance state belongs to another project, is deleted, or is hidden from the actor.
3. An actor can read maintenance but cannot create its state timeline.
4. Membership is removed after opening a form; submitting it still mutates data.
5. A private note becomes public, a public note becomes private, or its actor is lost.
6. Empty, whitespace-only, oversized, or unknown-visibility notes write rows.
7. A foreign-project or hidden maintenance ID reaches a root mutation helper.
8. A state picker truncates after 25 choices, leaks another project's state, or accepts an unbounded cursor.
9. A picker opened before permission revocation continues discovering resources afterward.
10. A monitor action uses stale or root props, changes another project, or succeeds when the update matched no row.
11. A monitor service failure is presented as success.
12. An unsupported action, malformed resource ID, or forged submitted state produces a mutation.
13. A replay repeats a note or mutation after Redis loses its cache.
14. Slow mutations time out before the initial deferred response or report success before persistence finishes.

Run signed interactions against the installed fixture app and read the affected rows through authenticated APIs. Retain request, response, actor, state, and note-count artifacts. Isolated checks exercise the real authorization layer with mocked database boundaries; they do not establish installed workflow success.

## Creation failures and prerequisites

Creation must retain title, description, severity for incidents, scheduled start and end for maintenance, multiple monitors, labels, incident on-call policies, and optional monitor status. Every reference must belong to the project and remain visible at final submit. Monitor-status writes also need monitor update authorization before creating the resource.

Reject invalid dates, missing timezone offsets, end before start, malformed UUIDs, duplicate or oversized selections, expired/cancelled drafts, another actor's draft, changed installations, and replays. Drafts must not create resources until explicit final submission. Use bounded native searchable selectors rather than pasted IDs or a silently truncated list.

The staged draft contract is pending HOM-39 coordination. Do not encode shared session storage or parsing in a domain module.

## Standalone on-call limitation

Teams' `MicrosoftTeams/Actions/OnCallDutyPolicy.ts` calls `executePolicy` with `IncidentCreated` and no incident ID. `OnCallDutyPolicyService.executePolicy` rejects that combination before creating an execution log. Slack's corresponding action only opens the policy URL. This is not a working standalone mutation to reproduce. Resource-linked execution remains in HOM-40. A new standalone notification event requires a product decision.
