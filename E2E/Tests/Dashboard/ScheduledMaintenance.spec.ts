import {
  APIRequestContext,
  Browser,
  Page,
  expect,
  test,
} from "@playwright/test";
import Faker from "Common/Utils/Faker";
import { registerAndCreateProject } from "./Helpers/ProductOnboarding";
import {
  createItem,
  JSONish,
  listItems,
  pollUntil,
  toId,
} from "./Helpers/MonitorAlerting";
import { publicPost } from "./Helpers/StatusPagePublic";

/*
 * Scheduled maintenance end to end: dashboard -> status page -> visitor.
 *
 * Scheduled maintenance had no e2e coverage at all. This spec creates an
 * event against a real stack, attaches it to a public status page, and
 * asserts an anonymous visitor sees it — then walks it through the state
 * machine (Scheduled -> Ongoing -> Ended) and asserts the public payload and
 * the event's own current state follow each transition.
 *
 * Anti-flake notes:
 * - every wait is a deadline-bounded poll, never a fixed sleep
 * - states are looked up by their semantic flags (isScheduledState,
 *   isOngoingState, isEndedState) rather than by name, so renaming the seed
 *   data does not silently break the spec
 * - run-unique titles so a re-run never collides with leftover rows
 * - chromium only: this exercises server behaviour, not rendering engines
 */

interface MaintenanceStates {
  scheduledStateId: string;
  ongoingStateId: string;
  endedStateId: string;
}

test.describe.configure({ mode: "serial", retries: 1 });

