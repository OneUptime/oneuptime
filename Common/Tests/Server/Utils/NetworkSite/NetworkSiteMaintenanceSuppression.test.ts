import NetworkSiteMaintenanceSuppression from "../../../../Server/Utils/NetworkSite/NetworkSiteMaintenanceSuppression";
import NetworkSiteService from "../../../../Server/Services/NetworkSiteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "../../../../Types/ObjectID";
import { MaintenanceEventWindow } from "../../../../Utils/NetworkSite/SiteMaintenanceUtil";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The server side of network-site maintenance (issue #3431).
 *
 * Two things this owns, and both have a failure mode worth pinning:
 *
 *   1. Which sites are currently silenced. Attaching a Region has to expand
 *      to its whole subtree, or a regional window covers nothing but the
 *      region row itself.
 *
 *   2. That a rollup NEVER fails because this lookup did. Falling back to
 *      "nothing is suppressed" reproduces pre-feature behaviour, which is
 *      the safe direction: a site may briefly read red for planned work,
 *      rather than a real outage going unnoticed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const REGION_ID: string = "11111111-1111-4111-8111-111111111111";
const UNIT_ID: string = "33333333-3333-4333-8333-333333333333";

function ongoingEvent(siteIds: Array<string>): ScheduledMaintenance {
  return {
    networkSites: siteIds.map((id: string) => {
      return { _id: id };
    }),
  } as unknown as ScheduledMaintenance;
}

describe("NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance", () => {
  beforeEach(() => {
    NetworkSiteMaintenanceSuppression.invalidateCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    NetworkSiteMaintenanceSuppression.invalidateCache();
  });

  it("expands an attached region to its whole subtree", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([ongoingEvent([REGION_ID])] as never);
    const subtree: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockResolvedValue(new Set<string>([REGION_ID, UNIT_ID]));

    const result: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROJECT_ID,
      );

    expect(Array.from(result).sort()).toEqual([REGION_ID, UNIT_ID].sort());

    const args: { siteIds: Array<ObjectID>; projectId: ObjectID } = subtree.mock
      .calls[0]![0] as { siteIds: Array<ObjectID>; projectId: ObjectID };
    expect(
      args.siteIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([REGION_ID]);
    expect(args.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  it("touches the hierarchy at all only when something is attached", async () => {
    /*
     * The common case by a wide margin: no ongoing event, or one with no
     * sites on it. Expanding subtrees anyway would put two extra queries on
     * every rollup in every project forever.
     */
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([ongoingEvent([])] as never);
    const subtree: jest.SpyInstance = jest.spyOn(
      NetworkSiteService,
      "getSubtreeSiteIds",
    );

    const result: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROJECT_ID,
      );

    expect(result.size).toBe(0);
    expect(subtree).not.toHaveBeenCalled();
  });

  it("deduplicates a site attached to two ongoing events", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([
        ongoingEvent([REGION_ID]),
        ongoingEvent([REGION_ID, UNIT_ID]),
      ] as never);
    const subtree: jest.SpyInstance = jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockResolvedValue(new Set<string>([REGION_ID, UNIT_ID]));

    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );

    const args: { siteIds: Array<ObjectID> } = subtree.mock.calls[0]![0] as {
      siteIds: Array<ObjectID>;
    };
    expect(args.siteIds).toHaveLength(2);
  });

  it("caches per project, and invalidateCache drops the answer", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([ongoingEvent([REGION_ID])] as never);
    jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockResolvedValue(new Set<string>([REGION_ID]));

    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    expect(findBy).toHaveBeenCalledTimes(1);

    /*
     * A window that has just flipped state must not be scored against the
     * previous answer, which is why the state-transition hook invalidates
     * rather than waiting out the TTL.
     */
    NetworkSiteMaintenanceSuppression.invalidateCache(PROJECT_ID);
    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  it("returns an empty set (and does not cache it) when the lookup throws", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockRejectedValue(new Error("database is on fire") as never);

    const result: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROJECT_ID,
      );

    expect(result.size).toBe(0);

    /*
     * Not cached: a transient failure must not silence maintenance for the
     * whole TTL, and must not silence the recovery either.
     */
    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    expect(findBy).toHaveBeenCalledTimes(2);
  });
});

