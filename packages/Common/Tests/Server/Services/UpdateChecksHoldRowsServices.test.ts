import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DataSourceService from "../../../Server/Services/DataSourceService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import DomainService from "../../../Server/Services/DomainService";
import IncidentRoleService from "../../../Server/Services/IncidentRoleService";
import IncomingCallPolicyEscalationRuleService from "../../../Server/Services/IncomingCallPolicyEscalationRuleService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import TeamService from "../../../Server/Services/TeamService";
import TelemetryIngestionKeyService from "../../../Server/Services/TelemetryIngestionKeyService";
import ThreatIntelFeedService from "../../../Server/Services/ThreatIntelFeedService";
import WorkflowVariableService from "../../../Server/Services/WorkflowVariableService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import GitHubInstallationBinding from "../../../Server/Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataSourceType from "../../../Types/DataSource/DataSourceType";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * EACH CHECK OF AN UPDATE'S ROWS JUDGES THE ROWS THE UPDATE WRITES, AND THE
 * UPDATE WRITES NO OTHER.
 *
 * For each service whose update hook refuses an update by what its rows
 * hold, a bulk update is checked the way the update path runs it:
 *
 *   - OneUptime's update, in a window beyond the first read's (skip 10000):
 *     the hook reads the rows in that window - not the first rows the query
 *     matches - refuses when one of them is refused, and holds the update to
 *     the rows it read;
 *   - a teammate whose permissions reach only some of the rows (a team
 *     limited to some labels, say): a row outside their reach is neither
 *     judged nor written, while one inside it is judged as any other.
 *
 * The rows the teammate may write are the update path's own read
 * (keepRowsCallerMayWrite), answered here by stubRowsCallerMayWrite.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000002",
);
const ROW_A: string = "6b000000-0000-4000-8000-00000000000a";
const ROW_B: string = "6b000000-0000-4000-8000-00000000000b";
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000001",
);
const REFUSED_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000002",
);
const OTHER_STATUS_PAGE_ID: ObjectID = new ObjectID(
  "6c000000-0000-4000-8000-000000000003",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "6d000000-0000-4000-8000-000000000001",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "6e000000-0000-4000-8000-000000000001",
);

const TEAMMATE: JSONObject = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("6f000000-0000-4000-8000-000000000001"),
};

interface ServiceCase {
  name: string;
  service: DatabaseService<DatabaseBaseModel>;
  // The update that makes the hook check its rows.
  data: () => JSONObject;
  // What a row holds when the check lets the update through, and when not.
  accepted: JSONObject | ((id: string) => JSONObject);
  refused: JSONObject;
  // The hook checks only a teammate's update (OneUptime's is never refused).
  teammateOnly?: boolean;
  // What the check calls besides the service's own reads.
  stub?: () => void;
}

function asService<TModel extends DatabaseBaseModel>(
  service: DatabaseService<TModel>,
): DatabaseService<DatabaseBaseModel> {
  return service as unknown as DatabaseService<DatabaseBaseModel>;
}

