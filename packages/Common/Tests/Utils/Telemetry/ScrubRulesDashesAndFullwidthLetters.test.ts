import { describe, expect, test } from "@jest/globals";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import ToolResultSerializer from "../../../Server/Utils/AI/Toolbox/Serializer";
import { buildScrubPatternForDataType } from "../../../Server/Utils/DataSecurity/Telemetry/TelemetryScrubCoverage";
import { readHashedUserPair } from "../../../Server/Utils/SecurityEvent/UserVault/HashedUserPairs";
import MetricPipelineEngine, {
  MutableMetricRow,
} from "../../../Server/Utils/Telemetry/MetricPipelineEngine";
import ScrubAction from "../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import { JSONObject } from "../../../Types/JSON";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../Types/Metrics/MetricPipelineRuleType";
import ObjectID from "../../../Types/ObjectID";
import {
  compileScrubRuleCustomRegex,
  ScrubRegExp,
} from "../../../Types/Telemetry/ScrubRule";
import { DataTypeDetector } from "../../../Utils/DataSecurity/Detector";
import BUILT_IN_DETECTORS, {
  getBuiltInDetectorsOf,
} from "../../../Utils/DataSecurity/Detectors/Index";
import { EMAIL_ADDRESS_DETECTORS } from "../../../Utils/DataSecurity/Detectors/ContactDetectors";
import { getDataTypePrefilter } from "../../../Utils/DataSecurity/DetectorPrefilter";
import { foldFullwidthLetters } from "../../../Utils/DataSecurity/FullwidthForms";
import { maskEmail } from "../../../Utils/DataSecurity/Masking";
import {
  findSensitiveValues,
  TextMatch,
} from "../../../Utils/DataSecurity/TextScanner";
import { compileBuiltInScrubPattern } from "../../../Utils/Telemetry/ScrubBuiltInPatterns";

