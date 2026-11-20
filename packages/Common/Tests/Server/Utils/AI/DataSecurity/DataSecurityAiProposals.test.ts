import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import Project from "../../../../../Models/DatabaseModels/Project";
import DataSecurityAiProposalService, {
  DataSecurityAiFirstApprovalSet,
  DataSecurityAiProposalTransitionSet,
} from "../../../../../Server/Services/DataSecurityAiProposalService";
import DataSecurityIssueFeedService from "../../../../../Server/Services/DataSecurityIssueFeedService";
import DataStoreFeedService from "../../../../../Server/Services/DataStoreFeedService";
import ProjectService from "../../../../../Server/Services/ProjectService";
import { DataSecurityAiAction } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiAction";
import DataSecurityAiActions from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiActions";
import DataSecurityAiProposals, {
  DISMISS_PERMISSION_MESSAGE,
  DISMISS_REASON_REQUIRED_MESSAGE,
  getProposalApprovalStepChangedMessage,
  PROPOSAL_ALREADY_APPROVED_FIRST_MESSAGE,
  PROPOSAL_APPROVER_MUST_BE_A_PERSON_MESSAGE,
  PROPOSAL_CHANGED_SINCE_SHOWN_MESSAGE,
  PROPOSAL_JUST_ACTED_ON_MESSAGE,
  PROPOSAL_NOT_FOUND_MESSAGE,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiProposals";
import logger from "../../../../../Server/Utils/Logger";
import {
  RemediationApprovalStepKind,
  encodeRemediationApprovalStep,
} from "../../../../../Types/AutoRemediation/RemediationApprovals";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  DataSecurityAiChangeSafety,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWork,
  getDataSecurityAiPlanFingerprint,
} from "../../../../../Types/DataSecurity/DataSecurityAi";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../../Types/Exception/NotFoundException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PROPOSAL OF ONEUPTIME AI'S, FROM WAITING TO MADE, DISMISSED OR UNDONE
 * (#10364): each press held to the person's own permission for the change,
 * a riskier change approved by two people where the project asks for two,
 * every change of state a claim that exactly one press wins, and every one
 * written on the issue's and the store's timelines. The proposal's table is
 * held in memory, its claims answered as Postgres would answer them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10364000-0000-4000-8000-000000000001",
);
const PROPOSAL_ID: string = "10364000-0000-4000-8000-0000000003a1";
const ISSUE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000a1");
const STORE_ID: ObjectID = new ObjectID("10364000-0000-4000-8000-0000000000b1");
const ALICE: ObjectID = new ObjectID("10364000-0000-4000-8000-00000000a11c");
const BOB: ObjectID = new ObjectID("10364000-0000-4000-8000-00000000b0b0");

const PLAN: { kind: string; places: Array<string> } = {
  kind: "Logs",
  places: ["attributes.user.password"],
};

let row: Record<string, unknown>;
let twoApprovals: boolean;
let action: DataSecurityAiAction;
let issueFeed: jest.SpiedFunction<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;
let storeFeed: jest.SpiedFunction<
  typeof DataStoreFeedService.createDataStoreFeedItem
>;

function person(userId: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function proposalRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: new ObjectID(PROPOSAL_ID),
    version: 1,
    projectId: PROJECT_ID,
    dataSecurityIssueId: ISSUE_ID,
    dataStoreId: STORE_ID,
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    work: DataSecurityAiWork.Contain,
    safety: DataSecurityAiChangeSafety.MaskOnly,
    status: DataSecurityAiProposalStatus.Proposed,
    title: "Scrub Password in attributes.user.password of checkout logs",
    plan: PLAN,
    planFingerprint: getDataSecurityAiPlanFingerprint({
      kind: DataSecurityAiProposalKind.ScrubTelemetry,
      plan: PLAN,
    }),
    result: undefined,
    ...overrides,
  };
}

