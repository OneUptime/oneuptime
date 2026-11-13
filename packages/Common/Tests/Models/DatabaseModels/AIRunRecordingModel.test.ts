import AllModelTypes from "../../../Models/DatabaseModels/Index";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunRecording from "../../../Models/DatabaseModels/AIRunRecording";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN AI INVESTIGATION SAW, AS A ROW (issue #6800): the context it
 * started from and every tool call it made with the text it was handed
 * back, kept so the run can be replayed on the same data.
 *
 * The text holds telemetry the tools read as the system - more than a
 * project member may read through the run's activity - so the table is the
 * server's alone:
 *
 *   - registered, a project's (its tenant column), with no CRUD API;
 *   - no permission creates, reads, updates or deletes a row, on the table
 *     or on any column;
 *   - a recording belongs to its run and its project, and goes with either;
 *   - what it holds is required: the run, the project, the recording.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

function relationsOf(target: unknown): Array<RelationMetadataArgs> {
  return getMetadataArgsStorage().relations.filter(
    (relation: RelationMetadataArgs): boolean => {
      return relation.target === target;
    },
  );
}

/*
 * The columns of every index on the model. TypeORM records an @Index() on a
 * property as an index whose columns are that property.
 */
function indexedColumnsOf(target: unknown): Array<Array<string>> {
  return getMetadataArgsStorage()
    .indices.filter((index: IndexMetadataArgs): boolean => {
      return index.target === target;
    })
    .map((index: IndexMetadataArgs): Array<string> => {
      return Array.isArray(index.columns)
        ? (index.columns as Array<string>)
        : [];
    });
}

function storedColumn(propertyName: string): ColumnMetadataArgs {
  const column: ColumnMetadataArgs | undefined =
    getMetadataArgsStorage().columns.find(
      (candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === AIRunRecording &&
          candidate.propertyName === propertyName
        );
      },
    );

  expect({ propertyName, stored: column !== undefined }).toEqual({
    propertyName,
    stored: true,
  });

  return column!;
}

describe("AIRunRecording", () => {
  const model: AIRunRecording = new AIRunRecording();

  test("is registered once, as the AIRunRecording table of a project", () => {
    expect(
      MODEL_TYPES.filter((modelType: ModelType): boolean => {
        return modelType === AIRunRecording;
      }),
    ).toHaveLength(1);
    expect(model.tableName).toBe("AIRunRecording");
    expect(model.getTenantColumn()).toBe("projectId");
    expect(model.singularName).toBe("AI Run Recording");
    expect(model.pluralName).toBe("AI Run Recordings");
  });

  test("has no CRUD API: nothing outside the server reaches a row", () => {
    expect(model.getCrudApiPath()).toBeFalsy();
  });

  test("no permission creates, reads, updates or deletes a row", () => {
    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getReadPermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);
  });

  test("nor any column: every column, the base ones included, is the server's alone", () => {
    const columnAccess: Record<string, ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const column of [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "project",
      "projectId",
      "aiRun",
      "aiRunId",
      "recording",
    ]) {
      expect({ column, access: columnAccess[column] }).toEqual({
        column,
        access: { create: [], read: [], update: [] },
      });
    }

    for (const [column, access] of Object.entries(columnAccess)) {
      expect({
        column,
        create: access.create,
        read: access.read,
        update: access.update,
      }).toEqual({ column, create: [], read: [], update: [] });
    }
  });

  test("holds the run, the project and the recording, each required", () => {
    for (const column of ["projectId", "aiRunId", "recording"]) {
      expect({
        column,
        required: model.getTableColumnMetadata(column).required,
      }).toEqual({ column, required: true });
      expect({
        column,
        nullable: storedColumn(column).options.nullable,
      }).toEqual({ column, nullable: false });
    }

    expect(model.getTableColumnMetadata("recording").type).toBe(
      TableColumnType.JSON,
    );
    expect(model.getTableColumnMetadata("projectId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata("aiRunId").type).toBe(
      TableColumnType.ObjectID,
    );
  });

  test("belongs to its run and its project, and is deleted with either", () => {
    const relations: Array<RelationMetadataArgs> = relationsOf(AIRunRecording);

    expect(
      relations
        .map((relation: RelationMetadataArgs) => {
          return {
            propertyName: relation.propertyName,
            relationType: relation.relationType,
            onDelete: relation.options.onDelete,
          };
        })
        .sort((a: { propertyName: string }, b: { propertyName: string }) => {
          return a.propertyName.localeCompare(b.propertyName);
        }),
    ).toEqual([
      {
        propertyName: "aiRun",
        relationType: "many-to-one",
        onDelete: "CASCADE",
      },
      {
        propertyName: "project",
        relationType: "many-to-one",
        onDelete: "CASCADE",
      },
    ]);
    expect(model.getTableColumnMetadata("aiRun").modelType).toBe(AIRun);
    expect(model.getTableColumnMetadata("project").modelType).toBe(Project);
    expect(model.getTableColumnMetadata("aiRun").manyToOneRelationColumn).toBe(
      "aiRunId",
    );
    expect(
      model.getTableColumnMetadata("project").manyToOneRelationColumn,
    ).toBe("projectId");
  });

  test("is found by its run and by its project: both columns are indexed, each on its own", () => {
    const indexes: Array<Array<string>> = indexedColumnsOf(AIRunRecording);

    expect(
      indexes.map((columns: Array<string>): number => {
        return columns.length;
      }),
    ).toEqual([1, 1]);
    expect(indexes.flat().sort()).toEqual(["aiRunId", "projectId"]);
  });

  test("a run is not told of its recording: AIRun has no relation to it", () => {
    for (const relation of relationsOf(AIRun)) {
      const relatedType: unknown =
        typeof relation.type === "function"
          ? (relation.type as () => unknown)()
          : relation.type;

      expect({ propertyName: relation.propertyName, relatedType }).not.toEqual({
        propertyName: relation.propertyName,
        relatedType: AIRunRecording,
      });
    }
  });
});
