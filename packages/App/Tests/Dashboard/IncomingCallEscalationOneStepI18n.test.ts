import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding an incoming call escalation rule is one short step: who to call
 * (one picker of on-call schedules and people, one pick) and how long the
 * phone rings, with the name and the description folded under Advanced.
 * Every word the dialog, its picker and the rules list draw is looked up in
 * the Dashboard locale files by its English text, so a string no locale
 * carries stays English for everyone. This pins the strings the change
 * added - in all seventeen locales, translated - and that the ones only the
 * old three-step form and its list drew are drawn no more.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_UI: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

// Every key this change added, by where it is drawn.
const NEW_STRINGS: Array<string> = [
  // The Who to call field and its picker.
  "Who to call",
  "An on-call schedule rings whoever is on call in it when the call comes in.",
  "Choose who to call",
  "Search schedules or people...",
  "No on-call schedules or people to pick from.",
  "Choose an on-call schedule or a person to call.",
  // How long the phone rings.
  "Ring for (in seconds)",
  "If nobody answers in this time, the call moves on to the next rule. Keep it shorter than their phone takes to go to voicemail.",
  // The description, under Advanced.
  "Describe who this rule calls and why.",
  // The rules list.
  "Ring for",
  "{{count}} seconds",
  // The policy's overview, which said rules could call teams.
  "Add the on-call schedules or people to call when someone dials this number.",
];

// The plural's "one" sentence, kept beside its general one.
const SECONDS_ONE_KEY: string = "{{count}} seconds_one";

// Languages whose plurals have a "one" form (README: Japanese, Korean and Chinese have none).
const LOCALES_WITHOUT_ONE_FORM: Array<string> = [
  "ja.json",
  "ko.json",
  "zh-CN.json",
  "zh-TW.json",
];

/*
 * Strings only the old three-step form and its list drew. Their keys stay
 * in the locale files, as retired keys do, but no code draws them.
 */
const RETIRED_STRINGS: Array<string> = [
  "Select who should be notified when a call comes in.",
  "Select an on-call schedule. The current on-call user will be called.",
  "Select On-Call Schedule",
  "Select a user to call directly.",
  "Time to wait before escalating to the next rule if no answer",
  "Time to wait before escalating to the next rule if no answer.",
  "e.g., Primary On-Call",
  "Optional description for this rule",
  "On-call schedule which will be called when a call comes in.",
  "User who will be called when a call comes in.",
  "The name of the escalation rule.",
  "The description of the escalation rule.",
  "Escalate After (seconds)",
  "Add on-call schedules, teams, or users to handle incoming calls",
];

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

type ReadLocaleFunction = (file: string) => Record<string, unknown>;

const readLocale: ReadLocaleFunction = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string) => {
    return file.endsWith(".json");
  })
  .sort();

const NON_ENGLISH_FILES: Array<string> = LOCALE_FILES.filter((file: string) => {
  return file !== "en.json";
});

type StripCommentsFunction = (source: string) => string;

const stripComments: StripCommentsFunction = (source: string): string => {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
};

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

type ListSourcesFunction = (directory: string) => Array<string>;

const listSources: ListSourcesFunction = (directory: string): Array<string> => {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return ["node_modules", "Locales", "build", "dist"].includes(entry.name)
          ? []
          : listSources(full);
      }

      return TYPESCRIPT_FILE.test(entry.name) ? [full] : [];
    });
};

// The code the strings are drawn from, without the prose about it.
const CODE: string = [...listSources(DASHBOARD_SRC), ...listSources(COMMON_UI)]
  .map((file: string): string => {
    return stripComments(fs.readFileSync(file, "utf8"));
  })
  .join("\n");

/*
 * What is wrong with a translation: missing, still English, its
 * placeholders changed, or - unless it is a count, which a language may
 * abbreviate ("{{count}} сек.") - a sentence turned into a label or back.
 */
type ProblemsFunction = (
  text: string,
  value: unknown,
  isSentence: boolean | null,
) => Array<string>;

const findProblems: ProblemsFunction = (
  text: string,
  value: unknown,
  isSentence: boolean | null,
): Array<string> => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [`missing: ${text}`];
  }

  if (value === text) {
    return [`left in English: ${text}`];
  }

  const placeholders: string = (text.match(PLACEHOLDER) || []).sort().join(",");

  if ((value.match(PLACEHOLDER) || []).sort().join(",") !== placeholders) {
    return [`placeholders changed: ${text}`];
  }

  if (isSentence === null) {
    return [];
  }

  // A sentence stays a sentence and a label stays a label.
  const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
    (ending: string): boolean => {
      return value.trim().endsWith(ending);
    },
  );

  if (isSentence !== endsLikeSentence) {
    return [`punctuation differs: ${text}`];
  }

  return [];
};

describe("the one-step incoming call escalation rule's strings", () => {
  test("seventeen locales are checked", () => {
    expect(LOCALE_FILES).toHaveLength(17);
    expect(LOCALE_FILES).toContain("en.json");
  });

  test("each new string is drawn by the code, as one whole string", () => {
    const unused: Array<string> = NEW_STRINGS.filter(
      (text: string): boolean => {
        return !CODE.includes(`"${text}"`);
      },
    );

    expect(unused).toEqual([]);
    // The plural's "one" sentence is drawn beside it.
    expect(CODE).toContain(`one: "{{count}} second",`);
  });

  test("none of the retired strings is drawn any more", () => {
    const drawn: Array<string> = RETIRED_STRINGS.filter(
      (text: string): boolean => {
        return CODE.includes(`"${text}"`);
      },
    );

    expect(drawn).toEqual([]);
  });

  test("English carries every new string as itself, and the plural's one form", () => {
    const english: Record<string, unknown> = readLocale("en.json");

    const wrong: Array<string> = NEW_STRINGS.filter((text: string): boolean => {
      return english[text] !== text;
    });

    expect(wrong).toEqual([]);
    expect(english[SECONDS_ONE_KEY]).toBe("{{count}} second");
  });

  test.each(NON_ENGLISH_FILES)(
    "%s translates every new string",
    (file: string) => {
      const locale: Record<string, unknown> = readLocale(file);

      const problems: Array<string> = NEW_STRINGS.flatMap(
        (text: string): Array<string> => {
          return findProblems(
            text,
            locale[text],
            text.startsWith("{{count}}") ? null : text.endsWith("."),
          );
        },
      );

      expect(problems).toEqual([]);
    },
  );

  test.each(
    NON_ENGLISH_FILES.filter((file: string): boolean => {
      return !LOCALES_WITHOUT_ONE_FORM.includes(file);
    }),
  )("%s translates the one-second form", (file: string) => {
    const locale: Record<string, unknown> = readLocale(file);

    expect(
      findProblems("{{count}} second", locale[SECONDS_ONE_KEY], null),
    ).toEqual([]);
  });
});
