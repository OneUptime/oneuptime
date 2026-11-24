import Project from "../../../../../../Models/DatabaseModels/Project";
import SecurityBlock from "../../../../../../Models/DatabaseModels/SecurityBlock";
import SecurityCase from "../../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityCaseFeed from "../../../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityPlaybookRun from "../../../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Semaphore from "../../../../../../Server/Infrastructure/Semaphore";
import ProjectService from "../../../../../../Server/Services/ProjectService";
import SecurityBlockService from "../../../../../../Server/Services/SecurityBlockService";
import SecurityCaseAiActionService from "../../../../../../Server/Services/SecurityCaseAiActionService";
import SecurityCaseFeedService from "../../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService, {
  AiStepRunRequest,
} from "../../../../../../Server/Services/SecurityPlaybookRunService";
import SecurityCaseResponseAfterClose, {
  SECURITY_CASE_AFTER_CLOSE_LOCK_WAIT_MS,
  SecurityCaseAfterCloseOutcome,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseAfterClose";
import SecurityCaseResponseLook from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseLook";
import SecurityCaseResponseNudge from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseNudge";
import { SECURITY_CASE_RESPONSE_LOCK_NAMESPACE } from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponseRunner";
import SecurityPlaybookEngine from "../../../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import ServerProducts from "../../../../../../Server/Utils/ServerProducts/ServerProducts";
import PositiveNumber from "../../../../../../Types/PositiveNumber";
import ObjectID from "../../../../../../Types/ObjectID";
import ProductKey from "../../../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../../../Types/Product/ServerProductOffReason";
import { SecurityBlockState } from "../../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiMode,
  SecurityCaseAiResponseState,
  SecurityCaseHandOffReason,
  SECURITY_CASE_AI_DEFAULT_MODES,
  SECURITY_CASE_AI_HAND_OFF_STEP_KEY,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import {
  SECURITY_CASE_AI_ACTION_REASON_SENTENCES,
  SECURITY_CASE_HAND_OFF_SENTENCES,
} from "../../../../../../Types/SecurityCase/SecurityCaseAiWords";
import SecurityCaseAiVerdict from "../../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriorityLevel from "../../../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookApprovalDecision } from "../../../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { RESPONSE_STEP_KINDS } from "../../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import { ResponseActionKind } from "../../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import {
  testPriorityId,
  testStatusId,
} from "../../../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../../../Helpers/SecurityCaseValuesStub";
import { getJestSpyOn } from "../../../../../Spy";
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
 * WHAT FOLLOWS ONEUPTIME AI'S OWN CLOSE OF A CASE (#10847).
 *
 * Closing a case ends OneUptime AI's work on it, so no look ever came after
 * its own close: the close never read as done, its closing report was
 * never written, and a close of a false positive or a benign case never
 * lifted the case's blocks nor offered its rule an exception, as #10683
 * planned (planAfterDismissal). The engine now carries that out as the
 * close's run finishes - the same steps and approval rules, with no look -
 * unless a person reopened the case or took it over first, or Security
 * Events is switched off; and once, however often it runs.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PERSON_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CLOSE_RUN_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555551",
);
const LIFT_RUN_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555552",
);
const BLOCK_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666661");
const RULE_ID: string = "77777777-7777-4777-8777-777777777771";
const ADDRESS: string = "35.196.249.14";
const NOW: Date = new Date("2026-11-24T02:00:00.000Z");
const ASKED_AT: Date = new Date("2026-11-24T01:00:00.000Z");
const REPORT: string = "## What happened\n\nA scanner probed known paths.";

const FALSE_POSITIVE_KEY: string = RESPONSE_STEP_KINDS.falsePositive;

// The case, as the database holds it.
let caseRow: Record<string, unknown>;
// OneUptime AI's log of the case, as the database holds it, in order.
let rows: Array<SecurityCaseAiAction>;
// The engine's runs, by id.
let runs: Map<string, SecurityPlaybookRun>;
let isProductOff: boolean;
let actionsOnItsOwnThisHour: number;
let onLiftStarted: (() => void) | null;
// What was done.
let startedRuns: Array<AiStepRunRequest>;
let timeline: Array<string>;
let caseWrites: Array<Record<string, unknown>>;
let rowIds: number;

