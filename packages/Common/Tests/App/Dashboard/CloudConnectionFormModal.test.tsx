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
 *     which it found - for every cloud and every way in, a role's ARN and a
 *     Google Cloud key printed after gcloud's own lines included; the
 *     values stay folded under it, and the step says once, on the paste,
 *     why it cannot go on;
 *   - the Test step tests what the form holds by itself as it opens -
 *     never before, though a form draws every step's fields before it
 *     opens its first - and Test again tests again; Connect saves it for
 *     the server to name, and says it is new;
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

const ROLE_ARN: string =
  "arn:aws:iam::123456789012:role/OneUptimeReadOnly-01234567";

// A Google Cloud key, as `gcloud iam service-accounts keys create` writes it.
const GCP_KEY: JSONObject = {
  type: "service_account",
  project_id: "acme-prod",
  private_key_id: "3f2a9c",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----\n",
  client_email: "oneuptime-read-only@acme-prod.iam.gserviceaccount.com",
  client_id: "1234567890",
};

// Everything Google Cloud Shell prints for the setup command: gcloud's lines, then the key.
const GCP_OUTPUT: string = [
  "Your active configuration is: [cloudshell-12345]",
  'Operation "operations/acat.p2-1234567890-abcd" finished successfully.',
  "Created service account [oneuptime-read-only].",
  "Updated IAM policy for project [acme-prod].",
  "created key [3f2a9c] of type [json] as [oneuptime-key.json] for [oneuptime-read-only@acme-prod.iam.gserviceaccount.com]",
  JSON.stringify(GCP_KEY, null, 2),
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
    // One way in: no sign-in method to choose - only what to read.
    expect(
      within(modal()).queryByTestId("cloud-connection-method"),
    ).not.toBeInTheDocument();
    expect(within(modal()).queryAllByRole("radio")).toHaveLength(2);
    expect(
      within(modal()).getByRole("radio", { name: /^This subscription/ }),
    ).toBeChecked();
    expect(
      within(modal()).getByRole("radio", {
        name: /^Every subscription in the tenant/,
      }),
    ).not.toBeChecked();
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

describe("what to read: one account or the organization", () => {
  function scopeRadio(name: RegExp): HTMLElement {
    return within(modal()).getByRole("radio", { name });
  }

  test("Azure: one subscription first; the tenant's every subscription changes the command", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();

    expect(scopeRadio(/^This subscription/)).toBeChecked();
    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).not.toHaveTextContent("managementGroups");

    await act(async () => {
      fireEvent.click(scopeRadio(/^Every subscription in the tenant/));
    });

    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("Microsoft.Management/managementGroups");
  });

  test("Google Cloud: the organization's every project, with the roles on the organization", async () => {
    await openForm({ provider: CloudProvider.GCP });
    await stepTitles();

    await act(async () => {
      fireEvent.click(scopeRadio(/^Every project in the organization/));
    });

    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("gcloud organizations add-iam-policy-binding");
  });

  test("AWS: an organization through a role only - the choice goes with the access key", async () => {
    await openForm({ provider: CloudProvider.AWS, awsRoleSetup: ROLE_SETUP });
    await stepTitles();

    await act(async () => {
      fireEvent.click(scopeRadio(/^Every account in the organization/));
    });

    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("aws cloudformation create-stack-set");

    await act(async () => {
      fireEvent.click(
        within(modal()).getByRole("radio", { name: /Access key/ }),
      );
    });

    // An access key's user cannot sign in to the other accounts' roles.
    expect(
      within(modal()).queryByRole("radio", { name: /^This account/ }),
    ).not.toBeInTheDocument();
    expect(
      within(modal()).getByTestId("cloud-setup-command-code"),
    ).toHaveTextContent("aws iam create-access-key");
  });

  test("the organization picked is what is tested and saved", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();

    await act(async () => {
      fireEvent.click(scopeRadio(/^Every subscription in the tenant/));
    });

    await next();
    await paste(AZURE_OUTPUT);
    await next();

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(1);
    });

    expect(postSpy.mock.calls[0]![0].data.config).toMatchObject({
      readScope: "organization",
    });
  });

  test("it is asked on the first step only: the values pasted are not where it is", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();

    // The fold of values under the paste holds the values, not the scope.
    expect(within(modal()).queryAllByRole("radio")).toHaveLength(0);
    expect(
      within(modal()).queryByText("Client secret expires"),
    ).not.toBeInTheDocument();
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

describe("every cloud, one paste", () => {
  // The Test step tests by itself as it opens.
  async function pressTest(): Promise<void> {
    await within(modal()).findByTestId("cloud-connection-test-pass");
    expect(postSpy).toHaveBeenCalledTimes(1);
  }

  test("the paste is the step's question: no (Optional) on it", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();

    const label: HTMLElement = within(modal()).getByText(
      "What the command printed",
    );

    expect(label.closest("label") || label.parentElement).not.toHaveTextContent(
      "(Optional)",
    );
  });

  test("AWS with a role: the role's ARN is pasted like any other output, and tested", async () => {
    await openForm({ provider: CloudProvider.AWS, awsRoleSetup: ROLE_SETUP });
    await stepTitles();
    await next();

    await paste(`${ROLE_ARN}\n`);

    expect(
      await within(modal()).findByTestId("cloud-connection-paste-found"),
    ).toHaveTextContent("Found: Role ARN");

    await next();
    await pressTest();

    const request: { data: JSONObject } = postSpy.mock.calls[0]![0];

    expect(request.data).toEqual({
      provider: CloudProvider.AWS,
      config: {
        authMethod: CloudConnectionAuthMethod.AwsRole,
        roleArn: ROLE_ARN,
        dataSecurity: "off",
        dataSecurityResponse: "off",
        readIntervalInMinutes: "10",
        readScope: "account",
      },
      secrets: {},
    });
  });

  test("Google Cloud: everything Cloud Shell printed - gcloud's lines and the key - is one paste, and the key is sent clean", async () => {
    await openForm({ provider: CloudProvider.GCP });
    await stepTitles();
    await next();

    await paste(GCP_OUTPUT);

    expect(
      await within(modal()).findByTestId("cloud-connection-paste-found"),
    ).toHaveTextContent("Found: Service account key (JSON)");

    // gcloud's own lines do not stop the step.
    await next();
    await pressTest();

    const request: { data: JSONObject } = postSpy.mock.calls[0]![0];
    const secrets: JSONObject = request.data["secrets"] as JSONObject;

    expect(request.data["provider"]).toBe(CloudProvider.GCP);
    expect(
      JSON.parse(secrets["serviceAccountJson"] as string) as JSONObject,
    ).toEqual(GCP_KEY);
  });

  test("a paste fills the values in without opening them: their names say what was found", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();

    const fold: HTMLElement = within(modal()).getByRole("button", {
      name: "Enter the values yourself",
    });

    expect(fold).toHaveAttribute("aria-expanded", "false");

    await paste(AZURE_OUTPUT);

    await within(modal()).findByTestId("cloud-connection-paste-found");
    expect(fold).toHaveAttribute("aria-expanded", "false");

    const items: Array<string> = within(modal())
      .getAllByTestId("folded-section-item")
      .map((item: HTMLElement): string => {
        return item.textContent || "";
      });

    expect(items.join(" | ")).toContain("Directory (tenant) ID");
    expect(items.join(" | ")).toContain("Client secret");
    // A secret is named, never shown.
    expect(items.join(" | ")).not.toContain(PASSWORD);
  });
});

