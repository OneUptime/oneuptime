import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import Query from "../../../Server/Types/Database/Query";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import Express, {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import SecurityWatchlists from "../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import { expressErrorHandler } from "../../../Server/Utils/StartServer";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import APIKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { getColumnAccessControlForAllColumns } from "../../../Types/Database/AccessControl/ColumnAccessControl";
import {
  getUniqueColumnBy,
  getUniqueColumnsBy,
} from "../../../Types/Database/UniqueColumnBy";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { getErrorDetails } from "../../../Types/Exception/BadDataExceptionWithDetails";
import NameTakenException, {
  NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE,
  NAME_TAKEN_REFUSAL_CODE,
  REFUSAL_CODE_FIELD,
} from "../../../Types/Exception/NameTakenException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { ARCHIVED_COLUMN } from "../../../Utils/ArchivableValues";
import { mockRouter } from "../API/Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

// Refusals below are deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * A RENAME ONTO A NAME ANOTHER RECORD OF ITS KIND HAS IS REFUSED, AS A
 * CREATE IS (#10318).
 *
 * Some seventy kinds hold their name one of their kind in their project, or
 * in what they belong to, with @UniqueColumnBy: incident and alert
 * severities and states, monitor statuses, status pages and their groups,
 * dashboards, workflows and their variables, runbooks, custom fields,
 * network sites and the rest. DatabaseService.checkUniqueColumnBy held that
 * rule on a create only, so a second "Critical" severity could not be made,
 * but another severity could be renamed "Critical", and every picker drew
 * the two alike.
 *
 * Every kind is read off the models here, so a kind added later is held to
 * it too, and each is renamed through its own service - its own hooks, the
 * permission checks, an in-memory table behind it - and through the API's
 * own PUT route, as a project owner, the way the Dashboard and Terraform
 * rename one:
 *
 *   - onto a name a record in service has: refused, nothing written, with
 *     the create's words and its code ("name_taken"), so the Terraform
 *     provider asks it again as it asks a create;
 *   - onto a name only an archived record has: refused with
 *     "name_taken_by_archived", in the create's words for it;
 *   - onto a name nobody has, or onto its own name again - in another case,
 *     with spaces around it, though a twin shares it: written;
 *   - a kind whose service holds its name itself (the resources telemetry
 *     is matched to by name, incident custom fields, runbook and workflow
 *     variables, watchlists) refuses it once, in its own words, with the
 *     code.
 *
 * Records that already share a name - from before this rule - stay as they
 * are: each can still be edited and renamed apart, never onto another's
 * name. One update that would give several records of one scope one name
 * is refused, with no code. OneUptime's own writes are trusted. The other
 * columns a model holds unique (an SSO provider's sign-on URL, a project
 * domain, an API key's permission) are held to the same rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10318aaa-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10318aaa-0000-4000-8000-000000000002",
);
// What a kind's name is unique within, besides its project: a status page, a dashboard.
const PARENT_ID: ObjectID = new ObjectID(
  "10318aaa-0000-4000-8000-000000000003",
);
const OTHER_PARENT_ID: ObjectID = new ObjectID(
  "10318aaa-0000-4000-8000-000000000004",
);
const USER_ID: ObjectID = new ObjectID("10318aaa-0000-4000-8000-000000000005");

// The record renamed, the one that has the name, and a twin of either.
const RENAMED_ID: string = "10318bbb-0000-4000-8000-000000000001";
const HOLDER_ID: string = "10318bbb-0000-4000-8000-000000000002";
const TWIN_ID: string = "10318bbb-0000-4000-8000-000000000003";
const ELSEWHERE_ID: string = "10318bbb-0000-4000-8000-000000000004";

type ModelType = { new (): BaseModel };

// A kind whose model holds a column unique, read off the model.
interface UniqueKind {
  type: ModelType;
  // The model's class, as a test names it: "IncidentSeverity".
  label: string;
  column: string;
  // The columns it is unique within.
  scope: Array<string>;
  service: DatabaseService<BaseModel>;
  isArchivable: boolean;
  // Whether its service holds the column itself, in words of its own.
  isCheckedByService: boolean;
}

interface ServiceDeclarations {
  getUniqueColumnsCheckedOnUpdate: () => ReadonlyArray<string>;
}

const SERVICES_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../Server/Services",
);

// Each service file, by its name in lower case: "projectssoservice".
const SERVICE_FILES: Map<string, string> = new Map<string, string>(
  fs
    .readdirSync(SERVICES_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith("Service.ts");
    })
    .map((file: string): [string, string] => {
      const name: string = file.slice(0, -".ts".length);
      return [name.toLowerCase(), name];
    }),
);

