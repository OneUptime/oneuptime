import Markdown, {
  EMAIL_SLOW_MARKDOWN_LIMITS,
  MarkdownContentType,
} from "../../../Server/Types/Markdown";
import {
  SlowMarkdownHolder,
  SlowMarkdownLimits,
  holdBackSlowMarkdown,
} from "../../../Utils/Markdown/SlowMarkdown";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";
import { Renderer, marked } from "marked";

/*
 * ISSUE #7228: REFERENCES AND QUERY LINKS IN AN EMAIL.
 *
 * Before marked renders an email's Markdown, the blocks it would read
 * slowly are held back and written as text (Utils/Markdown/SlowMarkdown,
 * EMAIL_SLOW_MARKDOWN_LIMITS). A paragraph of 280 references - a template
 * writing one image reference for each run - or a link to a dashboard with
 * a query of 400 pairs was counted as if marked looked through the rest of
 * the paragraph from each bracket and each "=" and "&", and the email
 * showed "![Shot 0][s]" or "See [the dashboard](https://...)" as text,
 * where marked reads them in milliseconds.
 *
 * Now the emails count a block as marked reads it: these render as images
 * and links, exactly as marked alone renders them, while what marked does
 * read slowly is still written as text. SlowMarkdownAsMarked.test.ts tests
 * the count; HugeTextInLongRunningProcess.test.ts times the slowest
 * accepted shapes where V8 compiles regular expressions unoptimized.
 */

type RenderFunction = (markdown: string) => Promise<string>;

const render: RenderFunction = (markdown: string): Promise<string> => {
  return Markdown.convertToHTML(markdown, MarkdownContentType.Email);
};

// What marked makes of the Markdown with the email renderer, nothing held back.
const renderWithMarkedAlone: RenderFunction = async (
  markdown: string,
): Promise<string> => {
  // The renderer convertToHTML uses, raw HTML escaped as it sets it up.
  await render("");
  const renderer: Renderer = Markdown["getEmailRenderer"]();

  return await marked(markdown, { renderer: renderer });
};

// The emails' limits, counted as they were before: what was held back.
const LIMITS_BEFORE: SlowMarkdownLimits = {
  ...EMAIL_SLOW_MARKDOWN_LIMITS,
  countAsMarked: false,
};

// The pieces of `text` the limits hold back, in order.
const heldBack: (text: string, limits: SlowMarkdownLimits) => Array<string> = (
  text: string,
  limits: SlowMarkdownLimits,
): Array<string> => {
  const held: Array<string> = [];
  const holder: SlowMarkdownHolder = {
    holdLines: (lines: string): string => {
      held.push(lines);
      return `${held.length - 1}`;
    },
    holdCode: (code: string): string => {
      held.push(code);
      return `${held.length - 1}`;
    },
  };

  holdBackSlowMarkdown(text, holder, limits);

  return held;
};

// How many times `part` is in `text`.
const countOf: (text: string, part: string) => number = (
  text: string,
  part: string,
): number => {
  let count: number = 0;

  for (
    let at: number = text.indexOf(part);
    at !== -1;
    at = text.indexOf(part, at + part.length)
  ) {
    count++;
  }

  return count;
};

/*
 * The issue's paragraph: references, images and links in turn, one on each
 * line (or joined by `joiner`), then their definition after a blank line.
 */
const references: (count: number, joiner?: string) => string = (
  count: number,
  joiner: string = "\n",
): string => {
  const lines: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    lines.push(index % 2 === 0 ? `![Shot ${index}][s]` : `[Run ${index}][s]`);
  }

  return `${lines.join(joiner)}\n\n[s]: https://example.com/a.png`;
};

// A dashboard's address with a query, at least `length` characters long.
const queryAddress: (length: number) => string = (length: number): string => {
  let address: string = "https://grafana.example.com/d/abc/checkout?";

  for (let index: number = 0; address.length < length; index++) {
    address += `${index === 0 ? "" : "&"}k${index}=v${index}`;
  }

  return address;
};

// An address as the email's HTML writes it: each "&" as "&amp;".
const inHtml: (address: string) => string = (address: string): string => {
  return address.split("&").join("&amp;");
};

