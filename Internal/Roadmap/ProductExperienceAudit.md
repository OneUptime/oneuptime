# Product experience audit

Date: 7 September 2026. Baseline: `302d796fee8` on `master`.

OneUptime already has substantial product breadth. The next quality step is to
make everyday interactions dependable, make failures recoverable, and apply the
existing accessibility patterns consistently. This pass fixes four small shared
interaction defects and records the next priorities with evidence and acceptance
criteria.

## Scope and confidence

This is a broad **sampled product and source review**, not an exhaustive audit of
every screen, backend integration, deployment configuration, or customer journey.
It does not establish security compliance, production performance, or complete
accessibility conformance.

| Area | Reviewed | Validation in this pass |
| --- | --- | --- |
| Shared controls | Checkboxes, buttons, copy controls, tables, dialogs, pagination, empty/error states | Focused automated regressions and browser interaction checks for changed components |
| Dashboard workflows | Command palette, home checklist, navigation, common forms and monitor incident options | Palette integration tests; source inspection of other flows |
| Incident response and telemetry setup | Incident state actions, subscriber notification retry, logs/metrics/traces guides and ingestion-key selection | Source inspection, including existing profiles and replay diagnostics |
| Customer-facing surfaces | Accounts recovery pages, status-page navigation, docs search/copy/mobile drawer | Source inspection |
| Operational readiness | Existing internal on-call, email and network roadmaps | Read existing work before proposing priorities |
| Full application, mobile app and infrastructure | Complete authenticated journeys, external integrations, load and delivery behavior | Not validated by this pass |

The configured development host timed out during this review. The local ingress
also reported dashboard upstream timeouts, and app logs showed Redis connection
timeouts. The screenshots and GIF therefore show **actual shared components and
product styles in an isolated browser fixture**, using synthetic data and
controlled clipboard/search delays. They are not screenshots of a successfully
validated full application session. Recheck the affected dashboard workflows once
the development stack is healthy.

## Implemented in this PR

| Improvement | Before | After | Coverage |
| --- | --- | --- | --- |
| Checkbox labels and descriptions | Visible labels did not activate/name their inputs; all descriptions used the same DOM id; errors were not associated with the control | Stable unique ids link each label, description and error to its own input; errors are announced | Label clicks, keyboard use, multiple controls, error changes, explicit accessible names and CheckboxList integration |
| Disabled and saving button shortcuts | Keyboard shortcuts could call actions even when their button was disabled or loading | The shortcut subscription follows the same availability state as the native button | Initial state, state transitions, callback changes, cleanup and checkbox-to-save integration |
| Search freshness | Old rows stayed selectable after a query change; an old response could land during the next debounce window | Old rows disappear immediately; obsolete responses are discarded; pending state is visible and announced during debounce and requests | Delayed success/failure, provider replacement/removal, clearing, closing, keyboard selection, and existing palette behavior |
| Truthful copy feedback | “Copied” appeared before the write completed; missing API and failures could silently fail | Pending, successful and failed writes have distinct accessible feedback; failures can be retried; stale completions and timers are ignored | Async success/failure, unavailable API, keyboard operation inside forms, retries, value changes and unmount cleanup |

These changes affect shared components rather than adding parallel per-screen
implementations. For example, the monitor incident form's Auto Resolve Incident,
Show Incident on Status Page and Private Incident options all use the corrected
[checkbox](../../Common/UI/Components/Checkbox/Checkbox.tsx).

## Next priorities

The sizes below are planning judgments, not measured delivery estimates. Confirm
frequency and customer impact with support evidence and workflow observation.

