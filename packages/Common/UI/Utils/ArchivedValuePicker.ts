import { ARCHIVED_VALUE_TAG } from "../Components/ArchivedTag/ArchivedTagCopy";
import type { DropdownOption } from "../Components/Dropdown/Dropdown";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Select from "../../Types/BaseDatabase/Select";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import {
  ARCHIVED_COLUMN,
  isArchivableValueTable,
} from "../../Utils/ArchivableValues";

/*
 * PICKERS LEAVE ARCHIVED VALUES OUT (Common/Utils/ArchivableValues).
 *
 * A dropdown that sets a state, a severity, a monitor status, a label or an
 * incident role on a record lists only the values that are not archived:
 * the server refuses an archived one anyway (ArchivedValueCheck), and a
 * picker that offered it would offer a choice that cannot be saved. Every
 * entity dropdown and every form field that lists such a model asks for
 * them this way, so a new form needs nothing of its own.
 *
 * A value a record already has is still shown when its form opens - the
 * dropdown reads a selected value by its id, archived or not - marked
 * Archived beside its name, so it can be kept or changed. Table filters
 * list every value, archived ones too: old records stay findable by them.
 */

// The tag beside an archived value a record still has (ArchivedTag draws it).
export { ARCHIVED_VALUE_TAG };

type ModelType = { new (): BaseModel };

const archivableByModel: Map<unknown, boolean> = new Map();

export default class ArchivedValuePicker {
  // Whether a model's rows are values that can be archived.
  public static isArchivableValueModel(
    modelType: ModelType | undefined | null,
  ): boolean {
    if (!modelType) {
      return false;
    }

    const cached: boolean | undefined = archivableByModel.get(modelType);

    if (cached !== undefined) {
      return cached;
    }

    let isArchivable: boolean = false;

    try {
      isArchivable = isArchivableValueTable(new modelType().tableName);
    } catch {
      // A class that cannot be built for inspection lists as it always did.
      isArchivable = false;
    }

    archivableByModel.set(modelType, isArchivable);

    return isArchivable;
  }

  /*
   * The query a picker lists with: the caller's, narrowed to the values that
   * are not archived. A caller that already says which (a list of archived
   * values) is left as it is, and so is a model whose rows cannot be
   * archived.
   */
  public static getPickerQuery<TQuery extends Record<string, unknown>>(
    modelType: ModelType | undefined | null,
    query: TQuery | undefined | null,
  ): TQuery {
    const base: TQuery = (query || {}) as TQuery;

    if (!ArchivedValuePicker.isArchivableValueModel(modelType)) {
      return base;
    }

    if (Object.prototype.hasOwnProperty.call(base, ARCHIVED_COLUMN)) {
      return base;
    }

    return { ...base, [ARCHIVED_COLUMN]: false };
  }

  /*
   * The columns a picker reads a selected value with, so it can tell an
   * archived one: the archive switch, for a model that has one.
   */
  public static getSelectedValueSelect(
    modelType: ModelType | undefined | null,
  ): Record<string, true> {
    return ArchivedValuePicker.isArchivableValueModel(modelType)
      ? { [ARCHIVED_COLUMN]: true }
      : {};
  }

  // Whether a value read with its archive switch is archived.
  public static isArchived(value: unknown): boolean {
    if (!value || typeof value !== "object") {
      return false;
    }

    // A model holds each column as a property, as its JSON does.
    return (value as Record<string, unknown>)[ARCHIVED_COLUMN] === true;
  }

  /*
   * The values a picker offers for a new choice, of a list read with the
   * archive switch: the ones that are not archived.
   */
  public static getLiveValues<T>(values: Array<T>): Array<T> {
    return values.filter((value: T): boolean => {
      return !ArchivedValuePicker.isArchived(value);
    });
  }

  /*
   * The options of a dropdown built from a list the caller read itself
   * (with the archive switch selected), one option per value, in order: the
   * live values, and the archived values a record being edited still has -
   * `keptIds` - so its form still shows them, marked Archived (the dropdown
   * draws the tag, ArchivedTag) and never offered for a new pick
   * (isDisabled). Every other archived value is left out.
   */
  public static getPickerOptions<T>(data: {
    values: Array<T>;
    options: Array<DropdownOption>;
    keptIds?: Iterable<string> | undefined;
  }): Array<DropdownOption> {
    const kept: Set<string> = new Set<string>();

    for (const id of data.keptIds || []) {
      kept.add(id.toString().toLowerCase());
    }

    const archivedIds: Set<string> = new Set<string>();

    for (const value of data.values) {
      if (!ArchivedValuePicker.isArchived(value)) {
        continue;
      }

      const record: Record<string, unknown> = value as Record<string, unknown>;
      const id: unknown = record["_id"] || record["id"];

      if (id) {
        archivedIds.add(id.toString().toLowerCase());
      }
    }

    const options: Array<DropdownOption> = [];

    for (const option of data.options) {
      const id: string = String(option.value).toLowerCase();

      if (!archivedIds.has(id)) {
        options.push(option);
        continue;
      }

      if (kept.has(id)) {
        options.push({
          ...option,
          isArchived: true,
          isDisabled: true,
        });
      }
    }

    return options;
  }

