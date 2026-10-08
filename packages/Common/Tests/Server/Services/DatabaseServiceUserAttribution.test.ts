import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ColumnPermission from "../../../Server/Types/Database/Permissions/ColumnPermission";
import DatabaseRequestType from "../../../Server/Types/BaseDatabase/DatabaseRequestType";
import CreatedByUser from "../../../Server/Utils/Database/CreatedByUser";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import TableColumnType from "../../../Types/Database/TableColumnType";
import UserAttribution from "../../../Types/Database/UserAttribution";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import WorkflowPrincipal from "../../../Server/Utils/Workflow/WorkflowPrincipal";
import { getJestSpyOn } from "../../Spy";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubReadableParents } from "../TestingUtils/ReadableParents";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHO DID SOMETHING TO A RECORD IS FOR ONEUPTIME TO SAY.
 *
 * Who created a record, archived it, acknowledged it, triggered it is
 * recorded in columns named for the act (UserAttribution). DatabaseService
 * decides every one of them, for every model:
 *
 *  - a write made in a project - a person's request, an API key's,
 *    Terraform's, a workflow's, the admin dashboard's - has every such
 *    column taken out, under both of its names, before the hooks read it;
 *  - a create is then stamped with the person making it, after the
 *    permission check, and with nobody when there is no person;
 *  - an update never changes them, and archiving or resolving a record
 *    stamps who did it from the switch it turns;
 *  - OneUptime's own server code (root, with no project on the request)
 *    keeps the person it names: a job that acts for someone records them.
 *
 * These drive the real DatabaseService write path. The sweeps stop at the
 * first step after the rule, so nothing reaches a hook or the database; the
 * end-to-end cases run the whole path up to the row it would insert.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-aaaa-4aaa-8bbb-000000000001",
);

// The person making the request.
const USER_ID: ObjectID = new ObjectID("0193c0de-aaaa-4aaa-8bbb-0000000000e1");

// Somebody else, whom a write names.
const OTHER_USER_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000f2";

const RECORD_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000a1";

type ModelType = { new (): DatabaseBaseModel };

type SpyInstance = ReturnType<typeof getJestSpyOn>;

function grant(permissions: Array<Permission>): UserTenantAccessPermission {
  return {
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission): UserPermission => {
      return {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  };
}

/*
 * Who writes. Each is granted what it needs to get past the table check,
 * so the write reaches the rule.
 */
function personProps(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userType: UserType.User,
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      projectIds: [PROJECT_ID],
      globalPermissions: [Permission.Public, Permission.User],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: grant(permissions),
    },
  };
}

function apiKeyProps(
  permissions: Array<Permission> = [Permission.ProjectOwner],
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: grant(permissions),
    },
  };
}

// A workflow step: a Project Admin of its project, on the project's plan.
function workflowProps(): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: new ObjectID("0193c0de-aaaa-4aaa-8bbb-0000000000c1"),
      workflowName: "Close stale incidents",
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// The admin dashboard: a server admin, signed in.
const ADMIN_DASHBOARD_PROPS: DatabaseCommonInteractionProps = {
  isMasterAdmin: true,
  userId: USER_ID,
  userType: UserType.MasterAdmin,
};

// OneUptime's own server code: root, with no project on the request.
const SERVER_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
};

// ...acting with a person on it.
const SERVER_WITH_PERSON_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  userId: USER_ID,
};

// Thrown by the first step after the rule: what the write carried there.
class PastTheRule extends Error {}

interface AttributionCase {
  table: string;
  modelType: ModelType;
  columns: Array<string>;
}

const CASES: Array<AttributionCase> = (Entities as Array<ModelType>)
  .map((modelType: ModelType): AttributionCase => {
    const model: DatabaseBaseModel = new modelType();

    return {
      table: model.tableName || modelType.name,
      modelType: modelType,
      columns: UserAttribution.getColumns(model),
    };
  })
  .filter((attributionCase: AttributionCase): boolean => {
    return attributionCase.columns.length > 0;
  });

// A write naming somebody else under every one of the model's columns.
function namingSomebodyElse(
  attributionCase: AttributionCase,
): Record<string, unknown> {
  const model: DatabaseBaseModel = new attributionCase.modelType();
  const values: Record<string, unknown> = {};

  for (const column of attributionCase.columns) {
    const type: TableColumnType = model.getTableColumnMetadata(column).type;

    values[column] =
      type === TableColumnType.Entity
        ? { _id: OTHER_USER_ID }
        : type === TableColumnType.Date
          ? new Date("2020-01-01T00:00:00.000Z")
          : new ObjectID(OTHER_USER_ID);
  }

  return values;
}

