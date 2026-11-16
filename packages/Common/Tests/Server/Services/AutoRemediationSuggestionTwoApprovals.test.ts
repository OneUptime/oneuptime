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
 *  - the first approval: the fix still waits (Suggested), on the version
 *    the approval's checks read, and no first approval of this very fix is
 *    recorded (none, or one given to what the fix no longer runs) - so of
 *    two first approvals at once exactly one is recorded; what it approved
 *    (the plan's fingerprint) is recorded with it; the status is not
 *    touched, nothing runs;
 *  - the second approval: the claim Suggested -> Approved on the version
 *    read, and the first approval is the one the approver was shown, given
 *    to this very fix, and someone else's - so neither a first approval
 *    that moved, nor one given to another plan, nor the first approver's
 *    own second press can run the fix. A press by the first approver is
 *    refused before any query;
 *  - a lone approval's claim is held to the version read too.
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

// The version the approval's checks read, and the fix's fingerprint then.
const VERSION: number = 7;
const PLAN: string = "0123456789abcdef";

describe("attemptFirstApproval", () => {
  test("records who, when, where and what it approved, only on the version read, while the fix waits and has no first approval of this very fix", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);
    const at: Date = new Date("2026-11-06T09:00:00.000Z");

    const changed: number =
      await AutoRemediationSuggestionService.attemptFirstApproval({
        suggestionId: SUGGESTION_ID,
        atVersion: VERSION,
        set: {
          firstApprovedByUserId: MAYA,
          firstApprovedAt: at,
          firstApprovedFrom: AutoRemediationApprovalSource.Dashboard,
          firstApprovedPlanFingerprint: PLAN,
        },
      });

    expect(changed).toBe(1);
    expect(recorded.set).toEqual({
      firstApprovedByUserId: MAYA,
      firstApprovedAt: at,
      firstApprovedFrom: AutoRemediationApprovalSource.Dashboard,
      firstApprovedPlanFingerprint: PLAN,
    });
    // Nothing runs on a first approval: its status is not written.
    expect(recorded.set).not.toHaveProperty("status");
    expect(recorded.wheres).toEqual([
      { clause: '"_id" = :id', parameters: { id: SUGGESTION_ID.toString() } },
      {
        clause: '"status" = :status',
        parameters: { status: AutoRemediationSuggestionStatus.Suggested },
      },
      { clause: '"version" = :version', parameters: { version: VERSION } },
      {
        clause:
          '("firstApprovedByUserId" IS NULL OR "firstApprovedPlanFingerprint" IS DISTINCT FROM :planFingerprint)',
        parameters: { planFingerprint: PLAN },
      },
      { clause: '"deletedAt" IS NULL' },
    ]);
  });

  test("a first approval that lost the race says so: nothing changed", async () => {
    mockUpdateQueryBuilder(0);

    expect(
      await AutoRemediationSuggestionService.attemptFirstApproval({
        suggestionId: SUGGESTION_ID,
        atVersion: VERSION,
        set: {
          firstApprovedByUserId: SAM,
          firstApprovedAt: new Date(),
          firstApprovedFrom: AutoRemediationApprovalSource.MicrosoftTeams,
          firstApprovedPlanFingerprint: PLAN,
        },
      }),
    ).toBe(0);
  });
});

describe("attemptSecondApproval", () => {
  test("claims the fix only on the version read, while it waits, its first approval is the one shown, given to this very fix, and someone else's", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

    const changed: number =
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        atVersion: VERSION,
        firstApprovedByUserId: MAYA,
        firstApprovedPlanFingerprint: PLAN,
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
      { clause: '"version" = :version', parameters: { version: VERSION } },
      {
        clause: '"firstApprovedByUserId" = :firstApprovedByUserId',
        parameters: { firstApprovedByUserId: MAYA },
      },
      {
        clause: '"firstApprovedPlanFingerprint" = :planFingerprint',
        parameters: { planFingerprint: PLAN },
      },
      {
        clause: '"firstApprovedByUserId" <> :approverId',
        parameters: { approverId: SAM },
      },
      { clause: '"deletedAt" IS NULL' },
    ]);
  });

  test.each([
    ["the same id", MAYA],
    ["the same id in capitals", MAYA.toUpperCase()],
    ["the same id with spaces around it", `  ${MAYA} `],
  ])(
    "the first approver's own second press (%s) is refused before any query",
    async (_case: string, approver: string) => {
      const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

      expect(
        await AutoRemediationSuggestionService.attemptSecondApproval({
          suggestionId: SUGGESTION_ID,
          atVersion: VERSION,
          firstApprovedByUserId: MAYA,
          firstApprovedPlanFingerprint: PLAN,
          set: approvalSet(approver),
        }),
      ).toBe(0);
      expect(recorded.executed).toBe(0);
      expect(clauses(recorded)).toEqual([]);
    },
  );

  test("an approval that names nobody is refused before any query", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);
    const set: SuggestionTransitionSet = approvalSet(SAM);
    delete set.approvedByUserId;

    expect(
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        atVersion: VERSION,
        firstApprovedByUserId: MAYA,
        firstApprovedPlanFingerprint: PLAN,
        set,
      }),
    ).toBe(0);
    expect(recorded.executed).toBe(0);
  });

  test("a second approval that names no plan the first approved is refused before any query", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

    expect(
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        atVersion: VERSION,
        firstApprovedByUserId: MAYA,
        firstApprovedPlanFingerprint: "",
        set: approvalSet(SAM),
      }),
    ).toBe(0);
    expect(recorded.executed).toBe(0);
  });

  test("a second approval that lost to someone else says so: nothing changed", async () => {
    mockUpdateQueryBuilder(0);

    expect(
      await AutoRemediationSuggestionService.attemptSecondApproval({
        suggestionId: SUGGESTION_ID,
        atVersion: VERSION,
        firstApprovedByUserId: MAYA,
        firstApprovedPlanFingerprint: PLAN,
        set: approvalSet(SAM),
      }),
    ).toBe(0);
  });
});

describe("attemptStatusTransition", () => {
  test("an approval's claim lands only on the version its checks read", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

    await AutoRemediationSuggestionService.attemptStatusTransition({
      suggestionId: SUGGESTION_ID,
      fromStatus: AutoRemediationSuggestionStatus.Suggested,
      atVersion: VERSION,
      set: approvalSet(SAM),
    });

    expect(recorded.wheres).toEqual([
      { clause: '"_id" = :id', parameters: { id: SUGGESTION_ID.toString() } },
      {
        clause: '"status" = :fromStatus',
        parameters: { fromStatus: AutoRemediationSuggestionStatus.Suggested },
      },
      { clause: '"deletedAt" IS NULL' },
      { clause: '"version" = :version', parameters: { version: VERSION } },
    ]);
  });

  test("a transition that names no version is held to its status alone, as before", async () => {
    const recorded: RecordedUpdate = mockUpdateQueryBuilder(1);

    await AutoRemediationSuggestionService.attemptStatusTransition({
      suggestionId: SUGGESTION_ID,
      fromStatus: AutoRemediationSuggestionStatus.Approved,
      set: { status: AutoRemediationSuggestionStatus.Suggested },
    });

    expect(clauses(recorded)).toEqual([
      '"_id" = :id',
      '"status" = :fromStatus',
      '"deletedAt" IS NULL',
    ]);
  });
});
