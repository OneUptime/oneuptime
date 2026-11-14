/*
 * What a probe's check result does with the monitor's MonitorProbe rows, in
 * MonitorResourceUtil.monitorResource: one statement
 * (MonitorProbeLastResults.storeResultAndReadProbes) that stores the result
 * as the probe's last for the step it reported and reads the monitor's
 * probes - and of the other probes' lastMonitoringLog, only the step judged.
 *
 * Pinned here:
 *
 *   - one statement per result, and no other read of the rows;
 *   - the step stored is the step the probe reported; the step read of the
 *     others is the step the result is judged against (the first step, for
 *     a step deleted since the probe was handed the check);
 *   - probe agreement judges the other probes' last result of that step,
 *     and this result for the probe that reported it;
 *   - an SNMP trap stores nothing and reads no probe's result.
 *
 * The statement itself runs against Postgres in
 * MonitorProbeLastResultsPostgres.test.ts; here the rows are in memory
 * (MonitorProbeRowsInMemory answers as it does). The criteria evaluator, the
 * monitor service, the lock and the metric and log writers are mocked.
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

jest.mock("../../../../Server/Utils/Monitor/MonitorProbeLastResults", () => {
  return {
    __esModule: true,
    default: {
      storeResultAndReadProbes: jest.fn(),
      readProbes: jest.fn(),
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
import MonitorProbeLastResults from "../../../../Server/Utils/Monitor/MonitorProbeLastResults";
import MonitorService from "../../../../Server/Services/MonitorService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../../Models/DatabaseModels/Probe";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import MonitorProbeRowsInMemory from "../../TestingUtils/MonitorProbeRowsInMemory";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorDependencySuppression from "../../../../Server/Utils/Monitor/MonitorDependencySuppression";
import MonitorMaintenanceSuppression from "../../../../Server/Utils/Monitor/MonitorMaintenanceSuppression";
import MonitorStatusTimelineUtil from "../../../../Server/Utils/Monitor/MonitorStatusTimeline";
import MonitorSummaryCapture from "../../../../Server/Utils/Monitor/MonitorSummaryCapture";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const storeAndReadMock: jest.Mock =
  MonitorProbeLastResults.storeResultAndReadProbes as unknown as jest.Mock;

const readProbesMock: jest.Mock =
  MonitorProbeLastResults.readProbes as unknown as jest.Mock;

// What each probe's check says: the criteria it meets, by name.
const UP: string = "Up";
const DOWN: string = "Down";

function makeStep(): MonitorStep {
  const criteria: Array<MonitorCriteriaInstance> = [DOWN, UP].map(
    (name: string) => {
      const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
      instance.data!.id = `${name}-${ObjectID.generate().toString()}`;
      instance.data!.name = name;
      return instance;
    },
  );

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: criteria };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;
  return step;
}

function criteriaId(step: MonitorStep, name: string): string {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.find(
    (instance: MonitorCriteriaInstance) => {
      return instance.data?.name === name;
    },
  )!.data!.id;
}

function makeMonitor(steps: Array<MonitorStep>): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
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

function makeRow(data: {
  name: string;
  isEnabled?: boolean;
  connectionStatus?: ProbeConnectionStatus;
  lastMonitoringLog?: MonitorStepProbeResponse;
}): MonitorProbe {
  const probe: Probe = new Probe();
  probe.name = data.name;
  probe.connectionStatus =
    data.connectionStatus || ProbeConnectionStatus.Connected;

  const row: MonitorProbe = new MonitorProbe();
  row.id = ObjectID.generate();
  row.probeId = ObjectID.generate();
  row.isEnabled = data.isEnabled === undefined ? true : data.isEnabled;
  row.probe = probe;
  row.lastMonitoringLog = data.lastMonitoringLog || {};
  return row;
}

function check(data: {
  monitor: Monitor;
  probeId: ObjectID;
  stepId: ObjectID;
  verdict: string;
  body?: string;
}): ProbeMonitorResponse {
  return {
    projectId: data.monitor.projectId!,
    monitorId: data.monitor.id!,
    probeId: data.probeId,
    monitorStepId: data.stepId,
    isOnline: data.verdict === UP,
    responseCode: data.verdict === UP ? 200 : 503,
    responseBody: data.body || "",
    failureCause: data.verdict === UP ? "" : "503",
    monitoredAt: OneUptimeDate.getCurrentDate(),
    verdict: data.verdict,
  } as unknown as ProbeMonitorResponse;
}

// A check as lastMonitoringLog holds it: JSON.
function stored(result: ProbeMonitorResponse): ProbeMonitorResponse {
  return JSON.parse(JSON.stringify(result)) as ProbeMonitorResponse;
}

describe("MonitorResourceUtil.monitorResource and the monitor's probe rows", () => {
  let probeRows: MonitorProbeRowsInMemory;
  let stepOne: MonitorStep;
  let stepTwo: MonitorStep;
  let monitor: Monitor;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
    jest.spyOn(ProjectService, "isSampleProject").mockResolvedValue(false);
    (Semaphore.lock as jest.Mock).mockResolvedValue({} as never);

    probeRows = new MonitorProbeRowsInMemory();
    probeRows.install();

    stepOne = makeStep();
    stepTwo = makeStep();
    monitor = makeMonitor([stepOne, stepTwo]);
    (MonitorService.findOneById as jest.Mock).mockResolvedValue(
      monitor as never,
    );

    // Each check meets the criteria its verdict names, of the step judged.
    processMonitorStepMock.mockImplementation((async (input: {
      dataToProcess: JSONObject;
      monitorStep: MonitorStep;
      probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> => {
      return {
        ...input.probeApiIngestResponse,
        criteriaMetId: criteriaId(
          input.monitorStep,
          String(input.dataToProcess["verdict"]),
        ),
        rootCause: `It is ${String(input.dataToProcess["verdict"])}.`,
      };
    }) as never);

    // Past agreement: the status change and records are not what this is about.
    jest
      .spyOn(MonitorResourceUtil, "refreshCurrentMonitorStatus")
      .mockResolvedValue(undefined);
    jest
      .spyOn(MonitorStatusTimelineUtil, "updateMonitorStatusTimeline")
      .mockResolvedValue(null as never);
    jest
      .spyOn(MonitorIncident, "checkOpenIncidentsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    jest
      .spyOn(MonitorAlert, "checkOpenAlertsAndCloseIfResolved")
      .mockResolvedValue([] as never);
    jest
      .spyOn(
        MonitorIncident,
        "criteriaMetCreateIncidentsAndUpdateMonitorStatus",
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorAlert, "criteriaMetCreateAlertsAndUpdateMonitorStatus")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(MonitorMaintenanceSuppression, "getMaintenanceSuppression")
      .mockResolvedValue({
        suppressedSeriesFingerprints: new Set<string>(),
        suppressingDatabaseServerIds: [],
      } as never);
    jest
      .spyOn(MonitorDependencySuppression, "getDependencySuppression")
      .mockResolvedValue({ isSuppressed: false } as never);
    jest
      .spyOn(MonitorSummaryCapture, "capture")
      .mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one statement stores the result and reads the probes; nothing else reads the rows", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    probeRows.set([reporting, makeRow({ name: "Virginia" })]);

    await MonitorResourceUtil.monitorResource(
      check({
        monitor,
        probeId: reporting.probeId!,
        stepId: stepOne.id,
        verdict: UP,
      }),
      { reportingProbeId: reporting.probeId! },
    );

    expect(storeAndReadMock).toHaveBeenCalledTimes(1);
    expect(readProbesMock).not.toHaveBeenCalled();
  });

  test("the result is stored under the step it ran, as a storable copy stamped when it arrived", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    probeRows.set([reporting]);

    await MonitorResourceUtil.monitorResource(
      check({
        monitor,
        probeId: reporting.probeId!,
        stepId: stepTwo.id,
        verdict: UP,
        body: "ok\u0000",
      }),
      { reportingProbeId: reporting.probeId! },
    );

    const input: {
      reportedStepId: string;
      judgedStepId: string;
      result: JSONObject;
      monitorId: ObjectID;
    } = storeAndReadMock.mock.calls[0]![0] as {
      reportedStepId: string;
      judgedStepId: string;
      result: JSONObject;
      monitorId: ObjectID;
    };

    expect(input.monitorId.toString()).toBe(monitor.id!.toString());
    expect(input.reportedStepId).toBe(stepTwo.id.toString());
    expect(input.judgedStepId).toBe(stepTwo.id.toString());
    expect(input.result["responseBody"]).toBe("ok�");
    expect(input.result["monitoredAt"]).toBeInstanceOf(Date);
    expect(probeRows.stored).toHaveLength(1);
    expect(probeRows.stored[0]!.rowId).toBe(reporting.id!.toString());
  });

  test("a step deleted since the probe was handed the check is stored as reported, and the first step judged", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    probeRows.set([reporting]);

    const deletedStepId: ObjectID = ObjectID.generate();

    await MonitorResourceUtil.monitorResource(
      check({
        monitor,
        probeId: reporting.probeId!,
        stepId: deletedStepId,
        verdict: UP,
      }),
      { reportingProbeId: reporting.probeId! },
    );

    const input: { reportedStepId: string; judgedStepId: string } =
      storeAndReadMock.mock.calls[0]![0] as {
        reportedStepId: string;
        judgedStepId: string;
      };

    expect(input.reportedStepId).toBe(deletedStepId.toString());
    expect(input.judgedStepId).toBe(stepOne.id.toString());
  });

  test("probe agreement judges the others' last result of the step judged, and this result for its probe", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    const peerDown: MonitorProbe = makeRow({ name: "Virginia" });
    const peerUp: MonitorProbe = makeRow({ name: "Singapore" });

    peerDown.lastMonitoringLog = {
      [stepOne.id.toString()]: stored(
        check({
          monitor,
          probeId: peerDown.probeId!,
          stepId: stepOne.id,
          verdict: DOWN,
        }),
      ),
      // Another step's result is never read for this one.
      [stepTwo.id.toString()]: stored(
        check({
          monitor,
          probeId: peerDown.probeId!,
          stepId: stepTwo.id,
          verdict: UP,
        }),
      ),
    };

    peerUp.lastMonitoringLog = {
      [stepOne.id.toString()]: stored(
        check({
          monitor,
          probeId: peerUp.probeId!,
          stepId: stepOne.id,
          verdict: UP,
        }),
      ),
    };

    probeRows.set([reporting, peerDown, peerUp]);

    const agreement: jest.SpiedFunction<() => unknown> = jest.spyOn(
      MonitorResourceUtil as never,
      "checkProbeAgreement",
    );

    // Two of three must agree: Frankfurt and Virginia say Down.
    monitor.minimumProbeAgreement = 2;

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check({
          monitor,
          probeId: reporting.probeId!,
          stepId: stepOne.id,
          verdict: DOWN,
        }),
        { reportingProbeId: reporting.probeId! },
      );

    const probesJudged: Array<MonitorProbe> = (
      agreement.mock.calls[0]![0] as unknown as {
        monitorProbes: Array<MonitorProbe>;
      }
    ).monitorProbes;

    const byProbe: (row: MonitorProbe) => MonitorProbe = (
      row: MonitorProbe,
    ): MonitorProbe => {
      return probesJudged.find((probe: MonitorProbe) => {
        return probe.probeId!.toString() === row.probeId!.toString();
      })!;
    };

    // The others: the step judged, and nothing else of their column.
    expect(Object.keys(byProbe(peerDown).lastMonitoringLog!)).toEqual([
      stepOne.id.toString(),
    ]);
    expect(
      (
        byProbe(peerDown).lastMonitoringLog![
          stepOne.id.toString()
        ] as unknown as JSONObject
      )["verdict"],
    ).toBe(DOWN);

    // The reporting probe: this result.
    expect(
      (
        byProbe(reporting).lastMonitoringLog![
          stepOne.id.toString()
        ] as unknown as JSONObject
      )["verdict"],
    ).toBe(DOWN);
    expect(byProbe(reporting).probe?.name).toBe("Frankfurt");

    expect(response.criteriaMetId).toBe(criteriaId(stepOne, DOWN));
    expect(response.rootCause).toContain("Frankfurt");
    expect(response.rootCause).toContain("Virginia");
  });

  test("a disabled or disconnected probe's result is not read, and does not count", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    const disabled: MonitorProbe = makeRow({
      name: "Disabled",
      isEnabled: false,
    });
    const disconnected: MonitorProbe = makeRow({
      name: "Disconnected",
      connectionStatus: ProbeConnectionStatus.Disconnected,
    });

    for (const row of [disabled, disconnected]) {
      row.lastMonitoringLog = {
        [stepOne.id.toString()]: stored(
          check({
            monitor,
            probeId: row.probeId!,
            stepId: stepOne.id,
            verdict: UP,
          }),
        ),
      };
    }

    probeRows.set([reporting, disabled, disconnected]);

    const agreement: jest.SpiedFunction<() => unknown> = jest.spyOn(
      MonitorResourceUtil as never,
      "checkProbeAgreement",
    );

    const response: ProbeApiIngestResponse =
      await MonitorResourceUtil.monitorResource(
        check({
          monitor,
          probeId: reporting.probeId!,
          stepId: stepOne.id,
          verdict: DOWN,
        }),
        { reportingProbeId: reporting.probeId! },
      );

    const probesJudged: Array<MonitorProbe> = (
      agreement.mock.calls[0]![0] as unknown as {
        monitorProbes: Array<MonitorProbe>;
      }
    ).monitorProbes;

    for (const probe of probesJudged) {
      if (probe.probeId!.toString() !== reporting.probeId!.toString()) {
        expect(probe.lastMonitoringLog).toEqual({});
      }
    }

    // The only active probe is the reporting one: its verdict stands.
    expect(response.criteriaMetId).toBe(criteriaId(stepOne, DOWN));
  });

  test("a result that names no step stores nothing, and is judged against the first step", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    probeRows.set([reporting]);

    const result: ProbeMonitorResponse = check({
      monitor,
      probeId: reporting.probeId!,
      stepId: stepOne.id,
      verdict: UP,
    });
    delete (result as unknown as JSONObject)["monitorStepId"];

    await MonitorResourceUtil.monitorResource(result, {
      reportingProbeId: reporting.probeId!,
    });

    const input: { result: unknown; judgedStepId: unknown } = storeAndReadMock
      .mock.calls[0]![0] as { result: unknown; judgedStepId: unknown };

    expect(input.result).toBeUndefined();
    expect(input.judgedStepId).toBe(stepOne.id.toString());
    expect(probeRows.stored).toHaveLength(0);
    expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
  });

  test("an SNMP trap stores nothing and reads no probe's result", async () => {
    const reporting: MonitorProbe = makeRow({ name: "Frankfurt" });
    probeRows.set([reporting]);

    const trap: ProbeMonitorResponse = {
      ...check({
        monitor,
        probeId: reporting.probeId!,
        stepId: stepOne.id,
        verdict: UP,
      }),
      snmpTrapResponse: { trapOid: "1.3.6.1.6.3.1.1.5.3" },
    } as unknown as ProbeMonitorResponse;

    await MonitorResourceUtil.monitorResource(trap, {
      reportingProbeId: reporting.probeId!,
    });

    const input: { result: unknown; judgedStepId: unknown } = storeAndReadMock
      .mock.calls[0]![0] as { result: unknown; judgedStepId: unknown };

    expect(input.result).toBeUndefined();
    expect(input.judgedStepId).toBeUndefined();
    expect(probeRows.stored).toHaveLength(0);
  });
});