// What an update that asks to change nothing else is told.
function refusalFor(columns: Array<string>): string {
  return `${columns.join(", ")} ${
    columns.length === 1 ? "is" : "are"
  } recorded by OneUptime and cannot be changed.`;
}

/*
 * What a write made in a project that names somebody under every one of a
 * model's columns comes to: a create reaches the hooks naming nobody, and an
 * update that asked for nothing else is told those fields are OneUptime's.
 * Null when it came to that.
 */
function problemWith(
  writeName: string,
  attributionCase: AttributionCase,
  reached: Reached,
): string | null {
  if (writeName === "update") {
    const expected: string = refusalFor(attributionCase.columns);

    return reached.outcome instanceof BadDataException &&
      reached.outcome.message === expected
      ? null
      : describeOutcome(reached.outcome);
  }

  if (!(reached.outcome instanceof PastTheRule)) {
    return describeOutcome(reached.outcome);
  }

  const named: Array<string> = stillNamed(attributionCase, reached.data);

  return named.length > 0 ? named.join(", ") : null;
}

function payloadFor(
  modelType: ModelType,
  values: Record<string, unknown>,
): DatabaseBaseModel {
  const data: DatabaseBaseModel = new modelType();

  for (const [key, value] of Object.entries(values)) {
    (data as unknown as Record<string, unknown>)[key] = value;
  }

  return data;
}

interface Reached {
  outcome: unknown;
  data: Record<string, unknown> | undefined;
}

/*
 * A generic service for the model whose first step after the rule - the
 * create hooks, or the narrowing an update does before its hooks - records
 * what the write carried and stops there.
 */
function stoppedAfterTheRule(modelType: ModelType): {
  service: DatabaseService<DatabaseBaseModel>;
  reached: () => Record<string, unknown> | undefined;
} {
  const service: DatabaseService<DatabaseBaseModel> =
    new DatabaseService<DatabaseBaseModel>(modelType);
  let reached: Record<string, unknown> | undefined = undefined;

  getJestSpyOn(service, "_onBeforeCreate").mockImplementation(
    async (createBy: { data: unknown }): Promise<never> => {
      reached = { ...(createBy.data as Record<string, unknown>) };
      throw new PastTheRule();
    },
  );
  getJestSpyOn(service, "keepRowsCallerMayWrite").mockImplementation(
    async (updateBy: { data: unknown }): Promise<never> => {
      reached = { ...(updateBy.data as Record<string, unknown>) };
      throw new PastTheRule();
    },
  );

  return {
    service,
    reached: (): Record<string, unknown> | undefined => {
      return reached;
    },
  };
}

async function outcomeOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return "written";
  } catch (error) {
    return error;
  }
}

