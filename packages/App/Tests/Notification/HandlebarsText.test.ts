import { afterEach, describe, expect, test } from "@jest/globals";
import Handlebars from "handlebars";
import HandlebarsText, {
  LONG_TEMPLATE_RUN_KEPT_LENGTH,
  LONG_TEMPLATE_RUN_LENGTH,
} from "../../FeatureSet/Notification/Utils/HandlebarsText";

/*
 * A BODY OF THE SENDER'S OWN IS RENDERED AS HANDLEBARS RENDERS IT, WITHOUT
 * HANDLEBARS READING ITS LONG RUNS OF PLAIN TEXT.
 *
 * Handlebars runs out of stack on a few megabytes of plain text in a process
 * that compiles its regular expressions unoptimized (the case
 * HandlebarsTextInLongRunningProcess runs). So HandlebarsText holds back the
 * middle of every run of plain text longer than LONG_TEMPLATE_RUN_LENGTH and
 * writes it back into what Handlebars rendered. Here, at sizes Handlebars
 * still reads in this process, every template renders byte for byte as
 * Handlebars.compile(template)(vars) renders it - through blocks, loops,
 * whitespace control, standalone lines, escapes, comments, raw blocks and
 * quoted "}}" - while Handlebars itself only ever reads short runs.
 */

const LONG: number = LONG_TEMPLATE_RUN_LENGTH + 5000;

// A run of plain text of `length` characters that reads differently everywhere.
function plain(length: number, seed: string): string {
  const parts: Array<string> = [];
  let size: number = 0;
  let line: number = 0;

  while (size < length) {
    const part: string = `${seed} line ${line} < & " ' > text. `;
    parts.push(part);
    size += part.length;
    line++;
  }

  return parts.join("").slice(0, length);
}

const VARS: Record<string, unknown> = {
  name: "Ada <Lovelace>",
  html: "<b>bold</b>",
  yes: true,
  no: false,
  items: ["one", "two", "three"],
  map: { "key}}x": "quoted key", "weird}}name": "segment" },
  "weird}}name": "segment",
};

/*
 * The longest run of plain text in what Handlebars was given: the most
 * Handlebars ever had to read in one go.
 */
function longestRun(template: string): number {
  return HandlebarsText.findPlainRuns(template).reduce(
    (longest: number, [start, end]: [number, number]): number => {
      return Math.max(longest, end - start);
    },
    0,
  );
}

interface Case {
  name: string;
  template: string;
}

const CASES: Array<Case> = [
  {
    name: "long runs around a variable",
    template: `<p>${plain(LONG, "a")}</p><p>{{name}}</p>${plain(LONG, "b")}`,
  },
  {
    name: "a long run in a block that renders, and one in its else",
    template: `{{#if yes}}${plain(LONG, "c")}{{else}}${plain(LONG, "d")}{{/if}}`,
  },
  {
    name: "a long run in a block that does not render",
    template: `start {{#if no}}${plain(LONG, "e")}{{/if}} end`,
  },
  {
    name: "a long run in a loop, rendered once per item",
    template: `{{#each items}}[{{this}}] ${plain(LONG, "f")}{{/each}}`,
  },
  {
    name: "whitespace control trims whitespace longer than what a run keeps",
    template: `${plain(LONG, "g")}${" \n\t".repeat(LONG_TEMPLATE_RUN_KEPT_LENGTH)}{{~name~}}${"\n \t".repeat(LONG_TEMPLATE_RUN_KEPT_LENGTH)}${plain(LONG, "h")}`,
  },
  {
    name: "blocks on lines of their own drop those lines",
    template: `${plain(LONG, "i")}\n{{#if yes}}\n${plain(LONG, "j")}\n{{/if}}\n${plain(LONG, "k")}`,
  },
  {
    name: "blocks on lines of their own, with CRLF line ends",
    template: `${plain(LONG, "l")}\r\n  {{#each items}}\r\n${plain(LONG, "m")}\r\n  {{/each}}\r\n${plain(LONG, "n")}`,
  },
  {
    name: "an escaped mustache stays text",
    template: `${plain(LONG, "o")}\\{{name}}${plain(LONG, "p")}{{name}}`,
  },
  {
    name: "comments, one holding '}}', between long runs",
    template: `${plain(LONG, "q")}{{!-- a }} comment ${plain(LONG, "r")} --}}{{! short }}${plain(LONG, "s")}`,
  },
  {
    name: "a triple-stash between long runs",
    template: `${plain(LONG, "t")}{{{html}}}${plain(LONG, "u")}`,
  },
  {
    name: "a quoted '}}' and a [segment] with '}}' inside mustaches",
    template: `${plain(LONG, "v")}{{lookup map "key}}x"}}${plain(LONG, "w")}{{[weird}}name]}}${plain(LONG, "x")}`,
  },
  {
    name: "text that looks like a token is left alone",
    template: `heldbackdeadbeefdeadbeefn0x ${plain(LONG, "y")}{{name}} heldback0x`,
  },
];

