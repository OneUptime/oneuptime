import BadDataException from "../../../../Types/Exception/BadDataException";
import path from "path";

/*
 * Pure guards for the in-house code agent's workspace tools (B4 Tier 0,
 * Internal/Roadmap/CodeFixSandboxDesign.md): every file-system tool call is
 * path-guarded to the run's ephemeral workspace (the same escape posture as
 * WorkspaceManager.deleteWorkspace's base-directory check), and every tool
 * output is truncated before it re-enters the model context. Kept pure —
 * no IO — so the worker's safety edges are directly unit-testable.
 */

// Max characters a single tool result may feed back into the model.
export const MAX_TOOL_OUTPUT_CHARS: number = 20_000;

/*
 * Max characters a single write_file may put on disk. A model that loops on
 * a generation bug can otherwise fill the Runner's disk from inside a tool
 * call, taking down every other capability on the host — and no legitimate
 * source file a fix needs to write is anywhere near this size.
 */
export const MAX_WRITE_FILE_CHARS: number = 2_000_000;

/*
 * Git subcommands the code agent may not run.
 *
 * The pipeline owns the repository's git state: it cuts the branch, decides
 * what to stage, writes the commit and pushes. It also computes "what did
 * the agent change" from the working tree. A model that helpfully commits
 * its own work, resets the tree, switches branches or pushes therefore does
 * not just duplicate the pipeline — it destroys the pipeline's ability to
 * see the change at all (a committed tree is a clean tree, so the run
 * reports "no changes" and the fix is silently discarded), or it puts a
 * branch on the customer's remote that no pull request points at.
 *
 * The system prompt already asks the model not to. This is the enforcement,
 * because an instruction is not a control.
 *
 * Honest about what this is: a guard against a well-meaning model taking an
 * obvious wrong turn, NOT a sandbox. Shell is too expressive to filter
 * adversarially — the real containment boundary is that the workspace is
 * ephemeral, the credential is never in it, and nothing merges without a
 * human. Read-only git (log, diff, status, show, grep, blame) stays
 * available because the agent genuinely needs it.
 */
const REFUSED_GIT_SUBCOMMANDS: Set<string> = new Set<string>([
  "push",
  "commit",
  "reset",
  "checkout",
  "switch",
  "restore",
  "stash",
  "clean",
  "rebase",
  "merge",
  "cherry-pick",
  "revert",
  "am",
  "apply",
  "filter-branch",
  "update-ref",
  "remote",
  "config",
  "credential",
  "gc",
  "prune",
]);

/*
 * Shell operators that start a new command. Splitting on these is what lets
 * the guard see the `git push` in `npm test && git push`.
 */
const COMMAND_SEPARATORS: RegExp = /(?:&&|\|\||[;\n|&()`]|\$\()/;

// A leading `VAR=value` assignment, which belongs to the command not to argv.
const LEADING_ENV_ASSIGNMENT: RegExp = /^[A-Za-z_][A-Za-z0-9_]*=/;

/*
 * Options that take a separate value argument, so the subcommand is the
 * token after next rather than the next token (`git -C sub push`).
 */
const GIT_OPTIONS_WITH_VALUE: Set<string> = new Set<string>([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
]);

export interface CommandGuardDecision {
  allowed: boolean;
  // Set when not allowed — the message handed back to the model.
  reason: string | null;
}

export default class CodeAgentWorkspaceGuard {
  /*
   * Resolve a model-supplied path against the workspace root, refusing any
   * escape: `..` traversal, absolute paths outside the workspace, and
   * sibling-prefix tricks (`/workspace-evil` vs `/workspace`) all throw.
   * Absolute paths INSIDE the workspace are allowed — models frequently
   * echo back the absolute paths they were shown.
   */
  public static resolveWorkspacePath(
    workspaceRoot: string,
    requestedPath: string,
  ): string {
    if (!requestedPath || typeof requestedPath !== "string") {
      throw new BadDataException("A file path is required");
    }

    const root: string = path.resolve(workspaceRoot);
    const resolved: string = path.resolve(root, requestedPath);

    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new BadDataException(
        `Path escapes the workspace: ${requestedPath}`,
      );
    }

    return resolved;
  }

  // The workspace-relative form of an already-guarded absolute path.
  public static toWorkspaceRelativePath(
    workspaceRoot: string,
    absolutePath: string,
  ): string {
    const relative: string = path.relative(
      path.resolve(workspaceRoot),
      absolutePath,
    );

    return relative === "" ? "." : relative;
  }

  /*
   * Decide whether the agent may run a shell command.
   *
   * Only repository-state-mutating git is refused; everything else is
   * allowed, because building and testing is the whole point of the tool.
   * The refusal text names the reason so the model corrects course instead
   * of retrying the same command.
   */
  public static evaluateCommand(command: string): CommandGuardDecision {
    for (const segment of command.split(COMMAND_SEPARATORS)) {
      const subcommand: string | null = this.gitSubcommandOf(segment);

      if (subcommand && REFUSED_GIT_SUBCOMMANDS.has(subcommand)) {
        return {
          allowed: false,
          reason:
            `Refused: \`git ${subcommand}\` is not available to you. The surrounding ` +
            `pipeline owns this repository's git state — it created the branch, and it ` +
            `stages, commits and pushes your changes once you are done. Running git ` +
            `yourself would hide your work from it. Edit files with write_file and ` +
            `leave git alone; read-only git (status, diff, log, show, grep) is allowed.`,
        };
      }
    }

    return { allowed: true, reason: null };
  }

  /*
   * The git subcommand a single shell segment invokes, or null when the
   * segment does not invoke git. Skips leading environment assignments
   * (`GIT_DIR=x git ...`) and git's own global options, including the ones
   * that consume a following value.
   */
  private static gitSubcommandOf(segment: string): string | null {
    const tokens: Array<string> = segment
      .trim()
      .split(/\s+/)
      .filter((token: string) => {
        return token.length > 0;
      });

    let index: number = 0;

    // Leading VAR=value assignments belong to the command, not to argv.
    while (
      index < tokens.length &&
      LEADING_ENV_ASSIGNMENT.test(tokens[index] as string)
    ) {
      index++;
    }

    const executable: string | undefined = tokens[index];

    if (!executable) {
      return null;
    }

    // Match `git`, `/usr/bin/git`, and `"git"` alike.
    const executableName: string = executable
      .replace(/^["']|["']$/g, "")
      .split("/")
      .pop() as string;

    if (executableName !== "git") {
      return null;
    }

    index++;

    while (index < tokens.length) {
      const token: string = tokens[index] as string;

      if (!token.startsWith("-")) {
        return token.toLowerCase();
      }

      // `--git-dir=x` carries its value; `--git-dir x` consumes the next token.
      if (GIT_OPTIONS_WITH_VALUE.has(token)) {
        index += 2;
        continue;
      }

      index++;
    }

    return null;
  }

  /*
   * Truncate a tool output to the model-context cap, appending an explicit
   * marker so the model knows the output is partial rather than complete.
   */
  public static truncateToolOutput(
    output: string,
    maxChars: number = MAX_TOOL_OUTPUT_CHARS,
  ): string {
    if (output.length <= maxChars) {
      return output;
    }

    return `${output.substring(0, maxChars)}\n... [output truncated to ${maxChars.toLocaleString()} characters]`;
  }
}
