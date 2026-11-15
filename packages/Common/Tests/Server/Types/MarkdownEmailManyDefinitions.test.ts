import Markdown, {
  MarkdownContentType,
  readOnlyNamedDefinitions,
} from "../../../Server/Types/Markdown";
import {
  forEachLabelMarkedLooksUp,
  normalizeLinkLabel,
  normalizeReferenceLabel,
} from "../../../Utils/Markdown/LinkReferenceDefinitions";
import {
  FastestRun,
  fastestRun,
  fastestRunAsync,
} from "../../Helpers/FastestRun";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { Lexer, Links, Token, TokensList, Tokenizer, Tokens } from "marked";

/*
 * ISSUE #7597: MANY LINK REFERENCE DEFINITIONS, AND EVERY PARAGRAPH MARKED
 * READS.
 *
 * marked 12 reads the inline Markdown of each paragraph, heading, table
 * cell and list item - and of each link's and emphasis's text inside them -
 * with Lexer.inlineTokens, which lists every definition of the whole text
 * first (Object.keys(tokens.links)) and looks each reference it finds up
 * in that list. So D definitions and C such reads cost D times C: 20,000
 * definitions and 20,000 one-word paragraphs took an email 42 s, and the
 * guard before marked (Utils/Markdown/SlowMarkdown) measures each block on
 * its own, so nothing held them back.
 *
 * Now the lexer of an email's render reads each inline text with only the
 * definitions its text names (readOnlyNamedDefinitions, with the labels of
 * forEachLabelMarkedLooksUp). These hold that to marked's own reading -
 * every label marked looks up, on generated texts, is one the text names;
 * the tokens are marked's own, definitions, references, emphasis and all -
 * and hold an email's reads to the definitions their texts name, counted
 * where marked lists them: deterministic, whatever the machine's load.
 */

// The labels forEachLabelMarkedLooksUp calls back with, in order.
const labelsOf: (text: string) => Array<string> = (
  text: string,
): Array<string> => {
  const labels: Array<string> = [];

  forEachLabelMarkedLooksUp(text, (label: string): void => {
    labels.push(label);
  });

  return labels;
};

// A lexer as marked's own parse makes one (GitHub flavoured).
const newLexer: (tokenizer?: Tokenizer) => Lexer = (
  tokenizer?: Tokenizer,
): Lexer => {
  return new Lexer(
    tokenizer
      ? { gfm: true, breaks: false, pedantic: false, tokenizer: tokenizer }
      : { gfm: true, breaks: false, pedantic: false },
  );
};

// The tokens and definitions, as JSON: equal when marked read the same.
const readingOf: (tokens: TokensList) => string = (
  tokens: TokensList,
): string => {
  return JSON.stringify({
    tokens: tokens,
    links: Object.entries(tokens.links),
  });
};

const lexedByMarked: (text: string) => string = (text: string): string => {
  return readingOf(newLexer().lex(text));
};

const lexedWithNamedDefinitions: (text: string) => string = (
  text: string,
): string => {
  const lexer: Lexer = newLexer();

  readOnlyNamedDefinitions(lexer);

  return readingOf(lexer.lex(text));
};

/*
 * Every label marked looks a definition up by while it reads `text`, with
 * the inline text it was reading each time: the labels its masking of
 * references checks (reflinkSearch, read with marked's own expression on
 * marked's own text) and those its references look up (Tokenizer.reflink).
 */
interface LookUp {
  label: string;
  inlineText: string;
}

class LookUpRecordingTokenizer extends Tokenizer {
  public readonly lookUps: Array<LookUp> = [];
  public readonly reading: Array<string> = [];

  public override reflink(
    src: string,
    links: Links,
  ): Tokens.Link | Tokens.Image | Tokens.Text | undefined {
    const recording: Links = new Proxy(links, {
      get: (target: Links, key: string | symbol, receiver: unknown) => {
        if (typeof key === "string") {
          this.lookUps.push({
            label: key,
            inlineText: this.reading[this.reading.length - 1] ?? "",
          });
        }

        return Reflect.get(target, key, receiver);
      },
    });

    return super.reflink(src, recording);
  }
}

