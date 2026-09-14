import GitHubCommandType from "../../../../Types/CodeRepository/GitHubCommand";

/*
 * Every comment the OneUptime app writes into a GitHub thread.
 *
 * Pure string building, deliberately: these are the only words most users will
 * ever see from this integration, and a test can pin them without a GitHub
 * account, a database or a network.
 *
 * One rule holds throughout, and it is a safety rule rather than a style one:
 * NOTHING this file emits may contain a LIVE "@" mention of the app. Its own
 * comments come back as webhooks, and although the sender check in
 * GitHubCommandAuthorizer stops a bot comment before it is ever acted on, that
 * is one guard, and a self-mention in a status update is a comment loop that
 * bills the project until somebody notices.
 *
 * So every string that did not originate in this file — an agent's failure
 * message, a user's instruction, an exception's text — is passed through
 * quoteInstruction() before it is interpolated. A blockquote is the one
 * wrapper the parser provably ignores and that has no closing token an input
 * can break; a code fence is not (a reason containing ``` closes it early and
 * spills live markdown into the comment). Where the help text has to SHOW a
 * command it uses a fence, because that text is ours and cannot contain a
 * surprise.
 *
 * The composer's test file pins this end to end: every public method is run
 * through GitHubCommandParser.parse() and must yield no command.
 */

// Ends every comment, so a reader can always tell what wrote it and why.
const SIGNATURE: string =
  "<sub>Posted by OneUptime. Reply in this thread to ask for changes.</sub>";

// A quoted instruction is untrusted text; keep it short and clearly quoted.
const MAX_QUOTED_INSTRUCTION_LENGTH: number = 500;

export default class GitHubReplyComposer {
  /*
   * Quote untrusted comment text as a markdown blockquote.
   *
   * Blockquoting is not decoration. The parser ignores mentions inside `>`
   * lines, so echoing a user's instruction back verbatim — which may itself
   * contain a mention of this app — cannot re-trigger it.
   */
  public static quoteInstruction(instruction: string): string {
    const trimmed: string = instruction.trim();

    if (!trimmed) {
      return "";
    }

    /*
     * Clipped by CODE POINT, not by UTF-16 unit. substring() splits surrogate
     * pairs, so a comment ending in emoji got a lone high surrogate that
     * GitHub renders as a replacement character — the app quoting someone
     * back with visible corruption in their own words.
     */
    const codePoints: Array<string> = Array.from(trimmed);

    const clipped: string =
      codePoints.length > MAX_QUOTED_INSTRUCTION_LENGTH
        ? `${codePoints.slice(0, MAX_QUOTED_INSTRUCTION_LENGTH - 1).join("")}…`
        : trimmed;

    return clipped
      .split("\n")
      .map((line: string) => {
        return `> ${line}`;
      })
      .join("\n");
  }

  private static describeCommand(commandType: GitHubCommandType): string {
    switch (commandType) {
      case GitHubCommandType.Review:
        return "reviewing this pull request";
      case GitHubCommandType.Revise:
        return "revising this pull request";
      case GitHubCommandType.Implement:
        return "working on this issue";
      default:
        return "on it";
    }
  }

  public static acknowledgement(data: {
    commandType: GitHubCommandType;
    runUrl: string;
    instruction: string;
    /*
     * The OneUptime project this run is billed to. Named explicitly because a
     * repository can be connected to more than one project and the app acts
     * for exactly one of them — without saying which, a team can watch their
     * AI budget drain into a project they have never heard of.
     */
    projectName: string | undefined;
  }): string {
    const quoted: string = GitHubReplyComposer.quoteInstruction(
      data.instruction,
    );

    /*
     * The optional section is dropped BEFORE the blank line that separates the
     * body from the signature is appended. Filtering empty strings out of the
     * whole array would take that separator with it, and the signature would
     * run straight on from the last sentence.
     */
    const parts: Array<string> = [
      `🤖 **On it** — ${GitHubReplyComposer.describeCommand(data.commandType)}.`,
    ];

    if (quoted) {
      parts.push(`\nYou asked:\n${quoted}`);
    }

    parts.push(
      `\nI will update this comment when I am done. [Follow along in OneUptime](${data.runUrl})${
        data.projectName ? ` (project **${data.projectName}**)` : ""
      }.`,
    );

    return [...parts, "", SIGNATURE].join("\n");
  }

