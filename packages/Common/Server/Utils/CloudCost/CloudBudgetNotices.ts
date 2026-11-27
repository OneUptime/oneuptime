import CloudBudget from "../../../Models/DatabaseModels/CloudBudget";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import { CLOUD_BUDGET_ALERT_FROM_PERCENT } from "../../../Types/Cloud/CloudBudget";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { OwnerNotificationKind } from "../../../Types/Notification/OwnerNotificationDelivery";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import DatabaseConfig from "../../DatabaseConfig";
import AccessTokenService from "../../Services/AccessTokenService";
import TeamMemberService from "../../Services/TeamMemberService";
import UserNotificationSettingService from "../../Services/UserNotificationSettingService";
import logger from "../Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "../Notification/OwnerNotificationDeliveries";
import CallerPermission from "../Permission/CallerPermission";
import PushNotificationUtil from "../PushNotificationUtil";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * TELLING A BUDGET'S PEOPLE OF AN EARLY THRESHOLD, WITH NO ALERT (#11008).
 *
 * A cloud budget names who hears of it: people and teams picked, and - a
 * cost group's budget - the group's team. Below 100% they are told the
 * spend passed a threshold, each through their own notification settings
 * for SEND_CLOUD_BUDGET_THRESHOLD_NOTIFICATION: by email, and in Slack,
 * Microsoft Teams and Mattermost as they have those on for alerts (the
 * setting starts so: addCloudBudgetNotificationSettings) - never paged. At
 * 100% and when on course to pass, the budget raises an alert instead, and
 * they hear of it as its owners (CloudBudgetEvaluator).
 *
 * Only people who may read the project's budgets are told: a budget's
 * spend is the cloud's spend. Each is told once for each threshold of each
 * of the budget's windows, however the worker stops: whom it is to tell is
 * written first (OwnerNotificationDeliveries.plan), the budget's state
 * records the threshold, then each is told; a run that stopped part way
 * leaves its people to the next, which tells them first (resume).
 */

export const CLOUD_BUDGET_NOTICE_KIND: OwnerNotificationKind =
  OwnerNotificationKind.CloudBudgetThresholdPassed;

// What every message about one threshold says.
export interface CloudBudgetNoticeFacts {
  budgetId: ObjectID;
  projectId: ObjectID;
  budgetName: string;
  projectName: string;
  threshold: number;
  // "Cloud budget "Payments" passed 80%".
  title: string;
  // What was spent, of what, and where the window is heading.
  description: string;
  // What cost the most, when the scope's services were named.
  rootCause?: string | undefined;
  // The budget's page.
  budgetLink: string;
}

export interface CloudBudgetNoticeContent {
  eventType: NotificationSettingEventType;
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
}

// Each brace, so a budget's name never makes a Handlebars expression of a subject.
const ALL_BRACES: RegExp = /[{}]/g;

export default class CloudBudgetNotices {
  public static readonly EVENT_TYPE: NotificationSettingEventType =
    NotificationSettingEventType.SEND_CLOUD_BUDGET_THRESHOLD_NOTIFICATION;

  // A budget's notices replace each other on a phone: the newest is what counts.
  public static readonly PUSH_TAG: string = "cloud-budget-threshold";

  /*
   * A threshold of a window, as the notice's occurrence: the window's first
   * month and the threshold - 2026-10 and 80 are 2026100080. Each threshold
   * of each window is a notice of its own.
   */
  public static getOccurrence(data: {
    windowKey: string;
    threshold: number;
  }): number {
    const month: number = Number(data.windowKey.slice(0, 7).replace("-", ""));

    return (
      (Number.isFinite(month) ? month : 0) * 10000 +
      Math.max(0, Math.min(9999, Math.round(data.threshold)))
    );
  }

  // The threshold a notice's occurrence is of.
  public static getThresholdOfOccurrence(occurrence: number): number {
    return occurrence % 10000;
  }

