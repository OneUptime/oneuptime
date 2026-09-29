import GitHubCommandParser from "../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandParser";
import GitHubCommandType, {
  GitHubCommand,
  GitHubCommandSurface,
  isConversationalCommand,
} from "../../../../Types/CodeRepository/GitHubCommand";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * GitHubCommandParser is the gate between arbitrary text written by anyone
 * with comment access to a connected repository and a paid, write-capable
 * agent run. Nothing downstream re-checks whether the app was actually
 * addressed: if parse() returns a command, work is enqueued.
 *
 * So these tests are written around four invariants rather than around the
 * grammar:
 *
 *   1. NO MENTION, NO COMMAND. The overwhelmingly common case is a comment
 *      that has nothing to do with this app, and it must cost nothing and
 *      return null.
 *
 *   2. NO LOOPS. GitHub's "Quote reply" button copies the parent comment into
 *      a `>` block verbatim, so a mention inside a quote, a fenced code block
 *      or an inline code span must NOT be a command. Without this, every
 *      reply to one of the app's own comments re-triggers it and the two talk
 *      to each other until the fix budget is gone.
 *
 *   3. WHOLE-WORD MENTIONS, BOUNDED BY AN ALLOW-LIST. `@oneuptime-staging` is
 *      a different GitHub App and `support@oneuptime.com` is an email
 *      address. Neither may command this installation. The character BEFORE
 *      the at-sign is checked against a list of what may appear there —
 *      nothing, whitespace, or wrapping punctuation — rather than against a
 *      list of what may not, because "not an ASCII word character" silently
 *      admits every non-ASCII local part on earth.
 *
 *   4. NOTHING IS SILENTLY DROPPED. An unrecognized verb is not an error —
 *      the surface decides (pull request -> Revise, issue -> Implement) — and
 *      a verb aimed at the wrong surface still parses, so the webhook handler
 *      can answer with a real explanation instead of ignoring the user.
 *
 * The module is pure: no IO, no environment, nothing mocked. Every assertion
 * below is a statement about (body, appSlug, surface) alone.
 * ---------------------------------------------------------------------------
 */

const APP_SLUG: string = "oneuptime";

function parseOnPullRequest(
  body: string | null | undefined,
): GitHubCommand | null {
  return GitHubCommandParser.parse({
    body: body,
    appSlug: APP_SLUG,
    surface: GitHubCommandSurface.PullRequest,
  });
}

function parseOnIssue(body: string | null | undefined): GitHubCommand | null {
  return GitHubCommandParser.parse({
    body: body,
    appSlug: APP_SLUG,
    surface: GitHubCommandSurface.Issue,
  });
}

function parseWithSlug(
  body: string | null | undefined,
  appSlug: string | null | undefined,
): GitHubCommand | null {
  return GitHubCommandParser.parse({
    body: body,
    appSlug: appSlug,
    surface: GitHubCommandSurface.PullRequest,
  });
}

/*
 * Non-null variants. A test that means "this text IS a command" should fail
 * on the null itself rather than on a confusing property read of null.
 */
function commandOnPullRequest(body: string): GitHubCommand {
  const command: GitHubCommand | null = parseOnPullRequest(body);

  if (!command) {
    throw new Error(
      `Expected a command on a pull request from ${JSON.stringify(body)}, got null`,
    );
  }

  return command;
}

function commandOnIssue(body: string): GitHubCommand {
  const command: GitHubCommand | null = parseOnIssue(body);

  if (!command) {
    throw new Error(
      `Expected a command on an issue from ${JSON.stringify(body)}, got null`,
    );
  }

  return command;
}

// Multi-line comment bodies read far better as lines than as escaped strings.
function body(...lines: Array<string>): string {
  return lines.join("\n");
}

const FENCE: string = "```";
const TILDE_FENCE: string = "~~~";

/*
 * A four-character fence. CommonMark lets an author open with a LONGER fence
 * precisely so the block can contain the ordinary three-backtick one — which
 * is exactly the shape of a comment that shows someone how to talk to this
 * app, and therefore the shape most likely to contain a mention.
 */
const LONG_FENCE: string = "````";
const LONG_TILDE_FENCE: string = "~~~~";

/*
 * The parser is pure and mocks nothing, but the house convention is kept so
 * that a spy added to this file later cannot leak into a neighbouring test in
 * the same worker.
 */
