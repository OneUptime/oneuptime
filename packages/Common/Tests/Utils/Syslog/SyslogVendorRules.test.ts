import NetworkEventAttribute from "../../../Types/NetworkEvent/NetworkEventAttribute";
import {
  NETWORK_EVENT_DEFINITIONS,
  NetworkEventDefinition,
  NetworkEventTypeUtil,
} from "../../../Types/NetworkEvent/NetworkEventType";
import SyslogEventNormalizer from "../../../Utils/Syslog/SyslogEventNormalizer";
import { SYSLOG_VENDOR_PARSERS } from "../../../Utils/Syslog/SyslogVendorCatalog";
import {
  MAX_VENDOR_TEXT_LENGTH,
  SyslogEventRule,
  SyslogRuleFieldCondition,
  SyslogRuleValueSource,
  SyslogVendorParser,
} from "../../../Utils/Syslog/SyslogVendorParser";
import { describe, expect, it } from "@jest/globals";

/*
 * The parsers' event rules, held to what makes them safe to run on every
 * syslog message a network sends - text whoever can reach the syslog port
 * controls:
 *
 *   - a rule names an event of the vocabulary and attributes of it, and
 *     every "$1" it reads is a group its pattern has;
 *   - no pattern keeps state between messages (no g or y flag);
 *   - no pattern is slow: each is timed on text built from its own words,
 *     at the longest length a rule is ever handed.
 *
 * What each rule matches is tested on the vendors' sample lines
 * (SyslogVendorParsers.test.ts); this suite is about the rules as data.
 */

interface RuleCase {
  parser: SyslogVendorParser;
  rule: SyslogEventRule;
  index: number;
  label: string;
}

const RULES: Array<RuleCase> = SYSLOG_VENDOR_PARSERS.flatMap(
  (parser: SyslogVendorParser): Array<RuleCase> => {
    return parser.rules.map(
      (rule: SyslogEventRule, index: number): RuleCase => {
        return {
          parser: parser,
          rule: rule,
          index: index,
          label: `${parser.id} #${index} (${rule.event})`,
        };
      },
    );
  },
);

// Every pattern a rule holds: its text, and its field conditions that are patterns.
function patternsOf(rule: SyslogEventRule): Array<RegExp> {
  const patterns: Array<RegExp> = [];

  if (rule.text) {
    patterns.push(rule.text);
  }

  for (const condition of Object.values(
    rule.when || {},
  ) as Array<SyslogRuleFieldCondition>) {
    if (condition instanceof RegExp) {
      patterns.push(condition);
    }
  }

  return patterns;
}

// How many groups a pattern captures.
function groupCount(pattern: RegExp): number {
  const probe: RegExpExecArray | null = new RegExp(
    `${pattern.source}|`,
    pattern.flags,
  ).exec("");

  return probe ? probe.length - 1 : 0;
}

function sourcesOf(rule: SyslogEventRule): Array<string> {
  return (
    Object.values(rule.set || {}) as Array<SyslogRuleValueSource>
  ).flatMap((source: SyslogRuleValueSource): Array<string> => {
    return Array.isArray(source) ? source : [source];
  });
}

