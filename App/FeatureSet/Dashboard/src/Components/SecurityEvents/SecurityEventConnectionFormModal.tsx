import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import SecurityEventConnection from "Common/Models/DatabaseModels/SecurityEventConnection";
import HashedString from "Common/Types/HashedString";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { SecurityConnectorTestReport } from "Common/Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  ConnectorField,
  SecurityEventConnectorCatalog,
  SecurityEventConnectorCategories,
  SecurityEventConnectorCategory,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider, {
  isSecurityEventConnectorProvider,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { CardSelectOptionGroup } from "Common/UI/Components/CardSelect/CardSelect";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  InlineConnectionTest,
  connectionTestSettingsKey,
  runConnectionTestRequest,
} from "./ConnectionTestModal";
import {
  SECURITY_EVENT_CONNECTION_TEST_ROUTE,
  connectorDocsUrl,
} from "./SecurityEventConnectionDiagnosticsUtil";

export const PROVIDER_STEP_ID: string = "provider";
export const CONNECTION_STEP_ID: string = "connection";
export const CREDENTIALS_STEP_ID: string = "credentials";
export const POLLING_STEP_ID: string = "polling";

/*
 * Every provider's fields live in ONE form and are shown or hidden by the
 * selected provider. Several providers share field keys (tenantId,
 * clientId, clientSecret...), so the form name is namespaced per provider
 * to keep values, validation and initial defaults from bleeding across a
 * provider switch. The submit mapping strips the namespace again.
 */
export function configFieldName(provider: string, key: string): string {
  return `${provider}__config__${key}`;
}

export function secretFieldName(provider: string, key: string): string {
  return `${provider}__secret__${key}`;
}

/*
 * The "Remove the stored {title}" toggle an OPTIONAL secret gets on edit. A
 * blank password input has to keep meaning "unchanged" (stored secrets are
 * never read back, so the input always starts empty), which leaves no way
 * to delete a value; switching AWS from temporary to long-lived keys, or
 * Splunk from a token to a username and password, needs exactly that.
 */
export function removeSecretFieldName(provider: string, key: string): string {
  return `${provider}__removeSecret__${key}`;
}

export const TEST_SETTINGS_FIELD_NAME: string = "testTheseSettings";

export interface SecurityEventConnectionFormSubmission {
  provider: SecurityEventConnectorProvider;
  name: string;
  description: string | undefined;
  config: JSONObject;
  /*
   * Only the secret fields the user acted on: the typed value, or null for
   * an optional secret whose Remove toggle is on (the API deletes a key
   * sent as null and keeps any key that is absent or "").
   */
  secrets: JSONObject;
  isEnabled: boolean;
  pollIntervalInMinutes: number;
  alertingOnly: boolean;
}

function readString(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // BasicForm wraps Password values in HashedString before submit.
  if (value instanceof HashedString) {
    return value.toString();
  }

  if (typeof value === "object" && "value" in (value as JSONObject)) {
    // A Dropdown value that has not been unwrapped yet ({ label, value }).
    return readString((value as JSONObject)["value"]);
  }

  return String(value).trim();
}

function readConfigValue(
  field: ConnectorField,
  raw: JSONValue | undefined,
): JSONValue | undefined {
  if (field.type === "toggle") {
    return raw === true;
  }

  const text: string = readString(raw);

  if (text === "") {
    return undefined;
  }

  if (field.type === "number") {
    const parsed: number = Number(text);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return text;
}

/*
 * Turn the namespaced form values into what the API stores. Unknown keys
 * are never forwarded: the server rejects config keys the catalog does
 * not list, and a stale value from a previously selected provider would
 * otherwise fail the save with a confusing message.
 */
export function readSecurityEventConnectionForm(
  values: JSONObject,
  providerOverride?: string | undefined,
): SecurityEventConnectionFormSubmission {
  const provider: string = providerOverride || readString(values["provider"]);
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(provider);

  if (!definition || !isSecurityEventConnectorProvider(provider)) {
    throw new Error("Choose a provider before saving.");
  }

  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const value: JSONValue | undefined = readConfigValue(
      field,
      values[configFieldName(provider, field.key)] as JSONValue | undefined,
    );

    if (value !== undefined) {
      config[field.key] = value;
    }
  }

  const secrets: JSONObject = {};

  for (const field of definition.secretFields) {
    /*
     * Removal wins over anything typed in the input: the toggle is the
     * explicit instruction. A required secret can never be removed, so a
     * stray toggle value for one is ignored rather than sent.
     */
    if (
      !field.required &&
      values[removeSecretFieldName(provider, field.key)] === true
    ) {
      secrets[field.key] = null;
      continue;
    }

    const value: string = readString(
      values[secretFieldName(provider, field.key)] as JSONValue | undefined,
    );

    if (value !== "") {
      secrets[field.key] = value;
    }
  }

  const interval: number = Number(readString(values["pollIntervalInMinutes"]));

  return {
    provider,
    name: readString(values["name"]),
    description: readString(values["description"]) || undefined,
    config,
    secrets,
    isEnabled: values["isEnabled"] !== false,
    pollIntervalInMinutes: Number.isFinite(interval)
      ? interval
      : definition.defaultPollIntervalInMinutes,
    alertingOnly: values["alertingOnly"] !== false,
  };
}

