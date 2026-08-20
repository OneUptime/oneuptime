/*
 * The probe-result hot path in MonitorResource.ts now pre-fetches every
 * MonitorProbe row for the monitor ONCE (with the heavy lastMonitoringLog
 * jsonb) and threads the rows into checkProbeAgreement via the new optional
 * `monitorProbes` input. Before this optimization checkProbeAgreement
 * re-queried MonitorProbeService.findBy on every single probe result — the
 * second-largest read on the hottest Postgres path.
 *
 * This suite pins the contract of that reuse:
 *   - when `monitorProbes` is PROVIDED, findBy must never run and the
 *     agreement result must be computed purely from the provided rows
 *     (including the provided-but-empty-array case: [] is truthy, so it
 *     must NOT fall back to querying);
 *   - when `monitorProbes` is ABSENT, the original single findBy with the
 *     original query/select must still run (the fallback for callers that
 *     did not pre-fetch, e.g. the incoming-request path);
 *   - the agreement semantics themselves (active-probe filtering, the
 *     minimumProbeAgreement threshold, missing-step-log skipping, and the
 *     no-active-probes pass-through) are unchanged by the reuse.
 *
 * If any assertion here starts failing, either the fallback query drifted
 * from the pre-fetch select (the pre-fetch is the union both consumers
 * need) or the reuse regressed into re-querying per result.
 *
 * Everything heavy is mocked BEFORE importing MonitorResource: the criteria
 * evaluator (pulls native isolated-vm via VMAPI/VMRunner), the probe
 * service (Postgres) and the logger. Pure in-memory model instances — no
 * Postgres, no Redis, no isolated-vm.
 */

/*
 * MonitorResource's import chain reaches the native isolated-vm addon
 * through the sandbox runner. Nothing here touches the sandbox and the
 * prebuilt binary cannot always dlopen in the test environment, so stub it
 * out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/MonitorProbeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

import MonitorResourceUtil from "../../../Server/Utils/Monitor/MonitorResource";
import MonitorCriteriaEvaluator from "../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorProbeService from "../../../Server/Services/MonitorProbeService";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import ProbeApiIngestResponse from "../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import DataToProcess from "../../../Server/Utils/Monitor/DataToProcess";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { describe, expect, test, beforeEach } from "@jest/globals";

interface ProbeAgreementResult {
  hasAgreement: boolean;
  agreementCount: number;
  requiredCount: number;
  totalActiveProbes: number;
  agreedCriteriaId: string | null;
  agreedRootCause: string | null;
  agreedProbeNames: Array<string>;
}

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;

const findByMock: jest.Mock =
  MonitorProbeService.findBy as unknown as jest.Mock;

type CheckProbeAgreementFunction = (input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  currentCriteriaMetId: string | null;
  currentRootCause: string | null;
  monitorProbes?: Array<MonitorProbe> | undefined;
}) => Promise<ProbeAgreementResult>;

const checkProbeAgreement: CheckProbeAgreementFunction = (
  MonitorResourceUtil as any
)["checkProbeAgreement"].bind(MonitorResourceUtil);

type MakeMonitor = (minimumProbeAgreement?: number) => Monitor;

const makeMonitor: MakeMonitor = (minimumProbeAgreement?: number): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  if (minimumProbeAgreement !== undefined) {
    monitor.minimumProbeAgreement = minimumProbeAgreement;
  }
  return monitor;
};

/*
 * The mocked evaluator returns whatever criteria id the probe response
 * carries in its `testCriteriaId` marker — so each probe row fully
 * determines its own evaluation outcome.
 */
type MakeProbeResponse = (
  testCriteriaId: string | undefined,
  testRootCause?: string,
) => ProbeMonitorResponse;

const makeProbeResponse: MakeProbeResponse = (
  testCriteriaId: string | undefined,
  testRootCause?: string,
): ProbeMonitorResponse => {
  return {
    testCriteriaId: testCriteriaId,
    testRootCause: testRootCause || null,
  } as unknown as ProbeMonitorResponse;
};

type MakeMonitorProbe = (input: {
  probeName: string;
  isEnabled: boolean;
  connectionStatus: ProbeConnectionStatus | undefined;
  lastMonitoringLog?: MonitorStepProbeResponse | undefined;
}) => MonitorProbe;

