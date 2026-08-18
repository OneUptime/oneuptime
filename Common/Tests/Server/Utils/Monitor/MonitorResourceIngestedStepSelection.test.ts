/*
 * Which monitor step a result is evaluated against.
 *
 * A monitor can have several steps and EACH step carries its own criteria. A
 * probe result names the step it actually ran in `monitorStepId`, so that step
 * — not whichever step happens to sit first in the array — decides which
 * criteria may match. Five outputs hang off that choice:
 *
 *   - `criteriaMetId`, matched against the ingested step's criteria only;
 *   - `ingestedMonitorStepId`, echoed back to the probe;
 *   - `nextMonitorStepId`, which walks the chain from the ingested step;
 *   - the step handed to MonitorCriteriaEvaluator.processMonitorStep;
 *   - the step handed to checkProbeAgreement, which keys every other probe's
 *     lastMonitoringLog by step id — the wrong id compares this result against
 *     other probes' state for a different step.
 *
 * MonitorResource used to run the `.find()` for the ingested step and DISCARD
 * its result, leaving `monitorStep` pinned to `monitorStepsInstanceArray[0]`.
 * Single-step monitors (the overwhelming majority, including every SSL
 * monitor) could not notice; multi-step monitors silently evaluated every
 * step's results against step 0's criteria.
 *
 * A `monitorStepId` that matches NO step is stale — the step was deleted after
 * the probe was scheduled — and still falls back to step 0 rather than
 * dropping the result. That fallback is pinned here too, because it is the one
 * case where "use step 0" is deliberate rather than a bug.
 *
 * Everything heavy is mocked BEFORE importing MonitorResource: the criteria
 * evaluator (pulls native isolated-vm via VMAPI/VMRunner), the monitor and
 * probe services (Postgres), the per-monitor semaphore (Redis), the metric and
 * log utils (ClickHouse) and the logger. checkProbeAgreement is spied on so
 * this suite pins only the step it is HANDED — its internals are covered by
 * MonitorResourceProbeAgreementReuse.test.ts. Pure in-memory model instances.
 */

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
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorProbeService from "../../../../Server/Services/MonitorProbeService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const findOneByIdMock: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;

const findByMock: jest.Mock =
  MonitorProbeService.findBy as unknown as jest.Mock;

const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

/*
 * One criteria per step, so the criteria id that comes back on the response
 * names the step it was read off — exactly the coupling the discarded lookup
 * broke.
 */
type MakeStep = (criteriaName: string) => MonitorStep;

const makeStep: MakeStep = (criteriaName: string): MonitorStep => {
  const criteriaInstance: MonitorCriteriaInstance =
    new MonitorCriteriaInstance();
  criteriaInstance.data!.name = criteriaName;

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = {
    monitorCriteriaInstanceArray: [criteriaInstance],
  };

  const step: MonitorStep = new MonitorStep();
  step.data!.monitorCriteria = monitorCriteria;

  return step;
};

type CriteriaIdOfStep = (step: MonitorStep) => string;

const criteriaIdOfStep: CriteriaIdOfStep = (step: MonitorStep): string => {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
    .id;
};

type MakeMonitor = (input: {
  monitorType: MonitorType;
  steps: Array<MonitorStep>;
}) => Monitor;

const makeMonitor: MakeMonitor = (input: {
  monitorType: MonitorType;
  steps: Array<MonitorStep>;
}): Monitor => {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: input.steps,
    /*
     * Left undefined on purpose: a set default status sends the
     * no-criteria-met path into MonitorStatusTimelineService, which this
     * suite has no reason to reach.
     */
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = input.monitorType;
  monitor.monitorSteps = monitorSteps;

  return monitor;
};

type MakeProbeResult = (input: {
  monitor: Monitor;
  probeId: ObjectID;
  monitorStepId: ObjectID;
}) => DataToProcess;

const makeProbeResult: MakeProbeResult = (input: {
  monitor: Monitor;
  probeId: ObjectID;
  monitorStepId: ObjectID;
}): DataToProcess => {
  return {
    projectId: input.monitor.projectId!,
    monitorId: input.monitor.id!,
    probeId: input.probeId,
    monitorStepId: input.monitorStepId,
    isOnline: true,
    failureCause: "",
  } as ProbeMonitorResponse;
};

type StepPassedToEvaluator = () => MonitorStep;

const stepPassedToEvaluator: StepPassedToEvaluator = (): MonitorStep => {
  return processMonitorStepMock.mock.calls[0]![0].monitorStep;
};

