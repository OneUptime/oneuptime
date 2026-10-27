import {
  listScanRoots,
  listSourceFiles,
  toRelativePath,
} from "../ForeignHiddenRuleGuard";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * SEARCH AND FILTER BOXES NEVER HOLD A NEW VERSION BACK.
 *
 * When a new version of OneUptime is deployed under an open page, the next
 * page the reader opens loads it in full, and the Reload the notice offers
 * goes straight ahead - unless the page holds something the reader typed
 * and has not saved (Common/UI/Utils/NewVersion/UnsavedChanges), which a
 * reload would throw away. What is typed into a search or a filter box is a
 * query, never work to keep, so such a box says so: it carries
 * data-unsaved-changes-ignore (Common's Input writes it for
 * isSearchOrFilter), or it is an input of type search or a searchbox, and
 * UnsavedChanges leaves it out.
 *
 * This reads every box the frontends draw - their src, Common's UI and,
 * when the checkout has it, ee - and finds the ones that read as a search
 * or a filter: a placeholder or label that starts with Search, Filter or
 * Find or names a search, a test id or id that names a search, or a
 * combobox, whose text only finds an option to pick. Each one must say so.
 * A box that reads like one but holds a value someone is writing goes in
 * HOLDS_A_VALUE with why; the list fails when an entry stops matching, so
 * it cannot outlive the code it excuses.
 */

// packages/Common/Tests/UI -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const IGNORE_ATTRIBUTE: string = "data-unsaved-changes-ignore";

// Input's prop that writes IGNORE_ATTRIBUTE (Common/UI/Components/Input).
const INPUT_PROP: string = "isSearchOrFilter";

// The elements a reader types into: the DOM's own, and Common's Input.
const BOX_TAGS: ReadonlySet<string> = new Set<string>(["input", "Input"]);

