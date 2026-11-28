/*
 * A PROBE'S MONITORS, HANDED OUT FROM THE CLAIM ALONE, OVER A REAL
 * CONNECTION (issue #11120): the real /monitor/list router, mounted where
 * the app mounts it, with the real JSON parser and the real answer, and
 * the services that claim work and load secrets stood in for.
 *
 * /monitor/list claimed the probe's due monitor probes in one statement,
 * then read them again with their monitor (MonitorProbeService.findBy) to
 * build its answer: two round trips to Postgres per request, each holding
 * the request's probe scheduling slot. The claim now hands back each
 * claimed monitor as the probe is handed it, and the answer is built from
 * that: nothing of the claimed rows is read again, and the monitors go out
 * in the claim's order, oldest due first. MonitorProbeClaimedMonitorsPostgres
 * holds what the claim hands back to what the read used to.
 */
import {
  ExpressApplication,
  ExpressJson,
  createExpressApp,
} from "Common/Server/Utils/Express";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorProbeService, {
  ClaimedMonitorProbe,
} from "Common/Server/Services/MonitorProbeService";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import ProbeSchedulingLimiterInstance from "Common/Server/Utils/Probe/ProbeSchedulingLimiter";
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
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
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
  findOneBy: AnyMock;
  findOneById: AnyMock;
} = MonitorProbeService as unknown as {
  claimMonitorProbesForProbing: AnyMock;
  findBy: AnyMock;
  findOneBy: AnyMock;
  findOneById: AnyMock;
};

const secretService: { getSecretsForMonitors: AnyMock } =
  MonitorSecretService as unknown as { getSecretsForMonitors: AnyMock };

const hydration: { hydrateNetworkDeviceMonitors: AnyMock } =
  NetworkDeviceHydrationUtil as unknown as {
    hydrateNetworkDeviceMonitors: AnyMock;
  };

const PROBE_ID: string = "3b3b3b3b-0000-4000-8000-00000000003b";
const PROJECT_ID: ObjectID = new ObjectID(
  "4c4c4c4c-0000-4000-8000-00000000004c",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "4c4c4c4c-0000-4000-8000-00000000004d",
);
const TOKEN: string = "tok-11120-filled-in";

// A probe of this release: it declares everything the steps below may need.
const CURRENT_PROBE: Array<string> = [
  ProbeCapability.NetworkDevicePing,
  ProbeCapability.SnmpTables,
  ProbeCapability.SnmpWalk,
  ProbeCapability.DataSecurityScan,
  ProbeCapability.DataObservabilityCollect,
  ProbeCapability.RetryWhenBusy,
  ProbeCapability.RetryAllWorkWhenBusy,
  ProbeCapability.TotpCodes,
  ProbeCapability.AnyRequestBody,
  ProbeCapability.HideSecretValuesInLogs,
];

function stepsOf(monitorType: MonitorType, name: string): MonitorSteps {
  return MonitorSteps.getDefaultMonitorSteps({
    defaultMonitorStatusId: ObjectID.generate(),
    monitorType: monitorType,
    monitorName: name,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
  });
}

