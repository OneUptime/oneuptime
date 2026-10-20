import { describe, expect, test } from "@jest/globals";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Models from "../../Models/DatabaseModels/Index";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";

/*
 * GUARD: A REQUIRED COLUMN THAT DECLARES A DEFAULT CAN BE LEFT OUT OF A
 * CREATE.
 *
 * A @TableColumn's defaultValue is what the API reference and the Terraform
 * schema promise a client: the column is optional on create, with that
 * default (ModelSchema, TerraformSchema). DatabaseService.checkRequiredFields
 * only keeps the promise when the column is also flagged
 * isDefaultValueColumn - the insert then leaves it out and Postgres writes
 * its DEFAULT. Without the flag a create that leaves the column out is
 * refused: "<column> is required". The Dashboard's forms always send their
 * defaults, so nothing on screen shows it; an API or Terraform client does,
 * and every client of a model that gains such a column breaks on upgrade
 * (LlmCostBudget.spendSource in #5095, DetectionRule.shouldCreateIncident
 * before it - see LlmConnectCreateContract and DetectionRuleCreateContract).
 *
 * KNOWN holds the columns that were already like this when the guard came
 * in: each is refused when left out though the API reference gives it a
 * default. To fix one, flag it isDefaultValueColumn once its @Column has a
 * Postgres DEFAULT (or drop the declared default if the client must send
 * it), and take it off the list. An entry that no longer applies is
 * reported, so the list only shrinks.
 */
const KNOWN: ReadonlyArray<string> = [
  "DetectionRule.isEnabled",
  "DetectionRule.evaluationIntervalInMinutes",
  "DetectionRule.shouldCreateAlert",
  "DetectionRule.shouldWriteDetectionFinding",
  "LogPipelineProcessor.isEnabled",
  "LogRecordingRule.isEnabled",
  "LogSavedView.pageSize",
  "LogSavedView.isDefault",
  "MetricPipelineRule.filterCondition",
  "MetricPipelineRule.isEnabled",
  "MetricRecordingRule.isEnabled",
  "MetricSavedView.isDefault",
  "MonitorTest.isInQueue",
  "ProjectSmtpConfig.transportType",
  "ProjectSmtpConfig.authType",
  "SecurityEventConnection.isEnabled",
  "SecurityEventConnection.pollIntervalInMinutes",
  "SecurityEventConnection.alertingOnly",
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
];

// "<Model>.<column>" for every required column with a declared default that a create may not leave out.
function refusedWhenLeftOut(): Array<string> {
  const found: Array<string> = [];

  for (const modelType of Models as Array<DatabaseBaseModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata | undefined = columns[column];

      if (
        metadata?.required &&
        metadata.defaultValue !== undefined &&
        metadata.defaultValue !== null &&
        !metadata.isDefaultValueColumn
      ) {
        found.push(`${modelType.name}.${column}`);
      }
    }
  }

  return found.sort();
}

describe("required columns with a declared default", () => {
  test("every one can be left out of a create, as the API reference says", () => {
    const found: Array<string> = refusedWhenLeftOut().filter(
      (entry: string): boolean => {
        return !KNOWN.includes(entry);
      },
    );

    // Flag each isDefaultValueColumn (its @Column needs a Postgres DEFAULT).
    expect(found).toEqual([]);
  });

  test("every known one is still refused when left out", () => {
    const found: Array<string> = refusedWhenLeftOut();

    // Fixed, renamed or gone: take it off KNOWN.
    expect(
      KNOWN.filter((entry: string): boolean => {
        return !found.includes(entry);
      }),
    ).toEqual([]);
  });

  test("the guard sees a column like the one #5095 added", () => {
    // LlmCostBudget.spendSource without its flag would be caught.
    const budget: Dictionary<TableColumnMetadata> = getTableColumns(
      new (Models.find((modelType: DatabaseBaseModelType): boolean => {
        return modelType.name === "LlmCostBudget";
      }) as DatabaseBaseModelType)(),
    );
    const spendSource: TableColumnMetadata | undefined = budget["spendSource"];

    expect(spendSource?.required).toBe(true);
    expect(spendSource?.defaultValue).toBeDefined();
    expect(spendSource?.isDefaultValueColumn).toBe(true);
  });
});
