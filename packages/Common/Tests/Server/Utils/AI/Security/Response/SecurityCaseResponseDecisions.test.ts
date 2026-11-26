import DetectionRuleException from "../../../../../../Models/DatabaseModels/DetectionRuleException";
import SecurityCase from "../../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCaseFeed from "../../../../../../Models/DatabaseModels/SecurityCaseFeed";
import DetectionRuleExceptionService from "../../../../../../Server/Services/DetectionRuleExceptionService";
import SecurityCaseAiActionService from "../../../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../../../Server/Services/SecurityCaseService";
import SecurityCaseResponseDecisions, {
  ACTION_NOT_WAITING_MESSAGE,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseDecisions";
import SecurityCaseResponseNudge from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseNudge";
import SecurityCaseHandOff from "../../../../../../Server/Utils/SecurityCase/SecurityCaseHandOff";
import DatabaseCommonInteractionProps from "../../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../../Types/ObjectID";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseHandOffReason,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import { DetectionRuleExceptionKind } from "../../../../../../Types/SecurityEvent/DetectionRuleException";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../../../Server/Utils/Logger");

/*
 * A PERSON'S ANSWER TO WHAT ONEUPTIME AI ASKED ON THE CARD (#10352): a
 * decline turns the step down - OneUptime AI hands the case to people at
 * its next look - an accepted rule exception is made as the person, under
 * their own right to, and Take Over hands the case over without telling
 * anyone. Each answer is one compare-and-set, so two presses decide once.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ACTION_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-000000000001",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const PERSON: DatabaseCommonInteractionProps = {
  userId: PERSON_ID,
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

let asked: SecurityCaseAiAction | null;
let isClaimWon: boolean;
let claims: Array<Record<string, unknown>>;
let updates: Array<Record<string, unknown>>;
let exceptions: Array<{
  data: DetectionRuleException;
  props: DatabaseCommonInteractionProps;
}>;
let feed: Array<string>;
let nudges: number;

function askedRow(kind: SecurityCaseAiActionKind): SecurityCaseAiAction {
  const row: SecurityCaseAiAction = new SecurityCaseAiAction(ACTION_ID);
  row.kind = kind;
  row.status = SecurityCaseAiActionStatus.Asked;
  row.stepKey = "confirm:false-positive:35.196.249.14";
  row.target = "35.196.249.14";
  row.detectionRuleId = RULE_ID;
  row.evidence = {
    entity: { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
  } as never;
  return row;
}

beforeEach(() => {
  asked = askedRow(SecurityCaseAiActionKind.OfferRuleException);
  isClaimWon = true;
  claims = [];
  updates = [];
  exceptions = [];
  feed = [];
  nudges = 0;

  jest
    .spyOn(SecurityCaseAiActionService, "findOneBy")
    .mockImplementation((async () => {
      return asked;
    }) as never);
  jest
    .spyOn(SecurityCaseAiActionService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (args: { data: Record<string, unknown> }) => {
      claims.push(args.data);
      return isClaimWon;
    }) as never);
  jest
    .spyOn(SecurityCaseAiActionService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: { data: Record<string, unknown> }) => {
      updates.push(args.data);
    }) as never);
  jest.spyOn(SecurityCaseService, "findOneBy").mockImplementation((async () => {
    const securityCase: SecurityCase = new SecurityCase(CASE_ID);
    securityCase.caseNumberWithPrefix = "SC-12";
    securityCase.verdict = "False Positive" as never;
    return securityCase;
  }) as never);
  jest
    .spyOn(DetectionRuleExceptionService, "create")
    .mockImplementation((async (args: {
      data: DetectionRuleException;
      props: DatabaseCommonInteractionProps;
    }) => {
      exceptions.push(args);
      return args.data;
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (args: { feedInfoInMarkdown: string }) => {
      feed.push(args.feedInfoInMarkdown);
      return new SecurityCaseFeed();
    }) as never);
  jest
    .spyOn(SecurityCaseResponseNudge, "lookNow")
    .mockImplementation((async () => {
      nudges++;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const decision: {
  projectId: ObjectID;
  securityCaseId: ObjectID;
  actionId: ObjectID;
  props: DatabaseCommonInteractionProps;
} = {
  projectId: PROJECT_ID,
  securityCaseId: CASE_ID,
  actionId: ACTION_ID,
  props: PERSON,
};

describe("an exception OneUptime AI offered the case's rule", () => {
  test("accepted: made as the person, under their own right to, for the value that set the rule off", async () => {
    await SecurityCaseResponseDecisions.approve(decision);

    expect(exceptions).toHaveLength(1);
    expect(exceptions[0]!.props).toBe(PERSON);
    expect(exceptions[0]!.data).toEqual(
      expect.objectContaining({
        detectionRuleId: RULE_ID,
        kind: DetectionRuleExceptionKind.Entity,
        entityType: SecurityEntityType.IpAddress,
        value: "35.196.249.14",
      }),
    );
    expect(exceptions[0]!.data.reason).toContain("SC-12");
    expect(updates[updates.length - 1]).toEqual(
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Done,
        reason: SecurityCaseAiActionReason.Approved,
        decidedByUserId: PERSON_ID,
      }),
    );
  });

  test("refused by the exception's own rules: the offer waits again, and the person is told why", async () => {
    jest
      .spyOn(DetectionRuleExceptionService, "create")
      .mockImplementation((async () => {
        throw new Error("You may not add this rule's exceptions.");
      }) as never);

    await expect(
      SecurityCaseResponseDecisions.approve(decision),
    ).rejects.toThrow("You may not add this rule's exceptions.");
    expect(updates).toEqual([{ status: SecurityCaseAiActionStatus.Asked }]);
  });

  test("declined: dropped, and nothing more happens", async () => {
    await SecurityCaseResponseDecisions.decline(decision);

    expect(claims).toEqual([
      expect.objectContaining({
        status: SecurityCaseAiActionStatus.Declined,
        reason: SecurityCaseAiActionReason.DeclinedByPerson,
        decidedByUserId: PERSON_ID,
      }),
    ]);
    expect(feed).toEqual([]);
    expect(nudges).toBe(0);
  });
});

describe("a step OneUptime AI asked to take on the card", () => {
  test("declined: said on the timeline, and the next look hands the case to people", async () => {
    asked = askedRow(SecurityCaseAiActionKind.MarkStepDone);

    await SecurityCaseResponseDecisions.decline(decision);

    expect(feed).toHaveLength(1);
    expect(feed[0]).toContain("A person turned down what");
    expect(nudges).toBe(1);
  });

  test("two presses at once decide it once", async () => {
    asked = askedRow(SecurityCaseAiActionKind.MarkStepDone);
    isClaimWon = false;

    await expect(
      SecurityCaseResponseDecisions.decline(decision),
    ).rejects.toThrow(ACTION_NOT_WAITING_MESSAGE);
    expect(feed).toEqual([]);
  });

  test("a step that waits on its run is answered where the run is, not here", async () => {
    asked = askedRow(SecurityCaseAiActionKind.BlockAddress);
    asked.securityPlaybookRunId = new ObjectID(
      "55555555-5555-4555-8555-555555555555",
    );

    await expect(
      SecurityCaseResponseDecisions.approve(decision),
    ).rejects.toThrow(ACTION_NOT_WAITING_MESSAGE);
    expect(claims).toEqual([]);
  });
});

describe("Take Over", () => {
  test("hands the case to the person who pressed it, telling nobody else", async () => {
    let handedOff: Record<string, unknown> | undefined;

    jest.spyOn(SecurityCaseHandOff, "handToPeople").mockImplementation((async (
      args: Record<string, unknown>,
    ) => {
      handedOff = args;
      return true;
    }) as never);

    expect(
      await SecurityCaseResponseDecisions.takeOver({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        props: PERSON,
      }),
    ).toBe(true);
    expect(handedOff).toEqual(
      expect.objectContaining({
        reason: SecurityCaseHandOffReason.TakenOver,
        byUserId: PERSON_ID,
      }),
    );
  });
});
