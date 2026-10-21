import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import RunbookRule from "../../../Models/DatabaseModels/RunbookRule";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../../Types/Dictionary";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import Permission from "../../../Types/Permission";
import { describe, expect, test } from "@jest/globals";

/*
 * The columns a runbook rule now matches on. They are written and read by
 * exactly who may write and read the rule's title pattern (runbook admins
 * included), are optional, and pick from the models their names say.
 */

const model: RunbookRule = new RunbookRule();

interface Relation {
  column: string;
  modelType: unknown;
  modelName: string;
  title: string;
}

const RELATIONS: Array<Relation> = [
  {
    column: "monitors",
    modelType: Monitor,
    modelName: "Monitor",
    title: "Monitors",
  },
  {
    column: "incidentSeverities",
    modelType: IncidentSeverity,
    modelName: "IncidentSeverity",
    title: "Incident Severities",
  },
  {
    column: "alertSeverities",
    modelType: AlertSeverity,
    modelName: "AlertSeverity",
    title: "Alert Severities",
  },
  {
    column: "labels",
    modelType: Label,
    modelName: "Label",
    title: "Labels",
  },
  {
    column: "monitorLabels",
    modelType: Label,
    modelName: "Label",
    title: "Monitor Labels",
  },
];

const PATTERNS: Array<string> = [
  "monitorNamePattern",
  "monitorDescriptionPattern",
];

const accessControl: Dictionary<ColumnAccessControl> =
  model.getColumnAccessControlForAllColumns();

describe("RunbookRule match criteria columns", () => {
  test("is still a rule model, with its criteria column", () => {
    expect(model).toBeInstanceOf(RuleBaseModel);
    expect(model.getTableColumnMetadata("criteria")?.type).toBe(
      TableColumnType.JSON,
    );
  });

  test.each(RELATIONS)(
    "$column is an optional list of $modelName",
    (relation: Relation) => {
      const metadata: TableColumnMetadata = model.getTableColumnMetadata(
        relation.column,
      );

      expect(metadata.type).toBe(TableColumnType.EntityArray);
      expect(metadata.modelType).toBe(relation.modelType);
      expect(metadata.title).toBe(relation.title);
      expect(metadata.required).toBe(false);
      expect(metadata.description?.length || 0).toBeGreaterThan(20);
    },
  );

  test.each(PATTERNS)("%s is an optional pattern", (column: string) => {
    const metadata: TableColumnMetadata = model.getTableColumnMetadata(column);

    expect(metadata.type).toBe(TableColumnType.LongText);
    expect(metadata.required).toBe(false);
  });

  test.each([
    ...RELATIONS.map((relation: Relation): string => {
      return relation.column;
    }),
    ...PATTERNS,
  ])("%s has the title pattern's permissions", (column: string) => {
    expect(accessControl[column]).toEqual(accessControl["titlePattern"]);
  });

  test("runbook admins may write a rule's criteria; runbook members only read them", () => {
    const titlePattern: ColumnAccessControl = accessControl["titlePattern"]!;

    expect(titlePattern.create).toContain(Permission.RunbookAdmin);
    expect(titlePattern.update).toContain(Permission.RunbookAdmin);
    expect(titlePattern.read).toContain(Permission.RunbookMember);
    expect(titlePattern.update).not.toContain(Permission.RunbookMember);
  });
});
