import { readPage } from "./DocsContentSupport";
import {
  ACTION_BLOCK_OPTION,
  ACTION_CHALLENGE_OPTION,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Blocklist/BlocklistCopy";
import {
  AUTOMATIC_RESPONSE_TITLE,
  CREATE_POLICY,
  DELETE_POLICY,
  EDIT_POLICY,
  FIRST_BLOCK_FIELD_TITLE,
  MODE_OFF,
  MODE_ON,
  MODE_TRIAL_FINISHED,
  MODE_TRIAL_RUN,
  RULE_REAL_TIME,
  RULE_SCHEDULED,
  TECHNIQUES_FIELD_TITLE,
  THREAT_INTEL_FIELD_TITLE,
  TRIAL_WOULD_HAVE_CHALLENGED,
  TURNED_AWAY_FIELD_TITLE,
  TURN_IT_ON_QUESTION,
  TURN_ON,
  TURN_ON_WITHOUT_TRIAL,
  CASE_TIME_TO_BLOCK,
  SPARED_NONE,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseCopy";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import PageMap from "../../../FeatureSet/Dashboard/src/Utils/PageMap";
import { SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES } from "Common/Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRules";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES,
  SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS,
  SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_DAYS,
  SecurityAutomaticResponsePolicyDefinition,
  SecurityAutomaticResponsePolicyKind,
} from "Common/Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SECURITY_REPEAT_OFFENDER_LADDER,
  SECURITY_REPEAT_OFFENDER_WINDOW_DAYS,
} from "Common/Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "Common/Types/SecurityBlocklist/SecurityBlock";
import { getDetectionRuleLibraryEntry } from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import { DETECTION_REAL_TIME_RULES_MAX } from "Common/Types/SecurityEvent/RealTimeDetection";
import { automaticResponseBlockedMarkdown } from "Common/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseMarkdown";
import { describe, expect, it } from "@jest/globals";

/*
 * AUTOMATIC RESPONSE (#10350), held to the product.
 *
 * The page names each ready policy with what it acts on, does and for how
 * long, as the policies are defined; gives the guardrails' numbers - the
 * trial run's week, the 30 days a signed-in user's address is spared, the
 * ladder, the hourly limit, the real-time rules' cap - as the code holds
 * them; names the Dashboard's words in bold as the page draws them; quotes
 * the case's line as the timeline writes it; and opens the page from the
 * menu where the menu puts it. A change to any of them fails here until
 * the page says so too.
 */

const PAGE: string = "telemetry/security-automatic-response";

function page(): string {
  return readPage("en", PAGE);
}

function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

// "1 hour", "24 hours", "7 days", as the page writes a length.
function lengthOf(duration: SecurityBlockDuration): string {
  switch (duration) {
    case SecurityBlockDuration.OneHour:
      return "1 hour";
    case SecurityBlockDuration.OneDay:
      return "24 hours";
    case SecurityBlockDuration.SevenDays:
      return "7 days";
    default:
      return duration;
  }
}

describe("Automatic Response docs: the ready policies", () => {
  it("names each ready policy in its table, with what it does and its first block, as the policies are defined", () => {
    const text: string = page();

    for (const policy of SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES) {
      const row: string | undefined = text
        .split("\n")
        .find((line: string): boolean => {
          return line.startsWith(`| **${policy.name}** |`);
        });

      expect({ policy: policy.name, found: Boolean(row) }).toEqual({
        policy: policy.name,
        found: true,
      });

      const cells: Array<string> = row!
        .split("|")
        .map((cell: string): string => {
          return cell.trim();
        })
        .filter((cell: string): boolean => {
          return cell.length > 0;
        });

      expect(cells[2]).toBe(
        policy.blockAction === SecurityBlockAction.Challenge
          ? ACTION_CHALLENGE_OPTION
          : ACTION_BLOCK_OPTION,
      );
      expect(cells[3]).toBe(lengthOf(policy.duration));

      for (const technique of policy.match.mitreTechniques) {
        expect(cells[1]).toContain(technique);
      }
    }
  });

  it("names the library rules the Scanners and Password Guessing policies run in real time", () => {
    const text: string = flat(page());
    const scanners: Array<string> = SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES[
      SecurityAutomaticResponsePolicyKind.Scanners
    ].map((id: string): string => {
      return getDetectionRuleLibraryEntry(id)!.title;
    });

    expect(scanners).toEqual([
      "SQL injection attempts",
      "Path traversal attempts",
      "Log4Shell exploit attempt",
      "Many Cloudflare managed rule hits from one address",
    ]);
    expect(text).toContain(
      "SQL injection, path traversal and Log4Shell attempts, and many Cloudflare managed rule hits from one address",
    );
    expect(
      SECURITY_AUTOMATIC_RESPONSE_LIBRARY_RULES[
        SecurityAutomaticResponsePolicyKind.PasswordGuessing
      ],
    ).toHaveLength(3);
    expect(text).toContain(
      `A project runs at most ${DETECTION_REAL_TIME_RULES_MAX} rules in real time`,
    );
    expect(text).toContain(`**${RULE_SCHEDULED}**`);
    expect(text).toContain(`**${RULE_REAL_TIME}**`);
  });
});

