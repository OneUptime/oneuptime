import SecretRedactor from "./SecretRedactor";

/*
 * WHAT A FAILED GIT COMMAND SAYS, FOR THE PERSON WHOSE RUN IT WAS.
 *
 * Node's execFile rejects with "Command failed: <the whole command line>"
 * and then git's own output. The command line tells a person nothing they
 * can act on - the pinned addresses (http.curloptResolve), the workspace
 * path - and is long enough that the run's message, cut to fit where the
 * server keeps it, lost what git said after it: an Azure DevOps Server
 * clone that failed with "Authentication failed" reached the run as a
 * command line and a cut-off "Cloning into ..." (issue #6144).
 *
 * So a failed git command is reported by what git said went wrong: its
 * fatal, error and remote lines (a server explains a refusal on "remote:"
 * lines), and a push's rejected refs - redacted, and short. Where none of
 * those lines is there (git in another language), the last lines git wrote
 * are kept instead. The command line still goes to the Runner's own debug
 * log, redacted, for whoever operates it.
 */

/*
 * The most of git's own words a message carries: with what the Runner says
 * around them, the message fits where the server keeps a run's message
 * (500 characters), so git's reason is never the part that is cut.
 */
export const MAX_GIT_SAYS_LENGTH: number = 240;

// The lines git explains a failure on, in the order it writes them.
const REASON_LINE_PREFIXES: Array<string> = [
  "fatal:",
  "error:",
  "remote:",
  "! [",
];

// How many of git's last lines are kept when none of them is a reason line.
const FALLBACK_LINE_COUNT: number = 3;

// The most reason lines read, and the most of each line.
const MAX_REASON_LINES: number = 20;
const MAX_REASON_LINE_LENGTH: number = 2048;

// What git and libcurl say when the server refused the credentials.
const SIGN_IN_REFUSED_PHRASES: Array<string> = [
  "authentication failed",
  "could not read username",
  "could not read password",
  "the requested url returned error: 401",
  "http basic: access denied",
  "invalid username or password",
  "invalid username or token",
];

// What git says when the branch asked for is not on the remote.
const MISSING_REMOTE_BRANCH_PHRASES: Array<string> = [
  "not found in upstream",
  "could not find remote branch",
];

// What git and libcurl say when the server could not be reached at all.
const SERVER_UNREACHABLE_PHRASES: Array<string> = [
  "could not resolve host",
  "failed to connect to",
  "connection timed out",
  "connection refused",
  "operation timed out",
];

export default class GitCommandError extends Error {
  // The git command that failed: "clone", "push", "checkout", ...
  public readonly command: string;
  // What git said went wrong, redacted and short. Empty when it said nothing.
  public readonly gitSays: string;
  // Whether the command ran out of time and was stopped.
  public readonly isTimeout: boolean;
  /*
   * The same lines, whole: why it failed is read from them, so a long line
   * a server wrote first does not hide the one that says.
   */
  private readonly reason: string;

  public constructor(data: {
    command: string;
    gitSays: string;
    isTimeout: boolean;
    reason?: string | undefined;
  }) {
    super(GitCommandError.buildMessage(data));
    this.name = "GitCommandError";
    this.command = data.command;
    this.gitSays = data.gitSays;
    this.isTimeout = data.isTimeout;
    this.reason = data.reason ?? data.gitSays;
  }

  /*
   * The error a git command's rejection is reported as. `args` is the argv
   * git was given; the first argument that is not one of its `-c` options
   * names the command.
   */
  public static fromExecError(
    args: Array<string>,
    error: unknown,
  ): GitCommandError {
    const execError: { killed?: unknown; signal?: unknown } =
      error && typeof error === "object"
        ? (error as { killed?: unknown; signal?: unknown })
        : {};

    const reason: string = GitCommandError.readReason(
      GitCommandError.readOutput(error),
    );

    return new GitCommandError({
      command: GitCommandError.readCommand(args),
      gitSays: GitCommandError.shorten(reason),
      reason,
      isTimeout: execError.killed === true || execError.signal === "SIGKILL",
    });
  }

