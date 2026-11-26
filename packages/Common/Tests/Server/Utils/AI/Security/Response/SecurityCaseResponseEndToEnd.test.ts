import {
  ResponderInput,
  ResponderIntent,
  ResponderLogRow,
  ResponderPlan,
  ResponderWait,
  planSecurityCaseResponse,
} from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseResponsePlanner";
import { buildSecurityCaseClosingReport } from "../../../../../../Server/Utils/AI/Security/Response/SecurityCaseClosingReport";
import { SecurityBlockAction } from "../../../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SECURITY_CASE_AI_DEFAULT_MODES,
  SecurityCaseAiActionKind,
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
  SecurityCaseAiArea,
  SecurityCaseAiDecisionKind,
  SecurityCaseAiLimits,
  SecurityCaseAiMode,
} from "../../../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityCaseAiVerdict from "../../../../../../Types/SecurityCase/SecurityCaseAiVerdict";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseStepCheckState from "../../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityCaseVerdict from "../../../../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityEntityType } from "../../../../../../Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome from "../../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  ResponsePlanInput,
  buildResponsePlan,
} from "../../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanBuilder";
import {
  ResponseAddressBlock,
  ResponsePlan,
  ResponseStepCheck,
  ResponseTask,
} from "../../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanTypes";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SCANNER'S CASE, WORKED END TO END BY ONEUPTIME AI (#10352), on its real
 * Response Plan (ResponsePlanBuilder, as the server builds it without the
 * triage's report) and the project's recommended settings, with Block
 * addresses turned to On its own by a Security Admin and a test
 * destination enforcing the blocklist:
 *
 *   1. its triage read the case as Likely Malicious: OneUptime AI takes the
 *      case and blocks the scanner's address, on its own, through the
 *      engine (the toolkit's tests hold the engine path);
 *   2. the destination holds the block and OneUptime's checks prove it:
 *      every request turned away, no incident needed - it moves the case to
 *      Contained and marks the fix done with that evidence;
 *   3. it waits out the quiet window, then asks a person to close the case
 *      as True Positive, with its closing report - the one thing a person
 *      does;
 *   4. once a person approved and the case closed, it is finished.
 *
 * Each look reads what the last one left: the log OneUptime AI kept, and
 * the case as the engine and the checks changed it.
 */

const ADDRESS: string = "35.196.249.14";
const BLOCK_KEY: string = `contain:block-ip:${ADDRESS}`;
const DESTINATION: string = "Test destination";
const FIRST_SEEN: Date = new Date("2026-11-21T09:00:00.000Z");
const LAST_SEEN: Date = new Date("2026-11-21T09:30:00.000Z");

const LIMITS: SecurityCaseAiLimits = {
  isOn: true,
  modes: {
    ...SECURITY_CASE_AI_DEFAULT_MODES,
    [SecurityCaseAiArea.Edge]: SecurityCaseAiMode.OnItsOwn,
  },
  stamps: {
    [SecurityCaseAiArea.Edge]: {
      byUserId: "11111111-1111-4111-8111-111111111111",
      at: "2026-11-20T10:00:00.000Z",
    },
  },
};

function scannerDetection(): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: `Web scanner — ${ADDRESS}`,
    severity: "Medium",
    groupValue: ADDRESS,
    ruleName: "Web scanner",
    eventCount: 120,
    fireCount: 1,
    firstSeenAt: FIRST_SEEN.toISOString(),
    lastSeenAt: LAST_SEEN.toISOString(),
    sampleMessage: "",
    isOpening: true,
    rule: null,
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: FIRST_SEEN.toISOString(),
    windowEnd: LAST_SEEN.toISOString(),
    events: [],
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 120,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 120 },
  };
}

