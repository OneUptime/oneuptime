import { DataCheckType } from "Common/Types/DataObservability/DataCheckType";
import { translationKey, Translator } from "Common/Types/Translator";

/*
 * WHAT A CHECK MEASURES, IN THE READER'S WORDS (#7223).
 *
 * A check's type is stored as its English name ("Null Percent"), and the
 * Checks tab drew that value as it is: the form's Check dropdown and the
 * list's Check filter, the line under each check's name, and each
 * suggested check's facts read English on every page, with no locale file
 * holding most of the names. Each type now has its name here, a key every
 * language words, drawn as the reader reads it. What is saved and what a
 * checks file writes (`type: Null Percent`) stay the English value.
 *
 * React-free, beside DataCheckAlertConditionWords: App's tests read it
 * without React.
 */
export const DATA_CHECK_TYPE_LABELS: Readonly<Record<DataCheckType, string>> = {
  [DataCheckType.NullPercent]: translationKey("Null Percent"),
  [DataCheckType.DuplicatePercent]: translationKey("Duplicate Percent"),
  [DataCheckType.DistinctCount]: translationKey("Distinct Count"),
  [DataCheckType.Minimum]: translationKey("Minimum"),
  [DataCheckType.Maximum]: translationKey("Maximum"),
  [DataCheckType.Average]: translationKey("Average"),
  [DataCheckType.Sum]: translationKey("Sum"),
  [DataCheckType.InvalidPercent]: translationKey("Invalid Percent"),
  [DataCheckType.FormatMismatchPercent]: translationKey(
    "Format Mismatch Percent",
  ),
  [DataCheckType.OrphanCount]: translationKey("Orphan Count"),
  [DataCheckType.RowCount]: translationKey("Row Count"),
  [DataCheckType.CustomSql]: translationKey("Custom SQL"),
  [DataCheckType.FailingRows]: translationKey("Failing Rows"),
  [DataCheckType.DbtTest]: translationKey("dbt Test"),
};

/*
 * A check's type as the reader reads it: "Anteil NULL-Werte" for Null
 * Percent on a German page. A value that is no type a check has is drawn
 * as it is, rather than as nothing.
 */
export const getDataCheckTypeLabel: (data: {
  translator: Translator;
  checkType: string | null | undefined;
}) => string = (data: {
  translator: Translator;
  checkType: string | null | undefined;
}): string => {
  const value: string = data.checkType || "";
  const label: string | undefined = Object.prototype.hasOwnProperty.call(
    DATA_CHECK_TYPE_LABELS,
    value,
  )
    ? DATA_CHECK_TYPE_LABELS[value as DataCheckType]
    : undefined;

  if (!label) {
    return value;
  }

  return data.translator.translateText(label) || label;
};
