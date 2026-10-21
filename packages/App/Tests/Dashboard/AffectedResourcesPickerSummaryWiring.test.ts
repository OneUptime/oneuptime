import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A wizard with a summary step prints every field it holds. The affected
 * resources picker writes bare IDs into the form, so a picker field with no
 * summary element of its own falls through to the generic summary, which
 * printed those IDs raw: Create Alert's "Other Affected Resources" row was a
 * comma-joined list of host UUIDs, and the Kubernetes clusters, Docker and
 * Podman hosts and services picked with it did not appear at all (they are
 * hidden registrations, which the summary skips).
 *
 * How the picker names bare IDs is covered where it can render:
 *   Common/Tests/App/Dashboard/AffectedResourcesPicker.test.tsx
 *   Common/Tests/App/Dashboard/AffectedResourcesPickerEditForm.test.tsx
 * This App suite has no renderer, so the wiring is pinned by reading the
 * sources (comment-stripped, whitespace-squashed). The checks scan every
 * summary-enabled form rather than pinning one page.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
// A `//` that is not part of a URL (`https://`) or inside a quote.
const LINE_COMMENT_PATTERN: RegExp = /(^|[^:"'`])\/\/.*$/gm;
const WHITESPACE_PATTERN: RegExp = /\s+/g;

function normalizeSource(text: string): string {
  return text
    .replace(BLOCK_COMMENT_PATTERN, " ")
    .replace(LINE_COMMENT_PATTERN, "$1 ")
    .replace(WHITESPACE_PATTERN, " ");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];
  const sourceFilePattern: RegExp = /\.tsx$/;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (sourceFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

interface PickerField {
  file: string;
  // The whole file, to resolve a list the picker is given by name.
  source: string;
  // The whole field object literal the picker is rendered from.
  fieldSource: string;
}

/*
 * The object literal around `index`: walk back to the first `{` left open,
 * then forward to the `}` that closes it. JSX expressions and template
 * literals keep their braces balanced, which is all this needs.
 */
function enclosingObject(source: string, index: number): string {
  let depth: number = 0;
  let start: number = -1;
  for (let i: number = index; i >= 0; i--) {
    const char: string = source[i]!;
    if (char === "}") {
      depth++;
    } else if (char === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) {
    throw new Error("No enclosing object found");
  }

  depth = 0;
  for (let i: number = start; i < source.length; i++) {
    const char: string = source[i]!;
    if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  throw new Error("Unbalanced object literal");
}

/*
 * Every form field whose editor is the picker: a `<AffectedResourcesPicker`
 * whose nearest preceding render hook is `getCustomElement` (a picker inside
 * `getSummaryElement` is a summary, not an editor).
 */
function pickerEditorFields(file: string, source: string): Array<PickerField> {
  const fields: Array<PickerField> = [];
  let from: number = 0;
  for (;;) {
    const at: number = source.indexOf("<AffectedResourcesPicker", from);
    if (at < 0) {
      break;
    }
    from = at + 1;
    const editorHook: number = source.lastIndexOf("getCustomElement:", at);
    const summaryHook: number = source.lastIndexOf("getSummaryElement:", at);
    if (editorHook < 0 || summaryHook > editorHook) {
      continue;
    }
    fields.push({
      file,
      source,
      fieldSource: enclosingObject(source, editorHook),
    });
  }
  return fields;
}

function isSummaryEnabled(source: string): boolean {
  return source.includes("summary={{ enabled: true");
}

/*
 * The resource types a picker element is given: an inline array, or the
 * name of an array constant declared in the same file - how a page shares
 * one list between its editor and its summary.
 */
function resourceTypesOf(
  pickerSource: string,
  fileSource: string,
): Array<string> {
  let list: string | undefined = pickerSource.match(
    /resourceTypes=\{\[([^\]]*)\]\}/,
  )?.[1];

  const listName: string | undefined = pickerSource.match(
    /resourceTypes=\{([A-Za-z_$][\w$]*)\}/,
  )?.[1];

  if (list === undefined && listName) {
    list = fileSource.match(
      new RegExp(`const ${listName}(?:: [^=]+)? = \\[([^\\]]*)\\]`),
    )?.[1];
  }

  if (list === undefined) {
    return [];
  }
  return list
    .split(",")
    .map((part: string) => {
      return part.trim().replace(/^"|"$/g, "");
    })
    .filter(Boolean)
    .sort();
}

function pickerElementAfter(source: string, hook: string): string {
  const hookAt: number = source.indexOf(hook);
  expect(hookAt).toBeGreaterThanOrEqual(0);
  const pickerAt: number = source.indexOf("<AffectedResourcesPicker", hookAt);
  expect(pickerAt).toBeGreaterThanOrEqual(0);
  return source.slice(pickerAt, source.indexOf("/>", pickerAt) + 2);
}

const ALL_FILES: Array<{ file: string; source: string }> = listSourceFiles(
  DASHBOARD_SRC,
).map((file: string) => {
  return { file, source: normalizeSource(fs.readFileSync(file, "utf8")) };
});

const SUMMARY_PICKER_FIELDS: Array<PickerField> = ALL_FILES.filter(
  (entry: { source: string }) => {
    return isSummaryEnabled(entry.source);
  },
).flatMap((entry: { file: string; source: string }) => {
  return pickerEditorFields(entry.file, entry.source);
});

describe("affected resources in a wizard's summary step", () => {
  test("the scan finds the wizards that edit affected resources", () => {
    const files: Array<string> = SUMMARY_PICKER_FIELDS.map(
      (field: PickerField) => {
        return path.relative(DASHBOARD_SRC, field.file);
      },
    );

    // A floor, not the full list: a new wizard joins the checks on its own.
    expect(files).toEqual(
      expect.arrayContaining([
        path.join("Pages", "Alerts", "Create.tsx"),
        path.join("Pages", "Incidents", "Create.tsx"),
        path.join("Pages", "ScheduledMaintenanceEvents", "Create.tsx"),
      ]),
    );
  });

  test("every picker field in a summary-enabled form brings its own summary element", () => {
    const withoutSummary: Array<string> = SUMMARY_PICKER_FIELDS.filter(
      (field: PickerField) => {
        return !field.fieldSource.includes("getSummaryElement:");
      },
    ).map((field: PickerField) => {
      return path.relative(DASHBOARD_SRC, field.file);
    });

    expect(withoutSummary).toEqual([]);
  });

  test("a summary that renders the picker renders it read-only, with every type the editor offers", () => {
    const summaryPickers: Array<PickerField> = SUMMARY_PICKER_FIELDS.filter(
      (field: PickerField) => {
        const summaryAt: number =
          field.fieldSource.indexOf("getSummaryElement:");
        return (
          summaryAt >= 0 &&
          field.fieldSource.indexOf("<AffectedResourcesPicker", summaryAt) >= 0
        );
      },
    );

    // A floor, not the full list: a new wizard joins the checks on its own.
    expect(
      summaryPickers.map((field: PickerField) => {
        return path.relative(DASHBOARD_SRC, field.file);
      }),
    ).toEqual(
      expect.arrayContaining([
        path.join("Pages", "Alerts", "Create.tsx"),
        path.join("Pages", "Incidents", "Create.tsx"),
        path.join("Pages", "ScheduledMaintenanceEvents", "Create.tsx"),
      ]),
    );

    for (const field of summaryPickers) {
      const editor: string = pickerElementAfter(
        field.fieldSource,
        "getCustomElement:",
      );
      const summary: string = pickerElementAfter(
        field.fieldSource,
        "getSummaryElement:",
      );

      expect(summary).toContain("readOnly={true}");
      expect(resourceTypesOf(summary, field.source)).toEqual(
        resourceTypesOf(editor, field.source),
      );
      expect(resourceTypesOf(summary, field.source).length).toBeGreaterThan(0);

      /*
       * Each resource prop the editor reads, the summary reads too. Prettier
       * wraps long props, which normalizes to `{ values.x as ...}`.
       */
      const propPattern: RegExp = / ([a-zA-Z]+)=\{ ?values\.\1 as/g;
      const editorProps: Array<string> = Array.from(
        editor.matchAll(propPattern),
      ).map((match: RegExpMatchArray) => {
        return match[1]!;
      });
      expect(editorProps.length).toBeGreaterThan(0);
      for (const prop of editorProps) {
        expect(summary).toMatch(new RegExp(` ${prop}=\\{ ?item\\.${prop} as`));
      }
    }
  });
});
