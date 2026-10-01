import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";

/*
 * Pins MicrosoftTeamsUtil.stripHtmlTags, which turns a Teams message body
 * (HTML, as Graph and the Bot Framework deliver it) into plain text for the
 * AI Ops conversation history and for getChannelMessages.
 *
 * Both used to remove tags with one pass of /<[^>]*>/, which leaves an
 * unclosed tag behind: "<script" with no ">" after it matches no tag, so it
 * came out as it went in - the incomplete multi-character sanitization code
 * scanning reported on both call sites. The promise now is that the text
 * holds no "<" at all, whatever the body; entity-encoded text is left
 * encoded, since decoding "&lt;" would hand the markup back.
 */

type PlainTextFunction = (rawContent: string) => string;

// The AI Ops history path, private to the class.
const toPlainTextFromTeamsMessageBody: PlainTextFunction = (
  rawContent: string,
): string => {
  return (
    MicrosoftTeamsUtil as unknown as {
      toPlainTextFromTeamsMessageBody: PlainTextFunction;
    }
  ).toPlainTextFromTeamsMessageBody(rawContent);
};

describe("MicrosoftTeamsUtil.stripHtmlTags", () => {
  test("removes the tags of a Teams message body and keeps its text", () => {
    expect(
      MicrosoftTeamsUtil.stripHtmlTags(
        '<p>Database is <b>down</b></p><div><a href="https://x.test">runbook</a></div>',
      ),
    ).toBe("Database is downrunbook");
  });

  test("leaves text without markup exactly as it was", () => {
    expect(MicrosoftTeamsUtil.stripHtmlTags("restart the api pods")).toBe(
      "restart the api pods",
    );
    expect(MicrosoftTeamsUtil.stripHtmlTags("")).toBe("");
  });

  test("removes an unclosed tag, which no tag pattern matches", () => {
    expect(MicrosoftTeamsUtil.stripHtmlTags("hello <script")).toBe(
      "hello script",
    );
    expect(
      MicrosoftTeamsUtil.stripHtmlTags("<b>bold</b> then <img src=x"),
    ).toBe("bold then img src=x");
  });

  test("leaves entity-encoded text encoded", () => {
    // Teams sends a literal "<" typed in a message as "&lt;".
    expect(
      MicrosoftTeamsUtil.stripHtmlTags("<p>use &lt;script&gt; tags</p>"),
    ).toBe("use &lt;script&gt; tags");
  });

  test.each([
    "<scr<script>ipt>alert(1)</script>",
    "<<script>script>alert(1)",
    "<script<script>>alert(1)",
    "<p>x</p><script",
    "<<<<",
    "a < b <c",
    "<iframe src=x></iframe><style>",
    "<!-- <script> -->",
  ])("leaves no markup at all in %j", (body: string) => {
    expect(MicrosoftTeamsUtil.stripHtmlTags(body)).not.toContain("<");
  });
});

describe("the AI Ops message history text", () => {
  test("drops bot mentions, strips tags and collapses whitespace", () => {
    expect(
      toPlainTextFromTeamsMessageBody(
        "<p><at>OneUptime</at>&nbsp; why is <b>checkout</b>\n slow?</p>",
      ),
    ).toBe("why is checkout slow?");
  });

  test("keeps no markup from a body that tries to smuggle some", () => {
    expect(
      toPlainTextFromTeamsMessageBody(
        "<p><at>OneUptime</at> summarise</p><scr<script>ipt>x",
      ),
    ).not.toContain("<");
  });
});
