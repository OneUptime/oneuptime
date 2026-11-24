import SecurityAutomaticResponseAction from "../../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityAutomaticResponsePolicy from "../../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityAutomaticResponseActionService from "../../../../Server/Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../../../Server/Services/SecurityAutomaticResponsePolicyService";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService, {
  SecurityBlockLiftStatus,
} from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import SecurityAutomaticResponseDoubt from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseDoubt";
import ServerProducts from "../../../../Server/Utils/ServerProducts/ServerProducts";
import ProductKey from "../../../../Types/Product/ProductKey";
import { ServerProductOffReason } from "../../../../Types/Product/ServerProductOffReason";
import SecurityAutomaticResponseOwners from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOwners";
import SecurityAutomaticResponseRecorder, {
  getTimeToBlockInSeconds,
  readSecurityBlockHold,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRecorder";
import SecurityAutomaticResponseTrial, {
  describeTrialFinished,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseTrial";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressState,
  SecuritySignedInManyCheck,
  SecuritySignedInSource,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecuritySignedInAddresses";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import TestSecurityBlockDestination from "../../../../Server/Utils/SecurityBlocklist/TestSecurityBlockDestination";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityAutomaticResponseMode } from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { SecurityAutomaticResponseOutcome } from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockState,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * Automatic response's minute (#10350):
 *
 *   - a policy's block that took hold: its time to block, from the first
 *     request to the edge holding it, on its action and its case, and the
 *     case's line - "OneUptime challenged 35.205.11.131 at Cloudflare for 1
 *     hour (Scanners policy), 41 seconds after its first request." - once;
 *   - undo on doubt: a block a signed-in user was seen from since is
 *     lifted, and the security owners told; a trial's would-have block is
 *     marked as one it would have lifted;
 *   - a trial run's end: written down once, and its summary sent.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const BLOCK_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const ACTION_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const RUN_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ADDRESS: string = "35.205.11.131";
const FIRST_REQUEST: Date = new Date("2026-11-22T10:00:00.000Z");
const APPLIED: Date = new Date("2026-11-22T10:00:41.000Z");

let actions: Array<SecurityAutomaticResponseAction>;
let blocks: Array<SecurityBlock>;
let enforcement: Array<SecurityBlockEnforcement>;
let actionWrites: Array<{ id: string; data: JSONObject }>;
let compareAndSets: Array<{
  table: string;
  data: JSONObject;
  expected: JSONObject;
}>;
let alreadyStamped: boolean;
let timeline: Array<string>;

// Overrides may say a column is empty: no block made yet, say.
function makeAction(
  overrides: {
    [Column in keyof SecurityAutomaticResponseAction]?:
      | SecurityAutomaticResponseAction[Column]
      | undefined;
  } = {},
): SecurityAutomaticResponseAction {
  const action: SecurityAutomaticResponseAction =
    new SecurityAutomaticResponseAction(ACTION_ID);
  action.projectId = PROJECT_ID;
  action.securityAutomaticResponsePolicyId = POLICY_ID;
  action.policyName = "Scanners";
  action.securityCaseId = CASE_ID;
  action.value = ADDRESS;
  action.outcome = SecurityAutomaticResponseOutcome.Challenged;
  action.isTrialRun = false;
  action.blockAction = SecurityBlockAction.Challenge;
  action.duration = SecurityBlockDuration.OneHour;
  action.priorBlockCount = 0;
  action.firstRequestAt = FIRST_REQUEST;
  action.securityBlockId = BLOCK_ID;
  action.securityPlaybookRunId = RUN_ID;
  action.createdAt = new Date("2026-11-22T10:00:20.000Z");
  Object.assign(action, overrides);
  return action;
}

function makeBlock(overrides: Partial<SecurityBlock> = {}): SecurityBlock {
  const block: SecurityBlock = new SecurityBlock(BLOCK_ID);
  block.projectId = PROJECT_ID;
  block.value = ADDRESS;
  block.action = SecurityBlockAction.Challenge;
  block.challengeFallsBackToBlock = true;
  block.state = SecurityBlockState.Active;
  block.createdAt = new Date("2026-11-22T10:00:30.000Z");
  Object.assign(block, overrides);
  return block;
}

function applied(
  name: string,
  key: string,
  at: Date,
): SecurityBlockEnforcement {
  const row: SecurityBlockEnforcement = new SecurityBlockEnforcement();
  row.securityBlockId = BLOCK_ID;
  row.destinationName = name;
  row.destinationKey = key;
  row.state = SecurityBlockEnforcementState.Applied;
  row.appliedAt = at;
  row.lastConfirmedAt = at;
  return row;
}

beforeEach(() => {
  actions = [];
  blocks = [makeBlock()];
  enforcement = [];
  actionWrites = [];
  compareAndSets = [];
  alreadyStamped = false;
  timeline = [];

  SecurityBlockDestinations.setSourcesForTests([
    {
      provider: SecurityBlockDestinationProvider.Test,
      findForProject: async () => {
        return [
          new TestSecurityBlockDestination({
            key: "Test:cloudflare",
            name: "Cloudflare",
            canChallenge: true,
          }),
          new TestSecurityBlockDestination({
            key: "Test:feed",
            name: "Palo Alto feed",
            canChallenge: false,
          }),
        ];
      },
    },
  ]);

  jest
    .spyOn(SecurityAutomaticResponseActionService, "findBy")
    .mockImplementation((async () => {
      return actions;
    }) as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "findOneBy")
    .mockImplementation((async () => {
      return actions[0] || null;
    }) as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      actionWrites.push({ id: data.id.toString(), data: data.data });
    }) as never);
  jest
    .spyOn(
      SecurityAutomaticResponseActionService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (data: {
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      compareAndSets.push({
        table: "Action",
        data: data.data,
        expected: data.expectedData,
      });
      return !alreadyStamped;
    }) as never);
  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (data: {
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      compareAndSets.push({
        table: "Case",
        data: data.data,
        expected: data.expectedData,
      });
      return true;
    }) as never);
  jest
    .spyOn(SecurityBlockEnforcementService, "findForBlocks")
    .mockImplementation((async () => {
      return enforcement;
    }) as never);
  jest
    .spyOn(SecurityBlockService, "findByIds")
    .mockImplementation((async () => {
      return blocks;
    }) as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
      timeline.push(data.feedInfoInMarkdown);
    }) as never);
});

