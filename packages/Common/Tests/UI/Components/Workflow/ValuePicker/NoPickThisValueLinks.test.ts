import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Please make this easy to use and not have things like 'Pick value from
 * other component or from variable'" - the maintainer, on the Log step.
 *
 * Every setting has the value picker in it now, and the footer links - with
 * the two dialogs behind them - are gone. This keeps them gone: no source
 * that draws the product says it again, and the dialogs do not come back.
 */

const PACKAGES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const SCAN_ROOTS: Array<string> = [
  "Common/UI",
  "App/FeatureSet/Dashboard/src",
  "App/FeatureSet/AdminDashboard/src",
];

// The footer's words, in any case, as they were or nearly.
const FOOTER_WORDS: RegExp =
  /pick (this )?value from (an )?other (component|step)|or from variable/i;

const SOURCE_FILE: RegExp = /\.(tsx?|ejs)$/;

type WalkFunction = (directory: string) => Array<string>;

const walk: WalkFunction = (directory: string): Array<string> => {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "node_modules" ? [] : walk(full);
      }

      return SOURCE_FILE.test(entry.name) ? [full] : [];
    });
};

type CodeOfFunction = (file: string) => string;

// What a file draws or says, without its comments (which may quote the past).
const codeOf: CodeOfFunction = (file: string): string => {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ");
};

describe("the 'Pick this value' links are gone for good", () => {
  const files: Array<string> = SCAN_ROOTS.flatMap((root: string) => {
    return walk(path.join(PACKAGES_DIR, root));
  });

  test("the scan reaches the workflow builder", () => {
    expect(
      files.some((file: string) => {
        return file.endsWith(path.join("Workflow", "ArgumentsForm.tsx"));
      }),
    ).toBe(true);
  });

  test("no product source says them", () => {
    const offenders: Array<string> = files
      .filter((file: string) => {
        return FOOTER_WORDS.test(codeOf(file));
      })
      .map((file: string) => {
        return path.relative(PACKAGES_DIR, file);
      });

    expect(offenders).toEqual([]);
  });

  test("the two dialogs behind them are gone", () => {
    for (const removed of [
      "Common/UI/Components/Workflow/ComponentValuePickerModal.tsx",
      "Common/UI/Components/Workflow/VariableModal.tsx",
    ]) {
      expect(fs.existsSync(path.join(PACKAGES_DIR, removed))).toBe(false);
    }
  });

  test("a step's settings put nothing under their fields", () => {
    const argumentsForm: string = codeOf(
      path.join(PACKAGES_DIR, "Common/UI/Components/Workflow/ArgumentsForm.tsx"),
    );

    expect(argumentsForm).not.toContain("footerElement");
    expect(argumentsForm).toContain("ValuePickerProvider");
  });
});
