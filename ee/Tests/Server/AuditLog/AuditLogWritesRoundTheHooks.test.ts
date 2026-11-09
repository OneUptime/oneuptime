import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionUnmergeOutcome,
} from "Common/Server/Utils/Telemetry/TelemetryExceptionMerge";
import TelemetryExceptionService from "Common/Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService from "Common/Server/Services/TelemetryExceptionActivityService";
import ModelPermission from "Common/Server/Types/Database/Permissions/Index";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import DataProduct from "Common/Models/DatabaseModels/DataProduct";
import DataStore from "Common/Models/DatabaseModels/DataStore";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import Project from "Common/Models/DatabaseModels/Project";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT A PERSON DOES THROUGH A WRITE THAT GOES ROUND DATABASESERVICE
 * (issue #6276).
 *
 * Merging exceptions is written with raw SQL - it moves counts under row
 * locks - so DatabaseService's audit hook never saw it, and only OneUptime
 * writes the column it sets (the exception merged into), so the audit
 * defaults left that column out of every entry. Merging and unmerging left
 * no trace in the audit log at all.
 *
 * Such a write now records its change itself, once it commits, with the
 * person's props, and names the columns that say what they did
 * (recordUpdate's includeColumns). Pinned here, against the entry that
 * reaches the insert:
 *
 *   - an included column is recorded although only OneUptime writes it, on
 *     that entry only: the same write without it, and every other write of
 *     OneUptime's own, records nothing, as before;
 *   - one nobody may read, and a secret, is recorded as changed and never
 *     with its value; the row's id and timestamps never are;
 *   - merging exceptions A and B into C enters A and B, by the person who
 *     merged them, on each one's own page; unmerging enters the reverse.
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
const SERVICE_ID: string = "20000000-0000-4000-8000-000000000001";

// Four exceptions of one service.
const A: string = "30000000-0000-4000-8000-00000000000a";
const B: string = "30000000-0000-4000-8000-00000000000b";
const C: string = "30000000-0000-4000-8000-00000000000c";
const D: string = "30000000-0000-4000-8000-00000000000d";

const MERGED_INTO: string = "mergedIntoTelemetryExceptionId";

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function makeProject(enableAuditLogs: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = enableAuditLogs;
  item.auditLogsRetentionInDays = 30;
  item.storeSystemEventsInAuditLogs = false;
  return item;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

function exceptionBefore(data: {
  id?: ObjectID;
  mergedInto?: string | null;
}): TelemetryException {
  const before: TelemetryException = new TelemetryException(
    data.id || RECORD_ID,
  );
  before.projectId = PROJECT_ID;
  before.occuranceCount = 10;
  before.lastSeenAt = new Date("2026-10-29T00:00:00.000Z");

  if (data.mergedInto) {
    before.mergedIntoTelemetryExceptionId = new ObjectID(data.mergedInto);
  }

  return before;
}

async function recordUpdate<TModel extends BaseModel>(data: {
  model: TModel;
  before: TModel;
  updatedFields: JSONObject;
  includeColumns?: Array<string>;
  props?: DatabaseCommonInteractionProps;
}): Promise<void> {
  await recorder.recordUpdate({
    model: data.model,
    before: data.before,
    updatedFields: data.updatedFields,
    itemId: data.before.id || RECORD_ID,
    props: data.props || USER_PROPS,
    ...(data.includeColumns ? { includeColumns: data.includeColumns } : {}),
  });
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(true);
  inserted = [];

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  recorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    if (findOneById.id.toString() !== USER_ID.toString()) {
      return Promise.resolve(null);
    }

    const user: User = new User();
    user._id = USER_ID.toString();
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");
    return Promise.resolve(user);
  }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a column a write round the hooks names as what a person did", () => {
  test("is recorded although only OneUptime writes it", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({}),
      updatedFields: { [MERGED_INTO]: new ObjectID(C) } as never,
      includeColumns: [MERGED_INTO],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceType).toBe("Exception");
    expect(entry.resourceId?.toString()).toBe(RECORD_ID.toString());
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(changesOf(entry)).toEqual([
      { field: MERGED_INTO, oldValue: null, newValue: C },
    ]);
  });

  test("without it, the same write records nothing: only OneUptime's bookkeeping changed", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({}),
      updatedFields: { [MERGED_INTO]: new ObjectID(C) } as never,
    });

    expect(inserted).toHaveLength(0);
  });

  test("lets in only what it names: what else the write touched stays out", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({}),
      updatedFields: {
        [MERGED_INTO]: new ObjectID(C),
        mergedAt: new Date("2026-11-07T10:00:00.000Z"),
        mergedByUserId: USER_ID,
        occuranceCount: 0,
        lastSeenAt: new Date("2026-11-07T10:00:00.000Z"),
      } as never,
      includeColumns: [MERGED_INTO],
    });

    expect(
      changesOf(onlyEntry()).map((change: JSONObject): unknown => {
        return change["field"];
      }),
    ).toEqual([MERGED_INTO]);
  });

  test("a column nobody may read is recorded as changed, never with its value", async () => {
    const before: Runbook = new Runbook(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "Restart the API";
    before.webhookSecretKey = "old-key-0f3a";

    await recordUpdate({
      model: new Runbook(),
      before,
      updatedFields: { webhookSecretKey: "new-key-9c2b" },
      includeColumns: ["webhookSecretKey"],
    });

    const entry: AuditLog = onlyEntry();

    expect(changesOf(entry)).toEqual([
      {
        field: "webhookSecretKey",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(JSON.stringify(entry.changes)).not.toContain("key-");
    // The entry names the runbook it is about.
    expect(entry.resourceName).toBe("Restart the API");
  });

  test("a secret only OneUptime writes is recorded as changed, never with its value", async () => {
    const before: DataProduct = new DataProduct(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.badgeToken = "badge-old-5e1d";

    await recordUpdate({
      model: new DataProduct(),
      before,
      updatedFields: { badgeToken: "badge-new-77aa" },
      includeColumns: ["badgeToken"],
    });

    const entry: AuditLog = onlyEntry();

    expect(changesOf(entry)).toEqual([
      {
        field: "badgeToken",
        oldValue: AUDIT_LOG_REDACTED_VALUE,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
    expect(JSON.stringify(entry.changes)).not.toContain("badge-");
  });

  test("a secret set for the first time is recorded as set: nothing before, the marker after", async () => {
    const before: DataProduct = new DataProduct(RECORD_ID);
    before.projectId = PROJECT_ID;

    await recordUpdate({
      model: new DataProduct(),
      before,
      updatedFields: { badgeToken: "badge-new-77aa" },
      includeColumns: ["badgeToken"],
    });

    expect(changesOf(onlyEntry())).toEqual([
      {
        field: "badgeToken",
        oldValue: null,
        newValue: AUDIT_LOG_REDACTED_VALUE,
      },
    ]);
  });

  test("never the row's id, timestamps or version, whoever names them", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({}),
      updatedFields: {
        _id: new ObjectID(D),
        createdAt: new Date("2026-11-01T10:00:00.000Z"),
        updatedAt: new Date("2026-11-07T10:00:00.000Z"),
        deletedAt: new Date("2026-11-07T10:00:00.000Z"),
        version: 7,
      } as never,
      includeColumns: [
        "_id",
        "createdAt",
        "updatedAt",
        "deletedAt",
        "version",
        // Naming what is not a column of the model lets nothing in.
        "notAColumn",
      ],
    });

    expect(inserted).toHaveLength(0);
  });

  test("a column written back as it was is no change: no entry", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({ mergedInto: C }),
      updatedFields: { [MERGED_INTO]: new ObjectID(C.toUpperCase()) } as never,
      includeColumns: [MERGED_INTO],
    });

    expect(inserted).toHaveLength(0);
  });

  test("the project's settings still decide: with audit logging off, nothing is recorded", async () => {
    project = makeProject(false);

    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({}),
      updatedFields: { [MERGED_INTO]: new ObjectID(C) } as never,
      includeColumns: [MERGED_INTO],
    });

    expect(inserted).toHaveLength(0);
  });
});

