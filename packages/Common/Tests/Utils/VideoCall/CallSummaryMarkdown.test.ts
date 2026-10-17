import { describe, expect, test } from "@jest/globals";
import { marked, Tokens } from "marked";
import {
  CallSummaryBasis,
  CallSummaryRootCauseOutcome,
} from "../../../Types/VideoCall/CallSummary";
import CallSummaryMarkdown from "../../../Utils/VideoCall/CallSummaryMarkdown";

/*
 * The root cause a person starts from when they use OneUptime AI's
 * suggestion: the suggestion, then each transcript line it rests on as a
 * plain quote. Both are somebody else's text, so neither may turn into
 * Markdown that acts on its own - a link, an image, a heading, a callout.
 */

function tokensOf(markdown: string): Array<Tokens.Generic> {
  return marked.lexer(markdown) as unknown as Array<Tokens.Generic>;
}

describe("CallSummaryMarkdown.buildRootCause", () => {
  test("the suggestion, then each cited line as its own quote with time and speaker", () => {
    const markdown: string = CallSummaryMarkdown.buildRootCause({
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: "The 14:05 deploy doubled the workers and exhausted the DB pool.",
      basis: CallSummaryBasis.StatedOnCall,
      citations: [
        { line: 12, time: "00:12:03", speaker: "Priya Shah", text: "The pool maxes at 50." },
        { line: 15, text: "Rolling back fixed it." },
      ],
    });

    const tokens: Array<Tokens.Generic> = tokensOf(markdown).filter(
      (token: Tokens.Generic) => {
        return token.type !== "space";
      },
    );

    expect(tokens.map((token: Tokens.Generic) => {
      return token.type;
    })).toEqual(["paragraph", "blockquote", "blockquote"]);
    expect(markdown).toContain("The 14:05 deploy doubled the workers and exhausted the DB pool.");
    expect(tokens[1]!.text).toContain("00:12:03");
    expect(tokens[1]!.text).toContain("Priya Shah:");
    expect(tokens[1]!.text).toContain("The pool maxes at 50.");
    expect(tokens[2]!.text).toContain("Rolling back fixed it.");
  });

  test("Markdown in the model's words or a participant's stays text", () => {
    const markdown: string = CallSummaryMarkdown.buildRootCause({
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: "# Heading ![x](https://tracker.example/pixel.png) [click](https://evil.example)",
      basis: CallSummaryBasis.Inferred,
      citations: [
        {
          line: 1,
          speaker: "[!WARNING]",
          text: "**bold** <img src=x onerror=alert(1)> [link](https://evil.example)",
        },
      ],
    });

    const html: string = marked.parse(markdown) as string;

    expect(html).not.toContain("<h1");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<strong>");
    // A bare address may still read as a link, but no words hide where one goes.
    expect(html).not.toContain(">click</a>");
    expect(html).not.toContain(">link</a>");
    expect(html).not.toContain(">x</a>");
    expect(html).toContain("<blockquote>");
    // The "[!WARNING]" a speaker could be called does not make the quote a callout.
    expect(markdown).not.toContain("> [!WARNING]");
  });

  test("a call that did not discuss the cause gives nothing to start from", () => {
    expect(
      CallSummaryMarkdown.buildRootCause({
        outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
        citations: [],
      }),
    ).toBe("");
  });
});