beforeEach(() => {
  jest.restoreAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GitHubCommandParser.parse", () => {
  describe("comments that do not address the app", () => {
    test("returns null for an ordinary review comment", () => {
      expect(
        parseOnPullRequest("LGTM, shipping this once CI goes green."),
      ).toBeNull();
    });

    test("returns null when the app is named but not mentioned with an @", () => {
      expect(
        parseOnPullRequest(
          "we should ask oneuptime to review this at some point",
        ),
      ).toBeNull();
    });

    test("returns null when a different app is being commanded", () => {
      expect(parseOnPullRequest("@dependabot rebase")).toBeNull();
    });

    test("returns null for a long comment with no mention anywhere in it", () => {
      expect(parseOnIssue("x".repeat(5000))).toBeNull();
    });
  });

  describe("a bare mention", () => {
    /*
     * Orientation, not a licence to start work on whatever the thread happens
     * to be about. A bare "@oneuptime" on a 400-comment issue must not be
     * read as "implement all of that".
     */
    test("is Help with an empty instruction, not the surface default", () => {
      const command: GitHubCommand = commandOnIssue("@oneuptime");

      expect(command.commandType).toBe(GitHubCommandType.Help);
      expect(command.instruction).toBe("");
    });

    test("is Help on a pull request too", () => {
      expect(commandOnPullRequest("@oneuptime").commandType).toBe(
        GitHubCommandType.Help,
      );
    });

    test("is still Help when only whitespace and blank lines follow", () => {
      const command: GitHubCommand = commandOnPullRequest(
        body("", "", "@oneuptime   ", "", "\t"),
      );

      expect(command.commandType).toBe(GitHubCommandType.Help);
      expect(command.instruction).toBe("");
    });

    test("is Help for the [bot]-suffixed form GitHub renders", () => {
      const command: GitHubCommand = commandOnPullRequest("@oneuptime[bot]");

      expect(command.commandType).toBe(GitHubCommandType.Help);
      expect(command.instruction).toBe("");
    });
  });

  describe("explicit verbs", () => {
    describe("Review, on a pull request", () => {
      test.each([
        "review",
        "code review",
        "please review",
        "can you review",
        "review this",
      ])("'@oneuptime %s' asks for a Review", (phrase: string) => {
        expect(commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType).toBe(
          GitHubCommandType.Review,
        );
      });

      /*
       * "code review" must not be shadowed by the shorter "review" landing on
       * a different command type — they happen to agree today, and this test
       * is what keeps them agreeing if the phrase list is reordered.
       */
      test("'code review' is a Review even though 'review' is not its first word", () => {
        expect(commandOnPullRequest("@oneuptime code review").commandType).toBe(
          GitHubCommandType.Review,
        );
      });
    });

    describe("Revise, on a pull request", () => {
      test.each([
        "revise",
        "revise this",
        "please revise",
        "rework",
        "rework this",
        "redo",
        "redo this",
      ])("'@oneuptime %s' asks for a Revise", (phrase: string) => {
        expect(commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType).toBe(
          GitHubCommandType.Revise,
        );
      });
    });

    describe("Implement, on an issue", () => {
      test.each([
        "implement",
        "implement this",
        "please implement",
        "work on this",
        "work on it",
        "pick this up",
        "take this",
      ])("'@oneuptime %s' asks for an Implement", (phrase: string) => {
        expect(commandOnIssue(`@${APP_SLUG} ${phrase}`).commandType).toBe(
          GitHubCommandType.Implement,
        );
      });
    });

    describe("the conversational verbs, on either surface", () => {
      test.each(["help", "commands", "usage", "what can you do"])(
        "'@oneuptime %s' asks for Help",
        (phrase: string) => {
          expect(
            commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType,
          ).toBe(GitHubCommandType.Help);
          expect(commandOnIssue(`@${APP_SLUG} ${phrase}`).commandType).toBe(
            GitHubCommandType.Help,
          );
        },
      );

      test.each(["status", "progress"])(
        "'@oneuptime %s' asks for Status",
        (phrase: string) => {
          expect(
            commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType,
          ).toBe(GitHubCommandType.Status);
          expect(commandOnIssue(`@${APP_SLUG} ${phrase}`).commandType).toBe(
            GitHubCommandType.Status,
          );
        },
      );

      test.each(["cancel", "stop", "abort"])(
        "'@oneuptime %s' asks for Cancel",
        (phrase: string) => {
          expect(
            commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType,
          ).toBe(GitHubCommandType.Cancel);
          expect(commandOnIssue(`@${APP_SLUG} ${phrase}`).commandType).toBe(
            GitHubCommandType.Cancel,
          );
        },
      );
    });

    /*
     * A verb overrides the surface default even when the surface cannot carry
     * it out. Downgrading a misplaced "review" on an issue into the issue
     * default would open a pull request nobody asked for; parsing it as a
     * Review lets the handler say why it cannot be done.
     */
    test("a Review asked for on an issue still parses as a Review", () => {
      expect(commandOnIssue("@oneuptime review").commandType).toBe(
        GitHubCommandType.Review,
      );
    });

    test("an Implement asked for on a pull request still parses as an Implement", () => {
      expect(
        commandOnPullRequest("@oneuptime implement this").commandType,
      ).toBe(GitHubCommandType.Implement);
    });

    describe("case insensitivity", () => {
      test("an all-caps comment is still parsed as its verb", () => {
        expect(commandOnPullRequest("@ONEUPTIME CODE REVIEW").commandType).toBe(
          GitHubCommandType.Review,
        );
      });

      test("a mixed-case verb is still parsed as its verb", () => {
        expect(commandOnPullRequest("@oneuptime Review This").commandType).toBe(
          GitHubCommandType.Review,
        );
      });

      test("the [bot] suffix matches in any case", () => {
        expect(commandOnPullRequest("@ONEUPTIME[BOT] status").commandType).toBe(
          GitHubCommandType.Status,
        );
      });

      test("a slug configured in a different case still matches the comment", () => {
        const command: GitHubCommand | null = parseWithSlug(
          "@oneuptime review",
          "OneUptime",
        );

        expect(command?.commandType).toBe(GitHubCommandType.Review);
      });

      /*
       * The instruction is NOT lower-cased on its way out. Only the verb match
       * is case-insensitive; the text the agent reads is what the human typed,
       * including any identifier whose case is load-bearing.
       */
      test("does not lower-case the instruction it hands on", () => {
        expect(commandOnPullRequest("@oneuptime CODE REVIEW").instruction).toBe(
          "CODE REVIEW",
        );
      });
    });
  });

  describe("punctuation around the verb", () => {
    test.each(["review:", "review :", "review,", "review.", "review!"])(
      "'@oneuptime %s' is still a Review",
      (phrase: string) => {
        expect(commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType).toBe(
          GitHubCommandType.Review,
        );
      },
    );

    test("'@oneuptime help!' is Help", () => {
      expect(commandOnPullRequest("@oneuptime help!").commandType).toBe(
        GitHubCommandType.Help,
      );
    });

    test("'@oneuptime status?' is Status", () => {
      expect(commandOnPullRequest("@oneuptime status?").commandType).toBe(
        GitHubCommandType.Status,
      );
    });

    test("'@oneuptime abort!' is Cancel", () => {
      expect(commandOnPullRequest("@oneuptime abort!").commandType).toBe(
        GitHubCommandType.Cancel,
      );
    });

    // "@oneuptime: review" — the colon belongs to the mention, not the verb.
    test("a colon straight after the mention does not hide the verb", () => {
      expect(commandOnPullRequest("@oneuptime: review").commandType).toBe(
        GitHubCommandType.Review,
      );
    });

    test("a leading list dash does not hide the verb", () => {
      expect(
        commandOnIssue("@oneuptime - please implement this").commandType,
      ).toBe(GitHubCommandType.Implement);
    });

    test("a verb on the line after the mention is still the verb", () => {
      expect(
        commandOnPullRequest(body("@oneuptime", "please review this diff"))
          .commandType,
      ).toBe(GitHubCommandType.Review);
    });
  });

  describe("the instruction handed to the agent", () => {
    /*
     * The verb is kept in the instruction rather than stripped. Every consumer
     * quotes this text into a prompt as the user's own words, and removing the
     * first line of them changes what was asked for.
     */
    test("keeps the verb itself, not only the words after it", () => {
      expect(
        commandOnPullRequest(
          "@oneuptime review this and check perf on the hot path",
        ).instruction,
      ).toBe("review this and check perf on the hot path");
    });

    test("keeps trailing punctuation and the rest of the sentence", () => {
      expect(
        commandOnPullRequest("@oneuptime review: focus on the retry loop")
          .instruction,
      ).toBe("review: focus on the retry loop");
    });

    test("keeps everything after a mention written mid-sentence", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "Hey @oneuptime review this when you get a sec",
      );

      expect(command.commandType).toBe(GitHubCommandType.Review);
      expect(command.instruction).toBe("review this when you get a sec");
    });

    test("does not include the mention token itself", () => {
      expect(
        commandOnPullRequest("@oneuptime[bot] revise this").instruction,
      ).not.toContain("@oneuptime");
    });

    test("collapses the whitespace between the mention and the instruction", () => {
      expect(commandOnPullRequest("@oneuptime      status").instruction).toBe(
        "status",
      );
    });

    test("preserves non-ASCII text byte for byte", () => {
      expect(
        commandOnPullRequest(
          "@oneuptime revise this — the café loader 🚀 drops frames",
        ).instruction,
      ).toBe("revise this — the café loader 🚀 drops frames");
    });

    /*
     * Inline code is blanked only to LOCATE the mention — the instruction is
     * sliced out of the ORIGINAL text at the same index. Removing the span
     * instead would hand the agent "revise this to use " and leave it to
     * guess what to use, on the very requests where the person was most
     * precise: the ones where they typed the identifier out.
     */
    test("keeps an inline code span the person typed", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime revise this to use `Array<T>`",
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe("revise this to use `Array<T>`");
    });

    test("keeps an inline code span in the middle of the instruction", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime revise this: `retryCount` must be capped at 5",
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe(
        "revise this: `retryCount` must be capped at 5",
      );
    });

    test("keeps several inline code spans and the text between them", () => {
      expect(
        commandOnIssue(
          "@oneuptime implement this: `parseAll()` should call `parseOne()` per row",
        ).instruction,
      ).toBe("implement this: `parseAll()` should call `parseOne()` per row");
    });

    /*
     * The blanking is what keeps the two strings index-aligned. A span BEFORE
     * the mention is the case that would go wrong if the span were removed
     * rather than blanked: every index after it would shift, and the
     * instruction would be sliced from the wrong place.
     */
    test("an inline code span before the mention does not shift the slice", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "`retryCount` is wrong — @oneuptime revise this: cap it at 5",
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe("revise this: cap it at 5");
    });

    test("carries a multi-line instruction through to the end of the comment", () => {
      const command: GitHubCommand = commandOnPullRequest(
        body(
          "@oneuptime revise this",
          "because the retry loop is wrong",
          "> quoted from an older comment",
          "also fix the log line",
        ),
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe(
        body(
          "revise this",
          "because the retry loop is wrong",
          "also fix the log line",
        ),
      );
    });

    /*
     * The quoted half of a reply is history, not instruction. Letting it
     * through would feed the app its own earlier output back as a request.
     */
    test("drops quoted lines from the instruction, keeping only the new text", () => {
      const command: GitHubCommand = commandOnPullRequest(
        body(
          "> @oneuptime review",
          "> looks good to me",
          "",
          "@oneuptime revise this: add the null check",
        ),
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe("revise this: add the null check");
      expect(command.instruction).not.toContain("looks good to me");
    });
  });

  describe("surface defaults when no verb is recognized", () => {
    /*
     * "@oneuptime the retry loop here looks wrong" is the most natural way to
     * ask for a change. Rejecting it as unparseable would make the app feel
     * broken; guessing Implement on a pull request would open a second PR.
     */
    test("unrecognized text on a pull request is a Revise", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime the retry loop here looks wrong",
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe("the retry loop here looks wrong");
    });

    test("the same text on an issue is an Implement", () => {
      const command: GitHubCommand = commandOnIssue(
        "@oneuptime the retry loop here looks wrong",
      );

      expect(command.commandType).toBe(GitHubCommandType.Implement);
      expect(command.instruction).toBe("the retry loop here looks wrong");
    });

    /*
     * The composition that matters: whatever the default is, it has to be
     * something the surface it came from can actually carry out, or free-text
     * mentions would dead-end in "not supported here".
     */
    test("the default is always supported on the surface it came from", () => {
      const onPullRequest: GitHubCommand = commandOnPullRequest(
        "@oneuptime this needs a null check",
      );
      const onIssue: GitHubCommand = commandOnIssue(
        "@oneuptime this needs a null check",
      );

      expect(
        GitHubCommandParser.isSupportedOnSurface({
          commandType: onPullRequest.commandType,
          surface: GitHubCommandSurface.PullRequest,
        }),
      ).toBe(true);

      expect(
        GitHubCommandParser.isSupportedOnSurface({
          commandType: onIssue.commandType,
          surface: GitHubCommandSurface.Issue,
        }),
      ).toBe(true);
    });
  });

  /*
   * A verb is a verb only at the START of the instruction. Scanning the whole
   * instruction for the word would turn ordinary prose that happens to mention
   * reviewing into a review run, and — worse — would let a comment ending in
   * "...so I stopped" cancel someone else's in-flight work.
   */
  describe("a word that is not the verb", () => {
    test("'the reviewer asked for a null check' is not a Review", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime the reviewer asked for a null check",
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
    });

    test.each([
      "reviews are failing on main",
      "helpme with the flaky spec",
      "stopping the poller mid-flight leaks a handle",
      "cancelled the deploy last night",
      "implementation is wrong here",
      "statuses should be paginated",
    ])(
      "'@oneuptime %s' falls through to the surface default",
      (phrase: string) => {
        expect(commandOnPullRequest(`@${APP_SLUG} ${phrase}`).commandType).toBe(
          GitHubCommandType.Revise,
        );
      },
    );

    test("a verb buried in the middle of a sentence does not win", () => {
      expect(
        commandOnPullRequest(
          "@oneuptime can we get someone to review and merge",
        ).commandType,
      ).toBe(GitHubCommandType.Revise);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * More than one mention in one comment.
   *
   * "@oneuptime[bot] said it was flaky, so @oneuptime review this again" is
   * ordinary English, and it is what people write when they are replying to
   * the app and giving it an order in the same breath. Reading only the FIRST
   * mention turns the order into a fragment of an instruction string nobody
   * wrote — and picks the surface default instead of the verb the person
   * actually used, which is the difference between answering a question and
   * pushing a commit.
   *
   * So every mention is scanned, and the precedence is: the first mention
   * followed by a recognized VERB wins; failing that, the first mention that
   * says anything at all; failing that, Help.
   * -------------------------------------------------------------------------
   */
  describe("several mentions in one comment", () => {
    test("a verb on a later mention beats free text on an earlier one", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime[bot] said it was flaky, so @oneuptime status",
      );

      expect(command.commandType).toBe(GitHubCommandType.Status);
      expect(command.instruction).toBe("status");
    });

    test("the verb wins even when the earlier mention would default to Revise", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime the CI is red, so @oneuptime review this",
      );

      expect(command.commandType).toBe(GitHubCommandType.Review);
      expect(command.instruction).toBe("review this");
    });

    test("the same precedence holds on an issue", () => {
      expect(
        commandOnIssue("@oneuptime this is still open, @oneuptime cancel")
          .commandType,
      ).toBe(GitHubCommandType.Cancel);
    });

    /*
     * With no verb anywhere, the FIRST substantive mention is the request —
     * later ones are the person addressing the app again inside their own
     * sentence, not a second command.
     */
    test("with no verb anywhere the first substantive mention wins", () => {
      const command: GitHubCommand = commandOnIssue(
        "@oneuptime the CSV export drops the last row, cc @oneuptime",
      );

      expect(command.commandType).toBe(GitHubCommandType.Implement);
      expect(command.instruction).toBe(
        "the CSV export drops the last row, cc @oneuptime",
      );
    });

    /*
     * An earlier mention with nothing after it must not consume the comment:
     * before the scan, a leading bare mention returned Help and the order on
     * the next line was never read.
     */
    test("a bare mention on its own line does not eat the order below it", () => {
      const command: GitHubCommand = commandOnPullRequest(
        body("@oneuptime", "", "@oneuptime code review"),
      );

      expect(command.commandType).toBe(GitHubCommandType.Review);
    });

    test("two verbs in one comment resolve to the first of them", () => {
      expect(
        commandOnPullRequest("@oneuptime review this, @oneuptime cancel")
          .commandType,
      ).toBe(GitHubCommandType.Review);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * A mention with no WORD after it.
   *
   * "@oneuptime 👍" is applause, not a work order. It is not the empty string
   * either, so a bare truthiness check on the instruction sent it to the
   * surface default and spent a full agent run — a write-capable one on a
   * pull request — on a thumbs-up. Substance means at least one alphanumeric
   * character.
   * -------------------------------------------------------------------------
   */
  describe("a mention with no word after it", () => {
    test.each(["👍", "🎉 🚀", "!!", "...", "??", "— —", "🙏"])(
      "'@oneuptime %s' is Help, not a paid run",
      (trailer: string) => {
        const command: GitHubCommand = commandOnPullRequest(
          `@${APP_SLUG} ${trailer}`,
        );

        expect(command.commandType).toBe(GitHubCommandType.Help);
        expect(command.instruction).toBe("");
      },
    );

    test("an emoji-only mention on an issue is Help too, not an Implement", () => {
      expect(commandOnIssue("@oneuptime 👍").commandType).toBe(
        GitHubCommandType.Help,
      );
    });

    test("a single letter after the mention IS substance", () => {
      const command: GitHubCommand = commandOnPullRequest("@oneuptime k");

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe("k");
    });

    /*
     * Substance is about the presence of a word, not about dropping the
     * decoration around it — the agent still reads the emoji the person sent.
     */
    test("an emoji beside a real instruction does not suppress it", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime 🙏 revise this: cap the retries",
      );

      expect(command.commandType).toBe(GitHubCommandType.Revise);
      expect(command.instruction).toBe("🙏 revise this: cap the retries");
    });

    test("a thumbs-up before a real order still runs the order", () => {
      expect(
        commandOnPullRequest("@oneuptime 👍 and @oneuptime status").commandType,
      ).toBe(GitHubCommandType.Status);
    });
  });

  /*
   * ---------------------------------------------------------------------
   * Loop prevention. Each of these bodies is text the app itself could have
   * written and a human could have quoted back. Any one of them returning a
   * command is a comment loop that spends the project's fix budget.
   * ---------------------------------------------------------------------
   */
  describe("loop prevention: quoted regions are not commands", () => {
    test("a mention inside a blockquote is not a command", () => {
      expect(parseOnPullRequest("> @oneuptime review")).toBeNull();
    });

    test("a mention inside GitHub's nested quote-reply form is not a command", () => {
      expect(parseOnPullRequest("> > @oneuptime review this")).toBeNull();
    });

    test("an indented quote is still a quote", () => {
      expect(parseOnPullRequest("   > @oneuptime review")).toBeNull();
    });

    test("a tab-indented quote is still a quote", () => {
      expect(parseOnPullRequest("\t> @oneuptime review")).toBeNull();
    });

    test("a quote that appears after other text is still a quote", () => {
      expect(
        parseOnPullRequest(
          body("Thanks, that helped!", "", "> @oneuptime review"),
        ),
      ).toBeNull();
    });

    // The exact shape GitHub's "Quote reply" button produces.
    test("quote-replying to the app's own comment does not re-trigger it", () => {
      expect(
        parseOnPullRequest(
          body(
            "> **@oneuptime[bot]** commented:",
            "> ",
            "> @oneuptime review",
            "",
            "Thanks, looks good.",
          ),
        ),
      ).toBeNull();
    });

    test("a genuine mention below the quoted history is still a command", () => {
      expect(
        commandOnPullRequest(
          body("> @oneuptime review", "", "@oneuptime status"),
        ).commandType,
      ).toBe(GitHubCommandType.Status);
    });

    /*
     * The stripping has to stay line-anchored. A ">" written mid-sentence is
     * a comparison, and dropping that line would silently swallow the command
     * on it.
     */
    test("a '>' in the middle of a line does not make the line a quote", () => {
      expect(
        commandOnPullRequest("if a > b then @oneuptime review this")
          .commandType,
      ).toBe(GitHubCommandType.Review);
    });
  });

  describe("loop prevention: fenced code blocks are not commands", () => {
    test("a mention inside a backtick fence is not a command", () => {
      expect(
        parseOnPullRequest(body(FENCE, "@oneuptime review", FENCE)),
      ).toBeNull();
    });

    test("a mention inside a fence with an info string is not a command", () => {
      expect(
        parseOnPullRequest(
          body(`${FENCE}suggestion`, "@oneuptime review", FENCE),
        ),
      ).toBeNull();
    });

    test("a mention inside a tilde fence is not a command", () => {
      expect(
        parseOnPullRequest(body(TILDE_FENCE, "@oneuptime review", TILDE_FENCE)),
      ).toBeNull();
    });

    test("a mention inside a tilde fence with an info string is not a command", () => {
      expect(
        parseOnPullRequest(
          body(`${TILDE_FENCE}text`, "@oneuptime review", TILDE_FENCE),
        ),
      ).toBeNull();
    });

    /*
     * The case a lazy regex gets wrong. Pasted logs very often end without a
     * closing fence, and everything after the opener is code as far as GitHub
     * renders it — so it must be code as far as this parser reads it too.
     */
    test("an unclosed fence swallows the rest of the comment", () => {
      expect(
        parseOnPullRequest(
          body(
            "Here is the log:",
            FENCE,
            "@oneuptime review",
            "more log lines",
          ),
        ),
      ).toBeNull();
    });

    test("an unclosed tilde fence swallows the rest of the comment", () => {
      expect(
        parseOnIssue(body(TILDE_FENCE, "@oneuptime implement this")),
      ).toBeNull();
    });

    test("a backtick fence is not closed by a tilde fence", () => {
      expect(
        parseOnPullRequest(
          body(FENCE, "@oneuptime review", TILDE_FENCE, "@oneuptime status"),
        ),
      ).toBeNull();
    });

    test("a mention after a CLOSED fence is a command again", () => {
      expect(
        commandOnPullRequest(
          body(FENCE, "@oneuptime help", FENCE, "@oneuptime review"),
        ).commandType,
      ).toBe(GitHubCommandType.Review);
    });

    test("a quote marker inside a fence does not end the fence early", () => {
      expect(
        parseOnPullRequest(
          body(FENCE, "> @oneuptime review", "@oneuptime cancel", FENCE),
        ),
      ).toBeNull();
    });

    test("backticks inside a fence do not re-open it as an inline span", () => {
      expect(
        parseOnPullRequest(
          body(FENCE, "`@oneuptime`", "@oneuptime cancel", FENCE),
        ),
      ).toBeNull();
    });

    test("a CRLF comment is stripped the same way as an LF one", () => {
      expect(
        parseOnPullRequest("log:\r\n```\r\n@oneuptime review\r\n```\r\n"),
      ).toBeNull();
    });

    /*
     * Fence LENGTH, per CommonMark: a fence closes only on a run of the same
     * character that is AT LEAST as long as the opener. Comparing only the
     * character is the loop guard failing open on the one comment shape most
     * likely to contain a mention — someone using a four-backtick block to
     * show a colleague what a three-backtick example looks like. The inner
     * ``` does not close the ```` block, so the mention beneath it is still
     * code, not an order.
     */
    test("a short fence inside a longer one does not close it", () => {
      expect(
        commandOnPullRequest(
          body(
            LONG_FENCE,
            FENCE,
            "@oneuptime review",
            FENCE,
            LONG_FENCE,
            "@oneuptime status",
          ),
        ).commandType,
      ).toBe(GitHubCommandType.Status);
    });

    test("a short fence inside an unclosed longer one swallows the rest", () => {
      expect(
        parseOnPullRequest(
          body(LONG_FENCE, "@oneuptime review", FENCE, "@oneuptime cancel"),
        ),
      ).toBeNull();
    });

    test("a short tilde fence inside a longer one does not close it", () => {
      expect(
        parseOnPullRequest(
          body(
            LONG_TILDE_FENCE,
            "@oneuptime review",
            TILDE_FENCE,
            "@oneuptime cancel",
          ),
        ),
      ).toBeNull();
    });

    /*
     * The other direction is allowed by the same rule: a longer run closes a
     * shorter opener, so a comment that ends its block with extra backticks
     * is not left permanently open.
     */
    test("a longer fence does close a shorter one", () => {
      expect(
        commandOnPullRequest(
          body(FENCE, "@oneuptime review", LONG_FENCE, "@oneuptime status"),
        ).commandType,
      ).toBe(GitHubCommandType.Status);
    });

    test("an exactly matching long fence closes the block", () => {
      expect(
        commandOnPullRequest(
          body(LONG_FENCE, "@oneuptime review", LONG_FENCE, "@oneuptime help"),
        ).commandType,
      ).toBe(GitHubCommandType.Help);
    });
  });

  describe("loop prevention: inline code spans are not commands", () => {
    test("a mention inside an inline span is not a command", () => {
      expect(
        parseOnPullRequest("`@oneuptime review` is how you ask for one"),
      ).toBeNull();
    });

    test("a real mention beside a documented one is still a command", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "Use `@oneuptime review` — @oneuptime help",
      );

      expect(command.commandType).toBe(GitHubCommandType.Help);
      expect(command.instruction).toBe("help");
    });

    test("an inline span inside a quote is not a command either", () => {
      expect(
        parseOnPullRequest(body("> `@oneuptime review`", "nothing to do here")),
      ).toBeNull();
    });

    /*
     * An UNMATCHED backtick renders literally on GitHub, so the mention after
     * it is really addressed to the app. Swallowing to end-of-line here would
     * let a stray backtick silently drop a genuine command.
     */
    test("a single unmatched backtick does not swallow the command", () => {
      expect(commandOnPullRequest("`@oneuptime review").commandType).toBe(
        GitHubCommandType.Review,
      );
    });
  });

  describe("the mention must be a whole word", () => {
    /*
     * A DIFFERENT GitHub App. `\b` sits happily between "oneuptime" and the
     * "-", which is exactly why the parser uses a negative lookahead instead.
     */
    test("@oneuptime-staging does not command @oneuptime", () => {
      expect(parseOnPullRequest("@oneuptime-staging review")).toBeNull();
    });

    test.each([
      "@oneuptimebot review",
      "@oneuptime_bot review",
      "@oneuptime2 review",
    ])("'%s' does not command @oneuptime", (text: string) => {
      expect(parseOnPullRequest(text)).toBeNull();
    });

    test("an email address ending in the slug is not a mention", () => {
      expect(
        parseOnPullRequest("ping support@oneuptime.com if CI is stuck"),
      ).toBeNull();
    });

    test("an at-sign preceded by a word character is never a mention", () => {
      expect(
        parseOnPullRequest("email@oneuptime and see what happens"),
      ).toBeNull();
    });

    test("a slug inside a URL path is not a mention", () => {
      expect(
        parseOnPullRequest("see https://example.com/@oneuptime for the docs"),
      ).toBeNull();
    });

    test("a doubled at-sign is not a mention", () => {
      expect(parseOnPullRequest("@@oneuptime review")).toBeNull();
    });

    test("the [bot] form GitHub renders IS a mention", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "@oneuptime[bot] review",
      );

      expect(command.commandType).toBe(GitHubCommandType.Review);
      expect(command.instruction).toBe("review");
    });

    test("the [bot] form falls through to the surface default like any other", () => {
      expect(
        commandOnPullRequest("@oneuptime[bot] the retry loop is wrong")
          .commandType,
      ).toBe(GitHubCommandType.Revise);
    });

    test("a mention at the very start of a later line is a mention", () => {
      expect(
        commandOnPullRequest(
          body("Hi team.", "", "@oneuptime review this diff"),
        ).commandType,
      ).toBe(GitHubCommandType.Review);
    });
  });

  /*
   * -------------------------------------------------------------------------
   * The character immediately BEFORE the at-sign.
   *
   * This is an ALLOW-LIST, and the whole describe block exists to pin that it
   * stays one. The obvious rule — "the preceding character must not be a word
   * character" — is written in ASCII and is therefore wrong everywhere else:
   * "é" is not an ASCII word character, so `café@oneuptime.com` parsed as a
   * mention and an EMAIL ADDRESS in the body of a comment started a paid,
   * write-capable agent run. There is no finite list of characters an email
   * local part may end with, so the only sound rule names what MAY precede a
   * mention instead: the start of the text, whitespace, or the punctuation
   * people genuinely wrap a mention in.
   *
   * Each character is asserted on its own rather than as a class, because a
   * single character dropped from — or added to — the class is invisible in a
   * diff and changes what can spend money.
   * -------------------------------------------------------------------------
   */
  describe("the character before the mention is an allow-list", () => {
    /*
     * Each accepted character is tested with a letter in front of it, so that
     * a passing case proves the CHARACTER was accepted rather than the
     * start-of-text alternative matching.
     */
    test.each([
      { name: "a space", character: " " },
      { name: "a tab", character: "\t" },
      { name: "a newline", character: "\n" },
      { name: "an opening parenthesis", character: "(" },
      { name: "an opening square bracket", character: "[" },
      { name: "an opening brace", character: "{" },
      { name: "an asterisk, as in *@oneuptime*", character: "*" },
      { name: "an underscore, as in _@oneuptime_", character: "_" },
      { name: "a tilde, as in ~@oneuptime~", character: "~" },
      { name: "a double quote", character: '"' },
      { name: "a single quote", character: "'" },
      { name: "a lone backtick", character: "`" },
    ])(
      "$name before the at-sign still leaves a mention",
      ({ character }: { name: string; character: string }) => {
        expect(
          commandOnPullRequest(`hi${character}@${APP_SLUG} review`).commandType,
        ).toBe(GitHubCommandType.Review);
      },
    );

    test("the very start of the comment is a mention position", () => {
      expect(commandOnPullRequest("@oneuptime review").commandType).toBe(
        GitHubCommandType.Review,
      );
    });

    /*
     * Everything else. A hyphen, a slash and a dot are the characters that
     * make a mention out of a handle in a URL, a path or a domain; a letter
     * and a digit are the ordinary end of an email local part; and "é" is the
     * one that used to get through, which is the reason this list is an
     * allow-list at all.
     */
    test.each([
      { name: "a letter", character: "x" },
      { name: "a digit", character: "7" },
      { name: "a hyphen", character: "-" },
      { name: "a slash", character: "/" },
      { name: "a dot", character: "." },
      { name: "a non-ASCII letter", character: "é" },
    ])(
      "$name before the at-sign is not a mention position",
      ({ character }: { name: string; character: string }) => {
        expect(
          parseOnPullRequest(`${character}@${APP_SLUG} review`),
        ).toBeNull();
      },
    );

    /*
     * The case that actually happened. Every part of this body is innocent —
     * someone pasting a contact address into a thread — and it must cost
     * nothing at all.
     */
    test("an email address with a non-ASCII local part is not a mention", () => {
      expect(
        parseOnPullRequest("write to café@oneuptime.com if CI is stuck"),
      ).toBeNull();
    });

    test("a bare non-ASCII address is not a mention either", () => {
      expect(parseOnIssue("café@oneuptime.com")).toBeNull();
    });

    /*
     * A domain with no local part in front of it. The leading guard cannot
     * catch this one — a space precedes the at-sign — so the trailing guard
     * has to.
     */
    test("a bare @slug followed by a domain suffix is not a mention", () => {
      expect(parseOnPullRequest("we host this at @oneuptime.com")).toBeNull();
    });

    test.each([
      "@oneuptime.com is our site",
      "see @oneuptime.dev for the docs",
      "docs live at @oneuptime.io/docs",
    ])("'%s' is not a mention", (text: string) => {
      expect(parseOnPullRequest(text)).toBeNull();
    });

    /*
     * ...but the dot guard must only refuse a dot that starts something
     * DOMAIN-shaped. A mention at the end of a sentence is how most people
     * write, and refusing it would silently drop ordinary commands.
     */
    test("a sentence-ending period after the mention is still a mention", () => {
      const command: GitHubCommand = commandOnPullRequest("thanks @oneuptime.");

      expect(command.commandType).toBe(GitHubCommandType.Help);
      expect(command.instruction).toBe("");
    });

    test("a period between the mention and the verb does not hide the verb", () => {
      const command: GitHubCommand = commandOnPullRequest(
        "thanks @oneuptime. please review this",
      );

      expect(command.commandType).toBe(GitHubCommandType.Review);
      // The instruction is the text as typed; only the verb match normalizes.
      expect(command.instruction).toBe(". please review this");
    });

    test("a comma after the mention is untouched by the dot guard", () => {
      expect(
        commandOnPullRequest("@oneuptime, please review this").commandType,
      ).toBe(GitHubCommandType.Review);
    });
  });

  /*
   * The slug comes from configuration, so a metacharacter in it is a
   * correctness bug rather than an injection — but an unescaped "[" throws a
   * SyntaxError that takes down every webhook for that installation, and an
   * unescaped "+" or "*" quietly widens what counts as a mention.
   */
  describe("app slugs containing regex metacharacters", () => {
    test("a dot in the slug matches only a literal dot", () => {
      expect(parseWithSlug("@oneXuptime review", "one.uptime")).toBeNull();
      expect(
        parseWithSlug("@one.uptime review", "one.uptime")?.commandType,
      ).toBe(GitHubCommandType.Review);
    });

    test("a plus in the slug is not read as a repetition", () => {
      expect(parseWithSlug("@oneeeuptime review", "one+uptime")).toBeNull();
      expect(
        parseWithSlug("@one+uptime review", "one+uptime")?.commandType,
      ).toBe(GitHubCommandType.Review);
    });

    test("a star in the slug is not read as a repetition", () => {
      expect(parseWithSlug("@onuptime review", "one*uptime")).toBeNull();
    });

    test("a dollar in the slug is not read as an end anchor", () => {
      expect(
        parseWithSlug("@one$uptime review", "one$uptime")?.commandType,
      ).toBe(GitHubCommandType.Review);
    });

    test("an unbalanced bracket in the slug does not throw", () => {
      expect(() => {
        return parseWithSlug("nothing to see here", "one[uptime");
      }).not.toThrow();

      expect(parseWithSlug("nothing to see here", "one[uptime")).toBeNull();
      expect(parseWithSlug("@one[uptime help", "one[uptime")?.commandType).toBe(
        GitHubCommandType.Help,
      );
    });

    test("a parenthesised slug is matched literally", () => {
      expect(parseWithSlug("@a(b) review", "a(b)")?.commandType).toBe(
        GitHubCommandType.Review,
      );
    });

    test("a slug stored with surrounding whitespace still matches", () => {
      expect(
        parseWithSlug("@oneuptime review", "  oneuptime  ")?.commandType,
      ).toBe(GitHubCommandType.Review);
    });
  });

  describe("missing or empty input", () => {
    test("a null body is not a command", () => {
      expect(parseOnPullRequest(null)).toBeNull();
    });

    test("an undefined body is not a command", () => {
      expect(parseOnIssue(undefined)).toBeNull();
    });

    test("an empty body is not a command", () => {
      expect(parseOnPullRequest("")).toBeNull();
    });

    test("a whitespace-only body is not a command", () => {
      expect(parseOnPullRequest("   \n\t  \n")).toBeNull();
    });

    /*
     * An unconfigured slug must never fall back to matching everything: with
     * an empty pattern, "@" alone — or any text at all — would start a run.
     */
    test("a null app slug is not a command", () => {
      expect(parseWithSlug("@oneuptime review", null)).toBeNull();
    });

    test("an undefined app slug is not a command", () => {
      expect(parseWithSlug("@oneuptime review", undefined)).toBeNull();
    });

    test("an empty app slug is not a command", () => {
      expect(parseWithSlug("@oneuptime review", "")).toBeNull();
    });

    test("a whitespace-only app slug is not a command", () => {
      expect(parseWithSlug("@oneuptime review", "   ")).toBeNull();
    });
  });
});

