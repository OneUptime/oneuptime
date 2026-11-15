import { describe, expect, test } from "@jest/globals";
import DataAlert from "../../../Models/DatabaseModels/DataAlert";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataAssetFeed from "../../../Models/DatabaseModels/DataAssetFeed";
import DataAssetLineage from "../../../Models/DatabaseModels/DataAssetLineage";
import DataAssetUsage from "../../../Models/DatabaseModels/DataAssetUsage";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataPipelineRun from "../../../Models/DatabaseModels/DataPipelineRun";
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

/*
 * THE RELATED MODELS' NAMES, AND THEIR ID COLUMNS (#8344).
 *
 * #7533 worded the six names a Create button or a dialog draws. The less
 * visible names of the same models - a table's feed, its usage and lineage,
 * a pipeline's runs, a data alert - and the ID columns that relate a record
 * to a table, a pipeline or a reconciliation kept their English in 15
 * languages (Arabic and Persian worded them): an audit log's resource
 * types, the workflow builder's model steps, exports and generic forms
 * named them in English on a German page. Each is worded now as the
 * language's side menu names the thing it belongs to: German "Pipeline-
 * Ausführung" beside the pipeline page's "Ausführungen", "Tabellen-ID".
 */
describe("the related models' names and their ID columns (#8344)", () => {
  interface RelatedName {
    key: string;
    // The model's own name for the thing the name belongs to.
    parentKey: string;
  }

  const RELATED: ReadonlyArray<RelatedName> = [
    { key: "Data Alert", parentKey: "Alert" },
    { key: "Data Alerts", parentKey: "Alert" },
    { key: "Data Asset Feed", parentKey: "Data Asset" },
    { key: "Data Asset Feeds", parentKey: "Data Asset" },
    { key: "Data Asset Feed Event", parentKey: "Data Asset" },
    { key: "Data Asset Usage", parentKey: "Data Asset" },
    { key: "Data Asset Usages", parentKey: "Data Asset" },
    { key: "Data Asset Lineage", parentKey: "Data Asset" },
    { key: "Data Pipeline Run", parentKey: "Data Pipeline" },
    { key: "Data Pipeline Runs", parentKey: "Data Pipeline" },
    { key: "Data Asset ID", parentKey: "Data Asset" },
    { key: "Data Pipeline ID", parentKey: "Data Pipeline" },
    { key: "Data Reconciliation ID", parentKey: "Data Reconciliation" },
    { key: "Table ID", parentKey: "Table (database object)" },
  ];

  // The first letters of a word, which its forms in a name share: "tabe" in "Tabellen-ID".
  function stemOf(word: string, language: string): string {
    return Array.from(word.toLocaleLowerCase(language)).slice(0, 4).join("");
  }

  test.each([
    [DataAlert, "Data Alert", "Data Alerts"],
    [DataAssetFeed, "Data Asset Feed", "Data Asset Feeds"],
    [DataAssetUsage, "Data Asset Usage", "Data Asset Usages"],
    [DataAssetLineage, "Data Asset Lineage", "Data Asset Lineage"],
    [DataPipelineRun, "Data Pipeline Run", "Data Pipeline Runs"],
  ])(
    "%p names itself %j and %j",
    (modelType: { new (): BaseModel }, singular: string, plural: string) => {
      const record: BaseModel = new modelType();

      expect(record.singularName).toBe(singular);
      expect(record.pluralName).toBe(plural);
    },
  );

  test("each is a key of the Dashboard's English file, which reads it as written", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const name of RELATED) {
      expect({ key: name.key, english: english[name.key] }).toEqual({
        key: name.key,
        english: name.key,
      });
    }
  });

  test("none is left English in any of the 17 languages", () => {
    for (const name of RELATED) {
      expect({
        key: name.key,
        unworded: languagesLeavingUnworded(name.key),
      }).toEqual({ key: name.key, unworded: [] });
    }
  });

  test("each names the thing it belongs to as the language names it, in every language that left it English", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      if (WORDED_BEFORE.includes(language)) {
        continue;
      }

      const words: Record<string, string> = readDashboardLocale(language);

      for (const name of RELATED) {
        const parent: string = words[name.parentKey]!;

        expect({
          language,
          key: name.key,
          namesItsParent: (words[name.key] || "")
            .toLocaleLowerCase(language)
            .includes(stemOf(parent, language)),
        }).toEqual({ language, key: name.key, namesItsParent: true });
      }
    }
  });

  test.each([
    [
      "de",
      {
        "Data Pipeline Run": "Pipeline-Ausführung",
        "Data Pipeline Runs": "Pipeline-Ausführungen",
        "Data Asset Feed": "Tabellen-Feed",
        "Data Asset ID": "Tabellen-ID",
        "Data Pipeline ID": "Pipeline-ID",
        "Data Reconciliation ID": "Abgleichs-ID",
        "Data Alert": "Datenwarnung",
      },
    ],
    [
      "fr",
      {
        "Data Pipeline Run": "Exécution de pipeline",
        "Data Asset Feed": "Fil d'activité de la table",
        "Data Asset ID": "ID de table",
        "Table ID": "ID de table",
      },
    ],
    [
      "es",
      {
        "Data Pipeline Run": "Ejecución de la canalización",
        "Data Asset Lineage": "Linaje de la tabla",
        "Data Asset ID": "ID de la tabla",
      },
    ],
    [
      "ja",
      {
        "Data Pipeline Run": "パイプラインの実行",
        "Data Asset ID": "テーブル ID",
        "Data Reconciliation ID": "照合 ID",
      },
    ],
    [
      "zh-CN",
      {
        "Data Pipeline Runs": "管道运行",
        "Data Asset Lineage": "表血缘",
        "Table ID": "表 ID",
      },
    ],
  ])("in %s: %j", (language: string, expected: Record<string, string>) => {
    const words: Record<string, string> = readDashboardLocale(language);

    for (const [key, word] of Object.entries(expected)) {
      expect({ key, drawn: words[key] }).toEqual({ key, drawn: word });
    }
  });

  test("a table's ID reads alike wherever a column names it: Table ID and Data Asset ID", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      if (WORDED_BEFORE.includes(language)) {
        continue;
      }

      const words: Record<string, string> = readDashboardLocale(language);

      expect({ language, same: words["Data Asset ID"] }).toEqual({
        language,
        same: words["Table ID"],
      });
    }
  });

  test("Arabic and Persian keep the names they gave before", () => {
    expect(readDashboardLocale("ar")["Data Pipeline Run"]).toBe(
      "تشغيل مسار البيانات",
    );
    expect(readDashboardLocale("fa")["Data Asset ID"]).toBe(
      "شناسه دارایی داده",
    );
  });

  test("the check above catches a related name a language leaves English (negative control)", () => {
    const french: Record<string, string> = readDashboardLocale("fr");
    const worded: string = french["Data Pipeline Run"]!;

    try {
      french["Data Pipeline Run"] = "Data Pipeline Run";
      expect(languagesLeavingUnworded("Data Pipeline Run")).toEqual(["fr"]);
    } finally {
      french["Data Pipeline Run"] = worded;
    }

    expect(languagesLeavingUnworded("Data Pipeline Run")).toEqual([]);
  });

  test("German: a pipeline run's Delete reads in German, its name as the pipeline page says it", () => {
    expect(
      translateNamedAction(dashboardTranslator("de"), {
        template: "Delete {{itemName}}",
        itemName: "Data Pipeline Run",
      }),
    ).toBe("Pipeline-Ausführung löschen");
  });
});
