import { getMetadataArgsStorage } from "typeorm";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";

/*
 * The relations TypeORM has read off the models' decorators, for suites that
 * cannot import typeorm themselves: ee/ reaches Common through its symlink in
 * ee/node_modules, and its type-check (Compile's compile-ee) resolves
 * Common's own files but not Common's dependencies, so an ee test that
 * imports "typeorm" passes in jest and fails to compile.
 */
export interface ModelRelation {
  // The model the relation is declared on.
  model: unknown;
  // The model it points to: a lazy type function already called.
  relatedModel: unknown;
  relationType: string;
  onDelete: string | undefined;
}

export function modelRelations(): Array<ModelRelation> {
  return getMetadataArgsStorage().relations.map(
    (relation: RelationMetadataArgs): ModelRelation => {
      return {
        model: relation.target,
        relatedModel:
          typeof relation.type === "function"
            ? (relation.type as () => unknown)()
            : relation.type,
        relationType: relation.relationType,
        onDelete: relation.options.onDelete,
      };
    },
  );
}
