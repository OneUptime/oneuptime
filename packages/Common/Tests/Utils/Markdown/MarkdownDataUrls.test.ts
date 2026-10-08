import MarkdownDataUrls, {
  DataUrlUse,
  DataUrlUseKind,
  MarkdownDataUrlUses,
  isDataUrl,
} from "../../../Utils/Markdown/MarkdownDataUrls";
import {
  DashboardDataUrls,
  dataUrlUsesAsDashboard,
} from "./DashboardMarkdownDataUrls";
import { describe, expect, test } from "@jest/globals";

/*
 * WHERE A DESCRIPTION USES A data: URL, AS THE DASHBOARD'S PARSER READS IT.
 *
 * A synthetic monitor's screenshot is an image whose address is the image
 * itself, ![Login page](data:image/png;base64,...), and before the same
 * Markdown goes to Slack or Microsoft Teams every such image, link and
 * definition has to be found exactly where a Markdown renderer finds one -
 * and never in a code span or a code block, which stay byte for byte as they
 * were written. These tests pin where MarkdownDataUrls finds them, check it
 * against micromark (the parser of the dashboard and of Slack's conversion)
 * on handwritten and on thousands of generated texts, and hold it to time
 * linear in the length of the text, megabytes of base64 included.
 */

// A real 1x1 PNG, as the probe's Buffer.toString("base64") writes one.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DATA_URL: string = `data:image/png;base64,${PNG}`;

function find(markdown: string): MarkdownDataUrlUses {
  return MarkdownDataUrls.find(markdown);
}

// Each use as [kind, the text it covers].
function usesOf(markdown: string): Array<[DataUrlUseKind, string]> {
  return find(markdown).uses.map(
    (use: DataUrlUse): [DataUrlUseKind, string] => {
      return [use.kind, markdown.slice(use.start, use.end)];
    },
  );
}

// A PNG of this many bytes: the PNG signature, then random-looking bytes.
function pngOfSize(byteLength: number): string {
  const bytes: Buffer = Buffer.alloc(byteLength);

  for (let index: number = 0; index < byteLength; index++) {
    bytes[index] = (index * 7919 + 13) % 256;
  }

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);

  return bytes.toString("base64");
}

