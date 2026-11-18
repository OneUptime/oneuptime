/*
 * MonitorCriteriaEvaluator reaches the template renderer, which loads the
 * native isolated-vm addon. Nothing here uses the sandbox and the prebuilt
 * binary cannot always dlopen in the test environment.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import MonitorTest from "../../../../Models/DatabaseModels/MonitorTest";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorTestEvaluation from "../../../../Server/Utils/Monitor/MonitorTestEvaluation";
import URL from "../../../../Types/API/URL";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary, {
  MonitorEvaluationCriteriaResult,
} from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHAT A TEST MONITOR RUN'S CRITERIA MAKE OF IT (#7074), by the real
 * evaluator: the steps are seeded the way Create Monitor seeds a Website
 * monitor, and the probe's answer is judged as the monitor's own checks
 * are - read only. The result dialog then says which criteria matched and
 * what would follow; here, which one the evaluation says matched.
 */

const ONLINE_STATUS_ID: ObjectID = ObjectID.generate();
const OFFLINE_STATUS_ID: ObjectID = ObjectID.generate();
const INCIDENT_SEVERITY_ID: ObjectID = ObjectID.generate();
const ALERT_SEVERITY_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const TEST_ID: ObjectID = ObjectID.generate();
const SAVED_MONITOR_ID: ObjectID = ObjectID.generate();

function websiteSteps(): MonitorSteps {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Acme website",
    monitorType: MonitorType.Website,
    onlineMonitorStatusId: ONLINE_STATUS_ID,
    offlineMonitorStatusId: OFFLINE_STATUS_ID,
    defaultIncidentSeverityId: INCIDENT_SEVERITY_ID,
    defaultAlertSeverityId: ALERT_SEVERITY_ID,
  });

  step.data!.monitorDestination = URL.fromString(
    "https://acme-commerce.example",
  );

  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: ONLINE_STATUS_ID,
  };

  return monitorSteps;
}

function firstStep(monitorSteps: MonitorSteps): MonitorStep {
  return monitorSteps.data!.monitorStepsInstanceArray[0]!;
}

function criteriaOf(
  monitorSteps: MonitorSteps,
): Array<MonitorCriteriaInstance> {
  return (
    firstStep(monitorSteps).data?.monitorCriteria.data
      ?.monitorCriteriaInstanceArray || []
  );
}

function monitorTest(
  monitorSteps: MonitorSteps,
  overrides: { [Key in keyof MonitorTest]?: MonitorTest[Key] | undefined } = {},
): MonitorTest {
  return Object.assign(new MonitorTest(), {
    _id: TEST_ID.toString(),
    projectId: PROJECT_ID,
    monitorType: MonitorType.Website,
    monitorSteps: monitorSteps,
    ...overrides,
  });
}

// What the probe answered for the test's one step.
function answer(
  monitorSteps: MonitorSteps,
  overrides: Partial<ProbeMonitorResponse>,
): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    // The probe names the test, not a monitor, as the monitor it checked.
    monitorId: TEST_ID,
    monitorStepId: firstStep(monitorSteps).id,
    probeId: ObjectID.generate(),
    failureCause: "",
    monitoredAt: new Date(),
    ...overrides,
  };
}

// The criteria an evaluation says matched: the first met, as the monitor acts.
function matchedCriteria(
  summary: MonitorEvaluationSummary | undefined,
): MonitorEvaluationCriteriaResult | undefined {
  return (summary?.criteriaResults || []).find(
    (result: MonitorEvaluationCriteriaResult): boolean => {
      return result.met && !result.skipped;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("A Test Monitor run is judged by its criteria", () => {
  test("a site that answers 200 matches the criteria that keeps it online", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();

    const summary: MonitorEvaluationSummary | undefined =
      await MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps),
        probeResponse: answer(monitorSteps, {
          isOnline: true,
          responseCode: 200,
          responseTimeInMs: 120,
        }),
      });

    const online: MonitorCriteriaInstance | undefined = criteriaOf(
      monitorSteps,
    ).find((instance: MonitorCriteriaInstance) => {
      return (
        instance.data?.monitorStatusId?.toString() ===
        ONLINE_STATUS_ID.toString()
      );
    });

    expect(summary).toBeDefined();
    expect(matchedCriteria(summary)?.criteriaId).toBe(online!.data!.id);
    expect(matchedCriteria(summary)?.criteriaName).toBe(online!.data!.name);
  });

  test("a site that is down matches the criteria that opens the incident", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();

    const summary: MonitorEvaluationSummary | undefined =
      await MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps),
        probeResponse: answer(monitorSteps, {
          isOnline: false,
          responseCode: 503,
          failureCause: "Server returned 503",
        }),
      });

    const offline: MonitorCriteriaInstance | undefined = criteriaOf(
      monitorSteps,
    ).find((instance: MonitorCriteriaInstance) => {
      return (
        instance.data?.monitorStatusId?.toString() ===
        OFFLINE_STATUS_ID.toString()
      );
    });

    expect(offline!.data!.createIncidents).toBe(true);
    expect(matchedCriteria(summary)?.criteriaId).toBe(offline!.data!.id);
  });

  test("an answer no criteria matches says so: none is met", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();

    // Only the offline criteria is left: a healthy answer matches nothing.
    firstStep(
      monitorSteps,
    ).data!.monitorCriteria.data!.monitorCriteriaInstanceArray = criteriaOf(
      monitorSteps,
    ).filter((instance: MonitorCriteriaInstance) => {
      return (
        instance.data?.monitorStatusId?.toString() ===
        OFFLINE_STATUS_ID.toString()
      );
    });

    const summary: MonitorEvaluationSummary | undefined =
      await MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps),
        probeResponse: answer(monitorSteps, {
          isOnline: true,
          responseCode: 200,
        }),
      });

    expect(summary).toBeDefined();
    expect(summary!.criteriaResults.length).toBeGreaterThan(0);
    expect(matchedCriteria(summary)).toBeUndefined();
  });

  test("a criteria switched off is never the one that matched", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();

    for (const instance of criteriaOf(monitorSteps)) {
      instance.data!.isEnabled = false;
    }

    const summary: MonitorEvaluationSummary | undefined =
      await MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps),
        probeResponse: answer(monitorSteps, {
          isOnline: false,
          responseCode: 500,
        }),
      });

    expect(matchedCriteria(summary)).toBeUndefined();
    expect(
      summary!.criteriaResults.every(
        (result: MonitorEvaluationCriteriaResult) => {
          return result.skipped === true;
        },
      ),
    ).toBe(true);
  });
});

