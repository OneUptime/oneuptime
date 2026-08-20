/*
 * Probe agreement re-runs the criteria evaluator over every OTHER probe's
 * stored result before a status change is allowed. Two things about that
 * pass used to make it disagree with the evaluation summary shown to the
 * user on the very same incident:
 *
 *   1. The stored result is `JSON.parse(JSON.stringify(response))`, so its
 *      ObjectIDs come back as plain `{ _type, value }` objects. Those are
 *      not `instanceof ObjectID`, so an "evaluate over time" lookup bound
 *      them as-is and matched zero rows - indistinguishable from "this
 *      monitor has no history", which sent the evaluator down its
 *      instantaneous-value fallback.
 *   2. The probe whose result triggered this whole pass was re-evaluated
 *      from that stored copy rather than reusing the verdict the caller had
 *      just computed, so its "over time" window was a different window.
 *
 * Together those produced incidents whose stored root cause quoted a single
 * sample while the summary beside it reported the full window and said the
 * criteria was not met. See
 * https://github.com/OneUptime/oneuptime/issues/2321.
 *
 * As in the sibling reuse suite, everything heavy is mocked BEFORE
 * importing MonitorResource.
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

type CheckProbeAgreementFunction = (input: {
  monitor: Monitor;
  monitorStep: MonitorStep;
  currentCriteriaMetId: string | null;
  currentRootCause: string | null;
  currentProbeId?: ObjectID | undefined;
  monitorProbes?: Array<MonitorProbe> | undefined;
}) => Promise<ProbeAgreementResult>;

const checkProbeAgreement: CheckProbeAgreementFunction = (
  MonitorResourceUtil as any
)["checkProbeAgreement"].bind(MonitorResourceUtil);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";
const STEP_ID: string = "33333333-3333-4333-8333-333333333333";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";

/**
 * A probe response exactly as it comes back out of the lastMonitoringLog
 * jsonb column - every ObjectID flattened to `{ _type, value }` and every
 * Date to an ISO string.
 */
function storedProbeResponse(
  overrides: Record<string, unknown> = {},
): ProbeMonitorResponse {
  return {
    projectId: { _type: "ObjectID", value: PROJECT_ID },
    monitorId: { _type: "ObjectID", value: MONITOR_ID },
    monitorStepId: { _type: "ObjectID", value: STEP_ID },
    probeId: { _type: "ObjectID", value: PROBE_ID },
    monitoredAt: "2026-08-20T12:00:00.000Z",
    ingestedAt: "2026-08-20T12:00:01.000Z",
    isOnline: false,
    responseCode: 404,
    failureCause: "",
    ...overrides,
  } as unknown as ProbeMonitorResponse;
}

function makeMonitorProbe(input: {
  probeName: string;
  probeId?: ObjectID | undefined;
  lastMonitoringLog?: MonitorStepProbeResponse | undefined;
}): MonitorProbe {
  const probe: Probe = new Probe();
  probe.name = input.probeName;
  probe.connectionStatus = ProbeConnectionStatus.Connected;

  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.probeId = input.probeId || ObjectID.generate();
  monitorProbe.isEnabled = true;
  monitorProbe.probe = probe;

  if (input.lastMonitoringLog !== undefined) {
    monitorProbe.lastMonitoringLog = input.lastMonitoringLog;
  }

  return monitorProbe;
}

function makeMonitor(): Monitor {
  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  return monitor;
}

