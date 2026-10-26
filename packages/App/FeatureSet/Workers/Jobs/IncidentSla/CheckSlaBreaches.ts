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
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSlaBreachNotice, {
  IncidentSlaBreachFacts,
  IncidentSlaBreachMessages,
  IncidentSlaBreachType,
} from "Common/Server/Utils/Incident/IncidentSlaBreachNotice";

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
        let breachType: IncidentSlaBreachType | null = null;

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
            const totalResponseTime: number =
              OneUptimeDate.getDifferenceInMinutes(
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
            {
              projectId: sla.projectId?.toString(),
              incidentId: sla.incidentId?.toString(),
            },
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
        logger.error(`Error checking SLA breach for ${sla.id}: ${error}`, {
          projectId: sla.projectId?.toString(),
          incidentId: sla.incidentId?.toString(),
        });
      }
    }
  },
);

/*
 * Tells the incident's owners - the project's owners when it has none -
 * that its SLA was breached, on every channel each of them has on for
 * "Incident SLA breached" (IncidentSlaBreachNotice words it). Never throws:
 * a breach is recorded whether or not anyone could be told.
 */
async function sendBreachNotification(data: {
  sla: IncidentSla;
  breachType: IncidentSlaBreachType;
}): Promise<void> {
  const { sla, breachType } = data;

  if (!sla.incidentId || !sla.projectId) {
    return;
  }

  try {
    const incident: Incident | null = await IncidentService.findOneById({
      id: sla.incidentId,
      select: {
        _id: true,
        title: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        projectId: true,
        declaredAt: true,
        createdAt: true,
        project: {
          name: true,
        },
        currentIncidentState: {
          name: true,
          color: true,
        },
        incidentSeverity: {
          name: true,
          color: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      return;
    }

    let owners: Array<User> = await IncidentService.findOwners(sla.incidentId);
    const hasOwners: boolean = owners.length > 0;

    if (!hasOwners) {
      // The project's owners, for an incident with none.
      owners = await ProjectService.getOwners(sla.projectId);
    }

    if (owners.length === 0) {
      return;
    }

    const incidentViewLink: string = (
      await IncidentService.getIncidentLinkInDashboard(
        incident.projectId!,
        incident.id!,
      )
    ).toString();

    const facts: IncidentSlaBreachFacts = {
      breachType: breachType,
      deadline:
        breachType === "response"
          ? sla.responseDeadline
          : sla.resolutionDeadline,
      slaRuleName: sla.incidentSlaRule?.name,
      incidentTitle: incident.title || "",
      incidentNumber: incident.incidentNumber,
      incidentNumberWithPrefix: incident.incidentNumberWithPrefix,
      projectName: incident.project?.name || "",
      currentStateName: incident.currentIncidentState?.name,
      currentStateColor: incident.currentIncidentState?.color,
      severityName: incident.incidentSeverity?.name,
      severityColor: incident.incidentSeverity?.color,
      openedAt: incident.declaredAt || incident.createdAt,
      incidentViewLink: incidentViewLink,
      now: OneUptimeDate.getCurrentDate(),
    };

    for (const user of owners) {
      if (!user.id) {
        continue;
      }

      const messages: IncidentSlaBreachMessages =
        IncidentSlaBreachNotice.getMessages({
          facts: facts,
          recipient: {
            timezone: user.timezone,
            isOwner: hasOwners,
          },
        });

      /*
       * Nothing is sent for an event a person has no setting for. Somebody
       * who joined before SLA breaches had a setting of their own gets one
       * now, on the channels they had on for "Incident created", which
       * breaches were sent through before.
       */
      try {
        await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
          user.id,
          sla.projectId,
        );
      } catch (err) {
        logger.debug(
          `Could not make sure of a user's SLA breach notification setting: ${err}`,
          {
            projectId: sla.projectId?.toString(),
            incidentId: sla.incidentId?.toString(),
          },
        );
      }

      await UserNotificationSettingService.sendUserNotification({
        userId: user.id,
        projectId: sla.projectId,
        emailEnvelope: messages.emailEnvelope,
        smsMessage: messages.smsMessage,
        callRequestMessage: messages.callRequestMessage,
        pushNotificationMessage: messages.pushNotificationMessage,
        whatsAppMessage: messages.whatsAppMessage,
        incidentId: sla.incidentId,
        /*
         * Never coalesced into a rollup: the event is one of
         * NEVER_ROLLED_UP_EVENT_TYPES - an SLA breach is a deadline that has
         * already passed.
         */
        eventType: messages.eventType,
      });
    }

    logger.info(
      `Sent SLA ${breachType} breach notification for incident ${sla.incidentId}`,
      {
        projectId: sla.projectId?.toString(),
        incidentId: sla.incidentId?.toString(),
      },
    );
  } catch (error) {
    logger.error(
      `Error sending SLA breach notification for incident ${sla.incidentId}: ${error}`,
      {
        projectId: sla.projectId?.toString(),
        incidentId: sla.incidentId?.toString(),
      },
    );
  }
}
