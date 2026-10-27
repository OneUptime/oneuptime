import VMUtil from "../../Server/Utils/VM/VMAPI";
import { createWhatsAppMessageFromTemplate } from "../../Server/Utils/WhatsAppTemplateUtil";
import { checkJsonSyntax } from "../../Types/Code/JsonSyntax";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";
import WhatsAppTemplateMessages, {
  WhatsAppTemplateId,
  renderWhatsAppTemplate,
} from "../../Types/WhatsApp/WhatsAppTemplates";
import {
  TemplateExpression,
  maskTemplateExpressions,
  parseTemplateExpressions,
} from "../../Types/Workflow/TemplateSyntax";
import { containsTemplateExpression } from "../../UI/Components/Workflow/ColumnEditor/ColumnRowSerialization";
import DataSourceQueryText from "../../Utils/DataSource/DataSourceQueryText";
import {
  TemplatePlaceholder,
  findEachOpening,
  findTemplatePlaceholders,
  hasTemplatePlaceholder,
  replaceLoopVariablePlaceholders,
  replaceTemplatePlaceholders,
} from "../../Utils/TemplatePlaceholders";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { fastestRun } from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * "{{...}}" PLACEHOLDERS ARE FOUND IN TIME IN LINE WITH THE TEXT'S LENGTH,
 * AND EXACTLY WHERE THEY WERE FOUND BEFORE.
 *
 * A workflow's arguments are filled in on the server from the placeholders
 * a project wrote in them, the builder checks the same text in the browser,
 * and a dashboard's legend template and the WhatsApp templates are filled
 * in the same way. Each pattern read on to the end of the line from every
 * "{{" that has no "}}" after it on its line, and was tried again from the
 * next "{{": a line of "{{{{..." held the server up for minutes. Each now
 * takes such a "{{" and the rest of its line in one more alternative that is
 * given back as written, or - for the legend - goes on from the place the
 * next placeholder can start; and each finds exactly what it found.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
const timeOf: (run: () => unknown) => number = (run: () => unknown): number => {
  return fastestRun({ run: run, limitInMs: 2000 }).inMs;
};

const WORST_CASES: Array<[string, string]> = [
  ["openings run together", repeat("{{", LENGTH)],
  ["openings and single closings", repeat("{{}", LENGTH) + "\n"],
  ["a closing on the line before", "}}\n" + repeat("{{", LENGTH)],
  ["loop openings with words", "}}" + repeat("{{#each a ", LENGTH)],
  ["a loop opening and white space", "}}{{#each" + repeat(" ", LENGTH) + "x"],
  ["loop openings across lines", "}}" + repeat("{{#each\n", LENGTH)],
  ["openings of three braces", repeat("{{{", LENGTH)],
];

describe("placeholders are found in time in line with the text's length", () => {
  test.each(WORST_CASES)("%s", (_label: string, text: string) => {
    expect(
      timeOf(() => {
        findTemplatePlaceholders(text);
        hasTemplatePlaceholder(text);
        replaceTemplatePlaceholders(text, () => {
          return "x";
        });
        replaceLoopVariablePlaceholders(text, () => {
          return "x";
        });

        let from: number = 0;

        for (let count: number = 0; count < 200; count++) {
          const opening: TemplatePlaceholder | null = findEachOpening(
            text,
            from,
          );

          if (!opening) {
            break;
          }

          from = opening.end;
        }
      }),
    ).toBeLessThan(2000);
  });

  test.each(WORST_CASES)(
    "%s, through every reader of placeholders",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          parseTemplateExpressions(text);
          maskTemplateExpressions(text);
          containsTemplateExpression(text);
          checkJsonSyntax(text);
          DataSourceQueryText.applyLegendTemplate(text, { job: "api" });
        }),
      ).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "%s, through a workflow run's filling of an argument",
    (_label: string, text: string) => {
      expect(
        timeOf(() => {
          VMUtil.replaceValueInPlace(
            { local: { variables: { a: "A" } } },
            text,
            false,
          );
        }),
      ).toBeLessThan(2000);
    },
  );
});