describe("Markdown email renderer - references in one paragraph render (#7228)", () => {
  test.each([270, 280, 1000, 2000])(
    "%i references, one on each line: images and links, as marked alone renders them",
    async (count: number) => {
      const markdown: string = references(count);
      const html: string = await render(markdown);

      expect(countOf(html, '<img src="https://example.com/a.png"')).toBe(
        count / 2,
      );
      expect(countOf(html, '<a href="https://example.com/a.png"')).toBe(
        count / 2,
      );
      expect(html.includes("[s]")).toBe(false);
      expect(html).toBe(await renderWithMarkedAlone(markdown));
    },
  );

  test("1,000 references on one line: images and links", async () => {
    const markdown: string = references(1000, " ");
    const html: string = await render(markdown);

    expect(countOf(html, "<img ")).toBe(500);
    expect(countOf(html, '<a href="https://example.com/a.png"')).toBe(500);
    expect(html).toBe(await renderWithMarkedAlone(markdown));
  });

  test("references in another script, and full, collapsed and shortcut references alike", async () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 400; index++) {
      lines.push(
        [`![Снимок ${index}][s]`, `[Запуск ${index}][s]`, "[s][]", "[s]"][
          index % 4
        ]!,
      );
    }

    const markdown: string = `${lines.join("\n")}\n\n[s]: https://example.com/a.png`;
    const html: string = await render(markdown);

    expect(markdown.length).toBeGreaterThan(4000);
    expect(countOf(html, "<img ")).toBe(100);
    expect(countOf(html, '<a href="https://example.com/a.png"')).toBe(300);
    expect(html).toBe(await renderWithMarkedAlone(markdown));
  });

  /*
   * A template that writes each run's screenshot as a reference of its own,
   * and the definitions in a block after them. A definition is no inline
   * Markdown to marked - its block rule takes the line whole, label and all
   * - so a block of them costs no more than its length.
   */
  test("1,000 runs' screenshots, each with a definition of its own: 1,000 images, as marked alone renders them", async () => {
    const shots: Array<string> = [];
    const definitions: Array<string> = [];

    for (let index: number = 0; index < 1000; index++) {
      shots.push(`![Run ${index}][s${index}]`);
      definitions.push(
        `[s${index}]: https://ci.example.com/runs/${index}/screenshot.png`,
      );
    }

    const markdown: string = `${shots.join("\n")}\n\n${definitions.join("\n")}`;
    const html: string = await render(markdown);

    expect(countOf(html, '<img src="https://ci.example.com/runs/')).toBe(1000);
    expect(html.includes('<img src="https://ci.example.com/runs/999/')).toBe(
      true,
    );
    // No definition and no reference shows as text.
    expect(html.includes("[s")).toBe(false);
    expect(html.includes("screenshot.png\n")).toBe(false);
    expect(html).toBe(await renderWithMarkedAlone(markdown));
    // Counted as before, the block of definitions was held back.
    expect(heldBack(markdown, LIMITS_BEFORE).length).toBeGreaterThan(0);
  });

  test("280 and 1,000 references were held back before: the email showed their Markdown", () => {
    for (const count of [280, 1000]) {
      const held: Array<string> = heldBack(references(count), LIMITS_BEFORE);

      expect([count, held.join("\n").includes("![Shot 0][s]")]).toEqual([
        count,
        true,
      ]);
    }
  });
});

describe("Markdown email renderer - links to an address with a long query render (#7228)", () => {
  test.each([
    ["4 KB", 4096],
    ["32 KB", 32 * 1024],
  ])("inline, to a %s query: a link", async (_size: string, length: number) => {
    const address: string = queryAddress(length);
    const markdown: string = `See [the dashboard](${address}) for the run.`;
    const html: string = await render(markdown);

    expect(
      html.includes(`<a href="${inHtml(address)}">the dashboard</a>`),
    ).toBe(true);
    expect(html.includes("[the dashboard]")).toBe(false);
    expect(html).toBe(await renderWithMarkedAlone(markdown));
  });

  test.each([
    ["4 KB", 4096],
    ["32 KB", 32 * 1024],
  ])(
    "inline with a title, to a %s query: a link with its title",
    async (_size: string, length: number) => {
      const address: string = queryAddress(length);
      const markdown: string = `See [the dashboard](${address} "Checkout, last hour") for the run.`;
      const html: string = await render(markdown);

      expect(
        html.includes(
          `<a href="${inHtml(address)}" title="Checkout, last hour">the dashboard</a>`,
        ),
      ).toBe(true);
      expect(html).toBe(await renderWithMarkedAlone(markdown));
    },
  );

  test.each([
    ["4 KB", 4096],
    ["32 KB", 32 * 1024],
  ])(
    "as a definition, to a %s query: a link",
    async (_size: string, length: number) => {
      const address: string = queryAddress(length);
      const markdown: string = `See [the dashboard][d] for the run.\n\n[d]: ${address}`;
      const html: string = await render(markdown);

      expect(
        html.includes(`<a href="${inHtml(address)}">the dashboard</a>`),
      ).toBe(true);
      expect(html.includes("[d]")).toBe(false);
      expect(html).toBe(await renderWithMarkedAlone(markdown));
    },
  );

  test.each([
    ["4 KB", 4096],
    ["32 KB", 32 * 1024],
  ])(
    "as a definition in <> with a title, to a %s query: a link with its title",
    async (_size: string, length: number) => {
      const address: string = queryAddress(length);
      const markdown: string = `See [the dashboard][d] for the run.\n\n[d]: <${address}> "Checkout"`;
      const html: string = await render(markdown);

      expect(
        html.includes(
          `<a href="${inHtml(address)}" title="Checkout">the dashboard</a>`,
        ),
      ).toBe(true);
      expect(html).toBe(await renderWithMarkedAlone(markdown));
    },
  );

  test("an image from the web with a 4 KB query: an image", async () => {
    const address: string = queryAddress(4096);
    const markdown: string = `The graph: ![Latency](${address})`;
    const html: string = await render(markdown);

    expect(html.includes(`<img src="${inHtml(address)}" alt="Latency"`)).toBe(
      true,
    );
    expect(html).toBe(await renderWithMarkedAlone(markdown));
  });

  test("ten links to 4 KB queries in one paragraph: ten links", async () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 10; index++) {
      lines.push(
        `Run ${index}: [dashboard](${queryAddress(4096)}&run=${index}).`,
      );
    }

    const markdown: string = lines.join("\n");
    const html: string = await render(markdown);

    expect(countOf(html, '<a href="https://grafana.example.com/')).toBe(10);
    expect(html).toBe(await renderWithMarkedAlone(markdown));
  });

  test("the issue's links were held back before: the email showed their Markdown", () => {
    for (const markdown of [
      `See [the dashboard](${queryAddress(3900)}) for the run.`,
      `See [the dashboard][d] for the run.\n\n[d]: ${queryAddress(7800)}`,
    ]) {
      expect(heldBack(markdown, LIMITS_BEFORE).length).toBeGreaterThan(0);
    }
  });
});

