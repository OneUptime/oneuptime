import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  REQUIRED_COLUMN_DEFAULTS,
  RequiredColumnDefaultsContract,
  columnWithoutDefault,
  databaseDefaultOf,
  defaultedColumnsOf,
  withEveryRequiredColumnBut,
} from "../Helpers/RequiredColumnDefaults";
import { describe, expect, test } from "@jest/globals";

/*
 * The create contract of every column issue #5158 was one of.
 *
 * DatabaseService.checkRequiredFields answers "<column> is required" (a 400)
 * for a required column a create leaves out, unless the column is flagged
 * isDefaultValueColumn: then the insert leaves it out too, and Postgres
 * writes the column's DEFAULT. These 29 columns are required, and the API
 * reference and the Terraform schema list each as optional with a default -
 * but none was flagged, so a create that took the reference at its word was
 * refused. The Dashboard took it at its word too: a threat intel feed's and
 * a detection rule's create forms leave Enabled to the edit form (a new
 * feed is polled, a new rule runs), and every feed and rule created from
 * them was refused with "isEnabled is required".
 *
 * RequiredColumnsWithDefaultsGuard keeps every model to the rule. This file
 * holds each of the 29 to it through its own model's service: left out, or
 * sent as null, a column is let through and left to Postgres, whose DEFAULT
 * is the one the API reference names; a value sent is kept; and the check
 * still refuses a create without a column that has no default, so none of
 * this passes for a check that lets everything through.
 * RequiredColumnDefaultsPostgres writes the rows on a migrated Postgres.
 */

type RequiredFieldsCheck = {
  checkRequiredFields: (data: DatabaseBaseModel) => DatabaseBaseModel;
  modelType: DatabaseBaseModelType;
};

function checkOf(contract: RequiredColumnDefaultsContract): RequiredFieldsCheck {
  return contract.service as RequiredFieldsCheck;
}

function valueOf(model: DatabaseBaseModel, column: string): unknown {
  return (model as unknown as Record<string, unknown>)[column];
}

function setValue(
  model: DatabaseBaseModel,
  column: string,
  value: unknown,
): void {
  (model as unknown as Record<string, unknown>)[column] = value;
}

// A value other than the default, of the default's own kind.
function anotherValueThan(value: unknown): unknown {
  if (typeof value === "boolean") {
    return !value;
  }

  if (typeof value === "number") {
    return value + 1;
  }

  return `not ${String(value)}`;
}

describe("the columns issue #5158 found", () => {
  test("are the 29 the guard used to list, each held through its own model's service", () => {
    expect(
      REQUIRED_COLUMN_DEFAULTS.flatMap(
        (contract: RequiredColumnDefaultsContract): Array<string> => {
          return defaultedColumnsOf(contract).map((column: string): string => {
            return `${contract.modelType.name}.${column}`;
          });
        },
      ).sort(),
    ).toEqual([
      "DetectionRule.evaluationIntervalInMinutes",
      "DetectionRule.isEnabled",
      "DetectionRule.shouldCreateAlert",
      "DetectionRule.shouldWriteDetectionFinding",
      "LogPipelineProcessor.isEnabled",
      "LogRecordingRule.isEnabled",
      "LogSavedView.isDefault",
      "LogSavedView.pageSize",
      "MetricPipelineRule.filterCondition",
      "MetricPipelineRule.isEnabled",
      "MetricRecordingRule.isEnabled",
      "MetricSavedView.isDefault",
      "MonitorTest.isInQueue",
      "ProjectSmtpConfig.authType",
      "ProjectSmtpConfig.transportType",
      "SecurityEventConnection.alertingOnly",
      "SecurityEventConnection.isEnabled",
      "SecurityEventConnection.pollIntervalInMinutes",
      "SecurityEventDestination.isEnabled",
      "SecurityEventDestination.sendScope",
      "SecurityLogSource.isEnabled",
      "TableView.itemsOnPage",
      "ThreatIntelFeed.isEnabled",
      "ToolImportRecord.isComplete",
      "TracePipelineProcessor.isEnabled",
      "TraceRecordingRule.isEnabled",
      "TraceSavedView.isDefault",
      "WorkflowVariable.isSecret",
      "WorkflowVariable.variableType",
    ]);

    for (const contract of REQUIRED_COLUMN_DEFAULTS) {
      expect(checkOf(contract).modelType).toBe(contract.modelType);
    }
  });
});

describe.each(
  REQUIRED_COLUMN_DEFAULTS.map(
    (
      contract: RequiredColumnDefaultsContract,
    ): [string, RequiredColumnDefaultsContract] => {
      return [contract.modelType.name, contract];
    },
  ),
)(
  "%s create contract",
  (_name: string, contract: RequiredColumnDefaultsContract) => {
    const columns: Array<string> = defaultedColumnsOf(contract);

    test.each(contract.defaults)(
      "%s may be left out of a create, and Postgres writes %p",
      (column: string, value: unknown) => {
        const model: DatabaseBaseModel = new contract.modelType();

        expect(model.getTableColumnMetadata(column).required).toBe(true);
        expect(model.isDefaultValueColumn(column)).toBe(true);
        // What the API reference and the Terraform schema say...
        expect(model.getTableColumnMetadata(column).defaultValue).toBe(value);
        // ...is what the database writes.
        expect(databaseDefaultOf(contract.modelType, column)).toBe(value);
      },
    );

    test("the required-field check lets a create without them through, and leaves them to Postgres", () => {
      const created: DatabaseBaseModel = withEveryRequiredColumnBut(
        contract.modelType,
        columns,
      );

      expect(() => {
        return checkOf(contract).checkRequiredFields(created);
      }).not.toThrow();

      for (const column of columns) {
        expect(valueOf(created, column)).toBeUndefined();
      }
    });

    test("one sent as null is left to Postgres as well", () => {
      const created: DatabaseBaseModel = withEveryRequiredColumnBut(
        contract.modelType,
        columns,
      );

      for (const column of columns) {
        setValue(created, column, null);
      }

      expect(() => {
        return checkOf(contract).checkRequiredFields(created);
      }).not.toThrow();

      // Taken out of the insert, not written as NULL.
      for (const column of columns) {
        expect(valueOf(created, column)).toBeUndefined();
      }
    });

    test("a value sent for one is kept", () => {
      const created: DatabaseBaseModel = withEveryRequiredColumnBut(
        contract.modelType,
        columns,
      );

      for (const [column, value] of contract.defaults) {
        setValue(created, column, anotherValueThan(value));
      }

      checkOf(contract).checkRequiredFields(created);

      for (const [column, value] of contract.defaults) {
        expect(valueOf(created, column)).toEqual(anotherValueThan(value));
      }
    });

    test("the check still refuses a create without a column that has no default", () => {
      const refused: { column: string; leftOut: Array<string> } =
        columnWithoutDefault(contract.modelType);

      expect(() => {
        return checkOf(contract).checkRequiredFields(
          withEveryRequiredColumnBut(contract.modelType, [
            ...refused.leftOut,
            ...columns,
          ]),
        );
      }).toThrow(`${refused.column} is required`);
    });
  },
);