function matches(): SecurityCaseMatchesJson {
  return {
    detections: [scannerDetection()],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

function check(
  stepKey: string,
  state: SecurityCaseStepCheckState,
  checkedAt: Date,
): ResponseStepCheck {
  return {
    stepKey,
    state,
    evidence: {
      sentence: { template: "A check", values: {} },
      facts: [],
      links: [],
      data: {},
    },
    checkedAt,
  };
}

// Where the case stands at one look, as the engine and the checks left it.
interface CaseState {
  now: Date;
  stage: SecurityCaseStage;
  isTaken: boolean;
  blocks: Array<ResponseAddressBlock>;
  checks: Array<ResponseStepCheck>;
  tasks: Array<ResponseTask>;
}

function planFor(state: CaseState): ResponsePlan {
  const input: ResponsePlanInput = {
    entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
    // A scanner: Reconnaissance, Active Scanning.
    mitreTactics: ["TA0043"],
    mitreTechniques: ["T1595"],
    isAssigned: state.isTaken,
    hasIncident: false,
    stage: state.stage,
    hasContainedStatus: true,
    matches: matches(),
    playbooks: [],
    ranPlaybookIds: [],
    tasks: state.tasks,
    /*
     * As SecurityCaseResponseLook builds it: without the triage's report,
     * whose words are for the case's readers, and without the blocklist -
     * the block step is done by OneUptime's check that the block holds.
     */
    ai: null,
    checks: state.checks,
  };

  return buildResponsePlan(input);
}

function look(state: CaseState, log: Array<ResponderLogRow>): ResponderPlan {
  const responderInput: ResponderInput = {
    now: state.now,
    limits: LIMITS,
    hasScannersPolicyFinishedTrial: false,
    aiGate: null,
    securityCase: {
      stage: state.stage,
      aiVerdict: SecurityCaseAiVerdict.LikelyMalicious,
      hasSteeringText: false,
      isAtHighestPriority: false,
      priorityToRaiseTo: null,
      isRaisingToHighestPriority: false,
      lastDetectedAt: LAST_SEEN,
      createdAt: FIRST_SEEN,
    },
    plan: planFor(state),
    log,
    hasBlockDestination: true,
    canContainUsers: false,
    canContainHosts: false,
    caseBlocks: state.blocks.map((block: ResponseAddressBlock) => {
      return { id: block.id, value: block.value };
    }),
  };

  return planSecurityCaseResponse(responderInput);
}

// What OneUptime AI logs of an intent once the toolkit carried it out.
function logged(
  intent: ResponderIntent,
  status: SecurityCaseAiActionStatus,
  at: Date,
): ResponderLogRow {
  return {
    id: `${intent.kind}-${intent.stepKey}`,
    kind: intent.kind,
    status,
    reason: intent.reason,
    stepKey: intent.stepKey,
    target: intent.target || null,
    createdAt: at,
    ...(status === SecurityCaseAiActionStatus.Done ? { doneAt: at } : {}),
  };
}

function summary(plan: ResponderPlan): Array<[string, string, string]> {
  return plan.intents.map((intent: ResponderIntent) => {
    return [intent.kind, intent.stepKey, intent.decision];
  });
}

describe("a scanner's case, from its triage to its close", () => {
  const LOOK_1: Date = new Date("2026-11-21T09:35:00.000Z");
  const LOOK_2: Date = new Date("2026-11-21T09:45:00.000Z");
  const LOOK_3: Date = new Date("2026-11-21T09:50:00.000Z");
  const LOOK_4: Date = new Date("2026-11-22T09:31:00.000Z");
  const LOOK_5: Date = new Date("2026-11-22T09:40:00.000Z");

  const blockedAt: Date = new Date("2026-11-21T09:36:00.000Z");
  const block: ResponseAddressBlock = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-000000000001",
    value: ADDRESS,
    action: SecurityBlockAction.Block,
    createdAt: blockedAt,
    expiresAt: new Date("2026-11-22T09:36:00.000Z"),
    createdByName: "OneUptime AI",
    enforcedAt: [DESTINATION],
    enforcedSince: blockedAt,
    pendingAt: [],
    notAppliedAt: [],
  };

  const log: Array<ResponderLogRow> = [];

  test("1. the triage read it as malicious: it takes the case and blocks the address on its own, and waits for the checks", () => {
    const plan: ResponderPlan = look(
      {
        now: LOOK_1,
        stage: SecurityCaseStage.New,
        isTaken: false,
        blocks: [],
        checks: [],
        tasks: [],
      },
      log,
    );

    expect(plan.handOff).toBeNull();
    expect(summary(plan)).toEqual([
      [SecurityCaseAiActionKind.TakeCase, "confirm:take", "Do"],
      [SecurityCaseAiActionKind.BlockAddress, BLOCK_KEY, "Do"],
    ]);
    expect(
      plan.intents.find((intent: ResponderIntent) => {
        return intent.kind === SecurityCaseAiActionKind.BlockAddress;
      }),
    ).toEqual(
      expect.objectContaining({
        target: ADDRESS,
        reason: SecurityCaseAiActionReason.OnItsOwn,
        mode: SecurityCaseAiMode.OnItsOwn,
      }),
    );
    expect(plan.waits).toEqual([ResponderWait.Check]);

    // The toolkit carried both out: the case taken, the block through the engine.
    for (const intent of plan.intents) {
      log.push(logged(intent, SecurityCaseAiActionStatus.Done, blockedAt));
    }
  });

  test("2. the block holds and the checks prove it: it moves the case to Contained and marks the fix done with that evidence", () => {
    const checkedAt: Date = new Date("2026-11-21T09:44:00.000Z");
    const plan: ResponderPlan = look(
      {
        now: LOOK_2,
        stage: SecurityCaseStage.New,
        isTaken: true,
        blocks: [block],
        checks: [
          // Every request turned away; the address no longer reaches the app.
          check(
            "confirm:requests",
            SecurityCaseStepCheckState.Verified,
            checkedAt,
          ),
          check(BLOCK_KEY, SecurityCaseStepCheckState.Verified, checkedAt),
          check(
            "contain:incident",
            SecurityCaseStepCheckState.NotNeeded,
            checkedAt,
          ),
        ],
        tasks: [],
      },
      log,
    );

    expect(plan.handOff).toBeNull();
    expect(summary(plan)).toEqual([
      [SecurityCaseAiActionKind.MarkContained, "contain:mark-contained", "Do"],
      [SecurityCaseAiActionKind.MarkStepDone, "fix:discovery", "Do"],
    ]);
    // The fix is marked done with the requests' check as its evidence.
    expect(
      plan.intents.find((intent: ResponderIntent) => {
        return intent.kind === SecurityCaseAiActionKind.MarkStepDone;
      })?.check?.state,
    ).toBe(SecurityCaseStepCheckState.Verified);

    for (const intent of plan.intents) {
      log.push(logged(intent, SecurityCaseAiActionStatus.Done, LOOK_2));
    }
  });

  const contained: (now: Date) => CaseState = (now: Date): CaseState => {
    const checkedAt: Date = new Date("2026-11-21T09:44:00.000Z");

    return {
      now,
      stage: SecurityCaseStage.Contained,
      isTaken: true,
      blocks: [block],
      checks: [
        check(
          "confirm:requests",
          SecurityCaseStepCheckState.Verified,
          checkedAt,
        ),
        check(BLOCK_KEY, SecurityCaseStepCheckState.Verified, checkedAt),
        check(
          "contain:incident",
          SecurityCaseStepCheckState.NotNeeded,
          checkedAt,
        ),
      ],
      tasks: [
        {
          id: "task-1",
          responseStepKey: "fix:discovery",
          isDone: true,
          doneAt: LOOK_2,
          doneByName: "OneUptime AI",
        },
      ],
    };
  };

  test("3. every step done, the detection fired half an hour ago: it waits out the quiet window", () => {
    const plan: ResponderPlan = look(contained(LOOK_3), log);

    expect(plan.handOff).toBeNull();
    expect(plan.intents).toEqual([]);
    expect(plan.waits).toEqual([ResponderWait.QuietWindow]);
    expect(plan.quietUntil).toEqual(new Date("2026-11-22T09:30:00.000Z"));
  });

  test("4. quiet for a day: it asks a person to close the case as True Positive, with its closing report", () => {
    const plan: ResponderPlan = look(contained(LOOK_4), log);

    expect(plan.handOff).toBeNull();
    expect(summary(plan)).toEqual([
      [SecurityCaseAiActionKind.CloseCase, "close", "Ask"],
    ]);

    const close: ResponderIntent = plan.intents[0]!;

    expect(close.verdict).toBe(SecurityCaseVerdict.TruePositive);
    expect(close.reason).toBe(SecurityCaseAiActionReason.SettingAsks);
    expect(close.decision).toBe(SecurityCaseAiDecisionKind.Ask);

    // The report the person reads first: what happened, what was done.
    const report: string = buildSecurityCaseClosingReport({
      caseNumber: "SC-12",
      title: `Web scanner — ${ADDRESS}`,
      verdict: SecurityCaseVerdict.TruePositive,
      firstDetectedAt: FIRST_SEEN,
      lastDetectedAt: LAST_SEEN,
      detectionCount: 1,
      openingRuleName: "Web scanner",
      entities: [{ type: SecurityEntityType.IpAddress, value: ADDRESS }],
      mitreTactics: ["TA0043"],
      hasIncident: false,
      plan: planFor(contained(LOOK_4)),
      actions: log.map((row: ResponderLogRow) => {
        return {
          kind: row.kind,
          status: row.status,
          stepKey: row.stepKey || undefined,
          target: row.target || undefined,
          doneAt: row.doneAt,
        };
      }),
      blocks: [{ value: ADDRESS, expiresAt: block.expiresAt }],
      aiName: "OneUptime AI",
    });

    for (const section of [
      "### What happened",
      "### The impact",
      "### What was done",
      "### What was fixed",
      "### What to watch",
    ]) {
      expect(report).toContain(section);
    }

    expect(report).toContain(ADDRESS);
    expect(report).toContain("OneUptime AI");

    log.push(logged(close, SecurityCaseAiActionStatus.Asked, LOOK_4));

    // Until somebody answers, it waits.
    expect(look(contained(LOOK_4), log).waits).toEqual([
      ResponderWait.Approval,
    ]);
  });

  test("5. a person approved, and the case closed: it is finished", () => {
    log[log.length - 1] = {
      ...log[log.length - 1]!,
      status: SecurityCaseAiActionStatus.Done,
      reason: SecurityCaseAiActionReason.Approved,
      doneAt: LOOK_5,
    };

    const plan: ResponderPlan = look(
      { ...contained(LOOK_5), stage: SecurityCaseStage.Closed },
      log,
    );

    expect(plan.isFinished).toBe(true);
    expect(plan.intents).toEqual([]);
    expect(plan.handOff).toBeNull();

    // Of everything on the case, a person did one thing: approve the close.
    expect(
      log
        .filter((row: ResponderLogRow): boolean => {
          return row.reason === SecurityCaseAiActionReason.Approved;
        })
        .map((row: ResponderLogRow): string => {
          return row.kind;
        }),
    ).toEqual([SecurityCaseAiActionKind.CloseCase]);
  });
});

/*
 * What OneUptime AI does on a case is posted where the case's readers are
 * not the only readers - the Blocklist, Slack, Microsoft Teams, the notices
 * - so it never works from the triage's report, whose words are for them:
 * its Response Plan is built without it, and no part of the responder reads
 * the report (SubjectReadersOnlyGuard holds the rest).
 */
describe("the responder never reads the triage's report", () => {
  const SERVER: string = path.resolve(__dirname, "../../../../../../Server");
  const FILES: Array<string> = [
    ...fs
      .readdirSync(path.join(SERVER, "Utils/AI/Security/Response"))
      .map((file: string): string => {
        return path.join(SERVER, "Utils/AI/Security/Response", file);
      }),
    path.join(SERVER, "Utils/SecurityCase/SecurityCaseHandOff.ts"),
  ];

  test("no file of it names the report", () => {
    expect(FILES.length).toBeGreaterThan(8);

    for (const file of FILES) {
      expect({
        file: path.basename(file),
        readsReport: fs.readFileSync(file, "utf8").includes("aiTriageReport"),
      }).toEqual({ file: path.basename(file), readsReport: false });
    }
  });

  test("its plan takes only the playbook the triage named", () => {
    const look: string = fs
      .readFileSync(
        path.join(
          SERVER,
          "Utils/AI/Security/Response/SecurityCaseResponseLook.ts",
        ),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(look).toContain(
      "ai: { suggestedPlaybookId: securityCase.aiSuggestedPlaybookId?.toString(), },",
    );
  });
});
