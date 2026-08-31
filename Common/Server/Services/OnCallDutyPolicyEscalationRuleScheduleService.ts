import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import Dictionary from "../../Types/Dictionary";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import { SMSMessage } from "../../Types/SMS/SMS";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import DeleteBy from "../Types/Database/DeleteBy";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Gray500, Red500 } from "../../Types/BrandColors";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OneUptimeDate from "../../Types/Date";
import logger, { LogAttributes } from "../Utils/Logger";
import { OnCallShiftChangeReason } from "../Utils/OnCall/OnCallShiftChangeListeners";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /**
   * Attaching to / detaching from a policy changes the schedule's policy
   * context (which overrides apply, and which policies its calendar events
   * list), so it is a configuration change for the calendar feeds and the
   * reminders: bump shiftConfigVersion, purge the feed caches, notify the
   * listeners. Runs after the roster refresh; never throws.
   */
  private async propagateAttachmentChange(
    onCallDutyPolicyScheduleId: ObjectID | null | undefined,
    projectId: ObjectID | null | undefined,
  ): Promise<void> {
    if (!onCallDutyPolicyScheduleId) {
      return;
    }

    await OnCallDutyPolicyScheduleService.propagateShiftConfigChange({
      scheduleIds: [onCallDutyPolicyScheduleId],
      projectId: projectId || null,
      reason: OnCallShiftChangeReason.PolicyAttachmentChanged,
    });
  }

  /**
   * Re-resolve and persist the schedule's roster after it is attached to, or
   * detached from, an on-call policy.
   *
   * The persisted roster columns are derived state, and one of their inputs is
   * WHICH policies escalate to the schedule: a schedule attached to exactly one
   * policy is resolved in that policy's context, so its policy-scoped user
   * overrides count, and a schedule attached to none or to several is resolved
   * policy-blind (OnCallDutyPolicyScheduleService.getSingleAttachedPolicyId).
   * Attaching or detaching therefore changes the correct answer, and every other
   * input — layers, layer users, overrides — already refreshes on change.
   *
   * Without this the roster stayed on the pre-attach answer until the next
   * natural hand-off, so the schedule page's "X is currently on the roster"
   * banner and the "On Call Now" column named the originally-scheduled user for
   * the whole override window while alert routing paged the substitute.
   * https://github.com/OneUptime/oneuptime/issues/3411
   *
   * Best-effort: an attach must not fail because a roster could not be
   * recomputed, and the refresh is idempotent (an unaffected schedule simply
   * resolves to the same roster and diffs to "no change", so no duplicate
   * hand-off notification is sent).
   */
  private async refreshScheduleRoster(
    onCallDutyPolicyScheduleId: ObjectID | null | undefined,
  ): Promise<void> {
    if (!onCallDutyPolicyScheduleId) {
      return;
    }

    try {
      await OnCallDutyPolicyScheduleService.refreshCurrentUserIdAndHandoffTimeInSchedule(
        onCallDutyPolicyScheduleId,
      );
    } catch (err) {
      logger.error(
        "Error refreshing the roster after an on-call schedule was attached to or detached from a policy (best-effort).",
      );
      logger.error(err);
    }
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const createdItemId: ObjectID = createdItem.id!;

    if (!createdItemId) {
      throw new BadDataException("Created item does not have an ID");
    }

    const createdModel: Model | null = await this.findOneById({
      id: createdItemId,
      select: {
        projectId: true,
        onCallDutyPolicyScheduleId: true,
        onCallDutyPolicySchedule: {
          name: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
        createdByUserId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!createdModel) {
      throw new BadDataException("Created item does not have an ID");
    }

    if (!createdModel.onCallDutyPolicyScheduleId) {
      throw new BadDataException(
        "Created item does not have a onCallDutyPolicyScheduleId",
      );
    }

    /*
     * Bring the persisted roster in line with the new policy attachment before
     * anything below can return early. See refreshScheduleRoster.
     */
    await this.refreshScheduleRoster(createdModel.onCallDutyPolicyScheduleId);

    await this.propagateAttachmentChange(
      createdModel.onCallDutyPolicyScheduleId,
      createdModel.projectId,
    );

    // send notification to the new current user.

    const userOnSchedule: ObjectID | null =
      await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
        createdModel.onCallDutyPolicyScheduleId,
        {
          onCallDutyPolicyId: createdModel.onCallDutyPolicy?.id || undefined,
        },
      );

    /*
     * Record the attachment in the policy feed BEFORE the early return below.
     *
     * This used to sit at the bottom of the method, after `if (!userOnSchedule)
     * return`, so attaching a schedule that happened to have nobody on call at
     * that instant produced no feed item and no workspace message at all — the
     * audit trail silently depended on the roster state at the moment of the
     * click. Note the asymmetry it created: the delete path emits its feed item
     * from onBeforeDelete, which runs unconditionally, so removals were always
     * recorded while additions could vanish.
     *
     * When nobody is on call, the entry says so — attaching a schedule that
     * currently pages no one is exactly the thing an operator wants to see.
     */
    const feedOnCallDutyPolicyId: ObjectID | undefined | null =
      createdModel.onCallDutyPolicy?.id;

    if (feedOnCallDutyPolicyId) {
      const noCoverageSuffix: string = userOnSchedule
        ? ""
        : " ⚠️ **No one is currently on call in this schedule**, so alerts escalating to this rule will not notify anyone until coverage resumes.";

      await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
        onCallDutyPolicyId: feedOnCallDutyPolicyId,
        projectId: createdModel.projectId!,
        onCallDutyPolicyFeedEventType:
          OnCallDutyPolicyFeedEventType.OnCallDutyScheduleAdded,
        displayColor: userOnSchedule ? Gray500 : Red500,
        feedInfoInMarkdown: `📅 Added on-call schedule **${createdModel.onCallDutyPolicySchedule?.name || ""}** from the [On-Call Policy ${createdModel.onCallDutyPolicy?.name || ""}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(createdModel.projectId!, feedOnCallDutyPolicyId)).toString()}) escalation rule **${createdModel.onCallDutyPolicyEscalationRule?.name}** with order **${createdModel.onCallDutyPolicyEscalationRule?.order}**.${noCoverageSuffix}`,
        userId: createdModel.createdByUserId || undefined,
        workspaceNotification: {
          sendWorkspaceNotification: true,
          notifyUserId: createdModel.createdByUserId || undefined,
        },
      });
    }

    if (!userOnSchedule) {
      return createdItem;
    }

    /*
     * Open the roster user's on-call time log for this schedule/rule/policy.
     * Mirrors onDeleteSuccess's endTimeLogForUser (detaching a schedule closes
     * the log, so attaching must open it). Without this, attaching a schedule
     * whose roster user is ALREADY established never opened a log — the roster
     * refresh only opens one when the current user CHANGES — so the whole stint
     * went unrecorded in on-call reporting and the later detach's
     * endTimeLogForUser was a no-op (audit M1). startTimeLogForUser is idempotent
     * (open-log dedup), so a later natural handoff re-opening the same log is a
     * no-op.
     */
    if (
      createdModel.onCallDutyPolicy?.id &&
      createdModel.onCallDutyPolicyEscalationRule?.id &&
      createdModel.projectId &&
      createdModel.onCallDutyPolicyScheduleId
    ) {
      OnCallDutyPolicyTimeLogService.startTimeLogForUser({
        projectId: createdModel.projectId,
        onCallDutyPolicyId: createdModel.onCallDutyPolicy.id,
        onCallDutyPolicyEscalationRuleId:
          createdModel.onCallDutyPolicyEscalationRule.id,
        userId: userOnSchedule,
        onCallDutyPolicyScheduleId: createdModel.onCallDutyPolicyScheduleId,
        startsAt: OneUptimeDate.getCurrentDate(),
      }).catch((error: Error) => {
        logger.error(error, {
          projectId: createdModel.projectId?.toString(),
          userId: userOnSchedule?.toString(),
        } as LogAttributes);
      });
    }

    const scheduleName: string =
      createdModel.onCallDutyPolicySchedule?.name || "No name provided";

    const sendEmailToUserId: ObjectID | undefined | null = userOnSchedule;

    if (!sendEmailToUserId) {
      return createdItem;
    }

    if (!createdModel) {
      return createdItem;
    }

    const vars: Dictionary<string> = {
      onCallPolicyName:
        createdModel.onCallDutyPolicy?.name || "No name provided",
      escalationRuleName:
        createdModel.onCallDutyPolicyEscalationRule?.name || "No name provided",
      escalationRuleOrder:
        createdModel.onCallDutyPolicyEscalationRule?.order?.toString() ||
        "No order provided",
      reason: "You are currently on roster for schedule " + scheduleName,
      onCallPolicyViewLink: (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          createdModel!.projectId!,
          createdModel.onCallDutyPolicy!.id!,
        )
      ).toString(),
    };

    // Notify the current user about being added to the schedule.
    const emailMessage: EmailEnvelope = {
      templateType: EmailTemplateType.UserAddedToOnCallPolicy,
      vars: vars,
      subject: `You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for schedule ${scheduleName}`,
    };

    const sms: SMSMessage = {
      message: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification, go to User Settings in the OneUptime Dashboard.`,
    };

    const callMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. You have been added to the on-call duty policy ${createdModel.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${createdModel.onCallDutyPolicyEscalationRule?.name} with order ${createdModel.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification, go to User Settings in the OneUptime Dashboard. Goodbye.`,
        },
      ],
    };

    const pushMessage: PushNotificationMessage =
      PushNotificationUtil.createOnCallPolicyAddedNotification({
        policyName: createdModel.onCallDutyPolicy?.name || "No name provided",
      });

    const eventType: NotificationSettingEventType =
      NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY;

    const whatsAppMessage: WhatsAppMessagePayload =
      createWhatsAppMessageFromTemplate({
        eventType,
        templateVariables: {
          on_call_policy_name:
            createdModel.onCallDutyPolicy?.name || "No name provided",
          schedule_name: scheduleName,
          on_call_context: `schedule ${scheduleName}`,
          policy_link: vars["onCallPolicyViewLink"] || "",
        },
      });

    await UserNotificationSettingService.sendUserNotification({
      userId: sendEmailToUserId,
      projectId: createdModel!.projectId!,
      emailEnvelope: emailMessage,
      smsMessage: sms,
      callRequestMessage: callMessage,
      pushNotificationMessage: pushMessage,
      whatsAppMessage,
      eventType,
    });

    /*
     * The "schedule added" feed item is emitted above, before the
     * no-one-on-call early return, so it is recorded unconditionally.
     */

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToFetchBeforeDelete: Array<Model> = await this.findBy({
      query: deleteBy.query,
      props: {
        isRoot: true,
      },
      select: {
        projectId: true,
        onCallDutyPolicyScheduleId: true,
        onCallDutyPolicySchedule: {
          name: true,
          _id: true,
        },
        onCallDutyPolicyEscalationRule: {
          name: true,
          _id: true,
          order: true,
        },
        onCallDutyPolicy: {
          name: true,
          _id: true,
        },
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

    const deleteByUserId: ObjectID | undefined =
      deleteBy.deletedByUser?.id || deleteBy.props.userId;
    for (const item of itemsToFetchBeforeDelete) {
      const onCallDutyPolicyId: ObjectID | undefined =
        item.onCallDutyPolicy!.id!;
      const projectId: ObjectID | undefined = item.projectId;

      if (onCallDutyPolicyId && projectId) {
        const onCallDutyPolicyName: string | null =
          item.onCallDutyPolicy?.name || "No name provided";

        const onCallSchedule: OnCallDutyPolicySchedule | undefined =
          item.onCallDutyPolicySchedule;

        if (!onCallSchedule) {
          continue;
        }

        await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
          onCallDutyPolicyId: onCallDutyPolicyId,
          projectId: projectId,
          onCallDutyPolicyFeedEventType:
            OnCallDutyPolicyFeedEventType.OwnerTeamRemoved,
          displayColor: Red500,
          feedInfoInMarkdown: `📅 Removed on-call schedule **${onCallSchedule.name}** from the [On-Call Policy ${onCallDutyPolicyName}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule ${item.onCallDutyPolicyEscalationRule?.name} with order ${item.onCallDutyPolicyEscalationRule?.order}.`,
          userId: deleteByUserId || undefined,
          workspaceNotification: {
            sendWorkspaceNotification: true,
            notifyUserId: deleteByUserId || undefined,
          },
        });
      }
    }

    return {
      deleteBy,
      carryForward: {
        deletedItems: itemsToFetchBeforeDelete,
      },
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deletedItems: Array<Model> = onDelete.carryForward.deletedItems;

    /*
     * Detaching changes the schedule's policy context just as attaching does, so
     * its roster has to be re-resolved here too. Deduped by schedule: removing a
     * schedule from several escalation rules of one policy is one context
     * change, not several. See refreshScheduleRoster.
     */
    const refreshedScheduleIds: Set<string> = new Set<string>();
    for (const deletedItem of deletedItems) {
      const scheduleId: string | undefined =
        deletedItem.onCallDutyPolicyScheduleId?.toString();
      if (!scheduleId || refreshedScheduleIds.has(scheduleId)) {
        continue;
      }
      refreshedScheduleIds.add(scheduleId);
      await this.refreshScheduleRoster(deletedItem.onCallDutyPolicyScheduleId);
      await this.propagateAttachmentChange(
        deletedItem.onCallDutyPolicyScheduleId,
        deletedItem.projectId,
      );
    }

    for (const deletedItem of deletedItems) {
      const userOnSchedule: ObjectID | null =
        await OnCallDutyPolicyScheduleService.getCurrentUserIdInSchedule(
          deletedItem.onCallDutyPolicyScheduleId!,
          {
            onCallDutyPolicyId: deletedItem.onCallDutyPolicy?.id || undefined,
          },
        );

      if (!userOnSchedule) {
        continue;
      }

      /*
       * Close the roster user's open on-call time log for this schedule/rule/
       * policy. Roster handoffs open a time log keyed by schedule + rule + policy
       * (OnCallDutyPolicyScheduleService.startTimeLogForUser); the user-link and
       * team-link delete handlers close theirs, but detaching a SCHEDULE from the
       * rule left the log open forever, so the roster user kept showing as
       * on-call in reporting (audit F18).
       */
      if (
        deletedItem.onCallDutyPolicy?.id &&
        deletedItem.onCallDutyPolicyEscalationRule?.id &&
        deletedItem.projectId
      ) {
        OnCallDutyPolicyTimeLogService.endTimeLogForUser({
          projectId: deletedItem.projectId,
          onCallDutyPolicyId: deletedItem.onCallDutyPolicy.id,
          onCallDutyPolicyEscalationRuleId:
            deletedItem.onCallDutyPolicyEscalationRule.id,
          userId: userOnSchedule,
          onCallDutyPolicyScheduleId: deletedItem.onCallDutyPolicyScheduleId!,
          endsAt: OneUptimeDate.getCurrentDate(),
        }).catch((error: Error) => {
          logger.error(error, {
            projectId: deletedItem.projectId?.toString(),
            userId: userOnSchedule?.toString(),
          } as LogAttributes);
        });
      }

      const sendEmailToUserId: ObjectID | undefined | null = userOnSchedule;

      if (!sendEmailToUserId) {
        return onDelete;
      }

      const scheduleName: string =
        deletedItem.onCallDutyPolicySchedule?.name || "No name provided";

      const vars: Dictionary<string> = {
        onCallPolicyName:
          deletedItem.onCallDutyPolicy?.name || "No name provided",
        escalationRuleName:
          deletedItem.onCallDutyPolicyEscalationRule?.name ||
          "No name provided",
        escalationRuleOrder:
          deletedItem.onCallDutyPolicyEscalationRule?.order?.toString() ||
          "No order provided",
        reason: `You have been removed from the on-call duty policy escalation rule for schedule ${scheduleName}.`,
        onCallPolicyViewLink: (
          await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
            deletedItem!.projectId!,
            deletedItem.onCallDutyPolicy!.id!,
          )
        ).toString(),
      };

      // Notify the current user about being removed from the schedule.
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.UserRemovedFromOnCallPolicy,
        vars: vars,
        subject: `You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for schedule ${scheduleName}`,
      };

      const sms: SMSMessage = {
        message: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is a message from OneUptime. You have been removed from the on-call duty policy ${deletedItem.onCallDutyPolicy?.name} for schedule ${scheduleName} and escalation rule ${deletedItem.onCallDutyPolicyEscalationRule?.name} with order ${deletedItem.onCallDutyPolicyEscalationRule?.order}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good Bye`,
          },
        ],
      };

      const pushMessage: PushNotificationMessage =
        PushNotificationUtil.createOnCallPolicyRemovedNotification({
          policyName: deletedItem.onCallDutyPolicy?.name || "No name provided",
        });

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY;

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            on_call_policy_name:
              deletedItem.onCallDutyPolicy?.name || "No name provided",
            schedule_name: scheduleName,
            on_call_context: `schedule ${scheduleName}`,
            policy_link: vars["onCallPolicyViewLink"] || "",
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: sendEmailToUserId,
        projectId: deletedItem!.projectId!,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        whatsAppMessage,
        eventType,
      });
    }

    return onDelete;
  }
}

export default new Service();