describe("no other write of OneUptime's own to an exception is recorded", () => {
  test("ingest counting an occurrence, OneUptime AI explaining it, a regression: no entry", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({}),
      updatedFields: {
        occuranceCount: 11,
        lastSeenAt: new Date("2026-11-07T10:00:00.000Z"),
        firstSeenAt: new Date("2026-10-01T10:00:00.000Z"),
        firstSeenInRelease: "0.9.0",
        lastSeenInRelease: "1.3.0",
        regressedAt: new Date("2026-11-07T10:00:00.000Z"),
        aiExplanation: { summary: "A null user reached the checkout." },
        aiExplanationGeneratedAt: new Date("2026-11-07T10:00:00.000Z"),
      } as never,
    });

    expect(inserted).toHaveLength(0);
  });

  test("the merged-into column written by anything but a person's merge: no entry", async () => {
    await recordUpdate({
      model: new TelemetryException(),
      before: exceptionBefore({ mergedInto: C }),
      updatedFields: {
        [MERGED_INTO]: null,
        mergedAt: null,
        mergedByUserId: null,
      } as never,
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(inserted).toHaveLength(0);
  });
});

/*
 * The merge and the unmerge end to end: TelemetryExceptionMerge with
 * Postgres faked as in Common's TelemetryExceptionMerge.test.ts, core's
 * AuditLogService, and this recorder - the entries that reach the insert.
 */
