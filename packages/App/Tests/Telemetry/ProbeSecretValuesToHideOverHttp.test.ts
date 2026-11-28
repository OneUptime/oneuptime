/*
 * WHAT A PROBE IS HANDED TO HIDE IN ITS LOG, OVER A REAL CONNECTION (#10875):
 * the real /monitor/list and /monitor-test/list routers, mounted where the
 * app mounts them, the real JSON parser and the real secret filling
 * (MonitorUtil), with the services that claim work and load secrets stood
 * in for.
 *
 * An API monitor sends a token in a header and a password in its body. A
 * probe that declares hideSecretValuesInLogs is handed both values beside
 * the step (MonitorStep.secretValuesToHide), so it can hide them in its own
 * log. A probe that does not - every probe before this release, which has
 * no use for them - is handed exactly what it was handed before: the step
 * with the values filled in, and nothing beside it. Neither route logs a
 * value.
 */
import {
  ExpressApplication,
  ExpressJson,
  createExpressApp,
} from "Common/Server/Utils/Express";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import Probe from "Common/Models/DatabaseModels/Probe";
import MonitorProbeService, {
  ClaimedMonitorProbe,
} from "Common/Server/Services/MonitorProbeService";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import ProbeService from "Common/Server/Services/ProbeService";
import logger from "Common/Server/Utils/Logger";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeCapability from "Common/Types/Probe/ProbeCapability";
import MonitorRouter from "../../FeatureSet/Telemetry/API/ProbeIngest/Monitor";
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

/*
 * Each line as the logger would write it, read when it is logged: the
 * routes log a monitor before its secrets are filled in, and that same
 * object is filled in later.
 */
const mockLoggedLines: Array<string> = [];

