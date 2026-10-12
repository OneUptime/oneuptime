import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THIS FILE DEFENDS
 *
 * Packet captures as the dashboard drives them, end to end through the
 * server: the request the dashboard sends, the caller's real props, BaseAPI's
 * CRUD routes, PacketCaptureService's hooks and the whole permission layer -
 * nothing of it stubbed but the table, which is held in memory, and the
 * probe and the file store around it.
 *
 * A customer's every capture was refused, the project owner's included:
 * "User is not allowed to create on fileId column of Packet Capture". The
 * create hook stamped fileId null, DatabaseService checks the record as the
 * hooks leave it against the caller's create permission, and nobody may
 * create fileId. The service suite called the hook by itself and the API
 * suite ran Stop and Download only, so no test ever made a member's create.
 * This one makes every write a member makes, with each permission the docs
 * name (probe/packet-capture.md, Permissions):
 *
 *   - Start Packet Capture starts captures: Project Owner and Admin, and
 *     whoever is given it - a member's team, a project API key.
 *   - Delete Packet Capture deletes a capture, and its file with it.
 *   - Read Packet Capture lists them: who started what, where and when -
 *     never the file, which only Download hands out.
 *   - Nobody edits one: everything after the start is the probe's.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendFileResponse: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import PacketCaptureAPI from "../../../Server/API/PacketCaptureAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AuditLogService from "../../../Server/Services/AuditLogService";
import FileService from "../../../Server/Services/FileService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import PacketCaptureService from "../../../Server/Services/PacketCaptureService";
import ProbeService from "../../../Server/Services/ProbeService";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import File from "../../../Models/DatabaseModels/File";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import Probe from "../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import PacketCaptureStatus from "../../../Types/PacketCapture/PacketCaptureStatus";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  DASHBOARD_START_COLUMNS,
  dashboardStartBody,
} from "../../Helpers/PacketCaptureStartBody";

type MockedFn = ReturnType<typeof jest.fn>;

const START_ROUTE: string = "/packet-capture";
const LIST_ROUTE: string = "/packet-capture/get-list";
const DELETE_ROUTE: string = "/packet-capture/:id";
const UPDATE_ROUTE: string = "/packet-capture/:id";
const DOWNLOAD_ROUTE: string = "/packet-capture/:packetCaptureId/download";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const DEVICE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const CAPTURE_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_CAPTURE_ID: string = "77777777-7777-4777-8777-777777777777";
const FILE_ID: string = "55555555-5555-4555-8555-555555555555";

// The customer's capture, as their screenshot shows the form filled in.
const CUSTOMER_START: {
  interfaceName: string;
  bpfFilter: string;
  maxDurationInSeconds: number;
  maxPackets: number;
  maxFileSizeInMB: number;
} = {
  interfaceName: "ens18",
  bpfFilter: "net 192.168.50.0/24 and tcp",
  maxDurationInSeconds: 60,
  maxPackets: 100000,
  maxFileSizeInMB: 10,
};

// Who may start a capture, as the docs name them.
const STARTERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  [
    "a member whose team was given Start Packet Capture",
    [Permission.ProjectMember, Permission.CreatePacketCapture],
  ],
  [
    "a viewer whose team was given Start Packet Capture",
    [Permission.Viewer, Permission.CreatePacketCapture],
  ],
  ["someone holding only Start Packet Capture", [Permission.CreatePacketCapture]],
];

// Who may not, though they may see captures, download or delete them.
const NOT_STARTERS: Array<[string, Array<Permission>]> = [
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
  ["someone holding Read Packet Capture", [Permission.ReadPacketCapture]],
  [
    "someone holding Download Packet Capture",
    [Permission.ProjectMember, Permission.DownloadPacketCapture],
  ],
  [
    "someone holding Delete Packet Capture",
    [Permission.ProjectMember, Permission.DeletePacketCapture],
  ],
];

const DELETERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  [
    "a member whose team was given Delete Packet Capture",
    [Permission.ProjectMember, Permission.DeletePacketCapture],
  ],
];

const NOT_DELETERS: Array<[string, Array<Permission>]> = [
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
  [
    "a member who may start captures",
    [Permission.ProjectMember, Permission.CreatePacketCapture],
  ],
  [
    "a member who may download captures",
    [Permission.ProjectMember, Permission.DownloadPacketCapture],
  ],
];

