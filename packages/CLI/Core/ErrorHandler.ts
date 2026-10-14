import { printError } from "./OutputFormatter";

export enum ExitCode {
  Success = 0,
  GeneralError = 1,
  AuthError = 2,
  NotFound = 3,
}

export function handleError(error: unknown): never {
  if (error instanceof Error) {
    const message: string = error.message;

    /*
     * Auth-related errors. The API key is matched in any case: OneUptime
     * refuses a key with "Invalid API Key" and a request without one with
     * "API Key not found in the request header", and a key below its plan
     * with "API keys need the ... plan". Matched only as "API key", the first
     * exited as a general error and the second as "Not found".
     */
    if (
      message.toLowerCase().includes("api key") ||
      message.includes("credentials") ||
      message.includes("Unauthorized") ||
      message.includes("401")
    ) {
      printError(`Authentication error: ${message}`);
      process.exit(ExitCode.AuthError);
    }

    // Check for not found errors
    if (message.includes("404") || message.includes("not found")) {
      printError(`Not found: ${message}`);
      process.exit(ExitCode.NotFound);
    }

    // General API errors
    if (message.includes("API error")) {
      printError(message);
      process.exit(ExitCode.GeneralError);
    }

    printError(`Error: ${message}`);
  } else {
    printError(`Error: ${String(error)}`);
  }

  process.exit(ExitCode.GeneralError);
}
