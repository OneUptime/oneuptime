import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * EPISODES THAT RESOLVE THEMSELVES (EpisodeAutoResolve), the engine both
 * AlertEpisode:AutoResolve and IncidentEpisode:AutoResolve run.
 *
 * The jobs used to read "the first 1,000" open episodes every minute - the
 * same ones each time, so past 1,000 the rest never resolved - and start
 * two queries for every one of them at once. These pin, against an
 * in-memory database that answers the aggregate query the way Postgres
 * does (EpisodeAutoResolvePostgres.test.ts runs the SQL itself):
 *
 *   1. every open episode is checked each run, a keyset page at a time,
 *      past 1,000;
 *   2. a page costs one rules read, one states read for projects not seen
 *      yet, and ONE aggregate query - never a read per episode;
 *   3. never more than EPISODE_AUTO_RESOLVE_WRITE_CONCURRENCY writes at once,
 *      and one episode's failure never stops the rest;
 *   4. it stops between pages at its deadline;
 *   5. the decision is the one the job always made (decideEpisodeAutoResolve).
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import JobDeadline from "Common/Server/Utils/JobDeadline";
import logger from "Common/Server/Utils/Logger";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { StateListType } from "Common/Utils/StateOrder";
import runEpisodeAutoResolve, {
  AutoResolveEpisode,
  AutoResolveRule,
  AutoResolveState,
  EPISODE_AUTO_RESOLVE_PAGE_SIZE,
  EPISODE_AUTO_RESOLVE_WRITE_CONCURRENCY,
  EpisodeAutoResolveKind,
  EpisodeAutoResolveResult,
  decideEpisodeAutoResolve,
  getEpisodeMemberCountsSql,
} from "../../../FeatureSet/Workers/Utils/EpisodeAutoResolve";

const NOW: Date = new Date("2026-11-14T10:00:00.000Z");
const RESOLVED_ORDER: number = 3;