| Priority | Confirmed gap and evidence | Recommended change | Completion criterion | Size |
| --- | --- | --- | --- | --- |
| P1 | [Incident state controls](../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState.tsx) load optional note templates in the same critical path as essential state data; a template failure replaces the whole action panel | Load optional templates independently or on demand, with a recoverable warning | A failed template request leaves valid Acknowledge/Resolve actions usable; essential state failures remain explicit | Small |
| P1 | [IngestionKeySelector](../../App/FeatureSet/Dashboard/src/Components/Telemetry/IngestionKeySelector.tsx) omits enabled/expiry fields and automatically selects the first returned key, although ingestion rejects disabled or expired keys | Show eligibility and choose only usable keys for generated installation snippets | Disabled/expired keys are never auto-selected; an unusable selection explains recovery through an eligible key or create/manage action | Small–medium |
| P1 | The shared [telemetry setup guide](../../App/FeatureSet/Dashboard/src/Components/Telemetry/Documentation.tsx) verifies incoming profiles, while logs/metrics/traces finish with configuration examples | Extend the existing verification pattern to those signals with service/setup-window scope and a filtered explorer link | The guide distinguishes waiting, received data and check failure; old project data cannot falsely complete a new installation | Medium |
| P1 | Dashboard search catches entity failures and returns `[]` in [DashboardCommandPalette](../../App/FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPalette.tsx); the shared provider hook also treats rejection as no matches | Distinguish unavailable search from a successful empty result, retain healthy sections and offer retry | Simulated failure in one provider shows an actionable state while other results stay usable; retry is tested | Medium |
| P1 | [GettingStarted](../../App/FeatureSet/Dashboard/src/Components/Home/GettingStarted.tsx) marks “Invite your team” complete from `TeamMember` row count, and one failed count hides the entire checklist | Reuse existing unique-member semantics; explicitly choose sent versus accepted invitation completion; make steps permission-aware and isolate unavailable steps | One person in two teams does not complete the invitation task; a denied/failed step leaves other steps usable | Small–medium |
| P1 | [BasicForm](../../Common/UI/Components/Forms/BasicForm.tsx), [BasicFormModal](../../Common/UI/Components/FormModal/BasicFormModal.tsx) and [ModelFormModal](../../Common/UI/Components/ModelFormModal/ModelFormModal.tsx) do not provide a shared dirty-form navigation contract | Define one accessible unsaved-edit pattern and pilot it on a long form, building on existing editor confirmations | Dirty edits survive canceled navigation; save and explicit discard clear the guard; modal, route and browser exits are covered in the pilot | Medium for contract + pilot |
| P1 | [Status-page header](../../App/FeatureSet/StatusPage/src/Components/Header/Header.tsx) and navbar use icon-only outline menu buttons without names; [docs mobile drawer](../../App/FeatureSet/Docs/Views/Partials/Scripts.ejs) moves focus initially but does not trap it like docs search does | Reuse tested disclosure/dialog behavior: names, expanded state, Escape, focus containment where modal, and return focus | Mobile navigation is fully operable with keyboard and named correctly in accessibility snapshots | Small–medium |
| P2 | [Docs search index](../../App/FeatureSet/Docs/Views/Partials/Scripts.ejs) indexes navigation title/category, not page contents | Index headings, configuration keys and troubleshooting content; show relevant snippets | Searches for a documented configuration key or error message return the correct heading and useful context | Medium |
| P2 | Accounts [NotFound](../../App/FeatureSet/Accounts/src/Pages/NotFound.tsx) and [Forbidden](../../App/FeatureSet/Accounts/src/Pages/Forbidden.tsx) explain the problem but provide no recovery action | Add appropriate sign-in/home recovery and consistent page title/main/focus behavior | A user can recover from either page without editing the URL; route and keyboard regressions pass | Small |
| P2 | [Announcement resend](../../App/FeatureSet/Dashboard/src/Pages/StatusPages/AnnouncementView.tsx) swallows request failures; [subscriber notification confirmation](../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus.tsx) invokes the async callback and closes immediately | Await resend requests with pending feedback, duplicate-submit prevention and actionable failure/retry | Failed enqueue remains visible and retryable; successful enqueue refreshes delivery status | Small–medium |
| P2 | [Detail](../../Common/UI/Components/Detail/Detail.tsx) reveals copying only on hover, while JSONTable already supports focus-within; docs copy silently ignores failure; shared empty/error components vary in density and recovery copy | Finish keyboard visibility and copy-feedback adoption, then standardize loading/empty/error/retry presentation | Copy controls remain visible when focused; failures have a next action; representative narrow screens do not bury useful content in empty-state padding | Small–medium |

Switching between different projects currently reloads the document, so possible stale async state
in Home during an in-place project switch is not presented here as a confirmed
current picker defect.

## Product-quality operating plan

1. Establish a compact journey suite: first monitor, first incident, responder
   notification, status-page update, teammate invitation, and troubleshooting a
   failed integration. Record completion, failure recovery and keyboard behavior.
2. Give each shared interaction a state checklist: initial, loading, empty,
   partial failure, retry, forbidden, disabled and success. Include narrow-screen,
   dark-theme and keyboard checks where applicable.
3. Add a small mobile-browser smoke project. The current [E2E configuration](../../E2E/playwright.config.ts)
   enables desktop Chromium/Firefox while mobile project examples are commented
   out. Start with the critical journeys, not every suite on every device.
4. Measure first-monitor activation, onboarding completion, failed-search rate,
   abandoned dirty forms, and support contacts caused by unclear recovery. Set
   targets after measuring a baseline; do not infer them from this source audit.
5. Treat performance and operational delivery as separate evidence-based work:
   profile realistic accounts and trace real notification delivery before claiming
   latency or reliability improvements.

Existing command navigation, modal focus management, status-page skeletons,
resource search, skip links, live timestamps, multilingual docs and the shipped
on-call readiness work should be extended rather than re-proposed as missing.
The same applies to direct incident actions, state timelines, public/private notes,
announcement scheduling, subscriber-delivery inspection, inline ingestion-key
creation and retry, profiles installation confirmation, and replay diagnostics.

## Review evidence

See [browser screenshots and walkthrough](./ProductExperiencePolish/README.md).
The PR records exact focused test counts, compilation and lint outcomes, including
any environment limitations.
