import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import McpOAuthGrant from "Common/Models/DatabaseModels/McpOAuthGrant";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import EnableAuditLogOn from "Common/Types/BaseDatabase/EnableAuditLogOn";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHICH credential made a change.
 *
 * An audit entry has always said who changed something. It could not say what
 * they changed it THROUGH: every project API key's entry read "API Key", and a
 * change an MCP client made for a member would have been indistinguishable
 * from one the member made by hand in the dashboard. The middleware now puts
 * the credential on the interaction props - the key's id and name
 * (ProjectMiddleware), or the grant and client of a connected MCP client
 * (McpDelegationAuthorization) - and the recorder copies them onto the entry.
 *
 * Pinned here, against the entry that actually reaches the insert:
 *
 *   - a project API key: its id and name, and no person;
 *   - the instance master key: its name alone (it has no row, so no id),
 *     under the master admin it acts as;
 *   - a connected MCP client: the grant and the client's name, with the MEMBER
 *     still the actor - the client acts as them, so they are who did it;
 *   - an ordinary session, and a system event: none of the four;
 *   - an absent value is absent, never the string "undefined" or "";
 *   - connecting and revoking an MCP client are themselves audited, named
 *     after the client, without the bookkeeping columns and without the
 *     columns nobody may read.
 *
 * Every failure here would be silent: record* swallows its errors, and a
 * column the AuditLog model does not have throws inside the insert - which
 * drops the WHOLE entry, not just the field. So "the entry was recorded and
 * carries the value" is the assertion throughout.
 *
 * Billing and the edition are pinned as in AuditLogRecorder.test.ts; nothing
 * here touches ClickHouse or Postgres.
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const MASTER_ADMIN_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const API_KEY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const GRANT_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const OTHER_GRANT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SSO_PROVIDER_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const API_KEY_NAME: string = "CI deploy key";
const MASTER_API_KEY_NAME: string = "Master API Key";
const MCP_CLIENT_NAME: string = "Claude Code";
const MCP_CLIENT_ID: string =
  "https://claude.ai/oauth/claude-code-client-metadata";
const GRANT_RESOURCE_TYPE: string = "MCP Client Authorization";

// A member at the dashboard.
const SESSION_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

// A project API key: no person, the key is the actor.
const API_KEY_PROPS: DatabaseCommonInteractionProps = {
  userType: UserType.API,
  tenantId: PROJECT_ID,
  apiKeyId: API_KEY_ID,
  apiKeyName: API_KEY_NAME,
};

// The instance master key: it acts as the master admin user, and has no row.
const MASTER_KEY_PROPS: DatabaseCommonInteractionProps = {
  userId: MASTER_ADMIN_ID,
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
  tenantId: PROJECT_ID,
  apiKeyName: MASTER_API_KEY_NAME,
};

// The MCP server calling the API for a member who connected a client.
const MCP_CLIENT_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
  mcpOAuthGrantId: GRANT_ID,
  mcpClientName: MCP_CLIENT_NAME,
};

// A background job.
const SYSTEM_PROPS: DatabaseCommonInteractionProps = { isRoot: true };

const CREDENTIAL_COLUMNS: ReadonlyArray<string> = [
  "apiKeyId",
  "apiKeyName",
  "mcpOAuthGrantId",
  "mcpClientName",
];

interface Harness {
  recorder: AuditLogRecorder;
  inserted: Array<AuditLog>;
  insert: jest.Mock;
}

let project: Project;
let usersById: Map<string, User>;
let harness: Harness;

function makeProject(settings: {
  storeSystemEventsInAuditLogs?: boolean;
}): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = true;
  item.auditLogsRetentionInDays = 30;
  if (settings.storeSystemEventsInAuditLogs !== undefined) {
    item.storeSystemEventsInAuditLogs = settings.storeSystemEventsInAuditLogs;
  }
  return item;
}

function makeUser(id: ObjectID, name: string, email: string): User {
  const user: User = new User();
  user._id = id.toString();
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function createHarness(): Harness {
  const inserted: Array<AuditLog> = [];

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  const recorder: AuditLogRecorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    return Promise.resolve(usersById.get(findOneById.id.toString()) || null);
  }) as never);

  return { recorder, inserted, insert };
}

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.name = "Checkout API";
  return monitor;
}

/*
 * A grant as the consent endpoint writes it and the token endpoint then
 * activates it: every column set, including the bookkeeping the audit trail
 * ignores and the columns nobody may read.
 */
