import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { act } from "react";
import LayersSaveBar, {
  LayersSaveStatus,
  getLayersChangeLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayersSaveBar";
import { getUnexplainedServerErrorMessage } from "../../../Types/Exception/UnexplainedError";
import { ScheduleLayersChanges } from "../../../Types/OnCallDutyPolicy/ScheduleLayersSave";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * THE LAYERS PAGE'S CHANGES, IN EVERY LANGUAGE (issue #7575).
 *
 * The Layers page of an on-call schedule holds its changes until Save
 * changes: a bar at its foot names them, a person moved or added is marked,
 * someone taken out is listed until the save, and Discard and leaving the
 * page each ask first. Read from the Dashboard's locale files, every
 * language words each of those texts itself, keeps their placeholders and
 * their stops, and opens both questions with the one sentence. Then drawn:
 * the bar in German, Arabic and Japanese says all of it in that language,
 * with none of its English.
 */

jest.setTimeout(60000);

// The texts the page's changes are shown with.
const TEXTS: ReadonlyArray<string> = [
  "Changes saved",
  "Changes to the layers",
  "Includes unsaved changes",
  "Layers in a new priority order",
  "Moved",
  "New turn order in {{name}}",
  "Not saved yet. They join the rotation when you save.",
  "Not saved yet. They take this place in the rotation when you save.",
  "Nothing changes for the people on call until you save.",
  "Reload layers",
  "Removed when you save",
  "Someone else changed these layers",
  "The page could not load the layers again. Reload to keep editing them.",
  "Undo deleting {{name}}",
  "Undo removing {{name}}",
  "Unsaved changes to the layers",
  "You have unsaved changes to this schedule's layers. If you discard them, the layers go back to how they were last saved.",
  "You have unsaved changes to this schedule's layers. If you leave now, they will be lost.",
  "Your changes were not saved. Reload to see the layers as they are now, then make your changes again.",
  "Your changes were saved",
  "and {{count}} more changes",
  "and {{count}} more changes_one",
  "{{count}} users added to {{name}}",
  "{{count}} users added to {{name}}_one",
  "{{count}} users removed from {{name}}",
  "{{count}} users removed from {{name}}_one",
  "{{name}} will be deleted",
  "{{name}} will be deleted when you save.",
];

const DISCARD_QUESTION: string =
  "You have unsaved changes to this schedule's layers. If you discard them, the layers go back to how they were last saved.";
const LEAVE_QUESTION: string =
  "You have unsaved changes to this schedule's layers. If you leave now, they will be lost.";

// Marks that would turn a right-to-left sentence round (Locales/ARABIC.md).
const DIRECTION_MARKS: RegExp = /[\u{200E}\u{200F}\u{061C}]/u;

// A sentence's stop, in any of the Dashboard's languages.
const STOP: RegExp = /[.。।]$/u;

// Where a sentence ends: a stop and a space, or an ideographic stop.
const SENTENCE_END: RegExp = /(?:[.!?।]\s|。)/u;

// The texts `locale` leaves in English, empty, or without a placeholder of the English.
function problemsIn(locale: Record<string, string>): Array<string> {
  const english: Record<string, string> = readDashboardLocale("en");

  return TEXTS.filter((key: string): boolean => {
    const value: string | undefined = locale[key];

    return (
      !value ||
      !value.trim() ||
      value === english[key] ||
      placeholdersOf(value).join() !== placeholdersOf(english[key]!).join()
    );
  });
}

// A text's first sentence, with its stop.
function openingSentence(text: string): string {
  const end: RegExpExecArray | null = SENTENCE_END.exec(text);

  return end ? text.slice(0, end.index + 1) : text;
}

describe("the texts in English", () => {
  test("each is a key of en.json, worded as its key, and the two questions open alike", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of TEXTS) {
      expect(english[key]).toBe(
        key.endsWith("_one")
          ? key
              .slice(0, -"_one".length)
              .replace("changes", "change")
              .replace("users", "user")
          : key,
      );
    }

    expect(openingSentence(DISCARD_QUESTION)).toBe(
      "You have unsaved changes to this schedule's layers.",
    );
    expect(openingSentence(LEAVE_QUESTION)).toBe(
      openingSentence(DISCARD_QUESTION),
    );
  });

  test("a language that left one text in English, emptied one, or dropped a placeholder would be caught", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(problemsIn(german)).toEqual([]);
    expect(problemsIn({ ...german, Moved: "Moved" })).toEqual(["Moved"]);
    expect(problemsIn({ ...german, "Reload layers": " " })).toEqual([
      "Reload layers",
    ]);
    expect(
      problemsIn({
        ...german,
        "{{name}} will be deleted": "Die Ebene wird gelöscht",
      }),
    ).toEqual(["{{name}} will be deleted"]);
    expect(
      problemsIn({
        ...german,
        "{{count}} users added to {{name}}_one": "Ein Benutzer hinzugefügt",
      }),
    ).toEqual(["{{count}} users added to {{name}}_one"]);
  });
});

