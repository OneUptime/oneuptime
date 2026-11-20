import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import type { Mock, SpyInstance } from "jest-mock";
import * as React from "react";

/*
 * Connect a Workspace ONE UEM server (#10086) or a SOTI MobiControl server
 * (#10087), and choose one first. The form modal is captured instead of
 * drawn, so what is under test is what each form asks, step by step, what
 * "Connect" tests and what it saves:
 *
 *   - the picker offers all four device managers, each by its product name
 *     and with OneUptime's own icon;
 *   - Workspace ONE walks its server and how OneUptime signs in, then the
 *     OAuth client or the administrator's account, then the connection;
 *     SOTI walks its server and API client, its API user, then the
 *     connection;
 *   - each tests before it saves, and a test that fails saves nothing and
 *     says why in OneUptime's words, then the service's;
 *   - only the secrets of the way it signs in are sent, as JSON;
 *   - edit keeps a secret left blank, tests anything new about the
 *     sign-in before it saves it, and never asks for the server again.
 */

const mockCapturedFormProps: Array<Record<string, unknown>> = [];
type RunTestMock = (body: unknown) => Promise<unknown>;
const mockRunTest: Mock<RunTestMock> = jest.fn<RunTestMock>();

jest.mock("../../../UI/Components/FormModal/BasicFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedFormProps.push(props);
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagementApi",
  () => {
    return {
      __esModule: true,
      runDeviceManagementTest: (body: unknown): Promise<unknown> => {
        return mockRunTest(body);
      },
    };
  },
);

import WorkspaceOneConnectionFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/WorkspaceOneConnectionFormModal";
import SotiConnectionFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/SotiConnectionFormModal";
import DeviceManagerPickerModal, {
  DEVICE_MANAGER_CARD_OPTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagerPickerModal";
import {
  getDeviceManagementFailureWords,
  getManagedDeviceMatchWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagementWords";
import { readDeviceManagerFormText } from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagerFormParts";
import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import { DeviceManagementTestResult } from "../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDeviceHostMatch } from "../../../Types/DeviceManagement/ManagedDeviceIdentity";
import HashedString from "../../../Types/HashedString";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "40000000-0000-4000-8000-000000000001";
const CONNECTION_ID: string = "40000000-0000-4000-8000-000000000002";
const WS1_CLIENT_ID: string = "a3f1c2d4e5b647a8b9c0d1e2f3a4b5c6";
const WS1_SECRET: string = "9F2C4A7E1B3D5F60A8C2E4B6D8F0A1C3";
const WS1_API_KEY: string = "1EhZqw0lA6Uq2aUW8IDHm2RkAgpQZJbH9jE2/nYwG+w=";
const SOTI_CLIENT_ID: string = "a9326fd5872f4a66b6bab3e2c8065e63";
const SOTI_SECRET: string = "19DzUX7K7ObjwPRFbxZanwVQFsUcqMak";

interface CapturedField {
  field: Record<string, boolean>;
  title: string;
  fieldType: string;
  stepId?: string;
  required?: boolean | ((values: JSONObject) => boolean);
  showIf?: (values: JSONObject) => boolean;
  placeholder?: string;
  description?: string;
  dropdownOptions?: Array<{
    value: string;
    label: string;
    isUserContent?: boolean;
  }>;
  radioButtonOptions?: Array<{ value: string; title: string }>;
}

interface CapturedStep {
  id: string;
  title: string;
  showIf?: (values: JSONObject) => boolean;
}

let createSpy: SpyInstance<typeof ModelAPI.create>;
let updateSpy: SpyInstance<typeof ModelAPI.updateById>;

function passed(
  provider: DeviceManagementProvider,
  tenant: string,
  fields: Partial<DeviceManagementTestResult> = {},
): DeviceManagementTestResult {
  return {
    provider,
    status: "pass",
    message: `Connected: 4 devices to import.`,
    tenant,
    deviceCount: 4,
    durationMs: 1,
    ...fields,
  };
}

function lastFormProps(): Record<string, unknown> {
  const props: Record<string, unknown> | undefined =
    mockCapturedFormProps[mockCapturedFormProps.length - 1];

  if (!props) {
    throw new Error("No form was drawn");
  }

  return props;
}

function fieldsOf(props: Record<string, unknown>): Array<CapturedField> {
  return (props["formProps"] as { fields: Array<CapturedField> }).fields;
}

function titled(props: Record<string, unknown>, title: string): CapturedField {
  const found: CapturedField | undefined = fieldsOf(props).find(
    (field: CapturedField): boolean => {
      return field.title === title;
    },
  );

  if (!found) {
    throw new Error(`No field "${title}"`);
  }

  return found;
}

/*
 * The steps a person walks with these values, each with the fields it
 * shows: a step's showIf and a field's are applied, as BasicForm applies
 * them.
 */
function walk(props: Record<string, unknown>, values: JSONObject): Array<string> {
  const steps: Array<CapturedStep> = (
    props["formProps"] as { steps: Array<CapturedStep> }
  ).steps;

  return steps
    .filter((step: CapturedStep): boolean => {
      return !step.showIf || step.showIf(values);
    })
    .map((step: CapturedStep): string => {
      return `${step.title}: ${fieldsOf(props)
        .filter((field: CapturedField): boolean => {
          return (
            field.stepId === step.id && (!field.showIf || field.showIf(values))
          );
        })
        .map((field: CapturedField): string => {
          return field.title;
        })
        .join(", ")}`;
    });
}

function isRequired(field: CapturedField, values: JSONObject): boolean {
  return typeof field.required === "function"
    ? field.required(values)
    : Boolean(field.required);
}

async function submit(values: JSONObject): Promise<void> {
  await act(async () => {
    await (
      lastFormProps()["onSubmit"] as (values: JSONObject) => Promise<void>
    )(values);
  });
}

function savedModel(): DeviceManagementConnection {
  return (
    createSpy.mock.calls[0]![0] as { model: DeviceManagementConnection }
  ).model;
}

function updateData(): JSONObject {
  return (updateSpy.mock.calls[0]![0] as { data: JSONObject }).data;
}

beforeEach(() => {
  mockCapturedFormProps.length = 0;
  mockRunTest.mockReset();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(Toast, "success").mockImplementation(() => {});
  createSpy = getJestSpyOn(ModelAPI, "create").mockResolvedValue(
    {} as never,
  ) as unknown as SpyInstance<typeof ModelAPI.create>;
  updateSpy = getJestSpyOn(ModelAPI, "updateById").mockResolvedValue(
    {} as never,
  ) as unknown as SpyInstance<typeof ModelAPI.updateById>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("choosing a device manager", () => {
  test("offers all four, by their product names, each with OneUptime's own icon", () => {
    expect(
      DEVICE_MANAGER_CARD_OPTIONS.map(
        (option: { value: string; title: string; icon?: IconProp }) => {
          return `${option.value} ${option.title} ${option.icon}`;
        },
      ),
    ).toEqual([
      `esper Esper ${IconProp.DevicePhoneMobile}`,
      `intune Microsoft Intune ${IconProp.ComputerDesktop}`,
      `workspaceone Workspace ONE UEM ${IconProp.DeviceTablet}`,
      `soti SOTI MobiControl ${IconProp.Signal}`,
    ]);
  });

  test("hands the page Workspace ONE or SOTI when chosen", async () => {
    const onChoose: MockFunction = getJestMockFunction();

    render(
      <DeviceManagerPickerModal
        onClose={(): void => {}}
        onChoose={
          onChoose as unknown as (provider: DeviceManagementProvider) => void
        }
      />,
    );

    await submit({ provider: DeviceManagementProvider.WorkspaceOne });
    expect(onChoose).toHaveBeenLastCalledWith(
      DeviceManagementProvider.WorkspaceOne,
    );
    await submit({ provider: DeviceManagementProvider.Soti });
    expect(onChoose).toHaveBeenLastCalledWith(DeviceManagementProvider.Soti);
  });
});

describe("connecting a Workspace ONE server", () => {
  function renderForm(connection?: DeviceManagementConnection): {
    onSaved: MockFunction;
  } {
    const onSaved: MockFunction = getJestMockFunction();

    render(
      <WorkspaceOneConnectionFormModal
        connection={connection}
        onClose={(): void => {}}
        onSaved={onSaved as unknown as () => void}
      />,
    );

    return { onSaved };
  }

  test("walks the server and the way in, then the OAuth client - or the administrator's account - then the connection", () => {
    renderForm();
    const props: Record<string, unknown> = lastFormProps();

    expect(walk(props, { authMethod: "oauth" })).toEqual([
      "Server: REST API URL, Sign in with",
      "OAuth client: Client ID, Client Secret, Region",
      "Connection: Name, Read every",
    ]);
    expect(walk(props, { authMethod: "basic" })).toEqual([
      "Server: REST API URL, Sign in with",
      "Administrator account: Username, Password, REST API Key",
      "Connection: Name, Read every",
    ]);
    expect(
      (props["formProps"] as { initialValues: JSONObject }).initialValues,
    ).toEqual({
      authMethod: "oauth",
      region: "na",
      readIntervalInMinutes: 15,
    });
    expect(
      titled(props, "Sign in with").radioButtonOptions!.map(
        (option: { value: string; title: string }): string => {
          return `${option.value} ${option.title}`;
        },
      ),
    ).toEqual(["oauth OAuth client", "basic Administrator account"]);
    // The token service's regions, by the hosts Omnissa's docs name: as written.
    expect(titled(props, "Region").dropdownOptions).toEqual([
      { value: "na", label: "na.uemauth.workspaceone.com", isUserContent: true },
      {
        value: "emea",
        label: "emea.uemauth.workspaceone.com",
        isUserContent: true,
      },
      {
        value: "apac",
        label: "apac.uemauth.workspaceone.com",
        isUserContent: true,
      },
      {
        value: "uat",
        label: "uat.uemauth.workspaceone.com",
        isUserContent: true,
      },
    ]);
    // Only the way in taken asks for its credentials.
    expect(isRequired(titled(props, "Client Secret"), { authMethod: "oauth" })).toBe(true);
    expect(isRequired(titled(props, "Client Secret"), { authMethod: "basic" })).toBe(false);
    expect(isRequired(titled(props, "REST API Key"), { authMethod: "basic" })).toBe(true);
    for (const title of ["Client Secret", "Password", "REST API Key"]) {
      expect(titled(props, title).fieldType).toBe("Password");
    }
  });

  test("tests an OAuth client, then saves the server as the test read it and only the client's secret", async () => {
    mockRunTest.mockResolvedValue(
      passed(DeviceManagementProvider.WorkspaceOne, "as1234.awmdm.com"),
    );
    const { onSaved } = renderForm();

    await submit({
      tenant: " https://cn1234.awmdm.com/AirWatch ",
      authMethod: "oauth",
      clientId: ` ${WS1_CLIENT_ID} `,
      clientSecret: new HashedString(WS1_SECRET),
      region: "emea",
      // Typed and then left: the other way's values are never sent.
      username: "stale",
      password: new HashedString("stale"),
      readIntervalInMinutes: 30,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.WorkspaceOne,
      config: {
        tenant: "https://cn1234.awmdm.com/AirWatch",
        authMethod: "oauth",
        clientId: WS1_CLIENT_ID,
        region: "emea",
        readIntervalInMinutes: 30,
      },
      secrets: { clientSecret: WS1_SECRET },
    });

    const model: DeviceManagementConnection = savedModel();
    expect(model.provider).toBe(DeviceManagementProvider.WorkspaceOne);
    expect(model.config).toEqual({
      tenant: "as1234.awmdm.com",
      authMethod: "oauth",
      clientId: WS1_CLIENT_ID,
      region: "emea",
      readIntervalInMinutes: 30,
    });
    expect(JSON.parse(model.secrets!)).toEqual({ clientSecret: WS1_SECRET });
    expect(model.isEnabled).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("an administrator's account sends its username, password and REST API key", async () => {
    mockRunTest.mockResolvedValue(
      passed(DeviceManagementProvider.WorkspaceOne, "mdm.acme.com"),
    );
    renderForm();

    await submit({
      tenant: "mdm.acme.com",
      authMethod: "basic",
      username: "ACME\\reader",
      password: new HashedString(" pw with spaces "),
      apiKey: new HashedString(WS1_API_KEY),
      readIntervalInMinutes: 15,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.WorkspaceOne,
      config: {
        tenant: "mdm.acme.com",
        authMethod: "basic",
        username: "ACME\\reader",
        readIntervalInMinutes: 15,
      },
      secrets: { password: " pw with spaces ", apiKey: WS1_API_KEY },
    });
    expect(JSON.parse(savedModel().secrets!)).toEqual({
      password: " pw with spaces ",
      apiKey: WS1_API_KEY,
    });
  });

  test("a test that fails saves nothing, and says why in OneUptime's words, then Workspace ONE's", async () => {
    mockRunTest.mockResolvedValue({
      ...passed(DeviceManagementProvider.WorkspaceOne, "as1234.awmdm.com"),
      status: "fail",
      deviceCount: undefined,
      failureKind: LlmConnectionFailureKind.Permission,
      message:
        "The Workspace ONE UEM server answered the device list request with HTTP 403: User doesn't have sufficient permissions to perform this operation. (error code 1011).",
    });
    const { onSaved } = renderForm();

    await submit({
      tenant: "as1234.awmdm.com",
      authMethod: "oauth",
      clientId: WS1_CLIENT_ID,
      clientSecret: new HashedString(WS1_SECRET),
      region: "na",
      readIntervalInMinutes: 15,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(lastFormProps()["error"]).toBe(
      "OneUptime's admin role may not read Workspace ONE's devices. Give the role Read on Devices and Apps under its REST API permissions, at the organization group whose devices OneUptime reads. The Workspace ONE UEM server answered the device list request with HTTP 403: User doesn't have sufficient permissions to perform this operation. (error code 1011).",
    );
  });

  test("edit walks the saved way in and the connection, never the server; a blank secret is kept and nothing tested", async () => {
    const connection: DeviceManagementConnection =
      new DeviceManagementConnection();
    connection._id = CONNECTION_ID;
    connection.name = "Stores";
    connection.provider = DeviceManagementProvider.WorkspaceOne;
    connection.config = {
      tenant: "as1234.awmdm.com",
      authMethod: "oauth",
      region: "emea",
      clientId: WS1_CLIENT_ID,
      readIntervalInMinutes: 30,
    };
    const { onSaved } = renderForm(connection);
    const props: Record<string, unknown> = lastFormProps();

    // Whatever the values say, a saved connection keeps its way in.
    expect(walk(props, { authMethod: "basic" })).toEqual([
      "OAuth client: Client ID, Client Secret, Region",
      "Connection: Name, Read every",
    ]);
    expect(titled(props, "Client Secret")).toMatchObject({
      placeholder: "Unchanged",
    });
    expect(isRequired(titled(props, "Client Secret"), {})).toBe(false);
    expect(props["description"]).toBe("Server: as1234.awmdm.com");

    await submit({
      name: "Stores",
      clientId: WS1_CLIENT_ID,
      region: "emea",
      clientSecret: "",
      readIntervalInMinutes: 60,
    });

    expect(mockRunTest).not.toHaveBeenCalled();
    expect(updateData()).toEqual({
      name: "Stores",
      config: { clientId: WS1_CLIENT_ID, region: "emea", readIntervalInMinutes: 60 },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("edit tests a new secret, or a new region, against the saved connection before it saves", async () => {
    const connection: DeviceManagementConnection =
      new DeviceManagementConnection();
    connection._id = CONNECTION_ID;
    connection.name = "Stores";
    connection.provider = DeviceManagementProvider.WorkspaceOne;
    connection.config = {
      tenant: "as1234.awmdm.com",
      authMethod: "oauth",
      region: "na",
      clientId: WS1_CLIENT_ID,
      readIntervalInMinutes: 15,
    };
    mockRunTest.mockResolvedValue({
      ...passed(DeviceManagementProvider.WorkspaceOne, "as1234.awmdm.com"),
      status: "fail",
      failureKind: LlmConnectionFailureKind.Authentication,
      message: "",
    });
    renderForm(connection);

    await submit({
      name: "Stores",
      clientId: WS1_CLIENT_ID,
      region: "emea",
      clientSecret: "",
      readIntervalInMinutes: 15,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.WorkspaceOne,
      connectionId: CONNECTION_ID,
      config: { clientId: WS1_CLIENT_ID, region: "emea" },
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(lastFormProps()["error"]).toBe(
      "Workspace ONE refused OneUptime's sign-in. Copy the OAuth client's ID and secret again and check its region, or check the administrator's username, password and REST API key.",
    );
  });
});

describe("connecting a SOTI MobiControl server", () => {
  function renderForm(connection?: DeviceManagementConnection): {
    onSaved: MockFunction;
  } {
    const onSaved: MockFunction = getJestMockFunction();

    render(
      <SotiConnectionFormModal
        connection={connection}
        onClose={(): void => {}}
        onSaved={onSaved as unknown as () => void}
      />,
    );

    return { onSaved };
  }

  function savedSoti(): DeviceManagementConnection {
    const connection: DeviceManagementConnection =
      new DeviceManagementConnection();
    connection._id = CONNECTION_ID;
    connection.name = "Warehouses";
    connection.provider = DeviceManagementProvider.Soti;
    connection.config = {
      tenant: "acme.mobicontrolcloud.com",
      clientId: SOTI_CLIENT_ID,
      username: "oneuptime-reader",
      readIntervalInMinutes: 15,
    };
    return connection;
  }

  test("walks the server and its API client, the API user, then the connection", () => {
    renderForm();
    const props: Record<string, unknown> = lastFormProps();

    expect(walk(props, {})).toEqual([
      "API client: Server, Client ID, Client Secret",
      "API user: Username, Password",
      "Connection: Name, Read every",
    ]);
    expect(titled(props, "Server").placeholder).toBe(
      "https://acme.mobicontrolcloud.com",
    );
    expect(titled(props, "Username").description).toContain(
      "Web Console Access",
    );
    for (const title of ["Client Secret", "Password"]) {
      expect(titled(props, title)).toMatchObject({
        fieldType: "Password",
        required: true,
      });
    }
  });

  test("tests, then saves the server as the test read it, and both secrets as JSON", async () => {
    mockRunTest.mockResolvedValue(
      passed(DeviceManagementProvider.Soti, "acme.mobicontrolcloud.com"),
    );
    const { onSaved } = renderForm();

    await submit({
      tenant: "https://acme.mobicontrolcloud.com/MobiControl/WebConsole",
      clientId: SOTI_CLIENT_ID,
      clientSecret: new HashedString(SOTI_SECRET),
      username: " oneuptime-reader ",
      password: new HashedString("Reader pass 2026!"),
      readIntervalInMinutes: 5,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.Soti,
      config: {
        tenant: "https://acme.mobicontrolcloud.com/MobiControl/WebConsole",
        clientId: SOTI_CLIENT_ID,
        username: "oneuptime-reader",
        readIntervalInMinutes: 5,
      },
      secrets: { clientSecret: SOTI_SECRET, password: "Reader pass 2026!" },
    });

    const model: DeviceManagementConnection = savedModel();
    expect(model.provider).toBe(DeviceManagementProvider.Soti);
    expect(model.config).toMatchObject({ tenant: "acme.mobicontrolcloud.com" });
    expect(JSON.parse(model.secrets!)).toEqual({
      clientSecret: SOTI_SECRET,
      password: "Reader pass 2026!",
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("a test that fails saves nothing, and says why in OneUptime's words, then MobiControl's", async () => {
    mockRunTest.mockResolvedValue({
      ...passed(DeviceManagementProvider.Soti, "acme.mobicontrolcloud.com"),
      status: "fail",
      failureKind: LlmConnectionFailureKind.Authentication,
      message:
        "MobiControl at acme.mobicontrolcloud.com refused OneUptime's sign-in. The MobiControl server refused OneUptime's sign-in (HTTP 400). invalid_grant",
    });
    renderForm();

    await submit({
      tenant: "acme.mobicontrolcloud.com",
      clientId: SOTI_CLIENT_ID,
      clientSecret: new HashedString(SOTI_SECRET),
      username: "oneuptime-reader",
      password: new HashedString("wrong"),
      readIntervalInMinutes: 15,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(String(lastFormProps()["error"])).toMatch(
      /^MobiControl refused OneUptime's sign-in\. Check the API client's ID and secret, and the user's username and password\. The user must be a MobiControl user with Web Console Access\. MobiControl at acme\.mobicontrolcloud\.com refused/,
    );
  });

  test("edit walks the API client, the user and the connection, never the server; blank secrets are kept", async () => {
    const { onSaved } = renderForm(savedSoti());
    const props: Record<string, unknown> = lastFormProps();

    expect(walk(props, {})).toEqual([
      "API client: Client ID, Client Secret",
      "API user: Username, Password",
      "Connection: Name, Read every",
    ]);
    expect(titled(props, "Password")).toMatchObject({
      required: false,
      placeholder: "Unchanged",
    });

    await submit({
      name: "Warehouses",
      clientId: SOTI_CLIENT_ID,
      username: "oneuptime-reader",
      clientSecret: "",
      password: "",
      readIntervalInMinutes: 30,
    });

    expect(mockRunTest).not.toHaveBeenCalled();
    expect(updateData()).toEqual({
      name: "Warehouses",
      config: {
        clientId: SOTI_CLIENT_ID,
        username: "oneuptime-reader",
        readIntervalInMinutes: 30,
      },
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("edit tests a new password before it saves it, and saves only what changed", async () => {
    mockRunTest.mockResolvedValue(
      passed(DeviceManagementProvider.Soti, "acme.mobicontrolcloud.com"),
    );
    renderForm(savedSoti());

    await submit({
      name: "Warehouses",
      clientId: SOTI_CLIENT_ID,
      username: "oneuptime-reader",
      clientSecret: "",
      password: new HashedString("new password"),
      readIntervalInMinutes: 15,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.Soti,
      connectionId: CONNECTION_ID,
      config: { clientId: SOTI_CLIENT_ID, username: "oneuptime-reader" },
      secrets: { password: "new password" },
    });
    expect(JSON.parse(updateData()["secrets"] as string)).toEqual({
      password: "new password",
    });
  });
});

describe("the words each service is told by", () => {
  test("a failure in each service's own words, by its kind", () => {
    for (const provider of [
      DeviceManagementProvider.WorkspaceOne,
      DeviceManagementProvider.Soti,
    ]) {
      const headlines: Set<string> = new Set<string>();

      for (const kind of [
        LlmConnectionFailureKind.Authentication,
        LlmConnectionFailureKind.Permission,
        LlmConnectionFailureKind.Settings,
        LlmConnectionFailureKind.RateLimited,
        LlmConnectionFailureKind.Unavailable,
      ]) {
        const words: { headline: string; advice?: string | undefined } =
          getDeviceManagementFailureWords(kind, provider);

        expect(words.advice).toBeTruthy();
        headlines.add(words.headline);
      }

      expect(headlines.size).toBe(5);
    }
  });

  test("a device telemetry names by its name in the service says which service", () => {
    expect(
      getManagedDeviceMatchWords(
        ManagedDeviceHostMatch.Name,
        DeviceManagementProvider.WorkspaceOne,
      ),
    ).toBe("Telemetry names it by its Workspace ONE name");
    expect(
      getManagedDeviceMatchWords(
        ManagedDeviceHostMatch.Name,
        DeviceManagementProvider.Soti,
      ),
    ).toBe("Telemetry names it by its MobiControl name");
  });

  test("a password a form submitted is kept as typed; other text is trimmed", () => {
    expect(readDeviceManagerFormText(new HashedString(" pw "))).toBe(" pw ");
    expect(readDeviceManagerFormText(" as1234.awmdm.com ")).toBe(
      "as1234.awmdm.com",
    );
    expect(readDeviceManagerFormText(undefined)).toBe("");
    expect(readDeviceManagerFormText(15)).toBe("15");
  });
});
