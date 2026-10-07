import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";

/*
 * EVERY MODEL READ THROUGH ANOTHER RECORD CAN BE HELD TO THAT RECORD'S RULE.
 *
 * A model read through another record (@CanAccessIfCanReadOn - an
 * incident's notes, a status page's announcements) keeps to the parents
 * its caller may read (BasePermission.addParentAccessToQuery): the labels
 * their read is limited to, the labels a block takes away, and - when their
 * grants on the parent reach only what they own - the parents they or their
 * teams own (OwnedScopePermission.addOwnedParentsToQuery). That rule reads
 * the parent's own labels and owner rows, one level up, so this sweeps every
 * model and holds each one read through a parent to what the rule can
 * follow:
 *
 *   - the relation names the parent's model, by a key column or through a
 *     join table: a relation the rule cannot follow would leave the rows
 *     unnarrowed by the parent (a join table is declared with @JoinTable on
 *     the model itself);
 *   - the parent keeps its owners in owner rows of its own - it takes none
 *     from a record of its own (@OwnedThrough). The owned scope of such a
 *     parent would reach none of the rows read through it;
 *   - the parent is not itself read through another record: the rule
 *     follows one level, so a grandparent's labels and owners would not
 *     narrow the rows.
 *
 * Anything that legitimately does not is listed below with the reason, and
 * the lists may only shrink: each entry is the exact line the sweep
 * produces, so an entry nothing produces any more fails the test too.
 */

type ModelType = { new (): BaseModel };

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

// Lines of the sweep that are deliberate. May only shrink - and is empty.
const ALLOWED: Array<string> = [];

interface ParentRelation {
  model: BaseModel;
  modelType: ModelType;
  relation: string;
  column: TableColumnMetadata | undefined;
}

function getParentRelations(): Array<ParentRelation> {
  const relations: Array<ParentRelation> = [];

  for (const modelType of MODEL_TYPES) {
    const model: BaseModel = new modelType();

    if (!model.canAccessIfCanReadOn) {
      continue;
    }

    relations.push({
      model: model,
      modelType: modelType,
      relation: model.canAccessIfCanReadOn,
      column: model.getTableColumnMetadata(model.canAccessIfCanReadOn),
    });
  }

  return relations;
}

function hasJoinTable(modelType: ModelType, propertyName: string): boolean {
  return getMetadataArgsStorage().joinTables.some(
    (joinTable: JoinTableMetadataArgs): boolean => {
      return (
        joinTable.target === modelType &&
        joinTable.propertyName === propertyName
      );
    },
  );
}

function sweep(): Array<string> {
  const lines: Array<string> = [];

  for (const entry of getParentRelations()) {
    const name: string = `${entry.model.tableName}.${entry.relation}`;
    const column: TableColumnMetadata | undefined = entry.column;

    if (
      !column ||
      !column.modelType ||
      (column.type !== TableColumnType.Entity &&
        column.type !== TableColumnType.EntityArray)
    ) {
      lines.push(`${name}: the relation names no parent model`);
      continue;
    }

    if (
      column.type === TableColumnType.Entity &&
      !column.manyToOneRelationColumn
    ) {
      lines.push(`${name}: the relation names no key column`);
    }

    if (
      column.type === TableColumnType.EntityArray &&
      !hasJoinTable(entry.modelType, entry.relation)
    ) {
      lines.push(`${name}: the relation declares no join table`);
    }

    const parent: BaseModel = new column.modelType();

    if (parent.ownedThrough) {
      lines.push(
        `${name}: ${parent.tableName} takes its owners from another record`,
      );
    }

    if (parent.canAccessIfCanReadOn) {
      lines.push(
        `${name}: ${parent.tableName} is read through ${parent.canAccessIfCanReadOn}`,
      );
    }
  }

  return lines.sort();
}

describe("Models read through another record", () => {
  test("are a real set, not a handful", () => {
    // Notes, feeds and timelines of incidents, alerts, episodes, status pages ...
    expect(getParentRelations().length).toBeGreaterThan(50);
  });

  test("include parents linked through a join table", () => {
    // A status page's announcements: the rule reads the join table there.
    expect(
      getParentRelations().some((entry: ParentRelation): boolean => {
        return entry.column?.type === TableColumnType.EntityArray;
      }),
    ).toBe(true);
  });

  test("can each be held to the labels and owners of the record they are read through", () => {
    expect(sweep()).toEqual(ALLOWED);
  });
});
