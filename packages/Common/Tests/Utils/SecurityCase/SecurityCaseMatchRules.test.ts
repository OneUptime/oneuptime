import {
  SECURITY_CASE_MATCHES_GUIDANCE_MAX_LENGTH,
  SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH,
  SECURITY_CASE_MATCHES_MAX_GUIDANCE_LINES,
  SECURITY_CASE_MATCHES_MAX_LOOK_FOR,
  SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS,
  SECURITY_CASE_MATCHES_PADDING_IN_MINUTES,
  SecurityCaseMatchLookForJson,
} from "../../../Types/SecurityCase/SecurityCaseMatches";
import { DETECTION_RULE_LIBRARY } from "../../../Types/SecurityEvent/DetectionRuleLibrary";
import SigmaRule from "../../../Types/SecurityEvent/SigmaRule";
import {
  KEYWORD_FIELD,
  SecurityCaseMatchWindow,
  TextMatchPart,
  getDetectionMatchWindow,
  getLookForValues,
  getPositiveSelectionNames,
  getSigmaLiteralFragments,
  getSigmaRuleLookFor,
  readSigmaRuleGuidance,
  splitTextByLookFor,
} from "../../../Utils/SecurityCase/SecurityCaseMatchRules";
import SigmaRuleParser from "../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { describe, expect, test } from "@jest/globals";

/*
 * What a detection matched, the pure half: what a rule's condition looks
 * for (so the case marks it in each event), the guidance the rule's own
 * YAML gives, and the time a detection's events are read over (#9556).
 */

function rule(detection: string, extra: string = ""): SigmaRule {
  return SigmaRuleParser.parse(`title: Test rule
id: 00000000-0000-4000-8000-000000000001
level: medium
${extra}
detection:
${detection}
`);
}

const PATH_TRAVERSAL: string = DETECTION_RULE_LIBRARY.find(
  (entry: { title: string }): boolean => {
    return entry.title === "Path traversal attempts";
  },
)!.sigmaRuleYaml;

describe("the selections a condition needs to match", () => {
  test("are the ones under no not, never the filter it takes away", () => {
    const parsed: SigmaRule = rule(`  selection:
    targetResource|contains: '../'
  filter:
    principalIp: 10.0.0.1
  condition: selection and not filter`);

    expect(Array.from(getPositiveSelectionNames(parsed))).toEqual([
      "selection",
    ]);
  });

  test("read a quantifier's pattern: one of a prefix, all of them", () => {
    const prefixed: SigmaRule = rule(`  selection_a:
    message|contains: alpha
  selection_b:
    message|contains: beta
  other:
    message|contains: gamma
  condition: 1 of selection_* and not other`);

    expect(Array.from(getPositiveSelectionNames(prefixed)).sort()).toEqual([
      "selection_a",
      "selection_b",
    ]);

    const all: SigmaRule = rule(`  one:
    message|contains: alpha
  two:
    message|contains: beta
  condition: all of them`);

    expect(Array.from(getPositiveSelectionNames(all)).sort()).toEqual([
      "one",
      "two",
    ]);
  });

  test("count a not twice as none", () => {
    const parsed: SigmaRule = rule(`  selection:
    message|contains: alpha
  condition: not (not selection)`);

    expect(Array.from(getPositiveSelectionNames(parsed))).toEqual([
      "selection",
    ]);
  });
});

describe("the literal text in a Sigma value", () => {
  test("is the runs between its wildcards", () => {
    expect(getSigmaLiteralFragments("*/etc/passwd*")).toEqual(["/etc/passwd"]);
    expect(getSigmaLiteralFragments("cmd*.exe /c")).toEqual(["cmd", ".exe /c"]);
    expect(getSigmaLiteralFragments("a?bc")).toEqual(["bc"]);
  });

  test("keeps an escaped wildcard as the character it is", () => {
    expect(getSigmaLiteralFragments("100\\*")).toEqual(["100*"]);
  });

  test("leaves out a run too short to say anything", () => {
    expect(getSigmaLiteralFragments("*a*")).toEqual([]);
    expect(getSigmaLiteralFragments("*  *")).toEqual([]);
    expect(getSigmaLiteralFragments("..")).toEqual([".."]);
  });
});

