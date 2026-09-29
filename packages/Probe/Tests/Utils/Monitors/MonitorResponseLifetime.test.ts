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
import MonitorUtil from "../../../Utils/Monitors/Monitor";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import TelemetryContext from "Common/Server/Utils/Telemetry/TelemetryContext";

type ProbeStepInput = Parameters<typeof MonitorUtil.probeMonitorStep>[0];

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (resolvePromise: (value: T | PromiseLike<T>) => void) => {
      resolve = resolvePromise;
    },
  );
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

function makeMonitor(stepCount: number = 2): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(
    Array.from({ length: stepCount }, () => {
      return new MonitorStep();
    }),
  );
  return {
    id: ObjectID.generate(),
    projectId: ObjectID.generate(),
    monitorType: MonitorType.Website,
    monitorSteps,
  } as Monitor;
}

function makeResponse(
  data: Parameters<typeof MonitorUtil.probeMonitorStep>[0],
): ProbeMonitorResponse {
  return {
    monitorId: data.monitorId,
    projectId: data.projectId,
    monitorStepId: data.monitorStep.id,
    probeId: new ObjectID("11111111-2222-3333-4444-555555555555"),
    monitoredAt: new Date(),
    isOnline: true,
    failureCause: "",
    responseBody: "response body",
  };
}

// eslint-disable-next-line @typescript-eslint/typedef
let stepSpy = jest.spyOn(MonitorUtil, "probeMonitorStep");
// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let debugSpy = jest.spyOn(logger, "debug");

