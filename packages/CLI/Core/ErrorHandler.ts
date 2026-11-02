import { isJsonRequested, printError, printHint } from "./OutputFormatter";

export enum ExitCode {
  Success = 0,
  GeneralError = 1,
  AuthError = 2,
  NotFound = 3,
}

// Where an error happened, so its hint can name the command to run next.
export interface ErrorContext {
  // The resource command: `incident`.
  resource?: string | undefined;
  // Its subcommand: `create`.
  operation?: string | undefined;
}

/*
 * An error as the CLI reports it: the line it prints - the same line it
 * always printed, which scripts and the docs quote - the code it exits
 * with, the HTTP status OneUptime answered with when it answered, and what
 * to do about it.
 */
export interface DescribedError {
  exitCode: ExitCode;
  // "Authentication error: API error (400): Invalid API Key".
  line: string;
  // The error's own message, without the CLI's prefix.
  message: string;
  status: number | null;
  hint: string | null;
}

// "API error (422): ..." - the status ApiClient puts first.
const API_ERROR_STATUS: RegExp = /^API error \((\d{3})\)/;

function statusOf(message: string): number | null {
  const match: RegExpMatchArray | null = message.match(API_ERROR_STATUS);

  return match ? Number(match[1]) : null;
}

/*
 * Whether an error is about the API key. The key is matched in any case:
 * OneUptime refuses a key with "Invalid API Key" and a request without one
 * with "API Key not found in the request header", and a key below its plan
 * with "API keys need the ... plan". Matched only as "API key", the first
 * exited as a general error and the second as "Not found".
 */
function isAuthError(message: string): boolean {
  return (
    message.toLowerCase().includes("api key") ||
    message.includes("credentials") ||
    message.includes("Unauthorized") ||
    message.includes("401")
  );
}

function isNotFound(message: string): boolean {
  return message.includes("404") || message.includes("not found");
}

const KEYS_PAGE: string = "Project Settings → Advanced → API Keys";

function authHint(message: string, status: number | null): string | null {
  if (message.includes("No credentials found")) {
    return null;
  }

  if (status === 402) {
    return "Upgrade the project to the plan the message names: the same key works again once it is on it.";
  }

  if (message.includes("not found in the request header")) {
    return "Pass --api-key, set ONEUPTIME_API_KEY, or run `oneuptime login <api-key> <instance-url>`.";
  }

  return `Copy the key again from ${KEYS_PAGE}, where its Expires date is too, then run \`oneuptime login\` again or set ONEUPTIME_API_KEY.`;
}

function notFoundHint(context: ErrorContext): string {
  return context.resource
    ? `\`oneuptime ${context.resource} list\` shows the ones this key may read.`
    : "Check the ID, and that the key may read it.";
}

function generalHint(
  message: string,
  status: number | null,
  context: ErrorContext,
): string | null {
  if (status === 422 && message.toLowerCase().includes("permission")) {
    return `Give the API key one of the permissions the message names, in ${KEYS_PAGE}.`;
  }

  if (
    status === 400 &&
    context.resource &&
    (context.operation === "create" || context.operation === "update")
  ) {
    return `\`oneuptime ${context.resource} fields\` lists every field, and the flag that sets it.`;
  }

  if (message.startsWith("Invalid JSON")) {
    return "In Bash and zsh, wrap JSON in single quotes. Or put it in a file and use --file.";
  }

  if (message.startsWith("Request failed")) {
    return "Check the address with `oneuptime whoami`: it is the one you open OneUptime at, such as https://oneuptime.com.";
  }

  if (message.startsWith("Context \"") && message.endsWith("does not exist.")) {
    return "`oneuptime context list` shows the saved contexts.";
  }

  return null;
}

// How the CLI reports an error: what it prints, and how it exits.
export function describeError(
  error: unknown,
  context: ErrorContext = {},
): DescribedError {
  if (!(error instanceof Error)) {
    const message: string = String(error);

    return {
      exitCode: ExitCode.GeneralError,
      line: `Error: ${message}`,
      message,
      status: null,
      hint: null,
    };
  }

  const message: string = error.message;
  const status: number | null = statusOf(message);

  if (isAuthError(message)) {
    return {
      exitCode: ExitCode.AuthError,
      line: `Authentication error: ${message}`,
      message,
      status,
      hint: authHint(message, status),
    };
  }

  if (isNotFound(message)) {
    return {
      exitCode: ExitCode.NotFound,
      line: `Not found: ${message}`,
      message,
      status,
      hint: notFoundHint(context),
    };
  }

  return {
    exitCode: ExitCode.GeneralError,
    line: message.includes("API error") ? message : `Error: ${message}`,
    message,
    status,
    hint: generalHint(message, status, context),
  };
}

/*
 * Reports an error and exits. On standard error, so standard output holds
 * only answers: the line, then what to do. Asked for JSON (--json, -o
 * json), one JSON object instead, with the same fields every time:
 *
 *   {"error":{"message":"...","status":422,"exitCode":1,"hint":"..."}}
 */
export function handleError(
  error: unknown,
  context: ErrorContext = {},
): never {
  const described: DescribedError = describeError(error, context);

  if (isJsonRequested()) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        error: {
          message: described.message,
          status: described.status,
          exitCode: described.exitCode,
          hint: described.hint,
        },
      }),
    );
  } else {
    printError(described.line);

    if (described.hint) {
      printHint(described.hint);
    }
  }

  return process.exit(described.exitCode);
}