describe("what a rule looks for", () => {
  test("is the library's path traversal rule's strings, under the field it reads", () => {
    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      SigmaRuleParser.parse(PATH_TRAVERSAL),
    ]);

    expect(lookFor).toEqual([
      {
        field: "targetResource",
        values: ["../../", "..%2f", "%2e%2e%2f", "/etc/passwd"],
      },
    ]);
  });

  test("says each value once, whatever its case", () => {
    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      rule(`  selection:
    targetResource|contains:
      - '..%2f'
      - '..%2F'
  condition: selection`),
    ]);

    expect(getLookForValues(lookFor)).toEqual(["..%2f"]);
  });

  test("leaves out what a not takes away", () => {
    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      rule(`  selection:
    processCommandLine|contains: mimikatz
  filter:
    processCommandLine|contains: authorized-test
  condition: selection and not filter`),
    ]);

    expect(lookFor).toEqual([
      { field: "processCommandLine", values: ["mimikatz"] },
    ]);
  });

  test("reads a keyword list against the message", () => {
    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      rule(`  keywords:
    - 'jndi:ldap'
    - 'jndi:rmi'
  condition: keywords`),
    ]);

    expect(lookFor).toEqual([
      { field: KEYWORD_FIELD, values: ["jndi:ldap", "jndi:rmi"] },
    ]);
  });

  test("leaves out a category, a regular expression, a range, a comparison and a number", () => {
    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      rule(`  selection:
    className: Authentication
    statusName: Failure
    principalUser|re: '^adm.*'
    principalIp|cidr: 10.0.0.0/8
    targetPort|gte: 1024
    severityId: 4
    targetResource|startswith: /admin
  condition: selection`),
    ]);

    expect(lookFor).toEqual([{ field: "targetResource", values: ["/admin"] }]);
  });

  test("reads a correlation's rules alike", () => {
    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      rule(`  selection:
    message|contains: failed password
  condition: selection`),
      rule(`  selection:
    message|contains: accepted password
  condition: selection`),
    ]);

    expect(getLookForValues(lookFor)).toEqual([
      "failed password",
      "accepted password",
    ]);
  });

  test("holds at most its bound of values, each cut to its length", () => {
    const many: string = Array.from({ length: 40 }, (_: unknown, i: number) => {
      return `      - 'value-${i}'`;
    }).join("\n");
    const long: string = "x".repeat(400);

    const lookFor: Array<SecurityCaseMatchLookForJson> = getSigmaRuleLookFor([
      rule(`  selection:
    message|contains:
      - '${long}'
${many}
  condition: selection`),
    ]);
    const values: Array<string> = getLookForValues(lookFor);

    expect(values).toHaveLength(SECURITY_CASE_MATCHES_MAX_LOOK_FOR);
    expect(values[0]).toHaveLength(SECURITY_CASE_MATCHES_LOOK_FOR_MAX_LENGTH);
  });

  test("is nothing for no rule", () => {
    expect(getSigmaRuleLookFor([])).toEqual([]);
  });
});

describe("a rule's own guidance", () => {
  test("is its false positives and its web references", () => {
    expect(
      readSigmaRuleGuidance(`title: Scanner
falsepositives:
  - Vulnerability scanners your team runs
  - Unknown
references:
  - https://owasp.org/www-community/attacks/Path_Traversal
  - not a link
  - ftp://example.com/file
detection:
  selection:
    message: x
  condition: selection
`),
    ).toEqual({
      falsePositives: ["Vulnerability scanners your team runs"],
      references: ["https://owasp.org/www-community/attacks/Path_Traversal"],
    });
  });

  test("reads a single line, and every document of a correlation's file once", () => {
    expect(
      readSigmaRuleGuidance(`title: First
falsepositives: Backup jobs
---
title: Second
falsepositives:
  - backup jobs
  - Admins testing sign-ins
`),
    ).toEqual({
      falsePositives: ["Backup jobs", "Admins testing sign-ins"],
      references: [],
    });
  });

  test("is nothing for YAML that does not read, or none", () => {
    expect(readSigmaRuleGuidance("title: [unclosed")).toEqual({
      falsePositives: [],
      references: [],
    });
    expect(readSigmaRuleGuidance("")).toEqual({
      falsePositives: [],
      references: [],
    });
  });

  test("keeps its bound of lines, each cut to its length", () => {
    const lines: string = Array.from(
      { length: 15 },
      (_: unknown, i: number) => {
        return `  - Case ${i} ${"y".repeat(400)}`;
      },
    ).join("\n");
    const guidance: ReturnType<typeof readSigmaRuleGuidance> =
      readSigmaRuleGuidance(`falsepositives:\n${lines}\n`);

    expect(guidance.falsePositives).toHaveLength(
      SECURITY_CASE_MATCHES_MAX_GUIDANCE_LINES,
    );
    expect(guidance.falsePositives[0]).toHaveLength(
      SECURITY_CASE_MATCHES_GUIDANCE_MAX_LENGTH,
    );
    expect(guidance.falsePositives[0]!.endsWith("…")).toBe(true);
  });
});

