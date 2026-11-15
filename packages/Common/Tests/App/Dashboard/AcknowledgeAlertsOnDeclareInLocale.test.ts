import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import {
  ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE,
  ACKNOWLEDGES_ALERTS_DESCRIPTION,
  ACKNOWLEDGES_ONE_ALERT_DESCRIPTION,
  ACKNOWLEDGE_ALERTS_NOT_YET_ACKNOWLEDGED_TITLE,
  ACKNOWLEDGE_EVERY_ALERT_TITLE,
  ALERTS_NOT_YET_ACKNOWLEDGED_KEEP_ESCALATING_NOTE,
  ALREADY_ACKNOWLEDGED_ALERTS,
  THESE_ALERTS_KEEP_ESCALATING_NOTE,
  THE_ALERT_KEEPS_ESCALATING_NOTE,
  getAcknowledgeAlertsDescription,
  getAcknowledgeAlertsGate,
  getAcknowledgeAlertsTitle,
  getAlertsKeepEscalatingNote,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/AcknowledgeAlertsOnDeclare";
import Permission from "../../../Types/Permission";
import {
  PluralTemplate,
  Translator,
  createTranslator,
} from "../../../Types/Translator";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import UserUtil from "../../../UI/Utils/User";
import { AlertsToAcknowledge } from "../../../Utils/Incident/IncidentFromAlerts";

/*
 * THE "ACKNOWLEDGE THE ALERTS" BOX IN THE READER'S LANGUAGE (#7513).
 *
 * Declaring an incident from alerts shows a box, ticked by default, that
 * acknowledges the alerts not acknowledged yet, with a description under
 * it, a note when they will keep escalating and a note on the On-Call step.
 * The banner around it is in the reader's language, and its own words were
 * English in every language: plain English strings with the count written
 * in. Each is a translation key now - a plural where it names a count - and
 * every Dashboard locale words it. These tests draw each one through the
 * Dashboard's own locale files.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

// The Dashboard's languages besides English.
const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json") && file !== "en.json";
  })
  .map((file: string): string => {
    return file.replace(/\.json$/, "");
  })
  .sort();

const localeCache: Map<string, Record<string, string>> = new Map();

function localeOf(language: string): Record<string, string> {
  const cached: Record<string, string> | undefined = localeCache.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;

  localeCache.set(language, locale);

  return locale;
}

// The Dashboard's translator in a language, reading its locale file.
function translatorIn(language: string): Translator {
  const locale: Record<string, string> = localeOf(language);

  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const PLURALS: Array<PluralTemplate> = [
  ACKNOWLEDGE_EVERY_ALERT_TITLE,
  ACKNOWLEDGE_ALERTS_NOT_YET_ACKNOWLEDGED_TITLE,
  ALREADY_ACKNOWLEDGED_ALERTS,
  ALERTS_NOT_YET_ACKNOWLEDGED_KEEP_ESCALATING_NOTE,
];

const SENTENCES: Array<string> = [
  ACKNOWLEDGES_ONE_ALERT_DESCRIPTION,
  ACKNOWLEDGES_ALERTS_DESCRIPTION,
  THE_ALERT_KEEPS_ESCALATING_NOTE,
  THESE_ALERTS_KEEP_ESCALATING_NOTE,
  ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE,
  "You do not have permission to acknowledge this alert.",
];

// Every key the box's words are looked up by, with the English each holds.
const KEYS: Array<[string, string]> = [
  ...PLURALS.flatMap((plural: PluralTemplate): Array<[string, string]> => {
    return [
      [plural.other, plural.other],
      [`${plural.other}_one`, plural.one],
    ];
  }),
  ...SENTENCES.map((sentence: string): [string, string] => {
    return [sentence, sentence];
  }),
];

type ToAcknowledgeFunction = (
  count: number,
  alreadyAcknowledgedCount?: number,
) => AlertsToAcknowledge;

const toAcknowledge: ToAcknowledgeFunction = (
  count: number,
  alreadyAcknowledgedCount?: number,
): AlertsToAcknowledge => {
  return {
    alertIds: Array.from(
      { length: count },
      (_value: unknown, index: number): string => {
        return `alert-${index + 1}`;
      },
    ),
    alreadyAcknowledgedCount: alreadyAcknowledgedCount || 0,
  };
};

const GERMAN: Translator = translatorIn("de");
const PERSIAN: Translator = translatorIn("fa");
const RUSSIAN: Translator = translatorIn("ru");
const ENGLISH: Translator = translatorIn("en");

// Persian letters, and the Latin letters and digits a Persian text has none of.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;
const LATIN_LETTER_OR_DIGIT: RegExp = /[A-Za-z0-9]/;

describe("the box's words are keys every Dashboard locale words", () => {
  test("en.json holds each key with its English", () => {
    const english: Record<string, string> = localeOf("en");

    for (const [key, text] of KEYS) {
      expect({ key, text: english[key] }).toEqual({ key, text });
    }

    expect(KEYS).toHaveLength(14);
  });

  test.each(LANGUAGES)(
    "%s words every one of them, and not as English",
    (language: string) => {
      const locale: Record<string, string> = localeOf(language);

      for (const [key, english] of KEYS) {
        const worded: string | undefined = locale[key];

        expect({ language, key, worded: typeof worded === "string" }).toEqual({
          language,
          key,
          worded: true,
        });
        expect({ language, key, english: worded === english }).toEqual({
          language,
          key,
          english: false,
        });

        // A count stays where the locale puts it, and no placeholder is new.
        const placeholders: Array<string> =
          (worded || "").match(/\{\{\w+\}\}/g) || [];

        for (const placeholder of placeholders) {
          expect({ language, key, placeholder }).toEqual({
            language,
            key,
            placeholder: "{{count}}",
          });
        }

        if (key.endsWith("_one") || !english.includes("{{count}}")) {
          continue;
        }

        expect({ language, key, count: placeholders.length }).toEqual({
          language,
          key,
          count: 1,
        });
      }
    },
  );
});

describe("the box's label in the reader's language", () => {
  test("German: one alert, several, and only those not acknowledged yet", () => {
    expect(getAcknowledgeAlertsTitle(toAcknowledge(1), 1, GERMAN)).toBe(
      "Diese Warnung bestätigen, um ihre Eskalation zu stoppen",
    );
    expect(getAcknowledgeAlertsTitle(toAcknowledge(3), 3, GERMAN)).toBe(
      "Diese 3 Warnungen bestätigen, um ihre Eskalation zu stoppen",
    );
    expect(getAcknowledgeAlertsTitle(toAcknowledge(1, 2), 3, GERMAN)).toBe(
      "Die 1 noch nicht bestätigte Warnung bestätigen, um ihre Eskalation zu stoppen",
    );
    expect(getAcknowledgeAlertsTitle(toAcknowledge(2, 3), 5, GERMAN)).toBe(
      "Die 2 noch nicht bestätigten Warnungen bestätigen, um ihre Eskalation zu stoppen",
    );
  });

  test("German writes a large count its own way", () => {
    expect(getAcknowledgeAlertsTitle(toAcknowledge(1200), 1200, GERMAN)).toBe(
      "Diese 1.200 Warnungen bestätigen, um ihre Eskalation zu stoppen",
    );
  });

  test("Persian: the words in Persian, the count in Persian digits", () => {
    const one: string = getAcknowledgeAlertsTitle(toAcknowledge(1), 1, PERSIAN);
    const three: string = getAcknowledgeAlertsTitle(
      toAcknowledge(3),
      3,
      PERSIAN,
    );

    expect(one).toBe("تأیید این هشدار برای توقف تشدید آن");
    expect(three).toBe("تأیید این ۳ هشدار برای توقف تشدید آن‌ها");

    for (const title of [
      one,
      three,
      getAcknowledgeAlertsTitle(toAcknowledge(2, 1), 3, PERSIAN),
    ]) {
      expect(PERSIAN_LETTER.test(title)).toBe(true);
      expect({ title, latin: LATIN_LETTER_OR_DIGIT.test(title) }).toEqual({
        title,
        latin: false,
      });
    }
  });

  test("Russian: 21 alerts, which Russian counts as one, take the form with the count", () => {
    expect(getAcknowledgeAlertsTitle(toAcknowledge(1), 1, RUSSIAN)).toBe(
      "Подтвердить это оповещение, чтобы остановить его эскалацию",
    );
    // "This alert" is said of one alert only.
    expect(getAcknowledgeAlertsTitle(toAcknowledge(21), 21, RUSSIAN)).toBe(
      "Подтвердить эти оповещения (21), чтобы остановить их эскалацию",
    );
    expect(getAcknowledgeAlertsTitle(toAcknowledge(21, 1), 22, RUSSIAN)).toBe(
      "Подтвердить 21 ещё не подтверждённое оповещение, чтобы остановить его эскалацию",
    );
  });

  /*
   * Japanese, Korean and Chinese have no "one" form: i18next draws the
   * general form for one alert too, so it reads right with a 1 in it.
   */
  test("a language with no one form draws its general form for one alert, worded to read right for 1", () => {
    expect(
      getAcknowledgeAlertsTitle(toAcknowledge(1), 1, translatorIn("ja")),
    ).toBe("1 件のアラートを確認してエスカレーションを止める");
    expect(
      getAcknowledgeAlertsTitle(toAcknowledge(1), 1, translatorIn("ko")),
    ).toBe("경고 1개를 인지하여 에스컬레이션 중지");
    expect(
      getAcknowledgeAlertsTitle(toAcknowledge(1), 1, translatorIn("zh-CN")),
    ).toBe("确认这 1 个警报以停止其升级");
  });

  test("English stays as it was, and a language with no words for it stays English", () => {
    const unknown: Translator = createTranslator((): undefined => {
      return undefined;
    }, "xx");

    for (const translator of [ENGLISH, unknown]) {
      expect(getAcknowledgeAlertsTitle(toAcknowledge(1), 1, translator)).toBe(
        "Acknowledge this alert to stop its escalation",
      );
      expect(
        getAcknowledgeAlertsTitle(toAcknowledge(1, 2), 3, translator),
      ).toBe(
        "Acknowledge the 1 alert that is not acknowledged yet, to stop its escalation",
      );
      expect(getAcknowledgeAlertsTitle(toAcknowledge(3), 3, translator)).toBe(
        "Acknowledge these 3 alerts to stop their escalation",
      );
      expect(
        getAcknowledgeAlertsTitle(toAcknowledge(2, 3), 5, translator),
      ).toBe(
        "Acknowledge the 2 alerts that are not acknowledged yet, to stop their escalation",
      );
    }
  });
});

