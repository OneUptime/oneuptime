import Incident from "../../Models/DatabaseModels/Incident";
import IncidentPrivacyRule from "../../Models/DatabaseModels/IncidentPrivacyRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import IncidentFeedService from "./IncidentFeedService";
import IncidentPrivacyRuleService from "./IncidentPrivacyRuleService";
import IncidentService from "./IncidentService";
import MonitorService from "./MonitorService";
import { IncidentFeedEventType } from "../../Models/DatabaseModels/IncidentFeed";
import { Red500 } from "../../Types/BrandColors";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncidentPrivacyRuleEngineServiceClass {
  /**
   * Evaluates IncidentPrivacyRule rows for the given incident. If any enabled
   * rule matches, the incident is marked private (isPrivate=true) and the
   * passed-in incident object is mutated in place so downstream callers see
   * the updated value.
   *
   * Returns true if the incident was marked private by a rule.
   */
  @CaptureSpan()
  public async applyRulesToIncident(incident: Incident): Promise<boolean> {
    if (!incident.id || !incident.projectId) {
      return false;
    }

    if (incident.isPrivate === true) {
      // Already private — nothing to do.
      return false;
    }

    try {
      const rules: Array<IncidentPrivacyRule> =
        await IncidentPrivacyRuleService.findBy({
          query: {
            projectId: incident.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            monitors: { _id: true },
            incidentSeverities: { _id: true },
            incidentLabels: { _id: true },
            monitorLabels: { _id: true },
            incidentTitlePattern: true,
            incidentDescriptionPattern: true,
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return false;
      }

      const matchedRules: Array<IncidentPrivacyRule> = [];
      for (const rule of rules) {
        const matches: boolean = await this.doesIncidentMatchRule(
          incident,
          rule,
        );
        if (matches) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return false;
      }

      await IncidentService.updateOneById({
        id: incident.id,
        data: { isPrivate: true },
        props: { isRoot: true },
      });

      // Mirror in memory so downstream onCreateSuccess steps see the change.
      incident.isPrivate = true;

      logger.debug(
        `IncidentPrivacyRuleEngine marked incident ${incident.id} private`,
        { projectId: incident.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({ incident, matchedRules });

      return true;
    } catch (error) {
      logger.error(`Error applying incident privacy rules: ${error}`, {
        projectId: incident.projectId?.toString(),
        incidentId: incident.id?.toString(),
      } as LogAttributes);
      return false;
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    incident: Incident;
    matchedRules: Array<IncidentPrivacyRule>;
  }): Promise<void> {
    const { incident, matchedRules } = data;
    if (!incident.id || !incident.projectId || matchedRules.length === 0) {
      return;
    }

    try {
      const ruleNames: Array<string> = matchedRules
        .map((r: IncidentPrivacyRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const rulesPart: string =
        ruleNames.length === 1
          ? `**${ruleNames[0]}**`
          : ruleNames
              .map((n: string) => {
                return `**${n}**`;
              })
              .join(", ");

      const feedInfoInMarkdown: string = `🔒 **Incident Privacy Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nIncident has been marked **private** — visible only to its owners, project admins, and project owners.`;

      await IncidentFeedService.createIncidentFeedItem({
        incidentId: incident.id,
        projectId: incident.projectId,
        incidentFeedEventType: IncidentFeedEventType.PrivacyRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `IncidentPrivacyRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: incident.projectId?.toString(),
          incidentId: incident.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesIncidentMatchRule(
    incident: Incident,
    rule: IncidentPrivacyRule,
  ): Promise<boolean> {
    if (rule.monitors && rule.monitors.length > 0) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const incidentMonitorIds: Array<string> = incident.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      if (
        !ruleMonitorIds.some((id: string) => {
          return incidentMonitorIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!incident.incidentSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.incidentSeverities.map(
        (s: IncidentSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(incident.incidentSeverityId.toString())) {
        return false;
      }
    }

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
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return incidentLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      let anyMonitorMatches: boolean = false;
      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }
        const monitor: Monitor | null = await MonitorService.findOneById({
          id: incidentMonitor.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });
        if (!monitor) {
          continue;
        }

        let monitorMatches: boolean = true;

        if (rule.monitorLabels && rule.monitorLabels.length > 0) {
          if (!monitor.labels || monitor.labels.length === 0) {
            monitorMatches = false;
          } else {
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
            if (
              !ruleMonitorLabelIds.some((id: string) => {
                return monitorLabelIds.includes(id);
              })
            ) {
              monitorMatches = false;
            }
          }
        }

        if (
          monitorMatches &&
          rule.monitorNamePattern &&
          (!monitor.name ||
            !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
        ) {
          monitorMatches = false;
        }

        if (
          monitorMatches &&
          rule.monitorDescriptionPattern &&
          (!monitor.description ||
            !this.testRegex(
              rule.monitorDescriptionPattern,
              monitor.description,
              rule,
            ))
        ) {
          monitorMatches = false;
        }

        if (monitorMatches) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (
      rule.incidentTitlePattern &&
      (!incident.title ||
        !this.testRegex(rule.incidentTitlePattern, incident.title, rule))
    ) {
      return false;
    }

    if (
      rule.incidentDescriptionPattern &&
      (!incident.description ||
        !this.testRegex(
          rule.incidentDescriptionPattern,
          incident.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: IncidentPrivacyRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incident privacy rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentPrivacyRuleEngineServiceClass();
