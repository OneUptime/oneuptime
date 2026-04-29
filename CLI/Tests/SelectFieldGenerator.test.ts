import { generateAllFieldsSelect } from "../Utils/SelectFieldGenerator";
import { JSONObject } from "Common/Types/JSON";
import DatabaseModelsDefault from "Common/Models/DatabaseModels/Index";
import * as TableColumnModule from "Common/Types/Database/TableColumn";
import PermissionDefault from "Common/Types/Permission";

const DatabaseModels: Record<string, unknown> =
  DatabaseModelsDefault as unknown as Record<string, unknown>;
const tableColumnModule: Record<string, unknown> =
  TableColumnModule as unknown as Record<string, unknown>;
const Permission: Record<string, unknown> =
  PermissionDefault as unknown as Record<string, unknown>;

/*
 * AnalyticsTableName enum values used in tests (avoids deep import that can
 * fail when transitive dependencies are not resolvable by ts-jest).
 */
const AnalyticsTableName: {
  readonly Log: "LogItemV2";
} = {
  Log: "LogItemV2",
} as const;

describe("SelectFieldGenerator", () => {
  describe("generateAllFieldsSelect", () => {
    describe("database models", () => {
      it("should return fields for a known database model (Incident)", () => {
        const select: JSONObject = generateAllFieldsSelect(
          "Incident",
          "database",
        );
        expect(Object.keys(select).length).toBeGreaterThan(0);
        // Should have some common fields
        expect(select).toHaveProperty("_id");
      });

      it("should return fields for Monitor model", () => {
        const select: JSONObject = generateAllFieldsSelect(
          "Monitor",
          "database",
        );
        expect(Object.keys(select).length).toBeGreaterThan(0);
      });

      it("should return default select for unknown database model", () => {
        const select: JSONObject = generateAllFieldsSelect(
          "NonExistentModel12345",
          "database",
        );
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });

      it("should filter fields based on access control", () => {
        // Testing with a real model that has access control
        const select: JSONObject = generateAllFieldsSelect(
          "Incident",
          "database",
        );
        // We just verify it returns something reasonable
        expect(typeof select).toBe("object");
        expect(Object.keys(select).length).toBeGreaterThan(0);
      });
    });

    describe("analytics models", () => {
      it("should return default select for known analytics model (Log)", () => {
        const select: JSONObject = generateAllFieldsSelect(
          AnalyticsTableName.Log,
          "analytics",
        );
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });

      it("should return default select for unknown analytics model", () => {
        const select: JSONObject = generateAllFieldsSelect(
          "NonExistentAnalytics",
          "analytics",
        );
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });
    });

    describe("edge cases", () => {
      it("should return default select for unknown model type", () => {
        const select: JSONObject = generateAllFieldsSelect(
          "Incident",
          "unknown" as any,
        );
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });

      it("should return default select for empty tableName", () => {
        const select: JSONObject = generateAllFieldsSelect("", "database");
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });

      it("should handle outer exception and return default select", () => {
        const origFind: unknown = DatabaseModels.find;
        try {
          DatabaseModels.find = (): never => {
            throw new Error("Simulated error");
          };

          const select: JSONObject = generateAllFieldsSelect(
            "Incident",
            "database",
          );
          expect(select).toEqual({
            _id: true,
            createdAt: true,
            updatedAt: true,
          });
        } finally {
          DatabaseModels.find = origFind;
        }
      });

      it("should return default when getTableColumns returns empty", () => {
        const origGetTableColumns: unknown = tableColumnModule.getTableColumns;
        try {
          tableColumnModule.getTableColumns = (): Record<string, unknown> => {
            return {};
          };

          const select: JSONObject = generateAllFieldsSelect(
            "Incident",
            "database",
          );
          expect(select).toEqual({
            _id: true,
            createdAt: true,
            updatedAt: true,
          });
        } finally {
          tableColumnModule.getTableColumns = origGetTableColumns;
        }
      });

      it("should return default when all columns are filtered out", () => {
        const origGetTableColumns: unknown = tableColumnModule.getTableColumns;
        const origFind: unknown = DatabaseModels.find;

        try {
          tableColumnModule.getTableColumns = (): Record<
            string,
            Record<string, unknown>
          > => {
            return { field1: {}, field2: {} };
          };

          DatabaseModels.find = (fn: (model: unknown) => boolean): unknown => {
            function MockModel(this: Record<string, unknown>): void {
              this.tableName = "MockTable";
              this.getColumnAccessControlForAllColumns = (): Record<
                string,
                unknown
              > => {
                return {
                  field1: { read: [Permission.CurrentUser] },
                  field2: { read: [Permission.CurrentUser] },
                };
              };
            }
            const matches: boolean = fn(MockModel);
            if (matches) {
              return MockModel;
            }
            return undefined;
          };

          const select: JSONObject = generateAllFieldsSelect(
            "MockTable",
            "database",
          );
          expect(select).toEqual({
            _id: true,
            createdAt: true,
            updatedAt: true,
          });
        } finally {
          DatabaseModels.find = origFind;
          tableColumnModule.getTableColumns = origGetTableColumns;
        }
      });
    });
  });
});
