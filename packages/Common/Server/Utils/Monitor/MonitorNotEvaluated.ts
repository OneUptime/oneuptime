import Monitor from "../../../Models/DatabaseModels/Monitor";
import OneUptimeDate from "../../../Types/Date";
import {
  EvaluationSentence,
  translatableSentence,
} from "../../../Types/Monitor/EvaluationSentence";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorEvaluationSummary, {
  MonitorEvaluationEvent,
  MonitorEvaluationNotEvaluatedReason,
} from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import { MonitorPauseReason } from "../../../Utils/Monitor/MonitorPauseState";
import logger from "../Logger";
import DataToProcess from "./DataToProcess";
import EvaluationEventText from "./EvaluationEventText";
import MonitorHeartbeatState from "./MonitorHeartbeatState";
import MonitorLogUtil from "./MonitorLogUtil";
import MonitorRecordEvidence from "./MonitorRecordEvidence";

/*
 * WHAT REACHES A MONITOR THAT IS NOT BEING CHECKED (issue #11141).
 *
 * An Incoming Request monitor's requests, an Incoming Email monitor's
 * emails and a Server monitor's agent reports are sent to OneUptime from
 * outside, whatever OneUptime is doing with the monitor. While the monitor
 * is not being checked - an incident declared by hand or a maintenance
 * event paused it, someone turned its monitoring off, or it is archived -
 * they are not evaluated: nothing they say opens or resolves an incident
 * or an alert, or changes the monitor's status. The sender is still told
 * the request was received.
 *
 * They used to be dropped without a trace. A webhook receiver whose
 * monitor an incident paused lost every event that came in meanwhile, and
 * nothing on the monitor said any had. Now each one is listed in the
 * monitor's Logs, as it came, with why it was not evaluated, and when it
 * arrived is still kept for the monitor's page and for its heartbeat - so
 * a sender that kept sending is not judged silent once the monitor is
 * checked again.
 *
 * Probe checks are OneUptime's own and a probe is never handed a monitor
 * that is not being checked, so a probe result is not listed: only what is
 * sent from outside. An SNMP trap is written to its device's trap log
 * before any monitor reads it.
 */

// Each sentence written out where it is made, for npm run i18n:extract.
function getNotEvaluatedWords(reason: MonitorPauseReason): {
  title: EvaluationSentence;
  message: EvaluationSentence;
} {
  switch (reason) {
    case MonitorPauseReason.ManualIncident:
      return {
        title: translatableSentence(
          "Not evaluated: monitoring is paused by an incident",
        ),
        message: translatableSentence(
          "An incident declared by hand paused this monitor's checks, so this was not evaluated against its criteria and opened or resolved nothing. Checks resume when the incident is resolved. To keep checking during incidents, turn on Keep monitoring during incidents in the monitor's settings.",
        ),
      };
    case MonitorPauseReason.ScheduledMaintenance:
      return {
        title: translatableSentence(
          "Not evaluated: monitoring is paused for scheduled maintenance",
        ),
        message: translatableSentence(
          "A maintenance event paused this monitor's checks, so this was not evaluated against its criteria and opened or resolved nothing. Checks resume when the event ends.",
        ),
      };
    case MonitorPauseReason.Disabled:
      return {
        title: translatableSentence("Not evaluated: monitoring is turned off"),
        message: translatableSentence(
          "This monitor's monitoring is turned off, so this was not evaluated against its criteria and opened or resolved nothing.",
        ),
      };
    case MonitorPauseReason.Archived:
      return {
        title: translatableSentence("Not evaluated: the monitor is archived"),
        message: translatableSentence(
          "This monitor is archived, so this was not evaluated against its criteria and opened or resolved nothing.",
        ),
      };
  }
}

// The types whose results are sent from outside, listed while not checked.
const SENT_FROM_OUTSIDE: ReadonlyArray<MonitorType> = [
  MonitorType.IncomingRequest,
  MonitorType.IncomingEmail,
  MonitorType.Server,
];

/*
 * What a monitor is read with before a result can be listed for it, beside
 * its pause flags (MONITOR_PAUSE_FLAGS_SELECT).
 */
export const MONITOR_NOT_EVALUATED_SELECT: {
  _id: true;
  projectId: true;
  monitorType: true;
  keepResponseContent: true;
} = {
  _id: true,
  projectId: true,
  monitorType: true,
  keepResponseContent: true,
};

export default class MonitorNotEvaluated {
  // Whether what reaches a monitor of this type is listed while it is not checked.
  public static isSentFromOutside(
    monitorType: MonitorType | undefined | null,
  ): boolean {
    return Boolean(monitorType && SENT_FROM_OUTSIDE.includes(monitorType));
  }

