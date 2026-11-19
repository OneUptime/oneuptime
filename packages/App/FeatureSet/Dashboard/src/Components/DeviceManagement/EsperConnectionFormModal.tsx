import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES,
  getEsperConsoleHost,
  readDeviceManagementConfig,
} from "Common/Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "Common/Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "Common/Types/DeviceManagement/DeviceManagementProvider";
import HashedString from "Common/Types/HashedString";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field, {
  FormFieldCollapsibleSection,
} from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useRef,
  useState,
} from "react";
import { runDeviceManagementTest } from "./DeviceManagementApi";
import {
  DeviceManagementTestWords,
  READ_INTERVAL_WORDS,
  TEST_PASSED_WITH_DEVICES,
  getDeviceManagementTestWords,
} from "./DeviceManagementWords";

/*
 * Connect an Esper tenant, or edit a connection: one page, two questions -
 * the tenant and the API key - with the name and how often to read folded
 * under More fields.
 *
 * Connect tests before it saves: who the key belongs to, and how many
 * Android devices a read will import. A key Esper refuses, or a tenant it
 * does not know, is said in the form - what happened, what to do, and
 * Esper's own answer under it - and nothing is saved. The key is
 * write-only: it goes to the server with the test and the save, is stored
 * encrypted and is never shown again. On edit a key left blank keeps the
 * stored one, and a new one is tested before it is saved.
 */

export interface ComponentProps {
  // The connection to edit; none to connect a new tenant.
  connection?: DeviceManagementConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
}

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // BasicForm wraps Password values in HashedString before submit.
  if (value instanceof HashedString) {
    return value.toString();
  }

  return typeof value === "string" ? value.trim() : String(value).trim();
}

/*
 * The sentence a failed test is said in: OneUptime's words first, in the
 * reader's language, and Esper's own answer after them.
 */
export function getTestFailureSentence(
  result: DeviceManagementTestResult,
  translator: Translator,
): string {
  const words: DeviceManagementTestWords = getDeviceManagementTestWords(result);

  return [
    translator.translateText(words.headline) || words.headline,
    words.advice ? translator.translateText(words.advice) || words.advice : "",
    result.message,
  ]
    .filter(Boolean)
    .join(" ");
}

// What a test that passed says: how many Android devices a read imports.
export function getTestPassedSentence(
  result: DeviceManagementTestResult,
  translator: Translator,
): string {
  if (result.deviceCount === undefined) {
    const headline: string = getDeviceManagementTestWords(result).headline;

    return translator.translateText(headline) || headline;
  }

  return translator.translatePlural(
    TEST_PASSED_WITH_DEVICES,
    result.deviceCount,
  );
}

const EsperConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const moreFields: FormFieldCollapsibleSection<JSONObject> = useRef(
    getAdvancedFormSection<JSONObject>(),
  ).current;

  const isEditing: boolean = Boolean(props.connection?.id);
  const stored: { tenant: string; readIntervalInMinutes: number } =
    readDeviceManagementConfig(props.connection?.config);

  const intervalOptions: Array<DropdownOption> =
    DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES.map(
      (minutes: number): DropdownOption => {
        return {
          value: minutes,
          label: READ_INTERVAL_WORDS[minutes] || String(minutes),
        };
      },
    );

  const nameField: Field<JSONObject> = {
    field: { name: true },
    title: "Name",
    description: "How this connection is listed.",
    fieldType: FormFieldSchemaType.Text,
    required: isEditing,
    placeholder: "Esper",
    collapsibleSection: isEditing ? undefined : moreFields,
  };

  const intervalField: Field<JSONObject> = {
    field: { readIntervalInMinutes: true },
    title: "Read every",
    description:
      "How often the devices, their groups and their check-ins are read. Each device's apps are read every 6 hours.",
    fieldType: FormFieldSchemaType.Dropdown,
    required: true,
    dropdownOptions: intervalOptions,
    collapsibleSection: isEditing ? undefined : moreFields,
  };

  const fields: Array<Field<JSONObject>> = isEditing
    ? [
        nameField,
        {
          field: { apiKey: true },
          title: "API Key",
          description:
            "A new key from the Esper console replaces the stored one. Leave blank to keep it.",
          fieldType: FormFieldSchemaType.Password,
          required: false,
          disableSpellCheck: true,
          placeholder: "Unchanged",
        },
        intervalField,
      ]
    : [
        {
          field: { tenant: true },
          title: "Tenant",
          description:
            "The name before .esper.cloud in your Esper console's address: acme for acme.esper.cloud.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          disableSpellCheck: true,
          placeholder: "acme",
        },
        {
          field: { apiKey: true },
          title: "API Key",
          description:
            "Make one in the Esper console under API Key Management. OneUptime only reads.",
          fieldType: FormFieldSchemaType.Password,
          required: true,
          disableSpellCheck: true,
        },
        nameField,
        intervalField,
      ];

  const initialValues: JSONObject = isEditing
    ? {
        name: props.connection?.name || "",
        readIntervalInMinutes: stored.readIntervalInMinutes,
      }
    : {
        readIntervalInMinutes:
          DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
      };

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate("Edit {{name}}", {
              name: props.connection?.name || "Esper",
            })
          : translator.translateTemplate("Connect {{provider}}", {
              provider: "Esper",
            })
      }
      isTitleTranslated={true}
      description={
        isEditing
          ? translator.translateTemplate("Tenant: {{tenant}}", {
              tenant: getEsperConsoleHost(stored.tenant),
            })
          : "Every Android device Esper enrolls is imported into Inventory, with its group, apps and last check-in, and kept current. OneUptime only reads."
      }
      name={
        isEditing
          ? "Inventory > Managed Devices > Edit Esper Connection"
          : "Inventory > Managed Devices > Connect Esper"
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
          const apiKey: string = readText(values["apiKey"]);
          const readIntervalInMinutes: number =
            Number(values["readIntervalInMinutes"]) ||
            DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES;
          const name: string = readText(values["name"]);

          if (isEditing && props.connection?.id) {
            // A new key is tested before it replaces the stored one.
            if (apiKey) {
              const result: DeviceManagementTestResult =
                await runDeviceManagementTest({
                  connectionId: props.connection.id.toString(),
                  secrets: { apiKey },
                });

              if (result.status !== "pass") {
                setIsLoading(false);
                setError(getTestFailureSentence(result, translator));
                return;
              }
            }

            await ModelAPI.updateById<DeviceManagementConnection>({
              modelType: DeviceManagementConnection,
              id: props.connection.id,
              data: {
                name: name,
                config: { readIntervalInMinutes },
                ...(apiKey ? { secrets: JSON.stringify({ apiKey }) } : {}),
              },
            });

            setIsLoading(false);
            props.onSaved();
            return;
          }

          const tenant: string = readText(values["tenant"]);
          const result: DeviceManagementTestResult =
            await runDeviceManagementTest({
              provider: DeviceManagementProvider.Esper,
              config: { tenant, readIntervalInMinutes },
              secrets: { apiKey },
            });

          if (result.status !== "pass") {
            setIsLoading(false);
            setError(getTestFailureSentence(result, translator));
            return;
          }

          const model: DeviceManagementConnection =
            new DeviceManagementConnection();
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.provider = DeviceManagementProvider.Esper;
          model.config = {
            tenant: result.tenant || tenant,
            readIntervalInMinutes,
          };
          model.secrets = JSON.stringify({ apiKey });
          model.isEnabled = true;

          if (name) {
            model.name = name;
          }

          await ModelAPI.create<DeviceManagementConnection>({
            model,
            modelType: DeviceManagementConnection,
          });

          setIsLoading(false);
          Toast.success(getTestPassedSentence(result, translator), {
            description: translator.translateText(
              "The first read starts within a minute.",
            ),
          });
          props.onSaved();
        } catch (err) {
          setIsLoading(false);
          setError(API.getFriendlyErrorMessage(err as Error));
        }
      }}
      formProps={{
        id: isEditing
          ? "edit-esper-connection-form"
          : "create-esper-connection-form",
        initialValues,
        fields,
      }}
    />
  );
};

export default EsperConnectionFormModal;