afterEach(() => {
  SecurityBlockDestinations.resetSourcesForTests();
  jest.restoreAllMocks();
});

describe("time to block, and the case's line", () => {
  test("a block that holds is said on its case once, with its time to block on the action and the case", async () => {
    actions = [makeAction()];
    enforcement = [applied("Cloudflare", "Test:cloudflare", APPLIED)];

    expect(
      await SecurityAutomaticResponseRecorder.recordBlocksTakingHold(),
    ).toBe(1);

    expect(timeline).toEqual([
      "🛡️ OneUptime challenged `35.205.11.131` at Cloudflare for 1 hour (Scanners policy), 41\u00A0seconds after its first request.",
    ]);

    const [actionStamp, caseStamp] = compareAndSets;
    expect(actionStamp).toEqual({
      table: "Action",
      data: {
        appliedAt: APPLIED,
        timeToBlockInSeconds: 41,
        enforcedAt: {
          destinations: [{ name: "Cloudflare", heldAsBlock: false }],
        },
      },
      expected: { appliedAt: null },
    });
    expect(caseStamp).toEqual({
      table: "Case",
      data: { blockedAt: APPLIED, timeToBlockInSeconds: 41 },
      expected: { blockedAt: null },
    });
  });

  test("an edge that cannot challenge holds the challenge as a block, and the line says so", async () => {
    actions = [makeAction()];
    enforcement = [
      applied("Cloudflare", "Test:cloudflare", APPLIED),
      applied(
        "Palo Alto feed",
        "Test:feed",
        new Date("2026-11-22T10:01:30.000Z"),
      ),
    ];

    await SecurityAutomaticResponseRecorder.recordBlocksTakingHold();

    expect(timeline[0]).toBe(
      "🛡️ OneUptime challenged `35.205.11.131` at Cloudflare and Palo Alto feed for 1 hour (Scanners policy), 41\u00A0seconds after its first request. Palo Alto feed cannot challenge, so it blocks the address there for the same time.",
    );
  });

  test("a longer block of a repeat offender says why", async () => {
    actions = [
      makeAction({
        duration: SecurityBlockDuration.OneDay,
        priorBlockCount: 1,
      }),
    ];
    enforcement = [applied("Cloudflare", "Test:cloudflare", APPLIED)];

    await SecurityAutomaticResponseRecorder.recordBlocksTakingHold();

    expect(timeline[0]).toBe(
      "🛡️ OneUptime challenged `35.205.11.131` at Cloudflare for 24 hours (Scanners policy), 41\u00A0seconds after its first request. The block is longer because it was blocked once before in the last 30 days.",
    );
  });

  test("written once: of two at the same moment, the one that stamps the action writes the line", async () => {
    actions = [makeAction()];
    enforcement = [applied("Cloudflare", "Test:cloudflare", APPLIED)];
    alreadyStamped = true;

    expect(
      await SecurityAutomaticResponseRecorder.recordBlocksTakingHold(),
    ).toBe(0);
    expect(timeline).toHaveLength(0);
  });

  test("a block not held anywhere yet waits", async () => {
    actions = [makeAction()];
    enforcement = [];

    expect(
      await SecurityAutomaticResponseRecorder.recordBlocksTakingHold(),
    ).toBe(0);
    expect(compareAndSets).toHaveLength(0);
  });

  test("a block never made within half an hour is failed, with the run's words", async () => {
    actions = [
      makeAction({
        securityBlockId: undefined,
        createdAt: new Date(Date.now() - 31 * 60 * 1000),
      }),
    ];
    const run: SecurityPlaybookRun = new SecurityPlaybookRun(RUN_ID);
    run.errorMessage =
      "The run stopped without finishing: the worker running it was restarted or timed out.";
    jest
      .spyOn(SecurityPlaybookRunService, "findOneById")
      .mockResolvedValue(run);

    await SecurityAutomaticResponseRecorder.recordBlocksTakingHold();

    expect(actionWrites).toEqual([
      {
        id: ACTION_ID.toString(),
        data: {
          outcome: SecurityAutomaticResponseOutcome.Failed,
          detail:
            "The block was never made: The run stopped without finishing: the worker running it was restarted or timed out.",
        },
      },
    ]);
  });

  test("a block still being made within half an hour is left to be made", async () => {
    actions = [
      makeAction({
        securityBlockId: undefined,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
      }),
    ];

    await SecurityAutomaticResponseRecorder.recordBlocksTakingHold();

    expect(actionWrites).toHaveLength(0);
  });

  test("seconds after the first request, never less than none", () => {
    expect(
      getTimeToBlockInSeconds({
        firstRequestAt: FIRST_REQUEST,
        appliedAt: APPLIED,
      }),
    ).toBe(41);
    expect(
      getTimeToBlockInSeconds({
        firstRequestAt: APPLIED,
        appliedAt: FIRST_REQUEST,
      }),
    ).toBe(0);
    expect(
      getTimeToBlockInSeconds({ firstRequestAt: null, appliedAt: APPLIED }),
    ).toBeNull();
  });

  test("a hold is the earliest destination that applied it", () => {
    expect(
      readSecurityBlockHold({
        rows: [
          applied("AWS WAF", "Test:aws", new Date("2026-11-22T10:02:00.000Z")),
          applied("Cloudflare", "Test:cloudflare", APPLIED),
        ],
        canChallenge: () => {
          return true;
        },
        isFallbackChallenge: true,
      })?.appliedAt,
    ).toEqual(APPLIED);
  });
});