describe("merging and unmerging exceptions", () => {
  interface Row {
    id: string;
    projectId: string;
    primaryEntityId: string;
    fingerprint: string;
    mergedIntoId: string | null;
    occuranceCount: number;
    firstSeenAt: Date | null;
    lastSeenAt: Date | null;
    firstSeenInRelease: string | null;
    lastSeenInRelease: string | null;
    unhandled: boolean;
  }

  let rows: Array<Row>;

  function row(id: string, mergedIntoId: string | null = null): Row {
    return {
      id,
      projectId: PROJECT_ID.toString(),
      primaryEntityId: SERVICE_ID,
      fingerprint: `fp-${id.slice(-1)}`,
      mergedIntoId,
      occuranceCount: 10,
      firstSeenAt: new Date("2026-10-20T00:00:00.000Z"),
      lastSeenAt: new Date("2026-10-29T00:00:00.000Z"),
      firstSeenInRelease: "1.0.0",
      lastSeenInRelease: "1.2.0",
      unhandled: false,
    };
  }

  function mergedIntoChanges(): Array<[string, unknown, unknown]> {
    return inserted.map((entry: AuditLog): [string, unknown, unknown] => {
      const change: JSONObject = changesOf(entry)[0]!;
      expect(changesOf(entry)).toHaveLength(1);
      expect(change["field"]).toBe(MERGED_INTO);
      return [
        entry.resourceId!.toString(),
        change["oldValue"],
        change["newValue"],
      ];
    });
  }

  beforeEach(() => {
    rows = [row(A), row(B), row(C)];

    jest
      .spyOn(TelemetryExceptionMerge, "readOwnSeen")
      .mockResolvedValue(null as never);
    jest
      .spyOn(TelemetryExceptionActivityService, "record")
      .mockResolvedValue(0 as never);
    jest
      .spyOn(TelemetryExceptionService, "forgetGroupFingerprints")
      .mockResolvedValue(undefined as never);
    jest.spyOn(ModelPermission, "getUpdatableQuery").mockImplementation((async (
      _type: unknown,
      query: unknown,
    ) => {
      return query;
    }) as never);
    jest
      .spyOn(TelemetryExceptionService, "addExceptionScope")
      .mockImplementation((async (query: unknown) => {
        return query;
      }) as never);
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async () => {
        return rows.map((candidate: Row): TelemetryException => {
          const model: TelemetryException = new TelemetryException();
          model._id = candidate.id;
          model.primaryEntityId = new ObjectID(candidate.primaryEntityId);
          model.fingerprint = candidate.fingerprint;
          if (candidate.mergedIntoId) {
            model.mergedIntoTelemetryExceptionId = new ObjectID(
              candidate.mergedIntoId,
            );
          }
          return model;
        });
      }) as never);
    jest
      .spyOn(TelemetryExceptionService, "executeTransaction")
      .mockImplementation((async (
        run: (manager: unknown) => Promise<unknown>,
      ) => {
        return run({
          query: async (sql: string, params: Array<unknown>) => {
            if (!sql.trim().startsWith("SELECT")) {
              return [];
            }

            const ids: Array<string> = (params[0] as Array<string>) || [];
            const into: Array<string> = (params[1] as Array<string>) || [];

            return rows.filter((candidate: Row): boolean => {
              return (
                ids.includes(candidate.id) ||
                (candidate.mergedIntoId !== null &&
                  into.includes(candidate.mergedIntoId))
              );
            });
          },
        });
      }) as never);
  });

  test("merging A and B into C enters A and B, by the person who merged them, on each one's own page", async () => {
    await TelemetryExceptionMerge.merge({
      telemetryExceptionId: new ObjectID(C),
      mergedTelemetryExceptionIds: [new ObjectID(A), new ObjectID(B)],
      props: USER_PROPS,
    });

    expect(mergedIntoChanges()).toEqual([
      [A, null, C],
      [B, null, C],
    ]);

    for (const entry of inserted) {
      expect(entry.action).toBe(AuditLogAction.Update);
      expect(entry.resourceType).toBe("Exception");
      expect(entry.rootResourceType).toBe("Exception");
      expect(entry.rootResourceId?.toString()).toBe(
        entry.resourceId?.toString(),
      );
      expect(entry.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(entry.userId?.toString()).toBe(USER_ID.toString());
      expect(entry.userName).toBe("Ada Lovelace");
      expect(entry.userType).toBe(UserType.User);
    }
  });

  test("an exception merged into a merged one comes along, and is entered too", async () => {
    rows = [row(A), row(C), row(D, A)];

    await TelemetryExceptionMerge.merge({
      telemetryExceptionId: new ObjectID(C),
      mergedTelemetryExceptionIds: [new ObjectID(A)],
      props: USER_PROPS,
    });

    expect(mergedIntoChanges()).toEqual([
      [A, null, C],
      [D, A, C],
    ]);
  });

  test("merging again what is merged already enters nothing", async () => {
    rows = [row(A, C), row(C)];

    const result: { merged: Array<{ outcome: ExceptionMergeOutcome }> } =
      await TelemetryExceptionMerge.merge({
        telemetryExceptionId: new ObjectID(C),
        mergedTelemetryExceptionIds: [new ObjectID(A)],
        props: USER_PROPS,
      });

    expect(result.merged[0]!.outcome).toBe(ExceptionMergeOutcome.AlreadyMerged);
    expect(inserted).toHaveLength(0);
  });

  test("a refused merge enters nothing", async () => {
    rows = [row(A, D), row(C), row(D)];

    await expect(
      TelemetryExceptionMerge.merge({
        telemetryExceptionId: new ObjectID(C),
        mergedTelemetryExceptionIds: [new ObjectID(A)],
        props: USER_PROPS,
      }),
    ).rejects.toThrow();
    expect(inserted).toHaveLength(0);
  });

  test("unmerging enters the reverse: from the exception it was merged into, to none", async () => {
    rows = [row(A, C), row(C)];

    const result: { outcome: ExceptionUnmergeOutcome } =
      await TelemetryExceptionMerge.unmerge({
        telemetryExceptionId: new ObjectID(A),
        props: USER_PROPS,
      });

    expect(result.outcome).toBe(ExceptionUnmergeOutcome.Unmerged);
    expect(mergedIntoChanges()).toEqual([[A, C, null]]);
    expect(onlyEntry().userId?.toString()).toBe(USER_ID.toString());
  });

  test("unmerging one that is not merged enters nothing", async () => {
    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(A),
      props: USER_PROPS,
    });

    expect(inserted).toHaveLength(0);
  });

  test("a merge through an API key is entered with the key's name", async () => {
    await TelemetryExceptionMerge.merge({
      telemetryExceptionId: new ObjectID(C),
      mergedTelemetryExceptionIds: [new ObjectID(A)],
      props: {
        userId: USER_ID,
        userType: UserType.API,
        tenantId: PROJECT_ID,
        apiKeyId: RECORD_ID,
        apiKeyName: "CI triage",
      },
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.userType).toBe(UserType.API);
    expect(entry.apiKeyName).toBe("CI triage");
    expect(entry.userName).toBeUndefined();
  });

  test("in a project that does not record audit logs, a merge enters nothing and still merges", async () => {
    project = makeProject(false);

    const result: { merged: Array<{ outcome: ExceptionMergeOutcome }> } =
      await TelemetryExceptionMerge.merge({
        telemetryExceptionId: new ObjectID(C),
        mergedTelemetryExceptionIds: [new ObjectID(A)],
        props: USER_PROPS,
      });

    expect(result.merged[0]!.outcome).toBe(ExceptionMergeOutcome.Merged);
    expect(inserted).toHaveLength(0);
  });

  test("a merge whose entry cannot be written still merges", async () => {
    recorder = new AuditLogRecorder({
      store: {
        create: () => {
          return Promise.reject(new Error("ClickHouse is down"));
        },
      } as unknown as AuditLogStore,
    });
    installFakeEnterpriseModule({ auditLogRecorder: recorder });

    const result: { merged: Array<{ outcome: ExceptionMergeOutcome }> } =
      await TelemetryExceptionMerge.merge({
        telemetryExceptionId: new ObjectID(C),
        mergedTelemetryExceptionIds: [new ObjectID(A)],
        props: USER_PROPS,
      });

    expect(result.merged[0]!.outcome).toBe(ExceptionMergeOutcome.Merged);
  });
});

