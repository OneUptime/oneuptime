import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentSlaService from "Common/Server/Services/IncidentSlaService";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import logger from "Common/Server/Utils/Logger";
import IncidentInternalNoteService from "Common/Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import OneUptimeDate from "Common/Types/Date";

/**
 * This job sends automatic internal and public note reminders for incidents
 * based on the SLA rule configuration.
 * Runs every minute.
 */

// Default templates
const DEFAULT_INTERNAL_NOTE_TEMPLATE: string = `**SLA Reminder**: This incident has been open for {{elapsedTime}}.

- Response Deadline: {{responseDeadline}}
- Resolution Deadline: {{resolutionDeadline}}
- Current Status: {{slaStatus}}

Please provide an update on the incident progress.`;

const DEFAULT_PUBLIC_NOTE_TEMPLATE: string = `**Status Update**: Our team continues to work on resolving this incident.

- Current Status: {{slaStatus}}
- Time Open: {{elapsedTime}}

We appreciate your patience and will provide another update soon.`;

RunCron(
  "IncidentSla:SendNoteReminders",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    // Process internal note reminders
    await processInternalNoteReminders();

    // Process public note reminders
    await processPublicNoteReminders();
  },
);

async function processInternalNoteReminders(): Promise<void> {
  try {
    const slasNeedingReminder: Array<IncidentSla> =
      await IncidentSlaService.getIncidentsNeedingInternalNoteReminder();

    for (const sla of slasNeedingReminder) {
      if (!sla.id || !sla.incidentId || !sla.projectId) {
        continue;
      }

      try {
        // Get incident details for template variables
        const incident: Incident | null = await IncidentService.findOneById({
          id: sla.incidentId,
          select: {
            _id: true,
            title: true,
            incidentNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!incident) {
          continue;
        }

        // Get the template from the rule or use default
        const template: string =
          sla.incidentSlaRule?.internalNoteReminderTemplate ||
          DEFAULT_INTERNAL_NOTE_TEMPLATE;

        // Process template with variables
        const noteContent: string = processTemplate(template, sla, incident);

        // Create the internal note
        const internalNote: IncidentInternalNote = new IncidentInternalNote();
        internalNote.incidentId = sla.incidentId;
        internalNote.projectId = sla.projectId;
        internalNote.note = noteContent;
        internalNote.isOwnerNotified = true; // Mark as already notified since this is automated

        await IncidentInternalNoteService.create({
          data: internalNote,
          props: {
            isRoot: true,
          },
        });

        // Update the last reminder sent timestamp
        await IncidentSlaService.updateOneById({
          id: sla.id,
          data: {
            lastInternalNoteReminderSentAt: OneUptimeDate.getCurrentDate(),
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `Sent internal note reminder for incident ${sla.incidentId} (SLA ${sla.id})`,
        );
      } catch (error) {
        logger.error(
          `Error sending internal note reminder for SLA ${sla.id}: ${error}`,
        );
      }
    }
  } catch (error) {
    logger.error(`Error processing internal note reminders: ${error}`);
  }
}

async function processPublicNoteReminders(): Promise<void> {
  try {
    const slasNeedingReminder: Array<IncidentSla> =
      await IncidentSlaService.getIncidentsNeedingPublicNoteReminder();

    for (const sla of slasNeedingReminder) {
      if (!sla.id || !sla.incidentId || !sla.projectId) {
        continue;
      }

      try {
        // Get incident details for template variables
        const incident: Incident | null = await IncidentService.findOneById({
          id: sla.incidentId,
          select: {
            _id: true,
            title: true,
            incidentNumber: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!incident) {
          continue;
        }

        // Get the template from the rule or use default
        const template: string =
          sla.incidentSlaRule?.publicNoteReminderTemplate ||
          DEFAULT_PUBLIC_NOTE_TEMPLATE;

        // Process template with variables
        const noteContent: string = processTemplate(template, sla, incident);

        // Create the public note
        const publicNote: IncidentPublicNote = new IncidentPublicNote();
        publicNote.incidentId = sla.incidentId;
        publicNote.projectId = sla.projectId;
        publicNote.note = noteContent;
        publicNote.isOwnerNotified = true; // Mark as already notified since this is automated
        publicNote.postedAt = OneUptimeDate.getCurrentDate();

        await IncidentPublicNoteService.create({
          data: publicNote,
          props: {
            isRoot: true,
          },
        });

        // Update the last reminder sent timestamp
        await IncidentSlaService.updateOneById({
          id: sla.id,
          data: {
            lastPublicNoteReminderSentAt: OneUptimeDate.getCurrentDate(),
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `Sent public note reminder for incident ${sla.incidentId} (SLA ${sla.id})`,
        );
      } catch (error) {
        logger.error(
          `Error sending public note reminder for SLA ${sla.id}: ${error}`,
        );
      }
    }
  } catch (error) {
    logger.error(`Error processing public note reminders: ${error}`);
  }
}

function processTemplate(
  template: string,
  sla: IncidentSla,
  incident: Incident,
): string {
  const now: Date = OneUptimeDate.getCurrentDate();

  // Calculate elapsed time
  const elapsedMinutes: number = sla.slaStartedAt
    ? OneUptimeDate.getDifferenceInMinutes(now, sla.slaStartedAt)
    : 0;

  const elapsedTime: string = formatDuration(elapsedMinutes);

  // Calculate time to deadlines
  const timeToResponseDeadline: string = sla.responseDeadline
    ? formatDuration(
        OneUptimeDate.getDifferenceInMinutes(sla.responseDeadline, now),
      )
    : "N/A";

  const timeToResolutionDeadline: string = sla.resolutionDeadline
    ? formatDuration(
        OneUptimeDate.getDifferenceInMinutes(sla.resolutionDeadline, now),
      )
    : "N/A";

  // Format deadlines
  const responseDeadline: string = sla.responseDeadline
    ? OneUptimeDate.getDateAsLocalFormattedString(sla.responseDeadline)
    : "N/A";

  const resolutionDeadline: string = sla.resolutionDeadline
    ? OneUptimeDate.getDateAsLocalFormattedString(sla.resolutionDeadline)
    : "N/A";

  // Replace template variables
  let result: string = template;

  result = result.replace(/\{\{incidentTitle\}\}/g, incident.title || "");
  result = result.replace(
    /\{\{incidentNumber\}\}/g,
    incident.incidentNumber?.toString() || "",
  );
  result = result.replace(/\{\{elapsedTime\}\}/g, elapsedTime);
  result = result.replace(/\{\{responseDeadline\}\}/g, responseDeadline);
  result = result.replace(/\{\{resolutionDeadline\}\}/g, resolutionDeadline);
  result = result.replace(/\{\{slaStatus\}\}/g, sla.status || "");
  result = result.replace(
    /\{\{timeToResponseDeadline\}\}/g,
    timeToResponseDeadline,
  );
  result = result.replace(
    /\{\{timeToResolutionDeadline\}\}/g,
    timeToResolutionDeadline,
  );

  return result;
}

function formatDuration(minutes: number): string {
  if (minutes < 0) {
    return "Overdue by " + formatDuration(Math.abs(minutes));
  }

  if (minutes < 60) {
    return `${Math.round(minutes)} minutes`;
  }

  const hours: number = Math.floor(minutes / 60);
  const remainingMinutes: number = Math.round(minutes % 60);

  if (hours < 24) {
    if (remainingMinutes > 0) {
      return `${hours} hours ${remainingMinutes} minutes`;
    }
    return `${hours} hours`;
  }

  const days: number = Math.floor(hours / 24);
  const remainingHours: number = hours % 24;

  if (remainingHours > 0) {
    return `${days} days ${remainingHours} hours`;
  }
  return `${days} days`;
}