  // The budget's page in the Dashboard.
  public static async getBudgetLink(data: {
    projectId: ObjectID;
    budgetId: ObjectID;
  }): Promise<string> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString())
      .addRoute(
        `/${data.projectId.toString()}/cloud/budgets/${data.budgetId.toString()}`,
      )
      .toString();
  }

  public static getEmailSubject(facts: CloudBudgetNoticeFacts): string {
    return `[Cloud Budget] ${facts.title.replace(ALL_BRACES, "")}`;
  }

  // Why no alert came with it, in a sentence every channel ends with.
  public static getNoAlertSentence(): string {
    return `No alert was raised: the budget raises one at ${CLOUD_BUDGET_ALERT_FROM_PERCENT}%, and when it is on course to be passed.`;
  }

  public static buildContent(
    facts: CloudBudgetNoticeFacts,
  ): CloudBudgetNoticeContent {
    const noAlert: string = CloudBudgetNotices.getNoAlertSentence();
    const vars: Dictionary<string> = {
      budgetName: facts.budgetName,
      projectName: facts.projectName,
      title: facts.title,
      threshold: `${facts.threshold}%`,
      description: facts.description,
      rootCause: facts.rootCause || "",
      alertsFrom: `${CLOUD_BUDGET_ALERT_FROM_PERCENT}%`,
      budgetLink: facts.budgetLink,
    };

    return {
      eventType: CloudBudgetNotices.EVENT_TYPE,
      emailEnvelope: {
        templateType: EmailTemplateType.CloudBudgetThresholdPassed,
        vars,
        subject: CloudBudgetNotices.getEmailSubject(facts),
        isSubjectLiteral: true,
      },
      smsMessage: {
        message: buildNotificationSms(
          `${facts.title}. ${facts.description} ${noAlert}`,
        ),
      },
      callRequestMessage: {
        data: [
          {
            sayMessage: `This is a message from OneUptime. ${facts.title}. ${facts.description} ${noAlert} To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      },
      pushNotificationMessage: PushNotificationUtil.createGenericNotification({
        title: facts.title,
        body: `${facts.description} Tap to see the budget.`,
        clickAction: facts.budgetLink,
        tag: CloudBudgetNotices.PUSH_TAG,
        requireInteraction: false,
      }),
    };
  }

  /*
   * The people a budget names, as users: those picked, and the members of
   * the teams picked and of the cost group's team - each once.
   */
  @CaptureSpan()
  public static async getPeople(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
    teamIds: Array<ObjectID>;
  }): Promise<Array<User>> {
    const ids: Map<string, ObjectID> = new Map();

    for (const id of data.userIds) {
      ids.set(id.toString().toLowerCase(), id);
    }

    if (data.teamIds.length > 0) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          teamId: new Includes(data.teamIds),
          hasAcceptedInvitation: true,
        },
        select: { userId: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });

      for (const member of members) {
        if (member.userId) {
          ids.set(member.userId.toString().toLowerCase(), member.userId);
        }
      }
    }

    return Array.from(ids.values()).map((id: ObjectID): User => {
      const user: User = new User();
      user.id = id;
      return user;
    });
  }

  /*
   * Of `people`, those who may read the project's budgets, by the check
   * their own reads go through: their roles, and their blocks. Anyone who
   * has left the project reads nothing.
   */
  @CaptureSpan()
  public static async whoCanRead(data: {
    projectId: ObjectID;
    people: Array<User>;
  }): Promise<Array<User>> {
    const readers: Array<User> = [];

    for (const person of data.people) {
      if (
        person.id &&
        (await CloudBudgetNotices.canReadBudgets({
          userId: person.id,
          projectId: data.projectId,
        }))
      ) {
        readers.push(person);
      }
    }

    return readers;
  }

  public static async canReadBudgets(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    try {
      const props: DatabaseCommonInteractionProps =
        await AccessTokenService.getDatabaseCommonInteractionPropsByUserAndProject(
          {
            userId: data.userId,
            projectId: data.projectId,
          },
        );

      return (
        CallerPermission.isProjectMember(props, data.projectId) &&
        CallerPermission.holdsAnyOf(
          props,
          new CloudBudget().getReadPermissions(),
          { projectId: data.projectId },
        )
      );
    } catch (error) {
      if (!(error instanceof NotAuthorizedException)) {
        logger.error(
          `CloudBudgetNotices: could not tell whether user ${data.userId.toString()} can read cloud budgets in project ${data.projectId.toString()}: ${error}`,
        );
      }

      return false;
    }
  }

  /*
   * Writes whom a budget's threshold is to tell, before the budget records
   * it (see the top of this file). Never throws.
   */
  @CaptureSpan()
  public static async plan(data: {
    projectId: ObjectID;
    budgetId: ObjectID;
    windowKey: string;
    threshold: number;
    people: Array<User>;
  }): Promise<OwnerNotificationDelivery> {
    return OwnerNotificationDeliveries.plan({
      notification: {
        kind: CLOUD_BUDGET_NOTICE_KIND,
        projectId: data.projectId,
        resourceId: data.budgetId,
        eventId: data.budgetId,
        occurrence: CloudBudgetNotices.getOccurrence({
          windowKey: data.windowKey,
          threshold: data.threshold,
        }),
      },
      owners: data.people,
      isProjectOwners: false,
      writesFeedItem: false,
    });
  }

  /*
   * Tells a delivery's people of the threshold, each once: their setting
   * seeded first for one who has none, then sent on every channel it has
   * on. One person's failure is nobody else's. Returns how many were told.
   */
  @CaptureSpan()
  public static async tell(data: {
    delivery: OwnerNotificationDelivery;
    facts: CloudBudgetNoticeFacts;
  }): Promise<number> {
    if (!data.delivery.hasWorkToDo) {
      return 0;
    }

    const content: CloudBudgetNoticeContent = CloudBudgetNotices.buildContent(
      data.facts,
    );
    let told: number = 0;

    for (const user of data.delivery.owners) {
      const sent: boolean = await data.delivery.tell(
        user,
        async (): Promise<void> => {
          await UserNotificationSettingService.addCloudBudgetNotificationSettings(
            user.id!,
            data.facts.projectId,
          );

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id!,
            projectId: data.facts.projectId,
            eventType: content.eventType,
            emailEnvelope: content.emailEnvelope,
            smsMessage: content.smsMessage,
            callRequestMessage: content.callRequestMessage,
            pushNotificationMessage: content.pushNotificationMessage,
          });
        },
      );

      if (sent) {
        told++;
      }
    }

    return told;
  }

  /*
   * The people a stopped run left untold, told first, exactly them: their
   * budget read again, its threshold told with what it says now. A budget
   * deleted, or turned off, since is given up.
   */
  @CaptureSpan()
  public static async resume(data: {
    readFacts: (data: {
      budgetId: ObjectID;
      threshold: number;
    }) => Promise<CloudBudgetNoticeFacts | null>;
  }): Promise<void> {
    await OwnerNotificationDeliveries.resume({
      kinds: [CLOUD_BUDGET_NOTICE_KIND],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const facts: CloudBudgetNoticeFacts | null = await data.readFacts({
          budgetId: delivery.notification.resourceId,
          threshold: CloudBudgetNotices.getThresholdOfOccurrence(
            delivery.notification.occurrence,
          ),
        });

        if (!facts) {
          await delivery.giveUp("the budget is gone, or turned off");
          return;
        }

        await CloudBudgetNotices.tell({ delivery, facts });
      },
    });
  }
}
