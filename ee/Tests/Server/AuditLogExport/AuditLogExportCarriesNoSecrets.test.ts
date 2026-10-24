import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import AuditLogExporter from "../../../Server/AuditLogExport/AuditLogExporter";
import {
  getExportRedactedFields,
  redactAuditLogExportRecord,
} from "../../../Server/AuditLogExport/AuditLogExportRedaction";
import { toNdjson } from "../../../Server/AuditLogExport/AuditLogExportFiles";
import DatabaseService from "Common/Server/Services/DatabaseService";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import logger from "Common/Server/Utils/Logger";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Project from "Common/Models/DatabaseModels/Project";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AuditLogExportRecord,
  toAuditLogExportRecord,
} from "Common/Types/AuditLog/Export/AuditLogExportRecord";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * NOTHING SECRET LEAVES IN AN EXPORTED ENTRY.
 *
 * End to end through the real recorder and the real exporter's batch: a
 * change is recorded by AuditLogRecorder (its store captured), stored as the
 * audit table holds it (changes as JSON text, as ClickHouse answers it),
 * read back as export records by AuditLogExporter.toBatch, and the whole
 * NDJSON file a destination would get is searched for the secret.
 *
 * And an entry recorded before its secret was listed - which still holds
 * the value in the audit log until its retention ends - is redacted on its
 * way out (AuditLogExportRedaction).
 *
 * The harness is the recorder suite's (ee/Tests/Server/AuditLog): project
 * and user reads are module stubs, related-row lookups are stubbed, billing
 * and the edition are pinned.
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
  "12121212-1212-4121-8121-121212121212",
);

const PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("34343434-3434-4343-8343-343434343434"),
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

const API_KEY_VALUE: string = "c3d4e5f6-a7b8-4012-8def-123456789012";
const OLD_SECRET_KEY: string = "aaaa1111-2222-4333-8444-555566667777";
const NEW_SECRET_KEY: string = "bbbb1111-2222-4333-8444-555566667777";
const EMBED_TOKEN: string = "embed-token-9f8e7d6c";
const MASTER_PASSWORD_HASH: string =
  "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8";
const EXPORT_SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";

let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

// An entry as the audit table answers it: what the recorder wrote, changes as JSON text.
function asStoredRow(entry: AuditLog): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    createdAt: "2026-10-24 09:15:03",
    projectId: entry.projectId?.toString() || null,
    action: entry.action || null,
    resourceType: entry.resourceType || null,
    resourceId: entry.resourceId?.toString() || null,
    resourceName: entry.resourceName || null,
    rootResourceType: entry.rootResourceType || null,
    rootResourceId: entry.rootResourceId?.toString() || null,
    userId: entry.userId?.toString() || null,
    userType: entry.userType || null,
    changes: JSON.stringify(entry.changes || []),
  };
}

// The NDJSON a file destination would write for these entries.
function exportedFile(entries: Array<AuditLog>): string {
  return toNdjson(
    AuditLogExporter.toBatch({
      rows: entries.map(asStoredRow),
      maxBytes: 16 * 1024 * 1024,
    }),
  );
}

function changeOf(entry: AuditLog, field: string): JSONObject | undefined {
  return (entry.changes || []).find((change: unknown): boolean => {
    return (change as JSONObject)["field"] === field;
  }) as JSONObject | undefined;
}

