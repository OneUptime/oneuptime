import { describe, expect, test } from "@jest/globals";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataReconciliation from "../../../Models/DatabaseModels/DataReconciliation";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { translateNamedAction, Translator } from "../../../Types/Translator";
import { translateCreateAction } from "../../../UI/Components/ModelTable/BaseModelTable";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * DATA OBSERVABILITY'S MODELS, BY THE NAMES ITS SIDE MENU GIVES THEM (#7533).
 *
 * A model's singular and plural names are drawn wherever the product names
 * the model in a sentence: a list's Create button, a delete dialog's
 * question, an empty list. Data Asset, Data Reconciliation and Data Pipeline
 * kept their English names in 15 of the Dashboard's 17 languages (Arabic and
 * Persian worded them), so the German Reconciliations card, titled
 * "Abgleiche" like its side menu entry, offered "Data Reconciliation
 * erstellen".
 *
 * Each now reads as the side menu names the thing: a data asset is one of
 * the Tables (a table, a view or a collection) - "Tabelle" beside the
 * menu's "Tabellen"; a reconciliation is a "Abgleich" beside "Abgleiche";
 * a pipeline is a "Pipeline" beside "Pipelines".
 */

interface ModelName {
  // The model's own key: its singularName or pluralName.
  key: string;
  // The Dashboard key the side menu, a card or a form names the same thing with.
  menuKey: string;
}

const NAMES: ReadonlyArray<ModelName> = [
  { key: "Data Asset", menuKey: "Table (database object)" },
  { key: "Data Assets", menuKey: "Tables" },
  { key: "Data Reconciliation", menuKey: "Reconciliation" },
  { key: "Data Reconciliations", menuKey: "Reconciliations" },
  { key: "Data Pipeline", menuKey: "Pipeline" },
  { key: "Data Pipelines", menuKey: "Pipelines" },
];

// The two languages that worded the names before #7533, each its own way.
const WORDED_BEFORE: ReadonlyArray<string> = ["ar", "fa"];

function languagesLeavingUnworded(key: string): Array<string> {
  return DASHBOARD_LANGUAGES.filter((language: string): boolean => {
    return !isWordedInDashboardLocale(key, language);
  });
}

describe("the names are the models' own", () => {
  test.each([
    [DataAsset, "Data Asset", "Data Assets"],
    [DataReconciliation, "Data Reconciliation", "Data Reconciliations"],
    [DataPipeline, "Data Pipeline", "Data Pipelines"],
  ])(
    "%p names itself %j and %j",
    (modelType: { new (): BaseModel }, singular: string, plural: string) => {
      const model: BaseModel = new modelType();

      expect(model.singularName).toBe(singular);
      expect(model.pluralName).toBe(plural);
    },
  );

  test("each is a key of the Dashboard's English file, which reads it as written", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const name of NAMES) {
      expect(english[name.key]).toBe(name.key);
      expect(english[name.menuKey]).toBeDefined();
    }
  });
});

