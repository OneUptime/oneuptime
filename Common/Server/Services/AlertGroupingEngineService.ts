import ObjectID from "../../Types/ObjectID";
import AlertGroupingRule, {
  AlertGroupingRuleMatchCriteria,
  AlertGroupingRuleGroupByFields,
} from "../../Models/DatabaseModels/AlertGroupingRule";
import Alert from "../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember, {
  AlertEpisodeMemberAddedBy,
} from "../../Models/DatabaseModels/AlertEpisodeMember";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";

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
      const AlertGroupingRuleService = (
        await import("./AlertGroupingRuleService")
      ).default;

      const rules: AlertGroupingRule[] = await AlertGroupingRuleService.findBy({
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
          matchCriteria: true,
          timeWindowMinutes: true,
          groupByFields: true,
          episodeTitleTemplate: true,
          reopenWindowMinutes: true,
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
        const matches = await this.doesAlertMatchRule(alert, rule);

        if (matches) {
          logger.debug(
            `Alert ${alert.id} matches rule ${rule.name || rule.id}`,
          );

          // Try to find existing episode or create new one
          const result = await this.groupAlertWithRule(alert, rule);
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
    const criteria: AlertGroupingRuleMatchCriteria | undefined =
      rule.matchCriteria;

    // If no criteria specified, rule matches all alerts
    if (!criteria) {
      return true;
    }

    // Check monitor IDs
    if (criteria.monitorIds && criteria.monitorIds.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const monitorIdStr = alert.monitorId.toString();
      if (!criteria.monitorIds.includes(monitorIdStr)) {
        return false;
      }
    }

    // Check alert severity IDs
    if (criteria.alertSeverityIds && criteria.alertSeverityIds.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }
      const severityIdStr = alert.alertSeverityId.toString();
      if (!criteria.alertSeverityIds.includes(severityIdStr)) {
        return false;
      }
    }

    // Check label IDs
    if (criteria.labelIds && criteria.labelIds.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const alertLabelIds = alert.labels.map((l) => {
        return l.id?.toString() || "";
      });
      const hasMatchingLabel = criteria.labelIds.some((labelId) => {
        return alertLabelIds.includes(labelId);
      });
      if (!hasMatchingLabel) {
        return false;
      }
    }

    // Check alert title pattern (regex)
    if (criteria.alertTitlePattern) {
      if (!alert.title) {
        return false;
      }
      try {
        const regex = new RegExp(criteria.alertTitlePattern, "i");
        if (!regex.test(alert.title)) {
          return false;
        }
      } catch (e) {
        logger.warn(
          `Invalid regex pattern in rule ${rule.id}: ${criteria.alertTitlePattern}`,
        );
        return false;
      }
    }

    // Check alert description pattern (regex)
    if (criteria.alertDescriptionPattern) {
      if (!alert.description) {
        return false;
      }
      try {
        const regex = new RegExp(criteria.alertDescriptionPattern, "i");
        if (!regex.test(alert.description)) {
          return false;
        }
      } catch (e) {
        logger.warn(
          `Invalid regex pattern in rule ${rule.id}: ${criteria.alertDescriptionPattern}`,
        );
        return false;
      }
    }

    // Check telemetry query match - alerts with telemetry queries can be grouped
    if (criteria.telemetryQueryMatch) {
      if (!alert.telemetryQuery) {
        return false;
      }
    }

    // Check monitor custom fields
    if (
      criteria.monitorCustomFields &&
      Object.keys(criteria.monitorCustomFields).length > 0
    ) {
      if (!alert.customFields) {
        return false;
      }

      for (const [key, value] of Object.entries(criteria.monitorCustomFields)) {
        const alertCustomFields = alert.customFields as Record<string, unknown>;
        if (alertCustomFields[key] !== value) {
          return false;
        }
      }
    }

    return true;
  }

  @CaptureSpan()
  private async groupAlertWithRule(
    alert: Alert,
    rule: AlertGroupingRule,
  ): Promise<GroupingResult> {
    const AlertEpisodeService = (await import("./AlertEpisodeService")).default;
    const AlertEpisodeMemberService = (
      await import("./AlertEpisodeMemberService")
    ).default;

    // Build the grouping key based on groupByFields
    const groupingKey = this.buildGroupingKey(alert, rule.groupByFields);

    // Calculate time window cutoff
    const timeWindowMinutes = rule.timeWindowMinutes || 60;
    const timeWindowCutoff = OneUptimeDate.getSomeMinutesAgo(timeWindowMinutes);

    // Find existing active episode that matches
    const existingEpisode = await this.findMatchingActiveEpisode(
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

    // Check if we can reopen a recently resolved episode
    const reopenWindowMinutes = rule.reopenWindowMinutes || 0;
    if (reopenWindowMinutes > 0) {
      const reopenCutoff = OneUptimeDate.getSomeMinutesAgo(reopenWindowMinutes);
      const recentlyResolvedEpisode = await this.findRecentlyResolvedEpisode(
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

    // Create new episode
    const newEpisode = await this.createNewEpisode(alert, rule, groupingKey);

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

  private buildGroupingKey(
    alert: Alert,
    groupByFields: AlertGroupingRuleGroupByFields | undefined,
  ): string {
    const parts: string[] = [];

    if (!groupByFields) {
      // Default grouping by monitorId
      if (alert.monitorId) {
        parts.push(`monitor:${alert.monitorId.toString()}`);
      }
      return parts.join("|");
    }

    if (groupByFields.monitorId && alert.monitorId) {
      parts.push(`monitor:${alert.monitorId.toString()}`);
    }

    if (groupByFields.alertSeverityId && alert.alertSeverityId) {
      parts.push(`severity:${alert.alertSeverityId.toString()}`);
    }

    if (groupByFields.alertTitle && alert.title) {
      // Normalize title for grouping (remove numbers, etc.)
      const normalizedTitle = alert.title.toLowerCase().replace(/\d+/g, "X");
      parts.push(`title:${normalizedTitle}`);
    }

    if (groupByFields.telemetryQuery && alert.telemetryQuery) {
      // Hash the telemetry query for grouping
      const queryStr = JSON.stringify(alert.telemetryQuery);
      parts.push(`query:${this.simpleHash(queryStr)}`);
    }

    if (
      groupByFields.customFieldValues &&
      groupByFields.customFieldValues.length > 0
    ) {
      const customFields = alert.customFields as Record<string, unknown>;
      if (customFields) {
        for (const fieldName of groupByFields.customFieldValues) {
          if (customFields[fieldName] !== undefined) {
            parts.push(`cf:${fieldName}:${String(customFields[fieldName])}`);
          }
        }
      }
    }

    return parts.join("|") || "default";
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  @CaptureSpan()
  private async findMatchingActiveEpisode(
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    timeWindowCutoff: Date,
  ): Promise<AlertEpisode | null> {
    const AlertEpisodeService = (await import("./AlertEpisodeService")).default;
    const AlertStateService = (await import("./AlertStateService")).default;

    // Get resolved state to exclude resolved episodes
    const resolvedState = await AlertStateService.findOneBy({
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
     * that has been updated recently (within time window)
     */
    const episodes = await AlertEpisodeService.findBy({
      query: {
        projectId: projectId,
        alertGroupingRuleId: ruleId,
        groupingKey: groupingKey,
        lastAlertAddedAt: QueryHelper.greaterThanEqualTo(timeWindowCutoff),
      },
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
      const episodeOrder = episode.currentAlertState?.order || 0;
      const resolvedOrder = resolvedState?.order || 999;

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
    const AlertEpisodeService = (await import("./AlertEpisodeService")).default;

    // Find recently resolved episode with matching rule and grouping key
    const episode = await AlertEpisodeService.findOneBy({
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
    const AlertEpisodeService = (await import("./AlertEpisodeService")).default;

    // Generate episode title from template
    const title = this.generateEpisodeTitle(alert, rule.episodeTitleTemplate);

    const newEpisode = new AlertEpisode();
    newEpisode.projectId = alert.projectId;
    newEpisode.title = title;
    newEpisode.alertGroupingRuleId = rule.id;
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
      const createdEpisode = await AlertEpisodeService.create({
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

    // Replace placeholders in template
    let title = template;

    // {alertTitle}
    if (alert.title) {
      title = title.replace("{alertTitle}", alert.title);
    }

    // {monitorName}
    if (alert.monitor?.name) {
      title = title.replace("{monitorName}", alert.monitor.name);
    }

    // {alertSeverity} - would need severity name lookup
    if (alert.alertSeverity?.name) {
      title = title.replace("{alertSeverity}", alert.alertSeverity.name);
    }

    // Clean up any remaining placeholders
    title = title.replace(/\{[^}]+\}/g, "");

    return title || "Alert Episode";
  }

  @CaptureSpan()
  private async addAlertToEpisode(
    alert: Alert,
    episodeId: ObjectID,
    addedBy: AlertEpisodeMemberAddedBy,
    ruleId?: ObjectID,
  ): Promise<void> {
    const AlertEpisodeMemberService = (
      await import("./AlertEpisodeMemberService")
    ).default;

    const member = new AlertEpisodeMember();
    member.projectId = alert.projectId;
    member.alertEpisodeId = episodeId;
    member.alertId = alert.id;
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
    const AlertEpisodeMemberService = (
      await import("./AlertEpisodeMemberService")
    ).default;
    const AlertEpisodeService = (await import("./AlertEpisodeService")).default;

    const member = new AlertEpisodeMember();
    member.projectId = alert.projectId;
    member.alertEpisodeId = episodeId;
    member.alertId = alert.id;
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
