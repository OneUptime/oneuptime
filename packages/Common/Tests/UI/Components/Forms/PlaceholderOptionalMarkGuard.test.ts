import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../../../ForeignHiddenRuleGuard";

/*
 * A form field that may be left empty says so once, on its label: FieldLabel
 * draws "(Optional)" after the title of every field that is not required
 * (Forms/Utils/OptionalMark). About 150 placeholders said it again - "Select
 * Monitors (optional)" under "Monitors (Optional)", "Select Severities
 * (optional)", a network device's "Select Monitor (optional)" - and each was a
 * key of its own in the Dashboard's 17 locale files ("Monitore auswählen
 * (optional)").
 *
 * This holds every frontend to one mark: no form field's placeholder says
 * "optional", whether it is written on the field, kept in a constant the
 * field names ("Select Monitor" is MonitoringMethodFormFields'
 * MONITOR_BINDING_FIELD_PLACEHOLDER) or marked with translationKey(). A field
 * is an object literal with a placeholder and a fieldType or a title, the
 * shape every form host (ModelTable, ModelForm, BasicForm, CardModelDetail
 * and the rest) takes its fields in.
 *
 * What it leaves alone: an input with no label of its own, whose
 * placeholder is the only thing that names it - an SNMP table column's
 * "Unit (optional, e.g., dBm)", a dismissal's "Why? (optional)". Those are
 * JSX attributes, not form fields, and their placeholder is not a second
 * mark.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

// "optional" as a word, in any case: "(optional)", "(Optional)", "(optional, e.g. 1)".
const OPTIONAL_WORD: RegExp = /\boptional\b/i;

// The calls that only mark an English key for the extractor.
const KEY_MARKERS: ReadonlySet<string> = new Set<string>(["translationKey"]);

interface PlaceholderFinding {
  file: string;
  line: number;
  placeholder: string;
}

const unwrap: (node: ts.Node) => ts.Node = (node: ts.Node): ts.Node => {
  let current: ts.Node = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

const propertyNameOf: (property: ts.ObjectLiteralElementLike) => string = (
  property: ts.ObjectLiteralElementLike,
): string => {
  if (!property.name) {
    return "";
  }

  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }

  return "";
};

const initializerOf: (
  object: ts.ObjectLiteralExpression,
  name: string,
) => ts.Expression | null = (
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null => {
  for (const property of object.properties) {
    if (propertyNameOf(property) !== name) {
      continue;
    }

    if (ts.isPropertyAssignment(property)) {
      return property.initializer;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      return property.name;
    }
  }

  return null;
};

const parse: (file: string, text: string) => ts.SourceFile = (
  file: string,
  text: string,
): ts.SourceFile => {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
};

/*
 * The texts a value is, when it is written down: a string, each branch of a
 * condition, translationKey("..."), or a constant named by it (looked up in
 * `constants`, every module's string constants by name).
 */
const textsOf: (
  expression: ts.Node,
  constants: ReadonlyMap<string, Array<string>>,
  depth?: number,
) => Array<string> = (
  expression: ts.Node,
  constants: ReadonlyMap<string, Array<string>>,
  depth: number = 0,
): Array<string> => {
  if (depth > 8) {
    return [];
  }

  const node: ts.Node = unwrap(expression);

  if (ts.isStringLiteralLike(node)) {
    return [node.text];
  }

  if (ts.isTemplateExpression(node)) {
    return [
      [
        node.head.text,
        ...node.templateSpans.map((span: ts.TemplateSpan): string => {
          return span.literal.text;
        }),
      ].join(" "),
    ];
  }

  if (ts.isConditionalExpression(node)) {
    return [
      ...textsOf(node.whenTrue, constants, depth + 1),
      ...textsOf(node.whenFalse, constants, depth + 1),
    ];
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return [
      ...textsOf(node.left, constants, depth + 1),
      ...textsOf(node.right, constants, depth + 1),
    ];
  }

  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    KEY_MARKERS.has(node.expression.text) &&
    node.arguments[0]
  ) {
    return textsOf(node.arguments[0], constants, depth + 1);
  }

  if (ts.isIdentifier(node)) {
    return constants.get(node.text) || [];
  }

  return [];
};

// Every module-level `const NAME = "..."` (or translationKey("...")), by name.
const collectStringConstants: (
  sources: Array<ts.SourceFile>,
) => Map<string, Array<string>> = (
  sources: Array<ts.SourceFile>,
): Map<string, Array<string>> => {
  const constants: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const empty: ReadonlyMap<string, Array<string>> = new Map<
    string,
    Array<string>
  >();

  for (const source of sources) {
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) {
        continue;
      }

      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }

        const texts: Array<string> = textsOf(declaration.initializer, empty);

        if (texts.length > 0) {
          constants.set(declaration.name.text, [
            ...(constants.get(declaration.name.text) || []),
            ...texts,
          ]);
        }
      }
    }
  }

  return constants;
};

// A form field: an object with a placeholder and a fieldType or a title.
const isFormField: (object: ts.ObjectLiteralExpression) => boolean = (
  object: ts.ObjectLiteralExpression,
): boolean => {
  return (
    initializerOf(object, "placeholder") !== null &&
    (initializerOf(object, "fieldType") !== null ||
      initializerOf(object, "title") !== null)
  );
};

