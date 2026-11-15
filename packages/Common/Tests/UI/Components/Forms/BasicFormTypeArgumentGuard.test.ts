import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NO TYPE ARGUMENT ON <BasicForm> IN A TEST (#7538, after #7314).
 *
 * BasicForm is `ForwardRefExoticComponent<any>` (UI/Components/Forms/
 * BasicForm.tsx): a forwardRef component takes no type parameters, so
 * `<BasicForm<JSONObject> ...>` is TS2558, "Expected 0 type arguments, but
 * got 1". Product code would not compile with it, but tests are only
 * type-checked by `npm run compile-tests` (the compile-common job): jest
 * transpiles them without a type check, so the suite passes and Compile
 * turns red for every branch merged with main. It happened twice, in
 * ErrorExplanation.test.tsx (#7314) and DashboardRecordingSources.test.tsx
 * (#7538). Draw it as `<BasicForm ...>`; the form's values are typed where
 * they are read.
 *
 * This reads every test file under packages/Common/Tests, packages/App/Tests
 * and ee/Tests (when the checkout has ee/; CI's Common jobs remove it) and
 * fails on each `<BasicForm<`, with its file and line.
 */

const REPOSITORY: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const TEST_DIRECTORIES: ReadonlyArray<string> = [
  "packages/Common/Tests",
  "packages/App/Tests",
  "ee/Tests",
];

const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(["node_modules", "build"]);

// `<BasicForm` and then a `<`: a type argument, whatever the spacing.
const TYPE_ARGUMENT_ON_BASIC_FORM: RegExp = /<BasicForm\s*</g;

const TEST_FILE: RegExp = /\.(test|spec)\.tsx?$/;

function testFilesUnder(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry.name)) {
        files.push(...testFilesUnder(full));
      }
    } else if (TEST_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// Each `<BasicForm<` in `source`, as "<label>:<line>".
function typeArgumentsOnBasicForm(
  label: string,
  source: string,
): Array<string> {
  const found: Array<string> = [];

  for (const match of Array.from(
    source.matchAll(TYPE_ARGUMENT_ON_BASIC_FORM),
  )) {
    const line: number = source.slice(0, match.index).split("\n").length;
    found.push(`${label}:${line}`);
  }

  return found;
}

describe("a test draws <BasicForm> without a type argument", () => {
  test("BasicForm is still a component that takes none", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPOSITORY,
        "packages/Common/UI/Components/Forms/BasicForm.tsx",
      ),
      "utf8",
    );

    /*
     * If BasicForm ever becomes generic, a type argument is right and this
     * guard should go.
     */
    expect(source).toMatch(
      /const BasicForm: ForwardRefExoticComponent<any> = forwardRef\(/,
    );
  });

  test("finds one, on its line, however it is spaced", () => {
    const source: string = [
      'import BasicForm from "BasicForm";',
      "",
      "render(<BasicForm<JSONObject> fields={[]} />);",
      "render(<BasicForm",
      "  <Values> fields={[]} />);",
    ].join("\n");

    expect(typeArgumentsOnBasicForm("Example.test.tsx", source)).toEqual([
      "Example.test.tsx:3",
      "Example.test.tsx:4",
    ]);
  });

  test("passes a BasicForm without one, and a component whose name only starts the same", () => {
    const source: string = [
      "render(<BasicForm fields={[]} />);",
      "render(<BasicFormStep<JSONObject> step={step} />);",
      "const ref: React.RefObject<BasicFormRef> = useRef(null);",
    ].join("\n");

    expect(typeArgumentsOnBasicForm("Example.test.tsx", source)).toEqual([]);
  });

  test("no test file under packages/Common/Tests, packages/App/Tests or ee/Tests writes <BasicForm<", () => {
    // This file writes the mistake on purpose, to show what is looked for.
    const files: Array<string> = TEST_DIRECTORIES.flatMap(
      (directory: string): Array<string> => {
        return testFilesUnder(path.join(REPOSITORY, directory));
      },
    ).filter((file: string): boolean => {
      return file !== __filename;
    });

    // If the walk found nothing, this would pass by reading nothing.
    expect(
      files.filter((file: string): boolean => {
        return file.includes(`${path.sep}packages${path.sep}Common${path.sep}`);
      }).length,
    ).toBeGreaterThan(1000);
    expect(
      files.filter((file: string): boolean => {
        return file.includes(`${path.sep}packages${path.sep}App${path.sep}`);
      }).length,
    ).toBeGreaterThan(100);

    const found: Array<string> = files.flatMap(
      (file: string): Array<string> => {
        return typeArgumentsOnBasicForm(
          path.relative(REPOSITORY, file),
          fs.readFileSync(file, "utf8"),
        );
      },
    );

    expect(found).toEqual([]);
  });
});
