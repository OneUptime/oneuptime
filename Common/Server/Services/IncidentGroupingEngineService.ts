import ObjectID from "../../Types/ObjectID";
import IncidentGroupingRule from "../../Models/DatabaseModels/IncidentGroupingRule";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember, {
  IncidentEpisodeMemberAddedBy,
} from "../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodeOwnerUser from "../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import IncidentEpisodeOwnerTeam from "../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeRoleMember from "../../Models/DatabaseModels/IncidentEpisodeRoleMember";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import ServiceMonitor from "../../Models/DatabaseModels/ServiceMonitor";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import QueryHelper from "../Types/Database/QueryHelper";
import IncidentGroupingRuleService from "./IncidentGroupingRuleService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import IncidentEpisodeOwnerUserService from "./IncidentEpisodeOwnerUserService";
import IncidentEpisodeOwnerTeamService from "./IncidentEpisodeOwnerTeamService";
import IncidentEpisodeRoleMemberService from "./IncidentEpisodeRoleMemberService";
import MonitorService from "./MonitorService";
import ServiceMonitorService from "./ServiceMonitorService";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Green500 } from "../../Types/BrandColors";

export interface GroupingResult {
  grouped: boolean;
  episodeId?: ObjectID;
  isNewEpisode?: boolean;
  wasReopened?: boolean;
}

class IncidentGroupingEngineServiceClass {
  @CaptureSpan()
  public async processIncident(incident: Incident): Promise<GroupingResult> {
    logger.debug(`Processing incident ${incident.id} for grouping`);

    try {
      if (!incident.id || !incident.projectId) {
        logger.warn("Incident missing id or projectId, skipping grouping");
        return { grouped: false };
      }

      // If incident already has an episode, don't reprocess
      if (incident.incidentEpisodeId) {
        return { grouped: true, episodeId: incident.incidentEpisodeId };
      }

      // Get enabled rules sorted by priority
      const rules: Array<IncidentGroupingRule> =
        await IncidentGroupingRuleService.findBy({
          query: {
            projectId: incident.projectId,
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
            priority: true,
            // Match criteria fields
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
            monitorNamePattern: true,
            monitorDescriptionPattern: true,
            // Group by fields
            groupByMonitor: true,
            groupBySeverity: true,
            groupByIncidentTitle: true,
            groupByService: true,
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
            // Episode configuration fields
            episodeLabels: {
              _id: true,
            },
            episodeOwnerUsers: {
              _id: true,
            },
            episodeOwnerTeams: {
              _id: true,
            },
            episodeMemberRoles: {
              _id: true,
            },
            episodeMemberRoleAssignments: true,
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        logger.debug(
          `No enabled grouping rules found for project ${incident.projectId}`,
        );
        return { grouped: false };
      }

      logger.debug(
        `Found ${rules.length} enabled grouping rules for project ${incident.projectId}`,
      );

      // Find first matching rule
      for (const rule of rules) {
        const matches: boolean = await this.doesIncidentMatchRule(
          incident,
          rule,
        );

        if (matches) {
          logger.debug(
            `Incident ${incident.id} matches rule ${rule.name || rule.id}`,
          );

          // Try to find existing episode or create new one
          const result: GroupingResult = await this.groupIncidentWithRule(
            incident,
            rule,
          );
          return result;
        }
      }

      logger.debug(`Incident ${incident.id} did not match any grouping rules`);
      return { grouped: false };
    } catch (error) {
      logger.error(`Error processing incident for grouping: ${error}`);
      return { grouped: false };
    }
  }

  @CaptureSpan()
  private async doesIncidentMatchRule(
    incident: Incident,
    rule: IncidentGroupingRule,
  ): Promise<boolean> {
    logger.debug(
      `Checking if incident ${incident.id} matches rule ${rule.name || rule.id}`,
    );

    // Check monitor IDs - if monitors are specified, incident must be from one of them
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
          return l.id?.toString() || "";
        },
      );
      const hasMatchingLabel: boolean = ruleLabelIds.some((labelId: string) => {
        return incidentLabelIds.includes(labelId);
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
      if (!incident.monitors || incident.monitors.length === 0) {
        return false;
      }

      // Check at least one monitor matches all criteria
      let anyMonitorMatches: boolean = false;

      for (const incidentMonitor of incident.monitors) {
        if (!incidentMonitor.id) {
          continue;
        }

        // Load monitor with all needed fields
        const monitor: Monitor | null = await MonitorService.findOneById({
          id: incidentMonitor.id,
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
          continue;
        }

        let monitorMatches: boolean = true;

        // Check monitor labels
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
            const hasMatchingMonitorLabel: boolean = ruleMonitorLabelIds.some(
              (labelId: string) => {
                return monitorLabelIds.includes(labelId);
              },
            );
            if (!hasMatchingMonitorLabel) {
              monitorMatches = false;
            }
          }
        }

        // Check monitor name pattern (regex)
        if (monitorMatches && rule.monitorNamePattern) {
          if (!monitor.name) {
            monitorMatches = false;
          } else {
            try {
              const regex: RegExp = new RegExp(rule.monitorNamePattern, "i");
              if (!regex.test(monitor.name)) {
                monitorMatches = false;
              }
            } catch {
              logger.warn(
                `Invalid regex pattern in rule ${rule.id}: ${rule.monitorNamePattern}`,
              );
              monitorMatches = false;
            }
          }
        }

        // Check monitor description pattern (regex)
        if (monitorMatches && rule.monitorDescriptionPattern) {
          if (!monitor.description) {
            monitorMatches = false;
          } else {
            try {
              const regex: RegExp = new RegExp(
                rule.monitorDescriptionPattern,
                "i",
              );
              if (!regex.test(monitor.description)) {
                monitorMatches = false;
              }
            } catch {
              logger.warn(
                `Invalid regex pattern in rule ${rule.id}: ${rule.monitorDescriptionPattern}`,
              );
              monitorMatches = false;
            }
          }
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
          `Invalid regex pattern in rule ${rule.id}: ${rule.incidentTitlePattern}`,
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
          `Invalid regex pattern in rule ${rule.id}: ${rule.incidentDescriptionPattern}`,
        );
        return false;
      }
    }

    // If no criteria specified (all fields empty), rule matches all incidents
    logger.debug(
      `Rule ${rule.name || rule.id} matched incident ${incident.id} (all criteria passed)`,
    );
    return true;
  }