/*
 * A kind's own service, by the file every kind has: Server/Services/
 * <Model>Service, named as the model's file is (ProjectSso for the class
 * ProjectSSO). Each kind's is the one its API and every hook use.
 */
function serviceOf(type: ModelType): DatabaseService<BaseModel> {
  const file: string | undefined = SERVICE_FILES.get(
    `${type.name}Service`.toLowerCase(),
  );

  if (!file) {
    throw new Error(`Server/Services has no service for ${type.name}.`);
  }

  const loaded: { default?: unknown } = jest.requireActual(
    path.join(SERVICES_DIRECTORY, file),
  ) as { default?: unknown };

  if (!(loaded.default instanceof DatabaseService)) {
    throw new Error(`Server/Services/${file} has no service.`);
  }

  return loaded.default as DatabaseService<BaseModel>;
}

// The columns each model holds unique, and what in.
function uniqueColumnsOf(type: ModelType): Array<{
  column: string;
  scope: Array<string>;
}> {
  const columns: Dictionary<string | Array<string>> = getUniqueColumnsBy(
    new type(),
  );

  return Object.keys(columns).map(
    (column: string): { column: string; scope: Array<string> } => {
      const scope: string | Array<string> = columns[column]!;

      return {
        column: column,
        scope: Array.isArray(scope) ? scope : [scope],
      };
    },
  );
}

function kindOf(type: ModelType, column: string): UniqueKind {
  const service: DatabaseService<BaseModel> = serviceOf(type);
  const scope: string | Array<string> = getUniqueColumnBy(new type(), column);

  return {
    type: type,
    label: type.name,
    column: column,
    scope: Array.isArray(scope) ? scope : [scope],
    service: service,
    isArchivable: new type().hasColumn(ARCHIVED_COLUMN),
    isCheckedByService: (service as unknown as ServiceDeclarations)
      .getUniqueColumnsCheckedOnUpdate()
      .includes(column),
  };
}

// Whether anyone may write the column on an update (ColumnAccessControl).
function isUpdatable(type: ModelType, column: string): boolean {
  const access: ColumnAccessControl | undefined =
    getColumnAccessControlForAllColumns(new type())[column];

  return Boolean(access && access.update.length > 0);
}

// The kinds whose model holds its name one of its kind.
const NAMED_KINDS: Array<UniqueKind> = AllModelTypes.filter(
  (type: ModelType): boolean => {
    return Boolean(getUniqueColumnBy(new type(), "name"));
  },
).map((type: ModelType): UniqueKind => {
  return kindOf(type, "name");
});

// Every other column a model holds unique that someone may change.
const OTHER_UNIQUE_COLUMNS: Array<UniqueKind> = AllModelTypes.flatMap(
  (type: ModelType): Array<UniqueKind> => {
    return uniqueColumnsOf(type)
      .filter((unique: { column: string }): boolean => {
        return unique.column !== "name" && isUpdatable(type, unique.column);
      })
      .map((unique: { column: string }): UniqueKind => {
        return kindOf(type, unique.column);
      });
  },
);

function cases(kinds: Array<UniqueKind>): Array<[string, UniqueKind]> {
  return kinds.map((kind: UniqueKind): [string, UniqueKind] => {
    return [
      kind.column === "name" ? kind.label : `${kind.label}.${kind.column}`,
      kind,
    ];
  });
}

/*
 * A project owner, as a request of theirs reaches the services: every
 * check of the write runs, and none refuses them for want of permission.
 */
