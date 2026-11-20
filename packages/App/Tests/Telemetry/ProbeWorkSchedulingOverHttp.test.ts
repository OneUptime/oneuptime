/*
 * THE PROBES' OTHER WORK ENDPOINTS UNDER THE PROBE SCHEDULING LIMIT, OVER
 * HTTP (issue #8051): real connections, the real Express app, the real JSON
 * parser, and the real routers mounted where the app mounts them.
 *
 * #7920 put /monitor/list, /monitor-test/list and /probe/network-device/list
 * under the limit. The other work a probe polls for held a connection each,
 * with no bound on how many ran at once: discovery scans, device
 * diagnostics, packet captures, VMware and OpenStack collections, OpenStack
 * checks, Data Security scans and Data Observability collections. Each now
 * waits for a slot, and one the limiter refuses claims nothing and is
 * answered busy, as each probe reads it:
 *
 *   - a 429 with Retry-After to a probe that declares retryAllWorkWhenBusy,
 *     whose fetches read it as "ask again after the Retry-After";
 *   - the endpoint's empty answer to any other - one that declares
 *     retryWhenBusy alone included: its fetches of these log a 429 as a
 *     failed request, every tick;
 *   - packet capture's list to every probe: the running captures are heard
 *     from and the stops answered, and only the claim is refused - a 429
 *     would lose the stops, and two minutes of them the captures.
 *
 * The limiter is made to refuse (its own refusals are pinned in
 * ProbeSchedulingBusy and ProbeSchedulingOverHttp); the claims are watched,
 * and none may run.
 */
import {
  ExpressApplication,
  ExpressJson,
  createExpressApp,
} from "Common/Server/Utils/Express";
import ProbeSchedulingLimiterInstance, {
  PROBE_SCHEDULING_BUSY_MESSAGE,
  PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS,
  ProbeSchedulingBusyError,
} from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
import DataStoreService from "Common/Server/Services/DataStoreService";
import NetworkDeviceDiagnosticService from "Common/Server/Services/NetworkDeviceDiagnosticService";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import OpenStackCloudCheckService from "Common/Server/Services/OpenStackCloudCheckService";
import OpenStackCloudConnectionTestService from "Common/Server/Services/OpenStackCloudConnectionTestService";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import PacketCaptureService from "Common/Server/Services/PacketCaptureService";
import VMwareVCenterConnectionTestService from "Common/Server/Services/VMwareVCenterConnectionTestService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import { DATA_OBSERVABILITY_PROBE_WORK_ROUTE } from "Common/Server/Utils/DataObservability/DataObservabilityProbeCollect";
import { DATA_SECURITY_PROBE_WORK_ROUTE } from "Common/Server/Utils/DataSecurity/DataSecurityProbeScan";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import DataObservabilityRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/DataObservability";
import DataSecurityRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/DataSecurity";
import DiscoveryScanRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";
import NetworkDeviceDiagnosticRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/NetworkDeviceDiagnostic";
import OpenStackChecksRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackChecks";
import OpenStackCollectionRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/OpenStackCollection";
import PacketCaptureRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/PacketCapture";
import VMwareCollectionRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/VMwareCollection";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import http from "http";
import { AddressInfo } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
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

// What ProbeAuthorization sets once a probe's id and key check out.
jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: (
        req: { body: { probeId?: string }; probe?: unknown },
        _res: unknown,
        next: () => void,
      ): void => {
        /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        const ProbeModel: new (id: unknown) => unknown =
          require("Common/Models/DatabaseModels/Probe").default;
        const ObjectIDType: new (id: string) => unknown =
          require("Common/Types/ObjectID").default;
        /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
        req.probe = new ProbeModel(new ObjectIDType(String(req.body.probeId)));
        next();
      },
      /*
       * A collection's key checks before its report is parsed (#10222):
       * nothing here posts a collection's key, so they let it through.
       */
      isAuthorizedFromHeadersMiddleware: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
      },
      isAuthorizedFromReportOpeningMiddleware: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
      },
    },
  };
});

// The queue module pulls in BullMQ at import time.
jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addMetricIngestJob: jest.fn(),
        addLogIngestJob: jest.fn(),
      },
    };
  },
);

const PROBE_ID: string = "7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a";
const RUNNING_CAPTURE_ID: string = "8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b";
const STOPPED_CAPTURE_ID: string = "9f0a1b2c-3d4e-4f5a-8b6c-7d8e9f0a1b2c";

// A probe from issue #8051 on: every work fetch reads a 429.
const EVERY_WORK_RETRYING_PROBE: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
  ProbeCapability.RetryAllWorkWhenBusy,
];
// A probe of #7920 to #8051: only its three scheduling fetches read a 429.
const SCHEDULING_RETRYING_PROBE: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
];
const OLDER_PROBE: Array<string> = [ProbeCapability.NetworkDevicePing];

interface Answer {
  status: number;
  retryAfter: string | null;
  body: JSONObject | JSONArray;
}

interface RunningServer {
  server: http.Server;
  origin: string;
}

