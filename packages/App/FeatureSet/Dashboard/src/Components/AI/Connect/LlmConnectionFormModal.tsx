import LlmObservabilityConnection from "Common/Models/DatabaseModels/LlmObservabilityConnection";
import HashedString from "Common/Types/HashedString";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  LlmConnectionDefinition,
  LlmConnectionField,
  LlmConnectionKind,
  getLlmConnectionDefinition,
} from "Common/Types/LlmObservability/LlmConnectionCatalog";
import LlmConnectionProvider from "Common/Types/LlmObservability/LlmConnectionProvider";
import { LlmConnectionTestResult } from "Common/Types/LlmObservability/LlmConnectionTest";
import LlmConversationReaders from "Common/Types/LlmObservability/LlmConversationReaders";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Icon from "Common/UI/Components/Icon/Icon";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";
import { llmConnectionDocsUrl, runLlmConnectionTest } from "./LlmConnectApi";
import LlmConnectionLogo from "./LlmConnectionLogo";
import LlmConnectionTestPanel from "./LlmConnectionTestPanel";
import LlmTellYourPeopleNote from "./LlmTellYourPeopleNote";

/*
 * Connect a provider account or a company AI tool, or edit a connection.
 * The provider is picked from its tile, so the form is that provider's
 * own, one question a step:
 *
 *   Set up       where the credential comes from, what arrives, the guide
 *                (a new connection only);
 *   Credentials  the catalog's settings and secrets; the name and the
 *                settings most people leave alone folded under More fields;
 *   Privacy      who may read the conversations, and whether what people
 *                wrote is kept (company AI tools only);
 *   Test         a small real read before anything is saved.
 *
 * Secrets are write-only: on edit a secret left blank keeps the stored
 * one; the server merges what is sent over what it stores.
 */

export const SETUP_STEP_ID: string = "setup";
export const CREDENTIALS_STEP_ID: string = "credentials";
export const PRIVACY_STEP_ID: string = "privacy";
export const TEST_STEP_ID: string = "test";

export function configFieldName(key: string): string {
  return `config__${key}`;
}

export function secretFieldName(key: string): string {
  return `secret__${key}`;
}

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // BasicForm wraps Password values in HashedString before submit.
  if (value instanceof HashedString) {
    return value.toString();
  }

  if (typeof value === "object" && "value" in (value as JSONObject)) {
    // A dropdown value that has not been unwrapped yet ({ label, value }).
    return readText((value as JSONObject)["value"]);
  }

  return String(value);
}

export interface LlmConnectionFormSubmission {
  name: string;
  config: JSONObject;
  // Only what was typed: a blank secret keeps the stored one on edit.
  secrets: JSONObject;
  conversationReaders: LlmConversationReaders;
  storeConversationText: boolean;
}

// The form's values as the API stores them.
export function readLlmConnectionForm(
  definition: LlmConnectionDefinition,
  values: JSONObject,
): LlmConnectionFormSubmission {
  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const text: string = readText(
      values[configFieldName(field.key)] as JSONValue | undefined,
    ).trim();

    if (text) {
      config[field.key] = text;
    }
  }

  const secrets: JSONObject = {};

  for (const field of definition.secretFields) {
    const raw: string = readText(
      values[secretFieldName(field.key)] as JSONValue | undefined,
    );

    // A pasted key file keeps its newlines; whitespace alone is blank.
    if (raw.trim()) {
      secrets[field.key] = field.type === "json" ? raw : raw.trim();
    }
  }

  const readers: string = readText(
    values["conversationReaders"] as JSONValue | undefined,
  );
  const keepText: JSONValue | undefined = values["storeConversationText"] as
    | JSONValue
    | undefined;

  return {
    name:
      readText(values["name"] as JSONValue | undefined).trim() ||
      definition.title,
    config,
    secrets,
    conversationReaders:
      readers === LlmConversationReaders.Everyone
        ? LlmConversationReaders.Everyone
        : LlmConversationReaders.Admins,
    storeConversationText: keepText !== false,
  };
}

/*
 * The body for POST /llm-observability-connection/test: the unsaved
 * settings on create, or the connection and the form's edits on edit.
 */
