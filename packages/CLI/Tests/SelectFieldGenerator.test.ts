import { generateAllFieldsSelect } from "../Utils/SelectFieldGenerator";
import { discoverResources } from "../Commands/ResourceCommands";
import { ResourceInfo } from "../Types/CLITypes";
import { JSONObject } from "Common/Types/JSON";
import DatabaseModelsDefault from "Common/Models/DatabaseModels/Index";
import AnalyticsModels from "Common/Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
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
 * fail when transitive dependencies are not resolvable by ts-jest). The Log
 * table is LogItemV3: this list said LogItemV2, a table no model has any
 * more, so the test that named it never reached the Log model.
 */
const AnalyticsTableName: {
  readonly Log: "LogItemV3";
} = {
  Log: "LogItemV3",
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
      /*
       * Every telemetry table the CLI has a command for. The analytics API
       * refuses a select that names a column its table does not have
       * ("Unknown column: ..."), and refuses with 422 one that names a
       * column with no read rule other than _id and createdAt, so a list
       * must ask for exactly what the table has and lets readers read.
       * The select used to be the database default, whose updatedAt no
       * telemetry table has: every telemetry list failed.
       */
      const telemetry: Array<ResourceInfo> = discoverResources().filter(
        (resource: ResourceInfo): boolean => {
          return resource.modelType === "analytics";
        },
      );

      function telemetryModel(tableName: string): AnalyticsBaseModel {
        const ModelClass: (new () => AnalyticsBaseModel) | undefined =
          AnalyticsModels.find(
            (Model: new () => AnalyticsBaseModel): boolean => {
              return new Model().tableName === tableName;
            },
          );

        if (!ModelClass) {
          throw new Error(`No analytics model for ${tableName}`);
        }

        return new ModelClass();
      }

      it("covers every telemetry command the CLI has", () => {
        expect(
          telemetry.map((resource: ResourceInfo): string => {
            return resource.name;
          }),
        ).toEqual(
          expect.arrayContaining(["log", "span", "metric", "change-event"]),
        );
      });

      it("never asks a telemetry table for a column it does not have, updatedAt included", () => {
        for (const resource of telemetry) {
          const model: AnalyticsBaseModel = telemetryModel(resource.tableName);
          const select: JSONObject = generateAllFieldsSelect(
            resource.tableName,
            "analytics",
          );
          const unknown: Array<string> = Object.keys(select).filter(
            (key: string): boolean => {
              return !model.getTableColumn(key);
            },
          );

          expect({ resource: resource.name, unknown }).toEqual({
            resource: resource.name,
            unknown: [],
          });
          expect(select).not.toHaveProperty("updatedAt");
        }
      });

      it("asks for every column readers may read, and for _id and createdAt", () => {
        for (const resource of telemetry) {
          const model: AnalyticsBaseModel = telemetryModel(resource.tableName);
          const select: JSONObject = generateAllFieldsSelect(
            resource.tableName,
            "analytics",
          );

          expect(select).toHaveProperty("_id", true);
          expect(select).toHaveProperty("createdAt", true);

          for (const column of model.getTableColumns()) {
            const read: Array<unknown> | undefined = column.accessControl?.read;

            if (read && read.length > 0) {
              expect({ resource: resource.name, [column.key]: true }).toEqual({
                resource: resource.name,
                [column.key]: select[column.key],
              });
            }
          }
        }
      });

      it("leaves out a column with no read rule, which the server reads as closed", () => {
        const model: AnalyticsBaseModel = telemetryModel(
          AnalyticsTableName.Log,
        );
        const retentionDate: { accessControl?: { read?: unknown } } =
          model.getTableColumn("retentionDate") as {
            accessControl?: { read?: unknown };
          };

        // The Log table's retention column declares no read rule.
        expect(retentionDate).toBeTruthy();
        expect(retentionDate.accessControl?.read).toBeUndefined();
        expect(
          generateAllFieldsSelect(AnalyticsTableName.Log, "analytics"),
        ).not.toHaveProperty("retentionDate");
      });

      it("reads a log's own fields: its time, severity and body", () => {
        const select: JSONObject = generateAllFieldsSelect(
          AnalyticsTableName.Log,
          "analytics",
        );

        for (const field of ["time", "severityText", "body", "traceId"]) {
          expect(select).toHaveProperty(field, true);
        }
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
        const origFind: unknown = DatabaseModels["find"];
        try {
          DatabaseModels["find"] = (): never => {
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
          DatabaseModels["find"] = origFind;
        }
      });

      it("should return default when getTableColumns returns empty", () => {
        const origGetTableColumns: unknown =
          tableColumnModule["getTableColumns"];
        try {
          tableColumnModule["getTableColumns"] = (): Record<
            string,
            unknown
          > => {
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
          tableColumnModule["getTableColumns"] = origGetTableColumns;
        }
      });

      it("should return default when all columns are filtered out", () => {
        const origGetTableColumns: unknown =
          tableColumnModule["getTableColumns"];
        const origFind: unknown = DatabaseModels["find"];

        try {
          tableColumnModule["getTableColumns"] = (): Record<
            string,
            Record<string, unknown>
          > => {
            return { field1: {}, field2: {} };
          };

          DatabaseModels["find"] = (
            fn: (model: unknown) => boolean,
          ): unknown => {
            function MockModel(this: Record<string, unknown>): void {
              this["tableName"] = "MockTable";
              this["getColumnAccessControlForAllColumns"] = (): Record<
                string,
                unknown
              > => {
                return {
                  field1: { read: [Permission["CurrentUser"]] },
                  field2: { read: [Permission["CurrentUser"]] },
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
          DatabaseModels["find"] = origFind;
          tableColumnModule["getTableColumns"] = origGetTableColumns;
        }
      });
    });
  });
});
