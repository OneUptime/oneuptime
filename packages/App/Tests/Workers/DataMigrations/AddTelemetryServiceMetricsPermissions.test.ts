import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import logger from "Common/Server/Utils/Logger";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import Label from "Common/Models/DatabaseModels/Label";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import FindBy from "Common/Server/Types/Database/FindBy";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import AddTelemetryServiceMetricsPermissions, {
  TelemetryGrant,
  planMetricPermissionCopies,
} from "../../../FeatureSet/Workers/DataMigrations/AddTelemetryServiceMetricsPermissions";
import fs from "fs";
import path from "path";

/*
 * Metric data points moved from the trace and log permissions to the
 * Telemetry Service Metrics ones. This backfill gives each team and API key
 * the metric permission that does what its trace and log grants did for
 * metrics - copied, never renamed, and no more: a grantee that could not
 * read a metric before gets no metric read now.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "AddTelemetryServiceMetricsPermissions";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const TEAM_A: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TEAM_B: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LABEL: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function grant(
  granteeId: string,
  permission: Permission,
  overrides: Partial<TelemetryGrant> = {},
): TelemetryGrant {
  return {
    granteeId: granteeId,
    projectId: PROJECT,
    permission: permission,
    isBlockPermission: false,
    scope: PermissionScope.All,
    labelIds: [],
    ...overrides,
  };
}

function summary(copies: Array<TelemetryGrant>): Array<string> {
  return copies
    .map((copy: TelemetryGrant): string => {
      return `${copy.granteeId === TEAM_A ? "A" : "B"} ${copy.isBlockPermission ? "block" : "allow"} ${copy.permission}`;
    })
    .sort();
}

describe("which metric permissions a grantee is given", () => {
  test("Read Traces with Read Log reads metrics: Read Metrics, with the Read Traces row's scope and labels", () => {
    const copies: Array<TelemetryGrant> = planMetricPermissionCopies([
      grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL],
      }),
      grant(TEAM_A, Permission.ReadTelemetryServiceLog, {
        scope: PermissionScope.Owned,
      }),
    ]);

    expect(copies).toEqual([
      {
        granteeId: TEAM_A,
        projectId: PROJECT,
        permission: Permission.ReadTelemetryServiceMetrics,
        isBlockPermission: false,
        scope: PermissionScope.Labels,
        labelIds: [LABEL],
      },
    ]);
  });

  test.each([
    [[Permission.ReadTelemetryServiceTraces]],
    [[Permission.ReadTelemetryServiceLog]],
    [[Permission.EditTelemetryServiceTraces]],
    [[Permission.CreateTelemetryServiceTraces]],
    [[Permission.CreateTelemetryServiceLog]],
  ])(
    "a grantee holding only %j read or created no metric, and gets no metric permission",
    (permissions: Array<Permission>) => {
      expect(
        planMetricPermissionCopies(
          permissions.map((permission: Permission): TelemetryGrant => {
            return grant(TEAM_A, permission);
          }),
        ),
      ).toEqual([]);
    },
  );

  test("the two grants must belong to the same grantee", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.ReadTelemetryServiceTraces),
        grant(TEAM_B, Permission.ReadTelemetryServiceLog),
      ]),
    ).toEqual([]);
  });

  test("a blocked Read Log does not count as holding it", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.ReadTelemetryServiceTraces),
        grant(TEAM_A, Permission.ReadTelemetryServiceLog, {
          isBlockPermission: true,
        }),
      ]),
    ).toEqual([]);
  });

  test("Create Traces with Create Log creates metrics: Create Metrics", () => {
    expect(
      summary(
        planMetricPermissionCopies([
          grant(TEAM_A, Permission.CreateTelemetryServiceTraces),
          grant(TEAM_A, Permission.CreateTelemetryServiceLog),
        ]),
      ),
    ).toEqual([`A allow ${Permission.CreateTelemetryServiceMetrics}`]);
  });

  test("Delete Traces deleted metrics: Delete Metrics", () => {
    expect(
      summary(
        planMetricPermissionCopies([
          grant(TEAM_A, Permission.DeleteTelemetryServiceTraces, {
            labelIds: [LABEL],
          }),
        ]),
      ),
    ).toEqual([`A allow ${Permission.DeleteTelemetryServiceMetrics}`]);
  });

  test("a blocked Read Traces stays a denial: Read Metrics is blocked, with its labels", () => {
    const copies: Array<TelemetryGrant> = planMetricPermissionCopies([
      grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
        isBlockPermission: true,
        labelIds: [LABEL],
      }),
    ]);

    expect(copies).toEqual([
      {
        granteeId: TEAM_A,
        projectId: PROJECT,
        permission: Permission.ReadTelemetryServiceMetrics,
        isBlockPermission: true,
        scope: PermissionScope.All,
        labelIds: [LABEL],
      },
    ]);
  });

  test("a grantee that already holds the metric permission is left alone", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.ReadTelemetryServiceTraces),
        grant(TEAM_A, Permission.ReadTelemetryServiceLog),
        grant(TEAM_A, Permission.ReadTelemetryServiceMetrics, {
          scope: PermissionScope.Owned,
        }),
        grant(TEAM_A, Permission.DeleteTelemetryServiceTraces),
        grant(TEAM_A, Permission.DeleteTelemetryServiceMetrics),
      ]),
    ).toEqual([]);
  });

  test("an allowed metric read does not stop a blocked one being copied, and the other way round", () => {
    expect(
      summary(
        planMetricPermissionCopies([
          grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
            isBlockPermission: true,
          }),
          grant(TEAM_A, Permission.ReadTelemetryServiceMetrics),
          grant(TEAM_B, Permission.ReadTelemetryServiceTraces),
          grant(TEAM_B, Permission.ReadTelemetryServiceLog),
          grant(TEAM_B, Permission.ReadTelemetryServiceMetrics, {
            isBlockPermission: true,
          }),
        ]),
      ),
    ).toEqual([
      `A block ${Permission.ReadTelemetryServiceMetrics}`,
      `B allow ${Permission.ReadTelemetryServiceMetrics}`,
    ]);
  });

  test("running it again on what it made adds nothing", () => {
    const grants: Array<TelemetryGrant> = [
      grant(TEAM_A, Permission.ReadTelemetryServiceTraces),
      grant(TEAM_A, Permission.ReadTelemetryServiceLog),
      grant(TEAM_A, Permission.CreateTelemetryServiceTraces),
      grant(TEAM_A, Permission.CreateTelemetryServiceLog),
      grant(TEAM_A, Permission.DeleteTelemetryServiceTraces),
      grant(TEAM_B, Permission.ReadTelemetryServiceTraces, {
        isBlockPermission: true,
      }),
    ];

    const copies: Array<TelemetryGrant> = planMetricPermissionCopies(grants);

    expect(summary(copies)).toEqual([
      `A allow ${Permission.CreateTelemetryServiceMetrics}`,
      `A allow ${Permission.DeleteTelemetryServiceMetrics}`,
      `A allow ${Permission.ReadTelemetryServiceMetrics}`,
      `B block ${Permission.ReadTelemetryServiceMetrics}`,
    ]);
    expect(planMetricPermissionCopies([...grants, ...copies])).toEqual([]);
  });
});

function label(id: string): Label {
  const result: Label = new Label();
  result.id = new ObjectID(id);
  return result;
}

function teamRow(
  teamId: string,
  permission: Permission,
  overrides: Partial<TeamPermission> = {},
): TeamPermission {
  const row: TeamPermission = new TeamPermission();
  row.teamId = new ObjectID(teamId);
  row.projectId = new ObjectID(PROJECT);
  row.permission = permission;
  row.isBlockPermission = false;
  row.scope = PermissionScope.All;
  row.labels = [];
  Object.assign(row, overrides);
  return row;
}

function keyRow(
  apiKeyId: string,
  permission: Permission,
  overrides: Partial<APIKeyPermission> = {},
): APIKeyPermission {
  const row: APIKeyPermission = new APIKeyPermission();
  row.apiKeyId = new ObjectID(apiKeyId);
  row.projectId = new ObjectID(PROJECT);
  row.permission = permission;
  row.isBlockPermission = false;
  row.labels = [];
  Object.assign(row, overrides);
  return row;
}

describe("AddTelemetryServiceMetricsPermissions", () => {
  const migration: AddTelemetryServiceMetricsPermissions =
    new AddTelemetryServiceMetricsPermissions();

  let teamCreate: SpyInstance<typeof TeamPermissionService.create>;
  let keyCreate: SpyInstance<typeof ApiKeyPermissionService.create>;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    teamCreate = jest
      .spyOn(TeamPermissionService, "create")
      .mockImplementation(
        async (createBy: CreateBy<TeamPermission>): Promise<TeamPermission> => {
          return createBy.data;
        },
      );
    keyCreate = jest
      .spyOn(ApiKeyPermissionService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<APIKeyPermission>,
        ): Promise<APIKeyPermission> => {
          return createBy.data;
        },
      );
  });

  test("carries its own name, the key the migration runner records as executed", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("gives a team and an API key the metric permissions their grants stood for", async () => {
    const teamFind: SpyInstance<typeof TeamPermissionService.findBy> = jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue([
        teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces, {
          scope: PermissionScope.Labels,
          labels: [label(LABEL)],
        }),
        teamRow(TEAM_A, Permission.ReadTelemetryServiceLog),
        teamRow(TEAM_B, Permission.ReadTelemetryServiceTraces),
      ]);
    const keyFind: SpyInstance<typeof ApiKeyPermissionService.findBy> = jest
      .spyOn(ApiKeyPermissionService, "findBy")
      .mockResolvedValue([
        keyRow(TEAM_B, Permission.DeleteTelemetryServiceTraces, {
          labels: [label(LABEL)],
        }),
      ]);

    await migration.migrate();

    // Read as root, every page, before anything is written.
    const teamQuery: FindBy<TeamPermission> = teamFind.mock.calls[0]![0];
    expect(teamQuery.props.isRoot).toBe(true);
    expect(teamQuery.skip).toBe(0);
    expect(keyFind.mock.calls[0]![0].props.isRoot).toBe(true);

    expect(teamCreate).toHaveBeenCalledTimes(1);
    const teamCopy: TeamPermission = teamCreate.mock.calls[0]![0].data;
    expect(teamCreate.mock.calls[0]![0].props.isRoot).toBe(true);
    expect(teamCopy.teamId?.toString()).toBe(TEAM_A);
    expect(teamCopy.projectId?.toString()).toBe(PROJECT);
    expect(teamCopy.permission).toBe(Permission.ReadTelemetryServiceMetrics);
    expect(teamCopy.isBlockPermission).toBe(false);
    expect(teamCopy.scope).toBe(PermissionScope.Labels);
    expect(
      (teamCopy.labels || []).map((each: Label): string => {
        return each.id!.toString();
      }),
    ).toEqual([LABEL]);

    expect(keyCreate).toHaveBeenCalledTimes(1);
    const keyCopy: APIKeyPermission = keyCreate.mock.calls[0]![0].data;
    expect(keyCopy.apiKeyId?.toString()).toBe(TEAM_B);
    expect(keyCopy.permission).toBe(Permission.DeleteTelemetryServiceMetrics);
    expect(
      (keyCopy.labels || []).map((each: Label): string => {
        return each.id!.toString();
      }),
    ).toEqual([LABEL]);
  });

  test("a row that cannot be added is logged and the rest are still added", async () => {
    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue([
        teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces),
        teamRow(TEAM_A, Permission.ReadTelemetryServiceLog),
        teamRow(TEAM_B, Permission.DeleteTelemetryServiceTraces),
      ]);
    jest.spyOn(ApiKeyPermissionService, "findBy").mockResolvedValue([]);

    teamCreate.mockImplementationOnce(async (): Promise<TeamPermission> => {
      throw new Error("Permissions of this team cannot be edited.");
    });

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(teamCreate).toHaveBeenCalledTimes(2);
    expect(logger.error as unknown as jest.Mock).toHaveBeenCalled();
  });

  test("a project with none of these grants is left as it is", async () => {
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([]);
    jest.spyOn(ApiKeyPermissionService, "findBy").mockResolvedValue([]);

    await migration.migrate();

    expect(teamCreate).not.toHaveBeenCalled();
    expect(keyCreate).not.toHaveBeenCalled();
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
  });
});
