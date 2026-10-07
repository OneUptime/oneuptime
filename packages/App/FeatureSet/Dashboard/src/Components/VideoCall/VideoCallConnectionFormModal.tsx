import VideoCallConnection from "Common/Models/DatabaseModels/VideoCallConnection";
import HashedString from "Common/Types/HashedString";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import {
  VideoCallConnectionField,
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
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
import {
  VideoCallTestResult,
  runVideoCallConnectionTest,
  videoCallDocsUrl,
} from "./VideoCallApi";
import VideoCallProviderLogo from "./VideoCallProviderLogo";
import VideoCallTestPanel from "./VideoCallTestPanel";

/*
 * Connect a video call provider, or edit a connection. The provider is
 * chosen before the form opens (from its tile on the Video Calls page), so
 * the form is that provider's own: its setup guide first, then its fields
 * and a test that starts a real meeting before anything is saved.
 *
 * Secrets are write-only. On edit, a credential left blank keeps the stored
 * value; the server merges what is sent over what it stores.
 */

export const SETUP_STEP_ID: string = "setup";
export const CONNECT_STEP_ID: string = "connect";

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
    // A Dropdown value that has not been unwrapped yet ({ label, value }).
    return readText((value as JSONObject)["value"]);
  }

  return String(value);
}

export interface VideoCallConnectionFormSubmission {
  name: string;
  description: string;
  config: JSONObject;
  // Only what was typed: a blank secret keeps the stored one on edit.
  secrets: JSONObject;
}

/*
 * The form's values as the API stores them: config keyed by the catalog's
 * field keys, secrets likewise, nothing a provider does not have.
 */
export function readVideoCallConnectionForm(
  definition: VideoCallProviderDefinition,
  values: JSONObject,
): VideoCallConnectionFormSubmission {
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

    /*
     * A pasted key keeps its newlines exactly; whitespace alone counts as
     * blank, which on edit means "keep the stored value".
     */
    if (raw.trim()) {
      secrets[field.key] = field.type === "json" ? raw : raw.trim();
    }
  }

  return {
    name: readText(values["name"] as JSONValue | undefined).trim(),
    description: readText(
      values["description"] as JSONValue | undefined,
    ).trim(),
    config,
    secrets,
  };
}

/*
 * The body for POST /video-call-connection/test: the unsaved settings on
 * create, or the connection plus the form's edits on edit.
 */