const findOptionalPlaceholders: (data: {
  sources: Array<ts.SourceFile>;
  constants: ReadonlyMap<string, Array<string>>;
  repositoryRoot: string;
}) => Array<PlaceholderFinding> = (data: {
  sources: Array<ts.SourceFile>;
  constants: ReadonlyMap<string, Array<string>>;
  repositoryRoot: string;
}): Array<PlaceholderFinding> => {
  const findings: Array<PlaceholderFinding> = [];

  for (const source of data.sources) {
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node) && isFormField(node)) {
        const placeholder: ts.Expression = initializerOf(
          node,
          "placeholder",
        ) as ts.Expression;

        for (const text of textsOf(placeholder, data.constants)) {
          if (OPTIONAL_WORD.test(text)) {
            findings.push({
              file: toRelativePath(data.repositoryRoot, source.fileName),
              line:
                source.getLineAndCharacterOfPosition(placeholder.getStart())
                  .line + 1,
              placeholder: text,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return findings;
};

const readSources: () => Array<ts.SourceFile> = (): Array<ts.SourceFile> => {
  return listScanRoots(REPOSITORY_ROOT)
    .flatMap((root: string): Array<string> => {
      return listSourceFiles(root);
    })
    .map((file: string): ts.SourceFile => {
      return parse(file, fs.readFileSync(file, "utf8"));
    });
};

const scanText: (files: Record<string, string>) => Array<string> = (
  files: Record<string, string>,
): Array<string> => {
  const sources: Array<ts.SourceFile> = Object.keys(files).map(
    (name: string): ts.SourceFile => {
      return parse(path.join(REPOSITORY_ROOT, name), files[name] as string);
    },
  );

  return findOptionalPlaceholders({
    sources,
    constants: collectStringConstants(sources),
    repositoryRoot: REPOSITORY_ROOT,
  }).map((finding: PlaceholderFinding): string => {
    return `${finding.file}:${finding.line} ${finding.placeholder}`;
  });
};

describe("a form field says it is optional once, on its label", () => {
  const sources: Array<ts.SourceFile> = readSources();

  test("no form field's placeholder says optional", () => {
    // The walk reached the frontends, so an empty list means something.
    expect(sources.length).toBeGreaterThan(1000);

    const findings: Array<string> = findOptionalPlaceholders({
      sources,
      constants: collectStringConstants(sources),
      repositoryRoot: REPOSITORY_ROOT,
    }).map((finding: PlaceholderFinding): string => {
      return `${finding.file}:${finding.line} placeholder "${finding.placeholder}" says optional, as the label's own (Optional) mark does: leave the mark to the label`;
    });

    expect(findings).toEqual([]);
  });

  test("it reads the rule pages and the forms the guard was written for", () => {
    const read: Array<string> = sources.map((source: ts.SourceFile) => {
      return toRelativePath(REPOSITORY_ROOT, source.fileName);
    });

    for (const file of [
      "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOwnerRules.tsx",
      "packages/App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Settings.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/MonitoringMethodFormFields.ts",
      "packages/App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleForm.ts",
    ]) {
      expect(read).toContain(file);
    }
  });

  test("the placeholders it was written for now say what to pick, and no more", () => {
    const constants: Map<string, Array<string>> =
      collectStringConstants(sources);

    expect(constants.get("MONITOR_BINDING_FIELD_PLACEHOLDER")).toEqual([
      "Select Monitor",
    ]);

    const ownerRules: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOwnerRules.tsx",
      ),
      "utf8",
    );

    for (const placeholder of [
      "Select Monitors",
      "Select Severities",
      "Select Incident Labels",
      "Select Monitor Labels",
    ]) {
      expect(ownerRules).toContain(`placeholder: "${placeholder}",`);
    }
  });

  test("it finds the mark written on a field, kept in a constant, or behind a condition", () => {
    expect(
      scanText({
        "Fields.tsx": [
          "const fields = [",
          '  { field: { monitors: true }, title: "Monitors", placeholder: "Select Monitors (optional)" },',
          '  { field: { labels: true }, fieldType: FormFieldSchemaType.MultiSelectDropdown, placeholder: "Select Labels (Optional)" },',
          "  { field: { site: true }, title: 'Site', placeholder: SITE_PLACEHOLDER },",
          '  { field: { unit: true }, title: "Unit", placeholder: isWide ? "Unit (optional, e.g. dBm)" : "Unit" },',
          "];",
        ].join("\n"),
        "Copy.ts": [
          'export const SITE_PLACEHOLDER: string = translationKey("Select Site (optional)");',
        ].join("\n"),
      }),
    ).toEqual([
      "Fields.tsx:2 Select Monitors (optional)",
      "Fields.tsx:3 Select Labels (Optional)",
      "Fields.tsx:4 Select Site (optional)",
      "Fields.tsx:5 Unit (optional, e.g. dBm)",
    ]);
  });

  test("it leaves a label-less input, a title that marks itself, and other objects alone", () => {
    expect(
      scanText({
        "Editor.tsx": [
          "const a = <Input placeholder=\"Unit (optional, e.g., dBm)\" />;",
          'const b = { field: { dns: true }, title: "DNS Server (Optional)", placeholder: "8.8.8.8" };',
          'const c = { placeholder: "Search (optional filters)" };',
          'const d = { field: { name: true }, title: "Name", placeholder: "Optionally, a name" };',
          'const e = { field: { monitors: true }, title: "Monitors", placeholder: "Select Monitors" };',
        ].join("\n"),
      }),
    ).toEqual([]);
  });
});
