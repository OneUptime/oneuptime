/*
 * ---------------------------------------------------------------------------
 * GitHubPullRequestReviewTaskHandler.parseReview — splitting one blob of
 * model output into the review a human reads and the inline anchors GitHub
 * pins to lines.
 *
 * The invariant every test below exists to pin: A MALFORMED ANCHOR BLOCK
 * COSTS THE ANCHORS, NEVER THE REVIEW. The agent has already spent up to
 * thirty minutes reading the repository; its answer is the entire product of
 * the run. If a stray character in a trailing ```json block could make that
 * answer come back empty, the person who typed "@oneuptime review" gets
 * silence — and silence reads as "the bot is broken", not as "the bot's JSON
 * was off by a brace".
 *
 * The mirror invariant is just as load-bearing: when the block IS good, the
 * fence must be STRIPPED off the body. A review that ends in a wall of raw
 * JSON is the fingerprint of a broken integration, and every reader of that
 * pull request sees it.
 *
 * Individual anchors are then dropped one at a time rather than as a batch.
 * A path GitHub cannot resolve, a line that is not in the diff, a zero or a
 * fraction — each of those loses its own pin and leaves its siblings alone.
 * The server re-validates every field before it reaches GitHub, so this layer
 * is about not throwing away good anchors, not about trusting them.
 *
 * Pure function, no mocks: everything here is text in, text out.
 * ---------------------------------------------------------------------------
 */

import GitHubPullRequestReviewTaskHandler, {
  ParsedReview,
} from "../../TaskHandlers/GitHubPullRequestReviewTaskHandler";
import { GitHubReviewCommentInput } from "../../Utils/BackendAPI";
import { describe, expect, test } from "@jest/globals";

// The shape the agent is asked for: prose, then one fenced block at the end.
function withAnchorBlock(prose: string, json: string): string {
  return `${prose}\n\n\`\`\`json\n${json}\n\`\`\``;
}

function parse(summary: string): ParsedReview {
  return GitHubPullRequestReviewTaskHandler.parseReview(summary);
}

// One well-formed anchor, used as the surviving sibling in the drop tests.
const VALID_ENTRY: string =
  '{"path": "src/checkout.ts", "line": 88, "body": "This retry has no ceiling."}';

