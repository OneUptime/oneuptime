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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import { Mock } from "jest-mock";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { INLINE_TEST_SETTINGS_CHANGED_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectionTestModal";
import SecurityEventConnectionFormModal, {
  CONNECTION_TEST_CHOOSE_PROVIDER_MESSAGE,
  configFieldName,
  connectionTestDisabledReason,
  connectionTestNeedsSecretsMessage,
  fieldTypeFor,
  readSecurityEventConnectionForm,
  removeSecretFieldName,
  secretFieldName,
  secretFieldTypeFor,
  securityEventConnectionTestBody,
  securityEventConnectionUpdatePayload,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionFormModal";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HashedString from "../../../Types/HashedString";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { GOOGLE_SECOPS_SUPPORTED_REGIONS } from "../../../Types/SecurityEvent/GoogleSecOpsRegion";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

// The modal's onClose and onSaved props, recorded by jest.fn().
type CallbackMock = Mock<() => void>;

/*
 * The form is generated from the connector catalog, so the things worth
 * pinning are the seams: which fields a provider choice reveals, what the
 * submit sends for create and edit (secrets omitted when blank), and the
 * body "Test these settings" posts before anything is saved. The real
 * BasicFormModal, BasicForm and CardSelect are exercised; only transport,
 * the project id and Monaco's browser-only editor are replaced.
 */

/*
 * A JSON field renders Monaco, which cannot run in jsdom. The stand-in is a
 * textarea wired to the same props, so the form's own label, value,
 * placeholder and JSON syntax validation are still the real ones.
 */
jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      return (
        <>
          <textarea
            aria-labelledby={props.ariaLabelledby}
            placeholder={props.placeholder}
            value={props.value ?? props.initialValue ?? ""}
            onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
              props.onChange?.(event.target.value);
            }}
            onBlur={props.onBlur}
          />
          {props.error && <span role="alert">{props.error}</span>}
        </>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const OKTA_ORG_URL: string = "https://acme.okta.com";
const OKTA_TOKEN: string = "00abcDEFghiJKLmnoPQRstuVWXyz-synthetic";
const AWS_TEMPORARY_KEY_ID: string = "ASIASYNTHETIC0000001";
const AWS_LONG_LIVED_KEY_ID: string = "AKIASYNTHETIC0000002";
const AWS_SECRET: string = "aws-secret-access-key-synthetic";

const GOOGLE: string = SecurityEventConnectorProvider.GoogleSecOps;
const GOOGLE_REGION: string = "europe";
const GOOGLE_INSTANCE: string =
  "projects/acme/locations/europe/instances/chronicle";
/*
 * Google's published endpoint prefixes, pinned independently of the shared
 * constant so a truncated or broadened list in that source of truth fails.
 */
const EXPECTED_GOOGLE_REGIONS: Array<string> = [
  "us",
  "eu",
  "europe",
  "africa-south1",
  "asia-east1",
  "asia-northeast1",
  "asia-northeast3",
  "asia-south1",
  "asia-southeast1",
  "asia-southeast2",
  "australia-southeast1",
  "europe-central2",
  "europe-west12",
  "europe-west2",
  "europe-west3",
  "europe-west6",
  "europe-west9",
  "me-central1",
  "me-central2",
  "me-west1",
  "northamerica-northeast2",
  "southamerica-east1",
];
/*
 * A pasted key as Google downloads it: pretty-printed across lines, a
 * private key whose \n escapes are two literal characters, and the trailing
 * newline a copy from a file usually carries. Every byte must reach the
 * secrets blob.
 */
const GOOGLE_KEY: string = `${JSON.stringify(
  {
    type: "service_account",
    client_email: "secops-reader@acme.example",
    private_key:
      "-----BEGIN PRIVATE KEY-----\\nsynthetic-key-material\\n-----END PRIVATE KEY-----\\n",
  },
  null,
  2,
)}\n`;
const GOOGLE_NEEDS_KEY_MESSAGE: string =
  "Paste the Service account JSON to test these settings before saving. A saved connection can be tested from its row's Test connection action.";

function report(): SecurityConnectorTestReport {
  return {
    provider: "okta",
    status: "pass",
    startedAt: "2026-09-10T12:00:00.000Z",
    completedAt: "2026-09-10T12:00:01.000Z",
    durationMs: 1000,
    summary: "Okta is reachable.",
    checks: [
      {
        key: "authentication",
        name: "Authenticate with Okta",
        status: "pass",
        durationMs: 300,
        message: "The API token was accepted.",
      },
    ],
  };
}

function oktaConnection(): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Acme Okta";
  connection.provider = SecurityEventConnectorProvider.OktaSystemLog;
  connection.config = { orgUrl: OKTA_ORG_URL, filter: 'eventType sw "user"' };
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 10;
  connection.alertingOnly = true;
  return connection;
}

/*
 * Created with temporary STS credentials, so a session token is stored.
 * The optional-secret-cannot-be-cleared scenario starts here.
 */
function awsConnection(): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Org Security Hub";
  connection.provider = SecurityEventConnectorProvider.AwsSecurityHub;
  connection.config = {
    region: "us-east-1",
    accessKeyId: AWS_TEMPORARY_KEY_ID,
  };
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 5;
  connection.alertingOnly = true;
  return connection;
}

function splunkConnection(): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Splunk ES";
  connection.provider = SecurityEventConnectorProvider.SplunkEnterpriseSecurity;
  connection.config = {
    url: "https://splunk.example.com:8089",
    searchString: "index=notable",
  };
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 5;
  connection.alertingOnly = true;
  return connection;
}

// A connection carried over from the retired SecOps page with Detections on.
function googleConnection(
  alertingOnly: boolean = false,
): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Customer SecOps";
  connection.provider = SecurityEventConnectorProvider.GoogleSecOps;
  connection.config = {
    region: GOOGLE_REGION,
    instanceResourceName: GOOGLE_INSTANCE,
  };
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 5;
  connection.alertingOnly = alertingOnly;
  return connection;
}

function removeToggles(): Array<HTMLElement> {
  return screen.queryAllByRole("switch", { name: /^Remove the stored/ });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

function footerButton(name: string): HTMLElement {
  return within(dialog()).getByRole("button", { name });
}

async function next(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(footerButton("Next"));
  });
}

async function goToStep(title: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(progress()).getByText(title));
  });
  await waitFor((): void => {
    expect(activeStep()).toBe(title);
  });
}

function fill(label: RegExp, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function chooseProvider(title: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("radio", { name: new RegExp(title) }));
  });
  await waitFor((): void => {
    expect(
      screen.getByRole("radio", { name: new RegExp(title) }),
    ).toHaveAttribute("aria-checked", "true");
  });
}

async function renderModal(
  props: {
    connection?: SecurityEventConnection;
    credentialsOnly?: boolean;
  } = {},
): Promise<{ onClose: CallbackMock; onSaved: CallbackMock }> {
  const onClose: CallbackMock = jest.fn<() => void>();
  const onSaved: CallbackMock = jest.fn<() => void>();
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <SecurityEventConnectionFormModal
          connection={props.connection}
          credentialsOnly={props.credentialsOnly}
          onClose={onClose}
          onSaved={onSaved}
        />
      </MemoryRouter>,
    );
  });
  await waitFor((): void => {
    expect(dialog()).toBeVisible();
  });
  return { onClose, onSaved };
}