function makeGrant(): McpOAuthGrant {
  const grant: McpOAuthGrant = new McpOAuthGrant();
  grant._id = GRANT_ID.toString();
  grant.projectId = PROJECT_ID;
  grant.userId = USER_ID;
  grant.name = MCP_CLIENT_NAME;
  grant.clientId = MCP_CLIENT_ID;
  grant.scope = "mcp:read mcp:write";
  grant.resource = "https://oneuptime.example.com/mcp";
  grant.activatedAt = new Date("2026-10-01T09:00:00.000Z");
  grant.expiresAt = new Date("2026-10-31T09:00:00.000Z");
  grant.lastUsedAt = new Date("2026-10-01T09:05:00.000Z");
  grant.ssoProviderType = SsoProviderType.ProjectSSO;
  grant.ssoProviderId = SSO_PROVIDER_ID;
  grant.ssoExpiresAt = new Date("2026-10-02T09:00:00.000Z");
  return grant;
}

function onlyEntry(): AuditLog {
  expect(harness.inserted).toHaveLength(1);
  return harness.inserted[0]!;
}

function fieldsOf(entry: AuditLog): Array<string> {
  return ((entry.changes || []) as Array<JSONObject>).map(
    (change: JSONObject): string => {
      return String(change["field"]);
    },
  );
}

function changeFor(entry: AuditLog, field: string): JSONObject | undefined {
  return ((entry.changes || []) as Array<JSONObject>).find(
    (change: JSONObject): boolean => {
      return change["field"] === field;
    },
  );
}

/*
 * The credential columns the entry actually holds, ids as their strings. A
 * column that was never set is absent, so `{}` means "none of the four".
 */
function credentialOf(entry: AuditLog): JSONObject {
  const credential: JSONObject = {};

  for (const column of CREDENTIAL_COLUMNS) {
    const value: unknown = entry.getColumnValue(column);

    if (value === undefined) {
      continue;
    }

    credential[column] =
      value instanceof ObjectID ? value.toString() : (value as string);
  }

  return credential;
}

async function recordMonitorCreate(
  props: DatabaseCommonInteractionProps,
): Promise<void> {
  await harness.recorder.recordCreate({
    model: new Monitor(),
    createdItem: makeMonitor(),
    props,
  });
}

