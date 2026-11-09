import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import AuditLogExporter from "../../../Server/AuditLogExport/AuditLogExporter";
import { toNdjson } from "../../../Server/AuditLogExport/AuditLogExportFiles";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { generatedTexts } from "Common/Tests/Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import DatabaseService from "Common/Server/Services/DatabaseService";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import AIAgent from "Common/Models/DatabaseModels/AIAgent";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DomainModel from "Common/Models/DatabaseModels/Domain";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import OpenStackProjectNotice from "Common/Models/DatabaseModels/OpenStackProjectNotice";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import Hostname from "Common/Types/API/Hostname";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import {
  AUDIT_LOG_SECRET_COLUMNS,
  looksLikeSecretColumn,
} from "Common/Types/AuditLog/AuditLogCoverage";
import {
  AUDIT_LOG_REDACTED_VALUE,
  getAuditLogRedactedColumns,
} from "Common/Types/AuditLog/AuditLogRedaction";
import {
  AuditLogExportRecord,
  AuditLogExportSchemaVersion,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Color from "Common/Types/Color";
import { getColumnAccessControlForAllColumns } from "Common/Types/Database/AccessControl/ColumnAccessControl";
import Domain from "Common/Types/Domain";
import Email from "Common/Types/Email";
import HashedString from "Common/Types/HashedString";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import Port from "Common/Types/Port";
import UserType from "Common/Types/UserType";
import Version from "Common/Types/Version";
import {
  AuditLogTypedValue,
  readAuditLogChange,
  readAuditLogTypedValue,
} from "Common/Utils/AuditLog/AuditLogTypedValues";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";

/*
 * A PHONE NUMBER IN AN AUDIT LOG ENTRY READS AS THE NUMBER (issue #6325).
 *
 * Releasing a number a call policy kept in its own columns recorded
 *   { "field": "routingPhoneNumber",
 *     "oldValue": { "_type": "Phone", "value": "+14155550100" },
 *     "newValue": null, "summary": ["Changed the value"] }
 * and so did every Phone, Email, URL, Hostname, Port, Version, Color and
 * Domain column people edit. Pinned here against the entry that reaches the
 * insert, through the real recorder:
 *
 *   - each typed column kind, created, changed, cleared, deleted and written
 *     back unchanged in another of its shapes, reads as the value, with no
 *     "Changed the value";
 *   - a typed value in a secret column, and a hash anywhere, is
 *     "[REDACTED]", and a column nobody may read is left out, as before;
 *   - a structure (a monitor's steps) stays JSON;
 *   - entries recorded before, as the audit table still holds them, are
 *     exported and read by the changes dialog as one recorded now;
 *   - a seeded sweep over every typed column of every audited model, secret
 *     and not: no secret in an entry, its export or the dialog's reading,
 *     and every other value as what it holds.
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
const RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

type ModelType = { new (): BaseModel };

let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

beforeEach(() => {
  setTestBillingEnabled(false);
  inserted = [];

  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  recorder = new AuditLogRecorder({
    store: {
      create: (createBy: { data: AuditLog }): Promise<AuditLog> => {
        inserted.push(createBy.data);
        return Promise.resolve(createBy.data);
      },
    } as unknown as AuditLogStore,
  });

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  project.auditLogsRetentionInDays = 30;
  project.storeSystemEventsInAuditLogs = false;

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });
  findUserMock.mockReset();
  findUserMock.mockImplementation(() => {
    return Promise.resolve(null);
  });

  // No related row has a name to add, and no row is read for one.
  jest.spyOn(DatabaseService.prototype, "findBy").mockImplementation((() => {
    return Promise.resolve([] as Array<BaseModel>);
  }) as never);
  jest.spyOn(DatabaseService.prototype, "findOneBy").mockImplementation((() => {
    return Promise.resolve(null);
  }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

// A row of a model in the project, holding these values.
function rowOf(modelType: ModelType, values: JSONObject): BaseModel {
  const row: BaseModel = new modelType();
  const record: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  row._id = RECORD_ID.toString();
  record["projectId"] = PROJECT_ID;

  for (const key of Object.keys(values)) {
    record[key] = values[key];
  }

  return row;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

function changeFor(entry: AuditLog, field: string): JSONObject | undefined {
  return changesOf(entry).find((change: JSONObject): boolean => {
    return change["field"] === field;
  });
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

// A value as an old entry's JSON holds it: { _type, value }.
function asJson(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

// An entry as the audit table answers it: changes as JSON text.
function asStoredRow(entry: AuditLog, changes?: JSONArray): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: "2026-11-08 10:00:00",
    projectId: entry.projectId?.toString() || null,
    action: entry.action || null,
    resourceType: entry.resourceType || null,
    resourceId: entry.resourceId?.toString() || null,
    resourceName: entry.resourceName || null,
    rootResourceType: entry.rootResourceType || null,
    rootResourceId: entry.rootResourceId?.toString() || null,
    userId: entry.userId?.toString() || null,
    userType: entry.userType || null,
    changes: JSON.stringify(changes || entry.changes || []),
  };
}

function exportedRecords(
  rows: Array<JSONObject>,
  schemaVersion: AuditLogExportSchemaVersion,
): Array<AuditLogExportRecord> {
  return AuditLogExporter.toBatch({
    rows,
    maxBytes: 16 * 1024 * 1024,
    schemaVersion,
  });
}

/*
 * The changes as the changes dialog reads them: through the API (the
 * server's JSON, which the dashboard's API client turns back into typed
 * objects - an old entry's { _type: "Phone" } into a Phone) and the
 * dialog's own reading of each change.
 */
function dialogReading(changes: JSONArray): Array<JSONObject> {
  const fromApi: unknown = JSONFunctions.deserializeValue(
    JSON.parse(
      JSON.stringify(JSONFunctions.serializeValue(changes as JSONValue)),
    ) as JSONValue,
  );

  return (fromApi as Array<JSONObject>).map(
    (change: JSONObject): JSONObject => {
      return readAuditLogChange(change);
    },
  );
}

// Whether a value of a change, at its top, is still a typed value's JSON.
function holdsTypedJson(change: JSONObject): boolean {
  return (
    readAuditLogTypedValue(change["oldValue"]) !== null ||
    readAuditLogTypedValue(change["newValue"]) !== null
  );
}

interface TypedColumnKind {
  kind: string;
  modelType: ModelType;
  column: string;
  before: () => unknown;
  after: () => unknown;
  // What each holds, as an entry reads it.
  plainBefore: string | number;
  plainAfter: string | number;
}

const KINDS: Array<TypedColumnKind> = [
  {
    kind: "a phone number (a status page subscriber's)",
    modelType: StatusPageSubscriber,
    column: "subscriberPhone",
    before: (): unknown => {
      return new Phone("+14155550100");
    },
    after: (): unknown => {
      return new Phone("+14155550101");
    },
    plainBefore: "+14155550100",
    plainAfter: "+14155550101",
  },
  {
    kind: "an email address (an SMTP configuration's from address)",
    modelType: ProjectSmtpConfig,
    column: "fromEmail",
    before: (): unknown => {
      return new Email("alerts@example.com");
    },
    after: (): unknown => {
      return new Email("status@example.com");
    },
    plainBefore: "alerts@example.com",
    plainAfter: "status@example.com",
  },
  {
    kind: "a URL (an SSO sign-on address)",
    modelType: ProjectSSO,
    column: "signOnURL",
    before: (): unknown => {
      return URL.fromString("https://idp.example.com/sso");
    },
    after: (): unknown => {
      return URL.fromString("https://idp.example.com/saml/login");
    },
    plainBefore: "https://idp.example.com/sso",
    plainAfter: "https://idp.example.com/saml/login",
  },
  {
    kind: "a host name (an SMTP server)",
    modelType: ProjectSmtpConfig,
    column: "hostname",
    before: (): unknown => {
      return new Hostname("smtp.example.com");
    },
    after: (): unknown => {
      return new Hostname("mail.example.com");
    },
    plainBefore: "smtp.example.com",
    plainAfter: "mail.example.com",
  },
  {
    kind: "a port (an SMTP server's)",
    modelType: ProjectSmtpConfig,
    column: "port",
    before: (): unknown => {
      return new Port(587);
    },
    after: (): unknown => {
      return new Port(2525);
    },
    plainBefore: 587,
    plainAfter: 2525,
  },
  {
    kind: "a version (an AI agent's)",
    modelType: AIAgent,
    column: "aiAgentVersion",
    before: (): unknown => {
      return new Version("14.0.104");
    },
    after: (): unknown => {
      return new Version("14.0.105");
    },
    plainBefore: "14.0.104",
    plainAfter: "14.0.105",
  },
  {
    kind: "a colour (a label's)",
    modelType: Label,
    column: "color",
    before: (): unknown => {
      return new Color("#dc2626");
    },
    after: (): unknown => {
      return new Color("#16a34a");
    },
    plainBefore: "#dc2626",
    plainAfter: "#16a34a",
  },
  {
    kind: "a domain",
    modelType: DomainModel,
    column: "domain",
    before: (): unknown => {
      return new Domain("status.example.com");
    },
    after: (): unknown => {
      return new Domain("status.example.org");
    },
    plainBefore: "status.example.com",
    plainAfter: "status.example.org",
  },
  {
    kind: "a name (a Name written to a text column)",
    modelType: Label,
    column: "description",
    before: (): unknown => {
      return new Name("Ada Lovelace");
    },
    after: (): unknown => {
      return new Name("Grace Hopper");
    },
    plainBefore: "Ada Lovelace",
    plainAfter: "Grace Hopper",
  },
];

describe("each typed column kind reads as the value", () => {
  test.each(KINDS)("$kind: created", async (kind: TypedColumnKind) => {
    await recorder.recordCreate({
      model: new kind.modelType(),
      createdItem: rowOf(kind.modelType, {
        [kind.column]: kind.before() as JSONValue,
      }),
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(changeFor(entry, kind.column)).toEqual({
      field: kind.column,
      newValue: kind.plainBefore,
    });
    expect(JSON.stringify(entry.changes)).not.toContain("_type");
  });

  test.each(KINDS)(
    "$kind: changed, before and after, with no 'Changed the value'",
    async (kind: TypedColumnKind) => {
      await recorder.recordUpdate({
        model: new kind.modelType(),
        before: rowOf(kind.modelType, {
          [kind.column]: kind.before() as JSONValue,
        }),
        updatedFields: { [kind.column]: kind.after() as JSONValue },
        itemId: RECORD_ID,
        props: USER_PROPS,
      });

      expect(changesOf(onlyEntry())).toEqual([
        {
          field: kind.column,
          oldValue: kind.plainBefore,
          newValue: kind.plainAfter,
        },
      ]);
    },
  );

  test.each(KINDS)("$kind: cleared", async (kind: TypedColumnKind) => {
    await recorder.recordUpdate({
      model: new kind.modelType(),
      before: rowOf(kind.modelType, {
        [kind.column]: kind.before() as JSONValue,
      }),
      updatedFields: { [kind.column]: null },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expect(changesOf(onlyEntry())).toEqual([
      { field: kind.column, oldValue: kind.plainBefore, newValue: null },
    ]);
  });

  test.each(KINDS)(
    "$kind: set where there was none",
    async (kind: TypedColumnKind) => {
      await recorder.recordUpdate({
        model: new kind.modelType(),
        before: rowOf(kind.modelType, {}),
        updatedFields: { [kind.column]: kind.after() as JSONValue },
        itemId: RECORD_ID,
        props: USER_PROPS,
      });

      expect(changesOf(onlyEntry())).toEqual([
        { field: kind.column, oldValue: null, newValue: kind.plainAfter },
      ]);
    },
  );

  test.each(KINDS)("$kind: deleted", async (kind: TypedColumnKind) => {
    await recorder.recordDelete({
      model: new kind.modelType(),
      deletedItem: rowOf(kind.modelType, {
        [kind.column]: kind.before() as JSONValue,
      }),
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Delete);
    expect(changeFor(entry, kind.column)).toEqual({
      field: kind.column,
      oldValue: kind.plainBefore,
    });
  });

  test.each(KINDS)(
    "$kind: written back as it was - the object, its JSON or its text - is no change",
    async (kind: TypedColumnKind) => {
      for (const writtenBack of [
        kind.before(),
        asJson(kind.before()),
        String(kind.before()),
      ]) {
        await recorder.recordUpdate({
          model: new kind.modelType(),
          before: rowOf(kind.modelType, {
            [kind.column]: kind.before() as JSONValue,
          }),
          updatedFields: { [kind.column]: writtenBack as JSONValue },
          itemId: RECORD_ID,
          props: USER_PROPS,
        });
      }

      expect(inserted).toHaveLength(0);
    },
  );

  test.each(KINDS)(
    "$kind: changed by a write in its JSON shape, still a change, read as the value",
    async (kind: TypedColumnKind) => {
      await recorder.recordUpdate({
        model: new kind.modelType(),
        before: rowOf(kind.modelType, {
          [kind.column]: asJson(kind.before()),
        }),
        updatedFields: { [kind.column]: asJson(kind.after()) },
        itemId: RECORD_ID,
        props: USER_PROPS,
      });

      expect(changesOf(onlyEntry())).toEqual([
        {
          field: kind.column,
          oldValue: kind.plainBefore,
          newValue: kind.plainAfter,
        },
      ]);
    },
  );
});

describe("the issue's entry: a number a call policy kept in its own columns, released", () => {
  test("names the number that went, as the number, with no summary", async () => {
    const before: IncomingCallPolicy = new IncomingCallPolicy(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "Support line";
    before.routingPhoneNumber = new Phone("+14155550100");
    before.callProviderPhoneNumberId = "PNlegacy0123456789";

    await recorder.recordUpdate({
      model: new IncomingCallPolicy(),
      before,
      updatedFields: {
        routingPhoneNumber: null,
        callProviderPhoneNumberId: null,
        phoneNumberCountryCode: null,
        phoneNumberAreaCode: null,
        phoneNumberPurchasedAt: null,
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
      includeColumns: ["routingPhoneNumber"],
    });

    expect(changesOf(onlyEntry())).toEqual([
      {
        field: "routingPhoneNumber",
        oldValue: "+14155550100",
        newValue: null,
      },
    ]);
  });
});

describe("secrets in typed columns stay [REDACTED]", () => {
  const WEBHOOK: string =
    "https://hooks.example.com/services/T000/B000/xoxb-secret-token-6325";

  test("a subscriber's webhook (a URL), created, changed and deleted", async () => {
    await recorder.recordCreate({
      model: new StatusPageSubscriber(),
      createdItem: rowOf(StatusPageSubscriber, {
        subscriberWebhook: URL.fromString(WEBHOOK) as unknown as JSONValue,
      }),
      props: USER_PROPS,
    });
    await recorder.recordUpdate({
      model: new StatusPageSubscriber(),
      before: rowOf(StatusPageSubscriber, {
        subscriberWebhook: URL.fromString(WEBHOOK) as unknown as JSONValue,
      }),
      updatedFields: {
        subscriberWebhook: URL.fromString(
          `${WEBHOOK}-rotated`,
        ) as unknown as JSONValue,
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });
    await recorder.recordDelete({
      model: new StatusPageSubscriber(),
      deletedItem: rowOf(StatusPageSubscriber, {
        subscriberWebhook: URL.fromString(WEBHOOK) as unknown as JSONValue,
      }),
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expect(inserted).toHaveLength(3);
    expect(changeFor(inserted[0]!, "subscriberWebhook")?.["newValue"]).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(changesOf(inserted[1]!)).toEqual([
      {
        field: "subscriberWebhook",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(changeFor(inserted[2]!, "subscriberWebhook")?.["oldValue"]).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(JSON.stringify(inserted)).not.toContain("xoxb-secret-token");
  });

  test("an OpenStack notice's webhook, written as its JSON, is still [REDACTED]", async () => {
    await recorder.recordUpdate({
      model: new OpenStackProjectNotice(),
      before: rowOf(OpenStackProjectNotice, {
        webhookUrl: asJson(URL.fromString(WEBHOOK)),
      }),
      updatedFields: { webhookUrl: asJson(URL.fromString(`${WEBHOOK}-2`)) },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expect(changesOf(onlyEntry())).toEqual([
      {
        field: "webhookUrl",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(JSON.stringify(inserted)).not.toContain("xoxb-secret-token");
  });

  test("a status page's master password and a private user's password (hashes)", async () => {
    await recorder.recordUpdate({
      model: new StatusPage(),
      before: rowOf(StatusPage, {
        masterPassword: new HashedString(
          "old-master-hash-6325",
          true,
        ) as unknown as JSONValue,
      }),
      updatedFields: {
        masterPassword: new HashedString(
          "new-master-hash-6325",
          true,
        ) as unknown as JSONValue,
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });
    await recorder.recordCreate({
      model: new StatusPagePrivateUser(),
      createdItem: rowOf(StatusPagePrivateUser, {
        email: new Email("viewer@example.com") as unknown as JSONValue,
        password: new HashedString(
          "private-user-hash-6325",
          true,
        ) as unknown as JSONValue,
      }),
      props: USER_PROPS,
    });

    expect(inserted).toHaveLength(2);
    expect(changesOf(inserted[0]!)).toEqual([
      {
        field: "masterPassword",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(changeFor(inserted[1]!, "password")?.["newValue"]).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    // The private user's address is no secret: it reads as the address.
    expect(changeFor(inserted[1]!, "email")?.["newValue"]).toBe(
      "viewer@example.com",
    );
    expect(JSON.stringify(inserted)).not.toContain("hash-6325");
  });

  test("a hash changed to the same hash, in another shape, is no change; to another, it is one", async () => {
    await recorder.recordUpdate({
      model: new StatusPage(),
      before: rowOf(StatusPage, {
        masterPassword: new HashedString(
          "same-hash",
          true,
        ) as unknown as JSONValue,
      }),
      updatedFields: {
        masterPassword: asJson(new HashedString("same-hash", true)),
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expect(inserted).toHaveLength(0);
  });

  test("a hash in a column that is no secret, and one inside JSON, are [REDACTED]", async () => {
    await recorder.recordUpdate({
      model: new Label(),
      before: rowOf(Label, { description: "Production" }),
      updatedFields: {
        description: new HashedString(
          "stray-hash-6325",
          true,
        ) as unknown as JSONValue,
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });
    await recorder.recordUpdate({
      model: new Monitor(),
      before: rowOf(Monitor, { customFields: { owner: "ada" } }),
      updatedFields: {
        customFields: {
          owner: "ada",
          check: asJson(new HashedString("nested-hash-6325", true)),
        },
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expect(inserted).toHaveLength(2);
    expect(changesOf(inserted[0]!)).toEqual([
      {
        field: "description",
        oldValue: "Production",
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(changeFor(inserted[1]!, "customFields")?.["newValue"]).toEqual({
      owner: "ada",
      check: AUDIT_LOG_REDACTED_VALUE,
    });
    expect(JSON.stringify(inserted)).not.toContain("hash-6325");
  });

  test("a typed column nobody may read is left out, and named, it is [REDACTED]", async () => {
    const slack: string =
      "https://hooks.slack.com/services/T1/B1/slack-secret-6325";

    await recorder.recordUpdate({
      model: new StatusPageSubscriber(),
      before: rowOf(StatusPageSubscriber, {
        subscriberEmail: new Email("ada@example.com") as unknown as JSONValue,
        slackIncomingWebhookUrl: URL.fromString(slack) as unknown as JSONValue,
      }),
      updatedFields: {
        subscriberEmail: new Email("grace@example.com") as unknown as JSONValue,
        slackIncomingWebhookUrl: URL.fromString(
          `${slack}-2`,
        ) as unknown as JSONValue,
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });
    await recorder.recordUpdate({
      model: new StatusPageSubscriber(),
      before: rowOf(StatusPageSubscriber, {
        slackIncomingWebhookUrl: URL.fromString(slack) as unknown as JSONValue,
      }),
      updatedFields: {
        slackIncomingWebhookUrl: URL.fromString(
          `${slack}-3`,
        ) as unknown as JSONValue,
      },
      itemId: RECORD_ID,
      props: USER_PROPS,
      includeColumns: ["slackIncomingWebhookUrl"],
    });

    expect(inserted).toHaveLength(2);
    expect(changesOf(inserted[0]!)).toEqual([
      {
        field: "subscriberEmail",
        oldValue: "ada@example.com",
        newValue: "grace@example.com",
      },
    ]);
    expect(changesOf(inserted[1]!)).toEqual([
      {
        field: "slackIncomingWebhookUrl",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(JSON.stringify(inserted)).not.toContain("slack-secret-6325");
  });
});

describe("a structure stays JSON", () => {
  test("a monitor's steps are recorded as their JSON, as before", async () => {
    const steps: MonitorSteps = new MonitorSteps();

    await recorder.recordCreate({
      model: new Monitor(),
      createdItem: rowOf(Monitor, {
        name: "Checkout API",
        monitorSteps: steps as unknown as JSONValue,
      }),
      props: USER_PROPS,
    });

    const recorded: JSONValue | undefined = changeFor(
      onlyEntry(),
      "monitorSteps",
    )?.["newValue"];

    expect(recorded).toEqual(asJson(steps));
    expect((recorded as JSONObject)["_type"]).toBe("MonitorSteps");
  });
});

/*
 * Entries recorded before this change hold the JSON until their retention
 * ends. As the audit table holds them - changes as JSON text, each typed
 * value its { _type, value } and its "Changed the value" - they are
 * exported, and read by the changes dialog, exactly as the same change
 * recorded today is.
 */
describe("an entry recorded before, as the audit table still holds it", () => {
  const OLD_CHANGES: JSONArray = [
    {
      field: "routingPhoneNumber",
      oldValue: { _type: "Phone", value: "+14155550100" },
      newValue: null,
      summary: ["Changed the value"],
    },
  ];

  async function recordedToday(): Promise<AuditLog> {
    const before: IncomingCallPolicy = new IncomingCallPolicy(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "Support line";
    before.routingPhoneNumber = new Phone("+14155550100");

    await recorder.recordUpdate({
      model: new IncomingCallPolicy(),
      before,
      updatedFields: { routingPhoneNumber: null },
      itemId: RECORD_ID,
      props: USER_PROPS,
      includeColumns: ["routingPhoneNumber"],
    });

    return onlyEntry();
  }

  test.each([1, 2] as Array<AuditLogExportSchemaVersion>)(
    "is exported, version %i, as the same change recorded today",
    async (version: AuditLogExportSchemaVersion) => {
      const today: AuditLog = await recordedToday();
      const row: JSONObject = asStoredRow(today);
      const oldRow: JSONObject = {
        ...row,
        changes: JSON.stringify(OLD_CHANGES),
      };

      const [exportedToday] = exportedRecords([row], version);
      const [exportedOld] = exportedRecords([oldRow], version);

      expect(exportedOld!.changes).toEqual(exportedToday!.changes);
      expect(exportedOld!.changes).toEqual([
        version === 1
          ? {
              field: "routingPhoneNumber",
              oldValue: "+14155550100",
              newValue: null,
            }
          : {
              field: "routingPhoneNumber",
              oldValue: "+14155550100",
              newValue: null,
              summary: null,
            },
      ]);
      expect(toNdjson([exportedOld!])).not.toContain("_type");
    },
  );

  test("reads in the changes dialog as the same change recorded today", async () => {
    const today: AuditLog = await recordedToday();

    expect(dialogReading(OLD_CHANGES)).toEqual([
      {
        field: "routingPhoneNumber",
        oldValue: "+14155550100",
        newValue: null,
        summary: null,
      },
    ]);
    expect(dialogReading(today.changes as JSONArray)).toEqual([
      {
        field: "routingPhoneNumber",
        oldValue: "+14155550100",
        newValue: null,
      },
    ]);
  });

  test("an old hash, in a field the export does not know as a secret, leaves as [REDACTED]", () => {
    const old: JSONArray = [
      {
        field: "anything",
        oldValue: { _type: "HashedString", value: "old-hash-6325" },
        newValue: { _type: "HashedString", value: "new-hash-6325" },
        summary: ["Changed value"],
      },
    ];
    const row: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: "2026-11-08 10:00:00",
      projectId: PROJECT_ID.toString(),
      action: "Update",
      resourceType: "Label",
      changes: JSON.stringify(old),
    };

    for (const version of [1, 2] as Array<AuditLogExportSchemaVersion>) {
      expect(toNdjson(exportedRecords([row], version))).not.toContain(
        "hash-6325",
      );
    }

    expect(JSON.stringify(dialogReading(old))).not.toContain("hash-6325");
  });

  test("an old secret column holding a typed value leaves as [REDACTED], its lines as they were", () => {
    const old: JSONArray = [
      {
        field: "subscriberWebhook",
        oldValue: {
          _type: "URL",
          value: "https://hooks.example.com/old-secret-6325",
        },
        newValue: null,
        summary: ["Changed the value"],
      },
    ];
    const row: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: "2026-11-08 10:00:00",
      projectId: PROJECT_ID.toString(),
      action: "Update",
      resourceType: new StatusPageSubscriber().singularName,
      changes: JSON.stringify(old),
    };
    const [record] = exportedRecords([row], 2);

    expect(record!.changes).toEqual([
      {
        field: "subscriberWebhook",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: null,
        summary: ["Changed the value"],
      },
    ]);
  });
});

/*
 * EVERY TYPED COLUMN OF EVERY AUDITED MODEL, secret and not, found the way
 * TypeORM stores it (its column's transformer gives a typed object), over
 * every action, with generated values: no secret in the entry, its export
 * or the dialog's reading, and every other value read as what it holds -
 * in the entry, and in the same change as an older entry recorded it.
 */
describe("a seeded sweep over every typed column of every audited model", () => {
  interface TypedColumn {
    modelType: ModelType;
    tableName: string;
    column: string;
    // The class the column holds, by name: Phone, Email, URL...
    className: string;
    from: (value: unknown) => unknown;
  }

  const PROBES: Array<unknown> = [
    "+14155550100",
    "ada@example.com",
    "https://example.com/a",
    "example.com",
    "1.2.3",
    "#ffffff",
    587,
    "Ada Lovelace",
  ];

  function findTypedColumns(): Array<TypedColumn> {
    const found: Array<TypedColumn> = [];
    const columns: Array<{
      target: unknown;
      propertyName: string;
      options: { transformer?: unknown };
    }> = getMetadataArgsStorage().columns as never;

    for (const modelType of AllModelTypes as Array<ModelType>) {
      const model: BaseModel = new modelType();

      if (!model.enableAuditLogOn || !model.tableName) {
        continue;
      }

      for (const column of columns) {
        const transformer: { from?: (value: unknown) => unknown } | undefined =
          column.options.transformer as
            | { from?: (value: unknown) => unknown }
            | undefined;

        if (
          !transformer ||
          typeof transformer.from !== "function" ||
          !(
            column.target === modelType ||
            (typeof column.target === "function" &&
              modelType.prototype instanceof (column.target as ModelType))
          )
        ) {
          continue;
        }

        for (const probe of PROBES) {
          let held: unknown = null;

          try {
            held = transformer.from(probe);
          } catch {
            continue;
          }

          const typed: AuditLogTypedValue | null = readAuditLogTypedValue(held);

          if (typed && !(held instanceof ObjectID)) {
            found.push({
              modelType,
              tableName: model.tableName,
              column: column.propertyName,
              className: (held as { constructor: { name: string } }).constructor
                .name,
              from: (value: unknown): unknown => {
                return transformer.from!(value);
              },
            });
          }

          if (held !== null && held !== undefined) {
            break;
          }
        }
      }
    }

    return found;
  }

  const TYPED_COLUMNS: Array<TypedColumn> = findTypedColumns();

  const LETTERS: Array<string> = "abcdefghijklmnopqrstuvwxyz".split("");
  const HEX: Array<string> = "0123456789abcdef".split("");
  const NAMES: Array<string> = generatedTexts(100, 6325, [
    "Ada",
    " ",
    "Lovelace",
    "é",
    "'",
    '"',
    "{",
    "_type",
  ]).filter((text: string): boolean => {
    return text.trim().length > 0;
  });

  function draw(
    random: SeededRandom,
    pieces: Array<string>,
    count: number,
  ): string {
    let text: string = "";

    for (let index: number = 0; index < count; index++) {
      text += pieces[random(pieces.length)];
    }

    return text;
  }

  /*
   * A text the column's class takes, holding a token found nowhere else -
   * so a secret's text can be searched for - and the value as its column
   * holds it.
   */
  const GENERATORS: Record<
    string,
    (random: SeededRandom, token: string) => unknown
  > = {
    Phone: (random: SeededRandom): unknown => {
      return `+1415${draw(random, HEX.slice(0, 10), 7)}`;
    },
    Email: (_random: SeededRandom, token: string): unknown => {
      return `${token}@example.com`;
    },
    URL: (_random: SeededRandom, token: string): unknown => {
      return `https://hooks.example.com/services/${token}`;
    },
    Hostname: (_random: SeededRandom, token: string): unknown => {
      return `${token}.example.com`;
    },
    Domain: (_random: SeededRandom, token: string): unknown => {
      return `${token}.example.com`;
    },
    Port: (random: SeededRandom): unknown => {
      return 1024 + random(60000);
    },
    Version: (random: SeededRandom): unknown => {
      return `${1 + random(30)}.${random(30)}.${random(300)}`;
    },
    Color: (random: SeededRandom): unknown => {
      return `#${draw(random, HEX, 6)}`;
    },
    Name: (random: SeededRandom, token: string): unknown => {
      return `${token} ${NAMES[random(NAMES.length)]}`;
    },
    HashedString: (random: SeededRandom, token: string): unknown => {
      return `${token}${draw(random, HEX, 32)}`;
    },
  };

  function isUnreadable(model: BaseModel, column: string): boolean {
    const access: { read?: Array<unknown> } | undefined = (
      getColumnAccessControlForAllColumns(model) as Record<
        string,
        { read?: Array<unknown> }
      >
    )[column];

    return Boolean(
      access && Array.isArray(access.read) && access.read.length === 0,
    );
  }

  // A secret by every rule the audit log knows one by, whichever applies.
  function isSecret(typedColumn: TypedColumn): boolean {
    const model: BaseModel = new typedColumn.modelType();

    return (
      typedColumn.className === "HashedString" ||
      getAuditLogRedactedColumns(model).has(typedColumn.column) ||
      isUnreadable(model, typedColumn.column) ||
      (AUDIT_LOG_SECRET_COLUMNS[typedColumn.tableName] || []).includes(
        typedColumn.column,
      ) ||
      looksLikeSecretColumn(
        typedColumn.column,
        model.getTableColumnMetadata(typedColumn.column)?.type,
      )
    );
  }

  function isLeftOut(typedColumn: TypedColumn, included: boolean): boolean {
    const model: BaseModel = new typedColumn.modelType();

    return (
      !included &&
      (isUnreadable(model, typedColumn.column) ||
        (model.enableAuditLogOn?.ignoreColumns || []).includes(
          typedColumn.column,
        ))
    );
  }

  test("finds the typed columns people edit, and can generate each one's values", () => {
    const found: Array<string> = TYPED_COLUMNS.map(
      (typedColumn: TypedColumn): string => {
        return `${typedColumn.tableName}.${typedColumn.column}`;
      },
    );

    expect(found).toEqual(
      expect.arrayContaining([
        "StatusPageSubscriber.subscriberPhone",
        "StatusPageSubscriber.subscriberEmail",
        "StatusPageSubscriber.subscriberWebhook",
        "ProjectSMTPConfig.fromEmail",
        "ProjectSMTPConfig.hostname",
        "ProjectSMTPConfig.port",
        "ProjectSSO.signOnURL",
        "IncomingCallPolicy.routingPhoneNumber",
        "IncomingCallPolicyPhoneNumber.phoneNumber",
        "AIAgent.aiAgentVersion",
        "Label.color",
        "Domain.domain",
        "StatusPage.masterPassword",
        "Project.createdOwnerName",
      ]),
    );

    // 48 typed columns of 10 classes when this was written: the sweep reads them all.
    expect(TYPED_COLUMNS.length).toBeGreaterThanOrEqual(48);
    expect(
      Array.from(
        new Set<string>(
          TYPED_COLUMNS.map((typedColumn: TypedColumn): string => {
            return typedColumn.className;
          }),
        ),
      ).sort(),
    ).toEqual(
      expect.arrayContaining([
        "Color",
        "Domain",
        "Email",
        "HashedString",
        "Hostname",
        "Name",
        "Phone",
        "Port",
        "URL",
        "Version",
      ]),
    );

    // A new kind of typed column needs a generator here, so it is swept too.
    expect(
      TYPED_COLUMNS.filter((typedColumn: TypedColumn): boolean => {
        return !GENERATORS[typedColumn.className];
      }).map((typedColumn: TypedColumn): string => {
        return `${typedColumn.tableName}.${typedColumn.column}: ${typedColumn.className}`;
      }),
    ).toEqual([]);
  });

  type Action =
    | "create"
    | "update"
    | "clear"
    | "delete"
    | "unchanged-json"
    | "unchanged-text";

  const ACTIONS: Array<Action> = [
    "create",
    "update",
    "clear",
    "delete",
    "unchanged-json",
    "unchanged-text",
  ];

  test("every column and action, then 600 drawn more: no secret anywhere, every other value as what it holds", async () => {
    const random: SeededRandom = seededRandom(6325);
    const problems: Array<string> = [];
    const runs: Array<{ typedColumn: TypedColumn; action: Action }> = [];

    for (const typedColumn of TYPED_COLUMNS) {
      for (const action of ACTIONS) {
        runs.push({ typedColumn, action });
      }
    }

    for (let extra: number = 0; extra < 600; extra++) {
      runs.push({
        typedColumn: TYPED_COLUMNS[random(TYPED_COLUMNS.length)]!,
        action: ACTIONS[random(ACTIONS.length)]!,
      });
    }

    for (const [index, run] of runs.entries()) {
      inserted = [];

      const { typedColumn, action } = run;
      const label: string = `${index} ${typedColumn.tableName}.${typedColumn.column} ${action}`;
      const generate: (random: SeededRandom, token: string) => unknown =
        GENERATORS[typedColumn.className]!;
      const tokenBefore: string = `tb${draw(random, LETTERS, 12)}`;
      const tokenAfter: string = `ta${draw(random, LETTERS, 12)}`;
      const before: unknown = typedColumn.from(generate(random, tokenBefore));
      let after: unknown = typedColumn.from(generate(random, tokenAfter));

      while (String(after) === String(before)) {
        after = typedColumn.from(generate(random, `x${tokenAfter}`));
      }

      const included: boolean = random(2) === 0;
      const model: BaseModel = new typedColumn.modelType();
      const secret: boolean = isSecret(typedColumn);

      if (action === "create") {
        await recorder.recordCreate({
          model,
          createdItem: rowOf(typedColumn.modelType, {
            [typedColumn.column]: before as JSONValue,
          }),
          props: USER_PROPS,
        });
      } else if (action === "delete") {
        await recorder.recordDelete({
          model,
          deletedItem: rowOf(typedColumn.modelType, {
            [typedColumn.column]: before as JSONValue,
          }),
          itemId: RECORD_ID,
          props: USER_PROPS,
        });
      } else {
        const written: unknown =
          action === "update"
            ? after
            : action === "clear"
              ? null
              : action === "unchanged-json"
                ? asJson(before)
                : String(before);

        await recorder.recordUpdate({
          model,
          before: rowOf(typedColumn.modelType, {
            [typedColumn.column]: before as JSONValue,
          }),
          updatedFields: { [typedColumn.column]: written as JSONValue },
          itemId: RECORD_ID,
          props: USER_PROPS,
          includeColumns: included ? [typedColumn.column] : undefined,
        });
      }

      const isSnapshot: boolean = action === "create" || action === "delete";
      const leftOut: boolean = isLeftOut(
        typedColumn,
        isSnapshot ? false : included,
      );
      const entry: AuditLog | undefined = inserted[0];
      const change: JSONObject | undefined = entry
        ? changeFor(entry, typedColumn.column)
        : undefined;

      // What must never be read anywhere: a secret's text.
      const secretTexts: Array<string> = secret
        ? [String(before), String(after), tokenBefore, tokenAfter]
        : [];

      const searched: Array<[string, string]> = [];

      if (entry) {
        searched.push(["the entry", JSON.stringify(entry)]);

        for (const version of [1, 2] as Array<AuditLogExportSchemaVersion>) {
          searched.push([
            `the export, version ${version}`,
            toNdjson(exportedRecords([asStoredRow(entry)], version)),
          ]);
        }

        searched.push([
          "the dialog",
          JSON.stringify(dialogReading(entry.changes as JSONArray)),
        ]);
      }

      for (const [where, text] of searched) {
        for (const secretText of secretTexts) {
          if (text.includes(secretText)) {
            problems.push(`${label}: ${where} carries a secret`);
          }
        }
      }

      if (action === "unchanged-json" || action === "unchanged-text") {
        if (inserted.length !== 0) {
          problems.push(`${label}: written back as it was, recorded`);
        }

        continue;
      }

      if (leftOut) {
        if (change) {
          problems.push(`${label}: left out, recorded`);
        }

        continue;
      }

      if (!change) {
        problems.push(`${label}: not recorded`);
        continue;
      }

      if (holdsTypedJson(change) || change["summary"] !== undefined) {
        problems.push(`${label}: recorded as JSON: ${JSON.stringify(change)}`);
        continue;
      }

      const read: (value: unknown) => unknown = (value: unknown): unknown => {
        if (value === null) {
          return null;
        }

        return secret
          ? AUDIT_LOG_REDACTED_VALUE
          : readAuditLogTypedValue(value)!.value;
      };

      const expected: JSONObject =
        action === "create"
          ? { field: typedColumn.column, newValue: read(before) as JSONValue }
          : action === "delete"
            ? { field: typedColumn.column, oldValue: read(before) as JSONValue }
            : {
                field: typedColumn.column,
                oldValue: read(before) as JSONValue,
                newValue: read(action === "clear" ? null : after) as JSONValue,
              };

      if (JSON.stringify(change) !== JSON.stringify(expected)) {
        problems.push(
          `${label}: ${JSON.stringify(change)}, not ${JSON.stringify(expected)}`,
        );
        continue;
      }

      /*
       * The same change as an older entry recorded it - its values the
       * { _type, value } JSON, with the JSON's line - is exported and read
       * as this one.
       */
      if (!secret) {
        const old: JSONObject = { ...change };

        for (const key of ["oldValue", "newValue"]) {
          if (old[key] !== undefined && old[key] !== null) {
            // A snapshot holds the row as it was; an update, both sides.
            old[key] = asJson(
              isSnapshot || key === "oldValue" ? before : after,
            );
          }
        }

        if (!isSnapshot) {
          old["summary"] = [
            action === "clear" ? "Changed the value" : "Changed value",
          ];
        }

        for (const version of [1, 2] as Array<AuditLogExportSchemaVersion>) {
          const now: Array<AuditLogExportRecord> = exportedRecords(
            [asStoredRow(entry!, [change])],
            version,
          );
          const then: Array<AuditLogExportRecord> = exportedRecords(
            [asStoredRow(entry!, [old])],
            version,
          );

          if (
            JSON.stringify(then[0]!.changes) !== JSON.stringify(now[0]!.changes)
          ) {
            problems.push(
              `${label}: an older entry exports, version ${version}, as ${JSON.stringify(then[0]!.changes)}`,
            );
          }
        }

        const readNow: JSONObject = dialogReading([change])[0]!;
        const readThen: JSONObject = dialogReading([old])[0]!;

        if (
          readThen["oldValue"] !== readNow["oldValue"] ||
          readThen["newValue"] !== readNow["newValue"] ||
          (readThen["summary"] !== undefined && readThen["summary"] !== null)
        ) {
          problems.push(
            `${label}: an older entry reads in the dialog as ${JSON.stringify(readThen)}`,
          );
        }
      }
    }

    expect(problems).toEqual([]);
    // The sweep recorded what it set out to, and read real entries.
    expect(runs.length).toBeGreaterThan(TYPED_COLUMNS.length * ACTIONS.length);
  });
});
