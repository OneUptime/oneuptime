import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import IncidentFeedService from "./IncidentFeedService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import OnCallDutyExecutionLogTimelineStatus from "../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import { Blue500, Green500, Red500, Yellow500 } from "../../Types/BrandColors";
import Color from "../../Types/Color";
import ObjectID from "../../Types/ObjectID";
import logger, { LogAttributes } from "../Utils/Logger";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import AlertFeedService from "./AlertFeedService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import UserService from "./UserService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import FeedMarkdown, { MarkdownText } from "../../Utils/Markdown/FeedMarkdown";
import OnCallPolicyRunMessage from "../Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import OnCallFeedText from "../Utils/OnCall/OnCallFeedText";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { isOnCallDirectPage } from "../../Types/OnCallDutyPolicy/OnCallDirectPage";
import { isOnCallPagePassedOnSkipTimelineMessage } from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import FirstPagedAt from "../Utils/OnCall/FirstPagedAt";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import PositiveNumber from "../../Types/PositiveNumber";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  public getColorBasedOnStatus(
    status: OnCallDutyExecutionLogTimelineStatus,
  ): Color {
    switch (status) {
      case OnCallDutyExecutionLogTimelineStatus.Started:
        return Blue500;
      case OnCallDutyExecutionLogTimelineStatus.Executing:
        return Yellow500;
      case OnCallDutyExecutionLogTimelineStatus.Error:
        return Red500;
      case OnCallDutyExecutionLogTimelineStatus.NotificationSent:
        return Green500;
      case OnCallDutyExecutionLogTimelineStatus.Skipped:
        return Red500;
      case OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged:
        return Green500;
      // Neither a failure nor an answer: the page moved on to somebody else.
      case OnCallDutyExecutionLogTimelineStatus.PassedOn:
        return Yellow500;
      default:
        return Blue500;
    }
  }

  /*
   * How many levels (escalation rules) a policy has, for "Level 2 of 3" in
   * a feed entry - or nothing when they cannot be counted: the entry then
   * says "Level 2", and is still written.
   */
  private async countPolicyLevels(
    policyId: ObjectID | undefined | null,
  ): Promise<number | undefined> {
    if (!policyId) {
      return undefined;
    }

    try {
      const count: PositiveNumber =
        await OnCallDutyPolicyEscalationRuleService.countBy({
          query: {
            onCallDutyPolicyId: policyId,
          },
          props: {
            isRoot: true,
          },
        });

      return count.toNumber() || undefined;
    } catch (error) {
      logger.debug(`Could not count the levels of policy ${policyId}`);
      logger.debug(error);
      return undefined;
    }
  }

  @CaptureSpan()
  public async addToIncidentOrAlertFeed(data: {
    onCallDutyPolicyExecutionLogTimelineId: ObjectID;
  }): Promise<void> {
    logger.debug(
      "OnCallDutyPolicyExecutionLogTimelineService.addToIncidentFeed",
      {
        onCallDutyPolicyExecutionLogTimelineId:
          data.onCallDutyPolicyExecutionLogTimelineId?.toString(),
      } as LogAttributes,
    );

    const onCallDutyPolicyExecutionLogTimeline: Model | null =
      await this.findOneById({
        id: data.onCallDutyPolicyExecutionLogTimelineId,
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          /*
           * Was missing from this select while the guard below (and the feed
           * branch further down) read it — so it was always undefined and every
           * incident-episode-triggered execution returned early, producing no
           * on-call feed entries at all for that trigger type.
           */
          triggeredByIncidentEpisodeId: true,
          projectId: true,
          status: true,
          statusMessage: true,
          alertSentToUserId: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          alertSentToUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            order: true,
            _id: true,
          },
          onCallDutySchedule: {
            name: true,
            _id: true,
          },
          // Paged as the next in the schedule's rotation, not as on call in it.
          isNextInRotation: true,
          isAcknowledged: true,
          acknowledgedAt: true,
          userBelongsToTeam: {
            name: true,
            _id: true,
          },
          overridedByUser: {
            name: true,
            _id: true,
          },
          // Who started the page, for a direct page's entry to name.
          onCallDutyPolicyExecutionLog: {
            triggeredByWorkflowName: true,
            triggeredByUserId: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    logger.debug("OnCallDutyPolicyExecutionLogTimeline: ", {
      projectId: onCallDutyPolicyExecutionLogTimeline?.projectId?.toString(),
    } as LogAttributes);
    logger.debug(onCallDutyPolicyExecutionLogTimeline, {
      projectId: onCallDutyPolicyExecutionLogTimeline?.projectId?.toString(),
    } as LogAttributes);

    if (!onCallDutyPolicyExecutionLogTimeline) {
      return;
    }

    if (
      !onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId &&
      !onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId &&
      !onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId &&
      !onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId
    ) {
      return;
    }

    /*
     * A direct page's step names no policy and no escalation rule: its
     * entry names who started the page instead (OnCallFeedText).
     */
    const isDirectPage: boolean = isOnCallDirectPage(
      onCallDutyPolicyExecutionLogTimeline,
    );

    /*
     * A person a direct page names a second time - a member of two of its
     * teams, on call in two of its schedules - was paged the first time:
     * "did not page Jane" under "paged Jane" would read as a page that
     * failed. The line stays on the run's own page.
     */
    if (
      isDirectPage &&
      onCallDutyPolicyExecutionLogTimeline.statusMessage ===
        ALREADY_PAGED_TIMELINE_MESSAGE
    ) {
      return;
    }

    /*
     * Somebody who escalated the page, passed over by a later rule or a
     * repeat: the feed said once that they escalated it, and "did not page
     * Ana" for every rule after it would only bury what the run did next.
     * The line stays on the run's own page. Lines written before the action
     * was renamed from "Pass it on" are read the same.
     */
    if (
      isOnCallPagePassedOnSkipTimelineMessage(
        onCallDutyPolicyExecutionLogTimeline.statusMessage,
      )
    ) {
      return;
    }

    if (
      isDirectPage ||
      (onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy &&
        onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.id)
    ) {
      const status: OnCallDutyExecutionLogTimelineStatus =
        onCallDutyPolicyExecutionLogTimeline.status!;

      logger.debug("Status: " + status, {
        projectId: onCallDutyPolicyExecutionLogTimeline?.projectId?.toString(),
      } as LogAttributes);

      if (
        status &&
        (status === OnCallDutyExecutionLogTimelineStatus.Skipped ||
          status === OnCallDutyExecutionLogTimelineStatus.Error ||
          status ===
            OnCallDutyExecutionLogTimelineStatus.SuccessfullyAcknowledged ||
          status === OnCallDutyExecutionLogTimelineStatus.PassedOn ||
          status === OnCallDutyExecutionLogTimelineStatus.NotificationSent)
      ) {
        const displayColor: Color = status
          ? this.getColorBasedOnStatus(status)
          : Blue500;

        /*
         * One sentence in the words the run's Slack and Microsoft Teams
         * message uses (OnCallFeedText). The record it is for is not
         * named: the entry goes to that record's own feed only.
         */
        const policyLink: MarkdownText | null =
          !isDirectPage && onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy
            ? FeedMarkdown.link(
                onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.name ||
                  "",
                (
                  await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                    onCallDutyPolicyExecutionLogTimeline.projectId!,
                    onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicy.id!,
                  )
                ).toString(),
              )
            : null;

        /*
         * Some timeline rows have NO recipient by construction: a schedule
         * that currently has nobody on call (a coverage gap), or an
         * escalation rule with no responders at all. Those rows are exactly
         * the ones an operator most needs to understand, so they get their
         * own wording - and never a user looked up by an id that is not set,
         * which would name an arbitrary person.
         */
        const recipient: MarkdownText | undefined =
          onCallDutyPolicyExecutionLogTimeline.alertSentToUserId
            ? await UserService.getUserMarkdownString({
                userId: onCallDutyPolicyExecutionLogTimeline.alertSentToUserId,
                projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
              })
            : undefined;

        const overriddenUser: MarkdownText | undefined =
          recipient && onCallDutyPolicyExecutionLogTimeline.overridedByUser?.id
            ? await UserService.getUserMarkdownString({
                userId: onCallDutyPolicyExecutionLogTimeline.overridedByUser.id,
                projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
              })
            : undefined;

        /*
         * The level by its place, as the Escalate dialog names it: "Level 2
         * of 3" (OnCallFeedText).
         */
        const ruleOrder: number | undefined =
          onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyEscalationRule
            ?.order || undefined;

        const feedInfoInMarkdown: string = policyLink
          ? OnCallFeedText.getStepMarkdown({
              status: status,
              policyLink: policyLink,
              ruleName:
                onCallDutyPolicyExecutionLogTimeline
                  .onCallDutyPolicyEscalationRule?.name,
              ruleOrder: ruleOrder,
              ruleCount: ruleOrder
                ? await this.countPolicyLevels(
                    onCallDutyPolicyExecutionLogTimeline.onCallDutyPolicyId,
                  )
                : undefined,
              scheduleName:
                onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name,
              isNextInRotation: Boolean(
                onCallDutyPolicyExecutionLogTimeline.isNextInRotation,
              ),
              teamName:
                onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name,
              recipient: recipient,
              overriddenUser: overriddenUser,
              statusMessage: onCallDutyPolicyExecutionLogTimeline.statusMessage,
            })
          : OnCallFeedText.getDirectPageStepMarkdown({
              status: status,
              pager:
                await OnCallDutyPolicyExecutionLogService.getDirectPagePager({
                  projectId: onCallDutyPolicyExecutionLogTimeline.projectId,
                  triggeredByWorkflowName:
                    onCallDutyPolicyExecutionLogTimeline
                      .onCallDutyPolicyExecutionLog?.triggeredByWorkflowName,
                  triggeredByUserId:
                    onCallDutyPolicyExecutionLogTimeline
                      .onCallDutyPolicyExecutionLog?.triggeredByUserId,
                }),
              scheduleName:
                onCallDutyPolicyExecutionLogTimeline.onCallDutySchedule?.name,
              teamName:
                onCallDutyPolicyExecutionLogTimeline.userBelongsToTeam?.name,
              recipient: recipient,
              overriddenUser: overriddenUser,
              statusMessage: onCallDutyPolicyExecutionLogTimeline.statusMessage,
            });

        logger.debug("Feed Info in Markdown: " + feedInfoInMarkdown, {
          projectId:
            onCallDutyPolicyExecutionLogTimeline?.projectId?.toString(),
        } as LogAttributes);

        /*
         * The record's feed only. Slack and Microsoft Teams hear of this
         * step through the run's one message, which is edited as the run
         * goes (OnCallPolicyRunMessage) - not through a paragraph per person
         * per rule per repeat, as they used to.
         */
        if (onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId) {
          await IncidentFeedService.createIncidentFeedItem({
            incidentId:
              onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            incidentFeedEventType: IncidentFeedEventType.OnCallPolicy,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId) {
          await AlertFeedService.createAlertFeedItem({
            alertId: onCallDutyPolicyExecutionLogTimeline.triggeredByAlertId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            alertFeedEventType: AlertFeedEventType.OnCallPolicy,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId) {
          await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
            alertEpisodeId:
              onCallDutyPolicyExecutionLogTimeline.triggeredByAlertEpisodeId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            alertEpisodeFeedEventType:
              AlertEpisodeFeedEventType.OnCallNotification,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        if (onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId) {
          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId:
              onCallDutyPolicyExecutionLogTimeline.triggeredByIncidentEpisodeId,
            projectId: onCallDutyPolicyExecutionLogTimeline.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.OnCallNotification,
            displayColor: displayColor,
            feedInfoInMarkdown: feedInfoInMarkdown,
          });
        }

        logger.debug("Incident Feed created", {
          projectId:
            onCallDutyPolicyExecutionLogTimeline?.projectId?.toString(),
        } as LogAttributes);
      }
    }
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    logger.debug(
      "OnCallDutyPolicyExecutionLogTimelineService.onCreateSuccess",
      { projectId: createdItem.projectId?.toString() } as LogAttributes,
    );
    logger.debug(createdItem, {
      projectId: createdItem.projectId?.toString(),
    } as LogAttributes);

    await this.addToIncidentOrAlertFeed({
      onCallDutyPolicyExecutionLogTimelineId: createdItem.id!,
    });

    /*
     * A step written already saying its page went out is the record's first
     * page, if it has none yet (FirstPagedAt). The escalation writes its
     * steps as "Executing" and marks them once the page is sent (below).
     */
    await FirstPagedAt.recordPage(createdItem);

    // The run's Slack / Microsoft Teams message names this step now.
    OnCallPolicyRunMessage.refresh(createdItem.onCallDutyPolicyExecutionLogId);

    return createdItem;
  }

  /*
   * The status each step had before an update that writes one, so the feed
   * hears of a status only when it changes (onUpdateSuccess).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const statusBeforeUpdate: Record<
      string,
      OnCallDutyExecutionLogTimelineStatus | undefined
    > = {};

    if (updateBy.data.status) {
      const itemsBeforeUpdate: Array<Model> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          status: true,
        });

      for (const item of itemsBeforeUpdate) {
        if (item.id) {
          statusBeforeUpdate[item.id.toString()] = item.status;
        }
      }
    }

    return {
      updateBy: updateBy,
      carryForward: {
        statusBeforeUpdate: statusBeforeUpdate,
      },
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    if (onUpdate.updateBy.query) {
      const updatedItems: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          status: true,
          onCallDutyPolicyExecutionLogId: true,
          // What FirstPagedAt reads of a step whose page went out.
          alertSentToUserId: true,
          createdAt: true,
          triggeredByIncidentId: true,
          triggeredByAlertId: true,
          triggeredByAlertEpisodeId: true,
          triggeredByIncidentEpisodeId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

      const statusBeforeUpdate:
        | Record<string, OnCallDutyExecutionLogTimelineStatus | undefined>
        | undefined = (
        onUpdate.carryForward as {
          statusBeforeUpdate?: Record<
            string,
            OnCallDutyExecutionLogTimelineStatus | undefined
          >;
        } | null
      )?.statusBeforeUpdate;

      for (const updatedItem of updatedItems) {
        /*
         * A step is news for the feed when its status changes, not every
         * time it is written: a page that reached somebody is marked
         * Notification Sent when it goes out and again when the person's
         * notification rules have all run, and each write added a second
         * "On-Call Alert Notification Sent to <person>" entry - in the feed,
         * and in Slack and Microsoft Teams. A status read before the update
         * that is missing (the row was not found then) counts as a change.
         */
        const id: string = updatedItem.id!.toString();
        const statusChanged: boolean =
          Boolean(onUpdate.updateBy.data.status) &&
          (!statusBeforeUpdate ||
            !(id in statusBeforeUpdate) ||
            statusBeforeUpdate[id] !== updatedItem.status);

        if (statusChanged) {
          await this.addToIncidentOrAlertFeed({
            onCallDutyPolicyExecutionLogTimelineId: updatedItem.id as ObjectID,
          });

          /*
           * The page went out - sent, acknowledged or passed on: the first
           * time one did is the record's First Paged At, written once.
           */
          await FirstPagedAt.recordPage(updatedItem);
        }

        OnCallPolicyRunMessage.refresh(
          updatedItem.onCallDutyPolicyExecutionLogId,
        );
      }
    }

    return onUpdate;
  }
}
export default new Service();
