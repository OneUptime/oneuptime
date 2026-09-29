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

    // Check for auth-related errors
    if (
      message.includes("API key") ||
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
