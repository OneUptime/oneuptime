import { beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import crypto from "crypto";
import path from "path";
import MonitorTemplateUtil from "../../../Server/Utils/Monitor/MonitorTemplateUtil";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import BrowserType from "../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import {
  HeldBackViewerText,
  HeldUrlTreeNode,
  MAX_HELD_TEXT_IN_REFERENCES,
  VIEWER_SLOW_MARKDOWN_LIMITS,
  holdBackForViewer,
  putBackHeldText,
  remarkPutBackHeldUrls,
} from "../../../UI/Components/Markdown.tsx/MarkdownViewerOverLongText";
import { OVER_LONG_LINE_LENGTH } from "../../../Utils/Markdown/OverLongText";
import { holdBackSlowMarkdown } from "../../../Utils/Markdown/SlowMarkdown";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";

/*
 * ISSUE #6010: A SYNTHETIC MONITOR'S SCREENSHOT IN AN INCIDENT'S
 * DESCRIPTION, SHOWN IN THE DASHBOARD.
 *
 * A description template can show a screenshot the probe took as an image
 * whose address is the image itself:
 *
 *   Monitor is down - {{syntheticResponses.0.scriptError}}
 *   ![](data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}})
 *
 * The incident's email showed it. The dashboard - the description on the
 * incident's page, and in its feed - did not:
 *
 *   - a screenshot of about eleven to sixty-four thousand characters of
 *     base64 - a JPEG of 1024x768 is about 30 KB, forty thousand
 *     characters - was shown as text, base64 and all, and the rest of the
 *     description's Markdown with it. SlowMarkdown, which keeps text of a
 *     slow shape from the parser, read the data as one word of punctuation
 *     and held the paragraph back.
 *   - a longer one - most PNGs - showed as an empty image: the middle of
 *     its over-long line was held back with a token, remark-rehype
 *     percent-encoded the token in the image's address, and the token was
 *     never found again.
 *
 * Now the data is held back before anything measures or parses the text,
 * as the emails hold it back (Utils/Markdown/Base64Data), and an address is
 * put back together in Markdown's own tree (remarkPutBackHeldUrls). The
 * first part here tests the viewer's hold-back; the second renders the real
 * MarkdownViewer - react-markdown, remark-gfm and all the viewer's own
 * components and plugins - in a node process that compiles regular
 * expressions unoptimized, the state a browser tab or a server that has
 * run a while reaches, with descriptions made the way an incident's is,
 * from the probe's response and the template.
 */

const PNG_SIGNATURE: ReadonlyArray<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
];
// A JPEG's start of image, then its JFIF header's marker.
const JPEG_SIGNATURE: ReadonlyArray<number> = [0xff, 0xd8, 0xff, 0xe0];

// A real 1x1 PNG, as the probe's Buffer.toString("base64") writes it.
const PNG_1X1: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const KB: number = 1024;
const MB: number = 1024 * 1024;

/*
 * Random bytes the same on every run - compressed pixels look like them -
 * reused past 256 KB, so a screenshot of megabytes costs no more to make.
 */
const RANDOM_BYTES: Buffer = ((): Buffer => {
  const random: SeededRandom = seededRandom(6010);
  const bytes: Buffer = Buffer.alloc(256 * KB);

  for (let index: number = 0; index < bytes.length; index++) {
    bytes[index] = random(256);
  }

  return bytes;
})();

/*
 * A screenshot of `byteCount` bytes as the probe reports it: base64 of a
 * file that starts with `signature`. `offset` picks other bytes, so two
 * screenshots of a description differ.
 */
function screenshot(
  signature: ReadonlyArray<number>,
  byteCount: number,
  offset: number = 0,
): string {
  const bytes: Buffer = Buffer.alloc(byteCount);

  Buffer.from(signature).copy(bytes);

  for (let index: number = signature.length; index < byteCount; index++) {
    bytes[index] = RANDOM_BYTES[(index + offset * 7919) % RANDOM_BYTES.length]!;
  }

  return bytes.toString("base64");
}

function withoutPadding(base64: string): string {
  let end: number = base64.length;

  while (end > 0 && base64[end - 1] === "=") {
    end--;
  }

  return base64.slice(0, end);
}

// The probe's response for one run of a synthetic monitor.
function syntheticRun(
  screenshots: Record<string, string>,
  overrides: Partial<SyntheticMonitorResponse> = {},
): SyntheticMonitorResponse {
  return {
    result: undefined,
    scriptError: "Timeout 30000ms exceeded",
    logMessages: [],
    capturedMetrics: [],
    executionTimeInMS: 30000,
    browserType: BrowserType.Chromium,
    screenSizeType: ScreenSizeType.Desktop,
    screenshots: screenshots,
    ...overrides,
  };
}

// The description a template renders for the runs, as the incident stores it.
function describeIncident(
  template: string,
  runs: Array<SyntheticMonitorResponse>,
): string {
  const response: ProbeMonitorResponse = {
    projectId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    failureCause: "1 of 1 runs failed",
    monitoredAt: new Date("2026-11-06T00:08:26.000Z"),
    syntheticMonitorResponse: runs,
  };
  const storageMap: JSONObject = MonitorTemplateUtil.buildTemplateStorageMap({
    monitorType: MonitorType.SyntheticMonitor,
    dataToProcess: response,
  });

  return MonitorTemplateUtil.processMarkdownTemplateString({
    value: template,
    storageMap: storageMap,
  });
}

// The issue's description template, with the error a synthetic run reports.
const ISSUE_TEMPLATE: string =
  "Monitor is down - {{syntheticResponses.0.scriptError}}\n![](data:image/jpeg;base64,{{syntheticResponses.0.screenshots.home}})";

function issueDescription(base64: string): string {
  return describeIncident(ISSUE_TEMPLATE, [syntheticRun({ home: base64 })]);
}

