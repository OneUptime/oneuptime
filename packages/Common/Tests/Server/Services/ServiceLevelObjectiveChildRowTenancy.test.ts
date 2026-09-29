/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveOwnerTeamService from "../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import SloLegacyMonitorLabelAdoption from "../../../Server/Utils/Slo/SloLegacyMonitorLabelAdoption";
import SloOwnerReferenceValidator from "../../../Server/Utils/Slo/SloOwnerReferenceValidator";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * The rows that hang off an SLO - owner users, owner teams, burn rate rules
 * and monitor rules - carry the SLO's id, and owner rows also carry a user or
 * a team. DatabaseService stamps each row's projectId from the caller and
 * checks none of those ids against it, so a caller holding another tenant's
 * SLO, team or user id could write a row in their own project pointing at it.
 * For owners that is the worst of it: findOwners reads owners by SLO id
 * alone, and the owner-added job emails every owner the SLO's name.
 *
 * These tests drive the REAL create hooks and the REAL validators against
 * small fake tables (SLOs, teams, team memberships), each holding one row in
 * this project and one in another. They pin:
 *
 * - every child row refuses another project's SLO, in the id column AND in
 *   the relation spelling, and a legitimate row still saves;
 * - owner users must be members of the project, owner teams must be the
 *   project's own teams;
 * - no lookup ever reads outside the row's project, and no error names,
 *   emails or even distinguishes a foreign SLO, team or user from an id
 *   that matches nothing;
 * - the monitor rule no longer goes through ProjectScopedReferenceValidator,
 *   whose unpinned read named a foreign SLO in its error.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8aaa-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8aaa-000000000002",
);

const SLO_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000a1";
const FOREIGN_SLO_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000b1";
// Exists nowhere.
const MISSING_SLO_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000c1";
const FOREIGN_SLO_NAME: string = "Other tenant payments availability";

const TEAM_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000d1";
const FOREIGN_TEAM_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000e1";
const FOREIGN_TEAM_NAME: string = "Other tenant SRE";

const MEMBER_USER_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000f1";
const FOREIGN_USER_ID: string = "0193c0de-aaaa-4aaa-8aaa-0000000000f2";
const FOREIGN_USER_EMAIL: string = "stranger@other-tenant.test";

const SLO_REJECTION: string =
  "references Service Level Objectives that do not exist in this project";

interface FakeRow {
  id: string;
  projectId: ObjectID;
  name: string;
}

const SLO_TABLE: Array<FakeRow> = [
  { id: SLO_ID, projectId: PROJECT_ID, name: "Checkout availability" },
  { id: FOREIGN_SLO_ID, projectId: OTHER_PROJECT_ID, name: FOREIGN_SLO_NAME },
];

const TEAM_TABLE: Array<FakeRow> = [
  { id: TEAM_ID, projectId: PROJECT_ID, name: "Platform on-call" },
  { id: FOREIGN_TEAM_ID, projectId: OTHER_PROJECT_ID, name: FOREIGN_TEAM_NAME },
];

// userId -> the project the membership is in.
const MEMBERSHIP_TABLE: Array<{ userId: string; projectId: ObjectID }> = [
  { userId: MEMBER_USER_ID, projectId: PROJECT_ID },
  { userId: FOREIGN_USER_ID, projectId: OTHER_PROJECT_ID },
];

interface LookupArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  props: Record<string, unknown>;
}

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

/*
 * The ids a query names: a bare id, or the ids bound into QueryHelper.any's
 * Raw operator (typeorm keeps the bound parameters on the FindOperator).
 */
function idsOf(value: unknown): Array<string> {
  if (typeof value === "string" || value instanceof ObjectID) {
    return [value.toString().toLowerCase()];
  }

  const parameters: Record<string, unknown> | undefined = (
    value as { objectLiteralParameters?: Record<string, unknown> } | undefined
  )?.objectLiteralParameters;

  const ids: Array<string> = [];

  for (const bound of Object.values(parameters || {})) {
    for (const id of bound as Array<unknown>) {
      ids.push(String(id).toLowerCase());
    }
  }

  return ids;
}

