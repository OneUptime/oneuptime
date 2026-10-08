import { afterEach, describe, expect, test } from "@jest/globals";
import SlackifyMarkdown from "slackify-markdown";
import SlackUtil, {
  CutMarkdown,
} from "../../../../../Server/Utils/Workspace/Slack/Slack";
import API from "../../../../../Utils/API";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * SLACK MESSAGES WHATEVER SIZE OF TEXT THEY CARRY.
 *
 * A description can carry a response body or a log of many megabytes.
 * slackify (Slack's Markdown) takes time that grows with the square of a
 * long line and ran out of stack on one of a few megabytes, and Slack shows
 * no more than MAX_SECTIONS_PER_MARKDOWN_BLOCK sections of 3000 characters
 * of one block anyway. So Markdown longer than one section more than that
 * is cut before slackify reads it, and ends with the truncated note.
 *
 * The incoming webhook - status page subscribers, workflows - sent one
 * section with all of the text in it, and Slack refuses a whole message
 * with a section over 3000 characters: such messages were never delivered.
 * It now sends the sections the bot does.
 */

const MAX_LENGTH: number = SlackUtil.SECTION_TEXT_MAX_LENGTH;
const NOTE: string = SlackUtil.TRUNCATED_SECTION_NOTE;
const MIB: number = 1024 * 1024;

interface PostCallArgs {
  url: URL;
  data: JSONObject;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function sectionTexts(blocks: Array<JSONObject>): Array<string> {
  return blocks.map((block: JSONObject): string => {
    return (block["text"] as JSONObject)["text"] as string;
  });
}

function markdownBlocks(
  text: string,
  maxSections?: number | undefined,
): Array<JSONObject> {
  return SlackUtil.getMarkdownBlocks({
    payloadMarkdownBlock: { _type: "WorkspacePayloadMarkdown", text: text },
    maxSections: maxSections,
  });
}

describe("SlackUtil.cutMarkdown", () => {
  test("cuts at one section more than a markdown block can show", () => {
    expect(SlackUtil.MARKDOWN_MAX_LENGTH).toBe(
      (SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK + 1) * MAX_LENGTH,
    );
  });

  test("leaves Markdown that fits as it is", () => {
    const text: string = "line\n".repeat(SlackUtil.MARKDOWN_MAX_LENGTH / 5);

    const cut: CutMarkdown = SlackUtil.cutMarkdown(text);

    expect(cut.isCutShort).toBe(false);
    expect(cut.text === text).toBe(true);
  });

  test("cuts longer Markdown at its last line break before the limit", () => {
    const text: string = "a line of text\n".repeat(10000);

    const cut: CutMarkdown = SlackUtil.cutMarkdown(text);

    expect(cut.isCutShort).toBe(true);
    expect(cut.text.length).toBeLessThanOrEqual(SlackUtil.MARKDOWN_MAX_LENGTH);
    expect(cut.text.endsWith("a line of text")).toBe(true);
    expect(text.startsWith(cut.text)).toBe(true);
  });

  test("cuts one long line where it stops fitting, never inside an emoji", () => {
    const text: string = "😀".repeat(SlackUtil.MARKDOWN_MAX_LENGTH);

    const cut: CutMarkdown = SlackUtil.cutMarkdown(text, 1001);

    expect(cut.isCutShort).toBe(true);
    expect(cut.text).toBe("😀".repeat(500));
  });
});

describe("SlackUtil markdown sections - text of any size", () => {
  test("sixteen megabytes on one line become sections Slack takes, ending with the note", () => {
    const text: string = `Before\n\n${"a".repeat(16 * MIB)}\n\nAfter`;

    const texts: Array<string> = sectionTexts(markdownBlocks(text));

    expect(texts.length).toBeLessThanOrEqual(
      SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
    );
    expect(
      texts.every((section: string): boolean => {
        return section.length <= MAX_LENGTH;
      }),
    ).toBe(true);
    expect(texts[0]!.startsWith("Before")).toBe(true);
    expect(texts[texts.length - 1]!.endsWith(NOTE)).toBe(true);
  });

  test("sixteen megabytes of JSON, links and lines take no more Markdown than Slack can show", () => {
    for (const body of [
      `{"items":[${'{"id":1,"name":"web-01"},'.repeat(700000)}]}`,
      "[a](".repeat(4 * MIB),
      "2026-10-08T10:00:00Z INFO request served\n".repeat(400000),
    ]) {
      const texts: Array<string> = sectionTexts(markdownBlocks(body));

      expect(texts.length).toBeGreaterThan(1);
      expect(texts.length).toBeLessThanOrEqual(
        SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
      );
      expect(texts[texts.length - 1]!.endsWith(NOTE)).toBe(true);
    }
  });

  test("Markdown that fits renders exactly as it always has", () => {
    const text: string = `**Incident** _created_\n\n${"- an affected resource\n".repeat(1000)}`;

    expect(text.length).toBeLessThanOrEqual(SlackUtil.MARKDOWN_MAX_LENGTH);

    expect(sectionTexts(markdownBlocks(text))).toEqual(
      SlackUtil.splitSectionText({ text: SlackifyMarkdown(text) }),
    );
  });

  test("a block allowed one section takes no more than two sections of Markdown", () => {
    const text: string = "word ".repeat(2000);

    const texts: Array<string> = sectionTexts(markdownBlocks(text, 1));

    expect(texts).toHaveLength(1);
    expect(texts[0]!.endsWith(NOTE)).toBe(true);
    expect(texts[0]!.length).toBeLessThanOrEqual(MAX_LENGTH);
  });
});

describe("SlackUtil.splitSectionText - text that was cut short before", () => {
  test("ends with the note even when what is left fits in one section", () => {
    expect(
      SlackUtil.splitSectionText({ text: "short text", isCutShort: true }),
    ).toEqual([`short text${NOTE}`]);
  });

  test("text that was not cut and fits is returned as it is", () => {
    expect(SlackUtil.splitSectionText({ text: "short text" })).toEqual([
      "short text",
    ]);
  });

  test("closes an open code block before the note", () => {
    expect(
      SlackUtil.splitSectionText({ text: "```\ncode", isCutShort: true }),
    ).toEqual([`\`\`\`\ncode\n\`\`\`${NOTE}`]);
  });
});

describe("SlackUtil incoming webhook - text of any size", () => {
  function mockSlackPost(): jest.SpyInstance {
    return jest.spyOn(API, "post").mockResolvedValue({
      jsonData: { ok: true },
    } as unknown as HTTPResponse<JSONObject>);
  }

  const webhook: URL = URL.fromString(
    "https://hooks.slack.com/services/T000/B000/XXXX",
  );

  test("a text that fits goes as the one section it always was", async () => {
    const postSpy: jest.SpyInstance = mockSlackPost();

    await SlackUtil.sendMessageToChannelViaIncomingWebhook({
      url: webhook,
      text: "*Incident created*",
    });

    expect((postSpy.mock.calls[0]![0] as PostCallArgs).data).toEqual({
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "*Incident created*" },
        },
      ],
    });
  });

  test("a longer text goes as several sections, none over 3000 characters", async () => {
    const postSpy: jest.SpyInstance = mockSlackPost();
    const text: string = "an affected resource\n".repeat(500);

    await SlackUtil.sendMessageToChannelViaIncomingWebhook({
      url: webhook,
      text: text,
    });

    const texts: Array<string> = sectionTexts(
      (postSpy.mock.calls[0]![0] as PostCallArgs).data[
        "blocks"
      ] as Array<JSONObject>,
    );

    expect(texts.length).toBeGreaterThan(1);
    expect(
      texts.every((section: string): boolean => {
        return section.length <= MAX_LENGTH;
      }),
    ).toBe(true);
    expect(texts.join("\n")).toBe(text.trimEnd());
  });

  test("sixteen megabytes of a description go as sections Slack takes, ending with the note", async () => {
    const postSpy: jest.SpyInstance = mockSlackPost();

    await SlackUtil.sendMessageToChannelViaIncomingWebhook({
      url: webhook,
      text: SlackUtil.convertMarkdownToSlackRichText(
        `*Incident created*\n\n${"x".repeat(16 * MIB)}`,
      ),
    });

    const texts: Array<string> = sectionTexts(
      (postSpy.mock.calls[0]![0] as PostCallArgs).data[
        "blocks"
      ] as Array<JSONObject>,
    );

    expect(texts.length).toBeLessThanOrEqual(
      SlackUtil.MAX_SECTIONS_PER_MARKDOWN_BLOCK,
    );
    expect(
      texts.every((section: string): boolean => {
        return section.length <= MAX_LENGTH;
      }),
    ).toBe(true);
    expect(texts[texts.length - 1]!.endsWith(NOTE)).toBe(true);
  });
});

describe("SlackUtil.convertMarkdownToSlackRichText - text of any size", () => {
  test("Markdown that fits converts exactly as it always has", () => {
    const markdown: string =
      "**Status** changed\n\n| Host | State |\n| --- | --- |\n| web-01 | down |";

    expect(SlackUtil.convertMarkdownToSlackRichText(markdown)).toBe(
      SlackifyMarkdown(
        SlackUtil["convertMarkdownTablesToSlackFormat"](markdown),
      ),
    );
  });

  test("longer Markdown is cut, and the text says so", () => {
    const text: string = SlackUtil.convertMarkdownToSlackRichText(
      `| Host | State |\n| --- | --- |\n${"| web-01 | down |\n".repeat(1000000)}`,
    );

    expect(text.length).toBeLessThan(4 * SlackUtil.MARKDOWN_MAX_LENGTH);
    expect(text.endsWith(NOTE)).toBe(true);
  });
});
