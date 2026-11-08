import Monitor from "../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationDetails from "../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import MonitorEvaluationDetailsUtil from "../../../Utils/Monitor/MonitorEvaluationDetailsUtil";
import { toStorableJson } from "../Database/PostgresStorableValue";
import logger from "../Logger";
import DataToProcess from "./DataToProcess";
import MonitorEvaluationDetailsBuilder from "./MonitorEvaluationDetailsBuilder";

/*
 * Captures the evaluation details an incident or an alert is created with
 * (MonitorEvaluationDetailsBuilder), for the creators to store.
 *
 * Built at most once per criteria per evaluation, and only when a record is
 * really created: a monitor that stays down evaluates every minute with its
 * incident already open, and has nothing new to store. A failure is logged
 * and stores nothing - evidence is never a reason for an incident not to
 * open.
 */

export type GetEvaluationDetails = () => Promise<JSONObject | null>;

/*
 * The monitor types whose records each describe the one check that opened
 * them, even when the criteria opens one per value: an Incoming Request
 * criteria that groups by a payload field judged the one request, and an
 * Incoming Email one that opens for every email judged the one email.
 */
const ONE_CHECK_PER_RECORD_MONITOR_TYPES: ReadonlyArray<MonitorType> = [
  MonitorType.IncomingRequest,
  MonitorType.IncomingEmail,
];

export default class MonitorEvaluationDetailsCapture {
  public static forCriteria(input: {
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    dataToProcess: DataToProcess;
    probeName?: string | undefined;
  }): GetEvaluationDetails {
    let captured: Promise<JSONObject | null> | null = null;

    return (): Promise<JSONObject | null> => {
      if (!captured) {
        captured = MonitorEvaluationDetailsCapture.capture(input);
      }

      return captured;
    };
  }

  public static async capture(input: {
    monitor: Monitor;
    monitorStep?: MonitorStep | undefined;
    criteriaInstance: MonitorCriteriaInstance;
    evaluationSummary?: MonitorEvaluationSummary | undefined;
    dataToProcess: DataToProcess;
    probeName?: string | undefined;
  }): Promise<JSONObject | null> {
    try {
      const details: MonitorEvaluationDetails | null =
        await MonitorEvaluationDetailsBuilder.build(input);

      if (!details) {
        return null;
      }

      // Made storable after serialize(), which keeps the Dates as Dates.
      return toStorableJson(MonitorEvaluationDetailsUtil.serialize(details));
    } catch (err) {
      logger.error(
        `${input.monitor.id?.toString()} - Could not capture the evaluation details for this evaluation. The incident / alert will be created without them.`,
      );
      logger.error(err);

      return null;
    }
  }

  /*
   * Do the details describe a record opened for this series? They do for a
   * record of the whole monitor, and for the records of the monitor types
   * whose records each come from the one check. A grouped metric or
   * infrastructure criteria opens one record per series, host, disk or
   * port, and its filters' sentences describe the monitor as a whole - that
   * record's own root cause names what breached on it, so it keeps none.
   */
  public static describesRecord(input: {
    monitorType: MonitorType | undefined;
    seriesFingerprint?: string | undefined;
  }): boolean {
    if (
      !input.seriesFingerprint ||
      input.seriesFingerprint ===
        MetricSeriesFingerprint.WholeMonitorFingerprint
    ) {
      return true;
    }

    return Boolean(
      input.monitorType &&
        ONE_CHECK_PER_RECORD_MONITOR_TYPES.includes(input.monitorType),
    );
  }
}
