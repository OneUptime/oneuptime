import GitHubReplyComposer from "../../../../Server/Utils/CodeRepository/GitHub/GitHubReplyComposer";
import GitHubCommandParser from "../../../../Server/Utils/CodeRepository/GitHub/GitHubCommandParser";
import GitHubCommandType, {
  GitHubCommand,
  GitHubCommandSurface,
} from "../../../../Types/CodeRepository/GitHubCommand";
import { describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * Every comment the OneUptime GitHub App writes into a thread comes from
 * GitHubReplyComposer. These tests exist for ONE invariant above all others:
 *
 *   NOTHING the composer emits may be readable, by GitHubCommandParser, as a
 *   command addressed to this app.
 *
 * This is a billing-safety rule, not a style rule. The app's own comments come
 * back to it as `issue_comment` webhooks, indistinguishable at the wire from a
 * human's. A status update that contains a bare "@oneuptime" therefore
 * commands the app, which posts another status update, which commands it
 * again — a comment loop that spends the project's AI budget until a human
 * notices the thread.
 *
 * The interesting case is help(), whose entire job is to PRINT the commands.
 * It stays safe only because it prints them inside a fenced code block, and
 * because the parser strips fenced blocks before it looks for mentions. Those
 * two facts live in two different files, so the test that they still agree is
 * an end-to-end one: compose, parse, expect null. It is written below for
 * every public composer method, not just for help().
 *
 * The second recurring hazard is the user's own text. quoteInstruction() is
 * the only thing standing between "@oneuptime review" typed by a user and the
 * same string being re-emitted by the app; blockquoting it is what makes the
 * echo inert. So the quoting tests assert through the parser too, rather than
 * asserting that a ">" appeared.
 *
 * A fence is NOT interchangeable with a blockquote for that job, and the
 * difference was a live hole. failed() and refusal() used to wrap their reason
 * in a ``` fence; a reason carrying a ``` of its own closed that wrapper early
 * and spilled everything after it into the comment as live markdown — a live
 * @mention included. A blockquote has no closing token an input can reach, so
 * every untrusted string now goes through quoteInstruction(). The fence
 * survives only in help(), whose text this file writes and which therefore
 * cannot contain a surprise.
 *
 * Everything here is pure string building — no database, no network, no
 * mocking, and therefore nothing to restore between tests.
 * ---------------------------------------------------------------------------
 */

const APP_SLUG: string = "oneuptime";

// A copy of the composer's own footer. If it changes, these tests should say so.
const SIGNATURE: string =
  "<sub>Posted by OneUptime. Reply in this thread to ask for changes.</sub>";

const RUN_URL: string = "https://oneuptime.com/dashboard/ai/runs/1e2d3c4b";
const RUN_URL_BASE: string = "https://oneuptime.com/dashboard/ai/runs";

function parseComment(
  body: string,
  surface: GitHubCommandSurface,
  appSlug: string = APP_SLUG,
): GitHubCommand | null {
  return GitHubCommandParser.parse({
    body: body,
    appSlug: appSlug,
    surface: surface,
  });
}

/*
 * What GitHub's "Quote reply" button does to a comment: copies it wholesale
 * into a `>` block on a new comment. This is the exact gesture that turns a
 * self-mention into a loop, so every composer output is run through it too.
 */
function quoteReply(body: string): string {
  return body
    .split("\n")
    .map((line: string): string => {
      return `> ${line}`;
    })
    .join("\n");
}

/*
 * Lines of a comment where a mention would actually count — i.e. outside every
 * fenced block and outside every blockquote. A direct, parser-independent
 * reading of the rule at the top of this file: if the parser itself ever
 * regressed into matching nothing, the parse-based tests would pass vacuously
 * while this one still failed.
 */
/*
 * Named rather than inlined: eslint's wrap-regex wants a regex literal that
 * receives a method call wrapped in parentheses, and prettier removes them
 * again.
 */
const FENCE_LINE: RegExp = /^[ \t]*(```|~~~)/;
const BLOCKQUOTE_LINE: RegExp = /^[ \t]*>/;

function linesWhereAMentionWouldCount(body: string): Array<string> {
  const offending: Array<string> = [];
  let insideFence: boolean = false;

  for (const line of body.split("\n")) {
    if (FENCE_LINE.test(line)) {
      insideFence = !insideFence;
      continue;
    }

    if (insideFence || BLOCKQUOTE_LINE.test(line)) {
      continue;
    }

    if (line.includes("@")) {
      offending.push(line);
    }
  }

  return offending;
}

/*
 * Whether the string contains half of a surrogate pair on its own — the exact
 * damage a UTF-16 substring does to text that ends in an emoji. Array.from
 * iterates by CODE POINT, so a well-formed pair arrives as one two-unit
 * string; anything that arrives one unit long and inside the surrogate range
 * is an orphan, and GitHub renders it as "�".
 */
function hasLoneSurrogate(value: string): boolean {
  for (const character of Array.from(value)) {
    if (character.length !== 1) {
      continue;
    }

    const code: number = character.charCodeAt(0);

    if (code >= 0xd800 && code <= 0xdfff) {
      return true;
    }
  }

  return false;
}

type ComposedComment = {
  method: string;
  scenario: string;
  body: string;
};

/*
 * One realistic call of every public composer method. Where a field carries
 * UNTRUSTED text (an instruction a user typed, an agent error message that
 * echoes one) the sample deliberately packs a mention into it, because that is
 * the input that would actually start a loop in production.
 */
function everyComposerOutput(): Array<ComposedComment> {
  return [
    {
      method: "quoteInstruction",
      scenario: "echoing a user comment that mentions the app",
      body: GitHubReplyComposer.quoteInstruction(
        `@${APP_SLUG} review this, then @${APP_SLUG} revise it`,
      ),
    },
    {
      method: "acknowledgement",
      scenario: "with an instruction that mentions the app twice",
      body: GitHubReplyComposer.acknowledgement({
        commandType: GitHubCommandType.Revise,
        runUrl: RUN_URL,
        instruction: `@${APP_SLUG} revise this — and then @${APP_SLUG}[bot] review it`,
        projectName: "Checkout",
      }),
    },
    {
      method: "acknowledgement",
      scenario: "with no instruction and no project name",
      body: GitHubReplyComposer.acknowledgement({
        commandType: GitHubCommandType.Implement,
        runUrl: RUN_URL,
        instruction: "",
        projectName: undefined,
      }),
    },
    {
      method: "completed",
      scenario: "reporting the pull request it opened",
      body: GitHubReplyComposer.completed({
        commandType: GitHubCommandType.Implement,
        runUrl: RUN_URL,
        resultLines: [
          "Opened https://github.com/acme/checkout/pull/42",
          "It closes this issue when merged.",
        ],
      }),
    },
    {
      method: "noChangeProposed",
      scenario: "with a reason from the agent",
      body: GitHubReplyComposer.noChangeProposed({
        reason: "The retry loop already backs off exponentially.",
        runUrl: RUN_URL,
      }),
    },
    {
      method: "failed",
      scenario: "with an error message that quotes the user's mention",
      body: GitHubReplyComposer.failed({
        reason: `Agent aborted while handling "@${APP_SLUG} revise this".`,
        runUrl: RUN_URL,
      }),
    },
    {
      /*
       * The reason carries a code fence AND a mention after it. Under the old
       * fenced wrapper this closed the wrapper and put the mention into the
       * comment live; it is in the sample table so it gets the quote-reply and
       * both-surface passes as well as its own named test below.
       */
      method: "failed",
      scenario:
        "with an error message that closes a code fence and mentions the app",
      body: GitHubReplyComposer.failed({
        reason: `\`\`\`\n@${APP_SLUG} review\n\`\`\`\n@${APP_SLUG} cancel`,
        runUrl: RUN_URL,
      }),
    },
    {
      method: "cancelled",
      scenario: "with nothing running",
      body: GitHubReplyComposer.cancelled({ cancelledCount: 0 }),
    },
    {
      method: "cancelled",
      scenario: "with two runs stopped",
      body: GitHubReplyComposer.cancelled({ cancelledCount: 2 }),
    },
    {
      /*
       * A run's OWN acknowledgement, edited to say it was cancelled. Separate
       * from cancelled(), which answers whoever typed the command.
       */
      method: "cancelledRun",
      scenario: "closing out one run's own acknowledgement",
      body: GitHubReplyComposer.cancelledRun({ runUrl: RUN_URL }),
    },
    {
      method: "help",
      scenario: "printing every command it accepts",
      body: GitHubReplyComposer.help({ appSlug: APP_SLUG }),
    },
    {
      method: "status",
      scenario: "idle",
      body: GitHubReplyComposer.status({
        runDescriptions: [],
        runUrlBase: RUN_URL_BASE,
      }),
    },
    {
      method: "status",
      scenario: "with two runs in flight",
      body: GitHubReplyComposer.status({
        runDescriptions: [
          "Revise on #42, started 2 minutes ago",
          "Review on #43, queued",
        ],
        runUrlBase: RUN_URL_BASE,
      }),
    },
    {
      method: "refusal",
      scenario: "a plain refusal",
      body: GitHubReplyComposer.refusal({
        reason: "This repository is not connected to a OneUptime project.",
      }),
    },
    {
      /*
       * Refusal reasons are usually this file's own sentences, but one of them
       * is a BadDataException message from the enqueue path — untrusted the
       * moment it starts interpolating anything a user typed.
       */
      method: "refusal",
      scenario: "with a reason that echoes a mention",
      body: GitHubReplyComposer.refusal({
        reason: `I cannot run "@${APP_SLUG} revise this" on a fork.`,
      }),
    },
    {
      method: "unsupportedOnSurface",
      scenario: "a review asked for on an issue",
      body: GitHubReplyComposer.unsupportedOnSurface({
        commandType: GitHubCommandType.Review,
        appSlug: APP_SLUG,
      }),
    },
    {
      method: "unsupportedOnSurface",
      scenario: "an implement asked for on a pull request",
      body: GitHubReplyComposer.unsupportedOnSurface({
        commandType: GitHubCommandType.Implement,
        appSlug: APP_SLUG,
      }),
    },
  ];
}