describe("an exported entry carries no secret", () => {
  beforeEach(() => {
    jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });

    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);

    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.enableAuditLogs = true;
    project.storeSystemEventsInAuditLogs = true;
    project.auditLogsRetentionInDays = 30;

    findProjectMock.mockReset();
    findProjectMock.mockImplementation(() => {
      return Promise.resolve(project);
    });
    findUserMock.mockReset();
    findUserMock.mockImplementation(() => {
      return Promise.resolve(null);
    });

    // No related row has a name to add.
    jest.spyOn(DatabaseService.prototype, "findBy").mockImplementation((() => {
      return Promise.resolve([] as Array<BaseModel>);
    }) as never);

    inserted = [];
    recorder = new AuditLogRecorder({
      store: {
        create: (createBy: { data: AuditLog }): Promise<AuditLog> => {
          inserted.push(createBy.data);
          return Promise.resolve(createBy.data);
        },
      } as unknown as AuditLogStore,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  test("an API key's key is recorded as set, never with its value", async () => {
    const apiKey: ApiKey = new ApiKey();
    apiKey.id = ObjectID.generate();
    apiKey.projectId = PROJECT_ID;
    apiKey.name = "CI deploy key";
    apiKey.apiKey = new ObjectID(API_KEY_VALUE);

    await recorder.recordCreate({
      model: new ApiKey(),
      createdItem: apiKey,
      props: PROPS,
    });

    expect(inserted).toHaveLength(1);
    expect(changeOf(inserted[0]!, "apiKey")).toEqual({
      field: "apiKey",
      newValue: "[REDACTED]",
    });
    expect(changeOf(inserted[0]!, "name")).toEqual({
      field: "name",
      newValue: "CI deploy key",
    });

    const file: string = exportedFile(inserted);

    expect(file).not.toContain(API_KEY_VALUE);
    expect(file).toContain("CI deploy key");
    expect(file).toContain('{"field":"apiKey","newValue":"[REDACTED]"}');
  });

  test("rotating a monitor's secret key is recorded as a change, without either key", async () => {
    const before: Monitor = new Monitor();
    before.id = ObjectID.generate();
    before.projectId = PROJECT_ID;
    before.name = "Heartbeat";
    before.incomingRequestSecretKey = new ObjectID(OLD_SECRET_KEY);

    await recorder.recordUpdate({
      model: new Monitor(),
      before,
      updatedFields: {
        incomingRequestSecretKey: new ObjectID(NEW_SECRET_KEY),
      },
      itemId: before.id,
      props: PROPS,
    });

    expect(inserted).toHaveLength(1);
    expect(changeOf(inserted[0]!, "incomingRequestSecretKey")).toEqual({
      field: "incomingRequestSecretKey",
      oldValue: "[REDACTED]",
      newValue: "[REDACTED]",
    });

    const file: string = exportedFile(inserted);

    expect(file).not.toContain(OLD_SECRET_KEY);
    expect(file).not.toContain(NEW_SECRET_KEY);
  });

  test("a monitor's secret key written back unchanged records nothing", async () => {
    const before: Monitor = new Monitor();
    before.id = ObjectID.generate();
    before.projectId = PROJECT_ID;
    before.incomingRequestSecretKey = new ObjectID(OLD_SECRET_KEY);

    await recorder.recordUpdate({
      model: new Monitor(),
      before,
      updatedFields: {
        incomingRequestSecretKey: new ObjectID(OLD_SECRET_KEY),
      },
      itemId: before.id,
      props: PROPS,
    });

    expect(inserted).toHaveLength(0);
  });

  test("a status page's embed token and hashed master password never leave", async () => {
    const page: StatusPage = new StatusPage();
    page.id = ObjectID.generate();
    page.projectId = PROJECT_ID;
    page.name = "Public status";
    page.embeddedOverallStatusToken = EMBED_TOKEN;
    page.masterPassword = new HashedString(MASTER_PASSWORD_HASH, true);

    await recorder.recordCreate({
      model: new StatusPage(),
      createdItem: page,
      props: PROPS,
    });

    expect(inserted).toHaveLength(1);
    expect(changeOf(inserted[0]!, "embeddedOverallStatusToken")).toEqual({
      field: "embeddedOverallStatusToken",
      newValue: "[REDACTED]",
    });

    // Recorded as set if it is recorded at all - never with the hash.
    const masterPassword: JSONObject | undefined = changeOf(
      inserted[0]!,
      "masterPassword",
    );

    expect(
      masterPassword === undefined ||
        masterPassword["newValue"] === "[REDACTED]",
    ).toBe(true);

    const file: string = exportedFile(inserted);

    expect(file).not.toContain(EMBED_TOKEN);
    expect(file).not.toContain(MASTER_PASSWORD_HASH);
    expect(file).toContain("Public status");
  });

  test("an audit log export's credentials never reach its entry, and the exporter's bookkeeping records nothing", async () => {
    const item: AuditLogExport = new AuditLogExport();
    item.id = ObjectID.generate();
    item.projectId = PROJECT_ID;
    item.name = "Compliance archive";
    item.destinationType = AuditLogExportDestinationType.AmazonS3;
    item.config = { bucket: "acme-audit-logs", region: "eu-west-1" };
    item.secrets = JSON.stringify({ secretAccessKey: EXPORT_SECRET });

    await recorder.recordCreate({
      model: new AuditLogExport(),
      createdItem: item,
      props: PROPS,
    });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.resourceType).toBe("Audit Log Export");
    expect(changeOf(inserted[0]!, "secrets")).toBeUndefined();
    expect(changeOf(inserted[0]!, "config")).toBeDefined();

    const file: string = exportedFile(inserted);

    expect(file).not.toContain(EXPORT_SECRET);
    expect(file).toContain("acme-audit-logs");

    // The cursor, counts and status the exporter writes are never an entry, even where system events are stored.
    await recorder.recordUpdate({
      model: new AuditLogExport(),
      before: item,
      updatedFields: {
        cursorCreatedAt: "2026-10-24T09:00:00.000Z",
        cursorEntryId: ObjectID.generate().toString(),
        exportedEntryCount: 120,
        lastExportedAt: "2026-10-24T09:01:00.000Z",
        lastAttemptAt: "2026-10-24T09:01:00.000Z",
        lastError: "Amazon S3 answered 403.",
        failingSince: "2026-10-24T09:01:00.000Z",
        consecutiveFailureCount: 3,
        nextAttemptAt: "2026-10-24T09:09:00.000Z",
      },
      itemId: item.id,
      props: { isRoot: true },
    });

    expect(inserted).toHaveLength(1);
  });

  test("an entry recorded before its secret was listed is redacted on its way out", () => {
    const old: JSONObject = {
      _id: ObjectID.generate().toString(),
      createdAt: "2026-09-01 08:00:00",
      projectId: PROJECT_ID.toString(),
      action: "Create",
      resourceType: "API Key",
      resourceName: "Old key",
      changes: JSON.stringify([
        { field: "name", newValue: "Old key" },
        { field: "apiKey", newValue: API_KEY_VALUE },
      ]),
    };

    const batch: Array<AuditLogExportRecord> = AuditLogExporter.toBatch({
      rows: [old],
      maxBytes: 1024 * 1024,
    });

    expect(batch[0]!.changes).toEqual([
      { field: "name", newValue: "Old key" },
      { field: "apiKey", newValue: "[REDACTED]" },
    ]);
    expect(toNdjson(batch)).not.toContain(API_KEY_VALUE);
  });

  test("an old update of a secret keeps its shape: nothing stays nothing, a value becomes the marker", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord({
      _id: ObjectID.generate().toString(),
      createdAt: "2026-09-01 08:00:00",
      resourceType: "Monitor",
      changes: JSON.stringify([
        {
          field: "serverMonitorSecretKey",
          oldValue: null,
          newValue: OLD_SECRET_KEY,
        },
        { field: "name", oldValue: "Old", newValue: "New" },
      ]),
    })!;

    expect(redactAuditLogExportRecord(record).changes).toEqual([
      {
        field: "serverMonitorSecretKey",
        oldValue: null,
        newValue: "[REDACTED]",
      },
      { field: "name", oldValue: "Old", newValue: "New" },
    ]);
  });

  test("an entry with nothing to redact passes through as it is", () => {
    const record: AuditLogExportRecord = toAuditLogExportRecord({
      _id: ObjectID.generate().toString(),
      createdAt: "2026-09-01 08:00:00",
      resourceType: "Monitor",
      changes: JSON.stringify([{ field: "name", newValue: "Heartbeat" }]),
    })!;

    expect(redactAuditLogExportRecord(record)).toBe(record);
    expect(getExportRedactedFields(null).size).toBe(0);
    expect(getExportRedactedFields("Something Else").size).toBe(0);
  });

  test("the fields redacted on the way out are the listed, encrypted, hashed and unreadable ones", () => {
    expect(getExportRedactedFields("API Key").has("apiKey")).toBe(true);
    expect(
      getExportRedactedFields("Monitor").has("incomingEmailSecretKey"),
    ).toBe(true);
    expect(getExportRedactedFields("Status Page").has("masterPassword")).toBe(
      true,
    );
    expect(getExportRedactedFields("Audit Log Export").has("secrets")).toBe(
      true,
    );
    // Ordinary fields never are.
    expect(getExportRedactedFields("Monitor").has("name")).toBe(false);
    expect(getExportRedactedFields("Audit Log Export").has("config")).toBe(
      false,
    );
  });
});