function pinnedProjectOf(query: Record<string, unknown>): string {
  return (query["projectId"] as ObjectID | undefined)?.toString() || "";
}

// A fake table read: an unpinned query sees every project's rows.
function matchingRows(rows: Array<FakeRow>, args: LookupArgs): Array<FakeRow> {
  const pinned: string = pinnedProjectOf(args.query);
  const ids: Array<string> = idsOf(args.query["_id"]);

  return rows.filter((row: FakeRow): boolean => {
    return (
      (!pinned || row.projectId.toString() === pinned) &&
      ids.includes(row.id.toLowerCase())
    );
  });
}

let sloLookups: Array<LookupArgs> = [];
let teamLookups: Array<LookupArgs> = [];
let membershipLookups: Array<LookupArgs> = [];
let unpinnedSloServiceRead: jest.SpyInstance;
let sharedReferenceValidator: jest.SpyInstance;

function installFakeTables(): void {
  sloLookups = [];
  teamLookups = [];
  membershipLookups = [];

  jest
    .spyOn(SloRecordReferenceValidator.getLookupService(), "findBy")
    .mockImplementation((async (
      args: LookupArgs,
    ): Promise<Array<ServiceLevelObjective>> => {
      sloLookups.push(args);

      return matchingRows(SLO_TABLE, args).map(
        (row: FakeRow): ServiceLevelObjective => {
          const slo: ServiceLevelObjective = new ServiceLevelObjective();
          slo._id = row.id;
          return slo;
        },
      );
    }) as never);

  /*
   * The read ProjectScopedReferenceValidator made through the SLO service:
   * as root, by id only, returning the tenant and the name - which its error
   * then printed. Faked faithfully so the pre-fix monitor rule is caught
   * naming the foreign SLO rather than failing on a missing database.
   */
  unpinnedSloServiceRead = jest
    .spyOn(ServiceLevelObjectiveService, "findBy")
    .mockImplementation((async (
      args: LookupArgs,
    ): Promise<Array<ServiceLevelObjective>> => {
      return matchingRows(SLO_TABLE, args).map(
        (row: FakeRow): ServiceLevelObjective => {
          const slo: ServiceLevelObjective = new ServiceLevelObjective();
          slo._id = row.id;
          slo.projectId = row.projectId;
          slo.name = row.name;
          return slo;
        },
      );
    }) as never);

  sharedReferenceValidator = jest.spyOn(
    ProjectScopedReferenceValidator,
    "validateReferencesBelongToProject",
  );

  /*
   * A monitor rule create that passed every check adopts the SLO's legacy
   * monitor labels next, which reads the database. Not under test here.
   */
  jest
    .spyOn(SloLegacyMonitorLabelAdoption, "adoptLegacyMonitorLabels")
    .mockResolvedValue([]);

  jest.spyOn(TeamService, "findBy").mockImplementation((async (
    args: LookupArgs,
  ): Promise<Array<Team>> => {
    teamLookups.push(args);

    return matchingRows(TEAM_TABLE, args).map((row: FakeRow): Team => {
      const team: Team = new Team();
      team._id = row.id;
      return team;
    });
  }) as never);

  jest.spyOn(TeamMemberService, "findBy").mockImplementation((async (
    args: LookupArgs,
  ): Promise<Array<TeamMember>> => {
    membershipLookups.push(args);

    const pinned: string = pinnedProjectOf(args.query);
    const userIds: Array<string> = idsOf(args.query["userId"]);

    return MEMBERSHIP_TABLE.filter(
      (row: { userId: string; projectId: ObjectID }): boolean => {
        return (
          (!pinned || row.projectId.toString() === pinned) &&
          userIds.includes(row.userId.toLowerCase())
        );
      },
    ).map((row: { userId: string; projectId: ObjectID }): TeamMember => {
      const member: TeamMember = new TeamMember();
      member.userId = new ObjectID(row.userId);
      member.projectId = row.projectId;
      return member;
    });
  }) as never);
}