// Own statics that are not comment-emitting entry points.
const NOT_A_COMPOSER_METHOD: Array<string> = [
  "length",
  "name",
  "prototype",
  // Private in TypeScript only; still an own property at runtime.
  "describeCommand",
];

function publicComposerMethodNames(): Array<string> {
  const composer: Record<string, unknown> =
    GitHubReplyComposer as unknown as Record<string, unknown>;

  return Object.getOwnPropertyNames(GitHubReplyComposer)
    .filter((key: string): boolean => {
      return (
        !NOT_A_COMPOSER_METHOD.includes(key) &&
        typeof composer[key] === "function"
      );
    })
    .sort();
}

describe("GitHubReplyComposer never writes a comment that commands the app", () => {
  /*
   * The control. Every assertion below is "the parser finds nothing"; if the
   * parser stopped finding anything at all, all of them would pass while the
   * loop was wide open. This one fails first in that world.
   */
  test("the parser used by these tests really does recognise a command", () => {
    expect(
      parseComment(`@${APP_SLUG} review`, GitHubCommandSurface.PullRequest),
    ).not.toBeNull();
  });

  /*
   * If a new composer method is added and not listed in everyComposerOutput(),
   * the loop-safety guarantee silently stops covering it. This is the tripwire.
   */
  test("the sample set covers every method the composer exposes", () => {
    const covered: Array<string> = Array.from(
      new Set(
        everyComposerOutput().map((sample: ComposedComment): string => {
          return sample.method;
        }),
      ),
    ).sort();

    expect(covered).toEqual(publicComposerMethodNames());
  });

  for (const sample of everyComposerOutput()) {
    test(`${sample.method} (${sample.scenario}) is not a command on either surface, even quote-replied`, () => {
      expect(
        parseComment(sample.body, GitHubCommandSurface.PullRequest),
      ).toBeNull();
      expect(parseComment(sample.body, GitHubCommandSurface.Issue)).toBeNull();
      expect(
        parseComment(quoteReply(sample.body), GitHubCommandSurface.PullRequest),
      ).toBeNull();
      expect(
        parseComment(quoteReply(sample.body), GitHubCommandSurface.Issue),
      ).toBeNull();
    });

    test(`${sample.method} (${sample.scenario}) puts no "@" anywhere a mention would count`, () => {
      expect(linesWhereAMentionWouldCount(sample.body)).toEqual([]);
    });
  }
});