describe("MarkdownDataUrls.find - images, links and definitions", () => {
  test("an image on a line of its own: where it is, what it carries, its line", () => {
    const markdown: string = `![Login page](${DATA_URL})`;
    const uses: Array<DataUrlUse> = find(markdown).uses;

    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({
      kind: DataUrlUseKind.Image,
      start: 0,
      end: markdown.length,
      url: DATA_URL,
      text: "Login page",
      topLevelBlockEnd: markdown.length,
      paragraphLine: {
        start: 0,
        end: markdown.length,
        previousLineEnd: null,
        nextLineStart: null,
        nextLineStartsBlock: false,
      },
    });
    expect(uses[0]!.image).toMatchObject({
      mimeType: "image/png",
      base64: PNG,
      byteLength: Buffer.from(PNG, "base64").length,
    });
  });

  test("the issue's template: the image on the paragraph's second line", () => {
    const markdown: string = `Timeout 30000ms exceeded\n![](${DATA_URL})`;
    const use: DataUrlUse = find(markdown).uses[0]!;

    expect(use.text).toBe("");
    expect(use.paragraphLine).toEqual({
      start: 25,
      end: markdown.length,
      previousLineEnd: 24,
      nextLineStart: null,
      nextLineStartsBlock: false,
    });
  });

  test("an image by reference: full, collapsed and shortcut, and the definition", () => {
    const markdown: string = [
      "![Login page][login]",
      "",
      "![Login][]",
      "",
      "![LOGIN]",
      "",
      `[login]: ${DATA_URL}`,
    ].join("\n");

    expect(usesOf(markdown)).toEqual([
      [DataUrlUseKind.Image, "![Login page][login]"],
      [DataUrlUseKind.Image, "![Login][]"],
      [DataUrlUseKind.Image, "![LOGIN]"],
      [DataUrlUseKind.Definition, `[login]: ${DATA_URL}`],
    ]);

    // Every reference takes the definition's address.
    for (const use of find(markdown).uses) {
      expect(use.url).toBe(DATA_URL);
      expect(use.image?.base64).toBe(PNG);
    }
  });

  test("a definition in angle brackets, with a title, on lines of its own", () => {
    const markdown: string = `![shot]\n\n[shot]:\n  <${DATA_URL}>\n  "The login page"\n`;

    expect(usesOf(markdown)).toEqual([
      [DataUrlUseKind.Image, "![shot]"],
      [
        DataUrlUseKind.Definition,
        `[shot]:\n  <${DATA_URL}>\n  "The login page"`,
      ],
    ]);
  });

  test("a link, an autolink and a link by reference to a data: URL", () => {
    const markdown: string = `[Download](${DATA_URL}), <${DATA_URL}> and [the shot][s]\n\n[s]: ${DATA_URL}`;

    expect(usesOf(markdown)).toEqual([
      [DataUrlUseKind.Link, `[Download](${DATA_URL})`],
      [DataUrlUseKind.Autolink, `<${DATA_URL}>`],
      [DataUrlUseKind.Link, "[the shot][s]"],
      [DataUrlUseKind.Definition, `[s]: ${DATA_URL}`],
    ]);
  });

  test("destinations in angle brackets, with titles and white space", () => {
    expect(usesOf(`![a](<${DATA_URL}> "title")`)).toEqual([
      [DataUrlUseKind.Image, `![a](<${DATA_URL}> "title")`],
    ]);
    expect(usesOf(`![a](  ${DATA_URL}  )`)).toEqual([
      [DataUrlUseKind.Image, `![a](  ${DATA_URL}  )`],
    ]);
    expect(usesOf(`![a](${DATA_URL}\n'title')`)).toEqual([
      [DataUrlUseKind.Image, `![a](${DATA_URL}\n'title')`],
    ]);
  });

  test("an image of any other data: URL is found, and carries no inline image", () => {
    const svg: string = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const use: DataUrlUse = find(`![logo](${svg})`).uses[0]!;

    expect(use.kind).toBe(DataUrlUseKind.Image);
    expect(use.url).toBe(svg);
    expect(use.image).toBeNull();
  });

  test("images and links on the web are not uses", () => {
    expect(
      find(
        "![logo](https://example.com/logo.png) [docs](https://example.com) <https://example.com>\n\n[d]: https://example.com",
      ).uses,
    ).toEqual([]);
  });

  test("a text without data: anywhere is not read at all", () => {
    expect(MarkdownDataUrls.mayHaveDataUrl("plain text")).toBe(false);
    expect(MarkdownDataUrls.mayHaveDataUrl(`![x](${DATA_URL})`)).toBe(true);
    expect(MarkdownDataUrls.mayHaveDataUrl(null)).toBe(false);
    expect(find("**bold** and [link](https://example.com)")).toEqual({
      uses: [],
      linkDefinitions: [],
    });
  });

  test("isDataUrl tells a data: URL from any other address", () => {
    expect(isDataUrl(DATA_URL)).toBe(true);
    expect(isDataUrl("DATA:text/plain,hi")).toBe(true);
    expect(isDataUrl("https://example.com/data:x")).toBe(false);
    expect(isDataUrl("")).toBe(false);
  });
});