jest.mock("Common/Server/Utils/Logger", () => {
  const record: (...args: Array<unknown>) => void = (
    ...args: Array<unknown>
  ): void => {
    mockLoggedLines.push(JSON.stringify(args));
  };

  return {
    __esModule: true,
    default: {
      debug: jest.fn(record),
      info: jest.fn(record),
      warn: jest.fn(record),
      error: jest.fn(record),
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

const PROBE_ID: string = "7d8e2f3a-4b5c-4d6e-8f9a-1b2c3d4e5f6a";
const PROJECT_ID: ObjectID = new ObjectID(
  "dddddddd-0000-4000-8000-00000000000d",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "d1d1d1d1-0000-4000-8000-0000000000d1",
);
const TEST_ID: ObjectID = new ObjectID("7e570000-0000-4000-8000-0000000000d2");
const STEP_ID: ObjectID = new ObjectID("57e90000-0000-4000-8000-0000000000d3");

const TOKEN: string = "tok-5a7c-echoed-back";
const PASSWORD: string = 'correct "horse" battery';

// What a probe of the release before this one declares.
const PROBE_BEFORE_THIS_RELEASE: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpTables,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
  ProbeCapability.RetryAllWorkWhenBusy,
  ProbeCapability.TotpCodes,
  ProbeCapability.AnyRequestBody,
];
const CURRENT_PROBE: Array<string> = [
  ...PROBE_BEFORE_THIS_RELEASE,
  ProbeCapability.HideSecretValuesInLogs,
];

function apiSteps(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.id = STEP_ID;
  step.data!.id = STEP_ID.toString();
  step.setRequestHeaders({ Authorization: "Bearer {{monitorSecrets.Token}}" });
  step.setRequestBody('{"password": "{{monitorSecrets.Password}}"}');

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function secrets(): Array<MonitorSecret> {
  return [
    ["Token", TOKEN],
    ["Password", PASSWORD],
  ].map(([name, value]: Array<string>): MonitorSecret => {
    const secret: MonitorSecret = new MonitorSecret();
    secret.name = name!;
    secret.secretType = MonitorSecretType.Text;
    secret.secretValue = value!;
    return secret;
  });
}

// What the claim hands back for the probe's one due monitor (#11120).
function claimedMonitor(): ClaimedMonitorProbe {
  const monitor: Monitor = new Monitor(MONITOR_ID);
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = MonitorType.API;
  monitor.monitorSteps = apiSteps();

  return {
    monitorProbeId: new ObjectID("c1c1c1c1-0000-4000-8000-0000000000d4"),
    monitor: monitor,
  };
}

function claimedTest(): MonitorTest {
  const test: MonitorTest = new MonitorTest(TEST_ID);
  test.projectId = PROJECT_ID;
  test.monitorId = MONITOR_ID;
  test.monitorType = MonitorType.API;
  test.monitorSteps = apiSteps();
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

// What a probe's HTTP client reads: the response's text, and the list in it.
async function fetchList(
  origin: string,
  path: string,
  probeCapabilities: Array<string>,
): Promise<{ text: string; list: JSONArray }> {
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

  const text: string = await response.text();

  return {
    text: text,
    list: (JSON.parse(text) as JSONObject)["data"] as JSONArray,
  };
}

function stepOf(
  item: JSONObject,
  model: typeof Monitor | typeof MonitorTest,
): MonitorStep {
  const read: Monitor | MonitorTest = (model as typeof Monitor).fromJSON(
    item,
    model as typeof Monitor,
  ) as Monitor | MonitorTest;

  return read.monitorSteps!.data!.monitorStepsInstanceArray[0]!;
}

// Everything the routes logged, as it was when logged: no value may be in it.
function everythingLogged(): string {
  expect(logger.debug).toHaveBeenCalled();

  return mockLoggedLines.join("\n");
}

describe("the secret values a probe is handed to hide in its log, over HTTP", () => {
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
    mockLoggedLines.length = 0;
    monitorProbeService.claimMonitorProbesForProbing.mockImplementation((() => {
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
    probeService.findOneById.mockResolvedValue(customProbe() as never);
  });

  test("a probe that hides them is handed a monitor's values beside its step", async () => {
    const { list } = await fetchList(
      running!.origin,
      "/probe-ingest/monitor/list",
      CURRENT_PROBE,
    );

    expect(list).toHaveLength(1);

    const step: MonitorStep = stepOf(list[0] as JSONObject, Monitor);

    expect([...(step.data!.secretValuesToHide || [])].sort()).toEqual(
      [PASSWORD, TOKEN].sort(),
    );
    // The step itself is as it always was: the values filled in.
    expect(step.data!.requestHeaders!["Authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(everythingLogged()).not.toContain(TOKEN);
    expect(everythingLogged()).not.toContain("horse");
  });

  test("a probe from before is handed the monitor as before, and nothing beside its step", async () => {
    const { text, list } = await fetchList(
      running!.origin,
      "/probe-ingest/monitor/list",
      PROBE_BEFORE_THIS_RELEASE,
    );

    expect(list).toHaveLength(1);
    expect(text).not.toContain("secretValuesToHide");

    const step: MonitorStep = stepOf(list[0] as JSONObject, Monitor);

    expect(step.data!.secretValuesToHide).toBeUndefined();
    expect(step.data!.requestHeaders!["Authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  test("a Test Monitor run alike: handed to a probe that hides them, kept from one that does not", async () => {
    const current: { text: string; list: JSONArray } = await fetchList(
      running!.origin,
      "/probe-ingest/monitor-test/list",
      CURRENT_PROBE,
    );

    expect(current.list).toHaveLength(1);
    expect(
      [
        ...(stepOf(current.list[0] as JSONObject, MonitorTest).data!
          .secretValuesToHide || []),
      ].sort(),
    ).toEqual([PASSWORD, TOKEN].sort());

    const older: { text: string; list: JSONArray } = await fetchList(
      running!.origin,
      "/probe-ingest/monitor-test/list",
      PROBE_BEFORE_THIS_RELEASE,
    );

    expect(older.list).toHaveLength(1);
    expect(older.text).not.toContain("secretValuesToHide");
    expect(everythingLogged()).not.toContain(TOKEN);
    expect(everythingLogged()).not.toContain("horse");
  });

  test("a probe that sends no capabilities at all is handed nothing beside its step", async () => {
    const { text, list } = await fetchList(
      running!.origin,
      "/probe-ingest/monitor/list",
      [],
    );

    expect(list).toHaveLength(1);
    expect(text).not.toContain("secretValuesToHide");
  });
});
