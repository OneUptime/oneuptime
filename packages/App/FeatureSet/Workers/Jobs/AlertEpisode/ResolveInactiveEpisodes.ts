import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import logger from "Common/Server/Utils/Logger";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";

RunCron(
  "AlertEpisode:ResolveInactiveEpisodes",
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
  },
  async () => {
    /*
     * Find active episodes that have been inactive for too long
     * and resolve them due to inactivity
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
          },
          props: {
            isRoot: true,
          },
          limit: 1000,
          skip: 0,
        });

      logger.debug(
        `AlertEpisode:ResolveInactiveEpisodes - Found ${activeEpisodes.length} active episodes`,
      );

      if (activeEpisodes.length === 0) {
        return;
      }

      /*
       * Episodes cluster by grouping rule, so fetch each distinct rule once
       * per tick instead of once per episode.
       */
      const rulesById: Map<string, AlertGroupingRule> =
        await fetchGroupingRules(activeEpisodes);

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(checkAndResolveInactiveEpisode(episode, rulesById));
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`AlertEpisode:ResolveInactiveEpisodes - Error: ${error}`);
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
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: true,
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

type CheckAndResolveInactiveEpisodeFunction = (
  episode: AlertEpisode,
  rulesById: Map<string, AlertGroupingRule>,
) => Promise<void>;

const checkAndResolveInactiveEpisode: CheckAndResolveInactiveEpisodeFunction =
  async (
    episode: AlertEpisode,
    rulesById: Map<string, AlertGroupingRule>,
  ): Promise<void> => {
    try {
      if (!episode.id || !episode.projectId) {
        return;
      }

      // Get inactivity timeout from the grouping rule (only if enabled)
      let inactivityTimeoutMinutes: number = 0;
      let enableInactivityTimeout: boolean = false;

      if (episode.alertGroupingRuleId) {
        const rule: AlertGroupingRule | undefined = rulesById.get(
          episode.alertGroupingRuleId.toString(),
        );

        if (rule) {
          enableInactivityTimeout = rule.enableInactivityTimeout || false;
          if (
            enableInactivityTimeout &&
            rule.inactivityTimeoutMinutes !== undefined
          ) {
            inactivityTimeoutMinutes = rule.inactivityTimeoutMinutes;
          }
        }
      }

      // If inactivity timeout is not enabled or is 0, don't resolve inactive episodes
      if (!enableInactivityTimeout || inactivityTimeoutMinutes <= 0) {
        return;
      }

      // Check if episode has been inactive for too long
      const lastAlertAddedAt: Date =
        episode.lastAlertAddedAt || episode.createdAt || new Date();
      const minutesSinceLastAlert: number =
        OneUptimeDate.getDifferenceInMinutes(
          lastAlertAddedAt,
          OneUptimeDate.getCurrentDate(),
        );

      if (minutesSinceLastAlert < inactivityTimeoutMinutes) {
        logger.debug(
          `AlertEpisode:ResolveInactiveEpisodes - Episode ${episode.id} is still active (${minutesSinceLastAlert} minutes since last alert, timeout: ${inactivityTimeoutMinutes})`,
        );
        return;
      }

      // Episode has been inactive for too long - resolve it
      logger.info(
        `AlertEpisode:ResolveInactiveEpisodes - Resolving episode ${episode.id} due to inactivity (${minutesSinceLastAlert} minutes since last alert)`,
      );

      await AlertEpisodeService.resolveEpisode(
        episode.id,
        undefined, // No user - auto-resolved due to inactivity
        true, // Cascade to alerts - resolve all member alerts as well
      );
    } catch (error) {
      logger.error(
        `AlertEpisode:ResolveInactiveEpisodes - Error processing episode ${episode.id}: ${error}`,
      );
    }
  };