export function llmConnectionTestBody(data: {
  definition: LlmConnectionDefinition;
  values: JSONObject;
  connection?: LlmObservabilityConnection | undefined;
}): JSONObject {
  const submission: LlmConnectionFormSubmission = readLlmConnectionForm(
    data.definition,
    data.values,
  );

  if (data.connection?.id) {
    return {
      connectionId: data.connection.id.toString(),
      config: submission.config,
      secrets: submission.secrets,
    };
  }

  return {
    provider: data.definition.provider,
    config: submission.config,
    secrets: submission.secrets,
  };
}

/*
 * Why the test cannot run yet: a new connection has no stored credential
 * to fall back on, so it needs every required setting typed in first.
 */
export function llmConnectionTestDisabledReason(data: {
  definition: LlmConnectionDefinition;
  values: JSONObject;
  isEditing: boolean;
  translator: Translator;
}): string | undefined {
  const missing: Array<LlmConnectionField> = [
    ...data.definition.configFields,
    ...(data.isEditing ? [] : data.definition.secretFields),
  ].filter((field: LlmConnectionField): boolean => {
    if (!field.required || field.defaultValue !== undefined) {
      return false;
    }

    const key: string = data.definition.secretFields.includes(field)
      ? secretFieldName(field.key)
      : configFieldName(field.key);

    return !readText(data.values[key] as JSONValue | undefined).trim();
  });

  if (missing.length === 0) {
    return undefined;
  }

  return data.translator.translateTemplate("Fill in {{fields}} to test.", {
    fields: missing
      .map((field: LlmConnectionField): string => {
        return data.translator.translateText(field.title) || field.title;
      })
      .join(", "),
  });
}

function fieldTypeFor(field: LlmConnectionField): FormFieldSchemaType {
  switch (field.type) {
    case "dropdown":
      return FormFieldSchemaType.Dropdown;
    case "json":
      return FormFieldSchemaType.JSON;
    case "password":
      return FormFieldSchemaType.Password;
    default:
      return FormFieldSchemaType.Text;
  }
}

export const LlmConnectionSetupGuide: FunctionComponent<{
  definition: LlmConnectionDefinition;
}> = (props: { definition: LlmConnectionDefinition }): ReactElement => {
  const translator: Translator = useTranslator();
  const isTool: boolean =
    props.definition.kind === LlmConnectionKind.CompanyTool;

  return (
    <div data-testid="llm-connection-setup-guide" className="space-y-4">
      <div className="flex items-center gap-3">
        <LlmConnectionLogo provider={props.definition.provider} size="lg" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-gray-900">
            {translator.translateText(props.definition.title)}
          </div>
          <div className="text-sm text-gray-500">
            {translator.translateText(props.definition.description)}
          </div>
        </div>
      </div>

      <div className="rounded-md bg-gray-50 p-3 ring-1 ring-inset ring-gray-200">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateText("What arrives")}
        </div>
        <div className="mt-1 text-sm text-gray-800">
          {translator.translateText(props.definition.summary)}
        </div>
      </div>

      <div className="rounded-md bg-gray-50 p-3 ring-1 ring-inset ring-gray-200">
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {translator.translateText("Before you start")}
        </div>
        <div className="mt-1 text-sm text-gray-800">
          {translator.translateText(props.definition.hint)}
        </div>
        <a
          href={llmConnectionDocsUrl(props.definition.docsPath).toString()}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="llm-connection-guide-link"
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Icon icon={IconProp.Book} className="h-4 w-4" />
          <span>{translator.translateText("Step-by-step guide")}</span>
        </a>
      </div>

      {isTool ? (
        <LlmTellYourPeopleNote />
      ) : (
        <div className="flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">
          <Icon
            icon={IconProp.ShieldCheck}
            className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
          />
          <span>
            {translator.translateText(
              "OneUptime only reads usage and cost. The credential is encrypted at rest and never shown again.",
            )}
          </span>
        </div>
      )}
    </div>
  );
};

export interface ComponentProps {
  provider: LlmConnectionProvider;
  // Set for edit; absent for create.
  connection?: LlmObservabilityConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const LlmConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // The test reads the form as it is when the button is pressed.
  const latestValues: MutableRefObject<JSONObject> = useRef<JSONObject>({});
  const moreFields: FormFieldCollapsibleSection<JSONObject> = useRef(
    getAdvancedFormSection<JSONObject>(),
  ).current;

  const definition: LlmConnectionDefinition | undefined =
    getLlmConnectionDefinition(props.provider);