/*
 * A new connection has nothing stored to remove; the create form never
 * shows the Remove toggles, and this keeps a null out of a create body even
 * if one were set.
 */
function withoutRemovedSecrets(secrets: JSONObject): JSONObject {
  const kept: JSONObject = {};

  for (const key of Object.keys(secrets)) {
    const value: JSONValue | undefined = secrets[key];

    if (value !== null && value !== undefined) {
      kept[key] = value;
    }
  }

  return kept;
}

/*
 * The body for POST /security-event-connection/test. Unsaved settings on
 * create; on edit the connection id plus the edits, so blank secrets keep
 * the stored values and a secret sent as null is tested as removed (the API
 * overlays secrets with the same rule the save uses).
 */
export function securityEventConnectionTestBody(data: {
  values: JSONObject;
  connection?: SecurityEventConnection | undefined;
  credentialsOnly?: boolean | undefined;
}): JSONObject {
  const provider: string | undefined = data.connection?.provider;
  const submission: SecurityEventConnectionFormSubmission =
    readSecurityEventConnectionForm(data.values, provider);

  if (data.connection?.id) {
    const body: JSONObject = {
      connectionId: data.connection.id.toString(),
      secrets: submission.secrets,
    };

    if (!data.credentialsOnly) {
      body["config"] = submission.config;
    }

    return body;
  }

  return {
    provider: submission.provider,
    config: submission.config,
    secrets: withoutRemovedSecrets(submission.secrets),
    alertingOnly: submission.alertingOnly,
  };
}

export function securityEventConnectionUpdatePayload(
  submission: SecurityEventConnectionFormSubmission,
  credentialsOnly: boolean,
): JSONObject {
  if (credentialsOnly) {
    return { secrets: JSON.stringify(submission.secrets) };
  }

  return {
    name: submission.name,
    description: submission.description || "",
    config: submission.config,
    isEnabled: submission.isEnabled,
    pollIntervalInMinutes: submission.pollIntervalInMinutes,
    alertingOnly: submission.alertingOnly,
    /*
     * A blank credential step means "keep what is stored"; a removal (null)
     * is a change, so it is sent like a typed value.
     */
    ...(Object.keys(submission.secrets).length > 0
      ? { secrets: JSON.stringify(submission.secrets) }
      : {}),
  };
}

function fieldTypeFor(field: ConnectorField): FormFieldSchemaType {
  switch (field.type) {
    case "url":
      return FormFieldSchemaType.URL;
    case "password":
      return FormFieldSchemaType.Password;
    case "number":
      return FormFieldSchemaType.Number;
    case "toggle":
      return FormFieldSchemaType.Toggle;
    case "dropdown":
      return FormFieldSchemaType.Dropdown;
    default:
      return FormFieldSchemaType.Text;
  }
}

export function providerCardOptions(): Array<CardSelectOptionGroup> {
  return SecurityEventConnectorCategories.map(
    (category: SecurityEventConnectorCategory): CardSelectOptionGroup => {
      return {
        label: category,
        options: SecurityEventConnectorCatalog.filter(
          (definition: SecurityEventConnectorDefinition): boolean => {
            return definition.category === category;
          },
        ).map((definition: SecurityEventConnectorDefinition) => {
          return {
            value: definition.provider,
            title: definition.title,
            description: definition.description,
            icon: definition.icon,
            keywords: [definition.vendorName, definition.productName],
          };
        }),
      };
    },
  ).filter((group: CardSelectOptionGroup): boolean => {
    return group.options.length > 0;
  });
}

interface InlineSettingsTestProps {
  values: JSONObject;
  connection?: SecurityEventConnection | undefined;
  credentialsOnly?: boolean | undefined;
}

