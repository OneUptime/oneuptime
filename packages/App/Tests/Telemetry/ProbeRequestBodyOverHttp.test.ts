/*
 * What a probe too old to send an array, single-value or text body is
 * handed, over a real connection (issue #10737): the real /monitor/list
 * and /monitor-test/list routers, mounted where the app mounts them, the
 * real JSON parser, the real secret filling (MonitorUtil) and the real gate
 * (ProbeStepGate, with every need), with the services that claim work and
 * load secrets stood in for.
 *
 * An API monitor posts a JSON array, a monitor secret holding a quote in
 * it. A probe that declares anyRequestBody is handed the monitor, the
 * secret filled in escaped for its string (#10735). A custom probe that
 * does not - every probe before 17.2.0 - is handed nothing for it, and the
 * check's result is written for it instead: offline, with a sentence that
 * says the probe is too old to send such a body and to update it, where
 * the old probe would have failed with "Expected JSONObject, but got
 * JSONArray".
 */
import {
  ExpressApplication,
  ExpressJson,
  createExpressApp,
} from "Common/Server/Utils/Express";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import ProbeService from "Common/Server/Services/ProbeService";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import MonitorRequestBody, {
  MonitorRequestBodyReading,
} from "Common/Utils/Monitor/MonitorRequestBody";
import TelemetryQueueService from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/Monitor";
import { REQUEST_BODY_STEP_NOT_RUN_MESSAGE } from "../../FeatureSet/Telemetry/Utils/RequestBodyProbeGate";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
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

// Substitution only: the sandbox runner and tracing are not needed.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return {
    __esModule: true,
    default: {
      runCodeInSandbox: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
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
    },
  };
});

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: jest.fn(),
      setString: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      claimMonitorProbesForProbing: jest.fn(),
      countMonitorProbesDueForProbing: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorTestService", () => {
  return {
    __esModule: true,
    default: {
      claimMonitorTestsForProbing: jest.fn(),
      findBy: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      getSecretsForMonitors: jest.fn(),
      getSecretsForUnsavedMonitor: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil", () => {
  return {
    __esModule: true,
    default: {
      hydrateNetworkDeviceMonitors: jest.fn(),
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
        addProbeIngestJob: jest.fn(),
      },
    };
  },
);

type AnyMock = Mock<(...args: Array<any>) => any>;

const monitorProbeService: {
  claimMonitorProbesForProbing: AnyMock;
  findBy: AnyMock;
} = MonitorProbeService as unknown as {
  claimMonitorProbesForProbing: AnyMock;
  findBy: AnyMock;
};

const monitorTestService: {
  claimMonitorTestsForProbing: AnyMock;
  findBy: AnyMock;
} = MonitorTestService as unknown as {
  claimMonitorTestsForProbing: AnyMock;
  findBy: AnyMock;
};

const secretService: {
  getSecretsForMonitors: AnyMock;
  getSecretsForUnsavedMonitor: AnyMock;
} = MonitorSecretService as unknown as {
  getSecretsForMonitors: AnyMock;
  getSecretsForUnsavedMonitor: AnyMock;
};

const probeService: { findOneById: AnyMock } = ProbeService as unknown as {
  findOneById: AnyMock;
};

const queue: { addProbeIngestJob: AnyMock } =
  TelemetryQueueService as unknown as { addProbeIngestJob: AnyMock };

const PROBE_ID: string = "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b";
const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "a1a1a1a1-0000-4000-8000-0000000000a1",
);
const TEST_ID: ObjectID = new ObjectID("7e570000-0000-4000-8000-0000000000e2");
const STEP_ID: ObjectID = new ObjectID("57e90000-0000-4000-8000-0000000000e2");

const PASSWORD: string = 'p"ass\\word';
const BODY: string =
  '[{"user": "ops", "password": "{{monitorSecrets.Password}}"}]';

