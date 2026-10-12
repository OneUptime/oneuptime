import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import NetworkSiteMaintenanceSuppression from "../../../../Server/Utils/NetworkSite/NetworkSiteMaintenanceSuppression";
import NetworkSite from "../../../../Models/DatabaseModels/NetworkSite";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "../../../../Types/ObjectID";
import {
  IN_PROGRESS_KEYS,
  NOT_IN_PROGRESS_KEYS,
  PROGRESS_PROJECT_ID,
  PROGRESS_STATE_KEYS,
  ProgressStateKey,
  eventMatchesStateQuery,
  makeEventInState,
  mockProgressStateReads,
} from "../../TestingUtils/ScheduledMaintenanceProgressWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * A network site under a scheduled maintenance event stops voting in its
 * ancestors' rollups while the event is IN PROGRESS - in its project's
 * ongoing state, or in a state of the project's own placed between Ongoing
 * and Ended ("Verifying"), where the event still holds its monitors
 * (Common/Utils/ScheduledMaintenanceStart). It used to ask for the ongoing
 * flag alone, so an event moved on to "Verifying" put its planned outage
 * back into the region above it, mid-window.
 *
 * The database is a stand-in that keeps the events each query lets through,
 * by their state's id or flags, as Postgres would.
 */

// One site per state, so what is suppressed names the states that count.
function siteIdOf(key: ProgressStateKey): string {
  const index: number = PROGRESS_STATE_KEYS.indexOf(key) + 1;
  return `5b000000-0000-4000-8000-00000000000${index}`;
}

function eventWithSite(key: ProgressStateKey): ScheduledMaintenance {
  const event: ScheduledMaintenance = makeEventInState(key);
  const site: NetworkSite = new NetworkSite();
  site._id = siteIdOf(key);
  event.networkSites = [site];
  return event;
}

describe("network sites are suppressed by every event in progress", () => {
  let events: Array<ScheduledMaintenance> = [];
  let eventQueries: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    NetworkSiteMaintenanceSuppression.invalidateCache();
    eventQueries = [];
    events = PROGRESS_STATE_KEYS.map(eventWithSite);

    mockProgressStateReads();

    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation((async (args: { query: Record<string, unknown> }) => {
        eventQueries.push(args.query);

        return events.filter((event: ScheduledMaintenance): boolean => {
          return eventMatchesStateQuery(event, args.query);
        });
      }) as never);

    jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockImplementation((async (args: { siteIds: Array<ObjectID> }) => {
        return new Set<string>(
          args.siteIds.map((id: ObjectID): string => {
            return id.toString();
          }),
        );
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    NetworkSiteMaintenanceSuppression.invalidateCache();
  });

  it("suppresses the sites of an ongoing event and of one in a state of the project's own between Ongoing and Ended", async () => {
    const suppressed: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROGRESS_PROJECT_ID,
      );

    expect(Array.from(suppressed).sort()).toEqual(
      IN_PROGRESS_KEYS.map(siteIdOf).sort(),
    );
  });

  it.each(NOT_IN_PROGRESS_KEYS)(
    "leaves the sites of an event in %s in their ancestors' rollups",
    async (key: ProgressStateKey) => {
      const suppressed: Set<string> =
        await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
          PROGRESS_PROJECT_ID,
        );

      expect(suppressed.has(siteIdOf(key))).toBe(false);
    },
  );

  it("asks for the events by the states they are in progress in, within the project, not by the ongoing flag", async () => {
    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROGRESS_PROJECT_ID,
    );

    expect(eventQueries).toHaveLength(1);
    expect(eventQueries[0]!["projectId"]?.toString()).toBe(
      PROGRESS_PROJECT_ID.toString(),
    );
    expect(
      eventQueries[0]!["currentScheduledMaintenanceState"],
    ).toBeUndefined();
    expect(
      eventQueries[0]!["currentScheduledMaintenanceStateId"],
    ).toBeDefined();
  });

  it("a project with no event in progress suppresses nothing and never walks the hierarchy", async () => {
    events = [eventWithSite("reviewing"), eventWithSite("scheduled")];

    const suppressed: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROGRESS_PROJECT_ID,
      );

    expect(suppressed.size).toBe(0);
    expect(NetworkSiteService.getSubtreeSiteIds).not.toHaveBeenCalled();
  });
});
