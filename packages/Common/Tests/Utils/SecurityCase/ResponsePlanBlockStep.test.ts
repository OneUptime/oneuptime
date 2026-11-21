import { SecurityBlockAction } from "../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  getCaseBlockableAddresses,
  isCaseBlockableAddress,
} from "../../../Utils/SecurityCase/ResponsePlan/BlockableAddresses";
import { canonicalAddress } from "../../../Utils/SecurityCase/SecurityConnectionMatch";
import {
  ResponsePlanInput,
  buildResponsePlan,
  getContainmentSteps,
  readAddressBlockRuns,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  ResponseActionKind,
  ResponseAddressBlock,
  ResponseAddressBlocking,
  ResponsePlan,
  ResponsePlaybookRunState,
  ResponseStep,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import {
  ACTION_BLOCK_FOR_A_DAY,
  STEP_BLOCK_AT_DESTINATIONS,
  STEP_BLOCK_FAILED,
  STEP_BLOCK_PUBLIC_IP,
  STEP_BLOCK_RUNNING,
  STEP_BLOCK_WAITING,
  STEP_ISOLATE_PRIVATE_IP,
} from "../../../Utils/SecurityCase/ResponsePlan/ResponsePlanWords";
import { describe, expect, test } from "@jest/globals";

/*
 * THE BLOCK STEP OF A CASE'S RESPONSE PLAN, AS EVERY READER OF THE PLAN
 * BUILDS IT (#10342): a public address of the case is blocked from the
 * plan once the plan knows the project's blocklist - where it is
 * enforced, the blocks that hold the case's addresses, and where a block
 * from the case stands - and is done only once a destination enforces the
 * block. Without the blocklist (the server's checks, OneUptime AI), the
 * step is the one done outside OneUptime it was.
 */

const ADDRESS: string = "35.196.249.14";
const KEY: string = `contain:block-ip:${ADDRESS}`;

function detection(
  groupValue: string,
  events: Array<SecurityCaseMatchedEventJson> = [],
): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: `Path traversal attempts — ${groupValue}`,
    severity: "Medium",
    groupValue,
    ruleName: "Path traversal attempts",
    eventCount: 12,
    fireCount: 1,
    firstSeenAt: "2026-11-17T19:28:00.000Z",
    lastSeenAt: "2026-11-17T19:28:00.000Z",
    sampleMessage: "",
    isOpening: true,
    rule: null,
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: "2026-11-17T19:22:00.000Z",
    windowEnd: "2026-11-17T19:29:00.000Z",
    events,
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 12,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 12 },
  };
}

