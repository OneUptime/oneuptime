import GitHubCommandType, {
  GitHubCommand,
  GitHubCommandSurface,
} from "../../../../Types/CodeRepository/GitHubCommand";

/*
 * Named rather than inlined at the call sites: eslint's wrap-regex wants a
 * regex literal that is the receiver of a method call wrapped in parentheses,
 * and prettier removes those parentheses again — a fix loop with no fixed
 * point. A named constant satisfies both, and reads better anyway.
 */
// A markdown blockquote line, including GitHub's nested "> >" quote-replies.
const BLOCKQUOTE_LINE: RegExp = /^[ \t]*>/;
// What may follow a verb for it to count as the whole verb.
const VERB_TERMINATOR: RegExp = /^[\s:,.!?]/;
// Whether an instruction contains a word at all.
const ALPHANUMERIC: RegExp = /[A-Za-z0-9]/;

/*
 * One comment, in two index-aligned forms: `original` as the author wrote it
 * (minus quotes and fenced blocks), and `searchable` with inline code blanked
 * out to the same width. Mentions are found in `searchable`; the instruction
 * is sliced out of `original`.
 */
interface StrippedBody {
  original: string;
  searchable: string;
}

interface VerbPhraseGroup {
  phrases: Array<string>;
  commandType: GitHubCommandType;
}

/*
 * Turns the body of a GitHub issue / pull request comment into a command for
 * the OneUptime app, or into null when the app was not addressed at all.
 *
 * Everything here is a PURE function of (body, appSlug, surface): no IO, no
 * environment reads. That is deliberate — this is the gate that decides
 * whether arbitrary text from a repository is allowed to start a paid agent
 * run, so it has to be exhaustively testable on its own.
 *
 * Three properties matter more than richness of grammar:
 *
 *   1. A mention inside a QUOTE or a CODE BLOCK is not a command. GitHub's
 *      "Quote reply" button copies the parent comment into a `>` block, so
 *      without this every reply to one of the app's own comments would
 *      re-trigger it — a comment loop that spends the project's fix budget.
 *
 *   2. A mention must be a whole word. `@oneuptime-staging` and
 *      `support@oneuptime.com` are not mentions of `@oneuptime`.
 *
 *   3. An unrecognized verb is NOT an error. "@oneuptime the retry loop here
 *      looks wrong" is the most natural way to ask for a revision, so the
 *      surface decides the default: pull request -> Revise, issue ->
 *      Implement. Only an EMPTY mention falls back to Help.
 */
