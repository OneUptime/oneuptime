import { describe, expect, test } from "@jest/globals";
import {
  SecurityAutomaticResponseOverviewData,
  SecurityAutomaticResponseOverviewPolicy,
  SecurityAutomaticResponseRuleState,
  readSecurityAutomaticResponseOverview,
  readSecurityAutomaticResponseOverviewPolicy,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import { JSONObject } from "../../../Types/JSON";

/*
 * THE AUTOMATIC RESPONSE PAGE'S READ (#10350), as the Dashboard reads what
 * the server answered: whatever it can read is kept, and what it cannot is
 * the safest thing it could be - a policy Off with nothing done, a rule not
 * added, no destination, a limit of 50.
 */

const POLICY_ID: string = "71111111-1111-4111-8111-111111111111";

function answered(values: JSONObject = {}): JSONObject {
  return {
    _id: POLICY_ID,
    kind: SecurityAutomaticResponsePolicyKind.Scanners,
    name: "Scanners",
    description: "Challenges an address that probes your app.",
    mode: SecurityAutomaticResponseMode.TrialRun,
    blockAction: SecurityBlockAction.Challenge,
    duration: SecurityBlockDuration.OneHour,
    matchConditions: {
      mitreTechniques: ["T1595", "t1190"],
      detectionRuleIds: [],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: true,
    },
    trialStartedAt: "2026-11-15T09:00:00.000Z",
    trialEndsAt: "2026-11-22T09:00:00.000Z",
    trialFinishedAt: null,
    trialSkippedAt: null,
    turnedOnAt: null,
    turnedOnBy: null,
    trialState: SecurityAutomaticResponseTrialState.Finished,
    trialDaysLeft: 0,
    trialSummary: {
      wouldActOn: 1283,
      wouldHaveLifted: 0,
      sparedSignedIn: 0,
      sparedProtected: 0,
      sparedCannotTell: 0,
      wouldHaveStopped: 0,
    },
    timeToBlock: {
      count: 3,
      p50InSeconds: 41,
      p95InSeconds: 95,
      days: [
        { day: "2026-11-21", count: 3, p50InSeconds: 41, p95InSeconds: 95 },
        { day: "not a day", count: 1, p50InSeconds: 1, p95InSeconds: 1 },
      ],
    },
    lastWeek: { acted: 0, spared: 0 },
    rules: [
      {
        libraryRuleId: "cfdf6ad4-7138-4201-8a1c-6bf962335cee",
        title: "SQL injection attempts",
        detectionRuleId: "72222222-2222-4222-8222-222222222222",
        state: SecurityAutomaticResponseRuleState.RealTime,
      },
      { libraryRuleId: "x", title: "A rule of no state", state: "Sideways" },
      { title: "No library id" },
    ],
    ...values,
  };
}

describe("reading the page's answer", () => {
  test("a policy is read whole: its dates as dates, its techniques as policies keep them", () => {
    const read: SecurityAutomaticResponseOverviewPolicy | null =
      readSecurityAutomaticResponseOverviewPolicy(answered());

    expect(read).not.toBeNull();
    expect(read!.id).toBe(POLICY_ID);
    expect(read!.mode).toBe(SecurityAutomaticResponseMode.TrialRun);
    expect(read!.match.mitreTechniques).toEqual(["T1595", "T1190"]);
    expect(read!.match.requiresEveryRequestTurnedAway).toBe(true);
    expect(read!.trialEndsAt).toEqual(new Date("2026-11-22T09:00:00.000Z"));
    expect(read!.trialFinishedAt).toBeNull();
    expect(read!.trialState).toBe(SecurityAutomaticResponseTrialState.Finished);
    expect(read!.trialSummary?.wouldActOn).toBe(1283);
    // A day that is no day is left out.
    expect(read!.timeToBlock.days).toEqual([
      { day: "2026-11-21", count: 3, p50InSeconds: 41, p95InSeconds: 95 },
    ]);
    // A rule of a state it cannot read is one not added; one with no library id is no rule.
    expect(
      read!.rules.map(
        (rule: {
          title: string;
          state: SecurityAutomaticResponseRuleState;
        }): [string, SecurityAutomaticResponseRuleState] => {
          return [rule.title, rule.state];
        },
      ),
    ).toEqual([
      ["SQL injection attempts", SecurityAutomaticResponseRuleState.RealTime],
      ["A rule of no state", SecurityAutomaticResponseRuleState.Missing],
    ]);
  });

  test("what it cannot read is the safest thing it could be", () => {
    const read: SecurityAutomaticResponseOverviewPolicy | null =
      readSecurityAutomaticResponseOverviewPolicy({
        _id: POLICY_ID,
        kind: "Sideways",
        mode: "Maybe",
        blockAction: "Shout",
        duration: "Forever",
        trialStartedAt: "yesterday-ish",
        trialDaysLeft: -3,
        lastWeek: { acted: "many" },
      });

    expect(read).toEqual({
      id: POLICY_ID,
      kind: SecurityAutomaticResponsePolicyKind.Custom,
      name: "",
      description: "",
      mode: SecurityAutomaticResponseMode.Off,
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneHour,
      match: {
        mitreTechniques: [],
        detectionRuleIds: [],
        requiresThreatIntel: false,
        requiresEveryRequestTurnedAway: false,
      },
      trialStartedAt: null,
      trialEndsAt: null,
      trialFinishedAt: null,
      trialSkippedAt: null,
      turnedOnAt: null,
      turnedOnBy: null,
      trialState: SecurityAutomaticResponseTrialState.NotStarted,
      trialDaysLeft: 0,
      trialSummary: null,
      timeToBlock: {
        count: 0,
        p50InSeconds: null,
        p95InSeconds: null,
        days: [],
      },
      lastWeek: { acted: 0, spared: 0 },
      rules: [],
    });
    // A policy with no id is none.
    expect(
      readSecurityAutomaticResponseOverviewPolicy({ name: "x" }),
    ).toBeNull();
    expect(readSecurityAutomaticResponseOverviewPolicy(null)).toBeNull();
  });

  test("the page: its policies, the destinations and whether each challenges, and the hour's blocks", () => {
    const read: SecurityAutomaticResponseOverviewData =
      readSecurityAutomaticResponseOverview({
        policies: [answered(), { name: "no id" }],
        destinations: [
          { name: "Cloudflare", provider: "Cloudflare", canChallenge: true },
          { name: "FortiGate feed", provider: "Feed" },
          { name: "  " },
        ],
        destinationsCannotTell: true,
        blocksThisHour: 50,
        maxBlocksPerHour: 50,
      });

    expect(read.policies).toHaveLength(1);
    expect(read.destinations).toEqual([
      { name: "Cloudflare", provider: "Cloudflare", canChallenge: true },
      { name: "FortiGate feed", provider: "Feed", canChallenge: false },
    ]);
    expect(read.destinationsCannotTell).toBe(true);
    expect(read.blocksThisHour).toBe(50);
    expect(read.maxBlocksPerHour).toBe(50);
  });

  test("an answer it cannot read is a page of nothing, with the product's limit", () => {
    expect(readSecurityAutomaticResponseOverview(undefined)).toEqual({
      policies: [],
      destinations: [],
      destinationsCannotTell: false,
      blocksThisHour: 0,
      maxBlocksPerHour: SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
    });
  });
});