beforeEach(() => {
  stepSpy = jest
    .spyOn(MonitorUtil, "probeMonitorStep")
    .mockImplementation(
      async (data: ProbeStepInput): Promise<ProbeMonitorResponse> => {
        return makeResponse(data);
      },
    );
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: {} } as never);
  debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {});
  jest.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("periodic monitor response lifetime", () => {
  test("ingests every step and resolves without retaining response bodies", async () => {
    const monitor: Monitor = makeMonitor();

    await expect(MonitorUtil.probeMonitor(monitor)).resolves.toBeUndefined();

    expect(stepSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (let index: number = 0; index < 2; index++) {
      const request: Parameters<typeof API.fetch>[0] =
        fetchSpy.mock.calls[index]![0];
      expect(request.method).toBe(HTTPMethod.POST);
      expect(request.url.toString()).toBe(
        "https://oneuptime.example.com/probe-ingest/probe/response/ingest",
      );
      expect(request.data).toMatchObject({
        probeKey: "test-probe-key",
        probeId: "11111111-2222-3333-4444-555555555555",
        probeMonitorResponse: {
          monitorId: monitor.id,
          monitorStepId:
            monitor.monitorSteps!.data!.monitorStepsInstanceArray[index]!.id,
          responseBody: "response body",
        },
      });
      expect(request.options?.timeout).toBe(45000);
      expect(request.options?.onRequestComplete).toEqual(expect.any(Function));
    }
  });

  test("logs an ingested step before a later step finishes", async () => {
    const nextStep: Deferred<ProbeMonitorResponse | null> =
      deferred<ProbeMonitorResponse | null>();
    stepSpy.mockImplementationOnce(async (data: ProbeStepInput) => {
      return makeResponse(data);
    });
    stepSpy.mockReturnValueOnce(nextStep.promise);

    let completed: boolean = false;
    const run: Promise<void> = MonitorUtil.probeMonitor(makeMonitor()).then(
      () => {
        completed = true;
      },
    );
    await flushMicrotasks();

    expect(completed).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ responseBody: "response body" }),
    );

    nextStep.resolve(null);
    await run;
    expect(completed).toBe(true);
  });

  test("awaits ingestion before logging or starting the following step", async () => {
    const ingest: Deferred<never> = deferred<never>();
    fetchSpy.mockReturnValueOnce(ingest.promise);
    const run: Promise<void> = MonitorUtil.probeMonitor(makeMonitor());
    await flushMicrotasks();

    expect(stepSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalledWith("Probed monitor step:");

    ingest.resolve({ data: {} } as never);
    await run;
    expect(stepSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test("null step responses are not ingested and do not block later steps", async () => {
    stepSpy.mockResolvedValueOnce(null);

    await expect(
      MonitorUtil.probeMonitor(makeMonitor()),
    ).resolves.toBeUndefined();

    expect(stepSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(null);
  });

  test.each(["missing", "empty"])(
    "a monitor with %s steps returns no payload",
    async (scenario: string) => {
      const monitor: Monitor = makeMonitor(0);
      if (scenario === "missing") {
        delete monitor.monitorSteps;
      }

      await expect(MonitorUtil.probeMonitor(monitor)).resolves.toBeUndefined();

      expect(stepSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  test("skips missing step entries while ingesting the remaining steps", async () => {
    const monitor: Monitor = makeMonitor(1);
    monitor.monitorSteps!.data!.monitorStepsInstanceArray.unshift(
      null as unknown as MonitorStep,
    );

    await MonitorUtil.probeMonitor(monitor);

    expect(stepSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("reports a thrown check as offline and continues through later steps", async () => {
    const monitor: Monitor = makeMonitor();
    stepSpy.mockRejectedValueOnce(new Error("check failed"));

    await expect(MonitorUtil.probeMonitor(monitor)).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0]![0].data).toMatchObject({
      probeMonitorResponse: {
        monitorId: monitor.id,
        isOnline: false,
        failureCause: "check failed",
      },
    });
    expect(fetchSpy.mock.calls[1]![0].data).toMatchObject({
      probeMonitorResponse: { isOnline: true },
    });
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error));
  });

  test("propagates an ingest failure and does not start further steps", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ingest unavailable"));

    await expect(MonitorUtil.probeMonitor(makeMonitor())).rejects.toThrow(
      "ingest unavailable",
    );

    expect(stepSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).not.toHaveBeenCalledWith("Probed monitor step:");
  });

  test("keeps monitor and project context around checking and ingesting", async () => {
    const monitor: Monitor = makeMonitor(1);
    // eslint-disable-next-line @typescript-eslint/typedef
    const contextSpy = jest.spyOn(TelemetryContext, "runWithContext");

    await MonitorUtil.probeMonitor(monitor);

    expect(contextSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: monitor.id!.toString(),
        projectId: monitor.projectId!.toString(),
        monitorType: MonitorType.Website,
      }),
      expect.any(Function),
    );
  });

  test("a large batch of multi-step checks returns only completion signals", async () => {
    const monitorCount: number = 100;
    const stepsPerMonitor: number = 4;
    stepSpy.mockImplementation(async (data: ProbeStepInput) => {
      return {
        ...makeResponse(data),
        responseBody: data.monitorId.toString() + "x".repeat(64 * 1024),
      };
    });

    const completions: Array<void> = await Promise.all(
      Array.from({ length: monitorCount }, () => {
        return MonitorUtil.probeMonitor(makeMonitor(stepsPerMonitor));
      }),
    );

    /*
     * Completed promises must not keep 400 bodies alive in the worker's
     * pending batch while a different check waits for its deadline.
     */
    expect(completions).toEqual(Array.from({ length: monitorCount }));
    expect(fetchSpy).toHaveBeenCalledTimes(monitorCount * stepsPerMonitor);
    expect(stepSpy).toHaveBeenCalledTimes(monitorCount * stepsPerMonitor);
  });

  test("interactive monitor tests still return their original results", async () => {
    const monitor: Monitor = makeMonitor();
    stepSpy.mockResolvedValueOnce(null);

    const results: Array<ProbeMonitorResponse | null> =
      await MonitorUtil.probeMonitorTest(monitor as unknown as MonitorTest);

    expect(results).toEqual([
      null,
      expect.objectContaining({ responseBody: "response body" }),
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0].url.toString()).toContain(
      "/probe/response/monitor-test-ingest/" + monitor.id!.toString(),
    );
  });
});