describe("quoteInstruction", () => {
  /*
   * The blockquote is the safety mechanism, so it has to reach EVERY line —
   * including blank ones. A bare blank line ends a markdown blockquote, and it
   * would end the parser's `>` skipping too, letting a mention on the next
   * line count.
   */
  test("prefixes every line with a blockquote marker, blank lines included", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      "first line\n\nthird line",
    );

    expect(quoted).toBe("> first line\n> \n> third line");

    for (const line of quoted.split("\n")) {
      expect(line.startsWith(">")).toBe(true);
    }
  });

  test("quotes a single-line instruction without adding anything else", () => {
    expect(
      GitHubReplyComposer.quoteInstruction("  back off exponentially  "),
    ).toBe("> back off exponentially");
  });

  test("keeps quoting when GitHub sends CRLF line endings", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      `look at the retry loop\r\n@${APP_SLUG} review`,
    );

    for (const line of quoted.split("\n")) {
      expect(line.startsWith("> ")).toBe(true);
    }

    expect(parseComment(quoted, GitHubCommandSurface.PullRequest)).toBeNull();
  });

  /*
   * "" is a sentinel, not just a tidy result: acknowledgement() tests this
   * return value to decide whether to print a "You asked" section at all. A
   * lone "> " would both render as an empty quote and defeat that check.
   */
  test("returns an empty string for an instruction that is empty or only whitespace", () => {
    expect(GitHubReplyComposer.quoteInstruction("")).toBe("");
    expect(GitHubReplyComposer.quoteInstruction("   ")).toBe("");
    expect(GitHubReplyComposer.quoteInstruction("\n\n\t  \n")).toBe("");
    expect(GitHubReplyComposer.quoteInstruction("\r\n")).toBe("");
  });

  test("clips an over-long instruction and marks the cut with an ellipsis", () => {
    const long: string = "a".repeat(600);
    const quoted: string = GitHubReplyComposer.quoteInstruction(long);

    expect(quoted.startsWith("> ")).toBe(true);
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted).not.toContain("\n");
    // "> " plus 499 kept characters plus the one-character ellipsis.
    expect(quoted).toBe(`> ${"a".repeat(499)}…`);
  });

  test("leaves an instruction of exactly the cap length untouched", () => {
    const exact: string = "b".repeat(500);

    expect(GitHubReplyComposer.quoteInstruction(exact)).toBe(`> ${exact}`);
  });

  test("clips an instruction that is one character over the cap", () => {
    const overCap: string = "c".repeat(501);

    expect(GitHubReplyComposer.quoteInstruction(overCap)).toBe(
      `> ${"c".repeat(499)}…`,
    );
  });

  test("preserves non-ASCII text verbatim when it is short enough", () => {
    expect(
      GitHubReplyComposer.quoteInstruction(
        "リトライは指数バックオフにしてください",
      ),
    ).toBe("> リトライは指数バックオフにしてください");
  });

  /*
   * The cap counts CHARACTERS THE READER SEES, not UTF-16 units. 400 emoji are
   * 800 units, so a substring-based clip cut this in half and appended an
   * ellipsis to text that was never too long in the first place.
   */
  test("does not clip multi-byte text that is under the cap in code points", () => {
    const rockets: string = "🚀".repeat(400);

    expect(GitHubReplyComposer.quoteInstruction(rockets)).toBe(`> ${rockets}`);
  });

  /*
   * And when it does clip, it clips between characters. substring() cut the
   * 500th UTF-16 unit, which lands in the MIDDLE of a surrogate pair — the
   * comment then ended in half an emoji, which GitHub renders as a replacement
   * character. The app quoting somebody back with visible corruption in their
   * own words is a bug the reader blames on themselves.
   */
  test("clips multi-byte text by code point, never splitting a surrogate pair", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      "🚀".repeat(600),
    );

    expect(quoted).toBe(`> ${"🚀".repeat(499)}…`);
    expect(quoted.startsWith("> ")).toBe(true);
    expect(quoted.endsWith("…")).toBe(true);
    expect(quoted).not.toContain("\n");
    expect(hasLoneSurrogate(quoted)).toBe(false);

    // 499 kept characters plus the ellipsis, counted the way a reader counts.
    expect(Array.from(quoted).length).toBe(2 + 499 + 1);
  });

  // A surrogate pair split by a clip inside a longer sentence, not at the end.
  test("keeps a trailing emoji whole when the cut lands beside one", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      `${"a".repeat(498)}🚀${"b".repeat(100)}`,
    );

    expect(quoted).toBe(`> ${"a".repeat(498)}🚀…`);
    expect(hasLoneSurrogate(quoted)).toBe(false);
  });

  test("an echoed instruction that mentions the app cannot re-trigger the parser", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      `@${APP_SLUG} review`,
    );

    // The text really is echoed back — otherwise the parse below proves nothing.
    expect(quoted).toContain(`@${APP_SLUG} review`);
    expect(parseComment(quoted, GitHubCommandSurface.PullRequest)).toBeNull();
    expect(parseComment(quoted, GitHubCommandSurface.Issue)).toBeNull();
  });

  test("a multi-line instruction cannot smuggle a command onto a later line", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      [
        "look at the retry loop",
        "",
        `@${APP_SLUG} implement this`,
        `   @${APP_SLUG}[bot] cancel`,
      ].join("\n"),
    );

    expect(parseComment(quoted, GitHubCommandSurface.Issue)).toBeNull();
    expect(parseComment(quoted, GitHubCommandSurface.PullRequest)).toBeNull();
  });

  /*
   * A user who pastes a code fence into their instruction must not be able to
   * close the quoting around it. Blockquoting survives this because the
   * parser's fence detector only fires at the start of a line.
   */
  test("an instruction containing a code fence cannot break out of the quote", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      ["```", "not really code", "```", `@${APP_SLUG} revise this`].join("\n"),
    );

    expect(parseComment(quoted, GitHubCommandSurface.PullRequest)).toBeNull();
  });

  test("an instruction that is itself already a quote stays inert", () => {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      `> @${APP_SLUG} status`,
    );

    expect(quoted).toBe(`> > @${APP_SLUG} status`);
    expect(parseComment(quoted, GitHubCommandSurface.Issue)).toBeNull();
  });
});