function regionCombobox(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Region/ });
}

function serviceAccountEditor(): HTMLElement {
  return screen.getByRole("textbox", { name: /^Service account JSON/ });
}

function alertsCheckbox(): HTMLElement {
  return screen.getByRole("checkbox", { name: "Alerts" });
}

function detectionsCheckbox(): HTMLElement {
  return screen.getByRole("checkbox", { name: "Detections" });
}

function testButton(): HTMLElement {
  return screen.getByRole("button", { name: "Test these settings" });
}

function lastPostBody(): JSONObject {
  const calls: Array<Array<unknown>> = jest.mocked(API.post).mock.calls;
  return (calls[calls.length - 1]?.[0] as unknown as JSONObject)[
    "data"
  ] as JSONObject;
}

function mockTransport(): void {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(ModelAPI, "getCommonHeaders")
    .mockReturnValue({ "project-id": PROJECT_ID.toString() });
  jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue(new HTTPResponse(200, {}, {}));
  jest
    .spyOn(ModelAPI, "updateById")
    .mockResolvedValue(new HTTPResponse(200, {}, {}));
  jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse(200, report() as unknown as JSONObject, {}),
    );
}

describe("SecurityEventConnectionFormModal (create)", () => {
  beforeEach((): void => {
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("starts on the Provider step with every catalog provider grouped by category", async (): Promise<void> => {
    await renderModal();

    expect(activeStep()).toBe("Provider");
    expect(
      within(progress())
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Provider", "Connection", "Credentials", "Polling"]);
    expect(footerButton("Next")).toBeVisible();
    expect(
      within(dialog()).queryByRole("button", { name: "Create connection" }),
    ).not.toBeInTheDocument();

    const group: HTMLElement = screen.getByRole("radiogroup");
    for (const title of [
      "Microsoft Sentinel",
      "Microsoft Defender XDR",
      "CrowdStrike Falcon",
      "Splunk Enterprise Security",
      "Elastic Security",
      "AWS Security Hub",
      "Okta System Log",
      "Google SecOps",
    ]) {
      expect(
        within(group).getByRole("radio", { name: new RegExp(title) }),
      ).toBeVisible();
    }
    for (const category of [
      "SIEM",
      "EDR / XDR",
      "Cloud security",
      "Identity",
    ]) {
      expect(group).toHaveTextContent(category);
    }
    expect(ModelAPI.create).not.toHaveBeenCalled();
  });

  test("a provider must be chosen before moving on", async (): Promise<void> => {
    await renderModal();
    await next();

    expect(activeStep()).toBe("Provider");
    expect(await screen.findByText("Provider is required.")).toBeVisible();
  });

  test("switching providers swaps the connection fields and their setup guide", async (): Promise<void> => {
    await renderModal();

    await chooseProvider("Microsoft Sentinel");
    await next();
    expect(activeStep()).toBe("Connection");
    expect(screen.getByLabelText(/^Directory \(tenant\) ID/)).toBeVisible();
    expect(screen.getByLabelText(/^Workspace name/)).toBeVisible();
    expect(screen.getByText("Microsoft Sentinel settings")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Microsoft Sentinel setup guide/ }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/\/integrations\/microsoft-sentinel$/),
    );
    expect(
      screen.queryByLabelText(/^Okta organization URL/),
    ).not.toBeInTheDocument();

    await goToStep("Provider");
    await chooseProvider("Okta System Log");
    await next();

    expect(activeStep()).toBe("Connection");
    expect(screen.getByLabelText(/^Okta organization URL/)).toBeVisible();
    expect(screen.getByLabelText(/^Event filter/)).toBeVisible();
    expect(
      screen.queryByLabelText(/^Directory \(tenant\) ID/),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Workspace name/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Okta System Log setup guide/ }),
    ).toHaveAttribute("href", expect.stringMatching(/\/integrations\/okta$/));
  });

  test("required connection and credential fields block the next step by title", async (): Promise<void> => {
    await renderModal();
    await chooseProvider("Okta System Log");
    await next();
    await next();

    expect(activeStep()).toBe("Connection");
    expect(
      await screen.findByText("Okta organization URL is required."),
    ).toBeVisible();
    // Optional fields never block.
    expect(
      screen.queryByText("Event filter is required."),
    ).not.toBeInTheDocument();

    fill(/^Okta organization URL/, OKTA_ORG_URL);
    await next();
    expect(activeStep()).toBe("Credentials");
    await next();
    expect(activeStep()).toBe("Credentials");
    expect(await screen.findByText("API token is required.")).toBeVisible();
    expect(ModelAPI.create).not.toHaveBeenCalled();
    expect(API.post).not.toHaveBeenCalled();
  });

  test("Test these settings waits for a required credential on create and says which one", async (): Promise<void> => {
    await renderModal();
    await chooseProvider("Okta System Log");
    await next();
    fill(/^Okta organization URL/, OKTA_ORG_URL);
    await next();
    expect(activeStep()).toBe("Credentials");

    expect(testButton()).toBeDisabled();
    expect(
      screen.getByText(
        "Enter the API token to test these settings before saving. A saved connection can be tested from its row's Test connection action.",
      ),
    ).toBeVisible();
    fireEvent.click(testButton());
    expect(API.post).not.toHaveBeenCalled();

    // Whitespace is not a credential.
    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByLabelText(/^API token/), {
        target: { value: "   " },
      });
    });
    expect(testButton()).toBeDisabled();

    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByLabelText(/^API token/), {
        target: { value: OKTA_TOKEN },
      });
    });
    expect(testButton()).toBeEnabled();
    expect(
      screen.queryByText(/to test these settings before saving/),
    ).not.toBeInTheDocument();
  });

  test("Test these settings posts the unsaved provider, config and secrets without saving", async (): Promise<void> => {
    await renderModal();
    await chooseProvider("Okta System Log");
    await next();
    fill(/^Okta organization URL/, OKTA_ORG_URL);
    await next();
    expect(activeStep()).toBe("Credentials");

    const tokenInput: HTMLElement = screen.getByLabelText(/^API token/);
    expect(tokenInput).toHaveAttribute("type", "password");
    fireEvent.change(tokenInput, { target: { value: OKTA_TOKEN } });

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });

    expect(await screen.findByText("All checks passed")).toBeVisible();
    expect(API.post).toHaveBeenCalledTimes(1);
    const call: JSONObject = jest.mocked(API.post).mock
      .calls[0]?.[0] as unknown as JSONObject;
    expect(call["data"]).toEqual({
      provider: "okta",
      config: { orgUrl: OKTA_ORG_URL },
      secrets: { apiToken: OKTA_TOKEN },
      alertingOnly: true,
    });
    expect(call["headers"]).toEqual({ "project-id": PROJECT_ID.toString() });
    expect(new globalThis.URL(String(call["url"])).pathname).toMatch(
      /\/security-event-connection\/test$/,
    );
    expect(ModelAPI.create).not.toHaveBeenCalled();
    expect(ModelAPI.updateById).not.toHaveBeenCalled();
  });

  test("editing a tested credential hides the earlier report until it is tested again", async (): Promise<void> => {
    await renderModal();
    await chooseProvider("Okta System Log");
    await next();
    fill(/^Okta organization URL/, OKTA_ORG_URL);
    await next();
    fireEvent.change(screen.getByLabelText(/^API token/), {
      target: { value: OKTA_TOKEN },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();

    /*
     * stale-report-after-failed-rerun: a green report for token A must not
     * stay next to token B.
     */
    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByLabelText(/^API token/), {
        target: { value: `${OKTA_TOKEN}-replaced` },
      });
    });
    expect(screen.queryByText("All checks passed")).not.toBeInTheDocument();
    expect(
      screen.getByText(INLINE_TEST_SETTINGS_CHANGED_MESSAGE),
    ).toBeVisible();

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();
    expect(API.post).toHaveBeenCalledTimes(2);
    const call: JSONObject = jest.mocked(API.post).mock
      .calls[1]?.[0] as unknown as JSONObject;
    expect(call["data"]).toEqual({
      provider: "okta",
      config: { orgUrl: OKTA_ORG_URL },
      secrets: { apiToken: `${OKTA_TOKEN}-replaced` },
      alertingOnly: true,
    });
  });

  test("the create form never offers to remove a stored credential", async (): Promise<void> => {
    await renderModal();
    await chooseProvider("AWS Security Hub");
    await next();
    fill(/^Region/, "us-east-1");
    fill(/^Access key ID/, AWS_LONG_LIVED_KEY_ID);
    await next();

    expect(activeStep()).toBe("Credentials");
    expect(screen.getByLabelText(/^Session token/)).toBeVisible();
    expect(removeToggles()).toHaveLength(0);
  });

  test("a rejected test shows the server's message inline and the form stays editable", async (): Promise<void> => {
    jest
      .mocked(API.post)
      .mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { message: "Configuration: orgUrl must be an https URL." },
          {},
        ),
      );
    await renderModal();
    await chooseProvider("Okta System Log");
    await next();
    fill(/^Okta organization URL/, OKTA_ORG_URL);
    await next();
    fireEvent.change(screen.getByLabelText(/^API token/), {
      target: { value: OKTA_TOKEN },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });

    expect(
      await screen.findByText("Configuration: orgUrl must be an https URL."),
    ).toBeVisible();
    expect(screen.getByLabelText(/^API token/)).toHaveValue(OKTA_TOKEN);
    expect(testButton()).toBeEnabled();
  });

  test("creates the model with the provider's config, a secrets JSON string and the polling defaults", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal();
    await chooseProvider("Microsoft Sentinel");
    await next();
    fill(/^Directory \(tenant\) ID/, "tenant-guid");
    fill(/^Application \(client\) ID/, "client-guid");
    fill(/^Subscription ID/, "sub-guid");
    fill(/^Resource group/, "rg-security");
    fill(/^Workspace name/, "sentinel-ws");
    await next();
    expect(activeStep()).toBe("Credentials");
    fireEvent.change(screen.getByLabelText(/^Client secret/), {
      target: { value: "entra-secret-synthetic" },
    });
    await next();
    expect(activeStep()).toBe("Polling");

    expect(
      screen.getByRole("spinbutton", { name: /^Poll Interval/ }),
    ).toHaveValue(5);
    expect(screen.getByRole("switch", { name: /^Enabled/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Sentinel has no alerting-only distinction, so neither control shows.
    expect(
      screen.queryByRole("switch", { name: /^Alerts only/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "Data to import" }),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });
    expect(await screen.findByText("Name is required.")).toBeVisible();
    expect(ModelAPI.create).not.toHaveBeenCalled();

    fill(/^Name/, "Production Sentinel");
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });

    await waitFor((): void => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });
    const created: { model: SecurityEventConnection } = jest.mocked(
      ModelAPI.create,
    ).mock.calls[0]?.[0] as { model: SecurityEventConnection };
    expect(created.model.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created.model.name).toBe("Production Sentinel");
    expect(created.model.provider).toBe("microsoft-sentinel");
    expect(created.model.config).toEqual({
      tenantId: "tenant-guid",
      clientId: "client-guid",
      subscriptionId: "sub-guid",
      resourceGroup: "rg-security",
      workspaceName: "sentinel-ws",
      cloud: "public",
    });
    expect(JSON.parse(created.model.secrets || "{}")).toEqual({
      clientSecret: "entra-secret-synthetic",
    });
    expect(created.model.isEnabled).toBe(true);
    expect(created.model.pollIntervalInMinutes).toBe(5);
    expect(created.model.alertingOnly).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("a failed save reports the server message and does not close", async (): Promise<void> => {
    jest
      .mocked(ModelAPI.create)
      .mockRejectedValue(
        new HTTPErrorResponse(
          400,
          { message: "Credentials: apiToken is required for Okta System Log." },
          {},
        ),
      );
    const { onSaved }: { onSaved: CallbackMock } = await renderModal();
    await chooseProvider("Okta System Log");
    await next();
    fill(/^Okta organization URL/, OKTA_ORG_URL);
    await next();
    fireEvent.change(screen.getByLabelText(/^API token/), {
      target: { value: OKTA_TOKEN },
    });
    await next();
    fill(/^Name/, "Acme Okta");
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });

    /*
     * BasicFormModal renders the error itself and also passes it to Modal,
     * so the message appears twice; either instance proves the point.
     */
    expect(
      (
        await screen.findAllByText(
          "Credentials: apiToken is required for Okta System Log.",
        )
      )[0],
    ).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    expect(dialog()).toBeVisible();
  });
});