describe("NetworkSiteMaintenanceSuppression.toEventWindows", () => {
  it("drops events with no sites attached and events with no start", () => {
    const windows: Array<MaintenanceEventWindow> =
      NetworkSiteMaintenanceSuppression.toEventWindows([
        {
          startsAt: new Date("2026-08-01T00:00:00Z"),
          endsAt: new Date("2026-08-01T02:00:00Z"),
          networkSites: [{ _id: UNIT_ID }],
        },
        // No sites — excludes nothing, so it only lengthens the caller's loop.
        {
          startsAt: new Date("2026-08-01T00:00:00Z"),
          endsAt: null,
          networkSites: [],
        },
        // No start — there is no interval to subtract.
        {
          endsAt: new Date("2026-08-01T02:00:00Z"),
          networkSites: [{ _id: REGION_ID }],
        },
      ] as unknown as Array<ScheduledMaintenance>);

    expect(windows).toHaveLength(1);
    expect(windows[0]!.siteIds).toEqual([UNIT_ID]);
    expect(windows[0]!.endsAt).toEqual(new Date("2026-08-01T02:00:00Z"));
  });

  it("carries a null end through as 'still running'", () => {
    const windows: Array<MaintenanceEventWindow> =
      NetworkSiteMaintenanceSuppression.toEventWindows([
        {
          startsAt: new Date("2026-08-01T00:00:00Z"),
          endsAt: undefined,
          networkSites: [{ _id: UNIT_ID }],
        },
      ] as unknown as Array<ScheduledMaintenance>);

    expect(windows[0]!.endsAt).toBeNull();
  });
});

/*
 * Cache coherence (issue #3431, follow-up review).
 *
 * The lookup is cached per project for a few seconds, and a maintenance
 * event that changes state invalidates it. The dangerous interleaving is a
 * lookup that started BEFORE the invalidation and finishes after it: without
 * a guard it writes the pre-change answer back into the cache, and the
 * window it was supposed to start (or stop) stays wrong for a further full
 * TTL — which is exactly the moment correctness matters most.
 */
describe("NetworkSiteMaintenanceSuppression cache coherence", () => {
  beforeEach(() => {
    NetworkSiteMaintenanceSuppression.invalidateCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    NetworkSiteMaintenanceSuppression.invalidateCache();
  });

  it("does not install an answer that was invalidated while it was in flight", async () => {
    let releaseFirst: (() => void) | null = null;
    const firstQueryStarted: Promise<void> = new Promise<void>(
      (resolve: () => void) => {
        releaseFirst = resolve;
      },
    );

    let call: number = 0;
    let gateResolved: (() => void) | null = null;
    const gate: Promise<void> = new Promise<void>((resolve: () => void) => {
      gateResolved = resolve;
    });

    const findBy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockImplementation(async (): Promise<Array<ScheduledMaintenance>> => {
        call++;
        if (call === 1) {
          releaseFirst!();
          await gate;
          return [ongoingEvent([REGION_ID])];
        }
        // After the window ended, nothing is attached any more.
        return [];
      });
    jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockResolvedValue(new Set<string>([REGION_ID]));

    const inFlight: Promise<Set<string>> =
      NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROJECT_ID,
      );

    // The window ends while that first read is still awaiting its rows.
    await firstQueryStarted;
    NetworkSiteMaintenanceSuppression.invalidateCache(PROJECT_ID);
    gateResolved!();

    // The in-flight caller still gets the answer it asked for...
    expect(Array.from(await inFlight)).toEqual([REGION_ID]);

    /*
     * ...but it must not have been cached. The next read has to go back to
     * the database and see that the window is over — if the stale set were
     * installed, this would return REGION_ID and the maintenance blackout
     * would persist for another full TTL.
     */
    const afterwards: Set<string> =
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        PROJECT_ID,
      );

    expect(afterwards.size).toBe(0);
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  it("still caches normally when nothing invalidates underneath it", async () => {
    const findBy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([ongoingEvent([REGION_ID])] as never);
    jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockResolvedValue(new Set<string>([REGION_ID]));

    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );

    expect(findBy).toHaveBeenCalledTimes(1);
  });

  it("keeps projects independent of one another's invalidations", async () => {
    const otherProject: ObjectID = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );
    const findBy: jest.SpyInstance = jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([ongoingEvent([REGION_ID])] as never);
    jest
      .spyOn(NetworkSiteService, "getSubtreeSiteIds")
      .mockResolvedValue(new Set<string>([REGION_ID]));

    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      otherProject,
    );
    expect(findBy).toHaveBeenCalledTimes(2);

    // Invalidating one project must not evict the other's entry.
    NetworkSiteMaintenanceSuppression.invalidateCache(PROJECT_ID);

    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      otherProject,
    );
    expect(findBy).toHaveBeenCalledTimes(2);

    await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
      PROJECT_ID,
    );
    expect(findBy).toHaveBeenCalledTimes(3);
  });

  it("does not grow without bound across many projects", async () => {
    /*
     * The map is keyed by project and nothing ever removed an entry, so on a
     * large multi-tenant install it retained every project the process had
     * ever rolled up. Past its ceiling it now sweeps.
     */
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([] as never);

    for (let i: number = 0; i < 700; i++) {
      const hex: string = i.toString(16).padStart(12, "0");
      await NetworkSiteMaintenanceSuppression.getSiteIdsUnderOngoingMaintenance(
        new ObjectID(`00000000-0000-4000-8000-${hex}`),
      );
    }

    const cacheSize: number = (
      NetworkSiteMaintenanceSuppression as unknown as {
        cache: Map<string, unknown>;
      }
    ).cache.size;

    expect(cacheSize).toBeLessThanOrEqual(512);
  });
});
