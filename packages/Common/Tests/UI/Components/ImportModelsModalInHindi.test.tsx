import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import ImportModelsModal from "../../../UI/Components/ImportExport/ImportModelsModal";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
import { JSONObject } from "../../../Types/JSON";
import {
  Translator,
  translateNamedAction,
  translatableTerm,
} from "../../../Types/Translator";
import ModelImportExportUtil, {
  ImportResult,
} from "../../../UI/Utils/ModelImportExport";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * #7310: THE JSON IMPORT DIALOG SAYS आयात IN HINDI, IN EVERY PHASE.
 *
 * Hindi said import two ways - आयात on the Dashboard's Import button, and
 * the English word in Devanagari letters (इम्पोर्ट, इंपोर्ट) elsewhere - and
 * this dialog drew its waiting button (Importing...), its result title
 * (Import Complete) and its result lines in English. It opens from every
 * table that imports a JSON export (monitor groups, templates, rules), in
 * the Dashboard and the Admin Dashboard alike.
 *
 * Rendered through the real dialog and the real Hindi locale file, from
 * the first step to the result: every line says आयात, none says the
 * loanword, and none is left in English. A copy of the locale with one
 * value put back to the loanword, or to English, fails the same check.
 */

// The English word in Devanagari, however it is spelled.
const LOANWORD: RegExp = /इ(?:ं|ँ|म्|म)पोर्ट/u;

// An English import word left on a Hindi screen.
const ENGLISH_IMPORT: RegExp = /\bimport(?:s|ed|ing)?\b/i;

const IMPORT_WORD: string = "आयात";

const HINDI: Record<string, string> = readDashboardLocale("hi");

const MONITOR_GROUPS_JSON: string = JSON.stringify({
  items: [{ name: "Core" }, { name: "Edge" }],
});

const PARSED_ITEMS: Array<JSONObject> = [{ name: "Core" }, { name: "Edge" }];

function hindi(key: string): string {
  const text: string | undefined = HINDI[key];

  expect({ key, worded: Boolean(text) }).toEqual({ key, worded: true });

  return text as string;
}

function modalText(): string {
  return withoutIsolateMarks(screen.getByTestId("modal").textContent || "");
}

function submitButton(): HTMLElement {
  return screen.getByTestId("modal-footer-submit-button");
}

/*
 * What is wrong with a Hindi import screen's words: the loanword, an
 * English import word, or no आयात at all.
 */
function importWordProblems(text: string): Array<string> {
  const problems: Array<string> = [];

  if (LOANWORD.test(text)) {
    problems.push("says the loanword");
  }

  if (ENGLISH_IMPORT.test(text)) {
    problems.push("says import in English");
  }

  if (!text.includes(IMPORT_WORD)) {
    problems.push("never says आयात");
  }

  return problems;
}

interface HeldImport {
  finish: (result: ImportResult) => Promise<void>;
}

/*
 * Opens the dialog, pastes an export and starts the import, which stays
 * running (one of two done) until `finish` hands it a result.
 */
