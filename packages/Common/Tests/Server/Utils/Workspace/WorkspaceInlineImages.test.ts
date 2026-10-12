import WorkspaceInlineImages from "../../../../Server/Utils/Workspace/WorkspaceInlineImages";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadInlineImage,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import { describe, expect, test } from "@jest/globals";

/*
 * WorkspaceInlineImages splits each markdown block of a Slack or Microsoft
 * Teams message that carries a screenshot (an image whose address is a
 * data: URL) into its text and its images, in the order they read. Every
 * other block goes through as it was.
 */

// A real 1x1 PNG, as the probe's Buffer.toString("base64") writes it.
const PNG: string =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DATA_URL: string = `data:image/png;base64,${PNG}`;

function markdown(text: string): WorkspacePayloadMarkdown {
  return { _type: "WorkspacePayloadMarkdown", text: text };
}

function header(text: string): WorkspaceMessageBlock {
  return {
    _type: "WorkspacePayloadHeader",
    text: text,
  } as WorkspaceMessageBlock;
}

// A block, as compared: markdown by its text, an image by what it shows.
type BlockSummary =
  | string
  | { image: string; alt: string; fallback: string }
  | { other: string };

function summarize(blocks: Array<WorkspaceMessageBlock>): Array<BlockSummary> {
  return blocks.map((block: WorkspaceMessageBlock): BlockSummary => {
    if (block._type === "WorkspacePayloadMarkdown") {
      return (block as WorkspacePayloadMarkdown).text;
    }

    if (block._type === "WorkspacePayloadInlineImage") {
      const image: WorkspacePayloadInlineImage =
        block as WorkspacePayloadInlineImage;
      return {
        image: image.image.mimeType,
        alt: image.altText,
        fallback: image.fallbackMarkdown,
      };
    }

    return { other: block._type };
  });
}

describe("WorkspaceInlineImages.splitMessageBlocks", () => {
  test("returns an empty message as it is", () => {
    expect(WorkspaceInlineImages.splitMessageBlocks([])).toEqual([]);
  });

  test("passes blocks that are not markdown through untouched", () => {
    const block: WorkspaceMessageBlock = header(`![x](${DATA_URL})`);

    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([block]);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(block);
  });

  test("passes markdown with no data: URL through as the same block", () => {
    const block: WorkspacePayloadMarkdown = markdown(
      "Incident **created** with ![a](https://example.com/x.png)",
    );

    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([block]);

    expect(result).toEqual([block]);
    expect(result[0]).toBe(block);
    expect(WorkspaceInlineImages.getSplitFrom(result[0]!)).toBeUndefined();
  });

  test("passes markdown that mentions data: but holds no image through as it is", () => {
    const block: WorkspacePayloadMarkdown = markdown("Text data: but no image");

    expect(WorkspaceInlineImages.splitMessageBlocks([block])[0]).toBe(block);
  });

  test("leaves a block alone when its data: URLs are not raster images", () => {
    const block: WorkspacePayloadMarkdown = markdown(
      "![svg](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)",
    );

    expect(WorkspaceInlineImages.splitMessageBlocks([block])[0]).toBe(block);
  });

  test("splits a screenshot out of a description, where it was", () => {
    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        markdown(`Timeout 30000ms exceeded\n![Login page](${DATA_URL})\nAfter`),
      ]);

    expect(summarize(result)).toEqual([
      "Timeout 30000ms exceeded",
      { image: "image/png", alt: "Login page", fallback: "Login page" },
      "After",
    ]);
  });

  test("an image block carries the image itself, never its base64 as text", () => {
    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        markdown(`Before\n![Login page](${DATA_URL})`),
      ]);

    const image: WorkspacePayloadInlineImage =
      WorkspaceInlineImages.getInlineImages(result)[0]!;

    expect(image.image.base64).toBe(PNG);
    expect(image.image.fileExtension).toBe("png");

    for (const block of result) {
      if (block._type === "WorkspacePayloadMarkdown") {
        expect((block as WorkspacePayloadMarkdown).text).not.toContain(PNG);
      }
    }
  });

  test("an image with no alt text falls back to [image]", () => {
    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        markdown(`Before\n![](${DATA_URL})`),
      ]);

    expect(summarize(result)).toEqual([
      "Before",
      { image: "image/png", alt: "", fallback: "\\[image\\]" },
    ]);
  });

  test("a block of nothing but images becomes the images alone", () => {
    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        markdown(`![one](${DATA_URL})\n\n![two](${DATA_URL})`),
      ]);

    expect(summarize(result)).toEqual([
      { image: "image/png", alt: "one", fallback: "one" },
      { image: "image/png", alt: "two", fallback: "two" },
    ]);
  });

  test("keeps the order of the blocks around a split one", () => {
    const first: WorkspaceMessageBlock = header("Incident Created");
    const last: WorkspacePayloadMarkdown = markdown("Owners: Ada");

    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        first,
        markdown(`Before\n![Shot](${DATA_URL})\nAfter`),
        last,
      ]);

    expect(summarize(result)).toEqual([
      { other: "WorkspacePayloadHeader" },
      "Before",
      { image: "image/png", alt: "Shot", fallback: "Shot" },
      "After",
      "Owners: Ada",
    ]);
    expect(result[0]).toBe(first);
    expect(result[4]).toBe(last);
  });

  describe("link reference definitions", () => {
    const text: string = `Before [docs][d]\n![](${DATA_URL})\nAfter [docs][d]\n\n[d]: https://example.com`;

    test("are left out of the pieces by default", () => {
      const result: Array<WorkspaceMessageBlock> =
        WorkspaceInlineImages.splitMessageBlocks([markdown(text)]);

      const texts: Array<string> = result
        .filter((block: WorkspaceMessageBlock) => {
          return block._type === "WorkspacePayloadMarkdown";
        })
        .map((block: WorkspaceMessageBlock) => {
          return (block as WorkspacePayloadMarkdown).text;
        });

      expect(texts[0]).toBe("Before [docs][d]");
      for (const piece of texts) {
        expect(piece).not.toContain("[d]: https://example.com");
      }
    });

    test("go in front of every markdown piece with repeatLinkDefinitions", () => {
      const result: Array<WorkspaceMessageBlock> =
        WorkspaceInlineImages.splitMessageBlocks([markdown(text)], {
          repeatLinkDefinitions: true,
        });

      expect(summarize(result)).toEqual([
        "[d]: https://example.com\n\nBefore [docs][d]",
        { image: "image/png", alt: "", fallback: "\\[image\\]" },
        "[d]: https://example.com\n\nAfter [docs][d]\n\n",
      ]);
    });

    test("repeatLinkDefinitions adds nothing when there are no definitions", () => {
      const result: Array<WorkspaceMessageBlock> =
        WorkspaceInlineImages.splitMessageBlocks(
          [markdown(`Before\n![Shot](${DATA_URL})\nAfter`)],
          { repeatLinkDefinitions: true },
        );

      expect(summarize(result)).toEqual([
        "Before",
        { image: "image/png", alt: "Shot", fallback: "Shot" },
        "After",
      ]);
    });
  });
});