const CASES: Array<ServiceCase> = [
  {
    name: "IncidentRoleService: a primary role cannot allow multiple users",
    service: asService(IncidentRoleService),
    data: (): JSONObject => {
      return { canAssignMultipleUsers: true };
    },
    accepted: { isPrimaryRole: false },
    refused: { isPrimaryRole: true },
  },
  {
    name: "TeamService: a team that is not editable is not updated",
    service: asService(TeamService),
    data: (): JSONObject => {
      return { description: "Renamed" };
    },
    accepted: { name: "Engineering", isTeamEditable: true },
    refused: { name: "Owners", isTeamEditable: false },
  },
  {
    name: "ThreatIntelFeedService: an API token is not set beside a basic-auth password",
    service: asService(ThreatIntelFeedService),
    data: (): JSONObject => {
      return { apiToken: "token" };
    },
    accepted: { apiToken: "old-token" },
    refused: { basicAuthPassword: "secret" },
  },
  {
    name: "DataSourceService: every data source keeps the address its type needs",
    service: asService(DataSourceService),
    data: (): JSONObject => {
      return { url: "" };
    },
    accepted: {
      dataSourceType: DataSourceType.PostgreSQL,
      databaseHost: "db.internal",
    },
    refused: { dataSourceType: DataSourceType.Prometheus },
  },
  {
    name: "IncomingCallPolicyEscalationRuleService: every rule keeps a user or a schedule",
    service: asService(IncomingCallPolicyEscalationRuleService),
    data: (): JSONObject => {
      return { userId: null };
    },
    accepted: { onCallDutyPolicyScheduleId: SCHEDULE_ID },
    refused: {},
  },
  {
    name: "TelemetryIngestionKeyService: a browser key keeps an allowed origin",
    service: asService(TelemetryIngestionKeyService),
    data: (): JSONObject => {
      return { allowedOrigins: [] };
    },
    accepted: { keyType: TelemetryIngestionKeyType.Server },
    refused: { keyType: TelemetryIngestionKeyType.Browser },
  },
  {
    name: "WorkflowVariableService: a secret variable is not un-marked",
    service: asService(WorkflowVariableService),
    data: (): JSONObject => {
      return { isSecret: false };
    },
    accepted: { name: "Region", isSecret: false },
    refused: { name: "Token", isSecret: true },
  },
  {
    name: "DomainService: every domain verified has its verification text",
    service: asService(DomainService),
    data: (): JSONObject => {
      return { isVerified: true };
    },
    accepted: { domain: "ok.test", domainVerificationText: "oneuptime-ok" },
    refused: { domain: "missing.test" },
    teammateOnly: true,
  },
  {
    name: "CodeRepositoryService: every repository is bound to the installation's project",
    service: asService(CodeRepositoryService),
    data: (): JSONObject => {
      return { gitHubAppInstallationId: "12345" };
    },
    accepted: { projectId: PROJECT_ID },
    refused: { projectId: OTHER_PROJECT_ID },
    stub: (): void => {
      jest
        .spyOn(GitHubInstallationBinding, "assertInstallationBoundToProject")
        .mockImplementation((async (data: {
          projectId: ObjectID;
        }): Promise<void> => {
          if (data.projectId.toString() === OTHER_PROJECT_ID.toString()) {
            throw new BadDataException("Installation not bound.");
          }
        }) as never);
    },
  },
  {
    name: "StatusPageResourceService: no page lists the monitor twice",
    service: asService(StatusPageResourceService),
    data: (): JSONObject => {
      return { monitorId: MONITOR_ID };
    },
    // Each on a page of its own: one page never lists the monitor twice.
    accepted: (id: string): JSONObject => {
      return {
        statusPageId: id === ROW_A ? STATUS_PAGE_ID : OTHER_STATUS_PAGE_ID,
      };
    },
    refused: { statusPageId: REFUSED_STATUS_PAGE_ID },
    stub: (): void => {
      jest
        .spyOn(
          StatusPageResourceService as unknown as {
            isResourceAlreadyOnStatusPage: () => Promise<boolean>;
          },
          "isResourceAlreadyOnStatusPage",
        )
        .mockImplementation((async (data: {
          statusPageId: ObjectID;
        }): Promise<boolean> => {
          return (
            data.statusPageId.toString() === REFUSED_STATUS_PAGE_ID.toString()
          );
        }) as never);
    },
  },
  {
    name: "StatusPageGroupService: every group moved under a parent may sit under it",
    service: asService(StatusPageGroupService),
    data: (): JSONObject => {
      return {
        parentStatusPageGroupId: new ObjectID(
          "6c000000-0000-4000-8000-0000000000ff",
        ),
      };
    },
    accepted: { statusPageId: STATUS_PAGE_ID },
    refused: { statusPageId: REFUSED_STATUS_PAGE_ID },
    stub: (): void => {
      jest
        .spyOn(
          StatusPageGroupService as unknown as {
            assertParentIsValid: () => Promise<void>;
          },
          "assertParentIsValid",
        )
        .mockImplementation((async (data: {
          statusPageId: ObjectID;
        }): Promise<void> => {
          if (
            data.statusPageId.toString() === REFUSED_STATUS_PAGE_ID.toString()
          ) {
            throw new BadDataException("Not a valid parent group.");
          }
        }) as never);
    },
  },
];