describe("MarkdownDataUrls.find - never in code", () => {
  test.each([
    ["a code span", `\`![x](${DATA_URL})\``],
    ["a code span of two backticks", `\`\`a \` ![x](${DATA_URL})\`\``],
    ["a fenced code block", "```\n![x](" + DATA_URL + ")\n```"],
    [
      "a fenced code block with an info string",
      "```js\n![x](" + DATA_URL + ")\n```",
    ],
    ["a tilde fence", "~~~\n![x](" + DATA_URL + ")\n~~~"],
    [
      "a fence closed by a longer one",
      "````\n```\n![x](" + DATA_URL + ")\n`````",
    ],
    ["a fence never closed", "```\n![x](" + DATA_URL + ")"],
    ["an indented code block", `    ![x](${DATA_URL})`],
    ["a tab-indented code block", `\t![x](${DATA_URL})`],
    [
      "a fence in a list item",
      "- item\n\n  ```\n  ![x](" + DATA_URL + ")\n  ```",
    ],
    ["a fence in a block quote", "> ```\n> ![x](" + DATA_URL + ")\n> ```"],
    ["an indented code block in a block quote", `>     ![x](${DATA_URL})`],
  ])("%s", (_label: string, markdown: string) => {
    expect(find(markdown).uses).toEqual([]);
  });

  test("an image next to a code span is found, and the code span is not", () => {
    const markdown: string = `\`![x](${DATA_URL})\` and ![y](${DATA_URL})`;

    expect(usesOf(markdown)).toEqual([
      [DataUrlUseKind.Image, `![y](${DATA_URL})`],
    ]);
  });

  test("an unmatched backtick does not start a code span", () => {
    expect(usesOf(`a \` b ![x](${DATA_URL})`)).toEqual([
      [DataUrlUseKind.Image, `![x](${DATA_URL})`],
    ]);
  });

  test("a code span cannot run past its paragraph", () => {
    expect(usesOf(`a \`b\n\n![x](${DATA_URL}) \``)).toEqual([
      [DataUrlUseKind.Image, `![x](${DATA_URL})`],
    ]);
  });

  test("raw HTML hides what is inside it", () => {
    expect(find(`<!-- ![x](${DATA_URL}) -->`).uses).toEqual([]);
    expect(find(`<div>\n![x](${DATA_URL})\n</div>`).uses).toEqual([]);
    expect(find(`a <span title="![x](${DATA_URL})">text</span>`).uses).toEqual(
      [],
    );
    // A backtick in an attribute does not open a code span.
    expect(usesOf(`<a title="\`">x</a> ![y](${DATA_URL}) \``)).toEqual([
      [DataUrlUseKind.Image, `![y](${DATA_URL})`],
    ]);
  });

  test("an escaped ! makes a link of the image", () => {
    expect(usesOf(`\\![x](${DATA_URL})`)).toEqual([
      [DataUrlUseKind.Link, `[x](${DATA_URL})`],
    ]);
  });
});