describe("every language words each name", () => {
  test("none is left English in any of the 17 languages", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    for (const name of NAMES) {
      expect({
        key: name.key,
        unworded: languagesLeavingUnworded(name.key),
      }).toEqual({ key: name.key, unworded: [] });
    }
  });

  test("each reads as the side menu names the thing, in every language that left it English", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      if (WORDED_BEFORE.includes(language)) {
        continue;
      }

      const words: Record<string, string> = readDashboardLocale(language);

      for (const name of NAMES) {
        expect({ language, key: name.key, drawn: words[name.key] }).toEqual({
          language,
          key: name.key,
          drawn: words[name.menuKey],
        });
      }
    }
  });

  test("Arabic and Persian keep the names they gave before", () => {
    expect(readDashboardLocale("ar")["Data Reconciliation"]).toBe(
      "مطابقة البيانات",
    );
    expect(readDashboardLocale("fa")["Data Pipelines"]).toBe(
      "خط لوله‌های داده",
    );
  });

  test.each([
    [
      "de",
      "Tabelle",
      "Tabellen",
      "Abgleich",
      "Abgleiche",
      "Pipeline",
      "Pipelines",
    ],
    [
      "fr",
      "Table",
      "Tables",
      "Rapprochement",
      "Rapprochements",
      "Pipeline",
      "Pipelines",
    ],
    [
      "es",
      "Tabla",
      "Tablas",
      "Conciliación",
      "Conciliaciones",
      "Canalización",
      "Canalizaciones",
    ],
    [
      "ja",
      "テーブル",
      "テーブル",
      "照合",
      "照合",
      "パイプライン",
      "パイプライン",
    ],
    ["zh-TW", "資料表", "資料表", "對帳", "對帳", "管道", "管道"],
  ])(
    "in %s: %s, %s, %s, %s, %s, %s",
    (
      language: string,
      asset: string,
      assets: string,
      reconciliation: string,
      reconciliations: string,
      pipeline: string,
      pipelines: string,
    ) => {
      const words: Record<string, string> = readDashboardLocale(language);

      expect([
        words["Data Asset"],
        words["Data Assets"],
        words["Data Reconciliation"],
        words["Data Reconciliations"],
        words["Data Pipeline"],
        words["Data Pipelines"],
      ]).toEqual([
        asset,
        assets,
        reconciliation,
        reconciliations,
        pipeline,
        pipelines,
      ]);
    },
  );

  test("where English is right - Pipelines in German - the name is still the language's own, never the English model name", () => {
    for (const language of ["de", "fr", "nl", "da", "no", "sv", "pt"]) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect({ language, drawn: words["Data Pipelines"] }).toEqual({
        language,
        drawn: "Pipelines",
      });
      expect(isWordedInDashboardLocale("Data Pipelines", language)).toBe(true);
    }
  });

  test("the check above catches a name a language leaves English (negative control)", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const worded: string = german["Data Reconciliation"]!;

    try {
      german["Data Reconciliation"] = "Data Reconciliation";
      expect(languagesLeavingUnworded("Data Reconciliation")).toEqual(["de"]);
    } finally {
      german["Data Reconciliation"] = worded;
    }

    expect(languagesLeavingUnworded("Data Reconciliation")).toEqual([]);
  });
});

describe("in a sentence", () => {
  // The Create button of a list, as ModelTable writes it.
  function createButton(language: string, singularName: string): string {
    return translateCreateAction(dashboardTranslator(language), {
      itemName: singularName,
    });
  }

  // A row's Delete, as the table's ⋯ menu and its dialog name it.
  function deleteAction(language: string, singularName: string): string {
    const translator: Translator = dashboardTranslator(language);

    return translateNamedAction(translator, {
      template: "Delete {{itemName}}",
      itemName: singularName,
    });
  }

  test("German: the Reconciliations card offers Abgleich erstellen, as its title says Abgleiche", () => {
    expect(createButton("de", "Data Reconciliation")).toBe(
      "Abgleich erstellen",
    );
  });

  test("German: a pipeline and a table are deleted by the names the menu gives them", () => {
    expect(deleteAction("de", "Data Pipeline")).toBe("Pipeline löschen");
    expect(deleteAction("de", "Data Asset")).toBe("Tabelle löschen");
    expect(createButton("fr", "Data Reconciliation")).not.toContain(
      "Reconciliation",
    );
  });

  test("no language's Create button keeps an English model name", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const name of [
        "Data Asset",
        "Data Reconciliation",
        "Data Pipeline",
      ]) {
        expect({ language, button: createButton(language, name) }).not.toEqual({
          language,
          button: expect.stringContaining(name),
        });
      }
    }
  });

  test("English reads every name exactly as before", () => {
    expect(createButton("en", "Data Reconciliation")).toBe(
      "Create Data Reconciliation",
    );
    expect(createButton("en", "Data Asset")).toBe("Create Data Asset");
    expect(createButton("en", "Data Pipeline")).toBe("Create Data Pipeline");
    expect(deleteAction("en", "Data Asset")).toBe("Delete Data Asset");
  });
});
