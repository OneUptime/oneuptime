import RunCron from "../../Utils/Cron";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncidentService from "Common/Server/Services/IncidentService";
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
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
            lastIncidentAddedAt: true,
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
          updatedAt: true,
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
      logger.debug(
        `IncidentEpisode:AutoResolve - Episode ${episode.id} has unresolved incidents`,
      );
      return;
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