const READERS: Array<[string, Array<Permission>]> = [
  ["a project owner", [Permission.ProjectOwner]],
  ["a project admin", [Permission.ProjectAdmin]],
  ["a project member", [Permission.ProjectMember]],
  ["a viewer", [Permission.Viewer]],
];

let props: DatabaseCommonInteractionProps;
let captures: InMemoryTable;
let hardDeleteFiles: MockedFn;

const sendEntityResponseMock: MockedFn =
  Response.sendEntityResponse as unknown as MockedFn;
const sendEntityArrayResponseMock: MockedFn =
  Response.sendEntityArrayResponse as unknown as MockedFn;
const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;
const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

function caller(
  permissions: Array<Permission>,
  extra: Partial<Parameters<typeof customDomainCaller>[0]> = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      ...extra,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function probeRow(): Probe {
  const probe: Probe = new Probe(PROBE_ID);
  probe.projectId = PROJECT_ID;
  probe.name = "Site A probe";
  probe.isGlobalProbe = false;
  probe.packetCaptureCapability = {
    isEnabled: true,
    isToolAvailable: true,
    interfaces: [
      { name: "any", addresses: [], isUp: true },
      { name: "ens18", addresses: ["192.168.50.37/24"], isUp: true },
    ],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
  } as never;
  return probe;
}

// A capture the probe finished, with its file - as recordCompletion leaves it.
function completedCapture(
  overrides: StoredRow = {},
): StoredRow {
  return {
    _id: CAPTURE_ID,
    projectId: PROJECT_ID.toString(),
    probeId: PROBE_ID.toString(),
    name: "ens18: net 192.168.50.0/24 and tcp",
    interfaceName: "ens18",
    bpfFilter: "net 192.168.50.0/24 and tcp",
    maxDurationInSeconds: 60,
    maxPackets: 100000,
    maxFileSizeInMB: 10,
    status: PacketCaptureStatus.Completed,
    packetCount: 3,
    fileSizeInBytes: 120,
    fileId: FILE_ID,
    createdAt: new Date("2026-10-12T09:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

async function callRoute(
  method: string,
  route: string,
  data: { body?: JSONObject; params?: Record<string, string> } = {},
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

// The request Start Capture sends: ModelAPI.create's body for the form's capture.
async function start(
  values: Parameters<typeof dashboardStartBody>[0] = {
    probeId: PROBE_ID,
    ...CUSTOMER_START,
  },
): Promise<{ error: Error | undefined }> {
  return await callRoute("POST", START_ROUTE, {
    body: dashboardStartBody(values),
  });
}

function storedCaptures(): Array<StoredRow> {
  return captures.rows;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new PacketCaptureAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  captures = useInMemoryTable(PacketCaptureService, []);

  jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probeRow() as never);

  hardDeleteFiles = jest
    .spyOn(FileService, "hardDeleteBy")
    .mockResolvedValue(1 as never) as unknown as MockedFn;

  props = caller([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Start Packet Capture: POST /packet-capture with the body the dashboard sends", () => {
  test.each(STARTERS)(
    "%s starts the customer's capture",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error } = await start();

      expect(error).toBeUndefined();
      expect(sendEntityResponseMock).toHaveBeenCalledTimes(1);
      expect(storedCaptures()).toHaveLength(1);

      const stored: StoredRow = storedCaptures()[0]!;

      expect(String(stored["projectId"])).toBe(PROJECT_ID.toString());
      expect(String(stored["probeId"])).toBe(PROBE_ID.toString());
      expect(stored["interfaceName"]).toBe("ens18");
      expect(stored["bpfFilter"]).toBe("net 192.168.50.0/24 and tcp");
      expect(stored["maxDurationInSeconds"]).toBe(60);
      expect(stored["maxPackets"]).toBe(100000);
      expect(stored["maxFileSizeInMB"]).toBe(10);
      // Written by the server, which a start may not write.
      expect(stored["status"]).toBe(PacketCaptureStatus.Pending);
      expect(stored["name"]).toBe("ens18: net 192.168.50.0/24 and tcp");
      // Whoever started it, from the session: the list says "by <name>".
      expect(String(stored["createdByUserId"])).toBe(props.userId!.toString());
    },
  );

  test("the capture starts with no file at all: fileId is never written, only the probe's upload writes it", async () => {
    const { error } = await start();

    expect(error).toBeUndefined();

    const stored: StoredRow = storedCaptures()[0]!;

    expect("fileId" in stored).toBe(false);
    expect("file" in stored).toBe(false);
  });

  test("regression: the customer's start is not refused on the fileId column, nor on any other", async () => {
    for (const [, permissions] of STARTERS) {
      props = caller(permissions);

      const { error } = await start();

      expect(error).toBeUndefined();
      expect(error).not.toBeInstanceOf(ColumnWriteRefusedException);

      // Finished, so the probe's two capture slots never run out here.
      for (const row of storedCaptures()) {
        row["status"] = PacketCaptureStatus.Completed;
      }
    }

    // One capture per starter: none was refused, none was lost.
    expect(storedCaptures()).toHaveLength(STARTERS.length);
  });

  test("the body is exactly what the dashboard's form sends: the probe, the interface, the filter and the limits", () => {
    const body: JSONObject = dashboardStartBody({
      probeId: PROBE_ID,
      ...CUSTOMER_START,
    });

    expect(Object.keys(body).sort()).toEqual(["data", "miscDataProps"]);
    expect(Object.keys(body["data"] as JSONObject).sort()).toEqual(
      [...DASHBOARD_START_COLUMNS]
        .filter((column: string): boolean => {
          return column !== "networkDeviceId";
        })
        .sort(),
    );
  });

  test("a project API key holding Start Packet Capture starts one, which names no person as its starter", async () => {
    props = caller([Permission.CreatePacketCapture], { isApiKey: true });

    const { error } = await start();

    expect(error).toBeUndefined();
    expect(storedCaptures()).toHaveLength(1);
    expect(storedCaptures()[0]!["createdByUserId"]).toBeUndefined();
  });

  test("from a device's Traffic page, the capture is linked to the device", async () => {
    const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
    device.projectId = PROJECT_ID;
    jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(device as never);

    props = caller([Permission.ProjectMember, Permission.CreatePacketCapture]);

    const { error } = await start({
      probeId: PROBE_ID,
      networkDeviceId: DEVICE_ID,
      ...CUSTOMER_START,
      bpfFilter: "host 192.168.50.10",
    });

    expect(error).toBeUndefined();
    expect(String(storedCaptures()[0]!["networkDeviceId"])).toBe(
      DEVICE_ID.toString(),
    );
    expect(storedCaptures()[0]!["bpfFilter"]).toBe("host 192.168.50.10");
  });

  test.each(NOT_STARTERS)(
    "%s may not start one, and is told which permission starts one",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error } = await start();

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error).not.toBeInstanceOf(ColumnWriteRefusedException);
      expect(error!.message).toBe(
        "You do not have permissions to create Packet Capture. You need one of these permissions: Project Owner, Project Admin, Start Packet Capture",
      );
      expect(storedCaptures()).toHaveLength(0);
    },
  );

  test("a credential issued for reading only may not start one, whatever its member may do", async () => {
    props = caller([Permission.ProjectOwner], { isReadOnlyCredential: true });

    const { error } = await start();

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error!.message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(storedCaptures()).toHaveLength(0);
  });

  test("a client that also posts what the probe writes is not refused: the capture still starts Pending, with none of it", async () => {
    props = caller([Permission.ProjectMember, Permission.CreatePacketCapture]);

    const capture: PacketCapture = new PacketCapture();
    capture.probeId = PROBE_ID;
    capture.interfaceName = "ens18";
    capture.bpfFilter = "tcp port 443";
    capture.maxDurationInSeconds = 60;
    capture.maxPackets = 1000;
    capture.maxFileSizeInMB = 5;
    capture.fileId = new ObjectID(FILE_ID);
    capture.status = PacketCaptureStatus.Completed;
    capture.statusMessage = "done";
    capture.endReason = "DurationReached";
    capture.startedAt = new Date();
    capture.completedAt = new Date();
    capture.stopRequestedAt = new Date();
    capture.packetCount = 10;
    capture.fileSizeInBytes = 100;
    capture.name = "posted name";

    const { error } = await callRoute("POST", START_ROUTE, {
      body: {
        data: JSONFunctions.serialize(BaseModel.toJSON(capture, PacketCapture)),
        miscDataProps: {},
      },
    });

    expect(error).toBeUndefined();

    const stored: StoredRow = storedCaptures()[0]!;

    expect(stored["status"]).toBe(PacketCaptureStatus.Pending);
    expect(stored["name"]).toBe("ens18: tcp port 443");

    for (const column of [
      "fileId",
      "statusMessage",
      "endReason",
      "startedAt",
      "completedAt",
      "stopRequestedAt",
      "packetCount",
      "fileSizeInBytes",
    ]) {
      expect([column, stored[column]]).toEqual([column, undefined]);
    }
  });
});

