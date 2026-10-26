import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  CloudConnectionAuthMethodDefinition,
  CloudConnectionDefinition,
  CloudConnectionField,
  getCloudConnectionAuthMethod,
  getCloudConnectionDefinition,
  getCloudConnectionFieldsForMethod,
  getCloudConnectionReadIntervalInMinutes,
  READ_INTERVAL_FIELD_KEY,
  READ_SCOPE_FIELD_KEY,
} from "Common/Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionAwsRoleSetup } from "Common/Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionTestResult } from "Common/Types/CloudConnection/CloudConnectionTest";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject, JSONValue } from "Common/Types/JSON";
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
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import {
  Translator,
  composedValue,
  translatableTerm,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useRef,
  useState,
} from "react";
import { runCloudConnectionTest } from "./CloudConnectApi";
import {
  ACCESS_STEP_ID,
  AUTH_METHOD_FIELD,
  CREDENTIALS_STEP_ID,
  CloudConnectionFormSubmission,
  PASTED_FIELD,
  TEST_STEP_ID,
  applyCloudConnectionPaste,
  cloudConnectionTestBody,
  configFieldName,
  getMissingCloudConnectionFields,
  getPastedFieldTitles,
  getReadScopeField,
  isCredentialValueField,
  readCloudConnectionForm,
  readFormAuthMethod,
  readFormScope,
  readFormText,
  secretFieldName,
} from "./CloudConnectionForm";
import CloudConnectionTestPanel from "./CloudConnectionTestPanel";
import {
  PASTE_HOLDS_NOTHING,
  PASTE_NOTHING_YET,
  PASTE_STILL_MISSING,
} from "./CloudConnectionWords";
import CloudSetupCommand from "./CloudSetupCommand";

/*
 * Connect a cloud account, or edit a connection. The cloud is picked from
 * its tile, so the form is that cloud's own, one question a step:
 *
 *   Access       the one command that creates read-only access, run in the
 *                cloud's own browser terminal (AWS CloudShell, Azure Cloud
 *                Shell, Google Cloud Shell) - and for AWS, a role (nothing
 *                secret stored) or an access key;
 *   Credentials  what the command printed, pasted once, for every cloud and
 *                every way in: the values are read out of it - a role's
 *                ARN, a key and its secret, a Google Cloud key out of
 *                gcloud's progress lines - and folded under it, to check or
 *                to enter by hand. The name and the settings most people
 *                leave alone (regions, subscriptions, projects, how often)
 *                are folded under More fields;
 *   Test         a sign-in and a count of what there is to monitor, with
 *                what reading it costs in the cloud's own bill.
 *
 * Secrets are write-only: on edit a secret left blank keeps the stored
 * one; the server merges what is sent over what it stores.
 */

export interface ComponentProps {
  provider: CloudProvider;
  // Set for edit; absent for create.
  connection?: CloudConnection | undefined;
  /*
   * AWS: whether this OneUptime can sign in to a role, and what a role
   * trusts. Undefined while it loads.
   */
  awsRoleSetup?: CloudConnectionAwsRoleSetup | undefined;
  onClose: () => void;
  onSaved: (connection: { name: string; isNew: boolean }) => void;
}

