import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import Column from "../../../UI/Components/Table/Types/Column";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

/*
 * Concrete row shape used across the tests. A real ModelTable passes model
 * instances, but the utility only relies on property access / getColumnValue,
 * so plain objects exercise the same code paths.
 */
interface Row {
  name?: string | undefined;
  status?: string | undefined;
  isActive?: boolean | undefined;
  count?: number | undefined;
  label?: { name?: string } | null | undefined;
  severityText?: string | undefined;
  _id?: string | undefined;
}

describe("TableColumnsToCsv", () => {
  describe("escapeCsvValue", () => {
    test("leaves a plain value untouched", () => {
      expect(TableColumnsToCsv.escapeCsvValue("hello")).toBe("hello");
    });

    test("leaves an empty string untouched", () => {
      expect(TableColumnsToCsv.escapeCsvValue("")).toBe("");
    });

    test("quotes a value that contains a comma", () => {
      expect(TableColumnsToCsv.escapeCsvValue("a,b")).toBe('"a,b"');
    });

    test("quotes and doubles embedded quotes", () => {
      expect(TableColumnsToCsv.escapeCsvValue('she said "hi"')).toBe(
        '"she said ""hi"""',
      );
    });

    test("quotes a value that contains a newline", () => {
      expect(TableColumnsToCsv.escapeCsvValue("line1\nline2")).toBe(
        '"line1\nline2"',
      );
    });

    test("quotes a value that contains a carriage return", () => {
      expect(TableColumnsToCsv.escapeCsvValue("line1\r\nline2")).toBe(
        '"line1\r\nline2"',
      );
    });
  });

  describe("sanitizeForCsvInjection", () => {
    test("prefixes a value starting with =", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("=1+1")).toBe("'=1+1");
    });

    test("prefixes a value starting with +", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("+A1")).toBe("'+A1");
    });

    test("prefixes a value starting with @", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("@SUM(A1)")).toBe(
        "'@SUM(A1)",
      );
    });

    test("prefixes a value starting with a tab", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("\tvalue")).toBe(
        "'\tvalue",
      );
    });

    test("does not prefix a negative number so numbers survive", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("-5")).toBe("-5");
    });

    test("does not prefix a normal value", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("normal")).toBe(
        "normal",
      );
    });

    test("leaves an empty string untouched", () => {
      expect(TableColumnsToCsv.sanitizeForCsvInjection("")).toBe("");
    });
  });

  describe("getRawValueByPath", () => {
    test("reads a top-level property from a plain object", () => {
      expect(
        TableColumnsToCsv.getRawValueByPath({ name: "Prod" }, "name"),
      ).toBe("Prod");
    });

    test("reads a nested property with dot notation", () => {
      const item: Row = { label: { name: "Critical" } };
      expect(TableColumnsToCsv.getRawValueByPath(item, "label.name")).toBe(
        "Critical",
      );
    });

    test("preserves the falsy value false (does not treat it as missing)", () => {
      expect(
        TableColumnsToCsv.getRawValueByPath({ isActive: false }, "isActive"),
      ).toBe(false);
    });

    test("preserves the falsy value 0", () => {
      expect(TableColumnsToCsv.getRawValueByPath({ count: 0 }, "count")).toBe(
        0,
      );
    });

    test("returns undefined for a missing key", () => {
      expect(
        TableColumnsToCsv.getRawValueByPath({ name: "x" }, "missing"),
      ).toBeUndefined();
    });

    test("stops and returns the nullish value when a branch is null", () => {
      const item: Row = { label: null };
      expect(
        TableColumnsToCsv.getRawValueByPath(item, "label.name"),
      ).toBeNull();
    });

    test("a null branch formats to an empty CSV cell", () => {
      const column: Column<Row> = {
        title: "Label",
        type: FieldType.Text,
        key: "label.name" as keyof Row,
      };
      expect(TableColumnsToCsv.getCellValue({ label: null }, column)).toBe("");
    });

    test("falls back to getColumnValue for analytics-style models", () => {
      // Analytics models keep values in an internal map, only reachable via getColumnValue.
      const analyticsLike: {
        data: Record<string, unknown>;
        getColumnValue: (name: string) => unknown;
      } = {
        data: { severityText: "Error" },
        getColumnValue(name: string): unknown {
          return this.data[name];
        },
      };

      expect(
        TableColumnsToCsv.getRawValueByPath(analyticsLike, "severityText"),
      ).toBe("Error");
    });

    test("prefers direct property access over getColumnValue", () => {
      const hybrid: { name: string; getColumnValue: () => unknown } = {
        name: "direct",
        getColumnValue(): unknown {
          return "from-getter";
        },
      };

      expect(TableColumnsToCsv.getRawValueByPath(hybrid, "name")).toBe(
        "direct",
      );
    });
  });

  describe("formatValueForCsv", () => {
    test("returns empty string for null", () => {
      expect(TableColumnsToCsv.formatValueForCsv(null, FieldType.Text)).toBe(
        "",
      );
    });

    test("returns empty string for undefined", () => {
      expect(
        TableColumnsToCsv.formatValueForCsv(undefined, FieldType.Text),
      ).toBe("");
    });

    test("formats a Date column using the friendly date-only format", () => {
      const date: Date = new Date("2024-01-31T10:30:00.000Z");
      expect(TableColumnsToCsv.formatValueForCsv(date, FieldType.Date)).toBe(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, true),
      );
    });

    test("formats a DateTime column using the friendly date+time format", () => {
      const date: Date = new Date("2024-01-31T10:30:00.000Z");
      expect(
        TableColumnsToCsv.formatValueForCsv(date, FieldType.DateTime),
      ).toBe(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, false),
      );
    });

    test("formats an ISO date string for a Date column", () => {
      const iso: string = "2024-01-31T10:30:00.000Z";
      expect(TableColumnsToCsv.formatValueForCsv(iso, FieldType.Date)).toBe(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(iso, true),
      );
    });

    test("formats Boolean true as Yes", () => {
      expect(TableColumnsToCsv.formatValueForCsv(true, FieldType.Boolean)).toBe(
        "Yes",
      );
    });

    test("formats Boolean false as No", () => {
      expect(
        TableColumnsToCsv.formatValueForCsv(false, FieldType.Boolean),
      ).toBe("No");
    });

    test("formats USDCents into dollars", () => {
      expect(
        TableColumnsToCsv.formatValueForCsv(2500, FieldType.USDCents),
      ).toBe("25 USD");
    });

    test("formats a Percent value", () => {
      expect(TableColumnsToCsv.formatValueForCsv(80, FieldType.Percent)).toBe(
        "80%",
      );
    });

    test("stringifies a plain number for a Number column", () => {
      expect(TableColumnsToCsv.formatValueForCsv(42, FieldType.Number)).toBe(
        "42",
      );
    });

    test("uses a value's custom toString (ObjectID)", () => {
      const id: ObjectID = new ObjectID("resource-123");
      expect(TableColumnsToCsv.formatValueForCsv(id, FieldType.ObjectID)).toBe(
        "resource-123",
      );
    });

    test("extracts name from an entity-like object", () => {
      const entity: Row = { _id: "1", name: "Production" };
      expect(
        TableColumnsToCsv.formatValueForCsv(entity, FieldType.Entity),
      ).toBe("Production");
    });

    test("joins arrays of scalar values with a semicolon", () => {
      expect(
        TableColumnsToCsv.formatValueForCsv(
          ["one", "two", "three"],
          FieldType.ArrayOfText,
        ),
      ).toBe("one; two; three");
    });

    test("joins arrays of entity-like objects using their names", () => {
      const values: Array<Row> = [{ name: "A" }, { name: "B" }];
      expect(
        TableColumnsToCsv.formatValueForCsv(values, FieldType.EntityArray),
      ).toBe("A; B");
    });

    test("skips empty elements when joining arrays", () => {
      expect(
        TableColumnsToCsv.formatValueForCsv(
          ["a", "", "b"],
          FieldType.ArrayOfText,
        ),
      ).toBe("a; b");
    });
  });

  describe("getExportableColumns", () => {
    const columns: Columns<Row> = [
      { title: "Name", type: FieldType.Text, key: "name" },
      { title: "Actions", type: FieldType.Actions, key: null },
      { title: "Custom", type: FieldType.Element },
      { title: "Status", type: FieldType.Text, key: "status" },
    ];

    test("excludes the Actions column", () => {
      const result: Columns<Row> =
        TableColumnsToCsv.getExportableColumns(columns);
      expect(
        result.find((c: Column<Row>) => {
          return c.title === "Actions";
        }),
      ).toBeUndefined();
    });

    test("excludes columns without a data key", () => {
      const result: Columns<Row> =
        TableColumnsToCsv.getExportableColumns(columns);
      expect(
        result.find((c: Column<Row>) => {
          return c.title === "Custom";
        }),
      ).toBeUndefined();
    });

    test("keeps columns that have a key", () => {
      const result: Columns<Row> =
        TableColumnsToCsv.getExportableColumns(columns);
      expect(
        result.map((c: Column<Row>) => {
          return c.title;
        }),
      ).toEqual(["Name", "Status"]);
    });

    test("handles undefined columns gracefully", () => {
      expect(
        TableColumnsToCsv.getExportableColumns(
          undefined as unknown as Columns<Row>,
        ),
      ).toEqual([]);
    });
  });

  describe("getCellValue", () => {
    test("returns empty string for a keyless column", () => {
      const column: Column<Row> = {
        title: "X",
        type: FieldType.Text,
        key: null,
      };
      expect(TableColumnsToCsv.getCellValue({ name: "y" }, column)).toBe("");
    });

    test("formats the value at the column key", () => {
      const column: Column<Row> = {
        title: "Active",
        type: FieldType.Boolean,
        key: "isActive",
      };
      expect(TableColumnsToCsv.getCellValue({ isActive: false }, column)).toBe(
        "No",
      );
    });
  });

  describe("convertToCsv", () => {
    const columns: Columns<Row> = [
      { title: "Name", type: FieldType.Text, key: "name" },
      { title: "Active", type: FieldType.Boolean, key: "isActive" },
      { title: "Actions", type: FieldType.Actions, key: null },
    ];

    test("builds a header row from exportable columns only", () => {
      const csv: string = TableColumnsToCsv.convertToCsv({
        items: [],
        columns: columns,
      });
      expect(csv).toBe("Name,Active");
    });

    test("builds one row per item and separates rows with CRLF", () => {
      const items: Array<Row> = [
        { name: "Alpha", isActive: true },
        { name: "Beta", isActive: false },
      ];

      const csv: string = TableColumnsToCsv.convertToCsv({
        items: items,
        columns: columns,
      });

      expect(csv).toBe("Name,Active\r\nAlpha,Yes\r\nBeta,No");
    });

    test("escapes values that contain commas", () => {
      const items: Array<Row> = [{ name: "Smith, John", isActive: true }];
      const csv: string = TableColumnsToCsv.convertToCsv({
        items: items,
        columns: [{ title: "Name", type: FieldType.Text, key: "name" }],
      });
      expect(csv).toBe('Name\r\n"Smith, John"');
    });

    test("neutralizes formula injection in cell values", () => {
      const items: Array<Row> = [{ name: "=cmd()" }];
      const csv: string = TableColumnsToCsv.convertToCsv({
        items: items,
        columns: [{ title: "Name", type: FieldType.Text, key: "name" }],
      });
      expect(csv).toBe("Name\r\n'=cmd()");
    });

    test("renders missing values as empty cells", () => {
      const items: Array<Row> = [{ name: "OnlyName" }];
      const csv: string = TableColumnsToCsv.convertToCsv({
        items: items,
        columns: columns,
      });
      expect(csv).toBe("Name,Active\r\nOnlyName,");
    });

    test("handles undefined items gracefully", () => {
      const csv: string = TableColumnsToCsv.convertToCsv({
        items: undefined as unknown as Array<Row>,
        columns: columns,
      });
      expect(csv).toBe("Name,Active");
    });
  });

  describe("getExportFilename", () => {
    test("slugifies the label and appends the csv extension", () => {
      const filename: string =
        TableColumnsToCsv.getExportFilename("Monitor Probes");
      expect(filename).toMatch(
        /^monitor-probes-export-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.csv$/,
      );
    });

    test("collapses non-alphanumeric runs and trims dashes", () => {
      const filename: string = TableColumnsToCsv.getExportFilename(
        "  On-Call!! Policies  ",
      );
      expect(filename.startsWith("on-call-policies-export-")).toBe(true);
      expect(filename.endsWith(".csv")).toBe(true);
    });

    test("falls back to 'table' for an empty label", () => {
      const filename: string = TableColumnsToCsv.getExportFilename("");
      expect(filename.startsWith("table-export-")).toBe(true);
    });
  });

  describe("downloadCsv and exportItemsToCsv", () => {
    let createObjectURLMock: MockFunction;
    let revokeObjectURLMock: MockFunction;
    let clickSpy: jest.SpyInstance;
    let createElementSpy: jest.SpyInstance;
    let capturedAnchor: HTMLAnchorElement | null;

    beforeEach(() => {
      capturedAnchor = null;

      createObjectURLMock = getJestMockFunction();
      createObjectURLMock.mockReturnValue("blob:mock-url");
      revokeObjectURLMock = getJestMockFunction();

      (window.URL as unknown as { createObjectURL: unknown }).createObjectURL =
        createObjectURLMock;
      (window.URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL =
        revokeObjectURLMock;

      clickSpy = jest
        .spyOn(HTMLAnchorElement.prototype, "click")
        .mockImplementation(() => {});

      const originalCreateElement: (tagName: string) => HTMLElement =
        document.createElement.bind(document);

      createElementSpy = jest
        .spyOn(document, "createElement")
        .mockImplementation(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ((tagName: string): HTMLElement => {
            const element: HTMLElement = originalCreateElement(tagName);
            if (tagName === "a") {
              capturedAnchor = element as HTMLAnchorElement;
            }
            return element;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          }) as any,
        );
    });

    afterEach(() => {
      clickSpy.mockRestore();
      createElementSpy.mockRestore();
    });

    test("downloadCsv creates a link, triggers a download, and revokes the url", () => {
      TableColumnsToCsv.downloadCsv({
        csv: "a,b\r\n1,2",
        filename: "data.csv",
      });

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:mock-url");
      expect(capturedAnchor).not.toBeNull();
      expect(capturedAnchor!.download).toBe("data.csv");
      expect(capturedAnchor!.href).toContain("blob:mock-url");
      // Anchor is cleaned up from the DOM after the click.
      expect(document.body.contains(capturedAnchor)).toBe(false);
    });

    test("downloadCsv builds a text/csv blob", () => {
      TableColumnsToCsv.downloadCsv({ csv: "x", filename: "x.csv" });

      const blobArg: Blob = createObjectURLMock.mock.calls[0]![0] as Blob;
      expect(blobArg).toBeInstanceOf(Blob);
      expect(blobArg.type).toContain("text/csv");
    });

    test("exportItemsToCsv builds the CSV and downloads it end-to-end", () => {
      const columns: Columns<Row> = [
        { title: "Name", type: FieldType.Text, key: "name" },
      ];

      TableColumnsToCsv.exportItemsToCsv({
        items: [{ name: "Alpha" }],
        columns: columns,
        label: "Monitors",
      });

      expect(createObjectURLMock).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(capturedAnchor).not.toBeNull();
      expect(capturedAnchor!.download).toMatch(/^monitors-export-.*\.csv$/);
    });
  });
});
