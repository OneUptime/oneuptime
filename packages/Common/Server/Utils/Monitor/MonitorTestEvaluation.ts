import logger, { LogAttributes } from "../Logger";
import MonitorCriteriaEvaluator from "./MonitorCriteriaEvaluator";
import MonitorRecordEvidence from "./MonitorRecordEvidence";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTest from "../../../Models/DatabaseModels/MonitorTest";
import OneUptimeDate from "../../../Types/Date";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";

/*
 * WHAT A TEST MONITOR RUN'S CRITERIA MAKE OF IT (#7074).
 *
 * A Test Monitor run is one check, run by a probe before the monitor is
 * saved (or from a saved monitor's pages), and its result used to say only
 * what the probe found. A person then had to read the criteria and work out
 * for themselves which one the answer matched, and what that would do.
 *
 * So the result is judged as the monitor's own checks are, by the same
 * evaluator (MonitorCriteriaEvaluator.processMonitorStep), on the test's
 * steps as they were written - the form's, before they are saved - and the
 * evaluation is kept with the result, where the result dialog reads which
 * criteria matched. Read only: no match history is written (a stored-check
 * evaluation), nothing is opened, no status changes. A criteria judged over
 * time reads the history of the monitor the test is of, as its next check
 * would; a monitor not created yet has none.
 *
 * Never in the way of the result: a step that cannot be judged - an
 * evaluator that throws, a test with no steps to find the one the probe ran
 * - keeps its result, without an evaluation.
 */

export type MonitorTestForEvaluation = Pick<
  MonitorTest,
  "id" | "projectId" | "monitorId" | "monitorType" | "monitorSteps"
>;

export default class MonitorTestEvaluation {
  public static async evaluate(data: {
    monitorTest: MonitorTestForEvaluation | null | undefined;
    probeResponse: ProbeMonitorResponse;
  }): Promise<MonitorEvaluationSummary | undefined> {
    const monitorTest: MonitorTestForEvaluation | null | undefined =
      data.monitorTest;

    if (
      !monitorTest ||
      !monitorTest.projectId ||
      !monitorTest.monitorType ||
      !monitorTest.monitorSteps
    ) {
      return undefined;
    }

    const monitorStep: MonitorStep | undefined =
      MonitorRecordEvidence.findCheckStep({
        monitor: { monitorSteps: monitorTest.monitorSteps },
        check: data.probeResponse,
      });

    if (!monitorStep?.data?.monitorCriteria?.data) {
      return undefined;
    }

    /*
     * The monitor the test is of, held in memory: a saved one by its id, so
     * a criteria judged over time reads its history; a new one by the
     * test's, which names no monitor.
     */
    const monitorId: ObjectID | undefined =
      monitorTest.monitorId || monitorTest.id || undefined;

    const monitor: Monitor = new Monitor();

    if (monitorId) {
      monitor.id = monitorId;
    }

    monitor.projectId = monitorTest.projectId;
    monitor.monitorType = monitorTest.monitorType;
    monitor.monitorSteps = monitorTest.monitorSteps;

    const evaluationSummary: MonitorEvaluationSummary = {
      evaluatedAt: OneUptimeDate.getCurrentDate(),
      criteriaResults: [],
      events: [],
    };

    try {
      await MonitorCriteriaEvaluator.processMonitorStep({
        // A copy: the result is stored as the probe sent it.
        dataToProcess: { ...data.probeResponse },
        monitorStep: monitorStep,
        monitor: monitor,
        probeApiIngestResponse: {
          monitorId: monitorId || data.probeResponse.monitorId,
          criteriaMetId: undefined,
          rootCause: null,
          evaluationSummary: evaluationSummary,
        },
        evaluationSummary: evaluationSummary,
        // A test is no check of the monitor's: its history is left as it is.
        recordMatchHistory: false,
      });
    } catch (err) {
      logger.warn(
        `Test Monitor ${monitorTest.id?.toString() || ""}: its result could not be judged by its criteria, so it is kept without an evaluation.`,
        {
          monitorTestId: monitorTest.id?.toString(),
          projectId: monitorTest.projectId.toString(),
        } as LogAttributes,
      );
      logger.debug(err);

      return undefined;
    }

    return evaluationSummary;
  }
}