type CommandWording = {
  commandType: GitHubCommandType;
  description: string;
};

/*
 * The phrase that tells the reader WHICH of the three very different actions
 * is now running against their repository. Review changes nothing, Revise
 * pushes commits to their branch, Implement opens a pull request — reporting
 * the wrong one is how a user finds out too late what the app did.
 */
const COMMAND_WORDINGS: Array<CommandWording> = [
  {
    commandType: GitHubCommandType.Review,
    description: "reviewing this pull request",
  },
  {
    commandType: GitHubCommandType.Revise,
    description: "revising this pull request",
  },
  {
    commandType: GitHubCommandType.Implement,
    description: "working on this issue",
  },
  { commandType: GitHubCommandType.Help, description: "on it" },
  { commandType: GitHubCommandType.Status, description: "on it" },
  { commandType: GitHubCommandType.Cancel, description: "on it" },
];

describe("acknowledgement", () => {
  function acknowledgeReview(data: {
    instruction: string;
    projectName: string | undefined;
  }): string {
    return GitHubReplyComposer.acknowledgement({
      commandType: GitHubCommandType.Review,
      runUrl: RUN_URL,
      instruction: data.instruction,
      projectName: data.projectName,
    });
  }

  test("links the run so the reader can follow along", () => {
    const body: string = acknowledgeReview({
      instruction: "",
      projectName: undefined,
    });

    expect(body).toContain(`[Follow along in OneUptime](${RUN_URL})`);
  });

  for (const wording of COMMAND_WORDINGS) {
    test(`describes a ${wording.commandType} run as "${wording.description}"`, () => {
      const body: string = GitHubReplyComposer.acknowledgement({
        commandType: wording.commandType,
        runUrl: RUN_URL,
        instruction: "",
        projectName: undefined,
      });

      expect(body).toContain(`🤖 **On it** — ${wording.description}.`);
    });
  }

  // Review and Revise differ by two letters and by everything they do.
  test("does not describe a review as a revision, or the other way round", () => {
    const review: string = GitHubReplyComposer.acknowledgement({
      commandType: GitHubCommandType.Review,
      runUrl: RUN_URL,
      instruction: "",
      projectName: undefined,
    });
    const revise: string = GitHubReplyComposer.acknowledgement({
      commandType: GitHubCommandType.Revise,
      runUrl: RUN_URL,
      instruction: "",
      projectName: undefined,
    });

    expect(review).toContain("reviewing");
    expect(review).not.toContain("revising");
    expect(revise).toContain("revising");
    expect(revise).not.toContain("reviewing");
  });

  test("quotes back the instruction it is acting on", () => {
    const body: string = acknowledgeReview({
      instruction: "focus on the null checks in CartService",
      projectName: undefined,
    });

    expect(body).toContain("You asked:");
    expect(body).toContain("> focus on the null checks in CartService");
  });

  test("omits the whole 'You asked' section when the instruction is empty", () => {
    const body: string = acknowledgeReview({
      instruction: "",
      projectName: undefined,
    });

    expect(body).not.toContain("You asked");

    // No stray blockquote either — an empty quote renders as a grey bar.
    for (const line of body.split("\n")) {
      expect(line.startsWith(">")).toBe(false);
    }
  });

  test("omits the 'You asked' section for a whitespace-only instruction too", () => {
    const body: string = acknowledgeReview({
      instruction: "   \n\t  \n",
      projectName: undefined,
    });

    expect(body).not.toContain("You asked");
  });

  /*
   * A repository can be connected to more than one OneUptime project, and the
   * run is billed to exactly one of them. Dropping the name is how a team
   * watches its AI budget drain into a project it has never heard of.
   */
  test("names the OneUptime project the run is billed to", () => {
    const body: string = acknowledgeReview({
      instruction: "",
      projectName: "Checkout",
    });

    expect(body).toContain("(project **Checkout**)");
  });

  test("drops the project clause cleanly when no project name is known", () => {
    const body: string = acknowledgeReview({
      instruction: "",
      projectName: undefined,
    });

    expect(body).not.toContain("project");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("()");
    expect(body).toContain(`[Follow along in OneUptime](${RUN_URL}).`);
  });

  test("carries the signature", () => {
    expect(
      acknowledgeReview({ instruction: "", projectName: "Checkout" }).endsWith(
        SIGNATURE,
      ),
    ).toBe(true);
  });
});