  /*
   * The run finished and produced something. `resultLines` are the concrete
   * artefacts — a pull request link, a count of pushed commits, a link to the
   * review — because "done" without an artefact is not an answer.
   */
  public static completed(data: {
    commandType: GitHubCommandType;
    runUrl: string;
    /*
     * COMPOSER-CONTROLLED, and it has to stay that way: these lines are
     * interpolated raw. Their only writer is GitHubRunReply.buildResultLines,
     * which builds them from fixed phrases, pull request numbers and pull
     * request URLs. Anything sourced from a person or a model belongs in
     * quoteInstruction, not here.
     */
    resultLines: Array<string>;
  }): string {
    return [
      `✅ **Done** — ${GitHubReplyComposer.describeCommand(data.commandType)}.`,
      "",
      ...data.resultLines,
      "",
      `[View the full run in OneUptime](${data.runUrl}).`,
      "",
      SIGNATURE,
    ].join("\n");
  }

  /*
   * The run completed and concluded there was nothing to change. Worded as a
   * finding rather than a failure, because that is what it is — and because a
   * user who reads "failed" retries, while a user who reads "found nothing"
   * gives the agent better instructions instead.
   */
  public static noChangeProposed(data: {
    reason: string | undefined;
    runUrl: string;
  }): string {
    /*
     * The reason is the AGENT's own words, so it is quoted rather than
     * interpolated raw — see the note at the top of this file. A blockquote is
     * the one wrapper the parser provably ignores, and it also reads correctly:
     * this is the agent being quoted, not the app speaking.
     */
    const quotedReason: string = GitHubReplyComposer.quoteInstruction(
      data.reason || "The agent finished without editing a file.",
    );

    return [
      "🔍 **I looked, and I do not have a change worth proposing here.**",
      "",
      quotedReason,
      "",
      `Tell me more about what you want and I will try again. [View the run](${data.runUrl}).`,
      "",
      SIGNATURE,
    ].join("\n");
  }

  public static failed(data: {
    reason: string | undefined;
    runUrl: string;
  }): string {
    /*
     * Quoted, not fenced. A failure reason is machine-generated text that can
     * contain anything — including a ``` of its own, which closed the wrapper
     * early and put whatever followed into the comment as live markdown. A
     * blockquote has no closing token to break, and the parser ignores every
     * line of it.
     */
    const parts: Array<string> = ["❌ **I could not finish this one.**", ""];

    if (data.reason) {
      parts.push(GitHubReplyComposer.quoteInstruction(data.reason), "");
    }

    parts.push(
      `[View the run in OneUptime](${data.runUrl}) for the full log.`,
      "",
      SIGNATURE,
    );

    return parts.join("\n");
  }

  public static cancelled(data: { cancelledCount: number }): string {
    if (data.cancelledCount <= 0) {
      return [
        "🛑 Nothing of mine is running on this thread right now.",
        "",
        SIGNATURE,
      ].join("\n");
    }

    return [
      `🛑 **Cancelled** ${data.cancelledCount} run${
        data.cancelledCount === 1 ? "" : "s"
      } on this thread.`,
      "",
      "Work already pushed stays pushed — cancelling stops what comes next, it does not undo what happened.",
      "",
      SIGNATURE,
    ].join("\n");
  }