describe("Markdown email renderer - what marked reads slowly is still written as text (#7228)", () => {
  test.each([
    ["unclosed brackets", "[".repeat(4096)],
    ["unclosed brackets with words", "[a ".repeat(1400)],
    ["emphasis that never closes", "*a ".repeat(1400)],
    ["code spans", "`a".repeat(2048)],
    ["link openers", "[a](".repeat(1024)],
    ["references whose labels hold emphasis", "[*a*][s] ".repeat(600)],
    ["letters before an @", `x ${"a".repeat(4096)}@`],
    ["angle pairs", "< b > ".repeat(4000)],
    ["escaped symbols", "\\€ ".repeat(6000)],
    // Past what marked reads in good time (HugeTextInLongRunningProcess).
    [
      "2,500 references, one on each line",
      references(2500).slice(0, references(2500).indexOf("\n\n")),
    ],
  ])("%s", async (_name: string, shape: string) => {
    // A word in bold in the same paragraph: written as text, it stays "**".
    const markdown: string = `${shape} **held**\n\n[s]: https://example.com/a.png`;
    const html: string = await render(markdown);

    expect(heldBack(markdown, EMAIL_SLOW_MARKDOWN_LIMITS).length).toBe(1);
    expect(html.includes("**held**")).toBe(true);
    expect(html.includes("<strong>held</strong>")).toBe(false);
  });
});

/*
 * Texts of the shapes no longer held back - references, links and
 * definitions to long queries, entities and bracketed words, in paragraphs,
 * quotes and lists - render exactly as marked alone renders them. Each is
 * short enough that the copies of addresses its references make stay in
 * their budget (MarkdownEmailReferences.test.ts), so nothing else differs.
 */
describe("Markdown email renderer - generated texts no longer held back render as marked renders them (#7228)", () => {
  const generatedText: (random: SeededRandom) => string = (
    random: SeededRandom,
  ): string => {
    const pieces: Array<() => string> = [
      (): string => {
        return `![Shot ${random(1000)}][s]`;
      },
      (): string => {
        return `[Run ${random(1000)}][s]`;
      },
      (): string => {
        return "[s][]";
      },
      (): string => {
        return "[s]";
      },
      (): string => {
        return `[run ${random(100)}](https://example.com/runs/${random(1000)}?a=1&b=2)`;
      },
      (): string => {
        return `[the dashboard](${queryAddress(64 + random(4096))} "Checkout")`;
      },
      (): string => {
        return `![graph](${queryAddress(64 + random(2048))})`;
      },
      (): string => {
        return "Tom &amp; Jerry &copy; 2026 &";
      },
      (): string => {
        return "[INFO] served a]";
      },
      (): string => {
        return "words of a run";
      },
      (): string => {
        return "Запуск завершён";
      },
    ];
    const separators: ReadonlyArray<string> = [" ", " ", "\n", "\n> ", "\n- "];
    const size: number = 4000 + random(12000);
    let text: string = "";

    while (text.length < size) {
      text += pieces[random(pieces.length)]!();
      text += separators[random(separators.length)];
    }

    return `${text}\n\n[s]: https://example.com/a.png\n[d]: ${queryAddress(64 + random(8192))}`;
  };

  test("for 40 texts", async () => {
    const random: SeededRandom = seededRandom(7228);
    let heldBefore: number = 0;

    for (let index: number = 0; index < 40; index++) {
      const markdown: string = generatedText(random);

      // Nothing held back now; a failure names the text's number.
      expect([index, heldBack(markdown, EMAIL_SLOW_MARKDOWN_LIMITS)]).toEqual([
        index,
        [],
      ]);

      if (heldBack(markdown, LIMITS_BEFORE).length > 0) {
        heldBefore++;
      }

      const html: string = await render(markdown);

      expect([index, html === (await renderWithMarkedAlone(markdown))]).toEqual(
        [index, true],
      );
    }

    // Most were held back before: these are the texts the change renders.
    expect(heldBefore).toBeGreaterThan(30);
  });
});
