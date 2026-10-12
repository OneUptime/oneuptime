import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import CoreAuditLogService from "Common/Server/Services/AuditLogService";
import DatabaseService from "Common/Server/Services/DatabaseService";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A packet capture's pcap file holds the traffic itself, so who took a copy
 * of it is recorded: the download route asks the recorder for a Download
 * entry before the file leaves. What the entry says, and when it is made,
 * follows the same rules as every other entry - and it must never carry the
 * file.
 *
 * The harness is the recorder suite's (AuditLogRecorder.test.ts): no
 * ClickHouse or Postgres, the insert and the project and user reads stubbed.
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
const CAPTURE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const FILE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

let project: Project;
let inserted: Array<AuditLog>;
let insert: jest.Mock;
let recorder: AuditLogRecorder;

function makeProject(enableAuditLogs: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = enableAuditLogs;
  item.auditLogsRetentionInDays = 30;
  return item;
}

function makeUser(): User {
  const user: User = new User();
  user._id = USER_ID.toString();
  user.name = new Name("Ada Lovelace");
  user.email = new Email("ada@example.com");
  return user;
}

// What the download route hands the recorder: the columns that say what was taken.
function downloadedCapture(): PacketCapture {
  const capture: PacketCapture = new PacketCapture(CAPTURE_ID);
  capture.projectId = PROJECT_ID;
  capture.name = "eth0: host 10.0.0.5";
  capture.interfaceName = "eth0";
  capture.bpfFilter = "host 10.0.0.5";
  capture.probeId = PROBE_ID;
  capture.packetCount = 42;
  capture.fileSizeInBytes = 4096;
  return capture;
}

function recordDownload(
  item: PacketCapture = downloadedCapture(),
  props: DatabaseCommonInteractionProps = USER_PROPS,
): Promise<void> {
  return recorder.recordDownload({
    model: new PacketCapture(),
    downloadedItem: item,
    itemId: CAPTURE_ID,
    props: props,
  });
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

function changesOf(entry: AuditLog): Array<JSONObject> {
  return (entry.changes || []) as Array<JSONObject>;
}

function fieldsOf(entry: AuditLog): Array<string> {
  return changesOf(entry).map((change: JSONObject): string => {
    return String(change["field"]);
  });
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(true);
  inserted = [];

  insert = jest.fn(((createBy: { data: AuditLog }) => {
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
  findUserMock.mockImplementation(() => {
    return Promise.resolve(makeUser());
  });

  // Relation names are looked up in the project; nothing to find here.
  jest
    .spyOn(DatabaseService.prototype, "findBy")
    .mockResolvedValue([] as Array<BaseModel> as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a download of a packet capture's file", () => {
  test("is recorded as a Download of the Packet Capture, by the person who took it", async () => {
    await recordDownload();

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Download);
    expect(entry.action).toBe("Download");
    expect(entry.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(entry.resourceType).toBe("Packet Capture");
    expect(entry.resourceId?.toString()).toBe(CAPTURE_ID.toString());
    expect(entry.resourceName).toBe("eth0: host 10.0.0.5");
    expect(entry.userId?.toString()).toBe(USER_ID.toString());
    expect(entry.userName).toBe("Ada Lovelace");
    expect(entry.userEmail).toBe("ada@example.com");
    expect(entry.userType).toBe(UserType.User);
    expect(entry.retentionDate).toBeInstanceOf(Date);
  });

  test("says what was downloaded: the interface, the filter, the probe, the packets and the size", async () => {
    await recordDownload();

    const entry: AuditLog = onlyEntry();
    const changes: Array<JSONObject> = changesOf(entry);

    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "interfaceName", newValue: "eth0" },
        { field: "bpfFilter", newValue: "host 10.0.0.5" },
        { field: "packetCount", newValue: 42 },
        { field: "fileSizeInBytes", newValue: 4096 },
      ]),
    );
    expect(fieldsOf(entry)).toContain("probeId");
  });

  test("never carries the file, even when the item it is handed has one", async () => {
    const item: PacketCapture = downloadedCapture();
    item.fileId = FILE_ID;

    await recordDownload(item);

    const entry: AuditLog = onlyEntry();

    expect(fieldsOf(entry)).not.toContain("file");
    expect(fieldsOf(entry)).not.toContain("fileId");
    expect(JSON.stringify(entry.changes)).not.toContain(FILE_ID.toString());
  });

  test("an API key's download is recorded as the key's", async () => {
    await recordDownload(downloadedCapture(), {
      userType: UserType.API,
      tenantId: PROJECT_ID,
      apiKeyId: new ObjectID("66666666-6666-4666-8666-666666666666"),
      apiKeyName: "Wireshark automation",
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Download);
    expect(entry.userId).toBeUndefined();
    expect(entry.apiKeyId?.toString()).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(entry.apiKeyName).toBe("Wireshark automation");
  });

  test("nothing is recorded while the project has audit logging off", async () => {
    project = makeProject(false);

    await recordDownload();

    expect(inserted).toHaveLength(0);
  });

  test("the project comes from the item when the caller's props carry none", async () => {
    await recordDownload(downloadedCapture(), {
      userId: USER_ID,
      userType: UserType.User,
    });

    expect(onlyEntry().projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a failed insert never fails the download", async () => {
    insert.mockImplementation((() => {
      return Promise.reject(new Error("clickhouse unavailable"));
    }) as never);

    await expect(recordDownload()).resolves.toBeUndefined();
  });

  test("core's delegate reaches the recorder: what the download route calls", async () => {
    await CoreAuditLogService.recordDownload({
      model: new PacketCapture(),
      downloadedItem: downloadedCapture(),
      itemId: CAPTURE_ID,
      props: USER_PROPS,
    });

    expect(onlyEntry().action).toBe(AuditLogAction.Download);
  });

  test("on the Community Edition the delegate records nothing, and the download goes ahead", async () => {
    uninstallEnterpriseModule();

    await expect(
      CoreAuditLogService.recordDownload({
        model: new PacketCapture(),
        downloadedItem: downloadedCapture(),
        itemId: CAPTURE_ID,
        props: USER_PROPS,
      }),
    ).resolves.toBeUndefined();

    expect(inserted).toHaveLength(0);
  });
});

describe("starting and deleting a capture are recorded too, without the file", () => {
  test("a started capture is a Create entry", async () => {
    const created: PacketCapture = downloadedCapture();
    created.fileId = FILE_ID;

    await recorder.recordCreate({
      model: new PacketCapture(),
      createdItem: created,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Create);
    expect(entry.resourceType).toBe("Packet Capture");
    expect(fieldsOf(entry)).not.toContain("fileId");
  });

  test("updates are never recorded: after it starts, only the probe and the server write to a capture", () => {
    const model: PacketCapture = new PacketCapture();

    expect(model.enableAuditLogOn?.create).toBe(true);
    expect(model.enableAuditLogOn?.delete).toBe(true);
    expect(model.enableAuditLogOn?.update).toBe(false);
  });
});
