import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentSlaService from "Common/Server/Services/IncidentSlaService";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import IncidentSlaStatus from "Common/Types/Incident/IncidentSlaStatus";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import ProjectService from "Common/Server/Services/ProjectService";
import User from "Common/Models/DatabaseModels/User";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import Incident from "Common/Models/DatabaseModels/Incident";
import Dictionary from "Common/Types/Dictionary";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";

/**
 * This job checks SLAs for breach conditions and updates their status:
 * - OnTrack -> AtRisk: when elapsed time >= (deadline * atRiskThresholdInPercentage/100)
 * - OnTrack/AtRisk -> Breached: when current time > deadline
 * Runs every minute.
 */
RunCron(
  "IncidentSla:CheckSlaBreaches",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    const now: Date = OneUptimeDate.getCurrentDate();

    // Get all SLAs that need breach checking (OnTrack or AtRisk, not resolved)
    const slasToCheck: Array<IncidentSla> =
      await IncidentSlaService.getSlasNeedingBreachCheck();

    for (const sla of slasToCheck) {
      if (!sla.id || !sla.slaStartedAt) {
        continue;
      }

      try {
        const atRiskThreshold: number =
          sla.incidentSlaRule?.atRiskThresholdInPercentage || 80;

        let newStatus: IncidentSlaStatus | null = null;
        let breachType: "response" | "resolution" | null = null;

        // Check response deadline first
        if (
          sla.responseDeadline &&
          !sla.respondedAt &&
          sla.status !== IncidentSlaStatus.ResponseBreached
        ) {
          // Check if response deadline is breached
          if (OneUptimeDate.isAfter(now, sla.responseDeadline)) {
            newStatus = IncidentSlaStatus.ResponseBreached;
            breachType = "response";
          } else if (sla.status === IncidentSlaStatus.OnTrack) {
            // Check if at risk for response
            const totalResponseTime: number = OneUptimeDate.getDifferenceInMinutes(
              sla.responseDeadline,
              sla.slaStartedAt,
            );
            const elapsedTime: number = OneUptimeDate.getDifferenceInMinutes(
              now,
              sla.slaStartedAt,
            );
            const percentageElapsed: number =
              (elapsedTime / totalResponseTime) * 100;

            if (percentageElapsed >= atRiskThreshold) {
              newStatus = IncidentSlaStatus.AtRisk;
            }
          }
        }

        // Check resolution deadline (takes precedence over response)
        if (
          sla.resolutionDeadline &&
          sla.status !== IncidentSlaStatus.ResolutionBreached
        ) {
          // Check if resolution deadline is breached
          if (OneUptimeDate.isAfter(now, sla.resolutionDeadline)) {
            newStatus = IncidentSlaStatus.ResolutionBreached;
            breachType = "resolution";
          } else if (
            sla.status === IncidentSlaStatus.OnTrack ||
            sla.status === IncidentSlaStatus.AtRisk
          ) {
            // Check if at risk for resolution (only if not already breached for response)
            if (newStatus !== IncidentSlaStatus.ResponseBreached) {
              const totalResolutionTime: number =
                OneUptimeDate.getDifferenceInMinutes(
                  sla.resolutionDeadline,
                  sla.slaStartedAt,
                );
              const elapsedTime: number = OneUptimeDate.getDifferenceInMinutes(
                now,
                sla.slaStartedAt,
              );
              const percentageElapsed: number =
                (elapsedTime / totalResolutionTime) * 100;

              if (
                percentageElapsed >= atRiskThreshold &&
                sla.status === IncidentSlaStatus.OnTrack
              ) {
                newStatus = IncidentSlaStatus.AtRisk;
              }
            }
          }
        }

        // Update status if changed
        if (newStatus && newStatus !== sla.status) {
          const updateData: {
            status: IncidentSlaStatus;
            breachNotificationSentAt?: Date;
          } = {
            status: newStatus,
          };

          // If breached, mark notification as being sent now
          if (
            (newStatus === IncidentSlaStatus.ResponseBreached ||
              newStatus === IncidentSlaStatus.ResolutionBreached) &&
            !sla.breachNotificationSentAt
          ) {
            updateData.breachNotificationSentAt = now;
          }

          await IncidentSlaService.updateOneById({
            id: sla.id,
            data: updateData,
            props: {
              isRoot: true,
            },
          });

          logger.info(
            `SLA ${sla.id} status changed from ${sla.status} to ${newStatus}`,
          );

          // Send breach notification if breached
          if (
            breachType &&
            (newStatus === IncidentSlaStatus.ResponseBreached ||
              newStatus === IncidentSlaStatus.ResolutionBreached)
          ) {
            await sendBreachNotification({
              sla,
              breachType,
            });
          }
        }
      } catch (error) {
        logger.error(`Error checking SLA breach for ${sla.id}: ${error}`);
      }
    }
  },
);