describe("holdBackForViewer - a synthetic monitor's screenshot in a description", () => {
  test("the issue's description: the screenshot's data is held back, and nothing is held back as text", () => {
    const jpeg: string = screenshot(JPEG_SIGNATURE, 30 * KB);
    const description: string = issueDescription(jpeg);
    const data: string = withoutPadding(jpeg);

    expect(description).toBe(
      `Monitor is down - Timeout 30000ms exceeded\n![](data:image/jpeg;base64,${jpeg})`,
    );

    const heldBack: HeldBackViewerText = holdBackForViewer(description);

    expect(heldBack.heldLines).toEqual([]);
    expect(heldBack.held).toEqual([data.slice(0, -1)]);
    expect(heldBack.markdown).toBe(
      `Monitor is down - Timeout 30000ms exceeded\n![](data:image/jpeg;base64,\uE0050\uE006${jpeg.slice(data.length - 1)})`,
    );
    expect(heldBack.showAsText).toBe(false);
    expect(putBackHeldText(heldBack.markdown, heldBack.held)).toBe(description);
  });

  test("what held the issue's description back as text: the data alone costs too much as Markdown", () => {
    const description: string = issueDescription(
      screenshot(JPEG_SIGNATURE, 30 * KB),
    );
    const heldAsText: Array<string> = [];

    // SlowMarkdown on the description as written, the data in it.
    expect(
      holdBackSlowMarkdown(
        description,
        {
          holdLines: (text: string): string => {
            heldAsText.push(text);

            return "\uE0050\uE006";
          },
          holdCode: (text: string): string => {
            return text;
          },
        },
        VIEWER_SLOW_MARKDOWN_LIMITS,
      ),
    ).toBe("\uE0050\uE006");
    expect(heldAsText).toEqual([description]);
  });

  test.each([
    ["8 KB", 8 * KB],
    ["9 KB, just over what was read as Markdown before", 9 * KB],
    ["12 KB", 12 * KB],
    ["30 KB, the issue's", 30 * KB],
    ["47 KB, a line just under the over-long length", 47 * KB],
    ["48 KB, a line just at it", 48 * KB],
    ["49 KB, a line over it", 49 * KB],
    ["100 KB", 100 * KB],
    ["1 MB", MB],
    ["3 MB", 3 * MB],
  ])(
    "a screenshot of %s: its data is held back whole, never its paragraph as text",
    (_label: string, byteCount: number) => {
      const jpeg: string = screenshot(JPEG_SIGNATURE, byteCount);
      const description: string = issueDescription(jpeg);
      const heldBack: HeldBackViewerText = holdBackForViewer(description);

      expect(heldBack.heldLines).toEqual([]);
      expect(heldBack.held).toEqual([withoutPadding(jpeg).slice(0, -1)]);
      expect(heldBack.markdown.length).toBeLessThan(120);
      expect(heldBack.showAsText).toBe(false);
      expect(putBackHeldText(heldBack.markdown, heldBack.held)).toBe(
        description,
      );
    },
  );

  test("the line of a 49 KB screenshot is over-long as written: it was, and is no longer, held back in the middle", () => {
    const jpeg: string = screenshot(JPEG_SIGNATURE, 49 * KB);

    expect(`![](data:image/jpeg;base64,${jpeg})`.length).toBeGreaterThan(
      OVER_LONG_LINE_LENGTH,
    );
    expect(holdBackForViewer(issueDescription(jpeg)).held).toHaveLength(1);
  });

  test("the screenshot's paragraph keeps its Markdown", () => {
    const description: string = describeIncident(
      "**Checkout failed** on [step 3](https://example.com/runs/42): `{{syntheticResponses.0.scriptError}}`\n![Cart](data:image/jpeg;base64,{{syntheticResponses.0.screenshots.cart}})",
      [syntheticRun({ cart: screenshot(JPEG_SIGNATURE, 30 * KB) })],
    );
    const heldBack: HeldBackViewerText = holdBackForViewer(description);

    expect(heldBack.heldLines).toEqual([]);
    expect(
      heldBack.markdown.startsWith(
        "**Checkout failed** on [step 3](https://example.com/runs/42): `Timeout 30000ms exceeded`\n![Cart](data:image/jpeg;base64,\uE0050\uE006",
      ),
    ).toBe(true);
  });

  test("ten screenshots of a description share no budget: none is held back as text", () => {
    const shots: Array<string> = Array.from(
      { length: 10 },
      (_value: unknown, index: number): string => {
        return screenshot(JPEG_SIGNATURE, 30 * KB, index);
      },
    );
    const description: string = [
      "Every step failed:",
      ...shots.map((shot: string, index: number): string => {
        return `![Step ${index + 1}](data:image/jpeg;base64,${shot})`;
      }),
    ].join("\n");
    const heldBack: HeldBackViewerText = holdBackForViewer(description);

    expect(heldBack.heldLines).toEqual([]);
    expect(heldBack.held).toEqual(
      shots.map((shot: string): string => {
        return withoutPadding(shot).slice(0, -1);
      }),
    );
    expect(putBackHeldText(heldBack.markdown, heldBack.held)).toBe(description);
  });

  test("a paragraph too costly to read is still held back as text beside a screenshot, and the screenshot is not", () => {
    /*
     * Emphasis that never closes: remark took 9 s on 64 KB of it. Shorter
     * than an over-long line, whose middle would be held back instead.
     */
    const costly: string = "a* ".repeat(15000).trimEnd();

    expect(costly.length).toBeLessThan(OVER_LONG_LINE_LENGTH);
    const shot: string = issueDescription(screenshot(JPEG_SIGNATURE, 30 * KB));
    const description: string = `${costly}\n\n${shot}`;
    const heldBack: HeldBackViewerText = holdBackForViewer(description);

    expect(heldBack.heldLines).toHaveLength(1);
    expect(heldBack.held[heldBack.heldLines[0]!]).toBe(costly);
    expect(heldBack.markdown).toContain(
      "\n\nMonitor is down - Timeout 30000ms exceeded\n![](data:image/jpeg;base64,\uE005",
    );
    expect(putBackHeldText(heldBack.markdown, heldBack.held)).toBe(description);
  });

  test("token characters already in a description come back as they were, beside a screenshot", () => {
    const description: string = `Odd \uE005 \uE006 \uE0050\uE006 text\n${issueDescription(screenshot(JPEG_SIGNATURE, 30 * KB))}`;
    const heldBack: HeldBackViewerText = holdBackForViewer(description);

    expect(heldBack.heldLines).toEqual([]);
    expect(putBackHeldText(heldBack.markdown, heldBack.held)).toBe(description);
  });

  test("a small screenshot holds back nothing, and is read as it always was", () => {
    const description: string = issueDescription(PNG_1X1);
    const heldBack: HeldBackViewerText = holdBackForViewer(description);

    expect(heldBack).toEqual({
      markdown: description,
      held: [],
      heldLines: [],
      showAsText: false,
    });
  });

  test.each([
    ["a code block", "```\nPOST /upload payload;base64,", "\n```"],
    ["a code span", "The probe sent `payload;base64,", "`"],
    ["a sentence", "The probe sent payload;base64,", " and stopped."],
    ["a link", "[The report](data:application/pdf;base64,", ")"],
  ])(
    "base64 data in %s is held back and comes back as it was written",
    (_label: string, before: string, after: string) => {
      const data: string = withoutPadding(screenshot(PNG_SIGNATURE, 30 * KB));
      const text: string = `Before\n\n${before}${data}${after}\n\nAfter`;
      const heldBack: HeldBackViewerText = holdBackForViewer(text);

      expect(heldBack.heldLines).toEqual([]);
      expect(heldBack.held).toContain(data.slice(0, -1));
      expect(putBackHeldText(heldBack.markdown, heldBack.held)).toBe(text);
    },
  );
});

