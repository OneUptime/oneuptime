import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import AlertEpisodeOnCallRuleEngineService from "../../Services/AlertEpisodeOnCallRuleEngineService";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertOnCallRuleEngineService from "../../Services/AlertOnCallRuleEngineService";
import AlertService from "../../Services/AlertService";
import IncidentEpisodeOnCallRuleEngineService from "../../Services/IncidentEpisodeOnCallRuleEngineService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentOnCallRuleEngineService from "../../Services/IncidentOnCallRuleEngineService";
import IncidentService from "../../Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { getOnCallPolicyRunStartedEarlyReason } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPolicyAiHoldOutcome } from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
import { EventFieldSet } from "../EventFieldChange";
import logger, { LogAttributes } from "../Logger";

/*
 * A RECORD THAT CHANGED, AND ITS RUNS WAITING FOR WORKING HOURS.
 *
 * An on-call rule that pages only during working hours makes the runs it
 * starts outside them wait (OnCallRulePagingHold). The rules run once, when
 * the record is created: a P3 alert raised at 02:00 waits until 09:00. If
 * somebody raises it to P1 at 03:00, the P1 rule - which pages right away -
 * now matches it, and the alert should not wait any longer.
 *
 * So when a record changes in something its on-call rules read - its
 * severity, labels, title, description, or monitors - the runs of it still
 * waiting are matched against the rules again. Each run whose policy a
 * matching rule pages now - a rule that pages right away, or a working-hours
 * rule inside its hours - starts paging at once (startWaitingRun), and says
 * why in its record's feed and its Slack and Microsoft Teams message.
 *
 * Nothing else moves. A rule the record newly matches adds no policy to it:
 * the rules add policies when the record is created, and only then. A run is
 * never moved later, nor cancelled when its record drops to a lower
 * severity. A record acknowledged or resolved, or a run whose policy was
 * archived, is left to the worker, which ends those runs without paging
 * (ExecutePendingExecutions). Starting is claimed, so a run the worker starts
 * in the same moment pages once.
 */

// The kinds of record an on-call policy's run pages about.
export type WaitingRecordKind =
  | "alert"
  | "incident"
  | "alert episode"
  | "incident episode";

// What the early start reads of each waiting run: what starting it needs.
const WAITING_RUN_SELECT: {
  _id: true;
  projectId: true;
  status: true;
  pagingStartsAt: true;
  onCallDutyPolicyId: true;
  userNotificationEventType: true;
  triggeredByIncidentId: true;
  triggeredByAlertId: true;
  triggeredByAlertEpisodeId: true;
  triggeredByIncidentEpisodeId: true;
  onCallPolicyExecutionRepeatCount: true;
  aiHoldOutcome: true;
  createdAt: true;
  onCallDutyPolicy: { isArchived: true };
} = {
  _id: true,
  projectId: true,
  status: true,
  pagingStartsAt: true,
  onCallDutyPolicyId: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  onCallPolicyExecutionRepeatCount: true,
  aiHoldOutcome: true,
  createdAt: true,
  onCallDutyPolicy: { isArchived: true },
};

// One kind of record, as the early start reads and matches it.
interface WaitingRecordAccess<RecordType> {
  kind: WaitingRecordKind;
  // The run's column that names a record of this kind.
  runColumn:
    | "triggeredByAlertId"
    | "triggeredByIncidentId"
    | "triggeredByAlertEpisodeId"
    | "triggeredByIncidentEpisodeId";
  // The record, with what its on-call rules read.
  read: (recordId: ObjectID) => Promise<RecordType | null>;
  // Whether it is acknowledged or resolved: nobody needs paging.
  isHandled: (recordId: ObjectID) => Promise<boolean>;
  // The policies its matching rules page now, with those rules' names.
  getPoliciesPagingNow: (
    record: RecordType,
    now: Date,
  ) => Promise<Map<string, Array<string>>>;
}

