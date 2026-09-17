import AlertEpisodeOwnerTeamService from "../../../Server/Services/AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "../../../Server/Services/AlertEpisodeOwnerUserService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeOwnerTeamService from "../../../Server/Services/IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "../../../Server/Services/IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentOwnerTeamService from "../../../Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService from "../../../Server/Services/IncidentOwnerUserService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentTemplateOwnerTeamService from "../../../Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "../../../Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService from "../../../Server/Services/IncidentTemplateService";
import MonitorOwnerTeamService from "../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceOwnerTeamService from "../../../Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "../../../Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceTemplateOwnerTeamService from "../../../Server/Services/ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "../../../Server/Services/ScheduledMaintenanceTemplateOwnerUserService";
import ScheduledMaintenanceTemplateService from "../../../Server/Services/ScheduledMaintenanceTemplateService";
import StatusPageOwnerTeamService from "../../../Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "../../../Server/Services/StatusPageOwnerUserService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import PostgresErrorTranslator from "../../../Server/Utils/Database/PostgresErrorTranslator";
import OwnerRuleAssignment from "../../../Server/Utils/Rules/OwnerRuleAssignment";
import IncidentOwnerTeam from "../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../Models/DatabaseModels/IncidentOwnerUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Issue #3394, the internal callers.
 *
 * The issue names IncidentService.addOwners - the method MonitorIncident calls
 * when a monitor criteria raises an incident with owner teams - as one of the
 * paths that inserted owner rows without looking for an existing one. Every
 * <Resource>Service.addOwners had the same loop.
 *
 * With owner rows now unique, that loop would also have become fragile: the
 * first owner already on the record would throw and silently cost the record
 * every owner after it. Each addOwners therefore goes through
 * OwnerRuleAssignment.addOwners, which skips owners already there and keeps
 * going past one that a concurrent writer added.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0000000a-0000-4000-8000-000000000001",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "0000000c-0000-4000-8000-000000000001",
);
const TEAM_A: ObjectID = new ObjectID("0000000b-0000-4000-8000-000000000001");
const TEAM_B: ObjectID = new ObjectID("0000000b-0000-4000-8000-000000000002");
const USER_A: ObjectID = new ObjectID("0000000e-0000-4000-8000-000000000001");
const USER_B: ObjectID = new ObjectID("0000000e-0000-4000-8000-000000000002");
const ACTING_USER: ObjectID = new ObjectID(
  "0000000e-0000-4000-8000-000000000099",
);

const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: ACTING_USER,
};

// Services differ per case; only their identity is compared here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyService = any;

interface PositionalCase {
  name: string;
  addOwners: (notifyOwners: boolean) => Promise<void>;
  ownerUserService: AnyService;
  ownerTeamService: AnyService;
  resourceIdColumn: string;
}

function positional(
  name: string,
  service: {
    addOwners: (
      projectId: ObjectID,
      resourceId: ObjectID,
      userIds: Array<ObjectID>,
      teamIds: Array<ObjectID>,
      notifyOwners: boolean,
      props: DatabaseCommonInteractionProps,
    ) => Promise<void>;
  },
  ownerUserService: AnyService,
  ownerTeamService: AnyService,
  resourceIdColumn: string,
): PositionalCase {
  return {
    name,
    addOwners: (notifyOwners: boolean): Promise<void> => {
      return service.addOwners(
        PROJECT_ID,
        RESOURCE_ID,
        [USER_A],
        [TEAM_A],
        notifyOwners,
        PROPS,
      );
    },
    ownerUserService,
    ownerTeamService,
    resourceIdColumn,
  };
}

const POSITIONAL_CASES: Array<PositionalCase> = [
  positional(
    "IncidentService",
    IncidentService,
    IncidentOwnerUserService,
    IncidentOwnerTeamService,
    "incidentId",
  ),
  positional(
    "AlertService",
    AlertService,
    AlertOwnerUserService,
    AlertOwnerTeamService,
    "alertId",
  ),
  positional(
    "MonitorService",
    MonitorService,
    MonitorOwnerUserService,
    MonitorOwnerTeamService,
    "monitorId",
  ),
  positional(
    "ScheduledMaintenanceService",
    ScheduledMaintenanceService,
    ScheduledMaintenanceOwnerUserService,
    ScheduledMaintenanceOwnerTeamService,
    "scheduledMaintenanceId",
  ),
  positional(
    "StatusPageService",
    StatusPageService,
    StatusPageOwnerUserService,
    StatusPageOwnerTeamService,
    "statusPageId",
  ),
  positional(
    "IncidentTemplateService",
    IncidentTemplateService,
    IncidentTemplateOwnerUserService,
    IncidentTemplateOwnerTeamService,
    "incidentTemplateId",
  ),
  positional(
    "AlertEpisodeService",
    AlertEpisodeService,
    AlertEpisodeOwnerUserService,
    AlertEpisodeOwnerTeamService,
    "alertEpisodeId",
  ),
];

let delegate: jest.SpyInstance;