// Inputs that hold no text of their own: nothing to type, nothing to hold.
const UNTYPED_INPUT_TYPES: ReadonlySet<string> = new Set<string>([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

const LABEL_ATTRIBUTES: ReadonlyArray<string> = [
  "placeholder",
  "aria-label",
  "ariaLabel",
];

const ID_ATTRIBUTES: ReadonlyArray<string> = [
  "data-testid",
  "dataTestId",
  "id",
];

// Words a search or a filter box starts its label with.
const SEARCH_LABEL_START_REGEX: RegExp = /^\s*(search|filter|find)\b/i;

const SEARCH_WORD_REGEX: RegExp = /search/i;

// A filter's own placeholder, made for it (Filters/FilterPlaceholder).
const FILTER_PLACEHOLDER_REGEX: RegExp = /FilterPlaceholder\b/;

const WHITESPACE_REGEX: RegExp = /\s+/g;

interface HeldValue {
  // How many boxes in the file read like a search and are not one.
  count: number;
  reason: string;
}

const HOLDS_A_VALUE: Record<string, HeldValue> = {
  "packages/Common/UI/Components/AutocompleteTextInput/AutocompleteTextInput.tsx":
    {
      count: 1,
      reason:
        "A combobox whose text is the value itself: suggestions only help write it (a label's name, a key), so what is typed is the reader's work.",
    },
};

interface Box {
  file: string;
  line: number;
  tag: string;
  // Why it reads as a search or a filter box; empty when it does not.
  signals: Array<string>;
  // It says it is one (IGNORE_ATTRIBUTE, isSearchOrFilter, type search, a searchbox).
  isMarked: boolean;
}

const getAttributes: (
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
) => Map<string, ts.JsxAttribute> = (
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): Map<string, ts.JsxAttribute> => {
  const attributes: Map<string, ts.JsxAttribute> = new Map<
    string,
    ts.JsxAttribute
  >();

  for (const property of node.attributes.properties) {
    if (ts.isJsxAttribute(property)) {
      attributes.set(property.name.getText(), property);
    }
  }

  return attributes;
};

// Every piece of text written in an attribute's value: its strings and templates.
const getWrittenTexts: (
  attribute: ts.JsxAttribute | undefined,
) => Array<string> = (
  attribute: ts.JsxAttribute | undefined,
): Array<string> => {
  const texts: Array<string> = [];

  if (!attribute || !attribute.initializer) {
    return texts;
  }

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      texts.push(
        node.head.text +
          node.templateSpans
            .map((span: ts.TemplateSpan): string => {
              return "${}" + span.literal.text;
            })
            .join(""),
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(attribute.initializer);

  return texts;
};

const getSource: (attribute: ts.JsxAttribute | undefined) => string = (
  attribute: ts.JsxAttribute | undefined,
): string => {
  return attribute && attribute.initializer
    ? attribute.initializer.getText()
    : "";
};

// The value of an attribute written as plain text (type="search"), else "".
const getPlainValue: (attribute: ts.JsxAttribute | undefined) => string = (
  attribute: ts.JsxAttribute | undefined,
): string => {
  if (!attribute || !attribute.initializer) {
    return "";
  }

  let initializer: ts.Node = attribute.initializer;

  if (ts.isJsxExpression(initializer) && initializer.expression) {
    initializer = initializer.expression;
  }

  return ts.isStringLiteral(initializer) ||
    ts.isNoSubstitutionTemplateLiteral(initializer)
    ? initializer.text.toLowerCase()
    : "";
};

const describeBox: (
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
) => Box = (
  file: string,
  sourceFile: ts.SourceFile,
  node: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
): Box => {
  const attributes: Map<string, ts.JsxAttribute> = getAttributes(node);
  const type: string = getPlainValue(attributes.get("type"));
  const role: string = getPlainValue(attributes.get("role"));
  const signals: Array<string> = [];

  if (role === "combobox") {
    signals.push("a combobox");
  }

  for (const name of LABEL_ATTRIBUTES) {
    const attribute: ts.JsxAttribute | undefined = attributes.get(name);

    for (const text of getWrittenTexts(attribute)) {
      if (SEARCH_LABEL_START_REGEX.test(text)) {
        signals.push(`${name} "${text}"`);
      }
    }

    const source: string = getSource(attribute);

    if (
      source &&
      (SEARCH_WORD_REGEX.test(source) || FILTER_PLACEHOLDER_REGEX.test(source))
    ) {
      signals.push(
        `${name} ${source.replace(WHITESPACE_REGEX, " ").slice(0, 80)}`,
      );
    }
  }

  for (const name of ID_ATTRIBUTES) {
    for (const text of getWrittenTexts(attributes.get(name))) {
      if (SEARCH_WORD_REGEX.test(text)) {
        signals.push(`${name} "${text}"`);
      }
    }
  }

  const isMarked: boolean =
    attributes.has(IGNORE_ATTRIBUTE) ||
    (attributes.has(INPUT_PROP) &&
      getSource(attributes.get(INPUT_PROP)) !== "{false}") ||
    type === "search" ||
    role === "searchbox";

  return {
    file: file,
    line:
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1,
    tag: node.tagName.getText(sourceFile),
    signals: UNTYPED_INPUT_TYPES.has(type) ? [] : Array.from(new Set(signals)),
    isMarked: isMarked,
  };
};

let cachedBoxes: Array<Box> | null = null;

// Every <input> and <Input> the frontends draw.
const getBoxes: () => Array<Box> = (): Array<Box> => {
  if (cachedBoxes) {
    return cachedBoxes;
  }

  const boxes: Array<Box> = [];

  const files: Array<string> = listScanRoots(REPOSITORY_ROOT)
    .flatMap(listSourceFiles)
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .sort();

  for (const fullPath of files) {
    const text: string = fs.readFileSync(fullPath, "utf8");

    if (!text.includes("<input") && !text.includes("<Input")) {
      continue;
    }

    const file: string = toRelativePath(REPOSITORY_ROOT, fullPath);
    const sourceFile: ts.SourceFile = ts.createSourceFile(
      fullPath,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        BOX_TAGS.has(node.tagName.getText(sourceFile))
      ) {
        boxes.push(describeBox(file, sourceFile, node));
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  cachedBoxes = boxes;

  return boxes;
};

const isEnterpriseCheckout: () => boolean = (): boolean => {
  return fs.existsSync(path.join(REPOSITORY_ROOT, "ee"));
};

describe("SearchBoxesNeverUnsavedGuard", () => {
  test("reads the frontends' boxes (the scan is not empty)", () => {
    const boxes: Array<Box> = getBoxes();

    expect(boxes.length).toBeGreaterThan(200);
    expect(
      boxes.filter((box: Box): boolean => {
        return box.signals.length > 0;
      }).length,
    ).toBeGreaterThan(60);
  });

  test("every box that reads as a search or a filter says so", () => {
    const unmarked: Array<string> = getBoxes()
      .filter((box: Box): boolean => {
        return (
          box.signals.length > 0 && !box.isMarked && !HOLDS_A_VALUE[box.file]
        );
      })
      .map((box: Box): string => {
        return `${box.file}:${box.line} <${box.tag}> reads as a search or a filter (${box.signals.join("; ")}): add ${box.tag === "Input" ? `${INPUT_PROP}={true}` : IGNORE_ATTRIBUTE}, or list it in HOLDS_A_VALUE with why it holds a value`;
      });

    expect(unmarked).toEqual([]);
  });

  test("HOLDS_A_VALUE lists only boxes that still read like a search and hold a value", () => {
    const stale: Array<string> = [];

    for (const file of Object.keys(HOLDS_A_VALUE)) {
      const held: HeldValue = HOLDS_A_VALUE[file]!;
      const count: number = getBoxes().filter((box: Box): boolean => {
        return box.file === file && box.signals.length > 0 && !box.isMarked;
      }).length;

      if (!fs.existsSync(path.join(REPOSITORY_ROOT, file))) {
        if (file.startsWith("ee/") && !isEnterpriseCheckout()) {
          continue;
        }

        stale.push(`${file} no longer exists`);
        continue;
      }

      if (count !== held.count) {
        stale.push(
          `${file}: ${count} unmarked search-like boxes, the list says ${held.count}`,
        );
      }

      expect(held.reason.length).toBeGreaterThan(40);
    }

    expect(stale).toEqual([]);
  });

  /*
   * The shared pieces many boxes are drawn with: a table's filters, a
   * dropdown's own search and Common's Input itself.
   */
  test("a table's filters say so for every box under them", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/UI/Components/Filters/FiltersForm.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(`<div id={props.id} ${IGNORE_ATTRIBUTE}>`);
  });

  test("a dropdown's own search says so", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/UI/Components/Dropdown/Dropdown.tsx",
      ),
      "utf8",
    );
    const start: number = source.indexOf("<ReactSelectComponents.Input");
    const end: number = source.indexOf("/>", start);

    expect(start).toBeGreaterThan(-1);
    expect(source.slice(start, end)).toContain(IGNORE_ATTRIBUTE);
  });

  test("Common's Input writes the attribute for isSearchOrFilter", () => {
    const source: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "packages/Common/UI/Components/Input/Input.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      `${IGNORE_ATTRIBUTE}={props.${INPUT_PROP} || undefined}`,
    );
  });
});
