import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CalendarEvent from "../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import LayerUtil, {
  LayerEventsResult,
  LayerProps,
} from "../../Types/OnCallDutyPolicy/Layer";
import { RestrictionType } from "../../Types/OnCallDutyPolicy/RestrictionTimes";
import Recurring from "../../Types/Events/Recurring";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../Types/OnCallDutyPolicy/UserOverrideUtil";
import OnCallDutyPolicyUserOverride from "../../Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import QueryHelper from "../Types/Database/QueryHelper";
import OnCallDutyPolicyScheduleLayer from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../Models/DatabaseModels/User";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import Dictionary from "../../Types/Dictionary";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import UserService from "./UserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { SMSMessage } from "../../Types/SMS/SMS";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import BadDataException from "../../Types/Exception/BadDataException";
import Timezone from "../../Types/Timezone";
import logger, { LogAttributes } from "../Utils/Logger";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Green500, Red500 } from "../../Types/BrandColors";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import OnCallDutyPolicyScheduleLabelRuleEngineService from "./OnCallDutyPolicyScheduleLabelRuleEngineService";
import OnCallDutyPolicyScheduleOwnerRuleEngineService from "./OnCallDutyPolicyScheduleOwnerRuleEngineService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import { MaterializedShiftPolicy } from "../../Types/OnCallDutyPolicy/MaterializedShift";
import OnCallCalendarFeedCache from "../Infrastructure/OnCallCalendarFeedCache";
import OnCallShiftChangeListeners, {
  OnCallShiftChangeEvent,
  OnCallShiftChangeReason,
} from "../Utils/OnCall/OnCallShiftChangeListeners";

/*
 * ---------------------------------------------------------------------------
 * Resolver contracts (on-call calendar feeds / reminders / my-shifts)
 * ---------------------------------------------------------------------------
 */

// The schedule columns a resolved window carries along for its consumers.
export interface ResolvedScheduleInfo {
  id: string;
  name: string;
  // IANA zone; absent for legacy schedules (engine ran in the server's zone).
  timezone?: string;
  projectId: string;
  shiftConfigVersion: number;
}

/*
 * Resolution of the same base events in ONE escalation policy's context.
 * Only produced when the schedule is attached to two or more distinct policies
 * and a policy-scoped override for a schedule member overlaps the window — the
 * situation in which paging (which always resolves with the escalating policy)
 * and the policy-agnostic roster can name different people.
 */
export interface ResolvedPolicyVariant {
  policyId: string;
  policyName: string;
  segments: Array<CalendarEvent>;
}

export interface ResolvedShiftSegments {
  schedule: ResolvedScheduleInfo;
  /*
   * Resolved coverage segments (CalendarEvent.title = user id) that OVERLAP
   * [windowStart, windowEnd). Deliberately unclipped: a segment that started
   * before the window keeps its true start, because that start is the
   * calendar event's identity.
   */
  segments: Array<CalendarEvent>;
  policyVariants: Array<ResolvedPolicyVariant>;
  // Distinct (policy, rule) attachments, ordered by policy then rule order.
  attachedPolicies: Array<MaterializedShiftPolicy>;
  // The layers as fed to the engine (for the coverage envelope).
  layerProps: Array<LayerProps>;
  // Distinct user ids across all layers, in layer order.
  scheduleUserIds: Array<string>;
  /*
   * Every override that took part in the resolution (global ones plus, in a
   * policy context, that policy's), so a consumer can map a segment's
   * override meta back to its policy scope.
   */
  overrides: Array<UserOverrideRecord>;
  /*
   * max(updatedAt) over layers, layer users, participating overrides and
   * policy attachments. The schedule row is EXCLUDED on purpose: its
   * updatedAt moves on every roster refresh, which would make every feed
   * fetch look like a change.
   */
  lastModifiedAt: Date;
  // True when the engine hit its iteration cap; segments may be incomplete.
  truncated: boolean;
}

export interface ResolveShiftSegmentsOptions {
  scheduleId: ObjectID;
  windowStart: Date;
  windowEnd: Date;
  maxSimulationIterations?: number | undefined;
}

export interface ResolveShiftSegmentsForSchedulesOptions {
  scheduleIds: Array<ObjectID>;
  windowStart: Date;
  windowEnd: Date;
  maxSimulationIterations?: number | undefined;
}

/*
 * What a CRUD hook reports when an edit may have changed who is on call and
 * when. See propagateShiftConfigChange.
 */
export interface ShiftConfigChange {
  scheduleIds: Array<ObjectID>;
  projectId?: ObjectID | null | undefined;
  // Users named directly by the change (added/removed/overridden/substitute).
  userIds?: Array<ObjectID> | undefined;
  reason: OnCallShiftChangeReason;
  // The schedule rows are gone (delete) — nothing to bump.
  skipVersionBump?: boolean | undefined;
}

// Rows loaded once for a batch of schedules, grouped per schedule.
interface ScheduleResolutionInputs {
  schedule: OnCallDutyPolicySchedule;
  layers: Array<OnCallDutyPolicyScheduleLayer>;
  layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
  attachments: Array<OnCallDutyPolicyEscalationRuleSchedule>;
}

export class Service extends DatabaseService<OnCallDutyPolicySchedule> {
  private layerUtil = new LayerUtil();