function closedCase(aiVerdict: SecurityCaseAiVerdict): void {
  caseRow = {
    _id: CASE_ID.toString(),
    projectId: PROJECT_ID,
    caseNumberWithPrefix: "SEC-12",
    title: `Web scanner from ${ADDRESS}`,
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
    securityCasePriorityId: testPriorityId(SecurityCasePriorityLevel.Medium),
    aiVerdict,
    // Closing it finished OneUptime AI's work on it (SecurityCaseService).
    aiResponseState: SecurityCaseAiResponseState.Finished,
    aiTookCaseAt: new Date("2026-11-24T00:10:00.000Z"),
    createdAt: new Date("2026-11-24T00:00:00.000Z"),
    closedAt: NOW,
  };
}

function row(
  kind: SecurityCaseAiActionKind,
  status: SecurityCaseAiActionStatus,
  extra: Partial<SecurityCaseAiAction> = {},
): SecurityCaseAiAction {
  rowIds++;

  const action: SecurityCaseAiAction = new SecurityCaseAiAction(
    new ObjectID(`aaaaaaaa-aaaa-4aaa-8aaa-${String(rowIds).padStart(12, "0")}`),
  );
  action.projectId = PROJECT_ID;
  action.securityCaseId = CASE_ID;
  action.kind = kind;
  action.status = status;
  action.reason = SecurityCaseAiActionReason.OnItsOwn;
  action.createdAt = new Date(ASKED_AT.getTime() + rowIds * 1000);
  Object.assign(action, extra);
  return action;
}

/*
 * OneUptime AI's work on the case up to its close: it took the case,
 * blocked the address, and asked to close it - a person approved, and the
 * engine's run of that close has just finished.
 */
