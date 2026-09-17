import {
  formatOutput,
  printSuccess,
  printError,
  printWarning,
  printInfo,
} from "../Core/OutputFormatter";
import { JSONObject } from "Common/Types/JSON";

describe("OutputFormatter", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let originalNoColor: string | undefined;
  let originalArgv: string[];

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    originalNoColor = process.env["NO_COLOR"];
    originalArgv = [...process.argv];
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (originalNoColor !== undefined) {
      process.env["NO_COLOR"] = originalNoColor;
    } else {
      delete process.env["NO_COLOR"];
    }
    process.argv = originalArgv;
  });

  describe("formatOutput with JSON format", () => {
    it("should format single object as JSON", () => {
      const data: Record<string, string> = { id: "123", name: "Test" };
      const result: string = formatOutput(data, "json");
      expect(JSON.parse(result)).toEqual(data);
    });

    it("should format array as JSON", () => {
      const data: Record<string, string>[] = [
        { id: "1", name: "A" },
        { id: "2", name: "B" },
      ];
      const result: string = formatOutput(data, "json");
      expect(JSON.parse(result)).toEqual(data);
    });

    it("should format null as JSON", () => {
      const result: string = formatOutput(null, "json");
      expect(result).toBe("null");
    });

    it("should format number as JSON", () => {
      const result: string = formatOutput(42, "json");
      expect(result).toBe("42");
    });

    it("should format string as JSON", () => {
      const result: string = formatOutput("hello", "json");
      expect(result).toBe('"hello"');
    });

    it("should format boolean as JSON", () => {
      const result: string = formatOutput(true, "json");
      expect(result).toBe("true");
    });
  });

  describe("formatOutput with table format", () => {
    it("should format array as table", () => {
      const data: Record<string, string>[] = [
        { _id: "1", name: "A" },
        { _id: "2", name: "B" },
      ];
      const result: string = formatOutput(data, "table");
      expect(result).toContain("1");
      expect(result).toContain("A");
      expect(result).toContain("2");
      expect(result).toContain("B");
    });

    it("should handle empty array", () => {
      const result: string = formatOutput([], "table");
      expect(result).toBe("No results found.");
    });

    it("should handle single object as key-value table", () => {
      const data: Record<string, string> = { name: "Test", status: "Active" };
      const result: string = formatOutput(data, "table");
      expect(result).toContain("Test");
      expect(result).toContain("Active");
    });

    it("should return 'No data returned.' for null in table mode", () => {
      const result: string = formatOutput(null, "table");
      expect(result).toBe("No data returned.");
    });

    it("should return 'No data returned.' for undefined in table mode", () => {
      const result: string = formatOutput(undefined as any, "table");
      expect(result).toBe("No data returned.");
    });

    it("should return 'No data returned.' for empty string in table mode", () => {
      const result: string = formatOutput("" as any, "table");
      expect(result).toBe("No data returned.");
    });

    it("should fallback to JSON for array of non-objects", () => {
      const data: string[] = ["a", "b", "c"];
      const result: string = formatOutput(data, "table");
      // First item is not an object, so should fallback to JSON
      expect(result).toContain('"a"');
    });

    it("should truncate long string values", () => {
      const longValue: string = "x".repeat(100);
      const data: Record<string, string>[] = [{ _id: "1", field: longValue }];
      const result: string = formatOutput(data, "table");
      expect(result).toContain("...");
    });

    it("should truncate long object values", () => {
      const bigObj: Record<string, string> = { a: "x".repeat(80) };
      const data: JSONObject[] = [{ _id: "1", nested: bigObj }];
      const result: string = formatOutput(data, "table");
      expect(result).toContain("...");
    });

    it("should show short object values without truncation", () => {
      const smallObj: Record<string, number> = { a: 1 };
      const data: JSONObject[] = [{ _id: "1", nested: smallObj }];
      const result: string = formatOutput(data, "table");
      expect(result).toContain('{"a":1}');
    });

    it("should render null values as empty in table", () => {
      const data: JSONObject[] = [{ _id: "1", value: null }];
      const result: string = formatOutput(data, "table");
      expect(result).toContain("1");
    });

    it("should render undefined values as empty in table", () => {
      const data: JSONObject[] = [{ _id: "1", value: undefined }];
      const result: string = formatOutput(data, "table");
      expect(result).toContain("1");
    });
  });

  describe("formatOutput with wide format", () => {
    it("should show all columns in wide mode", () => {
      const data: Record<string, string>[] = [
        {
          _id: "1",
          name: "A",
          col1: "x",
          col2: "y",
          col3: "z",
          col4: "w",
          col5: "v",
          col6: "u",
          col7: "t",
        },
      ];
      const result: string = formatOutput(data, "wide");
      expect(result).toContain("col7");
    });

    it("should limit columns in non-wide table mode", () => {
      const data: Record<string, string>[] = [
        {
          _id: "1",
          name: "A",
          col1: "x",
          col2: "y",
          col3: "z",
          col4: "w",
          col5: "v",
          col6: "u",
          col7: "t",
        },
      ];
      const result: string = formatOutput(data, "table");
      // Table mode should limit to 6 columns, so col7 should not appear
      expect(result).not.toContain("col7");
    });

    it("should prioritize common columns in non-wide mode", () => {
      const data: Record<string, string>[] = [
        {
          extra1: "a",
          extra2: "b",
          extra3: "c",
          extra4: "d",
          extra5: "e",
          extra6: "f",
          _id: "1",
          name: "Test",
          title: "Title",
          status: "Active",
          createdAt: "2024-01-01",
          updatedAt: "2024-01-02",
        },
      ];
      const result: string = formatOutput(data, "table");
      // Priority columns should appear
      expect(result).toContain("_id");
      expect(result).toContain("name");
    });
  });

  describe("format auto-detection", () => {
    it("should default to JSON when not a TTY", () => {
      const originalIsTTY: boolean | undefined = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        writable: true,
        configurable: true,
      });

      const data: Record<string, string> = { id: "1" };
      const result: string = formatOutput(data);
      expect(() => {
        return JSON.parse(result);
      }).not.toThrow();

      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });

    it("should default to table when TTY", () => {
      const originalIsTTY: boolean | undefined = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });

      const data: Record<string, string>[] = [{ _id: "1", name: "Test" }];
      const result: string = formatOutput(data);
      // Table format contains box-drawing characters
      expect(result).toContain("\u2500");

      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });

    it("should handle unknown format string and default to table via TTY check", () => {
      const data: Record<string, string>[] = [{ _id: "1" }];
      // "unknown" is not json/table/wide, so cliFormat falls through and TTY detection occurs
      const originalIsTTY: boolean | undefined = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });

      const result: string = formatOutput(data, "unknown");
      expect(result).toContain("\u2500");

      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("color handling", () => {
    it("should respect NO_COLOR env variable in table rendering", () => {
      process.env["NO_COLOR"] = "1";
      const data: Record<string, string>[] = [{ _id: "1", name: "A" }];
      const result: string = formatOutput(data, "table");
      // Should not contain ANSI color codes
      // eslint-disable-next-line no-control-regex
      expect(result).not.toMatch(/\x1b\[/);
    });

    it("should respect --no-color argv flag in table rendering", () => {
      process.argv.push("--no-color");
      const data: Record<string, string>[] = [{ _id: "1", name: "A" }];
      const result: string = formatOutput(data, "table");
      // eslint-disable-next-line no-control-regex
      expect(result).not.toMatch(/\x1b\[/);
    });

    it("should render single object without color when NO_COLOR set", () => {
      process.env["NO_COLOR"] = "1";
      const data: Record<string, string> = { name: "Test" };
      const result: string = formatOutput(data, "table");
      // eslint-disable-next-line no-control-regex
      expect(result).not.toMatch(/\x1b\[/);
      expect(result).toContain("name");
    });
  });

  describe("printSuccess", () => {
    it("should log success message with color", () => {
      delete process.env["NO_COLOR"];
      // Remove --no-color from argv if present
      process.argv = process.argv.filter((a: string) => {
        return a !== "--no-color";
      });
      printSuccess("OK");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should log success message without color when NO_COLOR is set", () => {
      process.env["NO_COLOR"] = "1";
      printSuccess("OK");
      expect(consoleLogSpy).toHaveBeenCalledWith("OK");
    });
  });

  describe("printError", () => {
    it("should log error message with color", () => {
      delete process.env["NO_COLOR"];
      process.argv = process.argv.filter((a: string) => {
        return a !== "--no-color";
      });
      printError("fail");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("should log error message without color when NO_COLOR is set", () => {
      process.env["NO_COLOR"] = "1";
      printError("fail");
      expect(consoleErrorSpy).toHaveBeenCalledWith("fail");
    });
  });

  describe("printWarning", () => {
    it("should log warning message with color", () => {
      delete process.env["NO_COLOR"];
      process.argv = process.argv.filter((a: string) => {
        return a !== "--no-color";
      });
      printWarning("warn");
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it("should log warning message without color when NO_COLOR is set", () => {
      process.env["NO_COLOR"] = "1";
      printWarning("warn");
      expect(consoleErrorSpy).toHaveBeenCalledWith("warn");
    });
  });

  describe("printInfo", () => {
    it("should log info message with color", () => {
      delete process.env["NO_COLOR"];
      process.argv = process.argv.filter((a: string) => {
        return a !== "--no-color";
      });
      printInfo("info");
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it("should log info message without color when NO_COLOR is set", () => {
      process.env["NO_COLOR"] = "1";
      printInfo("info");
      expect(consoleLogSpy).toHaveBeenCalledWith("info");
    });
  });
});
