import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncidentGroupingRuleService from "Common/Server/Services/IncidentGroupingRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "Common/Models/DatabaseModels/IncidentGroupingRule";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Incident from "Common/Models/DatabaseModels/Incident";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";

RunCron(
  "IncidentEpisode:AutoResolve",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async () => {
    /*
     * Find active episodes that might be eligible for auto-resolve
     * Active = not in resolved state
     */

    try {
      // Get all active episodes
      const activeEpisodes: Array<IncidentEpisode> =
        await IncidentEpisodeService.findBy({
          query: {
            resolvedAt: QueryHelper.isNull(),
          },
          select: {
            _id: true,
            projectId: true,
            incidentGroupingRuleId: true,
            lastIncidentAddedAt: true,
            allIncidentsResolvedAt: true,
          },
          props: {
            isRoot: true,
          },
          limit: 1000,
          skip: 0,
        });

      logger.debug(
        `IncidentEpisode:AutoResolve - Found ${activeEpisodes.length} active episodes`,
      );

      if (activeEpisodes.length === 0) {
        return;
      }

      /*
       * Episodes cluster by grouping rule and project, so fetch each distinct
       * rule and resolved-state once per tick instead of once per episode.
       */
      const rulesById: Map<string, IncidentGroupingRule> =
        await fetchGroupingRules(activeEpisodes);
      const resolvedStateByProjectId: Map<string, IncidentState> =
        await fetchResolvedStates(activeEpisodes);

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(
          checkAndResolveEpisode(episode, rulesById, resolvedStateByProjectId),
        );
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`IncidentEpisode:AutoResolve - Error: ${error}`);
    }
  },
);

type FetchGroupingRulesFunction = (
  episodes: Array<IncidentEpisode>,
) => Promise<Map<string, IncidentGroupingRule>>;

