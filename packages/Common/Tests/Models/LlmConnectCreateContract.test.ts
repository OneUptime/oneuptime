import LlmCostBudget from "../../Models/DatabaseModels/LlmCostBudget";
import LlmObservabilityConnection from "../../Models/DatabaseModels/LlmObservabilityConnection";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LlmBudgetSpendSource from "../../Types/LlmObservability/LlmBudgetSpendSource";
import LlmConversationReaders from "../../Types/LlmObservability/LlmConversationReaders";
import LlmCostBudgetService from "../../Server/Services/LlmCostBudgetService";
import LlmObservabilityConnectionService from "../../Server/Services/LlmObservabilityConnectionService";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The create contract of the columns AI / LLM Connect (#5095) added with a
 * default. DatabaseService.checkRequiredFields answers "<column> is
 * required" (a 400) for a required column a create leaves out, unless the
 * column is flagged isDefaultValueColumn: then the insert leaves it out too
 * and Postgres writes the column's DEFAULT.
 *
 * LlmCostBudget.spendSource was added to a model API and Terraform clients
 * already create: without the flag, every budget created the way it was
 * before the column existed was refused ("spendSource is required"), though
 * the API reference and the Terraform schema list the column as optional
 * with a default, and the service promises "Unset keeps the default (the
 * project's AI calls)". The Dashboard's form always sends the column, so
 * only a test keeps this honest. A connection's switches and its readers
 * are the same: optional with a default, as the API reference says.
 */

type RequiredFieldsAccess = {
  checkRequiredFields: (data: DatabaseBaseModel) => DatabaseBaseModel;
};

// Every required column given a value, except the ones a create leaves out.
function withEveryRequiredColumnBut(
  model: DatabaseBaseModel,
  leftOut: Array<string>,
): DatabaseBaseModel {
  for (const column of model.getRequiredColumns().columns) {
    if (leftOut.includes(column)) {
      continue;
    }

    (model as unknown as Record<string, unknown>)[column] = "given";
  }

  return model;
}

// The DEFAULT Postgres writes for a column the insert leaves out.
function databaseDefaultOf(
  target: DatabaseBaseModelType,
  propertyName: string,
): unknown {
  const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === target && args.propertyName === propertyName;
    })
    .pop();

  return column?.options.default;
}

describe("LlmCostBudget create contract", () => {
  const budget: LlmCostBudget = new LlmCostBudget();

  test("spendSource may be left out of a create", () => {
    expect(budget.getTableColumnMetadata("spendSource").required).toBe(true);
    expect(budget.isDefaultValueColumn("spendSource")).toBe(true);
  });

  test("a budget left without spendSource counts the project's AI calls, as every budget before the column did", () => {
    expect(budget.getTableColumnMetadata("spendSource").defaultValue).toBe(
      LlmBudgetSpendSource.Calls,
    );
    expect(databaseDefaultOf(LlmCostBudget, "spendSource")).toBe(
      LlmBudgetSpendSource.Calls,
    );
  });

  test("the required-field check lets a budget without spendSource through", () => {
    const service: RequiredFieldsAccess =
      LlmCostBudgetService as unknown as RequiredFieldsAccess;
    const created: DatabaseBaseModel = withEveryRequiredColumnBut(
      new LlmCostBudget(),
      ["spendSource"],
    );

    expect(() => {
      return service.checkRequiredFields(created);
    }).not.toThrow();
    // Left out of the insert, so Postgres writes the default.
    expect((created as LlmCostBudget).spendSource).toBeUndefined();
  });

  test("the check still refuses a budget without a column that has no default", () => {
    const service: RequiredFieldsAccess =
      LlmCostBudgetService as unknown as RequiredFieldsAccess;

    expect(() => {
      return service.checkRequiredFields(
        withEveryRequiredColumnBut(new LlmCostBudget(), ["name"]),
      );
    }).toThrow("name is required");
  });
});

describe("LlmObservabilityConnection create contract", () => {
  const connection: LlmObservabilityConnection =
    new LlmObservabilityConnection();

  const DEFAULTS: Array<[string, unknown]> = [
    ["isEnabled", true],
    ["storeConversationText", true],
    ["conversationReaders", LlmConversationReaders.Admins],
  ];

  test.each(DEFAULTS)(
    "%s may be left out of a create, and Postgres writes %p",
    (column: string, value: unknown) => {
      expect(connection.getTableColumnMetadata(column).required).toBe(true);
      expect(connection.isDefaultValueColumn(column)).toBe(true);
      expect(connection.getTableColumnMetadata(column).defaultValue).toBe(
        value,
      );
      expect(databaseDefaultOf(LlmObservabilityConnection, column)).toBe(value);
    },
  );

  test("the required-field check lets a connection without them through", () => {
    const service: RequiredFieldsAccess =
      LlmObservabilityConnectionService as unknown as RequiredFieldsAccess;
    const leftOut: Array<string> = DEFAULTS.map(
      (entry: [string, unknown]): string => {
        return entry[0];
      },
    );
    const created: DatabaseBaseModel = withEveryRequiredColumnBut(
      new LlmObservabilityConnection(),
      leftOut,
    );

    expect(() => {
      return service.checkRequiredFields(created);
    }).not.toThrow();

    for (const column of leftOut) {
      expect(
        (created as unknown as Record<string, unknown>)[column],
      ).toBeUndefined();
    }
  });
});
