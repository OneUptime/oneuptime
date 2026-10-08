import ChatInlineImages, {
  CHAT_IMAGE_PLACEHOLDER,
  ChatInlineImage,
  ChatMarkdownPiece,
  ChatMarkdownPieceKind,
  ChatMarkdownSplit,
} from "../../../Utils/Markdown/ChatInlineImages";
import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
import {
  DashboardDataUrls,
  dataUrlUsesAsDashboard,
} from "./DashboardMarkdownDataUrls";
import SlackifyMarkdown from "slackify-markdown";
import { describe, expect, test } from "@jest/globals";

/*
 * A SCREENSHOT IN A DESCRIPTION, ON ITS WAY TO SLACK AND MICROSOFT TEAMS.
 *
 * The same description Markdown the dashboard and the emails show with its
 * screenshot is posted to Slack and Teams, which cannot show an image whose
 * address is a data: URL. ChatInlineImages either splits the Markdown into
 * text and images, each where it was, for a message that shows them
 * (split), or makes each image its alt text, for one that cannot (toText).
 * Either way the base64 never reaches a chat's text, code stays byte for
 * byte, and images on the web stay as they were.
 */

// Real 1x1 images, as the probe's Buffer.toString("base64") writes them.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG: string =
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

const DATA_URL: string = `data:image/png;base64,${PNG}`;
const JPEG_DATA_URL: string = `data:image/png;base64,${JPEG}`;
const PLACEHOLDER: string = "\\[image\\]";

// A piece, as compared: text as it is, an image by what it shows.
type PieceSummary = string | { image: string; alt: string; fallback: string };

function summarize(split: ChatMarkdownSplit): Array<PieceSummary> {
  return split.pieces.map((piece: ChatMarkdownPiece): PieceSummary => {
    if (piece.kind === ChatMarkdownPieceKind.Markdown) {
      return piece.markdown;
    }

    return {
      image: piece.image.mimeType,
      alt: piece.altText,
      fallback: piece.fallbackMarkdown,
    };
  });
}

function images(split: ChatMarkdownSplit): Array<ChatInlineImage> {
  return split.pieces.filter(
    (piece: ChatMarkdownPiece): piece is ChatInlineImage => {
      return piece.kind === ChatMarkdownPieceKind.Image;
    },
  );
}

function markdownOf(split: ChatMarkdownSplit): string {
  return split.pieces
    .filter((piece: ChatMarkdownPiece): boolean => {
      return piece.kind === ChatMarkdownPieceKind.Markdown;
    })
    .map((piece: ChatMarkdownPiece): string => {
      return (piece as { markdown: string }).markdown;
    })
    .join("\n\n");
}

// A PNG of this many bytes: the PNG signature, then other bytes.
function pngOfSize(byteLength: number): string {
  const bytes: Buffer = Buffer.alloc(byteLength);

  for (let index: number = 0; index < byteLength; index++) {
    bytes[index] = (index * 7919 + 13) % 256;
  }

  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);

  return bytes.toString("base64");
}

// The "Incident Created" feed item IncidentService writes, with a description.
function incidentCreatedFeed(description: string): string {
  return `#### 🚨 Incident #12 Created:\n\n**Checkout is down**:\n\n${description}\n\n🔴 **Incident State**: Created \n\n⚠️ **Severity**: Critical \n\n`;
}