// An API step that sends a monitor secret in a header.
function stepsWithASecret(): MonitorSteps {
  const step: MonitorStep = new MonitorStep();
  step.setRequestHeaders({ Authorization: "Bearer {{monitorSecrets.Token}}" });

  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

interface ClaimedSpec {
  monitorId: ObjectID;
  projectId: ObjectID;
  monitorType: MonitorType;
  monitoringInterval: string;
  monitorSteps: MonitorSteps;
}

/*
 * What the claim hands back, as MonitorProbeService builds it
 * (ClaimedMonitor): a monitor of its own each time, its steps read again
 * from their JSON - the answer fills secrets into them.
 */
function claimedOf(spec: ClaimedSpec): ClaimedMonitorProbe {
  const monitor: Monitor = new Monitor(spec.monitorId);
  monitor.projectId = spec.projectId;
  monitor.monitorType = spec.monitorType;
  monitor.monitoringInterval = spec.monitoringInterval;
  monitor.monitorSteps = MonitorSteps.fromJSON(spec.monitorSteps.toJSON());

  return { monitorProbeId: ObjectID.generate(), monitor: monitor };
}

// Three due monitors, oldest due first, as the claim orders them.
function threeDue(): Array<ClaimedSpec> {
  return [
    {
      monitorId: new ObjectID("5d5d5d5d-0000-4000-8000-000000000001"),
      projectId: PROJECT_ID,
      monitorType: MonitorType.Website,
      monitoringInterval: "* * * * *",
      monitorSteps: stepsOf(MonitorType.Website, "Website"),
    },
    {
      monitorId: new ObjectID("5d5d5d5d-0000-4000-8000-000000000002"),
      projectId: OTHER_PROJECT_ID,
      monitorType: MonitorType.Ping,
      monitoringInterval: "*/5 * * * *",
      monitorSteps: stepsOf(MonitorType.Ping, "Ping"),
    },
    {
      monitorId: new ObjectID("5d5d5d5d-0000-4000-8000-000000000003"),
      projectId: PROJECT_ID,
      monitorType: MonitorType.API,
      monitoringInterval: "*/2 * * * *",
      monitorSteps: stepsWithASecret(),
    },
  ];
}

function tokenSecret(): MonitorSecret {
  const secret: MonitorSecret = new MonitorSecret();
  secret.name = "Token";
  secret.secretType = MonitorSecretType.Text;
  secret.secretValue = TOKEN;
  return secret;
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

interface ListAnswer {
  status: number;
  list: JSONArray;
  count: number | null;
}

// What a probe's HTTP client reads from /monitor/list.
async function fetchList(
  origin: string,
  body: JSONObject,
): Promise<ListAnswer> {
  const response: globalThis.Response = await fetch(
    `${origin}/probe-ingest/monitor/list`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        probeId: PROBE_ID,
        probeKey: "a probe key",
        probeCapabilities: CURRENT_PROBE,
        ...body,
      }),
    },
  );

  const text: string = await response.text();
  let json: JSONObject = {};

  try {
    json = text ? (JSON.parse(text) as JSONObject) : {};
  } catch {
    // An error page, not a list.
  }

  return {
    status: response.status,
    list: (json["data"] as JSONArray | undefined) || [],
    count: typeof json["count"] === "number" ? json["count"] : null,
  };
}

// The monitors as the probe reads them (BaseModel.fromJSONArray in FetchList).
function monitorsOf(list: JSONArray): Array<Monitor> {
  return Monitor.fromJSONArray(list as Array<JSONObject>, Monitor);
}

// A request's slot goes back as its answer is sent: waited for, briefly.
async function eventually(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 50 && !condition(); attempt++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  expect(condition()).toBe(true);
}