// Every lookup was pinned to this project and read nothing but ids.
function expectEveryLookupPinnedToProject(): void {
  for (const lookup of [...sloLookups, ...teamLookups, ...membershipLookups]) {
    expect(pinnedProjectOf(lookup.query)).toBe(PROJECT_ID.toString());
    expect(lookup.props).toEqual({ isRoot: true });
  }

  for (const lookup of [...sloLookups, ...teamLookups]) {
    expect(lookup.select).toEqual({ _id: true });
  }

  for (const lookup of membershipLookups) {
    expect(lookup.select).toEqual({ userId: true });
  }
}

async function rejectionMessageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("Expected the create hook to refuse the row.");
}

// The refusal never gives away anything about the foreign records.
function expectNothingForeignNamed(message: string): void {
  expect(message).not.toContain(FOREIGN_SLO_NAME);
  expect(message).not.toContain(FOREIGN_TEAM_NAME);
  expect(message).not.toContain(FOREIGN_USER_EMAIL);
  expect(message).not.toContain("different project");
  expect(message).not.toContain(OTHER_PROJECT_ID.toString());
}

interface ChildRowCase {
  name: string;
  service: unknown;
  subject: string;
  // A create payload that is valid in every way except the SLO under test.
  buildData: (slo: {
    serviceLevelObjectiveId?: string | undefined;
    serviceLevelObjective?: { _id: string } | undefined;
  }) => Record<string, unknown>;
}

const CHILD_ROW_CASES: Array<ChildRowCase> = [
  {
    name: "ServiceLevelObjectiveOwnerUserService",
    service: ServiceLevelObjectiveOwnerUserService,
    subject: "SLO owner user",
    buildData: (slo: Record<string, unknown>): Record<string, unknown> => {
      return {
        projectId: PROJECT_ID,
        userId: new ObjectID(MEMBER_USER_ID),
        ...slo,
      };
    },
  },
  {
    name: "ServiceLevelObjectiveOwnerTeamService",
    service: ServiceLevelObjectiveOwnerTeamService,
    subject: "SLO owner team",
    buildData: (slo: Record<string, unknown>): Record<string, unknown> => {
      return {
        projectId: PROJECT_ID,
        teamId: new ObjectID(TEAM_ID),
        ...slo,
      };
    },
  },
  {
    name: "ServiceLevelObjectiveBurnRateRuleService",
    service: ServiceLevelObjectiveBurnRateRuleService,
    subject: "SLO burn rate rule",
    buildData: (slo: Record<string, unknown>): Record<string, unknown> => {
      return {
        projectId: PROJECT_ID,
        name: "Fast burn",
        burnRateThreshold: 14.4,
        longWindowInMinutes: 60,
        shortWindowInMinutes: 5,
        ...slo,
      };
    },
  },
  {
    name: "ServiceLevelObjectiveMonitorRuleService",
    service: ServiceLevelObjectiveMonitorRuleService,
    subject: "SLO monitor rule",
    buildData: (slo: Record<string, unknown>): Record<string, unknown> => {
      return {
        projectId: PROJECT_ID,
        name: "Production APIs",
        monitorNamePattern: ".*",
        ...slo,
      };
    },
  },
];