/*
 * The other actions people take that are written round the hooks, as the
 * recorder writes what each one hands it (the payloads are pinned at each
 * site: DataObservabilityAuditLog, CloudConnectionStreamAPI,
 * PacketCaptureService, RunbookWebhookRoute and
 * StatusPageSubscriberUnsubscribe).
 */
describe("the other actions written round the hooks", () => {
  const AT: Date = new Date("2026-11-07T10:00:00.000Z");

  test("watching a data store's tables: the setting, off to on, on the store's page", async () => {
    const before: DataStore = new DataStore(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "warehouse";
    before.isTableHealthEnabled = false;

    await recordUpdate({
      model: new DataStore(),
      before,
      updatedFields: { isTableHealthEnabled: true },
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceType).toBe("Data Store");
    expect(entry.resourceName).toBe("warehouse");
    expect(entry.rootResourceId?.toString()).toBe(RECORD_ID.toString());
    expect(changesOf(entry)).toEqual([
      { field: "isTableHealthEnabled", oldValue: false, newValue: true },
    ]);
  });

  test("a stream key made: its hashes as changed, never their value, and when it was made", async () => {
    const before: CloudConnection = new CloudConnection(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "Production AWS";

    await recordUpdate({
      model: new CloudConnection(),
      before,
      updatedFields: {
        streamKeyHashes: { current: { hash: "sha256-abc", createdAt: 1 } },
        streamKeyCreatedAt: AT,
      } as never,
      includeColumns: ["streamKeyHashes", "streamKeyCreatedAt"],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceName).toBe("Production AWS");
    expect(changesOf(entry)).toEqual(
      expect.arrayContaining([
        {
          field: "streamKeyHashes",
          oldValue: null,
          newValue: AUDIT_LOG_REDACTED_VALUE,
        },
        {
          field: "streamKeyCreatedAt",
          oldValue: null,
          newValue: AT.toISOString(),
        },
      ]),
    );
    expect(changesOf(entry)).toHaveLength(2);
    expect(JSON.stringify(entry.changes)).not.toContain("sha256");
  });

  test("streaming stopped: the keys, from set to none", async () => {
    const before: CloudConnection = new CloudConnection(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.streamKeyHashes = { current: { hash: "sha256-abc" } };
    before.streamKeyCreatedAt = AT;

    await recordUpdate({
      model: new CloudConnection(),
      before,
      updatedFields: { streamKeyHashes: null, streamKeyCreatedAt: null },
      includeColumns: ["streamKeyHashes", "streamKeyCreatedAt"],
    });

    expect(changesOf(onlyEntry())).toEqual(
      expect.arrayContaining([
        {
          field: "streamKeyHashes",
          oldValue: AUDIT_LOG_REDACTED_VALUE,
          newValue: null,
        },
        {
          field: "streamKeyCreatedAt",
          oldValue: AT.toISOString(),
          newValue: null,
        },
      ]),
    );
  });

  test("reading event hubs turned on: what it reads, by the path that changed", async () => {
    const before: CloudConnection = new CloudConnection(RECORD_ID);
    before.projectId = PROJECT_ID;

    await recordUpdate({
      model: new CloudConnection(),
      before,
      updatedFields: {
        streamKeyCreatedAt: AT,
        streamState: {
          hostSubscriptionId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
          offsets: {},
        },
      } as never,
      includeColumns: ["streamKeyCreatedAt", "streamState"],
    });

    const state: JSONObject | undefined = changesOf(onlyEntry()).find(
      (change: JSONObject): boolean => {
        return change["field"] === "streamState";
      },
    );

    expect(state?.["newValue"]).toEqual({
      hostSubscriptionId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      offsets: {},
    });
  });

  test("a packet capture stopped: when the stop was asked for, by whom", async () => {
    const before: PacketCapture = new PacketCapture(RECORD_ID);
    before.projectId = PROJECT_ID;
    before.name = "eth0 on edge-1";

    await recordUpdate({
      model: new PacketCapture(),
      before,
      updatedFields: { stopRequestedAt: AT } as never,
      includeColumns: ["stopRequestedAt"],
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceType).toBe("Packet Capture");
    expect(entry.resourceName).toBe("eth0 on edge-1");
    expect(entry.userName).toBe("Ada Lovelace");
    expect(changesOf(entry)).toEqual([
      { field: "stopRequestedAt", oldValue: null, newValue: AT.toISOString() },
    ]);
  });

  describe("a subscriber unsubscribing themselves", () => {
    const STATUS_PAGE_ID: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );

    async function unsubscribed(): Promise<void> {
      const before: StatusPageSubscriber = new StatusPageSubscriber(RECORD_ID);
      before.projectId = PROJECT_ID;
      before.statusPageId = STATUS_PAGE_ID;
      before.isUnsubscribed = false;

      await recordUpdate({
        model: new StatusPageSubscriber(),
        before,
        updatedFields: { isUnsubscribed: true },
        props: { isRoot: true, tenantId: PROJECT_ID },
      });
    }

    test("is a system event: not recorded unless the project stores them", async () => {
      await unsubscribed();

      expect(inserted).toHaveLength(0);
    });

    test("stored, it is on the status page's Audit Logs, by System", async () => {
      project.storeSystemEventsInAuditLogs = true;

      await unsubscribed();

      const entry: AuditLog = onlyEntry();

      expect(entry.userType).toBe("System");
      expect(entry.rootResourceType).toBe("Status Page");
      expect(entry.rootResourceId?.toString()).toBe(STATUS_PAGE_ID.toString());
      expect(changesOf(entry)).toEqual([
        { field: "isUnsubscribed", oldValue: false, newValue: true },
      ]);
    });
  });
});
