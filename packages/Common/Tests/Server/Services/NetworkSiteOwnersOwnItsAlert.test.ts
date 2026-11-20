import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import NetworkSiteOwnerTeamService from "../../../Server/Services/NetworkSiteOwnerTeamService";
import NetworkSiteOwnerUserService from "../../../Server/Services/NetworkSiteOwnerUserService";
import NetworkSiteService from "../../../Server/Services/NetworkSiteService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import CreatedNotificationHold, {
  OwnersAddedBy,
} from "../../../Server/Utils/Notification/CreatedNotificationHold";
import Alert from "../../../Models/DatabaseModels/Alert";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteOwnerTeam from "../../../Models/DatabaseModels/NetworkSiteOwnerTeam";
import NetworkSiteOwnerUser from "../../../Models/DatabaseModels/NetworkSiteOwnerUser";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A NETWORK SITE'S OWNERS OWN THE ALERT IT RAISES (#10188).
 *
 * A site that alerts when it is unhealthy raises one alert when its health
 * rolls up unhealthy (NetworkSiteService.syncSiteAlertForStatusTransition).
 * Sites have owners now - the Sites list adds and removes them in bulk, a
 * Meraki import's 700 stores at a time - and what owning a site does is
 * this:
 *
 *   - the site's people and teams are made the alert's owners, told as
 *     any alert's owners are (notify owners on);
 *   - the alert's "Alert Created" notification waits for them: the create
 *     is held while they are added, and let go once they are in - or once
 *     adding them failed (CreatedNotificationHold), so it never waits for
 *     ever;
 *   - a site nobody owns adds nobody, and its alert's created notification
 *     goes to the project's owners as before;
 *   - adding them failing never loses the alert: the site still tracks it.
 *
 * And the owners are read for the one site, in its project, as OneUptime.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10188000-0000-4000-8000-0000000000a1",
);
const SITE_ID: ObjectID = new ObjectID("10188000-0000-4000-8000-0000000000b1");
const SEVERITY_ID: ObjectID = new ObjectID(
  "10188000-0000-4000-8000-0000000000c1",
);
const ALERT_ID: ObjectID = new ObjectID("10188000-0000-4000-8000-0000000000d1");
const ALICE: ObjectID = new ObjectID("10188000-0000-4000-8000-0000000000e1");
const BOB: ObjectID = new ObjectID("10188000-0000-4000-8000-0000000000e2");
const STORE_OPS: ObjectID = new ObjectID(
  "10188000-0000-4000-8000-0000000000f1",
);

function store(): NetworkSite {
  const site: NetworkSite = new NetworkSite(SITE_ID);
  site.projectId = PROJECT_ID;
  site.name = "Store 0660";
  site.shouldAlertWhenUnhealthy = true;
  return site;
}

function offline(): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status.name = "Offline";
  status.isOperationalState = false;
  return status;
}

// The private seam the rollup calls when a site's status moves.
async function siteGoesUnhealthy(site: NetworkSite): Promise<void> {
  await (
    NetworkSiteService as unknown as {
      syncSiteAlertForStatusTransition: (data: {
        site: NetworkSite;
        newStatus: MonitorStatus | null;
      }) => Promise<void>;
    }
  ).syncSiteAlertForStatusTransition({ site: site, newStatus: offline() });
}

let createdWith: Array<CreateBy<Alert>> = [];
let heldWhileCreating: Array<boolean> = [];
let addOwnersCalls: Array<Array<unknown>> = [];
let siteAlertWrites: Array<{ id: ObjectID; data: unknown }> = [];

beforeEach(() => {
  createdWith = [];
  heldWhileCreating = [];
  addOwnersCalls = [];
  siteAlertWrites = [];

  jest.spyOn(AlertSeverityService, "findOneBy").mockResolvedValue({
    id: SEVERITY_ID,
  } as never);

  jest.spyOn(AlertService, "create").mockImplementation((async (
    createBy: CreateBy<Alert>,
  ): Promise<Alert> => {
    createdWith.push(createBy);
    heldWhileCreating.push(
      CreatedNotificationHold.isAddingOwners(createBy as never, [
        OwnersAddedBy.Caller,
      ]),
    );
    return new Alert(ALERT_ID);
  }) as never);

  jest.spyOn(AlertService, "addOwners").mockImplementation((async (
    ...args: Array<unknown>
  ): Promise<unknown> => {
    addOwnersCalls.push(args);
    return { added: [], skipped: [] };
  }) as never);

  jest
    .spyOn(NetworkSiteService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      id: ObjectID;
      data: unknown;
    }): Promise<void> => {
      siteAlertWrites.push(data);
    }) as never);

  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function ownedBy(data: { users: Array<ObjectID>; teams: Array<ObjectID> }): {
  userQueries: Array<unknown>;
  teamQueries: Array<unknown>;
} {
  const userQueries: Array<unknown> = [];
  const teamQueries: Array<unknown> = [];

  jest
    .spyOn(NetworkSiteOwnerUserService, "findAllBy")
    .mockImplementation((async (findBy: { query: unknown; props: unknown }) => {
      userQueries.push(findBy);
      return data.users.map((userId: ObjectID): NetworkSiteOwnerUser => {
        const row: NetworkSiteOwnerUser = new NetworkSiteOwnerUser();
        row.userId = userId;
        return row;
      });
    }) as never);

  jest
    .spyOn(NetworkSiteOwnerTeamService, "findAllBy")
    .mockImplementation((async (findBy: { query: unknown; props: unknown }) => {
      teamQueries.push(findBy);
      return data.teams.map((teamId: ObjectID): NetworkSiteOwnerTeam => {
        const row: NetworkSiteOwnerTeam = new NetworkSiteOwnerTeam();
        row.teamId = teamId;
        return row;
      });
    }) as never);

  return { userQueries, teamQueries };
}

