import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DeviceManagementConfig,
  getDeviceManagementConnectionAddress,
  readDeviceManagementConfig,
} from "Common/Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "Common/Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "Common/Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "Common/Types/JSON";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormStep } from "Common/UI/Components/Forms/Types/FormStep";
import { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Toast from "Common/UI/Utils/Toast";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import { runDeviceManagementTest } from "./DeviceManagementApi";
import {
  getDeviceManagerIntervalOptions,
  readDeviceManagerFormText,
} from "./DeviceManagerFormParts";
import {
  getTestFailureSentence,
  getTestPassedSentence,
} from "./EsperConnectionFormModal";

/*
 * Connect a SOTI MobiControl server, or edit a connection (#10087), in the
 * steps every device manager's form of more than three rows walks
 * (Docs/ux/README.md#steps):
 *
 *   API client   the server's address, and the Client ID and Client Secret
 *                of the API client made for OneUptime on it;
 *   API user     the username and password of the MobiControl user
 *                OneUptime signs in as, whose permissions only read;
 *   Connection   its name and how often it is read, from defaults.
 *
 * Connect tests before it saves: a sign-in, the first device of the list,
 * and how many devices a read will import. A refusal is said in the form -
 * what happened, what to do, and MobiControl's own answer under it - and
 * nothing is saved. The secrets are write-only: they go to the server with
 * the test and the save, are stored encrypted and are never shown again.
 * On edit a secret left blank keeps the stored one, and anything new about
 * the sign-in is tested before it is saved. The server is the connection's.
 */

export interface ComponentProps {
  // The connection to edit; none to connect a new server.
  connection?: DeviceManagementConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
}

const SotiConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const isEditing: boolean = Boolean(props.connection?.id);
  const stored: DeviceManagementConfig = readDeviceManagementConfig(
    props.connection?.config,
    DeviceManagementProvider.Soti,
  );

  const steps: Array<FormStep<JSONObject>> = [
    { id: "api-client", title: "API client" },
    { id: "api-user", title: "API user" },
    { id: "connection", title: "Connection" },
  ];

  const secretDescription: string = isEditing
    ? "A new one replaces the stored one. Leave blank to keep it."
    : "";

  const fields: Array<Field<JSONObject>> = [
    {
      field: { tenant: true },
      title: "Server",
      description:
        "The address of your MobiControl web console, without /MobiControl.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "api-client",
      required: true,
      disableSpellCheck: true,
      placeholder: "https://acme.mobicontrolcloud.com",
      showIf: (): boolean => {
        return !isEditing;
      },
    },
    {
      field: { clientId: true },
      title: "Client ID",
      description:
        "The ID of the API client made for OneUptime, under API Client in the web console's global settings.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "api-client",
      required: true,
      disableSpellCheck: true,
    },
    {
      field: { clientSecret: true },
      title: "Client Secret",
      description:
        secretDescription ||
        "MobiControl shows it once, when the API client is made.",
      fieldType: FormFieldSchemaType.Password,
      stepId: "api-client",
      required: !isEditing,
      disableSpellCheck: true,
      ...(isEditing ? { placeholder: "Unchanged" } : {}),
    },
    {
      field: { username: true },
      title: "Username",
      description:
        "A MobiControl user that can only read: Web Console Access, View Installed Applications, and View Groups on its groups.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "api-user",
      required: true,
      disableSpellCheck: true,
    },
    {
      field: { password: true },
      title: "Password",
      description: secretDescription || "The MobiControl user's password.",
      fieldType: FormFieldSchemaType.Password,
      stepId: "api-user",
      required: !isEditing,
      disableSpellCheck: true,
      ...(isEditing ? { placeholder: "Unchanged" } : {}),
    },
    {
      field: { name: true },
      title: "Name",
      description: "How this connection is listed.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "connection",
      required: isEditing,
      placeholder: "SOTI MobiControl",
    },
    {
      field: { readIntervalInMinutes: true },
      title: "Read every",
      description:
        "How often the devices, their groups and their check-ins are read. Each device's apps are read every 6 hours.",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "connection",
      required: true,
      dropdownOptions: getDeviceManagerIntervalOptions(),
    },
  ];

  const initialValues: JSONObject = isEditing
    ? {
        name: props.connection?.name || "",
        clientId: stored.clientId || "",
        username: stored.username || "",
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
              name: props.connection?.name || "SOTI MobiControl",
            })
          : translator.translateTemplate("Connect {{provider}}", {
              provider: "SOTI MobiControl",
            })
      }
      isTitleTranslated={true}
      description={
        isEditing
          ? translator.translateTemplate("Server: {{server}}", {
              server: getDeviceManagementConnectionAddress({
                provider: DeviceManagementProvider.Soti,
                config: stored,
              }),
            })
          : "Every device MobiControl manages is imported into Inventory, with its device group, apps and last check-in, and kept current. OneUptime only reads."
      }
      name={
        isEditing
          ? "Inventory > Managed Devices > Edit SOTI Connection"
          : "Inventory > Managed Devices > Connect SOTI"
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
          const clientId: string = readDeviceManagerFormText(
            values["clientId"],
          );
          const username: string = readDeviceManagerFormText(
            values["username"],
          );
          const clientSecret: string = readDeviceManagerFormText(
            values["clientSecret"],
          );
          const password: string = readDeviceManagerFormText(
            values["password"],
          );
          const readIntervalInMinutes: number =
            Number(values["readIntervalInMinutes"]) ||
            DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES;
          const name: string = readDeviceManagerFormText(values["name"]);
          const secrets: JSONObject = {
            ...(clientSecret ? { clientSecret } : {}),
            ...(password ? { password } : {}),
          };

          if (isEditing && props.connection?.id) {
            const isSignInChanged: boolean =
              Object.keys(secrets).length > 0 ||
              clientId !== (stored.clientId || "") ||
              username !== (stored.username || "");

            // A new sign-in is tested before it replaces the stored one.
            if (isSignInChanged) {
              const result: DeviceManagementTestResult =
                await runDeviceManagementTest({
                  provider: DeviceManagementProvider.Soti,
                  connectionId: props.connection.id.toString(),
                  config: { clientId, username },
                  ...(Object.keys(secrets).length > 0 ? { secrets } : {}),
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
                config: { clientId, username, readIntervalInMinutes },
                ...(Object.keys(secrets).length > 0
                  ? { secrets: JSON.stringify(secrets) }
                  : {}),
              },
            });

            setIsLoading(false);
            props.onSaved();
            return;
          }

          const tenant: string = readDeviceManagerFormText(values["tenant"]);
          const config: JSONObject = {
            tenant,
            clientId,
            username,
            readIntervalInMinutes,
          };
          const result: DeviceManagementTestResult =
            await runDeviceManagementTest({
              provider: DeviceManagementProvider.Soti,
              config,
              secrets,
            });

          if (result.status !== "pass") {
            setIsLoading(false);
            setError(getTestFailureSentence(result, translator));
            return;
          }

          const model: DeviceManagementConnection =
            new DeviceManagementConnection();
          model.projectId = ProjectUtil.getCurrentProjectId()!;
          model.provider = DeviceManagementProvider.Soti;
          model.config = { ...config, tenant: result.tenant || tenant };
          model.secrets = JSON.stringify(secrets);
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
          ? "edit-soti-connection-form"
          : "create-soti-connection-form",
        initialValues,
        steps,
        fields,
      }}
    />
  );
};

export default SotiConnectionFormModal;
