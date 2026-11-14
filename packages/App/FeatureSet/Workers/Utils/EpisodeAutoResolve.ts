import { forEachKeysetPage, forEachWithConcurrency } from "./BatchedWork";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ResolvedStateUtil from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";

/*
 * EPISODES THAT RESOLVE THEMSELVES ONCE EVERY MEMBER IS RESOLVED.
 *
 * Every minute, each open alert or incident episode is checked: once every
 * alert (incident) in it is resolved - and its grouping rule's resolve
 * delay, if it has one, has passed - the episode is resolved.
 *
 * The jobs used to read "the first 1,000" open episodes every minute - the
 * same 1,000 each time, so past 1,000 the rest never resolved - and start
 * the check of all of them at once, two queries each. Now they go a page at
 * a time in _id order (forEachKeysetPage), every open episode each run; a
 * page costs one query for its rules, one for the states of projects not
 * seen yet this run, and ONE aggregate query that counts each episode's
 * members and how many of them are unresolved. Only the episodes that
 * change are written, a few at a time (forEachWithConcurrency).
 */

export const EPISODE_AUTO_RESOLVE_PAGE_SIZE: number = 200;
export const EPISODE_AUTO_RESOLVE_WRITE_CONCURRENCY: number = 5;

// An open episode, as the check reads it.
export interface AutoResolveEpisode {
  id: ObjectID | null;
  projectId: ObjectID | null;
  groupingRuleId: ObjectID | null;
  // When every member was last found resolved; null while one is not.
  allMembersResolvedAt: Date | null;
}

export interface AutoResolveRule {
  enableResolveDelay: boolean;
  resolveDelayMinutes: number;
}

/*
 * A state of a project's list, as ResolvedStateUtil reads it: an
 * AlertState or an IncidentState, or anything shaped like one.
 */
export interface AutoResolveState {
  id?: ObjectID | null | undefined;
  projectId?: ObjectID | undefined;
  order?: number | undefined;
  isResolvedState?: boolean | undefined;
}

// What the aggregate query says of one episode's members.
export interface EpisodeMemberCounts {
  // Member rows: what "an episode with no alerts" is read from.
  memberCount: number;
  // Members whose record exists and is in a state above the resolved one.
  unresolvedCount: number;
}

/*
 * The tables of one kind of episode, for the aggregate query. Every name is
 * one of the literals below - never anything a caller types - so they are
 * written into the SQL as they are.
 */
export interface EpisodeMemberTables {
  memberTable: "AlertEpisodeMember" | "IncidentEpisodeMember";
  memberEpisodeColumn: "alertEpisodeId" | "incidentEpisodeId";
  memberRecordColumn: "alertId" | "incidentId";
  recordTable: "Alert" | "Incident";
  recordStateColumn: "currentAlertStateId" | "currentIncidentStateId";
  stateTable: "AlertState" | "IncidentState";
}

/*
 * One aggregate query for a page of episodes: for each, how many members it
 * has, and how many of those are records that still exist in a state above
 * their project's resolved state. A record whose state cannot be read
 * counts as order 0, as the check always read it - unresolved. A member
 * whose record is gone counts as a member but not as unresolved, as the
 * check always skipped it.
 */
export function getEpisodeMemberCountsSql(tables: EpisodeMemberTables): string {
  return `SELECT "page"."episodeId"::text AS "episodeId", COUNT("member"."_id")::int AS "memberCount", (COUNT("record"."_id") FILTER (WHERE COALESCE("state"."order", 0) < "page"."resolvedOrder"))::int AS "unresolvedCount" FROM unnest($1::uuid[], $2::int[]) AS "page"("episodeId", "resolvedOrder") JOIN "${tables.memberTable}" AS "member" ON "member"."${tables.memberEpisodeColumn}" = "page"."episodeId" AND "member"."deletedAt" IS NULL AND "member"."${tables.memberRecordColumn}" IS NOT NULL LEFT JOIN "${tables.recordTable}" AS "record" ON "record"."_id" = "member"."${tables.memberRecordColumn}" AND "record"."deletedAt" IS NULL LEFT JOIN "${tables.stateTable}" AS "state" ON "state"."_id" = "record"."${tables.recordStateColumn}" AND "state"."deletedAt" IS NULL GROUP BY "page"."episodeId"`;
}

export interface EpisodeAutoResolveKind {
  jobName: string;
  // The kind's list of states, for its project's resolved state.
  stateList: StateListType.AlertState | StateListType.IncidentState;
  tables: EpisodeMemberTables;
  // A keyset page of open episodes: sorted by _id, after `afterId`.
  readOpenEpisodes: (data: {
    afterId: ObjectID | null;
    limit: number;
  }) => Promise<Array<AutoResolveEpisode>>;
  readRules: (
    ruleIds: Array<ObjectID>,
  ) => Promise<Map<string, AutoResolveRule>>;
  readStates: (projectIds: Array<ObjectID>) => Promise<Array<AutoResolveState>>;
  // Runs a read-only statement (the aggregate query).
  query: (sql: string, params: Array<unknown>) => Promise<Array<unknown>>;
  setAllMembersResolvedAt: (data: {
    episodeId: ObjectID;
    at: Date | null;
  }) => Promise<void>;
  resolveEpisode: (episodeId: ObjectID) => Promise<void>;
}

