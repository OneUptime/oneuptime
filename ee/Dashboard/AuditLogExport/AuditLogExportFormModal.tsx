import { AuditLogExportCopy } from "./AuditLogExportCopy";
import {
  AuditLogExportFormSubmission,
  auditLogExportTestBody,
  auditLogExportTestDisabledReason,
  auditLogExportUpdatePayload,
  exportConfigFieldName,
  exportSecretFieldName,
  getAuditLogExportInitialValues,
  readAuditLogExportForm,
  readExportDestinationType,
} from "./AuditLogExportForm";
import { AuditLogExportInlineTest } from "./AuditLogExportTest";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import Route from "Common/Types/API/Route";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AuditLogExportDestinationCatalog,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
  AuditLogExportDestinationKind,
  getAuditLogExportDestinationDefinition,
  isAuditLogExportFieldShown,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ConnectorFieldOption } from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
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
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const EXPORT_DESTINATION_STEP_ID: string = "destination";
export const EXPORT_CONNECTION_STEP_ID: string = "connection";
export const EXPORT_SETTINGS_STEP_ID: string = "export";

export const AUDIT_LOG_EXPORT_SETUP_GUIDE_TEXT: string = "Setup guide";

function fieldTypeOf(
  field: AuditLogExportDestinationField,
): FormFieldSchemaType {
  if (field.isMultiline) {
    return FormFieldSchemaType.LongText;
  }

  switch (field.type) {
    case "dropdown":
      return FormFieldSchemaType.Dropdown;
    case "json":
      return FormFieldSchemaType.JSON;
    case "password":
      return FormFieldSchemaType.Password;
    case "url":
      return FormFieldSchemaType.URL;
    case "number":
      return FormFieldSchemaType.Number;
    default:
      return FormFieldSchemaType.Text;
  }
}

/*
 * The settings most people leave as they are (a folder, an Azure cloud, a
 * webhook's body format and signing secret, syslog framing): folded under
 * More fields, so a destination asks first for what it cannot do without.
 */
const advancedSection: FormFieldCollapsibleSection<JSONObject> =
  getAdvancedFormSection<JSONObject>();