function workedUpToTheClose(verdict: SecurityCaseVerdict): void {
  rows.push(
    row(SecurityCaseAiActionKind.TakeCase, SecurityCaseAiActionStatus.Done, {
      stepKey: "triage:assign",
    }),
    row(
      SecurityCaseAiActionKind.BlockAddress,
      SecurityCaseAiActionStatus.Done,
      { stepKey: `contain:block-ip:${ADDRESS}`, target: ADDRESS },
    ),
    row(SecurityCaseAiActionKind.CloseCase, SecurityCaseAiActionStatus.Asked, {
      stepKey: RESPONSE_STEP_KINDS.close,
      reason: SecurityCaseAiActionReason.SettingAsks,
      askedAt: ASKED_AT,
      securityPlaybookRunId: CLOSE_RUN_ID,
      report: REPORT,
    }),
  );

  const close: SecurityPlaybookRun = new SecurityPlaybookRun(CLOSE_RUN_ID);
  close.status = SecurityPlaybookRunStatus.Succeeded;
  close.completedAt = NOW;
  close.steps = [
    {
      id: "close",
      action: SecurityPlaybookActionType.SetCaseStatus,
      config: {
        statusId: testStatusId(SecurityCaseStage.Closed).toString(),
        verdict,
      },
      requiresApproval: true,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ] as never;
  close.stepResults = [
    {
      stepId: "close",
      action: SecurityPlaybookActionType.SetCaseStatus,
      status: SecurityPlaybookStepStatus.Succeeded,
      approval: {
        decision: SecurityPlaybookApprovalDecision.Approved,
        decidedAt: NOW.toISOString(),
        decidedByUserId: PERSON_ID.toString(),
      },
    },
  ] as never;
  runs.set(CLOSE_RUN_ID.toString(), close);
}

function productIsOff(isOff: boolean): void {
  isProductOff = isOff;
}

function rowsOf(kind: SecurityCaseAiActionKind): Array<SecurityCaseAiAction> {
  return rows.filter((action: SecurityCaseAiAction): boolean => {
    return action.kind === kind;
  });
}

function timelineText(): string {
  return timeline.join("\n");
}

async function followUp(): Promise<SecurityCaseAfterCloseOutcome> {
  return await SecurityCaseResponseAfterClose.followUp({
    projectId: PROJECT_ID,
    securityCaseId: CASE_ID,
    now: NOW,
  });
}

beforeEach(() => {
  rowIds = 0;
  rows = [];
  runs = new Map<string, SecurityPlaybookRun>();
  isProductOff = false;
  actionsOnItsOwnThisHour = 0;
  onLiftStarted = null;
  startedRuns = [];
  timeline = [];
  caseWrites = [];
  closedCase(SecurityCaseAiVerdict.LikelyFalsePositive);

  stubSecurityCaseValues();

  getJestSpyOn(ServerProducts, "getOffReasonOfServerWork").mockImplementation(
    async (product: ProductKey) => {
      return product === ProductKey.SecurityEvents && isProductOff
        ? ServerProductOffReason.SwitchedOff
        : null;
    },
  );

  getJestSpyOn(Semaphore, "lock").mockResolvedValue({ key: "lock" });
  getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);

  getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
    async (args: { query: Record<string, unknown> }) => {
      if (String(args.query["_id"]) !== CASE_ID.toString()) {
        return null;
      }

      const securityCase: SecurityCase = new SecurityCase(CASE_ID);
      Object.assign(securityCase, caseRow);
      return securityCase;
    },
  );
  getJestSpyOn(
    SecurityCaseService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(async (args: { data: Record<string, unknown> }) => {
    caseWrites.push(args.data);
    Object.assign(caseRow, args.data);
  });

  getJestSpyOn(ProjectService, "findOneById").mockImplementation(async () => {
    const project: Project = new Project(PROJECT_ID);
    project.enableAi = true;
    project.enableAutomaticSecurityCaseResponse = true;
    project.securityCaseAiCloseMode = SecurityCaseAiMode.Ask;
    project.securityCaseAiEdgeMode = SECURITY_CASE_AI_DEFAULT_MODES.Edge;
    return project;
  });

  // OneUptime AI's log: read as it stands - copies, as a read gives them - and written as the toolkit writes it.
  getJestSpyOn(SecurityCaseAiActionService, "findBy").mockImplementation(
    async () => {
      return rows.map((stored: SecurityCaseAiAction): SecurityCaseAiAction => {
        return Object.assign(new SecurityCaseAiAction(stored.id!), stored);
      });
    },
  );
  getJestSpyOn(SecurityCaseAiActionService, "create").mockImplementation(
    async (args: { data: SecurityCaseAiAction }) => {
      rowIds++;
      const created: SecurityCaseAiAction = args.data;
      created.id = new ObjectID(
        `bbbbbbbb-bbbb-4bbb-8bbb-${String(rowIds).padStart(12, "0")}`,
      );
      created.createdAt = NOW;
      rows.push(created);
      return created;
    },
  );
  getJestSpyOn(
    SecurityCaseAiActionService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(
    async (args: { id: ObjectID; data: Record<string, unknown> }) => {
      const updated: SecurityCaseAiAction | undefined = rows.find(
        (action: SecurityCaseAiAction): boolean => {
          return action.id?.toString() === args.id.toString();
        },
      );

      if (updated) {
        Object.assign(updated, args.data);
      }
    },
  );
  getJestSpyOn(SecurityCaseAiActionService, "countBy").mockImplementation(
    async () => {
      return new PositiveNumber(actionsOnItsOwnThisHour);
    },
  );

  // The engine's runs: how each of OneUptime AI's steps went.
  getJestSpyOn(SecurityPlaybookRunService, "findBy").mockImplementation(
    async () => {
      return [...runs.values()];
    },
  );
  getJestSpyOn(SecurityPlaybookRunService, "startAiStepRun").mockImplementation(
    async (request: AiStepRunRequest) => {
      startedRuns.push(request);

      const lift: SecurityPlaybookRun = new SecurityPlaybookRun(LIFT_RUN_ID);
      lift.status = SecurityPlaybookRunStatus.Queued;
      lift.steps = [request.step] as never;
      lift.stepResults = [] as never;
      runs.set(LIFT_RUN_ID.toString(), lift);

      onLiftStarted?.();
      return lift;
    },
  );

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (args: { feedInfoInMarkdown: string }) => {
    timeline.push(args.feedInfoInMarkdown);
    return new SecurityCaseFeed();
  });

  // The case's blocks: the one OneUptime AI made.
  const block: SecurityBlock = new SecurityBlock(BLOCK_ID);
  block.value = ADDRESS;
  block.state = SecurityBlockState.Active;
  getJestSpyOn(SecurityBlockService, "findBy").mockResolvedValue([block]);
  getJestSpyOn(SecurityBlockService, "findByIds").mockResolvedValue([block]);

  // The case's Response Plan: its close, and the rule's exception for the address.
  getJestSpyOn(SecurityCaseResponseLook, "readPlan").mockImplementation(
    async () => {
      return {
        plan: {
          steps: [
            {
              key: RESPONSE_STEP_KINDS.close,
              text: { template: "Close the case with a verdict.", values: {} },
              quotes: [],
              isOutsideOneUptime: false,
            },
            {
              key: FALSE_POSITIVE_KEY,
              text: {
                template: "If it is a false positive, add an exception.",
                values: {},
              },
              quotes: [],
              isOutsideOneUptime: false,
              action: {
                kind: ResponseActionKind.AddRuleException,
                title: "Add exception",
                detectionRuleId: RULE_ID,
                entity: { type: SecurityEntityType.IpAddress, value: ADDRESS },
              },
            },
          ],
        } as never,
        matches: null,
        playbooks: [],
      };
    },
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a close of OneUptime AI's own as a false positive or a benign case", () => {
  test.each([
    [
      SecurityCaseAiVerdict.LikelyFalsePositive,
      SecurityCaseVerdict.FalsePositive,
    ],
    [SecurityCaseAiVerdict.LikelyBenign, SecurityCaseVerdict.BenignPositive],
  ])(
    "read as %s: the close reads as done, its report is written, the case's blocks are lifted and its rule is offered an exception",
    async (aiVerdict: SecurityCaseAiVerdict, verdict: SecurityCaseVerdict) => {
      closedCase(aiVerdict);
      workedUpToTheClose(verdict);

      expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.FollowedUp);

      // The close, settled from its run: done once a person approved it.
      const close: SecurityCaseAiAction = rowsOf(
        SecurityCaseAiActionKind.CloseCase,
      )[0]!;
      expect(close.status).toBe(SecurityCaseAiActionStatus.Done);
      expect(close.reason).toBe(SecurityCaseAiActionReason.Approved);

      // Its closing report: the case's closing note, and on the timeline.
      expect(caseRow["closingNote"]).toBe(REPORT);
      expect(timelineText()).toContain("closing report.**");

      // The case's blocks lifted, through the engine, as the close went: approved.
      expect(startedRuns).toHaveLength(1);
      expect(startedRuns[0]!.step.action).toBe(
        SecurityPlaybookActionType.LiftAddressBlock,
      );
      expect(startedRuns[0]!.step.requiresApproval).toBe(false);
      expect(
        (startedRuns[0]!.targets || []).map(
          (target: { value: string }): string => {
            return target.value;
          },
        ),
      ).toEqual([ADDRESS]);

      const lift: SecurityCaseAiAction = rowsOf(
        SecurityCaseAiActionKind.LiftBlock,
      )[0]!;
      expect(lift.status).toBe(SecurityCaseAiActionStatus.Doing);
      expect(lift.reason).toBe(SecurityCaseAiActionReason.Approved);
      expect(lift.securityPlaybookRunId).toEqual(LIFT_RUN_ID);

      // The rule's exception, offered: it always waits for a person.
      const offer: SecurityCaseAiAction = rowsOf(
        SecurityCaseAiActionKind.OfferRuleException,
      )[0]!;
      expect(offer.status).toBe(SecurityCaseAiActionStatus.Asked);
      expect(offer.reason).toBe(SecurityCaseAiActionReason.AlwaysAsks);
      expect(offer.detectionRuleId?.toString()).toBe(RULE_ID);
      expect(offer.target).toBe(ADDRESS);
      expect(timelineText()).toContain("asks a person to approve:");
      expect(timelineText()).toContain(`exception for ${ADDRESS}`);

      // No look was needed: the case stays done with.
      expect(caseRow["aiResponseState"]).toBe(
        SecurityCaseAiResponseState.Finished,
      );
    },
  );

  test("nothing is done twice when it runs twice: the close's run and a later one's, or a job run again", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.FollowedUp);

    const entries: number = timeline.length;

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);
    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);

    expect(startedRuns).toHaveLength(1);
    expect(rowsOf(SecurityCaseAiActionKind.LiftBlock)).toHaveLength(1);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)).toHaveLength(1);
    expect(
      caseWrites.filter((write: Record<string, unknown>): boolean => {
        return write["closingNote"] !== undefined;
      }),
    ).toHaveLength(1);
    expect(timeline).toHaveLength(entries);
  });

  test("the lift's own run, once it finishes, reads as done on the log", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    await followUp();

    // The engine lifted the block.
    const lift: SecurityPlaybookRun = runs.get(LIFT_RUN_ID.toString())!;
    lift.status = SecurityPlaybookRunStatus.Succeeded;
    lift.completedAt = NOW;
    lift.stepResults = [
      {
        stepId: "lift",
        action: SecurityPlaybookActionType.LiftAddressBlock,
        status: SecurityPlaybookStepStatus.Succeeded,
      },
    ] as never;

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);
    expect(rowsOf(SecurityCaseAiActionKind.LiftBlock)[0]!.status).toBe(
      SecurityCaseAiActionStatus.Done,
    );
    expect(startedRuns).toHaveLength(1);
  });

  test("a case with no block of its own is offered the exception only", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    getJestSpyOn(SecurityBlockService, "findBy").mockResolvedValue([]);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.FollowedUp);
    expect(startedRuns).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.LiftBlock)).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)).toHaveLength(1);
  });

  test("the hour's limit on its actions stops the lift: the timeline says what is left, and why", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    actionsOnItsOwnThisHour = 10;

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.LeftForPeople);
    expect(startedRuns).toEqual([]);
    expect(timelineText()).toContain(
      "AI left what follows its close to a person.**",
    );
    expect(timelineText()).toContain(
      SECURITY_CASE_HAND_OFF_SENTENCES[
        SecurityCaseHandOffReason.BreakerTripped
      ],
    );
  });
});