const lookUpsOf: (text: string) => Array<LookUp> = (
  text: string,
): Array<LookUp> => {
  const tokenizer: LookUpRecordingTokenizer = new LookUpRecordingTokenizer();
  const lexer: Lexer = newLexer(tokenizer);
  const inlineTokens: (src: string, tokens?: Array<Token>) => Array<Token> =
    lexer.inlineTokens.bind(lexer);

  lexer.inlineTokens = (src: string, tokens?: Array<Token>): Array<Token> => {
    /*
     * The labels the masking checks before marked reads: a reference it
     * masks keeps its length, so its search finds what it finds in `src`.
     */
    const search: RegExp = new RegExp(
      tokenizer.rules.inline.reflinkSearch.source,
      "g",
    );
    let match: RegExpExecArray | null = search.exec(src);

    while (match !== null) {
      tokenizer.lookUps.push({
        label: match[0].slice(match[0].lastIndexOf("[") + 1, -1),
        inlineText: src,
      });
      match = search.exec(src);
    }

    tokenizer.reading.push(src);

    try {
      return inlineTokens(src, tokens);
    } finally {
      tokenizer.reading.pop();
    }
  };

  lexer.lex(text);

  return tokenizer.lookUps;
};

/*
 * Texts of every shape a reference can take, and every way a backslash, a
 * bracket or white space can sit in and around one - with definitions of
 * labels such texts hold, in every case and spacing, ahead of them and
 * after them.
 */
const REFERENCE_ALPHABET: ReadonlyArray<string> = [
  "[",
  "]",
  "[",
  "]",
  "\\",
  "\\\\",
  "a",
  "A",
  "b",
  " ",
  "  ",
  "\n",
  "\n\n",
  "*",
  "_",
  "**",
  "`",
  "!",
  "(",
  ")",
  "<",
  ">",
  "[a]",
  "[A]",
  "[a][b]",
  "[a][]",
  "![a]",
  "![b][a]",
  "\\[",
  "\\]",
  "](",
  "[ a ]",
  "[a  b]",
  "[A\tB]",
  "[x](/y)",
  "[t \\[a\\]](/u)",
  "[aΣ\uFEFFb]",
  "Σ",
  "\uFEFF",
  "\t",
  "> ",
  "- ",
  "1. ",
  "| ",
  "~",
  "&",
  "@",
];

const DEFINED_LABELS: ReadonlyArray<string> = [
  "a",
  "A",
  "b",
  "a b",
  "A  B",
  " a ",
  "x",
  "\\[a",
  "a\\]",
  "\\[",
  "Σ",
  "aΣ",
  "aΣ\uFEFFb",
  "aΣ b",
  "a\\\\",
  "*a*",
  "a*",
];

// Each text, and up to four definitions of DEFINED_LABELS after it or ahead.
const textsWithDefinitions: (count: number, seed: number) => Array<string> = (
  count: number,
  seed: number,
): Array<string> => {
  const random: SeededRandom = seededRandom(seed);

  return generatedTexts(count, seed + 1, REFERENCE_ALPHABET).map(
    (body: string, index: number): string => {
      let defined: string = "";
      const definitionCount: number = random(5);

      for (let number: number = 0; number < definitionCount; number++) {
        defined += `[${DEFINED_LABELS[random(DEFINED_LABELS.length)]!}]: /to/${number}\n`;
      }

      return index % 2 === 0 ? `${body}\n\n${defined}` : `${defined}\n${body}`;
    },
  );
};

// The references `text` resolves: each link and image token's address.
const resolvedIn: (text: string) => number = (text: string): number => {
  return JSON.stringify(newLexer().lex(text)).split('"href":"/to/').length - 1;
};