export default class GitHubCommandParser {
  /*
   * Remove every region a mention must not count in, in the order they nest:
   * fenced code blocks (which may themselves contain `>` lines and backticks),
   * then inline code spans, then blockquotes.
   *
   * Fences are scanned line by line rather than with one regex: an UNCLOSED
   * fence has to swallow the rest of the comment, and expressing that with a
   * lazy quantifier and an end-of-input alternative is exactly the kind of
   * subtlety that silently stops working.
   */
  private static stripNonCommandRegions(body: string): StrippedBody {
    const lines: Array<string> = body.split("\n");
    const original: Array<string> = [];
    const searchable: Array<string> = [];

    let openFence: string | null = null;

    for (const line of lines) {
      const fence: RegExpMatchArray | null = line.match(/^[ \t]*(```+|~~~+)/);

      if (openFence) {
        /*
         * Inside a fence: only a closing fence of the SAME character and AT
         * LEAST the same length ends it (CommonMark). Comparing only the
         * character would let a ``` line inside a ```` block close it, and
         * everything after would be read as live text — the loop guard
         * failing open on exactly the comment most likely to contain a
         * mention: one showing someone how to use the app.
         */
        if (
          fence &&
          fence[1] &&
          fence[1][0] === openFence[0] &&
          fence[1].length >= openFence.length
        ) {
          openFence = null;
        }
        continue;
      }

      if (fence && fence[1]) {
        openFence = fence[1];
        continue;
      }

      // Blockquotes, including the nested `> >` GitHub writes for quote-replies.
      if (BLOCKQUOTE_LINE.test(line)) {
        continue;
      }

      original.push(line);

      /*
       * Inline code is BLANKED, not removed — replaced by the same number of
       * spaces. Removing it would shift every index after it, and the
       * instruction is sliced out of the ORIGINAL text so that a request like
       * "revise this to use \`Array<T>\`" reaches the agent with the code the
       * person actually typed. Blanking keeps the two strings the same length,
       * so one index means the same place in both.
       */
      searchable.push(
        line.replace(/`[^`\n]*`/g, (match: string): string => {
          return " ".repeat(match.length);
        }),
      );
    }

    return {
      original: original.join("\n"),
      searchable: searchable.join("\n"),
    };
  }

  // Escape a GitHub App slug for safe embedding in a RegExp.
  private static escapeForRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /*
   * Matches `@slug` and `@slug[bot]` where a person actually addressed the app.
   *
   * Both guards are allow-lists rather than deny-lists, because the deny-list
   * versions were wrong in ways that cost real money:
   *
   *   - LEADING. A negated ASCII class let "café@oneuptime.com" through — the
   *     "é" is not an ASCII word character, so the address parsed as a mention
   *     and started a paid run. An address's local part can end in any letter
   *     in any script, so the only sound rule is to name what MAY precede a
   *     mention: nothing (start of text), whitespace, or the punctuation
   *     people actually wrap a mention in.
   *
   *   - TRAILING. `\b` sits happily between "oneuptime" and the "-" of
   *     "@oneuptime-staging", a different account. And a plain
   *     "not a letter or digit" lookahead let "@oneuptime.com is our site"
   *     through. So a following "." is refused only when it starts something
   *     domain-shaped; "thanks @oneuptime." at the end of a sentence is still
   *     a mention.
   */
  private static buildMentionRegExp(appSlug: string): RegExp {
    const slug: string = GitHubCommandParser.escapeForRegExp(appSlug.trim());

    return new RegExp(
      `(^|[\\s(\\[{*_~"'\`])@${slug}(\\[bot\\])?(?![A-Za-z0-9_-])(?!\\.[A-Za-z0-9])`,
      "gi",
    );
  }

  /*
   * Explicit verbs that OVERRIDE the surface default. Longest phrases first so
   * "code review" is not shadowed by "review".
   *
   * Deliberately small. Every phrase here is one a user could not plausibly
   * mean any other way; anything ambiguous ("fix this", "sort this out") is
   * better served by the surface default than by a guess.
   */
  private static readonly verbPhrases: Array<VerbPhraseGroup> = [
    {
      phrases: [
        "code review",
        "please review",
        "can you review",
        "review this",
        "review",
      ],
      commandType: GitHubCommandType.Review,
    },
    {
      phrases: [
        "please revise",
        "revise this",
        "revise",
        "rework this",
        "rework",
        "redo this",
        "redo",
      ],
      commandType: GitHubCommandType.Revise,
    },
    {
      phrases: [
        "please implement",
        "implement this",
        "implement",
        "work on this",
        "work on it",
        "pick this up",
        "take this",
      ],
      commandType: GitHubCommandType.Implement,
    },
    {
      phrases: ["what can you do", "commands", "usage", "help"],
      commandType: GitHubCommandType.Help,
    },
    {
      phrases: ["status", "progress"],
      commandType: GitHubCommandType.Status,
    },
    {
      phrases: ["cancel", "stop", "abort"],
      commandType: GitHubCommandType.Cancel,
    },
  ];

  /*
   * The verb is only recognized at the START of the instruction. "@oneuptime
   * the reviewer asked for X" must not be read as a Review command just
   * because the word appears somewhere in it.
   */
  private static matchVerb(instruction: string): GitHubCommandType | null {
    const normalized: string = instruction
      .toLowerCase()
      .replace(/^[\s:,.!?-]+/, "");

    for (const entry of GitHubCommandParser.verbPhrases) {
      for (const phrase of entry.phrases) {
        if (normalized === phrase) {
          return entry.commandType;
        }

        if (
          normalized.startsWith(phrase) &&
          VERB_TERMINATOR.test(normalized.slice(phrase.length))
        ) {
          return entry.commandType;
        }
      }
    }

    return null;
  }

  private static defaultCommandFor(
    surface: GitHubCommandSurface,
  ): GitHubCommandType {
    return surface === GitHubCommandSurface.PullRequest
      ? GitHubCommandType.Revise
      : GitHubCommandType.Implement;
  }

  /*
   * Whether a candidate instruction says anything at all.
   *
   * "@mention 👍" and "@mention !!" are not requests to start work, but they
   * are not empty strings either, so a bare truthiness check sent them to the
   * surface default and spent a full agent run on a thumbs-up. A command needs
   * a word in it.
   */
  private static hasSubstance(instruction: string): boolean {
    return ALPHANUMERIC.test(instruction);
  }

  /*
   * Returns null when the app was not mentioned in a commandable position —
   * the overwhelmingly common case, since this runs on every comment in every
   * connected repository.
   *
   * Every mention is considered, not just the first. A comment that mentions
   * the app in passing and THEN gives it an order — "@oneuptime[bot] said it
   * was flaky, so @oneuptime review this again" — is ordinary English, and
   * reading only the first mention turns the order into part of an
   * instruction string nobody wrote. So: the first mention followed by a
   * recognized verb wins; failing that, the first mention that says anything
   * at all; failing that, Help.
   */
  public static parse(data: {
    body: string | null | undefined;
    appSlug: string | null | undefined;
    surface: GitHubCommandSurface;
  }): GitHubCommand | null {
    if (!data.body || !data.appSlug || !data.appSlug.trim()) {
      return null;
    }

    const stripped: StrippedBody = GitHubCommandParser.stripNonCommandRegions(
      data.body,
    );

    const mentionRegExp: RegExp = GitHubCommandParser.buildMentionRegExp(
      data.appSlug,
    );

    let sawMention: boolean = false;
    let firstSubstantive: GitHubCommand | null = null;
    let mention: RegExpExecArray | null = null;

    while ((mention = mentionRegExp.exec(stripped.searchable)) !== null) {
      sawMention = true;

      /*
       * Sliced out of the ORIGINAL text at the same index — see
       * stripNonCommandRegions for why the two strings stay index-aligned.
       */
      const instruction: string = stripped.original
        .slice(mention.index + mention[0].length)
        .trim();

      if (!GitHubCommandParser.hasSubstance(instruction)) {
        continue;
      }

      const verb: GitHubCommandType | null =
        GitHubCommandParser.matchVerb(instruction);

      if (verb) {
        return { commandType: verb, instruction: instruction };
      }

      if (!firstSubstantive) {
        firstSubstantive = {
          commandType: GitHubCommandParser.defaultCommandFor(data.surface),
          instruction: instruction,
        };
      }
    }

    if (firstSubstantive) {
      return firstSubstantive;
    }

    if (sawMention) {
      /*
       * A mention with nothing to act on — bare, or only punctuation. A
       * request for orientation, not a licence to start work on whatever the
       * thread happens to be about.
       */
      return { commandType: GitHubCommandType.Help, instruction: "" };
    }

    return null;
  }

  /*
   * Whether a command can be carried out on the surface it was written on.
   * Kept beside the grammar so the two cannot drift: a Review on an issue and
   * an Implement on a pull request are both real user mistakes that deserve a
   * helpful reply rather than a silently dropped comment.
   */
  public static isSupportedOnSurface(data: {
    commandType: GitHubCommandType;
    surface: GitHubCommandSurface;
  }): boolean {
    if (
      data.commandType === GitHubCommandType.Review ||
      data.commandType === GitHubCommandType.Revise
    ) {
      return data.surface === GitHubCommandSurface.PullRequest;
    }

    if (data.commandType === GitHubCommandType.Implement) {
      return data.surface === GitHubCommandSurface.Issue;
    }

    return true;
  }
}
