import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED,
  ON_CALL_TEST_PAGE_CALL_GREETING,
  ON_CALL_TEST_PAGE_CALL_PROMPT,
  getOnCallTestPageAcknowledgeLabel,
  getOnCallTestPageAskToAcknowledge,
  getOnCallTestPageCallWhatItTests,
  getOnCallTestPageEmailSubject,
  getOnCallTestPageHeadline,
  getOnCallTestPageSentBy,
  getOnCallTestPageSmsText,
  getOnCallTestPageWhatItTests,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageWords";
import { Translator } from "../../../Types/Translator";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A TEST PAGE SAYS (OnCallTestPageWords): TEST in its first words, on
 * every channel and in every language OneUptime writes a page in, and that
 * nothing is wrong. The words are looked up in the server's locale set
 * (Common/Server/Locales) through the translator a real page uses.
 */

// The word each language says TEST with, first in every headline.
const TEST_WORD: Record<string, string> = {
  en: "TEST",
  de: "TEST",
  fr: "TEST",
  es: "PRUEBA",
  it: "TEST",
  pt: "TESTE",
  nl: "TEST",
  da: "TEST",
  no: "TEST",
  sv: "TEST",
  ru: "ТЕСТ",
  ja: "テスト",
  ko: "테스트",
  "zh-CN": "测试",
  "zh-TW": "測試",
  hi: "परीक्षण",
  fa: "آزمایشی",
  ar: "اختبار",
};

const LANGUAGES: Array<string> = Object.keys(TEST_WORD);

const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  return getServerTranslator(language);
};

describe("every message says TEST in its first words", () => {
  test.each<[string]>(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )("%s: the headline, the text and the email subject start with it", (language: string) => {
    const translator: Translator = translatorFor(language);
    const word: string = TEST_WORD[language]!;

    expect(
      withoutIsolateMarks(getOnCallTestPageHeadline(translator, "OneUptime")),
    ).toMatch(new RegExp(`^${word}`));

    expect(
      withoutIsolateMarks(
        getOnCallTestPageSmsText(translator, {
          productName: "OneUptime",
          projectName: "Acme",
          link: "https://oneuptime.com/l/abcd",
        }),
      ),
    ).toMatch(new RegExp(`^${word}`));

    expect(
      withoutIsolateMarks(getOnCallTestPageEmailSubject(translator, "Acme")),
    ).toMatch(new RegExp(`^${word}`));
  });

  test.each<[string]>(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }).map((language: string): [string] => {
      return [language];
    }),
  )("%s: every sentence is worded in the language, not left in English", (language: string) => {
    const english: Translator = translatorFor("en");
    const translator: Translator = translatorFor(language);

    const pairs: Array<[string, string]> = [
      [
        getOnCallTestPageHeadline(english, "OneUptime"),
        getOnCallTestPageHeadline(translator, "OneUptime"),
      ],
      [
        getOnCallTestPageAskToAcknowledge(english),
        getOnCallTestPageAskToAcknowledge(translator),
      ],
      [
        getOnCallTestPageAcknowledgeLabel(english),
        getOnCallTestPageAcknowledgeLabel(translator),
      ],
      [
        getOnCallTestPageSentBy(english, {
          isSentBySelf: true,
          senderName: "",
        }),
        getOnCallTestPageSentBy(translator, {
          isSentBySelf: true,
          senderName: "",
        }),
      ],
      [
        getOnCallTestPageWhatItTests(english, {
          recordKind: OnCallTestPageRecordKind.Alert,
          projectName: "Acme",
          severityName: "Critical",
        }),
        getOnCallTestPageWhatItTests(translator, {
          recordKind: OnCallTestPageRecordKind.Alert,
          projectName: "Acme",
          severityName: "Critical",
        }),
      ],
    ];

    for (const [inEnglish, inLanguage] of pairs) {
      expect(withoutIsolateMarks(inLanguage)).not.toBe(inEnglish);
    }
  });
});

