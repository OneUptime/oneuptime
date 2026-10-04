import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  MORE_FIELDS_SECTION_TITLE,
  MORE_SETTINGS_SECTION_TITLE,
  RETIRED_FOLD_TITLE,
} from "../../../../UI/Components/FoldedSection/FoldedSectionTitles";

/*
 * "The advanced section in the form should be called something better -
 * like 'more' or something as such. Please make the UI better as well and
 * show what things are inside it when collapsed (small summary of things)."
 * - the maintainer.
 *
 * Every fold of rarely needed options is now one thing, with one name:
 *   - in a form, "More fields": getAdvancedFormSection (form fields) or, in a
 *     hand-built editor such as the monitor form, a FoldedSection titled
 *     MORE_FIELDS_SECTION_TITLE that lists what it holds;
 *   - on a page, "More settings": AdvancedPageSection.
 * Each lists what is inside while folded, the set ones as chips.
 *
 * This guard keeps it so. Across every front end (Dashboard, Admin
 * Dashboard, Status Page, Accounts, Common UI and ee) it fails:
 *   1. a folded section titled "Advanced..." - a FormFieldCollapsibleSection
 *      written by hand, or a CollapsibleSection / FoldedSection drawn with
 *      that title;
 *   2. "More fields" or "More settings" written out instead of the shared
 *      constants, so the name lives in one place (FoldedSectionTitles);
 *   3. a FormFieldCollapsibleSection titled More fields by hand, instead of
 *      getAdvancedFormSection - which is what lists its fields and draws its
 *      icon;
 *   4. the old way of showing extra options - an "Advanced: ..." link that
 *      reveals an "Advanced Options" box, a "Show/Hide Advanced Options"
 *      button, a "Show N advanced settings" link - outside the forms listed
 *      below with the reason they keep it.
 * Wizard steps titled Advanced or More are AdvancedStepsGuard's.
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

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const FOLDED_SECTION_TITLES_FILE: string =
  "packages/Common/UI/Components/FoldedSection/FoldedSectionTitles.ts";

interface Finding {
  file: string;
  line: number;
  text: string;
}

interface ListedFile {
  file: string;
  reason: string;
}

/*
 * The telemetry monitors (logs, traces, exceptions, security events) still
 * show their extra filters with a Show / Hide Advanced Options button. The
 * queued task telemetry-monitor-filters-advanced-section folds them under
 * the shared More fields section; it removes these entries (the stale check
 * below tells it to).
 */
export const OLD_ADVANCED_TOGGLE_ALLOWED: Array<ListedFile> = [
  "Components/Form/Monitor/LogMonitor/LogMonitorStepFrom.tsx",
  "Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm.tsx",
  "Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm.tsx",
  "Components/Form/Monitor/SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx",
]
  .map((file: string): ListedFile => {
    return {
      file: `${DASHBOARD}/${file}`,
      reason:
        "A telemetry monitor's extra filters (attributes, services, severities) are folded under the shared More fields section by the task telemetry-monitor-filters-advanced-section; until then they keep their Show / Hide Advanced Options button.",
    };
  })
  .concat([
    {
      file: `${DASHBOARD}/Utils/GroupingRule/GroupingRuleSetup.ts`,
      reason:
        "Grouping rules' Show advanced settings is a switch that adds the rule's optional wizard steps (Episode Lifecycle, Details, On-Call & Ownership), not a fold of fields: a step cannot sit in a folded section. Its wording is the maintainer's call.",
    },
  ]);

// "Advanced: Port, Timeout and Retries" - the link that opened a box.
const ADVANCED_LINK_TITLE: RegExp = /^\s*Advanced\s*:/i;

/*
 * The box's heading, the telemetry forms' toggle, and the workflow step's
 * "Show 3 advanced settings" link it once had.
 */
const ADVANCED_OPTIONS_TEXT: RegExp =
  /\b(?:(?:Show |Hide )?Advanced Options|(?:Show|Hide)\b[^.]*\badvanced settings?)\b/i;

// A FormFieldCollapsibleSection, told apart from steps and menu sections.
const SECTION_ONLY_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "openWhenConfigured",
  "isConfigured",
  "getSummary",
  "listFieldsWhileFolded",
]);

const FOLD_COMPONENTS: ReadonlySet<string> = new Set<string>([
  "CollapsibleSection",
  "FoldedSection",
]);

const TRANSLATION_CALLS: ReadonlySet<string> = new Set<string>([
  "translateText",
  "translateString",
  "translationKey",
  "translateValue",
  "t",
]);

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

// The static text an expression shows, when it is one.
function staticText(node: ts.Expression | undefined): string | null {
  if (!node) {
    return null;
  }

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }

  if (ts.isParenthesizedExpression(node)) {
    return staticText(node.expression);
  }

  if (ts.isCallExpression(node)) {
    const callee: ts.Expression = node.expression;
    const name: string | null = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;

    if (name && TRANSLATION_CALLS.has(name) && node.arguments.length > 0) {
      return staticText(node.arguments[0]);
    }
  }

  return null;
}

