import { mockRouter } from "Common/Tests/Server/API/Helpers";
import PacketCaptureService from "Common/Server/Services/PacketCaptureService";
import Probe from "Common/Models/DatabaseModels/Probe";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PacketCaptureEndReason from "Common/Types/PacketCapture/PacketCaptureEndReason";
import {
  MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST,
  PACKET_CAPTURE_PROBE_CONCURRENCY,
  PacketCaptureJob,
} from "Common/Types/PacketCapture/PacketCaptureJob";
import {
  BYTES_IN_A_MEGABYTE,
  PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH,
} from "Common/Types/PacketCapture/PacketCaptureLimits";
import PacketCaptureStatus from "Common/Types/PacketCapture/PacketCaptureStatus";
import { PacketCaptureCapability } from "Common/Types/PacketCapture/PacketCaptureCapability";
import ProbeAuthorization from "../../FeatureSet/Telemetry/Middleware/ProbeAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/PacketCaptureService", () => {
  return {
    __esModule: true,
    default: {
      recordProbeCapability: jest.fn(),
      findCapturesToStop: jest.fn(),
      claimPendingForProbe: jest.fn(),
      recordFailure: jest.fn(),
      recordCompletion: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * The probe's side of packet capture: what it can capture on, the captures
 * it is handed and told to stop, and the file (or the reason) it reports.
 * What these protect:
 *
 *   - every route is behind probe authentication and takes the probe from
 *     the AUTHENTICATED request - a probe id in the body is never read - so
 *     a probe only ever claims, hears about and settles its own captures;
 *   - a probe is handed no more captures than it has slots for, and never
 *     one it could not run safely (an interface name tcpdump could read as
 *     an option, a filter that is not one): that one is failed instead;
 *   - an upload is a base64 pcap file no larger than the largest capture,
 *     and fits through nginx and the server's body parser.
 */
import PacketCaptureIngestRouter, {
  GLOBAL_PROBE_REPORT_MESSAGE,
  readRunningIds,
  resolveClaimLimit,
} from "../../FeatureSet/Telemetry/API/ProbeIngest/PacketCapture";

const service: {
  recordProbeCapability: jest.Mock;
  findCapturesToStop: jest.Mock;
  claimPendingForProbe: jest.Mock;
  recordFailure: jest.Mock;
  recordCompletion: jest.Mock;
} = PacketCaptureService as unknown as {
  recordProbeCapability: jest.Mock;
  findCapturesToStop: jest.Mock;
  claimPendingForProbe: jest.Mock;
  recordFailure: jest.Mock;
  recordCompletion: jest.Mock;
};

const responseUtil: {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
} = Response as unknown as {
  sendErrorResponse: jest.Mock;
  sendJsonObjectResponse: jest.Mock;
};

const loggerMock: { warn: jest.Mock; error: jest.Mock } = logger as unknown as {
  warn: jest.Mock;
  error: jest.Mock;
};

const CAPABILITY_URI: string = "/probe/packet-capture/capability";
const LIST_URI: string = "/probe/packet-capture/list";
const INGEST_URI: string = "/probe/packet-capture/response/ingest";

const PROBE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_PROBE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CAPTURE_ID: string = "33333333-3333-4333-8333-333333333333";
const SECOND_CAPTURE_ID: string = "44444444-4444-4444-8444-444444444444";

const mockResponse: ExpressResponse = {} as ExpressResponse;

function makeRequest(data: {
  probeId?: ObjectID | null | undefined;
  body?: unknown;
}): ExpressRequest {
  const req: JSONObject = {
    body: (data.body === undefined ? {} : data.body) as JSONObject,
  };

  if (data.probeId !== null) {
    req["probe"] = new Probe(data.probeId || PROBE_ID);
  }

  return req as unknown as ExpressRequest;
}

async function call(
  uri: string,
  req: ExpressRequest,
): Promise<{ next: jest.Mock }> {
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", uri)
    .handlerFunction(req, mockResponse, next as unknown as NextFunction);

  return { next };
}

function sentBody(): JSONObject {
  expect(responseUtil.sendErrorResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  return responseUtil.sendJsonObjectResponse.mock.calls[0]![2] as JSONObject;
}

function refusal(): string {
  expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  expect(responseUtil.sendErrorResponse).toHaveBeenCalledTimes(1);

  const error: unknown = responseUtil.sendErrorResponse.mock.calls[0]![2];

  expect(error).toBeInstanceOf(BadDataException);

  return (error as Error).message;
}

function job(overrides: Partial<PacketCaptureJob> = {}): PacketCaptureJob {
  return {
    id: CAPTURE_ID,
    interfaceName: "eth0",
    bpfFilter: "port 53",
    maxDurationInSeconds: 60,
    maxPackets: 100000,
    maxFileSizeInBytes: 10 * BYTES_IN_A_MEGABYTE,
    ...overrides,
  };
}

// A pcap global header and one 4-byte packet.
function tinyPcap(): Buffer {
  const header: Buffer = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4, 0);
  header.writeUInt16LE(2, 4);
  header.writeUInt16LE(4, 6);
  header.writeUInt32LE(262144, 16);
  header.writeUInt32LE(1, 20);

  const record: Buffer = Buffer.alloc(20);
  record.writeUInt32LE(4, 8);
  record.writeUInt32LE(4, 12);

  return Buffer.concat([header, record]);
}

beforeEach(() => {
  jest.clearAllMocks();
  service.recordProbeCapability.mockResolvedValue(true as never);
  service.findCapturesToStop.mockResolvedValue([] as never);
  service.claimPendingForProbe.mockResolvedValue([] as never);
  service.recordFailure.mockResolvedValue(true as never);
  service.recordCompletion.mockResolvedValue(true as never);
});

describe("wiring", () => {
  test("the router is what the module exports", () => {
    expect(PacketCaptureIngestRouter).toBe(mockRouter);
  });

  test.each([CAPABILITY_URI, LIST_URI, INGEST_URI])(
    "%s is a POST behind probe authentication",
    (uri: string) => {
      expect(mockRouter.match("post", uri).middlewares).toContain(
        ProbeAuthorization.isAuthorizedServiceMiddleware,
      );
    },
  );

  test.each([CAPABILITY_URI, LIST_URI, INGEST_URI])(
    "%s refuses a request no probe was authenticated for",
    async (uri: string) => {
      await call(uri, makeRequest({ probeId: null }));

      expect(refusal()).toBe("Probe not found");
    },
  );

  test("the Telemetry feature set mounts the routes under the probe ingest prefixes", () => {
    const index: string = fs.readFileSync(
      path.join(__dirname, "../../FeatureSet/Telemetry/Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      'import ProbeIngestPacketCaptureAPI from "./API/ProbeIngest/PacketCapture";',
    );
    expect(index).toContain(
      "app.use(PROBE_INGEST_PREFIXES, ProbeIngestPacketCaptureAPI);",
    );
  });
});

describe("POST /probe/packet-capture/capability", () => {
  function report(overrides: JSONObject = {}): JSONObject {
    return {
      isEnabled: true,
      isToolAvailable: true,
      toolVersion: "tcpdump version 4.99.3",
      interfaces: [{ name: "eth0", addresses: ["10.0.0.2/24"], isUp: true }],
      limits: {
        maxDurationInSeconds: 600,
        maxPackets: 1000000,
        maxFileSizeInMB: 5,
      },
      ...overrides,
    };
  }

  test("keeps the report on the authenticated probe, never one the body names", async () => {
    await call(
      CAPABILITY_URI,
      makeRequest({
        body: {
          probeId: OTHER_PROBE_ID.toString(),
          packetCaptureCapability: report(),
        },
      }),
    );

    expect(service.recordProbeCapability).toHaveBeenCalledTimes(1);

    const kept: { probeId: ObjectID; capability: PacketCaptureCapability } =
      service.recordProbeCapability.mock.calls[0]![0] as {
        probeId: ObjectID;
        capability: PacketCaptureCapability;
      };

    expect(kept.probeId.toString()).toBe(PROBE_ID.toString());
    expect(kept.capability).toEqual({
      isEnabled: true,
      isToolAvailable: true,
      toolVersion: "tcpdump version 4.99.3",
      interfaces: [{ name: "eth0", addresses: ["10.0.0.2/24"], isUp: true }],
      limits: {
        maxDurationInSeconds: 600,
        maxPackets: 1000000,
        maxFileSizeInMB: 5,
      },
    });
    expect(sentBody()).toEqual({ isPacketCaptureAvailable: true });
  });

  test("keeps the report as sanitized: an interface tcpdump could misread is dropped", async () => {
    await call(
      CAPABILITY_URI,
      makeRequest({
        body: {
          packetCaptureCapability: report({
            interfaces: [
              { name: "-w", addresses: [] },
              { name: "eth1", addresses: [] },
            ],
          }),
        },
      }),
    );

    const kept: { capability: PacketCaptureCapability } = service
      .recordProbeCapability.mock.calls[0]![0] as {
      capability: PacketCaptureCapability;
    };

    expect(kept.capability.interfaces).toEqual([
      { name: "eth1", addresses: [] },
    ]);
  });

  test("says whether a capture can be started on the probe as it reported", async () => {
    await call(
      CAPABILITY_URI,
      makeRequest({
        body: { packetCaptureCapability: report({ isToolAvailable: false }) },
      }),
    );

    expect(sentBody()).toEqual({ isPacketCaptureAvailable: false });
  });

  test("a probe with captures off is kept as off", async () => {
    await call(
      CAPABILITY_URI,
      makeRequest({ body: { packetCaptureCapability: { isEnabled: false } } }),
    );

    expect(
      (
        service.recordProbeCapability.mock.calls[0]![0] as {
          capability: PacketCaptureCapability;
        }
      ).capability.isEnabled,
    ).toBe(false);
    expect(sentBody()).toEqual({ isPacketCaptureAvailable: false });
  });

  test("a global probe is told its captures stay off", async () => {
    service.recordProbeCapability.mockResolvedValue(false as never);

    await call(
      CAPABILITY_URI,
      makeRequest({ body: { packetCaptureCapability: report() } }),
    );

    expect(sentBody()).toEqual({
      isPacketCaptureAvailable: false,
      message: GLOBAL_PROBE_REPORT_MESSAGE,
    });
  });

  test.each([
    ["no report", {}],
    ["a report that is not an object", { packetCaptureCapability: "on" }],
    [
      "a report that does not say whether captures are on",
      { packetCaptureCapability: { interfaces: [] } },
    ],
  ])("%s is refused", async (_name: string, body: JSONObject) => {
    await call(CAPABILITY_URI, makeRequest({ body: body }));

    expect(refusal()).toBe(
      "packetCaptureCapability must be an object with isEnabled true or false",
    );
    expect(service.recordProbeCapability).not.toHaveBeenCalled();
  });

  test("a body that is not an object is no report", async () => {
    await call(CAPABILITY_URI, makeRequest({ body: ["x"] }));

    expect(refusal()).toContain("packetCaptureCapability must be an object");
  });

  test("a failure of the service is passed on", async () => {
    const failure: Error = new Error("database unavailable");
    service.recordProbeCapability.mockRejectedValue(failure as never);

    const { next } = await call(
      CAPABILITY_URI,
      makeRequest({ body: { packetCaptureCapability: report() } }),
    );

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("POST /probe/packet-capture/list", () => {
  test("hands out the captures claimed for the authenticated probe, up to its free slots", async () => {
    service.claimPendingForProbe.mockResolvedValue([job()] as never);

    await call(
      LIST_URI,
      makeRequest({ body: { limit: 2, probeId: OTHER_PROBE_ID.toString() } }),
    );

    const claim: { probeId: ObjectID; limit: number } = service
      .claimPendingForProbe.mock.calls[0]![0] as {
      probeId: ObjectID;
      limit: number;
    };

    expect(claim.probeId.toString()).toBe(PROBE_ID.toString());
    expect(claim.limit).toBe(2);
    expect(sentBody()).toEqual({
      packetCaptures: [job()],
      stopPacketCaptureIds: [],
    });
  });

  test("never hands out more than a probe runs at once, whatever it asks for", async () => {
    await call(LIST_URI, makeRequest({ body: { limit: 50 } }));

    expect(
      (service.claimPendingForProbe.mock.calls[0]![0] as { limit: number })
        .limit,
    ).toBe(PACKET_CAPTURE_PROBE_CONCURRENCY);
  });

  test("a probe that says it has no room, or cannot say, is handed nothing and nothing is claimed", async () => {
    for (const limit of [0, -1, "2", null, undefined, Number.NaN]) {
      jest.clearAllMocks();

      await call(LIST_URI, makeRequest({ body: { limit: limit } }));

      expect(service.claimPendingForProbe).not.toHaveBeenCalled();
      expect(sentBody()).toEqual({
        packetCaptures: [],
        stopPacketCaptureIds: [],
      });
    }
  });

  test("tells the probe which of its running captures to stop, asked about its own probe", async () => {
    service.findCapturesToStop.mockResolvedValue([SECOND_CAPTURE_ID] as never);

    await call(
      LIST_URI,
      makeRequest({
        body: {
          limit: 0,
          runningPacketCaptureIds: [CAPTURE_ID, SECOND_CAPTURE_ID],
        },
      }),
    );

    const asked: {
      probeId: ObjectID;
      runningPacketCaptureIds: Array<string>;
    } = service.findCapturesToStop.mock.calls[0]![0] as {
      probeId: ObjectID;
      runningPacketCaptureIds: Array<string>;
    };

    expect(asked.probeId.toString()).toBe(PROBE_ID.toString());
    expect(asked.runningPacketCaptureIds).toEqual([
      CAPTURE_ID,
      SECOND_CAPTURE_ID,
    ]);
    expect(sentBody()).toEqual({
      packetCaptures: [],
      stopPacketCaptureIds: [SECOND_CAPTURE_ID],
    });
  });

  test("a probe running nothing is not asked about", async () => {
    await call(LIST_URI, makeRequest({ body: { limit: 2 } }));

    expect(service.findCapturesToStop).not.toHaveBeenCalled();
  });

  test("stops are answered before new captures are claimed", async () => {
    const order: Array<string> = [];

    service.findCapturesToStop.mockImplementation((async () => {
      order.push("stop");
      return [];
    }) as never);
    service.claimPendingForProbe.mockImplementation((async () => {
      order.push("claim");
      return [];
    }) as never);

    await call(
      LIST_URI,
      makeRequest({
        body: { limit: 1, runningPacketCaptureIds: [CAPTURE_ID] },
      }),
    );

    expect(order).toEqual(["stop", "claim"]);
  });

  test("a capture the probe could never run safely is failed with the reason instead of handed out", async () => {
    const optionInterface: PacketCaptureJob = job({
      id: CAPTURE_ID,
      interfaceName: "-w",
    });
    const shellFilter: PacketCaptureJob = job({
      id: SECOND_CAPTURE_ID,
      bpfFilter: "port 53; reboot",
    });
    const fine: PacketCaptureJob = job({
      id: "55555555-5555-4555-8555-555555555555",
    });

    service.claimPendingForProbe.mockResolvedValue([
      optionInterface,
      shellFilter,
      fine,
    ] as never);

    await call(LIST_URI, makeRequest({ body: { limit: 2 } }));

    expect(sentBody()["packetCaptures"]).toEqual([fine]);
    expect(service.recordFailure).toHaveBeenCalledTimes(2);

    const failures: Array<{
      probeId: ObjectID;
      packetCaptureId: ObjectID;
      statusMessage: string;
    }> = service.recordFailure.mock.calls.map((callArgs: Array<unknown>) => {
      return callArgs[0] as {
        probeId: ObjectID;
        packetCaptureId: ObjectID;
        statusMessage: string;
      };
    });

    expect(failures[0]!.packetCaptureId.toString()).toBe(CAPTURE_ID);
    expect(failures[0]!.probeId.toString()).toBe(PROBE_ID.toString());
    expect(failures[0]!.statusMessage).toBe(
      "This capture names an interface the probe cannot capture on.",
    );
    expect(failures[1]!.packetCaptureId.toString()).toBe(SECOND_CAPTURE_ID);
    expect(failures[1]!.statusMessage).toContain(
      'The filter can\'t contain ";"',
    );
    expect(loggerMock.warn).toHaveBeenCalledTimes(2);
  });

  test("a failure that cannot be recorded is logged, and the other captures are still handed out", async () => {
    service.claimPendingForProbe.mockResolvedValue([
      job({ id: CAPTURE_ID, interfaceName: "--help" }),
      job({ id: SECOND_CAPTURE_ID }),
    ] as never);
    service.recordFailure.mockRejectedValue(new Error("db down") as never);

    await call(LIST_URI, makeRequest({ body: { limit: 2 } }));

    expect(sentBody()["packetCaptures"]).toEqual([
      job({ id: SECOND_CAPTURE_ID }),
    ]);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  test("a failure of the service is passed on", async () => {
    const failure: Error = new Error("database unavailable");
    service.claimPendingForProbe.mockRejectedValue(failure as never);

    const { next } = await call(LIST_URI, makeRequest({ body: { limit: 2 } }));

    expect(next).toHaveBeenCalledWith(failure);
    expect(responseUtil.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("resolveClaimLimit", () => {
  test("the slots the probe has free, never more than it runs at once", () => {
    expect(resolveClaimLimit(1)).toBe(1);
    expect(resolveClaimLimit(2)).toBe(2);
    expect(resolveClaimLimit(3)).toBe(PACKET_CAPTURE_PROBE_CONCURRENCY);
    expect(resolveClaimLimit(1.9)).toBe(1);
  });

  test("anything that is not a number of slots is none", () => {
    for (const value of [
      0,
      -2,
      "2",
      null,
      undefined,
      Number.NaN,
      Infinity,
      {},
    ]) {
      expect(resolveClaimLimit(value)).toBe(0);
    }
  });
});

describe("readRunningIds", () => {
  test("strings only, and a bounded number of them", () => {
    expect(
      readRunningIds([CAPTURE_ID, 5, null, "", "  ", SECOND_CAPTURE_ID]),
    ).toEqual([CAPTURE_ID, SECOND_CAPTURE_ID]);

    const many: Array<string> = [];

    for (
      let index: number = 0;
      index < MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST + 10;
      index++
    ) {
      many.push(`id-${index}`);
    }

    expect(readRunningIds(many)).toHaveLength(
      MAX_RUNNING_PACKET_CAPTURE_IDS_PER_REQUEST,
    );
  });

  test("anything that is not a list is no ids", () => {
    expect(readRunningIds(undefined)).toEqual([]);
    expect(readRunningIds(CAPTURE_ID)).toEqual([]);
    expect(readRunningIds({ 0: CAPTURE_ID })).toEqual([]);
  });
});

describe("POST /probe/packet-capture/response/ingest", () => {
  test("a failure is recorded against the authenticated probe, with its reason", async () => {
    await call(
      INGEST_URI,
      makeRequest({
        body: {
          probeId: OTHER_PROBE_ID.toString(),
          packetCaptureId: ` ${CAPTURE_ID} `,
          status: PacketCaptureStatus.Failed,
          statusMessage: "tcpdump could not use the filter.",
        },
      }),
    );

    const recorded: {
      probeId: ObjectID;
      packetCaptureId: ObjectID;
      statusMessage: string;
    } = service.recordFailure.mock.calls[0]![0] as {
      probeId: ObjectID;
      packetCaptureId: ObjectID;
      statusMessage: string;
    };

    expect(recorded.probeId.toString()).toBe(PROBE_ID.toString());
    expect(recorded.packetCaptureId.toString()).toBe(CAPTURE_ID);
    expect(recorded.statusMessage).toBe("tcpdump could not use the filter.");
    expect(service.recordCompletion).not.toHaveBeenCalled();
    expect(sentBody()).toEqual({ result: "ok" });
  });

  test("a failure without a reason is recorded with none", async () => {
    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Failed,
        },
      }),
    );

    expect(
      (service.recordFailure.mock.calls[0]![0] as { statusMessage: string })
        .statusMessage,
    ).toBe("");
  });

  test("a completion hands the service the decoded file, the end reason and the tool's words", async () => {
    const pcap: Buffer = tinyPcap();

    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Completed,
          endReason: PacketCaptureEndReason.CaptureToolStopped,
          statusMessage: "tcpdump stopped by itself: interface went down",
          pcapBase64: pcap.toString("base64"),
        },
      }),
    );

    const recorded: {
      probeId: ObjectID;
      packetCaptureId: ObjectID;
      pcap: Buffer | null;
      endReason: PacketCaptureEndReason | undefined;
      statusMessage: string | undefined;
    } = service.recordCompletion.mock.calls[0]![0] as {
      probeId: ObjectID;
      packetCaptureId: ObjectID;
      pcap: Buffer | null;
      endReason: PacketCaptureEndReason | undefined;
      statusMessage: string | undefined;
    };

    expect(recorded.probeId.toString()).toBe(PROBE_ID.toString());
    expect(recorded.packetCaptureId.toString()).toBe(CAPTURE_ID);
    expect(recorded.pcap!.equals(pcap)).toBe(true);
    expect(recorded.endReason).toBe(PacketCaptureEndReason.CaptureToolStopped);
    expect(recorded.statusMessage).toBe(
      "tcpdump stopped by itself: interface went down",
    );
    expect(sentBody()).toEqual({ result: "ok" });
  });

  test("a completion with no file - no packet matched - is recorded with none", async () => {
    for (const pcapBase64 of [undefined, null, ""]) {
      jest.clearAllMocks();
      service.recordCompletion.mockResolvedValue(true as never);

      await call(
        INGEST_URI,
        makeRequest({
          body: {
            packetCaptureId: CAPTURE_ID,
            status: PacketCaptureStatus.Completed,
            endReason: PacketCaptureEndReason.DurationReached,
            pcapBase64: pcapBase64,
          },
        }),
      );

      expect(
        (service.recordCompletion.mock.calls[0]![0] as { pcap: Buffer | null })
          .pcap,
      ).toBeNull();
    }
  });

  test("an end reason the probe made up is not passed on", async () => {
    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Completed,
          endReason: "BecauseISaidSo",
        },
      }),
    );

    expect(
      (
        service.recordCompletion.mock.calls[0]![0] as {
          endReason: PacketCaptureEndReason | undefined;
        }
      ).endReason,
    ).toBeUndefined();
  });

  test.each([
    ["no id", {}],
    ["an id that is not one", { packetCaptureId: "../etc/passwd" }],
    ["an id that is not text", { packetCaptureId: 42 }],
  ])("%s is refused", async (_name: string, body: JSONObject) => {
    await call(
      INGEST_URI,
      makeRequest({ body: { status: PacketCaptureStatus.Failed, ...body } }),
    );

    expect(refusal()).toBe("packetCaptureId is not a valid id");
    expect(service.recordFailure).not.toHaveBeenCalled();
  });

  test("a reason that is not text is refused", async () => {
    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Failed,
          statusMessage: { html: "<b>x</b>" },
        },
      }),
    );

    expect(refusal()).toBe("statusMessage must be a string");
  });

  test("a status other than Completed or Failed is refused", async () => {
    for (const status of [
      PacketCaptureStatus.Running,
      PacketCaptureStatus.Pending,
      "completed",
      undefined,
    ]) {
      jest.clearAllMocks();

      await call(
        INGEST_URI,
        makeRequest({ body: { packetCaptureId: CAPTURE_ID, status: status } }),
      );

      expect(refusal()).toBe('status must be "Completed" or "Failed"');
    }

    expect(service.recordCompletion).not.toHaveBeenCalled();
    expect(service.recordFailure).not.toHaveBeenCalled();
  });

  test("a file that is not base64 text is refused before the service sees it", async () => {
    for (const pcapBase64 of [42, ["AAAA"], { data: "AAAA" }]) {
      jest.clearAllMocks();

      await call(
        INGEST_URI,
        makeRequest({
          body: {
            packetCaptureId: CAPTURE_ID,
            status: PacketCaptureStatus.Completed,
            pcapBase64: pcapBase64,
          },
        }),
      );

      expect(refusal()).toBe(
        "pcapBase64 must be the capture file as base64, within the capture's size limit",
      );
    }

    jest.clearAllMocks();

    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Completed,
          pcapBase64: "not*base64!",
        },
      }),
    );

    expect(refusal()).toBe("pcapBase64 is not base64");
    expect(service.recordCompletion).not.toHaveBeenCalled();
  });

  test("a file larger than the largest capture is refused without being decoded", async () => {
    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Completed,
          pcapBase64: "A".repeat(PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH + 4),
        },
      }),
    );

    expect(refusal()).toContain("within the capture's size limit");
    expect(service.recordCompletion).not.toHaveBeenCalled();
  });

  test("a report of a capture the probe no longer has is refused, with why", async () => {
    service.recordFailure.mockResolvedValue(false as never);

    await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Failed,
        },
      }),
    );

    expect(refusal()).toBe(
      "No running packet capture with this id for this probe. It may have been stopped, deleted or timed out.",
    );
  });

  test("the service's refusal of a file is passed on", async () => {
    const failure: BadDataException = new BadDataException(
      "The uploaded file is not a pcap capture.",
    );
    service.recordCompletion.mockRejectedValue(failure as never);

    const { next } = await call(
      INGEST_URI,
      makeRequest({
        body: {
          packetCaptureId: CAPTURE_ID,
          status: PacketCaptureStatus.Completed,
          pcapBase64: Buffer.from("hello").toString("base64"),
        },
      }),
    );

    expect(next).toHaveBeenCalledWith(failure);
  });
});

