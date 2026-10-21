import { translationKey } from "./TranslateTemplate";
import { DropdownOption } from "../Components/Dropdown/Dropdown";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
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

// The tag beside an archived value a record still has.
export const ARCHIVED_VALUE_TAG: string = translationKey("Archived");

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

    const model: { getColumnValue?: (column: string) => unknown } = value as {
      getColumnValue?: (column: string) => unknown;
    };

    if (typeof model.getColumnValue === "function") {
      return model.getColumnValue(ARCHIVED_COLUMN) === true;
    }

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
   * `keptIds` - so its form still shows them, marked Archived and never
   * offered for a new pick (isDisabled). Every other archived value is left
   * out.
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
          description: ARCHIVED_VALUE_TAG,
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
}