/*
 * ---------------------------------------------------------------------------
 * A NUMBER SET APART BY ANOTHER DASH, AND A VALUE TYPED IN FULLWIDTH
 * LETTERS, FOUND AND HIDDEN WHEREVER A RULE RUNS (#11385).
 *
 * Japanese text sets a phone number's groups apart by the prolonged sound
 * mark ー, typeset text by ‐, ‑, ‒, – or −; an input method in fullwidth
 * mode types a value's letters in fullwidth too - an email address, an
 * IBAN, a UK postcode, the TEL beside a number. Data Security finds each;
 * every rule hides what it finds the same ways: the built-in rules, a
 * Custom Regex rule Scrub It makes, Mask and Hash (the token the value
 * written plainly has), a metric rule that hides, the AI toolbox, the user
 * vault and the database search. What is no value written so is kept: a
 * katakana word's ー beside a digit, a range, a minus, CJK prose.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-000000113850";

function tokenOf(value: string): string {
  return ScrubHashToken.ofValue({ projectId: PROJECT_ID, value });
}

// A value as it is written, where it sits, the value written plainly, its type, rule and mask.
interface Written {
  label: string;
  dataTypeId: string;
  patternType: string;
  text: string;
  written: string;
  // What Mask and Hash read it as: the value written plainly.
  reads: string;
  mask: string;
}

const WRITTEN: ReadonlyArray<Written> = [
  {
    label: "a phone number set apart by the prolonged sound mark, typed in fullwidth",
    dataTypeId: "phone-number",
    patternType: LogScrubPatternType.PhoneNumber,
    text: "電話 ＋８１ ３ー１２３４ー５６７８ まで",
    written: "＋８１ ３ー１２３４ー５６７８",
    reads: "+81 3-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "a phone number set apart by the halfwidth prolonged sound mark",
    dataTypeId: "phone-number",
    patternType: LogScrubPatternType.PhoneNumber,
    text: "ﾃﾞﾝﾜ +81 6ｰ1234ｰ5678",
    written: "+81 6ｰ1234ｰ5678",
    reads: "+81 6-1234-5678",
    mask: "***-***-5678",
  },
  {
    label: "a phone number set apart by a non-breaking hyphen",
    dataTypeId: "phone-number",
    patternType: LogScrubPatternType.PhoneNumber,
    text: "call +44 20 7123‑4567 now",
    written: "+44 20 7123‑4567",
    reads: "+44 20 7123-4567",
    mask: "***-***-4567",
  },
  {
    label: "a North American number set apart by an en dash",
    dataTypeId: "phone-number",
    patternType: LogScrubPatternType.PhoneNumber,
    text: "tel (415) 555–2671",
    written: "(415) 555–2671",
    reads: "(415) 555-2671",
    mask: "***-***-2671",
  },
  {
    label: "a phone number set apart by figure dashes",
    dataTypeId: "phone-number",
    patternType: LogScrubPatternType.PhoneNumber,
    text: "fax +33 1‒23‒45‒67‒89",
    written: "+33 1‒23‒45‒67‒89",
    reads: "+33 1-23-45-67-89",
    mask: "***-***-6789",
  },
  {
    label: "a national number beside its word typed in fullwidth",
    dataTypeId: "phone-number",
    patternType: LogScrubPatternType.PhoneNumber,
    text: "ＴＥＬ　０３１２３４５６７８",
    written: "０３１２３４５６７８",
    reads: "0312345678",
    mask: "***-***-5678",
  },
  {
    label: "a Social Security number set apart by en dashes",
    dataTypeId: "us-ssn",
    patternType: LogScrubPatternType.SSN,
    text: "applicant ssn 536–22–8731 verified",
    written: "536–22–8731",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number set apart by minus signs",
    dataTypeId: "us-ssn",
    patternType: LogScrubPatternType.SSN,
    text: "ssn: 536−22−8731",
    written: "536−22−8731",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "a Social Security number typed in fullwidth, set apart by the prolonged sound mark",
    dataTypeId: "us-ssn",
    patternType: LogScrubPatternType.SSN,
    text: "SSN：５３６ー２２ー８７３１",
    written: "５３６ー２２ー８７３１",
    reads: "536-22-8731",
    mask: "***-**-8731",
  },
  {
    label: "nine digits beside SSN typed in fullwidth",
    dataTypeId: "us-ssn",
    patternType: LogScrubPatternType.SSN,
    text: "ＳＳＮ：５３６２２１２３４",
    written: "５３６２２１２３４",
    reads: "536221234",
    mask: "***-**-1234",
  },
  {
    label: "a card set apart by en dashes",
    dataTypeId: "credit-card-number",
    patternType: LogScrubPatternType.CreditCard,
    text: "card 4532–0151–1283–0366 charged",
    written: "4532–0151–1283–0366",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "a card typed in fullwidth, set apart by the prolonged sound mark",
    dataTypeId: "credit-card-number",
    patternType: LogScrubPatternType.CreditCard,
    text: "カード番号：４５３２ー０１５１ー１２８３ー０３６６",
    written: "４５３２ー０１５１ー１２８３ー０３６６",
    reads: "4532-0151-1283-0366",
    mask: "****-****-****-0366",
  },
  {
    label: "an email address typed in fullwidth",
    dataTypeId: "email-address",
    patternType: LogScrubPatternType.Email,
    text: "メール ｊａｎｅ．ｄｏｅ＠ａｃｍｅｃｏｒｐ．ｉｏ に送信",
    written: "ｊａｎｅ．ｄｏｅ＠ａｃｍｅｃｏｒｐ．ｉｏ",
    reads: "jane.doe@acmecorp.io",
    mask: "j***@***.io",
  },
  {
    label: "an email address with its at sign alone in fullwidth",
    dataTypeId: "email-address",
    patternType: LogScrubPatternType.Email,
    text: "連絡先：jane.doe＠acmecorp.io",
    written: "jane.doe＠acmecorp.io",
    reads: "jane.doe@acmecorp.io",
    mask: "j***@***.io",
  },
];

// What is no value, written so: each rule keeps it, Data Security finds none of it.
const KEPT: ReadonlyArray<[string, string, string]> = [
  ["phone-number", LogScrubPatternType.PhoneNumber, "サーバー3台 データ2ー3件"],
  ["phone-number", LogScrubPatternType.PhoneNumber, "pages 10–20 of 2020–2026"],
  ["phone-number", LogScrubPatternType.PhoneNumber, "気温 −5 度"],
  ["phone-number", LogScrubPatternType.PhoneNumber, "at UTC +1 2026−11−24 10:15:00"],
  ["phone-number", LogScrubPatternType.PhoneNumber, "ＩＤ　０３１２３４５６７８"],
  ["phone-number", LogScrubPatternType.PhoneNumber, "ｐｈｏｎｅ＝ｅ＋７７７６９８３２６２８８５８"],
  ["us-ssn", LogScrubPatternType.SSN, "SSN 666–22–8731"],
  ["us-ssn", LogScrubPatternType.SSN, "ref 536–22–8731–01"],
  ["us-ssn", LogScrubPatternType.SSN, "ＲＥＦ　５３６２２１２３４"],
  ["credit-card-number", LogScrubPatternType.CreditCard, "card 4532–0151–1283–0367"],
  ["email-address", LogScrubPatternType.Email, "ＩＴ部門＠本社 へ連絡してください"],
  ["email-address", LogScrubPatternType.Email, "設定を確認してください。（注）以上です！"],
];

function rangesOf(regex: ScrubRegExp, text: string): Array<string> {
  return regex.matchRanges(text).map(([start, end]: [number, number]): string => {
    return text.slice(start, end);
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

describe("Data Security finds each, on its written characters, and the rule of its type hides exactly that", () => {
  test.each(WRITTEN.map((written: Written): [string, Written] => [written.label, written]))(
    "%s",
    (_label: string, written: Written) => {
      const regex: ScrubRegExp = compileBuiltInScrubPattern(written.patternType)!;

      expect(findingsOf(written.text, written.dataTypeId)).toEqual([
        written.written,
      ]);
      expect(rangesOf(regex, written.text)).toEqual([written.written]);
    },
  );

  /*
   * What is no value written so is none to Data Security; and a rule hides
   * of it exactly what it hides of the same text written with hyphens and
   * in ASCII - its own pattern's matches, which it always hid (any ten
   * digits for a Phone Number rule, any 3-2-4 grouping for an SSN rule) -
   * since it reads the dashes and the fullwidth letters as those.
   */
  test.each(KEPT)("a %s rule finds none of what is none: %s", (
    dataTypeId: string,
    patternType: string,
    text: string,
  ) => {
    const regex: ScrubRegExp = compileBuiltInScrubPattern(patternType)!;
    const plain: string = foldFullwidthLetters(text);

    expect(findingsOf(text, dataTypeId)).toEqual([]);
    expect(findingsOf(plain, dataTypeId)).toEqual([]);
    expect(regex.matchRanges(text)).toEqual(regex.matchRanges(plain));
  });

  test.each([
    [LogScrubPatternType.PhoneNumber, "サーバー3台 データ2ー3件"],
    [LogScrubPatternType.PhoneNumber, "pages 10–20 of 2020–2026"],
    [LogScrubPatternType.PhoneNumber, "気温 −5 度"],
    [LogScrubPatternType.PhoneNumber, "ｐｈｏｎｅ＝ｅ＋７７７６９８３２６２８８５８"],
    [LogScrubPatternType.SSN, "ＲＥＦ　５３６２２１２３４"],
    [LogScrubPatternType.Email, "ＩＴ部門＠本社 へ連絡してください"],
    [LogScrubPatternType.Email, "設定を確認してください。（注）以上です！"],
  ])("a %s rule keeps %s", (patternType: string, text: string) => {
    expect(compileBuiltInScrubPattern(patternType)!.matchRanges(text)).toEqual(
      [],
    );
  });
});