// What the form holds for a destination's config, as the catalog reads it.
function readFormConfig(
  definition: AuditLogExportDestinationDefinition,
  values: FormValues<JSONObject>,
): JSONObject {
  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const value: JSONValue | undefined = (values as JSONObject)[
      exportConfigFieldName(definition.type, field.key)
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
 * The fields of the destinations the form offers, each shown only while its
 * destination is the one picked - and, for a field another field turns on
 * (Azure's SAS token or access key, syslog's CA certificate), only while
 * that field says so. Built from the catalog, so a destination added there
 * gets its form without a change here.
 */
export function getAuditLogExportConnectionFields(data: {
  definitions: Array<AuditLogExportDestinationDefinition>;
  isEditing: boolean;
  lockedType?: AuditLogExportDestinationType | undefined;
}): Array<Field<JSONObject>> {
  const fields: Array<Field<JSONObject>> = [];

  for (const definition of data.definitions) {
    const showIf: (
      field: AuditLogExportDestinationField,
    ) => (values: FormValues<JSONObject>) => boolean = (
      field: AuditLogExportDestinationField,
    ) => {
      return (values: FormValues<JSONObject>): boolean => {
        const picked: AuditLogExportDestinationType | undefined =
          readExportDestinationType(values as JSONObject, data.lockedType);

        return (
          picked === definition.type &&
          isAuditLogExportFieldShown({
            definition,
            field,
            config: readFormConfig(definition, values),
          })
        );
      };
    };

    const configField: (
      field: AuditLogExportDestinationField,
      isFirst: boolean,
    ) => Field<JSONObject> = (
      field: AuditLogExportDestinationField,
      isFirst: boolean,
    ): Field<JSONObject> => {
      return {
        field: {
          [exportConfigFieldName(definition.type, field.key)]: true,
        },
        title: field.title,
        description: field.description,
        stepId: EXPORT_CONNECTION_STEP_ID,
        fieldType: fieldTypeOf(field),
        required: field.required,
        disableSpellCheck: true,
        showIf: showIf(field),
        ...(field.isAdvanced ? { collapsibleSection: advancedSection } : {}),
        // The destination's setup guide, beside the first thing it asks for.
        ...(isFirst
          ? {
              sideLink: {
                text: AUDIT_LOG_EXPORT_SETUP_GUIDE_TEXT,
                url: Route.fromString(definition.docsPath),
                openLinkInNewTab: true,
              },
            }
          : {}),
        ...(field.type === "number"
          ? { validation: { minValue: 1, maxValue: 65535 } }
          : {}),
        /*
         * The catalog's default (us-east-1, SAS, TLS on 6514): the field
         * starts on it, and a fold reads it as nobody's setting.
         */
        ...(typeof field.defaultValue === "string"
          ? { defaultValue: field.defaultValue }
          : typeof field.defaultValue === "number"
            ? { defaultValue: String(field.defaultValue) }
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

    const secretField: (
      field: AuditLogExportDestinationField,
    ) => Field<JSONObject> = (
      field: AuditLogExportDestinationField,
    ): Field<JSONObject> => {
      return {
        field: {
          [exportSecretFieldName(definition.type, field.key)]: true,
        },
        title: field.title,
        description: field.description,
        stepId: EXPORT_CONNECTION_STEP_ID,
        fieldType:
          field.type === "json"
            ? FormFieldSchemaType.JSON
            : FormFieldSchemaType.Password,
        // A stored credential is never read back, so an edit never requires it.
        required: data.isEditing ? false : field.required,
        showIf: showIf(field),
        ...(field.isAdvanced ? { collapsibleSection: advancedSection } : {}),
        ...(data.isEditing
          ? { placeholder: AuditLogExportCopy.unchangedPlaceholder }
          : field.placeholder
            ? { placeholder: field.placeholder }
            : {}),
      };
    };

    // What the destination cannot do without, its credentials, then More fields.
    const essentials: Array<AuditLogExportDestinationField> =
      definition.configFields.filter(
        (field: AuditLogExportDestinationField): boolean => {
          return !field.isAdvanced;
        },
      );

    essentials.forEach(
      (field: AuditLogExportDestinationField, index: number): void => {
        fields.push(configField(field, index === 0));
      },
    );

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

export interface ComponentProps {
  // Set to edit; left out to add one.
  auditLogExport?: AuditLogExport | undefined;
  // The project a new export is for; none for the instance's.
  projectId?: ObjectID | undefined;
  // Where the form's test is sent (the scope's test route).
  testRoute: string;
  // The page's model API: the project's, or the Admin Dashboard's.
  modelAPI: typeof ModelAPI;
  onClose: () => void;
  onSaved: () => void;
}

/*
 * Add or edit an audit log export. Picks the destination - Amazon S3,
 * S3-compatible storage, Google Cloud Storage, Azure Blob Storage, a webhook
 * or syslog - walks its own settings (with a test that can be sent before
 * saving), then names it and says where it starts. An edit keeps its
 * destination, so it starts at the settings.
 */
const AuditLogExportFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const isEditing: boolean = Boolean(props.auditLogExport?.id);
  const lockedType: AuditLogExportDestinationType | undefined =
    props.auditLogExport?.destinationType;
  const lockedDefinition: AuditLogExportDestinationDefinition | undefined =
    getAuditLogExportDestinationDefinition(lockedType);
  const definitions: Array<AuditLogExportDestinationDefinition> =
    lockedDefinition ? [lockedDefinition] : AuditLogExportDestinationCatalog;

  const steps: Array<FormStep<JSONObject>> = [
    ...(lockedDefinition
      ? []
      : [
          {
            id: EXPORT_DESTINATION_STEP_ID,
            title: AuditLogExportCopy.destinationStep,
          },
        ]),
    { id: EXPORT_CONNECTION_STEP_ID, title: AuditLogExportCopy.connectionStep },
    { id: EXPORT_SETTINGS_STEP_ID, title: AuditLogExportCopy.exportStep },
  ];

  const fields: Array<Field<JSONObject>> = [
    ...(lockedDefinition
      ? []
      : [
          {
            field: { destinationType: true },
            title: AuditLogExportCopy.destinationField,
            description: AuditLogExportCopy.destinationFieldDescription,
            stepId: EXPORT_DESTINATION_STEP_ID,
            fieldType: FormFieldSchemaType.CardSelect,
            /*
             * One card per destination, two to a row: each carries a line
             * on what arrives there, which three columns squeeze, and six
             * destinations make three even rows.
             */
            cardSelectOptions: AuditLogExportDestinationCatalog.map(
              (definition: AuditLogExportDestinationDefinition) => {
                return {
                  value: definition.type,
                  title: definition.title,
                  description: definition.description,
                  icon: definition.icon,
                };
              },
            ),
            cardSelectMaxColumns: 2,
            required: true,
          } as Field<JSONObject>,
        ]),
    ...getAuditLogExportConnectionFields({
      definitions,
      isEditing,
      lockedType,
    }),
    {
      field: { testEntry: true },
      title: AuditLogExportCopy.testField,
      stepId: EXPORT_CONNECTION_STEP_ID,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
        const definition: AuditLogExportDestinationDefinition | undefined =
          getAuditLogExportDestinationDefinition(
            readExportDestinationType(values as JSONObject, lockedType),
          );

        return (
          <AuditLogExportInlineTest
            route={props.testRoute}
            modelAPI={props.modelAPI}
            writesFiles={
              definition?.kind !== AuditLogExportDestinationKind.Stream
            }
            buildBody={(): JSONObject => {
              return auditLogExportTestBody({
                values: values as JSONObject,
                auditLogExport: props.auditLogExport,
              });
            }}
            disabledReason={auditLogExportTestDisabledReason({
              values: values as JSONObject,
              auditLogExport: props.auditLogExport,
            })}
          />
        );
      },
    },
    {
      field: { name: true },
      title: AuditLogExportCopy.nameField,
      description: AuditLogExportCopy.nameFieldDescription,
      stepId: EXPORT_SETTINGS_STEP_ID,
      fieldType: FormFieldSchemaType.Text,
      // The destination's name when none is typed (readAuditLogExportForm).
      required: false,
      placeholder: AuditLogExportCopy.namePlaceholder,
    },
    ...(isEditing
      ? [
          {
            field: { isEnabled: true },
            title: AuditLogExportCopy.enabledField,
            description: AuditLogExportCopy.enabledFieldDescription,
            stepId: EXPORT_SETTINGS_STEP_ID,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          } as Field<JSONObject>,
        ]
      : []),
    {
      field: { startsAt: true },
      title: AuditLogExportCopy.startsAtField,
      description: isEditing
        ? AuditLogExportCopy.startsAtEditDescription
        : AuditLogExportCopy.startsAtCreateDescription,
      stepId: EXPORT_SETTINGS_STEP_ID,
      fieldType: FormFieldSchemaType.DateTime,
      required: false,
      collapsibleSection: advancedSection,
    },
  ];

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate(AuditLogExportCopy.editTitle, {
              name: props.auditLogExport?.name || lockedDefinition?.title || "",
            })
          : AuditLogExportCopy.createTitle
      }
      description={
        isEditing
          ? AuditLogExportCopy.editDescription
          : AuditLogExportCopy.createDescription
      }
      name={
        isEditing
          ? "Audit Logs > Edit Audit Log Export"
          : "Audit Logs > Add Audit Log Export"
      }
      modalWidth={ModalWidth.Large}
      isLoading={isLoading}
      error={error}
      submitButtonText={
        isEditing
          ? AuditLogExportCopy.saveButton
          : AuditLogExportCopy.createButton
      }
      onClose={(): void => {
        setIsLoading(false);
        props.onClose();
      }}
      onSubmit={async (values: JSONObject): Promise<void> => {
        setError(undefined);
        setIsLoading(true);

        try {
          const submission: AuditLogExportFormSubmission =
            readAuditLogExportForm(values, lockedType);

          if (isEditing && props.auditLogExport?.id) {
            await props.modelAPI.updateById<AuditLogExport>({
              modelType: AuditLogExport,
              id: props.auditLogExport.id,
              data: auditLogExportUpdatePayload({
                submission,
                auditLogExport: props.auditLogExport,
              }),
            });
          } else {
            const model: AuditLogExport = new AuditLogExport();

            if (props.projectId) {
              model.projectId = props.projectId;
            }

            model.name = submission.name;
            model.destinationType = submission.destinationType;
            model.config = submission.config;
            model.secrets = JSON.stringify(submission.secrets);
            model.isEnabled = true;

            if (submission.startsAt) {
              model.startsAt = submission.startsAt;
            }

            await props.modelAPI.create<AuditLogExport>({
              model,
              modelType: AuditLogExport,
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
          ? "edit-audit-log-export-form"
          : "create-audit-log-export-form",
        initialValues: getAuditLogExportInitialValues(
          props.auditLogExport,
          lockedType,
        ),
        steps,
        fields,
        // An edit opens any step from the step list; Save changes stays on the last.
        ...(isEditing ? { allowAnyStepNavigation: true } : {}),
      }}
    />
  );
};

export default AuditLogExportFormModal;