describe("MonitorResourceUtil.monitorResource ingested monitor step selection", () => {
  let checkProbeAgreementSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();

    lockMock.mockResolvedValue({});

    /*
     * Stands in for the real evaluator in the one respect this suite is
     * about: the criteria it can match are exactly the ones hanging off the
     * step it was handed. rootCause stays null so the criteria-met branch
     * (incidents, alerts, status timeline) never runs.
     */
    processMonitorStepMock.mockImplementation(
      (input: {
        monitorStep: MonitorStep;
        probeApiIngestResponse: ProbeApiIngestResponse;
      }): Promise<ProbeApiIngestResponse> => {
        return Promise.resolve({
          ...input.probeApiIngestResponse,
          criteriaMetId: criteriaIdOfStep(input.monitorStep),
          rootCause: null,
        });
      },
    );

    /*
     * Agreement itself is covered elsewhere; here it only has to pass the
     * evaluated criteria through so the response still reports it, while
     * recording the step it was given.
     */
    checkProbeAgreementSpy = jest
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
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("probe result naming a step (multi-step monitor)", () => {
    let stepOne: MonitorStep;
    let stepTwo: MonitorStep;
    let stepThree: MonitorStep;
    let monitor: Monitor;
    let probeId: ObjectID;

    beforeEach(() => {
      stepOne = makeStep("Step one criteria");
      stepTwo = makeStep("Step two criteria");
      stepThree = makeStep("Step three criteria");

      monitor = makeMonitor({
        monitorType: MonitorType.Website,
        steps: [stepOne, stepTwo, stepThree],
      });

      probeId = ObjectID.generate();

      const monitorProbe: MonitorProbe = new MonitorProbe();
      monitorProbe.id = ObjectID.generate();
      monitorProbe.probeId = probeId;
      monitorProbe.isEnabled = true;

      findOneByIdMock.mockResolvedValue(monitor);
      findByMock.mockResolvedValue([monitorProbe]);
    });

    test("evaluates the named step's criteria, not step 0's", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor: monitor,
            probeId: probeId,
            monitorStepId: stepTwo.id,
          }),
        );

      expect(stepPassedToEvaluator().id.toString()).toBe(stepTwo.id.toString());
      expect(response.criteriaMetId).toBe(criteriaIdOfStep(stepTwo));
      expect(response.criteriaMetId).not.toBe(criteriaIdOfStep(stepOne));
    });

    test("reports the named step as the ingested step", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor: monitor,
            probeId: probeId,
            monitorStepId: stepTwo.id,
          }),
        );

      expect(response.ingestedMonitorStepId?.toString()).toBe(
        stepTwo.id.toString(),
      );
    });

    test("walks the step chain on from the named step", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor: monitor,
            probeId: probeId,
            monitorStepId: stepTwo.id,
          }),
        );

      // Step three follows step two — not step two, which follows step one.
      expect(response.nextMonitorStepId?.toString()).toBe(
        stepThree.id.toString(),
      );
    });

    test("the last step has no next step", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor: monitor,
            probeId: probeId,
            monitorStepId: stepThree.id,
          }),
        );

      expect(response.nextMonitorStepId).toBeUndefined();
    });

    test("hands probe agreement the named step, so it reads the right step's probe logs", async () => {
      await MonitorResourceUtil.monitorResource(
        makeProbeResult({
          monitor: monitor,
          probeId: probeId,
          monitorStepId: stepTwo.id,
        }),
      );

      expect(checkProbeAgreementSpy).toHaveBeenCalledTimes(1);

      const agreementInput: { monitorStep: MonitorStep } =
        checkProbeAgreementSpy.mock.calls[0]![0] as {
          monitorStep: MonitorStep;
        };

      expect(agreementInput.monitorStep.id.toString()).toBe(
        stepTwo.id.toString(),
      );
    });

    test("step 0 is still selected when the result names step 0", async () => {
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor: monitor,
            probeId: probeId,
            monitorStepId: stepOne.id,
          }),
        );

      expect(stepPassedToEvaluator().id.toString()).toBe(stepOne.id.toString());
      expect(response.criteriaMetId).toBe(criteriaIdOfStep(stepOne));
      expect(response.ingestedMonitorStepId?.toString()).toBe(
        stepOne.id.toString(),
      );
    });

    test("an unknown step id falls back to step 0 rather than dropping the result", async () => {
      // The step was deleted after this probe was scheduled.
      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(
          makeProbeResult({
            monitor: monitor,
            probeId: probeId,
            monitorStepId: ObjectID.generate(),
          }),
        );

      expect(stepPassedToEvaluator().id.toString()).toBe(stepOne.id.toString());
      expect(response.criteriaMetId).toBe(criteriaIdOfStep(stepOne));
      expect(response.ingestedMonitorStepId?.toString()).toBe(
        stepOne.id.toString(),
      );
      expect(response.nextMonitorStepId?.toString()).toBe(
        stepTwo.id.toString(),
      );
    });
  });

  describe("result carrying no step id", () => {
    test("uses step 0", async () => {
      /*
       * Server monitors heartbeat in without a monitorStepId at all — the
       * whole lookup is skipped and step 0 is the intended step.
       */
      const stepOne: MonitorStep = makeStep("Step one criteria");
      const stepTwo: MonitorStep = makeStep("Step two criteria");

      const monitor: Monitor = makeMonitor({
        monitorType: MonitorType.Server,
        steps: [stepOne, stepTwo],
      });

      findOneByIdMock.mockResolvedValue(monitor);

      const serverMonitorResponse: ServerMonitorResponse = {
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        hostname: "test-host",
        requestReceivedAt: OneUptimeDate.getCurrentDate(),
        onlyCheckRequestReceivedAt: false,
      };

      const response: ProbeApiIngestResponse =
        await MonitorResourceUtil.monitorResource(serverMonitorResponse);

      expect(stepPassedToEvaluator().id.toString()).toBe(stepOne.id.toString());
      expect(response.criteriaMetId).toBe(criteriaIdOfStep(stepOne));
      expect(response.ingestedMonitorStepId?.toString()).toBe(
        stepOne.id.toString(),
      );
    });
  });
});
