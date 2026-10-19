import { SECURITY_EVENT_DESTINATION_SCOPE_TEXTS } from "./SecurityConnectionsCopy";
import { SecurityEventDestinationInlineTest } from "./SecurityEventDestinationTest";
import {
  SecurityEventDestinationFormSubmission,
  destinationConfigFieldName,
  destinationSecretFieldName,
  destinationTestDisabledReason,
  readSecurityEventDestinationForm,
  securityEventDestinationTestBody,
  securityEventDestinationUpdatePayload,
} from "./SecurityEventDestinationUtil";
import SecurityEventDestination from "Common/Models/DatabaseModels/SecurityEventDestination";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  ConnectorField,
  ConnectorFieldOption,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  SecurityEventDestinationCatalog,
  SecurityEventDestinationDefinition,
  getSecurityEventDestinationDefinition,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationCatalog";
import {
  DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE,
  SECURITY_EVENT_DESTINATION_SCOPES,
  SecurityEventDestinationScopeOption,
} from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationScope";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";

export const DESTINATION_PROVIDER_STEP_ID: string = "provider";
export const DESTINATION_CONNECTION_STEP_ID: string = "connection";
export const DESTINATION_SEND_STEP_ID: string = "send";

export function getDestinationScopeChoices(): Array<RadioButton> {
  return SECURITY_EVENT_DESTINATION_SCOPES.map(
    (option: SecurityEventDestinationScopeOption): RadioButton => {
      return {
        value: option.scope,
        title: SECURITY_EVENT_DESTINATION_SCOPE_TEXTS[option.scope].title,
        description:
          SECURITY_EVENT_DESTINATION_SCOPE_TEXTS[option.scope].description,
      };
    },
  );
}

function fieldTypeOf(field: ConnectorField): FormFieldSchemaType {
  switch (field.type) {
    case "dropdown":
      return FormFieldSchemaType.Dropdown;
    case "json":
      return FormFieldSchemaType.JSON;
    case "password":
      return FormFieldSchemaType.Password;
    case "url":
      return FormFieldSchemaType.URL;
    default:
      return FormFieldSchemaType.Text;
  }
}

/*
 * The fields of the SIEMs the form offers, each shown only while its SIEM
 * is the one picked. Built from the catalog, so a SIEM added there gets its
 * form without a change here.
 */
export function getDestinationConnectionFields(data: {
  definitions: Array<SecurityEventDestinationDefinition>;
  isEditing: boolean;
  lockedProvider?: string | undefined;
}): Array<Field<JSONObject>> {
  const fields: Array<Field<JSONObject>> = [];

  const isSelected: (
    definition: SecurityEventDestinationDefinition,
  ) => (values: FormValues<JSONObject>) => boolean = (
    definition: SecurityEventDestinationDefinition,
  ) => {
    return (values: FormValues<JSONObject>): boolean => {
      const picked: JSONValue | undefined = data.lockedProvider
        ? data.lockedProvider
        : ((values as JSONObject)["provider"] as JSONValue | undefined);

      return picked === definition.provider;
    };
  };

  for (const definition of data.definitions) {
    for (const field of definition.configFields) {
      fields.push({
        field: {
          [destinationConfigFieldName(definition.provider, field.key)]: true,
        },
        title: field.title,
        description: field.description,
        stepId: DESTINATION_CONNECTION_STEP_ID,
        fieldType: fieldTypeOf(field),
        required: field.required,
        disableSpellCheck: true,
        showIf: isSelected(definition),
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
      });
    }

    for (const field of definition.secretFields) {
      fields.push({
        field: {
          [destinationSecretFieldName(definition.provider, field.key)]: true,
        },
        title: field.title,
        description: field.description,
        stepId: DESTINATION_CONNECTION_STEP_ID,
        fieldType:
          field.type === "json"
            ? FormFieldSchemaType.JSON
            : FormFieldSchemaType.Password,
        // A stored secret is never read back, so an edit never requires it.
        required: data.isEditing ? false : field.required,
        showIf: isSelected(definition),
        ...(data.isEditing
          ? { placeholder: "Unchanged" }
          : field.placeholder
            ? { placeholder: field.placeholder }
            : {}),
      });
    }
  }

  return fields;
}

export interface ComponentProps {
  // Set to edit; left out to add one.
  destination?: SecurityEventDestination | undefined;
  onClose: () => void;
  onSaved: () => void;
}

/*
 * Add or edit a SIEM OneUptime sends security events to. Walks the SIEM's
 * own settings (with a test event that can be sent before saving), then
 * what to send. Today the SIEM is Google SecOps; the provider step appears
 * once the catalog offers more than one.
 */
const SecurityEventDestinationFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const isEditing: boolean = Boolean(props.destination?.id);
  const lockedProvider: string | undefined =
    props.destination?.provider ||
    (SecurityEventDestinationCatalog.length === 1
      ? SecurityEventDestinationCatalog[0]!.provider
      : undefined);
  const lockedDefinition: SecurityEventDestinationDefinition | undefined =
    getSecurityEventDestinationDefinition(lockedProvider);
  const definitions: Array<SecurityEventDestinationDefinition> =
    lockedDefinition ? [lockedDefinition] : SecurityEventDestinationCatalog;

  const steps: Array<FormStep<JSONObject>> = [
    ...(lockedDefinition
      ? []
      : [{ id: DESTINATION_PROVIDER_STEP_ID, title: "SIEM" }]),
    // The dialog's title already names the SIEM.
    { id: DESTINATION_CONNECTION_STEP_ID, title: "Connection" },
    { id: DESTINATION_SEND_STEP_ID, title: "What to send" },
  ];

  const fields: Array<Field<JSONObject>> = [
    ...(lockedDefinition
      ? []
      : [
          {
            field: { provider: true },
            title: "SIEM",
            description: "Where OneUptime sends your security events.",
            stepId: DESTINATION_PROVIDER_STEP_ID,
            fieldType: FormFieldSchemaType.CardSelect,
            cardSelectOptions: [
              {
                label: "SIEM",
                options: SecurityEventDestinationCatalog.map(
                  (definition: SecurityEventDestinationDefinition) => {
                    return {
                      value: definition.provider,
                      title: definition.title,
                      description: definition.description,
                      icon: definition.icon,
                    };
                  },
                ),
              },
            ],
            required: true,
          } as Field<JSONObject>,
        ]),
    ...getDestinationConnectionFields({
      definitions,
      isEditing,
      lockedProvider,
    }),
    {
      field: { testEvent: true },
      title: "Test before saving",
      stepId: DESTINATION_CONNECTION_STEP_ID,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
        return (
          <SecurityEventDestinationInlineTest
            buildBody={(): JSONObject => {
              return securityEventDestinationTestBody({
                values: values as JSONObject,
                destination: props.destination,
              });
            }}
            disabledReason={destinationTestDisabledReason({
              values: {
                ...(values as JSONObject),
                ...(lockedProvider ? { provider: lockedProvider } : {}),
              },
              destination: props.destination,
            })}
          />
        );
      },
    },
    {
      field: { name: true },
      title: "Name",
      description: "How this destination appears in the list.",
      stepId: DESTINATION_SEND_STEP_ID,
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "e.g. Google SecOps production",
    },
    {
      field: { sendScope: true },
      title: "What to send",
      stepId: DESTINATION_SEND_STEP_ID,
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: getDestinationScopeChoices(),
      required: true,
    },
    ...(isEditing
      ? [
          {
            field: { isEnabled: true },
            title: "Send",
            description:
              "Turned off, nothing is sent; events that arrive meanwhile are not sent later.",
            stepId: DESTINATION_SEND_STEP_ID,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
          } as Field<JSONObject>,
        ]
      : []),
  ];

  const initialValues: JSONObject = {
    name: props.destination?.name || lockedDefinition?.title || "",
    sendScope:
      props.destination?.sendScope || DEFAULT_SECURITY_EVENT_DESTINATION_SCOPE,
    isEnabled: props.destination ? props.destination.isEnabled !== false : true,
  };

  if (lockedProvider) {
    initialValues["provider"] = lockedProvider;
  }

  if (props.destination && lockedDefinition) {
    const config: JSONObject = props.destination.config || {};

    for (const field of lockedDefinition.configFields) {
      const value: JSONValue | undefined = config[field.key];

      if (value !== undefined && value !== null) {
        initialValues[
          destinationConfigFieldName(lockedDefinition.provider, field.key)
        ] = value;
      }
    }
  }

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate("Edit {{name}}", {
              name: props.destination?.name || lockedDefinition?.title || "",
            })
          : lockedDefinition
            ? translator.translateTemplate("Send to {{name}}", {
                name: lockedDefinition.title,
              })
            : "Send to your SIEM"
      }
      description={
        isEditing
          ? "Change where and what is sent. The key stays unless you paste a new one."
          : "OneUptime sends what it finds to the SIEM your team already works in, as it happens. Send a test event before saving."
      }
      name={
        isEditing
          ? "Security Events > Edit SIEM Destination"
          : "Security Events > Add SIEM Destination"
      }
      modalWidth={ModalWidth.Large}
      isLoading={isLoading}
      error={error}
      submitButtonText={isEditing ? "Save changes" : "Start sending"}
      onClose={(): void => {
        setIsLoading(false);
        props.onClose();
      }}
      onSubmit={async (values: JSONObject): Promise<void> => {
        setError(undefined);
        setIsLoading(true);

        try {
          const submission: SecurityEventDestinationFormSubmission =
            readSecurityEventDestinationForm(values, lockedProvider);

          if (isEditing && props.destination?.id) {
            await ModelAPI.updateById<SecurityEventDestination>({
              modelType: SecurityEventDestination,
              id: props.destination.id,
              data: securityEventDestinationUpdatePayload(submission),
            });
          } else {
            const model: SecurityEventDestination =
              new SecurityEventDestination();
            model.projectId = ProjectUtil.getCurrentProjectId()!;
            model.name = submission.name;
            model.provider = submission.provider as never;
            model.config = submission.config;
            model.secrets = JSON.stringify(submission.secrets);
            model.sendScope = submission.sendScope;
            model.isEnabled = true;

            await ModelAPI.create<SecurityEventDestination>({
              model,
              modelType: SecurityEventDestination,
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
          ? "edit-security-event-destination-form"
          : "create-security-event-destination-form",
        initialValues,
        steps,
        fields,
      }}
    />
  );
};

export default SecurityEventDestinationFormModal;
