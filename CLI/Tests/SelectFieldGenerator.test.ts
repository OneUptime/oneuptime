import { generateAllFieldsSelect } from "../Utils/SelectFieldGenerator";

describe("SelectFieldGenerator", () => {
  describe("generateAllFieldsSelect", () => {
    describe("database models", () => {
      it("should return fields for a known database model (Incident)", () => {
        const select = generateAllFieldsSelect("Incident", "database");
        expect(Object.keys(select).length).toBeGreaterThan(0);
        // Should have some common fields
        expect(select).toHaveProperty("_id");
      });

      it("should return fields for Monitor model", () => {
        const select = generateAllFieldsSelect("Monitor", "database");
        expect(Object.keys(select).length).toBeGreaterThan(0);
      });

      it("should return default select for unknown database model", () => {
        const select = generateAllFieldsSelect(
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
        const select = generateAllFieldsSelect("Incident", "database");
        // We just verify it returns something reasonable
        expect(typeof select).toBe("object");
        expect(Object.keys(select).length).toBeGreaterThan(0);
      });
    });

    describe("analytics models", () => {
      it("should return default select for known analytics model (LogItem)", () => {
        // The Log analytics model has tableName "LogItem"
        const select = generateAllFieldsSelect("LogItem", "analytics");
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });

      it("should return default select for unknown analytics model", () => {
        const select = generateAllFieldsSelect(
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
        const select = generateAllFieldsSelect(
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
        const select = generateAllFieldsSelect("", "database");
        expect(select).toEqual({
          _id: true,
          createdAt: true,
          updatedAt: true,
        });
      });

      it("should handle outer exception and return default select", () => {
        const DatabaseModels = require("Common/Models/DatabaseModels/Index").default;
        const origFind = DatabaseModels.find;
        try {
          DatabaseModels.find = () => {
            throw new Error("Simulated error");
          };

          const select = generateAllFieldsSelect("Incident", "database");
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
        const tableColumnModule = require("Common/Types/Database/TableColumn");
        const origGetTableColumns = tableColumnModule.getTableColumns;
        try {
          tableColumnModule.getTableColumns = () => ({});

          const select = generateAllFieldsSelect("Incident", "database");
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
        const tableColumnModule = require("Common/Types/Database/TableColumn");
        const origGetTableColumns = tableColumnModule.getTableColumns;
        const DatabaseModels = require("Common/Models/DatabaseModels/Index").default;
        const origFind = DatabaseModels.find;
        const Permission = require("Common/Types/Permission").default;

        try {
          tableColumnModule.getTableColumns = () => ({ field1: {}, field2: {} });

          DatabaseModels.find = (fn) => {
            function MockModel() {
              this.tableName = "MockTable";
              this.getColumnAccessControlForAllColumns = () => ({
                field1: { read: [Permission.CurrentUser] },
                field2: { read: [Permission.CurrentUser] },
              });
            }
            const matches = fn(MockModel);
            if (matches) return MockModel;
            return undefined;
          };

          const select = generateAllFieldsSelect("MockTable", "database");
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
