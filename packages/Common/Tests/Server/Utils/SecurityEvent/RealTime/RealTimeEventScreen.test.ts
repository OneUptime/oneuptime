import { TelemetryServiceMetadata } from "../../../../../Server/Services/OpenTelemetryIngestService";
import {
  REAL_TIME_SCREEN_TEXT_LIMIT,
  ScreenVerdict,
  matchesWildcard,
  readSigmaPattern,
  screenSecurityEventRow,
} from "../../../../../Server/Utils/SecurityEvent/RealTime/RealTimeEventScreen";
import { buildSecurityEventDbRow } from "../../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SigmaRule from "../../../../../Types/SecurityEvent/SigmaRule";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import SigmaRuleParser from "../../../../../Utils/SecurityEvent/Sigma/SigmaRuleParser";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * THE REAL-TIME SCREEN: an event's row, as ingest wrote it, read the way
 * the engine's query reads the table - and answered "no" only where that
 * is certain, so the confirming query is never handed less than it would
 * match. Each modifier the compiler knows, the three-valued and / or / not
 * / N of, and the shapes the screen leaves to the database (letters
 * outside ASCII, regular expressions, watchlists, values past its limit),
 * in linear time on a value an attacker wrote.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "31313131-3131-4313-8313-313131313131",
);