  /*
   * The ids of `ids` a saved record names anywhere in it - its JSON, such
   * as a monitor's criteria - so a picker keeps showing an archived one it
   * already has. A uuid is unique enough to be found in the text.
   */
  public static getIdsNamedIn(
    record: unknown,
    ids: Iterable<string>,
  ): Array<string> {
    if (record === undefined || record === null) {
      return [];
    }

    let text: string = "";

    try {
      text = JSON.stringify(record).toLowerCase();
    } catch {
      return [];
    }

    const named: Array<string> = [];

    for (const id of ids) {
      const normalized: string = id.toString().toLowerCase();

      if (normalized && text.indexOf(normalized) !== -1) {
        named.push(normalized);
      }
    }

    return named;
  }

  /*
   * A NEW RECORD MADE FROM ANOTHER ONE - a Duplicate - takes only the values
   * a new record may have. An archived label (state, status) stays with the
   * record it is on and is never copied onto the new one: the server would
   * refuse the copy for it, and nobody could pick it there anyway.
   *
   * getCopySelect is the select the original is read with: the archive
   * switch beside the id of every value it copies. withoutArchivedValues
   * then takes the archived ones off what was read, keeping each other
   * value as the plain select would have read it - its id - so the copy is
   * sent as it always was.
   */
  public static getCopySelect<T extends BaseModel>(
    modelType: { new (): T },
    select: Select<T>,
  ): Select<T> {
    const copySelect: Record<string, unknown> = {
      ...(select as Record<string, unknown>),
    };

    for (const relation of getArchivableRelations(new modelType(), select)) {
      const columnSelect: unknown = copySelect[relation.column];

      copySelect[relation.column] = {
        ...(columnSelect && typeof columnSelect === "object"
          ? (columnSelect as Record<string, unknown>)
          : {}),
        _id: true,
        [ARCHIVED_COLUMN]: true,
      };
    }

    return copySelect as Select<T>;
  }

  public static withoutArchivedValues<T extends BaseModel>(
    item: T,
    select: Select<T>,
  ): T {
    for (const relation of getArchivableRelations(item, select)) {
      const value: unknown = item.getValue(relation.column);

      if (Array.isArray(value)) {
        item.setValue(
          relation.column,
          ArchivedValuePicker.getLiveValues(value).map(
            (kept: unknown): BaseModel => {
              return toIdOnly(kept, relation.modelType);
            },
          ) as never,
        );
        continue;
      }

      if (value && ArchivedValuePicker.isArchived(value)) {
        item.removeValue(relation.column);

        if (relation.idColumn) {
          item.removeValue(relation.idColumn);
        }

        continue;
      }

      if (value && typeof value === "object") {
        item.setValue(
          relation.column,
          toIdOnly(value, relation.modelType) as never,
        );
      }
    }

    return item;
  }
}

// A relation of a model, as a select reads it, to values that can be archived.
interface ArchivableRelation {
  column: string;
  // A single relation's ID column ("changeMonitorStatusToId").
  idColumn?: string | undefined;
  modelType: ModelType;
}

const getArchivableRelations: (
  model: BaseModel,
  select: unknown,
) => Array<ArchivableRelation> = (
  model: BaseModel,
  select: unknown,
): Array<ArchivableRelation> => {
  const relations: Array<ArchivableRelation> = [];

  for (const column of Object.keys((select as Record<string, unknown>) || {})) {
    let metadata: TableColumnMetadata | undefined = undefined;

    try {
      metadata = model.getTableColumnMetadata(column);
    } catch {
      // Not a column of the model: copied as it always was.
      continue;
    }

    if (
      !metadata ||
      (metadata.type !== TableColumnType.Entity &&
        metadata.type !== TableColumnType.EntityArray) ||
      !metadata.modelType ||
      !ArchivedValuePicker.isArchivableValueModel(metadata.modelType)
    ) {
      continue;
    }

    relations.push({
      column: column,
      idColumn: metadata.manyToOneRelationColumn,
      modelType: metadata.modelType,
    });
  }

  return relations;
};

// A value as a plain select reads it: a model of its kind with its id.
const toIdOnly: (value: unknown, modelType: ModelType) => BaseModel = (
  value: unknown,
  modelType: ModelType,
): BaseModel => {
  const record: Record<string, unknown> = (value || {}) as Record<
    string,
    unknown
  >;
  const id: unknown = record["_id"] || record["id"];
  const model: BaseModel = new modelType();

  if (id) {
    model._id = id.toString();
  }

  return model;
};