describe("Mask and Hash read each as the value written plainly", () => {
  test.each(WRITTEN.map((written: Written): [string, Written] => [written.label, written]))(
    "%s",
    (_label: string, written: Written) => {
      const regex: ScrubRegExp = compileBuiltInScrubPattern(written.patternType)!;
      const apply: (action: string) => string = (action: string): string => {
        return ScrubAction.apply({
          match: written.written,
          action,
          patternType: written.patternType,
          projectId: PROJECT_ID,
          pattern: regex,
        });
      };

      expect(apply(LogScrubAction.Redact)).toBe("[REDACTED]");
      expect(apply(LogScrubAction.Mask)).toBe(written.mask);
      expect(apply(LogScrubAction.Hash)).toBe(tokenOf(written.reads));
      // The plain value's own token: one token however it is written.
      expect(
        ScrubAction.apply({
          match: written.reads,
          action: LogScrubAction.Hash,
          patternType: written.patternType,
          projectId: PROJECT_ID,
          pattern: regex,
        }),
      ).toBe(tokenOf(written.reads));
    },
  );

  test("a finding's masked email sample reads an address typed in fullwidth as the address", () => {
    expect(maskEmail("ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ")).toBe(maskEmail("jane@example.com"));
    expect(maskEmail("jane＠example.com")).toBe("j***@e******.com");
  });
});

