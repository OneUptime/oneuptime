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

  /**
   * Several lines of plain text — additional information, affected users or
   * systems. Stored as a string, exactly like `Text`; only the input (a text
   * area) and the rendering (line breaks kept) differ.
   */
  LongText = "LongText",

  /**
   * Rich text, written in the Markdown editor (which has a visual mode) and
   * stored as the Markdown source string. Anything that renders it must go
   * through the Markdown renderer, never insert it as HTML.
   */
  Markdown = "Markdown",

  /**
   * One file - a signed change request, a contract, a diagram - uploaded on
   * the record. Stored in the `customFields` bag as a reference to the file
   * (CustomFieldFile: its id, name, type and size), never the bytes, which
   * stay in File. The server writes the reference from the file itself
   * (Server/Utils/CustomField/CustomFieldFiles), and the file is served only
   * to someone who may read the record, as a download.
   */
  File = "File",

  /**
   * As `File`, but several: a list of references, in the order they were
   * added, at most CUSTOM_FIELD_MAX_FILES of them.
   */
  MultipleFiles = "MultipleFiles",
}

export default CustomFieldType;