describe("a network site's owners own the alert it raises", () => {
  test("its people and teams are made the alert's owners, told as any alert's are", async () => {
    ownedBy({ users: [ALICE, BOB], teams: [STORE_OPS] });

    await siteGoesUnhealthy(store());

    expect(createdWith).toHaveLength(1);
    expect(createdWith[0]!.data.title).toBe(
      "Network site Store 0660 is Offline",
    );
    expect(addOwnersCalls).toHaveLength(1);

    const [projectId, alertId, userIds, teamIds, notifyOwners, props] =
      addOwnersCalls[0]! as [
        ObjectID,
        ObjectID,
        Array<ObjectID>,
        Array<ObjectID>,
        boolean,
        { isRoot: boolean },
      ];

    expect(projectId.toString()).toBe(PROJECT_ID.toString());
    expect(alertId.toString()).toBe(ALERT_ID.toString());
    expect(
      userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([ALICE.toString(), BOB.toString()]);
    expect(
      teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([STORE_OPS.toString()]);
    expect(notifyOwners).toBe(true);
    expect(props.isRoot).toBe(true);

    // The site tracks its open alert.
    expect(siteAlertWrites).toEqual([
      { id: SITE_ID, data: { currentActiveAlertId: ALERT_ID } },
    ]);
  });

  test("the owners are read for the one site, in its project, as OneUptime", async () => {
    const reads: { userQueries: Array<unknown>; teamQueries: Array<unknown> } =
      ownedBy({ users: [ALICE], teams: [] });

    await siteGoesUnhealthy(store());

    for (const read of [...reads.userQueries, ...reads.teamQueries]) {
      expect(read).toMatchObject({
        query: { networkSiteId: SITE_ID, projectId: PROJECT_ID },
        props: { isRoot: true },
      });
    }

    expect(reads.userQueries).toHaveLength(1);
    expect(reads.teamQueries).toHaveLength(1);
  });

  test("the alert's created notification waits for them, and is let go once they are in", async () => {
    ownedBy({ users: [ALICE], teams: [STORE_OPS] });

    await siteGoesUnhealthy(store());

    // Held while the alert was created: its owners were still to come...
    expect(heldWhileCreating).toEqual([true]);
    // ...and in once the site's alert is up.
    expect(
      CreatedNotificationHold.isAddingOwners(createdWith[0]! as never, [
        OwnersAddedBy.Caller,
      ]),
    ).toBe(false);
  });

  test("a site nobody owns adds nobody", async () => {
    ownedBy({ users: [], teams: [] });

    await siteGoesUnhealthy(store());

    expect(createdWith).toHaveLength(1);
    expect(addOwnersCalls).toEqual([]);
    expect(
      CreatedNotificationHold.isAddingOwners(createdWith[0]! as never, [
        OwnersAddedBy.Caller,
      ]),
    ).toBe(false);
  });

  test("adding them failing never loses the alert, nor keeps its notification waiting", async () => {
    jest
      .spyOn(NetworkSiteOwnerUserService, "getSiteOwners")
      .mockRejectedValue(new Error("connection reset") as never);

    await siteGoesUnhealthy(store());

    expect(addOwnersCalls).toEqual([]);
    expect(siteAlertWrites).toEqual([
      { id: SITE_ID, data: { currentActiveAlertId: ALERT_ID } },
    ]);
    expect(
      CreatedNotificationHold.isAddingOwners(createdWith[0]! as never, [
        OwnersAddedBy.Caller,
      ]),
    ).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });

  test("a site that does not alert raises nothing, so owns nothing", async () => {
    ownedBy({ users: [ALICE], teams: [] });

    const quiet: NetworkSite = store();
    quiet.shouldAlertWhenUnhealthy = false;

    await siteGoesUnhealthy(quiet);

    expect(createdWith).toEqual([]);
    expect(addOwnersCalls).toEqual([]);
  });
});