beforeEach(() => {
  installFakeTables();
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * forEach rather than a for...of loop: the describe callbacks read the
 * module-level lookup logs above, which are reassigned per test, and
 * no-loop-func flags a closure over them declared inside a loop.
 */
CHILD_ROW_CASES.forEach((childRowCase: ChildRowCase) => {
  describe(`${childRowCase.name}.onBeforeCreate - the parent SLO`, () => {
    test("refuses another project's SLO without naming or confirming it", async () => {
      const message: string = await rejectionMessageOf(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({
            serviceLevelObjectiveId: FOREIGN_SLO_ID,
          }),
          props: { tenantId: PROJECT_ID },
        }),
      );

      expect(message).toBe(
        `This ${childRowCase.subject} ${SLO_REJECTION}: "${FOREIGN_SLO_ID}". Please pick SLOs from this project and try again.`,
      );
      expectNothingForeignNamed(message);

      // One pinned read of ids, and never the unpinned SLO-service read.
      expect(sloLookups).toHaveLength(1);
      expectEveryLookupPinnedToProject();
      expect(unpinnedSloServiceRead).not.toHaveBeenCalled();
    });

    test("answers a foreign SLO exactly like an id that matches nothing", async () => {
      const foreign: string = await rejectionMessageOf(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({
            serviceLevelObjectiveId: FOREIGN_SLO_ID,
          }),
          props: { tenantId: PROJECT_ID },
        }),
      );

      const missing: string = await rejectionMessageOf(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({
            serviceLevelObjectiveId: MISSING_SLO_ID,
          }),
          props: { tenantId: PROJECT_ID },
        }),
      );

      expect(foreign.replace(FOREIGN_SLO_ID, "<id>")).toBe(
        missing.replace(MISSING_SLO_ID, "<id>"),
      );
    });

    test("refuses another project's SLO sent in the relation spelling", async () => {
      await expect(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({
            serviceLevelObjective: { _id: FOREIGN_SLO_ID },
          }),
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(SLO_REJECTION);
    });

    test("refuses a foreign relation even when the id column names this project's SLO", async () => {
      const message: string = await rejectionMessageOf(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({
            serviceLevelObjectiveId: SLO_ID,
            serviceLevelObjective: { _id: FOREIGN_SLO_ID },
          }),
          props: { tenantId: PROJECT_ID },
        }),
      );

      // Only the id that failed is echoed back.
      expect(message).toContain(`"${FOREIGN_SLO_ID}"`);
      expect(message).not.toContain(`"${SLO_ID}"`);
    });

    test("pins the check to the caller's tenant, not the payload's project", async () => {
      await expect(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: {
            ...childRowCase.buildData({
              serviceLevelObjectiveId: FOREIGN_SLO_ID,
            }),
            projectId: OTHER_PROJECT_ID,
          },
          props: { tenantId: PROJECT_ID },
        }),
      ).rejects.toThrow(SLO_REJECTION);

      expect(pinnedProjectOf(sloLookups[0]!.query)).toBe(PROJECT_ID.toString());
    });

    test("accepts this project's SLO", async () => {
      await expect(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({ serviceLevelObjectiveId: SLO_ID }),
          props: { tenantId: PROJECT_ID },
        }),
      ).resolves.toBeDefined();

      expect(sloLookups).toHaveLength(1);
      expectEveryLookupPinnedToProject();
    });

    test("checks a root write with no tenant against the row's own project", async () => {
      // The SLO create seeds its default burn rate rules exactly like this.
      await expect(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({ serviceLevelObjectiveId: SLO_ID }),
          props: { isRoot: true },
        }),
      ).resolves.toBeDefined();

      await expect(
        callHook(childRowCase.service, "onBeforeCreate", {
          data: childRowCase.buildData({
            serviceLevelObjectiveId: FOREIGN_SLO_ID,
          }),
          props: { isRoot: true },
        }),
      ).rejects.toThrow(SLO_REJECTION);

      expectEveryLookupPinnedToProject();
    });
  });
});

