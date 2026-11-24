/** @timezone UTC */
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  writeNetworkChallengedToast,
  writeRowBlockPill,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Campaigns/CampaignContainmentModel";
import OneUptimeDate from "../../../Types/Date";
import { withDateDisplayLanguage } from "../../../Types/DateLanguage";
import { SecurityBlockAction } from "../../../Types/SecurityBlocklist/SecurityBlock";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
} from "../../Helpers/DashboardLocales";

/*
 * THE CAMPAIGNS' MOMENTS, IN EVERY LANGUAGE (#10932).
 *
 * A row's pill and Challenge This Network's toast once wrote their own
 * "until" before a moment that held a date whenever it was not today:
 * Spanish "Bloqueada hasta 27 nov, 14:25", Italian "fino a 27 nov, 14:25",
 * French "jusqu'à 27 nov., 14:25". They now name the moment with no
 * preposition ("Blocked {{until}}"), and the moment brings its own words:
 * "until 14:25" today, "until 8 Dec at 01:25" on another day - Spanish "a
 * la 01:25" and Italian "fino all'8 dic all'01:25" with it (#10902). A
 * challenge lifted by hand reads its network alone, never "until" with
 * nothing after it. Each language's sentences, pinned word for word.
 */

const NOW: Date = new Date("2026-12-27T10:00:00.000Z");

// A moment written whole, as the sentences once held it: its day, a comma, then its clock - "8 dic, 01:25".
const MOMENT_WRITTEN_WHOLE: RegExp = /,\s*\d{1,2}[:.]\d{2}/u;
// A placeholder no value filled.
const PLACEHOLDER_LEFT: RegExp = /\{\{|\}\}/u;
// A sentence whose value came out empty: nothing before its full stop ("until .").
const NOTHING_BEFORE_END: RegExp = /\s[.。।]$/u;
const TODAY_AT_14_25: string = "2026-12-27T14:25:00.000Z";
const THE_8TH_AT_01_25: string = "2026-12-08T01:25:00.000Z";
const ADDRESS: string = "35.205.11.131";
const NETWORK: string = "203.0.113.0/24";

interface CampaignSentences {
  blockedToday: string;
  challengedToday: string;
  toastToday: string;
  blockedOnThe8th: string;
  challengedOnThe8th: string;
  toastOnThe8th: string;
  toastUntilLifted: string;
}

