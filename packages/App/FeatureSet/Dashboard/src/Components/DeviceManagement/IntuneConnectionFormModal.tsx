import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DEFAULT_INTUNE_CLOUD,
  DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES,
  DeviceManagementConfig,
  INTUNE_CLOUDS,
  INTUNE_CLOUD_TITLES,
  IntuneCloud,
  getDeviceManagementConnectionAddress,
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
import { READ_INTERVAL_WORDS } from "./DeviceManagementWords";
import {
  getTestFailureSentence,
  getTestPassedSentence,
} from "./EsperConnectionFormModal";

/*
 * Connect a Microsoft Intune tenant, or edit a connection (#9837): three
 * questions - the tenant, the app registration's client ID and its secret -
 * with the cloud, the name and how often to read folded under More fields.
 *
 * Connect tests before it saves: a token from Microsoft Entra, the first
 * device of Intune's list, and how many devices a read will import. A
 * secret Microsoft refuses, or a permission the app registration lacks, is
 * said in the form - what happened, what to do, and Microsoft's own answer
 * under it - and nothing is saved. The secret is write-only: it goes to the
 * server with the test and the save, is stored encrypted and is never
 * shown again. On edit a secret left blank keeps the stored one, and a new
 * one, or a new client ID, is tested before it is saved.
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

const IntuneConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const moreFields: FormFieldCollapsibleSection<JSONObject> = useRef(
    getAdvancedFormSection<JSONObject>(),
  ).current;

  const isEditing: boolean = Boolean(props.connection?.id);
  const stored: DeviceManagementConfig = readDeviceManagementConfig(
    props.connection?.config,
    DeviceManagementProvider.Intune,
  );

  const intervalOptions: Array<DropdownOption> =
    DEVICE_MANAGEMENT_READ_INTERVALS_IN_MINUTES.map(
      (minutes: number): DropdownOption => {
        return {
          value: minutes,
          label: READ_INTERVAL_WORDS[minutes] || String(minutes),
        };
      },
    );

  // Product names, drawn as written.
  const cloudOptions: Array<DropdownOption> = INTUNE_CLOUDS.map(
    (cloud: IntuneCloud): DropdownOption => {
      return {
        value: cloud,
        label: INTUNE_CLOUD_TITLES[cloud],
        isUserContent: true,
      };
    },
  );

  const nameField: Field<JSONObject> = {
    field: { name: true },
    title: "Name",
    description: "How this connection is listed.",
    fieldType: FormFieldSchemaType.Text,
    required: isEditing,
    placeholder: "Microsoft Intune",
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

  const clientIdField: Field<JSONObject> = {
    field: { clientId: true },
    title: "Application (Client) ID",
    description:
      "On the app registration's Overview. It needs the application permission DeviceManagementManagedDevices.Read.All on Microsoft Graph.",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    disableSpellCheck: true,
    placeholder: "00000000-0000-0000-0000-000000000000",
  };

  const fields: Array<Field<JSONObject>> = isEditing
    ? [
        nameField,
        clientIdField,
        {
          field: { clientSecret: true },
          title: "Client Secret",
          description:
            "A new secret replaces the stored one. Leave blank to keep it.",
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
          title: "Tenant ID",
          description:
            "The Directory (tenant) ID on the app registration's Overview in the Microsoft Entra admin center, or a domain of the tenant.",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          disableSpellCheck: true,
          placeholder: "contoso.onmicrosoft.com",
        },
        clientIdField,
        {
          field: { clientSecret: true },
          title: "Client Secret",
          description:
            "The secret's value, from Certificates & secrets on the app registration. OneUptime only reads.",
          fieldType: FormFieldSchemaType.Password,
          required: true,
          disableSpellCheck: true,
        },
        {
          field: { cloud: true },
          title: "Cloud",
          description: "The Microsoft cloud the tenant is in.",
          fieldType: FormFieldSchemaType.Dropdown,
          required: true,
          dropdownOptions: cloudOptions,
          collapsibleSection: moreFields,
        },
        nameField,
        intervalField,
      ];

  const initialValues: JSONObject = isEditing
    ? {
        name: props.connection?.name || "",
        clientId: stored.clientId || "",
        readIntervalInMinutes: stored.readIntervalInMinutes,
      }
    : {
        cloud: DEFAULT_INTUNE_CLOUD,
        readIntervalInMinutes:
          DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
      };

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate("Edit {{name}}", {
              name: props.connection?.name || "Microsoft Intune",
            })
          : translator.translateTemplate("Connect {{provider}}", {
              provider: "Microsoft Intune",
            })
      }
      isTitleTranslated={true}
      description={
        isEditing
          ? translator.translateTemplate("Tenant: {{tenant}}", {
              tenant: getDeviceManagementConnectionAddress({
                provider: DeviceManagementProvider.Intune,
                config: stored,
              }),
            })
          : "Every device Intune manages is imported into Inventory, with its category, apps and last check-in, and kept current. OneUptime only reads."
      }
      name={
        isEditing
          ? "Inventory > Managed Devices > Edit Intune Connection"
          : "Inventory > Managed Devices > Connect Intune"
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
          const clientSecret: string = readText(values["clientSecret"]);
          const clientId: string = readText(values["clientId"]);
          const readIntervalInMinutes: number =
            Number(values["readIntervalInMinutes"]) ||
            DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES;
          const name: string = readText(values["name"]);

          if (isEditing && props.connection?.id) {
            const isClientIdChanged: boolean =
              clientId.toLowerCase() !== (stored.clientId || "");

            // New credentials are tested before they replace the stored ones.
            if (clientSecret || isClientIdChanged) {
              /*
               * The saved connection's service is what the server tests
               * with; naming it too words a refusal of the form's values
               * (a secret's ID for its value) as Intune's.
               */
              const result: DeviceManagementTestResult =
                await runDeviceManagementTest({
                  provider: DeviceManagementProvider.Intune,
                  connectionId: props.connection.id.toString(),
                  config: { clientId },
                  ...(clientSecret ? { secrets: { clientSecret } } : {}),
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
                config: { clientId, readIntervalInMinutes },
                ...(clientSecret
                  ? { secrets: JSON.stringify({ clientSecret }) }
                  : {}),
              },
            });

            setIsLoading(false);
            props.onSaved();
            return;
          }

          const tenant: string = readText(values["tenant"]);
          const cloud: string =
            readText(values["cloud"]) || DEFAULT_INTUNE_CLOUD;
          const result: DeviceManagementTestResult =
            await runDeviceManagementTest({
              provider: DeviceManagementProvider.Intune,
              config: { tenant, clientId, cloud, readIntervalInMinutes },
              secrets: { clientSecret },
            });

          if (result.status !== "pass") {
            setIsLoading(false);
            setError(getTestFailureSentence(result, translator));
            return;
          }

          const model: DeviceManagementConnection =
            new DeviceManagementConnection();
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.provider = DeviceManagementProvider.Intune;
          model.config = {
            tenant: result.tenant || tenant,
            clientId,
            cloud,
            readIntervalInMinutes,
          };
          model.secrets = JSON.stringify({ clientSecret });
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
          ? "edit-intune-connection-form"
          : "create-intune-connection-form",
        initialValues,
        fields,
      }}
    />
  );
};

export default IntuneConnectionFormModal;
