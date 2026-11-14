import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  dashboardTranslator,
  isWordedInDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "Common/Tests/Helpers/TranslatedLanguages";
import { Translator } from "Common/Types/Translator";

/*
 * THE STATUS PAGE GRID, THE ROLE CARDS AND THE DASHBOARD WIDGETS THE TWO
 * RIGHT-TO-LEFT REVIEWS MET, IN PERSIAN (#7088).
 *
 * The UI reviews of #6979 (Status Page > Resources and the role cards in
 * Arabic and Persian) and #6986 (dashboard widgets in Arabic and Persian)
 * found words on the surfaces they changed that the Persian Dashboard still
 * drew in English: the grid cell's "Add monitor", the off-grid count line
 * (English in German and twelve more languages too), the resource list's
 * "Shown on the status page as", the role cards' "Reassign" and its busy
 * "Reassigning...", a honeycomb tile's "Click to open" and the SLO chart's
 * "No history ..." notice, drawn in English with its full stop at the left.
 * The code already looked every one of them up; only the words were
 * missing.
 *
 * Every string those surfaces draw is held here, as the extractor reads it
 * from their files: Persian words each one, or keeps it as written on
 * purpose (its same-as-English list), and every Dashboard language words the
 * off-grid count line in each form it reads.
 */

const DASHBOARD: string = path.resolve(__dirname, "../../FeatureSet/Dashboard");
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

// The surfaces the two reviews looked at.
const SURFACE_FILES: ReadonlyArray<string> = [
  // Status Page > Resources: the grid, its cells and the off-grid list.
  "packages/Common/UI/Components/StatusPage/ResourceGrid.tsx",
  // Status Page > Resources: the list and its column headings.
  "packages/Common/UI/Components/StatusPage/ResourceList.tsx",
  // The role cards on an incident, an alert, an episode or a team.
  "packages/Common/UI/Components/MemberRoleAssignment/MemberRoleAssignment.tsx",
  // A list widget's honeycomb and its tooltip.
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb.tsx",
  // The Kubernetes pod list widget, whose tiles the review hovered.
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesPodListComponent.tsx",
  // The SLO widget, and its chart's notice when the range has no history.
  "packages/App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardSloComponent.tsx",
];

// The words the reviews saw in English, by the issue's table.
const REVIEWED: ReadonlyArray<string> = [
  "Add monitor",
  "{{count}} resources are not on the grid",
  "Shown on the status page as",
  "Reassign",
  "Reassigning...",
  "Click to open",
  "No history for the selected time range — the SLO is evaluated every few minutes.",
];

const OFF_GRID: string = "{{count}} resources are not on the grid";
const OFF_GRID_ONE: string = `${OFF_GRID}_one`;

/*
 * Latin words a Persian string on these surfaces keeps: SLO is the
 * product's name for an objective (the Persian SLO pages say "SLO" too);
 * Enter is the name on the key a honeycomb tile's keyboard tooltip says to
 * press (#7347), as the Persian Dashboard writes it everywhere else: the
 * session replay search's "Press Enter to open this session." and the key
 * name itself.
 */
const KEPT_LATIN_WORDS: ReadonlyArray<string> = ["SLO", "Enter"];

const PLACEHOLDER: RegExp = /\{\{\s*[\w.]+\s*\}\}/g;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_LETTER: RegExp = /[\u0600-\u06FF]/;
const ARABIC_YEH_OR_KAF: RegExp = /[\u064A\u0643]/;
const PERSIAN_QUESTION_MARK: string = "\u061F";
// A sentence's end: a full stop or a question mark, Latin or Persian.
const SENTENCE_END: RegExp = /[.?\u061F]$/;

