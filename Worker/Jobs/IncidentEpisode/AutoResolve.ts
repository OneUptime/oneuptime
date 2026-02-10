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

      const promises: Array<Promise<void>> = [];

      for (const episode of activeEpisodes) {
        promises.push(checkAndResolveEpisode(episode));
      }

      await Promise.allSettled(promises);
    } catch (error) {
      logger.error(`IncidentEpisode:AutoResolve - Error: ${error}`);
    }
  },
);

type CheckAndResolveEpisodeFunction = (
  episode: IncidentEpisode,
) => Promise<void>;

const checkAndResolveEpisode: CheckAndResolveEpisodeFunction = async (
  episode: IncidentEpisode,
): Promise<void> => {
  try {
    if (!episode.id || !episode.projectId) {
      return;
    }

    // Get resolve delay from the grouping rule if exists and enabled
    let resolveDelayMinutes: number = 0;
    let enableResolveDelay: boolean = false;

    if (episode.incidentGroupingRuleId) {
      const rule: IncidentGroupingRule | null =
        await IncidentGroupingRuleService.findOneById({
          id: episode.incidentGroupingRuleId,
          select: {
            enableResolveDelay: true,
            resolveDelayMinutes: true,
          },
          props: {
            isRoot: true,
          },
        });

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
      await IncidentStateService.findOneBy({
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
        `IncidentEpisode:AutoResolve - No resolved state found for project ${episode.projectId}`,
      );
      return;
    }

    // Check if all incidents are in resolved state or higher
    let allResolved: boolean = true;

    for (const incidentId of incidentIds) {
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        select: {
          currentIncidentState: {
            order: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      if (!incident) {
        continue;
      }

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