describe("SecurityEventConnectionFormModal (edit and credentials)", () => {
  beforeEach((): void => {
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("editing locks the provider, prefills config and treats blank secrets as unchanged", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: oktaConnection(),
    });

    expect(
      screen.getByRole("dialog", { name: "Edit connection: Acme Okta" }),
    ).toBeVisible();
    expect(
      within(progress())
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Connection", "Credentials", "Polling"]);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^Okta organization URL/)).toHaveValue(
      OKTA_ORG_URL,
    );
    expect(screen.getByLabelText(/^Event filter/)).toHaveValue(
      'eventType sw "user"',
    );

    await next();
    expect(activeStep()).toBe("Credentials");
    const token: HTMLElement = screen.getByLabelText(/^API token/);
    expect(token).toHaveAttribute("placeholder", "Unchanged");
    expect(token).toHaveValue("");
    expect(
      screen.getByText(/Leave blank to keep the stored value\./),
    ).toBeVisible();
    // A saved connection tests with its stored token, so nothing is missing.
    expect(testButton()).toBeEnabled();

    // Blank credentials do not block the step on edit.
    await next();
    expect(activeStep()).toBe("Polling");
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Acme Okta");
    expect(
      screen.getByRole("spinbutton", { name: /^Poll Interval/ }),
    ).toHaveValue(10);
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /^Poll Interval/ }),
      {
        target: { value: "15" },
      },
    );

    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });

    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { id: ObjectID; data: JSONObject } = jest.mocked(
      ModelAPI.updateById,
    ).mock.calls[0]?.[0] as { id: ObjectID; data: JSONObject };
    expect(update.id.toString()).toBe(CONNECTION_ID);
    expect(update.data).toEqual({
      name: "Acme Okta",
      description: "",
      config: { orgUrl: OKTA_ORG_URL, filter: 'eventType sw "user"' },
      isEnabled: true,
      pollIntervalInMinutes: 15,
      alertingOnly: true,
    });
    expect(update.data).not.toHaveProperty("secrets");
    expect(ModelAPI.create).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("Test these settings on edit sends the connection id with the unsaved edits and the scope", async (): Promise<void> => {
    await renderModal({ connection: oktaConnection() });
    fill(/^Event filter/, 'eventType sw "security"');
    await next();

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });

    expect(await screen.findByText("All checks passed")).toBeVisible();
    const call: JSONObject = jest.mocked(API.post).mock
      .calls[0]?.[0] as unknown as JSONObject;
    expect(call["data"]).toEqual({
      connectionId: CONNECTION_ID,
      config: { orgUrl: OKTA_ORG_URL, filter: 'eventType sw "security"' },
      secrets: {},
      alertingOnly: true,
    });
  });

  test("Update credentials shows only the credential step and sends just the new secrets", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: oktaConnection(),
      credentialsOnly: true,
    });

    expect(
      screen.getByRole("dialog", { name: "Update credentials: Acme Okta" }),
    ).toBeVisible();
    expect(
      within(progress())
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Credentials"]);
    expect(
      screen.queryByLabelText(/^Okta organization URL/),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Update credentials"));
    });
    expect(
      (
        await screen.findAllByText(/Enter at least one credential to update/)
      )[0],
    ).toBeVisible();
    expect(ModelAPI.updateById).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^API token/), {
      target: { value: OKTA_TOKEN },
    });
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Update credentials"));
    });

    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data).toEqual({
      secrets: JSON.stringify({ apiToken: OKTA_TOKEN }),
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  /*
   * optional-secret-cannot-be-cleared: switching AWS from temporary to a
   * long-lived key left the stale session token merged back in, so every
   * request failed. The Remove toggle sends null, which deletes the key.
   */
  test("an optional secret gets a Remove toggle on edit that tests and saves it as null", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: awsConnection(),
    });

    fill(/^Access key ID/, AWS_LONG_LIVED_KEY_ID);
    await next();
    expect(activeStep()).toBe("Credentials");

    // Only the optional session token can be removed.
    expect(
      removeToggles().map((toggle: HTMLElement): string => {
        return toggle.getAttribute("aria-checked") || "";
      }),
    ).toEqual(["false"]);
    const removeToken: HTMLElement = screen.getByRole("switch", {
      name: /^Remove the stored Session token/,
    });

    fireEvent.change(screen.getByLabelText(/^Secret access key/), {
      target: { value: AWS_SECRET },
    });
    // Typed before the toggle is turned on: the toggle wins and this is ignored.
    fireEvent.change(screen.getByLabelText(/^Session token/), {
      target: { value: "typed-token-ignored" },
    });
    await act(async (): Promise<void> => {
      fireEvent.click(removeToken);
    });
    expect(removeToken).toHaveAttribute("aria-checked", "true");

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();
    const testCall: JSONObject = jest.mocked(API.post).mock
      .calls[0]?.[0] as unknown as JSONObject;
    expect(testCall["data"]).toEqual({
      connectionId: CONNECTION_ID,
      config: { region: "us-east-1", accessKeyId: AWS_LONG_LIVED_KEY_ID },
      secrets: { secretAccessKey: AWS_SECRET, sessionToken: null },
      alertingOnly: true,
    });

    await next();
    expect(activeStep()).toBe("Polling");
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });

    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data["config"]).toEqual({
      region: "us-east-1",
      accessKeyId: AWS_LONG_LIVED_KEY_ID,
    });
    expect(JSON.parse(update.data["secrets"] as string)).toEqual({
      secretAccessKey: AWS_SECRET,
      sessionToken: null,
    });
    expect(update.data["secrets"]).not.toContain("typed-token-ignored");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("a required secret has no Remove toggle", async (): Promise<void> => {
    await renderModal({ connection: oktaConnection() });
    await next();

    expect(activeStep()).toBe("Credentials");
    expect(screen.getByLabelText(/^API token/)).toBeVisible();
    expect(removeToggles()).toHaveLength(0);
  });

  test("Update credentials can remove an optional credential without entering a new one", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: splunkConnection(),
      credentialsOnly: true,
    });

    expect(dialog()).toHaveTextContent(
      "Turn on a Remove toggle to delete an optional one.",
    );
    expect(removeToggles()).toHaveLength(2);

    // Switching from a revoked token to username and password.
    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("switch", {
          name: /^Remove the stored Authentication token/,
        }),
      );
    });
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Update credentials"));
    });

    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data).toEqual({
      secrets: JSON.stringify({ apiToken: null }),
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

/*
 * Google SecOps used to have its own page, form and model. As a catalog
 * provider it has to keep everything that form guaranteed: an explicit
 * region pick from Google's list, a key edited as JSON and stored as the
 * pasted text, and "Data to import" (Alerts always, Detections optional)
 * mapped onto alertingOnly with the right polarity.
 */
describe("SecurityEventConnectionFormModal (poll interval bounds)", () => {
  /*
   * Every provider shares one Poll Interval field, bounded to whole minutes
   * from 1 to 1440. The retired Google SecOps form suite pinned those bounds
   * and nothing else did once it was deleted, so a dropped or widened
   * validation would let a connection be saved that polls never or
   * constantly. The edit form is used because it reaches the Polling step
   * without choosing a provider; the field is the same on create.
   */
  beforeEach((): void => {
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  function pollIntervalInput(): HTMLElement {
    return screen.getByRole("spinbutton", { name: /^Poll Interval/ });
  }

  async function openPollingStep(): Promise<CallbackMock> {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: oktaConnection(),
    });
    await next();
    await next();
    expect(activeStep()).toBe("Polling");
    expect(pollIntervalInput()).toHaveValue(10);
    return onSaved;
  }

  async function saveWithInterval(value: string): Promise<void> {
    fireEvent.change(pollIntervalInput(), { target: { value } });
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });
  }

  test.each([
    {
      value: "0",
      error: "Poll Interval (Minutes) should not be less than 1.",
    },
    {
      value: "1441",
      error: "Poll Interval (Minutes) should not be more than 1440.",
    },
  ])(
    "$value minutes blocks saving with the form's bound message",
    async ({ value, error }: { value: string; error: string }) => {
      const onSaved: CallbackMock = await openPollingStep();

      await saveWithInterval(value);

      expect(await screen.findByText(error)).toBeVisible();
      expect(activeStep()).toBe("Polling");
      expect(ModelAPI.updateById).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  test.each([1, 1440])(
    "%s minutes is inside the bounds and is saved",
    async (minutes: number) => {
      const onSaved: CallbackMock = await openPollingStep();

      await saveWithInterval(String(minutes));

      await waitFor((): void => {
        expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
      });
      const update: { id: ObjectID; data: JSONObject } = jest.mocked(
        ModelAPI.updateById,
      ).mock.calls[0]?.[0] as { id: ObjectID; data: JSONObject };
      expect(update.data["pollIntervalInMinutes"]).toBe(minutes);
      expect(
        screen.queryByText(/^Poll Interval \(Minutes\) should not be/),
      ).not.toBeInTheDocument();
      expect(onSaved).toHaveBeenCalledTimes(1);
    },
  );
});

describe("SecurityEventConnectionFormModal (Google SecOps)", () => {
  beforeEach((): void => {
    mockTransport();
  });

  afterEach((): void => {
    cleanup();
    jest.restoreAllMocks();
  });

  async function openGoogleConnectionStep(): Promise<UserEvent> {
    await renderModal();
    await chooseProvider("Google SecOps");
    await next();
    expect(activeStep()).toBe("Connection");
    return userEvent.setup({ delay: null });
  }

  async function selectRegion(user: UserEvent, region: string): Promise<void> {
    await user.click(regionCombobox());
    await user.click(
      await screen.findByRole("option", { name: region, exact: true }),
    );
  }

  async function reachGoogleCredentials(user: UserEvent): Promise<void> {
    await selectRegion(user, GOOGLE_REGION);
    fill(/^Instance resource name/, GOOGLE_INSTANCE);
    await next();
    expect(activeStep()).toBe("Credentials");
  }

  async function pasteKey(value: string): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.change(serviceAccountEditor(), { target: { value } });
    });
  }

  test("the region is a required pick from exactly Google's endpoint list, with nothing preselected", async (): Promise<void> => {
    const user: UserEvent = await openGoogleConnectionStep();

    expect(screen.getByText("Google SecOps settings")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Google SecOps setup guide/ }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(/\/integrations\/google-secops$/),
    );
    expect(screen.getByText("Select a region", { exact: true })).toBeVisible();
    expect(
      screen.getByPlaceholderText(
        "projects/{project}/locations/{location}/instances/{instance}",
      ),
    ).toBeVisible();

    await user.click(regionCombobox());
    const listbox: HTMLElement = await screen.findByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
    ).toEqual(EXPECTED_GOOGLE_REGIONS);
    expect([...GOOGLE_SECOPS_SUPPORTED_REGIONS]).toEqual(
      EXPECTED_GOOGLE_REGIONS,
    );
    await user.keyboard("{Escape}");

    // Nothing is preselected: leaving the step without a pick is refused.
    fill(/^Instance resource name/, GOOGLE_INSTANCE);
    await next();
    expect(await screen.findByText("Region is required.")).toBeVisible();
    expect(activeStep()).toBe("Connection");
  });

  test("typed text is not a region selection", async (): Promise<void> => {
    const user: UserEvent = await openGoogleConnectionStep();

    await user.type(regionCombobox(), "us-central1");
    expect(regionCombobox()).toHaveValue("us-central1");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    fill(/^Instance resource name/, GOOGLE_INSTANCE);
    await next();

    expect(await screen.findByText("Region is required.")).toBeVisible();
    expect(activeStep()).toBe("Connection");
    expect(API.post).not.toHaveBeenCalled();
  });

  test("the key is a JSON editor, and testing waits for it to be pasted", async (): Promise<void> => {
    const user: UserEvent = await openGoogleConnectionStep();
    await reachGoogleCredentials(user);

    const editor: HTMLElement = serviceAccountEditor();
    expect(editor.tagName).toBe("TEXTAREA");
    expect(editor).toHaveAttribute(
      "placeholder",
      '{ "client_email": "...", "private_key": "..." }',
    );
    expect(
      within(dialog()).queryByLabelText(/^Service account JSON/, {
        selector: 'input[type="password"]',
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Google SecOps credentials")).toBeVisible();

    expect(testButton()).toBeDisabled();
    expect(screen.getByText(GOOGLE_NEEDS_KEY_MESSAGE)).toBeVisible();

    await pasteKey(GOOGLE_KEY);
    expect(testButton()).toBeEnabled();
    expect(
      screen.queryByText(GOOGLE_NEEDS_KEY_MESSAGE),
    ).not.toBeInTheDocument();
  });

  test.each(["{", '{"client_email":"reader@example.com",}', "credentials"])(
    "malformed service-account JSON %j cannot leave the Credentials step",
    async (malformed: string): Promise<void> => {
      const user: UserEvent = await openGoogleConnectionStep();
      await reachGoogleCredentials(user);
      await pasteKey(malformed);
      await next();

      expect(
        (
          await screen.findAllByText(/Service account JSON is not valid JSON\./)
        )[0],
      ).toBeVisible();
      expect(activeStep()).toBe("Credentials");
      expect(ModelAPI.create).not.toHaveBeenCalled();
    },
  );

  test("Test these settings sends the scalar region and the pasted key byte for byte", async (): Promise<void> => {
    const user: UserEvent = await openGoogleConnectionStep();
    await reachGoogleCredentials(user);
    await pasteKey(GOOGLE_KEY);

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();

    const body: JSONObject = lastPostBody();
    expect(body).toEqual({
      provider: GOOGLE,
      config: { region: GOOGLE_REGION, instanceResourceName: GOOGLE_INSTANCE },
      secrets: { serviceAccountJson: GOOGLE_KEY },
      alertingOnly: true,
    });
    const secrets: JSONObject = body["secrets"] as JSONObject;
    expect(typeof secrets["serviceAccountJson"]).toBe("string");
    expect(secrets["serviceAccountJson"]).toContain("\n");
    expect((body["config"] as JSONObject)["region"]).not.toEqual({
      label: GOOGLE_REGION,
      value: GOOGLE_REGION,
    });
  });

  test("Data to import replaces the Alerts only toggle: Alerts fixed, Detections off by default", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal();
    await chooseProvider("Google SecOps");
    await next();
    const user: UserEvent = userEvent.setup({ delay: null });
    await reachGoogleCredentials(user);
    await pasteKey(GOOGLE_KEY);
    await next();
    expect(activeStep()).toBe("Polling");

    const group: HTMLElement = screen.getByRole("group", {
      name: "Data to import",
    });
    expect(group).toBeVisible();
    expect(
      screen.getByText(
        "Alerts are always imported because Google's API always returns them. Select Detections to also import rule matches that did not generate an alert.",
      ),
    ).toBeVisible();
    expect(alertsCheckbox()).toBeChecked();
    expect(alertsCheckbox()).toBeDisabled();
    expect(alertsCheckbox()).toHaveAttribute(
      "title",
      "Google's alerts API always includes alerts.",
    );
    expect(detectionsCheckbox()).not.toBeChecked();
    expect(detectionsCheckbox()).toBeEnabled();
    expect(
      screen.queryByRole("switch", { name: /^Alerts only/ }),
    ).not.toBeInTheDocument();

    // The fixed option is not an input a person can clear.
    expect(alertsCheckbox()).toHaveAttribute("readonly");

    fill(/^Name/, "Customer SecOps");
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });

    await waitFor((): void => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });
    const created: { model: SecurityEventConnection } = jest.mocked(
      ModelAPI.create,
    ).mock.calls[0]?.[0] as { model: SecurityEventConnection };
    expect(created.model.provider).toBe(GOOGLE);
    expect(created.model.alertingOnly).toBe(true);
    expect(created.model.config).toEqual({
      region: GOOGLE_REGION,
      instanceResourceName: GOOGLE_INSTANCE,
    });
    expect(typeof created.model.secrets).toBe("string");
    expect(JSON.parse(created.model.secrets as string)).toEqual({
      serviceAccountJson: GOOGLE_KEY,
    });
    expect(created.model.pollIntervalInMinutes).toBe(5);
    expect(created.model.isEnabled).toBe(true);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("selecting Detections creates the connection with alertingOnly false and keeps it across steps", async (): Promise<void> => {
    await renderModal();
    await chooseProvider("Google SecOps");
    await next();
    const user: UserEvent = userEvent.setup({ delay: null });
    await reachGoogleCredentials(user);
    await pasteKey(GOOGLE_KEY);
    await next();

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByText("Detections", { exact: true }));
    });
    expect(detectionsCheckbox()).toBeChecked();
    fill(/^Name/, "Customer SecOps");

    await goToStep("Credentials");
    expect(serviceAccountEditor()).toHaveValue(GOOGLE_KEY);
    await goToStep("Connection");
    expect(screen.getByText(GOOGLE_REGION, { exact: true })).toBeVisible();
    await next();
    await next();
    expect(activeStep()).toBe("Polling");
    expect(detectionsCheckbox()).toBeChecked();

    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });
    await waitFor((): void => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });
    const created: { model: SecurityEventConnection } = jest.mocked(
      ModelAPI.create,
    ).mock.calls[0]?.[0] as { model: SecurityEventConnection };
    expect(created.model.alertingOnly).toBe(false);
    expect(JSON.parse(created.model.secrets as string)).toEqual({
      serviceAccountJson: GOOGLE_KEY,
    });
  });

  test("editing shows the stored scope, keeps the key optional and tests the unsaved scope with the stored key", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: googleConnection(false),
    });

    expect(
      screen.getByRole("dialog", { name: "Edit connection: Customer SecOps" }),
    ).toBeVisible();
    expect(screen.getByText(GOOGLE_REGION, { exact: true })).toBeVisible();
    expect(screen.getByLabelText(/^Instance resource name/)).toHaveValue(
      GOOGLE_INSTANCE,
    );

    await next();
    expect(activeStep()).toBe("Credentials");
    expect(serviceAccountEditor()).toHaveValue("");
    expect(serviceAccountEditor()).toHaveAttribute("placeholder", "Unchanged");
    expect(
      screen.getByText(/Leave blank to keep the stored value\./),
    ).toBeVisible();
    expect(removeToggles()).toHaveLength(0);
    expect(testButton()).toBeEnabled();

    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();
    expect(lastPostBody()).toEqual({
      connectionId: CONNECTION_ID,
      config: { region: GOOGLE_REGION, instanceResourceName: GOOGLE_INSTANCE },
      secrets: {},
      alertingOnly: false,
    });

    // A blank key does not block the step on edit.
    await next();
    expect(activeStep()).toBe("Polling");
    expect(detectionsCheckbox()).toBeChecked();
    await act(async (): Promise<void> => {
      fireEvent.click(detectionsCheckbox());
    });
    expect(detectionsCheckbox()).not.toBeChecked();

    // The unsaved scope change is what the next test runs with.
    await goToStep("Credentials");
    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    await waitFor((): void => {
      expect(API.post).toHaveBeenCalledTimes(2);
    });
    expect(lastPostBody()).toEqual({
      connectionId: CONNECTION_ID,
      config: { region: GOOGLE_REGION, instanceResourceName: GOOGLE_INSTANCE },
      secrets: {},
      alertingOnly: true,
    });

    await next();
    expect(activeStep()).toBe("Polling");
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });
    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data).toEqual({
      name: "Customer SecOps",
      description: "",
      config: { region: GOOGLE_REGION, instanceResourceName: GOOGLE_INSTANCE },
      isEnabled: true,
      pollIntervalInMinutes: 5,
      alertingOnly: true,
    });
    expect(update.data).not.toHaveProperty("secrets");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test("an alerts-only connection opens with Detections cleared, and checking it saves alertingOnly false", async (): Promise<void> => {
    await renderModal({ connection: googleConnection(true) });
    await next();
    await next();
    expect(activeStep()).toBe("Polling");
    expect(alertsCheckbox()).toBeChecked();
    expect(detectionsCheckbox()).not.toBeChecked();

    await act(async (): Promise<void> => {
      fireEvent.click(detectionsCheckbox());
    });
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });
    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data["alertingOnly"]).toBe(false);
  });

  test("editing with a new key sends it as the pasted string, newlines intact", async (): Promise<void> => {
    await renderModal({ connection: googleConnection(true) });
    await next();
    await pasteKey(GOOGLE_KEY);
    await next();
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });
    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(JSON.parse(update.data["secrets"] as string)).toEqual({
      serviceAccountJson: GOOGLE_KEY,
    });
  });

  test("Update credentials rotates the key in a JSON editor and sends only the new key string", async (): Promise<void> => {
    const { onSaved }: { onSaved: CallbackMock } = await renderModal({
      connection: googleConnection(true),
      credentialsOnly: true,
    });

    expect(
      screen.getByRole("dialog", {
        name: "Update credentials: Customer SecOps",
      }),
    ).toBeVisible();
    expect(
      within(progress())
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Credentials"]);
    expect(serviceAccountEditor().tagName).toBe("TEXTAREA");
    expect(
      screen.queryByRole("group", { name: "Data to import" }),
    ).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Update credentials"));
    });
    expect(
      (
        await screen.findAllByText(/Enter at least one credential to update/)
      )[0],
    ).toBeVisible();

    await pasteKey(GOOGLE_KEY);
    await act(async (): Promise<void> => {
      fireEvent.click(testButton());
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();
    expect(lastPostBody()).toEqual({
      connectionId: CONNECTION_ID,
      secrets: { serviceAccountJson: GOOGLE_KEY },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Update credentials"));
    });
    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data).toEqual({
      secrets: JSON.stringify({ serviceAccountJson: GOOGLE_KEY }),
    });
    expect(
      JSON.parse(update.data["secrets"] as string)["serviceAccountJson"],
    ).toBe(GOOGLE_KEY);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});