function fingerprint(): string {
  return getDataSecurityAiPlanFingerprint({
    kind: row["kind"],
    plan: row["plan"],
  });
}

function fakeAction(
  overrides: Partial<DataSecurityAiAction> = {},
): DataSecurityAiAction {
  return {
    kind: DataSecurityAiProposalKind.ScrubTelemetry,
    appliesToCheck: (): boolean => {
      return true;
    },
    plan: jest.fn() as never,
    getApproveRefusal: jest.fn((): string | null => {
      return null;
    }) as never,
    getUndoRefusal: jest.fn((): string | null => {
      return null;
    }) as never,
    apply: jest.fn(async () => {
      return {
        result: { rules: [{ scrubRuleId: "rule-1", created: true }] },
        summaryMarkdown: "Scrub rules made: **Data Security: Password**.",
      };
    }) as never,
    undo: jest.fn(async () => {
      return { summaryMarkdown: "Scrub rules deleted." };
    }) as never,
    ...overrides,
  } as DataSecurityAiAction;
}

beforeEach(() => {
  row = proposalRow();
  twoApprovals = false;
  action = fakeAction();

  jest.spyOn(logger, "error").mockImplementation((): void => {});

  // A read as the person finds the row; one as anyone else's would not.
  jest
    .spyOn(DataSecurityAiProposalService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: { _id: ObjectID; projectId: ObjectID };
      props: DatabaseCommonInteractionProps;
    }) => {
      if (
        findBy.query._id.toString() !== PROPOSAL_ID ||
        findBy.query.projectId.toString() !== PROJECT_ID.toString() ||
        (findBy.props as { cannotRead?: boolean }).cannotRead
      ) {
        return null;
      }

      return { ...row } as unknown as DataSecurityAiProposal;
    }) as never);

  // The claims, as Postgres answers them: the WHERE decides.
  jest
    .spyOn(DataSecurityAiProposalService, "attemptTransition")
    .mockImplementation((async (data: {
      fromStatuses: ReadonlyArray<string>;
      set: DataSecurityAiProposalTransitionSet;
      atVersion?: number;
    }) => {
      if (
        !data.fromStatuses.includes(row["status"] as string) ||
        (data.atVersion !== undefined && data.atVersion !== row["version"])
      ) {
        return 0;
      }

      row = { ...row, ...data.set, version: (row["version"] as number) + 1 };
      return 1;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptFirstApproval")
    .mockImplementation((async (data: {
      atVersion: number;
      set: DataSecurityAiFirstApprovalSet;
    }) => {
      if (
        row["status"] !== DataSecurityAiProposalStatus.Proposed ||
        data.atVersion !== row["version"] ||
        (row["firstApprovedByUserId"] &&
          row["firstApprovedPlanFingerprint"] ===
            data.set.firstApprovedPlanFingerprint)
      ) {
        return 0;
      }

      row = {
        ...row,
        firstApprovedByUserId: new ObjectID(data.set.firstApprovedByUserId),
        firstApprovedAt: data.set.firstApprovedAt,
        firstApprovedPlanFingerprint: data.set.firstApprovedPlanFingerprint,
        version: (row["version"] as number) + 1,
      };
      return 1;
    }) as never);
  jest
    .spyOn(DataSecurityAiProposalService, "attemptSecondApproval")
    .mockImplementation((async (data: {
      atVersion: number;
      firstApprovedByUserId: string;
      planFingerprint: string;
      set: DataSecurityAiProposalTransitionSet;
    }) => {
      if (
        row["status"] !== DataSecurityAiProposalStatus.Proposed ||
        data.atVersion !== row["version"] ||
        String(row["firstApprovedByUserId"]) !== data.firstApprovedByUserId ||
        row["firstApprovedPlanFingerprint"] !== data.planFingerprint ||
        data.set.approvedByUserId === data.firstApprovedByUserId
      ) {
        return 0;
      }

      row = { ...row, ...data.set, version: (row["version"] as number) + 1 };
      return 1;
    }) as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return {
      id: PROJECT_ID,
      requireTwoApprovalsForRiskierFixes: twoApprovals,
    } as unknown as Project;
  }) as never);

  jest.spyOn(DataSecurityAiActions, "get").mockImplementation(() => {
    return action;
  });

  issueFeed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
  storeFeed = jest
    .spyOn(DataStoreFeedService, "createDataStoreFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function approveAs(
  userId: ObjectID,
  extra: Record<string, unknown> = {},
): Promise<unknown> {
  return await DataSecurityAiProposals.approve({
    props: person(userId),
    projectId: PROJECT_ID,
    proposalId: PROPOSAL_ID,
    ...extra,
  });
}

describe("approving a proposal", () => {
  test("makes the change as the person who approved it, with their props, and says so on both timelines", async () => {
    const answer: unknown = await approveAs(ALICE, {
      expectedPlanFingerprint: fingerprint(),
      expectedApprovalStep: "only",
    });

    expect(answer).toEqual({
      proposalId: PROPOSAL_ID,
      status: DataSecurityAiProposalStatus.Applied,
      waitsForSecondApproval: false,
    });
    expect(action.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        actor: { props: person(ALICE), userId: ALICE },
      }),
    );
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Applied);
    expect(String(row["approvedByUserId"])).toBe(ALICE.toString());
    expect(row["appliedAt"]).toBeInstanceOf(Date);
    expect(row["result"]).toEqual({
      rules: [{ scrubRuleId: "rule-1", created: true }],
    });
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        dataSecurityIssueId: ISSUE_ID,
        eventType: "AiChangeMade",
        userId: ALICE,
        feedInfoInMarkdown: expect.stringContaining("Scrub rules made"),
      }),
    );
    expect(storeFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        dataStoreId: STORE_ID,
        dataStoreFeedEventType: "AiChangeMade",
        userId: ALICE,
      }),
    );
  });

  test("is refused, with what the change takes, when the person may not make it - and nothing is claimed", async () => {
    action = fakeAction({
      getApproveRefusal: jest.fn(() => {
        return "Approving this makes log scrub rules, and you do not have permission to create them.";
      }) as never,
    });

    await expect(approveAs(ALICE)).rejects.toThrow(
      new NotAuthorizedException(
        "Approving this makes log scrub rules, and you do not have permission to create them.",
      ),
    );
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(action.apply).not.toHaveBeenCalled();
    expect(issueFeed).not.toHaveBeenCalled();
  });

  test("puts it back to wait when making the change is refused for the person", async () => {
    action = fakeAction({
      apply: jest.fn(async () => {
        throw new NotAuthorizedException(
          "You do not have permission to create log scrub rules.",
        );
      }) as never,
    });

    await expect(approveAs(ALICE)).rejects.toThrow(NotAuthorizedException);
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(row["approvedByUserId"]).toBeNull();
    expect(issueFeed).not.toHaveBeenCalled();
  });

  test("records a failure, with why, when the change cannot be made - and nothing changed", async () => {
    action = fakeAction({
      apply: jest.fn(async () => {
        throw new BadDataException("No scrub rule reaches body of Sessions.");
      }) as never,
    });

    await expect(approveAs(ALICE)).rejects.toThrow(
      "The change could not be made, and nothing changed: No scrub rule reaches body of Sessions.",
    );
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Failed);
    expect(row["failureMessage"]).toBe(
      "No scrub rule reaches body of Sessions.",
    );
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "AiChangeFailed", userId: ALICE }),
    );
  });

  test("of a proposal that changed since it was shown does nothing", async () => {
    await expect(
      approveAs(ALICE, { expectedPlanFingerprint: "0000000000000000" }),
    ).rejects.toThrow(PROPOSAL_CHANGED_SINCE_SHOWN_MESSAGE);
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
  });

  test("of one already acted on does nothing", async () => {
    for (const status of [
      DataSecurityAiProposalStatus.Applied,
      DataSecurityAiProposalStatus.Dismissed,
      DataSecurityAiProposalStatus.Expired,
      DataSecurityAiProposalStatus.Undone,
    ]) {
      row = proposalRow({ status });

      await expect(approveAs(ALICE)).rejects.toThrow(
        PROPOSAL_JUST_ACTED_ON_MESSAGE,
      );
    }

    expect(action.apply).not.toHaveBeenCalled();
  });

  test("of two at once, makes the change once", async () => {
    const results: Array<PromiseSettledResult<unknown>> =
      await Promise.allSettled([approveAs(ALICE), approveAs(BOB)]);

    expect(
      results.filter((result: PromiseSettledResult<unknown>): boolean => {
        return result.status === "fulfilled";
      }),
    ).toHaveLength(1);
    expect(action.apply).toHaveBeenCalledTimes(1);
  });

  test("needs a person: OneUptime's own props approve nothing", async () => {
    await expect(
      DataSecurityAiProposals.approve({
        props: { isRoot: true },
        projectId: PROJECT_ID,
        proposalId: PROPOSAL_ID,
      }),
    ).rejects.toThrow(PROPOSAL_APPROVER_MUST_BE_A_PERSON_MESSAGE);
  });

  test("of one the person may not read, or of another project, is not found - the same either way", async () => {
    await expect(
      DataSecurityAiProposals.approve({
        props: {
          ...person(ALICE),
          cannotRead: true,
        } as unknown as DatabaseCommonInteractionProps,
        projectId: PROJECT_ID,
        proposalId: PROPOSAL_ID,
      }),
    ).rejects.toThrow(new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE));
    await expect(
      DataSecurityAiProposals.approve({
        props: person(ALICE),
        projectId: new ObjectID("10364000-0000-4000-8000-000000000999"),
        proposalId: PROPOSAL_ID,
      }),
    ).rejects.toThrow(new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE));
    await expect(
      DataSecurityAiProposals.approve({
        props: person(ALICE),
        projectId: PROJECT_ID,
        proposalId: "not-an-id",
      }),
    ).rejects.toThrow(new NotFoundException(PROPOSAL_NOT_FOUND_MESSAGE));
  });
});