function fieldTypeFor(field: CloudConnectionField): FormFieldSchemaType {
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

/*
 * The methods the form offers: the cloud's, but an AWS role only when this
 * OneUptime can sign in to one.
 */
export function getOfferedMethods(data: {
  definition: CloudConnectionDefinition;
  awsRoleSetup?: CloudConnectionAwsRoleSetup | undefined;
}): Array<CloudConnectionAuthMethodDefinition> {
  return data.definition.authMethods.filter(
    (method: CloudConnectionAuthMethodDefinition): boolean => {
      return (
        method.method !== CloudConnectionAuthMethod.AwsRole ||
        Boolean(data.awsRoleSetup?.isAvailable)
      );
    },
  );
}

const CloudConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  // The step on screen: the test runs by itself when it is the Test step.
  const [stepId, setStepId] = useState<string | undefined>(undefined);

  // The test reads the form as it is when the button is pressed.
  const latestValues: MutableRefObject<JSONObject> = useRef<JSONObject>({});
  const moreFields: FormFieldCollapsibleSection<JSONObject> = useRef(
    getAdvancedFormSection<JSONObject>(),
  ).current;
  /*
   * The values the paste filled in, folded under it: folded they say what
   * was found, opened they can be checked or entered by hand. A paste that
   * fills them in does not open them.
   */
  const valuesFold: FormFieldCollapsibleSection<JSONObject> = useRef({
    id: "cloud-connection-values",
    title: "Enter the values yourself",
    description: "Filled in from what you paste above.",
    openWhenConfigured: false,
  }).current;

  const definition: CloudConnectionDefinition | undefined =
    getCloudConnectionDefinition(props.provider);

  if (!definition) {
    return <></>;
  }

  const isEditing: boolean = Boolean(props.connection?.id);
  const title: string = isEditing
    ? translator.translateTemplate("Edit {{name}}", {
        name: props.connection?.name || definition.title,
      })
    : translator.translateTemplate("Connect {{provider}}", {
        provider: translatableTerm(definition.title),
      });

  // An AWS form waits for the role setup: it decides what the form offers.
  if (definition.provider === CloudProvider.AWS && !props.awsRoleSetup) {
    return (
      <Modal
        title={title}
        isBodyLoading={true}
        modalWidth={ModalWidth.Medium}
        onClose={props.onClose}
      >
        <></>
      </Modal>
    );
  }

  const offered: Array<CloudConnectionAuthMethodDefinition> = getOfferedMethods(
    { definition, awsRoleSetup: props.awsRoleSetup },
  );
  const storedMethod: CloudConnectionAuthMethod | undefined = isEditing
    ? getCloudConnectionAuthMethod(
        definition,
        props.connection?.config?.["authMethod"],
      )
    : undefined;
  // The method a new form starts on: the first offered (an AWS role first).
  const defaultMethod: CloudConnectionAuthMethod =
    storedMethod || offered[0]!.method;
  const methodOf: (values: JSONObject) => CloudConnectionAuthMethod = (
    values: JSONObject,
  ): CloudConnectionAuthMethod => {
    return readFormAuthMethod(definition, values, defaultMethod);
  };

  const steps: Array<FormStep<JSONObject>> = [
    { id: ACCESS_STEP_ID, title: "Access" },
    { id: CREDENTIALS_STEP_ID, title: "Credentials" },
    { id: TEST_STEP_ID, title: "Test" },
  ];

  const fields: Array<Field<JSONObject>> = [];

  // Step 1: the way in (AWS: role or key), then its command.
  if (offered.length > 1) {
    fields.push({
      field: { [AUTH_METHOD_FIELD]: true },
      title: "How OneUptime signs in",
      stepId: ACCESS_STEP_ID,
      fieldType: FormFieldSchemaType.RadioButton,
      required: true,
      defaultValue: defaultMethod,
      dataTestId: "cloud-connection-method",
      radioButtonOptions: offered.map(
        (method: CloudConnectionAuthMethodDefinition) => {
          return {
            title: method.title,
            description: method.description,
            value: method.method,
          };
        },
      ),
    });
  }

  /*
   * Then what to read - the account the command is run in, or every
   * account of its organization - for a method that can read more than
   * one. The command below changes with it.
   */
  const scopeField: CloudConnectionField | undefined =
    definition.configFields.find((field: CloudConnectionField): boolean => {
      return field.key === READ_SCOPE_FIELD_KEY;
    });

  if (scopeField) {
    fields.push({
      field: { [configFieldName(READ_SCOPE_FIELD_KEY)]: true },
      title: scopeField.title,
      description: scopeField.description,
      stepId: ACCESS_STEP_ID,
      fieldType: FormFieldSchemaType.RadioButton,
      required: false,
      hideOptionalLabel: true,
      defaultValue: scopeField.defaultValue,
      dataTestId: "cloud-connection-scope",
      radioButtonOptions: (scopeField.options || []).map(
        (option: { label: string; value: string }) => {
          return { title: option.label, value: option.value };
        },
      ),
      showIf: (values: FormValues<JSONObject>): boolean => {
        return Boolean(
          getReadScopeField(definition, methodOf(values as JSONObject)),
        );
      },
    });
  }

  fields.push({
    field: { setupCommand: true },
    title: "",
    stepId: ACCESS_STEP_ID,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
      return (
        <CloudSetupCommand
          definition={definition}
          method={methodOf(values as JSONObject)}
          scope={readFormScope(definition, values as JSONObject, defaultMethod)}
          roleSetup={props.awsRoleSetup}
        />
      );
    },
  });

  /*
   * Step 2: what the command printed. Every cloud and every way in asks
   * for the same one paste, which fills in the values folded below it - a
   * single value too: a role's ARN, or a Google Cloud key, which gcloud
   * prints after lines of its own that a key field would refuse.
   */
  const methodFields: (
    method: CloudConnectionAuthMethod,
  ) => Array<CloudConnectionField> = (
    method: CloudConnectionAuthMethod,
  ): Array<CloudConnectionField> => {
    return [
      ...getCloudConnectionFieldsForMethod(definition.configFields, method),
      ...getCloudConnectionFieldsForMethod(definition.secretFields, method),
    ].filter(isCredentialValueField);
  };

  const isSecret: (field: CloudConnectionField) => boolean = (
    field: CloudConnectionField,
  ): boolean => {
    return definition.secretFields.includes(field);
  };

  // Whether any value of the method picked holds something, pasted or typed.
  const hasAnyValue: (values: JSONObject) => boolean = (
    values: JSONObject,
  ): boolean => {
    return methodFields(methodOf(values)).some(
      (field: CloudConnectionField): boolean => {
        const name: string = isSecret(field)
          ? secretFieldName(field.key)
          : configFieldName(field.key);

        return Boolean(
          readFormText(values[name] as JSONValue | undefined).trim(),
        );
      },
    );
  };

  fields.push({
    field: { [PASTED_FIELD]: true },
    title: "What the command printed",
    description: "Paste all of it: OneUptime picks out the values it needs.",
    stepId: CREDENTIALS_STEP_ID,
    fieldType: FormFieldSchemaType.LongText,
    // The way in, not an option: the values can be typed instead.
    required: false,
    hideOptionalLabel: true,
    disableSpellCheck: true,
    placeholder: "{ ... }",
    /*
     * One message, on the paste, when the step cannot go on: nothing
     * pasted yet, or a value still missing - rather than every empty
     * value in the fold below asking on its own.
     */
    customValidation: (values: FormValues<JSONObject>): string | null => {
      const missing: Array<CloudConnectionField> =
        getMissingCloudConnectionFields({
          definition,
          values: values as JSONObject,
          isEditing,
          fallbackMethod: defaultMethod,
        });

      if (missing.length === 0) {
        return null;
      }

      if (!hasAnyValue(values as JSONObject)) {
        // Something pasted that holds none of the values, or nothing yet.
        const message: string = readFormText(
          (values as JSONObject)[PASTED_FIELD] as JSONValue | undefined,
        ).trim()
          ? PASTE_HOLDS_NOTHING
          : PASTE_NOTHING_YET;

        return translator.translateText(message) || message;
      }

      return translator.translateTemplate(PASTE_STILL_MISSING, {
        fields: composedValue((inSentence: Translator): string => {
          return missing
            .map((field: CloudConnectionField): string => {
              return inSentence.translateText(field.title) || field.title;
            })
            .join(", ");
        }),
      });
    },
    onChange: (
      value: JSONValue,
      currentValues: FormValues<JSONObject>,
      setNewFormValues: (values: FormValues<JSONObject>) => void,
    ): void => {
      const next: JSONObject | undefined = applyCloudConnectionPaste({
        definition,
        method: methodOf(currentValues as JSONObject),
        values: currentValues as JSONObject,
        pasted: readFormText(value),
      });

      if (next) {
        // After the field stores what was typed (it cannot be rewritten in its own onChange).
        queueMicrotask(() => {
          setNewFormValues(next as FormValues<JSONObject>);
        });
      }
    },
    getFooterElement: (
      values: FormValues<JSONObject>,
      error?: string,
    ): ReactElement => {
      const pasted: string = readFormText(
        (values as JSONObject)[PASTED_FIELD] as JSONValue | undefined,
      );

      if (!pasted.trim()) {
        return <></>;
      }

      const found: Array<string> = getPastedFieldTitles({
        definition,
        method: methodOf(values as JSONObject),
        pasted,
      });

      return found.length > 0 ? (
        <div
          className="mt-2 flex items-start gap-1.5 text-sm text-emerald-700"
          data-testid="cloud-connection-paste-found"
        >
          <Icon icon={IconProp.Check} className="mt-0.5 h-4 w-4" />
          <span>
            {translator.translateTemplate("Found: {{fields}}", {
              fields: composedValue((inSentence: Translator): string => {
                return found
                  .map((fieldTitle: string): string => {
                    return inSentence.translateText(fieldTitle) || fieldTitle;
                  })
                  .join(", ");
              }),
            })}
          </span>
        </div>
      ) : error ? (
        // The field's own error already says what to do.
        <></>
      ) : (
        <div
          className="mt-2 text-sm text-amber-700"
          data-testid="cloud-connection-paste-nothing"
        >
          {translator.translateText(PASTE_HOLDS_NOTHING)}
        </div>
      );
    },
  });

  // Every method's own fields, each shown only while its method is picked.
  const seen: Set<string> = new Set<string>();

  for (const method of offered) {
    const own: Array<CloudConnectionField> = methodFields(method.method);

    for (const field of own) {
      const name: string = isSecret(field)
        ? secretFieldName(field.key)
        : configFieldName(field.key);

      if (seen.has(name)) {
        continue;
      }

      seen.add(name);

      fields.push({
        field: { [name]: true },
        title: field.title,
        description:
          isEditing && isSecret(field)
            ? translator.translateTemplate(
                "{{description}} Leave blank to keep the stored value.",
                {
                  description: composedValue(
                    (inSentence: Translator): string => {
                      return (
                        inSentence.translateText(field.description) ||
                        field.description
                      );
                    },
                  ),
                },
              )
            : field.description,
        stepId: CREDENTIALS_STEP_ID,
        fieldType: fieldTypeFor(field),
        /*
         * What is still missing is said once, on the paste above
         * (getMissingCloudConnectionFields: a stored secret is never
         * missing on edit); the server checks every value again.
         */
        required: false,
        hideOptionalLabel: true,
        disableSpellCheck: true,
        showIf: (values: FormValues<JSONObject>): boolean => {
          return methodOf(values as JSONObject) === method.method;
        },
        ...(isEditing && isSecret(field)
          ? { placeholder: "Unchanged" }
          : field.placeholder
            ? { placeholder: field.placeholder }
            : {}),
        collapsibleSection: valuesFold,
      });
    }
  }

  // The name and the settings most people leave alone, folded.
  fields.push({
    field: { name: true },
    title: "Name",
    description:
      "How this connection is listed, and the name of the service its metrics belong to.",
    stepId: CREDENTIALS_STEP_ID,
    fieldType: FormFieldSchemaType.Text,
    required: false,
    placeholder: definition.title,
    collapsibleSection: moreFields,
  });

  for (const field of definition.configFields) {
    if (!field.isAdvanced) {
      continue;
    }

    fields.push({
      field: { [configFieldName(field.key)]: true },
      title: field.title,
      description: field.description,
      stepId: CREDENTIALS_STEP_ID,
      fieldType: fieldTypeFor(field),
      required: false,
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
      ...(field.defaultValue !== undefined
        ? { defaultValue: field.defaultValue }
        : {}),
      collapsibleSection: moreFields,
    });
  }

  // Step 3: a sign-in and a count of what there is to monitor.
  fields.push({
    field: { testThisConnection: true },
    title: "",
    stepId: TEST_STEP_ID,
    fieldType: FormFieldSchemaType.CustomComponent,
    required: false,
    hideOptionalLabel: true,
    getCustomElement: (values: FormValues<JSONObject>): ReactElement => {
      latestValues.current = values as JSONObject;

      const missing: Array<CloudConnectionField> =
        getMissingCloudConnectionFields({
          definition,
          values: values as JSONObject,
          isEditing,
          fallbackMethod: defaultMethod,
        });

      return (
        <CloudConnectionTestPanel
          definition={definition}
          readIntervalInMinutes={getCloudConnectionReadIntervalInMinutes(
            definition,
            readFormText(
              (values as JSONObject)[
                configFieldName(READ_INTERVAL_FIELD_KEY)
              ] as JSONValue | undefined,
            ),
          )}
          disabledReason={
            missing.length > 0
              ? translator.translateTemplate("Fill in {{fields}} to test.", {
                  fields: composedValue((inSentence: Translator): string => {
                    return missing
                      .map((field: CloudConnectionField): string => {
                        return (
                          inSentence.translateText(field.title) || field.title
                        );
                      })
                      .join(", ");
                  }),
                })
              : undefined
          }
          autoStart={stepId === TEST_STEP_ID}
          isEditing={isEditing}
          runTest={(): Promise<CloudConnectionTestResult> => {
            return runCloudConnectionTest(
              cloudConnectionTestBody({
                definition,
                values: latestValues.current,
                connection: props.connection,
                fallbackMethod: defaultMethod,
              }),
            );
          }}
        />
      );
    },
  });

  const initialValues: JSONObject = {
    [AUTH_METHOD_FIELD]: defaultMethod,
    /*
     * Empty, not absent: a field the form holds no value for is only asked
     * whether it is required, and the paste's own check (what is still
     * missing) would never run.
     */
    [PASTED_FIELD]: "",
  };

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
  } else {
    for (const field of definition.configFields) {
      if (field.defaultValue !== undefined) {
        initialValues[configFieldName(field.key)] = field.defaultValue;
      }
    }
  }

  return (
    <BasicFormModal<JSONObject>
      title={title}
      // What arrives once it is connected, in the reader's words.
      description={definition.summary}
      name={
        isEditing
          ? "Cloud > Connect > Edit Connection"
          : "Cloud > Connect > Add Connection"
      }
      modalWidth={ModalWidth.Medium}
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
          const submission: CloudConnectionFormSubmission =
            readCloudConnectionForm(definition, values, defaultMethod);
          const name: string = readFormText(
            values["name"] as JSONValue | undefined,
          ).trim();

          if (isEditing && props.connection?.id) {
            await ModelAPI.updateById<CloudConnection>({
              modelType: CloudConnection,
              id: props.connection.id,
              data: {
                name: name || props.connection.name || definition.title,
                config: submission.config,
                // A blank secret keeps the stored one.
                ...(Object.keys(submission.secrets).length > 0
                  ? { secrets: JSON.stringify(submission.secrets) }
                  : {}),
              },
            });
          } else {
            const model: CloudConnection = new CloudConnection();
            model.projectId = ProjectUtil.getCurrentProjectId()!;
            // Empty: the server names it after the cloud and its account.
            model.name = name;
            model.provider = definition.provider;
            model.config = submission.config;
            model.secrets = JSON.stringify(submission.secrets);
            model.isEnabled = true;

            await ModelAPI.create<CloudConnection>({
              model,
              modelType: CloudConnection,
            });
          }

          setIsLoading(false);
          props.onSaved({
            name: name || props.connection?.name || definition.title,
            isNew: !isEditing,
          });
        } catch (err) {
          setIsLoading(false);
          setError(API.getFriendlyErrorMessage(err as Error));
        }
      }}
      formProps={{
        id: isEditing
          ? "edit-cloud-connection-form"
          : "create-cloud-connection-form",
        initialValues,
        steps,
        fields,
        onFormStepChange: (id: string): void => {
          setStepId(id);
        },
        ...(isEditing ? { allowAnyStepNavigation: true } : {}),
      }}
    />
  );
};

export default CloudConnectionFormModal;
