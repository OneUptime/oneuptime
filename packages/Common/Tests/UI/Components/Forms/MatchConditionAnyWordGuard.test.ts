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
 * "Any", on its own, is the Match Condition's word.
 *
 * The Dashboard translates a label by its English text, so every screen that
 * draws the bare word "Any" draws the same translation. That word is a
 * monitor criteria's Match Condition: All (every filter must match) or Any
 * (one is enough). Korean, French, Dutch and Persian drew it with their
 * word for all, every or everything - 모두, Tout, Elke, هر - so the two
 * options read alike; they now say "one or more" / "at least one" (하나
 * 이상, Au moins un, Minstens één, دست‌کم یکی).
 *
 * Two other screens drew the bare "Any" with another meaning, where those
 * words read wrong: Traces > Recording Rules' Span Kind filter left open
 * (now "All") and the workflow value picker's badge for a value of any type
 * (now "Any type"). This guard keeps it that way. It reads every frontend,
 * the shared UI, the Enterprise screens when ee/ is there, and
 * Common/Types (where labels for dropdowns live), for the text "Any" as a
 * whole string or JSX text, and fails unless it is:
 *
 *   - a Match Condition option: `{ title: "Any", value: FilterCondition.Any }`
 *     (or `label:`), the same meaning everywhere; or
 *   - an enum's value listed below, with how the screens draw it.
 *
 * A filter that leaves a value open names its noun ("Any protocol", "Any
 * severity") or says "All"; a value's type says "Any type".
 */

// packages/Common/Tests/UI/Components/Forms -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const ANY: string = "Any";

const MATCH_CONDITION_VALUE: string = "FilterCondition.Any";

const LABEL_PROPERTIES: ReadonlyArray<string> = ["title", "label"];

interface AllowedEnumValue {
  // Repository-relative, with "/".
  file: string;
  enumName: string;
  // How the screens draw it - never as the bare "Any".
  drawnAs: string;
}

/*
 * Enums with a member whose value is "Any", and how each is drawn. A new
 * one has to say here how the screens draw it; one that goes leaves the
 * list (the guard says so).
 */
export const ALLOWED_ENUM_VALUES: ReadonlyArray<AllowedEnumValue> = [
  {
    file: "packages/Common/Types/Filter/FilterCondition.ts",
    enumName: "FilterCondition",
    drawnAs:
      "the Match Condition's own option, All or Any (MonitorCriteriaInstance draws the enum)",
  },
  {
    file: "packages/Common/Types/PacketCapture/PacketCaptureFilter.ts",
    enumName: "PacketCaptureProtocol",
    drawnAs: '"Any protocol" (PROTOCOL_LABELS in PacketCaptureFilterInput)',
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter.ts",
    enumName: "DiscoveredHostNameFilter",
    drawnAs: '"All" (getDiscoveredHostNameFilterLabel)',
  },
];

export type AnyWordKind = "match-condition-option" | "enum-value" | "other";

export interface AnyWord {
  file: string;
  line: number;
  kind: AnyWordKind;
  // The enum it belongs to, for an enum value.
  enumName?: string | undefined;
  // The code around it, for the failure message.
  code: string;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function lineOf(node: ts.Node, sourceFile: ts.SourceFile): number {
  return (
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
  );
}

function propertyName(property: ts.ObjectLiteralElementLike): string {
  return property.name &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    ? property.name.text
    : "";
}

/*
 * `{ title: "Any", value: FilterCondition.Any }`: an option of a Match
 * Condition radio, which means what the editor's Any means.
 */
function isMatchConditionOption(
  literal: ts.Node,
  sourceFile: ts.SourceFile,
): boolean {
  const property: ts.Node = literal.parent;

  if (
    !ts.isPropertyAssignment(property) ||
    property.initializer !== literal ||
    !LABEL_PROPERTIES.includes(propertyName(property)) ||
    !ts.isObjectLiteralExpression(property.parent)
  ) {
    return false;
  }

  return property.parent.properties.some(
    (sibling: ts.ObjectLiteralElementLike): boolean => {
      return (
        ts.isPropertyAssignment(sibling) &&
        propertyName(sibling) === "value" &&
        sibling.initializer.getText(sourceFile) === MATCH_CONDITION_VALUE
      );
    },
  );
}

/**
 * Every place the source writes the text "Any" on its own: a string
 * literal, a template without substitutions, or JSX text.
 */
export function findAnyWords(file: string, text: string): Array<AnyWord> {
  const found: Array<AnyWord> = [];

  if (!text.includes(ANY)) {
    return found;
  }

  const sourceFile: ts.SourceFile = parse(file, text);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    const isAnyString: boolean =
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === ANY;
    const isAnyJsxText: boolean = ts.isJsxText(node) && node.text.trim() === ANY;

    if (isAnyString || isAnyJsxText) {
      const parent: ts.Node = node.parent;
      let kind: AnyWordKind = "other";
      let enumName: string | undefined = undefined;

      if (isAnyString && ts.isEnumMember(parent) && parent.initializer === node) {
        kind = "enum-value";
        enumName = (parent.parent as ts.EnumDeclaration).name.text;
      } else if (isAnyString && isMatchConditionOption(node, sourceFile)) {
        kind = "match-condition-option";
      }

      found.push({
        file: file,
        line: lineOf(node, sourceFile),
        kind: kind,
        enumName: enumName,
        code: (parent.getText(sourceFile) || "").split("\n")[0]!.trim(),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function scannedFiles(): Array<string> {
  return [
    ...listScanRoots(REPOSITORY_ROOT),
    path.join(REPOSITORY_ROOT, "packages", "Common", "Types"),
  ].flatMap((root: string): Array<string> => {
    return listSourceFiles(root);
  });
}

function scan(): Array<AnyWord> {
  return scannedFiles().flatMap((file: string): Array<AnyWord> => {
    return findAnyWords(
      toRelativePath(REPOSITORY_ROOT, file),
      fs.readFileSync(file, "utf8"),
    );
  });
}

const FOUND: Array<AnyWord> = scan();

function describeWord(word: AnyWord): string {
  return `${word.file}:${word.line} ${word.code}`;
}

function isAllowedEnumValue(word: AnyWord): boolean {
  return ALLOWED_ENUM_VALUES.some((allowed: AllowedEnumValue): boolean => {
    return allowed.file === word.file && allowed.enumName === word.enumName;
  });
}

describe("the bare word Any", () => {
  test("is only a Match Condition option or an enum value listed with how it is drawn", () => {
    const offending: Array<string> = FOUND.filter((word: AnyWord): boolean => {
      if (word.kind === "match-condition-option") {
        return false;
      }

      return !(word.kind === "enum-value" && isAllowedEnumValue(word));
    }).map(describeWord);

    /*
     * When this fails: the Dashboard draws "Any" as the Match Condition's
     * "any one of the filters" (하나 이상, Au moins un, ...). Name what is
     * left open ("Any protocol", "All") or the type ("Any type"), or - for
     * an enum value that is not drawn as written - list it above with how
     * it is drawn.
     */
    expect(offending).toEqual([]);
  });

  test("every listed enum still has its Any value", () => {
    const stale: Array<string> = ALLOWED_ENUM_VALUES.filter(
      (allowed: AllowedEnumValue): boolean => {
        return !FOUND.some((word: AnyWord): boolean => {
          return (
            word.kind === "enum-value" &&
            word.file === allowed.file &&
            word.enumName === allowed.enumName
          );
        });
      },
    ).map((allowed: AllowedEnumValue): string => {
      return `${allowed.file} ${allowed.enumName}`;
    });

    expect(stale).toEqual([]);
  });

  test("finds the Match Condition radios it lets through", () => {
    const files: Array<string> = FOUND.filter((word: AnyWord): boolean => {
      return word.kind === "match-condition-option";
    }).map((word: AnyWord): string => {
      return word.file;
    });

    expect(files).toEqual(
      expect.arrayContaining([
        "packages/App/FeatureSet/Dashboard/src/Pages/Metrics/Settings/PipelineRules.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleForm.tsx",
        "packages/App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable.tsx",
      ]),
    );
  });

  test("Traces' Span Kind filter and the value picker's type badge say what they mean", () => {
    for (const file of [
      "packages/Common/Types/Trace/TraceRecordingRuleDefinition.ts",
      "packages/Common/UI/Components/Workflow/ValuePicker/ValueSuggestion.ts",
    ]) {
      expect(
        findAnyWords(
          file,
          fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
        ).map(describeWord),
      ).toEqual([]);
    }
  });
});

describe("findAnyWords", () => {
  test("reads a Match Condition option, by title or label", () => {
    expect(
      findAnyWords(
        "Form.tsx",
        [
          "const a = [",
          '  { title: "All", value: FilterCondition.All },',
          '  { title: "Any", value: FilterCondition.Any },',
          '  { label: "Any", value: FilterCondition.Any },',
          "];",
        ].join("\n"),
      ).map((word: AnyWord): [number, AnyWordKind] => {
        return [word.line, word.kind];
      }),
    ).toEqual([
      [3, "match-condition-option"],
      [4, "match-condition-option"],
    ]);
  });

  test("reads any other option or label map as other", () => {
    expect(
      findAnyWords(
        "Options.ts",
        [
          'const spanKinds = [{ value: "", label: "Any" }];',
          'const types = { [ComponentInputType.AnyValue]: "Any" };',
          'const words = [`Any`, translateText("Any")];',
          'const option = { title: "Any", value: SomethingElse.Any };',
        ].join("\n"),
      ).map((word: AnyWord): [number, AnyWordKind] => {
        return [word.line, word.kind];
      }),
    ).toEqual([
      [1, "other"],
      [2, "other"],
      [3, "other"],
      [3, "other"],
      [4, "other"],
    ]);
  });

  test("reads JSX text and an enum's value", () => {
    expect(
      findAnyWords(
        "Picker.tsx",
        [
          "enum Kind {",
          '  Any = "Any",',
          '  Some = "Some",',
          "}",
          "const element = <option>",
          "  Any",
          "</option>;",
        ].join("\n"),
      ).map((word: AnyWord): [number, AnyWordKind, string | undefined] => {
        return [word.line, word.kind, word.enumName];
      }),
    ).toEqual([
      [2, "enum-value", "Kind"],
      // The line the word is on, after the element's opening tag.
      [6, "other", undefined],
    ]);
  });

  test("leaves longer text, comments and identifiers alone", () => {
    expect(
      findAnyWords(
        "Copy.tsx",
        [
          '// "Any" in a comment',
          'const a = "Any protocol";',
          'const b = "Any type";',
          "const AnyValue = 1;",
          "const c = <span>Any device</span>;",
          "type T = Any;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
