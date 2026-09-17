import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import AlertService from "Common/Server/Services/AlertService";
import logger from "Common/Server/Utils/Logger";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Alert from "Common/Models/DatabaseModels/Alert";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";

RunCron(
  "AlertEpisode:AutoResolve",
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
      const activeEpisodes: Array<AlertEpisode> =
        await AlertEpisodeService.findBy({
          query: {
            resolvedAt: QueryHelper.isNull(),
          },
          select: {
            _id: true,
            projectId: true,
            alertGroupingRuleId: true,
            lastAlertAddedAt: true,
            allAlertsResolvedAt: true,
          },
          props: {
            isRoot: true,
          },
          limit: 1000,
          skip: 0,
        });

      logger.debug(
        `AlertEpisode:AutoResolve - Found ${activeEpisodes.length} active episodes`,
      );

      if (activeEpisodes.length === 0) {
        return;
      }

      /*
       * Episodes cluster by grouping rule and project, so fetch each distinct
       * rule and resolved-state once per tick instead of once per episode.
       */
      const rulesById: Map<string, AlertGroupingRule> =
        await fetchGroupingRules(activeEpisodes);
      const resolvedStateByProjectId: Map<string, AlertState> =
        await fetchResolvedStates(activeEpisodes);

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(
          checkAndResolveEpisode(episode, rulesById, resolvedStateByProjectId),
        );
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`AlertEpisode:AutoResolve - Error: ${error}`);
    }
  },
);

type FetchGroupingRulesFunction = (
  episodes: Array<AlertEpisode>,
) => Promise<Map<string, AlertGroupingRule>>;

const fetchGroupingRules: FetchGroupingRulesFunction = async (
  episodes: Array<AlertEpisode>,
): Promise<Map<string, AlertGroupingRule>> => {
  const rulesById: Map<string, AlertGroupingRule> = new Map();

  const distinctRuleIds: Map<string, ObjectID> = new Map();
  for (const episode of episodes) {
    if (episode.alertGroupingRuleId) {
      distinctRuleIds.set(
        episode.alertGroupingRuleId.toString(),
        episode.alertGroupingRuleId,
      );
    }
  }

  if (distinctRuleIds.size === 0) {
    return rulesById;
  }

  const rules: Array<AlertGroupingRule> = await AlertGroupingRuleService.findBy(
    {
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
    },
  );

  for (const rule of rules) {
    if (rule.id) {
      rulesById.set(rule.id.toString(), rule);
    }
  }

  return rulesById;
};

type FetchResolvedStatesFunction = (
  episodes: Array<AlertEpisode>,
) => Promise<Map<string, AlertState>>;