describe("what does not follow", () => {
  test("a close as True Positive: its report is written, and nothing more", async () => {
    closedCase(SecurityCaseAiVerdict.LikelyMalicious);
    workedUpToTheClose(SecurityCaseVerdict.TruePositive);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);
    expect(caseRow["closingNote"]).toBe(REPORT);
    expect(startedRuns).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)).toEqual([]);
  });

  test("a person's own close of a case OneUptime AI read as a false positive: nothing of OneUptime AI's follows", async () => {
    rows.push(
      row(SecurityCaseAiActionKind.TakeCase, SecurityCaseAiActionStatus.Done),
    );

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);
    expect(startedRuns).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(caseWrites).toEqual([]);
    expect(timeline).toEqual([]);
  });

  test("a case still open - a run of OneUptime AI's finished on it - is one read, and nothing more", async () => {
    caseRow["closedAt"] = null;
    caseRow["securityCaseStatusId"] = testStatusId(SecurityCaseStage.New);
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.NotClosed);
    expect(Semaphore.lock).not.toHaveBeenCalled();
    expect(SecurityCaseAiActionService.findBy).not.toHaveBeenCalled();
  });
});

describe("a person first", () => {
  test("reopened before it ran: nothing follows - no report, no lift, no exception", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    caseRow["closedAt"] = null;
    caseRow["securityCaseStatusId"] = testStatusId(SecurityCaseStage.New);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.NotClosed);
    expect(startedRuns).toEqual([]);
    expect(caseWrites).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.LiftBlock)).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)).toEqual([]);
  });

  test("reopened while it went on: the exception is not offered once the case is open again", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    onLiftStarted = (): void => {
      caseRow["closedAt"] = null;
    };

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Reopened);
    expect(startedRuns).toHaveLength(1);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)).toEqual([]);
  });

  test("took the case over before the close was approved: the close is theirs, and nothing of OneUptime AI's follows it", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    // Take Over, pressed while OneUptime AI's close waited for approval.
    rows.push(
      row(
        SecurityCaseAiActionKind.HandToPeople,
        SecurityCaseAiActionStatus.Done,
        {
          stepKey: SECURITY_CASE_AI_HAND_OFF_STEP_KEY,
          reason: SecurityCaseAiActionReason.HandedOff,
          handOffReason: SecurityCaseHandOffReason.TakenOver,
          decidedByUserId: PERSON_ID,
        },
      ),
    );

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);
    expect(startedRuns).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.LiftBlock)).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)).toEqual([]);
  });

  test("a look still holds the case: it reads how the close went itself", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Lock is held."),
    );

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.LookUnderWay);
    expect(Semaphore.lock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: CASE_ID.toString(),
        namespace: SECURITY_CASE_RESPONSE_LOCK_NAMESPACE,
        acquireTimeout: SECURITY_CASE_AFTER_CLOSE_LOCK_WAIT_MS,
      }),
    );
    expect(startedRuns).toEqual([]);
    expect(caseWrites).toEqual([]);
  });
});