const SERVICE: TelemetryServiceMetadata = {
  serviceName: "Screen fixtures",
  primaryEntityId: new ObjectID("32323232-3232-4323-8323-323232323232"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

function row(overrides: Partial<NormalizedSecurityEvent> = {}): JSONObject {
  const normalized: NormalizedSecurityEvent = {
    time: new Date(),
    eventUid: "screen-fixture",
    categoryUid: 3,
    categoryName: "Identity & Access Management",
    classUid: 3002,
    className: "Authentication",
    activityName: "Logon",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: "Failure",
    message: "Failed password for alice from 203.0.113.9 port 22 ssh2",
    vendorName: "OpenSSH",
    productName: "sshd",
    ruleId: "",
    ruleName: "",
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110"],
    principalUser: "alice",
    principalHost: "web-01",
    principalIp: "203.0.113.9",
    principalProcess: "sshd",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "",
    targetIp: "10.0.0.5",
    targetPort: 22,
    targetResource: "",
    observables: ["203.0.113.9", "alice"],
    attributes: {
      "src.country": "NL",
      "http.status_code": "401",
      "event.count": 3,
    },
    ...overrides,
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId: PROJECT_ID,
    serviceMetadata: SERVICE,
    retentionDays: 15,
  });
}

function rule(detection: string): SigmaRule {
  return SigmaRuleParser.parse(`title: Screen
detection:
${detection}`);
}

function screen(detection: string, event: JSONObject = row()): ScreenVerdict {
  return screenSecurityEventRow(rule(detection), event);
}

describe("plain values, whatever the case", () => {
  test("equality reads text as the query does: whatever the case, the whole value", () => {
    expect(screen("  sel:\n    principalUser: Alice\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    principalUser: alic\n  condition: sel")).toBe(
      "no",
    );
    // A list of values matches any of them.
    expect(
      screen("  sel:\n    principalUser: [bob, ALICE]\n  condition: sel"),
    ).toBe("yes");
  });

  test("contains, startswith and endswith", () => {
    expect(
      screen("  sel:\n    message|contains: FAILED PASSWORD\n  condition: sel"),
    ).toBe("yes");
    expect(
      screen("  sel:\n    message|startswith: failed\n  condition: sel"),
    ).toBe("yes");
    expect(screen("  sel:\n    message|endswith: ssh2\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    message|endswith: ssh3\n  condition: sel")).toBe(
      "no",
    );
    expect(
      screen("  sel:\n    message|contains: accepted\n  condition: sel"),
    ).toBe("no");
  });

  test("Sigma's * and ? are wildcards, and a backslash makes them literal", () => {
    expect(screen("  sel:\n    principalHost: web-*\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    principalHost: web-0?\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    principalHost: web-?\n  condition: sel")).toBe(
      "no",
    );
    expect(
      screen(
        "  sel:\n    principalHost: 'web\\*'\n  condition: sel",
        row({ principalHost: "web*" }),
      ),
    ).toBe("yes");
    expect(
      screen("  sel:\n    principalHost: 'web\\*'\n  condition: sel"),
    ).toBe("no");
    // LIKE's own % and _ are text in a Sigma value.
    expect(screen("  sel:\n    principalUser: 'a_ice'\n  condition: sel")).toBe(
      "no",
    );
    expect(
      screen(
        "  sel:\n    principalUser|contains: '%'\n  condition: sel",
        row({ principalUser: "100%" }),
      ),
    ).toBe("yes");
  });

  test("cased compares exactly", () => {
    expect(
      screen("  sel:\n    principalUser|cased: Alice\n  condition: sel"),
    ).toBe("no");
    expect(
      screen("  sel:\n    principalUser|cased: alice\n  condition: sel"),
    ).toBe("yes");
  });

  test("windash matches a flag written with - or /", () => {
    const launch: JSONObject = row({
      processCommandLine: "powershell.exe /EncodedCommand SQBFAFgA",
    });

    expect(
      screen(
        "  sel:\n    CommandLine|windash|contains: -EncodedCommand\n  condition: sel",
        launch,
      ),
    ).toBe("yes");
    expect(
      screen(
        "  sel:\n    CommandLine|contains: -EncodedCommand\n  condition: sel",
        launch,
      ),
    ).toBe("no");
  });

  test("all asks every value to match", () => {
    expect(
      screen(
        "  sel:\n    message|contains|all: [failed, ssh2]\n  condition: sel",
      ),
    ).toBe("yes");
    expect(
      screen(
        "  sel:\n    message|contains|all: [failed, accepted]\n  condition: sel",
      ),
    ).toBe("no");
  });
});

describe("numbers, addresses, lists and presence", () => {
  test("a number column against a number, and its digits against text", () => {
    expect(screen("  sel:\n    classUid: 3002\n  condition: sel")).toBe("yes");
    expect(screen("  sel:\n    classUid: 3003\n  condition: sel")).toBe("no");
    expect(
      screen("  sel:\n    targetPort|startswith: '2'\n  condition: sel"),
    ).toBe("yes");
  });

  test("comparisons, on numbers and on text that is one", () => {
    expect(screen("  sel:\n    targetPort|gte: 22\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    targetPort|gt: 22\n  condition: sel")).toBe(
      "no",
    );
    expect(
      screen("  sel:\n    http.status_code|gte: 400\n  condition: sel"),
    ).toBe("yes");
    expect(
      screen("  sel:\n    http.status_code|lt: 400\n  condition: sel"),
    ).toBe("no");
    // An absent attribute is no number: the query's NULL compares as false.
    expect(screen("  sel:\n    missing.key|lt: 400\n  condition: sel")).toBe(
      "no",
    );
    // Text that is not plainly a number is the database's to read.
    expect(
      screen(
        "  sel:\n    http.status_code|gte: 400\n  condition: sel",
        row({ attributes: { "http.status_code": "4e2" } }),
      ),
    ).toBe("maybe");
  });

  test("cidr, on an IPv4 address; an empty field is no address", () => {
    expect(
      screen("  sel:\n    principalIp|cidr: 203.0.113.0/24\n  condition: sel"),
    ).toBe("yes");
    expect(
      screen("  sel:\n    principalIp|cidr: 10.0.0.0/8\n  condition: sel"),
    ).toBe("no");
    expect(
      screen(
        "  sel:\n    principalIp|cidr: 10.0.0.0/8\n  condition: sel",
        row({ principalIp: "" }),
      ),
    ).toBe("no");
    // IPv6 is the database's.
    expect(
      screen(
        "  sel:\n    principalIp|cidr: 2001:db8::/32\n  condition: sel",
        row({ principalIp: "2001:db8::1" }),
      ),
    ).toBe("maybe");
  });

  test("a list column: exact membership, or contains whatever the case", () => {
    expect(screen("  sel:\n    mitreTechniques: T1110\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    mitreTechniques: t1110\n  condition: sel")).toBe(
      "no",
    );
    expect(
      screen("  sel:\n    observables|contains: ALICE\n  condition: sel"),
    ).toBe("yes");
  });

  test("exists and null read presence: an attribute's key, a column's emptiness", () => {
    expect(
      screen("  sel:\n    src.country|exists: true\n  condition: sel"),
    ).toBe("yes");
    expect(screen("  sel:\n    src.city|exists: true\n  condition: sel")).toBe(
      "no",
    );
    expect(screen("  sel:\n    src.city: null\n  condition: sel")).toBe("yes");
    expect(screen("  sel:\n    targetUser: null\n  condition: sel")).toBe(
      "yes",
    );
    expect(screen("  sel:\n    principalUser: null\n  condition: sel")).toBe(
      "no",
    );
  });

  test("an attribute's own text is read; one that is not text is the database's", () => {
    expect(screen("  sel:\n    src.country: nl\n  condition: sel")).toBe("yes");
    expect(screen("  sel:\n    event.count: 3\n  condition: sel")).toBe(
      "maybe",
    );
    // An absent attribute is '' to the query.
    expect(screen("  sel:\n    src.city: ''\n  condition: sel")).toBe("yes");
  });

  test("keywords match the message, any of them", () => {
    expect(
      screen("  keywords:\n    - nothing\n    - SSH2\n  condition: keywords"),
    ).toBe("yes");
    expect(screen("  keywords:\n    - nothing\n  condition: keywords")).toBe(
      "no",
    );
  });
});

describe("conditions, in three values", () => {
  const BOTH: string =
    "  failure:\n    statusName: Failure\n  remote:\n    principalIp|cidr: 10.0.0.0/8\n";

  test("and, or and not", () => {
    expect(screen(`${BOTH}  condition: failure and not remote`)).toBe("yes");
    expect(screen(`${BOTH}  condition: failure and remote`)).toBe("no");
    expect(screen(`${BOTH}  condition: failure or remote`)).toBe("yes");
    expect(screen(`${BOTH}  condition: not failure or remote`)).toBe("no");
  });

  test("1 of, all of and N of", () => {
    const three: string =
      "  sel_a:\n    principalUser: alice\n  sel_b:\n    principalHost: web-01\n  sel_c:\n    statusName: Success\n";

    expect(screen(`${three}  condition: 1 of sel_*`)).toBe("yes");
    expect(screen(`${three}  condition: all of sel_*`)).toBe("no");
    expect(screen(`${three}  condition: 2 of sel_*`)).toBe("yes");
    expect(screen(`${three}  condition: all of them`)).toBe("no");
  });

  test("what the screen cannot read stays maybe through not, and decides nothing it must not", () => {
    const unsure: string =
      "  sel:\n    CommandLine|re: 'evil'\n  failure:\n    statusName: Failure\n";

    expect(screen(`${unsure}  condition: sel`)).toBe("maybe");
    expect(screen(`${unsure}  condition: not sel`)).toBe("maybe");
    // A certain no decides an and; a certain yes decides an or.
    expect(screen(`${unsure}  condition: sel and not failure`)).toBe("no");
    expect(screen(`${unsure}  condition: sel or failure`)).toBe("yes");
    expect(screen(`${unsure}  condition: sel and failure`)).toBe("maybe");
  });

  test("N of counts the maybes as could-be", () => {
    const mixed: string =
      "  sel_a:\n    principalUser: alice\n  sel_b:\n    CommandLine|re: 'x'\n  sel_c:\n    statusName: Success\n";

    expect(screen(`${mixed}  condition: 2 of sel_*`)).toBe("maybe");
    expect(screen(`${mixed}  condition: 3 of sel_*`)).toBe("no");
  });
});

describe("what the screen leaves to the database", () => {
  test("letters outside ASCII, unless compared exactly", () => {
    const accented: JSONObject = row({ principalUser: "José" });

    expect(
      screen("  sel:\n    principalUser: josé\n  condition: sel", accented),
    ).toBe("maybe");
    expect(
      screen("  sel:\n    principalUser: bob\n  condition: sel", accented),
    ).toBe("maybe");
    expect(
      screen(
        "  sel:\n    principalUser|cased: José\n  condition: sel",
        accented,
      ),
    ).toBe("yes");
    // A ? over text outside ASCII is the database's, compared exactly or not.
    expect(
      screen(
        "  sel:\n    principalUser|cased: Jos?\n  condition: sel",
        accented,
      ),
    ).toBe("maybe");
  });

  test("a watchlist, which the project holds", () => {
    expect(
      screen(
        "  sel:\n    principalUser|expand: '%vip_users%'\n  condition: sel",
      ),
    ).toBe("maybe");
  });

  test("a value longer than the screen reads", () => {
    const long: JSONObject = row({
      message: "x".repeat(REAL_TIME_SCREEN_TEXT_LIMIT + 1),
    });

    expect(
      screen("  sel:\n    message|contains: evil\n  condition: sel", long),
    ).toBe("maybe");
    expect(REAL_TIME_SCREEN_TEXT_LIMIT).toBe(65536);
  });

  test("a rule naming a selection it does not have is not the screen's to refuse", () => {
    expect(
      screenSecurityEventRow(
        {
          ...rule("  sel:\n    principalUser: alice\n  condition: sel"),
          condition: { kind: "selection", name: "gone" },
        },
        row(),
      ),
    ).toBe("maybe");
  });
});

describe("the wildcard matcher", () => {
  test("reads a Sigma value's pieces as sigmaPatternToLike does", () => {
    expect(readSigmaPattern("a*b?c")).toEqual([
      { kind: "text", text: "a" },
      { kind: "any" },
      { kind: "text", text: "b" },
      { kind: "one" },
      { kind: "text", text: "c" },
    ]);
    expect(readSigmaPattern("a\\*b\\\\c\\")).toEqual([
      { kind: "text", text: "a*b\\c\\" },
    ]);
  });

  test("matches whole text with any runs and single characters", () => {
    const cases: Array<[string, string, boolean]> = [
      ["web-01", "web-*", true],
      ["web-01", "*-01", true],
      ["web-01", "w?b-*1", true],
      ["web-01", "web-?", false],
      ["", "*", true],
      ["", "?", false],
      ["abc", "a*b*c*", true],
      ["abcabd", "*abd", true],
      ["mississippi", "*sip*", true],
      ["mississippi", "m*iss*pi", true],
      ["mississippi", "m*x*", false],
    ];

    for (const [text, pattern, expected] of cases) {
      expect([
        text,
        pattern,
        matchesWildcard(text, readSigmaPattern(pattern)),
      ]).toEqual([text, pattern, expected]);
    }
  });

  test("takes linear time on the longest value it reads, built to make a backtracking matcher try every split", () => {
    const attack: JSONObject = row({
      processCommandLine: "a".repeat(REAL_TIME_SCREEN_TEXT_LIMIT),
    });
    const greedy: SigmaRule = rule(
      "  sel:\n    CommandLine: '*a*a*a*a*a*a*a*a*b'\n  condition: sel",
    );

    const timed: FastestRun<ScreenVerdict> = fastestRun({
      run: (): ScreenVerdict => {
        return screenSecurityEventRow(greedy, attack);
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe("no");
    expect(timed.inMs).toBeLessThan(2000);
  });
});
