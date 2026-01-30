import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/IncidentSlaRule";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import { IsBillingEnabled } from "../EnvironmentConfig";
import MonitorService from "./MonitorService";
import IncidentService from "./IncidentService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
    if (IsBillingEnabled) {
      this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365); // 3 years
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Auto-assign order on creation
    if (!createBy.data.order) {
      const highestOrderRule: Model | null = await this.findOneBy({
        query: {
          projectId: createBy.data.projectId!,
        },
        select: {
          order: true,
        },
        sort: {
          order: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

      createBy.data.order = (highestOrderRule?.order || 0) + 1;
    }

    return {
      createBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  public async findMatchingRule(data: {
    incidentId: ObjectID;
    projectId: ObjectID;
    incident?: Incident;
  }): Promise<Model | null> {
    logger.debug(
      `Finding matching SLA rule for incident ${data.incidentId} in project ${data.projectId}`,
    );

    // Get the incident if not provided
    let incident: Incident | null = data.incident || null;

    if (!incident) {
      incident = await IncidentService.findOneById({
        id: data.incidentId,
        select: {
          projectId: true,
          title: true,
          description: true,
          incidentSeverityId: true,
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
    }

    if (!incident) {
      logger.warn(`Incident ${data.incidentId} not found`);
      return null;
    }

    // Get all enabled rules sorted by order
    const rules: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        isEnabled: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      select: {
        _id: true,
        name: true,
        order: true,
        responseTimeInMinutes: true,
        resolutionTimeInMinutes: true,
        atRiskThresholdInPercentage: true,
        internalNoteReminderIntervalInMinutes: true,
        publicNoteReminderIntervalInMinutes: true,
        internalNoteReminderTemplate: true,
        publicNoteReminderTemplate: true,
        monitors: {
          _id: true,
        },
        incidentSeverities: {
          _id: true,
        },
        incidentLabels: {
          _id: true,
        },
        monitorLabels: {
          _id: true,
        },
        incidentTitlePattern: true,
        incidentDescriptionPattern: true,
      },
      limit: 100,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (rules.length === 0) {
      logger.debug(`No enabled SLA rules found for project ${data.projectId}`);
      return null;
    }

    // Find first matching rule
    for (const rule of rules) {
      const matches: boolean = await this.doesIncidentMatchRule(incident, rule);

      if (matches) {
        logger.debug(
          `Incident ${data.incidentId} matches SLA rule ${rule.name || rule.id}`,
        );
        return rule;
      }
    }

    logger.debug(`Incident ${data.incidentId} did not match any SLA rules`);
    return null;
  }

  @CaptureSpan()
  public async doesIncidentMatchRule(
    incident: Incident,
    rule: Model,
  ): Promise<boolean> {
    logger.debug(
      `Checking if incident ${incident.id} matches SLA rule ${rule.name || rule.id}`,
    );

    // Check monitor IDs - if monitors are specified, incident must have at least one of them
    if (rule.monitors && rule.monitors.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });

      const incidentMonitorIds: Array<string> = incident.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || m._id?.toString() || "";
        },
      );

      const hasMatchingMonitor: boolean = ruleMonitorIds.some(
        (monitorId: string) => {
          return incidentMonitorIds.includes(monitorId);
        },
      );

      if (!hasMatchingMonitor) {
        return false;
      }
    }

    // Check incident severity IDs - if severities are specified, incident must have one of them
    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!incident.incidentSeverityId) {
        return false;
      }

      const severityIds: Array<string> = rule.incidentSeverities.map(
        (s: IncidentSeverity) => {
          return s.id?.toString() || "";
        },
      );

      const incidentSeverityIdStr: string =
        incident.incidentSeverityId.toString();

      if (!severityIds.includes(incidentSeverityIdStr)) {
        return false;
      }
    }

    // Check incident label IDs - if incident labels are specified, incident must have at least one of them
    if (rule.incidentLabels && rule.incidentLabels.length > 0) {
      if (!incident.labels || incident.labels.length === 0) {
        return false;
      }

      const ruleLabelIds: Array<string> = rule.incidentLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );

      const incidentLabelIds: Array<string> = incident.labels.map(
        (l: Label) => {
          return l.id?.toString() || l._id?.toString() || "";
        },
      );

      const hasMatchingLabel: boolean = ruleLabelIds.some((labelId: string) => {
        return incidentLabelIds.includes(labelId);
      });

      if (!hasMatchingLabel) {
        return false;
      }
    }

    // Check monitor labels - incident's monitors must have at least one matching label
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      const ruleMonitorLabelIds: Array<string> = rule.monitorLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );

      // Get labels from incident's monitors
      let hasMatchingMonitorLabel: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        // Load monitor labels if not already loaded
        let monitorLabels: Array<Label> | undefined = incidentMonitor.labels;

        if (!monitorLabels) {
          const monitorId: ObjectID | undefined = incidentMonitor.id
            ? incidentMonitor.id
            : incidentMonitor._id
              ? new ObjectID(incidentMonitor._id.toString())
              : undefined;

          if (monitorId) {
            const monitor: Monitor | null = await MonitorService.findOneById({
              id: monitorId,
              select: {
                labels: {
                  _id: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

            monitorLabels = monitor?.labels;
          }
        }

        if (monitorLabels && monitorLabels.length > 0) {
          const monitorLabelIds: Array<string> = monitorLabels.map(
            (l: Label) => {
              return l.id?.toString() || l._id?.toString() || "";
            },
          );

          hasMatchingMonitorLabel = ruleMonitorLabelIds.some(
            (labelId: string) => {
              return monitorLabelIds.includes(labelId);
            },
          );

          if (hasMatchingMonitorLabel) {
            break;
          }
        }
      }

      if (!hasMatchingMonitorLabel) {
        return false;
      }
    }

    // Check incident title pattern (regex)
    if (rule.incidentTitlePattern) {
      if (!incident.title) {
        return false;
      }

      try {
        const regex: RegExp = new RegExp(rule.incidentTitlePattern, "i");
        if (!regex.test(incident.title)) {
          return false;
        }
      } catch {
        logger.warn(
          `Invalid regex pattern in SLA rule ${rule.id}: ${rule.incidentTitlePattern}`,
        );
        return false;
      }
    }

    // Check incident description pattern (regex)
    if (rule.incidentDescriptionPattern) {
      if (!incident.description) {
        return false;
      }

      try {
        const regex: RegExp = new RegExp(rule.incidentDescriptionPattern, "i");
        if (!regex.test(incident.description)) {
          return false;
        }
      } catch {
        logger.warn(
          `Invalid regex pattern in SLA rule ${rule.id}: ${rule.incidentDescriptionPattern}`,
        );
        return false;
      }
    }

    // If no criteria specified (all fields empty), rule matches all incidents
    logger.debug(
      `SLA rule ${rule.name || rule.id} matched incident ${incident.id} (all criteria passed)`,
    );
    return true;
  }
}

export default new Service();
