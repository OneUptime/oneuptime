import { formatOutput } from "../Core/OutputFormatter";

describe("OutputFormatter", () => {
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
      // Wide mode should include all columns
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
      // Table mode should limit to 6 columns
      expect(result).not.toContain("col7");
    });
  });
});
