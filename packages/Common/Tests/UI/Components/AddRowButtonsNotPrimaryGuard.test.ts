// UX rule: Docs/ux/README.md#cards-and-the-look-of-a-page
import {
  CORE_FRONTEND_DIRECTORIES,
  REPOSITORY_ROOT,
  listFrontendFiles,
} from "../../Helpers/HandDrawnButtonLookScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A BUTTON THAT ADDS A ROW TO A BUILDER NEVER LOOKS LIKE THE FORM'S ACTION.
 *
 * Add condition, Add filter, Add criteria and Add row put one more line
 * into a list the person is building; they are a step inside the form, not
 * what the form is for. A rule's Applies to step drew Add condition as the
 * tinted indigo SECONDARY button, under a footer whose Next is (rightly)
 * not primary - so the one coloured button on the screen was the one that
 * did the least, and it read as the dialog's main action (#9116).
 *
 * So an add-row button is an outline button (ButtonStyleType.OUTLINE, as
 * the rule builder's, the filter builders' and the workspace rules' are),
 * a link, or the plain bordered NORMAL button - never a filled or tinted
 * one (PRIMARY, SECONDARY, SUCCESS, WARNING, DANGER).
 *
 * It reads every <Button> in the frontends whose title is one of those
 * words ("Add condition", "Add Filter", RuleCriteriaCopy.addCondition) and
 * the style it is given; no buttonStyle is NORMAL, Button's default. To
 * list an exception, add its file to ALLOWED with the reason - there
 * should not be one.
 */

const ADD_ROW_TITLE: RegExp =
  /^Add (condition|conditions|filter|filters|criteria|criterion|row|rows)$/i;

// A title given as a constant: the rule builder's.
const ADD_ROW_TITLE_CONSTANTS: ReadonlyArray<string> = [
  "RuleCriteriaCopy.addCondition",
];

const FILLED_STYLES: ReadonlyArray<string> = ["PRIMARY", "DANGER"];

// file -> why its add-row button may be filled. None today.
const ALLOWED: Record<string, string> = {};

export interface AddRowButton {
  file: string;
  line: number;
  title: string;
  // ButtonStyleType's member, or NORMAL when none is given.
  style: string;
}

/*
 * The text of each <Button ...> opening tag: from "<Button" to the ">" or
 * "/>" that closes it, skipping what is inside {...} (arrow functions'
 * "=>", comparisons) and inside quotes.
 */
export function buttonTags(
  source: string,
): Array<{ text: string; index: number }> {
  const tags: Array<{ text: string; index: number }> = [];
  const opening: RegExp = /<Button(?=[\s/>])/g;
  let match: RegExpExecArray | null = opening.exec(source);

  while (match) {
    let depth: number = 0;
    let quote: string | null = null;
    let end: number = -1;

    for (let i: number = match.index + 1; i < source.length; i++) {
      const char: string = source[i] as string;

      if (quote) {
        if (char === quote) {
          quote = null;
        }
        continue;
      }

      if (char === '"' || char === "'" || char === "`") {
        quote = char;
      } else if (char === "{") {
        depth++;
      } else if (char === "}") {
        depth--;
      } else if (char === ">" && depth === 0) {
        end = i;
        break;
      }
    }

    if (end > 0) {
      tags.push({
        text: source.slice(match.index, end + 1),
        index: match.index,
      });
    }

    match = opening.exec(source);
  }

  return tags;
}

// The add-row buttons in one file, with the style each is drawn in.
export function findAddRowButtons(
  file: string,
  source: string,
): Array<AddRowButton> {
  const found: Array<AddRowButton> = [];

  for (const tag of buttonTags(source)) {
    const literal: RegExpMatchArray | null = tag.text.match(
      /\stitle=(?:"([^"]*)"|\{\s*"([^"]*)"\s*\})/,
    );
    const constant: RegExpMatchArray | null = tag.text.match(
      /\stitle=\{\s*([\w.]+)\s*\}/,
    );
    const title: string | undefined =
      literal?.[1] ?? literal?.[2] ?? constant?.[1];

    if (
      !title ||
      !(
        ADD_ROW_TITLE.test(title.trim()) ||
        ADD_ROW_TITLE_CONSTANTS.includes(title)
      )
    ) {
      continue;
    }

    const style: RegExpMatchArray | null = tag.text.match(
      /\sbuttonStyle=\{\s*ButtonStyleType\.(\w+)\s*\}/,
    );

    found.push({
      file: file,
      line: source.slice(0, tag.index).split("\n").length,
      title: title,
      style: style?.[1] || "NORMAL",
    });
  }

  return found;
}