async function listen(app: ExpressApplication): Promise<RunningServer> {
  const server: http.Server = http.createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

async function close(running: RunningServer | null): Promise<void> {
  if (!running) {
    return;
  }
  running.server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    running.server.close(() => {
      resolve();
    });
  });
}

// A probe's POST, as its HTTP client sends it.
async function post(
  origin: string,
  path: string,
  body: JSONObject,
): Promise<Answer> {
  const response: globalThis.Response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    retryAfter: response.headers.get("retry-after"),
    body: (await response.json()) as JSONObject | JSONArray,
  };
}

type Claim = ReturnType<typeof jest.spyOn>;

interface WorkEndpoint {
  name: string;
  path: string;
  // What the probe sends with its capabilities.
  body: JSONObject;
  // What the probe's HTTP client reads out of the empty answer.
  emptyAnswer: JSONObject | JSONArray;
  readsAs: (answer: Answer) => unknown;
  // The claims the request would make: none may run while it is refused.
  claims: () => Array<Claim>;
}

function asJson(answer: Answer): unknown {
  return answer.body;
}

const WORK_ENDPOINTS: Array<WorkEndpoint> = [
  {
    name: "discovery scans",
    path: "/probe/discovery-scan/list",
    body: { excludeScanIds: [] },
    emptyAnswer: [],
    // The probe reads the list through HTTPResponse, as BaseModel.fromJSONArray takes it.
    readsAs: (answer: Answer): unknown => {
      return new HTTPResponse<JSONArray>(answer.status, answer.body, {}).data;
    },
    claims: (): Array<Claim> => {
      return [
        jest.spyOn(NetworkDeviceDiscoveryScanService, "findBy"),
        jest.spyOn(
          NetworkDeviceDiscoveryScanService,
          "updateColumnsByIdWithoutHooks",
        ),
      ];
    },
  },
  {
    name: "network device diagnostics",
    path: "/probe/network-device-diagnostic/list",
    body: { limit: 10 },
    emptyAnswer: { diagnostics: [] },
    readsAs: asJson,
    claims: (): Array<Claim> => {
      return [
        jest.spyOn(NetworkDeviceDiagnosticService, "claimPendingForProbe"),
      ];
    },
  },
  {
    name: "VMware collections",
    path: "/probe/vmware/work",
    body: { runningVMwareVCenterIds: [] },
    emptyAnswer: { collections: [], tests: [] },
    readsAs: asJson,
    claims: (): Array<Claim> => {
      return [
        jest.spyOn(VMwareVCenterService, "claimForCollection"),
        jest.spyOn(VMwareVCenterConnectionTestService, "claimPendingTests"),
      ];
    },
  },
  {
    name: "OpenStack collections",
    path: "/probe/openstack/work",
    body: { runningOpenStackCloudIds: [] },
    emptyAnswer: { collections: [], tests: [] },
    readsAs: asJson,
    claims: (): Array<Claim> => {
      return [
        jest.spyOn(OpenStackCloudService, "claimForCollection"),
        jest.spyOn(OpenStackCloudConnectionTestService, "claimPendingTests"),
      ];
    },
  },
  {
    name: "OpenStack checks",
    path: "/probe/openstack/checks/work",
    body: { runningApiCheckIds: [], runningLifecycleCheckIds: [] },
    emptyAnswer: { apiChecks: [], lifecycleChecks: [] },
    readsAs: asJson,
    claims: (): Array<Claim> => {
      return [
        jest.spyOn(OpenStackCloudCheckService, "claimApiChecks"),
        jest.spyOn(OpenStackCloudCheckService, "claimLifecycleChecks"),
      ];
    },
  },
  {
    name: "Data Security scans",
    path: DATA_SECURITY_PROBE_WORK_ROUTE,
    body: {},
    emptyAnswer: { stores: [] },
    readsAs: asJson,
    // The claim is one statement on DataStoreService's connection.
    claims: (): Array<Claim> => {
      return [jest.spyOn(DataStoreService, "getRepository")];
    },
  },
  {
    name: "Data Observability collections",
    path: DATA_OBSERVABILITY_PROBE_WORK_ROUTE,
    body: {},
    emptyAnswer: { stores: [] },
    readsAs: asJson,
    claims: (): Array<Claim> => {
      return [jest.spyOn(DataStoreService, "getRepository")];
    },
  },
];