function matchesOf(
  opening: SecurityCaseMatchedDetectionJson,
): SecurityCaseMatchesJson {
  return {
    detections: [opening],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

function blocking(
  overrides: Partial<ResponseAddressBlocking> = {},
): ResponseAddressBlocking {
  return {
    destinations: ["Cloudflare", "AWS WAF"],
    blocks: [],
    runStates: {},
    ...overrides,
  };
}

function block(overrides: Partial<ResponseAddressBlock> = {}): ResponseAddressBlock {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    value: ADDRESS,
    action: SecurityBlockAction.Block,
    createdAt: new Date("2026-11-21T10:42:00.000Z"),
    expiresAt: new Date("2026-11-22T10:42:00.000Z"),
    createdByName: "Jane Doe",
    enforcedAt: ["Cloudflare"],
    enforcedSince: new Date("2026-11-21T10:42:30.000Z"),
    pendingAt: [],
    notAppliedAt: [],
    ...overrides,
  };
}

function plan(overrides: Partial<ResponsePlanInput> = {}): ResponsePlan {
  return buildResponsePlan({
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    isAssigned: false,
    hasIncident: false,
    stage: SecurityCaseStage.New,
    hasContainedStatus: true,
    matches: matchesOf(detection(ADDRESS)),
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    ...overrides,
  });
}

function blockStep(built: ResponsePlan, key: string = KEY): ResponseStep {
  const step: ResponseStep | undefined = built.steps.find(
    (candidate: ResponseStep): boolean => {
      return candidate.key === key;
    },
  );

  expect({ key, found: Boolean(step) }).toEqual({ key, found: true });

  return step!;
}

describe("without the blocklist: the step done outside OneUptime, as before", () => {
  test("the server's and OneUptime AI's plan: Outside OneUptime, the address to copy, no button", () => {
    const step: ResponseStep = blockStep(plan());

    expect(step.text).toEqual({
      template: STEP_BLOCK_PUBLIC_IP,
      values: { value: ADDRESS },
    });
    expect(step.isOutsideOneUptime).toBe(true);
    expect(step.copyValue).toBe(ADDRESS);
    expect(step.action).toBeUndefined();
    expect(step.isBlockHelpShown).toBeUndefined();
  });

  test("the step keeps its key either way: a tick or a check of it is the same step's", () => {
    expect(blockStep(plan({ addressBlocking: blocking() })).key).toBe(
      blockStep(plan()).key,
    );
  });
});

describe("with the blocklist", () => {
  test("nothing enforces it: block it where the address reaches the app, with how to connect what would - never Outside OneUptime", () => {
    const step: ResponseStep = blockStep(
      plan({ addressBlocking: blocking({ destinations: [] }) }),
    );

    expect(step.text).toEqual({
      template: STEP_BLOCK_PUBLIC_IP,
      values: { value: ADDRESS },
    });
    expect(step.isOutsideOneUptime).toBe(false);
    expect(step.isBlockHelpShown).toBe(true);
    expect(step.copyValue).toBe(ADDRESS);
    expect(step.address).toBe(ADDRESS);
    expect(step.action).toBeUndefined();
    expect(step.isDone).toBe(false);
  });

  test("a destination enforces it: the step names where, and Block for 24 Hours blocks the address", () => {
    const step: ResponseStep = blockStep(plan({ addressBlocking: blocking() }));

    expect(step.text).toEqual({
      template: STEP_BLOCK_AT_DESTINATIONS,
      values: { value: ADDRESS },
      lists: { destinations: ["Cloudflare", "AWS WAF"] },
    });
    expect(step.isOutsideOneUptime).toBe(false);
    expect(step.copyValue).toBeUndefined();
    expect(step.action).toEqual({
      kind: ResponseActionKind.BlockAddress,
      title: ACTION_BLOCK_FOR_A_DAY,
      entity: { type: SecurityEntityType.IpAddress, value: ADDRESS },
    });
    expect(step.isDone).toBe(false);
  });

  test.each([
    [ResponsePlaybookRunState.Waiting, STEP_BLOCK_WAITING, false, false],
    [ResponsePlaybookRunState.Running, STEP_BLOCK_RUNNING, false, false],
    [ResponsePlaybookRunState.Failed, STEP_BLOCK_FAILED, true, true],
  ])(
    "a block from the case %s: said, its button %s",
    (
      state: ResponsePlaybookRunState,
      template: string,
      isWarning: boolean,
      hasButton: boolean,
    ) => {
      const step: ResponseStep = blockStep(
        plan({
          addressBlocking: blocking({ runStates: { [ADDRESS]: state } }),
        }),
      );

      expect(step.detail).toEqual({ template, values: {} });
      expect(Boolean(step.isDetailWarning)).toBe(isWarning);
      expect(Boolean(step.action)).toBe(hasButton);
      expect(step.isDone).toBe(false);
    },
  );

  test("a block a destination enforces: drawn on the step, which the case has done - nothing to press", () => {
    const held: ResponseAddressBlock = block();
    const built: ResponsePlan = plan({
      addressBlocking: blocking({ blocks: [held] }),
    });
    const step: ResponseStep = blockStep(built);

    expect(step.addressBlock).toEqual(held);
    expect(step.address).toBe(ADDRESS);
    expect(step.isDone).toBe(true);
    expect(step.action).toBeUndefined();
    expect(getContainmentSteps(built.steps)).toContain(step);
  });

  test.each([
    ["still being applied", block({ enforcedAt: [], pendingAt: ["Cloudflare"] })],
    [
      "turned down everywhere",
      block({
        enforcedAt: [],
        notAppliedAt: [{ name: "Cloudflare", reason: "The list is full." }],
      }),
    ],
    ["held nowhere", block({ enforcedAt: [] })],
  ])(
    "a block %s is drawn, and never done: a block nothing enforces blocks nothing",
    (_name: string, held: ResponseAddressBlock) => {
      const step: ResponseStep = blockStep(
        plan({ addressBlocking: blocking({ blocks: [held] }) }),
      );

      expect(step.addressBlock).toEqual(held);
      expect(step.isDone).toBe(false);
      // Already on the blocklist: no second block.
      expect(step.action).toBeUndefined();
    },
  );

  test("a range around the address holds it", () => {
    const range: ResponseAddressBlock = block({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000002",
      value: "35.196.249.0/24",
    });
    const step: ResponseStep = blockStep(
      plan({
        addressBlocking: blocking({
          blocks: [block({ value: "35.196.250.7" }), range],
        }),
      }),
    );

    expect(step.addressBlock).toEqual(range);
    expect(step.isDone).toBe(true);
  });

  test("a closed case keeps its block, with nothing more to press", () => {
    const step: ResponseStep = blockStep(
      plan({
        stage: SecurityCaseStage.Closed,
        addressBlocking: blocking(),
      }),
    );

    expect(step.action).toBeUndefined();
  });

  test("a private address is found, never blocked: no blocklist changes its step", () => {
    const step: ResponseStep = blockStep(
      plan({
        entities: [{ type: SecurityEntityType.IpAddress, value: "10.0.3.17" }],
        matches: matchesOf(detection("10.0.3.17")),
        addressBlocking: blocking(),
      }),
      "contain:find-ip:10.0.3.17",
    );

    expect(step.text.template).toBe(STEP_ISOLATE_PRIVATE_IP);
    expect(step.action).toBeUndefined();
    expect(step.addressBlock).toBeUndefined();
  });
});

describe("where a block from the case stands", () => {
  function run(data: {
    status: SecurityPlaybookRunStatus;
    value?: string;
    securityPlaybookId?: string;
    action?: SecurityPlaybookActionType;
  }): {
    securityPlaybookId?: unknown;
    status: string;
    steps?: unknown;
    stepResults?: unknown;
  } {
    const action: SecurityPlaybookActionType =
      data.action || SecurityPlaybookActionType.BlockAddress;

    return {
      securityPlaybookId: data.securityPlaybookId,
      status: data.status,
      steps: [
        {
          id: "step-1",
          action,
          config:
            action === SecurityPlaybookActionType.BlockAddress
              ? { blockAction: "Block", duration: "OneDay" }
              : {},
        },
      ],
      stepResults: [
        {
          stepId: "step-1",
          action,
          status: "Pending",
          targets: [
            {
              type: SecurityEntityType.IpAddress,
              value: data.value || ADDRESS,
              reason: "On the Case",
              state: "Proposed",
            },
          ],
        },
      ],
    };
  }

  test("by address, from its newest run: waiting, running or failed", () => {
    expect(
      readAddressBlockRuns([
        run({ status: SecurityPlaybookRunStatus.WaitingForApproval }),
        run({ status: SecurityPlaybookRunStatus.Failed }),
        run({ status: SecurityPlaybookRunStatus.Queued, value: "35.205.11.131" }),
        run({ status: SecurityPlaybookRunStatus.Failed, value: "35.205.12.7" }),
      ]),
    ).toEqual({
      [ADDRESS]: ResponsePlaybookRunState.Waiting,
      "35.205.11.131": ResponsePlaybookRunState.Running,
      "35.205.12.7": ResponsePlaybookRunState.Failed,
    });
  });

  test("a run that made its block, was cancelled or rejected says nothing: the Blocklist says the rest", () => {
    expect(
      readAddressBlockRuns([
        run({ status: SecurityPlaybookRunStatus.Succeeded }),
        run({ status: SecurityPlaybookRunStatus.Failed }),
      ]),
    ).toEqual({});
    expect(
      readAddressBlockRuns([run({ status: SecurityPlaybookRunStatus.Cancelled })]),
    ).toEqual({});
  });

  test("a playbook's run, or a run of anything but a block, is not a block from the case", () => {
    expect(
      readAddressBlockRuns([
        run({
          status: SecurityPlaybookRunStatus.WaitingForApproval,
          securityPlaybookId: "77777777-7777-4777-8777-777777777777",
        }),
        run({
          status: SecurityPlaybookRunStatus.Failed,
          action: SecurityPlaybookActionType.LiftAddressBlock,
        }),
      ]),
    ).toEqual({});
  });

  test("an address written another way is the same address", () => {
    expect(
      readAddressBlockRuns([
        run({
          status: SecurityPlaybookRunStatus.Running,
          value: "2001:DB8::0:1",
        }),
      ]),
    ).toEqual({
      [canonicalAddress("2001:db8::1")!]: ResponsePlaybookRunState.Running,
    });
  });
});

describe("the addresses a case may be blocked from", () => {
  test("its public ones, the opening detection's first, each once, written one way", () => {
    expect(
      getCaseBlockableAddresses({
        entities: [
          { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
          { type: SecurityEntityType.IpAddress, value: ADDRESS },
          { type: SecurityEntityType.IpAddress, value: "10.0.3.17" },
          { type: SecurityEntityType.IpAddress, value: "127.0.0.1" },
          { type: SecurityEntityType.User, value: "alice@acme.com" },
        ],
        matches: matchesOf(detection(ADDRESS)),
      }),
    ).toEqual([ADDRESS, "203.0.113.9"]);
  });

  test("never one its requests only claimed: whoever sent them wrote it", () => {
    const claimed: string = "198.51.100.23";
    const matches: SecurityCaseMatchesJson = matchesOf(
      detection(ADDRESS, [
        {
          id: "event-1",
          time: "2026-11-17T19:28:00.000Z",
          message: "GET /../../etc/passwd",
          principalIp: ADDRESS,
          traceId: "",
          spanId: "",
          attributes: {
            [SECURITY_REQUEST_ATTRIBUTES.claimedClientAddress]: claimed,
          },
        } as SecurityCaseMatchedEventJson,
      ]),
    );
    const entities: Array<{ type: SecurityEntityType; value: string }> = [
      { type: SecurityEntityType.IpAddress, value: ADDRESS },
      { type: SecurityEntityType.IpAddress, value: claimed },
    ];

    expect(getCaseBlockableAddresses({ entities, matches })).toEqual([ADDRESS]);
    expect(isCaseBlockableAddress({ value: claimed, entities, matches })).toBe(
      false,
    );
    expect(isCaseBlockableAddress({ value: ADDRESS, entities, matches })).toBe(
      true,
    );

    // Nor does the plan offer to block it.
    const built: ResponsePlan = plan({
      entities,
      matches,
      addressBlocking: blocking(),
    });

    expect(
      built.steps.filter((step: ResponseStep): boolean => {
        return step.action?.kind === ResponseActionKind.BlockAddress;
      }).map((step: ResponseStep): string | undefined => {
        return step.action?.entity?.value;
      }),
    ).toEqual([ADDRESS]);
  });

  test("an address the case does not name is not the case's to block", () => {
    expect(
      isCaseBlockableAddress({
        value: "8.8.8.8",
        entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
        matches: matchesOf(detection(ADDRESS)),
      }),
    ).toBe(false);
  });
});