const fetchResolvedStates: FetchResolvedStatesFunction = async (
  episodes: Array<AlertEpisode>,
): Promise<Map<string, AlertState>> => {
  const resolvedStateByProjectId: Map<string, AlertState> = new Map();

  const distinctProjectIds: Map<string, ObjectID> = new Map();
  for (const episode of episodes) {
    if (episode.projectId) {
      distinctProjectIds.set(episode.projectId.toString(), episode.projectId);
    }
  }

  if (distinctProjectIds.size === 0) {
    return resolvedStateByProjectId;
  }

  const resolvedStates: Array<AlertState> = await AlertStateService.findBy({
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
  episode: AlertEpisode,
  rulesById: Map<string, AlertGroupingRule>,
  resolvedStateByProjectId: Map<string, AlertState>,
) => Promise<void>;

const checkAndResolveEpisode: CheckAndResolveEpisodeFunction = async (
  episode: AlertEpisode,
  rulesById: Map<string, AlertGroupingRule>,
  resolvedStateByProjectId: Map<string, AlertState>,
): Promise<void> => {
  try {
    if (!episode.id || !episode.projectId) {
      return;
    }

    // Get resolve delay from the grouping rule if exists and enabled
    let resolveDelayMinutes: number = 0;
    let enableResolveDelay: boolean = false;

    if (episode.alertGroupingRuleId) {
      const rule: AlertGroupingRule | undefined = rulesById.get(
        episode.alertGroupingRuleId.toString(),
      );

      if (rule) {
        enableResolveDelay = rule.enableResolveDelay || false;
        if (enableResolveDelay && rule.resolveDelayMinutes) {
          resolveDelayMinutes = rule.resolveDelayMinutes;
        }
      }
    }

    // Get all alerts in this episode
    const alertIds: ObjectID[] =
      await AlertEpisodeMemberService.getAlertsInEpisode(episode.id);

    if (alertIds.length === 0) {
      // No alerts in episode, check if it should be resolved due to being empty
      logger.debug(
        `AlertEpisode:AutoResolve - Episode ${episode.id} has no alerts`,
      );
      return;
    }

    // Check if all alerts are resolved
    const resolvedState: AlertState | null =
      resolvedStateByProjectId.get(episode.projectId.toString()) || null;

    if (!resolvedState || !resolvedState.order) {
      logger.debug(
        `AlertEpisode:AutoResolve - No resolved state found for project ${episode.projectId}`,
      );
      return;
    }

    /*
     * Check if all alerts are in resolved state or higher. One batched query
     * for the whole episode; alerts that no longer exist simply don't come
     * back, matching the old per-id skip behavior.
     */
    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        _id: QueryHelper.any(alertIds),
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
      limit: LIMIT_MAX,
      skip: 0,
    });

    let allResolved: boolean = true;

    for (const alert of alerts) {
      const alertOrder: number = alert.currentAlertState?.order || 0;

      if (alertOrder < resolvedState.order) {
        allResolved = false;
        break;
      }
    }

    if (!allResolved) {
      // If any alert is unresolved, clear allAlertsResolvedAt
      if (episode.allAlertsResolvedAt) {
        await AlertEpisodeService.updateOneById({
          id: episode.id,
          data: {
            allAlertsResolvedAt: null,
          },
          props: {
            isRoot: true,
          },
        });
      }

      logger.debug(
        `AlertEpisode:AutoResolve - Episode ${episode.id} has unresolved alerts`,
      );
      return;
    }

    // All alerts are resolved. Set allAlertsResolvedAt if not already set.
    if (!episode.allAlertsResolvedAt) {
      await AlertEpisodeService.updateOneById({
        id: episode.id,
        data: {
          allAlertsResolvedAt: OneUptimeDate.getCurrentDate(),
        },
        props: {
          isRoot: true,
        },
      });

      // If resolve delay is enabled, return and wait for the delay
      if (enableResolveDelay && resolveDelayMinutes > 0) {
        logger.debug(
          `AlertEpisode:AutoResolve - Episode ${episode.id} all alerts resolved, starting resolve delay (${resolveDelayMinutes} minutes)`,
        );
        return;
      }
    }

    // Check if resolve delay has passed (only if enabled)
    if (
      enableResolveDelay &&
      resolveDelayMinutes > 0 &&
      episode.allAlertsResolvedAt
    ) {
      const timeSinceAllResolved: number = OneUptimeDate.getDifferenceInMinutes(
        episode.allAlertsResolvedAt,
        OneUptimeDate.getCurrentDate(),
      );

      if (timeSinceAllResolved < resolveDelayMinutes) {
        logger.debug(
          `AlertEpisode:AutoResolve - Episode ${episode.id} waiting for resolve delay (${resolveDelayMinutes} minutes)`,
        );
        return;
      }
    }

    // Resolve the episode
    logger.info(
      `AlertEpisode:AutoResolve - Resolving episode ${episode.id} as all alerts are resolved`,
    );

    await AlertEpisodeService.resolveEpisode(
      episode.id,
      undefined, // No user - auto-resolved by system
      false, // Don't cascade to alerts - they're already resolved
    );
  } catch (error) {
    logger.error(
      `AlertEpisode:AutoResolve - Error processing episode ${episode.id}: ${error}`,
    );
  }
};
