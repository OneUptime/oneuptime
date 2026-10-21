import { describe, expect, test } from "@jest/globals";
import {
  createTranslator,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import ProbesAndIntervalCopy, {
  getProbeAgreementSentenceCount,
  getProbeAgreementText,
  MAX_PROBE_AGREEMENT,
  parseProbeAgreement,
  PROBE_AGREEMENT_SENTENCE,
  PROBE_AGREEMENT_SENTENCE_COUNT_FOR_ALL,
  ProbeAgreementParseResult,
} from "../../FeatureSet/Dashboard/src/Components/Monitor/ProbesAndIntervalCopy";

/*
 * How many of a monitor's probes must agree before its status changes, as
 * the Probe Agreement card on the Probes & Interval page reads and writes it.
 *
 * The card is one sentence with a number box in it: "Change this monitor's
 * status when [ ] probes agree". The box empty is all probes, which is what
 * the column empty has always meant to the server
 * (MonitorResourceUtil.checkProbeAgreement). These are the rules for what the
 * box may hold and how the sentence reads around it.
 */

describe("parseProbeAgreement", () => {
  test("an empty box is all probes: the column is cleared", () => {
    for (const text of ["", "   ", undefined, null]) {
      expect(parseProbeAgreement(text)).toEqual({ isValid: true, value: null });
    }
  });

  test("a whole number from 1 up is that many probes", () => {
    expect(parseProbeAgreement("1")).toEqual({ isValid: true, value: 1 });
    expect(parseProbeAgreement("2")).toEqual({ isValid: true, value: 2 });
    expect(parseProbeAgreement(" 3 ")).toEqual({ isValid: true, value: 3 });
    expect(parseProbeAgreement("02")).toEqual({ isValid: true, value: 2 });
    expect(parseProbeAgreement(String(MAX_PROBE_AGREEMENT))).toEqual({
      isValid: true,
      value: MAX_PROBE_AGREEMENT,
    });
  });

  test.each(["0", "00", "-1", "2.5", "1e3", "abc", "2 probes", "+2", "1,000"])(
    "%j is not a number of probes, and is not sent",
    (text: string) => {
      const result: ProbeAgreementParseResult = parseProbeAgreement(text);

      expect(result.isValid).toBe(false);
      expect(result.isValid ? "" : result.error).toBe(
        "Type a whole number of probes, or leave it empty for all probes.",
      );
    },
  );

  test("a number above what the server ever counts is refused", () => {
    expect(parseProbeAgreement(String(MAX_PROBE_AGREEMENT + 1)).isValid).toBe(
      false,
    );
    expect(parseProbeAgreement("99999999999999999999").isValid).toBe(false);
  });

  test("the most it can be is the most probes the server reads for a monitor", () => {
    // LIMIT_PER_PROJECT, which checkProbeAgreement reads MonitorProbes with.
    expect(MAX_PROBE_AGREEMENT).toBe(10000);
  });
});

describe("getProbeAgreementText", () => {
  test("is the number, or nothing for all probes", () => {
    expect(getProbeAgreementText(2)).toBe("2");
    expect(getProbeAgreementText(1)).toBe("1");
    expect(getProbeAgreementText(null)).toBe("");
    expect(getProbeAgreementText(undefined)).toBe("");
  });

  test("shows a value the dashboard would not write as it is, so the page never hides what the monitor has", () => {
    expect(getProbeAgreementText(0)).toBe("0");
    expect(getProbeAgreementText(-1)).toBe("-1");
    expect(getProbeAgreementText(Number.NaN)).toBe("");
  });
});

describe("the sentence", () => {
  const english: Translator = createTranslator(undefined, "en");

  test("reads as one sentence with the number in it", () => {
    expect(english.translatePlural(PROBE_AGREEMENT_SENTENCE, 2)).toBe(
      "Change this monitor's status when 2 probes agree",
    );
    expect(english.translatePlural(PROBE_AGREEMENT_SENTENCE, 1)).toBe(
      "Change this monitor's status when 1 probe agrees",
    );
  });

  test("while the box says all, the words take the form for many", () => {
    expect(getProbeAgreementSentenceCount(null)).toBe(
      PROBE_AGREEMENT_SENTENCE_COUNT_FOR_ALL,
    );
    expect(
      english
        .translatePlural(
          PROBE_AGREEMENT_SENTENCE,
          getProbeAgreementSentenceCount(null),
          { count: "all" },
        )
        .toString(),
    ).toBe("Change this monitor's status when all probes agree");
  });

  test("with a number, the words agree with that number", () => {
    expect(getProbeAgreementSentenceCount(1)).toBe(1);
    expect(getProbeAgreementSentenceCount(3)).toBe(3);
  });

  test.each([
    "en",
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ])(
    "the count used for all is never a 'one' form in %s",
    (language: string) => {
      expect(
        new Intl.PluralRules(language).select(
          PROBE_AGREEMENT_SENTENCE_COUNT_FOR_ALL,
        ),
      ).not.toBe("one");
    },
  );
});

describe("the copy", () => {
  test("names the page as Create Monitor names its step", () => {
    expect(ProbesAndIntervalCopy.pageTitle).toBe("Probes & Interval");
  });

  test("says what an empty box means, where the reader looks", () => {
    expect(ProbesAndIntervalCopy.agreementBoxPlaceholder).toBe("all");
    expect(ProbesAndIntervalCopy.agreementNote).toContain(
      "Leave it empty for all probes.",
    );
    expect(ProbesAndIntervalCopy.agreementNote).toContain(
      "Only probes that are on and connected take part.",
    );
  });

  test("never sends the reader to Settings or calls the card a setting of its own", () => {
    for (const text of Object.values(ProbesAndIntervalCopy)) {
      expect(text).not.toMatch(/go to settings/i);
      expect(text).not.toMatch(/Probe Agreement Settings/);
    }
  });
});
