import { JSONObject } from "../JSON";

/*
 * An incident template's custom field values, copied onto an incident being
 * declared from it.
 *
 * A MERGE, never a replacement: the template fills in the fields the incident
 * does not set, and a value the incident does set - the answer someone typed
 * on the Details step, or one an API caller sent - always wins. A key set to
 * null or an empty string wins too: that is an explicit "no value" for that
 * field, not a gap for the template to fill.
 *
 * Shared by the server, which copies a template's values when an incident is
 * created with `createdIncidentTemplateId`, and kept pure so it is tested on
 * its own. (The dashboard's Create page merges on the client instead, with
 * the Details step's values on top: see packCustomFieldFormValues.)
 */

type IsPlainObjectFunction = (value: unknown) => value is JSONObject;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is JSONObject => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

export type MergeTemplateCustomFieldsFunction = (data: {
  // The template's bag, keyed by field name.
  templateCustomFields: unknown;
  // What the incident is being created with, if anything.
  customFields: unknown;
}) => JSONObject | undefined;

/**
 * The incident's bag with the template's values filled in, or undefined when
 * there is nothing to change: the template has no values, or the incident's
 * `customFields` is something other than a bag (which is left exactly as it
 * was sent, for the caller's own mistake to surface as it would have).
 */
export const mergeTemplateCustomFields: MergeTemplateCustomFieldsFunction =
  (data: {
    templateCustomFields: unknown;
    customFields: unknown;
  }): JSONObject | undefined => {
    if (
      !isPlainObject(data.templateCustomFields) ||
      Object.keys(data.templateCustomFields).length === 0
    ) {
      return undefined;
    }

    if (data.customFields === undefined || data.customFields === null) {
      return { ...data.templateCustomFields };
    }

    if (!isPlainObject(data.customFields)) {
      return undefined;
    }

    return {
      ...data.templateCustomFields,
      ...data.customFields,
    };
  };

export default mergeTemplateCustomFields;