function ownerProps(): DatabaseCommonInteractionProps {
  const permissions: Array<UserPermission> = [
    Permission.CurrentUser,
    Permission.ProjectUser,
    Permission.ProjectMember,
    Permission.ProjectAdmin,
    Permission.ProjectOwner,
  ].map((permission: Permission): UserPermission => {
    return {
      _type: "UserPermission",
      permission: permission,
      labelIds: [],
      isBlockPermission: false,
      scope: PermissionScope.All,
    };
  });

  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: permissions,
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

// A value of a unique column, as each kind stores it.
function valueOf(kind: UniqueKind, text: string): string {
  if (kind.column === "signOnURL") {
    return `https://${text.trim().toLowerCase()}.example.com/sso`;
  }

  if (kind.column === "domain") {
    return `${text.trim().toLowerCase()}.example.com`;
  }

  if (kind.column === "address") {
    return text.trim().toLowerCase() === "primary" ? "10.0.0.1" : "10.0.0.2";
  }

  if (kind.column === "permission") {
    return text.trim().toLowerCase() === "primary"
      ? Permission.ReadProjectIncident
      : Permission.ReadAlert;
  }

  return text;
}

// Scope columns a row leaves empty: a permission given by no custom role.
const NULL_SCOPE_COLUMNS: Set<string> = new Set<string>(["apiKeyCustomRoleId"]);

// A row of the kind, in the project and the parent its column is unique within.
function rowOf(
  kind: UniqueKind,
  data: {
    id: string;
    value: string;
    isArchived?: boolean;
    projectId?: ObjectID;
    parentId?: ObjectID;
  },
): StoredRow {
  const row: StoredRow = {
    _id: data.id,
    projectId: (data.projectId || PROJECT_ID).toString(),
    [kind.column]: data.value,
    createdAt: new Date(Date.UTC(2026, 10, 1)),
    version: 1,
  };

  if (kind.column !== "name") {
    row["name"] = `Record ${data.id.slice(-1)}`;
  }

  for (const scopeColumn of kind.scope) {
    if (scopeColumn === "projectId") {
      continue;
    }

    // An API key's own permission: one a custom role gives is the role's.
    row[scopeColumn] = NULL_SCOPE_COLUMNS.has(scopeColumn)
      ? null
      : (data.parentId || PARENT_ID).toString();
  }

  if (kind.isArchivable) {
    row[ARCHIVED_COLUMN] = Boolean(data.isArchived);
  }

  return row;
}

/*
 * What a kind's own checks read of another table before its write, there
 * as on a server: an API key's permission belongs to a key of the project.
 */
function setUpWhatTheKindReads(kind: UniqueKind): void {
  if (kind.type === APIKeyPermission) {
    useInMemoryTable(ApiKeyService, [
      { _id: PARENT_ID.toString(), projectId: PROJECT_ID.toString() },
    ]);
  }
}

/*
 * The kind's table: the record renamed ("Staging") and the one that has
 * the name ("Primary"), with any more rows the test needs.
 */
function tableOf(
  kind: UniqueKind,
  options?: {
    holder?: { isArchived?: boolean } | undefined;
    more?: Array<StoredRow> | undefined;
  },
): InMemoryTable {
  setUpWhatTheKindReads(kind);

  return useInMemoryTable(kind.service, [
    rowOf(kind, { id: RENAMED_ID, value: valueOf(kind, "Staging") }),
    rowOf(kind, {
      id: HOLDER_ID,
      value: valueOf(kind, "Primary"),
      isArchived: Boolean(options?.holder?.isArchived),
    }),
    ...(options?.more || []),
  ]);
}

function rename(
  kind: UniqueKind,
  value: string,
  options?: {
    id?: string;
    props?: DatabaseCommonInteractionProps;
    more?: JSONObject;
  },
): Promise<number> {
  return kind.service.updateOneById({
    id: new ObjectID(options?.id || RENAMED_ID),
    data: { [kind.column]: value, ...(options?.more || {}) },
    props: options?.props || ownerProps(),
  });
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the write to be refused.");
}

function expectNameTaken(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(NameTakenException);
  // Still bad data, at 400, for everything that reads it as such.
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as NameTakenException).code).toBe(400);
  expect(getErrorDetails(error)).toEqual({ [REFUSAL_CODE_FIELD]: code });
}

// What a create of the kind is refused with when a record in service has the name.
function createRefusal(kind: UniqueKind): string {
  return `${new kind.type().singularName} with the same ${kind.column} already exists.`;
}

/*
 * The names each write stored, as the check compares them: some kinds
 * store a name without the spaces around it.
 */
function writtenNames(table: InMemoryTable): Array<string> {
  return table.updates.map((update: { set: StoredRow }): string => {
    return String(update.set["name"]).trim().toLowerCase();
  });
}

interface HooksAfterTheChecks {
  onUpdatePermitted: (updateBy: unknown) => Promise<void>;
  onUpdateSuccess: (onUpdate: unknown, ids: unknown) => Promise<unknown>;
}

/*
 * For a write the checks let through: what each kind does once its write
 * is let through - a workflow told its new name, a renamed field's values
 * moved, a variable's workflows held - is not what this suite is about,
 * and reaches tables and servers beyond the kind's own. Everything up to
 * the write, the unique checks included, runs as it does on a server.
 */