describe("HandlebarsText.render", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a text with no mustache is itself, and is never compiled", () => {
    const compile: jest.SpyInstance = jest.spyOn(Handlebars, "compile");
    const text: string = `<p>${plain(4 * LONG, "z")} }} { } \\</p>`;

    expect(HandlebarsText.render(text, VARS)).toBe(text);
    expect(compile).not.toHaveBeenCalled();
  });

  for (const testCase of CASES) {
    test(`renders as Handlebars does: ${testCase.name}`, () => {
      const expected: string = Handlebars.compile(testCase.template)(VARS);
      const compile: jest.SpyInstance = jest.spyOn(Handlebars, "compile");

      const rendered: string = HandlebarsText.render(testCase.template, VARS);

      expect(rendered.length).toBe(expected.length);
      expect(rendered === expected).toBe(true);

      // Handlebars read the template with its long runs held back.
      expect(compile).toHaveBeenCalledTimes(1);
      const read: string = compile.mock.calls[0]![0] as string;
      expect(read.length).toBeLessThan(testCase.template.length);
      expect(longestRun(read)).toBeLessThanOrEqual(LONG_TEMPLATE_RUN_LENGTH);
    });
  }

  test("a run no longer than LONG_TEMPLATE_RUN_LENGTH is read as it is", () => {
    const atTheLimit: string = `{{name}}${plain(LONG_TEMPLATE_RUN_LENGTH, "at")}{{name}}`;
    const overIt: string = `{{name}}${plain(LONG_TEMPLATE_RUN_LENGTH + 1, "over")}{{name}}`;

    expect(HandlebarsText.holdBackLongRuns(atTheLimit).heldBack).toEqual([]);
    expect(HandlebarsText.holdBackLongRuns(overIt).heldBack).toHaveLength(1);
  });

  test("a held-back run keeps its whitespace and its first and last characters", () => {
    // Four whitespace characters before the text, three after it.
    const run: string = `\n\n  ${plain(LONG, "keep")}!  \n`;
    const held: ReturnType<typeof HandlebarsText.holdBackLongRuns> =
      HandlebarsText.holdBackLongRuns(`{{name}}${run}{{name}}`);

    expect(held.heldBack).toHaveLength(1);

    const kept: Array<string> = held.template
      .slice("{{name}}".length, -"{{name}}".length)
      .split(new RegExp(`${held.prefix}0x`));

    expect(kept[0]).toBe(run.slice(0, 4 + LONG_TEMPLATE_RUN_KEPT_LENGTH));
    expect(kept[1]).toBe(
      run.slice(run.length - 3 - LONG_TEMPLATE_RUN_KEPT_LENGTH),
    );
    expect(`${kept[0]}${held.heldBack[0]}${kept[1]}`).toBe(run);
  });

  test("a mustache that does not close holds nothing back after it", () => {
    const template: string = `${plain(LONG, "before")}{{name ${plain(LONG, "inside")}`;

    expect(HandlebarsText.findPlainRuns(template)).toEqual([[0, LONG]]);
    expect(() => {
      return HandlebarsText.render(template, VARS);
    }).toThrow();
  });
});