describe("ChatInlineImages.toText - every image whose address is a data: URL is its alt text", () => {
  test("text without one comes back exactly as it was", () => {
    const markdown: string =
      "**Bold**, `code`, ![logo](https://example.com/logo.png) and [docs](https://example.com)\n\n```\nx\n```";

    expect(ChatInlineImages.toText(markdown)).toBe(markdown);
    expect(ChatInlineImages.toText("")).toBe("");
    expect(ChatInlineImages.toText(null)).toBe("");
    expect(ChatInlineImages.toText(undefined)).toBe("");
  });

  test("the issue's template: the error, then the screenshot's place", () => {
    expect(
      ChatInlineImages.toText(`Timeout 30000ms exceeded\n![](${DATA_URL})`),
    ).toBe(`Timeout 30000ms exceeded\n${PLACEHOLDER}`);
  });

  test("an image with alt text is its alt text, mid-sentence too", () => {
    expect(
      ChatInlineImages.toText(
        `See ![the login page](${DATA_URL}) for details.`,
      ),
    ).toBe("See the login page for details.");
  });

  test("an image by reference, and its definition goes", () => {
    expect(
      ChatInlineImages.toText(
        `![Login page][login] and ![login]\n\n[login]: ${DATA_URL}`,
      ),
    ).toBe("Login page and login\n\n");
  });

  test("a link to a data: URL is its text; an autolink to an image is [image]", () => {
    expect(
      ChatInlineImages.toText(
        `[Download the shot](${DATA_URL}) or <${DATA_URL}>.`,
      ),
    ).toBe(`Download the shot or ${PLACEHOLDER}.`);
  });

  test("an SVG or any other data: image is its alt text too", () => {
    expect(
      ChatInlineImages.toText(
        "![logo](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=) and ![](data:image/webp;base64,UklGRg==)",
      ),
    ).toBe(`logo and ${PLACEHOLDER}`);
  });

  test("an image on the web is left as it is", () => {
    const markdown: string = `![logo](https://example.com/logo.png) ![shot](${DATA_URL})`;

    expect(ChatInlineImages.toText(markdown)).toBe(
      "![logo](https://example.com/logo.png) shot",
    );
  });

  test("code spans and code blocks stay byte for byte", () => {
    const markdown: string = [
      `Inline: \`![x](${DATA_URL})\` and \`\` ![y](${DATA_URL}) \`\`.`,
      "",
      "```markdown",
      `![z](${DATA_URL})`,
      `[ref]: ${DATA_URL}`,
      "```",
      "",
      `    ![indented](${DATA_URL})`,
      "",
      `Real: ![real](${DATA_URL})`,
    ].join("\n");

    expect(ChatInlineImages.toText(markdown)).toBe(
      markdown.replace(`![real](${DATA_URL})`, "real"),
    );
  });

  test("an image in a link leaves its alt text as the link's text", () => {
    expect(
      ChatInlineImages.toText(
        `[![Login](${DATA_URL})](https://example.com/login)`,
      ),
    ).toBe("[Login](https://example.com/login)");
  });

  test("alt text reads as typed, wherever the image was", () => {
    // At the start of a line, a heading, list or quote marker is no block.
    expect(ChatInlineImages.toText(`![# Not a heading](${DATA_URL})`)).toBe(
      "\\# Not a heading",
    );
    expect(ChatInlineImages.toText(`![1. Not a list](${DATA_URL})`)).toBe(
      "1\\. Not a list",
    );
    expect(ChatInlineImages.toText(`![- item](${DATA_URL})`)).toBe("\\- item");
    // In a table, a pipe does not end the cell.
    expect(
      ChatInlineImages.toText(
        `| a | b |\n|---|---|\n| ![x \\| y](${DATA_URL}) | c |`,
      ),
    ).toBe("| a | b |\n|---|---|\n| x \\| y | c |");
    // Markdown in it is shown, not read.
    expect(ChatInlineImages.toText(`![*a* _b_ ~~c~~](${DATA_URL})`)).toBe(
      "\\*a\\* \\_b\\_ \\~\\~c\\~\\~",
    );
  });

  test("no mention in alt text reaches Slack", () => {
    const text: string = ChatInlineImages.toText(
      `![<!channel> <@U123>](${DATA_URL})`,
    );

    expect(SlackifyMarkdown(text)).not.toMatch(/<!channel>|<@U123>/);
  });

  test("Slack's conversion of the result carries no base64", () => {
    const markdown: string = incidentCreatedFeed(
      `Timeout\n![Login page](${DATA_URL})\n\n![shot][s]\n\n[link](${DATA_URL})\n\n[s]: ${DATA_URL}`,
    );
    const slack: string = SlackifyMarkdown(ChatInlineImages.toText(markdown));

    expect(slack).not.toContain(PNG);
    expect(slack).not.toContain("data:");
    expect(slack).toContain("Login page");
    expect(slack).toContain("shot");
  });

  test("FeedMarkdown.asChatMarkdown places a description that way", () => {
    expect(
      FeedMarkdown.asChatMarkdown(`Down\n![Login](${DATA_URL})`).toString(),
    ).toBe("Down\nLogin");
    expect(FeedMarkdown.asChatMarkdown(null).toString()).toBe("");
  });
});