describe("placeholders are found as they were", () => {
  test("two on a line are two, and each one's text is what stands between its braces", () => {
    expect(findTemplatePlaceholders("{{a}} and {{ b }}")).toEqual([
      { start: 0, end: 5, text: "{{a}}", inner: "a" },
      { start: 10, end: 17, text: "{{ b }}", inner: " b " },
    ]);
  });

  test("an opening with no closing on its line is no placeholder, nor is anything after it on that line", () => {
    expect(findTemplatePlaceholders("{{a {{b\n{{c}}")).toEqual([
      { start: 8, end: 13, text: "{{c}}", inner: "c" },
    ]);
    expect(hasTemplatePlaceholder("{{a\n}}")).toBe(false);
  });

  test("what replace gives is placed as it is, $ and all", () => {
    expect(
      replaceTemplatePlaceholders("x {{a}} y", () => {
        return "$& $1";
      }),
    ).toBe("x $& $1 y");
  });

  test("a loop's own tags are not loop variables, and the search goes on right after them", () => {
    expect(
      replaceLoopVariablePlaceholders(
        "{{#each items}}{{name}}{{/each}} {{@index}} {{this}}",
        (placeholder: TemplatePlaceholder) => {
          return `<${placeholder.inner}>`;
        },
      ),
    ).toBe("{{#each items}}<name>{{/each}} {{@index}} <this>");
  });

  test("a loop opening whose white space runs on to the next line is found there", () => {
    expect(findEachOpening("{{#each a {{#each\nb}}", 0)).toEqual({
      start: 10,
      end: 21,
      text: "{{#each\nb}}",
      inner: "b",
    });
  });

  test("an argument is filled as before", () => {
    expect(
      VMUtil.replaceValueInPlace(
        { local: { variables: { a: "A", list: [{ n: 1 }, { n: 2 }] } } },
        "a={{local.variables.a}} {{#each local.variables.list}}[{{n}}]{{/each}} {{missing}}",
        false,
      ),
    ).toBe("a=A [1][2] {{missing}}");
  });

  test("an expression is parsed as before, with where it stands", () => {
    const expressions: Array<TemplateExpression> = parseTemplateExpressions(
      "{{#each local.variables.list}}{{ name }}{{/each}}",
    );

    expect(
      expressions.map((expression: TemplateExpression) => {
        return [
          expression.raw,
          expression.inner,
          expression.startIndex,
          expression.endIndex,
          expression.isInsideEachBlock,
        ];
      }),
    ).toEqual([
      [
        "{{#each local.variables.list}}",
        "#each local.variables.list",
        0,
        30,
        false,
      ],
      ["{{ name }}", "name", 30, 40, true],
      ["{{/each}}", "/each", 40, 49, false],
    ]);
  });

  test("every WhatsApp template renders as it rendered", () => {
    for (const templateId of Object.keys(
      WhatsAppTemplateMessages,
    ) as Array<WhatsAppTemplateId>) {
      const template: string = WhatsAppTemplateMessages[templateId]!;
      const variables: Record<string, string> = {};

      for (const match of template.matchAll(/\{\{(.*?)\}\}/g)) {
        variables[match[1]!] = `<${match[1]}>`;
      }

      const before: string = template.replace(
        /\{\{(.*?)\}\}/g,
        (_whole: string, key: string): string => {
          return variables[key]!;
        },
      );

      expect({
        templateId,
        rendered: renderWhatsAppTemplate(templateId, variables),
      }).toEqual({ templateId, rendered: before });

      // The message a notification sends, its dashboard link filled in.
      const message: WhatsAppMessagePayload = createWhatsAppMessageFromTemplate(
        {
          templateKey: templateId,
          templateVariables: variables,
        },
      );

      expect({ templateId, body: message.body }).toEqual({
        templateId,
        body: template.replace(
          /\{\{(.*?)\}\}/g,
          (_whole: string, key: string): string => {
            return message.templateVariables?.[key] ?? "";
          },
        ),
      });
    }
  });
});

/*
 * The patterns as they were: the reference each reader must agree with on
 * texts drawn from the pieces they react to.
 */
const ALPHABET: ReadonlyArray<string> = [
  "{{",
  "{{",
  "}}",
  "}}",
  "{",
  "}",
  "a",
  "b c",
  " ",
  "  ",
  "\t",
  "\n",
  "\r",
  "\u2028",
  "#each",
  "#each ",
  "{{#each ",
  "{{#each",
  "/each",
  "{{/each}}",
  "@index",
  "{{@index}}",
  "x.y",
  "$1",
  "$&",
];

