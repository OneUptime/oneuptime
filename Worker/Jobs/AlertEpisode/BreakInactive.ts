import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import logger from "Common/Server/Utils/Logger";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

RunCron(
  "AlertEpisode:BreakInactive",
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
        `AlertEpisode:BreakInactive - Found ${activeEpisodes.length} active episodes`,
      );

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(checkAndBreakInactiveEpisode(episode));
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`AlertEpisode:BreakInactive - Error: ${error}`);
    }
  },
);

type CheckAndBreakInactiveEpisodeFunction = (
  episode: AlertEpisode,
) => Promise<void>;

const checkAndBreakInactiveEpisode: CheckAndBreakInactiveEpisodeFunction =
  async (episode: AlertEpisode): Promise<void> => {
    try {
      if (!episode.id || !episode.projectId) {
        return;
      }

      // Get inactivity timeout from the grouping rule
      let inactivityTimeoutMinutes: number = 60; // Default: 1 hour

      if (episode.alertGroupingRuleId) {
        const rule: AlertGroupingRule | null =
          await AlertGroupingRuleService.findOneById({
            id: episode.alertGroupingRuleId,
            select: {
              inactivityTimeoutMinutes: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (rule && rule.inactivityTimeoutMinutes !== undefined) {
          inactivityTimeoutMinutes = rule.inactivityTimeoutMinutes;
        }
      }

      // If inactivity timeout is 0, don't break inactive episodes
      if (inactivityTimeoutMinutes <= 0) {
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
          `AlertEpisode:BreakInactive - Episode ${episode.id} is still active (${minutesSinceLastAlert} minutes since last alert, timeout: ${inactivityTimeoutMinutes})`,
        );
        return;
      }

      // Episode has been inactive for too long - resolve it
      logger.info(
        `AlertEpisode:BreakInactive - Resolving episode ${episode.id} due to inactivity (${minutesSinceLastAlert} minutes since last alert)`,
      );

      await AlertEpisodeService.resolveEpisode(
        episode.id,
        undefined as any, // No user - auto-resolved due to inactivity
        true, // Cascade to alerts - resolve all member alerts as well
      );
    } catch (error) {
      logger.error(
        `AlertEpisode:BreakInactive - Error processing episode ${episode.id}: ${error}`,
      );
    }
  };