describe("a riskier change, where two people approve one", () => {
  beforeEach(() => {
    twoApprovals = true;
    row = proposalRow({ safety: DataSecurityAiChangeSafety.ChangesAccess });
  });

  test("the first approval is recorded, and nothing is made", async () => {
    expect(await approveAs(ALICE, { expectedApprovalStep: "first" })).toEqual({
      proposalId: PROPOSAL_ID,
      status: DataSecurityAiProposalStatus.Proposed,
      waitsForSecondApproval: true,
    });
    expect(action.apply).not.toHaveBeenCalled();
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
    expect(String(row["firstApprovedByUserId"])).toBe(ALICE.toString());
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "AiProposalApproved",
        userId: ALICE,
      }),
    );
  });

  test("the first approver cannot give the second", async () => {
    await approveAs(ALICE);

    await expect(approveAs(ALICE)).rejects.toThrow(
      PROPOSAL_ALREADY_APPROVED_FIRST_MESSAGE,
    );
    expect(action.apply).not.toHaveBeenCalled();
  });

  test("someone else's second approval makes the change, as them", async () => {
    await approveAs(ALICE);

    expect(
      await approveAs(BOB, {
        expectedApprovalStep: encodeRemediationApprovalStep({
          kind: RemediationApprovalStepKind.Second,
          firstApprovedByUserId: ALICE.toString(),
        }),
      }),
    ).toMatchObject({ status: DataSecurityAiProposalStatus.Applied });
    expect(action.apply).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { props: person(BOB), userId: BOB } }),
    );
    expect(String(row["approvedByUserId"])).toBe(BOB.toString());
  });

  test("a press offered as the only approval does nothing once two are needed", async () => {
    await expect(
      approveAs(ALICE, { expectedApprovalStep: "only" }),
    ).rejects.toThrow(
      getProposalApprovalStepChangedMessage({
        kind: RemediationApprovalStepKind.First,
      }),
    );
    expect(row["firstApprovedByUserId"]).toBeUndefined();
  });

  test("a mask-only change still takes one approval with the rule on", async () => {
    row = proposalRow({ safety: DataSecurityAiChangeSafety.MaskOnly });

    expect(await approveAs(ALICE)).toMatchObject({
      status: DataSecurityAiProposalStatus.Applied,
    });
  });
});