describe("while Security Events is switched off", () => {
  test("what follows the close is left for a person, on the log and the timeline, and never taken up by itself", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    productIsOff(true);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.ProductOff);

    // The close itself happened: its report is on the case.
    expect(caseRow["closingNote"]).toBe(REPORT);
    // No new step started.
    expect(startedRuns).toEqual([]);

    const left: Array<SecurityCaseAiAction> = rows.filter(
      (action: SecurityCaseAiAction): boolean => {
        return action.status === SecurityCaseAiActionStatus.Left;
      },
    );
    expect(
      left.map((action: SecurityCaseAiAction) => {
        return [action.kind, action.reason];
      }),
    ).toEqual([
      [
        SecurityCaseAiActionKind.LiftBlock,
        SecurityCaseAiActionReason.ProductOff,
      ],
      [
        SecurityCaseAiActionKind.OfferRuleException,
        SecurityCaseAiActionReason.ProductOff,
      ],
    ]);
    expect(timelineText()).toContain(
      `AI left what follows its close to a person.** ${SECURITY_CASE_AI_ACTION_REASON_SENTENCES[SecurityCaseAiActionReason.ProductOff]}`,
    );

    // Switched on again: nothing resumes by itself.
    productIsOff(false);

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Settled);
    expect(startedRuns).toEqual([]);
    expect(rowsOf(SecurityCaseAiActionKind.LiftBlock)).toHaveLength(1);
  });

  test("switched off after the lift started: the exception is left for a person", async () => {
    workedUpToTheClose(SecurityCaseVerdict.FalsePositive);
    onLiftStarted = (): void => {
      productIsOff(true);
    };

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.ProductOff);
    expect(startedRuns).toHaveLength(1);
    expect(rowsOf(SecurityCaseAiActionKind.OfferRuleException)[0]!.status).toBe(
      SecurityCaseAiActionStatus.Left,
    );
  });
});

