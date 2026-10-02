import { LIMIT_PER_PROJECT } from "../Database/LimitMax";
import Dictionary from "../Dictionary";
import { isValidCustomFieldVariableKey } from "./CustomFieldVariableKey";

/*
 * What happens to an incident custom field when an incident is declared: is
 * it asked for, and must it be filled in? A project answers that once per
 * field, with the field's own Show on Create and Required on Create switches.
 * This module is how an incident template answers it differently for itself
 * (issue #4114): a template for a data breach can require "Affected
 * Location" while the others leave it out.
 *
 * The settings are one JSON object KEYED BY THE FIELD'S TEMPLATE VARIABLE KEY
 * (IncidentCustomField.variableKey), never by its name. Values are stored by
 * name, but a name can change; the key is made from the name once and never
 * changes, so renaming a field keeps every template's setting for it, and a
 * template exported to another project finds the same fields there. A field
 * the object does not list is Default.
 *
 * A template only overrides: Default (or no entry) leaves the field's own
 * switches in charge - see applyTemplateCustomFieldCreateSettings.
 *
 * Only the dashboard's Declare Incident form applies them. Incidents created
 * through the API, by monitors, workflows, integrations and forms never see
 * a template's settings, exactly as they never see the project-wide Required
 * on Create. (A form - the Forms product - asks the custom fields its own
 * questions are linked to, and nothing else; see Types/Form/FormField.)
 *
 * Pure, with no database or React imports, so the server that checks a write
 * and the dashboard that applies a template read the settings the same way.
 */

export enum CustomFieldCreateSetting {
  // Follow the field's own Show on Create and Required on Create.
  Default = "Default",
  // Asked for, and must be filled in.
  Required = "Required",
  // Asked for, and may be left empty.
  Optional = "Optional",
  // Not asked for.
  Hidden = "Hidden",
}

// One setting per field, keyed by the field's template variable key.
export type CustomFieldCreateSettings = Dictionary<CustomFieldCreateSetting>;

/*
 * What a field ends up as once Default is resolved: asked and required,
 * asked, or not asked.
 */
export type EffectiveCustomFieldCreateSetting =
  | CustomFieldCreateSetting.Required
  | CustomFieldCreateSetting.Optional
  | CustomFieldCreateSetting.Hidden;

// Every setting, in the order a picker lists them.
export const CUSTOM_FIELD_CREATE_SETTINGS: ReadonlyArray<CustomFieldCreateSetting> =
  [
    CustomFieldCreateSetting.Default,
    CustomFieldCreateSetting.Required,
    CustomFieldCreateSetting.Optional,
    CustomFieldCreateSetting.Hidden,
  ];

/*
 * One entry per field at most, and a project holds at most this many fields.
 * Anything larger is not a settings object anybody wrote by hand.
 */
export const CUSTOM_FIELD_CREATE_SETTINGS_MAX_ENTRIES: number =
  LIMIT_PER_PROJECT;

/*
 * The fields a definition needs for its setting to be applied. The key is
 * optional because older rows predate it (every field has had one since
 * migration 1795800000000), and a definition without one can only be Default.
 */
export interface CustomFieldCreateSettingsDefinition {
  variableKey?: string | null | undefined;
  showOnCreate?: boolean | null | undefined;
  isRequiredOnCreate?: boolean | null | undefined;
}

/*
 * Problems are reported together so an API caller fixing several entries
 * does not find them one request at a time, but bounded: a settings object
 * made of ten thousand typos still reads as a few sentences.
 */
const MAX_LISTED_PROBLEMS: number = 5;

// Keys and values are quoted back, cut short so a pasted essay stays one line.
const MAX_QUOTED_LENGTH: number = 80;

type QuoteFunction = (value: unknown) => string;

const quote: QuoteFunction = (value: unknown): string => {
  let text: string | undefined;

  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }

  if (text === undefined) {
    text = String(value);
  }

  if (text.length > MAX_QUOTED_LENGTH) {
    text = `${text.slice(0, MAX_QUOTED_LENGTH)}...`;
  }

  return `"${text}"`;
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
};

/*
 * Own properties only. A field named "Constructor" has the key "constructor",
 * and reading that off a plain object that does not list it would otherwise
 * find Object.prototype.constructor.
 */
type HasOwnFunction = (target: Record<string, unknown>, key: string) => boolean;

const hasOwn: HasOwnFunction = (
  target: Record<string, unknown>,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(target, key);
};

export type IsCustomFieldCreateSettingFunction = (
  value: unknown,
) => value is CustomFieldCreateSetting;