function letTheWriteLand(kind: UniqueKind): void {
  const service: HooksAfterTheChecks =
    kind.service as unknown as HooksAfterTheChecks;

  getJestSpyOn(service, "onUpdatePermitted").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onUpdateSuccess").mockImplementation(
    async (onUpdate: unknown): Promise<unknown> => {
      return onUpdate;
    },
  );
}

// A name every kind takes: watchlists and variables allow no spaces.
const FREE_NAME: string = "Primary_2";

beforeEach(() => {
  stubProjectDirectory({});
  everyServerProductIsOn();
  // A server licensed for every Enterprise feature: SCIM's tables need one.
  getJestSpyOn(EnterpriseEdition, "assertFeatureAvailableSync").mockReturnValue(
    undefined as never,
  );
  // No rule, monitor or hunt reads a watchlist by its name here.
  getJestSpyOn(SecurityWatchlists, "findReaders").mockResolvedValue(
    new Map() as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the kinds, read off the models", () => {
  test("some seventy kinds hold their name one of their kind, the ones people name in Terraform among them", () => {
    const labels: Array<string> = NAMED_KINDS.map(
      (kind: UniqueKind): string => {
        return kind.label;
      },
    );

    expect(labels.length).toBeGreaterThanOrEqual(60);
    expect(labels).toEqual(
      expect.arrayContaining([
        "IncidentSeverity",
        "IncidentState",
        "AlertSeverity",
        "AlertState",
        "MonitorStatus",
        "ScheduledMaintenanceState",
        "StatusPage",
        "StatusPageGroup",
        "Dashboard",
        "Workflow",
        "WorkflowVariable",
        "Runbook",
        "RunbookVariable",
        "IncidentCustomField",
        "NetworkSite",
        "Service",
      ]),
    );
  });

  test("each kind has a service of its own, the one its API writes through", () => {
    for (const kind of [...NAMED_KINDS, ...OTHER_UNIQUE_COLUMNS]) {
      expect({ kind: kind.label, model: kind.service.modelType }).toEqual({
        kind: kind.label,
        model: kind.type,
      });
    }
  });

  /*
   * A service that holds a column itself says so, so the generic check
   * leaves it out: only a column its model holds unique, never one it
   * does not.
   */
  test("a service names only columns its model holds unique as the ones it checks itself", () => {
    const declared: Array<string> = [];

    for (const type of AllModelTypes) {
      const unique: Array<string> = uniqueColumnsOf(type).map(
        (each: { column: string }): string => {
          return each.column;
        },
      );

      if (unique.length === 0) {
        continue;
      }

      const service: DatabaseService<BaseModel> = serviceOf(type);

      for (const column of (
        service as unknown as ServiceDeclarations
      ).getUniqueColumnsCheckedOnUpdate()) {
        expect({ kind: type.name, column, unique }).toEqual({
          kind: type.name,
          column,
          unique: expect.arrayContaining([column]),
        });
        declared.push(`${type.name}.${column}`);
      }
    }

    // The kinds that held their own before #10318, and nothing else.
    expect(declared.sort()).toEqual(
      [
        "CephCluster.name",
        "DockerHost.hostIdentifier",
        "DockerSwarmCluster.name",
        "Host.hostIdentifier",
        "IncidentCustomField.name",
        "IoTFleet.name",
        "KubernetesCluster.clusterIdentifier",
        "Label.name",
        "NetworkAddressName.address",
        "OpenStackCloud.name",
        "PodmanHost.hostIdentifier",
        "ProxmoxCluster.name",
        "RunbookVariable.name",
        "SecurityWatchlist.name",
        "Service.name",
        "StorageArray.name",
        "VMwareVCenter.name",
        "WorkflowVariable.name",
      ].sort(),
    );
  });
});

describe("a rename, through the kind's own service", () => {
  test.each(cases(NAMED_KINDS))(
    "%s: onto a name a record in service has is refused with name_taken, and nothing is written",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);

      const error: unknown = await refusalOf(rename(kind, " PRIMARY "));

      expectNameTaken(error, NAME_TAKEN_REFUSAL_CODE);

      if (!kind.isCheckedByService) {
        // The create's words, unchanged.
        expect((error as Error).message).toBe(createRefusal(kind));
      }

      expect(table.updates).toEqual([]);
      expect(table.get(RENAMED_ID)!["name"]).toBe("Staging");
    },
  );

  test.each(
    cases(
      NAMED_KINDS.filter((kind: UniqueKind): boolean => {
        return kind.isArchivable;
      }),
    ),
  )(
    "%s: onto a name only an archived record has is refused with name_taken_by_archived",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind, {
        holder: { isArchived: true },
      });

      const error: unknown = await refusalOf(rename(kind, "Primary"));

      expectNameTaken(error, NAME_TAKEN_BY_ARCHIVED_REFUSAL_CODE);

      if (!kind.isCheckedByService) {
        expect((error as Error).message).toBe(
          `${new kind.type().singularName} with the same name already exists, and it is archived. Unarchive it, or choose another name.`,
        );
      }

      expect(table.updates).toEqual([]);
    },
  );

  test.each(cases(NAMED_KINDS))(
    "%s: onto a name nobody has is written",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);
      letTheWriteLand(kind);

      await expect(rename(kind, FREE_NAME)).resolves.toBe(1);

      expect(writtenNames(table)).toEqual([FREE_NAME.toLowerCase()]);
    },
  );

  test.each(cases(NAMED_KINDS))(
    "%s: its own name again, in another case and with spaces around it, is no rename, and is written",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);
      letTheWriteLand(kind);

      await expect(rename(kind, "STAGING")).resolves.toBe(1);
      await expect(rename(kind, " staging ")).resolves.toBe(1);

      expect(writtenNames(table)).toEqual(["staging", "staging"]);
    },
  );

  test.each(cases(NAMED_KINDS))(
    "%s: a name a record of another project, or of another parent, has is free",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = useInMemoryTable(kind.service, [
        rowOf(kind, { id: RENAMED_ID, value: "Staging" }),
        rowOf(kind, {
          id: ELSEWHERE_ID,
          value: "Primary",
          projectId: OTHER_PROJECT_ID,
          parentId: OTHER_PARENT_ID,
        }),
      ]);
      letTheWriteLand(kind);

      await expect(rename(kind, "Primary")).resolves.toBe(1);

      expect(writtenNames(table)).toEqual(["primary"]);
    },
  );
});

