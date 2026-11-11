# Activation milestones and product events

These record when a project first gets value from OneUptime (issue #6830). The full list of milestones and events, the naming rule, and the funnel queries are in [`Docs/analytics/activation.md`](../../../../../Docs/analytics/activation.md). This file covers how to use them in code.

## Record a milestone (server)

Call this where the thing happens, after the write that makes it true has succeeded:

```ts
import ProjectMilestoneService from "Common/Server/Services/ProjectMilestoneService";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";

ProjectMilestoneService.reachInBackground({
  projectId: createdItem.projectId,
  milestone: ActivationMilestone.FirstTestPageAcknowledged,
});
```

- Call it every time the thing happens. The first call stores the milestone (`INSERT ... ON CONFLICT DO NOTHING` on `ProjectMilestone`) and sends `activation/<milestone>` to product analytics if it is set up. Every later call is a lookup in this process's memo, with no query.
- It returns at once and never throws, so a request or ingest path never waits on it. Use `await ProjectMilestoneService.reach({...})` when you need the write to be finished, for example in a test. It resolves `true` only for the call that stored the milestone.
- Never call it before a check that can still refuse the action. A refused or failed action must not set a milestone.
- To add a milestone, do four things. The table itself needs no migration.
  1. Add a value to `ActivationMilestone` in `Common/Types/Analytics/ActivationMilestone.ts`.
  2. Add a line to `ACTIVATION_MILESTONE_DETAILS` in the same file.
  3. Add a `reachInBackground` call where it happens.
  4. Add a row to `Docs/analytics/activation.md`. Add a backfill source in `ProjectMilestoneBackfill.ts` too, if old data can show it.

Telemetry milestones (first logs, traces, metrics, exceptions and profiles) are set in one place, `TelemetryFanInWriter.submit`, once ClickHouse accepts the rows. See `TelemetryMilestones.ts`.

## Read milestones

- On the server: `await ProjectMilestoneService.getReachedMilestones(projectId)` returns `[{ milestone, reachedAt, wasBackfilled }]`, oldest first.
- In the Dashboard: list `ProjectMilestone` through `ModelAPI`, filtered by the project. Every member of the project can read them, so the Welcome checklist (#6803) and Setup health (#6812) can read the project's milestones instead of counting rows on every visit.
- `getActivationStuckAt(reached)` returns the first setup step a project has not reached: no monitor, no check result, or nobody reachable. The Admin Dashboard's project list uses it.

## Send a behaviour event (Dashboard)

```ts
import ProductEvents from "Common/UI/Utils/ProductEvents";
import { ProductEventName } from "Common/Types/Analytics/ProductEvent";

ProductEvents.send(ProductEventName.ImporterOpened, { from: "home" });
```

- Every event and every property it may carry is listed in `PRODUCT_EVENTS` (`Common/Types/Analytics/ProductEvent.ts`). A property that is not listed is dropped. A Cloud-only property is dropped everywhere except Cloud. A token property (a key the code chose) is lower-cased and sanitized.
- The common properties (`project_id`, `plan`, `edition`, `language`, `is_project_creator`) are added for you.
- For guided setups, use `useGuidedSetupEvents("<setup_key>")` from `Common/UI/Utils/GuidedSetupEvents.ts`. It sends `started` on mount and `left` (with the step) on unmount or when the tab closes. Call `reachStep("<step_key>")` as the setup moves on, and `finish()` at its end. Then remove the event's `reservedFor` in `PRODUCT_EVENTS`.
- For a checklist, call `ChecklistEvents.noteProgress({ projectId, current, stepKeys })` each time the steps are checked.
- To add an event:
  1. Add a value to `ProductEventName`.
  2. Add its entry to `PRODUCT_EVENTS`.
  3. Add a row to `Docs/analytics/activation.md`.

  The tests (`Common/Tests/Types/Analytics`) fail until all three are in step and no property name contains a name, email, address or message word.

## Privacy

- Events go only where `ANALYTICS_KEY` and `ANALYTICS_HOST` are set: OneUptime Cloud. A self-hosted server keeps its milestones in its own database and sends nothing.
- In the browser, events also wait for consent and respect Global Privacy Control (`Common/Utils/Analytics.ts`).
- Never put a name, an email or any other address, a phone number, or text someone wrote into an event.