describe("dismissing a proposal", () => {
  function dismissAs(
    props: DatabaseCommonInteractionProps,
    reason: unknown,
  ): Promise<unknown> {
    return DataSecurityAiProposals.dismiss({
      props,
      projectId: PROJECT_ID,
      proposalId: PROPOSAL_ID,
      reason,
    });
  }

  test("keeps it, with who and why, and OneUptime AI does not propose it again", async () => {
    const holdsIssueEdit: DatabaseCommonInteractionProps = {
      ...person(ALICE),
      isMasterAdmin: true,
    };

    expect(
      await dismissAs(holdsIssueEdit, "  Our support team searches by this.  "),
    ).toMatchObject({ status: DataSecurityAiProposalStatus.Dismissed });
    expect(row).toMatchObject({
      status: DataSecurityAiProposalStatus.Dismissed,
      dismissReason: "Our support team searches by this.",
    });
    expect(String(row["dismissedByUserId"])).toBe(ALICE.toString());
    expect(issueFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "AiProposalDismissed",
        feedInfoInMarkdown: expect.stringContaining(
          "Our support team searches by this.",
        ),
      }),
    );
  });

  test("takes the permission to change the issue", async () => {
    await expect(dismissAs(person(ALICE), "No.")).rejects.toThrow(
      new NotAuthorizedException(DISMISS_PERMISSION_MESSAGE),
    );
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Proposed);
  });

  test("takes a reason", async () => {
    await expect(
      dismissAs({ ...person(ALICE), isMasterAdmin: true }, "   "),
    ).rejects.toThrow(DISMISS_REASON_REQUIRED_MESSAGE);
    await expect(
      dismissAs({ ...person(ALICE), isMasterAdmin: true }, undefined),
    ).rejects.toThrow(DISMISS_REASON_REQUIRED_MESSAGE);
  });
});