describe("MarkdownDataUrls.find - text and structure around a use", () => {
  test("alt text and link text as plain text", () => {
    const markdown: string = `![Login \\*page\\* \`code\` ![inner](https://e.example/a.png)](${DATA_URL})`;

    expect(find(markdown).uses[0]!.text).toBe("Login *page* code inner");
  });

  test("an image in a link is found inside the link", () => {
    const markdown: string = `[![Login](${DATA_URL})](${DATA_URL})`;

    expect(usesOf(markdown)).toEqual([
      [DataUrlUseKind.Link, markdown],
      [DataUrlUseKind.Image, `![Login](${DATA_URL})`],
    ]);
    expect(find(markdown).uses[0]!.text).toBe("Login");
  });

  test("an autolink to a data: URL adds nothing to a link's text", () => {
    expect(find(`[a <${DATA_URL}> b](${DATA_URL})`).uses[0]!.text).toBe("a b");
  });

  test("the top-level block a use is in ends after the whole list, quote or table", () => {
    const list: string = `- one ![x](${DATA_URL})\n- two\n\n  more of two\n\nAfter`;
    const quote: string = `> ![x](${DATA_URL})\n> quoted\nlazy\n\nAfter`;
    const table: string = `| a | b |\n|---|---|\n| ![x](${DATA_URL}) | c |\n| d | e |\n\nAfter`;

    expect(find(list).uses[0]!.topLevelBlockEnd).toBe(
      list.indexOf("\n\nAfter"),
    );
    expect(find(quote).uses[0]!.topLevelBlockEnd).toBe(
      quote.indexOf("\n\nAfter"),
    );
    expect(find(table).uses[0]!.topLevelBlockEnd).toBe(
      table.indexOf("\n\nAfter"),
    );

    // Not in a paragraph at the top level: no line of one.
    expect(find(list).uses[0]!.paragraphLine).toBeNull();
    expect(find(quote).uses[0]!.paragraphLine).toBeNull();
    expect(find(table).uses[0]!.paragraphLine).toBeNull();
  });

  test("whether the paragraph's next line would start a block on its own", () => {
    const next: (line: string) => boolean = (line: string): boolean => {
      return find(`![x](${DATA_URL})\n${line}`).uses[0]!.paragraphLine!
        .nextLineStartsBlock;
    };

    expect(next("Some more text")).toBe(false);
    expect(next("2. not a list in the paragraph")).toBe(true);
    expect(next("<span>")).toBe(true);
    expect(next("a | b")).toBe(true);
  });

  test("CRLF and CR line endings", () => {
    const markdown: string = `Timeout\r\n![a](${DATA_URL})\r\n\r\n\`\`\`\r\n![b](${DATA_URL})\r\n\`\`\`\r![c](${DATA_URL})`;

    expect(usesOf(markdown)).toEqual([
      [DataUrlUseKind.Image, `![a](${DATA_URL})`],
      [DataUrlUseKind.Image, `![c](${DATA_URL})`],
    ]);
    expect(find(markdown).uses[0]!.paragraphLine!.previousLineEnd).toBe(7);
  });

  test("the other link reference definitions, in order, with where they are", () => {
    const markdown: string = `[docs][d]\n\n[d]: https://docs.example.com\n> [e]: <https://e.example> "E"\n\n[s]: ${DATA_URL}`;

    expect(find(markdown).linkDefinitions).toEqual([
      {
        start: markdown.indexOf("[d]:"),
        end: markdown.indexOf("\n> [e]"),
        label: "d",
        destination: "https://docs.example.com",
      },
      {
        start: markdown.indexOf("[e]:"),
        end: markdown.indexOf("\n\n[s]"),
        label: "e",
        destination: "<https://e.example>",
      },
    ]);
  });
});

/*
 * THE SAME AS THE DASHBOARD'S PARSER.
 *
 * Handwritten corner cases, then texts put together at random from pieces
 * of Markdown that change what is an image and what is code - fences,
 * backticks, brackets, HTML, containers, line endings - each checked against
 * micromark. A link reference definition is compared by where it starts.
 */

const HANDWRITTEN: Array<string> = [
  `![Login page](${DATA_URL})`,
  `Timeout\n![](${DATA_URL})`,
  `- item\n  \`\`\`\n  ![x](${DATA_URL})\n  \`\`\`\n- ![y](${DATA_URL})`,
  `> ![q](${DATA_URL})\nlazy ![r](${DATA_URL})`,
  `![s][]\n\n[S]: <${DATA_URL}>`,
  `[![x](${DATA_URL})](https://example.com)`,
  `![a ![b](${DATA_URL}) c](${DATA_URL})`,
  `| a | b |\n|---|---|\n| ![x](${DATA_URL}) | \`![y](${DATA_URL})\` |`,
  `<div>\n![x](${DATA_URL})\n</div>\n\n![y](${DATA_URL})`,
  `1. one\n2. ![two](${DATA_URL})\n\n   ![three](${DATA_URL})`,
  `* a\n\n      ![code](${DATA_URL})`,
  `Setext ![h](${DATA_URL})\n===`,
  `[s]: ${DATA_URL}\n===`,
  `- [x] task ![t](${DATA_URL})`,
  `~~~\n![x](${DATA_URL})\n~~~~\n![y](${DATA_URL})`,
  `\`\`\`js \`x\`\n![x](${DATA_URL})`,
  `-\t![tab](${DATA_URL})`,
  `[unclosed ![x](${DATA_URL})`,
  `</pre>\n![x](${DATA_URL})`,
  `    code\n2) ![x](${DATA_URL})`,
  `para\n> 2. ![x](${DATA_URL})`,
  `> a\n<span>\n> ![x](${DATA_URL})`,
  `[r][x\n\n[r]: ${DATA_URL}`,
  `[a](/u (b(c)) ![x](${DATA_URL})`,
];

