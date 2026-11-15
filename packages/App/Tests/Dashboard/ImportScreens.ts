import fs from "fs";
import path from "path";
import {
  ExtractedString,
  scanSourceText,
} from "../../FeatureSet/Dashboard/scripts/i18n/ExtractStrings";

/*
 * The screens a reader imports from (#7310, #7957), each file that draws
 * their words, and the keys those files draw - for the suites that hold
 * the screens whole in a language (HindiImportScreensWhole,
 * ImportScreensInEveryLanguage).
 */

const PACKAGES: string = path.resolve(__dirname, "../../..");

export const IMPORT_SCREENS: ReadonlyArray<string> = [
  // Any model's JSON import and export (monitor groups, status pages...).
  "Common/UI/Components/ImportExport/ImportModelsModal.tsx",
  "Common/UI/Components/ImportExport/ExportModelCard.tsx",
  "Common/UI/Components/CodeEditor/CodeEditor.tsx",
  // The label rule import (alert, incident, monitor... label rules).
  "Common/UI/Components/LabelRule/ImportLabelRulesModal.tsx",
  "Common/UI/Components/LabelRule/LabelRuleTable.tsx",
  // The CSV upload of the site and status page group imports.
  "Common/UI/Components/CSVFileUpload/CSVFileUpload.tsx",
  // Network > Settings > Auto Import Rules, its form and its run dialog.
  "App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AutoImportRules.tsx",
  "App/FeatureSet/Dashboard/src/Components/NetworkAutomation/RunAutoImportRuleModal.tsx",
];

// The JSON import's files, which the Admin Dashboard draws too.
export const SHARED_WITH_ADMIN: ReadonlyArray<string> = [
  "Common/UI/Components/ImportExport/ImportModelsModal.tsx",
  "Common/UI/Components/CodeEditor/CodeEditor.tsx",
];

function scan(file: string): Array<ExtractedString> {
  return scanSourceText(
    path.join("packages", file),
    fs.readFileSync(path.join(PACKAGES, file), "utf8"),
    { kind: "ui" },
  ).strings as Array<ExtractedString>;
}

// Every key the files draw, with the "one" form of a plural.
export function keysOf(files: ReadonlyArray<string>): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const file of files) {
    for (const entry of scan(file)) {
      keys.add(entry.text);

      if (entry.pluralOne) {
        keys.add(`${entry.text}_one`);
      }
    }
  }

  return Array.from(keys).sort();
}
