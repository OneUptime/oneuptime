import { ValueTransformer, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The columns TypeORM has read off the models' decorators, for suites that
 * cannot import typeorm themselves - ee's, whose type-check resolves Common's
 * own files but not Common's dependencies (see ModelRelations).
 */
export interface ModelColumn {
  // The class the column is declared on: a model, or a class models extend.
  model: unknown;
  propertyName: string;
  // What turns the stored value into the model's and back: one, a list, or none.
  transformer: ValueTransformer | Array<ValueTransformer> | undefined;
}

export function modelColumns(): Array<ModelColumn> {
  return getMetadataArgsStorage().columns.map(
    (column: ColumnMetadataArgs): ModelColumn => {
      return {
        model: column.target,
        propertyName: column.propertyName,
        transformer: column.options.transformer,
      };
    },
  );
}