  /*
   * Commands are shown inside a fenced block on purpose — see the note at the
   * top of this file. The fence is what makes it safe to print a mention of
   * this app in a comment this app posts.
   */
  /*
   * One run's own acknowledgement, closed out because it was cancelled.
   *
   * Distinct from cancelled() above, which answers the person who typed the
   * command and counts what it stopped across the whole thread. Each cancelled
   * run edits its OWN comment, so a thread-wide count repeated three times
   * would be three comments each claiming there was one.
   */
  public static cancelledRun(data: { runUrl: string }): string {
    return [
      "🛑 **Cancelled** before this finished.",
      "",
      "Anything already pushed stays pushed — cancelling stops what comes next, it does not undo what happened.",
      "",
      `[See how far it got](${data.runUrl}).`,
      "",
      SIGNATURE,
    ].join("\n");
  }

  public static help(data: { appSlug: string }): string {
    return [
      "👋 **Here is what you can ask me to do.**",
      "",
      "On a **pull request**:",
      "",
      "```text",
      `@${data.appSlug} review`,
      `@${data.appSlug} revise this — the retry loop should back off exponentially`,
      "```",
      "",
      "On an **issue**:",
      "",
      "```text",
      `@${data.appSlug} implement this`,
      `@${data.appSlug} fix this, but keep the public API unchanged`,
      "```",
      "",
      "Anywhere:",
      "",
      "```text",
      `@${data.appSlug} status`,
      `@${data.appSlug} cancel`,
      "```",
      "",
      "You can also assign an issue to me, or add the repository's OneUptime trigger label to it, and I will pick it up.",
      "",
      "A few things worth knowing: I only take commands from people with write access to this repository, I never merge anything, and I open pull requests for a human to review.",
      "",
      SIGNATURE,
    ].join("\n");
  }

  public static status(data: {
    // Composer-controlled, like completed()'s resultLines — see the note there.
    runDescriptions: Array<string>;
    runUrlBase: string;
  }): string {
    if (data.runDescriptions.length === 0) {
      return [
        "💤 I am not working on anything in this thread right now.",
        "",
        SIGNATURE,
      ].join("\n");
    }

    return [
      "⏳ **Currently working on this thread:**",
      "",
      ...data.runDescriptions.map((description: string) => {
        return `- ${description}`;
      }),
      "",
      `[All runs for this project](${data.runUrlBase}).`,
      "",
      SIGNATURE,
    ].join("\n");
  }

  /*
   * Every refusal. Deliberately one shape: a user whose command did nothing
   * needs to know WHY in the thread they typed it, or the integration reads as
   * broken. Silence is the one response that is never acceptable here — with
   * the single exception of a command from someone without write access to the
   * repository, which the caller does not reply to at all (see
   * GitHubCommandAuthorizer: replying would turn the app into an
   * unauthenticated comment-poster for anyone with a GitHub account).
   */
  public static refusal(data: { reason: string }): string {
    /*
     * Refusal reasons are usually this app's own sentences, but one of them is
     * a BadDataException message from the enqueue path — and a message that
     * ever grows to include user text would otherwise carry a live mention
     * into a comment this app posts. Quoting costs one line of markdown and
     * removes the question.
     */
    return [
      "🚫 I cannot do that:",
      "",
      GitHubReplyComposer.quoteInstruction(data.reason),
      "",
      SIGNATURE,
    ].join("\n");
  }

  public static unsupportedOnSurface(data: {
    commandType: GitHubCommandType;
    appSlug: string;
  }): string {
    if (
      data.commandType === GitHubCommandType.Review ||
      data.commandType === GitHubCommandType.Revise
    ) {
      return GitHubReplyComposer.refusal({
        reason: `I can only ${
          data.commandType === GitHubCommandType.Review ? "review" : "revise"
        } pull requests, and this is an issue. Ask me to implement it instead, or run that command on a pull request.`,
      });
    }

    return GitHubReplyComposer.refusal({
      reason:
        "I can only implement issues, and this is a pull request. Ask me to revise or review it instead.",
    });
  }
}
