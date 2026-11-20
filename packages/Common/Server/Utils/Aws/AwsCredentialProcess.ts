import { ChildProcess, spawn } from "child_process";
import path from "path";

/*
 * A PROFILE'S credential_process, RUN THE SAFE WAY (#7381): the program a
 * profile of the AWS shared config files names to print the server's
 * credentials - such as aws_signing_helper, which trades an X.509
 * certificate for IAM Roles Anywhere credentials on a server outside AWS.
 *
 *   - No shell. The line is split into words as a shell would split them
 *     (spaces, '...', "...", \), and nothing else a shell does is done: a
 *     pipe, a redirect, $VARIABLE, `command`, ~ or a second command is
 *     refused, so the line means exactly the one program it names.
 *   - The program by its full path: one program, wherever PATH points.
 *   - A time limit (CREDENTIAL_PROCESS_TIMEOUT_MS): a program that hangs is
 *     killed, with anything it started.
 *   - What it prints is read no further than 64 KB; one that prints more
 *     is killed. What it writes to stderr is never read: it may name a
 *     secret, and is neither kept, logged nor put in a message.
 *
 * It prints its credentials as JSON:
 *
 *   {"Version": 1, "AccessKeyId": "...", "SecretAccessKey": "...",
 *    "SessionToken": "...", "Expiration": "2026-11-20T12:00:00Z"}
 *
 * https://docs.aws.amazon.com/sdkref/latest/guide/feature-process-credentials.html
 * https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html
 */

export interface AwsChainProcessRequest {
  // The program, by its full path.
  program: string;
  args: Array<string>;
  env: Record<string, string>;
  timeoutMs: number;
  // The most it may print; it is killed past this.
  maxOutputBytes: number;
}

export type AwsChainProcessResult =
  // It ran to its end: its exit code, and what it printed.
  | { outcome: "exited"; exitCode: number; stdout: string }
  // A signal ended it that was not OneUptime's.
  | { outcome: "killed"; signal: string }
  // It could not be started: the reason's code (ENOENT, EACCES).
  | { outcome: "not-started"; reason: string }
  | { outcome: "timed-out" }
  | { outcome: "too-much-output" };

/*
 * Runs one program and says how it went. Never throws: every way it can
 * go is a result.
 */
export type AwsChainProcessRunner = (
  request: AwsChainProcessRequest,
) => Promise<AwsChainProcessResult>;

// How long the program may take: a certificate traded at AWS takes a second or two.
export const CREDENTIAL_PROCESS_TIMEOUT_MS: number = 30 * 1000;

// The most it may print: credentials are a few hundred bytes.
export const MAX_CREDENTIAL_PROCESS_OUTPUT_BYTES: number = 64 * 1024;

// What a shell would do something with, outside quotes.
const SHELL_OPERATORS: ReadonlyArray<string> = [
  "|",
  "&",
  ";",
  "<",
  ">",
  "(",
  ")",
  "$",
  "`",
  "*",
  "?",
  "[",
  "]",
  "{",
  "}",
];

// The code of a Node error: ENOENT, EACCES.
const ERROR_CODE_PATTERN: RegExp = /^[A-Z0-9_]{1,40}$/;

// What a shell expands inside double quotes.
const DOUBLE_QUOTE_EXPANSIONS: ReadonlyArray<string> = ["$", "`"];

// What a backslash escapes inside double quotes, as a shell reads it.
const DOUBLE_QUOTE_ESCAPES: ReadonlyArray<string> = ['"', "\\", "$", "`"];

export type AwsCommandLineSplit =
  | { words: Array<string> }
  // Why the line is not one program: words for a message.
  | { problem: string };

const isControlCharacter: (character: string) => boolean = (
  character: string,
): boolean => {
  const code: number = character.charCodeAt(0);
  return (code < 0x20 && character !== "\t") || code === 0x7f;
};

/*
 * A credential_process line as the words of one program, split as a shell
 * splits them - or why it is not one. The words themselves never reach the
 * problem: an argument may be a secret.
 */