describe("completed", () => {
  function completedImplement(resultLines: Array<string>): string {
    return GitHubReplyComposer.completed({
      commandType: GitHubCommandType.Implement,
      runUrl: RUN_URL,
      resultLines: resultLines,
    });
  }

  test("leads with a done marker and names what it finished", () => {
    expect(completedImplement(["Opened #42."])).toContain(
      "✅ **Done** — working on this issue.",
    );
  });

  /*
   * "Done" with no artefact is not an answer — the reader needs the pull
   * request link, the commit count or the review link to act on.
   */
  test("prints every result line on a line of its own", () => {
    const lines: Array<string> = completedImplement([
      "Opened https://github.com/acme/checkout/pull/42",
      "It closes this issue when merged.",
    ]).split("\n");

    expect(lines).toContain("Opened https://github.com/acme/checkout/pull/42");
    expect(lines).toContain("It closes this issue when merged.");
  });

  test("still links the run and signs itself when there are no result lines", () => {
    const body: string = completedImplement([]);

    expect(body).toContain(`[View the full run in OneUptime](${RUN_URL}).`);
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });

  /*
   * The product rule for Review: the app posts a review as a COMMENT and never
   * approves. A completion notice that says "approved" or "merged" tells the
   * reader something that did not happen.
   */
  test("reports a finished review as a review, never as an approval or a merge", () => {
    const body: string = GitHubReplyComposer.completed({
      commandType: GitHubCommandType.Review,
      runUrl: RUN_URL,
      resultLines: ["Left 3 comments on the diff."],
    });

    expect(body).toContain("reviewing this pull request");
    expect(body.toLowerCase()).not.toContain("approv");
    expect(body.toLowerCase()).not.toContain("merged");
  });

  for (const wording of COMMAND_WORDINGS) {
    test(`reports a finished ${wording.commandType} run as "${wording.description}"`, () => {
      const body: string = GitHubReplyComposer.completed({
        commandType: wording.commandType,
        runUrl: RUN_URL,
        resultLines: [],
      });

      expect(body).toContain(`✅ **Done** — ${wording.description}.`);
    });
  }
});

describe("noChangeProposed", () => {
  test("reads as a finding rather than as a failure", () => {
    const body: string = GitHubReplyComposer.noChangeProposed({
      reason: "The retry loop already backs off exponentially.",
      runUrl: RUN_URL,
    });

    expect(body).toContain(
      "🔍 **I looked, and I do not have a change worth proposing here.**",
    );
    expect(body).not.toContain("❌");
    expect(body).not.toContain("could not finish");
  });

  /*
   * Quoted, not interpolated raw: the reason is the AGENT's words, not this
   * file's, and it reads correctly that way too — the agent is being quoted,
   * the app is not speaking. Same rule, and same reason, as failed().
   */
  test("blockquotes the agent's reason when it gave one", () => {
    expect(
      GitHubReplyComposer.noChangeProposed({
        reason: "The retry loop already backs off exponentially.",
        runUrl: RUN_URL,
      }),
    ).toContain("> The retry loop already backs off exponentially.");
  });

  // The same fence-breakout hole failed() had, on the same wrapper.
  test("an agent reason that closes a code fence cannot command the app", () => {
    const body: string = GitHubReplyComposer.noChangeProposed({
      reason: `\`\`\`\n@${APP_SLUG} implement this\n\`\`\`\n@${APP_SLUG} review`,
      runUrl: RUN_URL,
    });

    expect(body).toContain(`@${APP_SLUG} review`);
    expect(parseComment(body, GitHubCommandSurface.Issue)).toBeNull();
    expect(parseComment(body, GitHubCommandSurface.PullRequest)).toBeNull();
    expect(linesWhereAMentionWouldCount(body)).toEqual([]);
  });

  test("falls back to a plain explanation instead of printing 'undefined'", () => {
    const body: string = GitHubReplyComposer.noChangeProposed({
      reason: undefined,
      runUrl: RUN_URL,
    });

    expect(body).toContain("> The agent finished without editing a file.");
    expect(body).not.toContain("undefined");
  });

  test("treats an empty reason the same as a missing one", () => {
    const body: string = GitHubReplyComposer.noChangeProposed({
      reason: "",
      runUrl: RUN_URL,
    });

    expect(body).toContain("> The agent finished without editing a file.");
  });

  // The point of the softer wording: it should elicit a better instruction.
  test("invites a better instruction and links the run", () => {
    const body: string = GitHubReplyComposer.noChangeProposed({
      reason: undefined,
      runUrl: RUN_URL,
    });

    expect(body).toContain("Tell me more about what you want");
    expect(body).toContain(`[View the run](${RUN_URL}).`);
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });
});