/**
 * Whether a value is one of the four settings, spelled exactly as the enum
 * spells it. "required" is not "Required": the server stores what it is sent
 * and never rewrites it, so it only accepts what it can store as sent.
 */
export const isCustomFieldCreateSetting: IsCustomFieldCreateSettingFunction = (
  value: unknown,
): value is CustomFieldCreateSetting => {
  return (
    typeof value === "string" &&
    (CUSTOM_FIELD_CREATE_SETTINGS as ReadonlyArray<string>).includes(value)
  );
};

export type ValidateCustomFieldCreateSettingsFunction = (
  value: unknown,
) => string | null;

/**
 * Why a value cannot be stored as a template's custom field
 * settings, or null when it can. Nothing (null or undefined) is fine: it
 * clears the settings.
 *
 * It only judges, never repairs. The API stores exactly what it was sent:
 * Terraform compares a JSON column with the value in its configuration, so a
 * server that dropped a Default entry or fixed the case of a value would
 * report a change on every plan.
 */
export const validateCustomFieldCreateSettings: ValidateCustomFieldCreateSettingsFunction =
  (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }

    if (!isPlainObject(value)) {
      return `Custom Field Settings must be an object that maps each incident custom field's template variable key to Required, Optional, Hidden or Default, such as {"impact": "Required"}, but was sent ${quote(
        value,
      )}.`;
    }

    const entries: Array<[string, unknown]> = Object.entries(value);

    if (entries.length > CUSTOM_FIELD_CREATE_SETTINGS_MAX_ENTRIES) {
      return `Custom Field Settings can list at most ${CUSTOM_FIELD_CREATE_SETTINGS_MAX_ENTRIES} fields, but lists ${entries.length}.`;
    }

    const problems: Array<string> = [];

    for (const [key, setting] of entries) {
      if (!isValidCustomFieldVariableKey(key)) {
        problems.push(
          `${quote(
            key,
          )} is not an incident custom field's template variable key. Keys are lowercase letters and digits joined by single underscores, such as "affected_location".`,
        );
        continue;
      }

      if (!isCustomFieldCreateSetting(setting)) {
        problems.push(
          `The setting for ${quote(
            key,
          )} must be Required, Optional, Hidden or Default, but was sent ${quote(
            setting,
          )}.`,
        );
      }
    }

    if (problems.length === 0) {
      return null;
    }

    const listed: string = problems.slice(0, MAX_LISTED_PROBLEMS).join(" ");
    const more: number = problems.length - MAX_LISTED_PROBLEMS;

    if (more <= 0) {
      return listed;
    }

    return `${listed} ${more} more ${
      more === 1 ? "entry is" : "entries are"
    } not valid either.`;
  };

export type ReadCustomFieldCreateSettingsFunction = (
  value: unknown,
) => CustomFieldCreateSettings;

/**
 * The settings a stored value holds, for anything that applies them: every
 * entry with a valid key and a valid setting, and nothing else. Never throws,
 * so a value written before validation existed - or by hand, straight into
 * the database - makes those fields Default instead of breaking the page
 * that reads it.
 */
export const readCustomFieldCreateSettings: ReadCustomFieldCreateSettingsFunction =
  (value: unknown): CustomFieldCreateSettings => {
    const settings: CustomFieldCreateSettings = {};

    if (!isPlainObject(value)) {
      return settings;
    }

    for (const [key, setting] of Object.entries(value)) {
      if (
        isValidCustomFieldVariableKey(key) &&
        isCustomFieldCreateSetting(setting)
      ) {
        settings[key] = setting;
      }
    }

    return settings;
  };

export type GetCustomFieldCreateSettingFunction = (
  settings: unknown,
  variableKey?: string | null | undefined,
) => CustomFieldCreateSetting;

/**
 * One field's setting: Default when the settings do not list the key, list
 * something invalid for it, or the field has no key at all.
 */
export const getCustomFieldCreateSetting: GetCustomFieldCreateSettingFunction =
  (
    settings: unknown,
    variableKey?: string | null | undefined,
  ): CustomFieldCreateSetting => {
    if (
      !variableKey ||
      !isValidCustomFieldVariableKey(variableKey) ||
      !isPlainObject(settings) ||
      !hasOwn(settings, variableKey)
    ) {
      return CustomFieldCreateSetting.Default;
    }

    const setting: unknown = settings[variableKey];

    return isCustomFieldCreateSetting(setting)
      ? setting
      : CustomFieldCreateSetting.Default;
  };

export type GetEffectiveCustomFieldCreateSettingFunction = (
  definition: CustomFieldCreateSettingsDefinition,
  settings?: unknown,
) => EffectiveCustomFieldCreateSetting;