describe("delete: DELETE /packet-capture/:id", () => {
  beforeEach(() => {
    captures.rows.push(completedCapture());
    captures.rows.push(
      completedCapture({
        _id: OTHER_PROJECT_CAPTURE_ID,
        projectId: OTHER_PROJECT_ID.toString(),
        fileId: "88888888-8888-4888-8888-888888888888",
      }),
    );
  });

  test.each(DELETERS)(
    "%s deletes a capture, and its file goes with it",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error } = await callRoute("DELETE", DELETE_ROUTE, {
        params: { id: CAPTURE_ID },
      });

      expect(error).toBeUndefined();
      expect(sendEmptySuccessResponseMock).toHaveBeenCalledTimes(1);
      expect(captures.get(CAPTURE_ID)).toBeUndefined();
      expect(hardDeleteFiles).toHaveBeenCalledTimes(1);

      const fileQuery: string = JSON.stringify(
        (hardDeleteFiles.mock.calls[0]![0] as { query: unknown }).query,
      );

      expect(fileQuery).toContain(FILE_ID);
    },
  );

  test.each(NOT_DELETERS)(
    "%s may not delete one: the capture and its file stay",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error } = await callRoute("DELETE", DELETE_ROUTE, {
        params: { id: CAPTURE_ID },
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(captures.get(CAPTURE_ID)).toBeDefined();
      expect(hardDeleteFiles).not.toHaveBeenCalled();
    },
  );

  test("another project's capture is out of reach, even for an owner: it and its file stay", async () => {
    props = caller([Permission.ProjectOwner]);

    const { error } = await callRoute("DELETE", DELETE_ROUTE, {
      params: { id: OTHER_PROJECT_CAPTURE_ID },
    });

    expect(error).toBeDefined();
    expect(captures.get(OTHER_PROJECT_CAPTURE_ID)).toBeDefined();
    expect(hardDeleteFiles).not.toHaveBeenCalled();
  });
});

