import { translationKey } from "./TranslateTemplate";
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
}
