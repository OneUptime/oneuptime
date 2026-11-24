/** @timezone UTC */
import { EMPTY_VALUE_MARK } from "../../../Types/EmptyValueMark";
import { describe, expect, test } from "@jest/globals";
import {
  GUARDRAIL_LADDER,
  MODE_OFF,
  MODE_ON,
  MODE_TRIAL_FINISHED,
  MODE_TRIAL_RUN,
  RULE_MISSING,
  RULE_OFF,
  RULE_REAL_TIME,
  RULE_SCHEDULED,
  RULE_SCHEDULED_TOOLTIP,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseCopy";
import {
  PolicyCondition,
  canTurnOnWithoutTrial,
  formatTimeToBlock,
  getChallengeHeldAsBlockAt,
  getPolicyConditions,
  getPolicyDisplayDescription,
  getPolicyDisplayName,
  getPolicyModeChip,
  getPolicyRuleChip,
  getSwitchedOnMode,
  getTimeToBlockPoints,
  isPolicyAskingToTurnOn,
  isPolicySwitchOn,
  readTypedTechniques,
  writeGuardrails,
  writeLastWeek,
  writePolicyStateLine,
  writeTrialSummary,
  writeTypedTechniquesProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseModel";
import {
  SecurityAutomaticResponseOverviewPolicy,
  SecurityAutomaticResponseRuleState,
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
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import {
  PluralTemplate,
  SentenceOptions,
  TemplateValues,
  Translator,
  getGlobalTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * WHAT THE AUTOMATIC RESPONSE PAGE SAYS OF EACH POLICY (#10350), in
 * English: the chip beside its switch and where the switch takes it, the
 * line of where it stands, what its trial run would have done - the
 * issue's own sentence, "In 7 days this would have challenged 1,283
 * addresses. None had signed-in users, and none were yours." - what it
 * did once on, what it acts on, its guardrails in plain words, and its
 * time to block.
 */

const globalTranslator: Translator = getGlobalTranslator();

// The sentences as plain text: a number is kept on the line of its unit by a no-break space.
function plain(text: string | undefined): string {
  return (text || "").replace(/\u00a0/g, " ");
}

const english: Translator = {
  ...globalTranslator,
  translateText: (text: string | undefined): string => {
    return plain(globalTranslator.translateText(text));
  },
  translateTemplate: (
    template: string,
    values?: TemplateValues,
    options?: SentenceOptions,
  ): string => {
    return plain(globalTranslator.translateTemplate(template, values, options));
  },
  translatePlural: (
    template: PluralTemplate,
    count: number,
    values?: TemplateValues,
    options?: SentenceOptions,
  ): string => {
    return plain(
      globalTranslator.translatePlural(template, count, values, options),
    );
  },
};
const NOW: Date = new Date("2026-11-22T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

function policy(
  values: Partial<SecurityAutomaticResponseOverviewPolicy> = {},
): SecurityAutomaticResponseOverviewPolicy {
  return {
    id: "71111111-1111-4111-8111-111111111111",
    kind: SecurityAutomaticResponsePolicyKind.Scanners,
    name: "Scanners",
    description: "",
    mode: SecurityAutomaticResponseMode.Off,
    blockAction: SecurityBlockAction.Challenge,
    duration: SecurityBlockDuration.OneHour,
    match: {
      mitreTechniques: ["T1595", "T1190"],
      detectionRuleIds: [],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: true,
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
    timeToBlock: { count: 0, p50InSeconds: null, p95InSeconds: null, days: [] },
    lastWeek: { acted: 0, spared: 0 },
    rules: [],
    ...values,
  };
}

const finishedTrial: Partial<SecurityAutomaticResponseOverviewPolicy> = {
  mode: SecurityAutomaticResponseMode.TrialRun,
  trialStartedAt: new Date(NOW.getTime() - 8 * DAY_IN_MS),
  trialEndsAt: new Date(NOW.getTime() - DAY_IN_MS),
  trialState: SecurityAutomaticResponseTrialState.Finished,
  trialSummary: {
    wouldActOn: 1283,
    wouldHaveLifted: 0,
    sparedSignedIn: 0,
    sparedProtected: 0,
    sparedCannotTell: 0,
    wouldHaveStopped: 0,
  },
};

describe("where a policy stands", () => {
  test("an Off policy's switch starts a 7-day trial run, and says so", () => {
    const off: SecurityAutomaticResponseOverviewPolicy = policy();

    expect(getPolicyModeChip(off)).toEqual({
      text: MODE_OFF,
      tone: PillTone.Paused,
    });
    expect(isPolicySwitchOn(off)).toBe(false);
    expect(getSwitchedOnMode(off)).toBe(SecurityAutomaticResponseMode.TrialRun);
    expect(canTurnOnWithoutTrial(off)).toBe(true);
    expect(isPolicyAskingToTurnOn(off)).toBe(false);
    expect(
      writePolicyStateLine({ policy: off, translator: english, now: NOW }),
    ).toBe(
      "Turn it on to start a 7-day trial run. It records what it would have done, and touches no traffic.",
    );
  });

  test("in its trial run, it counts the days left, and its switch is on", () => {
    const running: SecurityAutomaticResponseOverviewPolicy = policy({
      mode: SecurityAutomaticResponseMode.TrialRun,
      trialState: SecurityAutomaticResponseTrialState.Running,
      trialDaysLeft: 5,
    });

    expect(getPolicyModeChip(running)).toEqual({
      text: MODE_TRIAL_RUN,
      tone: PillTone.Info,
    });
    expect(isPolicySwitchOn(running)).toBe(true);
    expect(canTurnOnWithoutTrial(running)).toBe(true);
    expect(
      writePolicyStateLine({ policy: running, translator: english, now: NOW }),
    ).toBe(
      "Trial run: 5 days left. It records what it would have done, and touches no traffic.",
    );
    expect(
      writePolicyStateLine({
        policy: { ...running, trialDaysLeft: 0 },
        translator: english,
        now: NOW,
      }),
    ).toBe(
      "Trial run: 1 day left. It records what it would have done, and touches no traffic.",
    );
  });

  test("a finished trial asks to be turned on, and offers no skipping", () => {
    const finished: SecurityAutomaticResponseOverviewPolicy =
      policy(finishedTrial);

    expect(getPolicyModeChip(finished)).toEqual({
      text: MODE_TRIAL_FINISHED,
      tone: PillTone.Info,
    });
    expect(isPolicyAskingToTurnOn(finished)).toBe(true);
    expect(canTurnOnWithoutTrial(finished)).toBe(false);
    // Its summary says where it stands.
    expect(
      writePolicyStateLine({ policy: finished, translator: english, now: NOW }),
    ).toBe("");
  });

  test("off after a whole week of trial run, its switch puts it straight to work", () => {
    const offAfterTrial: SecurityAutomaticResponseOverviewPolicy = policy({
      trialStartedAt: new Date("2026-11-01T09:00:00.000Z"),
      trialEndsAt: new Date("2026-11-08T09:00:00.000Z"),
      trialFinishedAt: new Date("2026-11-08T09:00:00.000Z"),
      trialState: SecurityAutomaticResponseTrialState.Finished,
    });

    expect(getSwitchedOnMode(offAfterTrial)).toBe(
      SecurityAutomaticResponseMode.On,
    );
    expect(canTurnOnWithoutTrial(offAfterTrial)).toBe(false);
    expect(
      writePolicyStateLine({
        policy: offAfterTrial,
        translator: english,
        now: NOW,
      }),
    ).toBe(
      "Its trial run finished 08 Nov, so turning it on puts it to work straight away.",
    );
  });

  test("on, it says since when and who turned it on", () => {
    const on: SecurityAutomaticResponseOverviewPolicy = policy({
      mode: SecurityAutomaticResponseMode.On,
      turnedOnAt: new Date("2026-11-20T08:00:00.000Z"),
      turnedOnBy: "Jane Doe",
      trialState: SecurityAutomaticResponseTrialState.Finished,
      trialFinishedAt: new Date("2026-11-19T08:00:00.000Z"),
    });

    expect(getPolicyModeChip(on)).toEqual({
      text: MODE_ON,
      tone: PillTone.Success,
    });
    expect(canTurnOnWithoutTrial(on)).toBe(false);
    expect(
      writePolicyStateLine({ policy: on, translator: english, now: NOW }),
    ).toBe("On since 20 Nov, turned on by Jane Doe.");
    expect(
      writePolicyStateLine({
        policy: { ...on, turnedOnBy: null },
        translator: english,
        now: NOW,
      }),
    ).toBe("On since 20 Nov.");
  });
});

describe("what it would have done, and did", () => {
  test("a finished trial says the issue's sentence", () => {
    expect(
      writeTrialSummary({ policy: policy(finishedTrial), translator: english }),
    ).toEqual([
      "In 7 days this would have challenged 1,283 addresses.",
      "None had signed-in users, and none were yours.",
    ]);
  });

  test("a policy that blocks says blocked, and one address is one", () => {
    expect(
      writeTrialSummary({
        policy: policy({
          ...finishedTrial,
          kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
          blockAction: SecurityBlockAction.Block,
          trialSummary: {
            ...finishedTrial.trialSummary!,
            wouldActOn: 1,
          },
        }),
        translator: english,
      })[0],
    ).toBe("In 7 days this would have blocked 1 address.");
  });

  test("what the guardrails left alone, and what it would have lifted, stopped at or left for a person", () => {
    expect(
      writeTrialSummary({
        policy: policy({
          ...finishedTrial,
          trialSummary: {
            wouldActOn: 40,
            wouldHaveLifted: 2,
            sparedSignedIn: 3,
            sparedProtected: 0,
            sparedCannotTell: 1,
            wouldHaveStopped: 1,
          },
        }),
        translator: english,
      }),
    ).toEqual([
      "In 7 days this would have challenged 40 addresses.",
      "It left 3 addresses alone because signed-in users had used them.",
      "None were yours.",
      "A signed-in user was seen later from 2 of them, so it would have lifted those blocks.",
      "It could not tell whether signed-in users had used 1 address, so it left it for a person.",
      "It would have reached the hourly limit of automatic blocks once, and paged your security owners.",
    ]);

    expect(
      writeTrialSummary({
        policy: policy({
          ...finishedTrial,
          trialSummary: {
            ...finishedTrial.trialSummary!,
            sparedProtected: 4,
          },
        }),
        translator: english,
      }).slice(1),
    ).toEqual([
      "None had signed-in users.",
      "It left 4 of your own addresses alone.",
    ]);
  });

  test("a trial still running says so far", () => {
    expect(
      writeTrialSummary({
        policy: policy({
          ...finishedTrial,
          trialState: SecurityAutomaticResponseTrialState.Running,
          trialEndsAt: new Date(NOW.getTime() + 2 * DAY_IN_MS),
        }),
        translator: english,
      })[0],
    ).toBe("So far it would have challenged 1,283 addresses.");
  });

  test("an Off policy, or one never in a trial run, has no summary", () => {
    expect(
      writeTrialSummary({ policy: policy(), translator: english }),
    ).toEqual([]);
    expect(
      writeTrialSummary({
        policy: policy({
          ...finishedTrial,
          mode: SecurityAutomaticResponseMode.Off,
        }),
        translator: english,
      }),
    ).toEqual([]);
  });

  test("on, it says what it did in the last 7 days", () => {
    expect(
      writeLastWeek({
        policy: policy({
          mode: SecurityAutomaticResponseMode.On,
          lastWeek: { acted: 12, spared: 2 },
        }),
        translator: english,
      }),
    ).toEqual([
      "In the last 7 days it challenged 12 addresses.",
      "Its guardrails left 2 addresses alone.",
    ]);
    expect(
      writeLastWeek({
        policy: policy({
          mode: SecurityAutomaticResponseMode.On,
          blockAction: SecurityBlockAction.Block,
          lastWeek: { acted: 0, spared: 0 },
        }),
        translator: english,
      }),
    ).toEqual(["In the last 7 days it blocked 0 addresses."]);
    expect(writeLastWeek({ policy: policy(), translator: english })).toEqual(
      [],
    );
  });
});

describe("what it acts on", () => {
  test("each of a ready policy's rules says where it stands", () => {
    const rule: (state: SecurityAutomaticResponseRuleState) => {
      libraryRuleId: string;
      title: string;
      detectionRuleId: string | null;
      state: SecurityAutomaticResponseRuleState;
    } = (state: SecurityAutomaticResponseRuleState) => {
      return {
        libraryRuleId: "cfdf6ad4-7138-4201-8a1c-6bf962335cee",
        title: "SQL injection attempts",
        detectionRuleId: null,
        state,
      };
    };

    expect(
      getPolicyRuleChip({
        rule: rule(SecurityAutomaticResponseRuleState.RealTime),
        isPolicyRunning: true,
      }),
    ).toEqual({ text: RULE_REAL_TIME, tone: PillTone.Success });
    // On its schedule is a warning only while the policy runs.
    expect(
      getPolicyRuleChip({
        rule: rule(SecurityAutomaticResponseRuleState.Scheduled),
        isPolicyRunning: true,
      }),
    ).toEqual({
      text: RULE_SCHEDULED,
      tone: PillTone.Warning,
      tooltip: RULE_SCHEDULED_TOOLTIP,
    });
    expect(
      getPolicyRuleChip({
        rule: rule(SecurityAutomaticResponseRuleState.Scheduled),
        isPolicyRunning: false,
      }).tone,
    ).toBe(PillTone.Neutral);
    expect(
      getPolicyRuleChip({
        rule: rule(SecurityAutomaticResponseRuleState.Off),
        isPolicyRunning: true,
      }).text,
    ).toBe(RULE_OFF);
    expect(
      getPolicyRuleChip({
        rule: rule(SecurityAutomaticResponseRuleState.Missing),
        isPolicyRunning: false,
      }).text,
    ).toBe(RULE_MISSING);
  });

  test("Scanners says it acts only while every request was turned away; Known-Bad Addresses on any detection about a listed address", () => {
    expect(
      getPolicyConditions({ policy: policy(), translator: english }),
    ).toEqual([
      { text: "Only while every request from the address was turned away." },
    ]);
    expect(
      getPolicyConditions({
        policy: policy({
          kind: SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
          match: {
            mitreTechniques: [],
            detectionRuleIds: [],
            requiresThreatIntel: true,
            requiresEveryRequestTurnedAway: false,
          },
        }),
        translator: english,
      }),
    ).toEqual([
      { text: "Any detection about an address your threat intel lists." },
    ]);
  });

  test("a project's own policy lists its techniques and counts its rules", () => {
    const conditions: Array<PolicyCondition> = getPolicyConditions({
      policy: policy({
        kind: SecurityAutomaticResponsePolicyKind.Custom,
        name: "Bots on the sign-in API",
        match: {
          mitreTechniques: ["T1110"],
          detectionRuleIds: ["a", "b"],
          requiresThreatIntel: true,
          requiresEveryRequestTurnedAway: false,
        },
      }),
      translator: english,
    });

    expect(conditions).toEqual([
      {
        text: "Detections with these ATT&CK techniques:",
        techniques: ["T1110"],
      },
      { text: "Detections made by one of 2 detection rules." },
      { text: "Only addresses your threat intel lists." },
    ]);
  });

  test("a challenge is held as a block where a destination cannot challenge, named once each", () => {
    const destinations: Array<{
      name: string;
      provider: string;
      canChallenge: boolean;
    }> = [
      { name: "Cloudflare", provider: "Cloudflare", canChallenge: true },
      { name: "FortiGate feed", provider: "Feed", canChallenge: false },
      { name: "FortiGate feed", provider: "Feed", canChallenge: false },
    ];

    expect(
      getChallengeHeldAsBlockAt({ policy: policy(), destinations }),
    ).toEqual(["FortiGate feed"]);
    // A policy that blocks blocks everywhere: nothing to say.
    expect(
      getChallengeHeldAsBlockAt({
        policy: policy({ blockAction: SecurityBlockAction.Block }),
        destinations,
      }),
    ).toEqual([]);
  });
});

describe("its guardrails, in plain words", () => {
  test("every guardrail, with the ladder its first length climbs", () => {
    expect(
      writeGuardrails({
        policy: policy(),
        maxBlocksPerHour: SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
        translator: english,
      }),
    ).toEqual([
      "Never touches your own or protected addresses.",
      "Never touches an address a signed-in user used in the last 30 days.",
      "Lasts 1 hour, then 24 hours and 7 days for an address that comes back within 30 days.",
      "Stops after 50 automatic blocks an hour across your policies, and pages your security owners.",
      "Lifts its block, and tells your security owners, if a signed-in user is seen from the address.",
    ]);
    // Known-Bad Addresses starts at 24 hours.
    expect(
      writeGuardrails({
        policy: policy({ duration: SecurityBlockDuration.OneDay }),
        maxBlocksPerHour: 50,
        translator: english,
      })[2],
    ).toBe(GUARDRAIL_LADDER[SecurityBlockDuration.OneDay]);
  });
});

describe("time to block", () => {
  test("in seconds, minutes and seconds, or hours and minutes", () => {
    expect(formatTimeToBlock(41, english)).toBe("41s");
    expect(formatTimeToBlock(41.4, english)).toBe("41s");
    expect(formatTimeToBlock(92, english)).toBe("1m 32s");
    expect(formatTimeToBlock(120, english)).toBe("2m");
    expect(formatTimeToBlock(2 * 3600 + 5 * 60, english)).toBe("2h 5m");
    expect(formatTimeToBlock(3600, english)).toBe("1h");
    expect(formatTimeToBlock(null, english)).toBe(EMPTY_VALUE_MARK);
  });

  test("a day with no block has no point", () => {
    expect(
      getTimeToBlockPoints(
        [
          {
            day: "2026-11-20",
            count: 0,
            p50InSeconds: null,
            p95InSeconds: null,
          },
          { day: "2026-11-21", count: 3, p50InSeconds: 40, p95InSeconds: 95 },
        ],
        "p95InSeconds",
      ),
    ).toEqual([{ day: new Date("2026-11-21T00:00:00.000Z"), seconds: 95 }]);
  });
});

describe("a project's own policy", () => {
  test("its techniques are read however they are written, each once", () => {
    expect(readTypedTechniques("t1110, T1190.001;T1110  ")).toEqual({
      techniques: ["T1110", "T1190.001"],
      invalid: null,
    });
    expect(readTypedTechniques("")).toEqual({ techniques: [], invalid: null });
    expect(writeTypedTechniquesProblem("T1110, brute", english)).toBe(
      "brute is not an ATT&CK technique. Write it as T1110 or T1110.003.",
    );
    expect(writeTypedTechniquesProblem("T1110", english)).toBeNull();
  });

  test("a ready policy's name and description are the product's words, a project's own as written", () => {
    expect(
      getPolicyDisplayName(
        {
          kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
          name: "renamed",
        },
        english,
      ),
    ).toBe("Password Guessing");
    expect(
      getPolicyDisplayDescription(
        {
          kind: SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
          description: "",
        },
        english,
      ),
    ).toBe(
      "Blocks an address your threat intel lists as malicious, as soon as a detection is about it.",
    );
    expect(
      getPolicyDisplayName(
        { kind: SecurityAutomaticResponsePolicyKind.Custom, name: "Network" },
        english,
      ),
    ).toBe("Network");
  });
});