type Locale = Record<string, unknown>;

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLocale(language: string): Locale {
  return readJson(
    path.join(DASHBOARD, `src/Locales/${language}.json`),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");
const PERSIAN: Locale = readLocale("fa");
const PERSIAN_KEPT: ReadonlyArray<string> =
  (
    readJson(path.join(DASHBOARD, "i18n/Progress/fa.json")) as {
      sameAsEnglish?: Array<string>;
    }
  ).sameAsEnglish || [];
const KEPT_EVERYWHERE: ReadonlyArray<string> = readJson(
  path.join(DASHBOARD, "i18n/SameAsEnglish.json"),
) as Array<string>;

// Every key the surfaces draw, as the extractor reads them: a plural's "one" form too.
const SURFACE_KEYS: Array<string> = Array.from(
  new Set<string>(
    SURFACE_FILES.flatMap((file: string): Array<string> => {
      return (
        scanSourceText(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
          { kind: "ui" },
        ).strings as Array<ExtractedString>
      ).flatMap((entry: ExtractedString): Array<string> => {
        return entry.pluralOne !== undefined
          ? [entry.text, `${entry.text}_one`]
          : [entry.text];
      });
    }),
  ),
).filter((key: string): boolean => {
  // Keys of the locale only: an attribute value or a class is not one.
  return typeof ENGLISH[key] === "string";
});

// The keys Persian writes as English on purpose: CSS colours, Kubernetes kinds.
function isKeptAsWritten(key: string): boolean {
  const english: string = String(ENGLISH[key]);

  return KEPT_EVERYWHERE.includes(english) || PERSIAN_KEPT.includes(english);
}

const PERSIAN_WORDED: Array<string> = SURFACE_KEYS.filter(
  (key: string): boolean => {
    return !isKeptAsWritten(key);
  },
);

describe("the surfaces the right-to-left reviews met", () => {
  test("draw the words the reviews saw, each a key of the English locale", () => {
    expect(SURFACE_KEYS.length).toBeGreaterThan(30);

    for (const key of [...REVIEWED, OFF_GRID_ONE]) {
      expect({ key, drawn: SURFACE_KEYS.includes(key) }).toEqual({
        key,
        drawn: true,
      });
    }
  });

  test("Persian words every string they draw, or keeps it as written on purpose", () => {
    const english: Array<string> = SURFACE_KEYS.filter(
      (key: string): boolean => {
        return !isWordedInDashboardLocale(key, "fa");
      },
    );

    expect(english).toEqual([]);
  });

  test("the words the reviews saw read in Persian, not in English", () => {
    for (const key of REVIEWED) {
      expect({ key, english: PERSIAN[key] === ENGLISH[key] }).toEqual({
        key,
        english: false,
      });
    }
  });

  test("a Persian string there holds no Latin letter, but the names it keeps", () => {
    const withLatin: Array<string> = PERSIAN_WORDED.filter(
      (key: string): boolean => {
        let text: string = String(PERSIAN[key]).replace(PLACEHOLDER, "");

        for (const word of KEPT_LATIN_WORDS) {
          text = text.split(word).join("");
        }

        return LATIN_LETTER.test(text) || !PERSIAN_LETTER.test(text);
      },
    );

    expect(withLatin).toEqual([]);
  });

  test("a Persian string there writes its letters the Persian way, and no digit of its own", () => {
    const wrong: Array<string> = PERSIAN_WORDED.filter(
      (key: string): boolean => {
        const text: string = String(PERSIAN[key]).replace(PLACEHOLDER, "");

        return ARABIC_YEH_OR_KAF.test(text) || LATIN_DIGIT.test(text);
      },
    );

    expect(wrong).toEqual([]);
  });

  test("a Persian sentence ends as its English does: a full stop, a Persian question mark, three dots", () => {
    for (const key of PERSIAN_WORDED) {
      const english: string = String(ENGLISH[key]);
      const persian: string = String(PERSIAN[key]);

      if (english.endsWith("...")) {
        expect({ key, ends: persian.endsWith("...") }).toEqual({
          key,
          ends: true,
        });
      } else if (english.endsWith(".")) {
        expect({ key, ends: persian.endsWith(".") }).toEqual({
          key,
          ends: true,
        });
      } else if (english.endsWith("?")) {
        expect({ key, ends: persian.endsWith(PERSIAN_QUESTION_MARK) }).toEqual({
          key,
          ends: true,
        });
      } else {
        expect({ key, ends: SENTENCE_END.test(persian) }).toEqual({
          key,
          ends: false,
        });
      }
    }
  });

  test("the SLO notice is a Persian sentence that names the SLO and ends with its full stop", () => {
    const notice: string = String(PERSIAN[REVIEWED[6] as string]);

    expect(notice).toBe(
      "برای بازه زمانی انتخاب‌شده تاریخچه‌ای نیست — SLO هر چند دقیقه یک بار ارزیابی می‌شود.",
    );
  });

  test("the role cards' Reassign button and its busy state say the same verb", () => {
    expect(PERSIAN["Reassign"]).toBe("تخصیص دوباره");
    expect(PERSIAN["Reassigning..."]).toBe("در حال تخصیص دوباره...");
    expect(String(PERSIAN["Reassign Role"])).toContain("تخصیص دوباره");
    expect(String(PERSIAN["Reassign {{role}} from {{member}}"])).toContain(
      "تخصیص دوباره",
    );
  });
});

describe("the off-grid count line", () => {
  const persian: Translator = dashboardTranslator("fa");
  const english: Translator = dashboardTranslator("en");
  const LINE: { one: string; other: string } = {
    one: String(ENGLISH[OFF_GRID_ONE]),
    other: OFF_GRID,
  };

  test("is worded in every Dashboard language, in each form the language reads", () => {
    const english: Array<string> = [];

    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of [OFF_GRID, OFF_GRID_ONE]) {
        if (!isWordedInDashboardLocale(key, language)) {
          english.push(`${language}: ${key}`);
        }
      }
    }

    expect(english).toEqual([]);
  });

  test("German says it in German, in both forms", () => {
    const german: Translator = dashboardTranslator("de");

    expect(german.translatePlural(LINE, 3)).toBe(
      "3 Ressourcen sind nicht im Raster",
    );
    expect(german.translatePlural(LINE, 1)).toBe(
      "1 Ressource ist nicht im Raster",
    );
  });

  test("Persian draws the count in Persian digits, in Persian words", () => {
    const three: string = persian.translatePlural(LINE, 3);
    const one: string = persian.translatePlural(LINE, 1);

    expect(three).toBe("۳ منبع در شبکه نیست");
    expect(one).toBe("۱ منبع در شبکه نیست");

    for (const line of [three, one]) {
      expect(LATIN_LETTER.test(line)).toBe(false);
      expect(LATIN_DIGIT.test(line)).toBe(false);
    }
  });

  test("English reads as it always did", () => {
    expect(english.translatePlural(LINE, 3)).toBe(
      "3 resources are not on the grid",
    );
    expect(english.translatePlural(LINE, 1)).toBe(
      "1 resource is not on the grid",
    );
  });
});

/*
 * The honeycomb tooltip's Namespace label is the Kubernetes kind, which the
 * Persian Dashboard writes as Kubernetes does, as it writes Deployment and
 * Job: its column heading, "نام Namespace", "رویدادهای Namespace" and the
 * Kubernetes monitor docs' **Namespace** filter all say it so. It stays on
 * the Persian same-as-English list on purpose, as German keeps it.
 */
describe("the Kubernetes kind Namespace", () => {
  test("stays as Kubernetes writes it in Persian, on purpose", () => {
    expect(PERSIAN_KEPT).toContain("Namespace");
    expect(PERSIAN["Namespace"]).toBe("Namespace");
    expect(String(PERSIAN["Namespace Name"])).toContain("Namespace");
  });

  test("while the tooltip's other labels read in Persian", () => {
    for (const key of ["Status", "Cluster", "Click to open", "Running"]) {
      expect({ key, english: PERSIAN[key] === ENGLISH[key] }).toEqual({
        key,
        english: false,
      });
    }
  });
});