describe("why the step cannot go on, said once", () => {
  async function errorsOnTheStep(): Promise<Array<string>> {
    return within(modal())
      .queryAllByTestId("error-message")
      .map((element: HTMLElement): string => {
        return (element.textContent || "").trim();
      })
      .filter((text: string): boolean => {
        return Boolean(text);
      });
  }

  test("nothing pasted: one sentence on the paste, the values stay folded", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();
    await next();

    // Still on Credentials: the step did not go on.
    expect(
      within(modal()).getByText("What the command printed"),
    ).toBeInTheDocument();
    expect(await errorsOnTheStep()).toEqual([
      "Paste everything the command printed.",
    ]);
    expect(
      within(modal()).getByRole("button", {
        name: "Enter the values yourself",
      }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(modal()).not.toHaveTextContent("is required");
  });

  test("a paste that holds none of the values says so once - not twice", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();
    await paste("az: command not found");
    await next();

    expect(await errorsOnTheStep()).toEqual([
      "Nothing OneUptime needs is in this yet. Copy everything the command printed.",
    ]);
    // The amber line under the paste gives way to the error.
    expect(
      within(modal()).queryByTestId("cloud-connection-paste-nothing"),
    ).not.toBeInTheDocument();
  });

  test("a value still missing is named", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();
    await paste(
      ["{", `  "appId": "${APP}",`, `  "tenant": "${TENANT}"`, "}"].join("\n"),
    );
    await next();

    expect(await errorsOnTheStep()).toEqual([
      "Still missing: Client secret. Paste everything the command printed, or enter the values below.",
    ]);
    // What it did find is still said.
    expect(
      within(modal()).getByTestId("cloud-connection-paste-found"),
    ).toHaveTextContent(
      "Found: Directory (tenant) ID, Application (client) ID",
    );
  });
});

describe("testing and connecting", () => {
  test("nothing is tested before the Test step opens", async () => {
    await openForm({ provider: CloudProvider.Azure });
    await stepTitles();
    await next();
    await paste(AZURE_OUTPUT);

    expect(postSpy).not.toHaveBeenCalled();
  });

  test("the Test step tests what was pasted by itself; Test again tests again; Connect saves it for the server to name", async () => {
    const onSaved: MockFunction = getJestMockFunction();

    await openForm({ provider: CloudProvider.Azure, onSaved });
    await stepTitles();
    await next();
    await paste(AZURE_OUTPUT);
    await next();

    // Nothing to press: the step tests as it opens.
    expect(
      await within(modal()).findByTestId("cloud-connection-test-pass"),
    ).toBeInTheDocument();
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(
      within(modal()).getByTestId("cloud-connection-test-button"),
    ).toHaveTextContent("Test again");

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
        dataSecurity: "off",
        dataSecurityResponse: "off",
        readIntervalInMinutes: "5",
        readScope: "account",
      },
      secrets: { clientSecret: PASSWORD },
    });

    await act(async () => {
      fireEvent.click(
        within(modal()).getByTestId("cloud-connection-test-button"),
      );
    });

    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledTimes(2);
    });
    expect(postSpy.mock.calls[1]![0].data).toEqual(request.data);

    await act(async () => {
      fireEvent.click(
        within(modal()).getByTestId("modal-footer-submit-button"),
      );
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

    expect(
      within(modal()).getByPlaceholderText("Unchanged"),
    ).toBeInTheDocument();

    await next();

    // The Test step tests the saved connection, with what the form changed, by itself.
    await within(modal()).findByTestId("cloud-connection-test-pass");
    // An edit is kept by Save changes, not by Connect.
    expect(
      within(modal()).getByTestId("cloud-connection-test-panel"),
    ).toHaveTextContent("Nothing changes until you save.");
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].data).toMatchObject({
      connectionId: connection._id,
      config: { tenantId: TENANT, clientId: APP },
      secrets: {},
    });

    await act(async () => {
      fireEvent.click(
        within(modal()).getByTestId("modal-footer-submit-button"),
      );
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