  // The event the monitor's log entry carries: why it was not evaluated.
  public static getEvent(reason: MonitorPauseReason): MonitorEvaluationEvent {
    const words: { title: EvaluationSentence; message: EvaluationSentence } =
      getNotEvaluatedWords(reason);

    return {
      type: "not-evaluated",
      ...EvaluationEventText.from({
        title: words.title,
        message: words.message,
      }),
      notEvaluatedReason: reason as MonitorEvaluationNotEvaluatedReason,
      at: OneUptimeDate.getCurrentDate(),
    };
  }

  /*
   * Whether this is OneUptime's own re-read of what arrived last - a
   * heartbeat sweep's or an online check's, which passes the last arrival
   * along rather than anything new - so nothing was sent: there is nothing
   * to list. One reaches a monitor that is not checked only when the pause
   * began between the sweep's read and the evaluation's.
   */
  public static isOwnCheck(dataToProcess: DataToProcess): boolean {
    const check: {
      onlyCheckForIncomingRequestReceivedAt?: boolean | undefined;
      onlyCheckForIncomingEmailReceivedAt?: boolean | undefined;
      onlyCheckRequestReceivedAt?: boolean | undefined;
    } = dataToProcess as never;

    return (
      check.onlyCheckForIncomingRequestReceivedAt === true ||
      check.onlyCheckForIncomingEmailReceivedAt === true ||
      check.onlyCheckRequestReceivedAt === true
    );
  }

  /*
   * Lists a result that reached the monitor while it was not being checked
   * in its Logs, as not evaluated and why, and keeps when it arrived. Only
   * for a type whose results are sent from outside, and only for what was
   * sent - never OneUptime's own re-read of it (isOwnCheck); read the
   * monitor with MONITOR_NOT_EVALUATED_SELECT. Best effort: it never throws,
   * so a refusal stays the refusal it was.
   */
  public static async record(data: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
    reason: MonitorPauseReason;
  }): Promise<void> {
    const monitor: Monitor = data.monitor;

    if (
      !monitor.id ||
      !monitor.projectId ||
      !MonitorNotEvaluated.isSentFromOutside(monitor.monitorType) ||
      MonitorNotEvaluated.isOwnCheck(data.dataToProcess)
    ) {
      return;
    }

    try {
      await MonitorNotEvaluated.keepArrival({
        monitor: monitor,
        dataToProcess: data.dataToProcess,
      });

      const evaluationSummary: MonitorEvaluationSummary = {
        evaluatedAt: OneUptimeDate.getCurrentDate(),
        criteriaResults: [],
        events: [MonitorNotEvaluated.getEvent(data.reason)],
      };

      MonitorLogUtil.saveMonitorLog({
        monitorId: monitor.id,
        projectId: monitor.projectId,
        dataToProcess: {
          ...data.dataToProcess,
          evaluationSummary: evaluationSummary,
        } as DataToProcess,
        keepResponseContent:
          MonitorRecordEvidence.keepsResponseContent(monitor),
        isNotEvaluated: true,
      });
    } catch (error) {
      logger.error(
        `Listing a result monitor ${monitor.id.toString()} received while it was not being checked failed: ${error}`,
      );
    }
  }

  /*
   * When it arrived, where the monitor's page and its heartbeat read it
   * (MonitorHeartbeatState): a request's arrival, and an agent's report -
   * so the server's online check does not judge the agent silent once the
   * monitor is checked again. An email's arrival is kept on the monitor by
   * its own ingest, paused or not.
   */
  private static async keepArrival(data: {
    monitor: Monitor;
    dataToProcess: DataToProcess;
  }): Promise<void> {
    if (data.monitor.monitorType === MonitorType.IncomingRequest) {
      const request: IncomingMonitorRequest =
        data.dataToProcess as IncomingMonitorRequest;

      if (
        request.onlyCheckForIncomingRequestReceivedAt ||
        !request.incomingRequestReceivedAt
      ) {
        return;
      }

      await MonitorHeartbeatState.recordIncomingRequest({
        monitorId: data.monitor.id!,
        receivedAt: request.incomingRequestReceivedAt,
      });

      return;
    }

    if (data.monitor.monitorType === MonitorType.Server) {
      const report: ServerMonitorResponse =
        data.dataToProcess as ServerMonitorResponse;

      if (report.onlyCheckRequestReceivedAt) {
        return;
      }

      await MonitorHeartbeatState.recordServerReport({
        monitorId: data.monitor.id!,
        receivedAt: report.requestReceivedAt,
      });
    }
  }
}