// Values with letters typed in fullwidth that Scrub It's Custom Regex rule of their type hides.
const CUSTOM: ReadonlyArray<[string, string, string, string]> = [
  [
    "iban",
    "振込先 IBAN：ＤＥ４７　３７０４　００４４　０５３２　０１３０　７７",
    "ＤＥ４７　３７０４　００４４　０５３２　０１３０　７７",
    "DE47 3704 0044 0532 0130 77",
  ],
  [
    "iban",
    "口座 ＤＥ４７３７０４００４４０５３２０１３０７７ へ",
    "ＤＥ４７３７０４００４４０５３２０１３０７７",
    "DE47370400440532013077",
  ],
  ["br-cpf", "CPF 471.392.865–82", "471.392.865–82", "471.392.865-82"],
];

describe("a Custom Regex rule Scrub It makes reads the dashes and the fullwidth letters too", () => {
  test.each(CUSTOM)("%s: %s", (
    dataTypeId: string,
    text: string,
    written: string,
    reads: string,
  ) => {
    const regex: ScrubRegExp = compileScrubRuleCustomRegex(
      buildScrubPatternForDataType(dataTypeId),
    )!;

    expect(findingsOf(text, dataTypeId)).toEqual([written]);
    expect(rangesOf(regex, text)).toEqual([written]);
    expect(
      ScrubAction.apply({
        match: written,
        action: LogScrubAction.Hash,
        patternType: LogScrubPatternType.Custom,
        projectId: PROJECT_ID,
        pattern: regex,
      }),
    ).toBe(tokenOf(reads));
  });

  test("CJK prose with fullwidth letters and digits holds no value for it", () => {
    const regex: ScrubRegExp = compileScrubRuleCustomRegex(
      buildScrubPatternForDataType("iban"),
    )!;

    expect(rangesOf(regex, "ＯＫです。ＩＴ部門の１２３件、ＤＥ８９は不明")).toEqual([]);
  });
});

function metricRow(attributes: JSONObject): MutableMetricRow {
  return {
    name: "payments",
    attributes: { ...attributes },
    attributeKeys: Object.keys(attributes).sort(),
  };
}

function metricRule(
  ruleType: MetricPipelineRuleType,
  key: string,
  conditionType: MetricPipelineRuleFilterConditionType,
  value: string,
): MetricPipelineRule {
  const rule: MetricPipelineRule = new MetricPipelineRule();

  rule.id = ObjectID.generate();
  rule.ruleType = ruleType;
  rule.addAttributeKey = key;
  rule.filters = [
    {
      checkOn: MetricPipelineRuleFilterCheckOn.Attribute,
      attributeKey: key,
      conditionType,
      value,
    },
  ];

  return rule;
}

describe("a metric rule that hides reads them too", () => {
  test("a Redact Attribute rule's Matches Regex filter of Scrub It's IBAN pattern hides one typed in fullwidth letters", () => {
    const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
      metricRow({ "account.iban": "ＤＥ４７３７０４００４４０５３２０１３０７７" }),
      [
        metricRule(
          MetricPipelineRuleType.RedactAttribute,
          "account.iban",
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          buildScrubPatternForDataType("iban")!,
        ),
      ],
      [],
    );

    expect(row!.attributes).toEqual({ "account.iban": "[REDACTED]" });
  });

  test("a Filter rule's Matches Regex filter reads the value as written, as before", () => {
    const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
      metricRow({ "account.iban": "ＤＥ４７３７０４００４４０５３２０１３０７７" }),
      [
        metricRule(
          MetricPipelineRuleType.Filter,
          "account.iban",
          MetricPipelineRuleFilterConditionType.MatchesRegex,
          buildScrubPatternForDataType("iban")!,
        ),
      ],
      [],
    );

    // A Filter keeps the rows it matches: as written, this matches nothing.
    expect(row).toBeNull();
  });

  test.each([
    ["phoneNumber", "caller", "＋８１ ３ー１２３４ー５６７８"],
    ["ssn", "applicant", "536–22–8731"],
    ["creditCard", "card", "4532–0151–1283–0366"],
    ["email", "user", "ｊａｎｅ＠ａｃｍｅｃｏｒｐ．ｉｏ"],
  ])("a Redact Attribute rule's Matches Pattern Type filter of %s hides %s=%s", (
    patternType: string,
    key: string,
    value: string,
  ) => {
    const row: MutableMetricRow | null = MetricPipelineEngine.applyRules(
      metricRow({ [key]: value }),
      [
        metricRule(
          MetricPipelineRuleType.RedactAttribute,
          key,
          MetricPipelineRuleFilterConditionType.MatchesPatternType,
          patternType,
        ),
      ],
      [],
    );

    expect(row!.attributes).toEqual({ [key]: "[REDACTED]" });
  });
});

