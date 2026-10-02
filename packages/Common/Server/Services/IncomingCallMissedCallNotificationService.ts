import DatabaseConfig from "../DatabaseConfig";
import BaseService from "./BaseService";
import IncomingCallLogItemService from "./IncomingCallLogItemService";
import IncomingCallLogService from "./IncomingCallLogService";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import ProjectService from "./ProjectService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import MissedCallNotification, {
  MissedCall,
  MissedCallAttempt,
  MissedCallNotificationContent,
} from "../Utils/IncomingCall/MissedCallNotification";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import MissedIncomingCall, {
  MissedIncomingCallReason,
} from "../../Types/IncomingCall/MissedIncomingCall";
import ObjectID from "../../Types/ObjectID";
import IncomingCallLog from "../../Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "../../Models/DatabaseModels/IncomingCallLogItem";
import User from "../../Models/DatabaseModels/User";

/*
 * Tells an Incoming Call Policy's owners when a call to it ended without
 * reaching anyone (issue #4159). Before this, a missed call was only a row in
 * the policy's call log that somebody had to go and look at.
 *
 * Owner users and the accepted members of owner teams are told; a policy with
 * no owners falls back to the project owners, as monitor status changes do.
 * Each person gets it on the channels they chose for "missed call" in
 * Notification Settings - email unless they changed it.
 */
export class IncomingCallMissedCallNotificationService extends BaseService {
  /**
   * Never throws. It runs once the call has already ended, and nothing that
   * goes wrong while telling people about it may reach the call provider's
   * webhook response.
   */
  @CaptureSpan()
  public async notifyOwnersOfMissedCall(data: {
    incomingCallLogId: ObjectID;
  }): Promise<void> {
    try {
      await this.notifyOwners(data.incomingCallLogId);
    } catch (err: unknown) {
      logger.error(
        `IncomingCallMissedCallNotificationService: failed to notify owners about missed call ${data.incomingCallLogId?.toString()}: ${err}`,
        {
          incomingCallLogId: data.incomingCallLogId?.toString(),
        } as LogAttributes,
      );
    }
  }