describe("the box's description in the reader's language", () => {
  test("German: what acknowledging does, for one alert and for several", () => {
    expect(
      getAcknowledgeAlertsDescription(toAcknowledge(1), undefined, GERMAN),
    ).toBe(
      "Sie wird in Ihrem Namen bestätigt, wenn der Vorfall gemeldet wird, und ihre eigene Bereitschaftseskalation stoppt innerhalb einer Minute. Bereits versendete Alarmierungen werden nicht zurückgerufen.",
    );
    expect(
      getAcknowledgeAlertsDescription(toAcknowledge(4), undefined, GERMAN),
    ).toBe(
      "Sie werden in Ihrem Namen bestätigt, wenn der Vorfall gemeldet wird, und ihre eigene Bereitschaftseskalation stoppt innerhalb einer Minute. Bereits versendete Alarmierungen werden nicht zurückgerufen.",
    );
  });

  test("German: the alerts left as they are, with their count, and a reason last", () => {
    const reason: string = "Sie haben keine Berechtigung.";

    expect(
      getAcknowledgeAlertsDescription(toAcknowledge(2, 1), undefined, GERMAN),
    ).toContain(
      "1 Warnung ist bereits bestätigt oder behoben und bleibt, wie sie ist.",
    );
    expect(
      getAcknowledgeAlertsDescription(toAcknowledge(1, 3), reason, GERMAN),
    ).toBe(
      `${GERMAN.translateText(ACKNOWLEDGES_ONE_ALERT_DESCRIPTION)} 3 Warnungen sind bereits bestätigt oder behoben und bleiben, wie sie sind. ${reason}`,
    );
  });

  test("Persian: in Persian, the count in Persian digits", () => {
    const description: string = getAcknowledgeAlertsDescription(
      toAcknowledge(1, 3),
      undefined,
      PERSIAN,
    );

    expect(description).toContain(
      PERSIAN.translateText(ACKNOWLEDGES_ONE_ALERT_DESCRIPTION) as string,
    );
    expect(description).toContain("۳ هشدار از پیش تأیید یا برطرف شده");
    expect(LATIN_LETTER_OR_DIGIT.test(description)).toBe(false);
  });

  test("English stays as it was", () => {
    expect(
      getAcknowledgeAlertsDescription(toAcknowledge(1, 1), undefined, ENGLISH),
    ).toBe(
      `${ACKNOWLEDGES_ONE_ALERT_DESCRIPTION} 1 alert is already acknowledged or resolved and is left as it is.`,
    );
    expect(
      getAcknowledgeAlertsDescription(toAcknowledge(2, 2), undefined, ENGLISH),
    ).toBe(
      `${ACKNOWLEDGES_ALERTS_DESCRIPTION} 2 alerts are already acknowledged or resolved and are left as they are.`,
    );
  });
});