function delegatedArgs(): Record<string, unknown> {
  expect(delegate).toHaveBeenCalledTimes(1);
  return delegate.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  delegate = jest
    .spyOn(OwnerRuleAssignment, "addOwners")
    .mockResolvedValue({ userIds: [], teamIds: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(
  POSITIONAL_CASES.map((c: PositionalCase): [string, PositionalCase] => {
    return [c.name, c];
  }),
)("%s.addOwners", (_name: string, c: PositionalCase) => {
  test("adds owners through the duplicate-safe helper, on its own owner tables", async () => {
    await c.addOwners(true);

    const args: Record<string, unknown> = delegatedArgs();

    expect(args["ownerUserService"]).toBe(c.ownerUserService);
    expect(args["ownerTeamService"]).toBe(c.ownerTeamService);
    expect(args["resourceIdColumn"]).toBe(c.resourceIdColumn);
    expect(args["resourceId"]).toBe(RESOURCE_ID);
    expect(args["projectId"]).toBe(PROJECT_ID);
    expect(args["userIds"]).toEqual([USER_A]);
    expect(args["teamIds"]).toEqual([TEAM_A]);
    expect(args["props"]).toBe(PROPS);
  });

  test("the resource column really is a column of both owner tables", () => {
    /*
     * A misspelt column would be dropped silently by setColumnValue, and the
     * row would fail as missing its resource id only at insert time.
     */
    expect(c.ownerUserService.getModel().hasColumn(c.resourceIdColumn)).toBe(
      true,
    );
    expect(c.ownerTeamService.getModel().hasColumn(c.resourceIdColumn)).toBe(
      true,
    );
  });

  test.each([
    [true, false],
    [false, true],
  ])(
    "notifyOwners = %p writes isOwnerNotified = %p",
    async (notifyOwners: boolean, isOwnerNotified: boolean) => {
      await c.addOwners(notifyOwners);

      expect(delegatedArgs()["isOwnerNotified"]).toBe(isOwnerNotified);
    },
  );
});

describe("ScheduledMaintenanceTemplateService.addOwners", () => {
  test("adds owners through the helper and leaves the notify flag alone", async () => {
    await ScheduledMaintenanceTemplateService.addOwners(
      PROJECT_ID,
      RESOURCE_ID,
      [USER_A],
      [TEAM_A],
      PROPS,
    );

    const args: Record<string, unknown> = delegatedArgs();

    expect(args["ownerUserService"]).toBe(
      ScheduledMaintenanceTemplateOwnerUserService,
    );
    expect(args["ownerTeamService"]).toBe(
      ScheduledMaintenanceTemplateOwnerTeamService,
    );
    expect(args["resourceIdColumn"]).toBe("scheduledMaintenanceTemplateId");
    expect(args["resourceId"]).toBe(RESOURCE_ID);
    expect(args["projectId"]).toBe(PROJECT_ID);
    expect(args["props"]).toBe(PROPS);
    // These template tables have no isOwnerNotified column.
    expect(args["isOwnerNotified"]).toBeUndefined();
    expect(
      ScheduledMaintenanceTemplateOwnerTeamService.getModel().hasColumn(
        "isOwnerNotified",
      ),
    ).toBe(false);
  });
});

describe("IncidentEpisodeService.addOwners", () => {
  test("adds owners through the helper as root, crediting the acting user", async () => {
    await IncidentEpisodeService.addOwners({
      episodeId: RESOURCE_ID,
      projectId: PROJECT_ID,
      userIds: [USER_A],
      teamIds: [TEAM_A],
      createdByUserId: ACTING_USER,
    });

    const args: Record<string, unknown> = delegatedArgs();

    expect(args["ownerUserService"]).toBe(IncidentEpisodeOwnerUserService);
    expect(args["ownerTeamService"]).toBe(IncidentEpisodeOwnerTeamService);
    expect(args["resourceIdColumn"]).toBe("incidentEpisodeId");
    expect(args["resourceId"]).toBe(RESOURCE_ID);
    expect(args["projectId"]).toBe(PROJECT_ID);
    expect(args["createdByUserId"]).toBe(ACTING_USER);
    expect(args["props"]).toEqual({ isRoot: true });
    /*
     * Left to the column default (false), which is what the episode
     * owner-added job picks up - the same as before.
     */
    expect(args["isOwnerNotified"]).toBeUndefined();
  });

  test("treats missing owner lists as empty", async () => {
    await IncidentEpisodeService.addOwners({
      episodeId: RESOURCE_ID,
      projectId: PROJECT_ID,
    });

    const args: Record<string, unknown> = delegatedArgs();

    expect(args["userIds"]).toEqual([]);
    expect(args["teamIds"]).toEqual([]);
  });
});

describe("IncidentService.addOwners end to end (the monitor criteria path)", () => {
  interface OwnerTables {
    teamCreates: Array<IncidentOwnerTeam>;
    userCreates: Array<IncidentOwnerUser>;
  }

  function ownerRow(column: string, id: ObjectID): unknown {
    return {
      getColumnValue: (key: string): unknown => {
        return key === column ? id : undefined;
      },
    };
  }

  function stubOwnerTables(data: {
    existingTeamIds?: Array<ObjectID>;
    existingUserIds?: Array<ObjectID>;
    racedTeamIds?: Array<ObjectID>;
  }): OwnerTables {
    const tables: OwnerTables = { teamCreates: [], userCreates: [] };

    jest.spyOn(IncidentOwnerTeamService, "findBy").mockResolvedValue(
      (data.existingTeamIds || []).map((id: ObjectID) => {
        return ownerRow("teamId", id);
      }) as never,
    );
    jest.spyOn(IncidentOwnerUserService, "findBy").mockResolvedValue(
      (data.existingUserIds || []).map((id: ObjectID) => {
        return ownerRow("userId", id);
      }) as never,
    );

    jest
      .spyOn(IncidentOwnerTeamService, "create")
      .mockImplementation((async (args: { data: IncidentOwnerTeam }) => {
        const raced: boolean = (data.racedTeamIds || []).some(
          (id: ObjectID) => {
            return id.toString() === args.data.teamId!.toString();
          },
        );

        if (raced) {
          throw PostgresErrorTranslator.translate({
            code: "23505",
            table: "IncidentOwnerTeam",
            detail:
              'Key ("incidentId", "teamId", "projectId")=(c, b, a) already exists.',
          });
        }

        tables.teamCreates.push(args.data);
        return args.data;
      }) as never);

    jest
      .spyOn(IncidentOwnerUserService, "create")
      .mockImplementation((async (args: { data: IncidentOwnerUser }) => {
        tables.userCreates.push(args.data);
        return args.data;
      }) as never);

    return tables;
  }

  beforeEach(() => {
    // These cases exercise the real helper.
    delegate.mockRestore();
  });

  test("a team that already owns the incident is not added again", async () => {
    const tables: OwnerTables = stubOwnerTables({
      existingTeamIds: [TEAM_A],
    });

    await IncidentService.addOwners(
      PROJECT_ID,
      RESOURCE_ID,
      [],
      [TEAM_A, TEAM_B],
      true,
      { isRoot: true },
    );

    expect(
      tables.teamCreates.map((row: IncidentOwnerTeam) => {
        return row.teamId!.toString();
      }),
    ).toEqual([TEAM_B.toString()]);
  });

  test("a criteria that lists a team twice adds it once", async () => {
    const tables: OwnerTables = stubOwnerTables({});

    await IncidentService.addOwners(
      PROJECT_ID,
      RESOURCE_ID,
      [USER_A, USER_A],
      [TEAM_A, TEAM_A],
      true,
      { isRoot: true },
    );

    expect(tables.teamCreates).toHaveLength(1);
    expect(tables.userCreates).toHaveLength(1);
  });

  test("owner ids that arrive as strings (miscDataProps) still work", async () => {
    const tables: OwnerTables = stubOwnerTables({});

    await IncidentService.addOwners(
      PROJECT_ID,
      RESOURCE_ID,
      [USER_A.toString() as unknown as ObjectID],
      [TEAM_A.toString() as unknown as ObjectID],
      true,
      { isRoot: true },
    );

    expect(tables.teamCreates[0]!.teamId).toBeInstanceOf(ObjectID);
    expect(tables.teamCreates[0]!.teamId!.toString()).toBe(TEAM_A.toString());
    expect(tables.userCreates[0]!.userId).toBeInstanceOf(ObjectID);
  });

  test("a team added concurrently does not stop the other owners being added", async () => {
    const tables: OwnerTables = stubOwnerTables({ racedTeamIds: [TEAM_A] });

    await expect(
      IncidentService.addOwners(
        PROJECT_ID,
        RESOURCE_ID,
        [USER_A, USER_B],
        [TEAM_A, TEAM_B],
        true,
        { isRoot: true },
      ),
    ).resolves.toBeUndefined();

    expect(
      tables.teamCreates.map((row: IncidentOwnerTeam) => {
        return row.teamId!.toString();
      }),
    ).toEqual([TEAM_B.toString()]);
    expect(tables.userCreates).toHaveLength(2);
  });

  test("writes rows on the incident, in the project, with the notify flag", async () => {
    const tables: OwnerTables = stubOwnerTables({});

    await IncidentService.addOwners(
      PROJECT_ID,
      RESOURCE_ID,
      [USER_A],
      [TEAM_A],
      false,
      { isRoot: true },
    );

    const team: IncidentOwnerTeam = tables.teamCreates[0]!;
    expect(team).toBeInstanceOf(IncidentOwnerTeam);
    expect(team.incidentId!.toString()).toBe(RESOURCE_ID.toString());
    expect(team.projectId!.toString()).toBe(PROJECT_ID.toString());
    // notifyOwners = false means the owner-added job must skip this row.
    expect(team.isOwnerNotified).toBe(true);

    const user: IncidentOwnerUser = tables.userCreates[0]!;
    expect(user).toBeInstanceOf(IncidentOwnerUser);
    expect(user.incidentId!.toString()).toBe(RESOURCE_ID.toString());
    expect(user.isOwnerNotified).toBe(true);
  });
});