const ALERT: WaitingRecordAccess<Alert> = {
  kind: "alert",
  runColumn: "triggeredByAlertId",
  read: async (alertId: ObjectID): Promise<Alert | null> => {
    return await AlertService.findOneById({
      id: alertId,
      select: {
        _id: true,
        projectId: true,
        monitorId: true,
        alertSeverityId: true,
        labels: { _id: true },
        title: true,
        description: true,
      },
      props: { isRoot: true },
    });
  },
  isHandled: async (alertId: ObjectID): Promise<boolean> => {
    return await AlertService.isAlertAcknowledged({ alertId: alertId });
  },
  getPoliciesPagingNow: async (
    alert: Alert,
    now: Date,
  ): Promise<Map<string, Array<string>>> => {
    return await AlertOnCallRuleEngineService.getPoliciesPagingNow(alert, now);
  },
};

const INCIDENT: WaitingRecordAccess<Incident> = {
  kind: "incident",
  runColumn: "triggeredByIncidentId",
  read: async (incidentId: ObjectID): Promise<Incident | null> => {
    return await IncidentService.findOneById({
      id: incidentId,
      select: {
        _id: true,
        projectId: true,
        incidentSeverityId: true,
        labels: { _id: true },
        monitors: { _id: true },
        title: true,
        description: true,
      },
      props: { isRoot: true },
    });
  },
  isHandled: async (incidentId: ObjectID): Promise<boolean> => {
    return await IncidentService.isIncidentAcknowledged({
      incidentId: incidentId,
    });
  },
  getPoliciesPagingNow: async (
    incident: Incident,
    now: Date,
  ): Promise<Map<string, Array<string>>> => {
    return await IncidentOnCallRuleEngineService.getPoliciesPagingNow(
      incident,
      now,
    );
  },
};

const ALERT_EPISODE: WaitingRecordAccess<AlertEpisode> = {
  kind: "alert episode",
  runColumn: "triggeredByAlertEpisodeId",
  read: async (episodeId: ObjectID): Promise<AlertEpisode | null> => {
    return await AlertEpisodeService.findOneById({
      id: episodeId,
      select: {
        _id: true,
        projectId: true,
        alertSeverityId: true,
        labels: { _id: true },
        title: true,
        description: true,
      },
      props: { isRoot: true },
    });
  },
  isHandled: async (episodeId: ObjectID): Promise<boolean> => {
    return await AlertEpisodeService.isEpisodeAcknowledged({
      episodeId: episodeId,
    });
  },
  getPoliciesPagingNow: async (
    episode: AlertEpisode,
    now: Date,
  ): Promise<Map<string, Array<string>>> => {
    return await AlertEpisodeOnCallRuleEngineService.getPoliciesPagingNow(
      episode,
      now,
    );
  },
};

const INCIDENT_EPISODE: WaitingRecordAccess<IncidentEpisode> = {
  kind: "incident episode",
  runColumn: "triggeredByIncidentEpisodeId",
  read: async (episodeId: ObjectID): Promise<IncidentEpisode | null> => {
    return await IncidentEpisodeService.findOneById({
      id: episodeId,
      select: {
        _id: true,
        projectId: true,
        incidentSeverityId: true,
        labels: { _id: true },
        title: true,
        description: true,
      },
      props: { isRoot: true },
    });
  },
  isHandled: async (episodeId: ObjectID): Promise<boolean> => {
    return await IncidentEpisodeService.isEpisodeAcknowledged({
      episodeId: episodeId,
    });
  },
  getPoliciesPagingNow: async (
    episode: IncidentEpisode,
    now: Date,
  ): Promise<Map<string, Array<string>>> => {
    return await IncidentEpisodeOnCallRuleEngineService.getPoliciesPagingNow(
      episode,
      now,
    );
  },
};

// The text columns of a record that its on-call rules read.
const RULE_TEXT_COLUMNS: ReadonlyArray<string> = ["title", "description"];