describe("the AI toolbox hides them before a model reads them", () => {
  test.each([
    ["電話 ＋８１ ３ー１２３４ー５６７８ まで", "電話 [redacted-phone] まで"],
    ["call +44 20 7123‑4567 now", "call [redacted-phone] now"],
    ["applicant ssn 536–22–8731 verified", "applicant ssn [redacted-ssn] verified"],
    ["card 4532–0151–1283–0366 charged", "card [redacted-card] charged"],
    ["カード番号：４５３２ー０１５１ー１２８３ー０３６６", "カード番号：[redacted-card]"],
    ["メール ｊａｎｅ．ｄｏｅ＠ａｃｍｅｃｏｒｐ．ｉｏ に送信", "メール [redacted-email] に送信"],
    ["連絡先：jane.doe＠acmecorp.io", "連絡先：[redacted-email]"],
    ["ＴＥＬ　０３１２３４５６７８", "ＴＥＬ　[redacted-phone]"],
  ])("%s", (text: string, redacted: string) => {
    expect(ToolResultSerializer.redact(text).text).toBe(redacted);
  });

  // As it hides the same text written with hyphens and in ASCII: what it always hid, and no more.
  test.each(KEPT.map((kept: [string, string, string]): [string] => [kept[2]]))(
    "hides of what is none what it hides of it written plainly: %s",
    (text: string) => {
      expect(ToolResultSerializer.redact(text).count).toBe(
        ToolResultSerializer.redact(foldFullwidthLetters(text)).count,
      );
    },
  );

  test.each([
    "サーバー3台 データ2ー3件",
    "pages 10–20 of 2020–2026",
    "気温 −5 度",
    "ｐｈｏｎｅ＝ｅ＋７７７６９８３２６２８８５８",
    "ＩＤ　０３１２３４５６７８",
    "ＲＥＦ　５３６２２１２３４",
    "ＩＴ部門＠本社 へ連絡してください",
    "設定を確認してください。（注）以上です！",
  ])("keeps %s", (text: string) => {
    expect(ToolResultSerializer.redact(text).text).toBe(text);
  });
});

describe("the user vault keeps a user an Email Address Hash rule hashed typed in fullwidth", () => {
  test("as the address it reads as, whose token the rule left", () => {
    const written: string = "ｊａｎｅ＠ａｃｍｅｃｏｒｐ．ｉｏ";
    const token: string = ScrubAction.apply({
      match: written,
      action: LogScrubAction.Hash,
      patternType: LogScrubPatternType.Email,
      projectId: PROJECT_ID,
    });

    expect(token).toBe(tokenOf("jane@acmecorp.io"));
    expect(
      readHashedUserPair({
        projectId: PROJECT_ID,
        before: `user=${written}`,
        after: `user=${token}`,
      }),
    ).toEqual({ token, user: "jane@acmecorp.io" });
  });
});

describe("the detectors that read them", () => {
  test("every detector that reads a number typed in fullwidth reads its letters and its words too", () => {
    const lacking: Array<string> = BUILT_IN_DETECTORS.filter(
      (detector: DataTypeDetector): boolean => {
        return Boolean(detector.readsFullwidthForms) && !detector.readsFullwidthLetters;
      },
    ).map((detector: DataTypeDetector): string => {
      return detector.dataTypeId;
    });

    expect(lacking).toEqual([]);
  });

  test("an email address's detectors read one typed in fullwidth", () => {
    for (const detector of EMAIL_ADDRESS_DETECTORS) {
      expect(detector.readsFullwidthLetters).toBe(true);
    }
  });

  test("a database search for each type takes a record holding it written so", () => {
    for (const written of [...WRITTEN, ...CUSTOM.map((custom: [string, string, string, string]): Written => {
      return {
        label: custom[0],
        dataTypeId: custom[0],
        patternType: LogScrubPatternType.Custom,
        text: custom[1],
        written: custom[2],
        reads: custom[3],
        mask: "",
      };
    })]) {
      const expression: string | null = getDataTypePrefilter({
        dataTypeId: written.dataTypeId,
      });

      expect(expression).not.toBeNull();
      expect([
        written.label,
        new RegExp(expression!.split("\\x{").join("\\u{"), "u").test(written.text),
      ]).toEqual([written.label, true]);
      expect(
        findSensitiveValues(written.text, {
          detectors: getBuiltInDetectorsOf(written.dataTypeId),
        }).length,
      ).toBeGreaterThan(0);
    }
  });
});