const IN_EVERY_LANGUAGE: Record<string, CampaignSentences> = {
  en: {
    blockedToday: "Blocked until 14:25",
    challengedToday: "Challenged until 14:25",
    toastToday: "Challenged 203.0.113.0/24 until 14:25.",
    blockedOnThe8th: "Blocked until 08 Dec at 01:25",
    challengedOnThe8th: "Challenged until 08 Dec at 01:25",
    toastOnThe8th: "Challenged 203.0.113.0/24 until 08 Dec at 01:25.",
    toastUntilLifted: "Challenged 203.0.113.0/24.",
  },
  de: {
    blockedToday: "Gesperrt bis 14:25",
    challengedToday: "Mit Challenge bis 14:25",
    toastToday: "203.0.113.0/24 bis 14:25 mit einer Challenge belegt.",
    blockedOnThe8th: "Gesperrt bis zum 8. Dez. um 01:25",
    challengedOnThe8th: "Mit Challenge bis zum 8. Dez. um 01:25",
    toastOnThe8th:
      "203.0.113.0/24 bis zum 8. Dez. um 01:25 mit einer Challenge belegt.",
    toastUntilLifted: "203.0.113.0/24 mit einer Challenge belegt.",
  },
  fr: {
    blockedToday: "Bloquée jusqu'à 14:25",
    challengedToday: "Soumise à un défi jusqu'à 14:25",
    toastToday: "Défi appliqué à 203.0.113.0/24 jusqu'à 14:25.",
    blockedOnThe8th: "Bloquée jusqu'au 8 déc. à 01:25",
    challengedOnThe8th: "Soumise à un défi jusqu'au 8 déc. à 01:25",
    toastOnThe8th: "Défi appliqué à 203.0.113.0/24 jusqu'au 8 déc. à 01:25.",
    toastUntilLifted: "Défi appliqué à 203.0.113.0/24.",
  },
  es: {
    blockedToday: "Bloqueada hasta las 14:25",
    challengedToday: "Sometida a desafío hasta las 14:25",
    toastToday: "Se sometió 203.0.113.0/24 a desafío hasta las 14:25.",
    blockedOnThe8th: "Bloqueada hasta el 8 dic a la 01:25",
    challengedOnThe8th: "Sometida a desafío hasta el 8 dic a la 01:25",
    toastOnThe8th:
      "Se sometió 203.0.113.0/24 a desafío hasta el 8 dic a la 01:25.",
    toastUntilLifted: "Se sometió 203.0.113.0/24 a desafío.",
  },
  it: {
    blockedToday: "Bloccato fino alle 14:25",
    challengedToday: "Sottoposto a verifica fino alle 14:25",
    toastToday: "203.0.113.0/24 sottoposto a verifica fino alle 14:25.",
    blockedOnThe8th: "Bloccato fino all'8 dic all'01:25",
    challengedOnThe8th: "Sottoposto a verifica fino all'8 dic all'01:25",
    toastOnThe8th:
      "203.0.113.0/24 sottoposto a verifica fino all'8 dic all'01:25.",
    toastUntilLifted: "203.0.113.0/24 sottoposto a verifica.",
  },
  pt: {
    blockedToday: "Bloqueado até as 14:25",
    challengedToday: "Desafiado até as 14:25",
    toastToday: "Desafio aplicado a 203.0.113.0/24 até as 14:25.",
    blockedOnThe8th: "Bloqueado até 8 de dez. à 01:25",
    challengedOnThe8th: "Desafiado até 8 de dez. à 01:25",
    toastOnThe8th: "Desafio aplicado a 203.0.113.0/24 até 8 de dez. à 01:25.",
    toastUntilLifted: "Desafio aplicado a 203.0.113.0/24.",
  },
  nl: {
    blockedToday: "Geblokkeerd tot 14:25",
    challengedToday: "Met challenge tot 14:25",
    toastToday: "203.0.113.0/24 heeft een challenge tot 14:25.",
    blockedOnThe8th: "Geblokkeerd tot 8 dec om 01:25",
    challengedOnThe8th: "Met challenge tot 8 dec om 01:25",
    toastOnThe8th: "203.0.113.0/24 heeft een challenge tot 8 dec om 01:25.",
    toastUntilLifted: "203.0.113.0/24 heeft een challenge.",
  },
  da: {
    blockedToday: "Blokeret indtil kl. 14.25",
    challengedToday: "Udfordret indtil kl. 14.25",
    toastToday: "Udfordrede 203.0.113.0/24 indtil kl. 14.25.",
    blockedOnThe8th: "Blokeret indtil den 8. dec. kl. 01.25",
    challengedOnThe8th: "Udfordret indtil den 8. dec. kl. 01.25",
    toastOnThe8th: "Udfordrede 203.0.113.0/24 indtil den 8. dec. kl. 01.25.",
    toastUntilLifted: "Udfordrede 203.0.113.0/24.",
  },
  no: {
    blockedToday: "Blokkert til kl. 14:25",
    challengedToday: "Utfordret til kl. 14:25",
    toastToday: "Utfordret 203.0.113.0/24 til kl. 14:25.",
    blockedOnThe8th: "Blokkert til 8. des. kl. 01:25",
    challengedOnThe8th: "Utfordret til 8. des. kl. 01:25",
    toastOnThe8th: "Utfordret 203.0.113.0/24 til 8. des. kl. 01:25.",
    toastUntilLifted: "Utfordret 203.0.113.0/24.",
  },
  sv: {
    blockedToday: "Blockerad till kl. 14:25",
    challengedToday: "Utmanad till kl. 14:25",
    toastToday: "Utmanade 203.0.113.0/24 till kl. 14:25.",
    blockedOnThe8th: "Blockerad till den 8 dec. kl. 01:25",
    challengedOnThe8th: "Utmanad till den 8 dec. kl. 01:25",
    toastOnThe8th: "Utmanade 203.0.113.0/24 till den 8 dec. kl. 01:25.",
    toastUntilLifted: "Utmanade 203.0.113.0/24.",
  },
  ru: {
    blockedToday: "Заблокирован до 14:25",
    challengedToday: "Проверка до 14:25",
    toastToday: "Проверка назначена для 203.0.113.0/24 до 14:25.",
    blockedOnThe8th: "Заблокирован до 8 дек., 01:25",
    challengedOnThe8th: "Проверка до 8 дек., 01:25",
    toastOnThe8th: "Проверка назначена для 203.0.113.0/24 до 8 дек., 01:25.",
    toastUntilLifted: "Проверка назначена для 203.0.113.0/24.",
  },
  ja: {
    blockedToday: "14:25 までブロック",
    challengedToday: "14:25 までチャレンジ",
    toastToday: "203.0.113.0/24 に 14:25 までチャレンジを適用しました。",
    blockedOnThe8th: "12月8日 01:25 までブロック",
    challengedOnThe8th: "12月8日 01:25 までチャレンジ",
    toastOnThe8th:
      "203.0.113.0/24 に 12月8日 01:25 までチャレンジを適用しました。",
    toastUntilLifted: "203.0.113.0/24 にチャレンジを適用しました。",
  },
  ko: {
    blockedToday: "14:25까지 차단됨",
    challengedToday: "14:25까지 챌린지 적용됨",
    toastToday: "203.0.113.0/24에 14:25까지 챌린지를 적용했습니다.",
    blockedOnThe8th: "12월 8일 01:25까지 차단됨",
    challengedOnThe8th: "12월 8일 01:25까지 챌린지 적용됨",
    toastOnThe8th: "203.0.113.0/24에 12월 8일 01:25까지 챌린지를 적용했습니다.",
    toastUntilLifted: "203.0.113.0/24에 챌린지를 적용했습니다.",
  },
  "zh-CN": {
    blockedToday: "封禁直到 14:25",
    challengedToday: "质询直到 14:25",
    toastToday: "已质询 203.0.113.0/24，直到 14:25。",
    blockedOnThe8th: "封禁直到 12月8日 01:25",
    challengedOnThe8th: "质询直到 12月8日 01:25",
    toastOnThe8th: "已质询 203.0.113.0/24，直到 12月8日 01:25。",
    toastUntilLifted: "已质询 203.0.113.0/24。",
  },
  "zh-TW": {
    blockedToday: "封鎖直到 14:25",
    challengedToday: "挑戰直到 14:25",
    toastToday: "已挑戰 203.0.113.0/24，直到 14:25。",
    blockedOnThe8th: "封鎖直到 12月8日 01:25",
    challengedOnThe8th: "挑戰直到 12月8日 01:25",
    toastOnThe8th: "已挑戰 203.0.113.0/24，直到 12月8日 01:25。",
    toastUntilLifted: "已挑戰 203.0.113.0/24。",
  },
  hi: {
    blockedToday: "14:25 तक ब्लॉक",
    challengedToday: "14:25 तक चैलेंज",
    toastToday: "203.0.113.0/24 पर 14:25 तक चैलेंज लगाया गया।",
    blockedOnThe8th: "8 दिस॰ को 01:25 तक ब्लॉक",
    challengedOnThe8th: "8 दिस॰ को 01:25 तक चैलेंज",
    toastOnThe8th: "203.0.113.0/24 पर 8 दिस॰ को 01:25 तक चैलेंज लगाया गया।",
    toastUntilLifted: "203.0.113.0/24 पर चैलेंज लगाया गया।",
  },
  fa: {
    blockedToday: "مسدود تا ساعت ۱۴:۲۵",
    challengedToday: "با چالش تا ساعت ۱۴:۲۵",
    toastToday: "203.0.113.0/24 تا ساعت ۱۴:۲۵ با چالش روبه‌رو شد.",
    blockedOnThe8th: "مسدود تا ۸ دسامبر ساعت ۰۱:۲۵",
    challengedOnThe8th: "با چالش تا ۸ دسامبر ساعت ۰۱:۲۵",
    toastOnThe8th: "203.0.113.0/24 تا ۸ دسامبر ساعت ۰۱:۲۵ با چالش روبه‌رو شد.",
    toastUntilLifted: "203.0.113.0/24 با چالش روبه‌رو شد.",
  },
  ar: {
    blockedToday: "محظور حتى الساعة 14:25",
    challengedToday: "خاضع للتحدي حتى الساعة 14:25",
    toastToday: "تم إخضاع 203.0.113.0/24 للتحدي حتى الساعة 14:25.",
    blockedOnThe8th: "محظور حتى 8 ديسمبر الساعة 01:25",
    challengedOnThe8th: "خاضع للتحدي حتى 8 ديسمبر الساعة 01:25",
    toastOnThe8th: "تم إخضاع 203.0.113.0/24 للتحدي حتى 8 ديسمبر الساعة 01:25.",
    toastUntilLifted: "تم إخضاع 203.0.113.0/24 للتحدي.",
  },
};

