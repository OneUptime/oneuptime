import TestPageAcknowledgementBackfill, {
  ACKNOWLEDGED_TEST_PAGES_SQL,
  PROJECT_BATCH_SQL,
  TEST_PAGE_ACKNOWLEDGEMENT_BACKFILL_BATCH_SIZE,
  TestPageAcknowledgementBackfillResult,
  groupAcknowledgedMembersByProject,
} from "../../../../Server/Utils/WelcomeChecklist/TestPageAcknowledgementBackfill";
import WelcomeChecklistService from "../../../../Server/Services/WelcomeChecklistService";
import ProjectService from "../../../../Server/Services/ProjectService";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * THE MEMBERS WHO ACKNOWLEDGED A TEST PAGE BEFORE THEIR NOTE WAS KEPT
 * (#7042), with the statements answered by a stand-in: how the backfill
 * walks the projects, what it asks of each batch - only a test page's
 * acknowledgement, never a real page's - and who it notes, oldest first.
 * WelcomeChecklistService.test.ts holds the write itself to the project
 * row's lock.
 */

interface Call {
  sql: string;
  parameters: Array<unknown>;
}

interface Acknowledgement {
  projectId: string;
  userId: string;
  acknowledgedAt: string;
}

interface Note {
  projectId: string;
  userIds: Array<string>;
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

const userId: (index: number) => string = (index: number): string => {
  return `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`;
};

/*
 * The batch's projects as Postgres answers PROJECT_BATCH_SQL, and its
 * acknowledgements as it answers ACKNOWLEDGED_TEST_PAGES_SQL: one row per
 * person per project, oldest first.
 */
const runWith: (data: {
  projects: Array<string>;
  acknowledgements?: Array<Acknowledgement>;
  batchSize?: number;
  notedPerProject?: (note: Note) => Promise<number>;
}) => Promise<{
  result: TestPageAcknowledgementBackfillResult;
  calls: Array<Call>;
  notes: Array<Note>;
}> = async (data: {
  projects: Array<string>;
  acknowledgements?: Array<Acknowledgement>;
  batchSize?: number;
  notedPerProject?: (note: Note) => Promise<number>;
}): Promise<{
  result: TestPageAcknowledgementBackfillResult;
  calls: Array<Call>;
  notes: Array<Note>;
}> => {
  const calls: Array<Call> = [];
  const notes: Array<Note> = [];

  const result: TestPageAcknowledgementBackfillResult =
    await TestPageAcknowledgementBackfill.backfill({
      batchSize: data.batchSize,
      query: async (
        sql: string,
        parameters: Array<unknown>,
      ): Promise<unknown> => {
        calls.push({ sql, parameters });

        if (sql === PROJECT_BATCH_SQL) {
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

        if (sql === ACKNOWLEDGED_TEST_PAGES_SQL) {
          const batch: Array<string> = parameters[0] as Array<string>;

          return (data.acknowledgements || [])
            .filter((row: Acknowledgement): boolean => {
              return batch.includes(row.projectId);
            })
            .sort((a: Acknowledgement, b: Acknowledgement): number => {
              return a.acknowledgedAt.localeCompare(b.acknowledgedAt);
            });
        }

        throw new Error(`Unexpected statement: ${sql}`);
      },
      note: async (note: {
        projectId: ObjectID;
        userIds: Array<string>;
      }): Promise<number> => {
        const recorded: Note = {
          projectId: note.projectId.toString(),
          userIds: note.userIds,
        };

        notes.push(recorded);

        return data.notedPerProject
          ? await data.notedPerProject(recorded)
          : note.userIds.length;
      },
    });

  return { result, calls, notes };
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what it reads", () => {
  test("projects that are not deleted, in primary key order, after the last one read", () => {
    expect(PROJECT_BATCH_SQL).toContain(`FROM "Project"`);
    expect(PROJECT_BATCH_SQL).toContain(`"deletedAt" IS NULL`);
    expect(PROJECT_BATCH_SQL).toContain(`"_id" > $2::uuid`);
    expect(PROJECT_BATCH_SQL).toContain(`ORDER BY "_id" ASC LIMIT $1`);
  });

  test("a test page's acknowledgements, by whoever acknowledged it, from each person's page and the run", () => {
    for (const table of ["UserOnCallLog", "OnCallDutyPolicyExecutionLog"]) {
      expect(ACKNOWLEDGED_TEST_PAGES_SQL).toContain(`FROM "${table}" WHERE`);
    }

    // Only the batch's projects, through their projectId indexes.
    expect(
      ACKNOWLEDGED_TEST_PAGES_SQL.match(/"projectId" = ANY\(\$1::uuid\[\]\)/g),
    ).toHaveLength(2);
    // A test page's, and an acknowledged one: who acknowledged it, and when.
    expect(
      ACKNOWLEDGED_TEST_PAGES_SQL.match(/"userNotificationEventType" = \$2/g),
    ).toHaveLength(2);
    expect(
      ACKNOWLEDGED_TEST_PAGES_SQL.match(/"acknowledgedAt" IS NOT NULL/g),
    ).toHaveLength(2);
    expect(
      ACKNOWLEDGED_TEST_PAGES_SQL.match(/"acknowledgedByUserId" IS NOT NULL/g),
    ).toHaveLength(2);
    // Each person once per project, oldest first.
    expect(ACKNOWLEDGED_TEST_PAGES_SQL).toContain(
      `GROUP BY "projectId", "userId"`,
    );
    expect(ACKNOWLEDGED_TEST_PAGES_SQL).toContain(
      `ORDER BY MIN("acknowledgedAt") ASC`,
    );
  });

  test("asks only for test pages: a real page's acknowledgement never counts", async () => {
    const [project] = projectIds(1);
    const { calls } = await runWith({ projects: [project!] });

    const acknowledged: Call | undefined = calls.find((call: Call) => {
      return call.sql === ACKNOWLEDGED_TEST_PAGES_SQL;
    });

    expect(acknowledged?.parameters).toEqual([
      [project],
      UserNotificationEventType.TestPage,
    ]);
    expect(UserNotificationEventType.TestPage).toBe("Test Page");
  });
});

describe("how it walks the projects", () => {
  test("a batch at a time, each after the last, until a batch comes back short", async () => {
    const projects: Array<string> = projectIds(5);
    const { result, calls } = await runWith({ projects, batchSize: 2 });

    const batches: Array<Call> = calls.filter((call: Call) => {
      return call.sql === PROJECT_BATCH_SQL;
    });

    expect(
      batches.map((call: Call) => {
        return call.parameters;
      }),
    ).toEqual([
      [2, null],
      [2, projects[1]],
      [2, projects[3]],
    ]);
    expect(
      calls
        .filter((call: Call) => {
          return call.sql === ACKNOWLEDGED_TEST_PAGES_SQL;
        })
        .map((call: Call) => {
          return call.parameters[0];
        }),
    ).toEqual([
      [projects[0], projects[1]],
      [projects[2], projects[3]],
      [projects[4]],
    ]);
    expect(result.projects).toBe(5);
  });

  test("a last batch that is exactly full asks once more, and stops on nothing", async () => {
    const projects: Array<string> = projectIds(4);
    const { result, calls } = await runWith({ projects, batchSize: 2 });

    expect(
      calls.filter((call: Call) => {
        return call.sql === PROJECT_BATCH_SQL;
      }),
    ).toHaveLength(3);
    expect(
      calls.filter((call: Call) => {
        return call.sql === ACKNOWLEDGED_TEST_PAGES_SQL;
      }),
    ).toHaveLength(2);
    expect(result.projects).toBe(4);
  });

  test("no projects asks nothing else and notes nobody", async () => {
    const { result, calls, notes } = await runWith({ projects: [] });

    expect(calls).toHaveLength(1);
    expect(notes).toEqual([]);
    expect(result).toEqual({
      projects: 0,
      projectsWithTestPages: 0,
      membersNoted: 0,
    });
  });

  test("its batch is the default unless it is told otherwise, and never less than one", async () => {
    expect(TEST_PAGE_ACKNOWLEDGEMENT_BACKFILL_BATCH_SIZE).toBe(200);

    const { calls } = await runWith({ projects: projectIds(1) });
    expect(calls[0]!.parameters[0]).toBe(200);

    const { calls: none } = await runWith({
      projects: projectIds(1),
      batchSize: 0,
    });
    expect(none[0]!.parameters[0]).toBe(200);

    const { calls: tiny } = await runWith({
      projects: projectIds(1),
      batchSize: 0.4,
    });
    expect(tiny[0]!.parameters[0]).toBe(1);

    const { calls: one } = await runWith({
      projects: projectIds(2),
      batchSize: 1,
    });
    expect(one[0]!.parameters[0]).toBe(1);
  });
});

describe("who it notes", () => {
  test("each project's members who acknowledged a test page, oldest first, each once", async () => {
    const projects: Array<string> = projectIds(3);
    const { result, notes } = await runWith({
      projects,
      acknowledgements: [
        {
          projectId: projects[0]!,
          userId: userId(2),
          acknowledgedAt: "2026-11-12T09:00:00.000Z",
        },
        {
          projectId: projects[0]!,
          userId: userId(1),
          acknowledgedAt: "2026-11-11T09:00:00.000Z",
        },
        {
          projectId: projects[2]!,
          userId: userId(3).toUpperCase(),
          acknowledgedAt: "2026-11-11T10:00:00.000Z",
        },
      ],
    });

    expect(notes).toEqual([
      { projectId: projects[0], userIds: [userId(1), userId(2)] },
      { projectId: projects[2], userIds: [userId(3)] },
    ]);
    // A project where nobody acknowledged one is not written.
    expect(result).toEqual({
      projects: 3,
      projectsWithTestPages: 2,
      membersNoted: 3,
    });
  });

  test("counts only the members noted now: a second run notes nobody", async () => {
    const projects: Array<string> = projectIds(1);
    const { result } = await runWith({
      projects,
      acknowledgements: [
        {
          projectId: projects[0]!,
          userId: userId(1),
          acknowledgedAt: "2026-11-11T09:00:00.000Z",
        },
      ],
      notedPerProject: async (): Promise<number> => {
        return 0;
      },
    });

    expect(result).toEqual({
      projects: 1,
      projectsWithTestPages: 1,
      membersNoted: 0,
    });
  });

  test("a project deleted since its batch was read is passed over", async () => {
    const projects: Array<string> = projectIds(2);
    const { result, notes } = await runWith({
      projects,
      acknowledgements: projects.map((projectId: string) => {
        return {
          projectId: projectId,
          userId: userId(1),
          acknowledgedAt: "2026-11-11T09:00:00.000Z",
        };
      }),
      notedPerProject: async (note: Note): Promise<number> => {
        if (note.projectId === projects[0]) {
          throw new NotFoundException("Project not found.");
        }

        return 1;
      },
    });

    expect(notes).toHaveLength(2);
    expect(result.membersNoted).toBe(1);
  });

  test("any other failure stops the run, so the migration is tried again", async () => {
    const projects: Array<string> = projectIds(1);

    await expect(
      runWith({
        projects,
        acknowledgements: [
          {
            projectId: projects[0]!,
            userId: userId(1),
            acknowledgedAt: "2026-11-11T09:00:00.000Z",
          },
        ],
        notedPerProject: async (): Promise<number> => {
          throw new Error("canceling statement due to lock timeout");
        },
      }),
    ).rejects.toThrow("canceling statement due to lock timeout");
  });

  test("rows with no project or no person, or ids that are not ids, are no answer", () => {
    const project: string = projectIds(1)[0]!;

    expect(
      Array.from(
        groupAcknowledgedMembersByProject([
          { projectId: project, userId: null },
          { projectId: null, userId: userId(1) },
          { projectId: project, userId: "not-an-id" },
          { projectId: project, userId: 42 },
          { projectId: ` ${project.toUpperCase()} `, userId: userId(2) },
          { projectId: project, userId: userId(2) },
        ]).entries(),
      ),
    ).toEqual([[project, [userId(2)]]]);
  });

  test("by default it notes through WelcomeChecklistService, on the project row it locks", async () => {
    const project: string = projectIds(1)[0]!;
    const queries: Array<string> = [];

    jest.spyOn(ProjectService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string): Promise<unknown> => {
          queries.push(sql);

          if (sql === PROJECT_BATCH_SQL) {
            return [{ _id: project }];
          }

          return [
            {
              projectId: project,
              userId: userId(1),
              acknowledgedAt: new Date(),
            },
          ];
        },
      },
    } as never);

    const noteSpy: SpyInstance<
      typeof WelcomeChecklistService.noteTestPagesAcknowledgedBefore
    > = jest
      .spyOn(WelcomeChecklistService, "noteTestPagesAcknowledgedBefore")
      .mockResolvedValue(1);

    const result: TestPageAcknowledgementBackfillResult =
      await TestPageAcknowledgementBackfill.backfill();

    expect(queries).toEqual([PROJECT_BATCH_SQL, ACKNOWLEDGED_TEST_PAGES_SQL]);
    expect(noteSpy).toHaveBeenCalledTimes(1);
    expect(noteSpy.mock.calls[0]![0].projectId.toString()).toBe(project);
    expect(noteSpy.mock.calls[0]![0].userIds).toEqual([userId(1)]);
    expect(result.membersNoted).toBe(1);
  });
});
