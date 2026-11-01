import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import { IsDevelopment } from "Common/Server/EnvironmentConfig";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogService, {
  NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
  notOptOutRuleQuery,
} from "Common/Server/Services/UserOnCallLogService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership, {
  ProjectUserPair,
} from "Common/Server/Utils/TeamMember/ProjectMembership";
import Incident from "Common/Models/DatabaseModels/Incident";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import BadDataException from "Common/Types/Exception/BadDataException";
import {
  getDueRuleExecution,
  isRuleFullyExecuted,
} from "Common/Types/NotificationRule/NotificationRepeat";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import ObjectID from "Common/Types/ObjectID";
import { isOnCallPageAgainRun } from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import { isOnCallPersonPage } from "Common/Types/OnCallDutyPolicy/OnCallPersonPage";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
} from "Common/Server/Utils/OnCall/OnCallAcknowledgementTimeout";

RunCron(
  "UserOnCallLog:ExecutePendingExecutions",
  {
    schedule: IsDevelopment ? EVERY_MINUTE : EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const pendingNotificationLogs: Array<UserOnCallLog> =
      await UserOnCallLogService.findAllBy({
        query: {
          status: UserNotificationExecutionStatus.Executing,
        },
        select: {
          _id: true,
          projectId: true,
          createdAt: true,
          executedNotificationRules: true,
          userId: true,
          userNotificationEventType: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          triggeredByIncidentEpisodeId: true,
          onCallDutyPolicyEscalationRuleId: true,
          onCallDutyPolicyExecutionLogTimelineId: true,
          onCallDutyPolicyExecutionLogId: true,
          onCallDutyPolicyId: true,
          onCallDutyScheduleId: true,
          userBelongsToTeamId: true,
          /*
           * A page again goes on until the run itself is acknowledged
           * (OnCallAcknowledgementTimeout): its record was acknowledged all
           * along. So does a page a person asked for (OnCallPersonPage),
           * told apart by who started it.
           */
          onCallDutyPolicyExecutionLog: {
            pageAgainNumber: true,
            acknowledgedAt: true,
            onCallDutyPolicyId: true,
            triggeredByUserId: true,
            triggeredByWorkflowId: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    /*
     * A log keeps running its later rules ("call me after 10 minutes") for as
     * long as the incident is not acknowledged, so the person it pages may
     * have left the project since it started. Whether each one is still a
     * member is read once for the whole tick (ProjectMembership).
     *
     * If membership cannot be read, the tick runs every log as it did before
     * this check rather than none of them: a page lost to a failed read is
     * worse than one more read next minute. That cannot reach somebody who
     * is not a member: the read of the rules a log runs carries the
     * membership condition itself.
     */
    let memberKeys: Set<string> | null = null;

    try {
      memberKeys = await ProjectMembership.getMemberKeys(
        pendingNotificationLogs
          .filter((log: UserOnCallLog): boolean => {
            return Boolean(log.projectId && log.userId);
          })
          .map((log: UserOnCallLog): ProjectUserPair => {
            return {
              projectId: log.projectId!,
              userId: log.userId!,
            };
          }),
      );
    } catch (err) {
      logger.error(
        "Could not read project membership for pending on-call logs; running them without the membership check.",
      );
      logger.error(err as Error);
    }

    const promises: Array<Promise<void>> = [];

    for (const pendingNotificationLog of pendingNotificationLogs) {
      promises.push(
        executePendingNotificationLog(pendingNotificationLog, {
          isProjectMember:
            memberKeys === null ||
            Boolean(
              pendingNotificationLog.projectId &&
                pendingNotificationLog.userId &&
                memberKeys.has(
                  ProjectMembership.getKey(
                    pendingNotificationLog.projectId,
                    pendingNotificationLog.userId,
                  ),
                ),
            ),
        }),
      );
    }

    await Promise.allSettled(promises);
  },
);

type ExecutePendingNotificationLogFunction = (
  pendingNotificationLog: UserOnCallLog,
  membership: {
    // Whether the person this log pages is a member of its project now.
    isProjectMember: boolean;
  },
) => Promise<void>;

const executePendingNotificationLog: ExecutePendingNotificationLogFunction =
  async (
    pendingNotificationLog: UserOnCallLog,
    membership: { isProjectMember: boolean },
  ): Promise<void> => {
    try {
      if (!membership.isProjectMember) {
        /*
         * Somebody who has left is not paged again on the project's behalf:
         * the log ends here and the rules still due for them are not run.
         */
        await UserOnCallLogService.updateOneById({
          id: pendingNotificationLog.id!,
          data: {
            status: UserNotificationExecutionStatus.Completed,
            statusMessage: NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
          },
          props: {
            isRoot: true,
          },
        });

        return;
      }

      const ruleType: NotificationRuleType =
        UserOnCallLogService.getNotificationRuleType(
          pendingNotificationLog.userNotificationEventType!,
        );

      let incident: Incident | null = null;
      let alert: Alert | null = null;
      let alertEpisode: AlertEpisode | null = null;
      let incidentEpisode: IncidentEpisode | null = null;

      if (pendingNotificationLog.triggeredByIncidentId) {
        incident = await IncidentService.findOneById({
          id: pendingNotificationLog.triggeredByIncidentId!,
          props: {
            isRoot: true,
          },
          select: {
            incidentSeverityId: true,
          },
        });
      }

      if (pendingNotificationLog.triggeredByAlertId) {
        alert = await AlertService.findOneById({
          id: pendingNotificationLog.triggeredByAlertId!,
          props: {
            isRoot: true,
          },
          select: {
            alertSeverityId: true,
          },
        });
      }

      if (pendingNotificationLog.triggeredByAlertEpisodeId) {
        alertEpisode = await AlertEpisodeService.findOneById({
          id: pendingNotificationLog.triggeredByAlertEpisodeId!,
          props: {
            isRoot: true,
          },
          select: {
            alertSeverityId: true,
          },
        });
      }

      if (pendingNotificationLog.triggeredByIncidentEpisodeId) {
        incidentEpisode = await IncidentEpisodeService.findOneById({
          id: pendingNotificationLog.triggeredByIncidentEpisodeId!,
          props: {
            isRoot: true,
          },
          select: {
            incidentSeverityId: true,
          },
        });
      }

      if (!incident && !alert && !alertEpisode && !incidentEpisode) {
        throw new Error(
          "Incident, Alert, Alert Episode, or Incident Episode not found.",
        );
      }

      /*
       * A person's page in a page again (OnCallAcknowledgementTimeout) is
       * about a record that was acknowledged all along, so the record being
       * acknowledged ends nothing: the page goes on until somebody
       * acknowledges the page again, or the record is resolved.
       *
       * So does a page a person asked for from Slack or Microsoft Teams
       * (OnCallPersonPage): somebody else acknowledging the record does not
       * mean the people they paged have seen it - the record is often
       * acknowledged before they page at all.
       */
      const pageRun: OnCallDutyPolicyExecutionLog | undefined =
        pendingNotificationLog.onCallDutyPolicyExecutionLog;
      const isPageAgain: boolean = isOnCallPageAgainRun(pageRun);
      const isPersonPage: boolean = isOnCallPersonPage(pageRun);
      const endsWhenAnsweredOrResolved: boolean = isPageAgain || isPersonPage;

      if (endsWhenAnsweredOrResolved) {
        const record: {
          kind: OnCallTimeoutRecordKind;
          recordId: ObjectID;
        } | null = OnCallAcknowledgementTimeout.getRunRecord(
          pendingNotificationLog,
        );

        const overReason: string | null = record
          ? await OnCallAcknowledgementTimeout.getPageAgainOverReason({
              run: pageRun!,
              kind: record.kind,
              recordId: record.recordId,
            })
          : null;

        if (overReason) {
          await UserOnCallLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
              status: UserNotificationExecutionStatus.Completed,
              statusMessage: `Execution completed because ${overReason}.`,
            },
            props: {
              isRoot: true,
            },
          });
          return;
        }
      }

      if (incident && !endsWhenAnsweredOrResolved) {
        // check if the incident is acknowledged.
        const isAcknowledged: boolean =
          await IncidentService.isIncidentAcknowledged({
            incidentId: pendingNotificationLog.triggeredByIncidentId!,
          });
        if (isAcknowledged) {
          // then mark this policy as executed.
          await UserOnCallLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
              status: UserNotificationExecutionStatus.Completed,
              statusMessage:
                "Execution completed because incident is acknowledged.",
            },
            props: {
              isRoot: true,
            },
          });
          return;
        }
      }

      if (alert && !endsWhenAnsweredOrResolved) {
        // check if the alert is acknowledged.
        const isAcknowledged: boolean = await AlertService.isAlertAcknowledged({
          alertId: pendingNotificationLog.triggeredByAlertId!,
        });

        if (isAcknowledged) {
          // then mark this policy as executed.
          await UserOnCallLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
              status: UserNotificationExecutionStatus.Completed,
              statusMessage:
                "Execution completed because alert is acknowledged.",
            },
            props: {
              isRoot: true,
            },
          });
          return;
        }
      }

      if (alertEpisode && !endsWhenAnsweredOrResolved) {
        // check if the alert episode is acknowledged.
        const isAcknowledged: boolean =
          await AlertEpisodeService.isEpisodeAcknowledged({
            episodeId: pendingNotificationLog.triggeredByAlertEpisodeId!,
          });

        if (isAcknowledged) {
          // then mark this policy as executed.
          await UserOnCallLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
              status: UserNotificationExecutionStatus.Completed,
              statusMessage:
                "Execution completed because alert episode is acknowledged.",
            },
            props: {
              isRoot: true,
            },
          });
          return;
        }
      }

      if (incidentEpisode && !endsWhenAnsweredOrResolved) {
        // check if the incident episode is acknowledged.
        const isAcknowledged: boolean =
          await IncidentEpisodeService.isEpisodeAcknowledged({
            episodeId: pendingNotificationLog.triggeredByIncidentEpisodeId!,
          });

        if (isAcknowledged) {
          // then mark this policy as executed.
          await UserOnCallLogService.updateOneById({
            id: pendingNotificationLog.id!,
            data: {
              status: UserNotificationExecutionStatus.Completed,
              statusMessage:
                "Execution completed because incident episode is acknowledged.",
            },
            props: {
              isRoot: true,
            },
          });
          return;
        }
      }

      const notificationRules: Array<UserNotificationRule> =
        await UserNotificationRuleService.findBy({
          query: {
            projectId: pendingNotificationLog.projectId!,
            /*
             * The person's rules, and only while they are a member of the
             * project: the condition rides on this read, so a log run
             * without the tick's membership check (it could not be read)
             * still reaches nobody who is not a member (ProjectMembership).
             */
            userId: ProjectMembership.userIdWhileMember({
              userId: pendingNotificationLog.userId!,
              projectId: pendingNotificationLog.projectId!,
            }),
            ruleType: ruleType,
            incidentSeverityId:
              incident?.incidentSeverityId ||
              incidentEpisode?.incidentSeverityId ||
              undefined,
            alertSeverityId:
              alert?.alertSeverityId ||
              alertEpisode?.alertSeverityId ||
              undefined,
            /*
             * Opt-out rows are not rules. They carry exactly the columns this
             * query filters on and no notification method at all, so without
             * this predicate one would be selected here, handed to
             * executeNotificationRuleItem, and "executed" - sending nothing
             * while its timeline row reports a notification. It would also
             * count as an outstanding rule for `isAllExecuted`, so the log
             * stays Executing for an extra tick and burns its claim on a
             * delivery that never happens. notOptOutRuleQuery is NULL-safe on
             * purpose; isOptOut is nullable and is NULL on every rule written
             * before the column existed, so a plain `false` here would exclude
             * every real rule and stop all escalation.
             */
            isOptOut: notOptOutRuleQuery(),
          },
          select: {
            _id: true,
            notifyAfterMinutes: true,
            // Whether the rule's push repeats until acknowledged.
            repeatEveryMinutes: true,
          },
          props: {
            isRoot: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
        });

      let isAllExecuted: boolean = true;

      const minutesSinceExecutionStarted: number =
        OneUptimeDate.getDifferenceInMinutes(
          pendingNotificationLog.createdAt!,
          OneUptimeDate.getCurrentDate(),
        );

      /*
       * Every delivery already sent on this log: each rule's first push under
       * the rule's id, each repeat under a key of its own (NotificationRepeat).
       */
      const executedClaimKeys: Array<string> = Object.keys(
        pendingNotificationLog.executedNotificationRules! || {},
      );

      for (const notificationRule of notificationRules) {
        const ruleId: string = notificationRule.id?.toString() || "";

        // Its first push, and every repeat it has, already sent.
        if (
          isRuleFullyExecuted({
            executedClaimKeys: executedClaimKeys,
            ruleId: ruleId,
            repeatEveryMinutes: notificationRule.repeatEveryMinutes,
          })
        ) {
          continue;
        }

        isAllExecuted = false;

        /*
         * The first push once it is due, then - for a rule that repeats until
         * acknowledged - the latest repeat due. Acknowledging ends the log
         * above, which is what stops the repeats.
         */
        const dueExecution: number | null = getDueRuleExecution({
          executedClaimKeys: executedClaimKeys,
          ruleId: ruleId,
          notifyAfterMinutes: notificationRule.notifyAfterMinutes || 0,
          repeatEveryMinutes: notificationRule.repeatEveryMinutes,
          minutesSinceStart: minutesSinceExecutionStarted,
        });

        if (dueExecution === null) {
          continue;
        }

        // execute this rule.

        await UserNotificationRuleService.executeNotificationRuleItem(
          notificationRule.id!,
          {
            userNotificationLogId: pendingNotificationLog.id!,
            projectId: pendingNotificationLog.projectId!,
            triggeredByIncidentId: pendingNotificationLog.triggeredByIncidentId,
            triggeredByAlertId: pendingNotificationLog.triggeredByAlertId,
            triggeredByAlertEpisodeId:
              pendingNotificationLog.triggeredByAlertEpisodeId,
            triggeredByIncidentEpisodeId:
              pendingNotificationLog.triggeredByIncidentEpisodeId,
            userNotificationEventType:
              pendingNotificationLog.userNotificationEventType!,
            onCallPolicyExecutionLogId:
              pendingNotificationLog.onCallDutyPolicyExecutionLogId,
            onCallPolicyId: pendingNotificationLog.onCallDutyPolicyId,
            onCallPolicyEscalationRuleId:
              pendingNotificationLog.onCallDutyPolicyEscalationRuleId,
            userBelongsToTeamId: pendingNotificationLog.userBelongsToTeamId,
            onCallDutyPolicyExecutionLogTimelineId:
              pendingNotificationLog.onCallDutyPolicyExecutionLogTimelineId,
            onCallScheduleId: pendingNotificationLog.onCallDutyScheduleId,
            ...(dueExecution > 0 ? { repeatNumber: dueExecution } : {}),
          },
        );
      }

      if (isAllExecuted) {
        // mark this log as complete.
        await UserOnCallLogService.updateOneById({
          id: pendingNotificationLog.id!,
          data: {
            status: UserNotificationExecutionStatus.Completed,
          },
          props: {
            isRoot: true,
          },
        });
      }
    } catch (err: any) {
      logger.error(
        `Error executing pending notification log: ${pendingNotificationLog._id}`,
      );
      logger.error(err);

      /*
       * Only mark the log Error for PERMANENT failures (bad/missing data a retry
       * cannot fix). Error is terminal — no worker re-selects an Error
       * UserOnCallLog (ExecutePendingExecutions queries Executing,
       * TimeoutStuckExecutions queries Started) — so forcing EVERY error to Error
       * meant one transient DB blip (connection reset, pool timeout) during a
       * single tick permanently dropped the user's not-yet-fired escalation
       * steps, including the loud last-resort "call at N minutes" page (audit
       * H3). For a transient/unknown error we LEAVE the log Executing (only log
       * it) so the next EVERY_MINUTE tick retries. Retries are idempotent: the
       * loop above skips deliveries already in executedNotificationRules - a
       * rule's first push and each repeat - so none is re-sent. Mirrors the
       * F16 rationale that a delayed retry beats a dropped page for an on-call
       * system.
       */
      if (err instanceof BadDataException) {
        await UserOnCallLogService.updateOneById({
          id: pendingNotificationLog.id!,
          data: {
            status: UserNotificationExecutionStatus.Error,
            statusMessage: err.message ? err.message : "Unknown error",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  };

export { executePendingNotificationLog };