describe("marking what a rule looks for in an event", () => {
  test("marks every occurrence, whatever its case", () => {
    const parts: Array<TextMatchPart> = splitTextByLookFor(
      "GET /api/get_log_file/../../../../proc/self/environ → 404",
      ["../../"],
    );

    expect(parts).toEqual([
      { text: "GET /api/get_log_file/", isMatch: false },
      { text: "../../../../", isMatch: true },
      { text: "proc/self/environ → 404", isMatch: false },
    ]);

    expect(splitTextByLookFor("GET /A/..%2F..%2Fetc", ["..%2f"])).toEqual([
      { text: "GET /A/", isMatch: false },
      { text: "..%2F..%2F", isMatch: true },
      { text: "etc", isMatch: false },
    ]);
  });

  test("marks overlapping values once, as one run", () => {
    expect(
      splitTextByLookFor("cat /etc/passwd", ["/etc/passwd", "etc"]),
    ).toEqual([
      { text: "cat ", isMatch: false },
      { text: "/etc/passwd", isMatch: true },
    ]);
  });

  test("is the whole text unmarked when nothing is looked for, and nothing for no text", () => {
    expect(splitTextByLookFor("plain", [])).toEqual([
      { text: "plain", isMatch: false },
    ]);
    expect(splitTextByLookFor("plain", ["a"])).toEqual([
      { text: "plain", isMatch: false },
    ]);
    expect(splitTextByLookFor("", ["x"])).toEqual([]);
  });
});

describe("the time a detection's events are read over", () => {
  const NOW: Date = new Date("2026-11-17T21:00:00.000Z");
  const FIRST: Date = new Date("2026-11-17T19:28:00.000Z");

  function minutes(window: SecurityCaseMatchWindow | null): [number, number] {
    return [
      (FIRST.getTime() - window!.start.getTime()) / 60000,
      (window!.end.getTime() - FIRST.getTime()) / 60000,
    ];
  }

  test("starts a rule's window (and a minute) before it first fired, and ends a minute after it last did", () => {
    const window: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
      firstSeenAt: FIRST,
      lastSeenAt: new Date(FIRST.getTime() + 10 * 60000),
      lookBackInMinutes: 5,
      now: NOW,
    });

    expect(minutes(window)).toEqual([6, 11]);
  });

  test("reads a source with no window a few minutes either side", () => {
    const window: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
      firstSeenAt: FIRST,
      lastSeenAt: FIRST,
      now: NOW,
    });

    expect(minutes(window)).toEqual([
      SECURITY_CASE_MATCHES_PADDING_IN_MINUTES,
      SECURITY_CASE_MATCHES_PADDING_IN_MINUTES,
    ]);
  });

  test("is at most a day from its start, and never past now", () => {
    const long: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
      firstSeenAt: FIRST,
      lastSeenAt: new Date(FIRST.getTime() + 5 * 24 * 60 * 60000),
      lookBackInMinutes: 5,
      now: new Date(FIRST.getTime() + 6 * 24 * 60 * 60000),
    });

    expect(long!.end.getTime() - long!.start.getTime()).toBe(
      SECURITY_CASE_MATCHES_MAX_WINDOW_IN_HOURS * 60 * 60000,
    );

    const recent: SecurityCaseMatchWindow | null = getDetectionMatchWindow({
      firstSeenAt: FIRST,
      lastSeenAt: FIRST,
      now: new Date(FIRST.getTime() + 60000),
    });

    expect(recent!.end.toISOString()).toBe(
      new Date(FIRST.getTime() + 60000).toISOString(),
    );
  });

  test("reads a detection with only a first firing, and none with no time", () => {
    expect(
      getDetectionMatchWindow({
        firstSeenAt: FIRST.toISOString(),
        lastSeenAt: undefined,
        now: NOW,
      }),
    ).not.toBeNull();
    expect(
      getDetectionMatchWindow({
        firstSeenAt: null,
        lastSeenAt: null,
        now: NOW,
      }),
    ).toBeNull();
    expect(
      getDetectionMatchWindow({
        firstSeenAt: "not a date",
        lastSeenAt: null,
        now: NOW,
      }),
    ).toBeNull();
  });
});
