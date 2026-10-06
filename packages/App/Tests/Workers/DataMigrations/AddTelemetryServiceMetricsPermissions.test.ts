import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import ApiKeyPermissionService from "Common/Server/Services/ApiKeyPermissionService";
import TeamPermissionService from "Common/Server/Services/TeamPermissionService";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import APIKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import Label from "Common/Models/DatabaseModels/Label";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import PermissionScope from "Common/Types/Database/AccessControl/PermissionScope";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import CreateBy from "Common/Server/Types/Database/CreateBy";
import FindBy from "Common/Server/Types/Database/FindBy";
import UpdateByID from "Common/Server/Types/Database/UpdateByID";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import AddTelemetryServiceMetricsPermissions, {
  METRIC_PERMISSION_COPY_INPUTS,
  MetricPermissionPlan,
  TelemetryGrant,
  getMetricReach,
  planMetricPermissionCopies,
} from "../../../FeatureSet/Workers/DataMigrations/AddTelemetryServiceMetricsPermissions";
import fs from "fs";
import path from "path";

/*
 * Metric data points moved from the trace permission to Read Telemetry
 * Service Metrics. This backfill keeps every team's and API key's metric
 * reads where they were: Read Traces is copied to Read Metrics with its
 * scope and labels, or an existing Read Metrics is set to them. Blocks and
 * writes are not copied; the writes are named in the log.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: { "error.class": "user-error" },
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
const OTHER_LABEL: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const METRICS_ROW: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

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

function metricsRow(
  granteeId: string,
  overrides: Partial<TelemetryGrant> = {},
): TelemetryGrant {
  return grant(granteeId, Permission.ReadTelemetryServiceMetrics, {
    rowId: METRICS_ROW,
    ...overrides,
  });
}

function summary(grants: Array<TelemetryGrant>): Array<string> {
  return grants
    .map((each: TelemetryGrant): string => {
      return `${each.granteeId === TEAM_A ? "A" : "B"} ${each.isBlockPermission ? "block" : "allow"} ${each.permission}`;
    })
    .sort();
}

const NOTHING: MetricPermissionPlan = {
  copies: [],
  updates: [],
  writesNotCopied: [],
};

describe("which grantees are given Read Telemetry Service Metrics", () => {
  test("Read Traces read metrics: Read Metrics, with its scope and labels", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL],
        }),
      ]),
    ).toEqual({
      ...NOTHING,
      copies: [
        {
          granteeId: TEAM_A,
          projectId: PROJECT,
          permission: Permission.ReadTelemetryServiceMetrics,
          isBlockPermission: false,
          scope: PermissionScope.Labels,
          labelIds: [LABEL],
        },
      ],
    });
  });

  test("Read Traces is copied on its own: the Read Log the columns asked for can sit on another of a member's teams", () => {
    expect(
      summary(
        planMetricPermissionCopies([
          grant(TEAM_A, Permission.ReadTelemetryServiceTraces),
          grant(TEAM_B, Permission.ReadTelemetryServiceLog),
        ]).copies,
      ),
    ).toEqual([`A allow ${Permission.ReadTelemetryServiceMetrics}`]);
  });

  test.each([
    [Permission.ReadTelemetryServiceLog],
    [Permission.EditTelemetryServiceTraces],
    [Permission.EditTelemetryServiceLog],
    [Permission.CreateTelemetryServiceLog],
    [Permission.DeleteTelemetryServiceLog],
  ])("%s read and wrote no metric: nothing", (permission: Permission) => {
    expect(planMetricPermissionCopies([grant(TEAM_A, permission)])).toEqual(
      NOTHING,
    );
  });

  test("a blocked Read Traces is not copied: blocking Read Metrics would refuse the metric catalogue it never refused", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
          isBlockPermission: true,
          labelIds: [LABEL],
        }),
        grant(TEAM_B, Permission.ReadTelemetryServiceTraces, {
          isBlockPermission: true,
        }),
      ]),
    ).toEqual(NOTHING);
  });

  test("a blocked Read Metrics does not count as holding it: the allow is still copied", () => {
    expect(
      summary(
        planMetricPermissionCopies([
          grant(TEAM_A, Permission.ReadTelemetryServiceTraces),
          grant(TEAM_A, Permission.ReadTelemetryServiceMetrics, {
            isBlockPermission: true,
          }),
        ]).copies,
      ),
    ).toEqual([`A allow ${Permission.ReadTelemetryServiceMetrics}`]);
  });

  test("a grantee whose Read Metrics reaches the same services is left alone", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL, OTHER_LABEL],
        }),
        metricsRow(TEAM_A, {
          scope: PermissionScope.Labels,
          labelIds: [OTHER_LABEL, LABEL],
        }),
      ]),
    ).toEqual(NOTHING);
  });

  test.each([
    [
      "every service, where the trace grant reached one label",
      { scope: PermissionScope.All },
    ],
    ["another scope", { scope: PermissionScope.Owned }],
    [
      "other labels",
      { scope: PermissionScope.Labels, labelIds: [OTHER_LABEL] },
    ],
  ])(
    "a Read Metrics already held reaching %s is set to the trace grant's scope and labels, which decided its metric reads",
    (_reach: string, held: Partial<TelemetryGrant>) => {
      const existing: TelemetryGrant = metricsRow(TEAM_A, held);

      expect(
        planMetricPermissionCopies([
          grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL],
          }),
          existing,
        ]),
      ).toEqual({
        ...NOTHING,
        updates: [
          {
            existing: existing,
            to: {
              granteeId: TEAM_A,
              projectId: PROJECT,
              permission: Permission.ReadTelemetryServiceMetrics,
              isBlockPermission: false,
              scope: PermissionScope.Labels,
              labelIds: [LABEL],
            },
          },
        ],
      });
    },
  );

  test("a Read Metrics held without Read Traces is the project's own grant: left as it is", () => {
    expect(
      planMetricPermissionCopies([
        metricsRow(TEAM_A, {
          scope: PermissionScope.Labels,
          labelIds: [LABEL],
        }),
      ]),
    ).toEqual(NOTHING);
  });

  test.each([
    [
      "All, whatever its labels, reaches what All reaches",
      { scope: PermissionScope.All, labelIds: [LABEL] },
      { scope: PermissionScope.All, labelIds: [] },
    ],
    [
      "Owned ignores labels",
      { scope: PermissionScope.Owned, labelIds: [LABEL] },
      { scope: PermissionScope.Owned, labelIds: [] },
    ],
    [
      "Labels with no labels reaches every service",
      { scope: PermissionScope.Labels, labelIds: [] },
      { scope: PermissionScope.All, labelIds: [] },
    ],
    [
      "an API key's grant has no scope: its labels decide",
      { scope: undefined, labelIds: [LABEL] },
      { scope: PermissionScope.Labels, labelIds: [LABEL] },
    ],
    [
      "an API key's grant with no labels reaches every service",
      { scope: undefined, labelIds: [] },
      { scope: PermissionScope.All, labelIds: [LABEL] },
    ],
  ])(
    "reach as the analytics read applies it: %s",
    (
      _rule: string,
      traces: Partial<TelemetryGrant>,
      metrics: Partial<TelemetryGrant>,
    ) => {
      const tracesGrant: TelemetryGrant = grant(
        TEAM_A,
        Permission.ReadTelemetryServiceTraces,
        traces,
      );
      const metricsGrant: TelemetryGrant = metricsRow(TEAM_A, metrics);

      expect(getMetricReach(tracesGrant)).toBe(getMetricReach(metricsGrant));
      expect(planMetricPermissionCopies([tracesGrant, metricsGrant])).toEqual(
        NOTHING,
      );
    },
  );

  test("Create and Delete Traces are not copied, a write is not widened, but each holder is named", () => {
    const create: TelemetryGrant = grant(
      TEAM_A,
      Permission.CreateTelemetryServiceTraces,
    );
    const remove: TelemetryGrant = grant(
      TEAM_B,
      Permission.DeleteTelemetryServiceTraces,
    );

    expect(
      planMetricPermissionCopies([
        create,
        grant(TEAM_A, Permission.CreateTelemetryServiceLog),
        remove,
      ]),
    ).toEqual({ ...NOTHING, writesNotCopied: [create, remove] });
  });

  test("a write holder that already holds the metric counterpart, or only a block of the trace write, is not named", () => {
    expect(
      planMetricPermissionCopies([
        grant(TEAM_A, Permission.CreateTelemetryServiceTraces),
        grant(TEAM_A, Permission.CreateTelemetryServiceMetrics),
        grant(TEAM_B, Permission.DeleteTelemetryServiceTraces, {
          isBlockPermission: true,
        }),
      ]),
    ).toEqual(NOTHING);
  });

  test("running it again on what it wrote changes nothing", () => {
    const grants: Array<TelemetryGrant> = [
      grant(TEAM_A, Permission.ReadTelemetryServiceTraces, {
        scope: PermissionScope.Owned,
      }),
      grant(TEAM_B, Permission.ReadTelemetryServiceTraces, {
        scope: PermissionScope.Labels,
        labelIds: [LABEL],
      }),
      metricsRow(TEAM_B, { scope: PermissionScope.All }),
    ];

    const plan: MetricPermissionPlan = planMetricPermissionCopies(grants);

    expect(summary(plan.copies)).toEqual([
      `A allow ${Permission.ReadTelemetryServiceMetrics}`,
    ]);
    expect(plan.updates).toHaveLength(1);

    const afterwards: Array<TelemetryGrant> = [
      grants[0]!,
      grants[1]!,
      { ...plan.updates[0]!.to, rowId: METRICS_ROW },
      ...plan.copies.map((copy: TelemetryGrant): TelemetryGrant => {
        return { ...copy, rowId: ObjectID.generate().toString() };
      }),
    ];

    expect(planMetricPermissionCopies(afterwards)).toEqual(NOTHING);
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
  row.id = ObjectID.generate();
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
  row.id = ObjectID.generate();
  row.apiKeyId = new ObjectID(apiKeyId);
  row.projectId = new ObjectID(PROJECT);
  row.permission = permission;
  row.isBlockPermission = false;
  row.labels = [];
  Object.assign(row, overrides);
  return row;
}

function labelIdsOfRow(labels: Array<Label> | undefined): Array<string> {
  return (labels || []).map((each: Label): string => {
    return each.id!.toString();
  });
}

describe("AddTelemetryServiceMetricsPermissions", () => {
  const migration: AddTelemetryServiceMetricsPermissions =
    new AddTelemetryServiceMetricsPermissions();

  let teamCreate: SpyInstance<typeof TeamPermissionService.create>;
  let keyCreate: SpyInstance<typeof ApiKeyPermissionService.create>;
  let teamUpdate: SpyInstance<typeof TeamPermissionService.updateOneById>;
  let keyUpdate: SpyInstance<typeof ApiKeyPermissionService.updateOneById>;

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
    teamUpdate = jest
      .spyOn(TeamPermissionService, "updateOneById")
      .mockResolvedValue(1);
    keyUpdate = jest
      .spyOn(ApiKeyPermissionService, "updateOneById")
      .mockResolvedValue(1);
  });

  test("carries its own name, the key the migration runner records as executed", () => {
    expect(migration.name).toBe(MIGRATION_NAME);
  });

  test("gives a team and an API key the metric read their trace read stood for, and nothing for blocks", async () => {
    const teamFind: SpyInstance<typeof TeamPermissionService.findBy> = jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue([
        teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces, {
          scope: PermissionScope.Labels,
          labels: [label(LABEL)],
        }),
        teamRow(TEAM_B, Permission.ReadTelemetryServiceTraces, {
          isBlockPermission: true,
        }),
      ]);
    const keyFind: SpyInstance<typeof ApiKeyPermissionService.findBy> = jest
      .spyOn(ApiKeyPermissionService, "findBy")
      .mockResolvedValue([
        keyRow(TEAM_B, Permission.ReadTelemetryServiceTraces, {
          labels: [label(LABEL)],
        }),
      ]);

    await migration.migrate();

    // Read as root, the inputs only, from the first page.
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
    expect(labelIdsOfRow(teamCopy.labels)).toEqual([LABEL]);

    expect(keyCreate).toHaveBeenCalledTimes(1);
    const keyCopy: APIKeyPermission = keyCreate.mock.calls[0]![0].data;
    expect(keyCopy.apiKeyId?.toString()).toBe(TEAM_B);
    expect(keyCopy.permission).toBe(Permission.ReadTelemetryServiceMetrics);
    expect(keyCopy.isBlockPermission).toBe(false);
    expect(labelIdsOfRow(keyCopy.labels)).toEqual([LABEL]);

    expect(teamUpdate).not.toHaveBeenCalled();
    expect(keyUpdate).not.toHaveBeenCalled();
  });

  test("asks for exactly the grants the plan reads, every page of them", async () => {
    const firstPage: Array<TeamPermission> = Array.from(
      { length: LIMIT_MAX },
      (): TeamPermission => {
        return teamRow(TEAM_B, Permission.ReadTelemetryServiceLog);
      },
    );
    const teamFind: SpyInstance<typeof TeamPermissionService.findBy> = jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce([
        teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces),
      ]);
    jest.spyOn(ApiKeyPermissionService, "findBy").mockResolvedValue([]);

    await migration.migrate();

    expect(teamFind).toHaveBeenCalledTimes(2);
    expect(teamFind.mock.calls[1]![0].skip).toBe(LIMIT_MAX);

    // QueryHelper.any builds an IN (...) whose one parameter is the list.
    const asked: Array<Permission> = Object.values(
      (
        teamFind.mock.calls[0]![0].query as unknown as {
          permission: {
            objectLiteralParameters: Record<string, Array<Permission>>;
          };
        }
      ).permission.objectLiteralParameters,
    )[0]!;
    expect([...asked].sort()).toEqual(
      [
        Permission.ReadTelemetryServiceTraces,
        Permission.ReadTelemetryServiceMetrics,
        Permission.CreateTelemetryServiceTraces,
        Permission.CreateTelemetryServiceMetrics,
        Permission.DeleteTelemetryServiceTraces,
        Permission.DeleteTelemetryServiceMetrics,
      ].sort(),
    );
    expect([...METRIC_PERMISSION_COPY_INPUTS].sort()).toEqual(
      [...asked].sort(),
    );

    // The second page's grant is not lost.
    expect(teamCreate).toHaveBeenCalledTimes(1);
    expect(teamCreate.mock.calls[0]![0].data.teamId?.toString()).toBe(TEAM_A);
  });

  test("a Read Metrics already held is set to the trace grant's scope and labels, and the change is logged", async () => {
    const existingTeamRow: TeamPermission = teamRow(
      TEAM_A,
      Permission.ReadTelemetryServiceMetrics,
      { scope: PermissionScope.All },
    );
    const existingKeyRow: APIKeyPermission = keyRow(
      TEAM_B,
      Permission.ReadTelemetryServiceMetrics,
      { labels: [label(OTHER_LABEL)] },
    );

    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([
      teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces, {
        scope: PermissionScope.Labels,
        labels: [label(LABEL)],
      }),
      existingTeamRow,
    ]);
    jest
      .spyOn(ApiKeyPermissionService, "findBy")
      .mockResolvedValue([
        keyRow(TEAM_B, Permission.ReadTelemetryServiceTraces),
        existingKeyRow,
      ]);

    await migration.migrate();

    expect(teamCreate).not.toHaveBeenCalled();
    expect(keyCreate).not.toHaveBeenCalled();

    expect(teamUpdate).toHaveBeenCalledTimes(1);
    const teamChange: UpdateByID<TeamPermission> = teamUpdate.mock
      .calls[0]![0] as UpdateByID<TeamPermission>;
    expect(teamChange.id.toString()).toBe(existingTeamRow.id!.toString());
    expect(teamChange.props.isRoot).toBe(true);
    expect(teamChange.data.scope).toBe(PermissionScope.Labels);
    expect(
      labelIdsOfRow(teamChange.data.labels as unknown as Array<Label>),
    ).toEqual([LABEL]);

    // An API key's grant has no scope: its labels are cleared to reach every service.
    expect(keyUpdate).toHaveBeenCalledTimes(1);
    const keyChange: UpdateByID<APIKeyPermission> = keyUpdate.mock
      .calls[0]![0] as UpdateByID<APIKeyPermission>;
    expect(keyChange.id.toString()).toBe(existingKeyRow.id!.toString());
    expect(
      labelIdsOfRow(keyChange.data.labels as unknown as Array<Label>),
    ).toEqual([]);

    // Printed where LOG_LEVEL=ERROR keeps it, as the project's own setting.
    expect(logger.error as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining(
        `team ${TEAM_A}'s ${Permission.ReadTelemetryServiceMetrics}`,
      ),
      EXTERNAL_FAULT,
    );
    expect(logger.error as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining(
        `API key ${TEAM_B}'s ${Permission.ReadTelemetryServiceMetrics}`,
      ),
      EXTERNAL_FAULT,
    );
    expect(logger.warn as unknown as jest.Mock).not.toHaveBeenCalled();
  });

  test("names every grantee whose metric writes are not copied", async () => {
    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue([
        teamRow(TEAM_A, Permission.CreateTelemetryServiceTraces),
      ]);
    jest
      .spyOn(ApiKeyPermissionService, "findBy")
      .mockResolvedValue([
        keyRow(TEAM_B, Permission.DeleteTelemetryServiceTraces),
      ]);

    await migration.migrate();

    expect(teamCreate).not.toHaveBeenCalled();
    expect(keyCreate).not.toHaveBeenCalled();
    expect(logger.error as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `team ${TEAM_A} holds ${Permission.CreateTelemetryServiceTraces}.*not given ${Permission.CreateTelemetryServiceMetrics}`,
        ),
      ),
      EXTERNAL_FAULT,
    );
    expect(logger.error as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `API key ${TEAM_B} holds ${Permission.DeleteTelemetryServiceTraces}.*not given ${Permission.DeleteTelemetryServiceMetrics}`,
        ),
      ),
      EXTERNAL_FAULT,
    );
  });

  test("a row the project's settings refuse is logged as a setting, the rest are still written", async () => {
    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue([
        teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces),
        teamRow(TEAM_B, Permission.ReadTelemetryServiceTraces),
      ]);
    jest.spyOn(ApiKeyPermissionService, "findBy").mockResolvedValue([]);

    teamCreate.mockImplementationOnce(async (): Promise<TeamPermission> => {
      throw new BadDataException(
        "Permissions for this team is not updateable.",
      );
    });

    await expect(migration.migrate()).resolves.toBeUndefined();

    expect(teamCreate).toHaveBeenCalledTimes(2);
    expect(logger.error as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not add ${Permission.ReadTelemetryServiceMetrics} to team ${TEAM_A}`,
      ),
      EXTERNAL_FAULT,
    );
  });

  test("any other failure stays a fault", async () => {
    jest
      .spyOn(TeamPermissionService, "findBy")
      .mockResolvedValue([
        teamRow(TEAM_A, Permission.ReadTelemetryServiceTraces),
      ]);
    jest.spyOn(ApiKeyPermissionService, "findBy").mockResolvedValue([]);

    teamCreate.mockImplementationOnce(async (): Promise<TeamPermission> => {
      throw new Error("connection reset");
    });

    await migration.migrate();

    expect(logger.error as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not add ${Permission.ReadTelemetryServiceMetrics} to team ${TEAM_A} (connection reset)`,
      ),
      undefined,
    );
  });

  test("a project with none of these grants is left as it is", async () => {
    jest.spyOn(TeamPermissionService, "findBy").mockResolvedValue([]);
    jest.spyOn(ApiKeyPermissionService, "findBy").mockResolvedValue([]);

    await migration.migrate();

    expect(teamCreate).not.toHaveBeenCalled();
    expect(keyCreate).not.toHaveBeenCalled();
    expect(teamUpdate).not.toHaveBeenCalled();
    expect(keyUpdate).not.toHaveBeenCalled();
    expect(logger.error as unknown as jest.Mock).not.toHaveBeenCalled();
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