  @CaptureSpan()
  private async groupIncidentWithRule(
    incident: Incident,
    rule: IncidentGroupingRule,
  ): Promise<GroupingResult> {
    // Build the grouping key based on groupBy fields
    const groupingKey: string = await this.buildGroupingKey(incident, rule);

    // Create mutex key to prevent race conditions when creating episodes
    const mutexKey: string = `${incident.projectId?.toString()}-${rule.id?.toString()}-${groupingKey}`;

    let mutex: SemaphoreMutex | null = null;

    try {
      /*
       * Acquire mutex to prevent concurrent episode creation for the same grouping key
       * This is critical - we must have the lock before proceeding to prevent race conditions
       */
      logger.debug(
        `Acquiring mutex for grouping key: ${mutexKey} for incident ${incident.id}`,
      );
      mutex = await Semaphore.lock({
        key: mutexKey,
        namespace: "IncidentGroupingEngine.groupIncidentWithRule",
        lockTimeout: 30000, // 30 seconds - enough time to complete episode creation
        acquireTimeout: 60000, // Wait up to 60 seconds to acquire the lock
      });
      logger.debug(
        `Acquired mutex for grouping key: ${mutexKey} for incident ${incident.id}`,
      );

      // Calculate time window cutoff (only if time window is enabled)
      let timeWindowCutoff: Date | null = null;
      if (rule.enableTimeWindow) {
        const timeWindowMinutes: number = rule.timeWindowMinutes || 60;
        timeWindowCutoff = OneUptimeDate.getSomeMinutesAgo(timeWindowMinutes);
      }

      // Find existing active episode that matches
      const existingEpisode: IncidentEpisode | null =
        await this.findMatchingActiveEpisode(
          incident.projectId!,
          rule.id!,
          groupingKey,
          timeWindowCutoff,
        );

      if (existingEpisode && existingEpisode.id) {
        // Add incident to existing episode
        await this.addIncidentToEpisode(
          incident,
          existingEpisode.id,
          IncidentEpisodeMemberAddedBy.Rule,
          rule.id!,
        );

        // Update episode severity if incident has higher severity
        if (incident.incidentSeverityId) {
          await IncidentEpisodeService.updateEpisodeSeverity(
            existingEpisode.id,
            incident.incidentSeverityId,
            true, // onlyIfHigher
          );
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
          const recentlyResolvedEpisode: IncidentEpisode | null =
            await this.findRecentlyResolvedEpisode(
              incident.projectId!,
              rule.id!,
              groupingKey,
              reopenCutoff,
            );

          if (recentlyResolvedEpisode && recentlyResolvedEpisode.id) {
            // Reopen the episode
            await IncidentEpisodeService.reopenEpisode(
              recentlyResolvedEpisode.id,
            );

            // Add incident to reopened episode
            await this.addIncidentToEpisode(
              incident,
              recentlyResolvedEpisode.id,
              IncidentEpisodeMemberAddedBy.Rule,
              rule.id!,
            );

            // Update episode severity if incident has higher severity
            if (incident.incidentSeverityId) {
              await IncidentEpisodeService.updateEpisodeSeverity(
                recentlyResolvedEpisode.id,
                incident.incidentSeverityId,
                true, // onlyIfHigher
              );
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
      const newEpisode: IncidentEpisode | null = await this.createNewEpisode(
        incident,
        rule,
        groupingKey,
      );

      if (newEpisode && newEpisode.id) {
        // Add incident to new episode
        await this.addIncidentToEpisode(
          incident,
          newEpisode.id,
          IncidentEpisodeMemberAddedBy.Rule,
          rule.id!,
        );

        return { grouped: true, episodeId: newEpisode.id, isNewEpisode: true };
      }

      return { grouped: false };
    } finally {
      // Release mutex
      if (mutex) {
        try {
          logger.debug(
            `Releasing mutex for grouping key: ${mutexKey} for incident ${incident.id}`,
          );
          await Semaphore.release(mutex);
          logger.debug(
            `Released mutex for grouping key: ${mutexKey} for incident ${incident.id}`,
          );
        } catch (err) {
          logger.error(
            `Error releasing mutex for grouping key: ${mutexKey}: ${err}`,
          );
        }
      }
    }
  }

  @CaptureSpan()
  private async buildGroupingKey(
    incident: Incident,
    rule: IncidentGroupingRule,
  ): Promise<string> {
    const parts: Array<string> = [];

    /*
     * Group by service - only if explicitly enabled
     * Must be checked before monitor since service contains multiple monitors
     */
    if (
      rule.groupByService &&
      incident.monitors &&
      incident.monitors.length > 0
    ) {
      // Use the first monitor's service for grouping
      const firstMonitor: Monitor | undefined = incident.monitors[0];
      if (firstMonitor && firstMonitor.id) {
        const serviceMonitor: ServiceMonitor | null =
          await ServiceMonitorService.findOneBy({
            query: {
              monitorId: firstMonitor.id,
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
    }

    // Group by monitor - only if explicitly enabled
    if (
      rule.groupByMonitor &&
      incident.monitors &&
      incident.monitors.length > 0
    ) {
      // Use the first monitor for grouping key
      const firstMonitor: Monitor | undefined = incident.monitors[0];
      if (firstMonitor && firstMonitor.id) {
        parts.push(`monitor:${firstMonitor.id.toString()}`);
      }
    }

    // Group by severity - only if explicitly enabled
    if (rule.groupBySeverity && incident.incidentSeverityId) {
      parts.push(`severity:${incident.incidentSeverityId.toString()}`);
    }

    // Group by incident title - only if explicitly enabled
    if (rule.groupByIncidentTitle && incident.title) {
      // Normalize title for grouping (remove numbers, etc.)
      const normalizedTitle: string = incident.title
        .toLowerCase()
        .replace(/\d+/g, "X");
      parts.push(`title:${normalizedTitle}`);
    }

    // If no group by options are enabled, all matching incidents go into a single episode
    return parts.join("|") || "default";
  }

  @CaptureSpan()
  private async findMatchingActiveEpisode(
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    timeWindowCutoff: Date | null,
  ): Promise<IncidentEpisode | null> {
    /*
     * Find active episode with matching rule and grouping key
     * Active episodes have resolvedAt = null (not yet resolved)
     * If time window is enabled, also filter by lastIncidentAddedAt
     * If time window is disabled (timeWindowCutoff is null), find any matching active episode
     */
    interface EpisodeQueryType {
      projectId: ObjectID;
      incidentGroupingRuleId: ObjectID;
      groupingKey: string;
      resolvedAt: null;
      lastIncidentAddedAt?: ReturnType<typeof QueryHelper.greaterThanEqualTo>;
    }

    const query: EpisodeQueryType = {
      projectId: projectId,
      incidentGroupingRuleId: ruleId,
      groupingKey: groupingKey,
      resolvedAt: null, // Only find active (non-resolved) episodes
    };

    // Only add time window filter if enabled
    if (timeWindowCutoff) {
      query.lastIncidentAddedAt =
        QueryHelper.greaterThanEqualTo(timeWindowCutoff);
    }

    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneBy({
        query: query as any,
        sort: {
          lastIncidentAddedAt: SortOrder.Descending,
        },
        select: {
          _id: true,
          lastIncidentAddedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    return episode;
  }

  @CaptureSpan()
  private async findRecentlyResolvedEpisode(
    projectId: ObjectID,
    ruleId: ObjectID,
    groupingKey: string,
    reopenCutoff: Date,
  ): Promise<IncidentEpisode | null> {
    // Find recently resolved episode with matching rule and grouping key
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneBy({
        query: {
          projectId: projectId,
          incidentGroupingRuleId: ruleId,
          groupingKey: groupingKey,
          resolvedAt: QueryHelper.greaterThanEqualTo(reopenCutoff),
        },
        sort: {
          resolvedAt: SortOrder.Descending,
        },
        select: {
          _id: true,
          resolvedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    return episode;
  }

  @CaptureSpan()
  private async createNewEpisode(
    incident: Incident,
    rule: IncidentGroupingRule,
    groupingKey: string,
  ): Promise<IncidentEpisode | null> {
    // Generate episode title from template (with initial incidentCount of 1)
    const title: string = this.generateEpisodeTitle(
      incident,
      rule.episodeTitleTemplate,
      1, // Initial incident count
    );

    // Generate episode description from template (with initial incidentCount of 1)
    const description: string | undefined = this.generateEpisodeDescription(
      incident,
      rule.episodeDescriptionTemplate,
      1, // Initial incident count
    );

    const newEpisode: IncidentEpisode = new IncidentEpisode();
    newEpisode.projectId = incident.projectId!;
    newEpisode.title = title;
    if (description) {
      newEpisode.description = description;
    }
    /*
     * Store preprocessed templates for dynamic variable updates
     * Static variables are replaced, dynamic ones (like {{incidentCount}}) remain as placeholders
     */
    if (rule.episodeTitleTemplate) {
      newEpisode.titleTemplate = this.preprocessTemplate(
        incident,
        rule.episodeTitleTemplate,
      );
    }
    if (rule.episodeDescriptionTemplate) {
      newEpisode.descriptionTemplate = this.preprocessTemplate(
        incident,
        rule.episodeDescriptionTemplate,
      );
    }
    newEpisode.incidentGroupingRuleId = rule.id!;
    newEpisode.groupingKey = groupingKey;
    newEpisode.isManuallyCreated = false;
    newEpisode.lastIncidentAddedAt = OneUptimeDate.getCurrentDate();

    // Set severity from incident
    if (incident.incidentSeverityId) {
      newEpisode.incidentSeverityId = incident.incidentSeverityId;
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

    // Copy episode labels from rule
    if (rule.episodeLabels && rule.episodeLabels.length > 0) {
      newEpisode.labels = rule.episodeLabels;
    }

    try {
      const createdEpisode: IncidentEpisode =
        await IncidentEpisodeService.create({
          data: newEpisode,
          props: {
            isRoot: true,
          },
        });

      // Add episode owner users from rule
      if (
        rule.episodeOwnerUsers &&
        rule.episodeOwnerUsers.length > 0 &&
        createdEpisode.id
      ) {
        for (const user of rule.episodeOwnerUsers) {
          if (!user.id) {
            continue;
          }
          try {
            const ownerUser: IncidentEpisodeOwnerUser =
              new IncidentEpisodeOwnerUser();
            ownerUser.projectId = incident.projectId!;
            ownerUser.incidentEpisodeId = createdEpisode.id;
            ownerUser.userId = user.id;
            await IncidentEpisodeOwnerUserService.create({
              data: ownerUser,
              props: {
                isRoot: true,
              },
            });
          } catch (ownerError) {
            logger.error(
              `Error adding owner user ${user.id} to episode: ${ownerError}`,
            );
          }
        }
      }

      // Add episode owner teams from rule
      if (
        rule.episodeOwnerTeams &&
        rule.episodeOwnerTeams.length > 0 &&
        createdEpisode.id
      ) {
        for (const team of rule.episodeOwnerTeams) {
          if (!team.id) {
            continue;
          }
          try {
            const ownerTeam: IncidentEpisodeOwnerTeam =
              new IncidentEpisodeOwnerTeam();
            ownerTeam.projectId = incident.projectId!;
            ownerTeam.incidentEpisodeId = createdEpisode.id;
            ownerTeam.teamId = team.id;
            await IncidentEpisodeOwnerTeamService.create({
              data: ownerTeam,
              props: {
                isRoot: true,
              },
            });
          } catch (ownerError) {
            logger.error(
              `Error adding owner team ${team.id} to episode: ${ownerError}`,
            );
          }
        }
      }

      // Add episode member role assignments from rule
      if (
        rule.episodeMemberRoleAssignments &&
        rule.episodeMemberRoleAssignments.length > 0 &&
        createdEpisode.id
      ) {
        for (const assignment of rule.episodeMemberRoleAssignments) {
          if (!assignment.userId || !assignment.incidentRoleId) {
            continue;
          }
          try {
            const roleMember: IncidentEpisodeRoleMember =
              new IncidentEpisodeRoleMember();
            roleMember.projectId = incident.projectId!;
            roleMember.incidentEpisodeId = createdEpisode.id;
            roleMember.userId = new ObjectID(assignment.userId);
            roleMember.incidentRoleId = new ObjectID(assignment.incidentRoleId);
            await IncidentEpisodeRoleMemberService.create({
              data: roleMember,
              props: {
                isRoot: true,
              },
            });
          } catch (memberError) {
            logger.error(
              `Error adding member role assignment to episode: ${memberError}`,
            );
          }
        }
      }

      // Add episode feed entry for episode creation
      if (createdEpisode.id) {
        const groupByParts: Array<string> = [];

        if (rule.groupByMonitor) {
          groupByParts.push("Monitor");
        }
        if (rule.groupBySeverity) {
          groupByParts.push("Severity");
        }
        if (rule.groupByIncidentTitle) {
          groupByParts.push("Incident Title");
        }
        if (rule.groupByService) {
          groupByParts.push("Service");
        }

        const groupByDescription: string =
          groupByParts.length > 0
            ? `Grouping by: ${groupByParts.join(", ")}`
            : "Grouping all matching incidents together";

        let moreInfo: string = `**Rule:** ${rule.name || "Unnamed Rule"}\n\n`;
        moreInfo += `**Grouping Key:** \`${groupingKey}\`\n\n`;
        moreInfo += `**${groupByDescription}**`;

        if (rule.enableTimeWindow && rule.timeWindowMinutes) {
          moreInfo += `\n\n**Time Window:** ${rule.timeWindowMinutes} minutes`;
        }

        try {
          await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
            incidentEpisodeId: createdEpisode.id,
            projectId: incident.projectId!,
            incidentEpisodeFeedEventType:
              IncidentEpisodeFeedEventType.EpisodeCreated,
            displayColor: Green500,
            feedInfoInMarkdown: `**Episode Created** by grouping rule **${rule.name || "Unnamed Rule"}**`,
            moreInformationInMarkdown: moreInfo,
          });
        } catch (feedError) {
          logger.error(
            `Error creating episode feed for episode creation: ${feedError}`,
          );
        }
      }

      return createdEpisode;
    } catch (error) {
      logger.error(`Error creating new episode: ${error}`);
      return null;
    }
  }

  private generateEpisodeTitle(
    incident: Incident,
    template: string | undefined,
    incidentCount: number = 1,
  ): string {
    if (!template) {
      // Default title based on incident
      if (
        incident.monitors &&
        incident.monitors.length > 0 &&
        incident.monitors[0]?.name
      ) {
        return incident.monitors[0].name;
      }
      if (incident.title) {
        return incident.title.substring(0, 50);
      }
      return "Untitled Episode";
    }

    return (
      this.replaceTemplatePlaceholders(incident, template, incidentCount) ||
      "Untitled Episode"
    );
  }

  private generateEpisodeDescription(
    incident: Incident,
    template: string | undefined,
    incidentCount: number = 1,
  ): string | undefined {
    if (!template) {
      return undefined;
    }

    return (
      this.replaceTemplatePlaceholders(incident, template, incidentCount) ||
      undefined
    );
  }

  private replaceTemplatePlaceholders(
    incident: Incident,
    template: string,
    incidentCount: number = 1,
  ): string {
    let result: string = template;

    /*
     * Static variables (from first incident)
     * {{incidentTitle}}
     */
    if (incident.title) {
      result = result.replace(/\{\{incidentTitle\}\}/g, incident.title);
    }

    // {{incidentDescription}}
    if (incident.description) {
      result = result.replace(
        /\{\{incidentDescription\}\}/g,
        incident.description,
      );
    }

    // {{monitorName}} - use first monitor's name
    if (
      incident.monitors &&
      incident.monitors.length > 0 &&
      incident.monitors[0]?.name
    ) {
      result = result.replace(
        /\{\{monitorName\}\}/g,
        incident.monitors[0].name,
      );
    }

    // {{incidentSeverity}}
    if (incident.incidentSeverity?.name) {
      result = result.replace(
        /\{\{incidentSeverity\}\}/g,
        incident.incidentSeverity.name,
      );
    }

    /*
     * Dynamic variables (updated when incidents are added/removed)
     * {{incidentCount}}
     */
    result = result.replace(/\{\{incidentCount\}\}/g, incidentCount.toString());

    // Clean up any remaining unknown placeholders
    result = result.replace(/\{\{[^}]+\}\}/g, "");

    return result;
  }

  /*
   * Preprocess template: replace static variables but keep dynamic ones as placeholders
   * This is stored on the episode so we can re-render with updated dynamic values later
   */
  private preprocessTemplate(incident: Incident, template: string): string {
    let result: string = template;

    /*
     * Replace static variables (from first incident)
     * {{incidentTitle}}
     */
    if (incident.title) {
      result = result.replace(/\{\{incidentTitle\}\}/g, incident.title);
    }

    // {{incidentDescription}}
    if (incident.description) {
      result = result.replace(
        /\{\{incidentDescription\}\}/g,
        incident.description,
      );
    }

    // {{monitorName}} - use first monitor's name
    if (
      incident.monitors &&
      incident.monitors.length > 0 &&
      incident.monitors[0]?.name
    ) {
      result = result.replace(
        /\{\{monitorName\}\}/g,
        incident.monitors[0].name,
      );
    }

    // {{incidentSeverity}}
    if (incident.incidentSeverity?.name) {
      result = result.replace(
        /\{\{incidentSeverity\}\}/g,
        incident.incidentSeverity.name,
      );
    }

    /*
     * Keep dynamic variables as placeholders (e.g., {{incidentCount}})
     * They will be replaced when title/description is re-rendered
     */

    return result;
  }

  @CaptureSpan()
  private async addIncidentToEpisode(
    incident: Incident,
    episodeId: ObjectID,
    addedBy: IncidentEpisodeMemberAddedBy,
    ruleId?: ObjectID,
  ): Promise<void> {
    const member: IncidentEpisodeMember = new IncidentEpisodeMember();
    member.projectId = incident.projectId!;
    member.incidentEpisodeId = episodeId;
    member.incidentId = incident.id!;
    member.addedBy = addedBy;

    if (ruleId) {
      member.matchedRuleId = ruleId;
    }

    try {
      await IncidentEpisodeMemberService.create({
        data: member,
        props: {
          isRoot: true,
        },
      });

      // Feed entries are created by IncidentEpisodeMemberService.onCreateSuccess
    } catch (error) {
      // Check if it's a duplicate error (incident already in episode)
      if (
        error instanceof Error &&
        error.message.includes("already a member")
      ) {
        logger.debug(
          `Incident ${incident.id} is already in episode ${episodeId}`,
        );
        return;
      }
      throw error;
    }
  }

  @CaptureSpan()
  public async addIncidentToEpisodeManually(
    incident: Incident,
    episodeId: ObjectID,
    addedByUserId?: ObjectID,
  ): Promise<void> {
    const member: IncidentEpisodeMember = new IncidentEpisodeMember();
    member.projectId = incident.projectId!;
    member.incidentEpisodeId = episodeId;
    member.incidentId = incident.id!;
    member.addedBy = IncidentEpisodeMemberAddedBy.Manual;

    if (addedByUserId) {
      member.addedByUserId = addedByUserId;
    }

    await IncidentEpisodeMemberService.create({
      data: member,
      props: {
        isRoot: true,
      },
    });

    // Feed entries are created by IncidentEpisodeMemberService.onCreateSuccess

    // Update episode severity if needed
    if (incident.incidentSeverityId) {
      await IncidentEpisodeService.updateEpisodeSeverity(
        episodeId,
        incident.incidentSeverityId,
        true, // onlyIfHigher
      );
    }
  }
}

export default new IncidentGroupingEngineServiceClass();
