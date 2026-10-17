/*
 * A check result a probe reported, through MonitorResourceUtil.monitorResource.
 *
 * Probe ingest hands monitorResource the probe that sent a result, as it
 * authenticated (reportingProbeId). The result is then that probe's own:
 *
 *   - one that names another probe is refused before anything is read;
 *   - one for a monitor type probes do not check (a heartbeat, an incoming
 *     request, a telemetry or network device monitor...) is refused before
 *     the monitor is locked, measured, judged or written;
 *   - one from a probe the monitor is not assigned to is refused before its
 *     stored probe results, metrics, logs or criteria are touched;
 *   - one from an assigned probe is stored under that probe's own row and
 *     judged as before.
 *
 * Results OneUptime builds itself - a device poll or a trap fanned out to
 * the monitors watching a device, a heartbeat - pass no reportingProbeId
 * and are processed exactly as before.
 *
 * Everything heavy is mocked BEFORE importing MonitorResource, as in
 * MonitorResourceStorablePayload.test.ts: the criteria evaluator (native
 * isolated-vm), the monitor and monitor probe services (Postgres), the
 * per-monitor semaphore (Redis), the metric and log utils (ClickHouse) and
 * the logger.
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
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import { PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE } from "../../../../Server/Utils/Probe/ProbeReportIdentity";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../../Models/DatabaseModels/MonitorProbe";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

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

const saveLogMock: jest.Mock =
  MonitorLogUtil.saveMonitorLog as unknown as jest.Mock;

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

// The probe that sent the result, and two others.
const SENDER: ObjectID = new ObjectID("0d4b1e3a-6c2f-4e8d-9a71-3f5b2c8e4d10");
const GLOBAL_PROBE: ObjectID = new ObjectID(
  "5e8c7a1d-2b4f-4c69-8d3e-1a0f9b7c6e21",
);
const OTHER_PROJECT_PROBE: ObjectID = new ObjectID(
  "9b3d5f7e-1c2a-4e6b-8f0d-2c4e6a8b0d32",
);

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

function makeMonitor(monitorType: MonitorType, step: MonitorStep): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = monitorType;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ObjectID.generate();

  return monitor;
}

function makeMonitorProbe(probeId: ObjectID): MonitorProbe {
  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.probeId = probeId;
  monitorProbe.isEnabled = true;
  monitorProbe.lastMonitoringLog = {};

  return monitorProbe;
}

function makeResult(input: {
  monitor: Monitor;
  step: MonitorStep;
  probeId?: ObjectID | string | undefined;
}): ProbeMonitorResponse {
  const result: Record<string, unknown> = {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    monitorStepId: input.step.id,
    isOnline: false,
    responseTimeInMs: 99999,
    failureCause: "Connection refused",
    monitoredAt: OneUptimeDate.getCurrentDate(),
  };

  if (input.probeId !== undefined) {
    result["probeId"] = input.probeId;
  }

  return result as unknown as ProbeMonitorResponse;
}

// What monitorResource wrote to MonitorProbe.lastMonitoringLog, and where.
function storedProbeLog(): { rowId: string; log: MonitorStepProbeResponse } {
  expect(updateMonitorProbeColumnsMock).toHaveBeenCalledTimes(1);

  const write: { id: ObjectID; data: { lastMonitoringLog: unknown } } =
    updateMonitorProbeColumnsMock.mock.calls[0]![0] as {
      id: ObjectID;
      data: { lastMonitoringLog: unknown };
    };

  return {
    rowId: write.id.toString(),
    log: write.data.lastMonitoringLog as MonitorStepProbeResponse,
  };
}

// Nothing a refused result could have changed was touched.
function expectNothingTouched(): void {
  expect(updateMonitorProbeColumnsMock).not.toHaveBeenCalled();
  expect(updateMonitorColumnsMock).not.toHaveBeenCalled();
  expect(saveMetricsMock).not.toHaveBeenCalled();
  expect(saveLogMock).not.toHaveBeenCalled();
  expect(processMonitorStepMock).not.toHaveBeenCalled();
}

const NOT_ASSIGNED: BadDataException = new BadDataException(
  ExceptionMessages.ProbeNotAssignedToMonitor,
);

describe("MonitorResourceUtil.monitorResource with the probe that reported the result", () => {
  let step: MonitorStep;
  let monitor: Monitor;

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
    monitor = makeMonitor(MonitorType.Website, step);
    findMonitorMock.mockResolvedValue(monitor);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a result from a probe assigned to the monitor is stored under that probe's own row", async () => {
    const senderRow: MonitorProbe = makeMonitorProbe(SENDER);
    findMonitorProbesMock.mockResolvedValue([
      makeMonitorProbe(GLOBAL_PROBE),
      senderRow,
    ]);

    await MonitorResourceUtil.monitorResource(
      makeResult({ monitor, step, probeId: SENDER }),
      { reportingProbeId: SENDER },
    );

    const stored: { rowId: string; log: MonitorStepProbeResponse } =
      storedProbeLog();

    expect(stored.rowId).toBe(senderRow.id!.toString());
    // The stored copy is JSON: the sender's id as JSON writes an ObjectID.
    expect(
      (stored.log[step.id.toString()] as ProbeMonitorResponse).probeId,
    ).toEqual(JSON.parse(JSON.stringify(SENDER)));
    expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
    expect(saveMetricsMock).toHaveBeenCalledTimes(1);
  });

  test("a result that names no probe is the reporting probe's", async () => {
    const senderRow: MonitorProbe = makeMonitorProbe(SENDER);
    findMonitorProbesMock.mockResolvedValue([
      makeMonitorProbe(GLOBAL_PROBE),
      senderRow,
    ]);

    const result: ProbeMonitorResponse = makeResult({ monitor, step });

    await MonitorResourceUtil.monitorResource(result, {
      reportingProbeId: SENDER,
    });

    expect(result.probeId.toString()).toBe(SENDER.toString());
    expect(storedProbeLog().rowId).toBe(senderRow.id!.toString());
  });

  test("a result that names another probe is refused before anything is read", async () => {
    findMonitorProbesMock.mockResolvedValue([
      makeMonitorProbe(GLOBAL_PROBE),
      makeMonitorProbe(SENDER),
    ]);

    await expect(
      MonitorResourceUtil.monitorResource(
        makeResult({ monitor, step, probeId: GLOBAL_PROBE }),
        { reportingProbeId: SENDER },
      ),
    ).rejects.toThrow(
      new BadDataException(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE),
    );

    expect(findMonitorMock).not.toHaveBeenCalled();
    expect(lockMock).not.toHaveBeenCalled();
    expectNothingTouched();
  });

  test("a result from a probe the monitor is not assigned to changes nothing", async () => {
    findMonitorProbesMock.mockResolvedValue([
      makeMonitorProbe(GLOBAL_PROBE),
      makeMonitorProbe(OTHER_PROJECT_PROBE),
    ]);

    for (const named of [SENDER, undefined]) {
      await expect(
        MonitorResourceUtil.monitorResource(
          makeResult({ monitor, step, probeId: named }),
          { reportingProbeId: SENDER },
        ),
      ).rejects.toThrow(NOT_ASSIGNED);
    }

    expectNothingTouched();
    // The lock taken to read the rows is given back.
    expect(Semaphore.release).toHaveBeenCalled();
  });

  test("a monitor with no probes at all takes no probe's result", async () => {
    findMonitorProbesMock.mockResolvedValue([]);

    await expect(
      MonitorResourceUtil.monitorResource(makeResult({ monitor, step }), {
        reportingProbeId: SENDER,
      }),
    ).rejects.toThrow(NOT_ASSIGNED);

    expectNothingTouched();
  });

  test("the probe is matched whatever case its id arrived in", async () => {
    const senderRow: MonitorProbe = makeMonitorProbe(SENDER);
    findMonitorProbesMock.mockResolvedValue([senderRow]);

    const shouted: ObjectID = new ObjectID(SENDER.toString().toUpperCase());

    await MonitorResourceUtil.monitorResource(
      makeResult({ monitor, step, probeId: shouted }),
      { reportingProbeId: shouted },
    );

    expect(storedProbeLog().rowId).toBe(senderRow.id!.toString());
  });

  test("every monitor type probes check takes the result of an assigned probe", async () => {
    const probedTypes: Array<MonitorType> = Object.values(MonitorType).filter(
      (monitorType: MonitorType) => {
        return MonitorTypeHelper.isProbableMonitor(monitorType);
      },
    );

    expect(probedTypes).toContain(MonitorType.Website);
    expect(probedTypes).toContain(MonitorType.Ping);

    for (const monitorType of probedTypes) {
      jest.clearAllMocks();
      lockMock.mockResolvedValue({});

      const typedMonitor: Monitor = makeMonitor(monitorType, step);
      findMonitorMock.mockResolvedValue(typedMonitor);
      findMonitorProbesMock.mockResolvedValue([makeMonitorProbe(SENDER)]);

      await MonitorResourceUtil.monitorResource(
        makeResult({ monitor: typedMonitor, step, probeId: SENDER }),
        { reportingProbeId: SENDER },
      );

      expect(updateMonitorProbeColumnsMock).toHaveBeenCalledTimes(1);
    }
  });

  test("a monitor type probes do not check takes no probe's result, before it is locked", async () => {
    const unprobedTypes: Array<MonitorType> = Object.values(
      MonitorType,
    ).filter((monitorType: MonitorType) => {
      return !MonitorTypeHelper.isProbableMonitor(monitorType);
    });

    expect(unprobedTypes).toContain(MonitorType.IncomingRequest);
    expect(unprobedTypes).toContain(MonitorType.Server);
    expect(unprobedTypes).toContain(MonitorType.NetworkDevice);

    for (const monitorType of unprobedTypes) {
      jest.clearAllMocks();

      const typedMonitor: Monitor = makeMonitor(monitorType, step);
      findMonitorMock.mockResolvedValue(typedMonitor);
      // Even a probe row someone made through the API for it is not enough.
      findMonitorProbesMock.mockResolvedValue([makeMonitorProbe(SENDER)]);

      const result: DataToProcess = {
        ...makeResult({ monitor: typedMonitor, step, probeId: SENDER }),
        // What an incoming request or a server heartbeat stores.
        incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
        requestReceivedAt: OneUptimeDate.getCurrentDate(),
      } as unknown as DataToProcess;

      await expect(
        MonitorResourceUtil.monitorResource(result, {
          reportingProbeId: SENDER,
        }),
      ).rejects.toThrow(NOT_ASSIGNED);

      expect(lockMock).not.toHaveBeenCalled();
      expectNothingTouched();
    }
  });
});

describe("MonitorResourceUtil.monitorResource with results OneUptime builds itself", () => {
  let step: MonitorStep;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    lockMock.mockResolvedValue({});
    updateMonitorProbeColumnsMock.mockResolvedValue(undefined);
    updateMonitorColumnsMock.mockResolvedValue(undefined);
    saveMetricsMock.mockResolvedValue(undefined);

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

    step = makeStep();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a device poll fanned out to a Network Device monitor is judged as before", async () => {
    // NetworkDeviceWalkUtil names the polling probe; the device was its own.
    const monitor: Monitor = makeMonitor(MonitorType.NetworkDevice, step);
    findMonitorMock.mockResolvedValue(monitor);

    await MonitorResourceUtil.monitorResource(
      makeResult({ monitor, step, probeId: SENDER }),
    );

    expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
    expect(saveMetricsMock).toHaveBeenCalledTimes(1);
    // Network Device monitors have no probe rows to read or write.
    expect(findMonitorProbesMock).not.toHaveBeenCalled();
    expect(updateMonitorProbeColumnsMock).not.toHaveBeenCalled();
  });

  test("an incoming request is stored as the monitor's last request, as before", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.IncomingRequest, step);
    findMonitorMock.mockResolvedValue(monitor);

    const request: IncomingMonitorRequest = {
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      requestHeaders: {},
      requestBody: { status: "ok" },
      requestMethod: "POST",
      incomingRequestReceivedAt: OneUptimeDate.getCurrentDate(),
      checkedAt: OneUptimeDate.getCurrentDate(),
    } as unknown as IncomingMonitorRequest;

    await MonitorResourceUtil.monitorResource(request);

    expect(updateMonitorColumnsMock).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        (updateMonitorColumnsMock.mock.calls[0]![0] as { data: object }).data,
      ),
    ).toContain("incomingMonitorRequest");
  });

  test("a probe result passed on without a reporting probe keeps the old check: the named probe must be assigned", async () => {
    const monitor: Monitor = makeMonitor(MonitorType.Website, step);
    findMonitorMock.mockResolvedValue(monitor);
    findMonitorProbesMock.mockResolvedValue([makeMonitorProbe(GLOBAL_PROBE)]);

    await expect(
      MonitorResourceUtil.monitorResource(
        makeResult({ monitor, step, probeId: SENDER }),
      ),
    ).rejects.toThrow(NOT_ASSIGNED);

    expect(updateMonitorProbeColumnsMock).not.toHaveBeenCalled();
  });
});
