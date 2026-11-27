import { describe, expect, test } from "@jest/globals";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import ToolResultSerializer from "../../../Server/Utils/AI/Toolbox/Serializer";
import {
  buildMetricScrubFilters,
  buildMetricScrubRule,
  buildScrubPatternForDataType,
  getScrubTarget,
  ScrubTarget,
} from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { readHashedUserPair } from "../../../Server/Utils/SecurityEvent/UserVault/HashedUserPairs";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "../../../Server/Utils/Telemetry/MetricPipelineEngine";
import ScrubAction from "../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import { DataStoreKind } from "../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import { MetricPipelineRuleFilterConditionType } from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import ObjectID from "../../../Types/ObjectID";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
} from "../../../Types/Telemetry/ScrubRule";
import { getDataTypePrefilter } from "../../../Utils/DataSecurity/DetectorPrefilter";
import { maskValue } from "../../../Utils/DataSecurity/Masking";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../Utils/Telemetry/ScrubBuiltInPatterns";

/*
 * ---------------------------------------------------------------------------
 * THREE PHONE AND SOCIAL SECURITY NUMBER GAPS #11089 LEFT, CLOSED.
 *
 *   - #11115: a number typed wholly in fullwidth, as Japanese and Chinese
 *     text writes one - its plus sign ＋, hyphens －, parentheses （ ）, full
 *     stops ． and ideographic spaces too, ＋８１ ３－１２３４－５６７８ - was
 *     neither found nor hidden, since every pattern sets a number's groups
 *     apart with ASCII characters. It is now, by every rule built on the
 *     detectors, under every action, Hash giving the plain number's token;
 *     and by a Custom Regex rule, the AI toolbox's card redaction, the
 *     Security Events user vault and the database search;
 *   - #11114: Data Security finds a national phone number of 9 to 12 digits
 *     and an SSN as nine digits in a row only beside a word that names them
 *     ("tel 02012345678", "SSN 536221234"), and a Phone Number or SSN rule
 *     did not hide them. It does now, judged by the words in the value as
 *     the scanner judges them, and nine digits no word names stay;
 *   - #11112: the metric rule Scrub It makes for a phone or SSN finding
 *     froze the detectors' shapes into a Matches Regex filter, which took a
 *     decimal for a phone number and read no other writing. It matches the
 *     type's Pattern Type now, as log and trace rules do.
 *
 * Every check here reads the code through what it offered before these
 * changes, so each fails on that code and passes on this.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000011115",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "0193b0a1-0000-7000-8000-000000011112",
);

const IDEOGRAPHIC_SPACE: string = "　";

// A text typed wholly in fullwidth: its digits, its signs and separators, its spaces.
function inFullwidth(text: string): string {
  let written: string = "";

  for (const character of text) {
    const code: number = character.charCodeAt(0);

    if (character === " ") {
      written += IDEOGRAPHIC_SPACE;
    } else if (
      (code >= 0x30 && code <= 0x39) ||
      "+-()./".includes(character)
    ) {
      written += String.fromCharCode(code - 0x20 + 0xff00);
    } else {
      written += character;
    }
  }

  return written;
}

function ruleOf(patternType: string): ScrubRegExp {
  const regex: ScrubRegExp | null = compileBuiltInScrubPattern(patternType);

  expect(regex).not.toBeNull();

  return regex!;
}

// What a rule leaves of a text, each match as the rule's action leaves it.
function leftOf(
  patternType: string,
  text: string,
  action: string = LogScrubAction.Redact,
): string {
  const regex: ScrubRegExp = ruleOf(patternType);

  return regex.replace(text, (match: string): string => {
    return ScrubAction.apply({
      match,
      action,
      patternType,
      projectId: PROJECT_ID,
      pattern: regex,
    });
  });
}

function findingsOf(text: string, dataTypeId: string): Array<string> {
  return findSensitiveValues(text)
    .filter((match: TextMatch): boolean => {
      return match.dataTypeId === dataTypeId;
    })
    .map((match: TextMatch): string => {
      return text.slice(match.start, match.end);
    });
}

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

// #11115: each number, its writing wholly in fullwidth, and the plain value it reads as.
const FULLWIDTH: Array<{
  label: string;
  patternType: string;
  dataTypeId: string;
  before: string;
  written: string;
  reads: string;
  mask: string;
}> = [
  {
    label: "a Japanese number, its groups apart by hyphens",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: "＋８１ ３－１２３４－５６７８",
    reads: "+81 3-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "the same number, an ideographic space after its calling code",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: `＋８１${IDEOGRAPHIC_SPACE}３－１２３４－５６７８`,
    reads: "+81 3-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "a Chinese mobile, its groups apart by ideographic spaces",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "手机号码 ",
    written: inFullwidth("+86 138 0013 8241"),
    reads: "+86 138 0013 8241",
    mask: "***-***-8241",
  },
  {
    label: "a fullwidth plus sign and hyphens before ASCII digits",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: "＋81 3－1234－5678",
    reads: "+81 3-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "a North American number, its area code in fullwidth parentheses",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "電話：",
    written: inFullwidth("(415) 321-8731"),
    reads: "(415) 321-8731",
    mask: "***-***-8731",
  },
  {
    label: "a Social Security number, its groups apart by fullwidth hyphens",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN ",
    written: inFullwidth("536-22-8731"),
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number, its groups apart by fullwidth full stops",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN ",
    written: inFullwidth("536.22.8731"),
    reads: "536.22.8731",
    mask: "***-**-8731",
  },
  {
    label: "a card, its groups apart by fullwidth hyphens",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "カード ",
    written: inFullwidth("4532-0151-1283-0366"),
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card, its groups apart by ideographic spaces",
    patternType: LogScrubPatternType.CreditCard,
    dataTypeId: "credit-card-number",
    before: "カード ",
    written: inFullwidth("4532 0151 1283 0366"),
    reads: "4532 0151 1283 0366",
    mask: "****-****-****-0366",
  },
];

// #11114: a number Data Security calls one only beside a word that names it.
const WORDED: Array<{
  label: string;
  patternType: string;
  dataTypeId: string;
  before: string;
  written: string;
  mask: string;
}> = [
  {
    label: "a national number of eleven digits after tel",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "tel ",
    written: "02012345678",
    mask: "***-***-5678",
  },
  {
    label: "one of nine digits after phone",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "phone: ",
    written: "201234567",
    mask: "***-***-4567",
  },
  {
    label: "one of twelve digits in a log body's key and value",
    patternType: LogScrubPatternType.PhoneNumber,
    dataTypeId: "phone-number",
    before: "sent ok mobile=",
    written: "447911123456",
    mask: "***-***-3456",
  },
  {
    label: "nine digits in a row after SSN",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "SSN ",
    written: "536221234",
    mask: "***-**-1234",
  },
  {
    label: "nine digits after the words social security number",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "social security number: ",
    written: "536221234",
    mask: "***-**-1234",
  },
  {
    label: "nine digits in Arabic-Indic digits after ssn",
    patternType: LogScrubPatternType.SSN,
    dataTypeId: "us-ssn",
    before: "ssn ",
    written: "٥٣٦٢٢١٢٣٤",
    mask: "***-**-1234",
  },
];

describe("a number typed wholly in fullwidth (#11115)", () => {
  test.each(
    FULLWIDTH.map((entry: (typeof FULLWIDTH)[number]) => {
      return [entry.label, entry] as [string, (typeof FULLWIDTH)[number]];
    }),
  )("Data Security finds %s, as it is written", (_label: string, entry) => {
    const text: string = `${entry.before}${entry.written} ok`;

    expect(findingsOf(text, entry.dataTypeId)).toEqual([entry.written]);
  });

  test.each(
    FULLWIDTH.map((entry: (typeof FULLWIDTH)[number]) => {
      return [entry.label, entry] as [string, (typeof FULLWIDTH)[number]];
    }),
  )(
    "its rule redacts, masks and hashes %s, the token the plain number's",
    (_label: string, entry) => {
      const text: string = `${entry.before}${entry.written} ok`;

      expect(leftOf(entry.patternType, text)).toBe(
        `${entry.before}[REDACTED] ok`,
      );
      expect(leftOf(entry.patternType, text, LogScrubAction.Mask)).toBe(
        `${entry.before}${entry.mask} ok`,
      );
      expect(leftOf(entry.patternType, text, LogScrubAction.Hash)).toBe(
        `${entry.before}${tokenOf(entry.reads)} ok`,
      );
      // The token the number has written plainly.
      expect(
        leftOf(
          entry.patternType,
          `${entry.before}${entry.reads} ok`,
          LogScrubAction.Hash,
        ),
      ).toBe(`${entry.before}${tokenOf(entry.reads)} ok`);
    },
  );

  test("what only looks like a phone number stays, in fullwidth as in ASCII", () => {
    for (const text of [
      `delta ${inFullwidth("+51.507217")} out of range`,
      `tick at UTC ${inFullwidth("+1 2026-11-24")} ok`,
      `counted ${inFullwidth("+1 2 3 4 5 6 7 8")} ok`,
      // CJK prose: an aside in fullwidth parentheses, ideographic spaces.
      `（注）設定を確認してください。${IDEOGRAPHIC_SPACE}詳細は後ほど。`,
    ]) {
      expect(findingsOf(text, "phone-number")).toEqual([]);
      expect(leftOf(LogScrubPatternType.PhoneNumber, text)).toBe(text);
    }
  });

  test("a Custom Regex rule Scrub It makes reads a CPF typed wholly in fullwidth", () => {
    const pattern: string = buildScrubPatternForDataType("br-cpf")!;
    const regex: ScrubRegExp = compileScrubRuleCustomRegex(pattern)!;
    const written: string = inFullwidth("471.392.865-82");

    expect(findingsOf(`CPF ${written}`, "br-cpf")).toEqual([written]);
    expect(
      regex.replace(`CPF ${written} ok`, (): string => {
        return "[REDACTED]";
      }),
    ).toBe("CPF [REDACTED] ok");
    expect(
      ScrubAction.hash({
        match: written,
        patternType: LogScrubPatternType.Custom,
        projectId: PROJECT_ID,
      }),
    ).toBe(tokenOf("471.392.865-82"));
  });

  test("the AI toolbox shows no card typed wholly in fullwidth", () => {
    for (const card of [
      inFullwidth("4532-0151-1283-0366"),
      inFullwidth("4532 0151 1283 0366"),
    ]) {
      expect(ToolResultSerializer.redact(`カード ${card} ok`).text).toBe(
        "カード [redacted-card] ok",
      );
    }
  });

  test("the user vault keeps the user a Phone Number Hash rule hashed in fullwidth, as the number it reads as", () => {
    const written: string = "＋８１ ３－１２３４－５６７８";

    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: written,
        after: tokenOf("+81 3-1234-5678"),
      }),
    ).toEqual({ token: tokenOf("+81 3-1234-5678"), user: "+81 3-1234-5678" });
  });

  test("a database search for a finding's records hands over one typed in fullwidth", () => {
    const expression: string = getDataTypePrefilter({
      dataTypeId: "phone-number",
    })!;
    const asJavaScript: RegExp = new RegExp(
      expression.replace(/\\x\{/g, "\\u{"),
      "u",
    );

    // ASCII digits, so no other script's digit lets it through.
    expect(asJavaScript.test("電話：＋81 3－1234－5678")).toBe(true);
  });

  test("a finding's sample keeps a fullwidth card's last four digits", () => {
    expect(
      maskValue("credit-card-number", inFullwidth("4532-0151-1283-0366")),
    ).toBe("**** **** **** 0366");
  });
});

describe("a national phone number or nine digits beside the word that names them (#11114)", () => {
  test.each(
    WORDED.map((entry: (typeof WORDED)[number]) => {
      return [entry.label, entry] as [string, (typeof WORDED)[number]];
    }),
  )(
    "Data Security finds %s, and its rule redacts, masks and hashes it",
    (_label: string, entry) => {
      const text: string = `${entry.before}${entry.written} ok`;

      expect(findingsOf(text, entry.dataTypeId)).toEqual([entry.written]);
      expect(leftOf(entry.patternType, text)).toBe(
        `${entry.before}[REDACTED] ok`,
      );
      expect(leftOf(entry.patternType, text, LogScrubAction.Mask)).toBe(
        `${entry.before}${entry.mask} ok`,
      );
      expect(leftOf(entry.patternType, text, LogScrubAction.Hash)).toBe(
        `${entry.before}${tokenOf(ScrubAction.asItReads(entry.written, entry.patternType))} ok`,
      );
    },
  );

  test.each([
    ["no word that names it", LogScrubPatternType.PhoneNumber, "order 02012345678 ok"],
    ["a word inside another", LogScrubPatternType.PhoneNumber, "telemetry 02012345678 ok"],
    ["nine digits of a reference", LogScrubPatternType.SSN, "ref 536221234 ok"],
    ["an area never issued", LogScrubPatternType.SSN, "SSN 666221234 ok"],
    ["a placeholder", LogScrubPatternType.SSN, "SSN 123456789 ok"],
    ["ten digits, which are no SSN", LogScrubPatternType.SSN, "SSN 5362212345 ok"],
  ])(
    "keeps a number with %s",
    (_label: string, patternType: string, text: string) => {
      expect(leftOf(patternType, text)).toBe(text);
    },
  );
});

describe("Scrub It's metric rule for a phone or SSN finding (#11112)", () => {
  function ruleFor(dataTypeId: string, key: string): MetricPipelineRule {
    const location: string = `attributes.${key}`;
    const target: ScrubTarget | null = getScrubTarget(
      DataStoreKind.TelemetryMetrics,
      location,
    );

    expect(target).not.toBeNull();

    const rule: MetricPipelineRule = buildMetricScrubRule({
      projectId: PROJECT_ID,
      serviceId: SERVICE_ID,
      kind: DataStoreKind.TelemetryMetrics,
      dataTypeId,
      location,
      target: target!,
    });

    rule.id = ObjectID.generate();

    return rule;
  }

  function labelAfter(rule: MetricPipelineRule, key: string, value: string): unknown {
    const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
      { name: "sms.sent", attributes: { [key]: value, region: "eu" } },
      [rule],
      [],
    );

    return (row!.attributes as JSONObject)[key];
  }

  test("matches the type's Pattern Type", () => {
    expect(buildMetricScrubFilters("phone-number", "caller")[0]).toEqual(
      expect.objectContaining({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesPatternType,
        value: LogScrubPatternType.PhoneNumber,
      }),
    );
    expect(buildMetricScrubFilters("us-ssn", "ssn")[0]).toEqual(
      expect.objectContaining({
        conditionType: MetricPipelineRuleFilterConditionType.MatchesPatternType,
        value: LogScrubPatternType.SSN,
      }),
    );
  });

  test.each([
    ["phone-number", "caller", "+44 20 7946 0958"],
    ["phone-number", "caller", "＋８１ ３－１２３４－５６７８"],
    ["phone-number", "caller", "+٤٤ ٢٠ ٧٩٤٦ ٠٩٥٨"],
    ["phone-number", "callback", "/callback?phone=%2B44+20+7946+0958"],
    ["phone-number", "contact", "tel 02012345678"],
    ["us-ssn", "ssn", "536-22-8731"],
    ["us-ssn", "ssn", "٥٣٦-٢٢-٨٧٣١"],
    ["us-ssn", "ssn", inFullwidth("536-22-8731")],
    ["us-ssn", "note", "SSN 536221234"],
  ])(
    "the rule for %s redacts %s holding %s",
    (dataTypeId: string, key: string, value: string) => {
      expect(labelAfter(ruleFor(dataTypeId, key), key, value)).toBe(
        "[REDACTED]",
      );
    },
  );

  test.each([
    ["phone-number", "delta", "+51.507217"],
    ["phone-number", "tz", "+1 2026-11-24"],
    ["us-ssn", "ssn", "666.22.8731"],
    ["us-ssn", "ref", "ref 536221234"],
  ])(
    "the rule for %s keeps %s holding what is none: %s",
    (dataTypeId: string, key: string, value: string) => {
      expect(labelAfter(ruleFor(dataTypeId, key), key, value)).toBe(value);
    },
  );
});