describe("the notes in the reader's language", () => {
  test("German: the note on alerts that keep escalating, in each of its four cases", () => {
    expect(getAlertsKeepEscalatingNote(toAcknowledge(1), 1, GERMAN)).toBe(
      "Das Melden des Vorfalls bestätigt die Warnung nicht: Sie eskaliert weiter, bis sie bestätigt wird.",
    );
    expect(getAlertsKeepEscalatingNote(toAcknowledge(3), 3, GERMAN)).toBe(
      "Das Melden des Vorfalls bestätigt diese Warnungen nicht: Sie eskalieren weiter, bis sie bestätigt werden.",
    );
    expect(getAlertsKeepEscalatingNote(toAcknowledge(1, 2), 3, GERMAN)).toBe(
      "Das Melden des Vorfalls bestätigt die noch nicht bestätigte Warnung nicht: Sie eskaliert weiter, bis sie bestätigt wird.",
    );
    expect(getAlertsKeepEscalatingNote(toAcknowledge(2, 2), 4, GERMAN)).toBe(
      "Das Melden des Vorfalls bestätigt die 2 noch nicht bestätigten Warnungen nicht: Sie eskalieren weiter, bis sie bestätigt werden.",
    );
  });

  test("Persian: the note in Persian, the count in Persian digits", () => {
    expect(getAlertsKeepEscalatingNote(toAcknowledge(1), 1, PERSIAN)).toBe(
      "اعلام حادثه هشدار را تأیید نمی‌کند: تا وقتی تأیید نشود، تشدیدش ادامه دارد.",
    );
    expect(
      getAlertsKeepEscalatingNote(toAcknowledge(2, 2), 4, PERSIAN),
    ).toContain("۲ هشداری");
  });

  test("the On-Call step's note is a key every language words", () => {
    expect(GERMAN.translateText(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE)).toBe(
      "Die Warnungen, aus denen er gemeldet wird, werden ebenfalls bestätigt, sodass ihre eigene Eskalation stoppt. Eine Warnungsepisode, zu der sie gehören, eskaliert weiter, bis die Episode bestätigt wird, und eine Vorfalls-Bereitschaftsregel kann, falls vorhanden, weiterhin alarmieren.",
    );
    expect(
      PERSIAN_LETTER.test(
        PERSIAN.translateText(ACKNOWLEDGED_ALERTS_NO_ON_CALL_NOTE) as string,
      ),
    ).toBe(true);
  });

  test("English stays as it was", () => {
    expect(getAlertsKeepEscalatingNote(toAcknowledge(1, 2), 3, ENGLISH)).toBe(
      "Declaring the incident does not acknowledge the alert that is not acknowledged yet: it keeps escalating until it is acknowledged.",
    );
    expect(getAlertsKeepEscalatingNote(toAcknowledge(2, 2), 4, ENGLISH)).toBe(
      "Declaring the incident does not acknowledge the 2 alerts that are not acknowledged yet: they keep escalating until they are acknowledged.",
    );
  });
});

