import { ChildProcess, spawn } from "child_process";
import { StringDecoder } from "string_decoder";

/*
 * A read-only git command the code agent's tools run themselves (issue
 * #6441): git grep for search_files, git ls-files for find_files and
 * list_directory, git status / diff / log / show / blame for the git tool.
 *
 * The argument list is the tool's own, never a shell line: the model only
 * fills in values (a pattern, a path, a revision), each checked and placed
 * where git reads it as that (a path after `--`). So these run on a global
 * Runner too, which runs no command a model composes, like the git grep
 * search_files always ran there.
 *
 * Unlike Execute.executeCommandFile, a failure is an answer, not a throw:
 * git grep exits 1 for "no match" and 128 for a bad pattern, and the tool
 * needs to tell the two apart and say which. Every run:
 *
 *   - reaches no network: protocol.allow=never refuses every transport, so
 *     a read never fetches (a partial clone's lazy fetch included);
 *   - writes nothing: GIT_OPTIONAL_LOCKS=0 keeps `git status` from
 *     refreshing the index, which the pipeline owns; git diff, which
 *     refreshes it regardless, is given a copy of it (indexFile); and no
 *     command here writes anything else;
 *   - runs no program the repository names: fsmonitor is off, the
 *     diff-showing commands pass --no-ext-diff and --no-textconv, and
 *     blame passes --no-textconv;
 *   - never waits on a prompt or a pager;
 *   - stops at its timeout and at its output limit (the process is killed,
 *     and the result says it was cut).
 */
export interface GitReadResult {
  // Null when it was killed (timeout, output limit) or never started.
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  // The output went past the limit, and the command was stopped there.
  outputLimitReached: boolean;
}

const BASE_ARGS: ReadonlyArray<string> = [
  "-c",
  "core.quotepath=off",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "protocol.allow=never",
  "-c",
  "color.ui=false",
  "--no-pager",
];

// The environment's variables a read-only git command must not see.
const STRIPPED_ENVIRONMENT: ReadonlyArray<string> = [
  "ONEUPTIME_RUNNER_KEY",
  "ONEUPTIME_RUNNER_ID",
  "GIT_ASKPASS",
  "ONEUPTIME_GIT_ACCESS_TOKEN",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_EXTERNAL_DIFF",
];

const MAX_STDERR_CHARS: number = 64 * 1024;

// How long output may still arrive once git has exited.
const EXIT_GRACE_MS: number = 2 * 1000;

export default class GitReadCommand {
  public static run(data: {
    cwd: string;
    args: Array<string>;
    timeoutMs: number;
    maxOutputBytes: number;
    /*
     * An index file of the command's own (a copy of the repository's), for
     * a command that refreshes the index it reads (git diff): it then
     * refreshes the copy, and the repository's index is never written.
     */
    indexFile?: string | undefined;
  }): Promise<GitReadResult> {
    return new Promise((resolve: (result: GitReadResult) => void): void => {
      let child: ChildProcess;

      try {
        child = spawn("git", [...BASE_ARGS, ...data.args], {
          cwd: data.cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: GitReadCommand.buildEnvironment(data.indexFile),
        });
      } catch (error) {
        resolve({
          exitCode: null,
          stdout: "",
          stderr: error instanceof Error ? error.message : String(error),
          timedOut: false,
          outputLimitReached: false,
        });
        return;
      }

      const stdoutDecoder: StringDecoder = new StringDecoder("utf8");
      const stderrDecoder: StringDecoder = new StringDecoder("utf8");
      let stdout: string = "";
      let stderr: string = "";
      let outputBytes: number = 0;
      let timedOut: boolean = false;
      let outputLimitReached: boolean = false;
      let settled: boolean = false;
      let exitTimer: ReturnType<typeof setTimeout> | null = null;

      const stop: () => void = (): void => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Already gone.
        }
      };

      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        timedOut = true;
        stop();
      }, data.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (outputLimitReached) {
          return;
        }

        outputBytes += chunk.length;

        if (outputBytes > data.maxOutputBytes) {
          outputLimitReached = true;
          const keep: number = Math.max(
            0,
            chunk.length - (outputBytes - data.maxOutputBytes),
          );
          stdout += stdoutDecoder.write(chunk.subarray(0, keep));
          stop();
          return;
        }

        stdout += stdoutDecoder.write(chunk);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR_CHARS) {
          stderr += stderrDecoder.write(chunk);
        }
      });

      const settle: (exitCode: number | null, extraError?: string) => void = (
        exitCode: number | null,
        extraError?: string,
      ): void => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timer);

        if (exitTimer) {
          clearTimeout(exitTimer);
        }

        resolve({
          exitCode: timedOut || outputLimitReached ? null : exitCode,
          stdout: stdout + stdoutDecoder.end(),
          stderr: `${stderr}${stderrDecoder.end()}${
            extraError ? `\n${extraError}` : ""
          }`.trim(),
          timedOut,
          outputLimitReached,
        });
      };

      child.on("close", (code: number | null) => {
        settle(code);
      });

      /*
       * "close" waits for every holder of the output pipes: a program git
       * started (a filter the Runner's own git configuration names) that
       * outlives it would hold the answer back. Once git itself has
       * exited, what is left of its output has a moment to arrive.
       */
      child.on("exit", (code: number | null) => {
        exitTimer = setTimeout(() => {
          settle(code);
        }, EXIT_GRACE_MS);
      });

      child.on("error", (error: Error) => {
        settle(null, error.message);
      });
    });
  }

  private static buildEnvironment(
    indexFile: string | undefined,
  ): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { ...process.env };

    for (const name of STRIPPED_ENVIRONMENT) {
      delete environment[name];
    }

    if (indexFile) {
      environment["GIT_INDEX_FILE"] = indexFile;
    }

    environment["GIT_TERMINAL_PROMPT"] = "0";
    environment["GIT_OPTIONAL_LOCKS"] = "0";
    environment["GIT_PAGER"] = "cat";
    environment["PAGER"] = "cat";
    environment["GIT_NO_LAZY_FETCH"] = "1";

    return environment;
  }
}