describe("the list: POST /packet-capture/get-list with the select the dashboard's table sends", () => {
  // PacketCapturesTable's columns and selectMoreFields, as ModelTable asks for them.
  const TABLE_SELECT: JSONObject = {
    _id: true,
    interfaceName: true,
    status: true,
    bpfFilter: true,
    createdAt: true,
    createdByUser: { name: true, email: true },
    probe: { name: true },
    startedAt: true,
    completedAt: true,
    stopRequestedAt: true,
    maxDurationInSeconds: true,
    maxPackets: true,
    maxFileSizeInMB: true,
    packetCount: true,
    fileSizeInBytes: true,
    endReason: true,
    statusMessage: true,
  };

  async function list(select: JSONObject): Promise<{ error: Error | undefined }> {
    return await callRoute("POST", LIST_ROUTE, {
      body: {
        query: JSONFunctions.serialize({ probeId: PROBE_ID.toString() }),
        select: JSONFunctions.serialize(select),
        sort: JSONFunctions.serialize({ createdAt: "DESC" }),
        limit: 10,
        skip: 0,
      },
    });
  }

  beforeEach(() => {
    captures.rows.push(completedCapture());
  });

  test.each(READERS)(
    "%s sees the probe's captures, and the read never asks for the file",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions);

      const { error } = await list(TABLE_SELECT);

      expect(error).toBeUndefined();
      expect(sendEntityArrayResponseMock).toHaveBeenCalledTimes(1);

      const rows: Array<BaseModel> = sendEntityArrayResponseMock.mock
        .calls[0]![2] as Array<BaseModel>;

      expect(rows).toHaveLength(1);
      expect(rows[0]!.id?.toString()).toBe(CAPTURE_ID);

      /*
       * The columns the read asks Postgres for: what the table shows, and
       * neither the file nor its id (the table here hands back whole rows).
       */
      const readSelect: Record<string, unknown> = (
        captures.repository.find.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select;

      expect(readSelect["fileId"]).toBeUndefined();
      expect(readSelect["file"]).toBeUndefined();
      expect(readSelect["interfaceName"]).toBe(true);
      expect(readSelect["bpfFilter"]).toBe(true);
    },
  );

  test("asking for the file's id is refused: the file leaves only through Download", async () => {
    props = caller([Permission.ProjectOwner]);

    const { error } = await list({ _id: true, fileId: true });

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error!.message).toContain(
      "You do not have permissions to select on - fileId.",
    );
  });
});