describe("a rename, through the API's own PUT route", () => {
  interface Answer {
    statuses: Array<number>;
    bodies: Array<JSONObject>;
  }

  // The PUT /<kind>/:id the kind's API registers, as Express runs it.
  function putRouteOf(
    kind: UniqueKind,
  ): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void> {
    mockRouter.routes.length = 0;
    getJestSpyOn(Express, "getRouter").mockReturnValue(mockRouter as never);

    new BaseAPI<BaseModel, DatabaseService<BaseModel>>(kind.type, kind.service);

    return mockRouter.match(
      "put",
      `${new kind.type().getCrudApiPath()!.toString()}/:id`,
    ).handlerFunction;
  }

  // A PUT of the kind's record, answered as the server answers it.
  async function put(kind: UniqueKind, data: JSONObject): Promise<Answer> {
    const answer: Answer = { statuses: [], bodies: [] };

    getJestSpyOn(
      CommonAPI,
      "getDatabaseCommonInteractionProps",
    ).mockResolvedValue(ownerProps() as never);

    const res: ExpressResponse = {
      headersSent: false,
      status: (code: number): ExpressResponse => {
        answer.statuses.push(code);
        return res;
      },
      send: (body: JSONObject): ExpressResponse => {
        answer.bodies.push(body);
        return res;
      },
      json: (body: JSONObject): ExpressResponse => {
        answer.bodies.push(body);
        return res;
      },
      setHeader: (): ExpressResponse => {
        return res;
      },
      getHeader: (): undefined => {
        return undefined;
      },
    } as unknown as ExpressResponse;

    const req: ExpressRequest = {
      url: `/api${new kind.type().getCrudApiPath()!.toString()}/${RENAMED_ID}`,
      method: "PUT",
      params: { id: RENAMED_ID },
      body: { data: data },
      headers: {},
      query: {},
      socket: {},
    } as unknown as ExpressRequest;

    let handedOn: unknown = undefined;

    await putRouteOf(kind)(req, res, ((error: unknown): void => {
      handedOn = error;
    }) as NextFunction);

    // What the route hands on reaches the server's error handler.
    if (handedOn) {
      expressErrorHandler(
        handedOn as Error,
        req,
        res,
        (() => {}) as unknown as NextFunction,
      );
    }

    return answer;
  }

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  test.each(cases(NAMED_KINDS))(
    "%s: onto a name a record in service has answers 400, with the sentence and name_taken beside it",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);

      const answer: Answer = await put(kind, { name: "Primary" });

      expect(answer.statuses).toEqual([400]);
      expect(answer.bodies).toHaveLength(1);
      expect(answer.bodies[0]![REFUSAL_CODE_FIELD]).toBe(
        NAME_TAKEN_REFUSAL_CODE,
      );

      if (!kind.isCheckedByService) {
        expect(answer.bodies[0]).toEqual({
          error: createRefusal(kind),
          [REFUSAL_CODE_FIELD]: NAME_TAKEN_REFUSAL_CODE,
        });
      }

      expect(table.updates).toEqual([]);
    },
  );

  test.each(cases(NAMED_KINDS))(
    "%s: onto its own name in another case is written, and answered as a success",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);
      letTheWriteLand(kind);

      const answer: Answer = await put(kind, { name: "staging" });

      expect(answer.statuses).not.toContain(400);
      expect(writtenNames(table)).toEqual(["staging"]);
    },
  );
});