export default class WaitingRunsOnRecordChange {
  /*
   * Whether an update to an alert or an incident changed something its
   * on-call rules read: its severity, labels, title, description or
   * monitors - compared with what it held before the write. Writing back
   * what a record holds, as every save of a card does, changes none.
   */
  public static isRuleInputChanged(data: {
    isSeverityChanged: boolean;
    fieldChanges: EventFieldSet;
    isMonitorChanged: boolean;
  }): boolean {
    return (
      data.isSeverityChanged ||
      data.fieldChanges.labels ||
      data.fieldChanges.textColumns.some((column: string): boolean => {
        return RULE_TEXT_COLUMNS.includes(column);
      }) ||
      data.isMonitorChanged
    );
  }

  /*
   * Whether an update to an episode writes something its on-call rules
   * read: its severity (under either of its names), labels, title or
   * description. An episode's severity follows its members
   * (updateEpisodeSeverity), which writes only when it rises.
   */
  public static isRuleInputWritten(data: {
    written: Record<string, unknown>;
    severityKeys: ReadonlyArray<string>;
  }): boolean {
    return [...data.severityKeys, "labels", ...RULE_TEXT_COLUMNS].some(
      (key: string): boolean => {
        return Object.prototype.hasOwnProperty.call(data.written, key);
      },
    );
  }

  public static async startForAlert(alertId: ObjectID): Promise<number> {
    return await this.start(alertId, ALERT);
  }

  public static async startForIncident(incidentId: ObjectID): Promise<number> {
    return await this.start(incidentId, INCIDENT);
  }

  public static async startForAlertEpisode(
    episodeId: ObjectID,
  ): Promise<number> {
    return await this.start(episodeId, ALERT_EPISODE);
  }

  public static async startForIncidentEpisode(
    episodeId: ObjectID,
  ): Promise<number> {
    return await this.start(episodeId, INCIDENT_EPISODE);
  }

  /*
   * Starts the record's waiting runs that a matching rule pages now, and
   * says how many it started. One that another start - the worker's -
   * claims first is not counted.
   */
  private static async start<RecordType>(
    recordId: ObjectID,
    access: WaitingRecordAccess<RecordType>,
  ): Promise<number> {
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          [access.runColumn]: recordId,
          status: OnCallDutyPolicyStatus.Waiting,
        },
        select: WAITING_RUN_SELECT,
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: { isRoot: true },
      });

    // A run whose policy was archived is the worker's to end.
    const startable: Array<OnCallDutyPolicyExecutionLog> = runs.filter(
      (run: OnCallDutyPolicyExecutionLog): boolean => {
        return Boolean(
          run.id &&
            run.onCallDutyPolicyId &&
            run.onCallDutyPolicy?.isArchived !== true,
        );
      },
    );

    if (startable.length === 0) {
      return 0;
    }

    // Acknowledged or resolved, it needs nobody: the worker ends its runs.
    if (await access.isHandled(recordId)) {
      return 0;
    }

    const record: RecordType | null = await access.read(recordId);

    if (!record) {
      return 0;
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const pagingNow: Map<
      string,
      Array<string>
    > = await access.getPoliciesPagingNow(record, now);

    let started: number = 0;

    for (const run of startable) {
      const ruleNames: Array<string> | undefined = pagingNow.get(
        run.onCallDutyPolicyId!.toString(),
      );

      // No rule that matches it now pages its policy before its hours.
      if (!ruleNames) {
        continue;
      }

      try {
        const isStarted: boolean =
          await OnCallDutyPolicyExecutionLogService.startWaitingRun({
            run: run,
            now: now,
            startedEarlyReason: getOnCallPolicyRunStartedEarlyReason({
              recordKind: access.kind,
              ruleNames: ruleNames,
            }),
            // A page OneUptime AI held goes to people: its hold is handed off.
            aiHoldOutcome:
              run.aiHoldOutcome === OnCallPolicyAiHoldOutcome.Holding
                ? OnCallPolicyAiHoldOutcome.HandedOff
                : undefined,
          });

        if (isStarted) {
          started++;
        }
      } catch (err) {
        logger.error(
          `Could not start on-call execution log ${run.id!.toString()} early for its ${access.kind} ${recordId.toString()}.`,
          { projectId: run.projectId?.toString() } as LogAttributes,
        );
        logger.error(err as Error);
      }
    }

    return started;
  }
}