describe("form value mapping", () => {
  const okta: string = SecurityEventConnectorProvider.OktaSystemLog;
  const aws: string = SecurityEventConnectorProvider.AwsSecurityHub;

  test("strips the provider namespace, drops blanks and unwraps hashed passwords", (): void => {
    const submission: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: okta,
        name: "  Acme Okta ",
        description: "",
        [configFieldName(okta, "orgUrl")]: ` ${OKTA_ORG_URL} `,
        [configFieldName(okta, "filter")]: "",
        [secretFieldName(okta, "apiToken")]: new HashedString(
          OKTA_TOKEN,
        ) as unknown as string,
        // A stale value from a previously selected provider must not leak.
        [configFieldName(aws, "region")]: "us-east-1",
        [secretFieldName(aws, "secretAccessKey")]: "aws-secret",
        pollIntervalInMinutes: "30",
        isEnabled: false,
        alertingOnly: true,
      });

    expect(submission).toEqual({
      provider: okta,
      name: "Acme Okta",
      description: undefined,
      config: { orgUrl: OKTA_ORG_URL },
      secrets: { apiToken: OKTA_TOKEN },
      isEnabled: false,
      pollIntervalInMinutes: 30,
      alertingOnly: true,
    });
  });

  test("dropdown values are accepted as raw strings or react-select options", (): void => {
    const sentinel: string = SecurityEventConnectorProvider.MicrosoftSentinel;
    const asOption: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: sentinel,
        [configFieldName(sentinel, "cloud")]: {
          label: "Azure Government (US)",
          value: "usgov",
        },
      });
    expect(asOption.config["cloud"]).toBe("usgov");

    const asString: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: sentinel,
        [configFieldName(sentinel, "cloud")]: "public",
      });
    expect(asString.config["cloud"]).toBe("public");

    const region: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: GOOGLE,
        [configFieldName(GOOGLE, "region")]: {
          label: GOOGLE_REGION,
          value: GOOGLE_REGION,
        },
      });
    expect(region.config).toEqual({ region: GOOGLE_REGION });
  });

  test("refuses to map without a provider", (): void => {
    expect((): void => {
      readSecurityEventConnectionForm({ name: "No provider" });
    }).toThrow("Choose a provider before saving.");
    expect((): void => {
      readSecurityEventConnectionForm({ provider: "not-a-provider" });
    }).toThrow("Choose a provider before saving.");
  });

  /*
   * The failure mode of f5279e6ec1: a credential stored as something other
   * than the text that was entered. A JSON secret is never trimmed, parsed
   * or wrapped on its way into the secrets blob.
   */
  test("a JSON secret is kept as the exact pasted string", (): void => {
    const padded: string = `  ${GOOGLE_KEY}\n\n`;
    const submission: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: GOOGLE,
        [configFieldName(GOOGLE, "region")]: GOOGLE_REGION,
        [configFieldName(GOOGLE, "instanceResourceName")]:
          ` ${GOOGLE_INSTANCE} `,
        [secretFieldName(GOOGLE, "serviceAccountJson")]: padded,
        alertingOnly: false,
      });

    expect(submission.secrets).toEqual({ serviceAccountJson: padded });
    expect(submission.config).toEqual({
      region: GOOGLE_REGION,
      instanceResourceName: GOOGLE_INSTANCE,
    });
    expect(submission.alertingOnly).toBe(false);
    expect(
      securityEventConnectionUpdatePayload(submission, true)["secrets"],
    ).toBe(JSON.stringify({ serviceAccountJson: padded }));
    expect(
      JSON.parse(
        securityEventConnectionUpdatePayload(submission, true)[
          "secrets"
        ] as string,
      )["serviceAccountJson"],
    ).toBe(padded);
  });

  test("a blank JSON secret means unchanged, and a non-string value is sent as its JSON text", (): void => {
    for (const blank of ["", "   ", "\n\t\n", null, undefined]) {
      expect(
        readSecurityEventConnectionForm({
          provider: GOOGLE,
          [secretFieldName(GOOGLE, "serviceAccountJson")]: blank,
        }).secrets,
      ).toEqual({});
    }

    const parsed: JSONObject = { client_email: "reader@acme.example" };
    expect(
      readSecurityEventConnectionForm({
        provider: GOOGLE,
        [secretFieldName(GOOGLE, "serviceAccountJson")]: parsed,
      }).secrets,
    ).toEqual({ serviceAccountJson: JSON.stringify(parsed) });

    // Defensive: a wrapped value still yields its text, never an envelope.
    expect(
      readSecurityEventConnectionForm({
        provider: GOOGLE,
        [secretFieldName(GOOGLE, "serviceAccountJson")]: new HashedString(
          GOOGLE_KEY,
        ) as unknown as string,
      }).secrets,
    ).toEqual({ serviceAccountJson: GOOGLE_KEY });
  });

  test("the test body carries unsaved settings on create and the id plus overlays and scope on edit", (): void => {
    const values: JSONObject = {
      provider: okta,
      [configFieldName(okta, "orgUrl")]: OKTA_ORG_URL,
      [secretFieldName(okta, "apiToken")]: "",
      alertingOnly: false,
    };

    expect(securityEventConnectionTestBody({ values })).toEqual({
      provider: okta,
      config: { orgUrl: OKTA_ORG_URL },
      secrets: {},
      alertingOnly: false,
    });

    expect(
      securityEventConnectionTestBody({
        values,
        connection: oktaConnection(),
      }),
    ).toEqual({
      connectionId: CONNECTION_ID,
      config: { orgUrl: OKTA_ORG_URL },
      secrets: {},
      alertingOnly: false,
    });

    // Credentials only: the stored settings are tested with the new secrets.
    expect(
      securityEventConnectionTestBody({
        values: {
          ...values,
          [secretFieldName(okta, "apiToken")]: OKTA_TOKEN,
        },
        connection: oktaConnection(),
        credentialsOnly: true,
      }),
    ).toEqual({
      connectionId: CONNECTION_ID,
      secrets: { apiToken: OKTA_TOKEN },
    });
  });

  test("the edit test body reports Data to import in alertingOnly's polarity", (): void => {
    const base: JSONObject = {
      [configFieldName(GOOGLE, "region")]: GOOGLE_REGION,
      [configFieldName(GOOGLE, "instanceResourceName")]: GOOGLE_INSTANCE,
    };

    expect(
      securityEventConnectionTestBody({
        values: { ...base, alertingOnly: false },
        connection: googleConnection(true),
      })["alertingOnly"],
    ).toBe(false);
    expect(
      securityEventConnectionTestBody({
        values: { ...base, alertingOnly: true },
        connection: googleConnection(false),
      })["alertingOnly"],
    ).toBe(true);
    // Anything but an explicit false is alerts-only, as the saved default is.
    expect(
      securityEventConnectionTestBody({
        values: { ...base },
        connection: googleConnection(false),
      })["alertingOnly"],
    ).toBe(true);
  });

  test("a Remove toggle maps an optional secret to null and is ignored for a required one", (): void => {
    const submission: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: aws,
        [configFieldName(aws, "region")]: "us-east-1",
        [configFieldName(aws, "accessKeyId")]: AWS_LONG_LIVED_KEY_ID,
        [secretFieldName(aws, "secretAccessKey")]: AWS_SECRET,
        [removeSecretFieldName(aws, "secretAccessKey")]: true,
        [secretFieldName(aws, "sessionToken")]: "typed-token-ignored",
        [removeSecretFieldName(aws, "sessionToken")]: true,
      });

    expect(submission.secrets).toEqual({
      secretAccessKey: AWS_SECRET,
      sessionToken: null,
    });

    // A removal alone is a change worth sending.
    expect(
      securityEventConnectionUpdatePayload(
        { ...submission, secrets: { sessionToken: null } },
        false,
      )["secrets"],
    ).toBe(JSON.stringify({ sessionToken: null }));

    // A create body has nothing stored to remove, so a null never leaves.
    expect(
      securityEventConnectionTestBody({
        values: {
          provider: aws,
          [secretFieldName(aws, "secretAccessKey")]: AWS_SECRET,
          [removeSecretFieldName(aws, "sessionToken")]: true,
        },
      })["secrets"],
    ).toEqual({ secretAccessKey: AWS_SECRET });
  });

  test("the update payload omits secrets when none were entered", (): void => {
    const submission: ReturnType<typeof readSecurityEventConnectionForm> =
      readSecurityEventConnectionForm({
        provider: okta,
        name: "Acme Okta",
        [configFieldName(okta, "orgUrl")]: OKTA_ORG_URL,
        pollIntervalInMinutes: 5,
      });

    expect(securityEventConnectionUpdatePayload(submission, false)).toEqual({
      name: "Acme Okta",
      description: "",
      config: { orgUrl: OKTA_ORG_URL },
      isEnabled: true,
      pollIntervalInMinutes: 5,
      alertingOnly: true,
    });
    expect(
      securityEventConnectionUpdatePayload(
        { ...submission, secrets: { apiToken: OKTA_TOKEN } },
        true,
      ),
    ).toEqual({ secrets: JSON.stringify({ apiToken: OKTA_TOKEN }) });
  });
});