describe("undoing a change", () => {
  function undoAs(userId: ObjectID): Promise<unknown> {
    return DataSecurityAiProposals.undo({
      props: person(userId),
      projectId: PROJECT_ID,
      proposalId: PROPOSAL_ID,
    });
  }

  test.each([
    [DataSecurityAiProposalStatus.AppliedWithoutAsking, "made without asking"],
    [DataSecurityAiProposalStatus.Applied, "proposed"],
  ])(
    "made %s takes it back as the person, and says so on both timelines",
    async (status: DataSecurityAiProposalStatus, words: string) => {
      row = proposalRow({ status, result: { rules: [] } });

      expect(await undoAs(BOB)).toMatchObject({
        status: DataSecurityAiProposalStatus.Undone,
      });
      expect(action.undo).toHaveBeenCalledWith(
        expect.objectContaining({ actor: { props: person(BOB), userId: BOB } }),
      );
      expect(row["status"]).toBe(DataSecurityAiProposalStatus.Undone);
      expect(String(row["undoneByUserId"])).toBe(BOB.toString());
      expect(issueFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "AiChangeUndone",
          userId: BOB,
          feedInfoInMarkdown: expect.stringContaining(words),
        }),
      );
      expect(storeFeed).toHaveBeenCalledWith(
        expect.objectContaining({ dataStoreFeedEventType: "AiChangeUndone" }),
      );
    },
  );

  test("is refused, with what taking it back takes, and the change stands", async () => {
    row = proposalRow({ status: DataSecurityAiProposalStatus.Applied });
    action = fakeAction({
      getUndoRefusal: jest.fn(() => {
        return "Undoing this deletes log scrub rules, and you do not have permission to delete them.";
      }) as never,
    });

    await expect(undoAs(BOB)).rejects.toThrow(NotAuthorizedException);
    expect(row["status"]).toBe(DataSecurityAiProposalStatus.Applied);
    expect(action.undo).not.toHaveBeenCalled();
  });

  test("that fails leaves the change as it was", async () => {
    row = proposalRow({
      status: DataSecurityAiProposalStatus.AppliedWithoutAsking,
    });
    action = fakeAction({
      undo: jest.fn(async () => {
        throw new NotAuthorizedException(
          "You do not have permission to delete log scrub rules.",
        );
      }) as never,
    });

    await expect(undoAs(BOB)).rejects.toThrow(NotAuthorizedException);
    expect(row["status"]).toBe(
      DataSecurityAiProposalStatus.AppliedWithoutAsking,
    );
    expect(row["undoneByUserId"]).toBeNull();
    expect(issueFeed).not.toHaveBeenCalled();
  });

  test("of a change never made, or undone already, does nothing", async () => {
    for (const status of [
      DataSecurityAiProposalStatus.Proposed,
      DataSecurityAiProposalStatus.Dismissed,
      DataSecurityAiProposalStatus.Undone,
      DataSecurityAiProposalStatus.Failed,
    ]) {
      row = proposalRow({ status });

      await expect(undoAs(BOB)).rejects.toThrow(BadDataException);
    }

    expect(action.undo).not.toHaveBeenCalled();
  });
});