// The ids an `_id` condition names: a plain id, or "any of" several.
function idsNamedBy(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (value instanceof ObjectID) {
    return [value.toString()];
  }

  if (!value) {
    return [];
  }

  return Object.values(
    (value as { objectLiteralParameters: JSONObject }).objectLiteralParameters,
  ).flat() as Array<string>;
}

function rowOf(
  service: DatabaseService<DatabaseBaseModel>,
  id: string,
  fields: JSONObject | ((id: string) => JSONObject),
): DatabaseBaseModel {
  const row: DatabaseBaseModel = new service.modelType();

  Object.assign(row, {
    projectId: PROJECT_ID,
    ...(typeof fields === "function" ? fields(id) : fields),
  });
  row._id = id;

  return row;
}

interface Read {
  query: JSONObject;
  skip: number;
  limit: number;
}

/*
 * The service's own reads: a read by `_id` answers the rows of the pool it
 * names, and any other read - the update's own query, as OneUptime's hook
 * reads it - the whole pool.
 */
function stubReads(
  service: DatabaseService<DatabaseBaseModel>,
  pool: Array<DatabaseBaseModel>,
): jest.SpyInstance {
  return jest.spyOn(service, "findBy").mockImplementation((async (
    findBy: Read,
  ): Promise<Array<DatabaseBaseModel>> => {
    const named: unknown = findBy.query?.["_id"];

    if (named === undefined) {
      return pool;
    }

    const ids: Array<string> = idsNamedBy(named);

    return pool.filter((row: DatabaseBaseModel): boolean => {
      return ids.includes(String(row._id));
    });
  }) as never);
}

function updateOf(
  data: JSONObject,
  props: JSONObject,
  window: { skip: number; limit: number },
): UpdateBy<DatabaseBaseModel> {
  return {
    query: { projectId: PROJECT_ID },
    data: data,
    props: props as unknown as DatabaseCommonInteractionProps,
    skip: window.skip,
    limit: window.limit,
  } as unknown as UpdateBy<DatabaseBaseModel>;
}

async function runHook(
  service: DatabaseService<DatabaseBaseModel>,
  updateBy: UpdateBy<DatabaseBaseModel>,
): Promise<void> {
  await (
    service as unknown as {
      onBeforeUpdate: (updateBy: UpdateBy<DatabaseBaseModel>) => Promise<void>;
    }
  ).onBeforeUpdate(updateBy);
}