const GROUP_SOURCE: RegExp = /^\$(\d+)$/;
const FIELD_SOURCE: RegExp = /^@[A-Za-z_][A-Za-z0-9_.-]*$/;
const NAMED_GROUP: RegExp = /\(\?<[A-Za-z]/;
const WORD: RegExp = /[A-Za-z]{2,}/g;

describe("the catalog's rules, as data", () => {
  it("there are rules to hold", () => {
    expect(RULES.length).toBeGreaterThan(120);
  });

  it("every rule names an event of the vocabulary", () => {
    for (const ruleCase of RULES) {
      expect({
        rule: ruleCase.label,
        known: NetworkEventTypeUtil.isBuiltIn(ruleCase.rule.event),
      }).toEqual({ rule: ruleCase.label, known: true });
    }
  });

  it("every rule says when it matches: a field, the words, or both", () => {
    for (const ruleCase of RULES) {
      const conditions: number =
        Object.keys(ruleCase.rule.when || {}).length +
        (ruleCase.rule.text ? 1 : 0);

      expect({ rule: ruleCase.label, hasCondition: conditions > 0 }).toEqual({
        rule: ruleCase.label,
        hasCondition: true,
      });
    }
  });

  it("every attribute a rule sets is one of the vocabulary's", () => {
    const known: Array<string> = Object.values(NetworkEventAttribute);
    // The normalizer writes these itself, from the rule's event and the device's words.
    const reserved: Array<string> = [
      NetworkEventAttribute.Domain,
      NetworkEventAttribute.Name,
      NetworkEventAttribute.Message,
    ];

    for (const ruleCase of RULES) {
      for (const attribute of Object.keys(ruleCase.rule.set || {})) {
        expect({
          rule: ruleCase.label,
          attribute,
          known: known.includes(attribute),
          reserved: reserved.includes(attribute),
        }).toEqual({
          rule: ruleCase.label,
          attribute,
          known: true,
          reserved: false,
        });
      }
    }
  });

  it("every $N a rule reads is a group of its own pattern", () => {
    for (const ruleCase of RULES) {
      const groups: number = ruleCase.rule.text
        ? groupCount(ruleCase.rule.text)
        : 0;

      for (const source of sourcesOf(ruleCase.rule)) {
        const group: RegExpMatchArray | null = source.match(GROUP_SOURCE);

        if (source.startsWith("$")) {
          expect({
            rule: ruleCase.label,
            source,
            inRange:
              group !== null &&
              parseInt(group[1] as string, 10) >= 1 &&
              parseInt(group[1] as string, 10) <= groups,
          }).toEqual({ rule: ruleCase.label, source, inRange: true });
        }
      }
    }
  });

  it("every @field a rule reads is a field name, and every literal is plain text", () => {
    for (const ruleCase of RULES) {
      for (const source of sourcesOf(ruleCase.rule)) {
        if (source.startsWith("@")) {
          expect({
            rule: ruleCase.label,
            source,
            valid: FIELD_SOURCE.test(source),
          }).toEqual({ rule: ruleCase.label, source, valid: true });
        } else if (!source.startsWith("$")) {
          expect({
            rule: ruleCase.label,
            source,
            plain: source.trim().length > 0 && source === source.trim(),
          }).toEqual({ rule: ruleCase.label, source, plain: true });
        }
      }
    }
  });

  it("a pattern with groups reads at least one of them", () => {
    for (const ruleCase of RULES) {
      if (!ruleCase.rule.text || groupCount(ruleCase.rule.text) === 0) {
        continue;
      }

      expect({
        rule: ruleCase.label,
        readsAGroup: sourcesOf(ruleCase.rule).some(
          (source: string): boolean => {
            return GROUP_SOURCE.test(source);
          },
        ),
      }).toEqual({ rule: ruleCase.label, readsAGroup: true });
    }
  });

  it("no pattern keeps state between messages, and none names its groups", () => {
    for (const ruleCase of RULES) {
      for (const pattern of patternsOf(ruleCase.rule)) {
        expect({
          rule: ruleCase.label,
          // Only "i" - a g or y pattern would remember where it last matched.
          flags: pattern.flags,
          named: NAMED_GROUP.test(pattern.source),
        }).toEqual({
          rule: ruleCase.label,
          flags: pattern.flags === "i" ? "i" : "",
          named: false,
        });
      }
    }
  });

  it("a rule that reads a subject sets the attribute its event names", () => {
    /*
     * An event's subject is what a monitor groups by. A rule may leave it
     * out when the message names none, but when it sets an attribute the
     * event has as its subject, good - and it must never set ANOTHER
     * event's reserved name by mistake (checked above). Here: every event
     * with a subject is given it by at least one rule somewhere.
     */
    for (const definition of NETWORK_EVENT_DEFINITIONS) {
      if (!definition.subjectAttribute) {
        continue;
      }

      const rulesOfEvent: Array<RuleCase> = RULES.filter(
        (ruleCase: RuleCase): boolean => {
          return ruleCase.rule.event === definition.type;
        },
      );

      expect({
        event: definition.type,
        subject: definition.subjectAttribute,
        setSomewhere: rulesOfEvent.some((ruleCase: RuleCase): boolean => {
          return Object.keys(ruleCase.rule.set || {}).includes(
            definition.subjectAttribute as string,
          );
        }),
      }).toEqual({
        event: definition.type,
        subject: definition.subjectAttribute,
        setSomewhere: true,
      });
    }
  });

  it("every event of the vocabulary is read from at least one vendor", () => {
    const produced: Set<string> = new Set(
      RULES.map((ruleCase: RuleCase): string => {
        return ruleCase.rule.event;
      }),
    );

    expect(
      NETWORK_EVENT_DEFINITIONS.filter(
        (definition: NetworkEventDefinition): boolean => {
          return !produced.has(definition.type);
        },
      ).map((definition: NetworkEventDefinition): string => {
        return definition.type;
      }),
    ).toEqual([]);
  });
});

/*
 * Text built to make a pattern work as hard as it can: its own words, over
 * and over, to the longest length a rule is handed - so every partial
 * match is tried and abandoned as often as possible.
 */
function slowTextsFor(pattern: RegExp): Array<string> {
  const words: Array<string> = Array.from(
    new Set(pattern.source.match(WORD) || []),
  );
  const texts: Array<string> = [];

  const fill: (piece: string) => string = (piece: string): string => {
    return piece
      .repeat(Math.ceil(MAX_VENDOR_TEXT_LENGTH / Math.max(piece.length, 1)))
      .slice(0, MAX_VENDOR_TEXT_LENGTH);
  };

  for (const word of words) {
    texts.push(fill(`${word} `));
    texts.push(fill(word));
  }

  if (words.length > 0) {
    texts.push(fill(`${words.join(" ")} `));
    texts.push(fill(`${words.join(" x ")} `));
  }

  for (const piece of [
    "a",
    " ",
    "a ",
    "1",
    "1:",
    ".",
    ",",
    ", ",
    "(",
    "[",
    "]",
    "'",
    '"',
    "/",
    "-",
    "=",
    "->",
    "0x",
    "a:b ",
    "10.0.0.1 ",
    "00:11:22:33:44:55 ",
  ]) {
    texts.push(fill(piece));
  }

  /*
   * And each of them ending in a character no pattern expects, so a
   * pattern that got as far as the end has to give everything back.
   */
  return texts.flatMap((text: string): Array<string> => {
    return [text, `${text.slice(0, -1)}!`, `${text.slice(0, -2)}\n!`];
  });
}

// The fastest of a few runs, so a pause of the machine is not mistaken for a slow pattern.
function fastestRun(pattern: RegExp, text: string): number {
  let fastest: number = Number.POSITIVE_INFINITY;

  for (let run: number = 0; run < 3; run++) {
    const startedAt: bigint = process.hrtime.bigint();

    pattern.test(text);

    const elapsed: number =
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    fastest = Math.min(fastest, elapsed);
  }

  return fastest;
}

// A pattern that needs this long for one message would hold up ingest.
const SLOW_PATTERN_MILLISECONDS: number = 25;

describe("no rule pattern is slow", () => {
  it("each matches, or gives up, in a few milliseconds on text built from its own words", () => {
    const slow: Array<string> = [];

    for (const ruleCase of RULES) {
      for (const pattern of patternsOf(ruleCase.rule)) {
        for (const text of slowTextsFor(pattern)) {
          const elapsed: number = fastestRun(pattern, text);

          if (elapsed > SLOW_PATTERN_MILLISECONDS) {
            slow.push(
              `${ruleCase.label} /${pattern.source}/ took ${elapsed.toFixed(1)} ms on ${JSON.stringify(text.slice(0, 40))}...`,
            );
          }
        }
      }
    }

    expect(slow).toEqual([]);
  });
});

/*
 * Whole messages built to be slow, through everything a message goes
 * through: every parser's detection, the detected parser's extraction, and
 * its rules. Each starts with a vendor's mark, so that vendor's parser
 * takes it, and goes on for a megabyte.
 */
const MARKS: Array<string> = [
  "",
  "%LINK-3-UPDOWN: ",
  "%LINK-3-UPDOWN: Interface ",
  "<Info> ",
  "<Info:vlan.msgs.portLinkStateDown> Port ",
  "CP1 [03/18/70 09:55:35.890] 0x0000c5e7 00300001.238 DYNAMIC SET GlobalRouter HW INFO ",
  "Event|403|LOG_INFO|AMM|1/1|",
  "00077 ports: ",
  "system,info ",
  "interface,info ",
  "WIFI-6-CLIENT-CONNECTED ",
  "kernel: ",
  "sshd[1]: ",
  "hostapd: ",
  "dropbear[1]: ",
  'log_type="Event" log_component="Interface" log_subtype="System" message="',
  'log_type="Event" log_component="HA" log_subtype="System" message="',
  'logid="0100020099" type="event" subtype="sdwan" status="down" msg="',
  "CEF:0|Ubiquiti|UniFi Network|9.3.33|401|WiFi Client Disconnected|2|msg=",
  "CEF:0|MikroTik|hAP|7.18|10|system,error,critical|High|msg=",
  "CEF:0|Example|Thing|1|1|Name|5|",
];

const TAILS: Array<string> = [
  "a",
  " ",
  "a ",
  "Interface ",
  "port ",
  "Port 1:1 link ",
  "login failure for user ",
  "from ",
  " is ",
  "k=v ",
  'k="v" ',
  "=",
  '"',
  "\\",
  "|",
  "%",
  "<",
  "[",
  "(",
  "CEF:",
  "Event|",
  ",",
  "x,",
  "1",
  ".",
];

describe("no message is slow, whatever it holds", () => {
  it("reads a megabyte behind any vendor's mark in a few milliseconds", () => {
    const slow: Array<string> = [];

    for (const mark of MARKS) {
      for (const tail of TAILS) {
        const message: string =
          mark + tail.repeat(Math.ceil(1_000_000 / tail.length));
        const startedAt: number = Date.now();

        SyslogEventNormalizer.normalize({ message: message });

        const elapsed: number = Date.now() - startedAt;

        if (elapsed > 250) {
          slow.push(
            `${JSON.stringify(mark)} + ${JSON.stringify(tail)}... took ${elapsed} ms`,
          );
        }
      }
    }

    expect(slow).toEqual([]);
  });

  it("reads the same messages as the content of a line with a short body", () => {
    for (const mark of MARKS) {
      const content: string = mark + "a ".repeat(500_000);
      const startedAt: number = Date.now();

      SyslogEventNormalizer.normalize({ message: "short", content: content });

      expect({
        mark,
        fast: Date.now() - startedAt < 250,
      }).toEqual({ mark, fast: true });
    }
  });
});