const isFilled: (button: AddRowButton) => boolean = (
  button: AddRowButton,
): boolean => {
  return FILLED_STYLES.includes(button.style);
};

describe("the guard reads a <Button>", () => {
  test("an add-row button's title and style, with arrow functions in its props", () => {
    const source: string = [
      "<Button",
      '  title="Add condition"',
      "  onClick={() => { if (a > b) { add(); } }}",
      "  buttonStyle={ButtonStyleType.PRIMARY}",
      "/>",
    ].join("\n");

    expect(findAddRowButtons("x.tsx", source)).toEqual([
      { file: "x.tsx", line: 1, title: "Add condition", style: "PRIMARY" },
    ]);
  });

  test("no buttonStyle is NORMAL, Button's default", () => {
    expect(
      findAddRowButtons("x.tsx", '<Button title="Add Filter" />')[0]?.style,
    ).toBe("NORMAL");
  });

  test("the rule builder's title, given as its constant", () => {
    expect(
      findAddRowButtons(
        "x.tsx",
        "<Button title={RuleCriteriaCopy.addCondition} buttonStyle={ButtonStyleType.OUTLINE} />",
      ),
    ).toEqual([
      {
        file: "x.tsx",
        line: 1,
        title: "RuleCriteriaCopy.addCondition",
        style: "OUTLINE",
      },
    ]);
  });

  test("not a button that adds a record of its own, nor one that is not a <Button>", () => {
    expect(
      findAddRowButtons(
        "x.tsx",
        [
          '<Button title="Add Monitor" buttonStyle={ButtonStyleType.PRIMARY} />',
          '<ButtonGroup title="Add condition" />',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("a filled or tinted style is caught; outline, link and plain are not", () => {
    const styleOf: (style: string) => boolean = (style: string): boolean => {
      return isFilled({ file: "", line: 1, title: "", style: style });
    };

    for (const style of FILLED_STYLES) {
      expect([style, styleOf(style)]).toEqual([style, true]);
    }

    for (const style of ["OUTLINE", "LINK", "SECONDARY_LINK", "NORMAL"]) {
      expect([style, styleOf(style)]).toEqual([style, false]);
    }
  });
});

describe("no add-row button looks like the form's action", () => {
  const buttons: Array<AddRowButton> = CORE_FRONTEND_DIRECTORIES.flatMap(
    (directory: string): Array<string> => {
      return listFrontendFiles(directory);
    },
  )
    .filter((file: string): boolean => {
      return file.endsWith(".tsx");
    })
    .flatMap((file: string): Array<AddRowButton> => {
      return findAddRowButtons(
        file,
        fs.readFileSync(path.join(REPOSITORY_ROOT, file), "utf8"),
      );
    });

  test("it reads the builders it is about", () => {
    const files: Array<string> = buttons.map((button: AddRowButton) => {
      return button.file;
    });

    for (const file of [
      "packages/Common/UI/Components/RuleCriteria/RuleCriteriaBuilder.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/Workspace/NotificationRuleForm/NotificationRuleConditions.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryBuilderField.tsx",
      "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateFilterBuilder.tsx",
    ]) {
      expect([file, files.includes(file)]).toEqual([file, true]);
    }
  });

  test("none is filled or tinted", () => {
    const filled: Array<string> = buttons
      .filter((button: AddRowButton): boolean => {
        return isFilled(button) && !ALLOWED[button.file];
      })
      .map((button: AddRowButton): string => {
        return `${button.file}:${button.line} "${button.title}" is ButtonStyleType.${button.style}; draw it with ButtonStyleType.OUTLINE`;
      });

    expect(filled).toEqual([]);
  });

  test("the rule builder's Add condition is an outline button (#9116)", () => {
    const ruleBuilder: Array<AddRowButton> = buttons.filter(
      (button: AddRowButton): boolean => {
        return button.file.endsWith("RuleCriteria/RuleCriteriaBuilder.tsx");
      },
    );

    expect(
      ruleBuilder.map((button: AddRowButton): string => {
        return button.style;
      }),
    ).toEqual(["OUTLINE"]);
  });
});
