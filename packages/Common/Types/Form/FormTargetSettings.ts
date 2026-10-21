import ObjectID from "../ObjectID";
import {
  FORM_INCIDENT_TITLE_MAX_LENGTH,
  FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
} from "./FormTargetCatalog";
import FormTargetType, { FORM_TARGET_TYPE_TEXT } from "./FormTargetType";

/*
 * What a form's submissions start with, beyond the answers: Form.
 * targetSettings, the form's On Submit page. The default title when the form
 * does not ask for one, the severity when the submitter does not choose
 * one, an incident template, the owners to notify, monitors and labels to
 * attach every time, and so on.
 *
 * One object for the form's current target, holding only that target's
 * settings. Ids are stored as lowercase uuids; whether each still names a
 * record of the form's project is the server's to check on write, and the
 * records deleted since are left out when a submission is made (a deleted
 * label is simply not attached).
 *
 * Pure, with no database or React imports.
 */

export interface IncidentFormTargetSettings {
  // The title when the form does not ask for one, or it is left empty.
  defaultTitle?: string | undefined;
  // The severity when the form does not ask for one, or it is left empty.
  incidentSeverityId?: string | undefined;
  /*
   * Incidents are declared from this template: whatever it sets applies
   * where the submission and the settings leave a field unset.
   */
  incidentTemplateId?: string | undefined;
  // Attached to every incident, together with any the submitter chooses.
  monitorIds?: Array<string> | undefined;
  labelIds?: Array<string> | undefined;
  onCallDutyPolicyIds?: Array<string> | undefined;
  // The incident's owners, told when it is declared.
  ownerUserIds?: Array<string> | undefined;
  ownerTeamIds?: Array<string> | undefined;
}

export interface ScheduledMaintenanceFormTargetSettings {
  defaultTitle?: string | undefined;
  monitorIds?: Array<string> | undefined;
  statusPageIds?: Array<string> | undefined;
  labelIds?: Array<string> | undefined;
  ownerUserIds?: Array<string> | undefined;
  ownerTeamIds?: Array<string> | undefined;
  /*
   * Off by default: a submission is somebody's request, and a request is
   * reviewed before it is published. When on, the event shows on its
   * status pages as soon as it is created.
   */
  showOnStatusPages?: boolean | undefined;
  /*
   * Off by default, for the same reason. When on, the status pages'
   * subscribers are told the event was scheduled.
   */
  notifySubscribers?: boolean | undefined;
}

export type FormTargetSettings =
  | IncidentFormTargetSettings
  | ScheduledMaintenanceFormTargetSettings;

// The record kinds a setting can name, for the server's project check.
export enum FormTargetSettingReferenceModel {
  IncidentSeverity = "IncidentSeverity",
  IncidentTemplate = "IncidentTemplate",
  Monitor = "Monitor",
  Label = "Label",
  OnCallDutyPolicy = "OnCallDutyPolicy",
  User = "User",
  Team = "Team",
  StatusPage = "StatusPage",
}

type SettingKind = "title" | "id" | "ids" | "boolean";

interface SettingDefinition {
  key: string;
  // The setting's name in an error message.
  title: string;
  kind: SettingKind;
  model?: FormTargetSettingReferenceModel | undefined;
}

const INCIDENT_SETTINGS: Array<SettingDefinition> = [
  { key: "defaultTitle", title: "Default Title", kind: "title" },
  {
    key: "incidentSeverityId",
    title: "Severity",
    kind: "id",
    model: FormTargetSettingReferenceModel.IncidentSeverity,
  },
  {
    key: "incidentTemplateId",
    title: "Incident Template",
    kind: "id",
    model: FormTargetSettingReferenceModel.IncidentTemplate,
  },
  {
    key: "monitorIds",
    title: "Monitors",
    kind: "ids",
    model: FormTargetSettingReferenceModel.Monitor,
  },
  {
    key: "labelIds",
    title: "Labels",
    kind: "ids",
    model: FormTargetSettingReferenceModel.Label,
  },
  {
    key: "onCallDutyPolicyIds",
    title: "On-Call Policies",
    kind: "ids",
    model: FormTargetSettingReferenceModel.OnCallDutyPolicy,
  },
  {
    key: "ownerUserIds",
    title: "Owner Users",
    kind: "ids",
    model: FormTargetSettingReferenceModel.User,
  },
  {
    key: "ownerTeamIds",
    title: "Owner Teams",
    kind: "ids",
    model: FormTargetSettingReferenceModel.Team,
  },
];

