import RunCron from "../../Utils/Cron";
import runEpisodeAutoResolve, {
  AutoResolveEpisode,
  AutoResolveRule,
  AutoResolveState,
  EpisodeAutoResolveKind,
  EpisodeAutoResolveResult,
} from "../../Utils/EpisodeAutoResolve";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertStateService from "Common/Server/Services/AlertStateService";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * Open alert episodes resolve themselves once every alert in them is
 * resolved, after their grouping rule's resolve delay (EpisodeAutoResolve,
 * which IncidentEpisode:AutoResolve shares). Every open episode, a page at
 * a time.
 */
export const ALERT_EPISODE_AUTO_RESOLVE: EpisodeAutoResolveKind = {
  jobName: "AlertEpisode:AutoResolve",
  stateList: StateListType.AlertState,
  tables: {
    memberTable: "AlertEpisodeMember",
    memberEpisodeColumn: "alertEpisodeId",
    memberRecordColumn: "alertId",
    recordTable: "Alert",
    recordStateColumn: "currentAlertStateId",
    stateTable: "AlertState",
  },
  readOpenEpisodes: async (data: {
    afterId: ObjectID | null;
    limit: number;
  }): Promise<Array<AutoResolveEpisode>> => {
    const episodes: Array<AlertEpisode> = await AlertEpisodeService.findBy({
      query: {
        resolvedAt: QueryHelper.isNull(),
        ...(data.afterId ? { _id: QueryHelper.greaterThan(data.afterId) } : {}),
      },
      select: {
        _id: true,
        projectId: true,
        alertGroupingRuleId: true,
        allAlertsResolvedAt: true,
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

    return episodes.map((episode: AlertEpisode): AutoResolveEpisode => {
      return {
        id: episode.id || null,
        projectId: episode.projectId || null,
        groupingRuleId: episode.alertGroupingRuleId || null,
        allMembersResolvedAt: episode.allAlertsResolvedAt || null,
      };
    });
  },
  readRules: async (
    ruleIds: Array<ObjectID>,
  ): Promise<Map<string, AutoResolveRule>> => {
    const rules: Array<AlertGroupingRule> =
      await AlertGroupingRuleService.findBy({
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
    return (await AlertStateService.findBy({
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
    })) as Array<AlertState> as Array<AutoResolveState>;
  },
  query: async (
    sql: string,
    params: Array<unknown>,
  ): Promise<Array<unknown>> => {
    return await AlertEpisodeMemberService.getRepository().manager.query(
      sql,
      params,
    );
  },
  setAllMembersResolvedAt: async (data: {
    episodeId: ObjectID;
    at: Date | null;
  }): Promise<void> => {
    await AlertEpisodeService.updateOneById({
      id: data.episodeId,
      data: {
        allAlertsResolvedAt: data.at,
      },
      props: {
        isRoot: true,
      },
    });
  },
  resolveEpisode: async (episodeId: ObjectID): Promise<void> => {
    await AlertEpisodeService.resolveEpisode(
      episodeId,
      undefined, // No user - auto-resolved by system
      false, // Don't cascade to alerts - they're already resolved
    );
  },
};

RunCron(
  "AlertEpisode:AutoResolve",
  {
    schedule: EVERY_MINUTE,
    runOnStartup: false,
  },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    try {
      const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
        kind: ALERT_EPISODE_AUTO_RESOLVE,
        deadline: deadline,
      });

      logger.debug(
        `AlertEpisode:AutoResolve - Checked ${result.episodesChecked} open episodes in ${result.pages} pages, resolved ${result.episodesResolved}${
          result.stoppedAtDeadline ? ", stopped at the job's deadline" : ""
        }`,
      );
    } catch (error) {
      logger.error(`AlertEpisode:AutoResolve - Error: ${error}`);
    }
  },
);
