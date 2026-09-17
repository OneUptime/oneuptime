/*
 * The member VALUES are load-bearing beyond this enum.
 *
 * CustomFieldsDetail passes a definition's `customFieldType` straight through
 * as the `fieldType` of a Detail field and of a form field, so every member
 * here has to name a member of BOTH `FieldType` (Detail) and
 * `FormFieldSchemaType` (Forms) by value. `Boolean` is the standing example:
 * it reaches the form as FormFieldSchemaType.Toggle, which is spelled
 * `Toggle = "Boolean"` for exactly this reason.
 *
 * Adding a member without that correspondence compiles fine and then renders
 * an empty cell and an input the user cannot type into.
 */
enum CustomFieldType {
  Text = "Text",
  Number = "Number",
  Boolean = "Boolean",
  Dropdown = "Dropdown",
  MultiSelectDropdown = "MultiSelectDropdown",

  /**
   * A calendar date with no time of day — purchase date, warranty expiry,
   * end-of-life. Stored in the `customFields` jsonb bag as an ISO-8601 string,
   * which is what makes it comparable: ISO-8601 sorts identically as text and
   * as an instant, so the range filters work over a jsonb key without a cast
   * (see JSONColumnQuery.compareText).
   */
  Date = "Date",

  /**
   * As `Date`, but the time of day is part of the answer — last audited at,
   * decommissioned at.
   */
  DateTime = "DateTime",
}

export default CustomFieldType;