/*
 * The surface matrix. Review and Revise both need a diff and a head branch;
 * Implement needs an issue to close. Getting one of these wrong does not
 * fail loudly — it runs the WRONG kind of agent, so the pairs below are
 * asserted in both directions.
 */
describe("GitHubCommandParser.isSupportedOnSurface", () => {
  function isSupported(
    commandType: GitHubCommandType,
    surface: GitHubCommandSurface,
  ): boolean {
    return GitHubCommandParser.isSupportedOnSurface({
      commandType: commandType,
      surface: surface,
    });
  }

  describe("Review", () => {
    test("is supported on a pull request", () => {
      expect(
        isSupported(GitHubCommandType.Review, GitHubCommandSurface.PullRequest),
      ).toBe(true);
    });

    test("is NOT supported on an issue, which has no diff to read", () => {
      expect(
        isSupported(GitHubCommandType.Review, GitHubCommandSurface.Issue),
      ).toBe(false);
    });
  });

  describe("Revise", () => {
    test("is supported on a pull request, whose head branch it pushes to", () => {
      expect(
        isSupported(GitHubCommandType.Revise, GitHubCommandSurface.PullRequest),
      ).toBe(true);
    });

    test("is NOT supported on an issue, which has no head branch", () => {
      expect(
        isSupported(GitHubCommandType.Revise, GitHubCommandSurface.Issue),
      ).toBe(false);
    });
  });

  describe("Implement", () => {
    test("is supported on an issue", () => {
      expect(
        isSupported(GitHubCommandType.Implement, GitHubCommandSurface.Issue),
      ).toBe(true);
    });

    /*
     * Implement opens a NEW pull request that closes an issue. Allowing it on
     * a pull request would open a second PR against the same work instead of
     * revising the one being commented on.
     */
    test("is NOT supported on a pull request", () => {
      expect(
        isSupported(
          GitHubCommandType.Implement,
          GitHubCommandSurface.PullRequest,
        ),
      ).toBe(false);
    });
  });

  describe("the conversational commands", () => {
    test.each([
      GitHubCommandType.Help,
      GitHubCommandType.Status,
      GitHubCommandType.Cancel,
    ])("%s is supported on both surfaces", (commandType: GitHubCommandType) => {
      expect(isSupported(commandType, GitHubCommandSurface.PullRequest)).toBe(
        true,
      );
      expect(isSupported(commandType, GitHubCommandSurface.Issue)).toBe(true);
    });
  });

  /*
   * The catch-all. A command type added to the enum without a line in
   * isSupportedOnSurface falls into the `return true` at the bottom and is
   * silently allowed everywhere — so the count is asserted too, to make a new
   * type fail HERE, next to the matrix it needs a decision in.
   */
  test("every command type is supported on at least one surface", () => {
    const commandTypes: Array<GitHubCommandType> =
      Object.values(GitHubCommandType);

    expect(commandTypes.length).toBe(6);

    for (const commandType of commandTypes) {
      expect(
        isSupported(commandType, GitHubCommandSurface.PullRequest) ||
          isSupported(commandType, GitHubCommandSurface.Issue),
      ).toBe(true);
    }
  });
});

