import ObjectID from "../../Types/ObjectID";
import AlertGroupingRule from "../../Models/DatabaseModels/AlertGroupingRule";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "../../Models/DatabaseModels/AlertEpisodeMember";
import AlertState from "../../Models/DatabaseModels/AlertState";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import ServiceMonitor from "../../Models/DatabaseModels/ServiceMonitor";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import AlertGroupingRuleService from "./AlertGroupingRuleService";
import AlertEpisodeService from "./AlertEpisodeService";
import AlertStateService from "./AlertStateService";
import AlertEpisodeMemberService from "./AlertEpisodeMemberService";
import MonitorService from "./MonitorService";
import ServiceMonitorService from "./ServiceMonitorService";

export interface GroupingResult {
  grouped: boolean;
  episodeId?: ObjectID;
  isNewEpisode?: boolean;
  wasReopened?: boolean;
}

class AlertGroupingEngineServiceClass {
  @CaptureSpan()
  public async processAlert(alert: Alert): Promise<GroupingResult> {
    try {
      if (!alert.id || !alert.projectId) {
        logger.warn("Alert missing id or projectId, skipping grouping");
        return { grouped: false };
      }

      // If alert already has an episode, don't reprocess
      if (alert.alertEpisodeId) {
        return { grouped: true, episodeId: alert.alertEpisodeId };
      }

      // Get enabled rules sorted by priority
      const rules: Array<AlertGroupingRule> =
        await AlertGroupingRuleService.findBy({
          query: {
            projectId: alert.projectId,
            isEnabled: true,
          },
          sort: {
            priority: SortOrder.Ascending,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            name: true,
            // Match criteria fields
            monitors: {
              _id: true,
            },
            alertSeverities: {
              _id: true,
            },
            alertLabels: {
              _id: true,
            },
            monitorLabels: {
              _id: true,
            },
            alertTitlePattern: true,
            alertDescriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
            // Group by fields
            groupByMonitor: true,
            groupBySeverity: true,
            groupByAlertTitle: true,
            // Time settings
            enableTimeWindow: true,
            timeWindowMinutes: true,
            episodeTitleTemplate: true,
            episodeDescriptionTemplate: true,
            enableResolveDelay: true,
            resolveDelayMinutes: true,
            enableReopenWindow: true,
            reopenWindowMinutes: true,
            enableInactivityTimeout: true,
            inactivityTimeoutMinutes: true,
            defaultAssignToUserId: true,
            defaultAssignToTeamId: true,
            onCallDutyPolicies: {
              _id: true,
            },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        logger.debug("No enabled grouping rules found for project");
        return { grouped: false };
      }

      // Find first matching rule
      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);

        if (matches) {
          logger.debug(
            `Alert ${alert.id} matches rule ${rule.name || rule.id}`,
          );

          // Try to find existing episode or create new one
          const result: GroupingResult = await this.groupAlertWithRule(
            alert,
            rule,
          );
          return result;
        }
      }

      logger.debug(`Alert ${alert.id} did not match any grouping rules`);
      return { grouped: false };
    } catch (error) {
      logger.error(`Error processing alert for grouping: ${error}`);
      return { grouped: false };
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertGroupingRule,
  ): Promise<boolean> {
    // Check monitor IDs - if monitors are specified, alert must be from one of them
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const monitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const alertMonitorIdStr: string = alert.monitorId.toString();
      if (!monitorIds.includes(alertMonitorIdStr)) {
        return false;
      }
    }

    // Check alert severity IDs - if severities are specified, alert must have one of them
    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.alertSeverities.map(
        (s: AlertSeverity) => {
          return s.id?.toString() || "";
        },
      );
      const alertSeverityIdStr: string = alert.alertSeverityId.toString();
      if (!severityIds.includes(alertSeverityIdStr)) {
        return false;
      }
    }

    // Check alert label IDs - if alert labels are specified, alert must have at least one of them
    if (rule.alertLabels && rule.alertLabels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.alertLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const alertLabelIds: Array<string> = alert.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const hasMatchingLabel: boolean = ruleLabelIds.some((labelId: string) => {
        return alertLabelIds.includes(labelId);
      });
      if (!hasMatchingLabel) {
        return false;
      }
    }