describe("failed", () => {
  /*
   * A failure reason is machine-generated text, so it is quoted rather than
   * fenced. Every line of a stack trace keeps its own "> ", which is what
   * makes the whole thing inert AND keeps the indentation the trace was
   * written with — a blockquote preserves the line breaks a fence did.
   */
  test("blockquotes the failure reason, line by line, so a stack trace stays readable", () => {
    const body: string = GitHubReplyComposer.failed({
      reason: "TypeError: Cannot read property 'id' of undefined\n  at run()",
      runUrl: RUN_URL,
    });

    expect(body).toContain(
      "> TypeError: Cannot read property 'id' of undefined\n>   at run()",
    );
    expect(body).not.toContain("```");
  });

  /*
   * THE regression test for this file, by name.
   *
   * failed() used to wrap the reason in a ``` fence. A reason carrying its own
   * ``` closed that wrapper on the second line, and everything after it landed
   * in the comment as LIVE markdown — here, a bare "@oneuptime cancel" in a
   * comment this app posts on a thread this app watches. That is the comment
   * loop the whole file exists to prevent, and it was reachable from any agent
   * error message that happened to echo a fenced snippet back.
   *
   * A blockquote has no closing token an input can reach: the "> " goes on
   * every line, including the ones that look like fences.
   */
  test("a reason that closes a code fence cannot break out and command the app", () => {
    const body: string = GitHubReplyComposer.failed({
      reason: `\`\`\`\n@${APP_SLUG} review\n\`\`\`\n@${APP_SLUG} cancel`,
      runUrl: RUN_URL,
    });

    // The hostile text really is echoed — otherwise the parses prove nothing.
    expect(body).toContain(`@${APP_SLUG} cancel`);

    expect(parseComment(body, GitHubCommandSurface.PullRequest)).toBeNull();
    expect(parseComment(body, GitHubCommandSurface.Issue)).toBeNull();

    // And structurally, not just by the parser's current reading of it.
    expect(linesWhereAMentionWouldCount(body)).toEqual([]);
    for (const line of body.split("\n")) {
      if (line.includes(`@${APP_SLUG}`)) {
        expect(line.startsWith("> ")).toBe(true);
      }
    }
  });

  /*
   * `undefined` must drop the reason block entirely rather than emit an empty
   * quote — a lone "> " renders as a grey bar with nothing in it, and the
   * reader assumes output was lost.
   */
  test("emits no reason block at all when there is no reason", () => {
    const body: string = GitHubReplyComposer.failed({
      reason: undefined,
      runUrl: RUN_URL,
    });

    expect(body).not.toContain("```");
    expect(body).not.toContain("undefined");
    expect(body).toContain("❌ **I could not finish this one.**");

    for (const line of body.split("\n")) {
      expect(line.startsWith(">")).toBe(false);
    }
  });

  test("emits no reason block for an empty-string reason either", () => {
    const body: string = GitHubReplyComposer.failed({
      reason: "",
      runUrl: RUN_URL,
    });

    expect(body).not.toContain("```");

    for (const line of body.split("\n")) {
      expect(line.startsWith(">")).toBe(false);
    }
  });

  test("always points at the run log, with or without a reason", () => {
    const withReason: string = GitHubReplyComposer.failed({
      reason: "boom",
      runUrl: RUN_URL,
    });
    const withoutReason: string = GitHubReplyComposer.failed({
      reason: undefined,
      runUrl: RUN_URL,
    });

    expect(withReason).toContain(
      `[View the run in OneUptime](${RUN_URL}) for the full log.`,
    );
    expect(withoutReason).toContain(
      `[View the run in OneUptime](${RUN_URL}) for the full log.`,
    );
    expect(withReason.endsWith(SIGNATURE)).toBe(true);
    expect(withoutReason.endsWith(SIGNATURE)).toBe(true);
  });

  /*
   * Agent errors routinely echo the comment that started the run, so this is
   * the realistic loop: fail -> post the error -> the error mentions the app.
   * The blockquote is what keeps it inert.
   */
  test("an error message that echoes the user's mention cannot re-trigger the app", () => {
    const body: string = GitHubReplyComposer.failed({
      reason: `Agent aborted while handling "@${APP_SLUG} revise this".`,
      runUrl: RUN_URL,
    });

    expect(body).toContain(`@${APP_SLUG} revise this`);
    expect(body).toContain(
      `> Agent aborted while handling "@${APP_SLUG} revise this".`,
    );
    expect(parseComment(body, GitHubCommandSurface.PullRequest)).toBeNull();
    expect(parseComment(body, GitHubCommandSurface.Issue)).toBeNull();
  });
});

describe("cancelled", () => {
  test("does not claim to have cancelled anything when nothing was running", () => {
    const body: string = GitHubReplyComposer.cancelled({ cancelledCount: 0 });

    expect(body).toContain(
      "🛑 Nothing of mine is running on this thread right now.",
    );
    expect(body).not.toContain("Cancelled");
    expect(body).not.toContain("0 run");
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });

  test("uses the singular for exactly one run", () => {
    const body: string = GitHubReplyComposer.cancelled({ cancelledCount: 1 });

    expect(body).toContain("🛑 **Cancelled** 1 run on this thread.");
    expect(body).not.toContain("1 runs");
  });

  test("uses the plural for more than one run", () => {
    expect(GitHubReplyComposer.cancelled({ cancelledCount: 2 })).toContain(
      "🛑 **Cancelled** 2 runs on this thread.",
    );
    expect(GitHubReplyComposer.cancelled({ cancelledCount: 11 })).toContain(
      "🛑 **Cancelled** 11 runs on this thread.",
    );
  });

  /*
   * Revise pushes commits to the user's own head branch. A cancel notice that
   * let the reader believe those commits were rolled back would leave them
   * merging code nobody re-checked.
   */
  test("is explicit that cancelling does not undo commits already pushed", () => {
    const body: string = GitHubReplyComposer.cancelled({ cancelledCount: 1 });

    expect(body).toContain("Work already pushed stays pushed");
    expect(body).toContain("it does not undo what happened");
  });

  test("does not talk about pushed work when there was nothing to cancel", () => {
    expect(GitHubReplyComposer.cancelled({ cancelledCount: 0 })).not.toContain(
      "Work already pushed",
    );
  });

  /*
   * The count is a subtraction between two database reads, so a negative is a
   * bug upstream — but the comment is what the user sees, and "Cancelled -1
   * runs on this thread." is worse than saying nothing was running. The guard
   * is `<= 0` rather than `=== 0` for exactly that.
   */
  test("reads a negative count as nothing running rather than printing it", () => {
    const body: string = GitHubReplyComposer.cancelled({ cancelledCount: -1 });

    expect(body).toContain(
      "🛑 Nothing of mine is running on this thread right now.",
    );
    expect(body).not.toContain("-1");
    expect(body).not.toContain("Cancelled");
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });
});

/*
 * cancelledRun() closes out ONE run's own acknowledgement comment; cancelled()
 * answers the person who typed "@oneuptime cancel" and counts what that
 * command stopped across the whole thread. They were the same string once, and
 * cancelling three runs then produced three separate comments each announcing
 * that it had cancelled "1 run on this thread" — a reader counting comments
 * would think nine runs had been stopped.
 */