export interface EpisodeAutoResolveDecision {
  // A new "every member resolved" moment to write: a Date, or null to clear it.
  setAllMembersResolvedAt?: Date | null | undefined;
  resolve: boolean;
}

/*
 * What to do with one episode, as the check has always decided it - kept
 * apart so it can be read, and pinned, without a database.
 */
export function decideEpisodeAutoResolve(data: {
  counts: EpisodeMemberCounts;
  hasResolvedState: boolean;
  allMembersResolvedAt: Date | null;
  rule: AutoResolveRule | null;
  now: Date;
}): EpisodeAutoResolveDecision {
  // An episode with no members is left as it is.
  if (data.counts.memberCount === 0) {
    return { resolve: false };
  }

  // A project with no resolved state has nothing to resolve to.
  if (!data.hasResolvedState) {
    return { resolve: false };
  }

  const delayMinutes: number =
    data.rule?.enableResolveDelay && data.rule.resolveDelayMinutes > 0
      ? data.rule.resolveDelayMinutes
      : 0;

  if (data.counts.unresolvedCount > 0) {
    // A member is open again: the episode is not all resolved any more.
    return data.allMembersResolvedAt
      ? { setAllMembersResolvedAt: null, resolve: false }
      : { resolve: false };
  }

  if (!data.allMembersResolvedAt) {
    // Every member resolved just now: the resolve delay starts here.
    return {
      setAllMembersResolvedAt: data.now,
      resolve: delayMinutes === 0,
    };
  }

  if (
    delayMinutes > 0 &&
    OneUptimeDate.getDifferenceInMinutes(data.allMembersResolvedAt, data.now) <
      delayMinutes
  ) {
    return { resolve: false };
  }

  return { resolve: true };
}

export interface EpisodeAutoResolveResult {
  episodesChecked: number;
  episodesResolved: number;
  pages: number;
  stoppedAtDeadline: boolean;
}

export default async function runEpisodeAutoResolve(data: {
  kind: EpisodeAutoResolveKind;
  deadline?: JobDeadline | undefined;
}): Promise<EpisodeAutoResolveResult> {
  const { kind } = data;

  // Each project's resolved state's order, read once a run; null for none.
  const resolvedOrderByProject: Map<string, number | null> = new Map();

  const result: EpisodeAutoResolveResult = {
    episodesChecked: 0,
    episodesResolved: 0,
    pages: 0,
    stoppedAtDeadline: false,
  };

  const pages: {
    pages: number;
    rows: number;
    stoppedAtDeadline: boolean;
  } = await forEachKeysetPage<AutoResolveEpisode>({
    jobName: kind.jobName,
    pageSize: EPISODE_AUTO_RESOLVE_PAGE_SIZE,
    deadline: data.deadline,
    readPage: (
      afterId: ObjectID | null,
    ): Promise<Array<AutoResolveEpisode>> => {
      return kind.readOpenEpisodes({
        afterId: afterId,
        limit: EPISODE_AUTO_RESOLVE_PAGE_SIZE,
      });
    },
    getId: (episode: AutoResolveEpisode): ObjectID | null => {
      return episode.id;
    },
    onPage: async (page: Array<AutoResolveEpisode>): Promise<void> => {
      const episodes: Array<AutoResolveEpisode> = page.filter(
        (episode: AutoResolveEpisode): boolean => {
          return Boolean(episode.id && episode.projectId);
        },
      );

      if (episodes.length === 0) {
        return;
      }

      await readResolvedOrders({
        kind,
        episodes,
        resolvedOrderByProject,
      });

      const rulesById: Map<string, AutoResolveRule> = await readRulesOfPage(
        kind,
        episodes,
      );

      /*
       * Only an episode of a project with a resolved state can resolve; the
       * others are not counted at all.
       */
      const countable: Array<AutoResolveEpisode> = episodes.filter(
        (episode: AutoResolveEpisode): boolean => {
          return (
            typeof resolvedOrderByProject.get(episode.projectId!.toString()) ===
            "number"
          );
        },
      );

      const countsByEpisode: Map<string, EpisodeMemberCounts> =
        countable.length > 0
          ? await countMembers({
              kind,
              episodes: countable,
              resolvedOrderByProject,
            })
          : new Map();

      const now: Date = OneUptimeDate.getCurrentDate();

      const toWrite: Array<{
        episode: AutoResolveEpisode;
        decision: EpisodeAutoResolveDecision;
      }> = [];

      for (const episode of episodes) {
        const resolvedOrder: number | null | undefined =
          resolvedOrderByProject.get(episode.projectId!.toString());

        const decision: EpisodeAutoResolveDecision = decideEpisodeAutoResolve({
          counts: countsByEpisode.get(episode.id!.toString()) || {
            memberCount: 0,
            unresolvedCount: 0,
          },
          hasResolvedState: typeof resolvedOrder === "number",
          allMembersResolvedAt: episode.allMembersResolvedAt,
          rule: episode.groupingRuleId
            ? rulesById.get(episode.groupingRuleId.toString()) || null
            : null,
          now: now,
        });

        if (
          decision.resolve ||
          decision.setAllMembersResolvedAt !== undefined
        ) {
          toWrite.push({ episode, decision });
        }
      }

      result.episodesChecked += episodes.length;

      await forEachWithConcurrency({
        items: toWrite,
        concurrency: EPISODE_AUTO_RESOLVE_WRITE_CONCURRENCY,
        /*
         * Past the deadline no more episodes are written: each episode's
         * writes are made whole or not at all, and the ones left are still
         * open for the next run.
         */
        deadline: data.deadline,
        work: async (item: {
          episode: AutoResolveEpisode;
          decision: EpisodeAutoResolveDecision;
        }): Promise<void> => {
          if (item.decision.setAllMembersResolvedAt !== undefined) {
            await kind.setAllMembersResolvedAt({
              episodeId: item.episode.id!,
              at: item.decision.setAllMembersResolvedAt,
            });
          }

          if (item.decision.resolve) {
            logger.info(
              `${kind.jobName} - Resolving episode ${item.episode.id} as all its members are resolved`,
            );

            await kind.resolveEpisode(item.episode.id!);
            result.episodesResolved++;
          }
        },
        onError: (
          item: {
            episode: AutoResolveEpisode;
            decision: EpisodeAutoResolveDecision;
          },
          error: unknown,
        ): void => {
          logger.error(
            `${kind.jobName} - Error processing episode ${item.episode.id}: ${error}`,
          );
        },
      });
    },
  });

  result.pages = pages.pages;
  result.stoppedAtDeadline = pages.stoppedAtDeadline;

  return result;
}

