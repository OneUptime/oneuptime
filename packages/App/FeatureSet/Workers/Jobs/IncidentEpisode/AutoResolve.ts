import RunCron from "../../Utils/Cron";
import runEpisodeAutoResolve, {
  AutoResolveEpisode,
  AutoResolveRule,
  AutoResolveState,
  EpisodeAutoResolveKind,
  EpisodeAutoResolveResult,
} from "../../Utils/EpisodeAutoResolve";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import IncidentGroupingRuleService from "Common/Server/Services/IncidentGroupingRuleService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "Common/Models/DatabaseModels/IncidentGroupingRule";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * Open incident episodes resolve themselves once every incident in them is
 * resolved, after their grouping rule's resolve delay (EpisodeAutoResolve,
 * which AlertEpisode:AutoResolve shares). Every open episode, a page at
 * a time.
 */
export const INCIDENT_EPISODE_AUTO_RESOLVE: EpisodeAutoResolveKind = {
  jobName: "IncidentEpisode:AutoResolve",
  stateList: StateListType.IncidentState,
  tables: {
    memberTable: "IncidentEpisodeMember",
    memberEpisodeColumn: "incidentEpisodeId",
    memberRecordColumn: "incidentId",
    recordTable: "Incident",
    recordStateColumn: "currentIncidentStateId",
    stateTable: "IncidentState",
  },
  readOpenEpisodes: async (data: {
    afterId: ObjectID | null;
    limit: number;
  }): Promise<Array<AutoResolveEpisode>> => {
    const episodes: Array<IncidentEpisode> = await IncidentEpisodeService.findBy({
      query: {
        resolvedAt: QueryHelper.isNull(),
        ...(data.afterId ? { _id: QueryHelper.greaterThan(data.afterId) } : {}),
      },
      select: {
        _id: true,
        projectId: true,
        incidentGroupingRuleId: true,
        allIncidentsResolvedAt: true,
      },
      sort: {
        _id: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
      limit: data.limit,
      skip: 0,
    });

    return episodes.map((episode: IncidentEpisode): AutoResolveEpisode => {
      return {
        id: episode.id || null,
        projectId: episode.projectId || null,
        groupingRuleId: episode.incidentGroupingRuleId || null,
        allMembersResolvedAt: episode.allIncidentsResolvedAt || null,
      };
    });
  },
  readRules: async (
    ruleIds: Array<ObjectID>,
  ): Promise<Map<string, AutoResolveRule>> => {
    const rules: Array<IncidentGroupingRule> =
      await IncidentGroupingRuleService.findBy({
        query: {
          _id: QueryHelper.any(ruleIds),
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

    const rulesById: Map<string, AutoResolveRule> = new Map();

    for (const rule of rules) {
      if (rule.id) {
        rulesById.set(rule.id.toString(), {
          enableResolveDelay: rule.enableResolveDelay || false,
          resolveDelayMinutes: rule.resolveDelayMinutes || 0,
        });
      }
    }

    return rulesById;
  },
  readStates: async (
    projectIds: Array<ObjectID>,
  ): Promise<Array<AutoResolveState>> => {
    return (await IncidentStateService.findBy({
      query: {
        projectId: QueryHelper.any(projectIds),
      },
      select: {
        _id: true,
        order: true,
        projectId: true,
        isResolvedState: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    })) as Array<IncidentState> as Array<AutoResolveState>;
  },
  query: async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<unknown>> => {
    return await IncidentEpisodeMemberService.getRepository().manager.query(
      sql,
      params,
    );
  },
  setAllMembersResolvedAt: async (data: {
    episodeId: ObjectID;
    at: Date | null;
  }): Promise<void> => {
    await IncidentEpisodeService.updateOneById({
      id: data.episodeId,
      data: {
        allIncidentsResolvedAt: data.at,
      },
      props: {
        isRoot: true,
      },
    });
  },
  resolveEpisode: async (episodeId: ObjectID): Promise<void> => {
    await IncidentEpisodeService.resolveEpisode(
      episodeId,
      undefined, // No user - auto-resolved by system
      false, // Don't cascade to incidents - they're already resolved
    );
  },
};

RunCron(
  "IncidentEpisode:AutoResolve",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
        kind: INCIDENT_EPISODE_AUTO_RESOLVE,
        deadline: deadline,
      });

      logger.debug(
        `IncidentEpisode:AutoResolve - Checked ${result.episodesChecked} open episodes in ${result.pages} pages, resolved ${result.episodesResolved}${
          result.stoppedAtDeadline ? ", stopped at the job's deadline" : ""
        }`,
      );
    } catch (error) {
      logger.error(`IncidentEpisode:AutoResolve - Error: ${error}`);
    }
  },
);