describe("cancelledRun", () => {
  const body: string = GitHubReplyComposer.cancelledRun({ runUrl: RUN_URL });

  test("speaks about this one run, and claims no thread-wide count", () => {
    expect(body).toContain("🛑 **Cancelled** before this finished.");
    expect(body).not.toContain("run on this thread");
    expect(body).not.toContain("runs on this thread");
  });

  /*
   * Revise pushes commits to the user's own head branch, so this warning has
   * to survive on BOTH cancel messages — the run's own comment is the one a
   * reader lands on from the run link, and often the only one they read.
   */
  test("keeps the warning that cancelling does not undo pushed commits", () => {
    expect(body).toContain("Anything already pushed stays pushed");
    expect(body).toContain("it does not undo what happened");
  });

  test("links the run so the reader can see how far it got, and signs itself", () => {
    expect(body).toContain(`[See how far it got](${RUN_URL}).`);
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });

  test("does not read as a failure — cancelling is something a user chose", () => {
    expect(body).not.toContain("❌");
    expect(body).not.toContain("could not finish");
  });
});

describe("status", () => {
  test("says plainly that it is idle, and offers no run list to click", () => {
    const body: string = GitHubReplyComposer.status({
      runDescriptions: [],
      runUrlBase: RUN_URL_BASE,
    });

    expect(body).toContain(
      "💤 I am not working on anything in this thread right now.",
    );
    expect(body).not.toContain(RUN_URL_BASE);
    expect(body).not.toContain("\n- ");
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });

  test("bullets every in-flight run and links the project's run list", () => {
    const body: string = GitHubReplyComposer.status({
      runDescriptions: [
        "Revise on #42, started 2 minutes ago",
        "Review on #43, queued",
      ],
      runUrlBase: RUN_URL_BASE,
    });
    const lines: Array<string> = body.split("\n");

    expect(body).toContain("⏳ **Currently working on this thread:**");
    expect(lines).toContain("- Revise on #42, started 2 minutes ago");
    expect(lines).toContain("- Review on #43, queued");
    expect(body).toContain(`[All runs for this project](${RUN_URL_BASE}).`);
  });

  test("never shows the idle message while work is in flight", () => {
    expect(
      GitHubReplyComposer.status({
        runDescriptions: ["Review on #43, queued"],
        runUrlBase: RUN_URL_BASE,
      }),
    ).not.toContain("I am not working on anything");
  });

  test("lists a single run without pluralising it into a summary", () => {
    const lines: Array<string> = GitHubReplyComposer.status({
      runDescriptions: ["Implement on #7, started just now"],
      runUrlBase: RUN_URL_BASE,
    }).split("\n");

    expect(lines).toContain("- Implement on #7, started just now");
  });
});

describe("refusal", () => {
  /*
   * Silence is the one response that is never acceptable to a user whose
   * command did nothing — the integration just reads as broken. Every refusal
   * therefore has the same shape: a marker sentence in the app's own voice,
   * then the reason QUOTED beneath it, then the signature.
   *
   * The reason is quoted rather than inlined because not every refusal reason
   * is this file's own prose: one of them is a BadDataException message from
   * the enqueue path, and a message that ever grows to include user text would
   * otherwise carry a live mention into a comment this app posts. Splitting
   * the marker onto its own line is what makes the quote possible — a
   * blockquote cannot start mid-sentence.
   */
  test("states the reason and signs the comment, in exactly that shape", () => {
    expect(
      GitHubReplyComposer.refusal({
        reason: "This repository is not connected to a OneUptime project.",
      }),
    ).toBe(
      `🚫 I cannot do that:\n\n> This repository is not connected to a OneUptime project.\n\n${SIGNATURE}`,
    );
  });

  test("keeps the refusal marker so the reader can see it is a refusal", () => {
    const body: string = GitHubReplyComposer.refusal({
      reason: "The fix budget is used up.",
    });

    expect(body.startsWith("🚫 I cannot do that:")).toBe(true);
    expect(body).toContain("> The fix budget is used up.");
  });

  /*
   * The reason that reaches this method can be an exception's text, and an
   * exception's text is exactly where a user-supplied fence and mention ride
   * in. Under the old single-line refusal there was no wrapper at all.
   */
  test("a reason carrying a mention cannot command the app", () => {
    const body: string = GitHubReplyComposer.refusal({
      reason: `I cannot run "@${APP_SLUG} revise this" on a fork.`,
    });

    expect(body).toContain(`@${APP_SLUG} revise this`);
    expect(parseComment(body, GitHubCommandSurface.PullRequest)).toBeNull();
    expect(parseComment(body, GitHubCommandSurface.Issue)).toBeNull();
    expect(linesWhereAMentionWouldCount(body)).toEqual([]);
  });
});

describe("unsupportedOnSurface", () => {
  test("a review asked for on an issue redirects to implement", () => {
    const body: string = GitHubReplyComposer.unsupportedOnSurface({
      commandType: GitHubCommandType.Review,
      appSlug: APP_SLUG,
    });

    expect(body).toContain(
      "I can only review pull requests, and this is an issue.",
    );
    expect(body).toContain("Ask me to implement it instead");
    expect(body).not.toContain("revise");
  });

  /*
   * Review and Revise take different branches of the same sentence. If they
   * collapsed into one, half of these replies would tell the user to run a
   * command they did not ask for.
   */
  test("a revise asked for on an issue says revise, not review", () => {
    const body: string = GitHubReplyComposer.unsupportedOnSurface({
      commandType: GitHubCommandType.Revise,
      appSlug: APP_SLUG,
    });

    expect(body).toContain(
      "I can only revise pull requests, and this is an issue.",
    );
    expect(body).not.toContain("I can only review");
  });

  test("an implement asked for on a pull request redirects to revise or review", () => {
    const body: string = GitHubReplyComposer.unsupportedOnSurface({
      commandType: GitHubCommandType.Implement,
      appSlug: APP_SLUG,
    });

    expect(body).toContain(
      "I can only implement issues, and this is a pull request.",
    );
    expect(body).toContain("Ask me to revise or review it instead.");
  });

  /*
   * Routed through refusal() rather than composed separately, so it picks up
   * that method's shape — and its quoting — for free.
   */
  test("every surface mismatch is delivered as a signed refusal", () => {
    for (const commandType of [
      GitHubCommandType.Review,
      GitHubCommandType.Revise,
      GitHubCommandType.Implement,
    ]) {
      const body: string = GitHubReplyComposer.unsupportedOnSurface({
        commandType: commandType,
        appSlug: APP_SLUG,
      });

      expect(body.startsWith("🚫 I cannot do that:\n\n> ")).toBe(true);
      expect(body.endsWith(`\n\n${SIGNATURE}`)).toBe(true);
    }
  });

  /*
   * The redirect names a command but must not print it as a mention — that is
   * the sentence most likely to grow an "@oneuptime implement this" example.
   */
  test("names the right command without mentioning the app", () => {
    for (const commandType of [
      GitHubCommandType.Review,
      GitHubCommandType.Revise,
      GitHubCommandType.Implement,
    ]) {
      expect(
        GitHubReplyComposer.unsupportedOnSurface({
          commandType: commandType,
          appSlug: APP_SLUG,
        }),
      ).not.toContain(`@${APP_SLUG}`);
    }
  });
});

