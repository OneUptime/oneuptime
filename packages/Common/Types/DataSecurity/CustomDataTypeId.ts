/*
 * HOW A PROJECT'S OWN DATA TYPE IS KEYED.
 *
 * Stores, issues and findings carry data type ids: a built-in type's
 * ("credit-card-number", DataTypeCatalog), or "custom:" and the id of the
 * row a project defined it in (DataSecurityCustomDataType), so one can never
 * collide with a built-in id. The scanner writes them
 * (Utils/DataSecurity/CustomDataTypeDetector) and everything that names a
 * type reads them (DataTypeNamer).
 */

export const CUSTOM_DATA_TYPE_ID_PREFIX: string = "custom:";

export function customDataTypeId(rowId: string): string {
  return CUSTOM_DATA_TYPE_ID_PREFIX + rowId;
}

export function isCustomDataTypeId(dataTypeId: string): boolean {
  return dataTypeId.startsWith(CUSTOM_DATA_TYPE_ID_PREFIX);
}
