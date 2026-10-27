import { BACKUP_FREQUENCY_COPY, BackupsCopy } from "./BackupsCopy";
import {
  BACKUP_PROVIDER_FIELD,
  backupConfigFieldName,
  backupSecretFieldName,
  backupSettingPayload,
  backupTestBody,
  backupTestDisabledReason,
  getBackupFormInitialValues,
  getProviderField,
  keepsStoredBackupSecrets,
  readBackupProvider,
} from "./BackupDestinationForm";
import BackupDestinationTestPanel from "./BackupDestinationTestPanel";
import { describeUtcHourOption, getWeekdayName } from "./BackupFormat";
import AdminModelAPI from "@oneuptime/admin-dashboard/Utils/ModelAPI";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import Route from "Common/Types/API/Route";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import {
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProvider,
  BackupProviderCatalog,
  BackupProviderDefinition,
  getBackupDestinationDefinition,
  isBackupFieldShown,
} from "Common/Types/Backup/BackupDestinationCatalog";
import {
  AllBackupFrequencies,
  BackupFrequency,
  MAX_BACKUP_RETENTION_IN_DAYS,
  MIN_BACKUP_RETENTION_IN_DAYS,
  parseBackupTimeOfDay,
  TimeOfDay,
} from "Common/Types/Backup/BackupSchedule";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { ConnectorFieldOption } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { getFeedClock } from "Common/UI/Components/Feed/FeedTime";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Set up backups, or change them: where they go (a recommended destination,
 * as a card), how OneUptime reaches it (that destination's own fields, with
 * its setup guide beside them and a test that can run before anything is
 * saved), then when they run and how long they are kept.
 *
 * Credentials are never read back: an edit leaves them as they are unless
 * new ones are pasted, and asks for them only when the destination changes.
 */

export const BACKUP_DESTINATION_STEP_ID: string = "destination";
export const BACKUP_CONNECTION_STEP_ID: string = "connection";
export const BACKUP_SCHEDULE_STEP_ID: string = "schedule";

function fieldTypeOf(field: BackupDestinationField): FormFieldSchemaType {
  switch (field.type) {
    case "dropdown":
      return FormFieldSchemaType.Dropdown;
    case "password":
      return FormFieldSchemaType.Password;
    case "url":
      return FormFieldSchemaType.URL;
    default:
      return FormFieldSchemaType.Text;
  }
}

// The form's config of a destination, as the catalog reads it (for showWhen).
function readFormConfig(
  provider: BackupProviderDefinition,
  definition: BackupDestinationDefinition,
  values: FormValues<JSONObject>,
): JSONObject {
  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const value: JSONValue | undefined = (values as JSONObject)[
      backupConfigFieldName(provider.provider, field.key)
    ] as JSONValue | undefined;

    if (value !== undefined && value !== null) {
      config[field.key] =
        typeof value === "object" && !Array.isArray(value) && "value" in value
          ? ((value as JSONObject)["value"] as JSONValue)
          : value;
    }
  }

  return config;
}

/*
 * Every recommended destination's fields, each shown only while its
 * destination is the one picked (and, for a field another one turns on -
 * Azure's SAS token or access key - only while that one says so). What a
 * destination cannot do without comes first, its credentials next, and the
 * rest (a folder, a region, an Azure cloud) under More fields.
 */