describe("forEachLabelMarkedLooksUp", () => {
  test.each([
    ["no brackets", "plain text", []],
    ["a shortcut reference", "[a]", ["a", "a"]],
    [
      "a full reference: both labels",
      "[text][Label]",
      ["text", "text", "Label", "label"],
    ],
    ["a collapsed reference", "[a][]", ["a", "a", "", ""]],
    ["an image", "![Alt][s1]", ["Alt", "alt", "s1", "s1"]],
    ["white space normalized the second way", "[A \t B]", ["A \t B", "a b"]],
    ["a line break in a label", "[a\nb]", ["a\nb", "a b"]],
    ["an escaped opening bracket: the rest as written only", "\\[a]", ["a"]],
    [
      "an escaped bracket inside: after it as written, all of it normalized",
      "[x\\[a]",
      ["a", "x\\[a"],
    ],
    [
      "an escaped closing bracket stays in the label",
      "[a\\]b]",
      ["a\\]b", "a\\]b"],
    ],
    ["two backslashes escape each other", "\\\\[a]", ["a", "a"]],
    ["three backslashes escape the bracket", "\\\\\\[a]", ["a"]],
    [
      "a backslash before a line break escapes nothing",
      "[a\\\nb]",
      ["a\\\nb", "a\\ b"],
    ],
    ["a closing bracket with no opening one", "a] b]", []],
    ["a label that never closes", "[a [b", []],
    ["the innermost of nested brackets", "[[a]]", ["a", "a"]],
    ["a second closing bracket closes nothing", "[a]b]", ["a", "a"]],
    ["each label once", "[a] [b] [c]", ["a", "a", "b", "b", "c", "c"]],
    ["code spans hold labels too", "`[a]`", ["a", "a"]],
    ["a link's text", "[run](https://example.com)", ["run", "run"]],
    ["an empty label", "[]", ["", ""]],
  ])("%s", (_name: string, text: string, labels: Array<string>) => {
    expect(labelsOf(text)).toEqual(labels);
  });

  test("reads each character once: a megabyte of brackets in good time", () => {
    for (const unit of ["[", "]", "[a]", "\\[", "[\\[", "\\\\[a\\]"]) {
      const text: string = unit.repeat(Math.ceil((1024 * 1024) / unit.length));
      const read: FastestRun<number> = fastestRun({
        run: (): number => {
          let total: number = 0;

          forEachLabelMarkedLooksUp(text, (label: string): void => {
            total += label.length;
          });

          return total;
        },
        limitInMs: 2000,
      });

      // Each label of each way holds characters no other label of it does.
      expect(read.result).toBeLessThanOrEqual(2 * text.length);
      expect(read.inMs).toBeLessThan(2000);
    }
  });
});

describe("normalizeReferenceLabel", () => {
  test("is marked's own: white space collapsed, then lower case", () => {
    const whiteSpace: Array<string> = [];
    const isWhiteSpace: RegExp = /^\s$/;

    for (let code: number = 0; code < 0x10000; code++) {
      if (isWhiteSpace.test(String.fromCharCode(code))) {
        whiteSpace.push(String.fromCharCode(code));
      }
    }

    const labels: Array<string> = generatedTexts(20000, 7597, [
      ...whiteSpace,
      "a",
      "A",
      "Σ",
      "İ",
      "ß",
      "\\",
      "\\]",
      "x",
    ]);

    for (const label of labels) {
      expect(normalizeReferenceLabel(label)).toBe(
        label.replace(/\s+/g, " ").toLowerCase(),
      );
    }
  });

  test("differs from a definition's own label only where a Σ ends a word", () => {
    // marked lowers a definition's label first, and a reference's last.
    expect(normalizeLinkLabel("aΣ\uFEFFb")).toBe("aσ b");
    expect(normalizeReferenceLabel("aΣ\uFEFFb")).toBe("aς b");
    expect(normalizeReferenceLabel("Run  42")).toBe(
      normalizeLinkLabel("Run  42"),
    );
  });
});

