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

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(checkAndResolveEpisode(episode));
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`AlertEpisode:AutoResolve - Error: ${error}`);
    }
  },
);

type CheckAndResolveEpisodeFunction = (episode: AlertEpisode) => Promise<void>;

const checkAndResolveEpisode: CheckAndResolveEpisodeFunction = async (
  episode: AlertEpisode,
): Promise<void> => {
  try {
    if (!episode.id || !episode.projectId) {
      return;
    }

    // Get resolve delay from the grouping rule if exists
    let resolveDelayMinutes: number = 0;

    if (episode.alertGroupingRuleId) {
      const rule: AlertGroupingRule | null =
        await AlertGroupingRuleService.findOneById({
          id: episode.alertGroupingRuleId,
          select: {
            resolveDelayMinutes: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (rule && rule.resolveDelayMinutes) {
        resolveDelayMinutes = rule.resolveDelayMinutes;
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
    const resolvedState: AlertState | null = await AlertStateService.findOneBy({
      query: {
        projectId: episode.projectId,
        isResolvedState: true,
      },
      select: {
        _id: true,
        order: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!resolvedState || !resolvedState.order) {
      logger.debug(
        `AlertEpisode:AutoResolve - No resolved state found for project ${episode.projectId}`,
      );
      return;
    }

    // Check if all alerts are in resolved state or higher
    let allResolved: boolean = true;
    let lastResolvedAt: Date | null = null;

    for (const alertId of alertIds) {
      const alert: Alert | null = await AlertService.findOneById({
        id: alertId,
        select: {
          currentAlertState: {
            order: true,
          },
          updatedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!alert) {
        continue;
      }

      const alertOrder: number = alert.currentAlertState?.order || 0;

      if (alertOrder < resolvedState.order) {
        allResolved = false;
        break;
      }

      // Track the latest resolved time among alerts
      if (alert.updatedAt) {
        if (!lastResolvedAt || alert.updatedAt > lastResolvedAt) {
          lastResolvedAt = alert.updatedAt;
        }
      }
    }

    if (!allResolved) {
      logger.debug(
        `AlertEpisode:AutoResolve - Episode ${episode.id} has unresolved alerts`,
      );
      return;
    }

    // All alerts are resolved. Check if resolve delay has passed
    if (resolveDelayMinutes > 0 && lastResolvedAt) {
      const timeSinceLastResolved: number =
        OneUptimeDate.getDifferenceInMinutes(
          lastResolvedAt,
          OneUptimeDate.getCurrentDate(),
        );

      if (timeSinceLastResolved < resolveDelayMinutes) {
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
      undefined as any, // No user - auto-resolved
      false, // Don't cascade to alerts - they're already resolved
    );
  } catch (error) {
    logger.error(
      `AlertEpisode:AutoResolve - Error processing episode ${episode.id}: ${error}`,
    );
  }
};