/*
 * Wires the shared inline tester to this form's values: the body is built
 * from whatever the form holds at the moment the button is pressed.
 */
const InlineSettingsTest: FunctionComponent<InlineSettingsTestProps> = (
  props: InlineSettingsTestProps,
): ReactElement => {
  const valuesRef: React.MutableRefObject<JSONObject> = useRef<JSONObject>(
    props.values,
  );
  valuesRef.current = props.values;

  const provider: string =
    props.connection?.provider || readString(props.values["provider"]);
  const definition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(provider);

  /*
   * The report is only shown while the form still holds the values it was
   * tested with; editing a key after a green result hides that result.
   */
  const settingsKey: string = connectionTestSettingsKey((): JSONObject => {
    return securityEventConnectionTestBody({
      values: props.values,
      connection: props.connection,
      credentialsOnly: props.credentialsOnly,
    });
  });

  return (
    <InlineConnectionTest
      providerTitle={definition?.title || "the provider"}
      disabledReason={
        definition ? undefined : "Choose a provider before testing."
      }
      settingsKey={settingsKey}
      runTest={(): Promise<SecurityConnectorTestReport> => {
        return runConnectionTestRequest({
          route: SECURITY_EVENT_CONNECTION_TEST_ROUTE,
          body: securityEventConnectionTestBody({
            values: valuesRef.current,
            connection: props.connection,
            credentialsOnly: props.credentialsOnly,
          }),
        });
      }}
    />
  );
};

export interface ComponentProps {
  // Set for edit; absent for create.
  connection?: SecurityEventConnection | undefined;
  // Only the credentials step (the "Update credentials" row action).
  credentialsOnly?: boolean | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const SecurityEventConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /*
   * BasicFormModal's footer button is the form's submit button on every
   * step, so it has to read "Next" until the last step the way
   * ModelFormModal's does; otherwise step one shows "Create connection".
   */
  const [isLastStep, setIsLastStep] = useState<boolean>(false);
  const isEditing: boolean = Boolean(props.connection?.id);
  const credentialsOnly: boolean = Boolean(props.credentialsOnly && isEditing);
  const lockedProvider: string | undefined = props.connection?.provider;
  const lockedDefinition: SecurityEventConnectorDefinition | undefined =
    getSecurityEventConnectorDefinition(lockedProvider);

  const isSelected: (
    definition: SecurityEventConnectorDefinition,
  ) => (values: FormValues<JSONObject>) => boolean = (
    definition: SecurityEventConnectorDefinition,
  ) => {
    return (values: FormValues<JSONObject>): boolean => {
      return (
        (lockedProvider || readString(values["provider"] as JSONValue)) ===
        definition.provider
      );
    };
  };

  const definitions: Array<SecurityEventConnectorDefinition> = lockedDefinition
    ? [lockedDefinition]
    : SecurityEventConnectorCatalog;

  const steps: Array<FormStep<JSONObject>> = [];

  if (!isEditing) {
    steps.push({ id: PROVIDER_STEP_ID, title: "Provider" });
  }

  if (!credentialsOnly) {
    steps.push({ id: CONNECTION_STEP_ID, title: "Connection" });
  }

  steps.push({ id: CREDENTIALS_STEP_ID, title: "Credentials" });

  if (!credentialsOnly) {
    steps.push({ id: POLLING_STEP_ID, title: "Polling" });
  }

  const fields: Array<Field<JSONObject>> = [];

  if (!isEditing) {
    fields.push({
      field: { provider: true },
      title: "Provider",
      description:
        "The security product to import from. Each provider has its own setup guide with the roles and values it needs.",
      stepId: PROVIDER_STEP_ID,
      fieldType: FormFieldSchemaType.CardSelect,
      cardSelectOptions: providerCardOptions(),
      required: true,
    });
  }