describe("readOnlyNamedDefinitions - marked's own reading", () => {
  test("every label marked looks up is one the inline text names", () => {
    let defined: number = 0;

    for (const text of textsWithDefinitions(6000, 75970)) {
      const links: Links = newLexer().lex(text).links;

      for (const lookUp of lookUpsOf(text)) {
        if (!Object.prototype.hasOwnProperty.call(links, lookUp.label)) {
          continue;
        }

        defined++;
        expect({
          text: text,
          inlineText: lookUp.inlineText,
          label: lookUp.label,
          named: labelsOf(lookUp.inlineText).includes(lookUp.label),
        }).toEqual({
          text: text,
          inlineText: lookUp.inlineText,
          label: lookUp.label,
          named: true,
        });
      }
    }

    // The texts look up thousands of labels that are defined.
    expect(defined).toBeGreaterThan(4000);
  });

  test("tokens, definitions and all, are marked's own on generated texts", () => {
    let references: number = 0;

    for (const text of textsWithDefinitions(12000, 75971)) {
      expect({ text: text, tokens: lexedWithNamedDefinitions(text) }).toEqual({
        text: text,
        tokens: lexedByMarked(text),
      });

      references += resolvedIn(text);
    }

    // And they resolve thousands of references.
    expect(references).toBeGreaterThan(2000);
  });

  test.each([
    ["references masked from emphasis", "*a [b*] c*\n\n[b*]: /b"],
    ["a full reference's text read as Markdown", "[*run* 42][s]\n\n[s]: /s"],
    [
      "a reference inside a link's text, its brackets escaped",
      "[see \\[s\\]](/x)\n\n[s]: /s",
    ],
    [
      "a label in another case and spacing",
      "[Run   ONE] and [run one]\n\n[RUN one]: /r",
    ],
    [
      "an image and a link to one definition",
      "![Shot][s] [Run][s]\n\n[s]: /s.png",
    ],
    [
      "the first of two definitions of a label",
      "[a]\n\n[a]: /first\n[A]: /second",
    ],
    [
      "a definition in a list item and a quote",
      "- [a]\n\n  [a]: /a\n\n> [b]\n>\n> [b]: /b",
    ],
    [
      "a table's cells",
      "| [a] | [b] |\n| - | - |\n| [b] | c |\n\n[a]: /a\n[b]: /b",
    ],
    ["a heading", "# [a]\n\n[a]: /a"],
    ["emphasis inside emphasis", "**[a] *[b]* [c]**\n\n[a]: /a\n[b]: /b"],
    ["a label of escapes", "[\\[a] [x\\[a] [a\\]]\n\n[\\[a]: /e\n[a\\]]: /f"],
    [
      "a label where a Σ ends a word, looked up as marked looks it up",
      "[aΣ\uFEFFb]\n\n[aΣ b]: /s",
    ],
  ])("%s", (_name: string, text: string) => {
    expect(lexedWithNamedDefinitions(text)).toBe(lexedByMarked(text));
  });

  test("gives every definition back once the text is read", () => {
    const lexer: Lexer = newLexer();

    readOnlyNamedDefinitions(lexer);

    const tokens: TokensList = lexer.lex("[a] b *c*\n\n[a]: /a\n[b]: /b");

    expect(Object.keys(tokens.links)).toEqual(["a", "b"]);
  });
});

/*
 * How many definitions marked lists, in all, while an email renders: the
 * work that grew with the definitions times the reads (#7597). Counted
 * where marked lists them - each inline read's tokens.links - so the count
 * says the same on any machine, however loaded.
 */
let inlineReads: SpyInstance | null = null;

afterEach(() => {
  inlineReads?.mockRestore();
  inlineReads = null;
});

interface Listing {
  reads: number;
  listed: number;
}

const listedWhile: (work: () => Promise<unknown>) => Promise<Listing> = async (
  work: () => Promise<unknown>,
): Promise<Listing> => {
  const listing: Listing = { reads: 0, listed: 0 };
  const original: Lexer["inlineTokens"] = Lexer.prototype.inlineTokens;

  inlineReads = jest
    .spyOn(Lexer.prototype, "inlineTokens")
    .mockImplementation(function (
      this: Lexer,
      src: string,
      tokens?: Array<Token>,
    ): Array<Token> {
      listing.reads++;
      listing.listed += Object.keys(this.tokens.links).length;

      return original.call(this, src, tokens);
    });

  try {
    await work();
  } finally {
    inlineReads.mockRestore();
    inlineReads = null;
  }

  return listing;
};

// `count` definitions, each "[l<n>]: <address>", each on a line of its own.
const definitions: (count: number, address?: string) => string = (
  count: number,
  address: string = "https://example.com/runs/",
): string => {
  const lines: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    lines.push(`[l${index}]: ${address}${index}`);
  }

  return lines.join("\n");
};

// `count` paragraphs, the `index`th made by `paragraph`.
const paragraphs: (
  count: number,
  paragraph: (index: number) => string,
) => string = (count: number, paragraph: (index: number) => string): string => {
  const written: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    written.push(paragraph(index));
  }

  return written.join("\n\n");
};

const countOf: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  return text.split(part).length - 1;
};

const email: (markdown: string) => Promise<string> = (
  markdown: string,
): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Email);
};