describe("what the test is, in English", () => {
  const english: Translator = translatorFor("en");

  test("says nothing is wrong, and what kind of page and severity it tests", () => {
    expect(
      getOnCallTestPageWhatItTests(english, {
        recordKind: OnCallTestPageRecordKind.Incident,
        projectName: "Acme",
        severityName: "Critical",
      }),
    ).toBe(
      "Nothing is wrong. This tests how Acme pages you for an incident of severity Critical.",
    );

    expect(
      getOnCallTestPageWhatItTests(english, {
        recordKind: OnCallTestPageRecordKind.Alert,
        projectName: "Acme",
        severityName: "High",
      }),
    ).toBe(
      "Nothing is wrong. This tests how Acme pages you for an alert of severity High.",
    );
  });

  test("says who sent it: yourself, a member, or a policy's test", () => {
    expect(
      getOnCallTestPageSentBy(english, {
        isSentBySelf: true,
        senderName: "Ana",
      }),
    ).toBe("You sent yourself this test page.");

    expect(
      getOnCallTestPageSentBy(english, {
        isSentBySelf: false,
        senderName: "Ana Lopez",
      }),
    ).toBe("Ana Lopez sent you this test page.");

    expect(
      getOnCallTestPageSentBy(english, {
        isSentBySelf: false,
        senderName: "Ana Lopez",
        policyName: "Primary",
      }),
    ).toBe("Ana Lopez is testing the on-call policy Primary, which pages you.");

    // A policy's test even when the sender tests themselves.
    expect(
      getOnCallTestPageSentBy(english, {
        isSentBySelf: true,
        senderName: "",
        policyName: "Primary",
      }),
    ).toBe("OneUptime is testing the on-call policy Primary, which pages you.");

    // Nobody known: says nothing rather than something untrue.
    expect(
      getOnCallTestPageSentBy(english, {
        isSentBySelf: false,
        senderName: "  ",
      }),
    ).toBe("");
  });

  test("the text message keeps its link whole, after a space", () => {
    const text: string = getOnCallTestPageSmsText(english, {
      productName: "OneUptime",
      projectName: "Acme",
      link: "https://oneuptime.com/l/abcd",
    });

    expect(text).toBe(
      "TEST page from OneUptime for Acme: nothing is wrong. Acknowledge: https://oneuptime.com/l/abcd",
    );
    expect(text.endsWith(" https://oneuptime.com/l/abcd")).toBe(true);
  });

  test.each<[string]>(
    LANGUAGES.map((language: string): [string] => {
      return [language];
    }),
  )("%s: the text message keeps a space before its link", (language: string) => {
    const text: string = withoutIsolateMarks(
      getOnCallTestPageSmsText(translatorFor(language), {
        productName: "OneUptime",
        projectName: "Acme",
        link: "https://oneuptime.com/l/abcd",
      }),
    );

    expect(text).toContain(" https://oneuptime.com/l/abcd");
  });

  test("an English test text with a long project name and a short link fits one SMS", () => {
    const text: string = getOnCallTestPageSmsText(english, {
      productName: "OneUptime",
      // The longest a test's text carries (SMS_PROJECT_NAME_MAX_LENGTH).
      projectName: "A".repeat(40),
      link: "https://oneuptime.com/l/ab12cd34",
    });

    expect(text.length).toBeLessThanOrEqual(160);
  });

  test("the email subject", () => {
    expect(getOnCallTestPageEmailSubject(english, "Acme")).toBe(
      "TEST page from Acme: nothing is wrong",
    );
  });
});

describe("the call, in English as every call is", () => {
  test("says it is a test and nothing is wrong, then what it tests, then to press 1", () => {
    expect(ON_CALL_TEST_PAGE_CALL_GREETING).toBe(
      "This is a test page from OneUptime. Nothing is wrong.",
    );

    expect(
      getOnCallTestPageCallWhatItTests({
        recordKind: OnCallTestPageRecordKind.Incident,
        projectName: "Acme",
        severityName: "Critical",
      }),
    ).toBe("This tests how Acme pages you for an incident of severity Critical.");

    expect(ON_CALL_TEST_PAGE_CALL_PROMPT).toBe(
      "To acknowledge this test page, press 1.",
    );
    expect(ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED).toContain(
      "You have acknowledged this test page.",
    );
  });
});