function id(prefix: string, index: number): ObjectID {
  return new ObjectID(
    `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

interface FakeEpisode {
  id: ObjectID;
  projectId: ObjectID;
  groupingRuleId: ObjectID | null;
  allMembersResolvedAt: Date | null;
  resolvedAt: Date | null;
}

interface FakeMember {
  episodeId: string;
  recordId: string | null;
  deleted?: boolean;
}

interface FakeRecord {
  id: string;
  stateId: string | null;
  deleted?: boolean;
}

interface FakeState {
  id: string;
  projectId: string;
  order: number;
  isResolvedState: boolean;
  deleted?: boolean;
}

// What the in-memory database holds, and what it was asked.
class FakeDatabase {
  public episodes: Array<FakeEpisode> = [];
  public members: Array<FakeMember> = [];
  public records: Map<string, FakeRecord> = new Map();
  public states: Array<FakeState> = [];
  public rules: Map<string, AutoResolveRule> = new Map();

  public episodeReads: Array<{ afterId: string | null; limit: number }> = [];
  public ruleReads: Array<Array<string>> = [];
  public stateReads: Array<Array<string>> = [];
  public aggregateQueries: Array<{ sql: string; params: Array<unknown> }> =
    [];
  public stamps: Array<{ episodeId: string; at: Date | null }> = [];
  public resolved: Array<string> = [];

  public writesInFlight: number = 0;
  public mostWritesInFlight: number = 0;
  public writeDelay: (() => Promise<void>) | null = null;
  public failResolveOf: Set<string> = new Set();

  /*
   * A project's states: created, acknowledged, resolved (order 3) and one
   * placed after it (order 4), which counts as resolved too.
   */
  public addProject(projectId: ObjectID): void {
    for (const [order, isResolvedState] of [
      [1, false],
      [2, false],
      [RESOLVED_ORDER, true],
      [RESOLVED_ORDER + 1, false],
    ] as Array<[number, boolean]>) {
      this.states.push({
        id: `${projectId.toString()}-state-${order}`,
        projectId: projectId.toString(),
        order,
        isResolvedState,
      });
    }
  }

  public stateIdOf(projectId: ObjectID, order: number): string {
    return `${projectId.toString()}-state-${order}`;
  }

  // An open episode whose members are in the given state orders.
  public addEpisode(data: {
    id: ObjectID;
    projectId: ObjectID;
    memberOrders: Array<number>;
    groupingRuleId?: ObjectID | null;
    allMembersResolvedAt?: Date | null;
  }): void {
    this.episodes.push({
      id: data.id,
      projectId: data.projectId,
      groupingRuleId: data.groupingRuleId || null,
      allMembersResolvedAt: data.allMembersResolvedAt || null,
      resolvedAt: null,
    });

    data.memberOrders.forEach((order: number, index: number) => {
      const recordId: string = `${data.id.toString()}-record-${index}`;
      this.members.push({ episodeId: data.id.toString(), recordId });
      this.records.set(recordId, {
        id: recordId,
        stateId: this.stateIdOf(data.projectId, order),
      });
    });
  }

  private async write(work: () => void): Promise<void> {
    this.writesInFlight++;
    this.mostWritesInFlight = Math.max(
      this.mostWritesInFlight,
      this.writesInFlight,
    );

    try {
      if (this.writeDelay) {
        await this.writeDelay();
      }
      work();
    } finally {
      this.writesInFlight--;
    }
  }

  public kind(): EpisodeAutoResolveKind {
    return {
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
        this.episodeReads.push({
          afterId: data.afterId ? data.afterId.toString() : null,
          limit: data.limit,
        });

        return this.episodes
          .filter((episode: FakeEpisode) => {
            return (
              !episode.resolvedAt &&
              (!data.afterId ||
                episode.id.toString() > data.afterId.toString())
            );
          })
          .sort((a: FakeEpisode, b: FakeEpisode) => {
            return a.id.toString() < b.id.toString() ? -1 : 1;
          })
          .slice(0, data.limit)
          .map((episode: FakeEpisode): AutoResolveEpisode => {
            return {
              id: episode.id,
              projectId: episode.projectId,
              groupingRuleId: episode.groupingRuleId,
              allMembersResolvedAt: episode.allMembersResolvedAt,
            };
          });
      },
      readRules: async (
        ruleIds: Array<ObjectID>,
      ): Promise<Map<string, AutoResolveRule>> => {
        this.ruleReads.push(
          ruleIds.map((ruleId: ObjectID) => {
            return ruleId.toString();
          }),
        );

        const found: Map<string, AutoResolveRule> = new Map();
        for (const ruleId of ruleIds) {
          const rule: AutoResolveRule | undefined = this.rules.get(
            ruleId.toString(),
          );
          if (rule) {
            found.set(ruleId.toString(), rule);
          }
        }
        return found;
      },
      readStates: async (
        projectIds: Array<ObjectID>,
      ): Promise<Array<AutoResolveState>> => {
        const wanted: Array<string> = projectIds.map((projectId: ObjectID) => {
          return projectId.toString();
        });
        this.stateReads.push(wanted);

        return this.states
          .filter((state: FakeState) => {
            return !state.deleted && wanted.includes(state.projectId);
          })
          .map((state: FakeState): AutoResolveState => {
            return {
              _id: new ObjectID(state.id),
              projectId: new ObjectID(state.projectId),
              order: state.order,
              isResolvedState: state.isResolvedState,
            };
          });
      },
      // The aggregate query, answered as getEpisodeMemberCountsSql answers it.
      query: async (
        sql: string,
        params: Array<unknown>,
      ): Promise<Array<unknown>> => {
        this.aggregateQueries.push({ sql, params });

        const episodeIds: Array<string> = params[0] as Array<string>;
        const resolvedOrders: Array<number> = params[1] as Array<number>;
        const rows: Array<unknown> = [];

        episodeIds.forEach((episodeId: string, index: number) => {
          const members: Array<FakeMember> = this.members.filter(
            (member: FakeMember) => {
              return (
                member.episodeId === episodeId &&
                !member.deleted &&
                member.recordId !== null
              );
            },
          );

          if (members.length === 0) {
            return; // An inner join: no row for an episode with no members.
          }

          let unresolvedCount: number = 0;

          for (const member of members) {
            const record: FakeRecord | undefined = this.records.get(
              member.recordId!,
            );

            if (!record || record.deleted) {
              continue;
            }

            const state: FakeState | undefined = this.states.find(
              (candidate: FakeState) => {
                return candidate.id === record.stateId && !candidate.deleted;
              },
            );

            if ((state?.order || 0) < resolvedOrders[index]!) {
              unresolvedCount++;
            }
          }

          rows.push({
            episodeId,
            memberCount: members.length,
            unresolvedCount,
          });
        });

        return rows;
      },
      setAllMembersResolvedAt: async (data: {
        episodeId: ObjectID;
        at: Date | null;
      }): Promise<void> => {
        await this.write(() => {
          this.stamps.push({ episodeId: data.episodeId.toString(), at: data.at });
          const episode: FakeEpisode | undefined = this.episodes.find(
            (candidate: FakeEpisode) => {
              return candidate.id.toString() === data.episodeId.toString();
            },
          );
          episode!.allMembersResolvedAt = data.at;
        });
      },
      resolveEpisode: async (episodeId: ObjectID): Promise<void> => {
        await this.write(() => {
          if (this.failResolveOf.has(episodeId.toString())) {
            throw new Error(`could not resolve ${episodeId.toString()}`);
          }

          this.resolved.push(episodeId.toString());
          const episode: FakeEpisode | undefined = this.episodes.find(
            (candidate: FakeEpisode) => {
              return candidate.id.toString() === episodeId.toString();
            },
          );
          episode!.resolvedAt = NOW;
        });
      },
    };
  }
}

let db: FakeDatabase;

beforeEach(() => {
  db = new FakeDatabase();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("every open episode, a page at a time", () => {
  test("checks and resolves every open episode in one run, far past the first 1,000", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    for (let index: number = 0; index < 2345; index++) {
      db.addEpisode({
        id: id("eeeeeeee", index),
        projectId: project,
        memberOrders: [RESOLVED_ORDER, RESOLVED_ORDER],
      });
    }

    const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
      kind: db.kind(),
    });

    expect(result.episodesChecked).toBe(2345);
    expect(result.episodesResolved).toBe(2345);
    expect(db.resolved).toHaveLength(2345);
    // The 1,001st and the last: never reached when the job read "the first 1,000".
    expect(db.resolved).toContain(id("eeeeeeee", 1000).toString());
    expect(db.resolved).toContain(id("eeeeeeee", 2344).toString());

    const expectedPages: number = Math.ceil(
      2345 / EPISODE_AUTO_RESOLVE_PAGE_SIZE,
    );
    expect(result.pages).toBe(expectedPages);
    expect(db.episodeReads).toHaveLength(expectedPages);
  });

  test("reads each page after the last episode of the one before, in _id order", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    for (let index: number = 0; index < EPISODE_AUTO_RESOLVE_PAGE_SIZE * 2 + 5; index++) {
      // Members still open: nothing resolves, so every page is read as it was.
      db.addEpisode({
        id: id("eeeeeeee", index),
        projectId: project,
        memberOrders: [1],
      });
    }

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.episodeReads).toEqual([
      { afterId: null, limit: EPISODE_AUTO_RESOLVE_PAGE_SIZE },
      {
        afterId: id("eeeeeeee", EPISODE_AUTO_RESOLVE_PAGE_SIZE - 1).toString(),
        limit: EPISODE_AUTO_RESOLVE_PAGE_SIZE,
      },
      {
        afterId: id(
          "eeeeeeee",
          EPISODE_AUTO_RESOLVE_PAGE_SIZE * 2 - 1,
        ).toString(),
        limit: EPISODE_AUTO_RESOLVE_PAGE_SIZE,
      },
    ]);
  });

  test("a page costs one aggregate query, one rules read and the states of projects not seen yet - never a read per episode", async () => {
    const projects: Array<ObjectID> = [id("aaaaaaaa", 1), id("aaaaaaaa", 2)];
    const rule: ObjectID = id("rrrrrrrr", 1);
    projects.forEach((project: ObjectID) => {
      db.addProject(project);
    });
    db.rules.set(rule.toString(), {
      enableResolveDelay: true,
      resolveDelayMinutes: 10,
    });

    for (let index: number = 0; index < EPISODE_AUTO_RESOLVE_PAGE_SIZE * 3; index++) {
      db.addEpisode({
        id: id("eeeeeeee", index),
        projectId: projects[index % 2]!,
        groupingRuleId: index % 3 === 0 ? rule : null,
        memberOrders: [1, RESOLVED_ORDER],
      });
    }

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.aggregateQueries).toHaveLength(3);
    expect(db.ruleReads).toEqual([
      [rule.toString()],
      [rule.toString()],
      [rule.toString()],
    ]);
    // Both projects' states, read once for the whole run.
    expect(db.stateReads).toHaveLength(1);
    expect(db.stateReads[0]!.sort()).toEqual(
      projects
        .map((project: ObjectID) => {
          return project.toString();
        })
        .sort(),
    );

    // Each aggregate query covers its page: ids and resolved orders aligned.
    for (const query of db.aggregateQueries) {
      const ids: Array<string> = query.params[0] as Array<string>;
      const orders: Array<number> = query.params[1] as Array<number>;
      expect(ids).toHaveLength(EPISODE_AUTO_RESOLVE_PAGE_SIZE);
      expect(orders).toEqual(ids.map(() => RESOLVED_ORDER));
      expect(query.sql).toBe(getEpisodeMemberCountsSql(db.kind().tables));
    }
  });

  test("a page with no grouping rules reads no rules", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);
    db.addEpisode({
      id: id("eeeeeeee", 1),
      projectId: project,
      memberOrders: [RESOLVED_ORDER],
    });

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.ruleReads).toHaveLength(0);
    expect(db.resolved).toEqual([id("eeeeeeee", 1).toString()]);
  });

  test("a run with no open episodes reads one empty page and nothing else", async () => {
    const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
      kind: db.kind(),
    });

    expect(result.episodesChecked).toBe(0);
    expect(db.episodeReads).toHaveLength(1);
    expect(db.aggregateQueries).toHaveLength(0);
    expect(db.ruleReads).toHaveLength(0);
    expect(db.stateReads).toHaveLength(0);
  });

  test("episodes of a project with no resolved state are not counted, and nothing is written for them", async () => {
    const withStates: ObjectID = id("aaaaaaaa", 1);
    const withoutResolvedState: ObjectID = id("aaaaaaaa", 2);
    db.addProject(withStates);
    db.states.push({
      id: "only-state",
      projectId: withoutResolvedState.toString(),
      order: 1,
      isResolvedState: false,
    });

    db.addEpisode({
      id: id("eeeeeeee", 1),
      projectId: withStates,
      memberOrders: [RESOLVED_ORDER],
    });
    db.episodes.push({
      id: id("eeeeeeee", 2),
      projectId: withoutResolvedState,
      groupingRuleId: null,
      allMembersResolvedAt: new Date("2026-11-14T09:00:00.000Z"),
      resolvedAt: null,
    });

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.aggregateQueries[0]!.params[0]).toEqual([
      id("eeeeeeee", 1).toString(),
    ]);
    expect(db.resolved).toEqual([id("eeeeeeee", 1).toString()]);
    expect(db.stamps).toEqual([
      { episodeId: id("eeeeeeee", 1).toString(), at: NOW },
    ]);
  });
});

describe("writing", () => {
  test("never has more than its limit of episodes' writes in flight", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    for (let index: number = 0; index < 60; index++) {
      db.addEpisode({
        id: id("eeeeeeee", index),
        projectId: project,
        memberOrders: [RESOLVED_ORDER],
      });
    }

    db.writeDelay = (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        setImmediate(resolve);
      });
    };

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.resolved).toHaveLength(60);
    expect(db.mostWritesInFlight).toBe(EPISODE_AUTO_RESOLVE_WRITE_CONCURRENCY);
  });

  test("writes only the episodes that change", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    // Still open, never stamped: nothing to write.
    db.addEpisode({
      id: id("eeeeeeee", 1),
      projectId: project,
      memberOrders: [1, RESOLVED_ORDER],
    });
    // Open again after being stamped: the stamp is cleared.
    db.addEpisode({
      id: id("eeeeeeee", 2),
      projectId: project,
      memberOrders: [2],
      allMembersResolvedAt: new Date("2026-11-14T09:59:00.000Z"),
    });
    // All resolved: stamped and resolved.
    db.addEpisode({
      id: id("eeeeeeee", 3),
      projectId: project,
      memberOrders: [RESOLVED_ORDER, RESOLVED_ORDER + 1],
    });

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.stamps).toEqual([
      { episodeId: id("eeeeeeee", 2).toString(), at: null },
      { episodeId: id("eeeeeeee", 3).toString(), at: NOW },
    ]);
    expect(db.resolved).toEqual([id("eeeeeeee", 3).toString()]);
  });

  test("one episode's failure is logged and the rest still resolve", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    for (let index: number = 0; index < 3; index++) {
      db.addEpisode({
        id: id("eeeeeeee", index),
        projectId: project,
        memberOrders: [RESOLVED_ORDER],
      });
    }
    db.failResolveOf.add(id("eeeeeeee", 1).toString());

    const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
      kind: db.kind(),
    });

    expect(db.resolved.sort()).toEqual(
      [id("eeeeeeee", 0).toString(), id("eeeeeeee", 2).toString()].sort(),
    );
    expect(result.episodesResolved).toBe(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(id("eeeeeeee", 1).toString()),
    );
  });
});

describe("its deadline", () => {
  test("stops it between pages: the episodes it did not reach are checked next run", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    for (let index: number = 0; index < EPISODE_AUTO_RESOLVE_PAGE_SIZE * 3; index++) {
      db.addEpisode({
        id: id("eeeeeeee", index),
        projectId: project,
        memberOrders: [RESOLVED_ORDER],
      });
    }

    const deadline: JobDeadline = new JobDeadline();
    let writes: number = 0;
    db.writeDelay = async (): Promise<void> => {
      // The time limit runs out during the first page's writes.
      if (++writes === 10) {
        deadline.end();
      }
    };

    const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
      kind: db.kind(),
      deadline,
    });

    expect(result.stoppedAtDeadline).toBe(true);
    expect(db.episodeReads).toHaveLength(1);
    // The episodes being written when it passed were finished, and no more.
    expect(db.resolved.length).toBeGreaterThan(0);
    expect(db.resolved.length).toBeLessThanOrEqual(
      EPISODE_AUTO_RESOLVE_WRITE_CONCURRENCY * 2,
    );

    // The next run takes up what is left.
    await runEpisodeAutoResolve({ kind: db.kind() });
    expect(db.resolved).toHaveLength(EPISODE_AUTO_RESOLVE_PAGE_SIZE * 3);
  });

  test("that passed before the run started reads nothing", async () => {
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    const result: EpisodeAutoResolveResult = await runEpisodeAutoResolve({
      kind: db.kind(),
      deadline,
    });

    expect(result.stoppedAtDeadline).toBe(true);
    expect(db.episodeReads).toHaveLength(0);
  });
});

describe("the aggregate query", () => {
  test("names the kind's tables and binds every value", () => {
    const sql: string = getEpisodeMemberCountsSql({
      memberTable: "IncidentEpisodeMember",
      memberEpisodeColumn: "incidentEpisodeId",
      memberRecordColumn: "incidentId",
      recordTable: "Incident",
      recordStateColumn: "currentIncidentStateId",
      stateTable: "IncidentState",
    });

    expect(sql).toContain(
      'JOIN "IncidentEpisodeMember" AS "member" ON "member"."incidentEpisodeId" = "page"."episodeId"',
    );
    expect(sql).toContain(
      'LEFT JOIN "Incident" AS "record" ON "record"."_id" = "member"."incidentId"',
    );
    expect(sql).toContain(
      'LEFT JOIN "IncidentState" AS "state" ON "state"."_id" = "record"."currentIncidentStateId"',
    );
    // Soft-deleted members, records and states count as they always did.
    expect(sql).toContain('"member"."deletedAt" IS NULL');
    expect(sql).toContain('"record"."deletedAt" IS NULL');
    expect(sql).toContain('"state"."deletedAt" IS NULL');
    expect(sql).toContain("unnest($1::uuid[], $2::int[])");
    expect(sql).not.toMatch(/\$3/);
  });

  test("an episode a member left, or whose records were deleted, counts as the job always counted it", async () => {
    const project: ObjectID = id("aaaaaaaa", 1);
    db.addProject(project);

    // Its only open member left the episode: what is left is resolved.
    db.addEpisode({
      id: id("eeeeeeee", 1),
      projectId: project,
      memberOrders: [RESOLVED_ORDER, 1],
    });
    db.members[1]!.deleted = true;

    // Its open member's record was deleted: skipped, the rest is resolved.
    db.addEpisode({
      id: id("eeeeeeee", 2),
      projectId: project,
      memberOrders: [RESOLVED_ORDER, 1],
    });
    db.records.get(`${id("eeeeeeee", 2).toString()}-record-1`)!.deleted = true;

    // A record whose state cannot be read counts as unresolved.
    db.addEpisode({
      id: id("eeeeeeee", 3),
      projectId: project,
      memberOrders: [RESOLVED_ORDER],
    });
    db.records.get(`${id("eeeeeeee", 3).toString()}-record-0`)!.stateId =
      null;

    // Every member left: an episode with no members is left alone.
    db.addEpisode({
      id: id("eeeeeeee", 4),
      projectId: project,
      memberOrders: [RESOLVED_ORDER],
    });
    db.members[db.members.length - 1]!.deleted = true;

    await runEpisodeAutoResolve({ kind: db.kind() });

    expect(db.resolved.sort()).toEqual(
      [id("eeeeeeee", 1).toString(), id("eeeeeeee", 2).toString()].sort(),
    );
  });
});

describe("decideEpisodeAutoResolve", () => {
  const counts: (
    memberCount: number,
    unresolvedCount: number,
  ) => { memberCount: number; unresolvedCount: number } = (
    memberCount: number,
    unresolvedCount: number,
  ) => {
    return { memberCount, unresolvedCount };
  };
  const delay: (minutes: number) => AutoResolveRule = (
    minutes: number,
  ): AutoResolveRule => {
    return { enableResolveDelay: true, resolveDelayMinutes: minutes };
  };
  const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
    return new Date(NOW.getTime() - minutes * 60 * 1000);
  };

  test("leaves an episode with no members alone", () => {
    expect(
      decideEpisodeAutoResolve({
        counts: counts(0, 0),
        hasResolvedState: true,
        allMembersResolvedAt: minutesAgo(30),
        rule: null,
        now: NOW,
      }),
    ).toEqual({ resolve: false });
  });

  test("leaves an episode of a project with no resolved state alone", () => {
    expect(
      decideEpisodeAutoResolve({
        counts: counts(2, 0),
        hasResolvedState: false,
        allMembersResolvedAt: null,
        rule: null,
        now: NOW,
      }),
    ).toEqual({ resolve: false });
  });

  test("clears the stamp of an episode a member is open in again, and only then writes", () => {
    expect(
      decideEpisodeAutoResolve({
        counts: counts(2, 1),
        hasResolvedState: true,
        allMembersResolvedAt: minutesAgo(1),
        rule: null,
        now: NOW,
      }),
    ).toEqual({ setAllMembersResolvedAt: null, resolve: false });

    expect(
      decideEpisodeAutoResolve({
        counts: counts(2, 1),
        hasResolvedState: true,
        allMembersResolvedAt: null,
        rule: null,
        now: NOW,
      }),
    ).toEqual({ resolve: false });
  });

  test("stamps and resolves at once with no resolve delay", () => {
    expect(
      decideEpisodeAutoResolve({
        counts: counts(3, 0),
        hasResolvedState: true,
        allMembersResolvedAt: null,
        rule: null,
        now: NOW,
      }),
    ).toEqual({ setAllMembersResolvedAt: NOW, resolve: true });

    // A rule whose delay is off, or zero, delays nothing.
    for (const rule of [
      { enableResolveDelay: false, resolveDelayMinutes: 10 },
      delay(0),
    ]) {
      expect(
        decideEpisodeAutoResolve({
          counts: counts(3, 0),
          hasResolvedState: true,
          allMembersResolvedAt: null,
          rule,
          now: NOW,
        }),
      ).toEqual({ setAllMembersResolvedAt: NOW, resolve: true });
    }
  });

  test("with a resolve delay: stamps first, waits while the delay runs, resolves once it has", () => {
    expect(
      decideEpisodeAutoResolve({
        counts: counts(1, 0),
        hasResolvedState: true,
        allMembersResolvedAt: null,
        rule: delay(10),
        now: NOW,
      }),
    ).toEqual({ setAllMembersResolvedAt: NOW, resolve: false });

    expect(
      decideEpisodeAutoResolve({
        counts: counts(1, 0),
        hasResolvedState: true,
        allMembersResolvedAt: minutesAgo(9),
        rule: delay(10),
        now: NOW,
      }),
    ).toEqual({ resolve: false });

    expect(
      decideEpisodeAutoResolve({
        counts: counts(1, 0),
        hasResolvedState: true,
        allMembersResolvedAt: minutesAgo(10),
        rule: delay(10),
        now: NOW,
      }),
    ).toEqual({ resolve: true });
  });

  test("resolves an episode stamped earlier when its rule has no delay", () => {
    expect(
      decideEpisodeAutoResolve({
        counts: counts(1, 0),
        hasResolvedState: true,
        allMembersResolvedAt: minutesAgo(2),
        rule: null,
        now: NOW,
      }),
    ).toEqual({ resolve: true });
  });
});