describe("the block step", () => {
  test("a block made and holding at once: its action names it, and the case's line is written now", async () => {
    actions = [makeAction({ securityBlockId: undefined })];
    enforcement = [applied("Cloudflare", "Test:cloudflare", APPLIED)];

    const wrote: boolean =
      await SecurityAutomaticResponseRecorder.recordBlockStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        policyId: POLICY_ID,
        securityCaseId: CASE_ID,
        value: ADDRESS,
        block: makeBlock(),
        failure: null,
      });

    expect(wrote).toBe(true);
    expect(actionWrites[0]!.data).toEqual({
      securityBlockId: BLOCK_ID,
      blockedAt: new Date("2026-11-22T10:00:30.000Z"),
      securityPlaybookRunId: RUN_ID,
    });
    expect(timeline).toHaveLength(1);
  });

  test("a block that failed is recorded as failed, with why", async () => {
    actions = [makeAction({ securityBlockId: undefined })];

    const wrote: boolean =
      await SecurityAutomaticResponseRecorder.recordBlockStep({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        policyId: POLICY_ID,
        securityCaseId: CASE_ID,
        value: ADDRESS,
        block: null,
        failure: "35.205.11.131 is one of your project's own addresses.",
      });

    expect(wrote).toBe(false);
    expect(actionWrites[0]!.data).toEqual({
      outcome: SecurityAutomaticResponseOutcome.Failed,
      detail: "35.205.11.131 is one of your project's own addresses.",
    });
  });
});