describe("An email with many link reference definitions (#7597)", () => {
  test("each paragraph's read lists none of the definitions it does not name", async () => {
    const markdown: string = `${definitions(3000)}\n\n${paragraphs(
      3000,
      (): string => {
        return "word";
      },
    )}`;

    const byEmail: Listing = await listedWhile((): Promise<string> => {
      return email(markdown);
    });
    const byMarked: Listing = await listedWhile(async (): Promise<void> => {
      newLexer().lex(markdown);
    });

    // Every paragraph is read, and marked alone lists every definition each time.
    expect(byEmail.reads).toBe(3000);
    expect(byMarked.reads).toBe(3000);
    expect(byMarked.listed).toBe(3000 * 3000);
    expect(byEmail.listed).toBe(0);
  });

  test("a read lists the definitions its text names, and each reference resolves", async () => {
    const markdown: string = `${paragraphs(2000, (index: number): string => {
      return `Run [l${index}] and [again][l${(index + 1) % 2000}]`;
    })}\n\n${definitions(2000)}`;

    let html: string = "";
    const listing: Listing = await listedWhile(async (): Promise<void> => {
      html = await email(markdown);
    });

    // A paragraph and the text of each of its two links.
    expect(listing.reads).toBe(3 * 2000);
    // A paragraph names two definitions, "[again]" none; a link's text none.
    expect(listing.listed).toBe(2 * 2000);
    expect(countOf(html, '<a href="https://example.com/runs/')).toBe(4000);

    for (const index of [0, 1, 999, 1998, 1999]) {
      expect(html).toContain(
        `Run <a href="https://example.com/runs/${index}">l${index}</a> and <a href="https://example.com/runs/${(index + 1) % 2000}">again</a>`,
      );
    }
  });

  test.each([
    [
      "a table's cells",
      (count: number): string => {
        return `| a |\n| - |\n${"| x |\n".repeat(count)}`;
      },
      2001,
    ],
    [
      "a list's one-word items",
      (count: number): string => {
        return "- a\n".repeat(count);
      },
      2000,
    ],
    [
      "headings",
      (count: number): string => {
        return "# a\n\n".repeat(count);
      },
      2000,
    ],
    [
      "paragraphs of emphasis, and the emphasis's text",
      (count: number): string => {
        return "*a*\n\n".repeat(count);
      },
      4000,
    ],
  ])(
    "%s list none of the definitions either",
    async (_name: string, shape: (count: number) => string, reads: number) => {
      const markdown: string = `${definitions(2000)}\n\n${shape(2000)}`;
      const listing: Listing = await listedWhile((): Promise<string> => {
        return email(markdown);
      });

      expect(listing.reads).toBe(reads);
      expect(listing.listed).toBe(0);
    },
  );

  test("a screenshot of each of 1,000 runs, each with a definition of its own, shows all of them", async () => {
    const shots: Array<string> = [];
    const defined: Array<string> = [];

    for (let index: number = 0; index < 1000; index++) {
      shots.push(`![Run ${index}][s${index}]`);
      defined.push(
        `[s${index}]: https://ci.example.com/runs/${index}/screenshot.png`,
      );
    }

    const html: string = await email(
      `${shots.join("\n")}\n\n${defined.join("\n")}`,
    );

    expect(countOf(html, '<img src="https://ci.example.com/runs/')).toBe(1000);
    expect(html).toContain(
      '<img src="https://ci.example.com/runs/999/screenshot.png" alt="Run 999"',
    );
  });

  test("a text with no definition is read by marked as it is", async () => {
    const markdown: string = paragraphs(500, (index: number): string => {
      return `Paragraph ${index} with [a link](https://example.com/${index}) and *emphasis*.`;
    });
    const listing: Listing = await listedWhile((): Promise<string> => {
      return email(markdown);
    });

    expect(listing.reads).toBeGreaterThanOrEqual(500);
    expect(listing.listed).toBe(0);
    expect(
      countOf(await email(markdown), '<a href="https://example.com/'),
    ).toBe(500);
  });

  test("10,000 definitions and 10,000 paragraphs render in good time, every reference resolved", async () => {
    // Every tenth paragraph a reference: the rest one word, as in #7597.
    const markdown: string = `${definitions(10000, "/r/")}\n\n${paragraphs(
      10000,
      (index: number): string => {
        return index % 10 === 0 ? `[l${index}]` : "word";
      },
    )}`;

    const rendered: FastestRun<string> = await fastestRunAsync({
      run: (): Promise<string> => {
        return email(markdown);
      },
      limitInMs: 2000,
    });

    expect(rendered.inMs).toBeLessThan(2000);
    expect(countOf(rendered.result, '<a href="/r/')).toBe(1000);
    expect(rendered.result).toContain('<p><a href="/r/9990">l9990</a></p>');
  }, 120000);
});