/*
 * RECORDS THAT ALREADY SHARE A NAME STAY AS THEY ARE.
 *
 * A rename was let through until #10318, so a project may hold two
 * severities called "Critical". Nothing renames them: names are what
 * people, workflows and Terraform know records by. Each can still be
 * edited, written with its own name again and renamed apart - never onto
 * another record's name.
 */
describe("records that already share a name", () => {
  const severities: UniqueKind = kindOf(IncidentSeverity, "name");

  function twinsTable(): InMemoryTable {
    return useInMemoryTable(severities.service, [
      rowOf(severities, { id: RENAMED_ID, value: "Critical" }),
      rowOf(severities, { id: TWIN_ID, value: "critical " }),
      rowOf(severities, { id: HOLDER_ID, value: "Minor" }),
    ]);
  }

  test("a twin's other columns are edited as before", async () => {
    const table: InMemoryTable = twinsTable();
    letTheWriteLand(severities);

    await expect(
      severities.service.updateOneById({
        id: new ObjectID(RENAMED_ID),
        data: { description: "Customers cannot sign in." } as JSONObject,
        props: ownerProps(),
      }),
    ).resolves.toBe(1);

    expect(table.get(RENAMED_ID)!["description"]).toBe(
      "Customers cannot sign in.",
    );
  });

  test("a twin written with its own name again - an edit form sends it with every save - is saved, though its twin shares it", async () => {
    const table: InMemoryTable = twinsTable();
    letTheWriteLand(severities);

    await expect(
      rename(severities, "CRITICAL", {
        more: { description: "Customers cannot sign in." },
      }),
    ).resolves.toBe(1);

    expect(table.get(RENAMED_ID)!["name"]).toBe("CRITICAL");
  });

  test("a twin is renamed apart", async () => {
    const table: InMemoryTable = twinsTable();
    letTheWriteLand(severities);

    await expect(rename(severities, "Critical (Legacy)")).resolves.toBe(1);

    expect(table.get(RENAMED_ID)!["name"]).toBe("Critical (Legacy)");
    expect(table.get(TWIN_ID)!["name"]).toBe("critical ");
  });

  test("a twin renamed onto another record's name is refused", async () => {
    const table: InMemoryTable = twinsTable();

    expectNameTaken(
      await refusalOf(rename(severities, "minor")),
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(table.updates).toEqual([]);
  });

  test("a third record renamed onto the twins' name is refused, and the twins keep it", async () => {
    const table: InMemoryTable = twinsTable();

    expectNameTaken(
      await refusalOf(rename(severities, "Critical", { id: HOLDER_ID })),
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(table.updates).toEqual([]);
    expect(table.get(RENAMED_ID)!["name"]).toBe("Critical");
    expect(table.get(TWIN_ID)!["name"]).toBe("critical ");
  });
});

describe("one update of several records", () => {
  const severities: UniqueKind = kindOf(IncidentSeverity, "name");
  const groups: UniqueKind = kindOf(StatusPageGroup, "name");

  function renameAll(kind: UniqueKind, name: string): Promise<number> {
    return kind.service.updateBy({
      query: { projectId: PROJECT_ID } as Query<BaseModel>,
      data: { name: name } as JSONObject,
      limit: 100,
      skip: 0,
      props: ownerProps(),
    });
  }

  test("that would give several records of one scope one name is refused, with no code: asking again changes nothing", async () => {
    const table: InMemoryTable = useInMemoryTable(severities.service, [
      rowOf(severities, { id: RENAMED_ID, value: "Critical" }),
      rowOf(severities, { id: HOLDER_ID, value: "Minor" }),
    ]);

    const error: unknown = await refusalOf(renameAll(severities, "Major"));

    expect(error).toBeInstanceOf(BadDataException);
    expect(error).not.toBeInstanceOf(NameTakenException);
    expect((error as Error).message).toBe(
      "Several Incident Severities cannot be given one name. Rename one at a time.",
    );
    expect(getErrorDetails(error)).toEqual({});
    expect(table.updates).toEqual([]);
  });

  test("onto a name one of them already has is refused as that name taken", async () => {
    const table: InMemoryTable = useInMemoryTable(severities.service, [
      rowOf(severities, { id: RENAMED_ID, value: "Major" }),
      rowOf(severities, { id: HOLDER_ID, value: "Minor" }),
    ]);

    expectNameTaken(
      await refusalOf(renameAll(severities, "major")),
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(table.updates).toEqual([]);
  });

  test("of records in different scopes - groups of two status pages - checks each in its own, and writes them", async () => {
    const table: InMemoryTable = useInMemoryTable(groups.service, [
      rowOf(groups, { id: RENAMED_ID, value: "Overview", parentId: PARENT_ID }),
      rowOf(groups, {
        id: HOLDER_ID,
        value: "Services",
        parentId: OTHER_PARENT_ID,
      }),
    ]);
    letTheWriteLand(groups);

    await expect(renameAll(groups, "Platform")).resolves.toBe(2);

    expect(writtenNames(table)).toEqual(["platform", "platform"]);
  });

  test("of records in different scopes is refused where one scope already has the name", async () => {
    const table: InMemoryTable = useInMemoryTable(groups.service, [
      rowOf(groups, { id: RENAMED_ID, value: "Overview", parentId: PARENT_ID }),
      rowOf(groups, {
        id: HOLDER_ID,
        value: "Services",
        parentId: OTHER_PARENT_ID,
      }),
      // Another group of the second page has the name.
      rowOf(groups, {
        id: TWIN_ID,
        value: "Platform",
        parentId: OTHER_PARENT_ID,
      }),
    ]);

    expectNameTaken(
      await refusalOf(
        groups.service.updateBy({
          query: { _id: QueryHelper.any([RENAMED_ID, HOLDER_ID]) },
          data: { name: "platform" } as JSONObject,
          limit: 100,
          skip: 0,
          props: ownerProps(),
        }),
      ),
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(table.updates).toEqual([]);
  });
});

describe("whose writes are held to the rule", () => {
  const severities: UniqueKind = kindOf(IncidentSeverity, "name");

  test("OneUptime's own are trusted, as for teams and labels: telemetry, a rule, a migration", async () => {
    const table: InMemoryTable = tableOf(severities);
    letTheWriteLand(severities);

    await expect(
      rename(severities, "Primary", { props: { isRoot: true } }),
    ).resolves.toBe(1);
    await expect(
      rename(severities, "PRIMARY", {
        props: { isRoot: true, ignoreHooks: true },
      }),
    ).resolves.toBe(1);

    expect(writtenNames(table)).toEqual(["primary", "primary"]);
  });

  test("a master admin's is held to it like anyone's", async () => {
    const table: InMemoryTable = tableOf(severities);

    expectNameTaken(
      await refusalOf(
        rename(severities, "Primary", {
          props: {
            isMasterAdmin: true,
            userId: USER_ID,
            userType: UserType.User,
            tenantId: PROJECT_ID,
            ...ON_HIGHEST_PLAN,
          },
        }),
      ),
      NAME_TAKEN_REFUSAL_CODE,
    );
    expect(table.updates).toEqual([]);
  });
});

describe("what the check reads", () => {
  const severities: UniqueKind = kindOf(IncidentSeverity, "name");

  interface CountCall {
    query: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }

  // Every count the service makes, answered by its table as before.
  function countCalls(kind: UniqueKind): Array<CountCall> {
    const calls: Array<CountCall> = [];
    const original: (countBy: never) => Promise<unknown> =
      kind.service.countBy.bind(kind.service) as unknown as (
        countBy: never,
      ) => Promise<unknown>;

    getJestSpyOn(kind.service, "countBy").mockImplementation(
      async (countBy: CountCall): Promise<unknown> => {
        calls.push(countBy);
        return await original(countBy as never);
      },
    );

    return calls;
  }

  function nameLookups(calls: Array<CountCall>): Array<CountCall> {
    return calls.filter((call: CountCall): boolean => {
      return Object.prototype.hasOwnProperty.call(call.query, "name");
    });
  }

  test("the other record is counted as OneUptime, in the renamed record's project: one the caller may not read holds its name all the same", async () => {
    tableOf(severities);
    const calls: Array<CountCall> = countCalls(severities);

    await refusalOf(rename(severities, "Primary"));

    const lookups: Array<CountCall> = nameLookups(calls);

    expect(lookups.length).toBeGreaterThanOrEqual(1);

    for (const lookup of lookups) {
      expect(lookup.props).toEqual({ isRoot: true });
      expect(String(lookup.query["projectId"])).toBe(PROJECT_ID.toString());
    }
  });

  test("the rows checked are the rows the update writes, the update held to them", async () => {
    tableOf(severities);
    const held: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      severities.service,
      "findRowsAndHoldUpdateToThem",
    );

    await refusalOf(rename(severities, "Primary"));

    expect(held).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ _id: true, name: true, projectId: true }),
    );
  });

  test.each([["   "], [""], [null]])(
    "a name written as %j is not looked up: the column's own checks answer it",
    async (name: string | null) => {
      tableOf(severities);
      letTheWriteLand(severities);
      const calls: Array<CountCall> = countCalls(severities);

      const outcome: unknown = await severities.service
        .updateOneById({
          id: new ObjectID(RENAMED_ID),
          data: { name: name } as JSONObject,
          props: ownerProps(),
        })
        .catch((error: unknown): unknown => {
          return error;
        });

      expect(outcome).not.toBeInstanceOf(NameTakenException);
      expect(nameLookups(calls)).toEqual([]);
    },
  );

  test("an update that writes no name reads nothing for it", async () => {
    tableOf(severities);
    letTheWriteLand(severities);
    const calls: Array<CountCall> = countCalls(severities);
    const held: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      severities.service,
      "findRowsAndHoldUpdateToThem",
    );

    await expect(
      severities.service.updateOneById({
        id: new ObjectID(RENAMED_ID),
        data: { description: "Wakes someone up." } as JSONObject,
        props: ownerProps(),
      }),
    ).resolves.toBe(1);

    expect(nameLookups(calls)).toEqual([]);
    expect(held).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: true }),
    );
  });

  test("a kind whose service holds its name itself is refused once, in its own words: the generic check never counts", async () => {
    const clusters: UniqueKind | undefined = NAMED_KINDS.find(
      (kind: UniqueKind): boolean => {
        return kind.label === "CephCluster";
      },
    );

    expect(clusters?.isCheckedByService).toBe(true);

    tableOf(clusters!);
    const calls: Array<CountCall> = countCalls(clusters!);

    const error: unknown = await refusalOf(rename(clusters!, "Primary"));

    expectNameTaken(error, NAME_TAKEN_REFUSAL_CODE);
    expect((error as Error).message).toBe(
      'Another Ceph cluster is already named "Primary".',
    );
    expect(nameLookups(calls)).toEqual([]);
  });
});

