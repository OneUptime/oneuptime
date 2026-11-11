import ProjectMilestoneBackfill, {
  MILESTONE_BACKFILL_SOURCES,
  MilestoneBackfillSource,
  PROJECT_MILESTONE_BACKFILL_BATCH_SIZE,
  ProjectMilestoneBackfillResult,
} from "../../../../Server/Utils/Activation/ProjectMilestoneBackfill";
import ActivationMilestone, {
  ALL_ACTIVATION_MILESTONES,
} from "../../../../Types/Analytics/ActivationMilestone";
import { describe, expect, test } from "@jest/globals";

/*
 * The one-off backfill of activation milestones (issue #6830), with its
 * statements answered by a stand-in: how it walks the projects, what it
 * asks for each batch, and that every row it writes is marked backfilled
 * and never overwrites one kept live. The statements themselves run against
 * a migrated Postgres in ProjectMilestonePostgres.test.ts.
 */

interface Call {
  sql: string;
  parameters: Array<unknown>;
}

const projectIds: (count: number) => Array<string> = (
  count: number,
): Array<string> => {
  const ids: Array<string> = [];

  for (let i: number = 0; i < count; i++) {
    ids.push(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  }

  return ids;
};

const runWith: (data: {
  projects: Array<string>;
  batchSize: number;
  keptPerStatement?: number;
}) => Promise<{
  result: ProjectMilestoneBackfillResult;
  calls: Array<Call>;
}> = async (data: {
  projects: Array<string>;
  batchSize: number;
  keptPerStatement?: number;
}): Promise<{ result: ProjectMilestoneBackfillResult; calls: Array<Call> }> => {
  const calls: Array<Call> = [];

  const result: ProjectMilestoneBackfillResult =
    await ProjectMilestoneBackfill.backfill({
      batchSize: data.batchSize,
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        calls.push({ sql, parameters });

        if (sql.startsWith(`SELECT "_id"::text AS "_id" FROM "Project"`)) {
          const limit: number = parameters[0] as number;
          const after: string | null = parameters[1] as string | null;

          return data.projects
            .filter((id: string): boolean => {
              return after === null || id > after;
            })
            .slice(0, limit)
            .map((id: string) => {
              return { _id: id };
            });
        }

        return new Array(data.keptPerStatement || 0).fill({ _id: "x" });
      },
    });

  return { result, calls };
};

describe("ProjectMilestoneBackfill", () => {
  test("has a source for every milestone old data can show - all but the test page, which is new", () => {
    const sourced: Array<ActivationMilestone> = MILESTONE_BACKFILL_SOURCES.map(
      (source: MilestoneBackfillSource): ActivationMilestone => {
        return source.milestone;
      },
    );

    expect(new Set(sourced).size).toBe(sourced.length);
    expect([...sourced].sort()).toEqual(
      ALL_ACTIVATION_MILESTONES.filter((milestone: ActivationMilestone) => {
        return milestone !== ActivationMilestone.FirstTestPageAcknowledged;
      }).sort(),
    );
  });

  test("every source reads one batch of projects: their id and when they reached it", () => {
    for (const source of MILESTONE_BACKFILL_SOURCES) {
      expect(source.sql).toContain(`= ANY($1::uuid[])`);
      expect(source.sql).toMatch(/^SELECT "projectId", /);
      expect(source.sql).toContain(`AS "reachedAt"`);
      // Nothing it reads is changed.
      expect(source.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
    }
  });

  test("walks the projects in primary key order, a batch at a time, until a short batch", async () => {
    const projects: Array<string> = projectIds(5);
    const { result, calls } = await runWith({ projects, batchSize: 2 });

    const pageReads: Array<Call> = calls.filter((call: Call): boolean => {
      return call.sql.startsWith(`SELECT "_id"::text AS "_id" FROM "Project"`);
    });

    expect(
      pageReads.map((call: Call) => {
        return call.parameters;
      }),
    ).toEqual([
      [2, null],
      [2, projects[1]],
      [2, projects[3]],
    ]);
    expect(pageReads[0]!.sql).toContain(`ORDER BY "_id" ASC LIMIT $1`);
    expect(result.projects).toBe(5);
  });

  test("a full last batch asks once more and stops on an empty one", async () => {
    const projects: Array<string> = projectIds(4);
    const { calls } = await runWith({ projects, batchSize: 2 });

    const pageReads: Array<Call> = calls.filter((call: Call): boolean => {
      return call.sql.startsWith(`SELECT "_id"::text AS "_id" FROM "Project"`);
    });

    expect(pageReads).toHaveLength(3);
  });

  test("each batch runs every source once, writing backfilled rows that never overwrite a kept one", async () => {
    const projects: Array<string> = projectIds(3);
    const { calls } = await runWith({ projects, batchSize: 10 });

    const inserts: Array<Call> = calls.filter((call: Call): boolean => {
      return call.sql.includes(`INSERT INTO "ProjectMilestone"`);
    });

    expect(inserts).toHaveLength(MILESTONE_BACKFILL_SOURCES.length);

    MILESTONE_BACKFILL_SOURCES.forEach(
      (source: MilestoneBackfillSource, index: number) => {
        const insert: Call = inserts[index]!;

        expect(insert.sql).toContain(`WITH "reached" AS (${source.sql})`);
        expect(insert.sql).toContain(`"reachedAt", true, 1 FROM "reached"`);
        expect(insert.sql).toContain(
          `ON CONFLICT ("projectId", "milestone") DO NOTHING`,
        );

        // The batch first, the source's own values, the milestone last.
        expect(insert.parameters[0]).toEqual(projects);
        expect(insert.parameters.slice(1, -1)).toEqual(source.parameters || []);
        expect(insert.parameters[insert.parameters.length - 1]).toBe(
          source.milestone,
        );
        expect(insert.sql).toContain(`$${insert.parameters.length}::varchar`);
      },
    );
  });

  test("counts what it kept, per milestone, across batches", async () => {
    const { result } = await runWith({
      projects: projectIds(3),
      batchSize: 2,
      keptPerStatement: 1,
    });

    for (const source of MILESTONE_BACKFILL_SOURCES) {
      expect(result.keptByMilestone[source.milestone]).toBe(2);
    }
  });

  test("with no projects it asks once and writes nothing", async () => {
    const { result, calls } = await runWith({ projects: [], batchSize: 2 });

    expect(calls).toHaveLength(1);
    expect(result).toEqual({ projects: 0, keptByMilestone: {} });
  });

  test("a batch is small enough to stay well inside a statement timeout", () => {
    expect(PROJECT_MILESTONE_BACKFILL_BATCH_SIZE).toBeGreaterThan(0);
    expect(PROJECT_MILESTONE_BACKFILL_BATCH_SIZE).toBeLessThanOrEqual(500);
  });
});
