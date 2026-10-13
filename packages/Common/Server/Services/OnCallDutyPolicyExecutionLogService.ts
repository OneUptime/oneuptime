import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ProjectReferencesService from "./ProjectReferencesService";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyStatus from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import UserNotificationEventType from "../../Types/UserNotification/UserNotificationEventType";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { IsBillingEnabled } from "../EnvironmentConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Blue500, Green500, Red500, Yellow500 } from "../../Types/BrandColors";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ObjectID from "../../Types/ObjectID";

import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import Color from "../../Types/Color";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import BadDataException from "../../Types/Exception/BadDataException";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import { IsNull, UpdateResult } from "typeorm";
import FeedMarkdown from "../../Utils/Markdown/FeedMarkdown";
import OnCallPolicyRunMessage from "../Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallFeedText from "../Utils/OnCall/OnCallFeedText";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 30);
    }
  }

  /*
   * Execution logs are written by OneUptime as it runs an on-call policy, for
   * the policy, incident or alert it is paging about. Refusing one would stop
   * the page. An execution log written by an API call or a workflow is checked
   * like any other write.
   */
  protected override checksServerWrites(): boolean {
    return false;
  }

  /**
   * Atomically claim the right to advance this execution to its next escalation
   * rule on the current tick. Implemented as a single conditional
   * `UPDATE ... WHERE lastEscalationRuleExecutedAt = <the value just read>`
   * (via TypeORM's repository.update, which emits one atomic statement and
   * returns the affected-row count), so that when two overlapping cron runs read
   * the same lastEscalationRuleExecutedAt, exactly one wins — the loser sees
   * `affected === 0` and bows out instead of double-paging responders (audit
   * F13). `updateOneBy` could NOT provide this: it does a non-locking SELECT and
   * then `save()` keyed only on `_id`, and returns the SELECT match count, so
   * both overlapping runs would "win".
   */
  @CaptureSpan()
  public async claimEscalationAdvance(data: {
    executionLogId: ObjectID;
    previousLastEscalationRuleExecutedAt: Date | null;
    newLastEscalationRuleExecutedAt: Date;
  }): Promise<boolean> {
    const whereClause: Record<string, unknown> = {
      _id: data.executionLogId.toString(),
      status: OnCallDutyPolicyStatus.Executing,
      lastEscalationRuleExecutedAt: data.previousLastEscalationRuleExecutedAt
        ? data.previousLastEscalationRuleExecutedAt
        : IsNull(),
    };

    const result: UpdateResult = await this.getRepository().update(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      whereClause as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      {
        lastEscalationRuleExecutedAt: data.newLastEscalationRuleExecutedAt,
      } as any,
    );

    return (result.affected || 0) > 0;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.status) {
      createBy.data.status = OnCallDutyPolicyStatus.Scheduled;
    }

    if (!createBy.data.statusMessage) {
      createBy.data.statusMessage = "Scheduled.";
    }

    /*
     * Triggered by the person making the request. DatabaseService has
     * already taken out whatever triggeredByUser the request named, under
     * both names (UserAttribution), so with no person on it - an API key, a
     * workflow - nobody triggered it by hand. Stamped with stamp, so a
     * relation a server caller names beside it is not what is stored.
     */
    if (createBy.props.userId) {
      RelationIdUtil.stamp(
        createBy.data as unknown as Record<string, unknown>,
        ["triggeredByUserId", "triggeredByUser"],
        createBy.props.userId,
      );
    }

    createBy.data.onCallPolicyExecutionRepeatCount = 1;

    /*
     * An archived policy pages no one, however its execution is asked for:
     * a record's Execute On-Call Policy in the dashboard, the API, Slack or
     * Microsoft Teams (OnCallDutyPolicyArchive). The log is still written,
     * with the reason, so "why was nobody paged?" has an answer on the
     * record; onCreateSuccess then starts no escalation.
     */
    const isPolicyArchived: boolean = await this.isPolicyArchived(
      createBy.data,
    );

    if (isPolicyArchived) {
      createBy.data.status = OnCallDutyPolicyStatus.Error;
      createBy.data.statusMessage =
        ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE;
    }

    return {
      createBy,
      carryForward: {
        isPolicyArchived: isPolicyArchived,
      },
    };
  }

  // Whether the policy an execution log is for is archived, read as OneUptime.
  private async isPolicyArchived(data: Model): Promise<boolean> {
    const policyId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["onCallDutyPolicyId", "onCallDutyPolicy"],
      "On-Call Duty Policy",
    );

    if (!policyId) {
      return false;
    }

    const policy: OnCallDutyPolicy | null =
      await OnCallDutyPolicyService.findOneById({
        id: policyId,
        select: {
          isArchived: true,
        },
        props: {
          isRoot: true,
        },
      });

    return policy?.isArchived === true;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * The run's one message in Slack and Microsoft Teams (OnCallPolicyRunMessage).
     * It is posted once the run has something to say - its first escalation
     * rule, or how it ended - and edited after that; this and every later
     * change to the run only ask for it to be brought up to date.
     */
    OnCallPolicyRunMessage.refresh(createdItem.id);

    // An archived policy's log says why nobody was paged; nothing follows it.
    if (
      (onCreate.carryForward as { isPolicyArchived?: boolean } | null)
        ?.isPolicyArchived
    ) {
      return createdItem;
    }

    if (
      createdItem.triggeredByIncidentId ||
      createdItem.triggeredByAlertId ||
      createdItem.triggeredByAlertEpisodeId ||
      createdItem.triggeredByIncidentEpisodeId
    ) {
      const onCallPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: createdItem.onCallDutyPolicyId!,
          select: {
            _id: true,
            projectId: true,
            name: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (onCallPolicy && onCallPolicy.id) {
        /*
         * One sentence (OnCallFeedText). Started by hand - Execute On-Call
         * Policy in a feed's Actions - it is credited to that person, and
         * reads after their name: "Nitin started on-call policy PolicyX".
         */
        const startedByUserId: ObjectID | undefined =
          createdItem.createdByUserId || createdItem.triggeredByUserId;

        const feedInfoInMarkdown: string = OnCallFeedText.getRunStartedMarkdown(
          {
            policyLink: FeedMarkdown.link(
              onCallPolicy.name || "",
              (
                await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                  onCallPolicy.projectId!,
                  onCallPolicy.id!,
                )
              ).toString(),
            ),
            isStartedBySomeone: Boolean(startedByUserId),
          },
        );

        // The feed only: Slack and Teams get the run's one message instead.
        if (
          onCallPolicy &&
          onCallPolicy.id &&
          createdItem.triggeredByIncidentId
        ) {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId: createdItem.triggeredByIncidentId,
            projectId: createdItem.projectId!,
            incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
            displayColor: Yellow500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: startedByUserId,
          });
        }

        if (onCallPolicy && onCallPolicy.id && createdItem.triggeredByAlertId) {
          await AlertFeedService.createAlertFeedItem({
            alertId: createdItem.triggeredByAlertId,
            projectId: createdItem.projectId!,
            alertFeedEventType: AlertFeedEventType.OnCallPolicy,
            displayColor: Yellow500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: startedByUserId,
          });
        }

        if (
          onCallPolicy &&
          onCallPolicy.id &&
          createdItem.triggeredByAlertEpisodeId
        ) {
          await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
            alertEpisodeId: createdItem.triggeredByAlertEpisodeId,
            projectId: createdItem.projectId!,
            alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OnCallPolicy,
            displayColor: Yellow500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: startedByUserId,
          });
        }

        if (
          onCallPolicy &&
          onCallPolicy.id &&
          createdItem.triggeredByIncidentEpisodeId
        ) {
          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: createdItem.triggeredByIncidentEpisodeId,
            projectId: createdItem.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.OnCallPolicy,
            displayColor: Yellow500,
            feedInfoInMarkdown: feedInfoInMarkdown,
            userId: startedByUserId,
          });
        }
      }
    }

    // get execution rules in this policy adn execute the first rule.
    const executionRule: OnCallDutyPolicyEscalationRule | null =
      await OnCallDutyPolicyEscalationRuleService.findOneBy({
        query: {
          projectId: createdItem.projectId!,
          onCallDutyPolicyId: createdItem.onCallDutyPolicyId!,
          order: 1,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

    if (executionRule) {
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          status: OnCallDutyPolicyStatus.Started,
          statusMessage: "Execution started...",
        },
        props: {
          isRoot: true,
        },
      });

      let userNotificationEventType: UserNotificationEventType | null = null;

      if (createdItem.triggeredByIncidentId) {
        userNotificationEventType = UserNotificationEventType.IncidentCreated;
      }

      if (createdItem.triggeredByAlertId) {
        userNotificationEventType = UserNotificationEventType.AlertCreated;
      }

      if (createdItem.triggeredByAlertEpisodeId) {
        userNotificationEventType =
          UserNotificationEventType.AlertEpisodeCreated;
      }

      if (createdItem.triggeredByIncidentEpisodeId) {
        userNotificationEventType =
          UserNotificationEventType.IncidentEpisodeCreated;
      }

      if (!userNotificationEventType) {
        throw new BadDataException("Invalid userNotificationEventType");
      }

      await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
        executionRule.id!,
        {
          projectId: createdItem.projectId!,
          triggeredByIncidentId: createdItem.triggeredByIncidentId,
          triggeredByAlertId: createdItem.triggeredByAlertId,
          triggeredByAlertEpisodeId: createdItem.triggeredByAlertEpisodeId,
          triggeredByIncidentEpisodeId:
            createdItem.triggeredByIncidentEpisodeId,
          userNotificationEventType: userNotificationEventType,
          onCallPolicyExecutionLogId: createdItem.id!,
          onCallPolicyId: createdItem.onCallDutyPolicyId!,
        },
      );

      await this.updateOneById({
        id: createdItem.id!,
        data: {
          status: OnCallDutyPolicyStatus.Executing,
          statusMessage: "First escalation rule executed...",
        },
        props: {
          isRoot: true,
        },
      });
    } else {
      await this.updateOneById({
        id: createdItem.id!,
        data: {
          status: OnCallDutyPolicyStatus.Error,
          statusMessage:
            "No Escalation Rules in Policy. Please add escalation rules to this policy.",
        },
        props: {
          isRoot: true,
        },
      });
    }

    return createdItem;
  }

  public getDisplayColorByStatus(status: OnCallDutyPolicyStatus): Color {
    switch (status) {
      case OnCallDutyPolicyStatus.Scheduled:
        return Blue500;
      case OnCallDutyPolicyStatus.Started:
        return Yellow500;
      case OnCallDutyPolicyStatus.Executing:
        return Yellow500;
      case OnCallDutyPolicyStatus.Completed:
        return Green500;
      /*
       * Amber, not green: the policy finished, but finishing without paging
       * anyone is a failure of the thing the policy exists to do.
       */
      case OnCallDutyPolicyStatus.CompletedWithNoNotifications:
        return Yellow500;
      case OnCallDutyPolicyStatus.Error:
        return Red500;
      default:
        return Blue500;
    }
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Every change to a run - its status, the escalation rule it is on, a
     * repeat, who acknowledged - can change what its Slack / Microsoft Teams
     * message says (OnCallPolicyRunMessage).
     */
    for (const id of updatedItemIds) {
      OnCallPolicyRunMessage.refresh(id);
    }

    /*
     * When the status is updated, each execution log the update wrote that
     * an incident, an alert or an episode triggered adds its new status to
     * that record's feed - when the status is news there: how the run ended.
     * Its start is already in the feed (onCreateSuccess) and so is every
     * page it sent, so "started" and "executing" would only say it again
     * (OnCallFeedText.isRunStatusFeedNews).
     */
    if (
      !onUpdate.updateBy.data.status ||
      !OnCallFeedText.isRunStatusFeedNews(
        onUpdate.updateBy.data.status as OnCallDutyPolicyStatus,
      )
    ) {
      return onUpdate;
    }

    for (const id of updatedItemIds) {
      const onCalldutyPolicyExecutionLog: Model | null = await this.findOneById(
        {
          id: id,
          select: {
            _id: true,
            projectId: true,
            onCallDutyPolicyId: true,
            status: true,
            statusMessage: true,
            triggeredByIncidentId: true,
            triggeredByAlertId: true,
            triggeredByAlertEpisodeId: true,
            triggeredByIncidentEpisodeId: true,
          },
          props: {
            isRoot: true,
          },
        },
      );

      if (
        onCalldutyPolicyExecutionLog &&
        (onCalldutyPolicyExecutionLog.triggeredByIncidentId ||
          onCalldutyPolicyExecutionLog.triggeredByAlertId ||
          onCalldutyPolicyExecutionLog.triggeredByAlertEpisodeId ||
          onCalldutyPolicyExecutionLog.triggeredByIncidentEpisodeId)
      ) {
        const onCallPolicy: OnCallDutyPolicy | null =
          await OnCallDutyPolicyService.findOneById({
            id: onCalldutyPolicyExecutionLog.onCallDutyPolicyId!,
            select: {
              _id: true,
              projectId: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (onCallPolicy && onCallPolicy.id) {
          // One sentence, and why when that adds something (OnCallFeedText).
          const feedInfoInMarkdown: string =
            OnCallFeedText.getRunStatusMarkdown({
              status: onCalldutyPolicyExecutionLog.status!,
              policyLink: FeedMarkdown.link(
                onCallPolicy.name || "",
                (
                  await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                    onCallPolicy.projectId!,
                    onCallPolicy.id!,
                  )
                ).toString(),
              ),
              statusMessage: onCalldutyPolicyExecutionLog.statusMessage,
            });

          // The feed only: Slack and Teams get the run's one message instead.
          if (onCalldutyPolicyExecutionLog.triggeredByIncidentId) {
            await IncidentFeedService.createIncidentFeedItem({
              incidentId: onCalldutyPolicyExecutionLog.triggeredByIncidentId,
              projectId: onCalldutyPolicyExecutionLog.projectId!,
              incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
              displayColor: onCalldutyPolicyExecutionLog.status
                ? this.getDisplayColorByStatus(
                    onCalldutyPolicyExecutionLog.status,
                  )
                : Blue500,
              feedInfoInMarkdown: feedInfoInMarkdown,
            });
          }

          if (onCalldutyPolicyExecutionLog.triggeredByAlertId) {
            await AlertFeedService.createAlertFeedItem({
              alertId: onCalldutyPolicyExecutionLog.triggeredByAlertId,
              projectId: onCalldutyPolicyExecutionLog.projectId!,
              alertFeedEventType: AlertFeedEventType.OnCallPolicy,
              displayColor: onCalldutyPolicyExecutionLog.status
                ? this.getDisplayColorByStatus(
                    onCalldutyPolicyExecutionLog.status,
                  )
                : Blue500,
              feedInfoInMarkdown: feedInfoInMarkdown,
            });
          }

          if (onCalldutyPolicyExecutionLog.triggeredByAlertEpisodeId) {
            await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
              alertEpisodeId:
                onCalldutyPolicyExecutionLog.triggeredByAlertEpisodeId,
              projectId: onCalldutyPolicyExecutionLog.projectId!,
              alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OnCallPolicy,
              displayColor: onCalldutyPolicyExecutionLog.status
                ? this.getDisplayColorByStatus(
                    onCalldutyPolicyExecutionLog.status,
                  )
                : Blue500,
              feedInfoInMarkdown: feedInfoInMarkdown,
            });
          }

          if (onCalldutyPolicyExecutionLog.triggeredByIncidentEpisodeId) {
            await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
              incidentEpisodeId:
                onCalldutyPolicyExecutionLog.triggeredByIncidentEpisodeId,
              projectId: onCalldutyPolicyExecutionLog.projectId!,
              incidentEpisodeFeedEventType:
                IncidentEpisodeFeedEventType.OnCallPolicy,
              displayColor: onCalldutyPolicyExecutionLog.status
                ? this.getDisplayColorByStatus(
                    onCalldutyPolicyExecutionLog.status,
                  )
                : Blue500,
              feedInfoInMarkdown: feedInfoInMarkdown,
            });
          }
        }
      }
    }

    return onUpdate;
  }
}
export default new Service();
