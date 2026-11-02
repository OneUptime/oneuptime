import {
  DescribedError,
  describeError,
  handleError,
  ExitCode,
} from "../Core/ErrorHandler";
import * as OutputFormatter from "../Core/OutputFormatter";

describe("ErrorHandler", () => {
  let exitSpy: jest.SpyInstance;
  let printErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, "exit").mockImplementation((() => {
      // no-op
    }) as any);
    printErrorSpy = jest
      .spyOn(OutputFormatter, "printError")
      .mockImplementation(() => {
        // no-op
      });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    printErrorSpy.mockRestore();
  });

  it("should exit with AuthError for API key errors", () => {
    handleError(new Error("Invalid API key provided"));
    expect(printErrorSpy).toHaveBeenCalledWith(
      "Authentication error: Invalid API key provided",
    );
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.AuthError);
  });

  /*
   * What OneUptime itself answers (ProjectAuthorization, PlanCutoffCredentials):
   * "API Key" with a capital K, and "API keys" in the plan cutoff. The docs'
   * exit code table (cli/scripting, cli/command-reference) promises 2 for
   * each; matched only as "API key", the first two exited 1 and 3.
   */
  it("exits with AuthError when OneUptime refuses the key as invalid", () => {
    handleError(new Error("API error (400): Invalid API Key"));
    expect(printErrorSpy).toHaveBeenCalledWith(
      "Authentication error: API error (400): Invalid API Key",
    );
    // The first exit is the one a real process makes: exit() never returns.
    expect(exitSpy.mock.calls[0]).toEqual([ExitCode.AuthError]);
  });

  it("exits with AuthError, not NotFound, when the request carried no key", () => {
    handleError(
      new Error(
        "API error (400): API Key not found in the request header. Please provide a valid API Key in the request header.",
      ),
    );
    expect(exitSpy.mock.calls[0]).toEqual([ExitCode.AuthError]);
  });

  it("exits with AuthError when the project is below the plan API keys need", () => {
    handleError(
      new Error(
        "API error (402): API keys need the Growth plan. This project's plan does not include them, so its API keys stopped working.",
      ),
    );
    expect(exitSpy.mock.calls[0]).toEqual([ExitCode.AuthError]);
  });

  it("still exits with NotFound for a record OneUptime does not find", () => {
    handleError(new Error("API error (404): Incident not found."));
    expect(printErrorSpy).toHaveBeenCalledWith(
      "Not found: API error (404): Incident not found.",
    );
    expect(exitSpy.mock.calls[0]).toEqual([ExitCode.NotFound]);
  });

  it("still exits with GeneralError for a refusal that is not about the key", () => {
    handleError(
      new Error(
        "API error (422): You do not have permissions to read Incident.",
      ),
    );
    expect(exitSpy.mock.calls[0]).toEqual([ExitCode.GeneralError]);
  });

  it("should exit with AuthError for credentials errors", () => {
    handleError(new Error("No credentials found"));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.AuthError);
  });

  it("should exit with AuthError for Unauthorized errors", () => {
    handleError(new Error("Unauthorized access"));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.AuthError);
  });

  it("should exit with AuthError for 401 errors", () => {
    handleError(new Error("HTTP 401 response"));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.AuthError);
  });

  it("should exit with NotFound for 404 errors", () => {
    handleError(new Error("HTTP 404 response"));
    expect(printErrorSpy).toHaveBeenCalledWith("Not found: HTTP 404 response");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.NotFound);
  });

  it("should exit with NotFound for not found errors", () => {
    handleError(new Error("Resource not found"));
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.NotFound);
  });

  it("should exit with GeneralError for API error messages", () => {
    handleError(new Error("API error (500): Internal Server Error"));
    expect(printErrorSpy).toHaveBeenCalledWith(
      "API error (500): Internal Server Error",
    );
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GeneralError);
  });

  it("should exit with GeneralError for generic Error objects", () => {
    handleError(new Error("Something went wrong"));
    expect(printErrorSpy).toHaveBeenCalledWith("Error: Something went wrong");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GeneralError);
  });

  it("should handle non-Error objects", () => {
    handleError("string error");
    expect(printErrorSpy).toHaveBeenCalledWith("Error: string error");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GeneralError);
  });

  it("should handle null error", () => {
    handleError(null);
    expect(printErrorSpy).toHaveBeenCalledWith("Error: null");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GeneralError);
  });

  it("should handle number error", () => {
    handleError(42);
    expect(printErrorSpy).toHaveBeenCalledWith("Error: 42");
    expect(exitSpy).toHaveBeenCalledWith(ExitCode.GeneralError);
  });

  it("prints the error once, then what to do, and exits once", () => {
    const hintSpy: jest.SpyInstance = jest
      .spyOn(OutputFormatter, "printHint")
      .mockImplementation(() => {
        // no-op
      });

    handleError(new Error("API error (404): Incident not found."), {
      resource: "incident",
      operation: "get",
    });

    expect(printErrorSpy).toHaveBeenCalledTimes(1);
    expect(hintSpy).toHaveBeenCalledWith(
      "`oneuptime incident list` shows the ones this key may read.",
    );
    expect(exitSpy).toHaveBeenCalledTimes(1);
    hintSpy.mockRestore();
  });

  /*
   * Errors that say what to do: each line the CLI always printed stays as
   * it was - scripts and the docs quote it - and a hint follows it.
   */
  describe("what an error says to do", () => {
    const cases: Array<{
      error: string;
      context?: { resource?: string; operation?: string };
      exitCode: ExitCode;
      status: number | null;
      hint: string | null;
    }> = [
      {
        error:
          "No credentials found. Run `oneuptime login` or set ONEUPTIME_API_KEY and ONEUPTIME_URL environment variables.",
        exitCode: ExitCode.AuthError,
        status: null,
        // The message says it already.
        hint: null,
      },
      {
        error: "API error (400): Invalid API Key",
        exitCode: ExitCode.AuthError,
        status: 400,
        hint: "Copy the key again from Project Settings → Advanced → API Keys, where its Expires date is too, then run `oneuptime login` again or set ONEUPTIME_API_KEY.",
      },
      {
        error:
          "API error (400): API Key not found in the request header. Please provide a valid API Key in the request header.",
        exitCode: ExitCode.AuthError,
        status: 400,
        hint: "Pass --api-key, set ONEUPTIME_API_KEY, or run `oneuptime login <api-key> <instance-url>`.",
      },
      {
        error:
          "API error (402): API keys need the Growth plan. This project's plan does not include them, so its API keys stopped working.",
        exitCode: ExitCode.AuthError,
        status: 402,
        hint: "Upgrade the project to the plan the message names: the same key works again once it is on it.",
      },
      {
        error: "API error (404): Monitor not found.",
        context: { resource: "monitor", operation: "get" },
        exitCode: ExitCode.NotFound,
        status: 404,
        hint: "`oneuptime monitor list` shows the ones this key may read.",
      },
      {
        error: "API error (404): Not found.",
        exitCode: ExitCode.NotFound,
        status: 404,
        hint: "Check the ID, and that the key may read it.",
      },
      {
        error:
          "API error (422): You do not have permissions to create Monitor. You need one of these permissions: Project Admin.",
        exitCode: ExitCode.GeneralError,
        status: 422,
        hint: "Give the API key one of the permissions the message names, in Project Settings → Advanced → API Keys.",
      },
      {
        error: "API error (400): Invalid data.",
        context: { resource: "monitor", operation: "create" },
        exitCode: ExitCode.GeneralError,
        status: 400,
        hint: "`oneuptime monitor fields` lists every field, and the flag that sets it.",
      },
      {
        error: "API error (400): Invalid data.",
        context: { resource: "monitor", operation: "list" },
        exitCode: ExitCode.GeneralError,
        status: 400,
        hint: null,
      },
      {
        error: "Invalid JSON: {name: x}",
        exitCode: ExitCode.GeneralError,
        status: null,
        hint: "In Bash and zsh, wrap JSON in single quotes. Or put it in a file and use --file.",
      },
      {
        error: "Request failed to https://oneuptime.example.com/api/incident/get-list",
        exitCode: ExitCode.GeneralError,
        status: null,
        hint: "Check the address with `oneuptime whoami`: it is the one you open OneUptime at, such as https://oneuptime.com.",
      },
      {
        error: 'Context "staging" does not exist.',
        exitCode: ExitCode.GeneralError,
        status: null,
        hint: "`oneuptime context list` shows the saved contexts.",
      },
    ];

    it.each(cases)("$error", (item: (typeof cases)[number]) => {
      const described: DescribedError = describeError(
        new Error(item.error),
        item.context || {},
      );

      expect({
        exitCode: described.exitCode,
        status: described.status,
        hint: described.hint,
        message: described.message,
      }).toEqual({
        exitCode: item.exitCode,
        status: item.status,
        hint: item.hint,
        message: item.error,
      });
    });
  });

  describe("ExitCode enum", () => {
    it("should have correct values", () => {
      expect(ExitCode.Success).toBe(0);
      expect(ExitCode.GeneralError).toBe(1);
      expect(ExitCode.AuthError).toBe(2);
      expect(ExitCode.NotFound).toBe(3);
    });
  });
});