const SCHEDULED_MAINTENANCE_SETTINGS: Array<SettingDefinition> = [
  { key: "defaultTitle", title: "Default Title", kind: "title" },
  {
    key: "monitorIds",
    title: "Monitors",
    kind: "ids",
    model: FormTargetSettingReferenceModel.Monitor,
  },
  {
    key: "statusPageIds",
    title: "Status Pages",
    kind: "ids",
    model: FormTargetSettingReferenceModel.StatusPage,
  },
  {
    key: "labelIds",
    title: "Labels",
    kind: "ids",
    model: FormTargetSettingReferenceModel.Label,
  },
  {
    key: "ownerUserIds",
    title: "Owner Users",
    kind: "ids",
    model: FormTargetSettingReferenceModel.User,
  },
  {
    key: "ownerTeamIds",
    title: "Owner Teams",
    kind: "ids",
    model: FormTargetSettingReferenceModel.Team,
  },
  { key: "showOnStatusPages", title: "Show on Status Pages", kind: "boolean" },
  {
    key: "notifySubscribers",
    title: "Notify Subscribers",
    kind: "boolean",
  },
];

const SETTINGS_BY_TARGET: Record<FormTargetType, Array<SettingDefinition>> = {
  [FormTargetType.Incident]: INCIDENT_SETTINGS,
  [FormTargetType.ScheduledMaintenance]: SCHEDULED_MAINTENANCE_SETTINGS,
};

const TITLE_MAX_LENGTH: Record<FormTargetType, number> = {
  [FormTargetType.Incident]: FORM_INCIDENT_TITLE_MAX_LENGTH,
  [FormTargetType.ScheduledMaintenance]:
    FORM_SCHEDULED_MAINTENANCE_TITLE_MAX_LENGTH,
};

// The most records one list setting names.
export const FORM_TARGET_SETTING_MAX_IDS: number = 100;

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

type NormalizeIdFunction = (value: unknown) => string | null;

const normalizeId: NormalizeIdFunction = (value: unknown): string | null => {
  const id: string =
    value instanceof ObjectID
      ? value.toString().toLowerCase()
      : typeof value === "string"
        ? value.trim().toLowerCase()
        : "";

  return ObjectID.isValidUUID(id) ? id : null;
};

export type ReadFormTargetSettingsFunction = (data: {
  targetType: FormTargetType;
  value: unknown;
}) => FormTargetSettings;

/**
 * The stored settings for a form of this target, as everything else reads
 * them: only this target's settings, ids lowercased and listed once, empty
 * text and empty lists left out. Never throws.
 */
export const readFormTargetSettings: ReadFormTargetSettingsFunction = (data: {
  targetType: FormTargetType;
  value: unknown;
}): FormTargetSettings => {
  const settings: Record<string, unknown> = {};

  if (!isPlainObject(data.value)) {
    return settings;
  }

  for (const definition of SETTINGS_BY_TARGET[data.targetType] || []) {
    const raw: unknown = data.value[definition.key];

    switch (definition.kind) {
      case "title": {
        const title: string = typeof raw === "string" ? raw.trim() : "";

        if (title) {
          settings[definition.key] = title.slice(
            0,
            TITLE_MAX_LENGTH[data.targetType],
          );
        }
        break;
      }

      case "id": {
        const id: string | null = normalizeId(raw);

        if (id) {
          settings[definition.key] = id;
        }
        break;
      }

      case "ids": {
        const ids: Array<string> = [];

        for (const entry of Array.isArray(raw) ? raw : []) {
          const id: string | null = normalizeId(entry);

          if (id && !ids.includes(id)) {
            ids.push(id);
          }
        }

        if (ids.length > 0) {
          settings[definition.key] = ids.slice(0, FORM_TARGET_SETTING_MAX_IDS);
        }
        break;
      }

      case "boolean": {
        if (raw === true) {
          settings[definition.key] = true;
        }
        break;
      }
    }
  }

  return settings as FormTargetSettings;
};

export type ValidateFormTargetSettingsFunction = (data: {
  targetType: FormTargetType;
  value: unknown;
}) => string | null;

/**
 * Null when the settings can be stored for a form of this target, or one
 * message naming every problem: a setting the target does not have, a
 * title that is not text or too long for the record, an id that is not an
 * id, a list that is not a list of ids or names more than
 * FORM_TARGET_SETTING_MAX_IDS records, a switch that is not true or false.
 * Null and undefined - no settings at all - are fine.
 */
