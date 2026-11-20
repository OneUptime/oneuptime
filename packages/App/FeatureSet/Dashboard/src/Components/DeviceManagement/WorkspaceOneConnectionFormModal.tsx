import DeviceManagementConnection from "Common/Models/DatabaseModels/DeviceManagementConnection";
import {
  DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
  DEFAULT_WORKSPACE_ONE_AUTH_METHOD,
  DEFAULT_WORKSPACE_ONE_REGION,
  DeviceManagementConfig,
  WORKSPACE_ONE_REGIONS,
  WorkspaceOneAuthMethod,
  WorkspaceOneRegion,
  getDeviceManagementConnectionAddress,
  getWorkspaceOneTokenHost,
  readDeviceManagementConfig,
} from "Common/Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "Common/Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "Common/Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "Common/Types/JSON";
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
 * Connect a Workspace ONE UEM server, or edit a connection (#10086), in the
 * steps every device manager's form of more than three rows walks
 * (Docs/ux/README.md#steps):
 *
 *   Server                 the REST API URL, and how OneUptime signs in: an
 *                          OAuth client (Omnissa's recommended way, the
 *                          default) or an administrator's account, for a
 *                          server without the token service;
 *   OAuth client           its Client ID and Client Secret, and the region
 *     or Administrator     of the token service it signs in at; or the
 *     account              administrator's username and password and the
 *                          tenant's REST API key;
 *   Connection             its name and how often it is read, from defaults.
 *
 * Connect tests before it saves: a sign-in, and the first page of the
 * device list, which says how many devices a read will import when the
 * whole list fits on it. A refusal is said in the form - what happened,
 * what to do, and Workspace ONE's own answer under it - and nothing is
 * saved. The secrets are write-only: they go to the server with the test
 * and the save, are stored encrypted and are never shown again. On edit a
 * secret left blank keeps the stored one, and anything new about the
 * sign-in is tested before it is saved. How a saved connection signs in is
 * kept: the server and the way in are the connection's.
 */

export interface ComponentProps {
  // The connection to edit; none to connect a new server.
  connection?: DeviceManagementConnection | undefined;
  onClose: () => void;
  onSaved: () => void;
}

// Whether the form's values sign in with an OAuth client.
function isOAuth(values: FormValues<JSONObject>): boolean {
  return (
    ((values as JSONObject)["authMethod"] ||
      DEFAULT_WORKSPACE_ONE_AUTH_METHOD) === "oauth"
  );
}

// The token service's regions, by their hosts: names Omnissa's docs use, drawn as written.
export const WORKSPACE_ONE_REGION_OPTIONS: Array<DropdownOption> =
  WORKSPACE_ONE_REGIONS.map((region: WorkspaceOneRegion): DropdownOption => {
    return {
      value: region,
      label: getWorkspaceOneTokenHost(region),
      isUserContent: true,
    };
  });

const WorkspaceOneConnectionFormModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const isEditing: boolean = Boolean(props.connection?.id);
  const stored: DeviceManagementConfig = readDeviceManagementConfig(
    props.connection?.config,
    DeviceManagementProvider.WorkspaceOne,
  );
  const storedAuthMethod: WorkspaceOneAuthMethod =
    stored.authMethod === "basic" ? "basic" : "oauth";

  // A saved connection's server and way in are fixed: its edit starts at the sign-in.
  const steps: Array<FormStep<JSONObject>> = [
    {
      id: "server",
      title: "Server",
      showIf: (): boolean => {
        return !isEditing;
      },
    },
    {
      id: "oauth-client",
      title: "OAuth client",
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isEditing ? storedAuthMethod === "oauth" : isOAuth(values);
      },
    },
    {
      id: "administrator",
      title: "Administrator account",
      showIf: (values: FormValues<JSONObject>): boolean => {
        return isEditing ? storedAuthMethod === "basic" : !isOAuth(values);
      },
    },
    { id: "connection", title: "Connection" },
  ];

  const secretDescription: string = isEditing
    ? "A new one replaces the stored one. Leave blank to keep it."
    : "";

  const fields: Array<Field<JSONObject>> = [
    {
      field: { tenant: true },
      title: "REST API URL",
      description:
        "Your Workspace ONE API server, as its REST API settings show it. A console address like cn1234.awmdm.com works too.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "server",
      required: true,
      disableSpellCheck: true,
      placeholder: "https://as1234.awmdm.com",
      showIf: (): boolean => {
        return !isEditing;
      },
    },
    {
      field: { authMethod: true },
      title: "Sign in with",
      fieldType: FormFieldSchemaType.RadioButton,
      stepId: "server",
      required: true,
      radioButtonOptions: [
        {
          value: "oauth",
          title: "OAuth client",
          description:
            "Recommended, for Workspace ONE in Omnissa's cloud. Make one under OAuth Client Management.",
        },
        {
          value: "basic",
          title: "Administrator account",
          description:
            "For a server on premises: an administrator's username and password, and the REST API key.",
        },
      ],
      showIf: (): boolean => {
        return !isEditing;
      },
    },
    {
      field: { clientId: true },
      title: "Client ID",
      description:
        "The OAuth client's ID. Give the client a role that can only read devices and apps.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "oauth-client",
      required: (values: FormValues<JSONObject>): boolean => {
        return isEditing ? storedAuthMethod === "oauth" : isOAuth(values);
      },
      disableSpellCheck: true,
    },
    {
      field: { clientSecret: true },
      title: "Client Secret",
      description:
        secretDescription ||
        "Workspace ONE shows it once, when the OAuth client is made.",
      fieldType: FormFieldSchemaType.Password,
      stepId: "oauth-client",
      required: (values: FormValues<JSONObject>): boolean => {
        return !isEditing && isOAuth(values);
      },
      disableSpellCheck: true,
      ...(isEditing ? { placeholder: "Unchanged" } : {}),
    },
    {
      field: { region: true },
      title: "Region",
      description:
        "The token service of your Workspace ONE data center: na for the US and Canada, emea for Europe, apac for Asia and Australia.",
      fieldType: FormFieldSchemaType.Dropdown,
      stepId: "oauth-client",
      required: (values: FormValues<JSONObject>): boolean => {
        return isEditing ? storedAuthMethod === "oauth" : isOAuth(values);
      },
      dropdownOptions: WORKSPACE_ONE_REGION_OPTIONS,
    },
    {
      field: { username: true },
      title: "Username",
      description:
        "An administrator whose role can only read devices and apps, at the organization group to read.",
      fieldType: FormFieldSchemaType.Text,
      stepId: "administrator",
      required: (values: FormValues<JSONObject>): boolean => {
        return isEditing ? storedAuthMethod === "basic" : !isOAuth(values);
      },
      disableSpellCheck: true,
    },
    {
      field: { password: true },
      title: "Password",
      description: secretDescription || "The administrator's password.",
      fieldType: FormFieldSchemaType.Password,
      stepId: "administrator",
      required: (values: FormValues<JSONObject>): boolean => {
        return !isEditing && !isOAuth(values);
      },
      disableSpellCheck: true,
      ...(isEditing ? { placeholder: "Unchanged" } : {}),
    },
    {
      field: { apiKey: true },
      title: "REST API Key",
      description:
        secretDescription ||
        "The tenant's API key, from the same REST API settings as the URL.",
      fieldType: FormFieldSchemaType.Password,
      stepId: "administrator",
      required: (values: FormValues<JSONObject>): boolean => {
        return !isEditing && !isOAuth(values);
      },
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
      placeholder: "Workspace ONE UEM",
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
        region: stored.region || DEFAULT_WORKSPACE_ONE_REGION,
        username: stored.username || "",
        readIntervalInMinutes: stored.readIntervalInMinutes,
      }
    : {
        authMethod: DEFAULT_WORKSPACE_ONE_AUTH_METHOD,
        region: DEFAULT_WORKSPACE_ONE_REGION,
        readIntervalInMinutes:
          DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES,
      };

  return (
    <BasicFormModal<JSONObject>
      title={
        isEditing
          ? translator.translateTemplate("Edit {{name}}", {
              name: props.connection?.name || "Workspace ONE UEM",
            })
          : translator.translateTemplate("Connect {{provider}}", {
              provider: "Workspace ONE UEM",
            })
      }
      isTitleTranslated={true}
      description={
        isEditing
          ? translator.translateTemplate("Server: {{server}}", {
              server: getDeviceManagementConnectionAddress({
                provider: DeviceManagementProvider.WorkspaceOne,
                config: stored,
              }),
            })
          : "Every device Workspace ONE manages is imported into Inventory with its group, apps and last check-in, and kept current. OneUptime only reads."
      }
      name={
        isEditing
          ? "Inventory > Managed Devices > Edit Workspace ONE Connection"
          : "Inventory > Managed Devices > Connect Workspace ONE"
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
          const authMethod: WorkspaceOneAuthMethod = isEditing
            ? storedAuthMethod
            : values["authMethod"] === "basic"
              ? "basic"
              : "oauth";
          const clientId: string = readDeviceManagerFormText(
            values["clientId"],
          );
          const region: string =
            readDeviceManagerFormText(values["region"]) ||
            DEFAULT_WORKSPACE_ONE_REGION;
          const username: string = readDeviceManagerFormText(
            values["username"],
          );
          const clientSecret: string = readDeviceManagerFormText(
            values["clientSecret"],
          );
          const password: string = readDeviceManagerFormText(
            values["password"],
          );
          const apiKey: string = readDeviceManagerFormText(values["apiKey"]);
          const readIntervalInMinutes: number =
            Number(values["readIntervalInMinutes"]) ||
            DEFAULT_DEVICE_MANAGEMENT_READ_INTERVAL_IN_MINUTES;
          const name: string = readDeviceManagerFormText(values["name"]);

          // Only the way it signs in is sent: an OAuth client's, or an administrator's.
          const signIn: JSONObject =
            authMethod === "oauth" ? { clientId, region } : { username };
          const secrets: JSONObject =
            authMethod === "oauth"
              ? { ...(clientSecret ? { clientSecret } : {}) }
              : {
                  ...(password ? { password } : {}),
                  ...(apiKey ? { apiKey } : {}),
                };

          if (isEditing && props.connection?.id) {
            const isSignInChanged: boolean =
              Object.keys(secrets).length > 0 ||
              (authMethod === "oauth"
                ? clientId !== (stored.clientId || "") ||
                  region !== (stored.region || DEFAULT_WORKSPACE_ONE_REGION)
                : username !== (stored.username || ""));

            // A new sign-in is tested before it replaces the stored one.
            if (isSignInChanged) {
              const result: DeviceManagementTestResult =
                await runDeviceManagementTest({
                  provider: DeviceManagementProvider.WorkspaceOne,
                  connectionId: props.connection.id.toString(),
                  config: signIn,
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
                config: { ...signIn, readIntervalInMinutes },
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
            authMethod,
            ...signIn,
            readIntervalInMinutes,
          };
          const result: DeviceManagementTestResult =
            await runDeviceManagementTest({
              provider: DeviceManagementProvider.WorkspaceOne,
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
          model.provider = DeviceManagementProvider.WorkspaceOne;
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
          ? "edit-workspace-one-connection-form"
          : "create-workspace-one-connection-form",
        initialValues,
        steps,
        fields,
      }}
    />
  );
};

export default WorkspaceOneConnectionFormModal;