describe("the probes' other work endpoints over HTTP when the server is busy", () => {
  let running: RunningServer | null = null;

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());

    for (const router of [
      DiscoveryScanRouter,
      NetworkDeviceDiagnosticRouter,
      PacketCaptureRouter,
      VMwareCollectionRouter,
      OpenStackCollectionRouter,
      OpenStackChecksRouter,
      DataSecurityRouter,
      DataObservabilityRouter,
    ]) {
      app.use("/probe-ingest", router);
    }

    running = await listen(app);
  });

  afterAll(async () => {
    await close(running);
  });

  let acquire: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    acquire = jest
      .spyOn(ProbeSchedulingLimiterInstance, "acquire")
      .mockRejectedValue(new ProbeSchedulingBusyError() as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(WORK_ENDPOINTS)(
    "POST $path ($name)",
    (endpoint: WorkEndpoint) => {
      async function ask(capabilities: Array<string>): Promise<{
        answer: Answer;
        claims: Array<Claim>;
      }> {
        const claims: Array<Claim> = endpoint.claims();

        const answer: Answer = await post(
          running!.origin,
          `/probe-ingest${endpoint.path}`,
          {
            ...endpoint.body,
            probeId: PROBE_ID,
            probeKey: "probe-key",
            probeCapabilities: capabilities,
          },
        );

        return { answer, claims };
      }

      test("waits for a scheduling slot under the probe's own key", async () => {
        await ask(EVERY_WORK_RETRYING_PROBE);

        expect(acquire).toHaveBeenCalledTimes(1);
        expect(acquire.mock.calls[0]![0]).toBe(PROBE_ID);
      });

      test("refused, a probe that declares retryAllWorkWhenBusy gets a 429 with Retry-After, and nothing is claimed", async () => {
        const { answer, claims } = await ask(EVERY_WORK_RETRYING_PROBE);

        expect(answer.status).toBe(429);
        expect(answer.retryAfter).toBe(
          String(PROBE_SCHEDULING_BUSY_RETRY_AFTER_SECONDS),
        );
        expect(answer.body).toEqual({ message: PROBE_SCHEDULING_BUSY_MESSAGE });

        for (const claim of claims) {
          expect(claim).not.toHaveBeenCalled();
        }
      });

      test.each([
        [
          "a probe that declares retryWhenBusy alone",
          SCHEDULING_RETRYING_PROBE,
        ],
        ["an older probe", OLDER_PROBE],
      ])(
        "refused, %s reads the empty answer, and nothing is claimed",
        async (_label: string, capabilities: Array<string>) => {
          const { answer, claims } = await ask(capabilities);

          expect(answer.status).toBe(200);
          expect(answer.retryAfter).toBeNull();
          expect(endpoint.readsAs(answer)).toEqual(endpoint.emptyAnswer);

          for (const claim of claims) {
            expect(claim).not.toHaveBeenCalled();
          }
        },
      );
    },
  );

  describe("POST /probe/packet-capture/list", () => {
    let heartbeat: ReturnType<typeof jest.spyOn>;
    let claim: ReturnType<typeof jest.spyOn>;

    beforeEach(() => {
      heartbeat = jest
        .spyOn(PacketCaptureService, "findCapturesToStop")
        .mockResolvedValue([STOPPED_CAPTURE_ID] as never);
      claim = jest.spyOn(PacketCaptureService, "claimPendingForProbe");
    });

    test.each([
      ["a probe that declares retryAllWorkWhenBusy", EVERY_WORK_RETRYING_PROBE],
      ["a probe that declares retryWhenBusy alone", SCHEDULING_RETRYING_PROBE],
      ["an older probe", OLDER_PROBE],
    ])(
      "refused, %s still has its running captures heard from and its stops answered - never a 429 - and nothing is claimed",
      async (_label: string, capabilities: Array<string>) => {
        const answer: Answer = await post(
          running!.origin,
          "/probe-ingest/probe/packet-capture/list",
          {
            probeId: PROBE_ID,
            probeKey: "probe-key",
            probeCapabilities: capabilities,
            limit: 1,
            runningPacketCaptureIds: [RUNNING_CAPTURE_ID, STOPPED_CAPTURE_ID],
          },
        );

        expect(answer.status).toBe(200);
        expect(answer.body).toEqual({
          packetCaptures: [],
          stopPacketCaptureIds: [STOPPED_CAPTURE_ID],
        });
        expect(heartbeat).toHaveBeenCalledTimes(1);
        expect(
          (
            heartbeat.mock.calls[0]![0] as {
              runningPacketCaptureIds: Array<string>;
            }
          ).runningPacketCaptureIds,
        ).toEqual([RUNNING_CAPTURE_ID, STOPPED_CAPTURE_ID]);
        expect(claim).not.toHaveBeenCalled();
      },
    );

    test("a probe with no capture slot free is answered without asking for a scheduling slot", async () => {
      const answer: Answer = await post(
        running!.origin,
        "/probe-ingest/probe/packet-capture/list",
        {
          probeId: PROBE_ID,
          probeKey: "probe-key",
          probeCapabilities: EVERY_WORK_RETRYING_PROBE,
          limit: 0,
          runningPacketCaptureIds: [RUNNING_CAPTURE_ID, STOPPED_CAPTURE_ID],
        },
      );

      expect(answer.status).toBe(200);
      expect(answer.body).toEqual({
        packetCaptures: [],
        stopPacketCaptureIds: [STOPPED_CAPTURE_ID],
      });
      expect(acquire).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    });
  });

  test("the reports the probe sends back are never held to the limit", async () => {
    const answer: Answer = await post(
      running!.origin,
      "/probe-ingest/probe/packet-capture/response/ingest",
      {
        probeId: PROBE_ID,
        probeKey: "probe-key",
        probeCapabilities: EVERY_WORK_RETRYING_PROBE,
        packetCaptureId: "not-an-id",
      },
    );

    // Refused for what it says, not for a busy server.
    expect(answer.status).toBe(400);
    expect(acquire).not.toHaveBeenCalled();
  });
});