export function videoCallConnectionTestBody(data: {
  definition: VideoCallProviderDefinition;
  values: JSONObject;
  connection?: VideoCallConnection | undefined;
}): JSONObject {
  const submission: VideoCallConnectionFormSubmission =
    readVideoCallConnectionForm(data.definition, data.values);

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
 * Why the test cannot run yet: a new connection has no stored credential to
 * fall back on, so it needs every required one typed in first.
 */
export function videoCallConnectionTestDisabledReason(data: {
  definition: VideoCallProviderDefinition;
  values: JSONObject;
  isEditing: boolean;
  translator: Translator;
}): string | undefined {
  if (data.isEditing) {
    return undefined;
  }

  const missing: Array<VideoCallConnectionField> = [
    ...data.definition.configFields,
    ...data.definition.secretFields,
  ].filter((field: VideoCallConnectionField): boolean => {
    if (!field.required) {
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

  return data.translator.translateTemplate(
    "Fill in {{fields}} to start a test meeting.",
    {
      fields: missing
        .map((field: VideoCallConnectionField): string => {
          return field.title;
        })
        .join(", "),
    },
  );
}

function fieldTypeFor(field: VideoCallConnectionField): FormFieldSchemaType {
  switch (field.type) {
    case "email":
      return FormFieldSchemaType.Email;
    case "url":
      return FormFieldSchemaType.URL;
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

export const VideoCallSetupGuide: FunctionComponent<{
  definition: VideoCallProviderDefinition;
}> = (props: { definition: VideoCallProviderDefinition }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div data-testid="video-call-setup-guide" className="space-y-4">
      <div className="flex items-center gap-3">
        <VideoCallProviderLogo provider={props.definition.provider} size="lg" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {props.definition.provider === VideoCallProvider.CustomLink
              ? translator.translateText("Set up a meeting link")
              : translator.translateTemplate("Set up {{provider}}", {
                  provider: props.definition.title,
                })}
          </p>
          <p className="text-sm text-gray-500">
            {translator.translateText(
              "Do this once, as an administrator of the provider. It takes about five minutes.",
            )}
          </p>
        </div>
      </div>

      <ol className="space-y-3">
        {props.definition.setupSteps.map(
          (step: string, index: number): ReactElement => {
            return (
              <li key={index} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1 text-sm text-gray-700">
                  <MarkdownViewer text={step} />
                </div>
              </li>
            );
          },
        )}
      </ol>

      <div className="flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-gray-700 ring-1 ring-inset ring-gray-200">
        <Icon
          icon={IconProp.ShieldCheck}
          className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-500"
        />
        <span>
          {translator.translateText(
            "Use a service account rather than a person's account, so calls keep starting when people leave. Credentials are encrypted at rest and never shown again.",
          )}
        </span>
      </div>
    </div>
  );
};

export interface ComponentProps {
  provider: VideoCallProvider;
  // Set for edit; absent for create.
  connection?: VideoCallConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const VideoCallConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const definition: VideoCallProviderDefinition | undefined =
    getVideoCallProviderDefinition(props.provider);

  /*
   * The test reads the form as it is when the button is pressed, not as it
   * was when the field was drawn.
   */
  const latestValues: MutableRefObject<JSONObject> = useRef<JSONObject>({});

  if (!definition) {
    return <></>;
  }

  const isEditing: boolean = Boolean(props.connection?.id);

  const steps: Array<FormStep<JSONObject>> = isEditing
    ? []
    : [
        { id: SETUP_STEP_ID, title: "Set up" },
        { id: CONNECT_STEP_ID, title: "Connect" },
      ];

  const stepId: string | undefined = isEditing ? undefined : CONNECT_STEP_ID;

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
        return <VideoCallSetupGuide definition={definition} />;
      },
    });
  }

  fields.push({
    field: { name: true },
    title: "Name",
    description:
      "How this connection appears when someone picks where a call is held.",
    stepId,
    fieldType: FormFieldSchemaType.Text,
    required: true,
    placeholder: translator.translateTemplate("{{provider}} for incidents", {
      provider: definition.title,
    }),
    validation: { minLength: 2 },
  });

  definition.configFields.forEach(
    (field: VideoCallConnectionField, index: number): void => {
      fields.push({
        field: { [configFieldName(field.key)]: true },
        title: field.title,
        description: field.description,
        stepId,
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
        ...(index === 0
          ? {
              sectionTitle: translator.translateTemplate(
                "{{provider}} settings",
                { provider: definition.title },
              ),
              sideLink: {
                text: "Setup guide",
                url: videoCallDocsUrl(definition.docsPath),
                openLinkInNewTab: true,
              },
            }
          : {}),
      });
    },
  );

  definition.secretFields.forEach(
    (field: VideoCallConnectionField, index: number): void => {
      fields.push({
        field: { [secretFieldName(field.key)]: true },
        title: field.title,
        description: isEditing
          ? translator.translateTemplate(
              "{{description}} Leave blank to keep the stored value.",
              { description: field.description },
            )
          : field.description,
        stepId,
        fieldType: fieldTypeFor(field),
        // Stored secrets can never be read back, so an edit never needs them.
        required: isEditing ? false : field.required,
        ...(isEditing
          ? { placeholder: "Unchanged" }
          : field.placeholder
            ? { placeholder: field.placeholder }
            : {}),
        ...(index === 0
          ? {
              sectionTitle: "Credentials",
              sectionDescription:
                "Encrypted at rest and never returned by the API.",
            }
          : {}),
      });
    },
  );

  fields.push({
    field: { description: true },
    title: "Description",
    stepId,
    fieldType: FormFieldSchemaType.LongText,
    required: false,
    placeholder: "Zoom meetings for Sev1 and Sev2 incidents.",
  });

  fields.push({
    field: { testThisConnection: true },
    title: "",
    stepId,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
      latestValues.current = values as JSONObject;

      return (
        <VideoCallTestPanel
          providerTitle={definition.title}
          disabledReason={videoCallConnectionTestDisabledReason({
            definition,
            values: values as JSONObject,
            isEditing,
            translator,
          })}
          runTest={(): Promise<VideoCallTestResult> => {
            return runVideoCallConnectionTest(
              videoCallConnectionTestBody({
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
    initialValues["name"] = props.connection.name || "";
    initialValues["description"] = props.connection.description || "";

    const config: JSONObject = props.connection.config || {};

    for (const field of definition.configFields) {
      const value: JSONValue | undefined = config[field.key];

      if (value !== undefined && value !== null) {
        initialValues[configFieldName(field.key)] = value;
      }
    }
  } else {
    initialValues["name"] = definition.title;

    for (const field of definition.configFields) {
      if (field.defaultValue !== undefined) {
        initialValues[configFieldName(field.key)] = field.defaultValue;
      }
    }
  }

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate("Edit {{name}}", {
              name: props.connection?.name || definition.title,
            })
          : definition.provider === VideoCallProvider.CustomLink
            ? translator.translateText("Add a meeting link") ||
              "Add a meeting link"
            : translator.translateTemplate("Connect {{provider}}", {
                provider: definition.title,
              })
      }
      description={definition.description}
      name={
        isEditing
          ? "Settings > Video Calls > Edit Connection"
          : "Settings > Video Calls > Add Connection"
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
          const submission: VideoCallConnectionFormSubmission =
            readVideoCallConnectionForm(definition, values);

          if (isEditing && props.connection?.id) {
            await ModelAPI.updateById<VideoCallConnection>({
              modelType: VideoCallConnection,
              id: props.connection.id,
              data: {
                name: submission.name,
                description: submission.description,
                config: submission.config,
                // A blank credential keeps the stored one.
                ...(Object.keys(submission.secrets).length > 0
                  ? { secrets: JSON.stringify(submission.secrets) }
                  : {}),
              },
            });
          } else {
            const model: VideoCallConnection = new VideoCallConnection();
            model.projectId = ProjectUtil.getCurrentProjectId()!;
            model.name = submission.name;
            if (submission.description) {
              model.description = submission.description;
            }
            model.provider = definition.provider;
            model.config = submission.config;
            model.secrets = JSON.stringify(submission.secrets);

            await ModelAPI.create<VideoCallConnection>({
              model,
              modelType: VideoCallConnection,
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
          ? "edit-video-call-connection-form"
          : "create-video-call-connection-form",
        initialValues,
        steps,
        fields,
      }}
    />
  );
};

export default VideoCallConnectionFormModal;