describe("Read only, and never in the result's way", () => {
  test("it writes no match history, and judges a new monitor by the test's own id", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();
    const processMonitorStep: SpyInstance<
      typeof MonitorCriteriaEvaluator.processMonitorStep
    > = jest.spyOn(MonitorCriteriaEvaluator, "processMonitorStep");

    await MonitorTestEvaluation.evaluate({
      monitorTest: monitorTest(monitorSteps),
      probeResponse: answer(monitorSteps, {
        isOnline: true,
        responseCode: 200,
      }),
    });

    expect(processMonitorStep).toHaveBeenCalledTimes(1);

    const input: {
      monitor: Monitor;
      monitorStep: MonitorStep;
      recordMatchHistory?: boolean | undefined;
    } = processMonitorStep.mock.calls[0]![0] as {
      monitor: Monitor;
      monitorStep: MonitorStep;
      recordMatchHistory?: boolean | undefined;
    };

    expect(input.recordMatchHistory).toBe(false);
    expect(input.monitor.id?.toString()).toBe(TEST_ID.toString());
    expect(input.monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(input.monitor.monitorType).toBe(MonitorType.Website);
    expect(input.monitorStep.id.toString()).toBe(
      firstStep(monitorSteps).id.toString(),
    );
  });

  test("a saved monitor's test is judged as that monitor, so its history counts", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();
    const processMonitorStep: SpyInstance<
      typeof MonitorCriteriaEvaluator.processMonitorStep
    > = jest.spyOn(MonitorCriteriaEvaluator, "processMonitorStep");

    await MonitorTestEvaluation.evaluate({
      monitorTest: monitorTest(monitorSteps, { monitorId: SAVED_MONITOR_ID }),
      probeResponse: answer(monitorSteps, {
        isOnline: true,
        responseCode: 200,
      }),
    });

    const input: { monitor: Monitor } = processMonitorStep.mock
      .calls[0]![0] as { monitor: Monitor };

    expect(input.monitor.id?.toString()).toBe(SAVED_MONITOR_ID.toString());
  });

  test("the probe's answer is judged as it came, and left as it came", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();
    const probeResponse: ProbeMonitorResponse = answer(monitorSteps, {
      isOnline: true,
      responseCode: 200,
    });
    const before: string = JSON.stringify(probeResponse);

    await MonitorTestEvaluation.evaluate({
      monitorTest: monitorTest(monitorSteps),
      probeResponse: probeResponse,
    });

    expect(JSON.stringify(probeResponse)).toBe(before);
  });

  test("an evaluator that throws leaves the result without an evaluation", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();

    jest
      .spyOn(MonitorCriteriaEvaluator, "processMonitorStep")
      .mockRejectedValue(new Error("boom"));

    await expect(
      MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps),
        probeResponse: answer(monitorSteps, { isOnline: true }),
      }),
    ).resolves.toBeUndefined();
  });

  test("nothing to judge: no test, no type, no steps, or a step the test does not have", async () => {
    const monitorSteps: MonitorSteps = websiteSteps();
    const probeResponse: ProbeMonitorResponse = answer(monitorSteps, {
      isOnline: true,
    });

    await expect(
      MonitorTestEvaluation.evaluate({ monitorTest: null, probeResponse }),
    ).resolves.toBeUndefined();

    await expect(
      MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps, { monitorType: undefined }),
        probeResponse,
      }),
    ).resolves.toBeUndefined();

    await expect(
      MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps, { monitorSteps: undefined }),
        probeResponse,
      }),
    ).resolves.toBeUndefined();

    await expect(
      MonitorTestEvaluation.evaluate({
        monitorTest: monitorTest(monitorSteps),
        probeResponse: { ...probeResponse, monitorStepId: ObjectID.generate() },
      }),
    ).resolves.toBeUndefined();
  });
});