describe("undo on doubt", () => {
  let manyCheck: SecuritySignedInManyCheck;
  let lifts: Array<JSONObject>;
  let told: Array<{ subject: string; messageInMarkdown: string }>;

  beforeEach(() => {
    lifts = [];
    told = [];
    manyCheck = {
      state: SecuritySignedInAddressState.SignedIn,
      usersByAddress: new Map([
        [
          ADDRESS,
          [
            {
              name: "jane@example.com",
              source: SecuritySignedInSource.Requests,
              lastSeenAt: new Date(Date.now() - 60 * 1000),
            },
          ],
        ],
      ]),
    };
    jest
      .spyOn(SecuritySignedInAddresses, "checkMany")
      .mockImplementation(async () => {
        return manyCheck;
      });
    jest.spyOn(SecurityBlockService, "lift").mockImplementation((async (
      data: JSONObject,
    ) => {
      lifts.push(data);
      return { status: SecurityBlockLiftStatus.Lifted };
    }) as never);
    jest
      .spyOn(SecurityAutomaticResponseOwners, "tell")
      .mockImplementation(
        async (data: { subject: string; messageInMarkdown: string }) => {
          told.push(data);
          return 1;
        },
      );
  });

  test("a signed-in user seen from a blocked address since: the policy lifts its block, tells the security owners and the case", async () => {
    actions = [
      makeAction({
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        blockedAt: new Date(Date.now() - 10 * 60 * 1000),
      }),
    ];

    expect(await SecurityAutomaticResponseDoubt.liftOnDoubt()).toBe(1);

    expect(compareAndSets[0]!.expected).toEqual({ doubtSeenAt: null });
    expect(compareAndSets[0]!.data["doubtDetail"]).toBe(
      "A signed-in user was seen from 35.205.11.131 after the policy acted on it: jane@example.com.",
    );
    expect(lifts).toHaveLength(1);
    expect(lifts[0]!["securityBlockId"]).toEqual(BLOCK_ID);
    expect(lifts[0]!["props"]).toEqual({ isRoot: true });
    expect(String(lifts[0]!["reason"])).toBe(
      "A signed-in user (jane@example.com) was seen from 35.205.11.131, so the Scanners policy lifted its block.",
    );
    expect(told[0]!.subject).toBe(
      "Scanners policy lifted its block of 35.205.11.131",
    );
    expect(timeline).toEqual([
      "↩️ The Scanners policy lifted its block of `35.205.11.131`: a signed-in user was seen from it since (jane@example.com). Your security owners were told.",
    ]);
  });

  test("a trial's would-have block is marked as one it would have lifted: nothing is lifted, nobody told", async () => {
    actions = [
      makeAction({
        isTrialRun: true,
        securityBlockId: undefined,
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
      }),
    ];

    expect(await SecurityAutomaticResponseDoubt.liftOnDoubt()).toBe(1);
    expect(compareAndSets[0]!.data["doubtSeenAt"]).toBeInstanceOf(Date);
    expect(lifts).toHaveLength(0);
    expect(told).toHaveLength(0);
  });

  test("a user seen before the block was made is no doubt", async () => {
    actions = [
      makeAction({
        createdAt: new Date(Date.now() - 10 * 60 * 1000),
        blockedAt: new Date(Date.now() - 10 * 60 * 1000),
      }),
    ];
    manyCheck = {
      state: SecuritySignedInAddressState.SignedIn,
      usersByAddress: new Map([
        [
          ADDRESS,
          [
            {
              name: "jane@example.com",
              source: SecuritySignedInSource.Requests,
              lastSeenAt: new Date(Date.now() - 60 * 60 * 1000),
            },
          ],
        ],
      ]),
    };

    expect(await SecurityAutomaticResponseDoubt.liftOnDoubt()).toBe(0);
    expect(lifts).toHaveLength(0);
  });

  test("when OneUptime cannot tell, nothing is lifted: the block ends by itself", async () => {
    actions = [
      makeAction({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }),
    ];
    manyCheck = {
      state: SecuritySignedInAddressState.CannotTell,
      reason: "OneUptime could not read the requests and sign-ins just now.",
    };

    expect(await SecurityAutomaticResponseDoubt.liftOnDoubt()).toBe(0);
    expect(lifts).toHaveLength(0);
  });

  test("a block lifted or ended meanwhile is no longer the policy's to lift", async () => {
    actions = [
      makeAction({ createdAt: new Date(Date.now() - 10 * 60 * 1000) }),
    ];
    blocks = [makeBlock({ state: SecurityBlockState.Lifted })];

    expect(await SecurityAutomaticResponseDoubt.liftOnDoubt()).toBe(0);
    expect(lifts).toHaveLength(0);
  });

  test("a block past its length is not asked about", async () => {
    actions = [
      makeAction({
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        blockedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      }),
    ];

    expect(await SecurityAutomaticResponseDoubt.liftOnDoubt()).toBe(0);
  });
});