  if (!definition) {
    return <></>;
  }

  const isEditing: boolean = Boolean(props.connection?.id);
  const isTool: boolean = definition.kind === LlmConnectionKind.CompanyTool;

  const steps: Array<FormStep<JSONObject>> = [
    ...(isEditing ? [] : [{ id: SETUP_STEP_ID, title: "Set up" }]),
    { id: CREDENTIALS_STEP_ID, title: "Credentials" },
    ...(isTool ? [{ id: PRIVACY_STEP_ID, title: "Privacy" }] : []),
    { id: TEST_STEP_ID, title: "Test" },
  ];

  const fields: Array<Field<JSONObject>> = [];

  if (!isEditing) {
    fields.push({
      field: { setupGuide: true },
      title: "",
      stepId: SETUP_STEP_ID,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      getCustomElement: (): ReactElement => {
        return <LlmConnectionSetupGuide definition={definition} />;
      },
    });
  }

  const visibleConfigFields: Array<LlmConnectionField> =
    definition.configFields.filter((field: LlmConnectionField): boolean => {
      return !field.isAdvanced;
    });
  const foldedConfigFields: Array<LlmConnectionField> =
    definition.configFields.filter((field: LlmConnectionField): boolean => {
      return Boolean(field.isAdvanced);
    });

  const configField: (
    field: LlmConnectionField,
    folded: boolean,
  ) => Field<JSONObject> = (
    field: LlmConnectionField,
    folded: boolean,
  ): Field<JSONObject> => {
    return {
      field: { [configFieldName(field.key)]: true },
      title: field.title,
      description: field.description,
      stepId: CREDENTIALS_STEP_ID,
      fieldType: fieldTypeFor(field),
      required: field.required,
      disableSpellCheck: true,
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
      ...(field.type === "dropdown"
        ? {
            dropdownOptions: (field.options || []).map(
              (option: { label: string; value: string }): DropdownOption => {
                return { label: option.label, value: option.value };
              },
            ),
          }
        : {}),
      ...(folded ? { collapsibleSection: moreFields } : {}),
    };
  };

  visibleConfigFields.forEach((field: LlmConnectionField): void => {
    fields.push(configField(field, false));
  });

  definition.secretFields.forEach((field: LlmConnectionField): void => {
    fields.push({
      field: { [secretFieldName(field.key)]: true },
      title: field.title,
      description: isEditing
        ? translator.translateTemplate(
            "{{description}} Leave blank to keep the stored value.",
            {
              description:
                translator.translateText(field.description) ||
                field.description,
            },
          )
        : field.description,
      stepId: CREDENTIALS_STEP_ID,
      fieldType: fieldTypeFor(field),
      // Stored secrets can never be read back, so an edit never needs them.
      required: isEditing ? false : field.required,
      disableSpellCheck: true,
      ...(isEditing
        ? { placeholder: "Unchanged" }
        : field.placeholder
          ? { placeholder: field.placeholder }
          : {}),
    });
  });

  // The name and the settings most people leave alone, folded.
  fields.push({
    field: { name: true },
    title: "Name",
    description:
      "How this connection is listed, and the name of the service its data belongs to.",
    stepId: CREDENTIALS_STEP_ID,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    defaultValue: definition.title,
    placeholder: definition.title,
    collapsibleSection: moreFields,
  });

  foldedConfigFields.forEach((field: LlmConnectionField): void => {
    fields.push(configField(field, true));
  });

  if (isTool) {
    fields.push({
      field: { conversationReaders: true },
      title: "Who can read conversations",
      description:
        "Everyone else in the project sees none of these conversations, anywhere in OneUptime.",
      stepId: PRIVACY_STEP_ID,
      fieldType: FormFieldSchemaType.Dropdown,
      required: true,
      defaultValue: LlmConversationReaders.Admins,
      dropdownOptions: [
        {
          label: "Project owners and admins",
          value: LlmConversationReaders.Admins,
        },
        {
          label: "Everyone who can read AI calls",
          value: LlmConversationReaders.Everyone,
        },
      ],
    });

    fields.push({
      field: { storeConversationText: true },
      title: "Keep what was written",
      description:
        "Off: OneUptime keeps who asked, when, which model and in which app, but not the questions and answers.",
      stepId: PRIVACY_STEP_ID,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: true,
    });

    fields.push({
      field: { tellYourPeople: true },
      title: "",
      stepId: PRIVACY_STEP_ID,
      fieldType: FormFieldSchemaType.CustomComponent,
      required: false,
      hideOptionalLabel: true,
      getCustomElement: (): ReactElement => {
        return <LlmTellYourPeopleNote />;
      },
    });
  }