describe("the engine", () => {
  test("follows up as one of OneUptime AI's own runs finishes - and only one of its own, only once", async () => {
    const followedUp: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityCaseResponseAfterClose,
      "followUp",
    ).mockResolvedValue(SecurityCaseAfterCloseOutcome.Settled);
    getJestSpyOn(SecurityCaseResponseNudge, "lookNow").mockResolvedValue(
      undefined,
    );
    let isFinishedNow: boolean = true;
    getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockImplementation(async () => {
      return isFinishedNow;
    });

    await SecurityPlaybookEngine.finishRun({
      runId: CLOSE_RUN_ID,
      status: SecurityPlaybookRunStatus.Succeeded,
      aiCase: { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    });

    expect(followedUp).toHaveBeenCalledTimes(1);
    expect(followedUp).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    // A person's run, or one another worker finished first: nothing more.
    await SecurityPlaybookEngine.finishRun({
      runId: CLOSE_RUN_ID,
      status: SecurityPlaybookRunStatus.Succeeded,
    });

    isFinishedNow = false;

    await SecurityPlaybookEngine.finishRun({
      runId: CLOSE_RUN_ID,
      status: SecurityPlaybookRunStatus.Succeeded,
      aiCase: { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    });

    expect(followedUp).toHaveBeenCalledTimes(1);
  });

  test("never throws to the engine", async () => {
    getJestSpyOn(SecurityCaseService, "findOneBy").mockRejectedValue(
      new Error("The database went away."),
    );

    expect(await followUp()).toBe(SecurityCaseAfterCloseOutcome.Failed);
  });
});
