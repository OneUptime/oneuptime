import CustomFieldType from "./CustomFieldType";

/*
 * One custom field, as the rest of the product needs to read it: the shape
 * that comes back from a `*CustomField` definition table, narrowed to the four
 * properties anything rendering or filtering by it actually uses.
 *
 * Lives in Types rather than beside the table columns that first needed it
 * because the facet bar builds its chips from the same definitions, and that
 * code is compiled by App's `tsc`, which has no React in it — importing the
 * type from a .tsx would pull React into a program that cannot resolve it.
 * `CustomFieldColumns` re-exports it, so existing imports keep working.
 */
export interface CustomFieldDefinition {
  name: string;
  description?: string | undefined;
  customFieldType?: CustomFieldType | undefined;
  /**
   * Serialized options for a Dropdown / MultiSelectDropdown field. Parse with
   * `parseCustomFieldDropdownOptions` — the value is either the legacy
   * one-per-line format or a JSON array of `{ value, color }`.
   */
  dropdownOptions?: string | undefined;
}