function attributeText(attribute: ts.JsxAttribute): string | null {
  const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;

  if (!initializer) {
    return null;
  }

  if (ts.isStringLiteral(initializer)) {
    return initializer.text;
  }

  if (ts.isJsxExpression(initializer)) {
    return staticText(initializer.expression);
  }

  return null;
}

function propertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (
    (ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)) &&
    property.name &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
  ) {
    return property.name.text;
  }

  return null;
}

interface FileFindings {
  retiredFoldTitles: Array<Finding>;
  writtenOutNames: Array<Finding>;
  handBuiltMoreFields: Array<Finding>;
  oldAdvancedToggles: Array<Finding>;
}

// What one module holds that the rules below are about; `name` as listed.
function scanSource(name: string, source: string): FileFindings {
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    name,
    source,
    ts.ScriptTarget.Latest,
    true,
    name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings: FileFindings = {
    retiredFoldTitles: [],
    writtenOutNames: [],
    handBuiltMoreFields: [],
    oldAdvancedToggles: [],
  };

  const record: (list: Array<Finding>, node: ts.Node, text: string) => void = (
    list: Array<Finding>,
    node: ts.Node,
    text: string,
  ): void => {
    list.push({ file: name, line: lineOf(sourceFile, node), text });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // 1 and 4: a fold drawn with an "Advanced" title, an "Advanced:" link.
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag: string = node.tagName.getText(sourceFile);

      for (const attribute of node.attributes.properties) {
        if (
          !ts.isJsxAttribute(attribute) ||
          attribute.name.getText(sourceFile) !== "title"
        ) {
          continue;
        }

        const text: string | null = attributeText(attribute);

        if (text === null) {
          continue;
        }

        if (FOLD_COMPONENTS.has(tag) && RETIRED_FOLD_TITLE.test(text)) {
          record(
            findings.retiredFoldTitles,
            attribute,
            `<${tag} title="${text}">`,
          );
        }

        if (
          ADVANCED_LINK_TITLE.test(text) ||
          ADVANCED_OPTIONS_TEXT.test(text)
        ) {
          record(
            findings.oldAdvancedToggles,
            attribute,
            `<${tag} title="${text}">`,
          );
        }
      }
    }

    // 4: the "Advanced Options" heading or toggle text, however it is drawn.
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text: string = node.text;

      if (
        ADVANCED_OPTIONS_TEXT.test(text) &&
        !(node.parent && ts.isJsxAttribute(node.parent))
      ) {
        record(findings.oldAdvancedToggles, node, text);
      }

      // 2: the names, written out.
      if (
        (text === MORE_FIELDS_SECTION_TITLE ||
          text === MORE_SETTINGS_SECTION_TITLE) &&
        name !== FOLDED_SECTION_TITLES_FILE
      ) {
        record(findings.writtenOutNames, node, text);
      }
    }

    // 1 and 3: a FormFieldCollapsibleSection written by hand.
    if (ts.isObjectLiteralExpression(node)) {
      const names: Array<string | null> = node.properties.map(propertyName);
      const isSection: boolean =
        names.includes("id") &&
        names.includes("title") &&
        names.some((propertyKey: string | null): boolean => {
          return Boolean(
            propertyKey && SECTION_ONLY_PROPERTIES.has(propertyKey),
          );
        });

      if (isSection) {
        const title: ts.ObjectLiteralElementLike | undefined =
          node.properties.find((property: ts.ObjectLiteralElementLike) => {
            return propertyName(property) === "title";
          });

        const titleNode: ts.Expression | undefined =
          title && ts.isPropertyAssignment(title)
            ? title.initializer
            : undefined;
        const text: string | null = staticText(titleNode);
        const isMoreFieldsConstant: boolean = Boolean(
          titleNode &&
            ts.isIdentifier(titleNode) &&
            titleNode.text === "MORE_FIELDS_SECTION_TITLE",
        );

        if (text !== null && RETIRED_FOLD_TITLE.test(text)) {
          record(findings.retiredFoldTitles, node, `title: "${text}"`);
        }

        if (
          name !==
            "packages/Common/UI/Components/Forms/Utils/AdvancedFormSection.ts" &&
          (text === MORE_FIELDS_SECTION_TITLE || isMoreFieldsConstant)
        ) {
          record(findings.handBuiltMoreFields, node, "title: More fields");
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return findings;
}

function scanFile(file: string): FileFindings {
  return scanSource(relative(file), fs.readFileSync(file, "utf8"));
}

const files: Array<string> = listScanRoots(REPOSITORY_ROOT).flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
);

const scanned: Array<FileFindings> = files.map(scanFile);

function all(pick: (findings: FileFindings) => Array<Finding>): Array<string> {
  return scanned.flatMap(pick).map((finding: Finding): string => {
    return `${finding.file}:${finding.line} ${finding.text}`;
  });
}

describe("folded sections of rarely needed options", () => {
  test("are really read, across every front end", () => {
    expect(files.length).toBeGreaterThan(1000);

    const roots: Array<string> = listScanRoots(REPOSITORY_ROOT).map(relative);

    expect(roots).toEqual(
      expect.arrayContaining([
        `${DASHBOARD}`,
        "packages/App/FeatureSet/AdminDashboard/src",
        "packages/Common/UI",
      ]),
    );
  });

  test("are never titled Advanced: a form's is More fields, a page's More settings", () => {
    expect(
      all((findings: FileFindings) => {
        return findings.retiredFoldTitles;
      }),
    ).toEqual([]);
  });

  test("take their names from FoldedSectionTitles, never written out", () => {
    expect(
      all((findings: FileFindings) => {
        return findings.writtenOutNames;
      }),
    ).toEqual([]);
  });

  test("in a form's fields, are built by getAdvancedFormSection, which lists what they hold", () => {
    expect(
      all((findings: FileFindings) => {
        return findings.handBuiltMoreFields;
      }),
    ).toEqual([]);
  });

  test("are folds, not an 'Advanced: ...' link or a Show Advanced Options button", () => {
    const allowed: Set<string> = new Set<string>(
      OLD_ADVANCED_TOGGLE_ALLOWED.map((entry: ListedFile): string => {
        return entry.file;
      }),
    );

    expect(
      scanned
        .flatMap((findings: FileFindings) => {
          return findings.oldAdvancedToggles;
        })
        .filter((finding: Finding): boolean => {
          return !allowed.has(finding.file);
        })
        .map((finding: Finding): string => {
          return `${finding.file}:${finding.line} ${finding.text}`;
        }),
    ).toEqual([]);
  });

  test("the forms listed with the old toggle still have it, so the list never goes stale", () => {
    for (const entry of OLD_ADVANCED_TOGGLE_ALLOWED) {
      const findings: FileFindings = scanFile(
        path.join(REPOSITORY_ROOT, entry.file),
      );

      expect({
        file: entry.file,
        hasOldToggle: findings.oldAdvancedToggles.length > 0,
      }).toEqual({ file: entry.file, hasOldToggle: true });
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });
});

/*
 * The detector, on snippets, so a change to it is seen to still catch what
 * it is for.
 */
describe("the detector", () => {
  function scanSnippet(source: string): FileFindings {
    return scanSource(`${DASHBOARD}/Pages/Snippet.tsx`, source);
  }

  test("finds a hand-written section titled Advanced, but not a menu section or a step", () => {
    const findings: FileFindings = scanSnippet(`
      const section = { id: "advanced", title: "Advanced", openWhenConfigured: false };
      const options = { id: "x", title: translationKey("Advanced Options"), isConfigured: () => true };
      const menu = { title: "Advanced", items: [] };
      const step = { id: "advanced", title: "Advanced" };
    `);

    expect(
      findings.retiredFoldTitles.map((finding: Finding): string => {
        return finding.text;
      }),
    ).toEqual(['title: "Advanced"', 'title: "Advanced Options"']);
  });

  test("finds a fold drawn with an Advanced title", () => {
    const findings: FileFindings = scanSnippet(`
      const a = <CollapsibleSection title="Advanced Options"><div /></CollapsibleSection>;
      const b = <FoldedSection title={translator.translateText("Advanced")}><div /></FoldedSection>;
      const c = <CollapsibleSection title="Filters"><div /></CollapsibleSection>;
    `);

    expect(findings.retiredFoldTitles).toHaveLength(2);
  });

  test("finds the names written out, and a hand-built More fields section", () => {
    const findings: FileFindings = scanSnippet(`
      const a = <FoldedSection title="More fields"><div /></FoldedSection>;
      const b = { id: "more", title: MORE_FIELDS_SECTION_TITLE, openWhenConfigured: false };
      const c = translateText("More settings");
    `);

    expect(findings.writtenOutNames).toHaveLength(2);
    expect(findings.handBuiltMoreFields).toHaveLength(1);
  });

  test("finds the old link and box, and the telemetry toggle", () => {
    const findings: FileFindings = scanSnippet(`
      const link = <Button title="Advanced: Port, Timeout and Retries" />;
      const heading = <h4>{translator.translateText("Advanced Options")}</h4>;
      const toggle = <Button title={show ? "Hide Advanced Options" : "Show Advanced Options"} />;
      const link = translatePlural({ one: "Show {{count}} advanced setting", other: "Show {{count}} advanced settings" }, 2);
    `);

    expect(
      findings.oldAdvancedToggles.map((finding: Finding): string => {
        return finding.text;
      }),
    ).toEqual([
      '<Button title="Advanced: Port, Timeout and Retries">',
      "Advanced Options",
      "Hide Advanced Options",
      "Show Advanced Options",
      "Show {{count}} advanced setting",
      "Show {{count}} advanced settings",
    ]);
  });
});