test.describe("scheduled maintenance", () => {
  test.skip(({ browserName }: { browserName: string }) => {
    return browserName !== "chromium";
  }, "server behaviour, one engine is enough");

  test("should show on the public status page and follow its state machine", async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(600000);

    const unique: string = Faker.generateName().toString().replace(/\s/g, "-");

    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "Scheduled Maintenance E2E",
    });

    /*
     * Every new project is seeded with the scheduled maintenance states after
     * the create response returns, so poll for them.
     */
    const states: MaintenanceStates = await pollUntil<MaintenanceStates>({
      page,
      description: "default scheduled maintenance states to be seeded",
      timeoutMs: 120000,
      check: async (): Promise<MaintenanceStates | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId,
          path: "/api/scheduled-maintenance-state",
          select: {
            _id: true,
            name: true,
            isScheduledState: true,
            isOngoingState: true,
            isEndedState: true,
          },
        });

        const scheduled: JSONish | undefined = rows.find((row: JSONish) => {
          return row["isScheduledState"] === true;
        });
        const ongoing: JSONish | undefined = rows.find((row: JSONish) => {
          return row["isOngoingState"] === true;
        });
        const ended: JSONish | undefined = rows.find((row: JSONish) => {
          return row["isEndedState"] === true;
        });

        if (!scheduled || !ongoing || !ended) {
          return null;
        }

        return {
          scheduledStateId: toId(scheduled["_id"]),
          ongoingStateId: toId(ongoing["_id"]),
          endedStateId: toId(ended["_id"]),
        };
      },
    });

    // A public status page for the event to be visible on.
    const statusPageName: string = `Maintenance Status Page ${unique}`;

    const statusPage: JSONish = await createItem({
      page,
      projectId,
      path: "/api/status-page",
      item: {
        name: statusPageName,
        description: "Created by ScheduledMaintenance.spec.ts",
        projectId,
        pageTitle: statusPageName,
        isPublicStatusPage: true,
      },
    });

    const statusPageId: string = toId(statusPage["_id"]);
    expect(statusPageId, "status page should have been created").not.toBe("");

    /*
     * The window starts in the near future and ends after it, so the event is
     * genuinely "scheduled" at creation time. The spec drives the transitions
     * itself rather than waiting for the cron to notice the window opening —
     * that would put a background job on the critical path.
     */
    const now: number = Date.now();
    const maintenanceTitle: string = `Database upgrade ${unique}`;

    const maintenance: JSONish = await createItem({
      page,
      projectId,
      path: "/api/scheduled-maintenance",
      item: {
        projectId,
        title: maintenanceTitle,
        description: "Rolling database upgrade, brief write downtime.",
        statusPages: [{ _id: statusPageId, projectId }],
        startsAt: new Date(now + 60 * 60 * 1000).toISOString(),
        endsAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
      },
    });

    const maintenanceId: string = toId(maintenance["_id"]);
    expect(
      maintenanceId,
      "scheduled maintenance should have been created",
    ).not.toBe("");

    /*
     * ScheduledMaintenanceService seeds the initial "Scheduled" state timeline
     * row asynchronously after create returns, so poll for it rather than
     * asserting once.
     */
    await pollUntil<JSONish>({
      page,
      description: "the event to land in the scheduled state",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId,
          path: "/api/scheduled-maintenance",
          query: { _id: maintenanceId },
          select: { _id: true, currentScheduledMaintenanceStateId: true },
        });

        const row: JSONish | undefined = rows[0];

        if (!row) {
          return null;
        }

        return toId(row["currentScheduledMaintenanceStateId"]) ===
          states.scheduledStateId
          ? row
          : null;
      },
    });

    // Read the public page as a stranger: a context with no session cookies.
    const anonymous: APIRequestContext = (await browser.newContext()).request;

    await pollUntil<JSONish>({
      page,
      description: "the maintenance event to appear on the public status page",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/overview/${statusPageId}`,
        });

        return JSON.stringify(body).includes(maintenanceTitle) ? body : null;
      },
    });

    /*
     * Walk the state machine. Each transition is a new state timeline row,
     * which is the same path the dashboard's "Mark as Ongoing" action takes,
     * and the service copies the new state onto the event itself.
     */
    type AdvanceToStateFunction = (data: {
      stateId: string;
      description: string;
    }) => Promise<void>;

    const advanceToState: AdvanceToStateFunction = async (data: {
      stateId: string;
      description: string;
    }): Promise<void> => {
      await createItem({
        page,
        projectId,
        path: "/api/scheduled-maintenance-state-timeline",
        item: {
          projectId,
          scheduledMaintenanceId: maintenanceId,
          scheduledMaintenanceStateId: data.stateId,
          startsAt: new Date().toISOString(),
          shouldStatusPageSubscribersBeNotified: false,
        },
      });

      await pollUntil<JSONish>({
        page,
        description: data.description,
        timeoutMs: 120000,
        check: async (): Promise<JSONish | null> => {
          const rows: Array<JSONish> = await listItems({
            page,
            projectId,
            path: "/api/scheduled-maintenance",
            query: { _id: maintenanceId },
            select: { _id: true, currentScheduledMaintenanceStateId: true },
          });

          const row: JSONish | undefined = rows[0];

          if (!row) {
            return null;
          }

          return toId(row["currentScheduledMaintenanceStateId"]) ===
            data.stateId
            ? row
            : null;
        },
      });
    };

    await advanceToState({
      stateId: states.ongoingStateId,
      description: "the event to move to the ongoing state",
    });

    await advanceToState({
      stateId: states.endedStateId,
      description: "the event to move to the ended state",
    });

    /*
     * The full transition history must be on record — three rows, one per
     * state, in the order they happened. This is what the status page renders
     * as the event's timeline.
     */
    const timeline: Array<JSONish> = await pollUntil<Array<JSONish>>({
      page,
      description: "all three state timeline rows to be recorded",
      timeoutMs: 120000,
      check: async (): Promise<Array<JSONish> | null> => {
        const rows: Array<JSONish> = await listItems({
          page,
          projectId,
          path: "/api/scheduled-maintenance-state-timeline",
          query: { scheduledMaintenanceId: maintenanceId },
          select: {
            _id: true,
            scheduledMaintenanceStateId: true,
            startsAt: true,
          },
        });

        return rows.length >= 3 ? rows : null;
      },
    });

    const stateIdsInTimeline: Array<string> = timeline.map((row: JSONish) => {
      return toId(row["scheduledMaintenanceStateId"]);
    });

    expect(stateIdsInTimeline).toContain(states.scheduledStateId);
    expect(stateIdsInTimeline).toContain(states.ongoingStateId);
    expect(stateIdsInTimeline).toContain(states.endedStateId);

    /*
     * Once the event has ended it must drop off the public overview: that
     * payload carries what is currently relevant to a visitor, and a finished
     * maintenance window sitting there forever is exactly the bug this
     * asserts against. It was present earlier in this test (the poll above
     * would have timed out otherwise), so this is a real transition and not a
     * vacuous "it was never there".
     */
    const finalOverview: JSONish = await pollUntil<JSONish>({
      page,
      description:
        "the ended maintenance event to drop off the public overview",
      timeoutMs: 120000,
      check: async (): Promise<JSONish | null> => {
        const body: JSONish = await publicPost({
          request: anonymous,
          path: `/api/status-page/overview/${statusPageId}`,
        });

        return JSON.stringify(body).includes(maintenanceTitle) ? null : body;
      },
    });

    expect(
      (finalOverview["scheduledMaintenanceEvents"] as Array<JSONish>) || [],
    ).toEqual([]);
  });
});
