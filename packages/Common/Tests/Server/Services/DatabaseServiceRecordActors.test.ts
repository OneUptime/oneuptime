import Entities from "../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import User from "../../../Models/DatabaseModels/User";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { Service as MonitorGroupService } from "../../../Server/Services/MonitorGroupService";
import QueryPermission from "../../../Server/Types/Database/Permissions/QueryPermission";
import SelectPermission from "../../../Server/Types/Database/Permissions/SelectPermission";
import Query from "../../../Server/Types/Database/Query";
import Select from "../../../Server/Types/Database/Select";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RecordActorType, {
  CREATED_BY_ACTOR_COLUMNS,
  LAST_MODIFIED_COLUMNS,
  RECORD_ACTOR_COLUMNS,
} from "../../../Types/Database/RecordActor";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
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
 * WHAT CREATED A RECORD, AND WHO LAST MODIFIED IT (#10290).
 *
 * Every record keeps, on the base model, what created it and when, by whom,
 * it was last modified (Types/Database/RecordActor). DatabaseService stamps
 * both: a create beside the creator's id, and an update on each row it
 * really changes. These drive the real write path - the generic service
 * every service extends, and MonitorGroupService with its own hooks - down
 * to the row it would insert or write; only the INSERT, the rows read and
 * the UPDATE are stubbed.
 *
 * What they pin:
 *
 *  - each kind of caller is recorded as what it is: a person, an API key
 *    (and which), a workflow (and which), an MCP client for its member, a
 *    server admin, OneUptime itself - never an API key or a workflow as a
 *    person;
 *  - OneUptime's own rewrites are no one's change: they leave the last
 *    change as it was;
 *  - a row written back as it was keeps its last change, and a change of
 *    one row of several stamps that row alone;
 *  - the stamp is not what the audit log or a workflow is told changed;
 *  - no request writes them, and nobody reads them who may not read who
 *    created the record.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);

// The person making the request.
const USER_ID: ObjectID = new ObjectID("0193c0de-cccc-4aaa-8bbb-0000000000e1");

// Somebody else, whom a write names.
const OTHER_USER_ID: string = "0193c0de-cccc-4aaa-8bbb-0000000000f2";

const API_KEY_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-0000000000a1",
);
const WORKFLOW_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-0000000000c1",
);
const GRANT_ID: ObjectID = new ObjectID("0193c0de-cccc-4aaa-8bbb-0000000000d1");

const RECORD_ID: string = "0193c0de-cccc-4aaa-8bbb-0000000000b1";

type ModelType = { new (): DatabaseBaseModel };

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

function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    apiKeyId: API_KEY_ID,
    apiKeyName: "Terraform",
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: grant([Permission.ProjectOwner]),
    },
  };
}

function workflowProps(): DatabaseCommonInteractionProps {
  return {
    ...WorkflowPrincipal.getPropsWithoutPlan({
      projectId: PROJECT_ID,
      workflowId: WORKFLOW_ID,
      workflowName: "Close stale incidents",
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// An MCP client a member connected with OAuth, acting for them.
function mcpClientProps(): DatabaseCommonInteractionProps {
  return {
    ...personProps(),
    mcpOAuthGrantId: GRANT_ID,
    mcpClientName: "Claude Code",
  };
}

// The admin dashboard: a server admin, signed in.
function adminDashboardProps(): DatabaseCommonInteractionProps {
  return {
    isMasterAdmin: true,
    userId: USER_ID,
    userType: UserType.MasterAdmin,
  };
}

// OneUptime's own server code: root, with no project on the request.
const SERVER_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

// An engine writing a project's records: root, with the project on it.
const ENGINE_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  tenantId: PROJECT_ID,
};

// OneUptime's own code acting for the person who clicked.
const SERVER_WITH_PERSON_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
  userId: USER_ID,
};

async function outcomeOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return "written";
  } catch (error) {
    return error;
  }
}

function idText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The whole create path, up to the row it would insert: the hooks, the
 * permission check and the stamps all run. Only the INSERT is not made.
 */