describe("edit: PUT /packet-capture/:id", () => {
  beforeEach(() => {
    captures.rows.push(completedCapture());
  });

  test.each([
    ["a project owner", [Permission.ProjectOwner]],
    [
      "a member who may start captures",
      [Permission.ProjectMember, Permission.CreatePacketCapture],
    ],
  ])(
    "%s may not edit a capture: everything after the start is the probe's",
    async (_who: string, permissions: Array<Permission>) => {
      props = caller(permissions as Array<Permission>);

      const { error } = await callRoute("PUT", UPDATE_ROUTE, {
        params: { id: CAPTURE_ID },
        body: {
          data: JSONFunctions.serialize({ bpfFilter: "tcp" }),
        },
      });

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(captures.get(CAPTURE_ID)?.["bpfFilter"]).toBe(
        "net 192.168.50.0/24 and tcp",
      );
    },
  );
});

describe("the whole walk, as the members the docs name", () => {
  test("a member given Start Packet Capture starts it, one given Download downloads it, one given Delete deletes it", async () => {
    // 1. Start, from the probe's page.
    props = caller([Permission.ProjectMember, Permission.CreatePacketCapture]);

    expect((await start()).error).toBeUndefined();

    const started: StoredRow = storedCaptures()[0]!;
    const captureId: string = String(started["_id"]);

    expect(started["status"]).toBe(PacketCaptureStatus.Pending);

    // 2. The probe picks it up and uploads its file (its own SQL: see PacketCaptureSqlPostgres).
    Object.assign(started, {
      status: PacketCaptureStatus.Completed,
      startedAt: new Date(),
      completedAt: new Date(),
      packetCount: 3,
      fileSizeInBytes: 120,
      fileId: FILE_ID,
    });

    // 3. Download, by someone given Download Packet Capture.
    const file: File = new File(new ObjectID(FILE_ID));
    file.projectId = PROJECT_ID;
    file.name = "packet-capture-site-a-probe-ens18-2026-10-12T09-00-00Z.pcap";
    file.fileType = MimeType.pcap;
    file.file = Buffer.from([0xd4, 0xc3, 0xb2, 0xa1, 2, 0, 4, 0]);

    jest.spyOn(FileService, "findOneById").mockResolvedValue(file as never);
    const recordDownload: MockedFn = jest
      .spyOn(AuditLogService, "recordDownload")
      .mockResolvedValue(undefined as never) as unknown as MockedFn;

    props = caller([Permission.ProjectMember, Permission.DownloadPacketCapture]);

    const download: { error: Error | undefined } = await callRoute(
      "POST",
      DOWNLOAD_ROUTE,
      { params: { packetCaptureId: captureId } },
    );

    expect(download.error).toBeUndefined();
    expect(recordDownload).toHaveBeenCalledTimes(1);

    const sent: JSONObject = sendJsonObjectResponseMock.mock
      .calls[0]![2] as JSONObject;

    expect(sent["fileName"]).toBe(file.name);
    expect(Buffer.from(String(sent["base64"]), "base64")).toEqual(file.file);

    // 4. Delete, by someone given Delete Packet Capture: the file goes too.
    props = caller([Permission.ProjectMember, Permission.DeletePacketCapture]);

    const removal: { error: Error | undefined } = await callRoute(
      "DELETE",
      DELETE_ROUTE,
      { params: { id: captureId } },
    );

    expect(removal.error).toBeUndefined();
    expect(captures.get(captureId)).toBeUndefined();
    expect(hardDeleteFiles).toHaveBeenCalledTimes(1);
  });
});