export function getBackupConnectionFields(data: {
  setting?: BackupSetting | undefined;
}): Array<Field<JSONObject>> {
  const fields: Array<Field<JSONObject>> = [];
  const advancedSection: FormFieldCollapsibleSection<JSONObject> =
    getAdvancedFormSection<JSONObject>();

  for (const provider of BackupProviderCatalog) {
    const definition: BackupDestinationDefinition | undefined =
      getBackupDestinationDefinition(provider.type);

    if (!definition) {
      continue;
    }

    // An edit that stays with its destination keeps the stored credentials.
    const keepsSecrets: boolean = keepsStoredBackupSecrets({
      provider: provider.provider,
      setting: data.setting,
    });

    const showIf: (
      field: BackupDestinationField,
    ) => (values: FormValues<JSONObject>) => boolean = (
      field: BackupDestinationField,
    ) => {
      return (values: FormValues<JSONObject>): boolean => {
        return (
          readBackupProvider(values as JSONObject)?.provider ===
            provider.provider &&
          isBackupFieldShown({
            definition,
            field,
            config: readFormConfig(provider, definition, values),
          })
        );
      };
    };

    const configField: (
      catalogField: BackupDestinationField,
      isFirst: boolean,
    ) => Field<JSONObject> = (
      catalogField: BackupDestinationField,
      isFirst: boolean,
    ): Field<JSONObject> => {
      const field: BackupDestinationField = getProviderField(
        provider,
        catalogField,
      );

      return {
        field: {
          [backupConfigFieldName(provider.provider, field.key)]: true,
        },
        title: field.title,
        description: field.description,
        stepId: BACKUP_CONNECTION_STEP_ID,
        fieldType: fieldTypeOf(field),
        required: field.required,
        disableSpellCheck: true,
        showIf: showIf(field),
        ...(field.isAdvanced ? { collapsibleSection: advancedSection } : {}),
        // The destination's setup guide, beside the first thing it asks for.
        ...(isFirst
          ? {
              sideLink: {
                text: BackupsCopy.setupGuide,
                url: Route.fromString(provider.docsPath),
                openLinkInNewTab: true,
              },
            }
          : {}),
        ...(typeof field.defaultValue === "string"
          ? { defaultValue: field.defaultValue }
          : {}),
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.type === "dropdown"
          ? {
              dropdownOptions: (field.options || []).map(
                (option: ConnectorFieldOption): DropdownOption => {
                  return { label: option.label, value: option.value };
                },
              ),
            }
          : {}),
      };
    };

    const secretField: (field: BackupDestinationField) => Field<JSONObject> = (
      field: BackupDestinationField,
    ): Field<JSONObject> => {
      return {
        field: {
          [backupSecretFieldName(provider.provider, field.key)]: true,
        },
        title: field.title,
        description: field.description,
        stepId: BACKUP_CONNECTION_STEP_ID,
        fieldType: FormFieldSchemaType.Password,
        // A stored credential is never read back, so keeping it needs nothing typed.
        required: keepsSecrets ? false : field.required,
        showIf: showIf(field),
        ...(field.isAdvanced ? { collapsibleSection: advancedSection } : {}),
        ...(keepsSecrets
          ? { placeholder: BackupsCopy.unchangedPlaceholder }
          : field.placeholder
            ? { placeholder: field.placeholder }
            : {}),
      };
    };

    const essentials: Array<BackupDestinationField> =
      definition.configFields.filter(
        (field: BackupDestinationField): boolean => {
          return !field.isAdvanced;
        },
      );

    essentials.forEach((field: BackupDestinationField, index: number): void => {
      fields.push(configField(field, index === 0));
    });

    for (const field of definition.secretFields) {
      if (!field.isAdvanced) {
        fields.push(secretField(field));
      }
    }

    for (const field of definition.configFields) {
      if (field.isAdvanced) {
        fields.push(configField(field, essentials.length === 0));
      }
    }

    for (const field of definition.secretFields) {
      if (field.isAdvanced) {
        fields.push(secretField(field));
      }
    }
  }

  return fields;
}