const PIECES: Array<string> = [
  `![a](${DATA_URL})`,
  `![b](<${DATA_URL}>)`,
  `[c](${DATA_URL})`,
  "![r]",
  "![x][r]",
  "[r][]",
  `[r]: ${DATA_URL}`,
  "[q]: /q",
  "![q]",
  `<${DATA_URL}>`,
  "`",
  "``",
  "```",
  "~~~",
  "[",
  "]",
  "(",
  ")",
  "!",
  "\\",
  "<",
  ">",
  "<a href='`'>",
  "<!--",
  "-->",
  "<div>",
  "</div>",
  "</pre>",
  "<span>",
  "- ",
  "* ",
  "1. ",
  "2) ",
  "> ",
  "    ",
  "  ",
  "\t",
  "\n",
  "\n\n",
  "\r\n",
  "# ",
  "===",
  "---",
  "* * *",
  "| a | b |",
  "|---|---|",
  "x",
  "text ",
  "*em*",
  '"',
  "'",
  "(x)",
  "[r]",
  "]: ",
  '[r](/u "t")',
];

// A seeded generator, so a failure can be read again.
function seededRandom(seed: number): () => number {
  let state: number = seed;

  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function generateTexts(count: number, seed: number): Array<string> {
  const random: () => number = seededRandom(seed);
  const texts: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    let text: string = "";
    const pieces: number = 3 + Math.floor(random() * 14);

    for (let piece: number = 0; piece < pieces; piece++) {
      text += PIECES[Math.floor(random() * PIECES.length)];
    }

    texts.push(text);
  }

  return texts;
}

// A use as it is compared: a definition by where it starts.
function keyOf(use: { kind: string; start: number; end: number }): string {
  return use.kind === DataUrlUseKind.Definition
    ? `${use.kind}@${use.start}`
    : `${use.kind}@${use.start}-${use.end}`;
}

// What MarkdownDataUrls finds, without what is inside an image's alt text.
function ownKeysOf(markdown: string): Array<string> {
  const uses: Array<DataUrlUse> = find(markdown).uses;

  return uses
    .filter((use: DataUrlUse): boolean => {
      return !uses.some((outer: DataUrlUse): boolean => {
        return (
          outer !== use &&
          outer.kind === DataUrlUseKind.Image &&
          outer.start <= use.start &&
          use.end <= outer.end
        );
      });
    })
    .map(keyOf)
    .sort();
}

describe("MarkdownDataUrls.find - the same as the dashboard's parser", () => {
  test("on handwritten corner cases and 3000 generated texts", () => {
    const texts: Array<string> = HANDWRITTEN.concat(generateTexts(3000, 4532));
    const expected: Array<DashboardDataUrls> = dataUrlUsesAsDashboard(texts);

    const mismatches: Array<string> = [];

    texts.forEach((text: string, index: number): void => {
      const mine: Array<string> = ownKeysOf(text);
      const theirs: Array<string> = expected[index]!.uses.map(keyOf).sort();

      if (mine.join(" ") !== theirs.join(" ")) {
        mismatches.push(
          `${JSON.stringify(text.split(PNG).join("P"))}: ${mine.join(", ")} / ${theirs.join(", ")}`,
        );
      }
    });

    expect(mismatches).toEqual([]);
  });
});

/*
 * LINEAR TIME.
 *
 * A screenshot is megabytes of base64, and a description is anybody's text.
 * At every one of these shapes and sizes, finding the uses is a matter of
 * milliseconds - the bound here is generous - where a reading that goes back
 * over what it has read would take seconds or minutes.
 */
const TIME_BOUND_IN_MS: number = 5000;