async function sendBreachNotification(data: {
  sla: IncidentSla;
  breachType: "response" | "resolution";
}): Promise<void> {
  const { sla, breachType } = data;

  if (!sla.incidentId || !sla.projectId) {
    return;
  }

  try {
    // Get the incident details
    const incident: Incident | null = await IncidentService.findOneById({
      id: sla.incidentId,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        projectId: true,
        project: {
          name: true,
        },
        currentIncidentState: {
          name: true,
        },
        incidentSeverity: {
          name: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return;
    }

    // Get incident owners
    let owners: Array<User> = await IncidentService.findOwners(sla.incidentId);

    if (owners.length === 0) {
      // Fall back to project owners
      owners = await ProjectService.getOwners(sla.projectId);
    }

    if (owners.length === 0) {
      return;
    }

    const incidentNumberStr: string = incident.incidentNumber
      ? `#${incident.incidentNumber}`
      : "";

    const incidentViewLink: string = (
      await IncidentService.getIncidentLinkInDashboard(
        incident.projectId!,
        incident.id!,
      )
    ).toString();

    const breachTypeStr: string =
      breachType === "response" ? "Response" : "Resolution";

    const deadline: Date | undefined =
      breachType === "response" ? sla.responseDeadline : sla.resolutionDeadline;

    const deadlineStr: string = deadline
      ? OneUptimeDate.getDateAsLocalFormattedString(deadline)
      : "N/A";

    const ruleName: string = sla.incidentSlaRule?.name || "SLA Rule";

    const vars: Dictionary<string> = {
      incidentTitle: incident.title!,
      incidentNumber: incidentNumberStr,
      projectName: incident.project!.name!,
      currentState: incident.currentIncidentState?.name || "Unknown",
      incidentSeverity: incident.incidentSeverity?.name || "Unknown",
      breachType: breachTypeStr,
      deadline: deadlineStr,
      slaRuleName: ruleName,
      incidentViewLink: incidentViewLink,
    };

    for (const user of owners) {
      const emailMessage: EmailEnvelope = {
        templateType: EmailTemplateType.IncidentOwnerResourceCreated, // Using a generic template
        vars: {
          ...vars,
          subject: `[SLA ${breachTypeStr} Breached] Incident ${incidentNumberStr} - ${incident.title}`,
        },
        subject: `[SLA ${breachTypeStr} Breached] Incident ${incidentNumberStr} - ${incident.title}`,
      };

      const sms: SMSMessage = {
        message: `SLA ${breachTypeStr} Breached for incident ${incident.title} ${incidentNumberStr}. Deadline was ${deadlineStr}. View incident in OneUptime Dashboard.`,
      };

      const callMessage: CallRequestMessage = {
        data: [
          {
            sayMessage: `This is an alert from OneUptime. SLA ${breachTypeStr} has been breached for incident ${incident.title}. The deadline was ${deadlineStr}. Please check the incident in OneUptime Dashboard immediately.`,
          },
        ],
      };

      const eventType: NotificationSettingEventType =
        NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

      const pushMessage: PushNotificationMessage = {
        title: `SLA ${breachTypeStr} Breached`,
        body: `SLA ${breachTypeStr} breached for incident ${incident.title} ${incidentNumberStr}`,
      };

      const whatsAppMessage: WhatsAppMessagePayload =
        createWhatsAppMessageFromTemplate({
          eventType,
          templateVariables: {
            incident_title: incident.title!,
            incident_number: incident.incidentNumber?.toString() || "",
            incident_link: incidentViewLink,
          },
        });

      await UserNotificationSettingService.sendUserNotification({
        userId: user.id!,
        projectId: sla.projectId,
        emailEnvelope: emailMessage,
        smsMessage: sms,
        callRequestMessage: callMessage,
        pushNotificationMessage: pushMessage,
        whatsAppMessage,
        eventType,
      });
    }

    logger.info(
      `Sent SLA ${breachType} breach notification for incident ${sla.incidentId}`,
    );
  } catch (error) {
    logger.error(
      `Error sending SLA breach notification for incident ${sla.incidentId}: ${error}`,
    );
  }
}