// Reads the resolved state of every project of the page not seen yet this run.
async function readResolvedOrders(data: {
  kind: EpisodeAutoResolveKind;
  episodes: Array<AutoResolveEpisode>;
  resolvedOrderByProject: Map<string, number | null>;
}): Promise<void> {
  const unseen: Map<string, ObjectID> = new Map();

  for (const episode of data.episodes) {
    const key: string = episode.projectId!.toString();

    if (!data.resolvedOrderByProject.has(key)) {
      unseen.set(key, episode.projectId!);
    }
  }

  if (unseen.size === 0) {
    return;
  }

  const states: Array<AutoResolveState> = await data.kind.readStates([
    ...unseen.values(),
  ]);

  const statesByProject: Map<string, Array<AutoResolveState>> = new Map();

  for (const state of states) {
    const key: string | undefined = state.projectId?.toString();

    if (!key) {
      continue;
    }

    const projectStates: Array<AutoResolveState> =
      statesByProject.get(key) || [];
    projectStates.push(state);
    statesByProject.set(key, projectStates);
  }

  for (const key of unseen.keys()) {
    /*
     * The first from the top flagged resolved (Common/Utils/ResolvedState).
     * A member at or below it is resolved. No order, as no resolved state:
     * nothing can resolve to it.
     */
    const resolvedState: AutoResolveState | null =
      ResolvedStateUtil.getResolvedState({
        list: data.kind.stateList,
        states: statesByProject.get(key) || [],
      }) as AutoResolveState | null;

    data.resolvedOrderByProject.set(
      key,
      resolvedState && resolvedState.order ? resolvedState.order : null,
    );
  }
}

async function readRulesOfPage(
  kind: EpisodeAutoResolveKind,
  episodes: Array<AutoResolveEpisode>,
): Promise<Map<string, AutoResolveRule>> {
  const ruleIds: Map<string, ObjectID> = new Map();

  for (const episode of episodes) {
    if (episode.groupingRuleId) {
      ruleIds.set(episode.groupingRuleId.toString(), episode.groupingRuleId);
    }
  }

  if (ruleIds.size === 0) {
    return new Map();
  }

  return await kind.readRules([...ruleIds.values()]);
}

async function countMembers(data: {
  kind: EpisodeAutoResolveKind;
  episodes: Array<AutoResolveEpisode>;
  resolvedOrderByProject: Map<string, number | null>;
}): Promise<Map<string, EpisodeMemberCounts>> {
  const rows: Array<unknown> = await data.kind.query(
    getEpisodeMemberCountsSql(data.kind.tables),
    [
      data.episodes.map((episode: AutoResolveEpisode): string => {
        return episode.id!.toString();
      }),
      data.episodes.map((episode: AutoResolveEpisode): number => {
        return data.resolvedOrderByProject.get(episode.projectId!.toString())!;
      }),
    ],
  );

  const countsByEpisode: Map<string, EpisodeMemberCounts> = new Map();

  for (const row of rows as Array<{
    episodeId: string;
    memberCount: number | string;
    unresolvedCount: number | string;
  }>) {
    countsByEpisode.set(String(row.episodeId), {
      memberCount: Number(row.memberCount) || 0,
      unresolvedCount: Number(row.unresolvedCount) || 0,
    });
  }

  return countsByEpisode;
}
