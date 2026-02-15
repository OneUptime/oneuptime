import {
  formatOutput,
  printSuccess,
  printError,
  printWarning,
  printInfo,
} from "../Core/OutputFormatter";

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
      const data = { id: "123", name: "Test" };
      const result = formatOutput(data, "json");
      expect(JSON.parse(result)).toEqual(data);
    });

    it("should format array as JSON", () => {
      const data = [
        { id: "1", name: "A" },
        { id: "2", name: "B" },
      ];
      const result = formatOutput(data, "json");
      expect(JSON.parse(result)).toEqual(data);
    });

    it("should format null as JSON", () => {
      const result = formatOutput(null, "json");
      expect(result).toBe("null");
    });

    it("should format number as JSON", () => {
      const result = formatOutput(42, "json");
      expect(result).toBe("42");
    });

    it("should format string as JSON", () => {
      const result = formatOutput("hello", "json");
      expect(result).toBe('"hello"');
    });

    it("should format boolean as JSON", () => {
      const result = formatOutput(true, "json");
      expect(result).toBe("true");
    });
  });

  describe("formatOutput with table format", () => {
    it("should format array as table", () => {
      const data = [
        { _id: "1", name: "A" },
        { _id: "2", name: "B" },
      ];
      const result = formatOutput(data, "table");
      expect(result).toContain("1");
      expect(result).toContain("A");
      expect(result).toContain("2");
      expect(result).toContain("B");
    });

    it("should handle empty array", () => {
      const result = formatOutput([], "table");
      expect(result).toBe("No results found.");
    });

    it("should handle single object as key-value table", () => {
      const data = { name: "Test", status: "Active" };
      const result = formatOutput(data, "table");
      expect(result).toContain("Test");
      expect(result).toContain("Active");
    });

    it("should return 'No data returned.' for null in table mode", () => {
      const result = formatOutput(null, "table");
      expect(result).toBe("No data returned.");
    });

    it("should return 'No data returned.' for undefined in table mode", () => {
      const result = formatOutput(undefined as any, "table");
      expect(result).toBe("No data returned.");
    });

    it("should return 'No data returned.' for empty string in table mode", () => {
      const result = formatOutput("" as any, "table");
      expect(result).toBe("No data returned.");
    });

    it("should fallback to JSON for array of non-objects", () => {
      const data = ["a", "b", "c"];
      const result = formatOutput(data, "table");
      // First item is not an object, so should fallback to JSON
      expect(result).toContain('"a"');
    });

    it("should truncate long string values", () => {
      const longValue = "x".repeat(100);
      const data = [{ _id: "1", field: longValue }];
      const result = formatOutput(data, "table");
      expect(result).toContain("...");
    });

    it("should truncate long object values", () => {
      const bigObj = { a: "x".repeat(80) };
      const data = [{ _id: "1", nested: bigObj }];
      const result = formatOutput(data, "table");
      expect(result).toContain("...");
    });

    it("should show short object values without truncation", () => {
      const smallObj = { a: 1 };
      const data = [{ _id: "1", nested: smallObj }];
      const result = formatOutput(data, "table");
      expect(result).toContain('{"a":1}');
    });

    it("should render null values as empty in table", () => {
      const data = [{ _id: "1", value: null }];
      const result = formatOutput(data, "table");
      expect(result).toContain("1");
    });

    it("should render undefined values as empty in table", () => {
      const data = [{ _id: "1", value: undefined }];
      const result = formatOutput(data, "table");
      expect(result).toContain("1");
    });
  });

  describe("formatOutput with wide format", () => {
    it("should show all columns in wide mode", () => {
      const data = [
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
      const result = formatOutput(data, "wide");
      expect(result).toContain("col7");
    });

    it("should limit columns in non-wide table mode", () => {
      const data = [
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
      const result = formatOutput(data, "table");
      // Table mode should limit to 6 columns, so col7 should not appear
      expect(result).not.toContain("col7");
    });

    it("should prioritize common columns in non-wide mode", () => {
      const data = [
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
      const result = formatOutput(data, "table");
      // Priority columns should appear
      expect(result).toContain("_id");
      expect(result).toContain("name");
    });
  });

  describe("format auto-detection", () => {
    it("should default to JSON when not a TTY", () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: false,
        writable: true,
        configurable: true,
      });

      const data = { id: "1" };
      const result = formatOutput(data);
      expect(() => JSON.parse(result)).not.toThrow();

      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });

    it("should default to table when TTY", () => {
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });

      const data = [{ _id: "1", name: "Test" }];
      const result = formatOutput(data);
      // Table format contains box-drawing characters
      expect(result).toContain("─");

      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        writable: true,
        configurable: true,
      });
    });

    it("should handle unknown format string and default to table via TTY check", () => {
      const data = [{ _id: "1" }];
      // "unknown" is not json/table/wide, so cliFormat falls through and TTY detection occurs
      const originalIsTTY = process.stdout.isTTY;
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        writable: true,
        configurable: true,
      });

      const result = formatOutput(data, "unknown");
      expect(result).toContain("─");

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
      const data = [{ _id: "1", name: "A" }];
      const result = formatOutput(data, "table");
      // Should not contain ANSI color codes
      expect(result).not.toMatch(/\x1b\[/);
    });

    it("should respect --no-color argv flag in table rendering", () => {
      process.argv.push("--no-color");
      const data = [{ _id: "1", name: "A" }];
      const result = formatOutput(data, "table");
      expect(result).not.toMatch(/\x1b\[/);
    });

    it("should render single object without color when NO_COLOR set", () => {
      process.env["NO_COLOR"] = "1";
      const data = { name: "Test" };
      const result = formatOutput(data, "table");
      expect(result).not.toMatch(/\x1b\[/);
      expect(result).toContain("name");
    });
  });

  describe("printSuccess", () => {
    it("should log success message with color", () => {
      delete process.env["NO_COLOR"];
      // Remove --no-color from argv if present
      process.argv = process.argv.filter((a) => a !== "--no-color");
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
      process.argv = process.argv.filter((a) => a !== "--no-color");
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
      process.argv = process.argv.filter((a) => a !== "--no-color");
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
      process.argv = process.argv.filter((a) => a !== "--no-color");
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
