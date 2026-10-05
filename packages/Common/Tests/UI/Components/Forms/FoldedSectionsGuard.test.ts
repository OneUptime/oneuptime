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
 *      button, a "Show N advanced settings" link, a "Show advanced settings"
 *      switch - anywhere. The last forms that had one (below) fold their
 *      extra options under More fields now, so no form keeps one.
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

/*
 * The forms that kept an old toggle longest, each listed once with the
 * reason it kept it, until it folded under More fields as well:
 *   - the telemetry monitors (logs, traces, exceptions, security events)
 *     had a Show / Hide Advanced Options button over their extra filters
 *     (#4378);
 *   - the incident and alert grouping rules had a Show advanced settings
 *     switch that added three wizard steps - Episode Lifecycle, Details,
 *     On-Call & Ownership. Those settings are one More fields fold at the
 *     end of the Grouping step now, under three small headings, and the
 *     wizard never grows.
 * Each must keep folding with the shared section and hold no toggle state.
 */
const TELEMETRY_MONITOR_FILTER_FORMS: Array<string> = [
  "LogMonitor/LogMonitorStepFrom.tsx",
  "TraceMonitor/TraceMonitorStepForm.tsx",
  "ExceptionMonitor/ExceptionMonitorStepForm.tsx",
  "SecurityEventsMonitor/SecurityEventsMonitorStepForm.tsx",
].map((file: string): string => {
  return `${DASHBOARD}/Components/Form/Monitor/${file}`;
});

const GROUPING_RULE_FORMS: Array<string> = [
  `${DASHBOARD}/Pages/Incidents/Settings/IncidentGroupingRules.tsx`,
  `${DASHBOARD}/Pages/Alerts/Settings/AlertGroupingRules.tsx`,
];

// Where the grouping rule form's fields and words are built.
const GROUPING_RULE_HELPERS: Array<string> = [
  `${DASHBOARD}/Components/GroupingRule/GroupingRuleFormFields.tsx`,
  `${DASHBOARD}/Utils/GroupingRule/GroupingRuleSetup.ts`,
];

// The switch's form key and its builders, gone with it.
const RETIRED_GROUPING_RULE_SWITCH: RegExp =
  /showAdvancedSettings|SHOW_ADVANCED_SETTINGS|ShowAdvancedSettings|hasAdvancedSettings|showAdvancedTitle|showAdvancedDescription/;

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

  test("are folds, never an 'Advanced: ...' link, a Show Advanced Options button or a Show advanced settings switch", () => {
    expect(
      all((findings: FileFindings) => {
        return findings.oldAdvancedToggles;
      }),
    ).toEqual([]);
  });

  test("the telemetry monitor filters, the last behind a Show Advanced Options button, fold under More fields", () => {
    for (const file of TELEMETRY_MONITOR_FILTER_FORMS) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({
        file: file,
        oldToggles: scanSource(file, source).oldAdvancedToggles,
        foldsWithTheSharedSection: source.includes("getAdvancedFormSection<"),
        keepsToggleState: source.includes("showAdvancedOptions"),
      }).toEqual({
        file: file,
        oldToggles: [],
        foldsWithTheSharedSection: true,
        keepsToggleState: false,
      });
    }
  });

  test("the grouping rules, the last behind a Show advanced settings switch, fold under More fields", () => {
    for (const file of GROUPING_RULE_FORMS) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({
        file: file,
        oldToggles: scanSource(file, source).oldAdvancedToggles,
        foldsWithTheSharedSection: source.includes("getAdvancedFormSection<"),
        namesTheRetiredSwitch: RETIRED_GROUPING_RULE_SWITCH.test(source),
        // One section, built once: every field in the fold names it.
        sectionsBuilt: source.split("getAdvancedFormSection<").length - 1,
      }).toEqual({
        file: file,
        oldToggles: [],
        foldsWithTheSharedSection: true,
        namesTheRetiredSwitch: false,
        sectionsBuilt: 1,
      });
    }

    for (const file of GROUPING_RULE_HELPERS) {
      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, file),
        "utf8",
      );

      expect({
        file: file,
        oldToggles: scanSource(file, source).oldAdvancedToggles,
        namesTheRetiredSwitch: RETIRED_GROUPING_RULE_SWITCH.test(source),
      }).toEqual({
        file: file,
        oldToggles: [],
        namesTheRetiredSwitch: false,
      });
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

  test("finds the grouping rules' switch, however its title is written", () => {
    const findings: FileFindings = scanSnippet(`
      const COPY = { showAdvancedTitle: "Show advanced settings" };
      const field = { title: "Show Advanced Settings", fieldType: FormFieldSchemaType.Toggle };
      const toggle = <Toggle title="Hide advanced settings" />;
    `);

    expect(
      findings.oldAdvancedToggles.map((finding: Finding): string => {
        return finding.text;
      }),
    ).toEqual([
      "Show advanced settings",
      "Show Advanced Settings",
      '<Toggle title="Hide advanced settings">',
    ]);
  });

  test("leaves the words alone where they are not a toggle's", () => {
    const findings: FileFindings = scanSnippet(`
      const a = <p>{translateText("Advanced settings for experts live in the API.")}</p>;
      const b = <Card title="Episode Lifecycle" description="Reopen and resolve episodes." />;
    `);

    expect(findings.oldAdvancedToggles).toEqual([]);
  });
});