describe("the largest upload fits on its way in", () => {
  const repository: string = path.resolve(__dirname, "../../../..");

  // A body parser or nginx limit such as "50mb" / "50M", in bytes.
  const SIZE: RegExp = /^(\d+)\s*(k|m|g)?b?$/i;
  const NGINX_BODY_LIMIT: RegExp = /client_max_body_size\s+([^;]+);/;
  const BODY_PARSER_LIMIT: RegExp = /limit:\s*"([^"]+)"/;

  function toBytes(value: string): number {
    const match: RegExpExecArray | null = SIZE.exec(value.trim());

    expect(match).not.toBeNull();

    const units: Record<string, number> = {
      k: 1024,
      m: 1024 * 1024,
      g: 1024 * 1024 * 1024,
    };

    return Number(match![1]) * (units[(match![2] || "").toLowerCase()] || 1);
  }

  // The largest file as base64, and room for the rest of the JSON report.
  const largestReport: number =
    PACKET_CAPTURE_MAX_UPLOAD_BASE64_LENGTH + 64 * 1024;

  test("through nginx's /probe-ingest location", () => {
    const template: string = fs.readFileSync(
      path.join(repository, "packages/Nginx/default.conf.template"),
      "utf8",
    );
    const start: number = template.indexOf("location /probe-ingest {");

    expect(start).toBeGreaterThan(-1);

    // The block's own closing brace: its lines hold ${...} templates.
    const block: string = template.substring(
      start,
      template.indexOf("\n    }", start),
    );
    const limit: RegExpExecArray | null = NGINX_BODY_LIMIT.exec(block);

    expect(limit).not.toBeNull();
    expect(toBytes(limit![1]!)).toBeGreaterThanOrEqual(largestReport);
  });

  test("through the server's JSON body parser", () => {
    const source: string = fs.readFileSync(
      path.join(repository, "packages/Common/Server/Utils/StartServer.ts"),
      "utf8",
    );
    const start: number = source.indexOf("export const jsonBodyParserOptions");

    expect(start).toBeGreaterThan(-1);

    const limit: RegExpExecArray | null = BODY_PARSER_LIMIT.exec(
      source.substring(start),
    );

    expect(limit).not.toBeNull();
    expect(toBytes(limit![1]!)).toBeGreaterThanOrEqual(largestReport);
  });
});
