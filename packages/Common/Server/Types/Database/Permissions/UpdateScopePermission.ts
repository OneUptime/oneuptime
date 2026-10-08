import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import CreateScopePermission, {
  CreateScope,
  LabelledRecordsNamed,
  LabelNamesFinder,
  RecordLabelsFinder,
} from "./CreateScopePermission";
import ReadPermission, { LabelledReferences } from "./ReadPermission";
import UpdateScopeException from "./UpdateScopeException";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import { UserPermission } from "../../../../Types/Permission";
import {
  normalizeReferenceId,
  resolveReferenceId,
  resolveReferenceIds,
} from "../../../Utils/Database/ProjectScopedReferenceRefusal";
import RelationNames, {
  RelationName,
} from "../../../Utils/Database/RelationNames";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

/*
 * A CHANGE LEAVES A RECORD WITHIN ITS EDITOR'S PERMISSION TO CHANGE IT.
 *
 * An update reaches only the records the caller's permission to update
 * reaches (BasePermission.addRecordScopeToQuery): with a permission limited
 * to some labels, the records carrying one of them; with a block with labels,
 * none carrying them. An update that changes the labels a record carries is
 * held to the same permission on the labels the record carries AFTER it, as
 * a create is to its create permission (CreateScopePermission):
 *
 *   - when every permission that lets the caller update the record is
 *     limited to labels, the record still carries at least one of them once
 *     the update is written - a model that carries labels by the labels it
 *     is written with, a model that does not by the labelled records it
 *     names once written (an announcement by its status pages, a status page
 *     resource by its status page and its monitor; one that comes to name no
 *     labelled record at all is about none of them, as a read takes it). One
 *     permission over the whole project lets every change through;
 *   - a block with labels on one of the model's update permissions refuses a
 *     change that leaves the record carrying one of its labels: the records
 *     the update reaches carry none of them already, so such a label is one
 *     the change adds.
 *
 * A refused change is an UpdateScopeException, whose message names the
 * labels. A change that leaves the labels as they are - every update that
 * does not write them - is not asked. Root and master admin callers are left
 * alone. DatabaseService asks before the update hooks run, on the rows the
 * update writes, and again after them should a hook change the labels.
 */
export default class UpdateScopePermission {
  /*
   * The columns the labels a record carries are read from: a model that
   * carries labels, its labels column; one that does not, the key columns
   * that name the labelled records it carries the labels of
   * (ReadPermission.getLabelledReferences), and the list of labelled parents
   * it is read through (CreateScopePermission.getLabelledParentList). None
   * for a model whose records carry no labels at all.
   */
  public static getLabelColumns(modelType: DatabaseBaseModelType): Array<string> {
    const model: BaseModel = new modelType();
    const accessControlColumn: string | null = model.getAccessControlColumn();

    if (accessControlColumn) {
      return [accessControlColumn];
    }

    const references: LabelledReferences =
      ReadPermission.getLabelledReferences(modelType);

    const columns: Array<string> = [
      ...references.keys.map((reference: { column: string }): string => {
        return reference.column;
      }),
      ...references.anyKindColumns,
    ];

    const parentList: string | null =
      CreateScopePermission.getLabelledParentList(modelType);

    if (parentList) {
      columns.push(parentList);
    }

    return Array.from(new Set<string>(columns));
  }

  /*
   * Whether `data`, what an update writes, writes one of the columns the
   * labels are read from (getLabelColumns) - under the relation's name or
   * its ID column's - null included: an update that clears a reference
   * changes what the record carries too.
   */
  public static changesLabels(
    modelType: DatabaseBaseModelType,
    data: unknown,
  ): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    const record: Record<string, unknown> = data as Record<string, unknown>;

