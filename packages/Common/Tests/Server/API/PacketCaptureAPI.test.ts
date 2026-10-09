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
 * The two routes that act on one packet capture: Stop, and Download of its
 * pcap file. What these protect:
 *
 *   - who may: stopping takes what starting takes (owners, admins, Start
 *     Packet Capture), downloading a permission of its own (owners, admins,
 *     Download Packet Capture) - an ordinary member, a viewer, or someone
 *     who may only see or start captures gets neither. The checks run on
 *     the caller's real props, not a stub of the permission layer.
 *   - whose: the capture is looked up inside the caller's project only, and
 *     its file is handed out only when it is that project's file - so
 *     another project's capture answers exactly as one that does not exist.
 *   - the record: every download is written to the audit log, by whom,
 *     before the bytes leave.
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

import PacketCaptureAPI, {
  FILE_GONE_MESSAGE,
} from "../../../Server/API/PacketCaptureAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AuditLogService from "../../../Server/Services/AuditLogService";
import FileService from "../../../Server/Services/FileService";
import PacketCaptureService, {
  NOT_STARTED_MESSAGE,
} from "../../../Server/Services/PacketCaptureService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import File from "../../../Models/DatabaseModels/File";
import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import MimeType from "../../../Types/File/MimeType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
  PACKET_CAPTURE_NOT_FOUND_MESSAGE,
  PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
} from "../../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../../Types/PacketCapture/PacketCaptureStatus";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { customDomainCaller } from "./CustomDomainCallers";

type MockedFn = ReturnType<typeof jest.fn>;

const STOP_ROUTE: string = "/packet-capture/:packetCaptureId/stop";
const DOWNLOAD_ROUTE: string = "/packet-capture/:packetCaptureId/download";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CAPTURE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const FILE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const DEVICE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const PCAP_BYTES: Buffer = Buffer.from([0xd4, 0xc3, 0xb2, 0xa1, 1, 2, 3, 4]);

const sendJsonObjectResponseMock: MockedFn =
  Response.sendJsonObjectResponse as unknown as MockedFn;

function caller(
  data: Partial<Parameters<typeof customDomainCaller>[0]> = {},
): DatabaseCommonInteractionProps {
  return customDomainCaller({
    permissions: [],
    projectId: PROJECT_ID,
    ...data,
  });
}

let props: DatabaseCommonInteractionProps;