// The 24 whole hours, in UTC, each with the reader's own time beside it.
export function getBackupTimeOptions(data: {
  translator: Translator;
  now?: Date | undefined;
  // A saved time that is not a whole hour (set through the API) stays a choice.
  savedTimeOfDay?: string | undefined;
}): Array<DropdownOption> {
  const clock: ReturnType<typeof getFeedClock> = getFeedClock({
    language: data.translator.language,
    now: data.now,
  });
  const options: Array<DropdownOption> = [];

  for (let hour: number = 0; hour < 24; hour++) {
    options.push({
      value: `${String(hour).padStart(2, "0")}:00`,
      label: describeUtcHourOption({
        hour,
        clock,
        translator: data.translator,
      }),
    });
  }

  const saved: TimeOfDay | null = parseBackupTimeOfDay(data.savedTimeOfDay);

  if (saved && saved.minutes !== 0 && data.savedTimeOfDay) {
    options.splice(saved.hours + 1, 0, {
      value: data.savedTimeOfDay,
      label: `${data.savedTimeOfDay} UTC`,
    });
  }

  return options;
}

export function getBackupScheduleFields(data: {
  translator: Translator;
  setting?: BackupSetting | undefined;
  now?: Date | undefined;
}): Array<Field<JSONObject>> {
  const readFrequency: (values: FormValues<JSONObject>) => string = (
    values: FormValues<JSONObject>,
  ): string => {
    const value: unknown = (values as JSONObject)["frequency"];

    return typeof value === "object" && value && "value" in value
      ? String((value as JSONObject)["value"])
      : String(value || "");
  };

  return [
    {
      field: { frequency: true },
      title: BackupsCopy.frequencyField,
      description: BackupsCopy.frequencyFieldDescription,
      stepId: BACKUP_SCHEDULE_STEP_ID,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      dropdownOptions: AllBackupFrequencies.map(
        (frequency: BackupFrequency): DropdownOption => {
          return { value: frequency, label: BACKUP_FREQUENCY_COPY[frequency] };
        },
      ),
    },
    {
      field: { timeOfDay: true },
      title: BackupsCopy.timeField,
      description: BackupsCopy.timeFieldDescription,
      stepId: BACKUP_SCHEDULE_STEP_ID,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      // Every hour runs on the hour: no time to choose.
      showIf: (values: FormValues<JSONObject>): boolean => {
        return readFrequency(values) !== BackupFrequency.EveryHour;
      },
      dropdownOptions: getBackupTimeOptions({
        translator: data.translator,
        now: data.now,
        savedTimeOfDay: data.setting?.timeOfDay,
      }),
    },
    {
      field: { dayOfWeek: true },
      title: BackupsCopy.dayField,
      stepId: BACKUP_SCHEDULE_STEP_ID,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      showIf: (values: FormValues<JSONObject>): boolean => {
        return readFrequency(values) === BackupFrequency.Weekly;
      },
      dropdownOptions: [0, 1, 2, 3, 4, 5, 6].map(
        (day: number): DropdownOption => {
          return {
            value: String(day),
            label: getWeekdayName(day, data.translator.language),
          };
        },
      ),
    },
    {
      field: { retentionInDays: true },
      title: BackupsCopy.retentionField,
      description: BackupsCopy.retentionFieldDescription,
      stepId: BACKUP_SCHEDULE_STEP_ID,
      fieldType: FormFieldSchemaType.Number,
      required: true,
      validation: {
        minValue: MIN_BACKUP_RETENTION_IN_DAYS,
        maxValue: MAX_BACKUP_RETENTION_IN_DAYS,
      },
    },
    {
      field: { includesClickhouse: true },
      title: BackupsCopy.clickhouseField,
      description: BackupsCopy.clickhouseFieldDescription,
      stepId: BACKUP_SCHEDULE_STEP_ID,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    },
  ];
}

export interface ComponentProps {
  // Set to edit; left out to set backups up.
  setting?: BackupSetting | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const BackupSettingsFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const isEditing: boolean = Boolean(props.setting?.id);

  const steps: Array<FormStep<JSONObject>> = [
    { id: BACKUP_DESTINATION_STEP_ID, title: BackupsCopy.destinationStep },
    { id: BACKUP_CONNECTION_STEP_ID, title: BackupsCopy.connectionStep },
    { id: BACKUP_SCHEDULE_STEP_ID, title: BackupsCopy.scheduleStep },
  ];