describe("MonitorResourceUtil.hydrateStoredProbeResponse", () => {
  const hydrate: (response: ProbeMonitorResponse) => ProbeMonitorResponse = (
    response: ProbeMonitorResponse,
  ): ProbeMonitorResponse => {
    return MonitorResourceUtil.hydrateStoredProbeResponse(response);
  };

  test("turns serialized ObjectIDs back into ObjectID instances", () => {
    const hydrated: ProbeMonitorResponse = hydrate(storedProbeResponse());

    expect(hydrated.projectId).toBeInstanceOf(ObjectID);
    expect(hydrated.monitorId).toBeInstanceOf(ObjectID);
    expect(hydrated.monitorStepId).toBeInstanceOf(ObjectID);
    expect(hydrated.probeId).toBeInstanceOf(ObjectID);
  });

  test("preserves the id values themselves", () => {
    const hydrated: ProbeMonitorResponse = hydrate(storedProbeResponse());

    expect(hydrated.projectId.toString()).toBe(PROJECT_ID);
    expect(hydrated.monitorId.toString()).toBe(MONITOR_ID);
    expect(hydrated.monitorStepId.toString()).toBe(STEP_ID);
    expect(hydrated.probeId.toString()).toBe(PROBE_ID);
  });

  test("accepts a bare id string too", () => {
    const hydrated: ProbeMonitorResponse = hydrate(
      storedProbeResponse({ projectId: PROJECT_ID }),
    );

    expect(hydrated.projectId).toBeInstanceOf(ObjectID);
    expect(hydrated.projectId.toString()).toBe(PROJECT_ID);
  });

  test("leaves a real ObjectID alone", () => {
    const projectId: ObjectID = new ObjectID(PROJECT_ID);

    const hydrated: ProbeMonitorResponse = hydrate(
      storedProbeResponse({ projectId: projectId }),
    );

    expect(hydrated.projectId).toBe(projectId);
  });

  test("turns serialized dates back into Date instances", () => {
    const hydrated: ProbeMonitorResponse = hydrate(storedProbeResponse());

    expect(hydrated.monitoredAt).toBeInstanceOf(Date);
    expect(hydrated.monitoredAt.toISOString()).toBe("2026-08-20T12:00:00.000Z");
    expect(hydrated.ingestedAt).toBeInstanceOf(Date);
  });

  test("leaves a real Date alone", () => {
    const monitoredAt: Date = new Date("2026-08-20T12:00:00.000Z");

    const hydrated: ProbeMonitorResponse = hydrate(
      storedProbeResponse({ monitoredAt: monitoredAt }),
    );

    expect(hydrated.monitoredAt).toBe(monitoredAt);
  });

  test("carries every other field through untouched", () => {
    const hydrated: ProbeMonitorResponse = hydrate(
      storedProbeResponse({
        responseCode: 503,
        responseTimeInMs: 1234,
        isOnline: false,
      }),
    );

    expect(hydrated.responseCode).toBe(503);
    expect(hydrated.responseTimeInMs).toBe(1234);
    expect(hydrated.isOnline).toBe(false);
  });

  test("does not mutate the stored row", () => {
    const stored: ProbeMonitorResponse = storedProbeResponse();

    hydrate(stored);

    expect(stored.projectId).not.toBeInstanceOf(ObjectID);
  });

  test("tolerates missing ids and dates", () => {
    const sparse: ProbeMonitorResponse = {
      isOnline: true,
    } as unknown as ProbeMonitorResponse;

    expect(() => {
      hydrate(sparse);
    }).not.toThrow();
  });

  test("tolerates an unparseable date", () => {
    const hydrated: ProbeMonitorResponse = hydrate(
      storedProbeResponse({ monitoredAt: "not-a-date" }),
    );

    // Left as-is rather than replaced with an Invalid Date.
    expect(hydrated.monitoredAt).toBe("not-a-date" as unknown as Date);
  });
});

