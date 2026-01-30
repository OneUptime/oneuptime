import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentSla";
import IncidentSlaRule from "../../Models/DatabaseModels/IncidentSlaRule";
import Incident from "../../Models/DatabaseModels/Incident";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import IncidentSlaStatus from "../../Types/Incident/IncidentSlaStatus";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import { IsBillingEnabled } from "../EnvironmentConfig";
import IncidentSlaRuleService from "./IncidentSlaRuleService";
import IncidentService from "./IncidentService";
import QueryHelper from "../Types/Database/QueryHelper";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  public async createSlaForIncident(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    declaredAt: Date;
    incident?: Incident;
  }): Promise<Model | null> {
    logger.debug(
      `Creating SLA record for incident ${data.incidentId} in project ${data.projectId}`,
    );

    // Find matching rule
    const matchingRuleArgs: {
      incidentId: ObjectID;
      projectId: ObjectID;
      incident?: Incident;
    } = {
      incidentId: data.incidentId,
      projectId: data.projectId,
    };

    if (data.incident) {
      matchingRuleArgs.incident = data.incident;
    }

    const matchingRule: IncidentSlaRule | null =
      await IncidentSlaRuleService.findMatchingRule(matchingRuleArgs);

    if (!matchingRule || !matchingRule.id) {
      logger.debug(
        `No matching SLA rule found for incident ${data.incidentId}`,
      );
      return null;
    }

    // Calculate deadlines
    const slaStartedAt: Date = data.declaredAt;
    let responseDeadline: Date | undefined = undefined;
    let resolutionDeadline: Date | undefined = undefined;

    if (matchingRule.responseTimeInMinutes) {
      responseDeadline = OneUptimeDate.addRemoveMinutes(
        slaStartedAt,
        matchingRule.responseTimeInMinutes,
      );
    }

    if (matchingRule.resolutionTimeInMinutes) {
      resolutionDeadline = OneUptimeDate.addRemoveMinutes(
        slaStartedAt,
        matchingRule.resolutionTimeInMinutes,
      );
    }

    // Create SLA record
    const sla: Model = new Model();
    sla.projectId = data.projectId;
    sla.incidentId = data.incidentId;
    sla.incidentSlaRuleId = matchingRule.id;
    sla.slaStartedAt = slaStartedAt;
    sla.status = IncidentSlaStatus.OnTrack;

    if (responseDeadline) {
      sla.responseDeadline = responseDeadline;
    }

    if (resolutionDeadline) {
      sla.resolutionDeadline = resolutionDeadline;
    }

    try {
      const createdSla: Model = await this.create({
        data: sla,
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `Created SLA record ${createdSla.id} for incident ${data.incidentId} with rule ${matchingRule.name || matchingRule.id}`,
      );

      return createdSla;
    } catch (error) {
      logger.error(
        `Error creating SLA record for incident ${data.incidentId}: ${error}`,
      );
      return null;
    }
  }

  @CaptureSpan()
  public async markResponded(data: {
    incidentId: ObjectID;
    respondedAt: Date;
  }): Promise<void> {
    logger.debug(
      `Marking incident ${data.incidentId} as responded at ${data.respondedAt}`,
    );

    // Find all active SLA records for this incident
    const slaRecords: Array<Model> = await this.findBy({
      query: {
        incidentId: data.incidentId,
        resolvedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        respondedAt: true,
        status: true,
        responseDeadline: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const sla of slaRecords) {
      // Only update if not already responded
      if (!sla.respondedAt && sla.id) {
        await this.updateOneById({
          id: sla.id,
          data: {
            respondedAt: data.respondedAt,
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(`Marked SLA ${sla.id} as responded at ${data.respondedAt}`);
      }
    }
  }

  @CaptureSpan()
  public async markResolved(data: {
    incidentId: ObjectID;
    resolvedAt: Date;
  }): Promise<void> {
    logger.debug(
      `Marking incident ${data.incidentId} as resolved at ${data.resolvedAt}`,
    );

    // Find all active SLA records for this incident
    const slaRecords: Array<Model> = await this.findBy({
      query: {
        incidentId: data.incidentId,
        resolvedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        status: true,
        resolutionDeadline: true,
        responseDeadline: true,
        respondedAt: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const sla of slaRecords) {
      if (!sla.id) {
        continue;
      }

      // Determine final SLA status
      let finalStatus: IncidentSlaStatus = IncidentSlaStatus.Met;

      // Check if response deadline was breached
      if (sla.responseDeadline && !sla.respondedAt) {
        // Never responded, check if response deadline passed
        if (OneUptimeDate.isAfter(data.resolvedAt, sla.responseDeadline)) {
          finalStatus = IncidentSlaStatus.ResponseBreached;
        }
      } else if (
        sla.responseDeadline &&
        sla.respondedAt &&
        OneUptimeDate.isAfter(sla.respondedAt, sla.responseDeadline)
      ) {
        // Responded after deadline
        finalStatus = IncidentSlaStatus.ResponseBreached;
      }

      // Check if resolution deadline was breached (takes precedence)
      if (
        sla.resolutionDeadline &&
        OneUptimeDate.isAfter(data.resolvedAt, sla.resolutionDeadline)
      ) {
        finalStatus = IncidentSlaStatus.ResolutionBreached;
      }

      await this.updateOneById({
        id: sla.id,
        data: {
          resolvedAt: data.resolvedAt,
          status: finalStatus,
        },
        props: {
          isRoot: true,
        },
      });

      logger.info(
        `Marked SLA ${sla.id} as resolved with status ${finalStatus}`,
      );
    }
  }

  @CaptureSpan()
  public async recalculateDeadlines(data: {
    incidentId: ObjectID;
  }): Promise<void> {
    logger.debug(`Recalculating deadlines for incident ${data.incidentId}`);

    // Get the incident to find the new severity and project
    const incident: Incident | null = await IncidentService.findOneById({
      id: data.incidentId,
      select: {
        projectId: true,
        declaredAt: true,
        incidentSeverityId: true,
        title: true,
        description: true,
        monitors: {
          _id: true,
          labels: {
            _id: true,
          },
        },
        labels: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident || !incident.projectId) {
      logger.warn(`Incident ${data.incidentId} not found`);
      return;
    }

    // Find all active SLA records for this incident
    const slaRecords: Array<Model> = await this.findBy({
      query: {
        incidentId: data.incidentId,
        resolvedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        slaStartedAt: true,
        incidentSlaRuleId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Find new matching rule (may be different due to severity change)
    const newMatchingRule: IncidentSlaRule | null =
      await IncidentSlaRuleService.findMatchingRule({
        incidentId: data.incidentId,
        projectId: incident.projectId,
        incident: incident,
      });

    for (const sla of slaRecords) {
      if (!sla.id || !sla.slaStartedAt) {
        continue;
      }

      // Check if the matching rule has changed
      if (
        newMatchingRule &&
        newMatchingRule.id?.toString() !== sla.incidentSlaRuleId?.toString()
      ) {
        // Rule has changed, recalculate with new rule
        let responseDeadline: Date | undefined = undefined;
        let resolutionDeadline: Date | undefined = undefined;

        if (newMatchingRule.responseTimeInMinutes) {
          responseDeadline = OneUptimeDate.addRemoveMinutes(
            sla.slaStartedAt,
            newMatchingRule.responseTimeInMinutes,
          );
        }

        if (newMatchingRule.resolutionTimeInMinutes) {
          resolutionDeadline = OneUptimeDate.addRemoveMinutes(
            sla.slaStartedAt,
            newMatchingRule.resolutionTimeInMinutes,
          );
        }

        await this.updateOneById({
          id: sla.id,
          data: {
            incidentSlaRuleId: newMatchingRule.id,
            responseDeadline: responseDeadline || null,
            resolutionDeadline: resolutionDeadline || null,
          },
          props: {
            isRoot: true,
          },
        });

        logger.info(
          `Recalculated SLA ${sla.id} with new rule ${newMatchingRule.name || newMatchingRule.id}`,
        );
      } else if (!newMatchingRule) {
        // No matching rule anymore, but keep the existing SLA record
        logger.debug(
          `No matching SLA rule found after severity change for incident ${data.incidentId}, keeping existing SLA`,
        );
      }
    }
  }

  @CaptureSpan()
  public async getIncidentsNeedingInternalNoteReminder(): Promise<
    Array<Model>
  > {
    /*
     * Find SLAs where:
     * - Not resolved
     * - Has internal note reminder interval configured
     * - Last reminder was sent more than interval ago OR never sent
     */
    const now: Date = OneUptimeDate.getCurrentDate();

    const slaRecords: Array<Model> = await this.findBy({
      query: {
        resolvedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        incidentId: true,
        projectId: true,
        incidentSlaRuleId: true,
        incidentSlaRule: {
          internalNoteReminderIntervalInMinutes: true,
          internalNoteReminderTemplate: true,
        },
        slaStartedAt: true,
        responseDeadline: true,
        resolutionDeadline: true,
        status: true,
        lastInternalNoteReminderSentAt: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Filter to only those needing reminders
    const needingReminder: Array<Model> = slaRecords.filter((sla: Model) => {
      const interval: number | undefined =
        sla.incidentSlaRule?.internalNoteReminderIntervalInMinutes;

      if (!interval) {
        return false;
      }

      if (!sla.lastInternalNoteReminderSentAt) {
        // Never sent, check if enough time has passed since SLA started
        const timeSinceStart: number = OneUptimeDate.getDifferenceInMinutes(
          now,
          sla.slaStartedAt!,
        );
        return timeSinceStart >= interval;
      }

      const timeSinceLastReminder: number =
        OneUptimeDate.getDifferenceInMinutes(
          now,
          sla.lastInternalNoteReminderSentAt,
        );

      return timeSinceLastReminder >= interval;
    });

    return needingReminder;
  }

  @CaptureSpan()
  public async getIncidentsNeedingPublicNoteReminder(): Promise<Array<Model>> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const slaRecords: Array<Model> = await this.findBy({
      query: {
        resolvedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        incidentId: true,
        projectId: true,
        incidentSlaRuleId: true,
        incidentSlaRule: {
          publicNoteReminderIntervalInMinutes: true,
          publicNoteReminderTemplate: true,
        },
        slaStartedAt: true,
        responseDeadline: true,
        resolutionDeadline: true,
        status: true,
        lastPublicNoteReminderSentAt: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // Filter to only those needing reminders
    const needingReminder: Array<Model> = slaRecords.filter((sla: Model) => {
      const interval: number | undefined =
        sla.incidentSlaRule?.publicNoteReminderIntervalInMinutes;

      if (!interval) {
        return false;
      }

      if (!sla.lastPublicNoteReminderSentAt) {
        // Never sent, check if enough time has passed since SLA started
        const timeSinceStart: number = OneUptimeDate.getDifferenceInMinutes(
          now,
          sla.slaStartedAt!,
        );
        return timeSinceStart >= interval;
      }

      const timeSinceLastReminder: number =
        OneUptimeDate.getDifferenceInMinutes(
          now,
          sla.lastPublicNoteReminderSentAt,
        );

      return timeSinceLastReminder >= interval;
    });

    return needingReminder;
  }

  @CaptureSpan()
  public async getSlasNeedingBreachCheck(): Promise<Array<Model>> {
    // Find SLAs where status is OnTrack or AtRisk and not resolved
    return await this.findBy({
      query: {
        resolvedAt: QueryHelper.isNull(),
        status: QueryHelper.any([
          IncidentSlaStatus.OnTrack,
          IncidentSlaStatus.AtRisk,
        ]),
      },
      select: {
        _id: true,
        incidentId: true,
        projectId: true,
        incidentSlaRuleId: true,
        incidentSlaRule: {
          atRiskThresholdInPercentage: true,
          name: true,
        },
        slaStartedAt: true,
        responseDeadline: true,
        resolutionDeadline: true,
        respondedAt: true,
        status: true,
        breachNotificationSentAt: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }

  @CaptureSpan()
  public async getActiveSlasForIncident(data: {
    incidentId: ObjectID;
  }): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        incidentId: data.incidentId,
        resolvedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        incidentId: true,
        projectId: true,
        incidentSlaRuleId: true,
        incidentSlaRule: {
          name: true,
          responseTimeInMinutes: true,
          resolutionTimeInMinutes: true,
          atRiskThresholdInPercentage: true,
        },
        slaStartedAt: true,
        responseDeadline: true,
        resolutionDeadline: true,
        respondedAt: true,
        resolvedAt: true,
        status: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new Service();