export const splitCommandLine: (line: string) => AwsCommandLineSplit = (
  line: string,
): AwsCommandLineSplit => {
  const words: Array<string> = [];
  let current: string = "";
  let isInWord: boolean = false;
  let index: number = 0;

  const operatorProblem: (
    character: string,
    where: string,
  ) => AwsCommandLineSplit = (
    character: string,
    where: string,
  ): AwsCommandLineSplit => {
    return {
      problem: `it holds ${character} ${where}, which only a shell reads, and OneUptime runs the program with no shell. Name one program and its arguments, quote a ${character} that is part of one in single quotes, or put what needs a shell in a script and name the script`,
    };
  };

  while (index < line.length) {
    const character: string = line.charAt(index);

    if (isControlCharacter(character)) {
      return { problem: "it holds a control character" };
    }

    if (character === " " || character === "\t") {
      if (isInWord) {
        words.push(current);
        current = "";
        isInWord = false;
      }

      index++;
      continue;
    }

    if (character === "'") {
      const end: number = line.indexOf("'", index + 1);

      if (end === -1) {
        return { problem: "a ' in it is never closed" };
      }

      current += line.slice(index + 1, end);
      isInWord = true;
      index = end + 1;
      continue;
    }

    if (character === '"') {
      let isClosed: boolean = false;

      index++;
      isInWord = true;

      while (index < line.length) {
        const inQuotes: string = line.charAt(index);

        if (inQuotes === '"') {
          isClosed = true;
          index++;
          break;
        }

        if (isControlCharacter(inQuotes)) {
          return { problem: "it holds a control character" };
        }

        if (
          inQuotes === "\\" &&
          DOUBLE_QUOTE_ESCAPES.includes(line.charAt(index + 1))
        ) {
          current += line.charAt(index + 1);
          index += 2;
          continue;
        }

        if (DOUBLE_QUOTE_EXPANSIONS.includes(inQuotes)) {
          return operatorProblem(inQuotes, "in double quotes");
        }

        current += inQuotes;
        index++;
      }

      if (!isClosed) {
        return { problem: 'a " in it is never closed' };
      }

      continue;
    }

    if (character === "\\") {
      if (index + 1 >= line.length) {
        return { problem: "it ends with a backslash" };
      }

      current += line.charAt(index + 1);
      isInWord = true;
      index += 2;
      continue;
    }

    if (SHELL_OPERATORS.includes(character)) {
      return operatorProblem(character, "outside quotes");
    }

    // A shell reads ~ at a word's start as the home directory.
    if (character === "~" && !isInWord) {
      return operatorProblem(character, "at the start of a word");
    }

    current += character;
    isInWord = true;
    index++;
  }

  if (isInWord) {
    words.push(current);
  }

  if (words.length === 0) {
    return { problem: "it is empty" };
  }

  if (!words[0]) {
    return { problem: "its first word, the program, is empty" };
  }

  return { words: words };
};

// Whether a program is named by its full path, which alone names one program.
export const isFullProgramPath: (program: string) => boolean = (
  program: string,
): boolean => {
  return path.isAbsolute(program) && !program.includes("\0");
};

/*
 * Stops the program and anything it started: it leads a process group of
 * its own, which is killed whole.
 */
const killProcessGroup: (child: ChildProcess) => void = (
  child: ChildProcess,
): void => {
  try {
    if (child.pid) {
      process.kill(-child.pid, "SIGKILL");
      return;
    }
  } catch {
    // The group is gone already, or was never one: kill the program alone.
  }

  try {
    child.kill("SIGKILL");
  } catch {
    // Already ended.
  }
};

/*
 * The runner a credential_process is run with: spawn, with no shell, in a
 * process group of its own (so a timeout kills what it started too),
 * stdin closed, stdout read up to its limit and stderr thrown away unread.
 */
export const defaultAwsChainProcessRunner: AwsChainProcessRunner = (
  request: AwsChainProcessRequest,
): Promise<AwsChainProcessResult> => {
  return new Promise<AwsChainProcessResult>(
    (resolve: (result: AwsChainProcessResult) => void): void => {
      let isSettled: boolean = false;
      let child: ChildProcess;
      const chunks: Array<Buffer> = [];
      let outputBytes: number = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const settle: (result: AwsChainProcessResult) => void = (
        result: AwsChainProcessResult,
      ): void => {
        if (isSettled) {
          return;
        }

        isSettled = true;

        if (timer) {
          clearTimeout(timer);
        }

        resolve(result);
      };

      try {
        child = spawn(request.program, request.args, {
          shell: false,
          env: request.env,
          stdio: ["ignore", "pipe", "ignore"],
          detached: true,
          windowsHide: true,
        });
      } catch (error) {
        settle({
          outcome: "not-started",
          reason: readErrorCode(error),
        });
        return;
      }

      timer = setTimeout(() => {
        killProcessGroup(child);
        settle({ outcome: "timed-out" });
      }, request.timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        if (isSettled) {
          return;
        }

        outputBytes += chunk.length;

        if (outputBytes > request.maxOutputBytes) {
          killProcessGroup(child);
          settle({ outcome: "too-much-output" });
          return;
        }

        chunks.push(chunk);
      });

      child.on("error", (error: Error) => {
        settle({ outcome: "not-started", reason: readErrorCode(error) });
      });

      child.on("close", (code: number | null, signal: string | null) => {
        if (code === null) {
          settle({ outcome: "killed", signal: signal || "a signal" });
          return;
        }

        settle({
          outcome: "exited",
          exitCode: code,
          stdout: Buffer.concat(chunks).toString("utf8"),
        });
      });
    },
  );
};

// The code an error of Node's names (ENOENT, EACCES), or a word for one that names none.
const readErrorCode: (error: unknown) => string = (error: unknown): string => {
  const code: unknown = (error as { code?: unknown } | null)?.code;

  return typeof code === "string" && ERROR_CODE_PATTERN.test(code)
    ? code
    : "it could not be run";
};