describe.each(CASES)("$name", (serviceCase: ServiceCase) => {
  beforeEach(() => {
    // No reference an update here names is another project's.
    jest
      .spyOn(ProjectScopedReferenceValidator, "getUnavailableReferences")
      .mockResolvedValue([] as never);

    if (serviceCase.stub) {
      serviceCase.stub();
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const service: DatabaseService<DatabaseBaseModel> = serviceCase.service;

  if (!serviceCase.teammateOnly) {
    it("reads OneUptime's update in its own window, beyond the first read's, and holds the update to the rows it read", async () => {
      const findBy: jest.SpyInstance = stubReads(service, [
        rowOf(service, ROW_A, serviceCase.accepted),
        rowOf(service, ROW_B, serviceCase.accepted),
      ]);

      const updateBy: UpdateBy<DatabaseBaseModel> = updateOf(
        serviceCase.data(),
        { isRoot: true, tenantId: PROJECT_ID },
        { skip: 10000, limit: 50 },
      );

      await runHook(service, updateBy);

      const windowReads: Array<Read> = (findBy.mock.calls as Array<[Read]>)
        .filter((call: [Read]): boolean => {
          return call[0].skip === 10000;
        })
        .map((call: [Read]): Read => {
          return call[0];
        });

      expect(windowReads.length).toBeGreaterThan(0);
      expect(windowReads[0]!.limit).toBe(50);

      expect(idsNamedBy((updateBy.query as JSONObject)["_id"]).sort()).toEqual(
        [ROW_A, ROW_B].sort(),
      );
      expect(updateBy.skip).toBe(0);
      expect(updateBy.limit).toBe(2);
    });

    it("refuses OneUptime's update when a row it writes is refused", async () => {
      stubReads(service, [
        rowOf(service, ROW_A, serviceCase.accepted),
        rowOf(service, ROW_B, serviceCase.refused),
      ]);

      await expect(
        runHook(
          service,
          updateOf(
            serviceCase.data(),
            { isRoot: true, tenantId: PROJECT_ID },
            { skip: 10000, limit: 50 },
          ),
        ),
      ).rejects.toThrow();
    });
  }

  it("neither judges nor writes a row outside a teammate's reach", async () => {
    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, serviceCase.accepted);
    const rowOutOfReach: DatabaseBaseModel = rowOf(
      service,
      ROW_B,
      serviceCase.refused,
    );

    // The teammate may write A only; B matches the query but is not theirs.
    stubRowsCallerMayWrite(service, () => {
      return [rowA];
    });
    stubReads(service, [rowA, rowOutOfReach]);

    const updateBy: UpdateBy<DatabaseBaseModel> = updateOf(
      serviceCase.data(),
      TEAMMATE,
      { skip: 0, limit: 100 },
    );

    await runHook(service, updateBy);

    expect(idsNamedBy((updateBy.query as JSONObject)["_id"])).toEqual([ROW_A]);
    expect(updateBy.limit).toBe(1);
  });

  it("refuses a teammate's update when a row they may write is refused", async () => {
    const rowA: DatabaseBaseModel = rowOf(service, ROW_A, serviceCase.accepted);
    const rowB: DatabaseBaseModel = rowOf(service, ROW_B, serviceCase.refused);

    stubRowsCallerMayWrite(service, () => {
      return [rowA, rowB];
    });
    stubReads(service, [rowA, rowB]);

    await expect(
      runHook(
        service,
        updateOf(serviceCase.data(), TEAMMATE, { skip: 0, limit: 100 }),
      ),
    ).rejects.toThrow();
  });
});

describe("StatusPageResourceService: one update points one page at a monitor once", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("refuses an update that would point two resources of one page at the same monitor", async () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(
      StatusPageResourceService,
    );

    jest
      .spyOn(ProjectScopedReferenceValidator, "getUnavailableReferences")
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        StatusPageResourceService as unknown as {
          isResourceAlreadyOnStatusPage: () => Promise<boolean>;
        },
        "isResourceAlreadyOnStatusPage",
      )
      .mockResolvedValue(false as never);

    stubReads(service, [
      rowOf(service, ROW_A, { statusPageId: STATUS_PAGE_ID }),
      rowOf(service, ROW_B, { statusPageId: STATUS_PAGE_ID }),
    ]);

    await expect(
      runHook(
        service,
        updateOf(
          { monitorId: MONITOR_ID },
          { isRoot: true, tenantId: PROJECT_ID },
          { skip: 0, limit: 100 },
        ),
      ),
    ).rejects.toThrow();
  });

  it("lets a resource keep the monitor it already shows", async () => {
    const service: DatabaseService<DatabaseBaseModel> = asService(
      StatusPageResourceService,
    );

    jest
      .spyOn(ProjectScopedReferenceValidator, "getUnavailableReferences")
      .mockResolvedValue([] as never);
    const alreadyOnPage: jest.SpyInstance = jest
      .spyOn(
        StatusPageResourceService as unknown as {
          isResourceAlreadyOnStatusPage: () => Promise<boolean>;
        },
        "isResourceAlreadyOnStatusPage",
      )
      .mockResolvedValue(true as never);

    stubReads(service, [
      rowOf(service, ROW_A, {
        statusPageId: STATUS_PAGE_ID,
        monitorId: MONITOR_ID,
      }),
    ]);

    await runHook(
      service,
      updateOf(
        { monitorId: MONITOR_ID },
        { isRoot: true, tenantId: PROJECT_ID },
        { skip: 0, limit: 100 },
      ),
    );

    expect(alreadyOnPage).not.toHaveBeenCalled();
  });
});