describe("remarkPutBackHeldUrls", () => {
  const held: ReadonlyArray<string> = [
    "SCREENSHOT-DATA",
    "LINK-PATH",
    "LINK-TEXT",
    "DEFINITION-DATA",
    "CELL-DATA",
  ];

  const image: (url: unknown) => HeldUrlTreeNode = (
    url: unknown,
  ): HeldUrlTreeNode => {
    return { type: "image", url: url };
  };

  test("puts back the address of every image, link and definition, wherever it is - and nothing else", () => {
    const tree: HeldUrlTreeNode = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", url: undefined },
            image("data:image/png;base64,\uE0050\uE006A"),
          ],
        },
        {
          type: "list",
          children: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  children: [
                    {
                      type: "link",
                      url: "https://example.com/\uE0051\uE006/runs",
                      children: [{ type: "text" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "definition", url: "data:image/png;base64,\uE0053\uE006B" },
        {
          type: "blockquote",
          children: [
            {
              type: "table",
              children: [
                {
                  type: "tableRow",
                  children: [
                    {
                      type: "tableCell",
                      children: [image("data:image/png;base64,\uE0054\uE006C")],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const textNode: HeldUrlTreeNode & { value?: string } = {
      type: "text",
      value: "\uE0052\uE006",
    };

    tree.children![1]!.children![0]!.children![0]!.children![0]!.children = [
      textNode,
    ];

    remarkPutBackHeldUrls({ held: held })(tree);

    expect(tree.children![0]!.children![1]!.url).toBe(
      "data:image/png;base64,SCREENSHOT-DATAA",
    );
    expect(
      tree.children![1]!.children![0]!.children![0]!.children![0]!.url,
    ).toBe("https://example.com/LINK-PATH/runs");
    expect(tree.children![2]!.url).toBe(
      "data:image/png;base64,DEFINITION-DATAB",
    );
    expect(
      tree.children![3]!.children![0]!.children![0]!.children![0]!.children![0]!
        .url,
    ).toBe("data:image/png;base64,CELL-DATAC");
    // Text is rehypePutBackHeldText's to put back, after remark-rehype.
    expect(textNode.value).toBe("\uE0052\uE006");
    expect(tree.children![0]!.children![0]!.url).toBeUndefined();
  });

  test("leaves every address as it is when nothing was held back", () => {
    const tree: HeldUrlTreeNode = {
      type: "root",
      children: [image("data:image/png;base64,\uE0050\uE006A")],
    };

    remarkPutBackHeldUrls({ held: [] })(tree);

    expect(tree.children![0]!.url).toBe("data:image/png;base64,\uE0050\uE006A");
  });

  test("leaves an address that is not a string as it is", () => {
    const tree: HeldUrlTreeNode = {
      type: "root",
      children: [image(null), image(42)],
    };

    remarkPutBackHeldUrls({ held: held })(tree);

    expect(tree.children![0]!.url).toBeNull();
    expect(tree.children![1]!.url).toBe(42);
  });

  test("walks a tree deeper than recursion could", () => {
    const bottom: HeldUrlTreeNode = image(
      "data:image/png;base64,\uE0050\uE006",
    );
    let tree: HeldUrlTreeNode = { type: "paragraph", children: [bottom] };

    for (let depth: number = 0; depth < 200000; depth++) {
      tree = { type: "blockquote", children: [tree] };
    }

    remarkPutBackHeldUrls({ held: held })({ type: "root", children: [tree] });

    expect(bottom.url).toBe("data:image/png;base64,SCREENSHOT-DATA");
  });

  describe("what link reference definitions carry to their references", () => {
    const ADDRESS: string = "data:image/png;base64,";
    const MOST: number = MAX_HELD_TEXT_IN_REFERENCES;

    // The token of held-back text `index`.
    const token: (index: number) => string = (index: number): string => {
      return `\uE005${index}\uE006`;
    };

    // A long string as a short one: its length and the start of its SHA-256.
    const fingerprint: (value: unknown) => unknown = (
      value: unknown,
    ): unknown => {
      return typeof value === "string"
        ? `${value.length}:${crypto.createHash("sha256").update(value).digest("hex").slice(0, 12)}`
        : value;
    };

    // A definition as remark builds one.
    const definition: (
      identifier: string,
      url: string,
      title?: string,
    ) => HeldUrlTreeNode = (
      identifier: string,
      url: string,
      title?: string,
    ): HeldUrlTreeNode => {
      return {
        type: "definition",
        identifier: identifier,
        url: url,
        title: title ?? null,
      };
    };

    // A paragraph of `count` references to `identifier`: images and links in turn.
    const referencesTo: (
      identifier: string,
      count: number,
    ) => HeldUrlTreeNode = (
      identifier: string,
      count: number,
    ): HeldUrlTreeNode => {
      const references: Array<HeldUrlTreeNode> = [];

      for (let index: number = 0; index < count; index++) {
        references.push({
          type: index % 2 === 0 ? "imageReference" : "linkReference",
          identifier: identifier,
          children: [],
        });
      }

      return { type: "paragraph", children: references };
    };

    const putBack: (
      held: ReadonlyArray<string>,
      ...children: Array<HeldUrlTreeNode>
    ) => void = (
      held: ReadonlyArray<string>,
      ...children: Array<HeldUrlTreeNode>
    ): void => {
      remarkPutBackHeldUrls({ held: held })({
        type: "root",
        children: children,
      });
    };

    test("a definition's address is put back while its references carry at most MAX_HELD_TEXT_IN_REFERENCES", () => {
      // Four references, each carrying exactly a quarter of the most.
      const data: string = "A".repeat(MOST / 4 - ADDRESS.length);
      const shot: HeldUrlTreeNode = definition("shot", ADDRESS + token(0));

      putBack([data], referencesTo("shot", 4), shot);

      expect(fingerprint(shot.url)).toBe(fingerprint(ADDRESS + data));
    });

    test("one character more, and the definition carries no address: its references show none", () => {
      const data: string = "A".repeat(MOST / 4 - ADDRESS.length + 1);
      const shot: HeldUrlTreeNode = definition("shot", ADDRESS + token(0));

      putBack([data], referencesTo("shot", 4), shot);

      expect(shot.url).toBe("");
    });

    test("a definition's title counts with its address, and goes with it", () => {
      // Two references, each carrying a quarter of the most in each.
      const data: string = "A".repeat(MOST / 4 - ADDRESS.length);
      const title: string = "T".repeat(MOST / 4);
      const kept: HeldUrlTreeNode = definition(
        "kept",
        ADDRESS + token(0),
        token(1),
      );
      const dropped: HeldUrlTreeNode = definition(
        "dropped",
        ADDRESS + token(0),
        token(1),
      );

      putBack([data, title], referencesTo("kept", 2), kept);
      putBack([data, `${title}T`], referencesTo("dropped", 2), dropped);

      expect(fingerprint(kept.url)).toBe(fingerprint(ADDRESS + data));
      expect(fingerprint(kept.title)).toBe(fingerprint(title));
      expect(dropped.url).toBe("");
      expect(dropped.title).toBeNull();
    });

    test("a title past it goes alone when the address holds nothing held back", () => {
      const run: HeldUrlTreeNode = definition(
        "run",
        "https://example.com/runs/42",
        token(0),
      );

      putBack(["T".repeat(MOST / 2 + 1)], referencesTo("run", 2), run);

      expect(run.title).toBeNull();
      expect(run.url).toBe("https://example.com/runs/42");
    });

    test("the first definitions in the text are given it first", () => {
      // Each carries just over half of the most to its one reference.
      const data: string = "A".repeat(MOST / 2);
      const first: HeldUrlTreeNode = definition("first", ADDRESS + token(0));
      const second: HeldUrlTreeNode = definition("second", ADDRESS + token(1));

      putBack(
        [data, data],
        referencesTo("second", 1),
        referencesTo("first", 1),
        { type: "blockquote", children: [first] },
        second,
      );

      expect(fingerprint(first.url)).toBe(fingerprint(ADDRESS + data));
      expect(second.url).toBe("");
    });

    test("only the first definition of an identifier carries anything, as remark-rehype reads only it", () => {
      // Two references carry exactly the most from the first definition.
      const data: string = "A".repeat(MOST / 2 - ADDRESS.length);
      const read: HeldUrlTreeNode = definition("shot", ADDRESS + token(0));
      const unread: HeldUrlTreeNode = definition("shot", ADDRESS + token(1));

      putBack([data, data], referencesTo("shot", 2), read, unread);

      expect(fingerprint(read.url)).toBe(fingerprint(ADDRESS + data));
      expect(fingerprint(unread.url)).toBe(fingerprint(ADDRESS + data));
    });

    test("references find their definition whatever its case, as remark-rehype finds it", () => {
      const home: HeldUrlTreeNode = definition("home", ADDRESS + token(0));

      putBack(
        ["A".repeat(MOST / 2)],
        {
          type: "paragraph",
          children: [
            { type: "imageReference", identifier: "Home" },
            { type: "linkReference", identifier: "HOME" },
          ],
        },
        home,
      );

      expect(home.url).toBe("");
    });

    test("an image's or a link's own address is put back however long: its text holds it once", () => {
      const data: string = "A".repeat(MOST + 1);
      const image: HeldUrlTreeNode = { type: "image", url: ADDRESS + token(0) };
      const link: HeldUrlTreeNode = {
        type: "link",
        url: `https://example.com/${token(1)}`,
        children: [],
      };

      putBack([data, data], { type: "paragraph", children: [image, link] });

      expect(fingerprint(image.url)).toBe(fingerprint(ADDRESS + data));
      expect(fingerprint(link.url)).toBe(
        fingerprint(`https://example.com/${data}`),
      );
    });

    test("a definition no reference reads is put back however long", () => {
      const data: string = "A".repeat(MOST + 1);
      const unread: HeldUrlTreeNode = definition("unread", ADDRESS + token(0));

      putBack([data], referencesTo("other", 3), unread);

      expect(fingerprint(unread.url)).toBe(fingerprint(ADDRESS + data));
    });

    test("a definition that holds nothing held back takes none of it", () => {
      const plain: HeldUrlTreeNode = definition(
        "plain",
        `https://example.com/${"a".repeat(MOST)}`,
      );
      const data: string = "A".repeat(MOST - ADDRESS.length);
      const shot: HeldUrlTreeNode = definition("shot", ADDRESS + token(0));

      putBack(
        [data],
        referencesTo("plain", 2),
        referencesTo("shot", 1),
        plain,
        shot,
      );

      expect(fingerprint(shot.url)).toBe(fingerprint(ADDRESS + data));
    });
  });
});

/*
 * THE REAL VIEWER.
 *
 * Jest stubs react-markdown and remark-gfm, whose ES modules it does not
 * load, and esbuild refuses to load under the jsdom environment Common's
 * jest uses (see EsbuildConfig.test.ts). So esbuild bundles MarkdownViewer
 * - with react-markdown, remark-gfm and every component and plugin of its
 * own - in a node process started with --no-regexp-optimization, which
 * renders each description to HTML with a jsdom window as a browser's.
 * Only the syntax highlighter (whose language modules Common does not
 * install in a form esbuild resolves) and mermaid are stand-ins: a code
 * block is drawn as a <pre> of its code.
 *
 * The HTML comes back with every run of base64 of COMPACT_LENGTH
 * characters or more written as {base64:<its SHA-256, 12 digits>:<length>}:
 * a screenshot of megabytes comes back as a few dozen characters, and the
 * test can still tell exactly which data is where - in an image's address,
 * or shown as text. So does its text, read without its tags: code breaks
 * a long word with <wbr> elements (BreakableName), which a reader does not
 * see.
 */

const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");

const COMPACT_LENGTH: number = 200;

const RENDER_SCRIPT: string = String.raw`
  const path = require("path");
  const crypto = require("crypto");
  const esbuild = require("esbuild");

  const COMPACT_LENGTH = ${COMPACT_LENGTH};

  const isBase64Code = (code) => {
    return (
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    );
  };

  // A loop, not a regular expression: the runs are megabytes long.
  const compact = (html) => {
    let compacted = "";
    let copiedUpTo = 0;
    let index = 0;

    while (index < html.length) {
      if (!isBase64Code(html.charCodeAt(index))) {
        index++;
        continue;
      }

      let end = index;

      while (end < html.length && isBase64Code(html.charCodeAt(end))) {
        end++;
      }

      if (end - index >= COMPACT_LENGTH) {
        const run = html.slice(index, end);
        const digest = crypto.createHash("sha256").update(run).digest("hex").slice(0, 12);

        compacted += html.slice(copiedUpTo, index) + "{base64:" + digest + ":" + run.length + "}";
        copiedUpTo = end;
      }

      index = end;
    }

    return compacted + html.slice(copiedUpTo);
  };

  // The HTML without its tags, as a reader sees its text. A loop as well.
  const withoutTags = (html) => {
    let text = "";
    let copiedUpTo = 0;

    for (let open = html.indexOf("<"); open !== -1; open = html.indexOf("<", copiedUpTo)) {
      const close = html.indexOf(">", open);

      if (close === -1) {
        break;
      }

      text += html.slice(copiedUpTo, open);
      copiedUpTo = close + 1;
    }

    return text + html.slice(copiedUpTo);
  };

  const readInput = () => {
    return new Promise((resolve) => {
      let input = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        input += chunk;
      });
      process.stdin.on("end", () => {
        resolve(input);
      });
    });
  };

  (async () => {
    const built = await esbuild.build({
      stdin: {
        contents: [
          'import React from "react";',
          'import { renderToStaticMarkup } from "react-dom/server";',
          'import MarkdownViewer from "./UI/Components/Markdown.tsx/MarkdownViewer";',
          "export const renderViewer = (props) => renderToStaticMarkup(React.createElement(MarkdownViewer, props));",
        ].join("\n"),
        resolveDir: process.cwd(),
        loader: "tsx",
        sourcefile: "markdown-viewer-screenshots.tsx",
      },
      bundle: true,
      platform: "node",
      format: "cjs",
      tsconfig: path.join(process.cwd(), "tsconfig.json"),
      write: false,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
      loader: { ".css": "empty", ".svg": "empty", ".png": "empty" },
      plugins: [
        {
          name: "stand-ins",
          setup: (build) => {
            build.onResolve({ filter: /^(react-syntax-highlighter|mermaid)(\/.*)?$/ }, (args) => {
              return { path: args.path, namespace: "stand-in" };
            });
            build.onLoad({ filter: /.*/, namespace: "stand-in" }, () => {
              return {
                contents: [
                  'import React from "react";',
                  "const Highlighter = (props) => React.createElement(\"pre\", { \"data-highlighted\": props.language || \"\" }, props.children);",
                  "Highlighter.registerLanguage = () => {};",
                  "export default Highlighter;",
                  "export const vscDarkPlus = {};",
                ].join("\n"),
                loader: "js",
                resolveDir: process.cwd(),
              };
            });
          },
        },
      ],
    });

    const { JSDOM } = require("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>", {
      url: "https://oneuptime.example.com/dashboard/incidents",
    });

    for (const name of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "Node"]) {
      try {
        Object.defineProperty(globalThis, name, {
          value: name === "window" ? dom.window : dom.window[name],
          configurable: true,
          writable: true,
        });
      } catch (error) {
        // A global node already has (navigator) can stay.
      }
    }

    const bundle = { exports: {} };
    new Function("module", "exports", "require", "__filename", "__dirname", built.outputFiles[0].text)(
      bundle,
      bundle.exports,
      require,
      path.join(process.cwd(), "markdown-viewer-screenshots.js"),
      process.cwd(),
    );

    const cases = JSON.parse(await readInput());
    const rendered = {};

    for (const item of cases) {
      try {
        const html = bundle.exports.renderViewer({ text: item.text, safeMode: item.safeMode });

        rendered[item.name] = {
          ok: true,
          html: compact(html),
          text: compact(withoutTags(html)),
        };
      } catch (error) {
        rendered[item.name] = {
          ok: false,
          error: String((error && error.message) || error).split("\n")[0].slice(0, 300),
        };
      }
    }

    // The state this is about: the base64 check the parser once used runs out of stack here.
    let oldBase64Pattern = "matched";

    try {
      /^[A-Za-z0-9+/]+={0,2}$/.test("iVBO".repeat(1024 * 1024));
    } catch (error) {
      oldBase64Pattern = String(error.message);
    }

    /*
     * A write to a pipe is not done when write returns: what the reader has
     * not taken yet waits in the stream, and exiting then would cut the report
     * short. Exit once it is written.
     */
    process.stdout.write(JSON.stringify({ rendered, oldBase64Pattern }), () => {
      process.exit(0);
    });
  })().catch((error) => {
    process.stderr.write(String((error && error.stack) || error), () => {
      process.exit(1);
    });
  });
`;

interface RenderCase {
  name: string;
  text: string;
  safeMode?: boolean | undefined;
}

interface RenderedCase {
  ok: boolean;
  // The HTML, and its text without tags: both compacted.
  html?: string;
  text?: string;
  error?: string;
}

interface RenderReport {
  rendered: Record<string, RenderedCase>;
  oldBase64Pattern: string;
}

function renderWithRealViewer(cases: Array<RenderCase>): RenderReport {
  return JSON.parse(
    childProcess.execFileSync(
      process.execPath,
      [
        "--no-regexp-optimization",
        "--max-old-space-size=8192",
        "-e",
        RENDER_SCRIPT,
      ],
      {
        cwd: COMMON_ROOT,
        /*
         * The viewer's imports reach typeorm, whose app-root-path looks for
         * the main module's file - and a script run with -e has none.
         */
        env: { ...process.env, APP_ROOT_PATH: COMMON_ROOT },
        input: JSON.stringify(cases),
        encoding: "utf8",
        timeout: 540000,
        maxBuffer: 64 * 1024 * 1024,
      },
    ),
  ) as RenderReport;
}

// How `run` - a run of base64 in the HTML - comes back from the process.
function compacted(run: string): string {
  if (run.length < COMPACT_LENGTH) {
    return run;
  }

  return `{base64:${crypto.createHash("sha256").update(run).digest("hex").slice(0, 12)}:${run.length}}`;
}

// The address of an inline image, as it comes back.
function imageAddress(mimeType: string, base64: string): string {
  const data: string = withoutPadding(base64);

  return `data:${mimeType};base64,${compacted(data)}${base64.slice(data.length)}`;
}

interface ShownImage {
  src: string | null;
  alt: string | null;
  title: string | null;
}

const IMAGE_TAG: RegExp = /<img\b([^>]*)>/g;

// A link's opening tag: never past the next "<", so it reads in linear time.
const LINK_TAG: RegExp = /<a\b([^<>]*)>/g;

function attributeOf(tag: string, name: string): string | null {
  const match: RegExpMatchArray | null = tag.match(
    new RegExp(`\\s${name}="([^"]*)"`),
  );

  return match ? match[1]! : null;
}

// Every image in the (compacted) HTML, in order.
function imagesIn(html: string): Array<ShownImage> {
  return Array.from(html.matchAll(IMAGE_TAG)).map(
    (match: RegExpMatchArray): ShownImage => {
      return {
        src: attributeOf(match[1]!, "src"),
        alt: attributeOf(match[1]!, "alt"),
        title: attributeOf(match[1]!, "title"),
      };
    },
  );
}

// Every link's address in the (compacted) HTML, in order.
function hrefsIn(html: string): Array<string> {
  return Array.from(html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

// The text of the HTML, its HTML escapes undone.
function unescaped(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/*
 * Whether the viewer read the text as Markdown: never as written - the
 * whole text (showAsText), or a block held back as text (heldLines).
 */
function readAsMarkdown(html: string): boolean {
  return (
    !html.includes('data-testid="markdown-viewer-text"') &&
    !html.includes("whitespace-pre-wrap")
  );
}

describe("the real MarkdownViewer shows a synthetic monitor's screenshot, in a process that has run a while", () => {
  const JPEG_30KB: string = screenshot(JPEG_SIGNATURE, 30 * KB, 1);
  const PNG_100KB: string = screenshot(PNG_SIGNATURE, 100 * KB, 2);
  const JPEG_SIZES: Array<[string, number]> = [
    ["8 KB", 8 * KB],
    ["12 KB", 12 * KB],
    ["47 KB", 47 * KB],
    ["49 KB", 49 * KB],
  ];
  const PNG_SIZES: Array<[string, number]> = [
    ["100 KB", 100 * KB],
    ["3 MB", 3 * MB],
    ["12 MB", 12 * MB],
  ];
  const SVG_30KB: string = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg">${"<rect/>".repeat(4500)}</svg>`,
  ).toString("base64");
  const NOT_AN_IMAGE: string = Buffer.from("x".repeat(30 * KB)).toString(
    "base64",
  );
  const LONG_QUERY: string = "a".repeat(70000);
  // Letters only: were it copied, it would come back compacted.
  const LONG_TITLE: string = "Failed".repeat(20000);

  const sized: Record<string, string> = {};
  const cases: Array<RenderCase> = [];

  const add: (name: string, text: string, safeMode?: boolean) => void = (
    name: string,
    text: string,
    safeMode?: boolean,
  ): void => {
    cases.push({ name: name, text: text, safeMode: safeMode });
  };

  add("the issue's description", issueDescription(JPEG_30KB));

  add(
    "a JPEG the template calls a PNG",
    describeIncident(
      "Monitor is down\n![Home](data:image/png;base64,{{syntheticResponses.0.screenshots.home}})",
      [syntheticRun({ home: JPEG_30KB })],
    ),
  );

  for (const [label, byteCount] of JPEG_SIZES) {
    sized[label] = screenshot(JPEG_SIGNATURE, byteCount, 3);
    add(`a JPEG of ${label}`, issueDescription(sized[label]!));
  }

  for (const [label, byteCount] of PNG_SIZES) {
    sized[label] = screenshot(PNG_SIGNATURE, byteCount, 4);
    add(
      `a PNG of ${label}`,
      describeIncident(
        "Monitor is down - {{syntheticResponses.0.scriptError}}\n\n![Home](data:image/png;base64,{{syntheticResponses.0.screenshots.home}})",
        [syntheticRun({ home: sized[label]! })],
      ),
    );
  }

  add(
    "Markdown around the screenshot",
    describeIncident(
      [
        "**Checkout failed** on [step 3](https://example.com/runs/42): `{{syntheticResponses.0.scriptError}}`",
        "![Cart](data:image/jpeg;base64,{{syntheticResponses.0.screenshots.cart}})",
        "",
        "- Browser: {{syntheticResponses.0.browserType}}",
        "- Screen: {{syntheticResponses.0.screenSizeType}}",
      ].join("\n"),
      [syntheticRun({ cart: JPEG_30KB })],
    ),
  );

  add(
    "a screenshot of each run",
    describeIncident(
      "Monitor is down\n\n{{#each syntheticResponses}}![{{browserType}} on {{screenSizeType}}](data:image/jpeg;base64,{{screenshots.home}})\n{{/each}}",
      [
        syntheticRun({ home: JPEG_30KB }),
        syntheticRun(
          { home: screenshot(JPEG_SIGNATURE, 30 * KB, 5) },
          {
            browserType: BrowserType.Firefox,
            screenSizeType: ScreenSizeType.Mobile,
          },
        ),
      ],
    ),
  );

  add(
    "five screenshots, with alt texts and titles",
    [
      "Every step failed:",
      `![Home](data:image/jpeg;base64,${JPEG_30KB} "Step 1")`,
      `![Search](data:image/jpeg;base64,${screenshot(JPEG_SIGNATURE, 30 * KB, 6)} "Step 2")`,
      `![Cart](data:image/jpeg;base64,${screenshot(JPEG_SIGNATURE, 30 * KB, 7)})`,
      "",
      `![Payment](data:image/png;base64,${PNG_100KB} "Step 4")`,
      `![Receipt](data:image/png;base64,${screenshot(PNG_SIGNATURE, 100 * KB, 8)})`,
    ].join("\n"),
  );

  add(
    "a reference-style screenshot",
    `Monitor is down\n\n![Home][home]\n\n[home]: data:image/png;base64,${PNG_100KB}`,
  );

  add(
    "a screenshot referenced twice",
    `Monitor is down\n\n![Before][home] ![After][home]\n\n[home]: data:image/png;base64,${sized["3 MB"]!}`,
  );

  // 600 MB of addresses, were every reference given the screenshot.
  add(
    "a screenshot referenced two hundred times",
    `Monitor is down\n\n${"![Home][home]\n".repeat(200)}\n[home]: data:image/png;base64,${sized["3 MB"]!}`,
  );

  add(
    "a long title referenced two hundred times",
    `Monitor is down\n\n${"[The failed run][run]\n".repeat(200)}\n[run]: https://example.com/runs/42 "${LONG_TITLE}"`,
  );

  add(
    "screenshots in a list, a quote and a table",
    [
      `- Step 1\n  ![Home](data:image/jpeg;base64,${JPEG_30KB})`,
      "",
      `> ![Cart](data:image/png;base64,${PNG_100KB})`,
      "",
      "| Step | Screenshot |",
      "| --- | --- |",
      `| 1 | ![Home](data:image/jpeg;base64,${JPEG_30KB}) |`,
    ].join("\n"),
  );

  add(
    "an SVG, a data: link, an image that is not one and HTML, all long",
    [
      `![Graph](data:image/svg+xml;base64,${SVG_30KB})`,
      "",
      `[Open the screenshot](data:image/jpeg;base64,${JPEG_30KB})`,
      "",
      `![Fake](data:image/png;base64,${NOT_AN_IMAGE})`,
      "",
      `![Page](data:text/html;base64,${NOT_AN_IMAGE})`,
    ].join("\n"),
  );

  add(
    "base64 data written as text",
    [
      "Before",
      "",
      "```",
      `POST /upload payload;base64,${withoutPadding(PNG_100KB)}`,
      "```",
      "",
      `The probe sent \`payload;base64,${withoutPadding(JPEG_30KB)}\` and stopped.`,
      "",
      "After",
    ].join("\n"),
  );

  add(
    "a link of more than 64 KB",
    `Monitor is down\n\n[The failed run](https://example.com/runs/42?q=${LONG_QUERY})`,
  );

  add(
    "the issue's description in safe mode",
    issueDescription(JPEG_30KB),
    true,
  );

  let report: RenderReport;

  beforeAll(() => {
    report = renderWithRealViewer(cases);
  }, 600000);

  // The (compacted) HTML of a case, which must have rendered.
  const htmlOf: (name: string) => string = (name: string): string => {
    expect({
      name: name,
      ...report.rendered[name],
      html: undefined,
      text: undefined,
    }).toEqual({ name: name, ok: true, html: undefined, text: undefined });

    return report.rendered[name]!.html!;
  };

  /*
   * The (compacted) text of a case as a reader sees it, without the line
   * breaks React writes between blocks at its ends.
   */
  const textOf: (name: string) => string = (name: string): string => {
    htmlOf(name);

    return unescaped(report.rendered[name]!.text!).trim();
  };

  test("the process compiles regular expressions unoptimized, as one that has run a while", () => {
    expect(report.oldBase64Pattern).toBe("Maximum call stack size exceeded");
  });

  test("the issue's description: the error, then the screenshot - never its base64 as text", () => {
    const html: string = htmlOf("the issue's description");

    expect(imagesIn(html)).toEqual([
      { src: imageAddress("image/jpeg", JPEG_30KB), alt: "", title: null },
    ]);
    expect(textOf("the issue's description")).toBe(
      "Monitor is down - Timeout 30000ms exceeded",
    );
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("a JPEG the template calls a PNG is shown as the JPEG it is", () => {
    expect(imagesIn(htmlOf("a JPEG the template calls a PNG"))).toEqual([
      { src: imageAddress("image/jpeg", JPEG_30KB), alt: "Home", title: null },
    ]);
  });

  test.each(JPEG_SIZES)("a JPEG of %s is shown", (label: string) => {
    const html: string = htmlOf(`a JPEG of ${label}`);

    expect(imagesIn(html)).toEqual([
      { src: imageAddress("image/jpeg", sized[label]!), alt: "", title: null },
    ]);
    expect(textOf(`a JPEG of ${label}`)).toBe(
      "Monitor is down - Timeout 30000ms exceeded",
    );
    expect(readAsMarkdown(html)).toBe(true);
  });

  test.each(PNG_SIZES)(
    "a PNG of %s is shown whole - not an empty image",
    (label: string) => {
      const html: string = htmlOf(`a PNG of ${label}`);

      expect(imagesIn(html)).toEqual([
        {
          src: imageAddress("image/png", sized[label]!),
          alt: "Home",
          title: null,
        },
      ]);
      expect(textOf(`a PNG of ${label}`)).toBe(
        "Monitor is down - Timeout 30000ms exceeded",
      );
      expect(readAsMarkdown(html)).toBe(true);
    },
  );

  test("the Markdown around a screenshot is read as Markdown", () => {
    const html: string = htmlOf("Markdown around the screenshot");

    expect(html).toContain(">Checkout failed</strong>");
    expect(hrefsIn(html)).toEqual(["https://example.com/runs/42"]);
    expect(html).toContain(">Timeout 30000ms exceeded</code>");
    expect(imagesIn(html)).toEqual([
      { src: imageAddress("image/jpeg", JPEG_30KB), alt: "Cart", title: null },
    ]);
    expect(html.match(/<li\b/g)).toHaveLength(2);
    expect(textOf("Markdown around the screenshot")).toContain(
      "Browser: Chromium",
    );
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("a template's screenshot of each run is shown, one after another", () => {
    const html: string = htmlOf("a screenshot of each run");

    expect(
      imagesIn(html).map(
        (image: ShownImage): [string | null, string | null] => {
          return [image.alt, image.src];
        },
      ),
    ).toEqual([
      ["Chromium on Desktop", imageAddress("image/jpeg", JPEG_30KB)],
      [
        "Firefox on Mobile",
        imageAddress("image/jpeg", screenshot(JPEG_SIGNATURE, 30 * KB, 5)),
      ],
    ]);
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("five screenshots of a description are all shown, with their alt texts and titles", () => {
    expect(
      imagesIn(htmlOf("five screenshots, with alt texts and titles")),
    ).toEqual([
      {
        src: imageAddress("image/jpeg", JPEG_30KB),
        alt: "Home",
        title: "Step 1",
      },
      {
        src: imageAddress("image/jpeg", screenshot(JPEG_SIGNATURE, 30 * KB, 6)),
        alt: "Search",
        title: "Step 2",
      },
      {
        src: imageAddress("image/jpeg", screenshot(JPEG_SIGNATURE, 30 * KB, 7)),
        alt: "Cart",
        title: null,
      },
      {
        src: imageAddress("image/png", PNG_100KB),
        alt: "Payment",
        title: "Step 4",
      },
      {
        src: imageAddress("image/png", screenshot(PNG_SIGNATURE, 100 * KB, 8)),
        alt: "Receipt",
        title: null,
      },
    ]);
  });

  test("a reference-style screenshot is shown", () => {
    const html: string = htmlOf("a reference-style screenshot");

    expect(imagesIn(html)).toEqual([
      { src: imageAddress("image/png", PNG_100KB), alt: "Home", title: null },
    ]);
    expect(textOf("a reference-style screenshot")).toBe("Monitor is down");
  });

  test("a screenshot defined once is shown at each of its references", () => {
    expect(imagesIn(htmlOf("a screenshot referenced twice"))).toEqual([
      {
        src: imageAddress("image/png", sized["3 MB"]!),
        alt: "Before",
        title: null,
      },
      {
        src: imageAddress("image/png", sized["3 MB"]!),
        alt: "After",
        title: null,
      },
    ]);
  });

  test("a screenshot referenced past what references may carry is drawn empty at each - and the page renders", () => {
    const html: string = htmlOf("a screenshot referenced two hundred times");

    expect(imagesIn(html)).toEqual(
      Array.from({ length: 200 }, (): ShownImage => {
        return { src: "", alt: "Home", title: null };
      }),
    );
    expect(html).not.toContain("{base64:");
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("a long title referenced past what references may carry is left out, the links kept", () => {
    const html: string = htmlOf("a long title referenced two hundred times");
    const links: Array<RegExpMatchArray> = Array.from(
      html.matchAll(/<a\b([^>]*)>/g),
    );

    expect(hrefsIn(html)).toEqual(
      Array.from({ length: 200 }, (): string => {
        return "https://example.com/runs/42";
      }),
    );
    expect(
      links.map((link: RegExpMatchArray): string | null => {
        return attributeOf(link[1]!, "title");
      }),
    ).toEqual(
      Array.from({ length: 200 }, (): null => {
        return null;
      }),
    );
    expect(html).not.toContain("{base64:");
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("screenshots in a list, a quote and a table are shown", () => {
    const html: string = htmlOf("screenshots in a list, a quote and a table");

    expect(imagesIn(html)).toEqual([
      { src: imageAddress("image/jpeg", JPEG_30KB), alt: "Home", title: null },
      { src: imageAddress("image/png", PNG_100KB), alt: "Cart", title: null },
      { src: imageAddress("image/jpeg", JPEG_30KB), alt: "Home", title: null },
    ]);
    expect(html).toContain("<blockquote");
    expect(html).toContain("<table");
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("an SVG, a data: link, an image whose bytes are none and HTML stay blocked, long as they are - their data shown nowhere", () => {
    const html: string = htmlOf(
      "an SVG, a data: link, an image that is not one and HTML, all long",
    );

    expect(imagesIn(html)).toEqual([
      { src: "", alt: "Graph", title: null },
      { src: "", alt: "Fake", title: null },
      { src: "", alt: "Page", title: null },
    ]);
    expect(hrefsIn(html)).toEqual([""]);
    expect(
      textOf(
        "an SVG, a data: link, an image that is not one and HTML, all long",
      ),
    ).toBe("Open the screenshot");
    expect(html).not.toContain("{base64:");
  });

  test("base64 data written as text is shown as text, as it was written", () => {
    const html: string = htmlOf("base64 data written as text");

    expect(imagesIn(html)).toEqual([]);
    // A code block's text ends with a line break, as it always has.
    expect(textOf("base64 data written as text")).toBe(
      [
        "Before",
        `POST /upload payload;base64,${compacted(withoutPadding(PNG_100KB))}`,
        "",
        `The probe sent payload;base64,${compacted(withoutPadding(JPEG_30KB))} and stopped.`,
        "After",
      ].join("\n"),
    );
    // Both in code: the block, and the span in the sentence.
    expect(html.match(/<code\b/g)).toHaveLength(2);
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("a link of more than 64 KB keeps its whole address", () => {
    expect(hrefsIn(htmlOf("a link of more than 64 KB"))).toEqual([
      `https://example.com/runs/42?q=${compacted(LONG_QUERY)}`,
    ]);
  });

  test("in safe mode no image is drawn, and its data is not shown as text either", () => {
    const html: string = htmlOf("the issue's description in safe mode");

    expect(imagesIn(html)).toEqual([]);
    expect(html).not.toContain("{base64:");
    expect(textOf("the issue's description in safe mode")).toBe(
      "Monitor is down - Timeout 30000ms exceeded",
    );
  });
});

/*
 * ISSUE #7229 IN THE DASHBOARD: A LINK ACROSS THE START OF AN OVER-LONG
 * LINE'S MIDDLE.
 *
 * The viewer holds back the middle of an over-long line as the emails do
 * (Utils/Markdown/OverLongText). A link, an image or a link reference
 * definition whose address is longer than the line's kept start, with a
 * title that takes the line over 64 KB, was held back in one piece from
 * the address to the title, and remark read no link. Now the rest of the
 * address and of the title are held back apart, and the viewer shows the
 * link with its address and its title - in a process that compiles regular
 * expressions unoptimized, as a browser tab that has run a while does. The
 * same at the middle's other end: a link whose address runs into the
 * line's kept end keeps its "[Run](" in view.
 */
describe("the real MarkdownViewer shows a link across either end of an over-long line's middle (#7229)", () => {
  // The issue's title: 68 KB, so each row is a line of about 70 KB.
  const TITLE: string = "Checkout failed. ".repeat(4000);
  // No run of base64 in it: it comes back as it is, not compacted.
  const ADDRESS: string = `https://example.com/${"a-".repeat(1000)}run`;

  const cases: Array<RenderCase> = [
    { name: "a link", text: `[Run](${ADDRESS} "${TITLE}")` },
    { name: "an image", text: `![Shot](${ADDRESS}.png "${TITLE}")` },
    {
      name: "a reference",
      text: `[Run][s] and [again][s]\n\n[s]: ${ADDRESS} "${TITLE}"`,
    },
    {
      name: "the 500-character row",
      text: `[Run](https://example.com/${"a-".repeat(250)} "${TITLE}")`,
    },
    {
      name: "a bare address",
      text: `See ${ADDRESS}. Then ${"lorem ipsum ".repeat(6000)}`,
    },
    // The other end of the middle: a long address at the end of a long line.
    {
      name: "a link at the end",
      text: `${"lorem ipsum ".repeat(6000)}see [Run](${ADDRESS}) now`,
    },
    {
      name: "an image at the end",
      text: `${"lorem ipsum ".repeat(6000)}![Shot](${ADDRESS}.png "Home page")`,
    },
  ];

  let report: RenderReport;

  beforeAll(() => {
    report = renderWithRealViewer(cases);
  }, 600000);

  const htmlOf: (name: string) => string = (name: string): string => {
    expect({ name: name, ok: report.rendered[name]!.ok }).toEqual({
      name: name,
      ok: true,
    });

    return report.rendered[name]!.html!;
  };

  const titlesIn: (html: string) => Array<string | null> = (
    html: string,
  ): Array<string | null> => {
    return Array.from(html.matchAll(LINK_TAG)).map(
      (link: RegExpMatchArray): string | null => {
        return attributeOf(link[1]!, "title");
      },
    );
  };

  test("the cases are lines over 64 KB", () => {
    for (const item of cases) {
      expect(item.text.length).toBeGreaterThan(OVER_LONG_LINE_LENGTH);
    }
  });

  test("a link is shown with its address and its title", () => {
    const html: string = htmlOf("a link");

    expect(hrefsIn(html)).toEqual([ADDRESS]);
    expect(titlesIn(html)).toEqual([TITLE]);
    expect(html).not.toContain("[Run](");
    expect(readAsMarkdown(html)).toBe(true);
  });

  test("an image is shown with its address and its title", () => {
    const html: string = htmlOf("an image");

    expect(imagesIn(html)).toEqual([
      { src: `${ADDRESS}.png`, alt: "Shot", title: TITLE },
    ]);
    expect(html).not.toContain("![Shot](");
  });

  test("a reference links to its definition's address, with the title", () => {
    const html: string = htmlOf("a reference");

    expect(hrefsIn(html)).toEqual([ADDRESS, ADDRESS]);
    expect(titlesIn(html)).toEqual([TITLE, TITLE]);
    expect(html).not.toContain("[s]:");
  });

  test("the 500-character row is shown as it always was", () => {
    const html: string = htmlOf("the 500-character row");

    expect(hrefsIn(html)).toEqual([`https://example.com/${"a-".repeat(250)}`]);
    expect(titlesIn(html)).toEqual([TITLE]);
  });

  test("a bare address links to itself alone, not to the text after it", () => {
    const html: string = htmlOf("a bare address");

    expect(hrefsIn(html)).toEqual([ADDRESS]);
  });

  test("a link whose address runs into the line's kept end is shown with its whole address", () => {
    const html: string = htmlOf("a link at the end");

    expect(hrefsIn(html)).toEqual([ADDRESS]);
    expect(html).not.toContain("[Run](");
  });

  test("an image whose address runs into the line's kept end is shown, with its title", () => {
    const html: string = htmlOf("an image at the end");

    expect(imagesIn(html)).toEqual([
      { src: `${ADDRESS}.png`, alt: "Shot", title: "Home page" },
    ]);
    expect(html).not.toContain("![Shot](");
  });
});