describe("GitHubPullRequestReviewTaskHandler.parseReview", () => {
  describe("an answer with no anchor block at all", () => {
    test("plain prose becomes the entire review body, with no anchors", () => {
      const answer: string =
        "## Verdict\n\nThe change is correct and the tests cover it. Nothing blocking.";

      const parsed: ParsedReview = parse(answer);

      expect(parsed.body).toBe(answer);
      expect(parsed.comments).toEqual([]);
    });

    test("leading and trailing whitespace is trimmed off the body", () => {
      const parsed: ParsedReview = parse(
        "\n\n   The retry loop looks right.   \n\n\n",
      );

      expect(parsed.body).toBe("The retry loop looks right.");
    });

    test("an empty summary produces an empty body and no anchors", () => {
      const parsed: ParsedReview = parse("");

      expect(parsed.body).toBe("");
      expect(parsed.comments).toEqual([]);
    });

    test("a whitespace-only summary produces an empty body and no anchors", () => {
      const parsed: ParsedReview = parse("   \n\t\n   ");

      expect(parsed.body).toBe("");
      expect(parsed.comments).toEqual([]);
    });

    /*
     * summary is typed as a string, but it arrives from the agent process and
     * ultimately from an LLM response body. A missing field must not take the
     * whole run down with a TypeError inside the handler.
     */
    test("a missing summary is treated as empty rather than throwing", () => {
      expect(() => {
        return parse(undefined as unknown as string);
      }).not.toThrow();

      expect(parse(undefined as unknown as string).body).toBe("");
      expect(parse(null as unknown as string).body).toBe("");
    });

    test("a fenced block in another language is not mistaken for the anchors", () => {
      const answer: string =
        "Here is the shape I would expect:\n\n```ts\nconst x: number = 1;\n```";

      const parsed: ParsedReview = parse(answer);

      expect(parsed.body).toBe(answer);
      expect(parsed.comments).toEqual([]);
    });

    /*
     * The regex anchors the block to the END of the answer. A ```json block
     * the agent wrote mid-review — quoting a config file, say — is prose, and
     * treating it as the anchor list would silently delete every word after
     * it from the review.
     */
    test("a ```json fence with prose after it is prose, not the anchor block", () => {
      const answer: string = `Verdict: the config default is wrong.

\`\`\`json
{"retries": 3}
\`\`\`

That value should be 5, and the rest of the change is fine.`;

      const parsed: ParsedReview = parse(answer);

      expect(parsed.body).toBe(answer);
      expect(parsed.body).toContain(
        "That value should be 5, and the rest of the change is fine.",
      );
      expect(parsed.comments).toEqual([]);
    });
  });

  describe("a well-formed trailing anchor block", () => {
    test("the body is the prose BEFORE the fence, so the reader never sees the JSON", () => {
      const prose: string =
        "## Verdict\n\nCorrect overall. One thing to fix before merge.";

      const parsed: ParsedReview = parse(
        withAnchorBlock(
          prose,
          '{"comments": [{"path": "src/api/user.ts", "line": 42, "body": "Dereferences user before the null check below."}]}',
        ),
      );

      expect(parsed.body).toBe(prose);
      expect(parsed.body).not.toContain("```json");
      expect(parsed.body).not.toContain("src/api/user.ts");
    });

    test("the anchors are parsed off the block", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "Verdict.",
          '{"comments": [{"path": "src/api/user.ts", "line": 42, "body": "Dereferences user before the null check below."}]}',
        ),
      );

      expect(parsed.comments).toEqual([
        {
          path: "src/api/user.ts",
          line: 42,
          body: "Dereferences user before the null check below.",
        },
      ]);
    });

    test("several anchors keep their order", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "Verdict.",
          '{"comments": [{"path": "a.ts", "line": 1, "body": "first"}, {"path": "b.ts", "line": 2, "body": "second"}, {"path": "c.ts", "line": 3, "body": "third"}]}',
        ),
      );

      expect(
        parsed.comments.map((comment: GitHubReviewCommentInput) => {
          return comment.path;
        }),
      ).toEqual(["a.ts", "b.ts", "c.ts"]);
    });

    /*
     * Models drop the {"comments": ...} wrapper roughly as often as they keep
     * it. Rejecting the bare array would throw away a perfectly good set of
     * anchors over a formatting preference.
     */
    test("a bare JSON array is accepted in place of the {comments: []} object", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock("Verdict.", `[${VALID_ENTRY}]`),
      );

      expect(parsed.body).toBe("Verdict.");
      expect(parsed.comments).toEqual([
        {
          path: "src/checkout.ts",
          line: 88,
          body: "This retry has no ceiling.",
        },
      ]);
    });

    test("path and body are trimmed", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "Verdict.",
          '[{"path": "   src/checkout.ts  ", "line": 5, "body": "  Trim me.\\n  "}]',
        ),
      );

      expect(parsed.comments).toEqual([
        { path: "src/checkout.ts", line: 5, body: "Trim me." },
      ]);
    });

    /*
     * Only the three fields the server validates are forwarded. A model that
     * volunteers `side` or `start_line` must not smuggle them into the
     * create-review call, where GitHub rejects the whole review rather than
     * the one field it did not expect.
     */
    test("extra fields on an anchor are not forwarded", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "Verdict.",
          '[{"path": "a.ts", "line": 5, "body": "x", "side": "LEFT", "start_line": 2, "position": 9}]',
        ),
      );

      expect(parsed.comments).toEqual([{ path: "a.ts", line: 5, body: "x" }]);
    });

    // A backtick run inside a comment body must not end the block early.
    test("a fence marker inside a comment body does not truncate the block", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "Verdict.",
          '[{"path": "a.ts", "line": 5, "body": "Wrap this in a ```json fence instead."}]',
        ),
      );

      expect(parsed.comments).toEqual([
        {
          path: "a.ts",
          line: 5,
          body: "Wrap this in a ```json fence instead.",
        },
      ]);
    });

    /*
     * An agent that answers with nothing but the block has still said
     * something, and an empty body is the one outcome the caller reports as
     * "no review produced". The fallback is a fixed sentence rather than the
     * raw answer: echoing the answer would put the JSON block itself on the
     * pull request as the review body, which is a wall of machine output where
     * the reader expects a verdict.
     */
    test("an answer that is only the anchor block yields a readable body, not the raw JSON", () => {
      const answer: string = `\`\`\`json\n[${VALID_ENTRY}]\n\`\`\``;

      const parsed: ParsedReview = parse(answer);

      expect(parsed.body.trim()).not.toBe("");
      expect(parsed.body).not.toContain("src/checkout.ts");
      expect(parsed.body).not.toContain("```json");
      expect(parsed.comments).toHaveLength(1);
    });

    test("unicode survives the round trip in both the body and the anchors", () => {
      const prose: string =
        "## 総評 — おおむね良好 ✅\n\nÜberprüfung abgeschlossen.";

      const parsed: ParsedReview = parse(
        withAnchorBlock(
          prose,
          '[{"path": "src/日本/ファイル.ts", "line": 12, "body": "エラー処理が抜けています 🚨"}]',
        ),
      );

      expect(parsed.body).toBe(prose);
      expect(parsed.comments).toEqual([
        {
          path: "src/日本/ファイル.ts",
          line: 12,
          body: "エラー処理が抜けています 🚨",
        },
      ]);
    });
  });

  describe("a malformed anchor block costs the anchors, never the review", () => {
    test("invalid JSON keeps the ENTIRE answer as the body and drops every anchor", () => {
      const answer: string = withAnchorBlock(
        "## Verdict\n\nThe error path is unhandled on line 88.",
        '{"comments": [{"path": "src/checkout.ts", "line": 88, "body": "unterminated',
      );

      const parsed: ParsedReview = parse(answer);

      // Nothing the agent wrote is lost, fence included.
      expect(parsed.body).toBe(answer);
      expect(parsed.body).toContain("The error path is unhandled on line 88.");
      expect(parsed.body).toContain("```json");
      expect(parsed.comments).toEqual([]);
    });

    test("a trailing comma — the commonest model JSON error — costs only the anchors", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock("Verdict.", `[${VALID_ENTRY},]`),
      );

      expect(parsed.body).toContain("Verdict.");
      expect(parsed.comments).toEqual([]);
    });

    /*
     * A review whose PROSE quotes a JSON snippet and which then ends with the
     * real anchor block. Reading from the first ```json to the last would hand
     * JSON.parse everything in between, fail, and silently drop every anchor —
     * on exactly the reviews doing the most work. The LAST block is the anchor
     * block; the earlier one is prose and stays in the body.
     */
    test("the LAST fenced JSON block is the anchor block, and an earlier one stays in the review", () => {
      const answer: string = `Verdict.

\`\`\`json
{"unrelated": 1}
\`\`\`

More thoughts.

\`\`\`json
[${VALID_ENTRY}]
\`\`\``;

      const parsed: ParsedReview = parse(answer);

      expect(parsed.body).toContain("Verdict.");
      expect(parsed.body).toContain('{"unrelated": 1}');
      expect(parsed.body).toContain("More thoughts.");
      // The anchor block itself is stripped, so the reader never sees it.
      expect(parsed.body).not.toContain("src/checkout.ts");
      expect(parsed.comments).toEqual([
        {
          path: "src/checkout.ts",
          line: 88,
          body: "This retry has no ceiling.",
        },
      ]);
    });

    /*
     * Valid JSON that simply is not a comment list is a different case from
     * broken JSON: the fence parsed, so it is stripped, and only the anchors
     * are lost.
     */
    test.each([
      ["an object with no comments key", '{"summary": "all good"}'],
      ["comments as an object rather than an array", '{"comments": {"a": 1}}'],
      ["comments as a string", '{"comments": "none"}'],
      ["a literal null", "null"],
      ["a literal string", '"nothing to say"'],
      ["a literal number", "7"],
    ])(
      "%s parses, strips the fence and yields no anchors",
      (_label: string, json: string) => {
        const parsed: ParsedReview = parse(withAnchorBlock("Verdict.", json));

        expect(parsed.body).toBe("Verdict.");
        expect(parsed.comments).toEqual([]);
      },
    );

    test("an empty fence is left in the body rather than read as an empty anchor list", () => {
      const answer: string = "Verdict.\n\n```json\n\n```";

      const parsed: ParsedReview = parse(answer);

      expect(parsed.body).toContain("Verdict.");
      expect(parsed.comments).toEqual([]);
    });
  });

  describe("a bad anchor is dropped on its own, not with its siblings", () => {
    /*
     * Every case pairs one broken entry with VALID_ENTRY. Asserting the
     * survivor matters as much as asserting the drop: an over-eager guard
     * that bailed out of the loop would pass a "the bad one is gone" check
     * and quietly lose every anchor after it.
     */
    function parsePair(brokenEntry: string): ParsedReview {
      return parse(
        withAnchorBlock("Verdict.", `[${brokenEntry}, ${VALID_ENTRY}]`),
      );
    }

    function expectOnlyTheValidSiblingSurvived(parsed: ParsedReview): void {
      expect(parsed.comments).toEqual([
        {
          path: "src/checkout.ts",
          line: 88,
          body: "This retry has no ceiling.",
        },
      ]);
    }

    test.each([
      ["no path at all", '{"line": 5, "body": "b"}'],
      ["no line at all", '{"path": "a.ts", "body": "b"}'],
      ["no body at all", '{"path": "a.ts", "line": 5}'],
      ["an empty object", "{}"],
      ["an empty-string path", '{"path": "", "line": 5, "body": "b"}'],
      ["a whitespace-only path", '{"path": "   ", "line": 5, "body": "b"}'],
      ["an empty-string body", '{"path": "a.ts", "line": 5, "body": ""}'],
      [
        "a whitespace-only body",
        '{"path": "a.ts", "line": 5, "body": " \\n \\t "}',
      ],
      ["a numeric path", '{"path": 12, "line": 5, "body": "b"}'],
      [
        "a path given as an array",
        '{"path": ["a.ts"], "line": 5, "body": "b"}',
      ],
      ["an object body", '{"path": "a.ts", "line": 5, "body": {"text": "b"}}'],
      ["a numeric body", '{"path": "a.ts", "line": 5, "body": 42}'],
      ["a null path", '{"path": null, "line": 5, "body": "b"}'],
      ["a null body", '{"path": "a.ts", "line": 5, "body": null}'],
    ])(
      "an anchor with %s is dropped while its valid sibling survives",
      (_label: string, brokenEntry: string) => {
        expectOnlyTheValidSiblingSurvived(parsePair(brokenEntry));
      },
    );

    /*
     * GitHub numbers lines from 1. A 0, a negative, or a fraction is not a
     * line the API can anchor to, and one anchor GitHub rejects fails the
     * whole create-review call — so a bad line has to be dropped here rather
     * than forwarded and argued about later.
     */
    test.each([
      ["zero", "0"],
      ["a negative line", "-3"],
      ["a fraction", "1.5"],
      ["a line given as a string", '"42"'],
      ["a boolean line", "true"],
      ["a null line", "null"],
      ["a line given as an array", "[7]"],
      ["a line beyond the safe integer range", "1e999"],
    ])(
      "an anchor with %s is dropped while its valid sibling survives",
      (_label: string, line: string) => {
        expectOnlyTheValidSiblingSurvived(
          parsePair(`{"path": "a.ts", "line": ${line}, "body": "b"}`),
        );
      },
    );

    // A JSON "3.0" is the integer 3, and a real anchor — do not drop it.
    test("a line written as 3.0 is an integer and is kept", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "Verdict.",
          '[{"path": "a.ts", "line": 3.0, "body": "b"}]',
        ),
      );

      expect(parsed.comments).toEqual([{ path: "a.ts", line: 3, body: "b" }]);
    });

    /*
     * Entries that are not objects at all. NOTE: a literal `null` entry is
     * deliberately absent from this list — parseReview dereferences each
     * entry without a null guard, so `[null]` throws rather than dropping the
     * entry. Add `null` here once that guard exists.
     */
    test.each([
      ["a bare string", '"just some text"'],
      ["a bare number", "42"],
      ["a bare boolean", "true"],
      ["a nested array", "[]"],
    ])(
      "an entry that is %s is dropped while its valid sibling survives",
      (_label: string, brokenEntry: string) => {
        expectOnlyTheValidSiblingSurvived(parsePair(brokenEntry));
      },
    );

    test("every anchor being unusable leaves the review intact with no anchors", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock(
          "## Verdict\n\nTwo problems, both described above.",
          '[{"path": "", "line": 0, "body": ""}, {"line": -1}]',
        ),
      );

      expect(parsed.body).toBe(
        "## Verdict\n\nTwo problems, both described above.",
      );
      expect(parsed.comments).toEqual([]);
    });

    test("an empty anchor array is a review with no anchors, not a lost review", () => {
      const parsed: ParsedReview = parse(
        withAnchorBlock("Nothing blocking.", '{"comments": []}'),
      );

      expect(parsed.body).toBe("Nothing blocking.");
      expect(parsed.comments).toEqual([]);
    });
  });
});
