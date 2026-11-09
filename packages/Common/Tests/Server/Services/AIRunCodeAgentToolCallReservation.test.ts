import AIRunService from "../../../Server/Services/AIRunService";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * AIRunService.reserveCodeAgentToolCall counts one production telemetry
 * call of a code task's run, in one conditional UPDATE. A run used to be
 * held to 12 such calls; now (issue #6440) it is held to none unless the
 * project set a limit of tool calls per run - and then to that, still in
 * the one statement, so two calls at once cannot both take the last one.
 * Either way only a Running code-fix run claimed by the calling agent, and
 * never a deleted one, is counted.
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

function clauses(recorded: RecordedQuery): Array<string> {
  return recorded.wheres.map((where: { clause: string }): string => {
    return where.clause;
  });
}

const RUN_ID: ObjectID = new ObjectID("7d1c2d3e-1111-4222-8333-944455556666");
const AGENT_ID: ObjectID = new ObjectID("7d1c2d3e-2222-4222-8333-944455556666");

describe("AIRunService.reserveCodeAgentToolCall", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("with no limit set, the call is counted on the run, with no cap in the statement", async () => {
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await expect(
      AIRunService.reserveCodeAgentToolCall({
        aiRunId: RUN_ID,
        aiAgentId: AGENT_ID,
        maxToolCalls: null,
      }),
    ).resolves.toBe(true);

    expect(clauses(recorded)).toEqual([
      '"_id" = :id',
      '"runType" = :runType',
      '"status" = :status',
      '"aiAgentId" = :aiAgentId',
      '"deletedAt" IS NULL',
    ]);
    expect(recorded.wheres[1]!.parameters).toEqual({
      runType: AIRunType.CodeFix,
    });
    expect(recorded.wheres[2]!.parameters).toEqual({
      status: AIRunStatus.Running,
    });
    expect(recorded.wheres[3]!.parameters).toEqual({
      aiAgentId: AGENT_ID.toString(),
    });
    // The count goes up by one, from 0 for a run that has none yet.
    expect(
      (recorded.set!["toolCallCount"] as () => string)(),
    ).toBe('COALESCE("toolCallCount", 0) + 1');
  });

  test("a project's limit of tool calls per run is held in the same statement", async () => {
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await AIRunService.reserveCodeAgentToolCall({
      aiRunId: RUN_ID,
      aiAgentId: AGENT_ID,
      maxToolCalls: 30,
    });

    expect(clauses(recorded)).toContain(
      'COALESCE("toolCallCount", 0) < :maxToolCalls',
    );
    expect(
      recorded.wheres.find(
        (where: { clause: string }): boolean => {
          return where.clause.includes(":maxToolCalls");
        },
      )!.parameters,
    ).toEqual({ maxToolCalls: 30 });
    expect(clauses(recorded).slice(-1)[0]).toBe('"deletedAt" IS NULL');
  });

  test("a run at its limit, or one that moved on, is not counted", async () => {
    mockUpdateQueryBuilder({ affected: 0 });

    await expect(
      AIRunService.reserveCodeAgentToolCall({
        aiRunId: RUN_ID,
        aiAgentId: AGENT_ID,
        maxToolCalls: 30,
      }),
    ).resolves.toBe(false);

    mockUpdateQueryBuilder({ affected: undefined });

    await expect(
      AIRunService.reserveCodeAgentToolCall({
        aiRunId: RUN_ID,
        aiAgentId: AGENT_ID,
        maxToolCalls: null,
      }),
    ).resolves.toBe(false);
  });
});