  const fields: Array<Field<JSONObject>> = [
    {
      field: { [BACKUP_PROVIDER_FIELD]: true },
      title: BackupsCopy.destinationField,
      description: BackupsCopy.destinationFieldDescription,
      stepId: BACKUP_DESTINATION_STEP_ID,
      fieldType: FormFieldSchemaType.CardSelect,
      // Two to a row: each card carries a line on what tells it from the others.
      cardSelectOptions: BackupProviderCatalog.map(
        (provider: BackupProviderDefinition) => {
          return {
            value: provider.provider,
            title: provider.title,
            description: provider.description,
            icon: provider.icon,
            logo: provider.logo,
          };
        },
      ),
      cardSelectMaxColumns: 2,
      required: true,
    } as Field<JSONObject>,
    ...getBackupConnectionFields({ setting: props.setting }),
    {
      field: { testEntry: true },
      title: BackupsCopy.testField,
      stepId: BACKUP_CONNECTION_STEP_ID,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
        return (
          <BackupDestinationTestPanel
            buildBody={(): JSONObject => {
              return backupTestBody({
                values: values as JSONObject,
                setting: props.setting,
              });
            }}
            disabledReason={backupTestDisabledReason({
              values: values as JSONObject,
              setting: props.setting,
            })}
          />
        );
      },
    },
    ...getBackupScheduleFields({ translator, setting: props.setting }),
  ];

  return (
    <BasicFormModal<JSONObject>
      title={isEditing ? BackupsCopy.editTitle : BackupsCopy.createTitle}
      description={
        isEditing ? BackupsCopy.editDescription : BackupsCopy.createDescription
      }
      name={
        isEditing
          ? "Settings > Backups > Edit Backup Settings"
          : "Settings > Backups > Set Up Backups"
      }
      modalWidth={ModalWidth.Large}
      isLoading={isLoading}
      error={error}
      submitButtonText={
        isEditing ? BackupsCopy.saveButton : BackupsCopy.createButton
      }
      onClose={(): void => {
        setIsLoading(false);
        props.onClose();
      }}
      onSubmit={async (values: JSONObject): Promise<void> => {
        setError(undefined);
        setIsLoading(true);

        try {
          const payload: JSONObject = backupSettingPayload({
            values,
            setting: props.setting,
          });

          if (isEditing && props.setting?.id) {
            await AdminModelAPI.updateById<BackupSetting>({
              modelType: BackupSetting,
              id: props.setting.id,
              data: payload,
            });
          } else {
            const model: BackupSetting = new BackupSetting();

            model.destinationType = payload[
              "destinationType"
            ] as BackupDestinationType;
            model.destinationProvider = payload[
              "destinationProvider"
            ] as BackupProvider;
            model.config = payload["config"] as JSONObject;
            model.secrets = (payload["secrets"] as string | undefined) || "{}";
            model.frequency = payload["frequency"] as BackupFrequency;
            model.timeOfDay = payload["timeOfDay"] as string;
            model.dayOfWeek = payload["dayOfWeek"] as number;
            model.retentionInDays = payload["retentionInDays"] as number;
            model.includesClickhouse = payload["includesClickhouse"] === true;
            // Set up to back up on the schedule: that is what it is for.
            model.isEnabled = true;

            await AdminModelAPI.create<BackupSetting>({
              model,
              modelType: BackupSetting,
            });
          }

          setIsLoading(false);
          props.onSaved();
        } catch (err) {
          setIsLoading(false);
          setError(API.getFriendlyErrorMessage(err as Error));
        }
      }}
      formProps={{
        id: isEditing
          ? "edit-backup-settings-form"
          : "create-backup-settings-form",
        initialValues: getBackupFormInitialValues(props.setting),
        steps,
        fields,
        // An edit opens any step from the step list; Save changes stays on the last.
        ...(isEditing ? { allowAnyStepNavigation: true } : {}),
      }}
    />
  );
};

export default BackupSettingsFormModal;