describe("MonitorResourceUtil.checkProbeAgreement stored-payload handling", () => {
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

  test("hydrates a stored payload before handing it to the evaluator", async () => {
    const monitor: Monitor = makeMonitor();

    const otherProbe: MonitorProbe = makeMonitorProbe({
      probeName: "Probe B",
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-c" }),
      },
    });

    await checkProbeAgreement({
      monitor: monitor,
      monitorStep: monitorStep,
      currentCriteriaMetId: "criteria-c",
      currentRootCause: "root cause C",
      monitorProbes: [otherProbe],
    });

    expect(processMonitorStepMock).toHaveBeenCalledTimes(1);

    const handed: ProbeMonitorResponse = (
      processMonitorStepMock.mock.calls[0]![0] as {
        dataToProcess: ProbeMonitorResponse;
      }
    ).dataToProcess;

    expect(handed.projectId).toBeInstanceOf(ObjectID);
    expect(handed.projectId.toString()).toBe(PROJECT_ID);
    expect(handed.monitorId).toBeInstanceOf(ObjectID);
    expect(handed.monitoredAt).toBeInstanceOf(Date);
  });

  /*
   * The caller has already evaluated the probe whose result triggered this
   * pass, and that evaluation is the one the user sees. Re-running it here
   * would read a different "over time" window seconds later.
   */
  test("reuses the caller's verdict for the probe being handled", async () => {
    const monitor: Monitor = makeMonitor();
    const currentProbeId: ObjectID = new ObjectID(PROBE_ID);

    const currentProbe: MonitorProbe = makeMonitorProbe({
      probeName: "Probe A",
      probeId: currentProbeId,
      lastMonitoringLog: {
        // Deliberately different: it must NOT be what the result reports.
        [stepId]: storedProbeResponse({ testCriteriaId: "stale-criteria" }),
      },
    });

    const result: ProbeAgreementResult = await checkProbeAgreement({
      monitor: monitor,
      monitorStep: monitorStep,
      currentCriteriaMetId: "criteria-live",
      currentRootCause: "root cause live",
      currentProbeId: currentProbeId,
      monitorProbes: [currentProbe],
    });

    expect(processMonitorStepMock).not.toHaveBeenCalled();
    expect(result.agreedCriteriaId).toBe("criteria-live");
    expect(result.agreedRootCause).toBe("root cause live");
    expect(result.agreementCount).toBe(1);
  });

  test("still evaluates the other probes", async () => {
    const monitor: Monitor = makeMonitor();
    const currentProbeId: ObjectID = new ObjectID(PROBE_ID);

    const currentProbe: MonitorProbe = makeMonitorProbe({
      probeName: "Probe A",
      probeId: currentProbeId,
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-live" }),
      },
    });

    const otherProbe: MonitorProbe = makeMonitorProbe({
      probeName: "Probe B",
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-live" }),
      },
    });

    const result: ProbeAgreementResult = await checkProbeAgreement({
      monitor: monitor,
      monitorStep: monitorStep,
      currentCriteriaMetId: "criteria-live",
      currentRootCause: "root cause live",
      currentProbeId: currentProbeId,
      monitorProbes: [currentProbe, otherProbe],
    });

    expect(processMonitorStepMock).toHaveBeenCalledTimes(1);
    expect(result.agreementCount).toBe(2);
    expect(result.hasAgreement).toBe(true);
    expect(result.agreedProbeNames).toEqual(["Probe A", "Probe B"]);
  });

  /*
   * The current probe seeing nothing while the others see a breach must
   * still count as a disagreement, not be quietly folded into the majority.
   */
  test("a caller verdict of 'no criteria met' is counted as its own outcome", async () => {
    const monitor: Monitor = makeMonitor();
    const currentProbeId: ObjectID = new ObjectID(PROBE_ID);

    const currentProbe: MonitorProbe = makeMonitorProbe({
      probeName: "Probe A",
      probeId: currentProbeId,
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-c" }),
      },
    });

    const otherProbe: MonitorProbe = makeMonitorProbe({
      probeName: "Probe B",
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-c" }),
      },
    });

    const result: ProbeAgreementResult = await checkProbeAgreement({
      monitor: monitor,
      monitorStep: monitorStep,
      currentCriteriaMetId: null,
      currentRootCause: null,
      currentProbeId: currentProbeId,
      monitorProbes: [currentProbe, otherProbe],
    });

    // Two probes, both required, but they disagree - no status change.
    expect(result.hasAgreement).toBe(false);
    expect(result.agreementCount).toBe(1);
  });

  /*
   * Without currentProbeId (the incoming-request caller, for instance) the
   * behaviour is unchanged: every stored row is evaluated.
   */
  test("evaluates every probe when no current probe is named", async () => {
    const monitor: Monitor = makeMonitor();

    const probeA: MonitorProbe = makeMonitorProbe({
      probeName: "Probe A",
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-c" }),
      },
    });
    const probeB: MonitorProbe = makeMonitorProbe({
      probeName: "Probe B",
      lastMonitoringLog: {
        [stepId]: storedProbeResponse({ testCriteriaId: "criteria-c" }),
      },
    });

    const result: ProbeAgreementResult = await checkProbeAgreement({
      monitor: monitor,
      monitorStep: monitorStep,
      currentCriteriaMetId: "criteria-c",
      currentRootCause: "root cause C",
      monitorProbes: [probeA, probeB],
    });

    expect(processMonitorStepMock).toHaveBeenCalledTimes(2);
    expect(result.agreementCount).toBe(2);
  });
});
