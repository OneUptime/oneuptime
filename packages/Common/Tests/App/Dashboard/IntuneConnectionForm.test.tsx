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
 * Connect a Microsoft Intune tenant (#9837), and choose it first. The form
 * modal is captured instead of drawn, so what is under test is what the
 * form asks, what "Connect" tests and what it saves:
 *
 *   - the choice of device manager hands the page the service chosen;
 *   - connect walks two steps (LongFormStepsGuard): the app registration -
 *     the tenant, the client ID and the secret, with the cloud under More
 *     fields - then the connection's name and how often it is read, and
 *     the cloud's choices as Microsoft names them;
 *   - it tests before it saves, and a test that fails saves nothing and
 *     says why in Microsoft's words;
 *   - edit keeps the secret left blank, and tests a new secret or a new
 *     client ID before it saves them.
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

import IntuneConnectionFormModal from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/IntuneConnectionFormModal";
import DeviceManagerPickerModal from "../../../../App/FeatureSet/Dashboard/src/Components/DeviceManagement/DeviceManagerPickerModal";
import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import { DeviceManagementTestResult } from "../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
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
const TENANT: string = "contoso.onmicrosoft.com";
const CLIENT_ID: string = "6731de76-14a6-49ae-97bc-6eba6914391e";
const SECRET: string = "Xq48Q~Zk1Lm9vN0pQrStUvWxYz.AbCdEfGhIjK-L";

interface CapturedField {
  field: Record<string, boolean>;
  title: string;
  fieldType: string;
  stepId?: string;
  required?: boolean;
  collapsibleSection?: unknown;
  dropdownOptions?: Array<{
    value: string;
    label: string;
    isUserContent?: boolean;
  }>;
}

let createSpy: SpyInstance<typeof ModelAPI.create>;
let updateSpy: SpyInstance<typeof ModelAPI.updateById>;

function passed(
  fields: Partial<DeviceManagementTestResult> = {},
): DeviceManagementTestResult {
  return {
    provider: DeviceManagementProvider.Intune,
    status: "pass",
    message:
      "Connected to the Intune tenant contoso.onmicrosoft.com: 412 devices to import.",
    tenant: TENANT,
    deviceCount: 412,
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

// Each step's title and the fields on it, in order.
function stepsOf(props: Record<string, unknown>): Array<string> {
  const steps: Array<{ id: string; title: string }> = (
    props["formProps"] as { steps: Array<{ id: string; title: string }> }
  ).steps;

  return steps.map((step: { id: string; title: string }): string => {
    return `${step.title}: ${fieldsOf(props)
      .filter((field: CapturedField): boolean => {
        return field.stepId === step.id;
      })
      .map((field: CapturedField): string => {
        return field.title;
      })
      .join(", ")}`;
  });
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

async function submit(values: JSONObject): Promise<void> {
  await act(async () => {
    await (
      lastFormProps()["onSubmit"] as (values: JSONObject) => Promise<void>
    )(values);
  });
}

function renderForm(connection?: DeviceManagementConnection): {
  onSaved: MockFunction;
  onClose: MockFunction;
} {
  const onSaved: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();

  render(
    <IntuneConnectionFormModal
      connection={connection}
      onClose={onClose as unknown as () => void}
      onSaved={onSaved as unknown as () => void}
    />,
  );

  return { onSaved, onClose };
}

function savedConnection(): DeviceManagementConnection {
  const connection: DeviceManagementConnection =
    new DeviceManagementConnection();
  connection._id = CONNECTION_ID;
  connection.name = "Contoso";
  connection.provider = DeviceManagementProvider.Intune;
  connection.config = {
    tenant: TENANT,
    clientId: CLIENT_ID,
    cloud: "public",
    readIntervalInMinutes: 30,
  };
  return connection;
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
  test("hands the page the service chosen", async () => {
    const onChoose: MockFunction = getJestMockFunction();

    render(
      <DeviceManagerPickerModal
        onClose={(): void => {}}
        onChoose={
          onChoose as unknown as (provider: DeviceManagementProvider) => void
        }
      />,
    );

    expect(lastFormProps()["title"]).toBe("Connect a device manager");
    await submit({ provider: DeviceManagementProvider.Intune });
    expect(onChoose).toHaveBeenCalledWith(DeviceManagementProvider.Intune);

    // Anything else is Esper, as a connection made before there was a choice.
    await submit({ provider: "nonsense" });
    expect(onChoose).toHaveBeenLastCalledWith(DeviceManagementProvider.Esper);
  });
});

describe("connecting an Intune tenant", () => {
  test("walks the app registration - the tenant, the client ID and the secret, the cloud folded - then the connection", () => {
    renderForm();
    const props: Record<string, unknown> = lastFormProps();

    expect(stepsOf(props)).toEqual([
      "App registration: Tenant ID, Application (Client) ID, Client Secret, Cloud",
      "Connection: Name, Read every",
    ]);
    expect(titled(props, "Client Secret")).toMatchObject({
      fieldType: "Password",
      required: true,
    });
    for (const title of [
      "Tenant ID",
      "Application (Client) ID",
      "Client Secret",
      "Name",
      "Read every",
    ]) {
      expect(titled(props, title).collapsibleSection).toBeUndefined();
    }
    // The cloud most tenants never change, under More fields.
    expect(titled(props, "Cloud").collapsibleSection).toBeDefined();
    expect(props["submitButtonText"]).toBe("Connect");
    // The clouds as Microsoft names them: product names, never translated.
    expect(titled(props, "Cloud").dropdownOptions).toEqual([
      {
        value: "public",
        label: "Microsoft Azure (worldwide)",
        isUserContent: true,
      },
      { value: "gcc", label: "Microsoft 365 GCC", isUserContent: true },
      { value: "usgov", label: "Microsoft 365 GCC High", isUserContent: true },
      { value: "dod", label: "Microsoft 365 DoD", isUserContent: true },
    ]);
    expect(
      (props["formProps"] as { initialValues: JSONObject }).initialValues,
    ).toEqual({ cloud: "public", readIntervalInMinutes: 15 });
  });

  test("tests, then saves the tenant as the test read it, and the secret as JSON", async () => {
    mockRunTest.mockResolvedValue(passed());
    const { onSaved } = renderForm();

    await submit({
      tenant: ` ${TENANT} `,
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      cloud: "public",
      readIntervalInMinutes: 15,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.Intune,
      config: {
        tenant: TENANT,
        clientId: CLIENT_ID,
        cloud: "public",
        readIntervalInMinutes: 15,
      },
      secrets: { clientSecret: SECRET },
    });

    const model: DeviceManagementConnection = (
      createSpy.mock.calls[0]![0] as { model: DeviceManagementConnection }
    ).model;
    expect(model.provider).toBe(DeviceManagementProvider.Intune);
    expect(model.config).toEqual({
      tenant: TENANT,
      clientId: CLIENT_ID,
      cloud: "public",
      readIntervalInMinutes: 15,
    });
    expect(JSON.parse(model.secrets!)).toEqual({ clientSecret: SECRET });
    expect(model.isEnabled).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("a test that fails saves nothing, and says why in Microsoft's words", async () => {
    mockRunTest.mockResolvedValue({
      ...passed(),
      status: "fail",
      deviceCount: undefined,
      failureKind: LlmConnectionFailureKind.Permission,
      message:
        "Microsoft Graph answered the device list request with HTTP 403: Forbidden.",
    });
    const { onSaved } = renderForm();

    await submit({
      tenant: TENANT,
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      cloud: "public",
      readIntervalInMinutes: 15,
    });

    expect(createSpy).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(lastFormProps()["error"]).toBe(
      "The app registration may not read Intune's devices. Give it the application permission DeviceManagementManagedDevices.Read.All on Microsoft Graph, and grant admin consent. Microsoft Graph answered the device list request with HTTP 403: Forbidden.",
    );
  });
});

describe("editing an Intune connection", () => {
  test("walks its client ID and a new secret, then its name and interval; the tenant and cloud are fixed", () => {
    renderForm(savedConnection());
    const props: Record<string, unknown> = lastFormProps();

    expect(stepsOf(props)).toEqual([
      "App registration: Application (Client) ID, Client Secret",
      "Connection: Name, Read every",
    ]);
    expect(titled(props, "Client Secret").required).toBe(false);
    expect(
      (props["formProps"] as { initialValues: JSONObject }).initialValues,
    ).toEqual({
      name: "Contoso",
      clientId: CLIENT_ID,
      readIntervalInMinutes: 30,
    });
  });

  test("a secret left blank is kept, and nothing is tested", async () => {
    const { onSaved } = renderForm(savedConnection());

    await submit({
      name: "Contoso",
      clientId: CLIENT_ID,
      clientSecret: "",
      readIntervalInMinutes: 60,
    });

    expect(mockRunTest).not.toHaveBeenCalled();
    expect(updateSpy.mock.calls[0]![0]).toMatchObject({
      data: {
        name: "Contoso",
        config: { clientId: CLIENT_ID, readIntervalInMinutes: 60 },
      },
    });
    expect(
      (updateSpy.mock.calls[0]![0] as { data: JSONObject }).data["secrets"],
    ).toBeUndefined();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("a new secret is tested against the saved connection before it is saved", async () => {
    mockRunTest.mockResolvedValue(passed());
    renderForm(savedConnection());

    await submit({
      name: "Contoso",
      clientId: CLIENT_ID,
      clientSecret: SECRET,
      readIntervalInMinutes: 30,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.Intune,
      connectionId: CONNECTION_ID,
      config: { clientId: CLIENT_ID },
      secrets: { clientSecret: SECRET },
    });
    expect(
      JSON.parse(
        (updateSpy.mock.calls[0]![0] as { data: JSONObject }).data[
          "secrets"
        ] as string,
      ),
    ).toEqual({ clientSecret: SECRET });
  });

  test("a new client ID that fails its test is not saved", async () => {
    mockRunTest.mockResolvedValue({
      ...passed(),
      status: "fail",
      failureKind: LlmConnectionFailureKind.Settings,
      message: "",
    });
    renderForm(savedConnection());

    await submit({
      name: "Contoso",
      clientId: "0d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a",
      clientSecret: "",
      readIntervalInMinutes: 30,
    });

    expect(mockRunTest).toHaveBeenCalledWith({
      provider: DeviceManagementProvider.Intune,
      connectionId: CONNECTION_ID,
      config: { clientId: "0d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a" },
    });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(lastFormProps()["error"]).toBe(
      "Check the tenant ID, the client ID and the cloud. All three are on the app registration's Overview in the Microsoft Entra admin center.",
    );
  });
});