// Every capability a 17.1.0 probe declares: one-time codes, objects only.
const PROBE_OF_17_1: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpTables,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
  ProbeCapability.RetryAllWorkWhenBusy,
  ProbeCapability.TotpCodes,
];
const CURRENT_PROBE: Array<string> = [
  ...PROBE_OF_17_1,
  ProbeCapability.AnyRequestBody,
];

function arrayBodySteps(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.id = STEP_ID;
  step.data = {
    ...MonitorStep.getDefaultMonitorStep({
      monitorType: MonitorType.API,
      defaultMonitorStatusId: ObjectID.generate(),
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
      monitorName: "Orders API",
    } as never).data!,
    id: STEP_ID.toString(),
    monitorDestination: URL.fromString("https://api.example.com/orders"),
    requestType: HTTPMethod.POST,
    requestBody: BODY,
  };

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function secrets(): Array<MonitorSecret> {
  const password: MonitorSecret = new MonitorSecret();
  password.name = "Password";
  password.secretType = MonitorSecretType.Text;
  password.secretValue = PASSWORD;

  return [password];
}

function claimedMonitor(): MonitorProbe {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.API;
  monitor.monitorSteps = arrayBodySteps();

  const monitorProbe: MonitorProbe = new MonitorProbe(ObjectID.generate());
  monitorProbe.monitorId = MONITOR_ID;
  monitorProbe.probeId = new ObjectID(PROBE_ID);
  monitorProbe.monitor = monitor;
  return monitorProbe;
}

function claimedTest(): MonitorTest {
  const test: MonitorTest = new MonitorTest(TEST_ID);
  test.projectId = PROJECT_ID;
  test.monitorId = MONITOR_ID;
  test.monitorType = MonitorType.API;
  test.monitorSteps = arrayBodySteps();
  return test;
}

function customProbe(): Probe {
  const probe: Probe = new Probe(new ObjectID(PROBE_ID));
  probe.isGlobalProbe = false;
  return probe;
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

// What a probe's HTTP client reads: the list, as BaseModel JSON.
async function fetchList(
  origin: string,
  path: string,
  probeCapabilities: Array<string>,
): Promise<JSONArray> {
  const response: globalThis.Response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      probeId: PROBE_ID,
      probeKey: "a probe key",
      probeCapabilities: probeCapabilities,
      limit: 10,
    }),
  });

  expect(response.status).toBe(200);

  return (JSON.parse(await response.text()) as JSONObject)["data"] as JSONArray;
}

function queuedResults(): Array<{
  jobType: string;
  testId?: string | undefined;
  result: ProbeMonitorResponse;
}> {
  return queue.addProbeIngestJob.mock.calls.map((call: Array<unknown>) => {
    const job: {
      jobType: string;
      testId?: string | undefined;
      probeMonitorResponse: JSONObject;
    } = call[0] as {
      jobType: string;
      testId?: string | undefined;
      probeMonitorResponse: JSONObject;
    };

    return {
      jobType: job.jobType,
      testId: job.testId,
      result: JSONFunctions.deserialize(
        job.probeMonitorResponse,
      ) as unknown as ProbeMonitorResponse,
    };
  });
}