async function startHeldImport(): Promise<HeldImport> {
  let resolveImport: (result: ImportResult) => void = (): void => {};

  jest
    .spyOn(ModelImportExportUtil, "parseImportFileText")
    .mockReturnValue(PARSED_ITEMS);
  jest.spyOn(ModelImportExportUtil, "importItems").mockImplementation(((data: {
    onProgress?: (completedCount: number, totalCount: number) => void;
  }): Promise<ImportResult> => {
    data.onProgress?.(1, 2);

    return new Promise<ImportResult>(
      (resolve: (result: ImportResult) => void) => {
        resolveImport = resolve;
      },
    );
  }) as never);

  render(
    <ImportModelsModal
      modelType={MonitorGroup}
      onClose={() => {}}
      onImportComplete={() => {}}
    />,
  );

  fireEvent.change(screen.getByTestId("code-editor-input"), {
    target: { value: MONITOR_GROUPS_JSON },
  });

  await act(async () => {
    fireEvent.click(submitButton());
  });

  return {
    finish: async (result: ImportResult): Promise<void> => {
      await act(async () => {
        resolveImport(result);
      });
    },
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "hi",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      hi: { translation: { ...HINDI } },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await act(async () => {
    await i18next.changeLanguage("hi");
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the JSON import dialog in Hindi", () => {
  test("the first step: its title, its help and its button say आयात, the export beside it निर्यात", () => {
    render(
      <ImportModelsModal
        modelType={MonitorGroup}
        onClose={() => {}}
        onImportComplete={() => {}}
      />,
    );

    const translator: Translator = dashboardTranslator("hi");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      translateNamedAction(translator, {
        template: "Import {{itemsName}}",
        itemName: "Monitor Groups",
      }),
    );
    expect(screen.getByTestId("modal-title").textContent).toContain(
      IMPORT_WORD,
    );
    expect(submitButton()).toHaveTextContent(hindi("Import"));
    expect(hindi("Import")).toBe("आयात करें");

    // The file it reads is an export, worded as the Export JSON button words it.
    expect(modalText()).toContain("निर्यात की गई JSON फ़ाइल");
    expect(modalText()).toContain(hindi("Select export file"));
    expect(modalText()).not.toMatch(/एक्सपोर्ट/u);

    expect(importWordProblems(modalText())).toEqual([]);
  });

  test("while it runs: the title, the progress and the waiting button say आयात", async () => {
    const held: HeldImport = await startHeldImport();

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      dashboardTranslator("hi").translateTemplate("Importing {{itemsName}}", {
        itemsName: translatableTerm("Monitor Groups"),
      }),
    );
    expect(submitButton()).toHaveTextContent(hindi("Importing..."));
    expect(hindi("Importing...")).toBe("आयात हो रहा है...");
    expect(submitButton()).toBeDisabled();
    expect(modalText()).not.toContain("Importing...");
    expect(importWordProblems(modalText())).toEqual([]);

    await held.finish({ successCount: 2, failures: [] });
  });

  test("the result: Import Complete and its counts say आयात, one and many", async () => {
    const held: HeldImport = await startHeldImport();

    await held.finish({
      successCount: 1,
      failures: [{ itemName: "Edge", errorMessage: "Edge was not saved." }],
    });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      hindi("Import Complete"),
    );
    expect(hindi("Import Complete")).toBe("आयात पूरा हुआ");
    // Worded as the device import's result says it.
    expect(hindi("Import Complete")).toBe(hindi("Import finished"));
    expect(modalText()).toContain("1 मॉनिटर समूह सफलतापूर्वक आयात हुआ।");
    expect(modalText()).toContain("1 मॉनिटर समूह आयात नहीं हो सका।");
    expect(submitButton()).toHaveTextContent(hindi("Close"));

    // The item's own name and its server message stay as they were written.
    expect(modalText()).toContain("Edge was not saved.");
    expect(
      importWordProblems(modalText().replace("Edge was not saved.", "")),
    ).toEqual([]);
  });

  test("the result, many of each: the plural sentences", async () => {
    const held: HeldImport = await startHeldImport();

    await held.finish({
      successCount: 3,
      failures: [
        { itemName: "Edge", errorMessage: "first" },
        { itemName: "Core", errorMessage: "second" },
      ],
    });

    expect(modalText()).toContain("3 मॉनिटर समूह सफलतापूर्वक आयात हुए।");
    expect(modalText()).toContain("2 मॉनिटर समूह आयात नहीं हो सके।");
    expect(importWordProblems(modalText())).toEqual([]);
  });

  test("English reads as before (English parity)", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });

    const held: HeldImport = await startHeldImport();

    expect(submitButton()).toHaveTextContent("Importing...");

    await held.finish({ successCount: 2, failures: [] });

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Import Complete",
    );
    expect(modalText()).toContain("2 monitor groups imported successfully.");
  });
});

describe("the check fails a dialog that says another word (negative control)", () => {
  test.each([
    ["Import Complete", "इम्पोर्ट पूरा हुआ", "says the loanword"],
    ["Import Complete", "Import Complete", "says import in English"],
    ["Import Complete", "पूरा हुआ", "never says आयात"],
  ])(
    "%s put back to %s: the result title %s",
    async (key: string, text: string, problem: string) => {
      i18next.addResource("hi", "translation", key, text);

      try {
        const held: HeldImport = await startHeldImport();

        await held.finish({ successCount: 0, failures: [] });

        const title: string =
          screen.getByTestId("modal-title").textContent || "";

        expect(title).toBe(text);
        expect(importWordProblems(title)).toContain(problem);
      } finally {
        i18next.addResource("hi", "translation", key, hindi(key));
      }
    },
  );

  test("Importing... put back to the loanword: the waiting dialog fails", async () => {
    i18next.addResource(
      "hi",
      "translation",
      "Importing...",
      "इंपोर्ट हो रहा है...",
    );

    try {
      const held: HeldImport = await startHeldImport();

      expect(importWordProblems(modalText())).toEqual(["says the loanword"]);

      await held.finish({ successCount: 2, failures: [] });
    } finally {
      i18next.addResource(
        "hi",
        "translation",
        "Importing...",
        hindi("Importing..."),
      );
    }
  });

  test("the check reads the loanword however it is spelled, and not important", () => {
    for (const text of [
      "इम्पोर्ट",
      "इंपोर्ट",
      "इँपोर्ट",
      "इमपोर्ट",
      "इंपोर्ट्स",
    ]) {
      expect({ text, loanword: LOANWORD.test(text) }).toEqual({
        text,
        loanword: true,
      });
    }

    expect(ENGLISH_IMPORT.test("Important: आयात")).toBe(false);
    expect(importWordProblems("आयात पूरा हुआ")).toEqual([]);
  });
});
