import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";
import Models from "../../Models/DatabaseModels/Index";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceTemplate from "../../Models/DatabaseModels/ScheduledMaintenanceTemplate";
import Dictionary from "../../Types/Dictionary";
import {
  getTableColumns,
  TableColumnMetadata,
} from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";

/*
 * A relation column says its model twice: once for TypeORM (@ManyToOne /
 * @ManyToMany, which is what the database joins) and once in @TableColumn's
 * modelType, which everything else reads: the API reference, nested selects
 * and their permission checks, the client's JSON parsing, and the Developer
 * pages, which look the record an id points at up by it to name it.
 *
 * The two disagreed on changeMonitorStatusTo (an incident's, a scheduled
 * maintenance event's and both templates'): TypeORM joined monitor statuses,
 * the metadata said incident or scheduled maintenance states. This holds
 * every model's relation columns to TypeORM's targets.
 */

function relationTarget(
  modelType: DatabaseBaseModelType,
  propertyName: string,
): unknown {
  const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
    .relations.filter((candidate: RelationMetadataArgs): boolean => {
      return (
        candidate.propertyName === propertyName &&
        typeof candidate.target === "function" &&
        (candidate.target === modelType ||
          modelType.prototype instanceof candidate.target)
      );
    })
    .pop();

  if (!relation) {
    return undefined;
  }

  return typeof relation.type === "function"
    ? (relation.type as () => unknown)()
    : relation.type;
}

interface RelationColumn {
  table: string;
  column: string;
  declared: string;
  joined: string;
}

function relationColumns(): Array<RelationColumn> {
  const found: Array<RelationColumn> = [];

  for (const modelType of Models as Array<DatabaseBaseModelType>) {
    const model: BaseModel = new modelType();
    const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);

    for (const column of Object.keys(columns)) {
      const metadata: TableColumnMetadata | undefined = columns[column];

      if (
        !metadata?.modelType ||
        (metadata.type !== TableColumnType.Entity &&
          metadata.type !== TableColumnType.EntityArray)
      ) {
        continue;
      }

      const target: unknown = relationTarget(modelType, column);

      if (!target) {
        continue;
      }

      found.push({
        table: model.tableName || modelType.name,
        column,
        declared: metadata.modelType.name,
        joined: (target as { name?: string }).name || String(target),
      });
    }
  }

  return found;
}

describe("a relation column's modelType is the model TypeORM joins", () => {
  const columns: Array<RelationColumn> = relationColumns();

  test("the check covers the models' relations", () => {
    expect(columns.length).toBeGreaterThan(500);
  });

  test("on every model", () => {
    const mismatched: Array<string> = columns
      .filter((column: RelationColumn): boolean => {
        return column.declared !== column.joined;
      })
      .map((column: RelationColumn): string => {
        return `${column.table}.${column.column}: @TableColumn says ${column.declared}, TypeORM joins ${column.joined}`;
      });

    expect(mismatched).toEqual([]);
  });

  test.each([
    ["Incident", Incident],
    ["IncidentTemplate", IncidentTemplate],
    ["ScheduledMaintenance", ScheduledMaintenance],
    ["ScheduledMaintenanceTemplate", ScheduledMaintenanceTemplate],
  ])(
    "%s.changeMonitorStatusTo is a monitor status",
    (_name: string, modelType: DatabaseBaseModelType) => {
      const metadata: TableColumnMetadata | undefined = getTableColumns(
        new modelType(),
      )["changeMonitorStatusTo"];

      expect(metadata?.modelType).toBe(MonitorStatus);
      expect(metadata?.manyToOneRelationColumn).toBe("changeMonitorStatusToId");
    },
  );
});
