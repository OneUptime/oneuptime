import AIRunService from "../../../Server/Services/AIRunService";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * setInvestigationAnalysisTldr writes display-only text, but it still must be
 * scoped: only the run it summarizes, only while that run is Completed, and
 * never a soft-deleted row. A stale attempt that lost the completion race (so
 * never posts a report) must not be able to label the run either.
 */

interface RecordedQuery {
  set: Record<string, unknown> | null;
  wheres: Array<{ clause: string; parameters: Record<string, unknown> }>;
}

function mockUpdateQueryBuilder(data: { affected: number | undefined }): {
  recorded: RecordedQuery;
} {
  const recorded: RecordedQuery = { set: null, wheres: [] };

  const builder: Record<string, unknown> = {
    update: () => {
      return builder;
    },
    set: (values: Record<string, unknown>) => {
      recorded.set = values;
      return builder;
    },
    where: (clause: string, parameters: Record<string, unknown>) => {
      recorded.wheres.push({ clause, parameters });
      return builder;
    },
    andWhere: (clause: string, parameters?: Record<string, unknown>) => {
      recorded.wheres.push({ clause, parameters: parameters || {} });
      return builder;
    },
    execute: async () => {
      return { affected: data.affected };
    },
  };

  jest.spyOn(AIRunService, "getRepository").mockReturnValue({
    createQueryBuilder: () => {
      return builder;
    },
  } as never);

  return { recorded };
}

function whereClauses(recorded: RecordedQuery): string {
  return recorded.wheres
    .map((where: { clause: string }): string => {
      return where.clause;
    })
    .join(" AND ");
}

describe("AIRunService.setInvestigationAnalysisTldr", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes only the summary, scoped to that Completed, undeleted run", async () => {
    const aiRunId: ObjectID = ObjectID.generate();
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await expect(
      AIRunService.setInvestigationAnalysisTldr({
        aiRunId,
        analysisTldr: "Checkout is failing on an exhausted pool.",
      }),
    ).resolves.toBe(1);

    expect(recorded.set).toEqual({
      analysisTldr: "Checkout is failing on an exhausted pool.",
    });

    const clauses: string = whereClauses(recorded);
    expect(clauses).toContain('"_id" = :id');
    expect(clauses).toContain('"status" = :status');
    expect(clauses).toContain('"deletedAt" IS NULL');
    expect(recorded.wheres[0]!.parameters).toEqual({
      id: aiRunId.toString(),
    });
    expect(recorded.wheres[1]!.parameters).toEqual({
      status: AIRunStatus.Completed,
    });
  });

  /*
   * A display-only writer must not be able to touch anything else. This is
   * the only thing standing between "set one varchar" and an UPDATE that
   * silently rewrites status or the code-fix decision on a settled run.
   */
  test("writes that column and nothing else", async () => {
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await AIRunService.setInvestigationAnalysisTldr({
      aiRunId: ObjectID.generate(),
      analysisTldr: "Summary of the outage.",
    });

    expect(Object.keys(recorded.set || {})).toEqual(["analysisTldr"]);
  });

  /*
   * Write-once. A stale attempt that lost the Completed CAS is kept out today
   * only by statement order in the engine — and by the time it could run, the
   * WINNER has already written both the report and its summary, so a
   * status-only guard would let the loser overwrite a summary describing a
   * different analysis.
   */
  test("refuses to overwrite a summary that already exists", async () => {
    const aiRunId: ObjectID = ObjectID.generate();
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await AIRunService.setInvestigationAnalysisTldr({
      aiRunId,
      analysisTldr: "Summary of the outage.",
    });

    expect(whereClauses(recorded)).toContain('"analysisTldr" IS NULL');
  });

  test("reports zero when another writer already summarized the run", async () => {
    mockUpdateQueryBuilder({ affected: 0 });

    await expect(
      AIRunService.setInvestigationAnalysisTldr({
        aiRunId: ObjectID.generate(),
        analysisTldr: "A second, conflicting summary.",
      }),
    ).resolves.toBe(0);
  });

  test("reports zero when the run is no longer Completed", async () => {
    mockUpdateQueryBuilder({ affected: 0 });

    await expect(
      AIRunService.setInvestigationAnalysisTldr({
        aiRunId: ObjectID.generate(),
        analysisTldr: "Summary.",
      }),
    ).resolves.toBe(0);
  });

  test("treats an undefined affected count as no rows changed", async () => {
    mockUpdateQueryBuilder({ affected: undefined });

    await expect(
      AIRunService.setInvestigationAnalysisTldr({
        aiRunId: ObjectID.generate(),
        analysisTldr: "Summary.",
      }),
    ).resolves.toBe(0);
  });
});