describe("what created a record, end to end", () => {
  class PastTheStamp extends Error {}

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

  // A request that claims the record was made by somebody else, by anything.
  const CLAIMING_SOMEBODY_ELSE: Record<string, unknown> = {
    createdByActorType: RecordActorType.System,
    createdByActorId: new ObjectID(OTHER_USER_ID),
    lastModifiedAt: new Date("2020-01-01T00:00:00.000Z"),
    lastModifiedByActorType: RecordActorType.User,
    lastModifiedByActorId: new ObjectID(OTHER_USER_ID),
    lastModifiedByUserId: new ObjectID(OTHER_USER_ID),
    lastModifiedByUser: { _id: OTHER_USER_ID },
  };

  function lastModifiedOf(
    row: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      [...LAST_MODIFIED_COLUMNS, "lastModifiedByUser"].map(
        (column: string): [string, unknown] => {
          return [column, row[column]];
        },
      ),
    );
  }

  const NOT_MODIFIED: Record<string, unknown> = {
    lastModifiedAt: undefined,
    lastModifiedByActorType: undefined,
    lastModifiedByActorId: undefined,
    lastModifiedByUserId: undefined,
    lastModifiedByUser: undefined,
  };

  test("a person's note was created by that person", async () => {
    const row: Record<string, unknown> = await inserted(
      CLAIMING_SOMEBODY_ELSE,
      personProps(),
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.User);
    expect(row["createdByActorId"]).toBeUndefined();
    expect(idText(row["createdByUserId"])).toBe(USER_ID.toString());
    // A new record has not been modified yet, whatever the request says.
    expect(lastModifiedOf(row)).toEqual(NOT_MODIFIED);
  });

  test("a note a person who holds only its own create permission makes is not refused for the stamps", async () => {
    const row: Record<string, unknown> = await inserted(
      {},
      personProps([
        Permission.CreateIncidentInternalNote,
        Permission.ReadProjectIncident,
      ]),
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.User);
  });

  test("an API key's note was created by that key, and by no person", async () => {
    const row: Record<string, unknown> = await inserted(
      CLAIMING_SOMEBODY_ELSE,
      apiKeyProps(),
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.ApiKey);
    expect(idText(row["createdByActorId"])).toBe(API_KEY_ID.toString());
    expect(row["createdByUserId"]).toBeUndefined();
    expect(lastModifiedOf(row)).toEqual(NOT_MODIFIED);
  });

  test("a workflow's note was created by that workflow, and by no person", async () => {
    const row: Record<string, unknown> = await inserted(
      CLAIMING_SOMEBODY_ELSE,
      workflowProps(),
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.Workflow);
    expect(idText(row["createdByActorId"])).toBe(WORKFLOW_ID.toString());
    expect(row["createdByUserId"]).toBeUndefined();
  });

  test("an MCP client's note was created by the client, for its member", async () => {
    const row: Record<string, unknown> = await inserted(
      CLAIMING_SOMEBODY_ELSE,
      mcpClientProps(),
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.McpClient);
    expect(idText(row["createdByActorId"])).toBe(GRANT_ID.toString());
    expect(idText(row["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("the admin dashboard's note was created by the server admin", async () => {
    const row: Record<string, unknown> = await inserted(
      CLAIMING_SOMEBODY_ELSE,
      adminDashboardProps(),
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.MasterAdmin);
    expect(row["createdByActorId"]).toBeUndefined();
    expect(idText(row["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("a note OneUptime makes on its own was created by OneUptime", async () => {
    const row: Record<string, unknown> = await inserted({}, SERVER_PROPS);

    expect(row["createdByActorType"]).toBe(RecordActorType.System);
    expect(row["createdByActorId"]).toBeUndefined();
    expect(row["createdByUserId"]).toBeUndefined();
  });

  test("a note an engine writes in a project was created by OneUptime, whatever it was handed", async () => {
    const row: Record<string, unknown> = await inserted(
      CLAIMING_SOMEBODY_ELSE,
      ENGINE_PROPS,
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.System);
    expect(row["createdByActorId"]).toBeUndefined();
    expect(lastModifiedOf(row)).toEqual(NOT_MODIFIED);
  });

  test("a note OneUptime makes for the person it names was created by that person", async () => {
    const row: Record<string, unknown> = await inserted(
      { createdByUserId: new ObjectID(OTHER_USER_ID) },
      SERVER_PROPS,
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.User);
    expect(idText(row["createdByUserId"])).toBe(OTHER_USER_ID);
  });

  test("a note OneUptime makes acting for the person who clicked was created by that person", async () => {
    const row: Record<string, unknown> = await inserted(
      {},
      SERVER_WITH_PERSON_PROPS,
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.User);
    expect(idText(row["createdByUserId"])).toBe(USER_ID.toString());
  });

  test("OneUptime's own write keeps the kind it names", async () => {
    const row: Record<string, unknown> = await inserted(
      {
        createdByActorType: RecordActorType.Workflow,
        createdByActorId: WORKFLOW_ID,
      },
      SERVER_PROPS,
    );

    expect(row["createdByActorType"]).toBe(RecordActorType.Workflow);
    expect(idText(row["createdByActorId"])).toBe(WORKFLOW_ID.toString());
  });
});

/*
 * The whole update path down to each row's write: the hooks, the
 * permission checks, the stamps and the audit entry all run. Only the rows
 * read, the UPDATE itself and the workflow and realtime events are stubbed.
 */
describe("who last modified a record, end to end", () => {
  interface RowWrites {
    writes: Array<Record<string, unknown>>;
    audited: Array<Record<string, unknown>>;
    outcome: unknown;
  }

  const ROW_IDS: Array<string> = [
    "0193c0de-cccc-4aaa-8bbb-000000000101",
    "0193c0de-cccc-4aaa-8bbb-000000000102",
  ];

  function rowFor(
    modelType: ModelType,
    values: Record<string, unknown>,
  ): DatabaseBaseModel {
    const row: DatabaseBaseModel = new modelType();

    for (const [key, value] of Object.entries(values)) {
      (row as unknown as Record<string, unknown>)[key] = value;
    }

    return row;
  }

  async function rowsWritten<TBaseModel extends DatabaseBaseModel>(data: {
    service: DatabaseService<TBaseModel>;
    rows: Array<Record<string, unknown>>;
    values: Record<string, unknown>;
    props: DatabaseCommonInteractionProps;
  }): Promise<RowWrites> {
    const { service } = data;
    const writes: Array<Record<string, unknown>> = [];
    const audited: Array<Record<string, unknown>> = [];

    getJestSpyOn(service, "_findBy").mockResolvedValue(
      data.rows.map(
        (row: Record<string, unknown>, index: number): DatabaseBaseModel => {
          return rowFor(service.modelType, {
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

    const outcome: unknown = await outcomeOf(
      service.updateBy({
        query: { _id: RECORD_ID } as never,
        data: data.values as never,
        limit: 10,
        skip: 0,
        props: data.props,
      }),
    );

    return { writes, audited, outcome };
  }

  function monitorRowsWritten(
    rows: Array<Record<string, unknown>>,
    values: Record<string, unknown>,
    props: DatabaseCommonInteractionProps,
  ): Promise<RowWrites> {
    return rowsWritten({
      service: new DatabaseService<Monitor>(Monitor),
      rows,
      values,
      props,
    });
  }

  function stampOf(row: Record<string, unknown>): Record<string, unknown> {
    return {
      lastModifiedByActorType: row["lastModifiedByActorType"],
      lastModifiedByActorId: idText(row["lastModifiedByActorId"]),
      lastModifiedByUserId: idText(row["lastModifiedByUserId"]),
    };
  }

  interface ChangerCase {
    name: string;
    props: () => DatabaseCommonInteractionProps;
    stamp: Record<string, unknown>;
  }

  const CHANGERS: Array<ChangerCase> = [
    {
      name: "a person",
      props: personProps,
      stamp: {
        lastModifiedByActorType: "User",
        lastModifiedByActorId: null,
        lastModifiedByUserId: USER_ID.toString(),
      },
    },
    {
      name: "an API key, and no person",
      props: apiKeyProps,
      stamp: {
        lastModifiedByActorType: "ApiKey",
        lastModifiedByActorId: API_KEY_ID.toString(),
        lastModifiedByUserId: null,
      },
    },
    {
      name: "a workflow, and no person",
      props: workflowProps,
      stamp: {
        lastModifiedByActorType: "Workflow",
        lastModifiedByActorId: WORKFLOW_ID.toString(),
        lastModifiedByUserId: null,
      },
    },
    {
      name: "an MCP client, for its member",
      props: mcpClientProps,
      stamp: {
        lastModifiedByActorType: "McpClient",
        lastModifiedByActorId: GRANT_ID.toString(),
        lastModifiedByUserId: USER_ID.toString(),
      },
    },
    {
      name: "a server admin",
      props: adminDashboardProps,
      stamp: {
        lastModifiedByActorType: "MasterAdmin",
        lastModifiedByActorId: null,
        lastModifiedByUserId: USER_ID.toString(),
      },
    },
    {
      name: "the person OneUptime's own code acts for",
      props: () => {
        return SERVER_WITH_PERSON_PROPS;
      },
      stamp: {
        lastModifiedByActorType: "User",
        lastModifiedByActorId: null,
        lastModifiedByUserId: USER_ID.toString(),
      },
    },
  ];

  describe.each(CHANGERS)("a change $name makes", (changer: ChangerCase) => {
    test("stamps the row with who made it, and when", async () => {
      const before: number = Date.now();

      const { writes, outcome } = await monitorRowsWritten(
        [{ name: "Checkout API" }],
        { name: "Checkout API v2" },
        changer.props(),
      );

      expect(outcome).toBe("written");
      expect(writes).toHaveLength(1);
      expect(writes[0]!["name"]).toBe("Checkout API v2");
      expect(stampOf(writes[0]!)).toEqual(changer.stamp);

      const at: unknown = writes[0]!["lastModifiedAt"];
      expect(at).toBeInstanceOf(Date);
      expect((at as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect((at as Date).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    test("through MonitorGroupService and its hooks too", async () => {
      const { writes, outcome } = await rowsWritten({
        service: new MonitorGroupService(),
        rows: [{ name: "Payments" }],
        values: { name: "Payments (EU)" },
        props: changer.props(),
      });

      expect(outcome).toBe("written");
      expect(writes).toHaveLength(1);
      expect(writes[0]!["name"]).toBe("Payments (EU)");
      expect(stampOf(writes[0]!)).toEqual(changer.stamp);
      expect(writes[0]!["lastModifiedAt"]).toBeInstanceOf(Date);
    });

    test("is not what the audit log is told changed", async () => {
      const { audited } = await monitorRowsWritten(
        [{ name: "Checkout API" }],
        { name: "Checkout API v2" },
        changer.props(),
      );

      expect(audited).toHaveLength(1);
      expect(audited[0]).toEqual({ name: "Checkout API v2" });
    });

    test("leaves a row written back as it was as it was", async () => {
      const { writes, audited } = await monitorRowsWritten(
        [{ name: "Checkout API" }],
        { name: "Checkout API" },
        changer.props(),
      );

      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual({ name: "Checkout API" });
      expect(audited).toHaveLength(0);
    });
  });

  test.each([
    ["OneUptime on its own", SERVER_PROPS],
    ["an engine writing a project's records", ENGINE_PROPS],
  ])(
    "a change %s makes is no one's: the last change stays as it was",
    async (_name: string, props: DatabaseCommonInteractionProps) => {
      const { writes } = await monitorRowsWritten(
        [{ name: "Checkout API" }],
        { name: "Checkout API v2" },
        props,
      );

      expect(writes).toHaveLength(1);
      expect(writes[0]).toEqual({ name: "Checkout API v2" });
    },
  );

  test("one update over two rows stamps only the row it changes", async () => {
    const { writes } = await monitorRowsWritten(
      [{ name: "Checkout API v2" }, { name: "Checkout API" }],
      { name: "Checkout API v2" },
      apiKeyProps(),
    );

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({ name: "Checkout API v2" });
    expect(stampOf(writes[1]!)).toEqual({
      lastModifiedByActorType: "ApiKey",
      lastModifiedByActorId: API_KEY_ID.toString(),
      lastModifiedByUserId: null,
    });
  });

  test("a person's change after a key's names no key", async () => {
    const { writes } = await monitorRowsWritten(
      [
        {
          name: "Checkout API",
          lastModifiedByActorType: RecordActorType.ApiKey,
          lastModifiedByActorId: API_KEY_ID,
          lastModifiedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      { name: "Checkout API v2" },
      personProps(),
    );

    expect(writes[0]!["lastModifiedByActorId"]).toBeNull();
    expect(stampOf(writes[0]!)).toEqual({
      lastModifiedByActorType: "User",
      lastModifiedByActorId: null,
      lastModifiedByUserId: USER_ID.toString(),
    });
  });

  test("a change that also names somebody else as its maker is still the caller's", async () => {
    const { writes, outcome } = await monitorRowsWritten(
      [{ name: "Checkout API" }],
      {
        name: "Checkout API v2",
        lastModifiedAt: new Date("2020-01-01T00:00:00.000Z"),
        lastModifiedByActorType: RecordActorType.System,
        lastModifiedByUserId: new ObjectID(OTHER_USER_ID),
        lastModifiedByUser: { _id: OTHER_USER_ID },
        createdByActorType: RecordActorType.System,
      },
      apiKeyProps(),
    );

    expect(outcome).toBe("written");
    expect(stampOf(writes[0]!)).toEqual({
      lastModifiedByActorType: "ApiKey",
      lastModifiedByActorId: API_KEY_ID.toString(),
      lastModifiedByUserId: null,
    });
    expect(writes[0]!["createdByActorType"]).toBeUndefined();
    expect(writes[0]!["lastModifiedByUser"]).toBeUndefined();
    expect(
      (writes[0]!["lastModifiedAt"] as Date).getFullYear(),
    ).toBeGreaterThan(2020);
  });

  test("an update that asks for nothing but who modified it is told they are OneUptime's", async () => {
    const { outcome, writes } = await monitorRowsWritten(
      [{ name: "Checkout API" }],
      {
        lastModifiedAt: new Date("2020-01-01T00:00:00.000Z"),
        lastModifiedByUserId: new ObjectID(OTHER_USER_ID),
      },
      personProps(),
    );

    expect(outcome).toBeInstanceOf(BadDataException);
    expect((outcome as BadDataException).message).toBe(
      "lastModifiedAt, lastModifiedByUserId are recorded by OneUptime and cannot be changed.",
    );
    expect(writes).toHaveLength(0);
  });

  test("archiving a resource is a change of it, by the person who archived it", async () => {
    const { writes } = await monitorRowsWritten(
      [{ isArchived: false }],
      { isArchived: true },
      personProps(),
    );

    expect(String(writes[0]!["archivedByUserId"])).toBe(USER_ID.toString());
    expect(stampOf(writes[0]!)).toEqual({
      lastModifiedByActorType: "User",
      lastModifiedByActorId: null,
      lastModifiedByUserId: USER_ID.toString(),
    });
  });
});

/*
 * WHO READS THEM: whoever may read who created the record, and nobody else.
 * A role that may read a resource but not users - Monitor Viewer reads
 * monitors, and no user's own record - reads the person who last modified
 * a monitor exactly as it reads the person who created it: their name,
 * through the relation, and nothing more of them.
 */
describe("who may read what created a record and who last modified it", () => {
  const MONITOR_READER_ROLES: ReadonlyArray<Permission> = [
    Permission.MonitorViewer,
    Permission.ReadProjectMonitor,
    Permission.Viewer,
  ];

  function readerProps(
    permissions: Array<Permission>,
  ): DatabaseCommonInteractionProps {
    return {
      userId: USER_ID,
      tenantId: PROJECT_ID,
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: grant(permissions),
      },
    };
  }

  function check(
    select: Select<Monitor>,
    props: DatabaseCommonInteractionProps,
  ): unknown {
    try {
      SelectPermission.checkSelectPermission(Monitor, select, props);
      QueryPermission.checkRelationQueryPermission(
        Monitor,
        {} as Query<Monitor>,
        select,
        props,
      );
      return "allowed";
    } catch (error) {
      return error;
    }
  }

  const ACTIVITY_SELECT: Select<Monitor> = {
    _id: true,
    createdAt: true,
    createdByActorType: true,
    createdByActorId: true,
    createdByUser: { name: true, email: true },
    lastModifiedAt: true,
    lastModifiedByActorType: true,
    lastModifiedByActorId: true,
    lastModifiedByUser: { name: true, email: true },
  } as Select<Monitor>;

  test.each(
    MONITOR_READER_ROLES.map((role: Permission) => {
      return [role];
    }),
  )(
    "%s, who reads monitors and not users, reads what made a monitor and who last modified it",
    (role: Permission) => {
      expect(check(ACTIVITY_SELECT, readerProps([role]))).toBe("allowed");
    },
  );

  test("reads no more of the person who last modified it than of the person who created it", () => {
    const props: DatabaseCommonInteractionProps = readerProps([
      Permission.MonitorViewer,
    ]);

    const outcomes: Array<string> = [];

    for (const column of Object.keys(getTableColumns(new User()))) {
      const throughCreator: unknown = check(
        { createdByUser: { [column]: true } } as Select<Monitor>,
        props,
      );
      const throughModifier: unknown = check(
        { lastModifiedByUser: { [column]: true } } as Select<Monitor>,
        props,
      );

      outcomes.push(
        `${column}: created by ${
          throughCreator === "allowed" ? "allowed" : "refused"
        }, last modified by ${
          throughModifier === "allowed" ? "allowed" : "refused"
        }`,
      );

      expect(throughModifier === "allowed").toBe(throughCreator === "allowed");
    }

    // What a reader of monitors reads of either person: their name, and no secret.
    expect(outcomes).toContain(
      "name: created by allowed, last modified by allowed",
    );
    expect(outcomes).toContain(
      "password: created by refused, last modified by refused",
    );
  });

  test("a role that may not read who created a monitor may not read who last modified it", () => {
    const props: DatabaseCommonInteractionProps = readerProps([
      Permission.IncidentViewer,
    ]);

    for (const column of RECORD_ACTOR_COLUMNS) {
      const outcome: unknown = check(
        { [column]: true } as Select<Monitor>,
        props,
      );

      expect({
        column,
        refused: outcome instanceof NotAuthorizedException,
      }).toEqual({ column, refused: true });
    }

    expect(
      check({ createdByUserId: true } as Select<Monitor>, props),
    ).toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * Every model: the columns are read by who may read who created the
   * record (its createdByUserId, or the record itself when it has none),
   * never by a public visitor, and written by no request.
   */
  test("on every model, read as who created the record is read, never by Public, written by nobody", () => {
    const wrong: Array<string> = [];

    for (const modelType of Entities as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();
      const access: Record<string, ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();
      const expectedReaders: Array<Permission> = (
        access["createdByUserId"]?.read ||
        model.readRecordPermissions ||
        []
      ).filter((permission: Permission): boolean => {
        return permission !== Permission.Public;
      });

      for (const column of RECORD_ACTOR_COLUMNS) {
        const columnAccess: ColumnAccessControl | undefined = access[column];
        const name: string = `${model.tableName}.${column}`;

        if (!columnAccess) {
          wrong.push(`${name}: no access control`);
          continue;
        }

        if (columnAccess.read.includes(Permission.Public)) {
          wrong.push(`${name}: read by Public`);
        }

        if (
          JSON.stringify([...columnAccess.read].sort()) !==
          JSON.stringify([...expectedReaders].sort())
        ) {
          wrong.push(`${name}: read by ${columnAccess.read.join(", ")}`);
        }

        if (columnAccess.create.length > 0 || columnAccess.update.length > 0) {
          wrong.push(`${name}: writable`);
        }

        if (!model.getTableColumnMetadata(column)?.computed) {
          wrong.push(`${name}: not computed`);
        }
      }
    }

    expect(wrong).toEqual([]);
  });

  test("every model has them, the relation to the person who last modified it among them", () => {
    const missing: Array<string> = [];

    for (const modelType of Entities as Array<ModelType>) {
      const model: DatabaseBaseModel = new modelType();

      for (const column of RECORD_ACTOR_COLUMNS) {
        if (!model.isTableColumn(column)) {
          missing.push(`${model.tableName}.${column}`);
        }
      }

      if (
        model.getTableColumnMetadata("lastModifiedByUser")?.modelType?.name !==
        "User"
      ) {
        missing.push(`${model.tableName}.lastModifiedByUser: not a user`);
      }
    }

    expect(missing).toEqual([]);
  });

  test("a create's columns and a change's are the ones the stamps write", () => {
    expect([...CREATED_BY_ACTOR_COLUMNS]).toEqual([
      "createdByActorType",
      "createdByActorId",
    ]);
    expect([...LAST_MODIFIED_COLUMNS]).toEqual([
      "lastModifiedAt",
      "lastModifiedByActorType",
      "lastModifiedByActorId",
      "lastModifiedByUserId",
    ]);
  });
});