describe("help", () => {
  const body: string = GitHubReplyComposer.help({ appSlug: APP_SLUG });

  /*
   * Without this, the loop-safety test for help() would pass for the wrong
   * reason: a help text that stopped printing commands is trivially inert and
   * also useless.
   */
  test("really does print every command, mention and all", () => {
    expect(body).toContain(`@${APP_SLUG} review`);
    expect(body).toContain(`@${APP_SLUG} revise this`);
    expect(body).toContain(`@${APP_SLUG} implement this`);
    expect(body).toContain(`@${APP_SLUG} status`);
    expect(body).toContain(`@${APP_SLUG} cancel`);
  });

  /*
   * And this is the mechanism that makes printing them safe. Asserted
   * structurally, line by line, rather than by trusting the parser: a mention
   * on a non-fenced line is the bug, wherever it came from.
   */
  test("keeps every printed mention inside a closed code fence", () => {
    let insideFence: boolean = false;

    for (const line of body.split("\n")) {
      if (line.startsWith("```")) {
        insideFence = !insideFence;
        continue;
      }

      if (!insideFence) {
        expect(line).not.toContain(`@${APP_SLUG}`);
      }
    }

    // An unclosed fence would swallow the rest of the comment when rendered.
    expect(insideFence).toBe(false);
  });

  test("separates the pull request commands from the issue commands", () => {
    expect(body).toContain("On a **pull request**:");
    expect(body).toContain("On an **issue**:");
  });

  /*
   * Assignment and the trigger label are the two ways to start a run that
   * involve typing nothing at all, so help is the only place a user can learn
   * they exist.
   */
  test("documents the triggers that are not comments", () => {
    expect(body).toContain("assign an issue to me");
    expect(body).toContain("trigger label");
  });

  /*
   * The three sentences that set a reader's expectations about what this app
   * can do to their repository. Losing any of them is a real change in what
   * users believe they have installed.
   */
  test("states the boundaries: write access only, no merging, human review", () => {
    expect(body).toContain("write access to this repository");
    expect(body).toContain("I never merge anything");
    expect(body).toContain("for a human to review");
  });

  test("carries the signature", () => {
    expect(body.endsWith(SIGNATURE)).toBe(true);
  });

  /*
   * A GitHub App slug can contain characters that mean something to a regular
   * expression. The parser escapes them; the fencing has to hold for that slug
   * too, or an unusually named installation loops where the default one does
   * not.
   */
  test("stays inert for a slug full of regular-expression metacharacters", () => {
    const oddSlug: string = "one.uptime+ai";
    const oddBody: string = GitHubReplyComposer.help({ appSlug: oddSlug });

    expect(oddBody).toContain(`@${oddSlug} review`);
    expect(
      parseComment(oddBody, GitHubCommandSurface.PullRequest, oddSlug),
    ).toBeNull();
    expect(
      parseComment(oddBody, GitHubCommandSurface.Issue, oddSlug),
    ).toBeNull();
  });
});

/*
 * The footer is how a reader tells an app comment from a human one, and how
 * they learn that replying in-thread is the way to ask for changes. It also
 * has to appear exactly once — a doubled signature means one composer output
 * was nested inside another.
 */
describe("every comment identifies itself", () => {
  for (const sample of everyComposerOutput()) {
    if (sample.method === "quoteInstruction") {
      // A fragment embedded in other comments, not a comment of its own.
      continue;
    }

    test(`${sample.method} (${sample.scenario}) ends with exactly one signature`, () => {
      expect(sample.body.endsWith(SIGNATURE)).toBe(true);
      expect(sample.body.split(SIGNATURE).length - 1).toBe(1);
    });

    /*
     * The blank line matters and used to go missing. acknowledgement() and
     * failed() build their body as an array of parts and drop the optional
     * ones; filtering empty strings out of the WHOLE array took the separator
     * with it, and `<sub>` ran straight on from the previous sentence — GitHub
     * then rendered the footer as part of that paragraph instead of as its own
     * small line. Both now drop only the optional section, never the
     * separator, so the shape is uniform across every method.
     */
    test(`${sample.method} (${sample.scenario}) leaves a blank line before the signature`, () => {
      expect(sample.body.endsWith(`\n\n${SIGNATURE}`)).toBe(true);
    });
  }

  test("the signature says who posted it and how to reply", () => {
    expect(SIGNATURE).toContain("Posted by OneUptime");
    expect(SIGNATURE).toContain("Reply in this thread");
  });

  test("quoteInstruction is a fragment and adds no signature of its own", () => {
    expect(
      GitHubReplyComposer.quoteInstruction("please back off exponentially"),
    ).not.toContain(SIGNATURE);
  });
});