const fetchGroupingRules: FetchGroupingRulesFunction = async (
  episodes: Array<IncidentEpisode>,
): Promise<Map<string, IncidentGroupingRule>> => {
  const rulesById: Map<string, IncidentGroupingRule> = new Map();

  const distinctRuleIds: Map<string, ObjectID> = new Map();
  for (const episode of episodes) {
    if (episode.incidentGroupingRuleId) {
      distinctRuleIds.set(
        episode.incidentGroupingRuleId.toString(),
        episode.incidentGroupingRuleId,
      );
    }
  }

  if (distinctRuleIds.size === 0) {
    return rulesById;
  }

  const rules: Array<IncidentGroupingRule> =
    await IncidentGroupingRuleService.findBy({
      query: {
        _id: QueryHelper.any([...distinctRuleIds.values()]),
      },
      select: {
        _id: true,
        enableResolveDelay: true,
        resolveDelayMinutes: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

  for (const rule of rules) {
    if (rule.id) {
      rulesById.set(rule.id.toString(), rule);
    }
  }

  return rulesById;
};

type FetchResolvedStatesFunction = (
  episodes: Array<IncidentEpisode>,
) => Promise<Map<string, IncidentState>>;

const fetchResolvedStates: FetchResolvedStatesFunction = async (
  episodes: Array<IncidentEpisode>,
): Promise<Map<string, IncidentState>> => {
  const resolvedStateByProjectId: Map<string, IncidentState> = new Map();

  const distinctProjectIds: Map<string, ObjectID> = new Map();
  for (const episode of episodes) {
    if (episode.projectId) {
      distinctProjectIds.set(episode.projectId.toString(), episode.projectId);
    }
  }

  if (distinctProjectIds.size === 0) {
    return resolvedStateByProjectId;
  }

  const resolvedStates: Array<IncidentState> =
    await IncidentStateService.findBy({
      query: {
        projectId: QueryHelper.any([...distinctProjectIds.values()]),
        isResolvedState: true,
      },
      select: {
        _id: true,
        order: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

  for (const state of resolvedStates) {
    const projectKey: string | undefined = state.projectId?.toString();
    if (projectKey && !resolvedStateByProjectId.has(projectKey)) {
      resolvedStateByProjectId.set(projectKey, state);
    }
  }

  return resolvedStateByProjectId;
};

type CheckAndResolveEpisodeFunction = (
  episode: IncidentEpisode,
  rulesById: Map<string, IncidentGroupingRule>,
  resolvedStateByProjectId: Map<string, IncidentState>,
) => Promise<void>;

const checkAndResolveEpisode: CheckAndResolveEpisodeFunction = async (
  episode: IncidentEpisode,
  rulesById: Map<string, IncidentGroupingRule>,
  resolvedStateByProjectId: Map<string, IncidentState>,
): Promise<void> => {
  try {
    if (!episode.id || !episode.projectId) {
      return;
    }

    // Get resolve delay from the grouping rule if exists and enabled
    let resolveDelayMinutes: number = 0;
    let enableResolveDelay: boolean = false;

    if (episode.incidentGroupingRuleId) {
      const rule: IncidentGroupingRule | undefined = rulesById.get(
        episode.incidentGroupingRuleId.toString(),
      );

      if (rule) {
        enableResolveDelay = rule.enableResolveDelay || false;
        if (enableResolveDelay && rule.resolveDelayMinutes) {
          resolveDelayMinutes = rule.resolveDelayMinutes;
        }
      }
    }

    // Get all incidents in this episode
    const incidentIds: ObjectID[] =
      await IncidentEpisodeMemberService.getIncidentsInEpisode(episode.id);

    if (incidentIds.length === 0) {
      // No incidents in episode, check if it should be resolved due to being empty
      logger.debug(
        `IncidentEpisode:AutoResolve - Episode ${episode.id} has no incidents`,
      );
      return;
    }

    // Check if all incidents are resolved
    const resolvedState: IncidentState | null =
      resolvedStateByProjectId.get(episode.projectId.toString()) || null;

    if (!resolvedState || !resolvedState.order) {
      logger.debug(
        `IncidentEpisode:AutoResolve - No resolved state found for project ${episode.projectId}`,
      );
      return;
    }

    /*
     * Check if all incidents are in resolved state or higher. One batched
     * query for the whole episode; incidents that no longer exist simply
     * don't come back, matching the old per-id skip behavior.
     */
    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        _id: QueryHelper.any(incidentIds),
      },
      select: {
        _id: true,
        currentIncidentState: {
          order: true,
        },
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    let allResolved: boolean = true;

    for (const incident of incidents) {
      const incidentOrder: number = incident.currentIncidentState?.order || 0;

      if (incidentOrder < resolvedState.order) {
        allResolved = false;
        break;
      }
    }

    if (!allResolved) {
      // If any incident is unresolved, clear allIncidentsResolvedAt
      if (episode.allIncidentsResolvedAt) {
        await IncidentEpisodeService.updateOneById({
          id: episode.id,
          data: {
            allIncidentsResolvedAt: null,
          },
          props: {
            isRoot: true,
          },
        });
      }

      logger.debug(
        `IncidentEpisode:AutoResolve - Episode ${episode.id} has unresolved incidents`,
      );
      return;
    }

    // All incidents are resolved. Set allIncidentsResolvedAt if not already set.
    if (!episode.allIncidentsResolvedAt) {
      await IncidentEpisodeService.updateOneById({
        id: episode.id,
        data: {
          allIncidentsResolvedAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });

      // If resolve delay is enabled, return and wait for the delay
      if (enableResolveDelay && resolveDelayMinutes > 0) {
        logger.debug(
          `IncidentEpisode:AutoResolve - Episode ${episode.id} all incidents resolved, starting resolve delay (${resolveDelayMinutes} minutes)`,
        );
        return;
      }
    }

    // Check if resolve delay has passed (only if enabled)
    if (
      enableResolveDelay &&
      resolveDelayMinutes > 0 &&
      episode.allIncidentsResolvedAt
    ) {
      const timeSinceAllResolved: number = OneUptimeDate.getDifferenceInMinutes(
        episode.allIncidentsResolvedAt,
        OneUptimeDate.getCurrentDate(),
      );

      if (timeSinceAllResolved < resolveDelayMinutes) {
        logger.debug(
          `IncidentEpisode:AutoResolve - Episode ${episode.id} waiting for resolve delay (${resolveDelayMinutes} minutes)`,
        );
        return;
      }
    }

    // Resolve the episode
    logger.info(
      `IncidentEpisode:AutoResolve - Resolving episode ${episode.id} as all incidents are resolved`,
    );

    await IncidentEpisodeService.resolveEpisode(
      episode.id,
      undefined, // No user - auto-resolved by system
      false, // Don't cascade to incidents - they're already resolved
    );
  } catch (error) {
    logger.error(
      `IncidentEpisode:AutoResolve - Error processing episode ${episode.id}: ${error}`,
    );
  }
};