describe("MarkdownDataUrls.find - linear time", () => {
  test.each([
    [
      "an 8 MB screenshot",
      (png: string): string => {
        return `Timeout\n![Login page](data:image/png;base64,${png})\n\nmore`;
      },
    ],
    [
      "an 8 MB screenshot by reference",
      (png: string): string => {
        return `![Login page][s]\n\n[s]: data:image/png;base64,${png}`;
      },
    ],
    [
      "an 8 MB screenshot in a code block",
      (png: string): string => {
        return "```\n![x](data:image/png;base64," + png + ")\n```";
      },
    ],
    [
      "an 8 MB screenshot in a code span",
      (png: string): string => {
        return "`![x](data:image/png;base64," + png + ")`";
      },
    ],
    [
      "an 8 MB screenshot that never closes",
      (png: string): string => {
        return "![x](data:image/png;base64," + png;
      },
    ],
  ])("%s", (_label: string, shape: (png: string) => string) => {
    const png: string = pngOfSize(6 * 1024 * 1024);
    const markdown: string = shape(png);

    const started: number = Date.now();
    const found: MarkdownDataUrlUses = find(markdown);

    expect(Date.now() - started).toBeLessThan(TIME_BOUND_IN_MS);
    expect(markdown.length).toBeGreaterThan(8 * 1024 * 1024);

    for (const use of found.uses) {
      if (use.image) {
        expect(use.image.base64).toBe(png);
      }
    }
  });

  test.each([
    [
      "nested list markers",
      (length: number): string => {
        return "- ".repeat(length / 2) + "data:";
      },
    ],
    [
      "nested quotes",
      (length: number): string => {
        return "> ".repeat(length / 2) + "data:";
      },
    ],
    [
      "opening brackets",
      (length: number): string => {
        return "[".repeat(length) + `![x](${DATA_URL})`;
      },
    ],
    [
      "closing brackets",
      (length: number): string => {
        return "]".repeat(length) + "data:";
      },
    ],
    [
      "nested brackets with a definition",
      (length: number): string => {
        return `[a]: ${DATA_URL}\n\n${"[".repeat(length / 2)}a${"]".repeat(length / 2)}`;
      },
    ],
    [
      "image openers",
      (length: number): string => {
        return "![".repeat(length / 2) + "data:";
      },
    ],
    [
      "backticks",
      (length: number): string => {
        return "`a ``b ".repeat(length / 7) + "data:";
      },
    ],
    [
      "unclosed links",
      (length: number): string => {
        return "[a](".repeat(length / 4) + "data:";
      },
    ],
    [
      "unclosed links with a definition",
      (length: number): string => {
        return `[a]: ${DATA_URL}\n\n${"[a](".repeat(length / 4)}`;
      },
    ],
    [
      "unclosed titles",
      (length: number): string => {
        return '[a](b "'.repeat(length / 7) + "data:";
      },
    ],
    [
      "unclosed attributes",
      (length: number): string => {
        return '<a b="'.repeat(length / 6) + "data:";
      },
    ],
    [
      "unclosed comments",
      (length: number): string => {
        return "<!--".repeat(length / 4) + "data:";
      },
    ],
    [
      "unclosed autolinks",
      (length: number): string => {
        return "<a:".repeat(length / 3) + "data:";
      },
    ],
    [
      "emphasis",
      (length: number): string => {
        return "*a ".repeat(length / 3) + `![x](${DATA_URL})`;
      },
    ],
    [
      "images",
      (length: number): string => {
        return `![x](${DATA_URL}) `.repeat(Math.max(1, length / 100));
      },
    ],
  ])("%s", (_label: string, shape: (length: number) => string) => {
    for (const length of [20000, 160000]) {
      const markdown: string = shape(length);

      const started: number = Date.now();

      find(markdown);

      expect({
        length: length,
        fast: Date.now() - started < TIME_BOUND_IN_MS,
      }).toEqual({ length: length, fast: true });
    }
  });
});
