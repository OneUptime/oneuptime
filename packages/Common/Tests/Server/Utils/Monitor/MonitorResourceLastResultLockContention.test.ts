/*
 * OneUptime issue #7194: a probe's result whose stored copy cannot be written
 * because another writer holds the monitor probe's row.
 *
 * monitorResource stores each probe result as its MonitorProbe row's
 * lastMonitoringLog before judging it. That UPDATE waits for the row like any
 * other, and on a busy database it waited past lock_timeout ("canceling
 * statement due to lock timeout") or lost a deadlock - and the error failed
 * the whole job. The queue then ran the job again from the start, twice, on
 * the database that was already too busy, and the telemetry queue fell
 * further behind.
 *
 * The stored copy is a cache of the probe's last result - its next result is
 * stored over it - so a write lost to another writer's lock costs only that
 * copy: the result is still judged, its metrics still saved. Any other failure
 * is still thrown, as before.
 *
 * Everything heavy is mocked BEFORE importing MonitorResource, as in
 * MonitorResourceReportingProbe.test.ts.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import logger from "../../../../Server/Utils/Logger";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const findMonitorMock: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;

const updateMonitorColumnsMock: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

const findMonitorProbesMock: jest.Mock =
  MonitorProbeService.findBy as unknown as jest.Mock;

const updateMonitorProbeColumnsMock: jest.Mock =
  MonitorProbeService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;

const saveMetricsMock: jest.Mock =
  MonitorMetricUtil.saveMonitorMetrics as unknown as jest.Mock;

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

const warnMock: jest.Mock = logger.warn as unknown as jest.Mock;

const PROBE_ID: ObjectID = new ObjectID("0d4b1e3a-6c2f-4e8d-9a71-3f5b2c8e4d10");

type PostgresFailure = Error & {
  code?: string | undefined;
  driverError?: { code?: string | undefined } | undefined;
  postgresErrorCode?: string | undefined;
};

/*
 * A failed statement as each layer hands it on: pg's own error (code), the
 * QueryFailedError TypeORM wraps it in (code copied, and driverError), or an
 * exception that kept only the driver's error.
 */
function failure(
  message: string,
  code: string,
  shape: "pg" | "typeorm" | "driverErrorOnly",
): PostgresFailure {
  const error: PostgresFailure = new Error(message);

  if (shape === "pg" || shape === "typeorm") {
    error.code = code;
  }

  if (shape === "typeorm" || shape === "driverErrorOnly") {
    error.driverError = { code: code };
  }

  return error;
}

function makeStep(): MonitorStep {
  const criteriaInstance: MonitorCriteriaInstance =
    new MonitorCriteriaInstance();
  criteriaInstance.data!.name = "Is Online";

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [criteriaInstance],
  };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  return step;
}

function makeMonitor(step: MonitorStep): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = MonitorType.Website;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ObjectID.generate();

  return monitor;
}

function makeMonitorProbe(): MonitorProbe {
  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.probeId = PROBE_ID;
  monitorProbe.isEnabled = true;
  monitorProbe.lastMonitoringLog = {};

  return monitorProbe;
}

function makeResult(monitor: Monitor, step: MonitorStep): ProbeMonitorResponse {
  return {
    projectId: monitor.projectId!,
    monitorId: monitor.id!,
    monitorStepId: step.id,
    probeId: PROBE_ID,
    isOnline: false,
    responseTimeInMs: 99999,
    failureCause: "Connection refused",
    monitoredAt: OneUptimeDate.getCurrentDate(),
  } as unknown as ProbeMonitorResponse;
}

function warnings(): Array<string> {
  return warnMock.mock.calls.map((call: Array<unknown>) => {
    return String(call[0]);
  });
}