function readCampaignSentences(language: string): CampaignSentences {
  const translator: Translator = dashboardTranslator(language);

  return withDateDisplayLanguage(language, (): CampaignSentences => {
    const pill: (action: SecurityBlockAction, expiresAt: string) => string = (
      action: SecurityBlockAction,
      expiresAt: string,
    ): string => {
      return writeRowBlockPill({
        block: { value: ADDRESS, action, expiresAt },
        value: ADDRESS,
        translator,
        now: NOW,
      }).text;
    };
    const toast: (expiresAt: Date | null) => string = (
      expiresAt: Date | null,
    ): string => {
      return writeNetworkChallengedToast({
        challenged: { value: NETWORK, expiresAt },
        translator,
        now: NOW,
      });
    };

    return {
      blockedToday: pill(SecurityBlockAction.Block, TODAY_AT_14_25),
      challengedToday: pill(SecurityBlockAction.Challenge, TODAY_AT_14_25),
      toastToday: toast(new Date(TODAY_AT_14_25)),
      blockedOnThe8th: pill(SecurityBlockAction.Block, THE_8TH_AT_01_25),
      challengedOnThe8th: pill(SecurityBlockAction.Challenge, THE_8TH_AT_01_25),
      toastOnThe8th: toast(new Date(THE_8TH_AT_01_25)),
      toastUntilLifted: toast(null),
    };
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the campaigns' sentences that name a moment, in every language", () => {
  test("every language the Dashboard speaks is pinned, English first", () => {
    expect(Object.keys(IN_EVERY_LANGUAGE).sort()).toEqual(
      ["en", ...DASHBOARD_LANGUAGES].sort(),
    );
  });

  test.each(Object.keys(IN_EVERY_LANGUAGE))(
    "%s: a row blocked and challenged until today's 14:25 and the 8th's 01:25, and the network challenged until then and until lifted",
    (language: string) => {
      jest
        .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
        .mockReturnValue(false);

      expect(readCampaignSentences(language)).toEqual(
        IN_EVERY_LANGUAGE[language],
      );
    },
  );

  test("no language holds a moment written whole, the way the sentences did before (#10932), nor a placeholder left unfilled", () => {
    jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    const offenders: Array<string> = [];

    for (const language of Object.keys(IN_EVERY_LANGUAGE)) {
      const read: CampaignSentences = readCampaignSentences(language);
      // Russian's own day phrase is a day, a comma and its clock: "до 8 дек., 01:25".
      const isRussian: boolean = language === "ru";

      for (const sentence of Object.values(read)) {
        if (!isRussian && MOMENT_WRITTEN_WHOLE.test(sentence)) {
          offenders.push(`${language}: a moment written whole in ${sentence}`);
        }

        if (
          PLACEHOLDER_LEFT.test(sentence) ||
          NOTHING_BEFORE_END.test(sentence)
        ) {
          offenders.push(`${language}: unfilled in ${sentence}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
