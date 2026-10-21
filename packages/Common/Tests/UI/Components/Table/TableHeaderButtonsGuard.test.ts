import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";

/*
 * "There are buttons which do not match the sizes ... buttons flying
 * everywhere. Please make it look like any other table in OneUptime. Please
 * also check if there is an issue with other tables just like this and fix
 * them as well."
 *
 * The Session Replay list was one of sixteen lists whose card header had
 * icons of its own: a refresh icon - and a filter funnel - with no border,
 * a size smaller than the buttons beside them, nudged into place with a
 * hand-tuned class. Every model table keeps Refresh and Filter in the ⋯ at
 * the end of its header, beside its main button. These hold every list a
 * page builds on Common's Table to the same header, and keep the nudge from
 * coming back anywhere.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

interface SourceFile {
  relativePath: string;
  code: string;
}

// A header icon nudged into place beside a card's title.
const NUDGED_ICON: RegExp = /className:\s{0,4}"py-0 pr-0 pl-\d mt-1"/;

// The Common Table, imported by a page (or by a Common component).
const COMMON_TABLE_MODULES: ReadonlyArray<string> = [
  "Common/UI/Components/Table/Table",
  "Common/UI/Components/Table/LocalTable",
  "../Table/Table",
  "./Table",
  "./LocalTable",
];

// A card's buttons handed through the shared header.
const SHARED_BUTTONS_CALL: RegExp = /^getTableHeaderButtons\(/;

// A card given the header's whole row: [headerToolbar].
const TOOLBAR_ROW: RegExp = /^\[\w{1,64}\]$/;

// The table components themselves and the model tables, which split their own buttons.
const TABLE_COMPONENTS: ReadonlySet<string> = new Set<string>([
  "packages/Common/UI/Components/Table/Table.tsx",
  "packages/Common/UI/Components/Table/LocalTable.tsx",
  "packages/Common/UI/Components/Table/TableHeaderControls.tsx",
  "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
]);

let cachedFiles: Array<SourceFile> | null = null;

function sourceFiles(): Array<SourceFile> {
  if (cachedFiles) {
    return cachedFiles;
  }

  cachedFiles = listScanRoots(REPOSITORY_ROOT)
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .map((file: string): SourceFile => {
      return {
        relativePath: path
          .relative(REPOSITORY_ROOT, file)
          .split(path.sep)
          .join("/"),
        code: fs.readFileSync(file, "utf8"),
      };
    });

  return cachedFiles;
}

// Whether a file imports the Common Table, read from its import declarations.
function importsCommonTable(file: SourceFile): boolean {
  return COMMON_TABLE_MODULES.some((module: string): boolean => {
    return (
      file.code.includes(`from "${module}";`) ||
      file.code.includes(`from "${module}"\n`)
    );
  });
}

interface CardButtons {
  // The buttons attribute's expression, as written.
  expression: string;
  line: number;
}

// Every <Card buttons={...}> in a file, read with the TypeScript parser.
function cardButtonsIn(file: SourceFile): Array<CardButtons> {
  const source: ts.SourceFile = ts.createSourceFile(
    file.relativePath,
    file.code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: Array<CardButtons> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === "Card"
    ) {
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === "buttons" &&
          attribute.initializer &&
          ts.isJsxExpression(attribute.initializer) &&
          attribute.initializer.expression
        ) {
          found.push({
            expression: attribute.initializer.expression.getText(source),
            line:
              source.getLineAndCharacterOfPosition(attribute.getStart(source))
                .line + 1,
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

// A card's buttons that keep to the shared header.
function isSharedHeader(file: SourceFile, buttons: CardButtons): boolean {
  if (SHARED_BUTTONS_CALL.test(buttons.expression)) {
    return true;
  }

  return (
    TOOLBAR_ROW.test(buttons.expression) &&
    file.code.includes("<TableHeaderToolbar")
  );
}

describe("a table's header buttons", () => {
  test("the scan reads the pages and the shared components", () => {
    const paths: Array<string> = sourceFiles().map((file: SourceFile) => {
      return file.relativePath;
    });

    expect(paths).toContain(
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable.tsx",
    );
    expect(paths).toContain(
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Events.tsx",
    );
    expect(paths).toContain(
      "packages/Common/UI/Components/StatusTimeline/ModelStatusTimeline.tsx",
    );
    expect(paths.length).toBeGreaterThan(1000);
  });

  test("no button is nudged into place beside a card's title as a loose icon", () => {
    const offenders: Array<string> = sourceFiles()
      .filter((file: SourceFile): boolean => {
        return NUDGED_ICON.test(file.code);
      })
      .map((file: SourceFile): string => {
        return file.relativePath;
      });

    expect(offenders).toEqual([]);
  });

  test("a table a page builds on Common's Table hands its card the shared header", () => {
    const tables: Array<SourceFile> = sourceFiles().filter(
      (file: SourceFile): boolean => {
        return (
          !TABLE_COMPONENTS.has(file.relativePath) && importsCommonTable(file)
        );
      },
    );

    const withButtons: Array<{ file: SourceFile; buttons: CardButtons }> =
      tables.flatMap((file: SourceFile) => {
        return cardButtonsIn(file).map((buttons: CardButtons) => {
          return { file: file, buttons: buttons };
        });
      });

    /*
     * The lists this rule was written for are all in the scan: it holds
     * them, not an empty set.
     */
    const checkedPaths: Set<string> = new Set<string>(
      withButtons.map((entry: { file: SourceFile }) => {
        return entry.file.relativePath;
      }),
    );

    for (const expected of [
      "packages/App/FeatureSet/Dashboard/src/Components/Infrastructure/ResourceTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/ClusterLog.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Ceph/View/Daemons.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Docker/View/Containers.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Processes.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/Services.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnits.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/Costs.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Costs.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Events.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesRightSizingCard.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Readiness.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/Podman/View/Containers.tsx",
      "packages/Common/UI/Components/Table/TableCard.tsx",
    ]) {
      expect(checkedPaths).toContain(expected);
    }

    const offenders: Array<string> = withButtons
      .filter((entry: { file: SourceFile; buttons: CardButtons }) => {
        return !isSharedHeader(entry.file, entry.buttons);
      })
      .map((entry: { file: SourceFile; buttons: CardButtons }): string => {
        return `${entry.file.relativePath}:${entry.buttons.line} buttons={${entry.buttons.expression}}`;
      });

    expect(offenders).toEqual([]);
  });

  test("an icon-only Refresh goes to the ⋯, never on its own into a card's header", () => {
    const offenders: Array<string> = sourceFiles()
      .filter((file: SourceFile): boolean => {
        return (
          file.code.includes("getRefreshButton()") &&
          !TABLE_COMPONENTS.has(file.relativePath) &&
          !file.code.includes("getTableHeaderButtons(")
        );
      })
      .map((file: SourceFile): string => {
        return file.relativePath;
      });

    expect(offenders).toEqual([]);
  });

  test("the rules see what they ban", () => {
    expect(NUDGED_ICON.test('className: "py-0 pr-0 pl-1 mt-1",')).toBe(true);
    expect(NUDGED_ICON.test('className: "py-0 pr-0 pl-0 mt-1",')).toBe(true);
    expect(NUDGED_ICON.test('className: "py-2 pr-0 pl-1 mt-1",')).toBe(false);

    const file: (code: string) => SourceFile = (code: string): SourceFile => {
      return { relativePath: "Page.tsx", code: code };
    };

    expect(
      importsCommonTable(
        file('import Table from "Common/UI/Components/Table/Table";\n'),
      ),
    ).toBe(true);
    expect(
      importsCommonTable(
        file('import TableCard from "Common/UI/Components/Table/TableCard";\n'),
      ),
    ).toBe(false);

    const page: SourceFile = file(
      [
        "const a = (",
        '  <Card title="X" onClick={() => {}} buttons={cardButtons}>',
        "    <Table />",
        "  </Card>",
        ");",
        'const b = <Card title="Y" buttons={getTableHeaderButtons(cardButtons)} />;',
        "const c = <Card title=\"Z\" buttons={[headerToolbar]} />;",
      ].join("\n"),
    );
    const found: Array<CardButtons> = cardButtonsIn(page);

    expect(
      found.map((buttons: CardButtons): string => {
        return buttons.expression;
      }),
    ).toEqual([
      "cardButtons",
      "getTableHeaderButtons(cardButtons)",
      "[headerToolbar]",
    ]);
    expect(found[0]?.line).toBe(2);
    expect(isSharedHeader(page, found[0] as CardButtons)).toBe(false);
    expect(isSharedHeader(page, found[1] as CardButtons)).toBe(true);
    /* A row of its own counts only where the file draws the toolbar. */
    expect(isSharedHeader(page, found[2] as CardButtons)).toBe(false);
    expect(
      isSharedHeader(
        file(`${page.code}\nconst t = <TableHeaderToolbar />;`),
        found[2] as CardButtons,
      ),
    ).toBe(true);
  });
});