describe("the trial run's end", () => {
  let told: Array<{ subject: string; messageInMarkdown: string }>;

  beforeEach(() => {
    told = [];
    jest
      .spyOn(SecurityAutomaticResponseOwners, "tell")
      .mockImplementation(
        async (data: { subject: string; messageInMarkdown: string }) => {
          told.push(data);
          return 1;
        },
      );
  });

  test("is written down once, and the security owners told what it would have done", async () => {
    const policy: SecurityAutomaticResponsePolicy =
      new SecurityAutomaticResponsePolicy(POLICY_ID);
    policy.projectId = PROJECT_ID;
    policy.name = "Scanners";
    policy.mode = SecurityAutomaticResponseMode.TrialRun;
    policy.blockAction = SecurityBlockAction.Challenge;
    policy.trialStartedAt = new Date("2026-11-15T10:00:00.000Z");
    policy.trialEndsAt = new Date("2026-11-22T10:00:00.000Z");

    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "findTrialsDue")
      .mockResolvedValue([policy]);
    jest
      .spyOn(
        SecurityAutomaticResponsePolicyService,
        "compareAndSetColumnsByIdWithoutHooks",
      )
      .mockImplementation((async (data: {
        data: JSONObject;
        expectedData: JSONObject;
      }) => {
        compareAndSets.push({
          table: "Policy",
          data: data.data,
          expected: data.expectedData,
        });
        return true;
      }) as never);
    actions = [
      makeAction({ isTrialRun: true, value: "35.205.11.131" }),
      makeAction({ isTrialRun: true, value: "35.205.11.132" }),
    ];

    expect(
      await SecurityAutomaticResponseTrial.finishDueTrials(
        new Date("2026-11-22T10:01:00.000Z"),
      ),
    ).toBe(1);

    expect(compareAndSets[0]).toEqual({
      table: "Policy",
      data: { trialFinishedAt: new Date("2026-11-22T10:00:00.000Z") },
      expected: {
        trialFinishedAt: null,
        mode: SecurityAutomaticResponseMode.TrialRun,
      },
    });
    expect(told[0]!.subject).toBe(
      "Your Scanners policy finished its trial run",
    );
    expect(told[0]!.messageInMarkdown).toContain(
      "In 7 days it would have challenged 2 addresses.",
    );
    expect(told[0]!.messageInMarkdown).toContain(
      "None had signed-in users, and none were yours.",
    );
  });

  /*
   * While Security Events is switched off, no policy decides, so a trial
   * run has nothing to count (#10816): none finishes, and its week stands
   * still - each sweep that finds the product off ends every running trial
   * a sweep later, compare-and-set on its end.
   */
  test("stands still while Security Events is switched off: none finishes, and each running trial ends a minute later", async () => {
    const running: SecurityAutomaticResponsePolicy =
      new SecurityAutomaticResponsePolicy(POLICY_ID);
    running.mode = SecurityAutomaticResponseMode.TrialRun;
    running.trialEndsAt = new Date("2026-11-22T10:00:00.000Z");

    jest
      .spyOn(ServerProducts, "getOffReasonOfServerWork")
      .mockImplementation((async (product: ProductKey) => {
        return product === ProductKey.SecurityEvents
          ? ServerProductOffReason.SwitchedOff
          : null;
      }) as never);
    let dueReads: number = 0;
    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "findTrialsDue")
      .mockImplementation(async () => {
        dueReads++;
        return [running];
      });
    jest
      .spyOn(SecurityAutomaticResponsePolicyService, "findBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        expect(data.query["mode"]).toBe(SecurityAutomaticResponseMode.TrialRun);
        return [running];
      }) as never);
    jest
      .spyOn(
        SecurityAutomaticResponsePolicyService,
        "compareAndSetColumnsByIdWithoutHooks",
      )
      .mockImplementation((async (data: {
        data: JSONObject;
        expectedData: JSONObject;
      }) => {
        compareAndSets.push({
          table: "Policy",
          data: data.data,
          expected: data.expectedData,
        });
        return true;
      }) as never);

    expect(
      await SecurityAutomaticResponseTrial.finishDueTrials(
        new Date("2026-11-22T10:01:00.000Z"),
      ),
    ).toBe(0);

    expect(dueReads).toBe(0);
    expect(told).toHaveLength(0);
    expect(compareAndSets).toEqual([
      {
        table: "Policy",
        data: { trialEndsAt: new Date("2026-11-22T10:01:00.000Z") },
        expected: {
          trialEndsAt: new Date("2026-11-22T10:00:00.000Z"),
          mode: SecurityAutomaticResponseMode.TrialRun,
        },
      },
    ]);
  });

  test("says what the guardrails spared, and what it would have lifted", () => {
    const text: string = describeTrialFinished({
      policyName: "Password Guessing",
      blockAction: SecurityBlockAction.Block,
      summary: {
        wouldActOn: 1283,
        wouldHaveLifted: 2,
        sparedSignedIn: 3,
        sparedProtected: 1,
        sparedCannotTell: 4,
        wouldHaveStopped: 1,
      },
      link: null,
    });

    expect(text).toContain("In 7 days it would have blocked 1,283 addresses.");
    expect(text).toContain(
      "It left 3 addresses alone because signed-in users had used them, and 1 address because they are yours.",
    );
    expect(text).toContain("so it would have lifted those blocks");
    expect(text).toContain("left them for a person");
    expect(text).toContain("in an hour once, and paged your security owners");
    expect(text).toContain(
      "Turn it on from Security Events -> Playbooks -> Automatic Response.",
    );
  });
});