describe.each([...DASHBOARD_LANGUAGES])(
  "the texts in %s",
  (language: string) => {
    const locale: Record<string, string> = readDashboardLocale(language);

    test("every text is the language's own, with every placeholder of the English", () => {
      expect(problemsIn(locale)).toEqual([]);

      for (const key of TEXTS) {
        expect({
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, worded: true });
      }
    });

    test("a sentence keeps its stop, and a label gets none", () => {
      for (const key of TEXTS) {
        const english: string = readDashboardLocale("en")[key]!;

        expect({ key, stop: STOP.test(locale[key]!) }).toEqual({
          key,
          stop: STOP.test(english),
        });
      }
    });

    test("both questions open with one sentence: the unsaved changes", () => {
      const opening: string = openingSentence(locale[LEAVE_QUESTION]!);

      expect(opening.length).toBeGreaterThan(0);
      expect(opening).not.toBe(locale[LEAVE_QUESTION]);
      expect(openingSentence(locale[DISCARD_QUESTION]!)).toBe(opening);
    });

    test("no direction marks, and Spanish says tu", () => {
      for (const key of TEXTS) {
        expect(DIRECTION_MARKS.test(locale[key]!)).toBe(false);

        if (language === "es") {
          expect(locale[key]!.toLowerCase()).not.toMatch(
            /\busted\b|\bguarde\b|\brecargue\b/,
          );
        }
      }
    });
  },
);

// ---- drawn: the bar, in the reader's language ------------------------------

const DRAWN_LANGUAGES: ReadonlyArray<string> = ["de", "ar", "ja"];

const PRIMARY: string = "0d750000-0000-4000-8000-000000000003";
const WEEKEND: string = "0d750000-0000-4000-8000-000000000005";

const CHANGES: ScheduleLayersChanges = {
  hasChanges: true,
  isLayerOrderChanged: true,
  deletedLayerIds: [WEEKEND],
  layers: [
    {
      layerId: PRIMARY,
      addedCount: 2,
      removedCount: 1,
      isTurnOrderChanged: true,
    },
  ],
};

const LAYER_NAMES: Record<string, string> = {
  [PRIMARY]: "Primary",
  [WEEKEND]: "Weekend",
};

// The English sentences the bar may show: none may reach a translated page.
const ENGLISH_SENTENCES: ReadonlyArray<string> = [
  "You have unsaved changes",
  "Nothing changes for the people on call until you save.",
  "Layers in a new priority order",
  "will be deleted",
  "users added to",
  "user removed from",
  "New turn order in",
  "more changes",
  "Save changes",
  "Discard",
  "Someone else changed these layers",
  "Your changes were not saved.",
  "Reload layers",
  "Your changes were saved",
  "The page could not load the layers again.",
  "Changes saved",
];

/*
 * A save, or the read after it, that failed in a way the server could not
 * explain: its answer is one English sentence with a reference in it.
 */
const REFERENCE: string = "a1b2c3d4";

// What to do with it, in English: Cloud's words and a self-hosted server's.
const GIVE_THE_REFERENCE: RegExp = /give (them )?this reference/;

const FAILURES_NOBODY_EXPLAINED: ReadonlyArray<LayersSaveStatus> = [
  { kind: "error", message: getUnexplainedServerErrorMessage(REFERENCE) },
  {
    kind: "reloadFailed",
    message: getUnexplainedServerErrorMessage(REFERENCE),
  },
];

function word(language: string, key: string): string {
  const text: string | undefined = readDashboardLocale(language)[key];

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  return withoutIsolateMarks(text as string);
}

function changeLines(language: string): Array<string> {
  return getLayersChangeLines({
    changes: CHANGES,
    getLayerName: (layerId: string): string => {
      return LAYER_NAMES[layerId]!;
    },
    translator: dashboardTranslator(language),
  });
}

function drawBar(language: string, status: LayersSaveStatus): string {
  render(
    <LayersSaveBar
      hasUnsavedChanges={status.kind !== "saved"}
      status={status}
      changeLines={changeLines(language)}
      onSave={() => {}}
      onDiscard={() => {}}
      onReload={() => {}}
    />,
  );

  return withoutIsolateMarks(document.body.textContent || "");
}