/*
 * The locked box's reason comes from PermissionGate, which writes it with
 * the global translator. Its first sentence was the verb-and-name template
 * with "acknowledge" in it, a verb no locale words on its own, so German
 * read "Sie haben keine Berechtigung für „acknowledge“ ...". It is a whole
 * sentence of its own now.
 */
describe("the locked box's reason in the reader's language", () => {
  let permissionsForTest: Array<Permission> = [];

  beforeAll(async () => {
    await i18next.init({
      lng: "de",
      fallbackLng: "en",
      resources: { de: { translation: localeOf("de") } },
      keySeparator: false,
      nsSeparator: false,
      interpolation: { escapeValue: false },
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  beforeEach(() => {
    PermissionGate.clearPermissionPropsCache();
    jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
      return permissionsForTest;
    });
    jest.spyOn(UserUtil, "isMasterAdmin").mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("German: the whole first sentence in German, and the permission it needs", () => {
    permissionsForTest = [Permission.Viewer];

    const gate: PermissionGateResult = getAcknowledgeAlertsGate();

    expect(gate.isAllowed).toBe(false);
    expect(
      gate.disabledReason?.startsWith(
        "Sie haben keine Berechtigung, diese Warnung zu bestätigen.",
      ),
    ).toBe(true);
    expect(gate.disabledReason).not.toContain("acknowledge");
    expect(gate.disabledReason).toContain("Create Alert State Timeline");
  });
});
