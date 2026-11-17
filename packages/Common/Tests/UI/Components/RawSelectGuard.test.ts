// UX rule: Docs/ux/README.md#one-control-for-one-job
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../../ForeignHiddenRuleGuard";

/*
 * A picker is the shared Dropdown (Common/UI/Components/Dropdown), never a
 * raw <select>.
 *
 * Some forty raw <select>s each drew their own size, border, focus ring and
 * dark look - `px-2 py-1.5 text-xs` on the topology maps, `py-1.5 pl-2 pr-8`
 * in RUM User Flows, borderless grey text in every footer - so no two
 * pickers on a page looked alike, and none looked like the Dropdown beside
 * them (#9194, #9294). The Dropdown has one focus ring, one menu, a search,
 * a keyboard and a dark theme everywhere, and one height - 40px in a form,
 * 28px (isCompact) in a bar of small controls; `isClearable={false}`
 * keeps a value that must always be set, `inputId` lets a <label htmlFor>
 * name it, and the DropdownChoices helpers build a fixed list's options.
 *
 * This reads every frontend's browser source (and Common/UI, and ee/ when
 * present) through the TypeScript AST and fails on a JSX <select>. A file
 * that must keep one lists here how many it holds and why.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

/*
 * Empty: the last 21 raw selects moved onto the shared Dropdown in #9310, a
 * list's rows per page and a query builder's fields among them, compact
 * (isCompact) where they sit in a bar of small controls. A file that must
 * keep a native <select> - for something only the browser's own does -
 * lists here how many it holds and why.
 */
export const RAW_SELECT_EXCEPTIONS: Record<
  string,
  { count: number; reason: string }
> = {};

export interface RawSelect {
  file: string;
  line: number;
}

export function findRawSelects(file: string, text: string): Array<RawSelect> {
  if (!text.includes("<select")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<RawSelect> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "select"
    ) {
      found.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

describe("the guard reads the shapes it is meant to", () => {
  test("a raw select is caught, open or self-closing", () => {
    const code: string = `
      const A = (props) => (
        <select value={props.value} onChange={props.onChange}>
          <option value="a">A</option>
        </select>
      );
      const B = () => <select aria-label="Empty" />;
    `;

    expect(
      findRawSelects("Fixture.tsx", code).map((select: RawSelect): number => {
        return select.line;
      }),
    ).toEqual([3, 7]);
  });

  test("the shared Dropdown, words about a select and a string are left alone", () => {
    const code: string = `
      // A <select> used to be here.
      const A = () => <Dropdown options={[]} isClearable={false} />;
      const B = () => <p>Use a {"<select>"} to choose.</p>;
      const html: string = "<select></select>";
      const C = () => <SelectFieldGroup />;
    `;

    expect(findRawSelects("Fixture.tsx", code)).toEqual([]);
  });
});

describe("a picker is the shared Dropdown", () => {
  const roots: Array<string> = listScanRoots(REPOSITORY_ROOT);
  const files: Array<string> = roots.flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  });

  const foundByFile: Map<string, Array<RawSelect>> = new Map();

  for (const file of files) {
    const relative: string = toRelativePath(REPOSITORY_ROOT, file);
    const found: Array<RawSelect> = findRawSelects(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    if (found.length > 0) {
      foundByFile.set(relative, found);
    }
  }

  test("the scan reads the frontends", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test("no raw <select> outside the exceptions", () => {
    const unexplained: Array<string> = [];

    foundByFile.forEach((found: Array<RawSelect>, file: string): void => {
      const allowed: number = RAW_SELECT_EXCEPTIONS[file]?.count || 0;

      if (found.length > allowed) {
        for (const select of found) {
          unexplained.push(
            `${select.file}:${select.line} is a raw <select>: use the shared Dropdown (Common/UI/Components/Dropdown), with isClearable={false} for a value that must be set`,
          );
        }
      }
    });

    expect(unexplained).toEqual([]);
  });

  test("every exception still holds the selects it lists, and says why", () => {
    const stale: Array<string> = [];

    for (const file of Object.keys(RAW_SELECT_EXCEPTIONS)) {
      // A checkout without ee/ (the Community Edition) has none of its files.
      if (
        file.startsWith("ee/") &&
        !fs.existsSync(path.join(REPOSITORY_ROOT, "ee"))
      ) {
        continue;
      }

      const exception: { count: number; reason: string } =
        RAW_SELECT_EXCEPTIONS[file]!;
      const count: number = foundByFile.get(file)?.length || 0;

      if (count !== exception.count) {
        stale.push(
          `${file} holds ${count}, the exception lists ${exception.count}`,
        );
      }

      if (!exception.reason.trim()) {
        stale.push(`${file} gives no reason`);
      }
    }

    expect(stale).toEqual([]);
  });
});