describe("a probe's monitors are handed out from the claim alone", () => {
  let running: RunningServer | null = null;
  // The probe's due monitors in this test, as the claim reads them.
  let due: Array<ClaimedSpec> = [];

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
    due = threeDue();
    monitorProbeService.claimMonitorProbesForProbing.mockImplementation((() => {
      return Promise.resolve(due.map(claimedOf));
    }) as never);
    // Any read of a claimed row again is the second round trip, gone.
    for (const read of [
      monitorProbeService.findBy,
      monitorProbeService.findOneBy,
      monitorProbeService.findOneById,
    ]) {
      read.mockImplementation((() => {
        return Promise.reject(
          new Error("the answer read the claimed rows again"),
        );
      }) as never);
    }
    secretService.getSecretsForMonitors.mockImplementation((() => {
      return Promise.resolve(
        new Map<string, Array<MonitorSecret>>([
          ["5d5d5d5d-0000-4000-8000-000000000003", [tokenSecret()]],
        ]),
      );
    }) as never);
    hydration.hydrateNetworkDeviceMonitors.mockResolvedValue(
      undefined as never,
    );
  });

  test("hands out the claimed monitors as the claim read them, in its order: oldest due first", async () => {
    const answer: ListAnswer = await fetchList(running!.origin, { limit: 10 });

    expect(answer.status).toBe(200);
    expect(answer.count).toBe(3);

    const monitors: Array<Monitor> = monitorsOf(answer.list);

    expect(
      monitors.map((monitor: Monitor): JSONObject => {
        return {
          id: monitor.id?.toString() || null,
          projectId: monitor.projectId?.toString() || null,
          monitorType: monitor.monitorType || null,
          monitoringInterval: monitor.monitoringInterval || null,
          hasSteps: monitor.monitorSteps instanceof MonitorSteps,
        };
      }),
    ).toEqual(
      due.map((spec: ClaimedSpec): JSONObject => {
        return {
          id: spec.monitorId.toString(),
          projectId: spec.projectId.toString(),
          monitorType: spec.monitorType,
          monitoringInterval: spec.monitoringInterval,
          hasSteps: true,
        };
      }),
    );
  });

  test("each monitor's steps reach the probe as the claim read them", async () => {
    const answer: ListAnswer = await fetchList(running!.origin, { limit: 10 });
    const monitors: Array<Monitor> = monitorsOf(answer.list);

    for (let index: number = 0; index < due.length; index++) {
      expect(
        monitors[index]!.monitorSteps!.data!.monitorStepsInstanceArray.map(
          (step: MonitorStep): string => {
            return step.id.toString();
          },
        ),
      ).toEqual(
        due[index]!.monitorSteps.data!.monitorStepsInstanceArray.map(
          (step: MonitorStep): string => {
            return step.id.toString();
          },
        ),
      );
    }
  });

  test("reads nothing of the claimed rows again: one claim, no MonitorProbe read", async () => {
    await fetchList(running!.origin, { limit: 10 });

    expect(
      monitorProbeService.claimMonitorProbesForProbing,
    ).toHaveBeenCalledTimes(1);
    expect(monitorProbeService.findBy).not.toHaveBeenCalled();
    expect(monitorProbeService.findOneBy).not.toHaveBeenCalled();
    expect(monitorProbeService.findOneById).not.toHaveBeenCalled();
  });

  test("asks the claim for this probe, as many as it asks for, and 100 when it asks for none", async () => {
    await fetchList(running!.origin, { limit: 7 });
    await fetchList(running!.origin, {});

    const calls: Array<Array<unknown>> =
      monitorProbeService.claimMonitorProbesForProbing.mock.calls;

    expect(calls).toHaveLength(2);
    expect((calls[0]![0] as { probeId: ObjectID }).probeId.toString()).toBe(
      PROBE_ID,
    );
    expect((calls[0]![0] as { limit: number }).limit).toBe(7);
    expect((calls[1]![0] as { limit: number }).limit).toBe(100);
  });

  test("a monitor's secrets are filled in from one read for every monitor that names one", async () => {
    const answer: ListAnswer = await fetchList(running!.origin, { limit: 10 });
    const monitors: Array<Monitor> = monitorsOf(answer.list);

    expect(secretService.getSecretsForMonitors).toHaveBeenCalledTimes(1);
    expect(
      (
        secretService.getSecretsForMonitors.mock.calls[0]![0] as {
          monitorIds: Array<ObjectID>;
        }
      ).monitorIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual(["5d5d5d5d-0000-4000-8000-000000000003"]);
    expect(
      monitors[2]!.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
        .requestHeaders!["Authorization"],
    ).toBe(`Bearer ${TOKEN}`);
  });

  test("the claimed monitors go to the network device hydration as they are handed out", async () => {
    await fetchList(running!.origin, { limit: 10 });

    expect(hydration.hydrateNetworkDeviceMonitors).toHaveBeenCalledTimes(1);
    expect(
      (
        hydration.hydrateNetworkDeviceMonitors.mock
          .calls[0]![0] as Array<Monitor>
      ).map((monitor: Monitor): string => {
        return monitor.id!.toString();
      }),
    ).toEqual(
      due.map((spec: ClaimedSpec): string => {
        return spec.monitorId.toString();
      }),
    );
  });

  test("nothing due: an empty list, and nothing else is read", async () => {
    monitorProbeService.claimMonitorProbesForProbing.mockResolvedValue(
      [] as never,
    );

    const answer: ListAnswer = await fetchList(running!.origin, { limit: 10 });

    expect(answer.status).toBe(200);
    expect(answer.list).toEqual([]);
    expect(answer.count).toBe(0);
    expect(secretService.getSecretsForMonitors).not.toHaveBeenCalled();
    expect(hydration.hydrateNetworkDeviceMonitors).not.toHaveBeenCalled();
    expect(monitorProbeService.findBy).not.toHaveBeenCalled();
  });

  test("a claimed row whose monitor has no id is left out, as it always was", async () => {
    monitorProbeService.claimMonitorProbesForProbing.mockImplementation((() => {
      const claimed: Array<ClaimedMonitorProbe> = due.map(claimedOf);
      claimed[1]!.monitor = new Monitor();
      return Promise.resolve(claimed);
    }) as never);

    const answer: ListAnswer = await fetchList(running!.origin, { limit: 10 });

    expect(
      monitorsOf(answer.list).map((monitor: Monitor): string => {
        return monitor.id!.toString();
      }),
    ).toEqual([
      "5d5d5d5d-0000-4000-8000-000000000001",
      "5d5d5d5d-0000-4000-8000-000000000003",
    ]);
    expect(answer.count).toBe(2);
  });

  test("a claim that fails is answered as an error, and its slot goes back", async () => {
    monitorProbeService.claimMonitorProbesForProbing.mockRejectedValue(
      new Error("the database went away") as never,
    );

    const answer: ListAnswer = await fetchList(running!.origin, { limit: 10 });

    expect(answer.status).toBeGreaterThanOrEqual(400);
    expect(answer.list).toEqual([]);
    expect(monitorProbeService.findBy).not.toHaveBeenCalled();
    await eventually((): boolean => {
      return ProbeSchedulingLimiterInstance.runningCount() === 0;
    });
  });
});
