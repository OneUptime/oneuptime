import {
  getRefusalText,
  RefusalWithValues,
} from "../../Types/Exception/RefusalWithValues";
import { translationKey } from "../../Types/Translator";

/*
 * WHY A MONITOR CANNOT BE LINKED TO A TEMPLATE, SYNCED FROM IT OR UNLINKED
 * (#7678).
 *
 * MonitorTemplateService refuses with these, and the template's page shows
 * them: Link Existing Monitors says why each monitor it could not link was
 * refused, and Sync from Template and Unlink from Template say why they did
 * not finish. They were fragments ("Monitor not found", "Monitor and
 * template belong to different projects") and a sentence with the two types
 * inside it ("Monitor type "Ping" does not match template type "API""), so
 * the page said them in English in every language. Each is a whole sentence
 * now, and a key of the Dashboard's locales (this directory is a source of
 * its string extractor). The type mismatch keeps its two types as
 * placeholders (RefusalWithValues): the Dashboard reads them back out of
 * the English and says the sentence with the reader's words for them.
 *
 * React-free and server-safe: the server throws these, the Dashboard reads
 * them.
 */

// The monitor is gone, or the caller may not see it.
export const MONITOR_NOT_FOUND_REFUSAL: string = translationKey(
  "This monitor does not exist in this project, or you do not have access to it.",
);

export const MONITOR_IN_ANOTHER_PROJECT_REFUSAL: string = translationKey(
  "This monitor and this template are in different projects.",
);

// Sync from Template and Unlink from Template reach only the template's own monitors.
export const MONITOR_NOT_LINKED_REFUSAL: string = translationKey(
  "This monitor is not linked to this template.",
);

/*
 * A template links only monitors of its own type: its criteria are written
 * for that type.
 */
export const MONITOR_TYPE_MISMATCH_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "This monitor's type is {{monitorType}}, and this template's type is {{templateType}}. Only monitors of the template's type can be linked to it.",
  ),
  terms: ["monitorType", "templateType"],
};

/*
 * A monitor made for a network device, linked to a template the device
 * already has a monitor of (issues #11260, #11266): a device has one
 * monitor from each template, which Monitor's unique (device, template)
 * index holds. The other monitor is named, as written, so the person can
 * find it and decide which of the two to keep.
 */
export const DEVICE_HAS_MONITOR_OF_TEMPLATE_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "The device this monitor was made for already has a monitor linked to this template: {{monitorName}}. Delete one of the two, or link this one to another template.",
  ),
  terms: [],
};

export const getDeviceHasMonitorOfTemplateRefusal: (
  monitorName: string,
) => string = (monitorName: string): string => {
  return getRefusalText(DEVICE_HAS_MONITOR_OF_TEMPLATE_REFUSAL, {
    monitorName: monitorName,
  });
};

// The same, when that monitor is one the person may not read: not named.
export const DEVICE_HAS_HIDDEN_MONITOR_OF_TEMPLATE_REFUSAL: string =
  translationKey(
    "The device this monitor was made for already has a monitor linked to this template. Delete one of the two, or link this one to another template.",
  );

// The type mismatch as the server answers it: in English, with the two types.
export const getMonitorTypeMismatchRefusal: (data: {
  monitorType: string;
  templateType: string;
}) => string = (data: {
  monitorType: string;
  templateType: string;
}): string => {
  return getRefusalText(MONITOR_TYPE_MISMATCH_REFUSAL, {
    monitorType: data.monitorType,
    templateType: data.templateType,
  });
};

/*
 * WHY A TEMPLATE ITSELF CANNOT BE SAVED, LINKED, SYNCED OR UNLINKED (#7711).
 *
 * The template's own refusals said "Monitor template not found", "Monitor
 * template is missing projectId", "Monitor template is missing
 * monitorType", "Monitor type is required to configure template sync
 * fields" and "Field "x" is not syncable from a monitor template": English
 * fragments that named its columns. Each is a whole sentence now that says
 * what to do, and a key of the Dashboard's locales; the one with a value in
 * it keeps the value as a placeholder (RefusalWithValues).
 */

// The template is gone, or the caller may not see it.
export const TEMPLATE_NOT_FOUND_REFUSAL: string = translationKey(
  "This monitor template does not exist in this project, or you do not have access to it. Reload the page, then try again.",
);

// A template that names no project, so no monitor of one can be linked to it.
export const TEMPLATE_WITHOUT_PROJECT_REFUSAL: string = translationKey(
  "This monitor template is in no project, so no monitor can be linked to it. Create the template again in this project.",
);

// A template that names no monitor type, whose monitors cannot be synced.
export const TEMPLATE_WITHOUT_TYPE_REFUSAL: string = translationKey(
  "This monitor template has no monitor type, so its monitors cannot be synced. Create the template again with a monitor type.",
);

// Template sync settings chosen before the template's monitor type.
export const SYNC_SETTINGS_WITHOUT_TYPE_REFUSAL: string = translationKey(
  "Template sync settings need the template's monitor type. Choose the monitor type first, then choose the sync settings again.",
);

// A setting a template does not sync, named by its path (an API client's).
export const FIELD_NOT_SYNCABLE_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'A monitor template cannot sync "{{field}}". Choose from the template sync settings the template offers, then save again.',
  ),
  terms: [],
};

// The setting refusal as the server answers it: in English, with the path.
export const getFieldNotSyncableRefusal: (field: string) => string = (
  field: string,
): string => {
  return getRefusalText(FIELD_NOT_SYNCABLE_REFUSAL, { field: field });
};
