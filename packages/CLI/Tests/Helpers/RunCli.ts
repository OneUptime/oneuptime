import { Command } from "commander";
import { buildProgram } from "../../Program";

/*
 * Runs the CLI's real program in this process, as `oneuptime <args>`, and
 * says what it printed and how it exited: standard output's lines,
 * standard error's lines, and the exit code (undefined when it never
 * exited, as a command that worked does not).
 *
 * The program is the one Index.ts runs (buildProgram), so the global
 * options, the lazy resource subcommands and their field flags are made as
 * they are for a customer. A test file that wants no real requests mocks
 * ../Core/ApiClient before it imports this.
 */

export interface CliRun {
  printed: Array<string>;
  errors: Array<string>;
  exitCode: number | undefined;
}

class ExitCalled extends Error {}

/*
 * Keeps Commander from ending the process, and takes what it prints - a
 * help, its own errors - into the run. Subcommands made later (a resource's,
 * as the program dispatches to it) inherit both from their parent.
 */
function capture(command: Command, run: CliRun): void {
  command.exitOverride();
  command.configureOutput({
    writeOut: (text: string): void => {
      run.printed.push(text.replace(TRAILING_NEWLINE, ""));
    },
    writeErr: (text: string): void => {
      run.errors.push(text.replace(TRAILING_NEWLINE, ""));
    },
  });
  command.commands.forEach((child: Command): void => {
    capture(child, run);
  });
}

const TRAILING_NEWLINE: RegExp = /\n$/;

// What Commander throws after it printed a help or the version.
const COMMANDER_DONE_CODES: ReadonlyArray<string> = [
  "commander.helpDisplayed",
  "commander.help",
  "commander.version",
];

export async function runCli(
  args: Array<string>,
  options: { isTTY?: boolean | undefined } = {},
): Promise<CliRun> {
  const run: CliRun = { printed: [], errors: [], exitCode: undefined };
  const noColor: string | undefined = process.env["NO_COLOR"];
  const originalIsTTY: boolean | undefined = process.stdout.isTTY;
  const originalArgv: Array<string> = process.argv;

  process.env["NO_COLOR"] = "1";
  process.argv = ["node", "oneuptime", ...args];
  Object.defineProperty(process.stdout, "isTTY", {
    value: options.isTTY,
    writable: true,
    configurable: true,
  });

  const log: jest.SpyInstance = jest
    .spyOn(console, "log")
    .mockImplementation((...parts: Array<unknown>): void => {
      run.printed.push(parts.map(String).join(" "));
    });
  const error: jest.SpyInstance = jest
    .spyOn(console, "error")
    .mockImplementation((...parts: Array<unknown>): void => {
      run.errors.push(parts.map(String).join(" "));
    });
  const exit: jest.SpyInstance = jest
    .spyOn(process, "exit")
    .mockImplementation((code?: string | number | null): never => {
      run.exitCode = Number(code);
      throw new ExitCalled();
    });

  try {
    const program: Command = buildProgram();
    capture(program, run);
    await program.parseAsync(["node", "oneuptime", ...args]);
  } catch (caught) {
    if (caught instanceof ExitCalled) {
      // The command exited: run.exitCode says how.
    } else if (
      caught &&
      typeof caught === "object" &&
      "exitCode" in caught &&
      typeof (caught as { exitCode: unknown }).exitCode === "number"
    ) {
      /*
       * Commander's own exit: after a help or the version (0), or a
       * refusal of the command line (an unknown option, a missing
       * argument), which it has already printed.
       */
      const code: string = String((caught as { code?: string }).code || "");

      run.exitCode = COMMANDER_DONE_CODES.includes(code)
        ? 0
        : (caught as { exitCode: number }).exitCode;
    } else {
      throw caught;
    }
  } finally {
    log.mockRestore();
    error.mockRestore();
    exit.mockRestore();
    process.argv = originalArgv;
    Object.defineProperty(process.stdout, "isTTY", {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });

    if (noColor === undefined) {
      delete process.env["NO_COLOR"];
    } else {
      process.env["NO_COLOR"] = noColor;
    }
  }

  return run;
}

// What a run printed to standard output, as JSON.
export function printedJson(run: CliRun): unknown {
  return JSON.parse(run.printed.join("\n"));
}

export const TEST_API_KEY: string = "sk-test-key-0123456789";
export const TEST_URL: string = "https://oneuptime.example.com";

// Credentials from the environment, as a script gives them.
export function useTestCredentials(): void {
  process.env["ONEUPTIME_API_KEY"] = TEST_API_KEY;
  process.env["ONEUPTIME_URL"] = TEST_URL;
}

export function clearTestCredentials(): void {
  delete process.env["ONEUPTIME_API_KEY"];
  delete process.env["ONEUPTIME_URL"];
}

// Real IDs: the API refuses anything else.
export const INCIDENT_ID: string = "6f1c2a40-3b1e-4c55-9a0b-3e2f8d7c1a11";
export const SEVERITY_ID: string = "1d7b0c3e-2a4f-4b6c-8d9e-0f1a2b3c4d5e";
export const MONITOR_ID: string = "2e8c1d4f-3b5a-4c7d-9e0f-1a2b3c4d5e6f";
export const OTHER_MONITOR_ID: string = "3f9d2e5a-4c6b-4d8e-8f1a-2b3c4d5e6f7a";
export const TEAM_ID: string = "4a0e3f6b-5d7c-4e9f-9a2b-3c4d5e6f7a8b";
export const USER_ID: string = "5b1f4a7c-6e8d-4f0a-8b3c-4d5e6f7a8b9c";
export const STATE_ID: string = "6c2a5b8d-7f9e-4a1b-9c4d-5e6f7a8b9c0d";
export const OTHER_STATE_ID: string = "7d3b6c9e-8a0f-4b2c-8d5e-6f7a8b9c0d1e";