export const validateFormTargetSettings: ValidateFormTargetSettingsFunction =
  (data: { targetType: FormTargetType; value: unknown }): string | null => {
    if (data.value === null || data.value === undefined) {
      return null;
    }

    if (!isPlainObject(data.value)) {
      return "Target settings must be an object.";
    }

    const definitions: Array<SettingDefinition> =
      SETTINGS_BY_TARGET[data.targetType] || [];
    const problems: Array<string> = [];
    const target: string =
      FORM_TARGET_TYPE_TEXT[data.targetType].nounWithArticle;

    for (const key of Object.keys(data.value)) {
      const definition: SettingDefinition | undefined = definitions.find(
        (candidate: SettingDefinition): boolean => {
          return candidate.key === key;
        },
      );

      const raw: unknown = data.value[key];

      if (!definition) {
        problems.push(
          `"${key.slice(0, 60)}" is not a setting of forms that create ${target}. Settings: ${definitions
            .map((candidate: SettingDefinition): string => {
              return candidate.key;
            })
            .join(", ")}.`,
        );
        continue;
      }

      if (raw === null || raw === undefined) {
        continue;
      }

      switch (definition.kind) {
        case "title":
          if (typeof raw !== "string") {
            problems.push(`${definition.title} must be text.`);
          } else if (raw.trim().length > TITLE_MAX_LENGTH[data.targetType]) {
            problems.push(
              `${definition.title} cannot be more than ${TITLE_MAX_LENGTH[data.targetType]} characters.`,
            );
          }
          break;

        case "id":
          if (raw !== "" && !normalizeId(raw)) {
            problems.push(`${definition.title} must be an id.`);
          }
          break;

        case "ids":
          if (!Array.isArray(raw)) {
            problems.push(`${definition.title} must be a list of ids.`);
          } else if (raw.length > FORM_TARGET_SETTING_MAX_IDS) {
            problems.push(
              `${definition.title} cannot name more than ${FORM_TARGET_SETTING_MAX_IDS} records.`,
            );
          } else if (
            raw.some((entry: unknown): boolean => {
              return !normalizeId(entry);
            })
          ) {
            problems.push(`${definition.title} must be a list of ids.`);
          }
          break;

        case "boolean":
          if (typeof raw !== "boolean") {
            problems.push(`${definition.title} must be true or false.`);
          }
          break;
      }
    }

    return problems.length > 0 ? problems.join(" ") : null;
  };

export interface FormTargetSettingReference {
  // The setting's name, for the message when it names a foreign record.
  title: string;
  model: FormTargetSettingReferenceModel;
  ids: Array<string>;
}

export type GetFormTargetSettingReferencesFunction = (data: {
  targetType: FormTargetType;
  settings: FormTargetSettings;
}) => Array<FormTargetSettingReference>;

/**
 * Every record the (read) settings name, by kind, for the server to check
 * they belong to the form's project.
 */
export const getFormTargetSettingReferences: GetFormTargetSettingReferencesFunction =
  (data: {
    targetType: FormTargetType;
    settings: FormTargetSettings;
  }): Array<FormTargetSettingReference> => {
    const references: Array<FormTargetSettingReference> = [];
    const settings: Record<string, unknown> = data.settings as Record<
      string,
      unknown
    >;

    for (const definition of SETTINGS_BY_TARGET[data.targetType] || []) {
      if (!definition.model) {
        continue;
      }

      const value: unknown = settings[definition.key];
      const ids: Array<string> =
        definition.kind === "id"
          ? typeof value === "string"
            ? [value]
            : []
          : Array.isArray(value)
            ? (value as Array<string>)
            : [];

      if (ids.length > 0) {
        references.push({
          title: definition.title,
          model: definition.model,
          ids: ids,
        });
      }
    }

    return references;
  };

export type GetFormTargetSettingKeysFunction = (
  targetType: FormTargetType,
) => Array<string>;

// The settings a form of this target has.
export const getFormTargetSettingKeys: GetFormTargetSettingKeysFunction = (
  targetType: FormTargetType,
): Array<string> => {
  return (SETTINGS_BY_TARGET[targetType] || []).map(
    (definition: SettingDefinition): string => {
      return definition.key;
    },
  );
};