const makeMonitorProbe: MakeMonitorProbe = (input: {
  probeName: string;
  isEnabled: boolean;
  connectionStatus: ProbeConnectionStatus | undefined;
  lastMonitoringLog?: MonitorStepProbeResponse | undefined;
}): MonitorProbe => {
  const probe: Probe = new Probe();
  probe.name = input.probeName;
  if (input.connectionStatus !== undefined) {
    probe.connectionStatus = input.connectionStatus;
  }

  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.probeId = ObjectID.generate();
  monitorProbe.isEnabled = input.isEnabled;
  monitorProbe.probe = probe;
  if (input.lastMonitoringLog !== undefined) {
    monitorProbe.lastMonitoringLog = input.lastMonitoringLog;
  }
  return monitorProbe;
};

describe("MonitorResourceUtil.checkProbeAgreement pre-fetched row reuse", () => {
  let monitorStep: MonitorStep;
  let stepId: string;

  beforeEach(() => {
    jest.clearAllMocks();

    monitorStep = new MonitorStep();
    stepId = monitorStep.id.toString();

    processMonitorStepMock.mockImplementation(
      (input: {
        dataToProcess: DataToProcess;
        monitor: Monitor;
      }): Promise<ProbeApiIngestResponse> => {
        return Promise.resolve({
          monitorId: input.monitor.id!,
          criteriaMetId: (input.dataToProcess as any).testCriteriaId,
          rootCause: (input.dataToProcess as any).testRootCause || null,
        });
      },
    );
  });

  describe("monitorProbes provided (hot path)", () => {
    test("never queries MonitorProbeService.findBy and computes agreement from the provided rows", async () => {
      const monitor: Monitor = makeMonitor();

      const probeA: MonitorProbe = makeMonitorProbe({
        probeName: "Probe A",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c", "root cause C"),
        },
      });
      const probeB: MonitorProbe = makeMonitorProbe({
        probeName: "Probe B",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c", "root cause C"),
        },
      });

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: "criteria-c",
        currentRootCause: "root cause C",
        monitorProbes: [probeA, probeB],
      });

      expect(findByMock).not.toHaveBeenCalled();
      // Both provided rows were evaluated — result came from them.
      expect(processMonitorStepMock).toHaveBeenCalledTimes(2);
      expect(result.hasAgreement).toBe(true);
      expect(result.agreementCount).toBe(2);
      expect(result.totalActiveProbes).toBe(2);
    });

    test("a provided EMPTY array still short-circuits the query ([] is truthy)", async () => {
      const monitor: Monitor = makeMonitor();

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: "current-criteria",
        currentRootCause: "current root cause",
        monitorProbes: [],
      });

      expect(findByMock).not.toHaveBeenCalled();
      expect(result.hasAgreement).toBe(true);
      expect(result.agreementCount).toBe(0);
    });

    test("both probes agreeing on the same criteria wins with both probe names", async () => {
      const monitor: Monitor = makeMonitor();

      const probeA: MonitorProbe = makeMonitorProbe({
        probeName: "Probe A",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c", "root cause C"),
        },
      });
      const probeB: MonitorProbe = makeMonitorProbe({
        probeName: "Probe B",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c", "root cause C"),
        },
      });

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: null,
        currentRootCause: null,
        monitorProbes: [probeA, probeB],
      });

      expect(result.hasAgreement).toBe(true);
      expect(result.agreementCount).toBe(2);
      expect(result.requiredCount).toBe(2);
      expect(result.totalActiveProbes).toBe(2);
      expect(result.agreedCriteriaId).toBe("criteria-c");
      expect(result.agreedRootCause).toBe("root cause C");
      expect([...result.agreedProbeNames].sort()).toEqual([
        "Probe A",
        "Probe B",
      ]);
    });

    test("minimumProbeAgreement not reached: split criteria yields no agreement and empty names", async () => {
      // 3 active probes, threshold 2, each evaluating to a DIFFERENT criteria.
      const monitor: Monitor = makeMonitor(2);

      const probes: Array<MonitorProbe> = ["c-1", "c-2", "c-3"].map(
        (criteriaId: string, index: number): MonitorProbe => {
          return makeMonitorProbe({
            probeName: `Probe ${index + 1}`,
            isEnabled: true,
            connectionStatus: ProbeConnectionStatus.Connected,
            lastMonitoringLog: {
              [stepId]: makeProbeResponse(criteriaId),
            },
          });
        },
      );

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: "c-1",
        currentRootCause: "root cause 1",
        monitorProbes: probes,
      });

      expect(findByMock).not.toHaveBeenCalled();
      expect(result.hasAgreement).toBe(false);
      expect(result.agreementCount).toBe(1);
      expect(result.requiredCount).toBe(2);
      expect(result.totalActiveProbes).toBe(3);
      expect(result.agreedCriteriaId).toBeNull();
      expect(result.agreedRootCause).toBeNull();
      expect(result.agreedProbeNames).toEqual([]);
    });

    test("disabled and disconnected probes are excluded from active probes", async () => {
      const monitor: Monitor = makeMonitor();

      const activeProbe: MonitorProbe = makeMonitorProbe({
        probeName: "Active Probe",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c", "root cause C"),
        },
      });
      const disabledProbe: MonitorProbe = makeMonitorProbe({
        probeName: "Disabled Probe",
        isEnabled: false,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("other-criteria"),
        },
      });
      const disconnectedProbe: MonitorProbe = makeMonitorProbe({
        probeName: "Disconnected Probe",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Disconnected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("other-criteria"),
        },
      });

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: null,
        currentRootCause: null,
        monitorProbes: [activeProbe, disabledProbe, disconnectedProbe],
      });

      // Only the enabled+connected probe counts — and only it is evaluated.
      expect(result.totalActiveProbes).toBe(1);
      expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
      expect(result.hasAgreement).toBe(true);
      expect(result.agreementCount).toBe(1);
      expect(result.agreedProbeNames).toEqual(["Active Probe"]);
    });

    test("no active probes passes the CURRENT criteria and root cause through as agreement", async () => {
      const monitor: Monitor = makeMonitor();

      const disabledProbe: MonitorProbe = makeMonitorProbe({
        probeName: "Disabled Probe",
        isEnabled: false,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("other-criteria"),
        },
      });

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: "current-criteria",
        currentRootCause: "current root cause",
        monitorProbes: [disabledProbe],
      });

      expect(findByMock).not.toHaveBeenCalled();
      expect(processMonitorStepMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        hasAgreement: true,
        agreementCount: 0,
        requiredCount: 0,
        totalActiveProbes: 0,
        agreedCriteriaId: "current-criteria",
        agreedRootCause: "current root cause",
        agreedProbeNames: [],
      });
    });

    test("an active probe with no lastMonitoringLog entry for the step is skipped", async () => {
      // No minimumProbeAgreement → required = number of ACTIVE probes (2).
      const monitor: Monitor = makeMonitor();

      const respondedProbe: MonitorProbe = makeMonitorProbe({
        probeName: "Responded Probe",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c"),
        },
      });
      const silentProbe: MonitorProbe = makeMonitorProbe({
        probeName: "Silent Probe",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        // Log exists but for a DIFFERENT step id — must not count.
        lastMonitoringLog: {
          [ObjectID.generate().toString()]: makeProbeResponse("criteria-c"),
        },
      });

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: null,
        currentRootCause: null,
        monitorProbes: [respondedProbe, silentProbe],
      });

      /*
       * The silent probe is still ACTIVE (it raises the bar) but is never
       * evaluated and never counts toward agreement.
       */
      expect(result.totalActiveProbes).toBe(2);
      expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
      expect(result.agreementCount).toBe(1);
      expect(result.requiredCount).toBe(2);
      expect(result.hasAgreement).toBe(false);
      expect(result.agreedProbeNames).toEqual([]);
    });
  });

  describe("monitorProbes absent (fallback path)", () => {
    test("falls back to exactly one findBy with the original query and select", async () => {
      const monitor: Monitor = makeMonitor();

      const probeA: MonitorProbe = makeMonitorProbe({
        probeName: "Probe A",
        isEnabled: true,
        connectionStatus: ProbeConnectionStatus.Connected,
        lastMonitoringLog: {
          [stepId]: makeProbeResponse("criteria-c", "root cause C"),
        },
      });

      findByMock.mockResolvedValue([probeA]);

      const result: ProbeAgreementResult = await checkProbeAgreement({
        monitor: monitor,
        monitorStep: monitorStep,
        currentCriteriaMetId: null,
        currentRootCause: null,
      });

      expect(findByMock).toHaveBeenCalledTimes(1);
      expect(findByMock).toHaveBeenCalledWith({
        query: {
          monitorId: monitor.id!,
        },
        select: {
          probeId: true,
          isEnabled: true,
          lastMonitoringLog: true,
          probe: {
            connectionStatus: true,
            name: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      // And the queried rows drive the result.
      expect(result.hasAgreement).toBe(true);
      expect(result.agreementCount).toBe(1);
      expect(result.agreedCriteriaId).toBe("criteria-c");
      expect(result.agreedRootCause).toBe("root cause C");
      expect(result.agreedProbeNames).toEqual(["Probe A"]);
    });
  });
});