beforeEach(() => {
  // Self-hosted Enterprise Edition with a valid license: everything records.
  setTestBillingEnabled(false);
  project = makeProject({});
  usersById = new Map<string, User>([
    [USER_ID.toString(), makeUser(USER_ID, "Ada Lovelace", "ada@example.com")],
    [
      MASTER_ADMIN_ID.toString(),
      makeUser(MASTER_ADMIN_ID, "Root Admin", "root@example.com"),
    ],
  ]);
  harness = createHarness();
  installFakeEnterpriseModule({ auditLogRecorder: harness.recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("an API key's change says which key", () => {
  test("a project API key's entry carries the key's id and name, and no person", async () => {
    await recordMonitorCreate(API_KEY_PROPS);

    const entry: AuditLog = onlyEntry();

    expect(entry.apiKeyId).toBeInstanceOf(ObjectID);
    expect(entry.apiKeyId?.toString()).toBe(API_KEY_ID.toString());
    expect(entry.apiKeyName).toBe(API_KEY_NAME);
    expect(entry.userType).toBe(UserType.API);

    // The key is the actor: there is no user behind it to look up.
    expect(entry.userId).toBeUndefined();
    expect(entry.userName).toBeUndefined();
    expect(entry.userEmail).toBeUndefined();
    expect(findUserMock).not.toHaveBeenCalled();

    // And it is not a connected MCP client.
    expect(entry.mcpOAuthGrantId).toBeUndefined();
    expect(entry.mcpClientName).toBeUndefined();
  });

  test("two keys in one project are told apart by their entries", async () => {
    const otherKeyId: ObjectID = new ObjectID(
      "99999999-9999-4999-8999-999999999999",
    );

    await recordMonitorCreate(API_KEY_PROPS);
    await recordMonitorCreate({
      ...API_KEY_PROPS,
      apiKeyId: otherKeyId,
      apiKeyName: "Terraform",
    });

    expect(harness.inserted).toHaveLength(2);
    expect(
      harness.inserted.map((entry: AuditLog): JSONObject => {
        return credentialOf(entry);
      }),
    ).toEqual([
      { apiKeyId: API_KEY_ID.toString(), apiKeyName: API_KEY_NAME },
      { apiKeyId: otherKeyId.toString(), apiKeyName: "Terraform" },
    ]);
  });

  test("a key that was resolved without a name still records its id", async () => {
    await recordMonitorCreate({
      userType: UserType.API,
      tenantId: PROJECT_ID,
      apiKeyId: API_KEY_ID,
    });

    expect(credentialOf(onlyEntry())).toEqual({
      apiKeyId: API_KEY_ID.toString(),
    });
  });

  test("the master API key's entry carries its name alone, under the master admin it acts as", async () => {
    await recordMonitorCreate(MASTER_KEY_PROPS);

    const entry: AuditLog = onlyEntry();

    // No row in ApiKey, so there is a name and no id.
    expect(credentialOf(entry)).toEqual({ apiKeyName: MASTER_API_KEY_NAME });
    expect(entry.apiKeyId).toBeUndefined();

    expect(entry.userType).toBe(UserType.MasterAdmin);
    expect(entry.userId?.toString()).toBe(MASTER_ADMIN_ID.toString());
    expect(entry.userName).toBe("Root Admin");
    expect(entry.userEmail).toBe("root@example.com");
  });
});

describe("a connected MCP client's change says which client, and which member", () => {
  test("the entry carries the grant and the client's name, and the member is still the actor", async () => {
    await recordMonitorCreate(MCP_CLIENT_PROPS);

    const entry: AuditLog = onlyEntry();

    expect(entry.mcpOAuthGrantId).toBeInstanceOf(ObjectID);
    expect(entry.mcpOAuthGrantId?.toString()).toBe(GRANT_ID.toString());
    expect(entry.mcpClientName).toBe(MCP_CLIENT_NAME);

    // The client acts as the member, so the member is who did it.
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userEmail).toBe("ada@example.com");
    expect(entry.userType).toBe(UserType.User);

    // And it is not an API key's change.
    expect(entry.apiKeyId).toBeUndefined();
    expect(entry.apiKeyName).toBeUndefined();
  });

  test("it is recorded as a person's change, not a system event, even though the project drops system events", async () => {
    project = makeProject({ storeSystemEventsInAuditLogs: false });
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await recordMonitorCreate(MCP_CLIENT_PROPS);

    expect(onlyEntry().userType).toBe(UserType.User);
  });

  test("two clients one member connected are told apart by their entries", async () => {
    await recordMonitorCreate(MCP_CLIENT_PROPS);
    await recordMonitorCreate({
      ...MCP_CLIENT_PROPS,
      mcpOAuthGrantId: OTHER_GRANT_ID,
      mcpClientName: "Cursor",
    });

    expect(
      harness.inserted.map((entry: AuditLog): JSONObject => {
        return credentialOf(entry);
      }),
    ).toEqual([
      { mcpOAuthGrantId: GRANT_ID.toString(), mcpClientName: MCP_CLIENT_NAME },
      { mcpOAuthGrantId: OTHER_GRANT_ID.toString(), mcpClientName: "Cursor" },
    ]);

    // Both are the same member's.
    expect(
      harness.inserted.map((entry: AuditLog): string | undefined => {
        return entry.userId?.toString();
      }),
    ).toEqual([USER_ID.toString(), USER_ID.toString()]);
  });

  test("the client's name is recorded as it was given, not interpreted", async () => {
    const oddName: string = '<b>Evil</b> "Client" & co';

    await recordMonitorCreate({ ...MCP_CLIENT_PROPS, mcpClientName: oddName });

    expect(onlyEntry().mcpClientName).toBe(oddName);
  });
});

describe("a change with no such credential says nothing about one", () => {
  test("an ordinary session records none of the four columns", async () => {
    await recordMonitorCreate(SESSION_PROPS);

    const entry: AuditLog = onlyEntry();

    expect(credentialOf(entry)).toEqual({});
    for (const column of CREDENTIAL_COLUMNS) {
      expect(entry.getColumnValue(column)).toBeUndefined();
    }

    // The entry itself is the ordinary one.
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userType).toBe(UserType.User);
  });

  test("a system event records none of the four columns", async () => {
    project = makeProject({ storeSystemEventsInAuditLogs: true });
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await recordMonitorCreate(SYSTEM_PROPS);

    const entry: AuditLog = onlyEntry();

    expect(entry.userType).toBe("System");
    expect(credentialOf(entry)).toEqual({});
  });

  test.each([
    {
      name: "undefined",
      props: {
        apiKeyId: undefined,
        apiKeyName: undefined,
        mcpOAuthGrantId: undefined,
        mcpClientName: undefined,
      },
    },
    {
      name: "an empty name",
      props: { apiKeyName: "", mcpClientName: "" },
    },
    {
      name: "null (a value that came off the wire)",
      props: {
        apiKeyId: null,
        apiKeyName: null,
        mcpOAuthGrantId: null,
        mcpClientName: null,
      },
    },
  ])(
    "a credential field that is $name is left out, never written as a string",
    async (data: { props: Record<string, unknown> }) => {
      await recordMonitorCreate({
        ...SESSION_PROPS,
        ...(data.props as unknown as DatabaseCommonInteractionProps),
      });

      const entry: AuditLog = onlyEntry();

      expect(credentialOf(entry)).toEqual({});

      const serialized: string = JSON.stringify(entry.toJSON());
      expect(serialized).not.toContain('"undefined"');
      expect(serialized).not.toContain('"null"');
      expect(serialized).not.toContain('apiKeyName":""');
      expect(serialized).not.toContain('mcpClientName":""');
    },
  );

  test("only the half that is present is written: an id without a name, a name without an id", async () => {
    await recordMonitorCreate({ ...SESSION_PROPS, mcpOAuthGrantId: GRANT_ID });
    await recordMonitorCreate({
      ...SESSION_PROPS,
      mcpClientName: MCP_CLIENT_NAME,
    });

    expect(
      harness.inserted.map((entry: AuditLog): JSONObject => {
        return credentialOf(entry);
      }),
    ).toEqual([
      { mcpOAuthGrantId: GRANT_ID.toString() },
      { mcpClientName: MCP_CLIENT_NAME },
    ]);
  });
});

describe("the credential is on every kind of entry", () => {
  interface CredentialCase {
    credential: string;
    props: DatabaseCommonInteractionProps;
    expected: JSONObject;
  }

  const CREDENTIAL_CASES: Array<CredentialCase> = [
    {
      credential: "a project API key",
      props: API_KEY_PROPS,
      expected: {
        apiKeyId: API_KEY_ID.toString(),
        apiKeyName: API_KEY_NAME,
      },
    },
    {
      credential: "the master API key",
      props: MASTER_KEY_PROPS,
      expected: { apiKeyName: MASTER_API_KEY_NAME },
    },
    {
      credential: "a connected MCP client",
      props: MCP_CLIENT_PROPS,
      expected: {
        mcpOAuthGrantId: GRANT_ID.toString(),
        mcpClientName: MCP_CLIENT_NAME,
      },
    },
    {
      credential: "an ordinary session",
      props: SESSION_PROPS,
      expected: {},
    },
  ];

  test.each(CREDENTIAL_CASES)(
    "$credential: create, update and delete entries all carry it",
    async (data: CredentialCase) => {
      await harness.recorder.recordCreate({
        model: new Monitor(),
        createdItem: makeMonitor(),
        props: data.props,
      });
      await harness.recorder.recordUpdate({
        model: new Monitor(),
        before: makeMonitor(),
        updatedFields: { name: "Checkout API (primary)" },
        itemId: MONITOR_ID,
        props: data.props,
      });
      await harness.recorder.recordDelete({
        model: new Monitor(),
        deletedItem: makeMonitor(),
        itemId: MONITOR_ID,
        props: data.props,
      });

      expect(
        harness.inserted.map((entry: AuditLog): string | undefined => {
          return entry.action;
        }),
      ).toEqual([
        AuditLogAction.Create,
        AuditLogAction.Update,
        AuditLogAction.Delete,
      ]);

      for (const entry of harness.inserted) {
        expect(credentialOf(entry)).toEqual(data.expected);
      }
    },
  );

  test("it reaches the entry through core's AuditLogService delegate, the way DatabaseService records", async () => {
    await CoreAuditLogService.recordCreate({
      model: new Monitor(),
      createdItem: makeMonitor(),
      props: MCP_CLIENT_PROPS,
    });

    expect(credentialOf(onlyEntry())).toEqual({
      mcpOAuthGrantId: GRANT_ID.toString(),
      mcpClientName: MCP_CLIENT_NAME,
    });
  });

  test("the credential never changes whether an entry is written: the insert still runs as root", async () => {
    await recordMonitorCreate(MCP_CLIENT_PROPS);

    expect(harness.insert).toHaveBeenCalledTimes(1);
    expect(
      (harness.insert.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("the credential says nothing about what changed: it is not in the entry's changes", async () => {
    await recordMonitorCreate(MCP_CLIENT_PROPS);

    const fields: Array<string> = fieldsOf(onlyEntry());

    for (const column of CREDENTIAL_COLUMNS) {
      expect(fields).not.toContain(column);
    }
  });
});

describe("connecting and revoking an MCP client are audited", () => {
  test("the model asks for create and delete entries, and no update entries", () => {
    const config: EnableAuditLogOn | undefined = new McpOAuthGrant()
      .enableAuditLogOn;

    expect(config?.create).toBe(true);
    expect(config?.delete).toBe(true);
    // After creation the only writes are bookkeeping; none is worth a line.
    expect(config?.update).toBe(false);
    expect([...(config?.ignoreColumns || [])].sort()).toEqual([
      "activatedAt",
      "expiresAt",
      "lastUsedAt",
    ]);
    // A top-level resource: its entries point at themselves.
    expect(config?.rootResource).toBeUndefined();
  });

  test("the entry is filed under the name the Dashboard looks its icon up by", () => {
    expect(new McpOAuthGrant().singularName).toBe(GRANT_RESOURCE_TYPE);
  });

  test("a member approving a client is recorded as that member connecting it, named after the client", async () => {
    /*
     * How McpOAuthGrantService.createPendingGrant writes: as root (nothing
     * may create a grant through the CRUD API) but NAMING the member, so the
     * entry is theirs and not a system event.
     */
    await harness.recorder.recordCreate({
      model: new McpOAuthGrant(),
      createdItem: makeGrant(),
      props: {
        isRoot: true,
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
      },
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe(GRANT_RESOURCE_TYPE);
    expect(entry.resourceId?.toString()).toBe(GRANT_ID.toString());
    expect(entry.resourceName).toBe(MCP_CLIENT_NAME);
    expect(entry.rootResourceType).toBe(GRANT_RESOURCE_TYPE);
    expect(entry.rootResourceId?.toString()).toBe(GRANT_ID.toString());
    expect(entry.projectId?.toString()).toBe(PROJECT_ID.toString());

    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userType).toBe(UserType.User);

    // What was granted is on the record.
    expect(changeFor(entry, "name")).toEqual({
      field: "name",
      newValue: MCP_CLIENT_NAME,
    });
    expect(changeFor(entry, "clientId")).toEqual({
      field: "clientId",
      newValue: MCP_CLIENT_ID,
    });
    expect(changeFor(entry, "scope")).toEqual({
      field: "scope",
      newValue: "mcp:read mcp:write",
    });
    expect(changeFor(entry, "userId")).toEqual({
      field: "userId",
      newValue: USER_ID.toString(),
    });
  });

  test("the approval is recorded even where system events are not stored", async () => {
    project = makeProject({ storeSystemEventsInAuditLogs: false });
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await harness.recorder.recordCreate({
      model: new McpOAuthGrant(),
      createdItem: makeGrant(),
      props: {
        isRoot: true,
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
      },
    });

    expect(harness.inserted).toHaveLength(1);
  });

  test.each([
    { action: "create", valueKey: "newValue" },
    { action: "delete", valueKey: "oldValue" },
  ])(
    "a $action entry leaves out the bookkeeping columns and the columns nobody may read",
    async (data: { action: string; valueKey: string }) => {
      if (data.action === "create") {
        await harness.recorder.recordCreate({
          model: new McpOAuthGrant(),
          createdItem: makeGrant(),
          props: SESSION_PROPS,
        });
      } else {
        await harness.recorder.recordDelete({
          model: new McpOAuthGrant(),
          deletedItem: makeGrant(),
          itemId: GRANT_ID,
          props: SESSION_PROPS,
        });
      }

      const entry: AuditLog = onlyEntry();
      const fields: Array<string> = fieldsOf(entry);

      // Tracked.
      expect(fields).toEqual(
        expect.arrayContaining([
          "projectId",
          "userId",
          "name",
          "clientId",
          "scope",
        ]),
      );
      expect(changeFor(entry, "name")).toEqual({
        field: "name",
        [data.valueKey]: MCP_CLIENT_NAME,
      });

      // Bookkeeping the token endpoint rewrites on every refresh.
      expect(fields).not.toContain("lastUsedAt");
      expect(fields).not.toContain("expiresAt");
      expect(fields).not.toContain("activatedAt");

      /*
       * Read ACL `[]`: recording them would hand the SSO evidence, and the
       * resource the grant is bound to, to anyone who may read audit logs.
       */
      expect(fields).not.toContain("resource");
      expect(fields).not.toContain("ssoProviderType");
      expect(fields).not.toContain("ssoProviderId");
      expect(fields).not.toContain("ssoExpiresAt");

      const serialized: string = JSON.stringify(entry.toJSON());
      expect(serialized).not.toContain(SSO_PROVIDER_ID.toString());
      expect(serialized).not.toContain("https://oneuptime.example.com/mcp");
    },
  );

  test("a member disconnecting a client in the dashboard is recorded as their delete", async () => {
    await harness.recorder.recordDelete({
      model: new McpOAuthGrant(),
      deletedItem: makeGrant(),
      itemId: GRANT_ID,
      props: SESSION_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Delete);
    expect(entry.resourceType).toBe(GRANT_RESOURCE_TYPE);
    expect(entry.resourceId?.toString()).toBe(GRANT_ID.toString());
    expect(entry.resourceName).toBe(MCP_CLIENT_NAME);
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    // By hand, not through the client.
    expect(credentialOf(entry)).toEqual({});
  });

  test("a client revoking its own token is recorded as the member's delete, through that client", async () => {
    // The props RevocationEndpoint revokes with.
    await harness.recorder.recordDelete({
      model: new McpOAuthGrant(),
      deletedItem: makeGrant(),
      itemId: GRANT_ID,
      props: {
        isRoot: true,
        userId: USER_ID,
        userType: UserType.User,
        tenantId: PROJECT_ID,
        mcpOAuthGrantId: GRANT_ID,
        mcpClientName: MCP_CLIENT_NAME,
      },
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Delete);
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userType).toBe(UserType.User);
    expect(credentialOf(entry)).toEqual({
      mcpOAuthGrantId: GRANT_ID.toString(),
      mcpClientName: MCP_CLIENT_NAME,
    });
  });

  test("the server revoking a grant whose secret was replayed is a system event: dropped by default, stored when the project keeps them", async () => {
    // McpOAuthGrantService.revokeBecauseCredentialWasReplayed: root, nobody named.
    const grant: McpOAuthGrant = makeGrant();

    await harness.recorder.recordDelete({
      model: new McpOAuthGrant(),
      deletedItem: grant,
      itemId: GRANT_ID,
      props: SYSTEM_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);

    project = makeProject({ storeSystemEventsInAuditLogs: true });
    harness.recorder.invalidateProjectSettings(PROJECT_ID);

    await harness.recorder.recordDelete({
      model: new McpOAuthGrant(),
      deletedItem: grant,
      itemId: GRANT_ID,
      props: SYSTEM_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    // Filed under the grant's own project, with no props.tenantId to go by.
    expect(entry.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(entry.userType).toBe("System");
    expect(entry.userId).toBeUndefined();
    expect(entry.resourceName).toBe(MCP_CLIENT_NAME);
  });

  test.each([
    {
      name: "the client was used (lastUsedAt)",
      updatedFields: { lastUsedAt: new Date("2026-10-01T10:00:00.000Z") },
    },
    {
      name: "the client refreshed and the expiry slid (expiresAt)",
      updatedFields: { expiresAt: new Date("2026-11-01T10:00:00.000Z") },
    },
    {
      name: "the client collected its tokens (activatedAt, expiresAt)",
      updatedFields: {
        activatedAt: new Date("2026-10-01T10:00:00.000Z"),
        expiresAt: new Date("2026-11-01T10:00:00.000Z"),
      },
    },
  ])(
    "bookkeeping produces no entry and costs no settings read when $name",
    async (data: { updatedFields: Record<string, Date> }) => {
      const before: McpOAuthGrant = makeGrant();
      (before as unknown as Record<string, unknown>)["activatedAt"] = undefined;

      await harness.recorder.recordUpdate({
        model: new McpOAuthGrant(),
        before,
        updatedFields: data.updatedFields as unknown as JSONObject,
        itemId: GRANT_ID,
        props: SESSION_PROPS,
      });

      expect(harness.inserted).toHaveLength(0);
      expect(findProjectMock).not.toHaveBeenCalled();
    },
  );

  test("an update to a column nobody may read produces no entry either", async () => {
    await harness.recorder.recordUpdate({
      model: new McpOAuthGrant(),
      before: makeGrant(),
      updatedFields: {
        ssoExpiresAt: new Date("2026-10-05T09:00:00.000Z"),
        resource: "https://elsewhere.example.com/mcp",
      } as unknown as JSONObject,
      itemId: GRANT_ID,
      props: SESSION_PROPS,
    });

    expect(harness.inserted).toHaveLength(0);
  });
});
