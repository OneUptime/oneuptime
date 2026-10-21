import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  CloudConnectionAuthMethod,
  CloudConnectionDefinition,
  getCloudConnectionDefinition,
} from "../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionAwsRoleSetup } from "../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudConnectionFormModal, {
  getOfferedMethods,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionFormModal";

/*
 * The connection form, drawn for real (BasicFormModal and its steps):
 *
 *   - Access, Credentials, Test: the command first, in the cloud's own
 *     terminal; for AWS a role (nothing secret stored) when this OneUptime
 *     can sign in to one, else an access key - and nothing until it knows;
 *   - one paste of what the command printed fills in every value, and says
 *     which it found;
 *   - the test sends what the form holds; Connect saves it for the server
 *     to name, and says it is new;
 *   - an edit keeps the stored secret unless a new one is typed.
 */

const AZURE: CloudConnectionDefinition = getCloudConnectionDefinition(
  CloudProvider.Azure,
)!;

const TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
const APP: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
const PASSWORD: string = "Q~8Q8.ab-CD{e}fGh~ij_kL}m";

const AZURE_OUTPUT: string = [
  "WARNING: Creating 'Monitoring Reader' role assignment under scope '/subscriptions/0000'",
  "{",
  `  "appId": "${APP}",`,
  '  "displayName": "OneUptimeReadOnly",',
  `  "password": "${PASSWORD}",`,
  `  "tenant": "${TENANT}"`,
  "}",
].join("\n");

const ROLE_SETUP: CloudConnectionAwsRoleSetup = {
  isAvailable: true,
  trustedPrincipalArn: "arn:aws:iam::999988887777:root",
  externalId: "oneuptime-0123456789abcdef0123456789abcdef",
};

const NO_ROLE: CloudConnectionAwsRoleSetup = {
  isAvailable: false,
  externalId: "",
};

let createSpy: jest.SpyInstance<any, any>;
let updateSpy: jest.SpyInstance<any, any>;
let postSpy: jest.SpyInstance<any, any>;

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  createSpy = getJestSpyOn(ModelAPI, "create").mockResolvedValue({});
  updateSpy = getJestSpyOn(ModelAPI, "updateById").mockResolvedValue({});
  postSpy = getJestSpyOn(API, "post").mockResolvedValue({
    data: {
      provider: "azure",
      status: "pass",
      message: "Signed in.",
      accounts: ["sub-1"],
      resourceCount: 2,
      resourceTypes: [{ type: "Microsoft.Compute/virtualMachines", count: 2 }],
      regions: [{ region: "westeurope", count: 2 }],
      durationMs: 10,
    },
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

async function openForm(data: {
  provider: CloudProvider;
  connection?: CloudConnection;
  awsRoleSetup?: CloudConnectionAwsRoleSetup | undefined;
  onSaved?: MockFunction;
}): Promise<void> {
  await act(async () => {
    render(
      <CloudConnectionFormModal
        provider={data.provider}
        connection={data.connection}
        awsRoleSetup={data.awsRoleSetup}
        onClose={getJestMockFunction()}
        onSaved={data.onSaved || getJestMockFunction()}
      />,
    );
  });
}

async function stepTitles(): Promise<Array<string>> {
  const progress: HTMLElement = await within(modal()).findByRole("navigation", {
    name: "Progress",
  });

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function next(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(modal()).getByTestId("modal-footer-next-button"));
  });
}

async function paste(text: string): Promise<void> {
  await act(async () => {
    fireEvent.change(within(modal()).getByPlaceholderText("{ ... }"), {
      target: { value: text },
    });
  });
  // The values are filled in after the paste is stored.
  await act(async () => {
    await Promise.resolve();
  });
}

describe("the steps", () => {
  test("Access, Credentials, Test - the command first, what arrives said up top", async () => {
    await openForm({ provider: CloudProvider.Azure });

    expect(await stepTitles()).toEqual(["Access", "Credentials", "Test"]);
    expect(
      within(modal()).getByText("Connect Microsoft Azure"),
    ).toBeInTheDocument();
    expect(within(modal()).getByTestId("modal-description")).toHaveTextContent(
      AZURE.summary,
    );
    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("az ad sp create-for-rbac");
    // One way in: nothing to choose.
    expect(within(modal()).queryAllByRole("radio")).toHaveLength(0);
  });

  test("AWS waits to know whether it can offer a role", async () => {
    await openForm({ provider: CloudProvider.AWS });

    expect(
      within(modal()).getByText("Connect Amazon Web Services"),
    ).toBeInTheDocument();
    expect(
      within(modal()).queryByTestId("cloud-setup-command"),
    ).not.toBeInTheDocument();
  });

  test("AWS with a role to offer: a role first, an access key the other choice, each with its command", async () => {
    await openForm({ provider: CloudProvider.AWS, awsRoleSetup: ROLE_SETUP });
    await stepTitles();

    const role: HTMLElement = within(modal()).getByRole("radio", {
      name: /IAM role/,
    });
    const key: HTMLElement = within(modal()).getByRole("radio", {
      name: /Access key/,
    });

    expect(role).toBeChecked();
    expect(key).not.toBeChecked();
    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent(ROLE_SETUP.externalId);

    await act(async () => {
      fireEvent.click(key);
    });

    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("aws iam create-access-key");
  });

  test("AWS that cannot sign in to a role: an access key, nothing to choose", async () => {
    await openForm({ provider: CloudProvider.AWS, awsRoleSetup: NO_ROLE });
    await stepTitles();

    expect(within(modal()).queryAllByRole("radio")).toHaveLength(0);
    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("aws iam create-access-key");
  });

  test("the methods offered: a role only when this OneUptime can sign in to one", () => {
    const aws: CloudConnectionDefinition = getCloudConnectionDefinition(
      CloudProvider.AWS,
    )!;

    expect(
      getOfferedMethods({ definition: aws, awsRoleSetup: ROLE_SETUP }).map(
        (method: { method: CloudConnectionAuthMethod }) => {
          return method.method;
        },
      ),
    ).toEqual([
      CloudConnectionAuthMethod.AwsRole,
      CloudConnectionAuthMethod.AwsAccessKey,
    ]);
    expect(
      getOfferedMethods({ definition: aws, awsRoleSetup: NO_ROLE }).map(
        (method: { method: CloudConnectionAuthMethod }) => {
          return method.method;
        },
      ),
    ).toEqual([CloudConnectionAuthMethod.AwsAccessKey]);
  });
});

describe("one paste", () => {
  test("says what it found in what Azure's command printed", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();

    await paste(AZURE_OUTPUT);

    expect(
      await within(modal()).findByTestId("cloud-connection-paste-found"),
    ).toHaveTextContent(
      "Found: Directory (tenant) ID, Application (client) ID, Client secret",
    );
  });

  test("says when nothing it needs is there yet", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();

    await paste("az: command not found");

    expect(
      await within(modal()).findByTestId("cloud-connection-paste-nothing"),
    ).toHaveTextContent(
      "Nothing OneUptime needs is in this yet. Copy everything the command printed.",
    );
  });
});