  public constructor() {
    super(OnCallDutyPolicySchedule);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<OnCallDutyPolicySchedule>,
    createdItem: OnCallDutyPolicySchedule,
  ): Promise<OnCallDutyPolicySchedule> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await OnCallDutyPolicyScheduleLabelRuleEngineService.applyRulesToSchedule(
            createdItem,
          );
        })
        .then(async () => {
          await OnCallDutyPolicyScheduleOwnerRuleEngineService.applyRulesToSchedule(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying on-call schedule rules in OnCallDutyPolicyScheduleService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              onCallDutyPolicyScheduleId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicySchedule>,
  ): Promise<OnDelete<OnCallDutyPolicySchedule>> {
    const callSchedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const schedule of callSchedules) {
      OnCallDutyPolicyTimeLogService.endTimeForSchedule({
        projectId: schedule.projectId!,
        onCallDutyPolicyScheduleId: schedule.id!,
        endsAt: OneUptimeDate.getCurrentDate(),
      }).catch((err: Error) => {
        logger.error(err, {
          projectId: schedule.projectId?.toString(),
        } as LogAttributes);
      });
    }

    /*
     * Capture the members of each schedule being deleted. Their layer-user
     * rows cascade away at the database level (no hooks run), so this is the
     * last moment the ids are available; onDeleteSuccess uses them to purge
     * those users' calendar-feed bodies and to tell the shift-change
     * listeners whose shift lists just changed. Best-effort.
     */
    const deletedSchedules: Array<{
      scheduleId: ObjectID;
      projectId: ObjectID | null;
      userIds: Array<ObjectID>;
    }> = [];

    try {
      const scheduleIds: Array<ObjectID> = callSchedules
        .map((schedule: OnCallDutyPolicySchedule) => {
          return schedule.id;
        })
        .filter((id: ObjectID | null | undefined): id is ObjectID => {
          return Boolean(id);
        });

      const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
        scheduleIds.length > 0
          ? await OnCallDutyPolicyScheduleLayerUserService.findBy({
              query: {
                onCallDutyPolicyScheduleId: QueryHelper.any(scheduleIds),
              },
              select: {
                userId: true,
                onCallDutyPolicyScheduleId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            })
          : [];

      for (const schedule of callSchedules) {
        if (!schedule.id) {
          continue;
        }

        const scheduleIdString: string = schedule.id.toString();

        deletedSchedules.push({
          scheduleId: schedule.id,
          projectId: schedule.projectId || null,
          userIds: OnCallShiftChangeListeners.dedupe(
            layerUsers
              .filter((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
                return (
                  layerUser.onCallDutyPolicyScheduleId?.toString() ===
                  scheduleIdString
                );
              })
              .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
                return layerUser.userId;
              })
              .filter((id: ObjectID | undefined): id is ObjectID => {
                return Boolean(id);
              }),
          ),
        });
      }
    } catch (err) {
      logger.error(
        "Error capturing schedule members before delete (best-effort).",
      );
      logger.error(err);
    }

    return {
      deleteBy: deleteBy,
      carryForward: { deletedSchedules },
    };
  }

  /*
   * A deleted schedule takes its shared feed with it (FK cascade) and drops
   * out of its members' personal feeds; purge what was rendered from it and
   * let the shift-change listeners (reminders) re-plan for those users. No
   * version bump — the row is gone.
   */
  protected override async onDeleteSuccess(
    onDelete: OnDelete<OnCallDutyPolicySchedule>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<OnCallDutyPolicySchedule>> {
    const deletedSchedules: Array<{
      scheduleId: ObjectID;
      projectId: ObjectID | null;
      userIds: Array<ObjectID>;
    }> = onDelete.carryForward?.deletedSchedules || [];

    for (const deleted of deletedSchedules) {
      await this.propagateShiftConfigChange({
        scheduleIds: [deleted.scheduleId],
        projectId: deleted.projectId,
        userIds: deleted.userIds,
        reason: OnCallShiftChangeReason.ScheduleDeleted,
        skipVersionBump: true,
      });
    }

    return onDelete;
  }

  /*
   * A rename or a timezone change alters every calendar event of the
   * schedule (its title, and for a timezone change the instants themselves),
   * so it must bump the schedule's shiftConfigVersion like any other
   * configuration edit. The roster refresh writes through updateOneById with
   * ignoreHooks, and the version bump itself is a raw statement, so neither
   * re-enters this hook.
   */
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<OnCallDutyPolicySchedule>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<OnCallDutyPolicySchedule>> {
    const data: Record<string, unknown> = (onUpdate.updateBy?.data ||
      {}) as unknown as Record<string, unknown>;

    const touchesShiftConfiguration: boolean =
      data["name"] !== undefined || data["timezone"] !== undefined;

    if (!touchesShiftConfiguration || updatedItemIds.length === 0) {
      return onUpdate;
    }

    try {
      const schedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
        query: {
          _id: QueryHelper.any(updatedItemIds),
        },
        select: {
          _id: true,
          projectId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const byProject: Map<string, Array<ObjectID>> = new Map<
        string,
        Array<ObjectID>
      >();

      for (const schedule of schedules) {
        if (!schedule.id) {
          continue;
        }
        const projectKey: string = schedule.projectId?.toString() || "";
        const list: Array<ObjectID> = byProject.get(projectKey) || [];
        list.push(schedule.id);
        byProject.set(projectKey, list);
      }

      for (const [projectKey, scheduleIds] of byProject) {
        await this.propagateShiftConfigChange({
          scheduleIds,
          projectId: projectKey ? new ObjectID(projectKey) : null,
          reason: OnCallShiftChangeReason.ScheduleChanged,
        });
      }
    } catch (err) {
      logger.error(
        "Error propagating a schedule rename / timezone change to the calendar feeds (best-effort).",
      );
      logger.error(err);
    }

    return onUpdate;
  }

  public async getOnCallSchedulesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<OnCallDutyPolicySchedule>> {
    const schedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
      query: {
        projectId: data.projectId,
        currentUserIdOnRoster: data.userId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return schedules;
  }

  private async sendNotificationToUserOnScheduleHandoff(data: {
    scheduleId: ObjectID;
    previousInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    };
    newInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    };
  }): Promise<void> {
    // Before we send any notification, we need to check if this schedule is attached to any on-call policy.

    const escalationRulesAttachedToSchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyScheduleId: data.scheduleId,
        },
        select: {
          projectId: true,
          _id: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          onCallDutyPolicySchedule: {
            name: true,
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    if (escalationRulesAttachedToSchedule.length === 0) {
      // do nothing.
      return;
    }

    for (const escalationRule of escalationRulesAttachedToSchedule) {
      const projectId: ObjectID = escalationRule.projectId!;

      const onCallSchedule: OnCallDutyPolicySchedule | undefined =
        escalationRule.onCallDutyPolicySchedule;

      if (!onCallSchedule) {
        continue;
      }

      const onCallPolicy: OnCallDutyPolicy | undefined =
        escalationRule.onCallDutyPolicy;

      if (!onCallPolicy) {
        continue;
      }

      const onCallDutyPolicyEscalationRule:
        | OnCallDutyPolicyEscalationRule
        | undefined = escalationRule.onCallDutyPolicyEscalationRule;

      if (!onCallDutyPolicyEscalationRule) {
        continue;
      }

      const { previousInformation, newInformation } = data;

      /*
       * if there's a change, witht he current user, send notification to the new current user.
       * Send notificiation to the new current user.
       */
      if (
        previousInformation.currentUserIdOnRoster?.toString() !==
          newInformation.currentUserIdOnRoster?.toString() ||
        previousInformation.rosterHandoffAt?.toString() !==
          newInformation.rosterHandoffAt?.toString()
      ) {
        if (
          previousInformation.currentUserIdOnRoster?.toString() !==
            newInformation.currentUserIdOnRoster?.toString() &&
          previousInformation.currentUserIdOnRoster?.toString()
        ) {
          // the user has changed. Send notifiction to old user that he has been removed.

          // send notification to the new current user.

          const sendEmailToUserId: ObjectID =
            previousInformation.currentUserIdOnRoster;

          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "Your on-call roster on schedule " +
              onCallSchedule.name +
              " just ended.",
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: previousInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: OneUptimeDate.isInTheFuture(
                  previousInformation.rosterHandoffAt!,
                )
                  ? OneUptimeDate.getCurrentDate()
                  : previousInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          // current user changed, send alert the new current user.
          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserNoLongerActiveOnOnCallRoster,
            vars: vars,
            subject: "You are no longer on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are no longer on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are no longer on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: "On-Call Duty Ended",
              body: `You are no longer on-call for ${onCallPolicy.name!} as your roster on schedule ${onCallSchedule.name} has ended.`,
              tag: "on-call-duty-ended",
              requireInteraction: false,
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                on_call_policy_name: onCallPolicy.name!,
                schedule_name: onCallSchedule.name!,
                schedule_link: vars["onCallPolicyViewLink"] || "",
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            eventType,
            onCallPolicyId: escalationRule.onCallDutyPolicy!.id!,
            onCallPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallScheduleId: data.scheduleId,
          });

          // add end log for user.
          OnCallDutyPolicyTimeLogService.endTimeLogForUser({
            userId: sendEmailToUserId,
            onCallDutyPolicyScheduleId: data.scheduleId,
            onCallDutyPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallDutyPolicyId: escalationRule.onCallDutyPolicy!.id!,
            projectId: projectId,
            endsAt: OneUptimeDate.getCurrentDate(),
          }).catch((err: Error) => {
            logger.error(
              "Error ending time log for user: " +
                sendEmailToUserId.toString() +
                " for schedule: " +
                data.scheduleId.toString(),
              {
                projectId: projectId?.toString(),
                userId: sendEmailToUserId?.toString(),
              } as LogAttributes,
            );
            logger.error(err, {
              projectId: projectId?.toString(),
              userId: sendEmailToUserId?.toString(),
            } as LogAttributes);
          });

          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          // Send workspace notifiction as well.
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.RosterHandoff,
            displayColor: Green500,
            feedInfoInMarkdown: `🚫 **${await UserService.getUserMarkdownString(
              {
                userId: sendEmailToUserId,
                projectId: projectId!,
              },
            )}** is no longer on call for [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}** because your on-call roster on schedule **${onCallSchedule.name}** just ended.`,
            userId: sendEmailToUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }

        /*
         * Only notify "you are now on-call" when the current user ACTUALLY
         * changed — not merely when the handoff time changed. The enclosing
         * guard also fires on a rosterHandoffAt change, which happens every
         * rotation period; without this user-changed check a continuing (e.g.
         * single-user) roster was re-sent the full email + SMS + phone call +
         * push + WhatsApp bundle every period. Mirrors the removal branch above.
         */
        if (
          previousInformation.currentUserIdOnRoster?.toString() !==
            newInformation.currentUserIdOnRoster?.toString() &&
          newInformation.currentUserIdOnRoster?.toString()
        ) {
          // send email to the new current user.
          const sendEmailToUserId: ObjectID =
            newInformation.currentUserIdOnRoster;
          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "You are now on-call for the policy " +
              onCallPolicy.name +
              " because your on-call roster on schedule " +
              onCallSchedule.name,
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserCurrentlyOnOnCallRoster,
            vars: vars,
            subject: "You are now on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are now on-call for ${onCallPolicy.name!} because you are now on the roster for schedule ${onCallSchedule.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are now on-call for ${onCallPolicy.name!} because you are now on the roster for schedule ${onCallSchedule.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: "On-Call Duty Started",
              body: `You are now on-call for ${onCallPolicy.name!} on schedule ${onCallSchedule.name}.`,
              tag: "on-call-duty-started",
              requireInteraction: true,
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                on_call_policy_name: onCallPolicy.name!,
                schedule_name: onCallSchedule.name!,
                schedule_link: vars["onCallPolicyViewLink"] || "",
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            eventType,
            onCallPolicyId: escalationRule.onCallDutyPolicy!.id!,
            onCallPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallScheduleId: data.scheduleId,
          });

          // add start log for user.
          OnCallDutyPolicyTimeLogService.startTimeLogForUser({
            userId: sendEmailToUserId,
            onCallDutyPolicyScheduleId: data.scheduleId,
            onCallDutyPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallDutyPolicyId: escalationRule.onCallDutyPolicy!.id!,
            projectId: projectId,
            startsAt: OneUptimeDate.getCurrentDate(),
          }).catch((err: Error) => {
            logger.error(
              "Error starting time log for user: " +
                sendEmailToUserId.toString() +
                " for schedule: " +
                data.scheduleId.toString(),
              {
                projectId: projectId?.toString(),
                userId: sendEmailToUserId?.toString(),
              } as LogAttributes,
            );
            logger.error(err, {
              projectId: projectId?.toString(),
              userId: sendEmailToUserId?.toString(),
            } as LogAttributes);
          });

          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          // Send workspace notifiction as well.
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.RosterHandoff,
            displayColor: Green500,
            feedInfoInMarkdown: `📞 **${await UserService.getUserMarkdownString(
              {
                userId: sendEmailToUserId,
                projectId: projectId!,
              },
            )}** is currently on call for [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}** because of schedule **${onCallSchedule.name}** and your on-call roster starts at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}** and ends at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}**.`,
            userId: sendEmailToUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }

        /*
         * Somebody was on call and now nobody is. This branch is the mirror of
         * the two above and used to be missing entirely: the "now on-call"
         * branch requires a NEW user to exist, and the "no longer on-call"
         * branch notifies only the departing person — who is precisely the one
         * individual that can no longer do anything about it. So a schedule
         * running off the end of its rotation, or into restricted hours with no
         * fallback layer, opened a coverage gap in complete silence.
         *
         * Deliberately NOT tied to a user notification bundle (email/SMS/call):
         * there is no on-call person to send it to. It goes to the policy feed
         * and out to the workspace channel, where whoever owns the policy sees it.
         */
        if (
          previousInformation.currentUserIdOnRoster?.toString() &&
          !newInformation.currentUserIdOnRoster?.toString()
        ) {
          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          const policyLink: string = (
            await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
              projectId!,
              onCallDutyPolicyId!,
            )
          ).toString();

          /*
           * When a next user is known, say when coverage resumes — that turns
           * "nobody is on call" from an alarm into an actionable window.
           */
          const resumesClause: string = newInformation.nextUserIdOnRoster
            ? ` Coverage resumes at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
                {
                  date:
                    newInformation.nextRosterStartAt ||
                    newInformation.nextHandOffTimeAt ||
                    OneUptimeDate.getCurrentDate(),
                  timezones: [Timezone.GMT],
                },
              )}** with **${await UserService.getUserMarkdownString({
                userId: newInformation.nextUserIdOnRoster,
                projectId: projectId!,
              })}**.`
            : " No further shifts are scheduled, so this schedule will keep paging no one until it is fixed.";

          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.CoverageGapStarted,
            displayColor: Red500,
            feedInfoInMarkdown: `⚠️ **Coverage gap: no one is on call in schedule ${onCallSchedule.name}.** [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${policyLink}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}** targets this schedule, so any alert that escalates to it right now will notify nobody.${resumesClause}`,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }
      }

      // send an email to the next user.
      if (
        previousInformation.nextUserIdOnRoster?.toString() !==
          newInformation.nextUserIdOnRoster?.toString() ||
        previousInformation.nextHandOffTimeAt?.toString() !==
          newInformation.nextHandOffTimeAt?.toString() ||
        previousInformation.nextRosterStartAt?.toString() !==
          newInformation.nextRosterStartAt?.toString()
      ) {
        /*
         * Only notify "you are next on-call" when the next user ACTUALLY
         * changed — not merely when the next handoff/start time advanced. The
         * enclosing guard also fires when nextHandOffTimeAt / nextRosterStartAt
         * change, which happens every rotation period; without this
         * user-changed check a continuing (e.g. single-user) roster re-sent the
         * full email + SMS + phone call + push + WhatsApp bundle every period.
         * Mirrors the current-user "now on-call" branch above.
         */
        if (
          previousInformation.nextUserIdOnRoster?.toString() !==
            newInformation.nextUserIdOnRoster?.toString() &&
          newInformation.nextUserIdOnRoster?.toString()
        ) {
          // send email to the next user.
          const sendEmailToUserId: ObjectID = newInformation.nextUserIdOnRoster;
          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "You are next on-call for the policy " +
              onCallPolicy.name +
              " because your on-call roster on schedule " +
              onCallSchedule.name +
              " will start when the next handoff happens.",
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.nextRosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.nextHandOffTimeAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserNextOnOnCallRoster,
            vars: vars,
            subject: "You are next on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are next on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} will start when the next handoff happens. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are next on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} will start when the next handoff happens. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: "Next On-Call Duty",
              body: `You are next on-call for ${onCallPolicy.name!} on schedule ${onCallSchedule.name}.`,
              tag: "next-on-call-duty",
              requireInteraction: false,
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                on_call_policy_name: onCallPolicy.name!,
                schedule_name: onCallSchedule.name!,
                schedule_link: vars["onCallPolicyViewLink"] || "",
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            eventType,
            onCallPolicyId: escalationRule.onCallDutyPolicy!.id!,
            onCallPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallScheduleId: data.scheduleId,
          });

          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          // Send workspace notifiction as well.
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.RosterHandoff,
            displayColor: Green500,
            feedInfoInMarkdown: `➡️ **${await UserService.getUserMarkdownString(
              {
                userId: sendEmailToUserId,
                projectId: projectId!,
              },
            )}** is next on call for [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}**. The on-call roster on schedule **${onCallSchedule.name}** will start when the next handoff happens which is at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.nextRosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}** and will end at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.nextHandOffTimeAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}**.`,
            userId: sendEmailToUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }
      }
    }
  }

  public async refreshCurrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    rosterStartAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    /*
     * Serialize per-schedule refreshes across processes (audit L2). This method
     * reads the persisted roster, diffs it, SENDS the handoff notification
     * bundle + feed items, and only THEN persists — notifying before persisting
     * is deliberate (audit F11). Without a lock the override-triggered refresh
     * (API process) and the EVERY_MINUTE RefreshHandoffTime cron (Workers
     * process) can both read the same stale roster and both send the full page
     * before either persists, double-paging the incoming user. A blocking
     * per-schedule mutex makes the second caller wait, then read the
     * already-persisted new roster and diff to "no change" -> no duplicate page.
     * Best-effort: if the lock cannot be acquired (Redis unavailable, or the
     * acquire window is exceeded) we proceed unlocked — no worse than before.
     */
    let mutex: SemaphoreMutex | null = null;
    try {
      mutex = await Semaphore.lock({
        key: scheduleId.toString(),
        namespace: "OnCallDutyPolicyScheduleService.refreshRoster",
        lockTimeout: 60000,
        acquireTimeout: 15000,
        retryInterval: 200,
        acquireAttemptsLimit: 100,
      });
    } catch (err) {
      logger.debug(
        "Proceeding with roster refresh without a per-schedule lock (could not acquire) for scheduleId: " +
          scheduleId.toString(),
      );
      logger.debug(err);
    }

    try {
      return await this.refreshCurrentUserIdAndHandoffTimeInScheduleInternal(
        scheduleId,
      );
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }
    }
  }

  private async refreshCurrentUserIdAndHandoffTimeInScheduleInternal(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    rosterStartAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    logger.debug(
      "refreshCurrentUserIdAndHandoffTimeInSchedule called with scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    // get previoius result.
    logger.debug(
      "Fetching previous schedule information for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );
    const onCallSchedule: OnCallDutyPolicySchedule | null =
      await this.findOneById({
        id: scheduleId,
        select: {
          currentUserIdOnRoster: true,
          rosterHandoffAt: true,
          nextUserIdOnRoster: true,
          rosterNextHandoffAt: true,
          rosterStartAt: true,
          rosterNextStartAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!onCallSchedule) {
      logger.debug(
        "Schedule not found for scheduleId: " + scheduleId.toString(),
        { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
      );
      throw new BadDataException("Schedule not found");
    }

    logger.debug(
      "Previous schedule information fetched for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    const previousInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserIdOnRoster: onCallSchedule.currentUserIdOnRoster || null,
      rosterHandoffAt: onCallSchedule.rosterHandoffAt || null,
      nextUserIdOnRoster: onCallSchedule.nextUserIdOnRoster || null,
      nextHandOffTimeAt: onCallSchedule.rosterNextHandoffAt || null,
      rosterStartAt: onCallSchedule.rosterStartAt || null,
      nextRosterStartAt: onCallSchedule.rosterNextStartAt || null,
    };

    logger.debug(previousInformation, {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);

    logger.debug(
      "Fetching new schedule information for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    /*
     * When this schedule is attached to exactly one on-call policy, resolve the
     * roster in that policy's context so its policy-scoped overrides are
     * reflected in the persisted roster, handoff notifications and time logs —
     * matching the live paging path, which already passes the policy id (audit
     * F10). Attached to zero or multiple policies, the roster stays
     * policy-agnostic (global overrides only), because a single schedule-level
     * roster cannot represent divergent per-policy overrides.
     */
    const singleAttachedPolicyId: ObjectID | undefined =
      await this.getSingleAttachedPolicyId(scheduleId);

    const newInformation: {
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = await this.getCurrrentUserIdAndHandoffTimeInSchedule(scheduleId, {
      onCallDutyPolicyId: singleAttachedPolicyId,
    });

    logger.debug(newInformation, {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);

    logger.debug(
      "Updating schedule with new information for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    logger.debug(
      "Sending notifications for schedule handoff for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    /*
     * Send the handoff notification BEFORE persisting the new roster. The
     * decision to notify is a diff of the persisted-previous vs new roster; if
     * we persisted first and the notification then threw (a transient DB error
     * in the notification-settings / timezone lookup, or a partial send), the
     * row would already show the new user, so the next tick's diff would show
     * "no change" and the newly-on-call user would NEVER be told they are on
     * call — the handoff page would be silently and permanently lost (audit
     * F11). By notifying first, a failed send leaves the roster un-advanced, so
     * the schedule is re-selected next tick and the notification is retried
     * (at worst a duplicate send, which is far better than a missed page for an
     * on-call system).
     */
    await this.sendNotificationToUserOnScheduleHandoff({
      scheduleId: scheduleId,
      previousInformation: previousInformation,
      newInformation: {
        currentUserIdOnRoster: newInformation.currentUserId,
        rosterHandoffAt: newInformation.handOffTimeAt,
        nextUserIdOnRoster: newInformation.nextUserId,
        nextHandOffTimeAt: newInformation.nextHandOffTimeAt,
        rosterStartAt: newInformation.rosterStartAt,
        nextRosterStartAt: newInformation.nextRosterStartAt,
      },
    });

    logger.debug(
      "Updating schedule with new information for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    await this.updateOneById({
      id: scheduleId!,
      data: {
        currentUserIdOnRoster: newInformation.currentUserId,
        rosterHandoffAt: newInformation.handOffTimeAt,
        nextUserIdOnRoster: newInformation.nextUserId,
        rosterNextHandoffAt: newInformation.nextHandOffTimeAt,
        rosterStartAt: newInformation.rosterStartAt,
        rosterNextStartAt: newInformation.nextRosterStartAt,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    logger.debug(
      "Returning new schedule information for scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    return newInformation;
  }

  public async getCurrrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
    options?: { onCallDutyPolicyId?: ObjectID | undefined } | undefined,
  ): Promise<{
    rosterStartAt: Date | null;
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    logger.debug(
      "getCurrrentUserIdAndHandoffTimeInSchedule called with scheduleId: " +
        scheduleId.toString(),
      { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
    );

    const resultReturn: {
      rosterStartAt: Date | null;
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserId: null,
      handOffTimeAt: null,
      nextUserId: null,
      nextHandOffTimeAt: null,
      rosterStartAt: null,
      nextRosterStartAt: null,
    };

    logger.debug("Fetching events for scheduleId: " + scheduleId.toString(), {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);
    const events: Array<CalendarEvent> | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        getNumberOfEvents: 2,
        onCallDutyPolicyId: options?.onCallDutyPolicyId,
      });

    logger.debug("Events fetched: " + JSON.stringify(events), {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);

    let currentEvent: CalendarEvent | null = events[0] || null;
    let nextEvent: CalendarEvent | null = events[1] || null;

    logger.debug("Current event: " + JSON.stringify(currentEvent), {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);
    logger.debug("Next event: " + JSON.stringify(nextEvent), {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);

    // if the current event start time in the future then the current event is the next event.
    if (currentEvent && OneUptimeDate.isInTheFuture(currentEvent.start)) {
      logger.debug(
        "Current event is in the future, treating it as next event.",
        { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
      );
      nextEvent = currentEvent;
      currentEvent = null;
    }

    if (currentEvent) {
      logger.debug(
        "Processing current event: " + JSON.stringify(currentEvent),
        { onCallDutyPolicyScheduleId: scheduleId.toString() } as LogAttributes,
      );
      const userId: string | undefined = currentEvent?.title; // this is user id in string.

      if (userId) {
        logger.debug("Current userId: " + userId, {
          onCallDutyPolicyScheduleId: scheduleId.toString(),
        } as LogAttributes);
        resultReturn.currentUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = currentEvent?.end; // this is user id in string.
      if (handOffTime) {
        logger.debug("Current handOffTime: " + handOffTime.toISOString(), {
          onCallDutyPolicyScheduleId: scheduleId.toString(),
        } as LogAttributes);
        resultReturn.handOffTimeAt = handOffTime;
      }

      // get start time
      const startTime: Date | undefined = currentEvent?.start; // this is user id in string.
      if (startTime) {
        logger.debug(
          "Current rosterStartAt (clamped): " + startTime.toISOString(),
          {
            onCallDutyPolicyScheduleId: scheduleId.toString(),
          } as LogAttributes,
        );

        /*
         * currentEvent.start is clamped to the resolution window start (now).
         * Recover the true start of the current coverage window so the
         * persisted/displayed "on call since" reflects when the shift actually
         * began, not ~now (audit F12). Best-effort with a fallback to the
         * clamped value.
         */
        if (resultReturn.currentUserId) {
          resultReturn.rosterStartAt = await this.getTrueRosterStartAt({
            scheduleId: scheduleId,
            currentUserId: resultReturn.currentUserId,
            now: OneUptimeDate.getCurrentDate(),
            onCallDutyPolicyId: options?.onCallDutyPolicyId,
            fallbackStart: startTime,
          });
        } else {
          resultReturn.rosterStartAt = startTime;
        }
      }
    }

    // do the same for next event.

    if (nextEvent) {
      logger.debug("Processing next event: " + JSON.stringify(nextEvent), {
        onCallDutyPolicyScheduleId: scheduleId.toString(),
      } as LogAttributes);
      const userId: string | undefined = nextEvent?.title; // this is user id in string.

      if (userId) {
        logger.debug("Next userId: " + userId, {
          onCallDutyPolicyScheduleId: scheduleId.toString(),
        } as LogAttributes);
        resultReturn.nextUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = nextEvent?.end; // this is user id in string.
      if (handOffTime) {
        logger.debug("Next handOffTime: " + handOffTime.toISOString(), {
          onCallDutyPolicyScheduleId: scheduleId.toString(),
        } as LogAttributes);
        resultReturn.nextHandOffTimeAt = handOffTime;
      }

      // get start time
      const startTime: Date | undefined = nextEvent?.start; // this is user id in string.
      if (startTime) {
        logger.debug("Next rosterStartAt: " + startTime.toISOString(), {
          onCallDutyPolicyScheduleId: scheduleId.toString(),
        } as LogAttributes);
        resultReturn.nextRosterStartAt = startTime;
      }
    }

    logger.debug("Returning result: " + JSON.stringify(resultReturn), {
      onCallDutyPolicyScheduleId: scheduleId.toString(),
    } as LogAttributes);
    return resultReturn;
  }

  /*
   * Returns the on-call policy this schedule is attached to IFF it is attached
   * to exactly one; otherwise undefined (audit F10). A lazy require avoids a
   * circular import — OnCallDutyPolicyEscalationRuleScheduleService imports this
   * service.
   */
  private async getSingleAttachedPolicyId(
    scheduleId: ObjectID,
  ): Promise<ObjectID | undefined> {
    try {
      const escalationRuleScheduleService: {
        findBy: (
          args: unknown,
        ) => Promise<Array<{ onCallDutyPolicyId?: ObjectID | undefined }>>;
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      } = require("./OnCallDutyPolicyEscalationRuleScheduleService").default;

      const links: Array<{ onCallDutyPolicyId?: ObjectID | undefined }> =
        await escalationRuleScheduleService.findBy({
          query: { onCallDutyPolicyScheduleId: scheduleId },
          select: { onCallDutyPolicyId: true },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: { isRoot: true },
        });

      const distinctPolicyIds: Set<string> = new Set<string>();
      for (const link of links) {
        const policyId: string | undefined =
          link.onCallDutyPolicyId?.toString();
        if (policyId) {
          distinctPolicyIds.add(policyId);
        }
      }

      if (distinctPolicyIds.size === 1) {
        return new ObjectID(Array.from(distinctPolicyIds)[0]!);
      }
    } catch (err) {
      logger.error(err);
    }

    return undefined;
  }

  /**
   * Re-resolve and persist the roster for every schedule in the project whose
   * layers include `userId`. Called when a user override is created / updated /
   * deleted so the persisted roster, handoff notifications and on-call time logs
   * reflect the override mid-period instead of waiting for the next natural
   * handoff or the per-minute cron (which does not re-select an established
   * roster) — audit F4. Best-effort and idempotent: refreshing an unaffected
   * schedule simply recomputes the same roster; per-schedule errors are logged
   * and never abort the rest.
   */
  public async refreshRostersForUserInProject(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<void> {
    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          projectId: data.projectId,
          userId: data.userId,
        },
        select: {
          onCallDutyPolicyScheduleId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const scheduleIds: Set<string> = new Set<string>();
    for (const layerUser of layerUsers) {
      const scheduleId: string | undefined =
        layerUser.onCallDutyPolicyScheduleId?.toString();
      if (scheduleId) {
        scheduleIds.add(scheduleId);
      }
    }

    for (const scheduleId of scheduleIds) {
      try {
        await this.refreshCurrentUserIdAndHandoffTimeInSchedule(
          new ObjectID(scheduleId),
        );
      } catch (err) {
        logger.error(
          `Error refreshing roster for schedule ${scheduleId} after a user override change.`,
        );
        logger.error(err);
      }
    }
  }

  private async getScheduleLayerProps(data: { scheduleId: ObjectID }): Promise<{
    layerProps: Array<LayerProps>;
    projectId: ObjectID | null;
    scheduleUserIds: Array<ObjectID>;
  }> {
    // get schedule layers.

    const scheduleId: ObjectID = data.scheduleId;

    const layers: Array<OnCallDutyPolicyScheduleLayer> =
      await OnCallDutyPolicyScheduleLayerService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          order: true,
          name: true,
          description: true,
          startsAt: true,
          restrictionTimes: true,
          rotation: true,
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          handOffTime: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          user: true,
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    /*
     * The schedule's timezone (if set) is applied to every layer so restriction
     * wall-clock times resolve in that zone. When null (existing schedules), the
     * layer engine falls back to server-local time — unchanged legacy behavior.
     */
    const schedule: OnCallDutyPolicySchedule | null = await this.findOneById({
      id: scheduleId,
      select: {
        timezone: true,
      },
      props: {
        isRoot: true,
      },
    });

    const scheduleTimezone: string | undefined =
      schedule?.timezone?.toString() || undefined;

    const { layerProps, scheduleUserIds } = this.buildLayerPropsFromRows({
      layers,
      layerUsers,
      scheduleTimezone,
    });

    const projectId: ObjectID | null = layers[0]?.projectId || null;

    return { layerProps, projectId, scheduleUserIds };
  }

  /*
   * Compose LayerProps from persisted layer + layer-user rows. Shared by the
   * single-schedule loader the paging/roster path uses and the batched loader
   * the calendar feeds use, so both feed the engine byte-identical input.
   * Layers must already be sorted by order; layer users by order.
   *
   * Each LayerProps is stamped with the layer's id and name (informational;
   * the engine copies them onto its events) so consumers can tell which
   * layer a merged segment came from.
   */
  private buildLayerPropsFromRows(data: {
    layers: Array<OnCallDutyPolicyScheduleLayer>;
    layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    scheduleTimezone: string | undefined;
  }): { layerProps: Array<LayerProps>; scheduleUserIds: Array<ObjectID> } {
    const layerProps: Array<LayerProps> = [];
    const scheduleUserIds: Array<ObjectID> = [];
    const seenUserIds: Set<string> = new Set<string>();

    for (const layer of data.layers) {
      const usersForLayer: Array<User> = data.layerUsers
        .filter((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
          return (
            layerUser.onCallDutyPolicyScheduleLayerId?.toString() ===
            layer.id?.toString()
          );
        })
        .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
          return layerUser.user!;
        })
        .filter((user: User) => {
          return Boolean(user);
        });

      for (const user of usersForLayer) {
        const idStr: string = user.id?.toString() || "";
        if (idStr && !seenUserIds.has(idStr)) {
          seenUserIds.add(idStr);
          scheduleUserIds.push(user.id!);
        }
      }

      const props: LayerProps = {
        users: usersForLayer,
        startDateTimeOfLayer: layer.startsAt!,
        restrictionTimes: layer.restrictionTimes!,
        rotation: layer.rotation!,
        handOffTime: layer.handOffTime!,
        timezone: data.scheduleTimezone,
      };

      const layerId: string | undefined = layer.id?.toString();
      if (layerId) {
        props.layerId = layerId;
      }

      if (typeof layer.name === "string" && layer.name) {
        props.layerName = layer.name;
      }

      layerProps.push(props);
    }

    return { layerProps, scheduleUserIds };
  }

  /*
   * ---------------------------------------------------------------------------
   * Shift resolver — the source of truth for the calendar feeds, /my-shifts
   * and the shift reminders.
   * ---------------------------------------------------------------------------
   */

  /**
   * Resolve every on-call segment of ONE schedule that overlaps
   * [windowStart, windowEnd), in the exact order the paging and roster paths
   * use: layers -> engine -> overrides. Returns null when the schedule does
   * not exist. See getResolvedShiftSegmentsForSchedules for the rules.
   */
  @CaptureSpan()
  public async getResolvedShiftSegments(
    options: ResolveShiftSegmentsOptions,
  ): Promise<ResolvedShiftSegments | null> {
    const resolved: Array<ResolvedShiftSegments> =
      await this.getResolvedShiftSegmentsForSchedules({
        scheduleIds: [options.scheduleId],
        windowStart: options.windowStart,
        windowEnd: options.windowEnd,
        maxSimulationIterations: options.maxSimulationIterations,
      });

    return resolved[0] || null;
  }

  /**
   * Batched resolver: loads the layers, layer users, policy attachments and
   * overrides of every schedule with a handful of IN queries, then resolves
   * each schedule in memory.
   *
   * Per schedule:
   *   1. LayerProps exactly as the roster path builds them (plus layer ids).
   *   2. Expansion window = 2 rotation periods before windowStart .. 2 after
   *      windowEnd, so the segments overlapping the window carry their TRUE
   *      start and end rather than the engine's clamp to the window edge.
   *   3. ONE multi-layer engine expansion, bounded by maxSimulationIterations
   *      (default: the engine's own caps); `truncated` reports a cap hit.
   *   4. Overrides in the roster's policy context: the single attached
   *      policy's scoped overrides plus globals when exactly one policy is
   *      attached, globals only otherwise — the same rule as
   *      refreshCurrentUserIdAndHandoffTimeInSchedule (getSingleAttachedPolicyId).
   *   5. With two or more distinct attached policies AND a policy-scoped
   *      override for a member overlapping the window, the same base events
   *      are re-resolved once per such policy -> policyVariants. The
   *      expensive expansion runs once; the override pass is cheap.
   *   6. lastModifiedAt = max(updatedAt) over layers, layer users,
   *      participating overrides and attachments — never the schedule row.
   *
   * Schedules that no longer exist are skipped; the result is in the order
   * of the input ids.
   */
  @CaptureSpan()
  public async getResolvedShiftSegmentsForSchedules(
    options: ResolveShiftSegmentsForSchedulesOptions,
  ): Promise<Array<ResolvedShiftSegments>> {
    const scheduleIds: Array<ObjectID> = OnCallShiftChangeListeners.dedupe(
      options.scheduleIds,
    );

    if (scheduleIds.length === 0) {
      return [];
    }

    if (
      !OneUptimeDate.isBefore(options.windowStart, options.windowEnd) &&
      options.windowStart.getTime() !== options.windowEnd.getTime()
    ) {
      throw new BadDataException("windowStart must be before windowEnd");
    }

    const inputsById: Map<string, ScheduleResolutionInputs> =
      await this.loadResolutionInputsForSchedules(scheduleIds);

    /*
     * Build the layer props and the per-schedule expansion window first so
     * the override query below can cover every schedule in one statement
     * (overrides are project-scoped, not schedule-scoped).
     */
    interface PreparedSchedule {
      inputs: ScheduleResolutionInputs;
      layerProps: Array<LayerProps>;
      scheduleUserIds: Array<ObjectID>;
      expansionStart: Date;
      expansionEnd: Date;
    }

    const prepared: Array<PreparedSchedule> = [];
    const projectIds: Set<string> = new Set<string>();
    let earliestStart: Date | null = null;
    let latestEnd: Date | null = null;

    for (const scheduleId of scheduleIds) {
      const inputs: ScheduleResolutionInputs | undefined = inputsById.get(
        scheduleId.toString(),
      );

      if (!inputs) {
        continue;
      }

      const { layerProps, scheduleUserIds } = this.buildLayerPropsFromRows({
        layers: inputs.layers,
        layerUsers: inputs.layerUsers,
        scheduleTimezone: inputs.schedule.timezone?.toString() || undefined,
      });

      const expansionStart: Date =
        layerProps.length > 0
          ? this.computeResolutionWindowStart(
              layerProps,
              options.windowStart,
              2,
            )
          : options.windowStart;

      const expansionEnd: Date =
        layerProps.length > 0
          ? this.computeResolutionWindowEndByPeriods(
              layerProps,
              options.windowEnd,
              2,
            )
          : options.windowEnd;

      if (inputs.schedule.projectId) {
        projectIds.add(inputs.schedule.projectId.toString());
      }

      if (
        !earliestStart ||
        OneUptimeDate.isBefore(expansionStart, earliestStart)
      ) {
        earliestStart = expansionStart;
      }

      if (!latestEnd || OneUptimeDate.isAfter(expansionEnd, latestEnd)) {
        latestEnd = expansionEnd;
      }

      prepared.push({
        inputs,
        layerProps,
        scheduleUserIds,
        expansionStart,
        expansionEnd,
      });
    }

    if (prepared.length === 0) {
      return [];
    }

    const allOverrides: Array<OnCallDutyPolicyUserOverride> =
      projectIds.size > 0 && earliestStart && latestEnd
        ? await this.loadOverridesForProjects({
            projectIds: Array.from(projectIds).map((id: string) => {
              return new ObjectID(id);
            }),
            windowStart: earliestStart,
            windowEnd: latestEnd,
          })
        : [];

    const results: Array<ResolvedShiftSegments> = [];

    for (const item of prepared) {
      results.push(
        this.resolveScheduleInMemory({
          schedule: item.inputs.schedule,
          layers: item.inputs.layers,
          layerUsers: item.inputs.layerUsers,
          attachments: item.inputs.attachments,
          layerProps: item.layerProps,
          scheduleUserIds: item.scheduleUserIds,
          overrides: allOverrides,
          expansionStart: item.expansionStart,
          expansionEnd: item.expansionEnd,
          windowStart: options.windowStart,
          windowEnd: options.windowEnd,
          maxSimulationIterations: options.maxSimulationIterations,
        }),
      );
    }

    return results;
  }

  /*
   * Everything the resolver needs for a batch of schedules, in four queries.
   * Schedules that do not exist simply have no entry.
   */
  private async loadResolutionInputsForSchedules(
    scheduleIds: Array<ObjectID>,
  ): Promise<Map<string, ScheduleResolutionInputs>> {
    const schedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
      query: {
        _id: QueryHelper.any(scheduleIds),
      },
      select: {
        _id: true,
        name: true,
        timezone: true,
        projectId: true,
        shiftConfigVersion: true,
        createdAt: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const byId: Map<string, ScheduleResolutionInputs> = new Map<
      string,
      ScheduleResolutionInputs
    >();

    for (const schedule of schedules) {
      if (!schedule.id) {
        continue;
      }
      byId.set(schedule.id.toString(), {
        schedule,
        layers: [],
        layerUsers: [],
        attachments: [],
      });
    }

    if (byId.size === 0) {
      return byId;
    }

    const existingIds: Array<ObjectID> = Array.from(byId.keys()).map(
      (id: string) => {
        return new ObjectID(id);
      },
    );

    const [layers, layerUsers, attachments]: [
      Array<OnCallDutyPolicyScheduleLayer>,
      Array<OnCallDutyPolicyScheduleLayerUser>,
      Array<OnCallDutyPolicyEscalationRuleSchedule>,
    ] = await Promise.all([
      OnCallDutyPolicyScheduleLayerService.findBy({
        query: {
          onCallDutyPolicyScheduleId: QueryHelper.any(existingIds),
        },
        select: {
          _id: true,
          order: true,
          name: true,
          description: true,
          startsAt: true,
          restrictionTimes: true,
          rotation: true,
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          handOffTime: true,
          updatedAt: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          onCallDutyPolicyScheduleId: QueryHelper.any(existingIds),
        },
        select: {
          _id: true,
          user: {
            _id: true,
          },
          userId: true,
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
          onCallDutyPolicyScheduleId: true,
          updatedAt: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
      OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyScheduleId: QueryHelper.any(existingIds),
        },
        select: {
          _id: true,
          onCallDutyPolicyScheduleId: true,
          onCallDutyPolicyId: true,
          onCallDutyPolicyEscalationRuleId: true,
          updatedAt: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      }),
    ]);

    for (const layer of layers) {
      const entry: ScheduleResolutionInputs | undefined = byId.get(
        layer.onCallDutyPolicyScheduleId?.toString() || "",
      );
      if (entry) {
        entry.layers.push(layer);
      }
    }

    for (const layerUser of layerUsers) {
      const entry: ScheduleResolutionInputs | undefined = byId.get(
        layerUser.onCallDutyPolicyScheduleId?.toString() || "",
      );
      if (entry) {
        entry.layerUsers.push(layerUser);
      }
    }

    for (const attachment of attachments) {
      const entry: ScheduleResolutionInputs | undefined = byId.get(
        attachment.onCallDutyPolicyScheduleId?.toString() || "",
      );
      if (entry) {
        entry.attachments.push(attachment);
      }
    }

    return byId;
  }

  /*
   * Every override (global AND policy-scoped) of the given projects that
   * overlaps [windowStart, windowEnd]. The per-schedule policy scoping and
   * member filtering happen in memory (see selectOverridesForSchedule), which
   * mirrors fetchOverridesForSchedule's query exactly but for many schedules
   * at once.
   */
  private async loadOverridesForProjects(data: {
    projectIds: Array<ObjectID>;
    windowStart: Date;
    windowEnd: Date;
  }): Promise<Array<OnCallDutyPolicyUserOverride>> {
    if (data.projectIds.length === 0) {
      return [];
    }

    return await OnCallDutyPolicyUserOverrideService.findBy({
      query: {
        projectId: QueryHelper.any(data.projectIds),
        startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
        endsAt: QueryHelper.greaterThanEqualTo(data.windowStart),
      },
      select: {
        _id: true,
        projectId: true,
        startsAt: true,
        endsAt: true,
        overrideUserId: true,
        routeAlertsToUserId: true,
        onCallDutyPolicyId: true,
        updatedAt: true,
      },
      sort: {
        startsAt: SortOrder.Ascending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * The in-memory twin of fetchOverridesForSchedule: the overrides of this
   * schedule's project that overlap the window, whose overridden user is a
   * schedule member, scoped to `policyId` (that policy's plus globals) or to
   * globals only when no policy context is given.
   */
  private selectOverridesForSchedule(data: {
    overrides: Array<OnCallDutyPolicyUserOverride>;
    projectId: string;
    scheduleUserIds: Set<string>;
    windowStart: Date;
    windowEnd: Date;
    policyId: string | undefined;
  }): Array<OnCallDutyPolicyUserOverride> {
    return data.overrides.filter((override: OnCallDutyPolicyUserOverride) => {
      if (override.projectId?.toString() !== data.projectId) {
        return false;
      }

      if (!override.startsAt || !override.endsAt) {
        return false;
      }

      if (
        OneUptimeDate.isAfter(override.startsAt, data.windowEnd) ||
        OneUptimeDate.isBefore(override.endsAt, data.windowStart)
      ) {
        return false;
      }

      if (
        !data.scheduleUserIds.has(override.overrideUserId?.toString() || "")
      ) {
        return false;
      }

      const overridePolicyId: string | undefined =
        override.onCallDutyPolicyId?.toString() || undefined;

      if (!overridePolicyId) {
        return true; // global
      }

      return Boolean(data.policyId) && overridePolicyId === data.policyId;
    });
  }

  private toUserOverrideRecord(
    override: OnCallDutyPolicyUserOverride,
  ): UserOverrideRecord {
    return {
      overrideUserId: override.overrideUserId?.toString() || "",
      routeAlertsToUserId: override.routeAlertsToUserId?.toString() || "",
      startsAt: override.startsAt!,
      endsAt: override.endsAt!,
      onCallDutyPolicyId: override.onCallDutyPolicyId?.toString() || null,
    };
  }

  /*
   * The pure part of the resolver: given everything already loaded, expand
   * once and resolve the base context plus any policy variants.
   */
  private resolveScheduleInMemory(data: {
    schedule: OnCallDutyPolicySchedule;
    layers: Array<OnCallDutyPolicyScheduleLayer>;
    layerUsers: Array<OnCallDutyPolicyScheduleLayerUser>;
    attachments: Array<OnCallDutyPolicyEscalationRuleSchedule>;
    layerProps: Array<LayerProps>;
    scheduleUserIds: Array<ObjectID>;
    overrides: Array<OnCallDutyPolicyUserOverride>;
    expansionStart: Date;
    expansionEnd: Date;
    windowStart: Date;
    windowEnd: Date;
    maxSimulationIterations?: number | undefined;
  }): ResolvedShiftSegments {
    const scheduleId: string = data.schedule.id!.toString();
    const projectId: string = data.schedule.projectId?.toString() || "";

    // Distinct (policy, rule) attachments, stable order.
    const attachedPolicies: Array<MaterializedShiftPolicy> =
      this.toAttachedPolicies(data.attachments);

    const distinctPolicyIds: Array<string> = [];
    for (const policy of attachedPolicies) {
      if (!distinctPolicyIds.includes(policy.policyId)) {
        distinctPolicyIds.push(policy.policyId);
      }
    }

    // The roster rule: exactly one attached policy => resolve in its context.
    const baseContextPolicyId: string | undefined =
      distinctPolicyIds.length === 1 ? distinctPolicyIds[0] : undefined;

    // 1 + 2 + 3: one engine expansion over the widened window.
    let baseEvents: Array<CalendarEvent> = [];
    let truncated: boolean = false;

    if (data.layerProps.length > 0) {
      const expansion: LayerEventsResult =
        this.layerUtil.getMultiLayerEventsWithMeta(
          {
            layers: data.layerProps,
            calendarStartDate: data.expansionStart,
            calendarEndDate: data.expansionEnd,
          },
          data.maxSimulationIterations !== undefined
            ? { maxSimulationIterations: data.maxSimulationIterations }
            : undefined,
        );

      baseEvents = expansion.events;
      truncated = expansion.truncated;
    }

    const scheduleUserIdSet: Set<string> = new Set<string>(
      data.scheduleUserIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    // 4: overrides in the base (roster) context.
    const baseOverrideRows: Array<OnCallDutyPolicyUserOverride> =
      this.selectOverridesForSchedule({
        overrides: data.overrides,
        projectId,
        scheduleUserIds: scheduleUserIdSet,
        windowStart: data.expansionStart,
        windowEnd: data.expansionEnd,
        policyId: baseContextPolicyId,
      });

    const baseOverrides: Array<UserOverrideRecord> = baseOverrideRows.map(
      (override: OnCallDutyPolicyUserOverride) => {
        return this.toUserOverrideRecord(override);
      },
    );

    const participatingOverrideRows: Array<OnCallDutyPolicyUserOverride> = [
      ...baseOverrideRows,
    ];
    const participatingOverrides: Array<UserOverrideRecord> = [
      ...baseOverrides,
    ];

    let segments: Array<CalendarEvent> = baseEvents;

    if (baseOverrides.length > 0 && baseEvents.length > 0) {
      segments = UserOverrideUtil.applyOverridesToEvents({
        events: baseEvents,
        overrides: baseOverrides,
        currentOnCallDutyPolicyId: baseContextPolicyId,
      });
    }

    segments = this.filterEventsOverlappingWindow(
      segments,
      data.windowStart,
      data.windowEnd,
    );

    // 5: policy variants.
    const policyVariants: Array<ResolvedPolicyVariant> = [];

    if (distinctPolicyIds.length >= 2 && baseEvents.length > 0) {
      for (const policyId of distinctPolicyIds) {
        const scopedRows: Array<OnCallDutyPolicyUserOverride> =
          this.selectOverridesForSchedule({
            overrides: data.overrides,
            projectId,
            scheduleUserIds: scheduleUserIdSet,
            windowStart: data.expansionStart,
            windowEnd: data.expansionEnd,
            policyId,
          }).filter((override: OnCallDutyPolicyUserOverride) => {
            // Only the policy-scoped ones make this context differ.
            return Boolean(override.onCallDutyPolicyId);
          });

        if (scopedRows.length === 0) {
          continue;
        }

        const variantOverrideRows: Array<OnCallDutyPolicyUserOverride> = [
          ...scopedRows,
          ...baseOverrideRows,
        ];

        const variantOverrides: Array<UserOverrideRecord> =
          variantOverrideRows.map((override: OnCallDutyPolicyUserOverride) => {
            return this.toUserOverrideRecord(override);
          });

        for (const row of scopedRows) {
          participatingOverrideRows.push(row);
        }
        for (const record of variantOverrides.slice(0, scopedRows.length)) {
          participatingOverrides.push(record);
        }

        const variantSegments: Array<CalendarEvent> =
          this.filterEventsOverlappingWindow(
            UserOverrideUtil.applyOverridesToEvents({
              events: baseEvents,
              overrides: variantOverrides,
              currentOnCallDutyPolicyId: policyId,
            }),
            data.windowStart,
            data.windowEnd,
          );

        const policyName: string =
          attachedPolicies.find((policy: MaterializedShiftPolicy) => {
            return policy.policyId === policyId;
          })?.policyName || "";

        policyVariants.push({
          policyId,
          policyName,
          segments: variantSegments,
        });
      }
    }

    // 6: lastModifiedAt — schedule row excluded.
    const lastModifiedAt: Date = this.computeLastModifiedAt({
      schedule: data.schedule,
      layers: data.layers,
      layerUsers: data.layerUsers,
      attachments: data.attachments,
      overrides: participatingOverrideRows,
    });

    const scheduleInfo: ResolvedScheduleInfo = {
      id: scheduleId,
      name: data.schedule.name || "",
      projectId,
      shiftConfigVersion: Service.toVersionNumber(
        data.schedule.shiftConfigVersion,
      ),
    };

    const timezone: string | undefined =
      data.schedule.timezone?.toString() || undefined;
    if (timezone) {
      scheduleInfo.timezone = timezone;
    }

    return {
      schedule: scheduleInfo,
      segments,
      policyVariants,
      attachedPolicies,
      layerProps: data.layerProps,
      scheduleUserIds: Array.from(scheduleUserIdSet),
      overrides: participatingOverrides,
      lastModifiedAt,
      truncated,
    };
  }

  private toAttachedPolicies(
    attachments: Array<OnCallDutyPolicyEscalationRuleSchedule>,
  ): Array<MaterializedShiftPolicy> {
    const seen: Set<string> = new Set<string>();
    const policies: Array<MaterializedShiftPolicy> = [];

    for (const attachment of attachments) {
      const policyId: string =
        attachment.onCallDutyPolicyId?.toString() ||
        attachment.onCallDutyPolicy?.id?.toString() ||
        "";
      const ruleId: string =
        attachment.onCallDutyPolicyEscalationRuleId?.toString() ||
        attachment.onCallDutyPolicyEscalationRule?.id?.toString() ||
        "";

      if (!policyId) {
        continue;
      }

      const key: string = `${policyId}:${ruleId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      policies.push({
        policyId,
        policyName: attachment.onCallDutyPolicy?.name || "",
        ruleId,
        ruleName: attachment.onCallDutyPolicyEscalationRule?.name || "",
        ruleOrder: Service.toVersionNumber(
          attachment.onCallDutyPolicyEscalationRule?.order,
        ),
      });
    }

    policies.sort((a: MaterializedShiftPolicy, b: MaterializedShiftPolicy) => {
      if (a.policyName !== b.policyName) {
        return a.policyName < b.policyName ? -1 : 1;
      }
      if (a.policyId !== b.policyId) {
        return a.policyId < b.policyId ? -1 : 1;
      }
      if (a.ruleOrder !== b.ruleOrder) {
        return a.ruleOrder - b.ruleOrder;
      }
      return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
    });

    return policies;
  }

  private computeLastModifiedAt(data: {
    schedule: OnCallDutyPolicySchedule;
    layers: Array<{ updatedAt?: Date | undefined }>;
    layerUsers: Array<{ updatedAt?: Date | undefined }>;
    attachments: Array<{ updatedAt?: Date | undefined }>;
    overrides: Array<{ updatedAt?: Date | undefined }>;
  }): Date {
    let latest: Date | null = null;

    const consider: (value: Date | undefined) => void = (
      value: Date | undefined,
    ): void => {
      if (!value) {
        return;
      }
      const asDate: Date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(asDate.getTime())) {
        return;
      }
      if (!latest || asDate.getTime() > latest.getTime()) {
        latest = asDate;
      }
    };

    for (const rows of [
      data.layers,
      data.layerUsers,
      data.attachments,
      data.overrides,
    ]) {
      for (const row of rows) {
        consider(row.updatedAt);
      }
    }

    if (latest) {
      return latest;
    }

    /*
     * Nothing configured yet (no layers, no attachments): fall back to when
     * the schedule was CREATED — stable, unlike its updatedAt — and finally
     * to the epoch so the value is always a valid instant.
     */
    if (data.schedule.createdAt) {
      const created: Date = new Date(data.schedule.createdAt);
      if (!Number.isNaN(created.getTime())) {
        return created;
      }
    }

    return new Date(0);
  }

  private filterEventsOverlappingWindow(
    events: Array<CalendarEvent>,
    windowStart: Date,
    windowEnd: Date,
  ): Array<CalendarEvent> {
    return events.filter((event: CalendarEvent) => {
      if (!event || !event.start || !event.end) {
        return false;
      }
      return (
        event.start.getTime() < windowEnd.getTime() &&
        event.end.getTime() > windowStart.getTime()
      );
    });
  }

  private static toVersionNumber(value: unknown): number {
    const parsed: number =
      typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  /*
   * ---------------------------------------------------------------------------
   * Change propagation — shiftConfigVersion, feed caches, listeners.
   * ---------------------------------------------------------------------------
   */

  /**
   * Atomically add one to shiftConfigVersion of each schedule, in a single
   * UPDATE per schedule (`SET col = COALESCE(col, 0) + 1`, no hooks, no
   * optimistic-lock bump — see atomicAddToColumnsByIdWithoutHooks). Best
   * effort: a failure is logged and never thrown, because this runs inside
   * the CRUD hooks of the user's edit and must not fail it.
   *
   * NEVER call this from refreshCurrentUserIdAndHandoffTimeInSchedule: the
   * roster refresh runs every handoff and touches no configuration, and the
   * version is what calendar clients see as SEQUENCE — bumping it there would
   * make every feed look edited every rotation period.
   */
  @CaptureSpan()
  public async bumpShiftConfigVersion(
    scheduleIds: Array<ObjectID>,
  ): Promise<void> {
    for (const scheduleId of OnCallShiftChangeListeners.dedupe(scheduleIds)) {
      try {
        await this.atomicAddToColumnsByIdWithoutHooks({
          id: scheduleId,
          add: { shiftConfigVersion: 1 },
        });
      } catch (err) {
        logger.error(
          `Error bumping shiftConfigVersion for schedule ${scheduleId.toString()} (best-effort).`,
        );
        logger.error(err);
      }
    }
  }

  /**
   * The schedules in `projectId` whose layers include any of `userIds` —
   * the query refreshRostersForUserInProject uses, batched. Root read.
   */
  @CaptureSpan()
  public async getScheduleIdsForUsersInProject(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<Array<ObjectID>> {
    const userIds: Array<ObjectID> = OnCallShiftChangeListeners.dedupe(
      data.userIds,
    );

    if (userIds.length === 0) {
      return [];
    }

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          projectId: data.projectId,
          userId: QueryHelper.any(userIds),
        },
        select: {
          onCallDutyPolicyScheduleId: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return OnCallShiftChangeListeners.dedupe(
      layerUsers
        .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
          return layerUser.onCallDutyPolicyScheduleId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        }),
    );
  }

  /**
   * What every configuration hook calls after the roster refresh:
   *   1. bump shiftConfigVersion of the affected schedules (SEQUENCE / cache key),
   *   2. purge the calendar-feed caches of those schedules and of the users
   *      the change names directly,
   *   3. tell the shift-change listeners (the reminder change pass) which
   *      schedules and users to look at again — delivered in the background,
   *      never awaited, never allowed to fail the edit.
   * Never throws.
   */
  @CaptureSpan()
  public async propagateShiftConfigChange(
    change: ShiftConfigChange,
  ): Promise<void> {
    try {
      const scheduleIds: Array<ObjectID> = OnCallShiftChangeListeners.dedupe(
        change.scheduleIds,
      );
      const explicitUserIds: Array<ObjectID> =
        OnCallShiftChangeListeners.dedupe(change.userIds || []);

      if (scheduleIds.length > 0 && !change.skipVersionBump) {
        await this.bumpShiftConfigVersion(scheduleIds);
      }

      for (const scheduleId of scheduleIds) {
        try {
          await OnCallCalendarFeedCache.purgeForSchedule(scheduleId.toString());
        } catch (err) {
          logger.error(err);
        }
      }

      if (change.projectId) {
        for (const userId of explicitUserIds) {
          try {
            await OnCallCalendarFeedCache.purgeForUser(
              change.projectId.toString(),
              userId.toString(),
            );
          } catch (err) {
            logger.error(err);
          }
        }
      }

      let userIds: Array<ObjectID> = explicitUserIds;

      if (scheduleIds.length > 0) {
        try {
          const members: Array<OnCallDutyPolicyScheduleLayerUser> =
            await OnCallDutyPolicyScheduleLayerUserService.findBy({
              query: {
                onCallDutyPolicyScheduleId: QueryHelper.any(scheduleIds),
              },
              select: {
                userId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          userIds = OnCallShiftChangeListeners.dedupe([
            ...explicitUserIds,
            ...members
              .map((member: OnCallDutyPolicyScheduleLayerUser) => {
                return member.userId;
              })
              .filter((id: ObjectID | undefined): id is ObjectID => {
                return Boolean(id);
              }),
          ]);
        } catch (err) {
          logger.error(
            "Error loading schedule members for the shift-change event (best-effort).",
          );
          logger.error(err);
        }
      }

      const event: OnCallShiftChangeEvent =
        OnCallShiftChangeListeners.buildEvent({
          projectId: change.projectId,
          scheduleIds,
          userIds,
          reason: change.reason,
        });

      // Background delivery; notify never rejects, the catch is belt-and-braces.
      OnCallShiftChangeListeners.notify(event).catch((err: Error) => {
        logger.error(err);
      });
    } catch (err) {
      logger.error(
        "Error propagating an on-call configuration change (best-effort).",
      );
      logger.error(err);
    }
  }

  private async fetchOverridesForSchedule(data: {
    projectId: ObjectID;
    scheduleUserIds: Array<ObjectID>;
    windowStart: Date;
    windowEnd: Date;
    currentOnCallDutyPolicyId?: ObjectID | undefined;
  }): Promise<Array<UserOverrideRecord>> {
    if (data.scheduleUserIds.length === 0) {
      return [];
    }

    /*
     * When a policy context is provided, include overrides scoped to that
     * policy plus global overrides. Without a policy context (e.g. schedule
     * roster refresh, dashboard preview, incoming-call routing), only global
     * overrides apply — a policy-specific override from one policy must not
     * affect schedule resolution for a different policy.
     */
    const overrides: Array<OnCallDutyPolicyUserOverride> =
      await OnCallDutyPolicyUserOverrideService.findBy({
        query: {
          projectId: data.projectId,
          startsAt: QueryHelper.lessThanEqualTo(data.windowEnd),
          endsAt: QueryHelper.greaterThanEqualTo(data.windowStart),
          onCallDutyPolicyId: data.currentOnCallDutyPolicyId
            ? QueryHelper.equalToOrNull(data.currentOnCallDutyPolicyId)
            : QueryHelper.isNull(),
        },
        select: {
          startsAt: true,
          endsAt: true,
          overrideUserId: true,
          routeAlertsToUserId: true,
          onCallDutyPolicyId: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const scheduleUserIdSet: Set<string> = new Set<string>(
      data.scheduleUserIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    return overrides
      .filter((o: OnCallDutyPolicyUserOverride) => {
        const overrideUserId: string = o.overrideUserId?.toString() || "";
        return scheduleUserIdSet.has(overrideUserId);
      })
      .map((o: OnCallDutyPolicyUserOverride): UserOverrideRecord => {
        return {
          overrideUserId: o.overrideUserId?.toString() || "",
          routeAlertsToUserId: o.routeAlertsToUserId?.toString() || "",
          startsAt: o.startsAt!,
          endsAt: o.endsAt!,
          onCallDutyPolicyId: o.onCallDutyPolicyId?.toString() || null,
        };
      });
  }

  /*
   * Compute how far out to resolve calendar events. Returns at least 1 year
   * from `from`, but extends far enough to contain (getNumberOfEvents + 1)
   * rotation periods for the slowest layer, so multi-year rotations still yield
   * a current and next event.
   */
  private computeResolutionWindowEnd(
    layerProps: Array<LayerProps>,
    from: Date,
    getNumberOfEvents: number,
  ): Date {
    const periodsNeeded: number = Math.max(2, getNumberOfEvents + 1);

    let windowEnd: Date = from;
    let anyLayerRestricted: boolean = false;

    for (const layer of layerProps) {
      if (this.isLayerRestricted(layer)) {
        anyLayerRestricted = true;
      }

      if (!layer.rotation) {
        continue;
      }

      let recurring: Recurring;
      try {
        recurring =
          layer.rotation instanceof Recurring
            ? layer.rotation
            : Recurring.fromJSON(layer.rotation as any);
      } catch {
        continue;
      }

      let candidate: Date = from;
      for (let i: number = 0; i < periodsNeeded; i++) {
        candidate = Recurring.getNextDateInterval(candidate, recurring);
      }

      if (OneUptimeDate.isAfter(candidate, windowEnd)) {
        windowEnd = candidate;
      }
    }

    /*
     * Floor the window. Restricted layers can have long coverage gaps (a
     * weekend-only or business-hours restriction), so the next COVERED event may
     * be far past the naive (getNumberOfEvents + 1)-period horizon — keep a
     * generous 1-year floor for them so a current/next user is still found.
     * UNRESTRICTED layers produce exactly one event per rotation period, so the
     * per-layer candidate above already spans the events we need; flooring those
     * at a full year forced a fast (hourly/daily) rotation to materialize
     * thousands of events on every resolution, and getMultiLayerEvents then ran
     * an O(n^2) overlap merge over them — a real worker stall (audit H2). For
     * unrestricted layers a small 1-day floor is ample margin.
     */
    const floor: Date = anyLayerRestricted
      ? OneUptimeDate.addRemoveYears(from, 1)
      : OneUptimeDate.addRemoveDays(from, 1);

    if (OneUptimeDate.isBefore(windowEnd, floor)) {
      windowEnd = floor;
    }

    return windowEnd;
  }

  /*
   * True when the layer carries an active (non-None) restriction. Handles both a
   * hydrated RestrictionTimes instance (exposes `restictionType`) and the raw
   * serialized JSON form ({ _type, value: { restictionType } }) so it is safe
   * regardless of where the LayerProps came from.
   */
  private isLayerRestricted(layer: LayerProps): boolean {
    const rt: unknown = layer.restrictionTimes;
    if (!rt) {
      return false;
    }
    const anyRt: {
      restictionType?: RestrictionType | string;
      value?: { restictionType?: RestrictionType | string };
    } = rt as {
      restictionType?: RestrictionType | string;
      value?: { restictionType?: RestrictionType | string };
    };
    const type: RestrictionType | string | undefined =
      anyRt.restictionType || anyRt.value?.restictionType;
    return Boolean(type) && type !== RestrictionType.None;
  }

  /*
   * Mirror of computeResolutionWindowEnd, stepping BACKWARDS: the earliest of
   * `from` minus `periodsBack` rotation periods across the layers (at least a
   * day). Used to recover the true, un-clamped start of the current coverage
   * window for rosterStartAt (audit F12).
   */
  private computeResolutionWindowStart(
    layerProps: Array<LayerProps>,
    from: Date,
    periodsBack: number,
  ): Date {
    let windowStart: Date = OneUptimeDate.addRemoveDays(from, -1);

    for (const layer of layerProps) {
      if (!layer.rotation) {
        continue;
      }

      let recurring: Recurring;
      try {
        recurring =
          layer.rotation instanceof Recurring
            ? layer.rotation
            : Recurring.fromJSON(layer.rotation as any);
      } catch {
        continue;
      }

      let candidate: Date = from;
      for (let i: number = 0; i < periodsBack; i++) {
        candidate = Recurring.getNextDateInterval(candidate, recurring, true);
      }

      if (OneUptimeDate.isBefore(candidate, windowStart)) {
        windowStart = candidate;
      }
    }

    return windowStart;
  }

  /*
   * Mirror of computeResolutionWindowStart, stepping FORWARDS: the latest of
   * `from` plus `periodsForward` rotation periods across the layers (at least
   * a day). The calendar-feed resolver widens its expansion this far past the
   * requested window so the last overlapping segment carries its true end
   * instead of the engine's clamp to the window edge.
   */
  private computeResolutionWindowEndByPeriods(
    layerProps: Array<LayerProps>,
    from: Date,
    periodsForward: number,
  ): Date {
    let windowEnd: Date = OneUptimeDate.addRemoveDays(from, 1);

    for (const layer of layerProps) {
      if (!layer.rotation) {
        continue;
      }

      let recurring: Recurring;
      try {
        recurring =
          layer.rotation instanceof Recurring
            ? layer.rotation
            : Recurring.fromJSON(layer.rotation as any);
      } catch {
        continue;
      }

      let candidate: Date = from;
      for (let i: number = 0; i < periodsForward; i++) {
        candidate = Recurring.getNextDateInterval(candidate, recurring);
      }

      if (OneUptimeDate.isAfter(candidate, windowEnd)) {
        windowEnd = candidate;
      }
    }

    return windowEnd;
  }

  /*
   * Recover the TRUE start of the current on-call coverage window for
   * `currentUserId`. getEventByIndexInSchedule always expands from `now`, and
   * LayerUtil clamps the first event's start to the window start, so the current
   * event's start reads ~now rather than when the shift actually began. We
   * re-expand over a bounded lookback window and return the start of the segment
   * that covers `now` for the current user. Best-effort: any failure (or no
   * covering segment found) falls back to the clamped value, so the who-is-paged
   * path is never affected (audit F12).
   */
  private async getTrueRosterStartAt(data: {
    scheduleId: ObjectID;
    currentUserId: ObjectID;
    now: Date;
    onCallDutyPolicyId?: ObjectID | undefined;
    fallbackStart: Date;
  }): Promise<Date> {
    try {
      const { layerProps, projectId, scheduleUserIds } =
        await this.getScheduleLayerProps({ scheduleId: data.scheduleId });

      if (layerProps.length === 0) {
        return data.fallbackStart;
      }

      const windowStart: Date = this.computeResolutionWindowStart(
        layerProps,
        data.now,
        2,
      );
      const windowEnd: Date = OneUptimeDate.addRemoveSeconds(data.now, 1);

      let events: Array<CalendarEvent> = this.layerUtil.getMultiLayerEvents({
        layers: layerProps,
        calendarStartDate: windowStart,
        calendarEndDate: windowEnd,
      });

      if (projectId && events.length > 0) {
        const overrides: Array<UserOverrideRecord> =
          await this.fetchOverridesForSchedule({
            projectId,
            scheduleUserIds,
            windowStart,
            windowEnd,
            currentOnCallDutyPolicyId: data.onCallDutyPolicyId,
          });

        if (overrides.length > 0) {
          events = UserOverrideUtil.applyOverridesToEvents({
            events,
            overrides,
            currentOnCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
          });
        }
      }

      const currentUserIdStr: string = data.currentUserId.toString();

      for (const event of events) {
        if (!event) {
          continue;
        }

        if (
          event.title === currentUserIdStr &&
          OneUptimeDate.isOnOrBefore(event.start, data.now) &&
          OneUptimeDate.isOnOrAfter(event.end, data.now)
        ) {
          return event.start;
        }
      }
    } catch (err) {
      logger.error(err);
    }

    return data.fallbackStart;
  }

  public async getEventByIndexInSchedule(data: {
    scheduleId: ObjectID;
    getNumberOfEvents: number; // which event would you like to get. First event, second event, etc.
    onCallDutyPolicyId?: ObjectID | undefined;
  }): Promise<Array<CalendarEvent>> {
    logger.debug(
      "getEventByIndexInSchedule called with data: " + JSON.stringify(data),
      {
        onCallDutyPolicyScheduleId: data.scheduleId.toString(),
      } as LogAttributes,
    );

    const { layerProps, projectId, scheduleUserIds } =
      await this.getScheduleLayerProps({
        scheduleId: data.scheduleId,
      });

    logger.debug("Layer properties fetched: " + JSON.stringify(layerProps), {
      onCallDutyPolicyScheduleId: data.scheduleId.toString(),
    } as LogAttributes);

    if (layerProps.length === 0) {
      logger.debug(
        "No layers found for scheduleId: " + data.scheduleId.toString(),
        {
          onCallDutyPolicyScheduleId: data.scheduleId.toString(),
        } as LogAttributes,
      );
      return [];
    }

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    logger.debug("Current start time: " + currentStartTime.toISOString(), {
      onCallDutyPolicyScheduleId: data.scheduleId.toString(),
    } as LogAttributes);

    /*
     * Size the resolution window from the layers' rotations rather than a fixed
     * 1 year. A rotation period longer than a year (e.g. a 3-year rotation)
     * would otherwise clamp the current event's end to now+1yr and report a
     * bogus handoff time with no "next" user. The window is at least 1 year and
     * large enough to contain the requested number of events for the slowest
     * layer.
     */
    const currentEndTime: Date = this.computeResolutionWindowEnd(
      layerProps,
      currentStartTime,
      data.getNumberOfEvents,
    );
    logger.debug("Current end time: " + currentEndTime.toISOString(), {
      onCallDutyPolicyScheduleId: data.scheduleId.toString(),
    } as LogAttributes);

    const numberOfEventsToGet: number = data.getNumberOfEvents;
    logger.debug("Number of events to get: " + numberOfEventsToGet, {
      onCallDutyPolicyScheduleId: data.scheduleId.toString(),
    } as LogAttributes);

    let events: Array<CalendarEvent> = this.layerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: numberOfEventsToGet,
      },
    );

    if (projectId && events.length > 0) {
      const overrides: Array<UserOverrideRecord> =
        await this.fetchOverridesForSchedule({
          projectId,
          scheduleUserIds,
          windowStart: currentStartTime,
          windowEnd: currentEndTime,
          currentOnCallDutyPolicyId: data.onCallDutyPolicyId,
        });

      if (overrides.length > 0) {
        events = UserOverrideUtil.applyOverridesToEvents({
          events,
          overrides,
          currentOnCallDutyPolicyId: data.onCallDutyPolicyId?.toString(),
        });
      }
    }

    logger.debug("Events fetched: " + JSON.stringify(events), {
      onCallDutyPolicyScheduleId: data.scheduleId.toString(),
    } as LogAttributes);

    return events;
  }

  @CaptureSpan()
  public async getCurrentUserIdInSchedule(
    scheduleId: ObjectID,
    options?: { onCallDutyPolicyId?: ObjectID | undefined } | undefined,
  ): Promise<ObjectID | null> {
    const { layerProps, projectId, scheduleUserIds } =
      await this.getScheduleLayerProps({
        scheduleId: scheduleId,
      });

    if (layerProps.length === 0) {
      return null;
    }

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveSeconds(
      currentStartTime,
      1,
    );

    let events: Array<CalendarEvent> = this.layerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: 1,
      },
    );

    if (projectId && events.length > 0) {
      const overrides: Array<UserOverrideRecord> =
        await this.fetchOverridesForSchedule({
          projectId,
          scheduleUserIds,
          windowStart: currentStartTime,
          windowEnd: currentEndTime,
          currentOnCallDutyPolicyId: options?.onCallDutyPolicyId,
        });

      if (overrides.length > 0) {
        events = UserOverrideUtil.applyOverridesToEvents({
          events,
          overrides,
          currentOnCallDutyPolicyId: options?.onCallDutyPolicyId?.toString(),
        });
      }
    }

    const currentEvent: CalendarEvent | null = events[0] || null;

    if (!currentEvent) {
      return null;
    }

    const userId: string | undefined = currentEvent?.title; // this is user id in string.

    if (!userId) {
      return null;
    }

    return new ObjectID(userId);
  }
}

export default new Service();