/*
 * THE OTHER COLUMNS A MODEL HOLDS UNIQUE, THAT SOMEONE MAY CHANGE: an SSO
 * provider's sign-on URL, a project domain, an API key's permission, and
 * the identifiers telemetry is matched on. A change onto another record's
 * value is refused as a create onto it is; the value written again is no
 * change.
 */
describe("a change of another unique column", () => {
  test("the columns, read off the models", () => {
    expect(
      OTHER_UNIQUE_COLUMNS.map((kind: UniqueKind): string => {
        return `${kind.label}.${kind.column}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        "APIKeyPermission.permission",
        "DashboardSSO.signOnURL",
        "Domain.domain",
        "Host.hostIdentifier",
        "KubernetesCluster.clusterIdentifier",
        "ProjectSSO.signOnURL",
        "StatusPageSSO.signOnURL",
      ]),
    );
  });

  test.each(cases(OTHER_UNIQUE_COLUMNS))(
    "%s: onto a value another record has is refused, and nothing is written",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);

      const error: unknown = await refusalOf(
        rename(kind, valueOf(kind, "Primary")),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error).not.toBeInstanceOf(NameTakenException);

      if (!kind.isCheckedByService) {
        expect((error as Error).message).toBe(createRefusal(kind));
      }

      expect(table.updates).toEqual([]);
    },
  );

  test.each(cases(OTHER_UNIQUE_COLUMNS))(
    "%s: its own value again is no change, and is written",
    async (_label: string, kind: UniqueKind) => {
      const table: InMemoryTable = tableOf(kind);
      letTheWriteLand(kind);

      await expect(rename(kind, valueOf(kind, "Staging"))).resolves.toBe(1);

      expect(table.updates).toHaveLength(1);
    },
  );
});