  for (const definition of definitions) {
    if (!credentialsOnly) {
      definition.configFields.forEach(
        (field: ConnectorField, index: number): void => {
          fields.push({
            field: { [configFieldName(definition.provider, field.key)]: true },
            title: field.title,
            description: field.description,
            stepId: CONNECTION_STEP_ID,
            fieldType: fieldTypeFor(field),
            required: field.required,
            ...(field.placeholder ? { placeholder: field.placeholder } : {}),
            disableSpellCheck: true,
            showIf: isSelected(definition),
            ...(index === 0
              ? {
                  sectionTitle: `${definition.title} settings`,
                  sectionDescription: `Values from your ${definition.vendorName} console. The setup guide explains where each one lives.`,
                  sideLink: {
                    text: `${definition.title} setup guide`,
                    url: connectorDocsUrl(definition),
                    openLinkInNewTab: true,
                  },
                }
              : {}),
            ...(field.type === "dropdown"
              ? {
                  dropdownOptions: (field.options || []).map(
                    (option: {
                      label: string;
                      value: string;
                    }): DropdownOption => {
                      return { label: option.label, value: option.value };
                    },
                  ),
                }
              : {}),
          });
        },
      );
    }

    definition.secretFields.forEach(
      (field: ConnectorField, index: number): void => {
        fields.push({
          field: { [secretFieldName(definition.provider, field.key)]: true },
          title: field.title,
          description: isEditing
            ? `${field.description} Leave blank to keep the stored value.`
            : field.description,
          stepId: CREDENTIALS_STEP_ID,
          fieldType: FormFieldSchemaType.Password,
          // Stored secrets can never be read back, so editing never requires them.
          required: isEditing ? false : field.required,
          ...(isEditing
            ? { placeholder: "Unchanged" }
            : field.placeholder
              ? { placeholder: field.placeholder }
              : {}),
          showIf: isSelected(definition),
          ...(index === 0
            ? {
                sectionTitle: `${definition.title} credentials`,
                sectionDescription:
                  "Encrypted at rest and never returned by the API.",
                sideLink: {
                  text: `${definition.title} setup guide`,
                  url: connectorDocsUrl(definition),
                  openLinkInNewTab: true,
                },
              }
            : {}),
        });

        /*
         * Only an optional secret can be removed: deleting a required one
         * would leave a connection the server refuses to save. The password
         * input above stays visible (hiding it would also hide the section
         * heading it carries) and is ignored while the toggle is on.
         */
        if (isEditing && !field.required) {
          fields.push({
            field: {
              [removeSecretFieldName(definition.provider, field.key)]: true,
            },
            title: `Remove the stored ${field.title}`,
            description: `On: the stored ${field.title} is deleted when you save, for example after switching to a different sign-in method. Anything typed in ${field.title} is ignored while this is on.`,
            stepId: CREDENTIALS_STEP_ID,
            fieldType: FormFieldSchemaType.Toggle,
            required: false,
            showIf: isSelected(definition),
          });
        }
      },
    );
  }