function englishShownIn(text: string): Array<string> {
  return ENGLISH_SENTENCES.filter((sentence: string): boolean => {
    return text.includes(sentence);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", ...DRAWN_LANGUAGES].map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

describe("the bar in English, as the control", () => {
  test("names the changes in English - so the checks below would see English if it were left", () => {
    const text: string = drawBar("en", { kind: "idle" });

    expect(changeLines("en")).toEqual([
      "Weekend will be deleted",
      "Layers in a new priority order",
      "2 users added to Primary",
      "1 user removed from Primary",
      "New turn order in Primary",
    ]);
    expect(text).toContain("You have unsaved changes");
    expect(text).toContain("and 2 more changes");
    expect(englishShownIn(text)).toEqual([
      "You have unsaved changes",
      "Nothing changes for the people on call until you save.",
      "Layers in a new priority order",
      "will be deleted",
      "users added to",
      "more changes",
      "Save changes",
      "Discard",
    ]);
  });

  test("a failure nobody explained reads as one anywhere: why, what to do, and the reference to give", () => {
    for (const status of FAILURES_NOBODY_EXPLAINED) {
      const text: string = drawBar("en", status);

      expect(screen.getByTestId("error-explanation")).toBeInTheDocument();
      expect(text).toContain(
        "The server ran into a problem it could not explain.",
      );
      expect(text).toMatch(GIVE_THE_REFERENCE);
      expect(screen.getByTestId("error-reference")).toHaveTextContent(
        REFERENCE,
      );
      // Not the server's one sentence, as it came.
      expect(text).not.toContain(getUnexplainedServerErrorMessage(REFERENCE));
      cleanup();
    }
  });
});

describe.each([...DRAWN_LANGUAGES])(
  "the bar, drawn in %s",
  (language: string) => {
    const translator: () => Translator = (): Translator => {
      return dashboardTranslator(language);
    };

    test("its changes, its count of the rest and its buttons are the language's own", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const text: string = drawBar(language, { kind: "idle" });
      const lines: Array<string> = changeLines(language);

      expect(lines.length).toBe(5);
      for (const line of lines.slice(0, 3)) {
        expect(text).toContain(withoutIsolateMarks(line));
      }
      expect(text).toContain(
        withoutIsolateMarks(
          translator().translatePlural(
            {
              one: "and {{count}} more change",
              other: "and {{count}} more changes",
            },
            2,
          ),
        ),
      );
      expect(text).toContain(word(language, "You have unsaved changes"));
      expect(text).toContain(
        word(
          language,
          "Nothing changes for the people on call until you save.",
        ),
      );
      expect(text).toContain(word(language, "Save changes"));
      expect(text).toContain(word(language, "Discard"));
      expect(
        screen.getByRole("region", {
          name: word(language, "Unsaved changes to the layers"),
        }),
      ).toBeInTheDocument();
      expect(englishShownIn(text)).toEqual([]);
    });

    test("someone else's change: the conflict and Reload layers are the language's own", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const text: string = drawBar(language, { kind: "conflict" });

      expect(text).toContain(
        word(language, "Someone else changed these layers"),
      );
      expect(text).toContain(
        word(
          language,
          "Your changes were not saved. Reload to see the layers as they are now, then make your changes again.",
        ),
      );
      expect(text).toContain(word(language, "Reload layers"));
      expect(englishShownIn(text)).toEqual([]);
    });

    test("saved but not read back, and saved: the language's own", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      const failed: string = drawBar(language, {
        kind: "reloadFailed",
        message: "",
      });

      expect(failed).toContain(word(language, "Your changes were saved"));
      expect(failed).toContain(
        word(
          language,
          "The page could not load the layers again. Reload to keep editing them.",
        ),
      );
      expect(englishShownIn(failed)).toEqual([]);
      cleanup();

      const saved: string = drawBar(language, { kind: "saved" });

      expect(saved).toContain(word(language, "Changes saved"));
      expect(englishShownIn(saved)).toEqual([]);
    });

    test("a failure nobody explained: why, what to do and the reference to give, in the language", async () => {
      await act(async () => {
        await i18next.changeLanguage(language);
      });

      for (const status of FAILURES_NOBODY_EXPLAINED) {
        const text: string = drawBar(language, status);

        expect(screen.getByTestId("error-explanation")).toBeInTheDocument();
        expect(screen.getByTestId("error-reference")).toHaveTextContent(
          REFERENCE,
        );
        expect(text).not.toContain("The server ran into a problem");
        expect(text).not.toMatch(GIVE_THE_REFERENCE);
        expect(englishShownIn(text)).toEqual([]);
        cleanup();
      }
    });
  },
);