    return UpdateScopePermission.getWrittenNames(modelType).some(
      (name: string): boolean => {
        return record[name] !== undefined;
      },
    );
  }

  /*
   * What `data` writes of the columns the labels are read from, as one
   * string - the records each name names, lower-cased and in order, null for
   * a clear - so that two writes that give a record the same labels compare
   * equal. For an ask after a service's hooks, which a hook that changed
   * none of them leaves unasked.
   */
  public static getLabelWrite(
    modelType: DatabaseBaseModelType,
    data: unknown,
  ): string {
    const written: Dictionary<Array<string> | null> = {};

    if (data && typeof data === "object") {
      const record: Record<string, unknown> = data as Record<string, unknown>;

      for (const name of UpdateScopePermission.getWrittenNames(modelType)) {
        const value: unknown = record[name];

        if (value === undefined) {
          continue;
        }

        written[name] =
          value === null
            ? null
            : resolveReferenceIds(value)
                .map((id: ObjectID | string): string => {
                  return normalizeReferenceId(id.toString());
                })
                .sort();
      }
    }

    return JSON.stringify(written);
  }

  /*
   * The caller's permission to update `modelType`, when its labels limit
   * what a change may leave a record carrying: a permission limited to
   * labels, or a block with labels. Null for a caller whose update
   * permissions do neither - one reaching the whole project, or only the
   * records they own, which a change of labels does not move.
   */
  public static getLimitedScope(
    modelType: DatabaseBaseModelType,
    props: DatabaseCommonInteractionProps,
  ): CreateScope | null {
    if (props.isRoot || props.isMasterAdmin) {
      return null;
    }

    const scope: CreateScope = CreateScopePermission.getWriteScope(
      modelType,
      props,
      DatabaseRequestType.Update,
    );

    if (
      scope.grantedLabelIds.length === 0 &&
      scope.labelledBlocks.length === 0
    ) {
      return null;
    }

    return scope;
  }

  /*
   * Refuses an update that leaves a record outside the caller's permission
   * to update it (see the class comment). `rows` are the records it writes
   * as they are now - for a model that carries no labels of its own, read
   * with the columns getLabelColumns names, whose values the update's own
   * replace. `findRecordLabels` reads the labels of the labelled records a
   * row names, as OneUptime, in the project; `findLabelNames` names the
   * labels in a refusal.
   */
  @CaptureSpan()
  public static async checkUpdateScope<TBaseModel extends BaseModel>(data: {
    modelType: { new (): TBaseModel };
    // What the update writes.
    data: unknown;
    rows: Array<BaseModel>;
    props: DatabaseCommonInteractionProps;
    findRecordLabels: RecordLabelsFinder;
    findLabelNames: LabelNamesFinder;
  }): Promise<void> {
    if (
      data.props.isRoot ||
      data.props.isMasterAdmin ||
      data.rows.length === 0 ||
      !UpdateScopePermission.changesLabels(data.modelType, data.data)
    ) {
      return;
    }

    const scope: CreateScope | null = UpdateScopePermission.getLimitedScope(
      data.modelType,
      data.props,
    );

    if (!scope) {
      return;
    }

    const model: BaseModel = new data.modelType();
    const accessControlColumn: string | null = model.getAccessControlColumn();

    // The labels each row carries once the update is written; null for none named.
    const labelsAfter: Array<Set<string> | null> = accessControlColumn
      ? [
          // Written as a whole: every row carries the labels it is written with.
          new Set<string>(
            resolveReferenceIds(
              (data.data as Record<string, unknown>)[accessControlColumn],
            ).map((labelId: ObjectID | string): string => {
              return normalizeReferenceId(labelId.toString());
            }),
          ),
        ]
      : await UpdateScopePermission.getLabelsOfRecordsAfter({
          modelType: data.modelType,
          records: data.rows.map(
            (row: BaseModel): Record<string, unknown> => {
              return UpdateScopePermission.getRecordAfterUpdate(
                data.modelType,
                row,
                data.data,
              );
            },
          ),
          props: data.props,
          findRecordLabels: data.findRecordLabels,
        });

    for (const recordLabelIds of labelsAfter) {
      await UpdateScopePermission.checkLabelsAfter({
        model: model,
        scope: scope,
        recordLabelIds: recordLabelIds,
        isLabelled: Boolean(accessControlColumn),
        props: data.props,
        findLabelNames: data.findLabelNames,
      });
    }
  }

  /*
   * The values of the columns getLabelColumns names, as a row will hold them
   * once `data` is written: the row's own, with what the update writes in
   * their place - under an ID column, or under the relation that shares it.
   */
  public static getRecordAfterUpdate(
    modelType: DatabaseBaseModelType,
    row: BaseModel,
    data: unknown,
  ): Record<string, unknown> {
    const stored: Record<string, unknown> = row as unknown as Record<
      string,
      unknown
    >;
    const written: Record<string, unknown> =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : {};

    const record: Record<string, unknown> = {};

    for (const column of UpdateScopePermission.getLabelColumns(modelType)) {
      record[column] =
        written[column] !== undefined ? written[column] : stored[column];
    }

    for (const relation of UpdateScopePermission.getSingleRelationsOf(
      modelType,
    )) {
      if (written[relation.relation] !== undefined) {
        record[relation.idColumn] =
          resolveReferenceId(written[relation.relation]) || null;
      }
    }

    return record;
  }

  /*
   * The labels each of `records` carries (a model that carries no labels of
   * its own), each kind of labelled record named looked up once for all of
   * them: null for a record that names no labelled record at all.
   */
  private static async getLabelsOfRecordsAfter(data: {
    modelType: DatabaseBaseModelType;
    records: Array<Record<string, unknown>>;
    props: DatabaseCommonInteractionProps;
    findRecordLabels: RecordLabelsFinder;
  }): Promise<Array<Set<string> | null>> {
    const named: Array<LabelledRecordsNamed> = data.records.map(
      (record: Record<string, unknown>): LabelledRecordsNamed => {
        return CreateScopePermission.getLabelledRecordsNamed(
          data.modelType,
          record,
        );
      },
    );

    // Every record named, by kind, across the rows.
    const idsByKind: Map<DatabaseBaseModelType, Set<string>> = new Map();

    for (const each of named) {
      for (const [modelType, ids] of each.ids.entries()) {
        const all: Set<string> = idsByKind.get(modelType) || new Set<string>();

        for (const id of ids) {
          all.add(id);
        }

        idsByKind.set(modelType, all);
      }
    }

    const labelsByKind: Map<
      DatabaseBaseModelType,
      Dictionary<Array<string>>
    > = new Map();

    await Promise.all(
      Array.from(idsByKind.entries()).map(
        async ([modelType, ids]: [
          DatabaseBaseModelType,
          Set<string>,
        ]): Promise<void> => {
          labelsByKind.set(
            modelType,
            await data.findRecordLabels({
              modelType: modelType,
              ids: Array.from(ids),
              props: data.props,
            }),
          );
        },
      ),
    );

    return named.map((each: LabelledRecordsNamed): Set<string> | null => {
      if (!each.namesARecord) {
        return null;
      }

      const labelIds: Set<string> = new Set<string>();

      for (const [modelType, ids] of each.ids.entries()) {
        const labelsByRecord: Dictionary<Array<string>> =
          labelsByKind.get(modelType) || {};

        for (const id of ids) {
          for (const labelId of labelsByRecord[normalizeReferenceId(id)] ||
            []) {
            labelIds.add(normalizeReferenceId(labelId));
          }
        }
      }

      return labelIds;
    });
  }

  // One row's labels once written, held to `scope`. See checkUpdateScope.
  private static async checkLabelsAfter(data: {
    model: BaseModel;
    scope: CreateScope;
    recordLabelIds: Set<string> | null;
    isLabelled: boolean;
    props: DatabaseCommonInteractionProps;
    findLabelNames: LabelNamesFinder;
  }): Promise<void> {
    const model: BaseModel = data.model;

    for (const block of data.scope.labelledBlocks) {
      const blockedLabelIds: Array<string> = UpdateScopePermission.getBlockLabelIds(
        block,
      ).filter((labelId: string): boolean => {
        return Boolean(data.recordLabelIds?.has(labelId));
      });

      if (blockedLabelIds.length > 0) {
        const names: Array<string> = await data.findLabelNames({
          labelIds: blockedLabelIds,
          props: data.props,
        });

        throw new UpdateScopeException(
          `You are not authorized to change this ${model.singularName} because ${block.permission} is in your team's permission block list for ${CreateScopePermission.describeLabels(names)}.`,
        );
      }
    }

    if (data.scope.grantedLabelIds.length === 0) {
      return;
    }

    const isAboutNoLabelledRecord: boolean =
      !data.isLabelled && data.recordLabelIds === null;

    const carriesGrantedLabel: boolean = data.scope.grantedLabelIds.some(
      (labelId: string): boolean => {
        return Boolean(data.recordLabelIds?.has(labelId));
      },
    );

    if (isAboutNoLabelledRecord || carriesGrantedLabel) {
      return;
    }

    const names: Array<string> = await data.findLabelNames({
      labelIds: data.scope.grantedLabelIds,
      props: data.props,
    });

    throw new UpdateScopeException(
      data.isLabelled
        ? `Your access lets you change ${model.pluralName} only with one of these labels: ${names.join(", ")}. Keep one of them and try again.`
        : `Your access lets you change ${model.pluralName} only for records with one of these labels: ${names.join(", ")}.`,
    );
  }

  // A block row's labels, lower-cased.
  private static getBlockLabelIds(block: UserPermission): Array<string> {
    return (block.labelIds || []).map((labelId: ObjectID): string => {
      return normalizeReferenceId(labelId.toString());
    });
  }

  /*
   * The names a write may give the columns getLabelColumns names: each
   * column, and the relation of each single reference whose ID column it is.
   */
  private static getWrittenNames(modelType: DatabaseBaseModelType): Array<string> {
    const columns: Array<string> =
      UpdateScopePermission.getLabelColumns(modelType);

    return [
      ...columns,
      ...UpdateScopePermission.getSingleRelationsOf(modelType).map(
        (relation: RelationName): string => {
          return relation.relation;
        },
      ),
    ];
  }

  // The single relations whose ID column is one getLabelColumns names.
  private static getSingleRelationsOf(
    modelType: DatabaseBaseModelType,
  ): Array<RelationName> {
    const columns: Array<string> =
      UpdateScopePermission.getLabelColumns(modelType);

    return RelationNames.getSingleRelations(new modelType()).filter(
      (relation: RelationName): boolean => {
        return columns.includes(relation.idColumn);
      },
    );
  }
}
