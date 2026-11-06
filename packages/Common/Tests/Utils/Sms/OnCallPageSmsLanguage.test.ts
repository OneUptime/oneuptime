import { describe, expect, test } from "@jest/globals";
import {
  FIRST_STRONG_ISOLATE,
  getServerTranslator,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Server/Utils/ServerTranslation";
import {
  getOnCallPageSmsWords,
  getOnCallPageStateName,
  OnCallPageKind,
  OnCallPageSmsWords,
} from "../../../Types/OnCallDutyPolicy/OnCallPageWords";
import { Translator } from "../../../Types/Translator";
import {
  buildOnCallPageSms,
  MIN_TITLE_CHARACTERS,
  ON_CALL_PAGE_SMS_CUT_MARK,
  OnCallPageSms,
  OnCallPageSmsInput,
  OnCallPageSmsKind,
  OnCallPageSmsLanguage,
} from "../../../Utils/Sms/OnCallPageSms";

/*
 * A PAGE'S TEXT MESSAGE IN THE LANGUAGE OF THE PERSON IT PAGES
 * (fu-i18n-larger).
 *
 * The page's words come from the person's language (OnCallPageWords) and go
 * around the same values - the product, the record, the project, the title
 * and the link - fitted by the same rule as an English one: everything, else
 * without the project, else the title cut, never the product, the record,
 * the reason, who paged or the link. A language written in Latin letters is
 * written in GSM-7's characters, so an accent never costs a second part; one
 * in another script goes out in UCS-2 with its own punctuation. Without a
 * language the text is English, exactly as before.
 */

const LINK: string = "https://oneuptime.com/l/XJlaZRsd";

const KINDS: Record<OnCallPageSmsKind, OnCallPageKind> = {
  [OnCallPageSmsKind.Incident]: OnCallPageKind.Incident,
  [OnCallPageSmsKind.Alert]: OnCallPageKind.Alert,
  [OnCallPageSmsKind.IncidentEpisode]: OnCallPageKind.IncidentEpisode,
  [OnCallPageSmsKind.AlertEpisode]: OnCallPageKind.AlertEpisode,
};

// The words of `language` for a page's text, as UserNotificationRuleService hands them over.
const languageOf: (language: string) => OnCallPageSmsLanguage = (
  language: string,
): OnCallPageSmsLanguage => {
  const words: OnCallPageSmsWords = getOnCallPageSmsWords(
    getServerTranslator(language),
  );

  return {
    describeRecord: (record: {
      kind: OnCallPageSmsKind;
      number: string;
      severityName: string;
    }): string => {
      return words.record({
        kind: KINDS[record.kind],
        number: record.number,
        severityName: record.severityName,
      });
    },
    head: words.head,
    action: words.action,
  };
};

const page: (
  input: Partial<OnCallPageSmsInput> & { language?: OnCallPageSmsLanguage },
) => OnCallPageSms = (
  input: Partial<OnCallPageSmsInput> & { language?: OnCallPageSmsLanguage },
): OnCallPageSms => {
  return buildOnCallPageSms({
    kind: OnCallPageSmsKind.Incident,
    productName: "OneUptime",
    severityName: "Critical Incident",
    number: "INC-42",
    projectName: "Acme Prod",
    title: "Checkout API is down",
    link: LINK,
    ...input,
  });
};

describe("in German", () => {
  const GERMAN: OnCallPageSmsLanguage = languageOf("de");
  const translator: Translator = getServerTranslator("de");

  test("a page: the record with its severity, the project, the title and the link, in one GSM-7 part", () => {
    const sms: OnCallPageSms = page({
      language: GERMAN,
      severityName: getOnCallPageStateName(translator, "Critical Incident"),
    });

    expect(sms.text).toBe(
      `OneUptime: Vorfall INC-42 (Kritischer Vorfall) im Projekt Acme Prod: Checkout API is down. Bestätigen oder eskalieren: ${LINK}`,
    );
    expect(sms.sent.encoding).toBe("GSM-7");
    expect(sms.sent.segments).toBe(1);
    expect(sms.isProjectLeftOut).toBe(false);
    expect(sms.isTitleCut).toBe(false);
  });

  test("a page again says it is still not resolved", () => {
    const sms: OnCallPageSms = page({
      language: GERMAN,
      isPageAgain: true,
      severityName: "",
      kind: OnCallPageSmsKind.Alert,
      number: "ALT-7",
      title: "Disk full",
    });

    expect(sms.text).toBe(
      `OneUptime: Warnung ALT-7 im Projekt Acme Prod ist noch nicht behoben: Disk full. Bestätigen oder eskalieren: ${LINK}`,
    );
  });

  test("a person's page says who paged whom", () => {
    const sms: OnCallPageSms = page({
      language: GERMAN,
      severityName: "",
      lead: "Alice Kim hat Sie alarmiert",
    });

    expect(sms.text).toBe(
      `OneUptime: Alice Kim hat Sie alarmiert, wegen Vorfall INC-42 in Acme Prod: Checkout API is down. Bestätigen oder eskalieren: ${LINK}`,
    );
  });

  test("a long title: the project goes first, then the title is cut - never the record, the reason or the link", () => {
    const title: string =
      "Checkout API latency over five seconds for every region and every payment provider since the deploy";
    const sms: OnCallPageSms = page({
      language: GERMAN,
      isPageAgain: true,
      title: title,
    });

    expect(sms.sent.segments).toBe(1);
    expect(sms.isProjectLeftOut).toBe(true);
    expect(sms.isTitleCut).toBe(true);
    expect(sms.text).not.toContain("Acme Prod");
    expect(sms.text).toContain("Vorfall INC-42 (Critical Incident)");
    expect(sms.text).toContain("ist noch nicht behoben: Checkout API");
    expect(sms.text).toContain(`${ON_CALL_PAGE_SMS_CUT_MARK} Bestätigen`);
    expect(sms.text.endsWith(LINK)).toBe(true);

    const kept: string = sms.text
      .slice(sms.text.indexOf("behoben: ") + "behoben: ".length)
      .split(ON_CALL_PAGE_SMS_CUT_MARK)[0] as string;

    expect(Array.from(kept).length).toBeGreaterThanOrEqual(
      MIN_TITLE_CHARACTERS,
    );
  });

  test("measured as it is sent: a longer product name still fits one part", () => {
    const sms: OnCallPageSms = page({
      language: GERMAN,
      sentAs: (text: string): string => {
        return text.split("OneUptime").join("Acme Reliability Cloud");
      },
    });

    expect(sms.sent.segments).toBe(1);
  });
});

describe("in other languages", () => {
  test("Portuguese: an accent of its own words has a GSM-7 look-alike, so the text stays one cheap part", () => {
    const sms: OnCallPageSms = page({
      language: languageOf("pt"),
      kind: OnCallPageSmsKind.IncidentEpisode,
      severityName: "",
      number: "EP-3",
    });

    // "Episódio" is written "Episodio": "ó" is not GSM-7.
    expect(sms.text).toContain("Episodio de incidente EP-3");
    expect(sms.text).not.toContain("ó");
    expect(sms.sent.encoding).toBe("GSM-7");
  });

  test("Japanese goes out in UCS-2 with its own punctuation, and a title's kept as written", () => {
    const sms: OnCallPageSms = page({
      language: languageOf("ja"),
      severityName: "",
      title: "決済が失敗（欧州）",
    });

    expect(sms.sent.encoding).toBe("UCS-2");
    expect(sms.text).toContain("確認またはエスカレーション：");
    // The title's full-width brackets are its own: no ASCII look-alikes.
    expect(sms.text).toContain("決済が失敗（欧州）");
    expect(sms.text.endsWith(LINK)).toBe(true);
  });

  test("Persian keeps the marks that set an English title apart in a sentence read from the right", () => {
    const sms: OnCallPageSms = page({
      language: languageOf("fa"),
      severityName: "",
    });

    expect(sms.sent.encoding).toBe("UCS-2");
    expect(sms.text).toContain(FIRST_STRONG_ISOLATE);
    expect(sms.text).toContain(POP_DIRECTIONAL_ISOLATE);
    expect(sms.text).toContain("تأیید یا تشدید:");
    expect(sms.text.endsWith(LINK)).toBe(true);
  });

  test("every language keeps a space before the link, so a phone makes it one", () => {
    for (const code of [
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
    ]) {
      const sms: OnCallPageSms = page({ language: languageOf(code) });

      expect([code, sms.text.endsWith(` ${LINK}`)]).toEqual([code, true]);
      expect([code, sms.text.startsWith("OneUptime: ")]).toEqual([code, true]);
    }
  });
});

describe("without a language", () => {
  test("the text is English, word for word as before", () => {
    expect(page({}).text).toBe(
      `OneUptime: Critical Incident INC-42 in Acme Prod: Checkout API is down. Ack or escalate: ${LINK}`,
    );
    expect(
      page({
        isPageAgain: true,
        kind: OnCallPageSmsKind.Alert,
        severityName: "High",
      }).text,
    ).toBe(
      `OneUptime: High alert INC-42 in Acme Prod is still not resolved: Checkout API is down. Ack or escalate: ${LINK}`,
    );
  });
});
