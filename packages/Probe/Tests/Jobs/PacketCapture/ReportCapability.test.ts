// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import {
  PacketCaptureCapability,
  PacketCaptureInterface,
} from "Common/Types/PacketCapture/PacketCaptureCapability";
import { HARD_MAX_PACKET_CAPTURE_LIMITS } from "Common/Types/PacketCapture/PacketCaptureLimits";
import API from "Common/Utils/API";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import InitJob, {
  buildPacketCaptureCapability,
  CapabilityDependencies,
  reportPacketCaptureCapability,
  resetReportedServerMessage,
} from "../../../Jobs/PacketCapture/ReportCapability";
import { CaptureToolInfo } from "../../../Utils/PacketCapture/PacketCaptureRunner";
import { readPacketCaptureSettings } from "../../../Utils/PacketCapture/PacketCaptureSettings";

/*
 * The probe tells OneUptime what it can capture on - when it starts and
 * every five minutes - so the dashboard's Start Packet Capture offers what
 * this probe can do right now. A probe with captures off says exactly that,
 * and nothing about its interfaces: its operator did not ask for them to be
 * shown. tcpdump and the host's interfaces are injected, never touched.
 */

const INTERFACES: Array<PacketCaptureInterface> = [
  { name: "any", addresses: [], isUp: true, isLoopback: false },
  { name: "eth0", addresses: ["10.0.0.2/24"], isUp: true, isLoopback: false },
];

let detectTool: jest.Mock;
let listInterfaces: jest.Mock;

function dependencies(
  env: Record<string, string> = {},
): CapabilityDependencies {
  return {
    settings: readPacketCaptureSettings({
      PROBE_PACKET_CAPTURE_ENABLED: "true",
      ...env,
    }),
    detectTool: detectTool as unknown as () => Promise<CaptureToolInfo>,
    listInterfaces:
      listInterfaces as unknown as () => Array<PacketCaptureInterface>,
  };
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  resetReportedServerMessage();
  detectTool = jest.fn(async (): Promise<CaptureToolInfo> => {
    return { isAvailable: true, version: "tcpdump version 4.99.3" };
  });
  listInterfaces = jest.fn((): Array<PacketCaptureInterface> => {
    return INTERFACES;
  });
  fetchSpy = jest
    .spyOn(API, "fetch")
    .mockResolvedValue(
      new HTTPResponse(200, { isPacketCaptureAvailable: true }, {}) as never,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sent(): { url: string; body: JSONObject } {
  expect(fetchSpy).toHaveBeenCalledTimes(1);

  const arg: JSONObject = fetchSpy.mock.calls[0]![0] as unknown as JSONObject;

  return { url: String(arg["url"]), body: arg["data"] as JSONObject };
}

describe("what the probe says it can capture on", () => {
  test("captures on: tcpdump, its version, the interfaces and the limits", async () => {
    expect(await buildPacketCaptureCapability(dependencies())).toEqual({
      isEnabled: true,
      isToolAvailable: true,
      toolVersion: "tcpdump version 4.99.3",
      interfaces: INTERFACES,
      limits: HARD_MAX_PACKET_CAPTURE_LIMITS,
    });
  });

  test("the operator's lower maximums are what it reports", async () => {
    const capability: PacketCaptureCapability =
      await buildPacketCaptureCapability(
        dependencies({
          PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS: "300",
          PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB: "5",
        }),
      );

    expect(capability.limits).toEqual({
      maxDurationInSeconds: 300,
      maxPackets: HARD_MAX_PACKET_CAPTURE_LIMITS.maxPackets,
      maxFileSizeInMB: 5,
    });
  });

  test("with no tcpdump it says so, with no version", async () => {
    detectTool.mockResolvedValue({ isAvailable: false } as never);

    expect(await buildPacketCaptureCapability(dependencies())).toMatchObject({
      isEnabled: true,
      isToolAvailable: false,
    });
    expect(
      (await buildPacketCaptureCapability(dependencies())).toolVersion,
    ).toBeUndefined();
  });

  test("captures off: exactly that, and neither tcpdump nor the interfaces are looked at", async () => {
    const capability: PacketCaptureCapability =
      await buildPacketCaptureCapability({
        ...dependencies(),
        settings: readPacketCaptureSettings({}),
      });

    expect(capability).toEqual({
      isEnabled: false,
      isToolAvailable: false,
      interfaces: [],
      limits: HARD_MAX_PACKET_CAPTURE_LIMITS,
    });
    expect(detectTool).not.toHaveBeenCalled();
    expect(listInterfaces).not.toHaveBeenCalled();
  });
});

describe("the report", () => {
  test("is posted to the probe-ingest capability route, authenticated as this probe", async () => {
    await reportPacketCaptureCapability(dependencies());

    const { url, body } = sent();

    expect(url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/packet-capture/capability",
    );
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");
    expect(body["packetCaptureCapability"]).toMatchObject({
      isEnabled: true,
      interfaces: INTERFACES,
    });
  });

  test("a probe with captures off still reports, so the dashboard says 'off' rather than 'not reported'", async () => {
    await reportPacketCaptureCapability({
      ...dependencies(),
      settings: readPacketCaptureSettings({}),
    });

    expect(sent().body["packetCaptureCapability"]).toEqual({
      isEnabled: false,
      isToolAvailable: false,
      interfaces: [],
      limits: HARD_MAX_PACKET_CAPTURE_LIMITS,
    });
  });

  test("what the server says the operator should hear is logged once, not every five minutes", async () => {
    const warn: jest.SpiedFunction<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    fetchSpy.mockResolvedValue(
      new HTTPResponse(
        200,
        {
          isPacketCaptureAvailable: false,
          message:
            "Packet capture runs only on a project's own probes. This is a global probe, so its captures stay off.",
        },
        {},
      ) as never,
    );

    await reportPacketCaptureCapability(dependencies());
    await reportPacketCaptureCapability(dependencies());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "Packet capture: Packet capture runs only on a project's own probes. This is a global probe, so its captures stay off.",
    );
  });

  test("a server older than packet capture is logged, and nothing throws", async () => {
    const warn: jest.SpiedFunction<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not Found" }, {}) as never,
    );

    await expect(
      reportPacketCaptureCapability(dependencies()),
    ).resolves.toBeUndefined();
    expect(String(warn.mock.calls[0]![0])).toContain("HTTP 404");
  });

  test("a network failure is logged, and nothing throws", async () => {
    const error: jest.SpiedFunction<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    fetchSpy.mockRejectedValue(new Error("ECONNREFUSED") as never);

    await expect(
      reportPacketCaptureCapability(dependencies()),
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
  });
});

describe("the cron registration", () => {
  test("reports every five minutes, and once at startup - whether or not captures are on", () => {
    InitJob();

    const captured: CapturedCronJob =
      mockCapturedCronJobs[mockCapturedCronJobs.length - 1]!;

    expect(captured.jobName).toBe("Probe:ReportPacketCaptureCapability");
    expect(captured.options.schedule).toBe(EVERY_FIVE_MINUTE);
    expect(captured.options.runOnStartup).toBe(true);
  });
});
