import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import ts from "typescript";
import { listSourceFiles, toRelativePath } from "../ForeignHiddenRuleGuard";

/*
 * Every file of Common's component library holds code: a component, or
 * something one is built from.
 *
 * Two held nothing at all - Forms/WizardForm.tsx and
 * Header/HeaderIconDropdown/HeaderIconDropdown.tsx - and nothing imported
 * either. A name in the library with nothing behind it reads as a component
 * that exists: the guided website setup (#7004) built a step frame of its
 * own beside an empty WizardForm. Both are gone (#7058).
 *
 * This reads every .ts and .tsx file under Common/UI/Components through the
 * TypeScript parser and fails on one with no statement: empty, white space,
 * or comments alone.
 */

const COMPONENTS_DIRECTORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "UI",
  "Components",
);

// The empty files #7058 found, relative to Common/UI/Components.
const REMOVED_EMPTY_FILES: ReadonlyArray<string> = [
  "Forms/WizardForm.tsx",
  "Header/HeaderIconDropdown/HeaderIconDropdown.tsx",
];

// Whether a source file holds no code: no statement, whatever its comments.
function holdsNoCode(fileName: string, text: string): boolean {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  return source.statements.length === 0;
}

function emptyFilesIn(directory: string): Array<string> {
  return listSourceFiles(directory)
    .filter((file: string): boolean => {
      return holdsNoCode(file, fs.readFileSync(file, "utf8"));
    })
    .map((file: string): string => {
      return toRelativePath(directory, file);
    })
    .sort();
}

describe("Common's component library", () => {
  test("no .ts or .tsx file in it is empty", () => {
    // A scan that read nothing would pass anything.
    expect(listSourceFiles(COMPONENTS_DIRECTORY).length).toBeGreaterThan(500);
    expect(emptyFilesIn(COMPONENTS_DIRECTORY)).toEqual([]);
  });

  test("the empty files #7058 found are gone", () => {
    for (const file of REMOVED_EMPTY_FILES) {
      expect([
        file,
        fs.existsSync(path.join(COMPONENTS_DIRECTORY, file)),
      ]).toEqual([file, false]);
    }

    // The folder that held only the empty dropdown went with it.
    expect(
      fs.existsSync(
        path.join(COMPONENTS_DIRECTORY, "Header", "HeaderIconDropdown"),
      ),
    ).toBe(false);
  });
});

describe("the guard's own proof", () => {
  test("an empty file, white space or comments alone hold no code", () => {
    expect(holdsNoCode("Empty.tsx", "")).toBe(true);
    expect(holdsNoCode("Blank.tsx", "\n  \t\n\n")).toBe(true);
    expect(
      holdsNoCode(
        "Comments.ts",
        "// A wizard, one day.\n/*\n * Steps go here.\n */\n",
      ),
    ).toBe(true);
  });

  test("a component, a type or a bare export holds code", () => {
    expect(
      holdsNoCode(
        "Card.tsx",
        "const Card = (): JSX.Element => <div />;\nexport default Card;\n",
      ),
    ).toBe(false);
    expect(
      holdsNoCode("Types.ts", "export type Step = { id: string };\n"),
    ).toBe(false);
    expect(holdsNoCode("Module.ts", "export {};\n")).toBe(false);
  });

  test("finds an empty file in a library, by its path in it, and skips node_modules", () => {
    const library: string = fs.mkdtempSync(
      path.join(os.tmpdir(), "oneuptime-empty-components-"),
    );

    try {
      const write: (file: string, text: string) => void = (
        file: string,
        text: string,
      ): void => {
        fs.mkdirSync(path.dirname(path.join(library, file)), {
          recursive: true,
        });
        fs.writeFileSync(path.join(library, file), text);
      };

      write("Forms/BasicForm.tsx", "export default function Form() {}\n");
      write("Forms/WizardForm.tsx", "");
      write("Header/Dropdown/Dropdown.tsx", "  \n// Nothing yet.\n");
      write("Types/Step.ts", "export interface Step { id: string }\n");
      write("node_modules/lib/Empty.ts", "");

      expect(emptyFilesIn(library)).toEqual([
        "Forms/WizardForm.tsx",
        "Header/Dropdown/Dropdown.tsx",
      ]);
    } finally {
      fs.rmSync(library, { recursive: true, force: true });
    }
  });
});