  public async getIncomingCallLogLinkInDashboard(data: {
    projectId: ObjectID;
    incomingCallPolicyId: ObjectID;
    incomingCallLogId: ObjectID;
  }): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    /*
     * Mirrors the Dashboard's ON_CALL_DUTY_INCOMING_CALL_POLICY_VIEW_LOG_VIEW
     * route. Spelled out because Common/Server cannot import App sources.
     */
    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${data.projectId.toString()}/on-call-duty/incoming-call-policies/${data.incomingCallPolicyId.toString()}/logs/${data.incomingCallLogId.toString()}`,
    );
  }

  private async notifyOwners(incomingCallLogId: ObjectID): Promise<void> {
    const callLog: IncomingCallLog | null =
      await IncomingCallLogService.findOneById({
        id: incomingCallLogId,
        select: {
          _id: true,
          projectId: true,
          incomingCallPolicyId: true,
          status: true,
          statusMessage: true,
          callerPhoneNumber: true,
          routingPhoneNumber: true,
          startedAt: true,
          endedAt: true,
          project: {
            name: true,
          },
          incomingCallPolicy: {
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!callLog || !callLog.projectId || !callLog.incomingCallPolicyId) {
      logger.error(
        `IncomingCallMissedCallNotificationService: call log ${incomingCallLogId.toString()} was not found, so nobody can be told it was missed.`,
      );
      return;
    }

    const projectId: ObjectID = callLog.projectId;
    const incomingCallPolicyId: ObjectID = callLog.incomingCallPolicyId;

    const logAttributes: LogAttributes = {
      projectId: projectId.toString(),
      incomingCallPolicyId: incomingCallPolicyId.toString(),
      incomingCallLogId: incomingCallLogId.toString(),
    } as LogAttributes;

    const reason: MissedIncomingCallReason | null =
      MissedIncomingCall.getReason({
        status: callLog.status,
        statusMessage: callLog.statusMessage,
      });

    // Only a call that ended without reaching anyone is a missed call.
    if (!reason) {
      logger.debug(
        `IncomingCallMissedCallNotificationService: call log ${incomingCallLogId.toString()} ended as ${callLog.status?.toString()}, which is not a missed call. Nobody is notified.`,
        logAttributes,
      );
      return;
    }

    let isOwner: boolean = true;
    let recipients: Array<User> =
      await IncomingCallPolicyService.findOwners(incomingCallPolicyId);

    if (recipients.length === 0) {
      isOwner = false;
      recipients = await ProjectService.getOwners(projectId);
    }

    if (recipients.length === 0) {
      logger.warn(
        `IncomingCallMissedCallNotificationService: incoming call policy ${incomingCallPolicyId.toString()} has no owners and project ${projectId.toString()} has no owners, so nobody can be told about missed call ${incomingCallLogId.toString()}. Add an owner to the policy.`,
        logAttributes,
      );
      return;
    }

    const call: MissedCall = {
      policyName:
        callLog.incomingCallPolicy?.name?.toString() || "Incoming Call Policy",
      projectName: callLog.project?.name?.toString() || "",
      callerPhoneNumber: callLog.callerPhoneNumber?.toString() || "",
      routingPhoneNumber: callLog.routingPhoneNumber?.toString() || "",
      reason: reason,
      statusMessage: callLog.statusMessage || "",
      startedAt: callLog.startedAt,
      endedAt: callLog.endedAt,
      attempts: await this.getAttempts(incomingCallLogId),
      incomingCallLogViewLink: (
        await this.getIncomingCallLogLinkInDashboard({
          projectId: projectId,
          incomingCallPolicyId: incomingCallPolicyId,
          incomingCallLogId: incomingCallLogId,
        })
      ).toString(),
    };

    const seenUserIds: Set<string> = new Set<string>();

    for (const user of recipients) {
      const userId: ObjectID | null | undefined = user.id;

      if (!userId || seenUserIds.has(userId.toString())) {
        continue;
      }

      seenUserIds.add(userId.toString());

      /*
       * Per-recipient isolation: one person with a broken notification
       * setup must not cost the others their notification.
       */
      try {
        const content: MissedCallNotificationContent =
          MissedCallNotification.buildContent({
            call: call,
            isOwner: isOwner,
            timezone: user.timezone,
          });

        /*
         * sendUserNotification sends nothing without a setting row. Members
         * who joined before this event existed get the default (email on)
         * here; a row the user already switched off is left alone.
         */
        await UserNotificationSettingService.ensureSettingExistsForUser({
          userId: userId,
          projectId: projectId,
          eventType: MissedCallNotification.EVENT_TYPE,
        });

        await UserNotificationSettingService.sendUserNotification({
          userId: userId,
          projectId: projectId,
          eventType: MissedCallNotification.EVENT_TYPE,
          emailEnvelope: content.emailEnvelope,
          smsMessage: content.smsMessage,
          callRequestMessage: content.callRequestMessage,
          pushNotificationMessage: content.pushNotificationMessage,
          whatsAppMessage: content.whatsAppMessage,
        });
      } catch (err: unknown) {
        logger.error(
          `IncomingCallMissedCallNotificationService: failed to notify user ${userId.toString()} about missed call ${incomingCallLogId.toString()}: ${err}`,
          logAttributes,
        );
      }
    }
  }

  // Every dial attempt of the call, in the order it was made.
  private async getAttempts(
    incomingCallLogId: ObjectID,
  ): Promise<Array<MissedCallAttempt>> {
    const items: Array<IncomingCallLogItem> =
      await IncomingCallLogItemService.findBy({
        query: {
          incomingCallLogId: incomingCallLogId,
        },
        select: {
          _id: true,
          status: true,
          startedAt: true,
          endedAt: true,
          userPhoneNumber: true,
          user: {
            name: true,
            email: true,
          },
          incomingCallPolicyEscalationRule: {
            name: true,
            order: true,
          },
        },
        sort: {
          startedAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    return items.map((item: IncomingCallLogItem): MissedCallAttempt => {
      const ruleName: string =
        item.incomingCallPolicyEscalationRule?.name?.toString().trim() || "";
      const ruleOrder: number | undefined =
        item.incomingCallPolicyEscalationRule?.order;

      return {
        userName:
          item.user?.name?.toString() || item.user?.email?.toString() || "",
        phoneNumber: item.userPhoneNumber?.toString() || "",
        ruleName:
          ruleName ||
          (ruleOrder !== undefined && ruleOrder !== null
            ? `Rule ${ruleOrder}`
            : ""),
        status: item.status,
        ringSeconds: MissedCallNotification.getSecondsBetween(
          item.startedAt,
          item.endedAt,
        ),
      };
    });
  }
}

export default new IncomingCallMissedCallNotificationService();