describe("ChatInlineImages.split - text and images, each where it was", () => {
  test("the issue's template: the error, then the screenshot", () => {
    const split: ChatMarkdownSplit = ChatInlineImages.split(
      `Timeout 30000ms exceeded\n![](${DATA_URL})`,
    );

    expect(summarize(split)).toEqual([
      "Timeout 30000ms exceeded",
      { image: "image/png", alt: "", fallback: PLACEHOLDER },
    ]);
    expect(images(split)[0]!.image.base64).toBe(PNG);
  });

  test("the Incident Created feed: the screenshot between the description and the state", () => {
    const split: ChatMarkdownSplit = ChatInlineImages.split(
      incidentCreatedFeed(
        `Timeout 30000ms exceeded\n![Login page](${DATA_URL})`,
      ),
    );

    expect(summarize(split)).toEqual([
      "#### 🚨 Incident #12 Created:\n\n**Checkout is down**:\n\nTimeout 30000ms exceeded",
      { image: "image/png", alt: "Login page", fallback: "Login page" },
      "\n\n🔴 **Incident State**: Created \n\n⚠️ **Severity**: Critical \n\n",
    ]);
  });

  test("the documented template: a screenshot after each run", () => {
    const split: ChatMarkdownSplit = ChatInlineImages.split(
      [
        "### What the page looked like",
        "**chromium / desktop**: Timeout",
        "",
        `![chromium desktop](${DATA_URL})`,
        "",
        "**firefox / desktop**: Timeout",
        "",
        `![firefox desktop](${JPEG_DATA_URL})`,
        "",
      ].join("\n"),
    );

    expect(summarize(split)).toEqual([
      "### What the page looked like\n**chromium / desktop**: Timeout\n\n",
      {
        image: "image/png",
        alt: "chromium desktop",
        fallback: "chromium desktop",
      },
      "\n\n**firefox / desktop**: Timeout\n\n",
      {
        image: "image/jpeg",
        alt: "firefox desktop",
        fallback: "firefox desktop",
      },
    ]);
  });

  test("images on one line are shown one after the other", () => {
    expect(
      summarize(
        ChatInlineImages.split(
          `Before\n\n![a](${DATA_URL})  ![b](${DATA_URL})\n\nAfter`,
        ),
      ),
    ).toEqual([
      "Before\n\n",
      { image: "image/png", alt: "a", fallback: "a" },
      { image: "image/png", alt: "b", fallback: "b" },
      "\n\nAfter",
    ]);
  });

  test("a line of the paragraph after the image starts the next piece", () => {
    expect(
      summarize(
        ChatInlineImages.split(`Error\n![shot](${DATA_URL})\n   and more text`),
      ),
    ).toEqual([
      "Error",
      { image: "image/png", alt: "shot", fallback: "shot" },
      "and more text",
    ]);
  });

  test("an image mid-sentence leaves its alt text, and is shown after the paragraph", () => {
    expect(
      summarize(
        ChatInlineImages.split(
          `See ![Login](${DATA_URL}) for details.\nNext line\n\nAfter`,
        ),
      ),
    ).toEqual([
      "See Login for details.\nNext line",
      { image: "image/png", alt: "Login", fallback: "" },
      "\n\nAfter",
    ]);
  });

  test("an image in a list is shown after the whole list", () => {
    expect(
      summarize(
        ChatInlineImages.split(
          `- one ![first](${DATA_URL})\n- two\n\n  more of two\n- three\n\nAfter`,
        ),
      ),
    ).toEqual([
      "- one first\n- two\n\n  more of two\n- three",
      { image: "image/png", alt: "first", fallback: "" },
      "\n\nAfter",
    ]);
  });

  test("an image in a block quote or a table is shown after it", () => {
    expect(
      summarize(ChatInlineImages.split(`> ![q](${DATA_URL}) said\n\nAfter`)),
    ).toEqual([
      "> q said",
      { image: "image/png", alt: "q", fallback: "" },
      "\n\nAfter",
    ]);
    expect(
      summarize(
        ChatInlineImages.split(
          `| a | b |\n|---|---|\n| x | ![c](${DATA_URL}) |\n\nAfter`,
        ),
      ),
    ).toEqual([
      "| a | b |\n|---|---|\n| x | c |",
      { image: "image/png", alt: "c", fallback: "" },
      "\n\nAfter",
    ]);
  });

  test("images keep the order they read in", () => {
    expect(
      summarize(
        ChatInlineImages.split(
          `Text ![first](${DATA_URL}) more\n![second](${DATA_URL})\nlast`,
        ),
      ),
    ).toEqual([
      "Text first more",
      { image: "image/png", alt: "first", fallback: "" },
      { image: "image/png", alt: "second", fallback: "second" },
      "last",
    ]);
  });

  test("an image by reference, its definition gone", () => {
    const split: ChatMarkdownSplit = ChatInlineImages.split(
      `Down\n\n![Login page][login]\n\n[login]: ${DATA_URL}`,
    );

    expect(summarize(split)).toEqual([
      "Down\n\n",
      { image: "image/png", alt: "Login page", fallback: "Login page" },
    ]);
    expect(split.linkDefinitionsMarkdown).toBe("");
  });

  test("the other link reference definitions leave the pieces, to be placed before each", () => {
    const split: ChatMarkdownSplit = ChatInlineImages.split(
      `See [the docs][d].\n\n![shot](${DATA_URL})\n\nAnd [again][d].\n\n[d]: https://docs.example.com`,
    );

    expect(summarize(split)).toEqual([
      "See [the docs][d].\n\n",
      { image: "image/png", alt: "shot", fallback: "shot" },
      "\n\nAnd [again][d].\n\n",
    ]);
    expect(split.linkDefinitionsMarkdown).toBe("[d]: https://docs.example.com");

    // Placed before a piece, they resolve its links in Slack without showing.
    expect(
      SlackifyMarkdown(
        `${split.linkDefinitionsMarkdown}\n\n${(split.pieces[2] as { markdown: string }).markdown}`,
      ),
    ).toBe("And <https://docs.example.com|again>.\n");
  });

  test("a line that would start a list on its own keeps the image in the paragraph", () => {
    expect(
      summarize(
        ChatInlineImages.split(`Error\n![x](${DATA_URL})\n2. not a list here`),
      ),
    ).toEqual([
      "Error\nx\n2. not a list here",
      { image: "image/png", alt: "x", fallback: "" },
    ]);
  });

  test("a hard line break before the image does not leave a backslash behind", () => {
    expect(
      summarize(ChatInlineImages.split(`Error\\\n![x](${DATA_URL})`)),
    ).toEqual(["Error", { image: "image/png", alt: "x", fallback: "x" }]);
  });

  test("an image no chat shows, on a line with images, is its alt text there", () => {
    expect(
      summarize(
        ChatInlineImages.split(
          `![a](${DATA_URL}) ![svg](data:image/svg+xml;base64,PHN2Zz4=) ![b](${DATA_URL})`,
        ),
      ),
    ).toEqual([
      { image: "image/png", alt: "a", fallback: "a" },
      "svg",
      { image: "image/png", alt: "b", fallback: "b" },
    ]);
  });

  test("an image in a link is the link's text, and is shown after the paragraph", () => {
    expect(
      summarize(
        ChatInlineImages.split(`[![Login](${DATA_URL})](https://example.com)`),
      ),
    ).toEqual([
      "[Login](https://example.com)",
      { image: "image/png", alt: "Login", fallback: "" },
    ]);
  });

  test("an image inside another image's alt text shows no image of its own", () => {
    expect(
      summarize(
        ChatInlineImages.split(`![a ![b](${DATA_URL}) c](${JPEG_DATA_URL})`),
      ),
    ).toEqual([{ image: "image/jpeg", alt: "a b c", fallback: "a b c" }]);
  });

  test("Markdown without an inline raster image is one piece, as toText makes it", () => {
    for (const markdown of [
      "Plain **text**",
      `\`![x](${DATA_URL})\``,
      "![svg](data:image/svg+xml;base64,PHN2Zz4=)",
      `[link](${DATA_URL})`,
    ]) {
      expect(summarize(ChatInlineImages.split(markdown))).toEqual([
        ChatInlineImages.toText(markdown),
      ]);
    }

    expect(ChatInlineImages.split("").pieces).toEqual([]);
  });

  test("the base64 is only ever in an image piece", () => {
    const split: ChatMarkdownSplit = ChatInlineImages.split(
      incidentCreatedFeed(
        `Down ![a](${DATA_URL}) here\n![b](${DATA_URL})\n\n- ![c](${DATA_URL})\n\n[d](${DATA_URL})\n\n![e][s]\n\n[s]: ${DATA_URL}`,
      ),
    );

    expect(markdownOf(split)).not.toContain(PNG);
    expect(images(split)).toHaveLength(4);

    for (const image of images(split)) {
      expect(image.image.base64).toBe(PNG);
    }
  });

  test("a description of several megabytes splits quickly, linearly", () => {
    const png: string = pngOfSize(1536 * 1024);
    const markdown: string = incidentCreatedFeed(
      `Timeout\n![Login page](data:image/png;base64,${png})\n\n${"text ".repeat(2000)}`,
    );

    const started: number = Date.now();
    const split: ChatMarkdownSplit = ChatInlineImages.split(markdown);
    const text: string = ChatInlineImages.toText(markdown);

    expect(Date.now() - started).toBeLessThan(5000);
    expect(images(split)[0]!.image.base64).toBe(png);
    expect(markdownOf(split)).not.toContain(png.slice(0, 100));
    expect(text).not.toContain(png.slice(0, 100));
  });
});