/*
 * The parser and this predicate together decide whether a comment costs
 * money. Anything conversational is answered inline by the webhook and never
 * enqueues an agent run, so a command type moving across this line changes
 * the billing behaviour of the whole integration.
 */
describe("commands that never start an agent run", () => {
  test.each([
    GitHubCommandType.Help,
    GitHubCommandType.Status,
    GitHubCommandType.Cancel,
  ])("%s is conversational", (commandType: GitHubCommandType) => {
    expect(isConversationalCommand(commandType)).toBe(true);
  });

  test.each([
    GitHubCommandType.Review,
    GitHubCommandType.Revise,
    GitHubCommandType.Implement,
  ])("%s is NOT conversational", (commandType: GitHubCommandType) => {
    expect(isConversationalCommand(commandType)).toBe(false);
  });

  // The bare mention is the one that fires most often by accident.
  test("a bare mention is conversational, so it cannot cost a run", () => {
    const command: GitHubCommand = commandOnIssue("@oneuptime");

    expect(isConversationalCommand(command.commandType)).toBe(true);
  });

  /*
   * The other one that fires by accident, and the more expensive of the two:
   * a thumbs-up on a pull request would have started a WRITE-capable Revise.
   */
  test("a thumbs-up mention is conversational, so it cannot cost a run", () => {
    const command: GitHubCommand = commandOnPullRequest("@oneuptime 👍");

    expect(isConversationalCommand(command.commandType)).toBe(true);
  });

  test("free text on an issue is NOT conversational, and does cost a run", () => {
    const command: GitHubCommand = commandOnIssue(
      "@oneuptime the CSV export drops the last row",
    );

    expect(isConversationalCommand(command.commandType)).toBe(false);
  });
});