describe("MonitorResourceUtil.monitorResource when the probe's last result cannot be stored (issue #7194)", () => {
  let step: MonitorStep;
  let monitor: Monitor;
  let monitorProbe: MonitorProbe;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    lockMock.mockResolvedValue({});
    updateMonitorProbeColumnsMock.mockResolvedValue(undefined);
    updateMonitorColumnsMock.mockResolvedValue(undefined);
    saveMetricsMock.mockResolvedValue(undefined);

    // No criteria met: nothing past the probe log and payload writes runs.
    processMonitorStepMock.mockImplementation(
      (input: {
        probeApiIngestResponse: ProbeApiIngestResponse;
      }): Promise<ProbeApiIngestResponse> => {
        return Promise.resolve({
          ...input.probeApiIngestResponse,
          criteriaMetId: undefined,
          rootCause: null,
        });
      },
    );

    // Agreement is covered elsewhere; pass this probe's verdict through.
    jest
      .spyOn(MonitorResourceUtil as any, "checkProbeAgreement")
      .mockImplementation((input: any) => {
        return Promise.resolve({
          hasAgreement: true,
          agreementCount: 1,
          requiredCount: 1,
          totalActiveProbes: 1,
          agreedCriteriaId: input.currentCriteriaMetId,
          agreedRootCause: input.currentRootCause,
          agreedProbeNames: [],
        });
      });

    step = makeStep();
    monitor = makeMonitor(step);
    monitorProbe = makeMonitorProbe();
    findMonitorMock.mockResolvedValue(monitor);
    findMonitorProbesMock.mockResolvedValue([monitorProbe]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    ["a lock timeout, as pg reports it", "pg", "55P03"],
    ["a lock timeout, as TypeORM wraps it", "typeorm", "55P03"],
    [
      "a lock timeout, with only the driver's error",
      "driverErrorOnly",
      "55P03",
    ],
    ["a deadlock, as pg reports it", "pg", "40P01"],
    ["a deadlock, as TypeORM wraps it", "typeorm", "40P01"],
  ] as Array<[string, "pg" | "typeorm" | "driverErrorOnly", string]>)(
    "%s costs the stored copy only: the result is still judged and its metrics saved",
    async (
      _label: string,
      shape: "pg" | "typeorm" | "driverErrorOnly",
      code: string,
    ) => {
      updateMonitorProbeColumnsMock.mockRejectedValueOnce(
        failure("canceling statement due to lock timeout", code, shape),
      );

      await expect(
        MonitorResourceUtil.monitorResource(makeResult(monitor, step), {
          reportingProbeId: PROBE_ID,
        }),
      ).resolves.toBeDefined();

      expect(updateMonitorProbeColumnsMock).toHaveBeenCalledTimes(1);
      expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
      expect(saveMetricsMock).toHaveBeenCalledTimes(1);

      // Said once, naming the monitor and the probe.
      const said: Array<string> = warnings().filter((line: string) => {
        return line.includes("not stored as its last result");
      });

      expect(said).toHaveLength(1);
      expect(said[0]).toContain(monitor.id!.toString());
      expect(said[0]).toContain(PROBE_ID.toString());
    },
  );

  /*
   * The evaluation that follows reads the monitor's probe rows from memory
   * (checkProbeAgreement reuses them) - it still sees this result, as it
   * would have had the write landed.
   */
  test("the result the write could not store is still the one the evaluation reads back", async () => {
    updateMonitorProbeColumnsMock.mockRejectedValueOnce(
      failure("canceling statement due to lock timeout", "55P03", "typeorm"),
    );

    await MonitorResourceUtil.monitorResource(makeResult(monitor, step), {
      reportingProbeId: PROBE_ID,
    });

    const stored: unknown = (
      monitorProbe.lastMonitoringLog as Record<string, unknown>
    )[step.id.toString()];

    expect(stored).toBeDefined();
    expect((stored as { failureCause?: string }).failureCause).toBe(
      "Connection refused",
    );
  });

  test.each([
    ["a dropped connection", failure("Connection terminated", "57P01", "pg")],
    [
      "a statement timeout",
      failure("canceling statement due to statement timeout", "57014", "pg"),
    ],
    ["an error with no code at all", new Error("connection reset")],
  ] as Array<[string, Error]>)(
    "%s is still thrown, as before",
    async (_label: string, error: Error) => {
      updateMonitorProbeColumnsMock.mockRejectedValueOnce(error);

      await expect(
        MonitorResourceUtil.monitorResource(makeResult(monitor, step), {
          reportingProbeId: PROBE_ID,
        }),
      ).rejects.toThrow(error.message);

      expect(
        warnings().some((line: string) => {
          return line.includes("not stored as its last result");
        }),
      ).toBe(false);
      // The per-monitor lock is still given back.
      expect(Semaphore.release).toHaveBeenCalled();
    },
  );

  test("a write that lands says nothing", async () => {
    await MonitorResourceUtil.monitorResource(makeResult(monitor, step), {
      reportingProbeId: PROBE_ID,
    });

    expect(updateMonitorProbeColumnsMock).toHaveBeenCalledTimes(1);
    expect(
      warnings().some((line: string) => {
        return line.includes("not stored as its last result");
      }),
    ).toBe(false);
  });
});