async function callRoute(
  route: string,
  id: string = CAPTURE_ID.toString(),
): Promise<{ next: MockedFn }> {
  const req: ExpressRequest = {
    params: { packetCaptureId: id },
    query: {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {} as ExpressResponse;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match("POST", route)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return { next };
}

function errorPassedOn(next: MockedFn): Error {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0] as Error;
}

function sentBody(): JSONObject {
  expect(sendJsonObjectResponseMock).toHaveBeenCalledTimes(1);
  return sendJsonObjectResponseMock.mock.calls[0]![2] as JSONObject;
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new PacketCaptureAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
  props = caller({ permissions: [Permission.ProjectOwner] });

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("wiring", () => {
  test.each([STOP_ROUTE, DOWNLOAD_ROUTE])(
    "%s is a POST behind the user auth middleware",
    (route: string) => {
      expect(mockRouter.match("POST", route).middlewares).toContain(
        UserMiddleware.getUserMiddleware,
      );
    },
  );

  test("the CRUD routes of the model are there too: captures are started, listed and deleted through them", () => {
    expect(() => {
      return mockRouter.match("POST", "/packet-capture");
    }).not.toThrow();
    expect(() => {
      return mockRouter.match("POST", "/packet-capture/get-list");
    }).not.toThrow();
  });
});

describe("POST /packet-capture/:id/stop", () => {
  function stubStop(): MockedFn {
    return jest
      .spyOn(PacketCaptureService, "requestStop")
      .mockResolvedValue(undefined) as unknown as MockedFn;
  }

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectAdmin],
    [Permission.CreatePacketCapture],
  ])(
    "someone holding %s may stop a capture of their project",
    async (permission: Permission) => {
      props = caller({ permissions: [permission] });
      const stop: MockedFn = stubStop();

      const { next } = await callRoute(STOP_ROUTE);

      expect(next).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledTimes(1);

      const call: { packetCaptureId: ObjectID; projectId: ObjectID } = stop.mock
        .calls[0]![0] as { packetCaptureId: ObjectID; projectId: ObjectID };

      expect(call.packetCaptureId.toString()).toBe(CAPTURE_ID.toString());
      expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(sentBody()).toEqual({ result: "ok" });
    },
  );

  test.each([
    [[Permission.ProjectMember]],
    [[Permission.Viewer]],
    [[Permission.ReadPacketCapture]],
    [[Permission.DownloadPacketCapture]],
    [[Permission.DeletePacketCapture]],
    [[Permission.ProjectMember, Permission.ReadPacketCapture]],
  ])(
    "someone holding only %s may not",
    async (permissions: Array<Permission>) => {
      props = caller({ permissions: permissions });
      const stop: MockedFn = stubStop();

      const { next } = await callRoute(STOP_ROUTE);
      const error: Error = errorPassedOn(next);

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(PACKET_CAPTURE_STOP_REFUSED_MESSAGE);
      expect(stop).not.toHaveBeenCalled();
    },
  );

  test("a credential issued for reading only may not stop one, whatever its member may do", async () => {
    props = caller({
      permissions: [Permission.ProjectOwner],
      isReadOnlyCredential: true,
    });
    const stop: MockedFn = stubStop();

    const { next } = await callRoute(STOP_ROUTE);
    const error: Error = errorPassedOn(next);

    expect(error).toBeInstanceOf(NotAuthorizedException);
    expect(error.message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(stop).not.toHaveBeenCalled();
  });

  test("a project API key holding Start Packet Capture may stop one", async () => {
    props = caller({
      permissions: [Permission.CreatePacketCapture],
      isApiKey: true,
    });
    const stop: MockedFn = stubStop();

    const { next } = await callRoute(STOP_ROUTE);

    expect(next).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("a master admin may stop one", async () => {
    props = caller({ permissions: [], isMasterAdmin: true });
    const stop: MockedFn = stubStop();

    const { next } = await callRoute(STOP_ROUTE);

    expect(next).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  test("a caller with no session is asked to sign in, with a 401", async () => {
    props = { userType: UserType.Public, tenantId: PROJECT_ID };
    const stop: MockedFn = stubStop();

    const { next } = await callRoute(STOP_ROUTE);

    expect(errorPassedOn(next)).toBeInstanceOf(NotAuthenticatedException);
    expect(stop).not.toHaveBeenCalled();
  });

  test("a caller with no project is refused", async () => {
    props = caller({ permissions: [Permission.ProjectOwner] });
    delete props.tenantId;
    const stop: MockedFn = stubStop();

    const { next } = await callRoute(STOP_ROUTE);
    const error: Error = errorPassedOn(next);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toBe("Project ID is required");
    expect(stop).not.toHaveBeenCalled();
  });

  test("an id that is not one is not found, and reaches nothing", async () => {
    const stop: MockedFn = stubStop();

    const { next } = await callRoute(STOP_ROUTE, "../../etc/passwd");

    expect(errorPassedOn(next).message).toBe(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
    expect(stop).not.toHaveBeenCalled();
  });

  test("the service's refusal is passed on as it is", async () => {
    jest
      .spyOn(PacketCaptureService, "requestStop")
      .mockRejectedValue(new BadDataException(NOT_STARTED_MESSAGE));

    const { next } = await callRoute(STOP_ROUTE);

    expect(errorPassedOn(next).message).toBe(NOT_STARTED_MESSAGE);
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });
});

describe("POST /packet-capture/:id/download", () => {
  function completedCapture(
    overrides: Partial<PacketCapture> = {},
  ): PacketCapture {
    const capture: PacketCapture = new PacketCapture(CAPTURE_ID);
    capture.projectId = PROJECT_ID;
    capture.name = "eth0: host 10.0.0.5";
    capture.interfaceName = "eth0";
    capture.bpfFilter = "host 10.0.0.5";
    capture.probeId = PROBE_ID;
    capture.networkDeviceId = DEVICE_ID;
    capture.status = PacketCaptureStatus.Completed;
    capture.packetCount = 42;
    capture.fileSizeInBytes = PCAP_BYTES.length;
    capture.fileId = FILE_ID;
    Object.assign(capture, overrides);
    return capture;
  }

  function storedFile(overrides: Partial<File> = {}): File {
    const file: File = new File(FILE_ID);
    file.file = PCAP_BYTES;
    file.name = "packet-capture-site-a-eth0-2026-10-09T08-30-00Z.pcap";
    file.fileType = MimeType.pcap;
    file.projectId = PROJECT_ID;
    Object.assign(file, overrides);
    return file;
  }

  function stubCapture(capture: PacketCapture | null): MockedFn {
    return jest
      .spyOn(PacketCaptureService, "findOneBy")
      .mockResolvedValue(capture as never) as unknown as MockedFn;
  }

  function stubFile(file: File | null): MockedFn {
    return jest
      .spyOn(FileService, "findOneById")
      .mockResolvedValue(file as never) as unknown as MockedFn;
  }

  function stubAudit(): MockedFn {
    return jest
      .spyOn(AuditLogService, "recordDownload")
      .mockResolvedValue(undefined) as unknown as MockedFn;
  }

  test.each([
    [Permission.ProjectOwner],
    [Permission.ProjectAdmin],
    [Permission.DownloadPacketCapture],
  ])(
    "someone holding %s gets the pcap file, as base64 with its name",
    async (permission: Permission) => {
      props = caller({ permissions: [permission] });
      stubCapture(completedCapture());
      stubFile(storedFile());
      stubAudit();

      const { next } = await callRoute(DOWNLOAD_ROUTE);

      expect(next).not.toHaveBeenCalled();
      expect(sentBody()).toEqual({
        fileName: "packet-capture-site-a-eth0-2026-10-09T08-30-00Z.pcap",
        fileType: MimeType.pcap,
        sizeInBytes: PCAP_BYTES.length,
        base64: PCAP_BYTES.toString("base64"),
      });
    },
  );

  test.each([
    [[Permission.ProjectMember]],
    [[Permission.Viewer]],
    [[Permission.ReadPacketCapture]],
    [[Permission.CreatePacketCapture]],
    [[Permission.DeletePacketCapture]],
    [
      [
        Permission.ProjectMember,
        Permission.ReadPacketCapture,
        Permission.CreatePacketCapture,
      ],
    ],
  ])(
    "someone holding only %s may not: the file is a permission of its own",
    async (permissions: Array<Permission>) => {
      props = caller({ permissions: permissions });
      const find: MockedFn = stubCapture(completedCapture());
      const read: MockedFn = stubFile(storedFile());
      const audit: MockedFn = stubAudit();

      const { next } = await callRoute(DOWNLOAD_ROUTE);
      const error: Error = errorPassedOn(next);

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(error.message).toBe(PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE);
      expect(find).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
      expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
    },
  );

  test("a caller with no session is asked to sign in, with a 401", async () => {
    props = { userType: UserType.Public, tenantId: PROJECT_ID };
    const find: MockedFn = stubCapture(completedCapture());

    const { next } = await callRoute(DOWNLOAD_ROUTE);

    expect(errorPassedOn(next)).toBeInstanceOf(NotAuthenticatedException);
    expect(find).not.toHaveBeenCalled();
  });

  test("a credential issued for reading only may download: it changes nothing", async () => {
    props = caller({
      permissions: [Permission.DownloadPacketCapture],
      isReadOnlyCredential: true,
    });
    stubCapture(completedCapture());
    stubFile(storedFile());
    stubAudit();

    const { next } = await callRoute(DOWNLOAD_ROUTE);

    expect(next).not.toHaveBeenCalled();
    expect(sentBody()["base64"]).toBe(PCAP_BYTES.toString("base64"));
  });

  test("the capture is looked up inside the caller's project, as root, and its file by the capture's id for it", async () => {
    const find: MockedFn = stubCapture(completedCapture());
    const read: MockedFn = stubFile(storedFile());
    stubAudit();

    await callRoute(DOWNLOAD_ROUTE);

    const lookup: { query: JSONObject; props: JSONObject } = find.mock
      .calls[0]![0] as { query: JSONObject; props: JSONObject };

    expect(lookup.query["_id"]).toBe(CAPTURE_ID.toString());
    expect(lookup.query["projectId"]?.toString()).toBe(PROJECT_ID.toString());
    expect(lookup.props).toEqual({ isRoot: true });

    const fileRead: { id: ObjectID; select: JSONObject } = read.mock
      .calls[0]![0] as { id: ObjectID; select: JSONObject };

    expect(fileRead.id.toString()).toBe(FILE_ID.toString());
    // The owner is read with the bytes, so keepProjectFile can hold them to it.
    expect(fileRead.select["projectId"]).toBe(true);
    expect(fileRead.select["file"]).toBe(true);
  });

  test("a capture that is not found - another project's included - answers not found", async () => {
    stubCapture(null);
    const read: MockedFn = stubFile(storedFile());
    const audit: MockedFn = stubAudit();

    const { next } = await callRoute(DOWNLOAD_ROUTE);

    expect(errorPassedOn(next).message).toBe(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
    expect(read).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  test.each([
    ["is still running", { status: PacketCaptureStatus.Running }],
    ["failed", { status: PacketCaptureStatus.Failed }],
    ["captured no packets", { fileId: undefined }],
  ])(
    "a capture that %s has no file to download",
    async (_name: string, overrides: Partial<PacketCapture>) => {
      stubCapture(completedCapture(overrides));
      const read: MockedFn = stubFile(storedFile());
      const audit: MockedFn = stubAudit();

      const { next } = await callRoute(DOWNLOAD_ROUTE);

      expect(errorPassedOn(next).message).toBe(FILE_GONE_MESSAGE);
      expect(read).not.toHaveBeenCalled();
      expect(audit).not.toHaveBeenCalled();
    },
  );

  test("a file that is not the capture's project's is never handed out", async () => {
    stubCapture(completedCapture());
    stubFile(storedFile({ projectId: OTHER_PROJECT_ID }));
    const audit: MockedFn = stubAudit();

    const { next } = await callRoute(DOWNLOAD_ROUTE);

    expect(errorPassedOn(next).message).toBe(FILE_GONE_MESSAGE);
    expect(audit).not.toHaveBeenCalled();
    expect(sendJsonObjectResponseMock).not.toHaveBeenCalled();
  });

  test("a file that has been deleted, or has no bytes, is gone", async () => {
    for (const file of [null, storedFile({ file: undefined })]) {
      jest.clearAllMocks();
      stubCapture(completedCapture());
      stubFile(file);
      stubAudit();

      const { next } = await callRoute(DOWNLOAD_ROUTE);

      expect(errorPassedOn(next).message).toBe(FILE_GONE_MESSAGE);
    }
  });

  test("every download is written to the audit log, by whom and of what, before the file is sent", async () => {
    stubCapture(completedCapture());
    stubFile(storedFile());

    const order: Array<string> = [];

    const audit: MockedFn = jest
      .spyOn(AuditLogService, "recordDownload")
      .mockImplementation(async (): Promise<void> => {
        order.push("audit");
      }) as unknown as MockedFn;

    sendJsonObjectResponseMock.mockImplementation((() => {
      order.push("send");
    }) as never);

    await callRoute(DOWNLOAD_ROUTE);

    expect(order).toEqual(["audit", "send"]);

    const entry: {
      model: PacketCapture;
      downloadedItem: PacketCapture;
      itemId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = audit.mock.calls[0]![0] as {
      model: PacketCapture;
      downloadedItem: PacketCapture;
      itemId: ObjectID;
      props: DatabaseCommonInteractionProps;
    };

    expect(entry.model).toBeInstanceOf(PacketCapture);
    expect(entry.itemId.toString()).toBe(CAPTURE_ID.toString());
    expect(entry.props).toBe(props);
    expect(entry.downloadedItem.id?.toString()).toBe(CAPTURE_ID.toString());
    expect(entry.downloadedItem.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(entry.downloadedItem.interfaceName).toBe("eth0");
    expect(entry.downloadedItem.bpfFilter).toBe("host 10.0.0.5");
    expect(entry.downloadedItem.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(entry.downloadedItem.networkDeviceId?.toString()).toBe(
      DEVICE_ID.toString(),
    );
    expect(entry.downloadedItem.packetCount).toBe(42);
    expect(entry.downloadedItem.fileSizeInBytes).toBe(PCAP_BYTES.length);

    // The entry describes the download, never the traffic itself.
    expect(entry.downloadedItem.file).toBeUndefined();
    expect(entry.downloadedItem.fileId).toBeUndefined();
  });

  test("a file stored without a name downloads under a generic one", async () => {
    stubCapture(completedCapture());
    stubFile(storedFile({ name: undefined }));
    stubAudit();

    await callRoute(DOWNLOAD_ROUTE);

    expect(sentBody()["fileName"]).toBe("packet-capture.pcap");
  });

  test("an id that is not one is not found, and reads nothing", async () => {
    const find: MockedFn = stubCapture(completedCapture());

    const { next } = await callRoute(DOWNLOAD_ROUTE, "not-an-id");

    expect(errorPassedOn(next).message).toBe(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
    expect(find).not.toHaveBeenCalled();
  });
});
