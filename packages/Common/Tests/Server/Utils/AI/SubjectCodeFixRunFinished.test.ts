import SubjectCodeFixRun from "../../../../Server/Utils/AI/SRE/SubjectCodeFixRun";
import AIRunService from "../../../../Server/Services/AIRunService";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRunType from "../../../../Types/AI/AIRunType";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import { FINISHED_FIX_STATUSES } from "../../../../Utils/Suggestions/CodeFixSuggestion";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * THE FIX A TRACE ALREADY HAD.
 *
 * A trace whose performance fix did its work - it opened its pull request,
 * or read the code and found nothing to change - is not offered, or given,
 * a second one: the trace page links to that fix. Which runs count is a
 * database predicate (the run's recipe, its status among
 * FINISHED_FIX_STATUSES, the trace inside its JSON context), so the
 * operators the query builds are swapped for sentinels a fake AIRunService
 * evaluates over stored runs: what is asserted is the real behaviour -
 * given these stored runs, which one is the trace's finished fix?
 */

const projectId: ObjectID = ObjectID.generate();
const traceId: string = "4bf92f3577b34da6a3ce929d0e0e4736";

interface StoredRun {
  id: string;
  projectId: ObjectID;
  runType: AIRunType;
  codeFixTaskType: CodeFixTaskType;
  status: AIRunStatus;
  taskContext: Record<string, unknown>;
  createdAt: number;
}

interface AnySentinel {
  anyOf: Array<string>;
}

interface ContainsSentinel {
  contains: Record<string, unknown>;
}

let storedRuns: Array<StoredRun> = [];
let clock: number = 0;

function storeRun(data: Partial<StoredRun> & { status: AIRunStatus }): string {
  clock += 1;
  const id: string = ObjectID.generate().toString();

  storedRuns.push({
    id,
    projectId,
    runType: AIRunType.CodeFix,
    codeFixTaskType: CodeFixTaskType.FixPerformance,
    taskContext: { traceId },
    createdAt: clock,
    ...data,
  });

  return id;
}

function matches(run: StoredRun, query: Record<string, unknown>): boolean {
  const status: AnySentinel = query["status"] as AnySentinel;
  const context: ContainsSentinel = query["taskContext"] as ContainsSentinel;

  return (
    run.projectId.toString() === (query["projectId"] as ObjectID).toString() &&
    run.runType === query["runType"] &&
    run.codeFixTaskType === query["codeFixTaskType"] &&
    status.anyOf.includes(run.status) &&
    Object.entries(context.contains).every(
      ([key, value]: [string, unknown]): boolean => {
        return run.taskContext[key] === value;
      },
    )
  );
}

describe("SubjectCodeFixRun.findFinishedPerformanceFixRunForTrace", () => {
  let findOneBy: jest.SpyInstance;

  beforeEach(() => {
    storedRuns = [];

    jest
      .spyOn(QueryHelper, "any")
      .mockImplementation((values: Array<string | ObjectID | number>) => {
        return {
          anyOf: values.map((value: string | ObjectID | number): string => {
            return value.toString();
          }),
        } as never;
      });

    jest
      .spyOn(QueryHelper, "jsonContains")
      .mockImplementation((value: unknown) => {
        return { contains: value } as never;
      });

    findOneBy = jest.spyOn(AIRunService, "findOneBy");
    findOneBy.mockImplementation(
      (data: {
        query: Record<string, unknown>;
        sort?: Record<string, SortOrder>;
      }): Promise<AIRun | null> => {
        const found: Array<StoredRun> = storedRuns
          .filter((run: StoredRun): boolean => {
            return matches(run, data.query);
          })
          .sort((a: StoredRun, b: StoredRun): number => {
            return data.sort?.["createdAt"] === SortOrder.Descending
              ? b.createdAt - a.createdAt
              : a.createdAt - b.createdAt;
          });

        return Promise.resolve(
          found[0]
            ? ({
                id: new ObjectID(found[0].id),
                status: found[0].status,
              } as unknown as AIRun)
            : null,
        );
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function finishedRunId(
    forTraceId: string = traceId,
  ): Promise<string | null> {
    const run: AIRun | null =
      await SubjectCodeFixRun.findFinishedPerformanceFixRunForTrace({
        projectId,
        traceId: forTraceId,
      });

    return run?.id?.toString() || null;
  }

  test.each([AIRunStatus.Completed, AIRunStatus.NoFixFound])(
    "a %s fix for the trace is its finished fix",
    async (status: AIRunStatus) => {
      const id: string = storeRun({ status });

      expect(await finishedRunId()).toBe(id);
    },
  );

  test.each([
    AIRunStatus.Error,
    AIRunStatus.Stale,
    AIRunStatus.Cancelled,
    AIRunStatus.Queued,
    AIRunStatus.Running,
    AIRunStatus.WaitingForApproval,
  ])(
    "a %s fix is not: it failed, was stopped, or is still on its way",
    async (status: AIRunStatus) => {
      storeRun({ status });

      expect(await finishedRunId()).toBeNull();
    },
  );

  test("a finished fix for another trace, recipe or project is not this trace's", async () => {
    storeRun({
      status: AIRunStatus.Completed,
      taskContext: { traceId: "another-trace" },
    });
    storeRun({
      status: AIRunStatus.Completed,
      codeFixTaskType: CodeFixTaskType.ImproveTracing,
    });
    storeRun({
      status: AIRunStatus.Completed,
      projectId: ObjectID.generate(),
    });

    expect(await finishedRunId()).toBeNull();
  });

  test("of several, the newest - the one the page links to", async () => {
    storeRun({ status: AIRunStatus.NoFixFound });
    const newest: string = storeRun({ status: AIRunStatus.Completed });
    storeRun({ status: AIRunStatus.Error });

    expect(await finishedRunId()).toBe(newest);
  });

  test("the query asks for the finished statuses and the trace inside the run's context, newest first", async () => {
    await finishedRunId();

    expect(QueryHelper.any).toHaveBeenCalledWith([...FINISHED_FIX_STATUSES]);
    expect(QueryHelper.jsonContains).toHaveBeenCalledWith({ traceId });
    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          projectId,
          runType: AIRunType.CodeFix,
          codeFixTaskType: CodeFixTaskType.FixPerformance,
        }),
        sort: { createdAt: SortOrder.Descending },
        props: { isRoot: true },
      }),
    );
  });

  test("no trace id: nothing is read", async () => {
    expect(await finishedRunId("")).toBeNull();
    expect(findOneBy).not.toHaveBeenCalled();
  });
});