describe("ChatInlineImages - code is byte for byte, as the dashboard's parser reads it", () => {
  const PIECES: Array<string> = [
    `![a](${DATA_URL})`,
    `[c](${DATA_URL})`,
    "![r]",
    `[r]: ${DATA_URL}`,
    `<${DATA_URL}>`,
    "`",
    "``",
    "```",
    "~~~",
    "[",
    "]",
    "\\",
    "<a href='`'>",
    "<!--",
    "-->",
    "- ",
    "> ",
    "    ",
    "\n",
    "\n\n",
    "text ",
    "| a | b |",
    "|---|---|",
  ];

  function seededRandom(seed: number): () => number {
    let state: number = seed;

    return (): number => {
      state = (state + 0x6d2b79f5) | 0;
      let mixed: number = Math.imul(state ^ (state >>> 15), 1 | state);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  test("every code span and code block of 2000 generated texts survives toText and split", () => {
    const random: () => number = seededRandom(20261008);
    const texts: Array<string> = [];

    for (let index: number = 0; index < 2000; index++) {
      let text: string = "";
      const count: number = 3 + Math.floor(random() * 12);

      for (let piece: number = 0; piece < count; piece++) {
        text += PIECES[Math.floor(random() * PIECES.length)];
      }

      texts.push(text);
    }

    const dashboard: Array<DashboardDataUrls> = dataUrlUsesAsDashboard(texts);
    const failures: Array<string> = [];

    texts.forEach((text: string, index: number): void => {
      const asText: string = ChatInlineImages.toText(text);
      const asPieces: string = markdownOf(ChatInlineImages.split(text));

      for (const [start, end] of dashboard[index]!.code) {
        const code: string = text.slice(start, end);

        if (!asText.includes(code) || !asPieces.includes(code)) {
          failures.push(JSON.stringify(text.split(PNG).join("P")));
          break;
        }
      }

      // Nothing to change: nothing changes.
      if (dashboard[index]!.uses.length === 0 && asText !== text) {
        failures.push(`changed: ${JSON.stringify(text.split(PNG).join("P"))}`);
      }
    });

    expect(failures).toEqual([]);
  });
});

describe("CHAT_IMAGE_PLACEHOLDER", () => {
  test("is what an image with no alt text reads as", () => {
    expect(CHAT_IMAGE_PLACEHOLDER).toBe("[image]");
    expect(SlackifyMarkdown(ChatInlineImages.toText(`![](${DATA_URL})`))).toBe(
      "[image]\n",
    );
  });
});