describe("an issue that closed", () => {
  test("whose check passed proves each change made for it, and expires what still waited", async () => {
    const proven: jest.SpiedFunction<
      typeof DataSecurityAiProposalService.markProvenForIssue
    > = jest
      .spyOn(DataSecurityAiProposalService, "markProvenForIssue")
      .mockResolvedValue(1);
    const expired: jest.SpiedFunction<
      typeof DataSecurityAiProposalService.expireWaitingForIssue
    > = jest
      .spyOn(DataSecurityAiProposalService, "expireWaitingForIssue")
      .mockResolvedValue(1);
    const at: Date = new Date("2026-11-20T12:00:00Z");

    await DataSecurityAiProposals.onIssuesClosed({
      issueIds: [ISSUE_ID],
      checkPassed: true,
      now: at,
    });

    expect(proven).toHaveBeenCalledWith({ dataSecurityIssueId: ISSUE_ID, at });
    expect(expired).toHaveBeenCalledWith({
      dataSecurityIssueId: ISSUE_ID,
      at,
    });
  });

  test("that a person set aside proves nothing, and expires what still waited", async () => {
    const proven: jest.SpiedFunction<
      typeof DataSecurityAiProposalService.markProvenForIssue
    > = jest
      .spyOn(DataSecurityAiProposalService, "markProvenForIssue")
      .mockResolvedValue(0);
    const expired: jest.SpiedFunction<
      typeof DataSecurityAiProposalService.expireWaitingForIssue
    > = jest
      .spyOn(DataSecurityAiProposalService, "expireWaitingForIssue")
      .mockResolvedValue(1);

    await DataSecurityAiProposals.onIssuesClosed({
      issueIds: [ISSUE_ID],
      checkPassed: false,
    });

    expect(proven).not.toHaveBeenCalled();
    expect(expired).toHaveBeenCalledTimes(1);
  });

  test("never throws: the issue closed whatever this could write", async () => {
    jest
      .spyOn(DataSecurityAiProposalService, "expireWaitingForIssue")
      .mockRejectedValue(new Error("the database went away"));

    await expect(
      DataSecurityAiProposals.onIssuesClosed({
        issueIds: [ISSUE_ID],
        checkPassed: false,
      }),
    ).resolves.toBeUndefined();
  });
});
