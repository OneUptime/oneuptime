import { describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import SlackUtil, {
  SlackifySafeMarkdown,
  getSlackifySafeMarkdown,
} from "../../../../../Server/Utils/Workspace/Slack/Slack";
import logger from "../../../../../Server/Utils/Logger";
import { JSONObject } from "../../../../../Types/JSON";

/*
 * SLACK TAKES EVERY MESSAGE A NOTIFICATION MAKES.
 *
 * - slackify-markdown read every link's address with decodeURIComponent and
 *   encodeURI, which throw on a "%" that starts no escape and on half an
 *   emoji ("URI malformed"): a response body with "100%" in an address, or
 *   a text cut in the middle of an emoji, and the whole message was lost.
 * - Slack refuses a whole message whose header is over 150 characters.
 *
 * Common's jest maps remark-gfm to a stand-in, so addresses written without
 * brackets ("www.example.com/%zz") are not links here: those run with the
 * real remark-gfm in HugeTextInLongRunningProcess.test.ts.
 */

// Lets one input throw from slackify-markdown; everything else is converted.
const mockSlackifyState: { throwOn: string | null } = { throwOn: null };

jest.mock("slackify-markdown", () => {
  const actual: (markdown: string) => string = jest.requireActual(
    "slackify-markdown",
  ) as (markdown: string) => string;

  return {
    __esModule: true,
    default: (markdown: string): string => {
      if (
        mockSlackifyState.throwOn !== null &&
        markdown.includes(mockSlackifyState.throwOn)
      ) {
        throw new TypeError("Cannot read properties of undefined");
      }

      return actual(markdown);
    },
  };
});

describe("getSlackifySafeMarkdown", () => {
  test("Markdown with nothing slackify throws on comes back as it is", () => {
    for (const markdown of [
      "plain text",
      "100%20 is an escape, as is %2F",
      "an emoji 😀 is whole",
    ]) {
      const safe: SlackifySafeMarkdown = getSlackifySafeMarkdown(markdown);

      expect(safe.markdown).toBe(markdown);
      expect(safe.restore("anything")).toBe("anything");
    }
  });

  test("a stray % becomes a stand-in, and comes back as % in text and %25 in an address", () => {
    const safe: SlackifySafeMarkdown = getSlackifySafeMarkdown(
      "100% and %zz and %2F",
    );

    expect(safe.markdown).not.toContain("100%");
    expect(safe.markdown).toContain("%2F");
    expect(safe.restore(safe.markdown)).toBe("100% and %zz and %2F");
    expect(safe.restore(encodeURI(safe.markdown))).toContain("100%25");
  });

  test("half an emoji becomes U+FFFD", () => {
    expect(getSlackifySafeMarkdown("a \uD83D b \uDE00 c").markdown).toBe(
      "a \uFFFD b \uFFFD c",
    );
  });

  test("an address that already holds the stand-in's escape is left as it was", () => {
    const markdown: string = "http://x/%EE%80%87 and 5%";

    expect(getSlackifySafeMarkdown(markdown).markdown).toBe(markdown);
  });
});

describe("SlackUtil.slackify - every text converts", () => {
  test("a stray % in an address no longer loses the message", () => {
    expect(SlackUtil.slackify("[the log](http://a/b%zz)")).toBe(
      "<http://a/b%25zz|the log>\n",
    );
    expect(SlackUtil.slackify("<http://a/%zz>")).toBe(
      "<http://a/%25zz|http://a/%zz>\n",
    );
  });

  test("a % in text, and an address that is already encoded, are as they were", () => {
    // slackify sets emphasis off with zero-width spaces.
    expect(SlackUtil.slackify("Disk at 100%, *now*")).toBe(
      "Disk at 100%, \u200B_now_\u200B\n",
    );
    expect(SlackUtil.slackify("[a](http://b/c%20d) at 5%")).toBe(
      "<http://b/c%20d|a> at 5%\n",
    );
  });

  test("half an emoji no longer loses the message", () => {
    expect(SlackUtil.slackify("cut \uD83D [a](http://x/\uD83D)")).toBe(
      "cut \uFFFD <http://x/%EF%BF%BD|a>\n",
    );
  });

  test("the stand-in character already in the text comes back as it was", () => {
    expect(SlackUtil.slackify("odd \uE007 char, 50%")).toBe(
      "odd \uE007 char, 50%\n",
    );
  });

  test("should slackify still fail, the message goes as its text, escaped as Slack reads it, and it is logged", () => {
    const warn: SpyInstance<typeof logger.warn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    mockSlackifyState.throwOn = "BREAKS";

    try {
      expect(SlackUtil.slackify("**BREAKS** <b> & more")).toBe(
        "**BREAKS** &lt;b&gt; &amp; more",
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toContain(
        "could not convert a message's Markdown",
      );
    } finally {
      mockSlackifyState.throwOn = null;
      warn.mockRestore();
    }
  });

  test("a message's sections are built whatever the addresses hold", () => {
    const blocks: Array<JSONObject> = SlackUtil.getMarkdownBlocks({
      payloadMarkdownBlock: {
        _type: "WorkspacePayloadMarkdown",
        text: "**Response:** [body](https://api.example.com/q?rate=100%)",
      },
    });

    expect(blocks).toHaveLength(1);
    expect((blocks[0]!["text"] as JSONObject)["text"]).toBe(
      "\u200B*Response:*\u200B <https://api.example.com/q?rate=100%25|body>\n",
    );
  });
});

describe("SlackUtil.getHeaderBlock - a header Slack takes", () => {
  function headerTextOf(text: string): string {
    return (
      SlackUtil.getHeaderBlock({
        payloadHeaderBlock: { _type: "WorkspacePayloadHeader", text: text },
      })["text"] as JSONObject
    )["text"] as string;
  }

  test("a header of at most 150 characters is as it was", () => {
    const text: string = "x".repeat(SlackUtil.HEADER_TEXT_MAX_LENGTH);

    expect(headerTextOf(text)).toBe(text);
    expect(headerTextOf("Incident #42: API down")).toBe(
      "Incident #42: API down",
    );
  });

  test("a longer one is cut to 150 characters, ending with an ellipsis", () => {
    const header: string = headerTextOf(
      `Incident #42: ${"a very long title ".repeat(30)}`,
    );

    expect(header).toHaveLength(SlackUtil.HEADER_TEXT_MAX_LENGTH);
    expect(header.endsWith("…")).toBe(true);
    expect(header.startsWith("Incident #42: a very long title")).toBe(true);
  });

  test("never in the middle of an emoji", () => {
    const header: string = headerTextOf(`${"x".repeat(148)}😀😀😀`);

    expect(header.length).toBeLessThanOrEqual(SlackUtil.HEADER_TEXT_MAX_LENGTH);
    expect(header).toBe(`${"x".repeat(148)}…`);
  });
});