  fields.push({
    field: { testThisConnection: true },
    title: "",
    stepId: TEST_STEP_ID,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
      latestValues.current = values as JSONObject;

      return (
        <LlmConnectionTestPanel
          definition={definition}
          disabledReason={llmConnectionTestDisabledReason({
            definition,
            values: values as JSONObject,
            isEditing,
            translator,
          })}
          runTest={(): Promise<LlmConnectionTestResult> => {
            return runLlmConnectionTest(
              llmConnectionTestBody({
                definition,
                values: latestValues.current,
                connection: props.connection,
              }),
            );
          }}
        />
      );
    },
  });

  const initialValues: JSONObject = {};

  if (isEditing && props.connection) {
    initialValues["name"] = props.connection.name || definition.title;

    const config: JSONObject = props.connection.config || {};

    for (const field of definition.configFields) {
      const value: JSONValue | undefined = config[field.key];

      if (value !== undefined && value !== null) {
        initialValues[configFieldName(field.key)] = value;
      } else if (field.defaultValue !== undefined) {
        initialValues[configFieldName(field.key)] = field.defaultValue;
      }
    }

    initialValues["conversationReaders"] =
      props.connection.conversationReaders || LlmConversationReaders.Admins;
    initialValues["storeConversationText"] =
      props.connection.storeConversationText !== false;
  } else {
    initialValues["name"] = definition.title;

    for (const field of definition.configFields) {
      if (field.defaultValue !== undefined) {
        initialValues[configFieldName(field.key)] = field.defaultValue;
      }
    }

    initialValues["conversationReaders"] = LlmConversationReaders.Admins;
    initialValues["storeConversationText"] = true;
  }

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate("Edit {{name}}", {
              name: props.connection?.name || definition.title,
            })
          : translator.translateTemplate("Connect {{provider}}", {
              provider:
                translator.translateText(definition.title) || definition.title,
            })
      }
      description={definition.description}
      name={
        isEditing
          ? "AI / LLM > Connect > Edit Connection"
          : "AI / LLM > Connect > Add Connection"
      }
      modalWidth={ModalWidth.Large}
      isLoading={isLoading}
      error={error}
      submitButtonText={isEditing ? "Save changes" : "Connect"}
      onClose={(): void => {
        setIsLoading(false);
        props.onClose();
      }}
      onSubmit={async (values: JSONObject): Promise<void> => {
        setError(undefined);
        setIsLoading(true);

        try {
          const submission: LlmConnectionFormSubmission = readLlmConnectionForm(
            definition,
            values,
          );

          if (isEditing && props.connection?.id) {
            await ModelAPI.updateById<LlmObservabilityConnection>({
              modelType: LlmObservabilityConnection,
              id: props.connection.id,
              data: {
                name: submission.name,
                config: submission.config,
                // A blank secret keeps the stored one.
                ...(Object.keys(submission.secrets).length > 0
                  ? { secrets: JSON.stringify(submission.secrets) }
                  : {}),
                ...(isTool
                  ? {
                      conversationReaders: submission.conversationReaders,
                      storeConversationText: submission.storeConversationText,
                    }
                  : {}),
              },
            });
          } else {
            const model: LlmObservabilityConnection =
              new LlmObservabilityConnection();
            model.projectId = ProjectUtil.getCurrentProjectId()!;
            model.name = submission.name;
            model.provider = definition.provider;
            model.config = submission.config;
            model.secrets = JSON.stringify(submission.secrets);
            model.isEnabled = true;

            if (isTool) {
              model.conversationReaders = submission.conversationReaders;
              model.storeConversationText = submission.storeConversationText;
            }

            await ModelAPI.create<LlmObservabilityConnection>({
              model,
              modelType: LlmObservabilityConnection,
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
          ? "edit-llm-connection-form"
          : "create-llm-connection-form",
        initialValues,
        steps,
        fields,
        ...(isEditing ? { allowAnyStepNavigation: true } : {}),
      }}
    />
  );
};

export default LlmConnectionFormModal;