    // Check monitor-related criteria (labels, name pattern, description pattern)
    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!alert.monitorId) {
        return false;
      }

      // Load monitor with all needed fields
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: alert.monitorId,
        select: {
          name: true,
          description: true,
          labels: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!monitor) {
        return false;
      }

      // Check monitor labels
      if (rule.monitorLabels && rule.monitorLabels.length > 0) {
        if (!monitor.labels || monitor.labels.length === 0) {
          return false;
        }

        const ruleMonitorLabelIds: Array<string> = rule.monitorLabels.map(
          (l: Label) => {
            return l.id?.toString() || "";
          },
        );
        const monitorLabelIds: Array<string> = monitor.labels.map(
          (l: Label) => {
            return l.id?.toString() || "";
          },
        );
        const hasMatchingMonitorLabel: boolean = ruleMonitorLabelIds.some(
          (labelId: string) => {
            return monitorLabelIds.includes(labelId);
          },
        );
        if (!hasMatchingMonitorLabel) {
          return false;
        }
      }

      // Check monitor name pattern (regex)
      if (rule.monitorNamePattern) {
        if (!monitor.name) {
          return false;
        }
        try {
          const regex: RegExp = new RegExp(rule.monitorNamePattern, "i");
          if (!regex.test(monitor.name)) {
            return false;
          }
        } catch {
          logger.warn(
            `Invalid regex pattern in rule ${rule.id}: ${rule.monitorNamePattern}`,
          );
          return false;
        }
      }

      // Check monitor description pattern (regex)
      if (rule.monitorDescriptionPattern) {
        if (!monitor.description) {
          return false;
        }
        try {
          const regex: RegExp = new RegExp(rule.monitorDescriptionPattern, "i");
          if (!regex.test(monitor.description)) {
            return false;
          }
        } catch {
          logger.warn(
            `Invalid regex pattern in rule ${rule.id}: ${rule.monitorDescriptionPattern}`,
          );
          return false;
        }
      }
    }

    // Check alert title pattern (regex)
    if (rule.alertTitlePattern) {
      if (!alert.title) {
        return false;
      }
      try {
        const regex: RegExp = new RegExp(rule.alertTitlePattern, "i");
        if (!regex.test(alert.title)) {
          return false;
        }
      } catch {
        logger.warn(
          `Invalid regex pattern in rule ${rule.id}: ${rule.alertTitlePattern}`,
        );
        return false;
      }
    }

    // Check alert description pattern (regex)
    if (rule.alertDescriptionPattern) {
      if (!alert.description) {
        return false;
      }
      try {
        const regex: RegExp = new RegExp(rule.alertDescriptionPattern, "i");
        if (!regex.test(alert.description)) {
          return false;
        }
      } catch {
        logger.warn(
          `Invalid regex pattern in rule ${rule.id}: ${rule.alertDescriptionPattern}`,
        );
        return false;
      }
    }

    // If no criteria specified (all fields empty), rule matches all alerts
    return true;
  }

  @CaptureSpan()
  private async groupAlertWithRule(
    alert: Alert,
    rule: AlertGroupingRule,
  ): Promise<GroupingResult> {
    // Build the grouping key based on groupBy fields
    const groupingKey: string = await this.buildGroupingKey(alert, rule);

    // Calculate time window cutoff (only if time window is enabled)
    let timeWindowCutoff: Date | null = null;
    if (rule.enableTimeWindow) {
      const timeWindowMinutes: number = rule.timeWindowMinutes || 60;
      timeWindowCutoff = OneUptimeDate.getSomeMinutesAgo(timeWindowMinutes);
    }

    // Find existing active episode that matches
    const existingEpisode: AlertEpisode | null =
      await this.findMatchingActiveEpisode(
        alert.projectId!,
        rule.id!,
        groupingKey,
        timeWindowCutoff,
      );

    if (existingEpisode && existingEpisode.id) {
      // Add alert to existing episode
      await this.addAlertToEpisode(
        alert,
        existingEpisode.id,
        AlertEpisodeMemberAddedBy.Rule,
        rule.id!,
      );

      // Update episode severity if alert has higher severity
      if (alert.alertSeverityId) {
        await AlertEpisodeService.updateEpisodeSeverity({
          episodeId: existingEpisode.id,
          severityId: alert.alertSeverityId,
          onlyIfHigher: true,
        });
      }

      return {
        grouped: true,
        episodeId: existingEpisode.id,
        isNewEpisode: false,
      };
    }

    // Check if we can reopen a recently resolved episode (only if enabled)
    if (rule.enableReopenWindow) {
      const reopenWindowMinutes: number = rule.reopenWindowMinutes || 0;
      if (reopenWindowMinutes > 0) {
        const reopenCutoff: Date =
          OneUptimeDate.getSomeMinutesAgo(reopenWindowMinutes);
        const recentlyResolvedEpisode: AlertEpisode | null =
          await this.findRecentlyResolvedEpisode(
            alert.projectId!,
            rule.id!,
            groupingKey,
            reopenCutoff,
          );

        if (recentlyResolvedEpisode && recentlyResolvedEpisode.id) {
          // Reopen the episode
          await AlertEpisodeService.reopenEpisode(recentlyResolvedEpisode.id);

          // Add alert to reopened episode
          await this.addAlertToEpisode(
            alert,
            recentlyResolvedEpisode.id,
            AlertEpisodeMemberAddedBy.Rule,
            rule.id!,
          );

          // Update episode severity if alert has higher severity
          if (alert.alertSeverityId) {
            await AlertEpisodeService.updateEpisodeSeverity({
              episodeId: recentlyResolvedEpisode.id,
              severityId: alert.alertSeverityId,
              onlyIfHigher: true,
            });
          }

          return {
            grouped: true,
            episodeId: recentlyResolvedEpisode.id,
            isNewEpisode: false,
            wasReopened: true,
          };
        }
      }
    }

    // Create new episode
    const newEpisode: AlertEpisode | null = await this.createNewEpisode(
      alert,
      rule,
      groupingKey,
    );

    if (newEpisode && newEpisode.id) {
      // Add alert to new episode
      await this.addAlertToEpisode(
        alert,
        newEpisode.id,
        AlertEpisodeMemberAddedBy.Rule,
        rule.id!,
      );

      return { grouped: true, episodeId: newEpisode.id, isNewEpisode: true };
    }

    return { grouped: false };
  }

  @CaptureSpan()
  private async buildGroupingKey(
    alert: Alert,
    rule: AlertGroupingRule,
  ): Promise<string> {
    const parts: Array<string> = [];

    // Group by service - only if explicitly enabled
    // Must be checked before monitor since service contains multiple monitors
    if (rule.groupByService && alert.monitorId) {
      const serviceMonitor: ServiceMonitor | null =
        await ServiceMonitorService.findOneBy({
          query: {
            monitorId: alert.monitorId,
          },
          select: {
            serviceId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (serviceMonitor?.serviceId) {
        parts.push(`service:${serviceMonitor.serviceId.toString()}`);
      }
    }

    // Group by monitor - only if explicitly enabled
    if (rule.groupByMonitor && alert.monitorId) {
      parts.push(`monitor:${alert.monitorId.toString()}`);
    }

    // Group by severity - only if explicitly enabled
    if (rule.groupBySeverity && alert.alertSeverityId) {
      parts.push(`severity:${alert.alertSeverityId.toString()}`);
    }

    // Group by alert title - only if explicitly enabled
    if (rule.groupByAlertTitle && alert.title) {
      // Normalize title for grouping (remove numbers, etc.)
      const normalizedTitle: string = alert.title
        .toLowerCase()
        .replace(/\d+/g, "X");
      parts.push(`title:${normalizedTitle}`);
    }

    // If no group by options are enabled, all matching alerts go into a single episode
    return parts.join("|") || "default";
  }

  @CaptureSpan()
  private async findMatchingActiveEpisode(
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    timeWindowCutoff: Date | null,
  ): Promise<AlertEpisode | null> {
    // Get resolved state to exclude resolved episodes
    const resolvedState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: projectId,
        isResolvedState: true,
      },
      select: {
        order: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * Find active episode with matching rule and grouping key
     * If time window is enabled, also filter by lastAlertAddedAt
     * If time window is disabled (timeWindowCutoff is null), find any matching active episode
     */
    type EpisodeQueryType = {
      projectId: ObjectID;
      alertGroupingRuleId: ObjectID;
      groupingKey: string;
      lastAlertAddedAt?: ReturnType<typeof QueryHelper.greaterThanEqualTo>;
    };

    const query: EpisodeQueryType = {
      projectId: projectId,
      alertGroupingRuleId: ruleId,
      groupingKey: groupingKey,
    };

    // Only add time window filter if enabled
    if (timeWindowCutoff) {
      query.lastAlertAddedAt = QueryHelper.greaterThanEqualTo(timeWindowCutoff);
    }

    const episodes: Array<AlertEpisode> = await AlertEpisodeService.findBy({
      query: query,
      sort: {
        lastAlertAddedAt: SortOrder.Descending,
      },
      select: {
        _id: true,
        currentAlertState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
      limit: 10,
      skip: 0,
    });

    // Filter to only active (non-resolved) episodes
    for (const episode of episodes) {
      const episodeOrder: number = episode.currentAlertState?.order || 0;
      const resolvedOrder: number = resolvedState?.order || 999;

      if (episodeOrder < resolvedOrder) {
        return episode;
      }
    }

    return null;
  }

  @CaptureSpan()
  private async findRecentlyResolvedEpisode(
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    reopenCutoff: Date,
  ): Promise<AlertEpisode | null> {
    // Find recently resolved episode with matching rule and grouping key
    const episode: AlertEpisode | null = await AlertEpisodeService.findOneBy({
      query: {
        projectId: projectId,
        alertGroupingRuleId: ruleId,
        groupingKey: groupingKey,
        resolvedAt: QueryHelper.greaterThanEqualTo(reopenCutoff),
      },
      sort: {
        resolvedAt: SortOrder.Descending,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return episode;
  }

  @CaptureSpan()
  private async createNewEpisode(
    alert: Alert,
    rule: AlertGroupingRule,
    groupingKey: string,
  ): Promise<AlertEpisode | null> {
    // Generate episode title from template (with initial alertCount of 1)
    const title: string = this.generateEpisodeTitle(
      alert,
      rule.episodeTitleTemplate,
      1, // Initial alert count
    );

    // Generate episode description from template (with initial alertCount of 1)
    const description: string | undefined = this.generateEpisodeDescription(
      alert,
      rule.episodeDescriptionTemplate,
      1, // Initial alert count
    );

    const newEpisode: AlertEpisode = new AlertEpisode();
    newEpisode.projectId = alert.projectId!;
    newEpisode.title = title;
    if (description) {
      newEpisode.description = description;
    }
    // Store preprocessed templates for dynamic variable updates
    // Static variables are replaced, dynamic ones (like {{alertCount}}) remain as placeholders
    if (rule.episodeTitleTemplate) {
      newEpisode.titleTemplate = this.preprocessTemplate(
        alert,
        rule.episodeTitleTemplate,
      );
    }
    if (rule.episodeDescriptionTemplate) {
      newEpisode.descriptionTemplate = this.preprocessTemplate(
        alert,
        rule.episodeDescriptionTemplate,
      );
    }
    newEpisode.alertGroupingRuleId = rule.id!;
    newEpisode.groupingKey = groupingKey;
    newEpisode.isManuallyCreated = false;

    // Set severity from alert
    if (alert.alertSeverityId) {
      newEpisode.alertSeverityId = alert.alertSeverityId;
    }

    // Set default ownership from rule
    if (rule.defaultAssignToUserId) {
      newEpisode.assignedToUserId = rule.defaultAssignToUserId;
    }

    if (rule.defaultAssignToTeamId) {
      newEpisode.assignedToTeamId = rule.defaultAssignToTeamId;
    }

    // Copy on-call policies from rule
    if (rule.onCallDutyPolicies && rule.onCallDutyPolicies.length > 0) {
      newEpisode.onCallDutyPolicies = rule.onCallDutyPolicies;
    }

    try {
      const createdEpisode: AlertEpisode = await AlertEpisodeService.create({
        data: newEpisode,
        props: {
          isRoot: true,
        },
      });

      return createdEpisode;
    } catch (error) {
      logger.error(`Error creating new episode: ${error}`);
      return null;
    }
  }

  private generateEpisodeTitle(
    alert: Alert,
    template: string | undefined,
    alertCount: number = 1,
  ): string {
    if (!template) {
      // Default title based on alert
      if (alert.monitor?.name) {
        return `Alert Episode: ${alert.monitor.name}`;
      }
      if (alert.title) {
        return `Alert Episode: ${alert.title.substring(0, 50)}`;
      }
      return "Alert Episode";
    }

    return (
      this.replaceTemplatePlaceholders(alert, template, alertCount) ||
      "Alert Episode"
    );
  }

  private generateEpisodeDescription(
    alert: Alert,
    template: string | undefined,
    alertCount: number = 1,
  ): string | undefined {
    if (!template) {
      return undefined;
    }

    return (
      this.replaceTemplatePlaceholders(alert, template, alertCount) || undefined
    );
  }

  private replaceTemplatePlaceholders(
    alert: Alert,
    template: string,
    alertCount: number = 1,
  ): string {
    let result: string = template;

    // Static variables (from first alert)
    // {{alertTitle}}
    if (alert.title) {
      result = result.replace(/\{\{alertTitle\}\}/g, alert.title);
    }

    // {{alertDescription}}
    if (alert.description) {
      result = result.replace(/\{\{alertDescription\}\}/g, alert.description);
    }

    // {{monitorName}}
    if (alert.monitor?.name) {
      result = result.replace(/\{\{monitorName\}\}/g, alert.monitor.name);
    }

    // {{alertSeverity}}
    if (alert.alertSeverity?.name) {
      result = result.replace(
        /\{\{alertSeverity\}\}/g,
        alert.alertSeverity.name,
      );
    }

    // Dynamic variables (updated when alerts are added/removed)
    // {{alertCount}}
    result = result.replace(/\{\{alertCount\}\}/g, alertCount.toString());

    // Clean up any remaining unknown placeholders
    result = result.replace(/\{\{[^}]+\}\}/g, "");

    return result;
  }

  // Preprocess template: replace static variables but keep dynamic ones as placeholders
  // This is stored on the episode so we can re-render with updated dynamic values later
  private preprocessTemplate(alert: Alert, template: string): string {
    let result: string = template;

    // Replace static variables (from first alert)
    // {{alertTitle}}
    if (alert.title) {
      result = result.replace(/\{\{alertTitle\}\}/g, alert.title);
    }

    // {{alertDescription}}
    if (alert.description) {
      result = result.replace(/\{\{alertDescription\}\}/g, alert.description);
    }

    // {{monitorName}}
    if (alert.monitor?.name) {
      result = result.replace(/\{\{monitorName\}\}/g, alert.monitor.name);
    }

    // {{alertSeverity}}
    if (alert.alertSeverity?.name) {
      result = result.replace(
        /\{\{alertSeverity\}\}/g,
        alert.alertSeverity.name,
      );
    }

    // Keep dynamic variables as placeholders (e.g., {{alertCount}})
    // They will be replaced when title/description is re-rendered

    return result;
  }

  @CaptureSpan()
  private async addAlertToEpisode(
    alert: Alert,
    episodeId: ObjectID,
    addedBy: AlertEpisodeMemberAddedBy,
    ruleId?: ObjectID,
  ): Promise<void> {
    const member: AlertEpisodeMember = new AlertEpisodeMember();
    member.projectId = alert.projectId!;
    member.alertEpisodeId = episodeId;
    member.alertId = alert.id!;
    member.addedBy = addedBy;

    if (ruleId) {
      member.matchedRuleId = ruleId;
    }

    try {
      await AlertEpisodeMemberService.create({
        data: member,
        props: {
          isRoot: true,
        },
      });
    } catch (error) {
      // Check if it's a duplicate error (alert already in episode)
      if (
        error instanceof Error &&
        error.message.includes("already a member")
      ) {
        logger.debug(`Alert ${alert.id} is already in episode ${episodeId}`);
        return;
      }
      throw error;
    }
  }

  @CaptureSpan()
  public async addAlertToEpisodeManually(
    alert: Alert,
    episodeId: ObjectID,
    addedByUserId?: ObjectID,
  ): Promise<void> {
    const member: AlertEpisodeMember = new AlertEpisodeMember();
    member.projectId = alert.projectId!;
    member.alertEpisodeId = episodeId;
    member.alertId = alert.id!;
    member.addedBy = AlertEpisodeMemberAddedBy.Manual;

    if (addedByUserId) {
      member.addedByUserId = addedByUserId;
    }

    await AlertEpisodeMemberService.create({
      data: member,
      props: {
        isRoot: true,
      },
    });

    // Update episode severity if needed
    if (alert.alertSeverityId) {
      await AlertEpisodeService.updateEpisodeSeverity({
        episodeId: episodeId,
        severityId: alert.alertSeverityId,
        onlyIfHigher: true,
      });
    }
  }
}

export default new AlertGroupingEngineServiceClass();
