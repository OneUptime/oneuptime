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
