import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import ProjectScopedReferenceValidator from "../Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Logger";

/*
 * Engines copy the records a rule names onto what they create - a grouping
 * rule's on-call policies and episode labels onto each episode it opens - as
 * root, past the checks a person's write meets. The lists are checked when
 * the rule is saved (ProjectReferencesService), but a rule saved before that
 * check existed can still name another project's record. So the engine
 * copies only the project's own: one read, pinned to the project.
 */
export default class RuleRecordScope {
  /*
   * The records among `records` that are the project's, in the order given.
   * The others are logged by id and left out. A failed read leaves them all
   * out - nothing unchecked is copied - and is logged; it never throws.
   */
  public static async keepRecordsInProject<
    TModel extends DatabaseBaseModel,
  >(data: {
    projectId: ObjectID;
    records: Array<TModel> | undefined;
    modelType: { new (): TModel };
    // For the log: "on-call policies of grouping rule Payments storms".
    description: string;
    logAttributes: LogAttributes;
  }): Promise<Array<TModel>> {
    const records: Array<TModel> = (data.records || []).filter(
      (record: TModel): boolean => {
        return Boolean(record?.id || record?._id);
      },
    );

    if (records.length === 0) {
      return [];
    }

    const idOf: (record: TModel) => string = (record: TModel): string => {
      return (record.id || record._id || "").toString();
    };

    let kept: Set<string>;

    try {
      kept = new Set<string>(
        await ProjectScopedReferenceValidator.keepIdsInProject({
          modelType: data.modelType,
          projectId: data.projectId,
          ids: records.map(idOf),
        }),
      );
    } catch (error) {
      logger.error(
        `Could not check the ${data.description}, so none were copied: ${error}`,
        data.logAttributes,
      );

      return [];
    }

    const dropped: Array<string> = records
      .map(idOf)
      .filter((id: string): boolean => {
        return !kept.has(id);
      });

    if (dropped.length > 0) {
      logger.warn(
        `Some ${data.description} are not in this project and were not copied: ${dropped
          .map((id: string): string => {
            return `"${id}"`;
          })
          .join(", ")}`,
        data.logAttributes,
      );
    }

    return records.filter((record: TModel): boolean => {
      return kept.has(idOf(record));
    });
  }
}
