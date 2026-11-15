import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * EVERY NAME AND COLUMN TITLE OF THE DATA OBSERVABILITY, DATA SECURITY AND
 * DATABASE MODELS, IN EVERY LANGUAGE (#8519).
 *
 * A model's names and its columns' titles are keys of the Dashboard's
 * locales (the i18n extractor reads them from the model files), drawn
 * wherever the Dashboard names a model's own columns rather than a page's:
 * a form's permission error ("You don't have enough permissions to edit
 * {{columnName}} ..."), Reset ID's dialog, Select items by, audit log
 * entries, the workflow builder's model steps. #8344 worded the related
 * Data Observability names; 108 more titles of these models - Last Run
 * Status, Upstream Table, Database Engine, Data Source Type, ... - kept
 * their English in 10 to 15 of the 17 languages.
 *
 * Each is worded now, and a new name or column title of these models is
 * worded the day it is added: this reads the model files as the extractor
 * does. A title a language writes as English on purpose ("Slug", "SLA")
 * is on its same-as-English list, which counts as worded.
 */

const MODELS_DIR: string = path.resolve(
  __dirname,
  "../../../Models/DatabaseModels",
);

// The Data Observability, Data Security, data source and Database models.
const MODEL_FILE: RegExp = /^(Data|Database|Dbt)[A-Za-z]*\.ts$/;

// A model's names, and a column's title: what the extractor reads of a model.
const NAME_OR_TITLE: RegExp =
  /\b(?:singularName|pluralName|title):\s*"([^"\\]+)"/g;

function modelFiles(): Array<string> {
  return fs
    .readdirSync(MODELS_DIR)
    .filter((file: string): boolean => {
      return MODEL_FILE.test(file);
    })
    .sort();
}

// Every name and title the files declare, each once, with a file that declares it.
function namesAndTitles(): Map<string, string> {
  const found: Map<string, string> = new Map<string, string>();

  for (const file of modelFiles()) {
    const source: string = fs.readFileSync(path.join(MODELS_DIR, file), "utf8");

    for (const match of source.matchAll(NAME_OR_TITLE)) {
      const text: string = match[1] as string;

      if (!found.has(text)) {
        found.set(text, file);
      }
    }
  }

  return found;
}

// The languages that leave a key unworded.
function languagesLeavingUnworded(key: string): Array<string> {
  return DASHBOARD_LANGUAGES.filter((language: string): boolean => {
    return !isWordedInDashboardLocale(key, language);
  });
}

describe("the Data Observability, Data Security and Database models' words", () => {
  test("are read from the models they come from", () => {
    const files: Array<string> = modelFiles();

    for (const model of [
      "DataAlert.ts",
      "DataAsset.ts",
      "DataPipeline.ts",
      "DataReconciliation.ts",
      "DataStore.ts",
      "DataSource.ts",
      "DatabaseServer.ts",
    ]) {
      expect(files).toContain(model);
    }

    const words: Map<string, string> = namesAndTitles();

    // A name, and a title of each kind: an ID column, a time, a relation.
    for (const word of [
      "Data Pipeline Run",
      "Last Run Status",
      "Upstream Table ID",
      "Table Health Collected At",
      "Database Engine",
      "Data Source Type",
    ]) {
      expect({ word, found: words.has(word) }).toEqual({ word, found: true });
    }
  });

  test("are each a key of the Dashboard's English file, which reads it as written", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const [word, file] of namesAndTitles()) {
      expect({ word, file, english: english[word] }).toEqual({
        word,
        file,
        english: word,
      });
    }
  });

  test("are each worded in every language the Dashboard is read in", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    const unworded: Array<string> = [];

    for (const [word, file] of namesAndTitles()) {
      const languages: Array<string> = languagesLeavingUnworded(word);

      if (languages.length > 0) {
        unworded.push(`${word} (${file}): ${languages.join(", ")}`);
      }
    }

    // Each listed here reads English in those languages: word it.
    expect(unworded).toEqual([]);
  });

  test.each([
    ["de", "Last Run Status", "Status der letzten Ausführung"],
    ["de", "Upstream Table", "Vorgelagerte Tabelle"],
    ["fr", "Downstream Table", "Table en aval"],
    ["es", "Source Measure", "Medida del origen"],
    ["ja", "Table Health Status", "テーブル収集のステータス"],
    ["it", "Database Engine", "Motore del database"],
    ["zh-CN", "Data Source Type", "数据源类型"],
    ["ru", "Last Run Duration", "Длительность последнего запуска"],
  ])(
    "in %s, %s reads %s",
    (language: string, key: string, expected: string) => {
      expect(readDashboardLocale(language)[key]).toBe(expected);
    },
  );

  /*
   * A reconciliation's two sides read as its page's Source and Target:
   * German "Quelle" and "Ziel", Spanish "Origen" and "Destino".
   */
  test("a reconciliation's two sides are named as its page names them, in every language", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      if (["ar", "fa"].includes(language)) {
        continue;
      }

      const words: Record<string, string> = readDashboardLocale(language);
      const stemOf: (word: string) => string = (word: string): string => {
        return Array.from(word.toLocaleLowerCase(language))
          .slice(0, 3)
          .join("");
      };

      for (const [key, side] of [
        ["Source Value", "Source"],
        ["Source Column", "Source"],
        ["Target Column", "Target"],
        ["Target Measure", "Target"],
      ]) {
        expect({
          language,
          key,
          namesItsSide: (words[key as string] || "")
            .toLocaleLowerCase(language)
            .includes(stemOf(words[side as string] || "?")),
        }).toEqual({ language, key, namesItsSide: true });
      }
    }
  });

  test("a word a language writes as English on purpose is on its same-as-English list: Slug", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        worded: isWordedInDashboardLocale("Slug", language),
      }).toEqual({ language, worded: true });
    }
  });

  test("the check above catches a title a language leaves English (negative control)", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const worded: string = german["Last Run Status"]!;

    try {
      german["Last Run Status"] = "Last Run Status";
      expect(languagesLeavingUnworded("Last Run Status")).toEqual(["de"]);
    } finally {
      german["Last Run Status"] = worded;
    }

    expect(languagesLeavingUnworded("Last Run Status")).toEqual([]);
  });
});