describe("testing and connecting", () => {
  test("the test sends what was pasted; Connect saves it for the server to name", async () => {
    const onSaved: MockFunction = getJestMockFunction();

    await openForm({ provider: CloudProvider.Azure, onSaved });
    await stepTitles();
    await next();
    await paste(AZURE_OUTPUT);
    await next();

    await waitFor(() => {
      expect(
        within(modal()).getByTestId("cloud-connection-test-button"),
      ).toBeEnabled();
    });

    await act(async () => {
      fireEvent.click(
        within(modal()).getByTestId("cloud-connection-test-button"),
      );
    });

    expect(
      await within(modal()).findByTestId("cloud-connection-test-pass"),
    ).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(1);

    const request: { url: { toString: () => string }; data: JSONObject } =
      postSpy.mock.calls[0]![0];

    expect(request.url.toString()).toMatch(/\/cloud-connection\/test$/);
    expect(request.data).toEqual({
      provider: CloudProvider.Azure,
      config: {
        authMethod: CloudConnectionAuthMethod.AzureClientSecret,
        tenantId: TENANT,
        clientId: APP,
        cloud: "public",
        readIntervalInMinutes: "5",
      },
      secrets: { clientSecret: PASSWORD },
    });

    await act(async () => {
      fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    const model: CloudConnection = createSpy.mock.calls[0]![0]
      .model as CloudConnection;

    expect(model.provider).toBe(CloudProvider.Azure);
    expect(model.projectId?.toString()).toBe(PROJECT_ID);
    // Empty: the server names it after the cloud and its account.
    expect(model.name).toBe("");
    expect(model.isEnabled).toBe(true);
    expect(JSON.parse(model.secrets as string)).toEqual({
      clientSecret: PASSWORD,
    });
    expect(model.config).toMatchObject({
      tenantId: TENANT,
      clientId: APP,
    });
    expect(onSaved).toHaveBeenCalledWith({
      name: "Microsoft Azure",
      isNew: true,
    });
  });
});

describe("editing a connection", () => {
  test("asks for what changes, keeps the stored secret, and saves without it", async () => {
    const connection: CloudConnection = new CloudConnection();
    connection._id = "20000000-0000-4000-8000-000000000001";
    connection.name = "Contoso production";
    connection.provider = CloudProvider.Azure;
    connection.config = {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: TENANT,
      clientId: APP,
    };
    const onSaved: MockFunction = getJestMockFunction();

    await openForm({ provider: CloudProvider.Azure, connection, onSaved });

    expect(await stepTitles()).toEqual(["Access", "Credentials", "Test"]);
    expect(
      within(modal()).getByText("Edit Contoso production"),
    ).toBeInTheDocument();

    await next();

    expect(within(modal()).getByPlaceholderText("Unchanged")).toBeInTheDocument();

    await next();

    await act(async () => {
      fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledTimes(1);
    });

    const update: { data: JSONObject } = updateSpy.mock.calls[0]![0];

    expect(update.data["name"]).toBe("Contoso production");
    expect(update.data["config"]).toMatchObject({
      tenantId: TENANT,
      clientId: APP,
    });
    // A blank secret keeps the stored one.
    expect(update.data).not.toHaveProperty("secrets");
    expect(createSpy).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith({
      name: "Contoso production",
      isNew: false,
    });
  });
});
