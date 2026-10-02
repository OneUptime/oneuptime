import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * "This custom fields.key template should be prefixed with incident, so it
 * should be incident.custom fields.key. Can you please check if this is the
 * issue everywhere else in the project and also fix those things as well?"
 *
 * An incident custom field is placed in a template as
 * {{incident.customFields.<key>}} - in a note template and in a status page's
 * custom subscriber notification template alike. Templates saved before the
 * rename hold the older {{customFields.<key>}}, which is still filled and
 * still counts as a custom field everywhere a template is checked. Both
 * names, and how one is told from the other, live in one module:
 * Common/Types/CustomField/CustomFieldVariableKey.
 *
 * This reads the TypeScript of every source file in Common and the App's
 * feature sets that mentions the names, and fails on:
 *
 *   - a string that shows or inserts the older placeholder ("{{customFields.")
 *     - the dashboard, the docs it renders and every default template hand
 *     out the documented name;
 *   - the older prefix spelled out anywhere but the module that defines it
 *     (the custom field table columns, whose ids are "customFields.<name>",
 *     are a different thing and keep their own constant);
 *   - a placeholder name checked with startsWith against either prefix
 *     outside that module: a check written that way sees one of the two
 *     names and misses the other - and the subscriber template save check is
 *     what keeps a status page role from sending itself the team's custom
 *     fields. Use isCustomFieldTemplateVariableName or
 *     getCustomFieldVariableKeyFromTemplateVariableName instead.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..");

const SCAN_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "Common", "Types"),
  path.join(PACKAGES_DIR, "Common", "Utils"),
  path.join(PACKAGES_DIR, "Common", "Server"),
  path.join(PACKAGES_DIR, "Common", "Models"),
  path.join(PACKAGES_DIR, "Common", "UI"),
  path.join(PACKAGES_DIR, "App", "FeatureSet"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
];

// Where the names are defined, and the one place allowed to spell them out.
const NAMES_MODULE: string =
  "Common/Types/CustomField/CustomFieldVariableKey.ts";

/*
 * The custom field table columns: their ids are "customFields.<name>"
 * (Types/CustomField/CustomFieldSavedViews), unrelated to templates.
 */
const COLUMN_ID_MODULE: string =
  "Common/Types/CustomField/CustomFieldSavedViews.ts";

const LEGACY_PREFIX: string = "customFields.";

const PREFIX_CONSTANTS: Array<string> = [
  "CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX",
  "LEGACY_CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX",
  "INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX",
];

const PREFIX_LITERALS: Array<string> = [
  "customFields.",
  "incident.customFields.",
];

// Cheap first pass: only files that could hold one of the names are parsed.
const MENTION: RegExp =
  /customFields\.|CUSTOM_FIELD_TEMPLATE_VARIABLE_PREFIX|INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX/;

// "{{customFields." and "{{ customFields.", not "{{incident.customFields.".
const OLDER_PLACEHOLDER: RegExp = /\{\{\s*customFields\./;

interface Finding {
  file: string;
  line: number;
  text: string;
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.includes(entry.name)) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

interface ParsedFile {
  // Relative to packages/, with forward slashes.
  file: string;
  source: ts.SourceFile;
}

function relative(file: string): string {
  return path.relative(PACKAGES_DIR, file).split(path.sep).join("/");
}

// Every scanned file that mentions the names, parsed once.
const PARSED: Array<ParsedFile> = SCAN_DIRS.flatMap(
  (directory: string): Array<string> => {
    return listSourceFiles(directory);
  },
)
  .filter((file: string): boolean => {
    return MENTION.test(fs.readFileSync(file, "utf8"));
  })
  .map((file: string): ParsedFile => {
    return {
      file: relative(file),
      source: ts.createSourceFile(
        file,
        fs.readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      ),
    };
  });

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

// The text of a string literal, or of any piece of a template literal.
function literalText(node: ts.Node): string | null {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  ) {
    return node.text;
  }

  if (ts.isJsxText(node)) {
    return node.text;
  }

  return null;
}

function findLiterals(predicate: (text: string) => boolean): Array<Finding> {
  const findings: Array<Finding> = [];

  for (const parsed of PARSED) {
    visit(parsed.source, (node: ts.Node) => {
      const text: string | null = literalText(node);

      if (text !== null && predicate(text)) {
        findings.push({
          file: parsed.file,
          line: lineOf(parsed.source, node),
          text: text,
        });
      }
    });
  }

  return findings;
}

// A `.startsWith(<prefix>)` call, against a prefix constant or literal.
function findPrefixChecks(): Array<Finding> {
  const findings: Array<Finding> = [];

  for (const parsed of PARSED) {
    visit(parsed.source, (node: ts.Node) => {
      if (
        !ts.isCallExpression(node) ||
        !ts.isPropertyAccessExpression(node.expression) ||
        node.expression.name.text !== "startsWith" ||
        node.arguments.length === 0
      ) {
        return;
      }

      const argument: ts.Expression = node.arguments[0]!;
      const argumentText: string = argument.getText(parsed.source);
      const literal: string | null = literalText(argument);

      if (
        PREFIX_CONSTANTS.some((constant: string): boolean => {
          return argumentText.includes(constant);
        }) ||
        (literal !== null && PREFIX_LITERALS.includes(literal))
      ) {
        findings.push({
          file: parsed.file,
          line: lineOf(parsed.source, node),
          text: node.getText(parsed.source),
        });
      }
    });
  }

  return findings;
}

describe("incident custom field template variables are named one way", () => {
  test("the scan reaches the files that name the variables", () => {
    const files: Array<string> = PARSED.map((parsed: ParsedFile): string => {
      return parsed.file;
    });

    // So the checks below cannot pass by reading nothing.
    expect(files).toEqual(
      expect.arrayContaining([
        NAMES_MODULE,
        "Common/Utils/Incident/IncidentNoteTemplateVariables.ts",
        "Common/Types/StatusPage/SubscriberNotificationTemplateVariables.ts",
        "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder.ts",
        "App/FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables.ts",
      ]),
    );
    expect(files.length).toBeGreaterThan(10);
  });

  test("no source shows or inserts the older {{customFields.<key>}}", () => {
    expect(
      findLiterals((text: string): boolean => {
        return OLDER_PLACEHOLDER.test(text);
      }),
    ).toEqual([]);
  });

  test("the documented placeholder is what the dashboard's variable reference shows", () => {
    expect(
      findLiterals((text: string): boolean => {
        return text.includes("{{incident.customFields.<key>}}");
      }).map((finding: Finding): string => {
        return finding.file;
      }),
    ).toContain(
      "App/FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateVariables.ts",
    );
  });

  test("the older prefix is spelled out only where it is defined", () => {
    const spelled: Array<Finding> = findLiterals((text: string): boolean => {
      return text === LEGACY_PREFIX;
    });

    expect(
      spelled
        .filter((finding: Finding): boolean => {
          return finding.file !== COLUMN_ID_MODULE;
        })
        .map((finding: Finding): string => {
          return finding.file;
        }),
    ).toEqual([NAMES_MODULE]);
  });

  test("no placeholder name is checked with startsWith against a prefix outside the names module", () => {
    expect(
      findPrefixChecks().filter((finding: Finding): boolean => {
        return finding.file !== NAMES_MODULE;
      }),
    ).toEqual([]);
  });
});