  fields.push({
    field: { [TEST_SETTINGS_FIELD_NAME]: true },
    title: "Test before saving",
    stepId: CREDENTIALS_STEP_ID,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    showIf: (values: FormValues<JSONObject>): boolean => {
      return Boolean(
        lockedProvider || readString(values["provider"] as JSONValue),
      );
    },
    getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
      return (
        <InlineSettingsTest
          values={values as JSONObject}
          connection={props.connection}
          credentialsOnly={credentialsOnly}
        />
      );
    },
  });

  if (!credentialsOnly) {
    fields.push(
      {
        field: { name: true },
        title: "Name",
        description: "How this connection appears in the list and on events.",
        stepId: POLLING_STEP_ID,
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "e.g. Production tenant",
        validation: { minLength: 2 },
      },
      {
        field: { description: true },
        title: "Description",
        stepId: POLLING_STEP_ID,
        fieldType: FormFieldSchemaType.LongText,
        required: false,
      },
      {
        field: { pollIntervalInMinutes: true },
        title: "Poll Interval (Minutes)",
        description:
          "How often new records are fetched, in whole minutes between 1 and 1440. Default 5.",
        stepId: POLLING_STEP_ID,
        fieldType: FormFieldSchemaType.Number,
        required: true,
        placeholder: "e.g. 5",
        validation: { minValue: 1, maxValue: 1440 },
      },
      {
        field: { isEnabled: true },
        title: "Enabled",
        description:
          "Disabled connections are skipped by scheduled polling. On-demand runs remain available.",
        stepId: POLLING_STEP_ID,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
      },
      {
        field: { alertingOnly: true },
        title: "Alerts only",
        description:
          "On: import only records the provider marks as alerting. Off: import every matching record.",
        stepId: POLLING_STEP_ID,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        showIf: (values: FormValues<JSONObject>): boolean => {
          const selected: SecurityEventConnectorDefinition | undefined =
            getSecurityEventConnectorDefinition(
              lockedProvider || readString(values["provider"] as JSONValue),
            );
          return Boolean(selected?.supportsAlertingOnlyToggle);
        },
      },
    );
  }

  const initialValues: JSONObject = {};

  if (isEditing && props.connection) {
    initialValues["provider"] = props.connection.provider || "";
    initialValues["name"] = props.connection.name || "";
    initialValues["description"] = props.connection.description || "";
    initialValues["isEnabled"] = props.connection.isEnabled !== false;
    initialValues["pollIntervalInMinutes"] =
      props.connection.pollIntervalInMinutes ||
      lockedDefinition?.defaultPollIntervalInMinutes ||
      5;
    initialValues["alertingOnly"] = props.connection.alertingOnly !== false;

    const config: JSONObject = props.connection.config || {};

    for (const field of lockedDefinition?.configFields || []) {
      if (config[field.key] !== undefined && config[field.key] !== null) {
        initialValues[configFieldName(lockedDefinition!.provider, field.key)] =
          config[field.key] as JSONValue;
      }
    }
  } else {
    initialValues["isEnabled"] = true;
    initialValues["alertingOnly"] = true;
    initialValues["pollIntervalInMinutes"] = 5;

    for (const definition of SecurityEventConnectorCatalog) {
      for (const field of definition.configFields) {
        if (field.defaultValue !== undefined) {
          initialValues[configFieldName(definition.provider, field.key)] =
            field.defaultValue as JSONValue;
        }
      }
    }
  }

  const finalButtonText: string = credentialsOnly
    ? "Update credentials"
    : isEditing
      ? "Save changes"
      : "Create connection";

  const title: string = credentialsOnly
    ? `Update credentials: ${props.connection?.name || lockedDefinition?.title || ""}`
    : isEditing
      ? `Edit connection: ${props.connection?.name || ""}`
      : "Add connection";

  const hasOptionalSecret: boolean = Boolean(
    lockedDefinition?.secretFields.some((field: ConnectorField): boolean => {
      return !field.required;
    }),
  );

  const description: string = credentialsOnly
    ? `Replace the stored ${lockedDefinition?.title || ""} credentials. Blank fields keep their stored value.${hasOptionalSecret ? " Turn on a Remove toggle to delete an optional one." : ""}`
    : isEditing
      ? `${lockedDefinition?.title || "Provider"} connection. The provider cannot be changed after creation; add a new connection to import from another product.`
      : "Import security events from a SIEM, EDR, cloud security or identity product. Test before saving.";

  return (
    <BasicFormModal<JSONObject>
      title={title}
      description={description}
      name={
        credentialsOnly
          ? "Security Events > Update Connection Credentials"
          : isEditing
            ? "Security Events > Edit Security Event Connection"
            : "Security Events > Add Security Event Connection"
      }
      modalWidth={ModalWidth.Large}
      isLoading={isLoading}
      error={error}
      submitButtonText={isLastStep ? finalButtonText : "Next"}
      onClose={(): void => {
        setIsLoading(false);
        props.onClose();
      }}
      onSubmit={async (values: JSONObject): Promise<void> => {
        setError(undefined);
        setIsLoading(true);

        try {
          const submission: SecurityEventConnectionFormSubmission =
            readSecurityEventConnectionForm(values, lockedProvider);

          if (isEditing && props.connection?.id) {
            if (
              credentialsOnly &&
              Object.keys(submission.secrets).length === 0
            ) {
              throw new Error(
                "Enter at least one credential to update or remove, or close this dialog to keep the stored values.",
              );
            }

            await ModelAPI.updateById<SecurityEventConnection>({
              modelType: SecurityEventConnection,
              id: props.connection.id,
              data: securityEventConnectionUpdatePayload(
                submission,
                credentialsOnly,
              ),
            });
          } else {
            const model: SecurityEventConnection =
              new SecurityEventConnection();
            model.projectId = ProjectUtil.getCurrentProjectId()!;
            model.name = submission.name;
            if (submission.description) {
              model.description = submission.description;
            }
            model.provider = submission.provider;
            model.config = submission.config;
            model.secrets = JSON.stringify(
              withoutRemovedSecrets(submission.secrets),
            );
            model.isEnabled = submission.isEnabled;
            model.pollIntervalInMinutes = submission.pollIntervalInMinutes;
            model.alertingOnly = submission.alertingOnly;

            await ModelAPI.create<SecurityEventConnection>({
              model,
              modelType: SecurityEventConnection,
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
        id: credentialsOnly
          ? "update-security-event-connection-credentials-form"
          : isEditing
            ? "edit-security-event-connection-form"
            : "create-security-event-connection-form",
        initialValues,
        steps,
        fields,
        onIsLastFormStep: (value: boolean): void => {
          setIsLastStep(value);
        },
      }}
    />
  );
};

export default SecurityEventConnectionFormModal;
