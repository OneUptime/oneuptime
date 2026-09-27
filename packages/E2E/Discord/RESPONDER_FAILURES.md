# Discord responder action acceptance failures

Standard: googledev-style. This inventory precedes the HOM-40 implementation.

## Domain contract

Exercise incidents, alerts, incident episodes and alert episodes through signed
Discord interactions. Read the resulting rows through authenticated OneUptime
APIs. An HTTP acknowledgment alone does not prove that an action succeeded.

1. Acknowledge and resolve update the requested resource and preserve actor attribution.
2. Public notes are available for incidents and incident episodes. Alerts and alert
   episodes accept internal notes only. Private notes never enter a public-note table.
3. Empty, non-string or oversized notes cannot create a row. Preserve valid note
   text exactly, including Markdown and literal mention text.
4. A submitted custom state belongs to the actor's project and is readable by the
   actor before a state change runs. Missing, malformed and foreign IDs fail closed.
5. On-call execution requires creation permission for the execution log and read
   access to both the affected resource and selected policy. The execution carries
   the correct resource trigger and event type for each family.
6. The current accepted membership is checked again on each submission. Cached
   form access does not survive removal or an explicit permission block.
7. Timeline/note/policy creation permission and resource visibility are independent
   gates. Hidden labels, ownership and private resources remain inaccessible.
8. Unknown actions and malformed resource IDs perform no writes. An unsupported
   public note on an alert must not become an internal note silently.
9. Resource update failures never return success. Incident
   and alert state updates retain the existing model-specific update checks.
10. Dropdown queries use the actor's project and permission props. All accessible
    choices remain reachable when more than 25 exist; unknown selections are
    revalidated on submission.
11. Repeated interaction delivery creates at most one note or on-call execution.
    The dispatcher owns the durable interaction claim; domain tests do not replace
    the signed route replay test.
12. Opening a form has no mutation side effects. Closing it creates no notes,
    timelines or execution logs. Submission receives a private success/refusal.
13. An unlinked Discord user or disconnected guild cannot perform actions, even
    with an old message or modal identifier. Forged signatures never reach a handler.
14. Preserve episode cascade semantics through existing services. Public
    incident-episode notes remain supported even though the Teams form lacks them.

## Evidence

`ResponderActions.spec.ts` exercises the real signed route, OAuth link and CRUD
readback. The four `Discord*Actions.test.ts` family entrypoints share
`DiscordResponderActionContract.ts` to isolate permission failures and service
boundaries with real model permission checks. Add transport-dependent cases to the
former before binding the dispatcher adapter. The fixture retains Playwright
traces, screenshots and JSON attachments; each run must identify its source tree.