describe("an API monitor that posts a JSON array, over HTTP", () => {
  let running: RunningServer | null = null;

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/probe-ingest", MonitorRouter);
    running = await listen(app);
  });

  afterAll(async () => {
    if (!running) {
      return;
    }
    running.server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      running!.server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    monitorProbeService.claimMonitorProbesForProbing.mockResolvedValue([
      new ObjectID("c1c1c1c1-0000-4000-8000-0000000000c2"),
    ] as never);
    monitorProbeService.findBy.mockImplementation((() => {
      return Promise.resolve([claimedMonitor()]);
    }) as never);
    monitorTestService.claimMonitorTestsForProbing.mockResolvedValue([
      TEST_ID,
    ] as never);
    monitorTestService.findBy.mockImplementation((() => {
      return Promise.resolve([claimedTest()]);
    }) as never);
    secretService.getSecretsForMonitors.mockImplementation((() => {
      return Promise.resolve(
        new Map<string, Array<MonitorSecret>>([
          [MONITOR_ID.toString(), secrets()],
        ]),
      );
    }) as never);
    secretService.getSecretsForUnsavedMonitor.mockResolvedValue(
      secrets() as never,
    );
    probeService.findOneById.mockResolvedValue(customProbe() as never);
    queue.addProbeIngestJob.mockResolvedValue(undefined as never);
  });

  test("a probe that sends any body is handed the monitor, its secret filled in escaped for its string", async () => {
    const list: JSONArray = await fetchList(
      running!.origin,
      "/probe-ingest/monitor/list",
      CURRENT_PROBE,
    );

    expect(list).toHaveLength(1);

    const monitor: Monitor = Monitor.fromJSON(
      list[0] as JSONObject,
      Monitor,
    ) as Monitor;
    const body: string = monitor.monitorSteps!.data!
      .monitorStepsInstanceArray[0]!.data!.requestBody as string;
    const reading: MonitorRequestBodyReading = MonitorRequestBody.read(body);

    expect(reading.isJson).toBe(true);
    expect(reading.isJson && reading.value).toEqual([
      { user: "ops", password: PASSWORD },
    ]);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
    expect(probeService.findOneById).not.toHaveBeenCalled();
  });

  test("a custom probe from before 17.2.0 is handed nothing for it, and the check fails offline, saying why", async () => {
    const list: JSONArray = await fetchList(
      running!.origin,
      "/probe-ingest/monitor/list",
      PROBE_OF_17_1,
    );

    // Nothing reaches the old probe: not the body, not the secret.
    expect(list).toEqual([]);
    expect(JSON.stringify(list)).not.toContain("ass\\\\word");

    const written: Array<{ jobType: string; result: ProbeMonitorResponse }> =
      queuedResults();

    expect(written).toHaveLength(1);
    expect(written[0]!.jobType).toBe("probe-response");

    const result: ProbeMonitorResponse = written[0]!.result;

    expect(result.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(result.monitorStepId.toString()).toBe(STEP_ID.toString());
    expect(result.probeId.toString()).toBe(PROBE_ID);
    expect(result.isOnline).toBe(false);
    expect(result.failureCause).toBe(REQUEST_BODY_STEP_NOT_RUN_MESSAGE);
    expect(result.failureCause).toBe(
      "This probe is too old to send a request body that is a JSON array, a single value or text, so the check did not run. Update the probe to OneUptime 17.2.0 or later.",
    );
    // The secret is not in what is written.
    expect(JSON.stringify(result)).not.toContain("word");
  });

  test("a Test Monitor run on such a probe says the same, filed under the test", async () => {
    const list: JSONArray = await fetchList(
      running!.origin,
      "/probe-ingest/monitor-test/list",
      PROBE_OF_17_1,
    );

    expect(list).toEqual([]);

    const written: Array<{
      jobType: string;
      testId?: string | undefined;
      result: ProbeMonitorResponse;
    }> = queuedResults();

    expect(written).toHaveLength(1);
    expect(written[0]!.jobType).toBe("monitor-test");
    expect(written[0]!.testId).toBe(TEST_ID.toString());
    expect(written[0]!.result.isOnline).toBe(false);
    expect(written[0]!.result.failureCause).toBe(
      REQUEST_BODY_STEP_NOT_RUN_MESSAGE,
    );
  });

  test("a Test Monitor run on a probe that sends any body is handed out", async () => {
    const list: JSONArray = await fetchList(
      running!.origin,
      "/probe-ingest/monitor-test/list",
      CURRENT_PROBE,
    );

    expect(list).toHaveLength(1);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });

  test("a global probe is handed the monitor whatever it declares: OneUptime's own probes are never flagged", async () => {
    const global: Probe = customProbe();
    global.isGlobalProbe = true;
    probeService.findOneById.mockResolvedValue(global as never);

    const list: JSONArray = await fetchList(
      running!.origin,
      "/probe-ingest/monitor/list",
      PROBE_OF_17_1,
    );

    expect(list).toHaveLength(1);
    expect(queue.addProbeIngestJob).not.toHaveBeenCalled();
  });
});
