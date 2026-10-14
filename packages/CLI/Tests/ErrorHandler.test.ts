import { handleError, ExitCode } from "../Core/ErrorHandler";
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

  describe("ExitCode enum", () => {
    it("should have correct values", () => {
      expect(ExitCode.Success).toBe(0);
      expect(ExitCode.GeneralError).toBe(1);
      expect(ExitCode.AuthError).toBe(2);
      expect(ExitCode.NotFound).toBe(3);
    });
  });
});
