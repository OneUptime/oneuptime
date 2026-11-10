import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A round of an AI fix started again, or put back (RemediationRound
 * .tryAgain, issue #6487): one conditional UPDATE whose WHERE carries the
 * round as it was read - its status AND its run - so of two presses at
 * once exactly one names its run, a round that moved on meanwhile is left
 * alone, and a deleted row is never written.
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

  jest
    .spyOn(AutoRemediationSuggestionService, "getRepository")
    .mockReturnValue({
      createQueryBuilder: () => {
        return builder;
      },
    } as never);

  return { recorded };
}

const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OLD_RUN_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const NEW_RUN_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999990",
);

describe("AutoRemediationSuggestionService.attemptRoundRunChange", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("names the new run only on the round as it was read: its id, status and run, undeleted", async () => {
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await expect(
      AutoRemediationSuggestionService.attemptRoundRunChange({
        suggestionId: SUGGESTION_ID,
        fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
        fromAiRunId: OLD_RUN_ID,
        set: {
          status: AutoRemediationSuggestionStatus.Planning,
          aiRunId: NEW_RUN_ID.toString(),
          commandPlan: null,
          mcpToolCallPlan: null,
          rationaleMarkdown: null,
        },
      }),
    ).resolves.toBe(1);

    // Exactly what a round started again changes, and nothing else.
    expect(recorded.set).toEqual({
      status: AutoRemediationSuggestionStatus.Planning,
      aiRunId: NEW_RUN_ID.toString(),
      commandPlan: null,
      mcpToolCallPlan: null,
      rationaleMarkdown: null,
    });

    expect(recorded.wheres).toEqual([
      { clause: '"_id" = :id', parameters: { id: SUGGESTION_ID.toString() } },
      {
        clause: '"status" = :fromStatus',
        parameters: {
          fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
        },
      },
      { clause: '"deletedAt" IS NULL', parameters: {} },
      {
        clause: '"aiRunId" = :fromAiRunId',
        parameters: { fromAiRunId: OLD_RUN_ID.toString() },
      },
    ]);
  });

  test("a round read with no run is changed only while it still has none", async () => {
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await AutoRemediationSuggestionService.attemptRoundRunChange({
      suggestionId: SUGGESTION_ID,
      fromStatus: AutoRemediationSuggestionStatus.Planning,
      fromAiRunId: null,
      set: {
        status: AutoRemediationSuggestionStatus.Planning,
        aiRunId: NEW_RUN_ID.toString(),
        commandPlan: null,
        mcpToolCallPlan: null,
        rationaleMarkdown: null,
      },
    });

    expect(recorded.wheres[3]).toEqual({
      clause: '"aiRunId" IS NULL',
      parameters: {},
    });
  });

  test("putting a round back names its old run again, from the run this press named", async () => {
    const { recorded } = mockUpdateQueryBuilder({ affected: 1 });

    await AutoRemediationSuggestionService.attemptRoundRunChange({
      suggestionId: SUGGESTION_ID,
      fromStatus: AutoRemediationSuggestionStatus.Planning,
      fromAiRunId: NEW_RUN_ID,
      set: {
        status: AutoRemediationSuggestionStatus.NoneApplicable,
        aiRunId: OLD_RUN_ID.toString(),
        commandPlan: null,
        mcpToolCallPlan: null,
        rationaleMarkdown: "The AI fix did not finish.",
      },
    });

    expect(recorded.wheres[1]!.parameters).toEqual({
      fromStatus: AutoRemediationSuggestionStatus.Planning,
    });
    expect(recorded.wheres[3]!.parameters).toEqual({
      fromAiRunId: NEW_RUN_ID.toString(),
    });
    expect(recorded.set?.["aiRunId"]).toBe(OLD_RUN_ID.toString());
  });

  test.each([
    [0, 0],
    [undefined, 0],
  ])(
    "another actor won (affected %s): it says so with %s",
    async (affected: number | undefined, expected: number) => {
      mockUpdateQueryBuilder({ affected });

      await expect(
        AutoRemediationSuggestionService.attemptRoundRunChange({
          suggestionId: SUGGESTION_ID,
          fromStatus: AutoRemediationSuggestionStatus.NoneApplicable,
          fromAiRunId: OLD_RUN_ID,
          set: {
            status: AutoRemediationSuggestionStatus.Planning,
            aiRunId: NEW_RUN_ID.toString(),
            commandPlan: null,
            mcpToolCallPlan: null,
            rationaleMarkdown: null,
          },
        }),
      ).resolves.toBe(expected);
    },
  );
});