describe("field types and test readiness", () => {
  function field(overrides: Partial<ConnectorField>): ConnectorField {
    return {
      key: "value",
      title: "Value",
      description: "",
      type: "text",
      required: true,
      ...overrides,
    };
  }

  test("a json field renders as the JSON editor for config and secrets; other secrets stay masked", (): void => {
    expect(fieldTypeFor(field({ type: "json" }))).toBe(
      FormFieldSchemaType.JSON,
    );
    expect(secretFieldTypeFor(field({ type: "json" }))).toBe(
      FormFieldSchemaType.JSON,
    );
    expect(secretFieldTypeFor(field({ type: "password" }))).toBe(
      FormFieldSchemaType.Password,
    );
    // Whatever else a secret is declared as, it is never shown in clear text.
    expect(secretFieldTypeFor(field({ type: "text" }))).toBe(
      FormFieldSchemaType.Password,
    );
    expect(fieldTypeFor(field({ type: "dropdown" }))).toBe(
      FormFieldSchemaType.Dropdown,
    );
    expect(fieldTypeFor(field({ type: "url" }))).toBe(FormFieldSchemaType.URL);
    expect(fieldTypeFor(field({ type: "number" }))).toBe(
      FormFieldSchemaType.Number,
    );
    expect(fieldTypeFor(field({ type: "toggle" }))).toBe(
      FormFieldSchemaType.Toggle,
    );
    expect(fieldTypeFor(field({ type: "text" }))).toBe(
      FormFieldSchemaType.Text,
    );
  });

  test("the Google SecOps catalog entry is what the form above relies on", (): void => {
    const definition: SecurityEventConnectorDefinition | undefined =
      getSecurityEventConnectorDefinition(GOOGLE);

    expect(
      definition?.configFields.map((item: ConnectorField) => {
        return [item.key, item.type, item.required, item.defaultValue];
      }),
    ).toEqual([
      ["region", "dropdown", true, undefined],
      ["instanceResourceName", "text", true, undefined],
    ]);
    expect(
      definition?.secretFields.map((item: ConnectorField) => {
        return [item.key, item.title, item.type, item.required];
      }),
    ).toEqual([["serviceAccountJson", "Service account JSON", "json", true]]);
    expect(definition?.supportsAlertingOnlyToggle).toBe(true);
    expect(definition?.alertingOnlyControl?.title).toBe("Data to import");
  });

  test("the needs-credentials message names what is missing in the form's own words", (): void => {
    expect(
      connectionTestNeedsSecretsMessage([
        field({ title: "Service account JSON", type: "json" }),
      ]),
    ).toBe(GOOGLE_NEEDS_KEY_MESSAGE);
    expect(
      connectionTestNeedsSecretsMessage([
        field({ title: "Client ID", type: "password" }),
        field({ title: "Client secret", type: "password" }),
        field({ title: "Key", type: "json" }),
      ]),
    ).toBe(
      "Enter the Client ID, Client secret and Key to test these settings before saving. A saved connection can be tested from its row's Test connection action.",
    );
    expect(
      connectionTestNeedsSecretsMessage([
        field({ title: "API token", type: "password" }),
        field({ title: "Secret", type: "password" }),
      ]),
    ).toBe(
      "Enter the API token and Secret to test these settings before saving. A saved connection can be tested from its row's Test connection action.",
    );
  });

  test("testing is blocked without a provider, and on create only by a blank required secret", (): void => {
    expect(connectionTestDisabledReason({ values: {} })).toBe(
      CONNECTION_TEST_CHOOSE_PROVIDER_MESSAGE,
    );
    expect(
      connectionTestDisabledReason({ values: { provider: "not-a-provider" } }),
    ).toBe(CONNECTION_TEST_CHOOSE_PROVIDER_MESSAGE);

    expect(connectionTestDisabledReason({ values: { provider: GOOGLE } })).toBe(
      GOOGLE_NEEDS_KEY_MESSAGE,
    );
    expect(
      connectionTestDisabledReason({
        values: {
          provider: GOOGLE,
          [secretFieldName(GOOGLE, "serviceAccountJson")]: "  \n ",
        },
      }),
    ).toBe(GOOGLE_NEEDS_KEY_MESSAGE);
    expect(
      connectionTestDisabledReason({
        values: {
          provider: GOOGLE,
          [secretFieldName(GOOGLE, "serviceAccountJson")]: GOOGLE_KEY,
        },
      }),
    ).toBeUndefined();

    // An optional secret left blank never blocks.
    expect(
      connectionTestDisabledReason({
        values: {
          provider: SecurityEventConnectorProvider.AwsSecurityHub,
          [secretFieldName(
            SecurityEventConnectorProvider.AwsSecurityHub,
            "secretAccessKey",
          )]: AWS_SECRET,
        },
      }),
    ).toBeUndefined();

    // A saved connection tests with what is stored.
    expect(
      connectionTestDisabledReason({
        values: {},
        connection: googleConnection(true),
      }),
    ).toBeUndefined();
  });
});
