import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AutoRemediationSuggestionService, {
  SuggestionTransitionSet,
} from "../../../Server/Services/AutoRemediationSuggestionService";
import AutoRemediationApprovalSource from "../../../Types/AutoRemediation/AutoRemediationApprovalSource";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "../../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE TWO WRITES OF A RISKIER FIX'S TWO APPROVALS (#6148's follow-up),
 * each one conditional UPDATE whose WHERE says what makes it right:
 *
 *  - the first approval: the fix still waits (Suggested) and nobody approved
 *    it first yet - so of two first approvals at once exactly one is
 *    recorded; the status is not touched, nothing runs;
 *  - the second approval: the claim Suggested -> Approved, and the first
 *    approval is the one the approver was shown, and someone else's - so
 *    neither a first approval that moved nor the first approver's own
 *    second press can run the fix. A press by the first approver is
 *    refused before any query.
 *
 * The query builder is recorded, not run: what each write sends is pinned.
 */

interface RecordedUpdate {
  set: Record<string, unknown> | null;
  wheres: Array<{ clause: string; parameters?: Record<string, unknown> }>;
  executed: number;
}

function mockUpdateQueryBuilder(affected: number = 1): RecordedUpdate {
  const recorded: RecordedUpdate = { set: null, wheres: [], executed: 0 };

  const builder: Record<string, unknown> = {
    update: () => {
      return builder;
    },
    set: (values: Record<string, unknown>) => {
      recorded.set = values;
      return builder;
    },
    where: (clause: string, parameters?: Record<string, unknown>) => {
      recorded.wheres.push({ clause, ...(parameters ? { parameters } : {}) });
      return builder;
    },
    andWhere: (clause: string, parameters?: Record<string, unknown>) => {
      recorded.wheres.push({ clause, ...(parameters ? { parameters } : {}) });
      return builder;
    },
    execute: async () => {
      recorded.executed++;
      return { affected };
    },
  };

  jest
    .spyOn(AutoRemediationSuggestionService, "getRepository")
    .mockReturnValue({
      createQueryBuilder: () => {
        return builder;
      },
    } as never);

  return recorded;
}

const SUGGESTION_ID: ObjectID = new ObjectID(
  "9b000000-0000-4000-8000-000000000001",
);
const MAYA: string = "9b000000-0000-4000-8000-0000000000aa";
const SAM: string = "9b000000-0000-4000-8000-0000000000bb";

function clauses(recorded: RecordedUpdate): Array<string> {
  return recorded.wheres.map((where: { clause: string }): string => {
    return where.clause;
  });
}

function approvalSet(approver: string): SuggestionTransitionSet {
  return {
    status: AutoRemediationSuggestionStatus.Approved,
    approvedByUserId: approver,
    approvedAt: new Date("2026-11-06T10:00:00.000Z"),
    approvedFrom: AutoRemediationApprovalSource.Slack,
    verificationStatus: AutoRemediationVerificationStatus.Pending,
    verificationDeadlineAt: new Date("2026-11-06T10:15:00.000Z"),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("attemptFirstApproval", () => {
  test("records who, when and where, only while the fix waits and nobody approved it first", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);
    const at: Date = new Date("2026-11-06T09:00:00.000Z");

    const changed: number =
      await AutoRemediationSuggestionService.attemptFirstApproval({
        suggestionId: SUGGESTION_ID,
        set: {
          firstApprovedByUserId: MAYA,
          firstApprovedAt: at,
          firstApprovedFrom: AutoRemediationApprovalSource.Dashboard,
        },
      });

    expect(changed).toBe(1);
    expect(recorded.set).toEqual({
      firstApprovedByUserId: MAYA,
      firstApprovedAt: at,
      firstApprovedFrom: AutoRemediationApprovalSource.Dashboard,
    });
    // Nothing runs on a first approval: its status is not written.
    expect(recorded.set).not.toHaveProperty("status");
    expect(recorded.wheres).toEqual([
      { clause: '"_id" = :id', parameters: { id: SUGGESTION_ID.toString() } },
      {
        clause: '"status" = :status',
        parameters: { status: AutoRemediationSuggestionStatus.Suggested },
      },
      { clause: '"firstApprovedByUserId" IS NULL' },
      { clause: '"deletedAt" IS NULL' },
    ]);
  });

  test("a first approval that lost the race says so: nothing changed", async () => {
    mockUpdateQueryBuilder(0);

    expect(
      await AutoRemediationSuggestionService.attemptFirstApproval({
        suggestionId: SUGGESTION_ID,
        set: {
          firstApprovedByUserId: SAM,
          firstApprovedAt: new Date(),
          firstApprovedFrom: AutoRemediationApprovalSource.MicrosoftTeams,
        },
      }),
    ).toBe(0);
  });
});

describe("attemptSecondApproval", () => {
  test("claims the fix only while it waits, its first approval is the one shown, and is someone else's", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

    const changed: number =
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        firstApprovedByUserId: MAYA,
        set: approvalSet(SAM),
      });

    expect(changed).toBe(1);
    expect(recorded.set).toEqual(approvalSet(SAM));
    expect(recorded.wheres).toEqual([
      { clause: '"_id" = :id', parameters: { id: SUGGESTION_ID.toString() } },
      {
        clause: '"status" = :fromStatus',
        parameters: { fromStatus: AutoRemediationSuggestionStatus.Suggested },
      },
      {
        clause: '"firstApprovedByUserId" = :firstApprovedByUserId',
        parameters: { firstApprovedByUserId: MAYA },
      },
      {
        clause: '"firstApprovedByUserId" <> :approverId',
        parameters: { approverId: SAM },
      },
      { clause: '"deletedAt" IS NULL' },
    ]);
  });

  test("the first approver's own second press is refused before any query, whatever the case of the ids", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

    expect(
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        firstApprovedByUserId: MAYA,
        set: approvalSet(MAYA.toUpperCase()),
      }),
    ).toBe(0);
    expect(recorded.executed).toBe(0);
    expect(clauses(recorded)).toEqual([]);
  });

  test("an approval that names nobody is refused before any query", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);
    const set: SuggestionTransitionSet = approvalSet(SAM);
    delete set.approvedByUserId;

    expect(
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        firstApprovedByUserId: MAYA,
        set,
      }),
    ).toBe(0);
    expect(recorded.executed).toBe(0);
  });

  test("a second approval that lost to someone else says so: nothing changed", async () => {
    mockUpdateQueryBuilder(0);

    expect(
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        firstApprovedByUserId: MAYA,
        set: approvalSet(SAM),
      }),
    ).toBe(0);
  });
});