/**
 * What the Details step of declaring an incident does with a field, once a
 * template's settings are applied: Required, Optional or Hidden. Default
 * resolves to the field's own switches - Hidden unless Show on Create is on,
 * then Required or Optional by Required on Create - so with no settings this
 * is the field's project-wide behaviour, which a settings picker can show
 * next to "Default".
 */
export const getEffectiveCustomFieldCreateSetting: GetEffectiveCustomFieldCreateSettingFunction =
  (
    definition: CustomFieldCreateSettingsDefinition,
    settings?: unknown,
  ): EffectiveCustomFieldCreateSetting => {
    const setting: CustomFieldCreateSetting = getCustomFieldCreateSetting(
      settings,
      definition.variableKey,
    );

    if (setting !== CustomFieldCreateSetting.Default) {
      return setting;
    }

    /*
     * The same two tests the Declare Incident form makes: only fields with
     * Show on Create are on its Details step, and only those with Required on
     * Create as well are required there. Required alone asks for nothing.
     */
    if (definition.showOnCreate !== true) {
      return CustomFieldCreateSetting.Hidden;
    }

    return definition.isRequiredOnCreate === true
      ? CustomFieldCreateSetting.Required
      : CustomFieldCreateSetting.Optional;
  };

type CopyWithFunction = <T extends CustomFieldCreateSettingsDefinition>(
  definition: T,
  changes: {
    showOnCreate?: boolean;
    isRequiredOnCreate?: boolean;
  },
) => T;

/*
 * A copy of a definition with its switches changed. The copy keeps the
 * original's prototype: a server caller may hand over model instances, and a
 * spread would return plain objects that TypeScript still types as models -
 * the first method called on one would throw.
 */
const copyWith: CopyWithFunction = <
  T extends CustomFieldCreateSettingsDefinition,
>(
  definition: T,
  changes: {
    showOnCreate?: boolean;
    isRequiredOnCreate?: boolean;
  },
): T => {
  const copy: T = Object.create(Object.getPrototypeOf(definition)) as T;

  return Object.assign(copy, definition, changes);
};

export type ApplyTemplateCustomFieldCreateSettingsFunction = <
  T extends CustomFieldCreateSettingsDefinition,
>(
  definitions: Array<T>,
  settings: unknown,
) => Array<T>;

/**
 * The project's field definitions as an incident template's settings make
 * them: Required shows the field and requires it, Optional shows it without
 * requiring it, Hidden leaves it off, and Default leaves the field's own
 * switches as they are. Hand the result to whatever picks the Details step's
 * fields (they filter on showOnCreate), and every later step - the initial
 * values, the required checks, the subscriber preview - follows.
 *
 * Returns new objects, in the order given; the definitions passed in are
 * never changed.
 */
export const applyTemplateCustomFieldCreateSettings: ApplyTemplateCustomFieldCreateSettingsFunction =
  <T extends CustomFieldCreateSettingsDefinition>(
    definitions: Array<T>,
    settings: unknown,
  ): Array<T> => {
    const read: CustomFieldCreateSettings =
      readCustomFieldCreateSettings(settings);

    return definitions.map((definition: T): T => {
      switch (getCustomFieldCreateSetting(read, definition.variableKey)) {
        case CustomFieldCreateSetting.Required:
          return copyWith(definition, {
            showOnCreate: true,
            isRequiredOnCreate: true,
          });

        case CustomFieldCreateSetting.Optional:
          return copyWith(definition, {
            showOnCreate: true,
            isRequiredOnCreate: false,
          });

        case CustomFieldCreateSetting.Hidden:
          return copyWith(definition, {
            showOnCreate: false,
            isRequiredOnCreate: false,
          });

        default:
          return copyWith(definition, {});
      }
    });
  };

export type CompactCustomFieldCreateSettingsFunction = (
  settings: unknown,
) => CustomFieldCreateSettings;

/**
 * The smallest settings object that means the same thing, for a settings
 * form to save: Default entries (which say nothing) and invalid ones are
 * left out. The server never does
 * this to what it is sent (see validateCustomFieldCreateSettings); a client
 * that wants a tidy value sends one.
 */
export const compactCustomFieldCreateSettings: CompactCustomFieldCreateSettingsFunction =
  (settings: unknown): CustomFieldCreateSettings => {
    const compacted: CustomFieldCreateSettings = {};

    for (const [key, setting] of Object.entries(
      readCustomFieldCreateSettings(settings),
    )) {
      if (setting === CustomFieldCreateSetting.Default) {
        continue;
      }

      compacted[key] = setting;
    }

    return compacted;
  };