const PLACEHOLDER_BEFORE: RegExp = /{{(.*?)}}/g;
const LOOP_VARIABLE_BEFORE: RegExp =
  /\{\{((?!#each\b|\/each\b|@index\b).*?)\}\}/g;
const EACH_OPENING_BEFORE: RegExp = /\{\{#each\s+(.*?)\}\}/g;
const LEGEND_BEFORE: RegExp = /\{\{\s*([^}\s]+)\s*\}\}/g;

const placeholdersBefore: (
  pattern: RegExp,
  text: string,
) => Array<TemplatePlaceholder> = (
  pattern: RegExp,
  text: string,
): Array<TemplatePlaceholder> => {
  return Array.from(text.matchAll(new RegExp(pattern.source, "g"))).map(
    (match: RegExpMatchArray): TemplatePlaceholder => {
      return {
        start: match.index!,
        end: match.index! + match[0].length,
        text: match[0],
        inner: match[1]!,
      };
    },
  );
};

const marked: (placeholder: TemplatePlaceholder) => string = (
  placeholder: TemplatePlaceholder,
): string => {
  return `<${placeholder.start}|${placeholder.inner}|${placeholder.text.length}>`;
};

describe("each reader finds exactly what its pattern found", () => {
  const texts: Array<string> = generatedTexts(30000, 1357, ALPHABET, 16);

  test("placeholders, found and replaced", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];
    let found: number = 0;

    for (const text of texts) {
      const before: Array<TemplatePlaceholder> = placeholdersBefore(
        PLACEHOLDER_BEFORE,
        text,
      );
      const replacedBefore: string = text.replace(
        new RegExp(PLACEHOLDER_BEFORE.source, "g"),
        (whole: string, inner: string, offset: number): string => {
          return marked({
            start: offset,
            end: offset + whole.length,
            text: whole,
            inner: inner,
          });
        },
      );

      found += before.length;

      const now: string = JSON.stringify([
        findTemplatePlaceholders(text),
        hasTemplatePlaceholder(text),
        replaceTemplatePlaceholders(text, marked),
      ]);
      const expected: string = JSON.stringify([
        before,
        before.length > 0,
        replacedBefore,
      ]);

      if (now !== expected) {
        mismatches.push({ text, now, before: expected });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(found).toBeGreaterThan(10000);
  });

  test("a loop body's names", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];

    for (const text of texts) {
      const before: string = text.replace(
        new RegExp(LOOP_VARIABLE_BEFORE.source, "g"),
        (whole: string, inner: string, offset: number): string => {
          return marked({
            start: offset,
            end: offset + whole.length,
            text: whole,
            inner: inner,
          });
        },
      );
      const now: string = replaceLoopVariablePlaceholders(text, marked);

      if (now !== before) {
        mismatches.push({ text, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  test("a loop's opening, searched for from every place", () => {
    const mismatches: Array<{ text: string; now: string; before: string }> = [];

    for (const text of texts.slice(0, 10000)) {
      for (let from: number = 0; from <= text.length; from++) {
        const pattern: RegExp = new RegExp(EACH_OPENING_BEFORE.source, "g");

        pattern.lastIndex = from;

        const match: RegExpExecArray | null = pattern.exec(text);
        const before: string = JSON.stringify(
          match
            ? {
                start: match.index,
                end: match.index + match[0].length,
                text: match[0],
                inner: match[1],
              }
            : null,
        );
        const now: string = JSON.stringify(findEachOpening(text, from));

        if (now !== before) {
          mismatches.push({ text: `${from}: ${text}`, now, before });
        }
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  test("a legend's names", () => {
    const attributes: Record<string, string> = {
      a: "A",
      "x.y": "XY",
      "{": "BRACE",
      "{{": "BRACES",
      "#each": "EACH",
      $1: "DOLLAR",
    };
    const mismatches: Array<{ text: string; now: string; before: string }> = [];
    let replaced: number = 0;

    for (const text of texts) {
      const before: string = text.replace(
        new RegExp(LEGEND_BEFORE.source, "g"),
        (_whole: string, key: string): string => {
          const value: string | undefined = attributes[key];
          return value === undefined || value === "" ? "(unset)" : value;
        },
      );
      const now: string = DataSourceQueryText.applyLegendTemplate(
        text,
        attributes,
      );

      if (before !== text) {
        replaced++;
      }

      if (now !== before) {
        mismatches.push({ text, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(replaced).toBeGreaterThan(5000);
  });
});