describe("Automatic Response docs: the guardrails", () => {
  it("gives the trial run's week, the signed-in users' 30 days, the ladder and the hourly limit as the code holds them", () => {
    const text: string = flat(page());

    expect(SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS).toBe(7);
    expect(text).toContain(
      `For ${SECURITY_AUTOMATIC_RESPONSE_TRIAL_DAYS} days it records what it would have done`,
    );
    expect(text).toContain(
      `Never an address a signed-in user used in the last ${SECURITY_SIGNED_IN_ADDRESS_LOOKBACK_DAYS} days.`,
    );
    expect(text).toContain(
      `The first block lasts ${SECURITY_REPEAT_OFFENDER_LADDER.map(
        lengthOf,
      ).join(
        ", then ",
      )} for an address blocked again within ${SECURITY_REPEAT_OFFENDER_WINDOW_DAYS} days.`,
    );
    expect(text).toContain(
      `At most ${SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR} automatic blocks an hour.`,
    );
    // Known-Bad Addresses climbs the ladder from its own first length.
    const knownBad: SecurityAutomaticResponsePolicyDefinition =
      SECURITY_AUTOMATIC_RESPONSE_READY_POLICIES.find(
        (policy: SecurityAutomaticResponsePolicyDefinition): boolean => {
          return (
            policy.kind ===
            SecurityAutomaticResponsePolicyKind.KnownBadAddresses
          );
        },
      )!;
    expect(text).toContain(
      `${knownBad.name} starts at ${lengthOf(knownBad.duration)}.`,
    );
  });
});

describe("Automatic Response docs: the Dashboard's words", () => {
  it("opens the page from the menu where the menu puts it", () => {
    const section: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find((candidate: SecurityEventsMenuSection) => {
        return candidate.items.some((item: SecurityEventsMenuItem): boolean => {
          return item.page === PageMap.SECURITY_AUTOMATIC_RESPONSE;
        });
      });

    expect(section?.title).toBe("Playbooks");
    expect(page()).toContain(
      `**Products → Security Events → ${section!.title} → ${AUTOMATIC_RESPONSE_TITLE}**`,
    );
  });

  it("names the chips, buttons and fields as the page draws them", () => {
    const text: string = page();

    for (const word of [
      MODE_OFF,
      MODE_TRIAL_RUN,
      MODE_TRIAL_FINISHED,
      MODE_ON,
      TURN_ON,
      TURN_ON_WITHOUT_TRIAL,
      CREATE_POLICY,
      EDIT_POLICY,
      DELETE_POLICY,
      TECHNIQUES_FIELD_TITLE,
      FIRST_BLOCK_FIELD_TITLE,
      THREAT_INTEL_FIELD_TITLE,
      TURNED_AWAY_FIELD_TITLE,
    ]) {
      expect({ word, named: text.includes(`**${word}**`) }).toEqual({
        word,
        named: true,
      });
    }
  });

  it("quotes the trial run's summary, the case's figure and the case's line as they are written", () => {
    const text: string = flat(page());

    expect(text).toContain(
      `"${TRIAL_WOULD_HAVE_CHALLENGED.other.replace("{{count}}", "1,283")} ${SPARED_NONE} ${TURN_IT_ON_QUESTION}"`,
    );
    expect(text).toContain(
      `"${CASE_TIME_TO_BLOCK.replace("{{time}}", "41s")}"`,
    );

    const line: string = automaticResponseBlockedMarkdown({
      action: SecurityBlockAction.Challenge,
      address: "35.205.11.131",
      enforcedAt: ["Cloudflare"],
      duration: SecurityBlockDuration.OneHour,
      policyName: "Scanners",
      secondsAfterFirstRequest: 41,
    })
      .toString()
      .replace(/^🛡️ /, "")
      .replace(/`/g, "");

    expect(text).toContain(`"${line}"`);
  });
});