describe("ServiceLevelObjectiveOwnerUserService.onBeforeCreate - the user", () => {
  test("refuses a user who is not a member of the project, without naming them", async () => {
    const message: string = await rejectionMessageOf(
      callHook(ServiceLevelObjectiveOwnerUserService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          userId: new ObjectID(FOREIGN_USER_ID),
        },
        props: { tenantId: PROJECT_ID },
      }),
    );

    expect(message).toBe(
      `This SLO owner user names a user who is not a member of this project: "${FOREIGN_USER_ID}". Please pick a user from this project and try again.`,
    );
    expectNothingForeignNamed(message);

    // Their membership in the other project was never even read.
    expect(membershipLookups).toHaveLength(1);
    expectEveryLookupPinnedToProject();
  });

  test("refuses a stranger sent in the user relation spelling", async () => {
    await expect(
      callHook(ServiceLevelObjectiveOwnerUserService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          userId: new ObjectID(MEMBER_USER_ID),
          user: { _id: FOREIGN_USER_ID },
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(`"${FOREIGN_USER_ID}"`);
  });

  test("checks the SLO before the user, so a foreign SLO costs no membership read", async () => {
    await expect(
      callHook(ServiceLevelObjectiveOwnerUserService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: FOREIGN_SLO_ID,
          userId: new ObjectID(FOREIGN_USER_ID),
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(SLO_REJECTION);

    expect(membershipLookups).toHaveLength(0);
  });

  test("accepts a member of the project as owner, unchanged", async () => {
    const data: Record<string, unknown> = {
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      userId: new ObjectID(MEMBER_USER_ID),
    };

    const result: { createBy: { data: unknown } } = (await callHook(
      ServiceLevelObjectiveOwnerUserService,
      "onBeforeCreate",
      { data: data, props: { tenantId: PROJECT_ID } },
    )) as { createBy: { data: unknown } };

    expect(result.createBy.data).toBe(data);
    expect(data["userId"]).toEqual(new ObjectID(MEMBER_USER_ID));
    expect(membershipLookups).toHaveLength(1);
    expect(idsOf(membershipLookups[0]!.query["userId"])).toEqual([
      MEMBER_USER_ID,
    ]);
    expectEveryLookupPinnedToProject();
  });
});

describe("ServiceLevelObjectiveOwnerTeamService.onBeforeCreate - the team", () => {
  test("refuses another project's team without naming it", async () => {
    const message: string = await rejectionMessageOf(
      callHook(ServiceLevelObjectiveOwnerTeamService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          teamId: new ObjectID(FOREIGN_TEAM_ID),
        },
        props: { tenantId: PROJECT_ID },
      }),
    );

    expect(message).toBe(
      `This SLO owner team references a team that does not exist in this project: "${FOREIGN_TEAM_ID}". Please pick a team from this project and try again.`,
    );
    expectNothingForeignNamed(message);
    expect(teamLookups).toHaveLength(1);
    expectEveryLookupPinnedToProject();
  });

  test("refuses another project's team sent in the relation spelling", async () => {
    await expect(
      callHook(ServiceLevelObjectiveOwnerTeamService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          team: { _id: FOREIGN_TEAM_ID },
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(`"${FOREIGN_TEAM_ID}"`);
  });

  test("accepts this project's team", async () => {
    await expect(
      callHook(ServiceLevelObjectiveOwnerTeamService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          teamId: new ObjectID(TEAM_ID),
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();

    expect(teamLookups).toHaveLength(1);
    expectEveryLookupPinnedToProject();
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onBeforeCreate - SLO before routing", () => {
  test("refuses a foreign SLO before any severity, routing or membership lookup", async () => {
    await expect(
      callHook(ServiceLevelObjectiveBurnRateRuleService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: FOREIGN_SLO_ID,
          name: "Fast burn",
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          alertSeverityId: new ObjectID(TEAM_ID),
          alertOwnerUsers: [{ _id: MEMBER_USER_ID }],
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(SLO_REJECTION);

    expect(sharedReferenceValidator).not.toHaveBeenCalled();
    expect(membershipLookups).toHaveLength(0);
  });

  /*
   * One tenant-first project for every check, not just the SLO's: a payload
   * projectId naming another project must not choose the project a severity
   * or an owner is checked against. Here the payload names the other project
   * while the caller's tenant holds the SLO, the severity and the owner, so
   * the create is valid only when every check is pinned to the tenant.
   */
  test("checks severities and owners against the caller's tenant, not the payload's project", async () => {
    sharedReferenceValidator.mockResolvedValue(undefined);

    await expect(
      callHook(ServiceLevelObjectiveBurnRateRuleService, "onBeforeCreate", {
        data: {
          projectId: OTHER_PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          name: "Fast burn",
          burnRateThreshold: 14.4,
          longWindowInMinutes: 60,
          shortWindowInMinutes: 5,
          alertSeverityId: new ObjectID(TEAM_ID),
          alertOwnerUsers: [{ _id: MEMBER_USER_ID }],
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).resolves.toBeDefined();

    const severityChecks: Array<[{ projectId: ObjectID }]> =
      sharedReferenceValidator.mock.calls as Array<[{ projectId: ObjectID }]>;

    expect(severityChecks.length).toBeGreaterThan(0);

    for (const [severityCheck] of severityChecks) {
      expect(severityCheck.projectId.toString()).toBe(PROJECT_ID.toString());
    }

    expect(sloLookups).toHaveLength(1);
    expect(membershipLookups).toHaveLength(1);
    expectEveryLookupPinnedToProject();
  });
});

describe("ServiceLevelObjectiveMonitorRuleService.onBeforeCreate - no shared validator", () => {
  test("does not go through ProjectScopedReferenceValidator, whose error named a foreign SLO", async () => {
    await expect(
      callHook(ServiceLevelObjectiveMonitorRuleService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: FOREIGN_SLO_ID,
          name: "Production APIs",
          monitorNamePattern: ".*",
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow(SLO_REJECTION);

    expect(sharedReferenceValidator).not.toHaveBeenCalled();
    expect(unpinnedSloServiceRead).not.toHaveBeenCalled();
  });

  test("still asks for an SLO id before any lookup", async () => {
    await expect(
      callHook(ServiceLevelObjectiveMonitorRuleService, "onBeforeCreate", {
        data: {
          projectId: PROJECT_ID,
          name: "Production APIs",
          monitorNamePattern: ".*",
        },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow("Service Level Objective ID is required");

    expect(sloLookups).toHaveLength(0);
  });
});

describe("SloOwnerReferenceValidator", () => {
  test("names every non-member in one message, deduplicated case-insensitively", async () => {
    const otherStranger: string = "0193c0de-aaaa-4aaa-8aaa-0000000000f3";

    const message: string = await rejectionMessageOf(
      SloOwnerReferenceValidator.validateUsersAreProjectMembers({
        projectId: PROJECT_ID,
        users: [
          FOREIGN_USER_ID,
          FOREIGN_USER_ID.toUpperCase(),
          { _id: otherStranger },
          new ObjectID(MEMBER_USER_ID),
        ],
        subject: "SLO owner user",
      }),
    );

    expect(message).toBe(
      `This SLO owner user names users who are not members of this project: "${FOREIGN_USER_ID}", "${otherStranger}". Please pick users from this project and try again.`,
    );
  });

  test("matches a member whose id was sent upper-cased", async () => {
    await expect(
      SloOwnerReferenceValidator.validateUsersAreProjectMembers({
        projectId: PROJECT_ID,
        users: [MEMBER_USER_ID.toUpperCase()],
        subject: "SLO owner user",
      }),
    ).resolves.toBeUndefined();
  });

  test("refuses a malformed id without querying", async () => {
    await expect(
      SloOwnerReferenceValidator.validateUsersAreProjectMembers({
        projectId: PROJECT_ID,
        users: ["not-a-uuid"],
        subject: "SLO owner user",
      }),
    ).rejects.toThrow('"not-a-uuid"');

    await expect(
      SloOwnerReferenceValidator.validateTeamsBelongToProject({
        projectId: PROJECT_ID,
        teams: ["not-a-uuid"],
        subject: "SLO owner team",
      }),
    ).rejects.toThrow('"not-a-uuid"');

    expect(membershipLookups).toHaveLength(0);
    expect(teamLookups).toHaveLength(0);
  });

  test("names several unknown teams in one plural message", async () => {
    await expect(
      SloOwnerReferenceValidator.validateTeamsBelongToProject({
        projectId: PROJECT_ID,
        teams: [FOREIGN_TEAM_ID, MISSING_SLO_ID, TEAM_ID],
        subject: "SLO owner team",
      }),
    ).rejects.toThrow(
      `This SLO owner team references teams that do not exist in this project: "${FOREIGN_TEAM_ID}", "${MISSING_SLO_ID}". Please pick teams from this project and try again.`,
    );
  });

  test("is a no-op with nothing to check or no project to check against", async () => {
    await expect(
      SloOwnerReferenceValidator.validateUsersAreProjectMembers({
        projectId: PROJECT_ID,
        users: [undefined, null],
        subject: "SLO owner user",
      }),
    ).resolves.toBeUndefined();

    await expect(
      SloOwnerReferenceValidator.validateTeamsBelongToProject({
        projectId: undefined,
        teams: [FOREIGN_TEAM_ID],
        subject: "SLO owner team",
      }),
    ).resolves.toBeUndefined();

    expect(membershipLookups).toHaveLength(0);
    expect(teamLookups).toHaveLength(0);
  });
});

/*
 * The hooks above check create only. That is enough because none of these
 * references can be changed afterwards: their column ACL grants update to
 * nobody, so ColumnPermissions refuses any non-root update that carries them.
 * If one ever becomes updatable, this fails and the update hook needs the
 * same check.
 */
describe("SLO child-row references are create-only", () => {
  const cases: Array<{
    name: string;
    build: () => DatabaseBaseModel;
    columns: Array<string>;
  }> = [
    {
      name: "ServiceLevelObjectiveOwnerUser",
      build: (): DatabaseBaseModel => {
        return new ServiceLevelObjectiveOwnerUser();
      },
      columns: [
        "serviceLevelObjectiveId",
        "serviceLevelObjective",
        "userId",
        "user",
      ],
    },
    {
      name: "ServiceLevelObjectiveOwnerTeam",
      build: (): DatabaseBaseModel => {
        return new ServiceLevelObjectiveOwnerTeam();
      },
      columns: [
        "serviceLevelObjectiveId",
        "serviceLevelObjective",
        "teamId",
        "team",
      ],
    },
    {
      name: "ServiceLevelObjectiveBurnRateRule",
      build: (): DatabaseBaseModel => {
        return new ServiceLevelObjectiveBurnRateRule();
      },
      columns: ["serviceLevelObjectiveId", "serviceLevelObjective"],
    },
    {
      name: "ServiceLevelObjectiveMonitorRule",
      build: (): DatabaseBaseModel => {
        return new ServiceLevelObjectiveMonitorRule();
      },
      columns: ["serviceLevelObjectiveId", "serviceLevelObjective"],
    },
  ];

  for (const modelCase of cases) {
    test(`${modelCase.name} grants update on none of its references`, () => {
      const accessControl: Record<
        string,
        { update?: Array<unknown> | undefined } | undefined
      > = modelCase
        .build()
        .getColumnAccessControlForAllColumns() as unknown as Record<
        string,
        { update?: Array<unknown> | undefined } | undefined
      >;

      for (const column of modelCase.columns) {
        expect({
          column,
          defined: accessControl[column] !== undefined,
        }).toEqual({ column, defined: true });
        expect({ column, update: accessControl[column]?.update }).toEqual({
          column,
          update: [],
        });
      }
    });
  }
});