  /*
   * What git wrote, from an execFile rejection: its message is "Command
   * failed: <cmd>" and then git's output, and `cmd` - the command line, a
   * commit message's lines among its arguments - is cut off whole.
   */
  public static readOutput(error: unknown): string {
    const message: string =
      error instanceof Error ? error.message : String(error || "");
    const cmd: unknown =
      error && typeof error === "object"
        ? (error as { cmd?: unknown }).cmd
        : undefined;

    if (typeof cmd === "string" && cmd) {
      const prefix: string = `Command failed: ${cmd}`;

      if (message.startsWith(prefix)) {
        return message.substring(prefix.length);
      }
    }

    return message;
  }

  // The git command an argv runs: what follows its global options.
  public static readCommand(args: Array<string>): string {
    for (let index: number = 0; index < args.length; index++) {
      const arg: string = args[index] || "";

      if (arg === "-c" || arg === "-C") {
        index++;
        continue;
      }

      if (arg.startsWith("-")) {
        continue;
      }

      return arg;
    }

    return "command";
  }

  /*
   * What git said went wrong, from what it wrote, as a message carries it:
   * its reason (readReason), cut to MAX_GIT_SAYS_LENGTH.
   */
  public static readGitSays(output: string): string {
    return GitCommandError.shorten(GitCommandError.readReason(output));
  }

  /*
   * Git's reason, whole: a "Command failed: ..." line left at the top
   * dropped, then its reason lines - or, when it wrote none, its last
   * lines - joined and redacted.
   */
  public static readReason(output: string): string {
    const lines: Array<string> = (output || "")
      .split("\n")
      .map((line: string): string => {
        return line.trim();
      })
      .filter((line: string, index: number): boolean => {
        if (!line) {
          return false;
        }

        // Node's own first line: the command, not what went wrong.
        return !(index === 0 && line.startsWith("Command failed:"));
      });

    const reasonLines: Array<string> = lines.filter((line: string) => {
      return REASON_LINE_PREFIXES.some((prefix: string): boolean => {
        return line.startsWith(prefix);
      });
    });

    const kept: Array<string> = (
      reasonLines.length > 0
        ? reasonLines.slice(0, MAX_REASON_LINES)
        : lines.slice(Math.max(0, lines.length - FALLBACK_LINE_COUNT))
    ).map((line: string): string => {
      /*
       * Each line bounded before the redactor's patterns read it: a server
       * can write a line of megabytes, and no pattern reads one
       * (Docs/notifications/README.md, "Megabyte-long values").
       */
      return line.length > MAX_REASON_LINE_LENGTH
        ? line.substring(0, MAX_REASON_LINE_LENGTH)
        : line;
    });

    return SecretRedactor.redact(kept.join(" "));
  }

  // A reason cut to what a message carries.
  private static shorten(text: string): string {
    return text.length > MAX_GIT_SAYS_LENGTH
      ? `${text.substring(0, MAX_GIT_SAYS_LENGTH - 1)}…`
      : text;
  }

  // Whether the server refused the credentials git signed in with.
  public isSignInRefusal(): boolean {
    return GitCommandError.says(this.reason, SIGN_IN_REFUSED_PHRASES);
  }

  // Whether the branch asked for is not on the remote.
  public isMissingRemoteBranch(): boolean {
    return GitCommandError.says(this.reason, MISSING_REMOTE_BRANCH_PHRASES);
  }

  // Whether the server could not be reached at all.
  public isServerUnreachable(): boolean {
    return GitCommandError.says(this.reason, SERVER_UNREACHABLE_PHRASES);
  }

  private static says(text: string, phrases: Array<string>): boolean {
    const lower: string = text.toLowerCase();

    return phrases.some((phrase: string): boolean => {
      return lower.includes(phrase);
    });
  }

  private static buildMessage(data: {
    command: string;
    gitSays: string;
    isTimeout: boolean;
  }): string {
    if (data.isTimeout) {
      return `git ${data.command} did not finish in time and was stopped.${
        data.gitSays ? ` Git said: ${data.gitSays}` : ""
      }`;
    }

    return data.gitSays
      ? `git ${data.command} failed. Git said: ${data.gitSays}`
      : `git ${data.command} failed.`;
  }
}
