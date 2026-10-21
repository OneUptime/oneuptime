import { describe, expect, test } from "@jest/globals";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import removeHtmlMarkup from "../../../../../Types/HtmlMarkup";

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
    "<!<!---->--",
    '<img alt="<script>" src=x>',
  ])("leaves no markup at all in %j", (body: string) => {
    expect(MicrosoftTeamsUtil.stripHtmlTags(body)).not.toContain("<");
  });

  /*
   * It reads bodies through removeHtmlMarkup (Common/Types/HtmlMarkup), as
   * the reaction note sync does: a tag ends only at a ">" outside a quoted
   * attribute value, and a comment at its "-->", so neither leaves the rest
   * of a value or a comment behind as text. One pass of /<[^>]*>/ ended
   * both at their first ">".
   */
  test("keeps no attribute value or comment as text", () => {
    expect(
      MicrosoftTeamsUtil.stripHtmlTags(
        '<p><img alt="chart > threshold" src="https://graph.microsoft.com/x/$value">over</p>',
      ),
    ).toBe("over");
    expect(MicrosoftTeamsUtil.stripHtmlTags("<p>a<!-- x > y -->b</p>")).toBe(
      "ab",
    );
  });

  test("reads a body as removeHtmlMarkup does", () => {
    for (const body of [
      '<div><div><at id="0">Adele Vance</at>&nbsp;Hello there</div></div>',
      "<scr<script>ipt>alert(1)</script>",
      "a<!-- never closed",
      '<a title="x>y">z</a>',
    ]) {
      expect(MicrosoftTeamsUtil.stripHtmlTags(body)).toBe(
        removeHtmlMarkup(body),
      );
    }
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