async function create(
  attributionCase: AttributionCase,
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<Reached> {
  const { service, reached } = stoppedAfterTheRule(attributionCase.modelType);

  const outcome: unknown = await outcomeOf(
    service.create({
      data: payloadFor(attributionCase.modelType, values),
      props: props,
    }),
  );

  return { outcome, data: reached() };
}

async function update(
  attributionCase: AttributionCase,
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): Promise<Reached> {
  const { service, reached } = stoppedAfterTheRule(attributionCase.modelType);

  const outcome: unknown = await outcomeOf(
    service.updateBy({
      query: { _id: RECORD_ID },
      data: values as never,
      limit: 1,
      skip: 0,
      props: props,
    }),
  );

  return { outcome, data: reached() };
}

type Write = (
  attributionCase: AttributionCase,
  values: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => Promise<Reached>;

const WRITES: Array<[string, Write]> = [
  ["create", create],
  ["update", update],
];

function describeOutcome(outcome: unknown): string {
  return outcome instanceof Error
    ? `${outcome.constructor.name}: ${outcome.message}`
    : String(outcome);
}

// The columns of the case a write still carries past the rule.
function stillNamed(
  attributionCase: AttributionCase,
  reached: Record<string, unknown> | undefined,
): Array<string> {
  return attributionCase.columns.filter((column: string): boolean => {
    return reached?.[column] !== undefined;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

test("the sweep sees every model that records who did something", () => {
  expect(CASES.length).toBeGreaterThan(400);

  const tables: Array<string> = CASES.map(
    (attributionCase: AttributionCase): string => {
      return attributionCase.table;
    },
  );

  for (const table of [
    "Incident",
    "IncidentAlert",
    "Monitor",
    "TelemetryException",
    "OnCallDutyPolicyExecutionLog",
    "RunbookExecution",
    "IncidentEpisodeMember",
    "WorkspaceNotificationRule",
    "Project",
    "User",
  ]) {
    expect(tables).toContain(table);
  }
});

describe.each(WRITES)("%s, every model", (name: string, write: Write) => {
  test.each([["the admin dashboard", ADMIN_DASHBOARD_PROPS]])(
    "%s names nobody: a create reaches the hooks without any of them, an update of nothing else is told they are OneUptime's",
    async (_who: string, props: DatabaseCommonInteractionProps) => {
      const wrong: Array<string> = [];

      for (const attributionCase of CASES) {
        const reached: Reached = await write(
          attributionCase,
          namingSomebodyElse(attributionCase),
          props,
        );

        const problem: string | null = problemWith(
          name,
          attributionCase,
          reached,
        );

        if (problem) {
          wrong.push(`${attributionCase.table}: ${problem}`);
        }
      }

      expect(wrong).toEqual([]);
    },
  );

  test.each([
    [
      "a person",
      (attributionCase: AttributionCase): DatabaseCommonInteractionProps => {
        return personProps(permissionsToWrite(attributionCase));
      },
    ],
    [
      "an API key",
      (attributionCase: AttributionCase): DatabaseCommonInteractionProps => {
        return apiKeyProps(permissionsToWrite(attributionCase));
      },
    ],
    [
      // A Project Admin of its project: what that role may not write is refused.
      "a workflow",
      (): DatabaseCommonInteractionProps => {
        return workflowProps();
      },
    ],
  ])(
    "%s names nobody: a create reaches the hooks without any of them, an update of nothing else is told they are OneUptime's",
    async (
      _who: string,
      propsFor: (
        attributionCase: AttributionCase,
      ) => DatabaseCommonInteractionProps,
    ) => {
      const wrong: Array<string> = [];
      let reachedTheRule: number = 0;

      for (const attributionCase of CASES) {
        const reached: Reached = await write(
          attributionCase,
          namingSomebodyElse(attributionCase),
          propsFor(attributionCase),
        );

        /*
         * A table this caller may not write at all is refused before the
         * rule, which is as good: nothing it named is written.
         */
        if (isRefusal(reached.outcome)) {
          continue;
        }

        reachedTheRule++;

        const problem: string | null = problemWith(
          name,
          attributionCase,
          reached,
        );

        if (problem) {
          wrong.push(`${attributionCase.table}: ${problem}`);
        }
      }

      expect(wrong).toEqual([]);
      expect(reachedTheRule).toBeGreaterThan(200);
    },
  );

  test("OneUptime's own server code keeps every one it names", async () => {
    const wrong: Array<string> = [];

    for (const attributionCase of CASES) {
      const values: Record<string, unknown> =
        namingSomebodyElse(attributionCase);
      const reached: Reached = await write(
        attributionCase,
        values,
        SERVER_PROPS,
      );

      if (!(reached.outcome instanceof PastTheRule)) {
        wrong.push(
          `${attributionCase.table}: ${describeOutcome(reached.outcome)}`,
        );
        continue;
      }

      const dropped: Array<string> = attributionCase.columns.filter(
        (column: string): boolean => {
          return reached.data?.[column] === undefined;
        },
      );

      if (dropped.length > 0) {
        wrong.push(`${attributionCase.table}: ${dropped.join(", ")}`);
      }
    }

    expect(wrong).toEqual([]);
  });
});

// Every permission the model lists for creating or updating its records.
function permissionsToWrite(
  attributionCase: AttributionCase,
): Array<Permission> {
  const model: DatabaseBaseModel = new attributionCase.modelType();

  return Array.from(
    new Set<Permission>([
      Permission.ProjectOwner,
      ...model.getCreatePermissions(),
      ...model.getUpdatePermissions(),
    ]),
  );
}

function isRefusal(outcome: unknown): boolean {
  return (
    outcome instanceof Error &&
    [
      "NotAuthorizedException",
      "NotAuthenticatedException",
      "ForbiddenException",
      "PaymentRequiredException",
    ].includes(outcome.constructor.name)
  );
}

describe("OneUptime's own server code, acting for a person", () => {
  const incident: AttributionCase = CASES.find(
    (attributionCase: AttributionCase): boolean => {
      return attributionCase.table === "Incident";
    },
  )!;

  test("a create is by the person on it: a creator relation beside the stamp goes", async () => {
    const reached: Reached = await create(
      incident,
      {
        createdByUser: { _id: OTHER_USER_ID },
        deletedByUserId: new ObjectID(OTHER_USER_ID),
      },
      SERVER_WITH_PERSON_PROPS,
    );

    expect(reached.outcome).toBeInstanceOf(PastTheRule);
    expect(reached.data?.["createdByUser"]).toBeUndefined();
    // The other columns it names are its own to name.
    expect(String(reached.data?.["deletedByUserId"])).toBe(OTHER_USER_ID);
  });

  test("an update keeps what it names", async () => {
    const reached: Reached = await update(
      incident,
      { createdByUserId: new ObjectID(OTHER_USER_ID) },
      SERVER_WITH_PERSON_PROPS,
    );

    expect(reached.outcome).toBeInstanceOf(PastTheRule);
    expect(String(reached.data?.["createdByUserId"])).toBe(OTHER_USER_ID);
  });
});

describe("a write names nobody even as the same person, or as a clear", () => {
  const incident: AttributionCase = CASES.find(
    (attributionCase: AttributionCase): boolean => {
      return attributionCase.table === "Incident";
    },
  )!;

  test.each(WRITES)(
    "%s: the requester under either name, or null, is taken out too",
    async (_name: string, write: Write) => {
      for (const values of [
        { createdByUserId: USER_ID },
        { createdByUser: { _id: USER_ID.toString() } },
        { createdByUserId: null },
        { createdByUserId: USER_ID, createdByUser: { _id: OTHER_USER_ID } },
      ]) {
        const reached: Reached = await write(
          incident,
          { title: "Payments are down", ...values },
          personProps(),
        );

        expect(reached.outcome).toBeInstanceOf(PastTheRule);
        expect(stillNamed(incident, reached.data)).toEqual([]);
        expect(reached.data?.["createdByUserId"]).toBeUndefined();
        expect(reached.data?.["createdByUser"]).toBeUndefined();
        expect(reached.data?.["title"]).toBe("Payments are down");
      }
    },
  );

  test("a create's own instance keeps every column: they are cleared, not deleted", async () => {
    const { service } = stoppedAfterTheRule(Incident);
    const data: DatabaseBaseModel = payloadFor(Incident, {
      createdByUserId: new ObjectID(OTHER_USER_ID),
    });

    await outcomeOf(service.create({ data: data, props: apiKeyProps() }));

    expect(Object.keys(data)).toContain("createdByUserId");
    expect(
      (data as unknown as Record<string, unknown>)["createdByUserId"],
    ).toBeUndefined();
  });

  test("two names that disagree are taken out, never refused", async () => {
    const reached: Reached = await create(
      incident,
      {
        createdByUserId: new ObjectID(OTHER_USER_ID),
        createdByUser: { _id: USER_ID.toString() },
      },
      apiKeyProps(),
    );

    expect(reached.outcome).toBeInstanceOf(PastTheRule);
    expect(reached.outcome).not.toBeInstanceOf(BadDataException);
  });
});

/*
 * The whole create path, up to the row it would insert: the hooks, the
 * permission check and the stamp all run. Only the INSERT is not made.
 */
describe("the creator of a record, end to end", () => {
  class PastTheStamp extends Error {}

  /*
   * The incident a note is created under is one its creator may read: a
   * member who is no project admin is looked up with the rule for private
   * incidents (CreatePermission.checkParentPermission), answered here as
   * found.
   */
  beforeEach(() => {
    stubReadableParents();
  });

  async function inserted(
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Record<string, unknown>> {
    const service: DatabaseService<IncidentInternalNote> =
      new DatabaseService<IncidentInternalNote>(IncidentInternalNote);
    let row: Record<string, unknown> | undefined = undefined;

    getJestSpyOn(service, "assertCreateWillInsert").mockImplementation(
      (data: unknown): never => {
        row = { ...(data as Record<string, unknown>) };
        throw new PastTheStamp();
      },
    );

    const note: IncidentInternalNote = new IncidentInternalNote();
    note.projectId = PROJECT_ID;
    note.incidentId = new ObjectID(RECORD_ID);
    note.note = "Rolled back the deploy.";

    for (const [key, value] of Object.entries(values)) {
      (note as unknown as Record<string, unknown>)[key] = value;
    }

    const outcome: unknown = await outcomeOf(
      service.create({ data: note, props: props }),
    );

    expect(outcome).toBeInstanceOf(PastTheStamp);

    return row!;
  }

  const NAMING_SOMEBODY_ELSE: Record<string, unknown> = {
    createdByUserId: new ObjectID(OTHER_USER_ID),
    createdByUser: { _id: OTHER_USER_ID },
    deletedByUserId: new ObjectID(OTHER_USER_ID),
  };

  test("a person's note is by that person, after the permission check", async () => {
    const checkColumns: typeof ColumnPermission.checkDataColumnPermissions =
      ColumnPermission.checkDataColumnPermissions.bind(ColumnPermission);
    let checked: Record<string, unknown> | undefined = undefined;

    const columnCheck: SpyInstance = getJestSpyOn(
      ColumnPermission,
      "checkDataColumnPermissions",
    ).mockImplementation(
      (
        modelType: never,
        data: never,
        props: never,
        requestType: never,
      ): void => {
        // What the check saw, before anything after it wrote to the row.
        checked = { ...(data as Record<string, unknown>) };
        return checkColumns(modelType, data, props, requestType);
      },
    );

    const row: Record<string, unknown> = await inserted(
      NAMING_SOMEBODY_ELSE,
      personProps(),
    );

    expect(String(row["createdByUserId"])).toBe(USER_ID.toString());
    expect(row["createdByUser"]).toBeUndefined();
    expect(row["deletedByUserId"]).toBeUndefined();
    expect(row["note"]).toBe("Rolled back the deploy.");

    // The check ran, and did not ask the person for access to the creator.
    expect(columnCheck).toHaveBeenCalledWith(
      IncidentInternalNote,
      expect.anything(),
      expect.objectContaining({ userId: USER_ID }),
      DatabaseRequestType.Create,
    );
    expect(checked).toBeDefined();
    expect(checked!["createdByUserId"]).toBeUndefined();
    expect(checked!["createdByUser"]).toBeUndefined();
  });

  test("a person who holds only the note's own create permission is not refused for the stamp", async () => {
    // A note is created under an incident its creator may read.
    const row: Record<string, unknown> = await inserted(
      {},
      personProps([
        Permission.CreateIncidentInternalNote,
        Permission.ReadProjectIncident,
      ]),
    );

    expect(String(row["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("an API key's note is by nobody", async () => {
    const row: Record<string, unknown> = await inserted(
      NAMING_SOMEBODY_ELSE,
      apiKeyProps(),
    );

    expect(row["createdByUserId"]).toBeUndefined();
    expect(row["createdByUser"]).toBeUndefined();
    expect(row["deletedByUserId"]).toBeUndefined();
  });

  test("a workflow's note is by nobody", async () => {
    const row: Record<string, unknown> = await inserted(
      NAMING_SOMEBODY_ELSE,
      workflowProps(),
    );

    expect(row["createdByUserId"]).toBeUndefined();
    expect(row["createdByUser"]).toBeUndefined();
  });

  test("the admin dashboard's note is by the admin who made it", async () => {
    const row: Record<string, unknown> = await inserted(
      NAMING_SOMEBODY_ELSE,
      ADMIN_DASHBOARD_PROPS,
    );

    expect(String(row["createdByUserId"])).toBe(USER_ID.toString());
    expect(row["createdByUser"]).toBeUndefined();
  });

  test("OneUptime's own note is by the person it names", async () => {
    const row: Record<string, unknown> = await inserted(
      { createdByUserId: new ObjectID(OTHER_USER_ID) },
      SERVER_PROPS,
    );

    expect(String(row["createdByUserId"])).toBe(OTHER_USER_ID);
  });

  test("OneUptime's own note with a person on it is by that person", async () => {
    const row: Record<string, unknown> = await inserted(
      { createdByUser: { _id: OTHER_USER_ID } },
      SERVER_WITH_PERSON_PROPS,
    );

    expect(String(row["createdByUserId"])).toBe(USER_ID.toString());
    expect(row["createdByUser"]).toBeUndefined();
  });

  test("a note OneUptime makes with nobody named is by nobody", async () => {
    const row: Record<string, unknown> = await inserted({}, SERVER_PROPS);

    expect(row["createdByUserId"]).toBeUndefined();
  });
});

/*
 * The whole update path up to the rows it would write: the hooks, the
 * permission check and the stamps all run. The rows are not read.
 */
describe("who changed a record, end to end", () => {
  class PastTheStamps extends Error {}

  async function written<TBaseModel extends DatabaseBaseModel>(
    modelType: { new (): TBaseModel },
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Record<string, unknown>> {
    const service: DatabaseService<TBaseModel> =
      new DatabaseService<TBaseModel>(modelType);
    let data: Record<string, unknown> | undefined = undefined;

    getJestSpyOn(service, "_findBy").mockResolvedValue([] as never);
    getJestSpyOn(service, "getFileReferenceChecksOnUpdate").mockImplementation(
      (write: { data: unknown }): never => {
        data = { ...(write.data as Record<string, unknown>) };
        throw new PastTheStamps();
      },
    );

    const outcome: unknown = await outcomeOf(
      service.updateBy({
        query: { _id: RECORD_ID },
        data: values as never,
        limit: 1,
        skip: 0,
        props: props,
      }),
    );

    expect(outcome).toBeInstanceOf(PastTheStamps);

    return data!;
  }

  describe("an exception resolved or archived records who did it", () => {
    test.each([
      ["isResolved", "markedAsResolvedByUserId"],
      ["isArchived", "markedAsArchivedByUserId"],
    ])(
      "%s on: the person making the change, whoever the request names",
      async (switchColumn: string, byUserColumn: string) => {
        const data: Record<string, unknown> = await written(
          TelemetryException,
          {
            [switchColumn]: true,
            [byUserColumn]: new ObjectID(OTHER_USER_ID),
          },
          personProps(),
        );

        expect(data[switchColumn]).toBe(true);
        expect(String(data[byUserColumn])).toBe(USER_ID.toString());
      },
    );

    test.each([
      ["isResolved", "markedAsResolvedByUserId"],
      ["isArchived", "markedAsArchivedByUserId"],
    ])("%s off: nobody", async (switchColumn: string, byUserColumn: string) => {
      const data: Record<string, unknown> = await written(
        TelemetryException,
        { [switchColumn]: false },
        personProps(),
      );

      expect(data[byUserColumn]).toBeNull();
    });

    test.each([
      ["an API key", apiKeyProps()],
      ["a workflow", workflowProps()],
    ])(
      "%s resolving it is nobody",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        const data: Record<string, unknown> = await written(
          TelemetryException,
          {
            isResolved: true,
            markedAsResolvedByUserId: new ObjectID(OTHER_USER_ID),
          },
          props,
        );

        expect(data["markedAsResolvedByUserId"]).toBeNull();
      },
    );

    test("OneUptime resolving it keeps the person it names, and names nobody otherwise", async () => {
      const named: Record<string, unknown> = await written(
        TelemetryException,
        {
          isResolved: true,
          markedAsResolvedByUserId: new ObjectID(OTHER_USER_ID),
        },
        SERVER_PROPS,
      );

      expect(String(named["markedAsResolvedByUserId"])).toBe(OTHER_USER_ID);

      const unnamed: Record<string, unknown> = await written(
        TelemetryException,
        { isResolved: true },
        SERVER_PROPS,
      );

      expect(unnamed["markedAsResolvedByUserId"]).toBeNull();
    });

    test.each([
      ["isResolved", "markedAsResolvedAt"],
      ["isArchived", "markedAsArchivedAt"],
    ])(
      "%s on: the time is the server's, whatever the request sends",
      async (switchColumn: string, atColumn: string) => {
        const sent: Date = new Date("2020-01-01T00:00:00.000Z");
        const before: number = Date.now();

        const data: Record<string, unknown> = await written(
          TelemetryException,
          { [switchColumn]: true, [atColumn]: sent },
          personProps(),
        );

        expect(data[atColumn]).toBeInstanceOf(Date);
        expect((data[atColumn] as Date).getTime()).toBeGreaterThanOrEqual(
          before,
        );
      },
    );

    test.each([
      ["isResolved", "markedAsResolvedAt"],
      ["isArchived", "markedAsArchivedAt"],
    ])("%s off: no time", async (switchColumn: string, atColumn: string) => {
      const data: Record<string, unknown> = await written(
        TelemetryException,
        { [switchColumn]: false },
        personProps(),
      );

      expect(data[atColumn]).toBeNull();
    });

    test("a time the request sends on its own is taken out", async () => {
      const service: DatabaseService<TelemetryException> =
        new DatabaseService<TelemetryException>(TelemetryException);

      const outcome: unknown = await outcomeOf(
        service.updateBy({
          query: { _id: RECORD_ID },
          data: {
            markedAsResolvedAt: new Date("2020-01-01T00:00:00.000Z"),
          } as never,
          limit: 1,
          skip: 0,
          props: personProps(),
        }),
      );

      expect((outcome as Error).message).toBe(
        refusalFor(["markedAsResolvedAt"]),
      );
    });
  });

  describe("a resource archived records who and when", () => {
    test("archiving: the person and the time", async () => {
      const data: Record<string, unknown> = await written(
        Monitor,
        { isArchived: true, archivedByUserId: new ObjectID(OTHER_USER_ID) },
        personProps(),
      );

      expect(String(data["archivedByUserId"])).toBe(USER_ID.toString());
      expect(data["archivedAt"]).toBeInstanceOf(Date);
    });

    test("restoring: neither", async () => {
      const data: Record<string, unknown> = await written(
        Monitor,
        { isArchived: false },
        personProps(),
      );

      expect(data["archivedByUserId"]).toBeNull();
      expect(data["archivedAt"]).toBeNull();
    });

    test("an API key archiving it is nobody", async () => {
      const data: Record<string, unknown> = await written(
        Monitor,
        { isArchived: true },
        apiKeyProps(),
      );

      expect(data["archivedByUserId"]).toBeNull();
      expect(data["archivedAt"]).toBeInstanceOf(Date);
    });
  });

  test("an update that asks to change only who did something is told those fields are OneUptime's", async () => {
    // Workspace rules once let their editors rewrite the creator.
    const service: DatabaseService<WorkspaceNotificationRule> =
      new DatabaseService<WorkspaceNotificationRule>(WorkspaceNotificationRule);
    const lookup: SpyInstance = getJestSpyOn(service, "_findBy");

    const outcome: unknown = await outcomeOf(
      service.updateBy({
        query: { _id: RECORD_ID },
        data: {
          createdByUserId: new ObjectID(OTHER_USER_ID),
          createdByUser: { _id: OTHER_USER_ID },
          deletedByUserId: new ObjectID(OTHER_USER_ID),
        } as never,
        limit: 1,
        skip: 0,
        props: personProps(),
      }),
    );

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as Error).message).toBe(
      refusalFor(
        UserAttribution.getColumns(new WorkspaceNotificationRule()).filter(
          (column: string): boolean => {
            return [
              "createdByUserId",
              "createdByUser",
              "deletedByUserId",
            ].includes(column);
          },
        ),
      ),
    );
    // Nothing was read or written.
    expect(lookup).not.toHaveBeenCalled();
  });

  test("OneUptime's own update of only who did something goes on", async () => {
    const data: Record<string, unknown> = await written(
      WorkspaceNotificationRule,
      { createdByUserId: new ObjectID(OTHER_USER_ID) },
      SERVER_PROPS,
    );

    expect(String(data["createdByUserId"])).toBe(OTHER_USER_ID);
  });

  test("the rest of the update goes on", async () => {
    const data: Record<string, unknown> = await written(
      Monitor,
      { name: "Payments API", createdByUserId: new ObjectID(OTHER_USER_ID) },
      personProps(),
    );

    expect(data).toEqual({ name: "Payments API" });
  });
});

/*
 * Who triggered an on-call policy, who added an incident to an episode:
 * columns about the request itself. A request names nobody there either;
 * the service stamps the person making it.
 */
describe("the other columns about who did something", () => {
  const executionLog: AttributionCase = CASES.find(
    (attributionCase: AttributionCase): boolean => {
      return attributionCase.modelType === OnCallDutyPolicyExecutionLog;
    },
  )!;

  test("an execution log names nobody as having triggered or acknowledged it", async () => {
    const reached: Reached = await create(
      executionLog,
      {
        triggeredByUserId: new ObjectID(OTHER_USER_ID),
        triggeredByUser: { _id: OTHER_USER_ID },
        acknowledgedByUserId: new ObjectID(OTHER_USER_ID),
      },
      apiKeyProps(permissionsToWrite(executionLog)),
    );

    expect(reached.outcome).toBeInstanceOf(PastTheRule);
    expect(reached.data?.["triggeredByUserId"]).toBeUndefined();
    expect(reached.data?.["triggeredByUser"]).toBeUndefined();
    expect(reached.data?.["acknowledgedByUserId"]).toBeUndefined();
  });
});

describe("the person a hook reads as the creator (CreatedByUser.getId)", () => {
  test("is the person making the request, whatever the write names", () => {
    expect(
      CreatedByUser.getId(
        { createdByUserId: new ObjectID(OTHER_USER_ID) },
        personProps(),
      )?.toString(),
    ).toBe(USER_ID.toString());
  });

  test("with no person, is the one OneUptime's own write names, under either name", () => {
    expect(
      CreatedByUser.getId(
        { createdByUser: { _id: OTHER_USER_ID } },
        SERVER_PROPS,
      )?.toString(),
    ).toBe(OTHER_USER_ID);
  });

  test("with no person and nobody named, is nobody", () => {
    expect(CreatedByUser.getId({}, apiKeyProps())).toBeNull();
    expect(CreatedByUser.getId(undefined, workflowProps())).toBeNull();
  });

  test("two different people under the two names are refused", () => {
    expect(() => {
      return CreatedByUser.getId(
        {
          createdByUserId: new ObjectID(OTHER_USER_ID),
          createdByUser: { _id: USER_ID.toString() },
        },
        SERVER_PROPS,
      );
    }).toThrow(BadDataException);
  });
});

describe("an incident a request declares", () => {
  test("is declared by nobody when an API key names somebody", async () => {
    const reached: Reached = await create(
      CASES.find((attributionCase: AttributionCase): boolean => {
        return attributionCase.modelType === Incident;
      })!,
      {
        title: "Checkout is down",
        createdByUserId: new ObjectID(OTHER_USER_ID),
      },
      apiKeyProps(),
    );

    expect(reached.outcome).toBeInstanceOf(PastTheRule);
    expect(reached.data?.["title"]).toBe("Checkout is down");
    expect(CreatedByUser.getId(reached.data, apiKeyProps())).toBeNull();
  });
});

/*
 * Re-sending a switch as it stands - Terraform sends a resource's whole
 * state on every apply, an edit form re-sends what it shows - turns nothing:
 * the row keeps who turned it, and when. Only a row whose switch really
 * turns takes the stamps. These run the whole update path down to each
 * row's write; only the rows read and the writes are stubbed.
 */
describe("a switch re-sent as it stands keeps who turned it, and when", () => {
  interface RowWrites {
    writes: Array<Record<string, unknown>>;
    audited: Array<Record<string, unknown>>;
  }

  const ROW_IDS: Array<string> = [
    "0193c0de-aaaa-4aaa-8bbb-000000000101",
    "0193c0de-aaaa-4aaa-8bbb-000000000102",
  ];

  async function rowsWritten<TBaseModel extends DatabaseBaseModel>(
    modelType: { new (): TBaseModel },
    rows: Array<Record<string, unknown>>,
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<RowWrites> {
    const service: DatabaseService<TBaseModel> =
      new DatabaseService<TBaseModel>(modelType);
    const writes: Array<Record<string, unknown>> = [];
    const audited: Array<Record<string, unknown>> = [];

    getJestSpyOn(service, "_findBy").mockResolvedValue(
      rows.map(
        (row: Record<string, unknown>, index: number): DatabaseBaseModel => {
          return payloadFor(modelType, {
            ...row,
            _id: ROW_IDS[index],
            projectId: PROJECT_ID,
          });
        },
      ) as never,
    );
    getJestSpyOn(service, "getRepository").mockReturnValue({
      update: async (
        _where: unknown,
        written: Record<string, unknown>,
      ): Promise<{ affected: number }> => {
        const row: Record<string, unknown> = { ...written };
        delete row["version"];
        writes.push(row);
        return { affected: 1 };
      },
    } as never);
    getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
      undefined as never,
    );
    getJestSpyOn(AuditLogService, "recordUpdate").mockImplementation(
      async (record: { updatedFields: unknown }): Promise<void> => {
        audited.push({
          ...(record.updatedFields as Record<string, unknown>),
        });
      },
    );

    await service.updateBy({
      query: { _id: RECORD_ID },
      data: values as never,
      limit: 10,
      skip: 0,
      props: props,
    });

    return { writes, audited };
  }

  test("resolving an exception that is already resolved keeps who resolved it, and when", async () => {
    const { writes } = await rowsWritten(
      TelemetryException,
      [{ isResolved: true }],
      { isResolved: true },
      personProps(),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ isResolved: true });
  });

  test("resolving one that is not records the person, and the time", async () => {
    const { writes } = await rowsWritten(
      TelemetryException,
      [{ isResolved: false }],
      { isResolved: true },
      personProps(),
    );

    expect(String(writes[0]!["markedAsResolvedByUserId"])).toBe(
      USER_ID.toString(),
    );
    expect(writes[0]!["markedAsResolvedAt"]).toBeInstanceOf(Date);
  });

  test("one update over two rows stamps only the row that turns", async () => {
    const { writes } = await rowsWritten(
      TelemetryException,
      [{ isArchived: true }, { isArchived: false }],
      { isArchived: true },
      personProps(),
    );

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({ isArchived: true });
    expect(String(writes[1]!["markedAsArchivedByUserId"])).toBe(
      USER_ID.toString(),
    );
    expect(writes[1]!["markedAsArchivedAt"]).toBeInstanceOf(Date);
  });

  test("reopening a resolved one clears who and when", async () => {
    const { writes } = await rowsWritten(
      TelemetryException,
      [{ isResolved: true }],
      { isResolved: false },
      personProps(),
    );

    expect(writes[0]).toEqual({
      isResolved: false,
      markedAsResolvedByUserId: null,
      markedAsResolvedAt: null,
    });
  });

  test("an edit that re-sends an archived resource's switch keeps who archived it, and the audit log says only what changed", async () => {
    const { writes, audited } = await rowsWritten(
      Monitor,
      [{ isArchived: true, name: "Checkout API" }],
      { isArchived: true, name: "Checkout API v2" },
      personProps(),
    );

    expect(writes[0]).toEqual({ isArchived: true, name: "Checkout API v2" });
    expect(audited).toHaveLength(1);
    expect(audited[0]).not.toHaveProperty("archivedAt");
    expect(audited[0]).not.toHaveProperty("archivedByUserId");
  });

  test("archiving a resource that is not archived records who and when, in the audit log too", async () => {
    const { writes, audited } = await rowsWritten(
      Monitor,
      [{ isArchived: false }],
      { isArchived: true },
      personProps(),
    );

    expect(String(writes[0]!["archivedByUserId"])).toBe(USER_ID.toString());
    expect(writes[0]!["archivedAt"]).toBeInstanceOf(Date);
    expect(String(audited[0]!["archivedByUserId"])).toBe(USER_ID.toString());
  });
});
