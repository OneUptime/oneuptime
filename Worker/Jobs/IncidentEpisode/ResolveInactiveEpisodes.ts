import RunCron from "../../Utils/Cron";
import OneUptimeDate from "Common/Types/Date";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentGroupingRuleService from "Common/Server/Services/IncidentGroupingRuleService";
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "Common/Models/DatabaseModels/IncidentGroupingRule";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";

RunCron(
  "IncidentEpisode:ResolveInactiveEpisodes",
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
          },
          props: {
            isRoot: true,
          },
          limit: 1000,
          skip: 0,
        });

      logger.debug(
        `IncidentEpisode:ResolveInactiveEpisodes - Found ${activeEpisodes.length} active episodes`,
      );

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(checkAndResolveInactiveEpisode(episode));
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`IncidentEpisode:ResolveInactiveEpisodes - Error: ${error}`);
    }
  },
);

type CheckAndResolveInactiveEpisodeFunction = (
  episode: IncidentEpisode,
) => Promise<void>;

const checkAndResolveInactiveEpisode: CheckAndResolveInactiveEpisodeFunction =
  async (episode: IncidentEpisode): Promise<void> => {
    try {
      if (!episode.id || !episode.projectId) {
        return;
      }

      // Get inactivity timeout from the grouping rule (only if enabled)
      let inactivityTimeoutMinutes: number = 0;
      let enableInactivityTimeout: boolean = false;

      if (episode.incidentGroupingRuleId) {
        const rule: IncidentGroupingRule | null =
          await IncidentGroupingRuleService.findOneById({
            id: episode.incidentGroupingRuleId,
            select: {
              enableInactivityTimeout: true,
              inactivityTimeoutMinutes: true,
            },
            props: {
              isRoot: true,
            },
          });

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
      const lastIncidentAddedAt: Date =
        episode.lastIncidentAddedAt || episode.createdAt || new Date();
      const minutesSinceLastIncident: number =
        OneUptimeDate.getDifferenceInMinutes(
          lastIncidentAddedAt,
          OneUptimeDate.getCurrentDate(),
        );

      if (minutesSinceLastIncident < inactivityTimeoutMinutes) {
        logger.debug(
          `IncidentEpisode:ResolveInactiveEpisodes - Episode ${episode.id} is still active (${minutesSinceLastIncident} minutes since last incident, timeout: ${inactivityTimeoutMinutes})`,
        );
        return;
      }

      // Episode has been inactive for too long - resolve it
      logger.info(
        `IncidentEpisode:ResolveInactiveEpisodes - Resolving episode ${episode.id} due to inactivity (${minutesSinceLastIncident} minutes since last incident)`,
      );

      await IncidentEpisodeService.resolveEpisode(
        episode.id,
        undefined, // No user - auto-resolved due to inactivity
        true, // Cascade to incidents - resolve all member incidents as well
      );
    } catch (error) {
      logger.error(
        `IncidentEpisode:ResolveInactiveEpisodes - Error processing episode ${episode.id}: ${error}`,
      );
    }
  };