describe("WorkspaceInlineImages.getSplitFrom", () => {
  test("names the block each markdown piece was split out of", () => {
    const original: WorkspacePayloadMarkdown = markdown(
      `Before\n![Shot](${DATA_URL})\nAfter`,
    );

    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([original]);

    expect(WorkspaceInlineImages.getSplitFrom(result[0]!)).toBe(original);
    expect(WorkspaceInlineImages.getSplitFrom(result[2]!)).toBe(original);
  });

  test("is undefined for image blocks and for blocks never split", () => {
    const untouched: WorkspacePayloadMarkdown = markdown("plain");

    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        untouched,
        markdown(`Before\n![Shot](${DATA_URL})`),
      ]);

    expect(WorkspaceInlineImages.getSplitFrom(result[0]!)).toBeUndefined();
    expect(result[2]!._type).toBe("WorkspacePayloadInlineImage");
    expect(WorkspaceInlineImages.getSplitFrom(result[2]!)).toBeUndefined();
  });

  test("keeps pieces of two blocks apart", () => {
    const first: WorkspacePayloadMarkdown = markdown(`One\n![a](${DATA_URL})`);
    const second: WorkspacePayloadMarkdown = markdown(`Two\n![b](${DATA_URL})`);

    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([first, second]);

    expect(summarize(result)).toEqual([
      "One",
      { image: "image/png", alt: "a", fallback: "a" },
      "Two",
      { image: "image/png", alt: "b", fallback: "b" },
    ]);
    expect(WorkspaceInlineImages.getSplitFrom(result[0]!)).toBe(first);
    expect(WorkspaceInlineImages.getSplitFrom(result[2]!)).toBe(second);
  });
});

describe("WorkspaceInlineImages.getInlineImages", () => {
  test("is empty when there are none", () => {
    expect(
      WorkspaceInlineImages.getInlineImages([
        markdown("text"),
        header("title"),
      ]),
    ).toEqual([]);
  });

  test("returns the image blocks in order", () => {
    const result: Array<WorkspaceMessageBlock> =
      WorkspaceInlineImages.splitMessageBlocks([
        markdown(`![first](${DATA_URL})\n\ntext\n\n![second](${DATA_URL})`),
      ]);

    expect(
      WorkspaceInlineImages.getInlineImages(result).map(
        (image: WorkspacePayloadInlineImage) => {
          return image.altText;
        },
      ),
    ).toEqual(["first", "second"]);
  });
});
