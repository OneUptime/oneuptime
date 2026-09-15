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
import { Mock } from "jest-mock";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { INLINE_TEST_SETTINGS_CHANGED_MESSAGE } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectionTestModal";
import SecurityEventConnectionFormModal, {
  configFieldName,
  readSecurityEventConnectionForm,
  removeSecretFieldName,
  secretFieldName,
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
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
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
 * BasicFormModal, BasicForm and CardSelect are exercised; only transport
 * and the project id are replaced.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const OKTA_ORG_URL: string = "https://acme.okta.com";
const OKTA_TOKEN: string = "00abcDEFghiJKLmnoPQRstuVWXyz-synthetic";
const AWS_TEMPORARY_KEY_ID: string = "ASIASYNTHETIC0000001";
const AWS_LONG_LIVED_KEY_ID: string = "AKIASYNTHETIC0000002";
const AWS_SECRET: string = "aws-secret-access-key-synthetic";

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

describe("SecurityEventConnectionFormModal (create)", () => {
  beforeEach((): void => {
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

    await act(async (): Promise<void> => {
      fireEvent.click(within(progress()).getByText("Provider"));
    });
    await waitFor((): void => {
      expect(activeStep()).toBe("Provider");
    });
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
      fireEvent.click(
        screen.getByRole("button", { name: "Test these settings" }),
      );
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
      fireEvent.click(
        screen.getByRole("button", { name: "Test these settings" }),
      );
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
      fireEvent.click(
        screen.getByRole("button", { name: "Test these settings" }),
      );
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
      fireEvent.click(
        screen.getByRole("button", { name: "Test these settings" }),
      );
    });

    expect(
      await screen.findByText("Configuration: orgUrl must be an https URL."),
    ).toBeVisible();
    expect(screen.getByLabelText(/^API token/)).toHaveValue(OKTA_TOKEN);
    expect(
      screen.getByRole("button", { name: "Test these settings" }),
    ).toBeEnabled();
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
    // Sentinel has no alerting-only distinction, so the toggle stays hidden.
    expect(
      screen.queryByRole("switch", { name: /^Alerts only/ }),
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

  test("Test these settings on edit sends the connection id with the unsaved edits", async (): Promise<void> => {
    await renderModal({ connection: oktaConnection() });
    fill(/^Event filter/, 'eventType sw "security"');
    await next();

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: "Test these settings" }),
      );
    });

    expect(await screen.findByText("All checks passed")).toBeVisible();
    const call: JSONObject = jest.mocked(API.post).mock
      .calls[0]?.[0] as unknown as JSONObject;
    expect(call["data"]).toEqual({
      connectionId: CONNECTION_ID,
      config: { orgUrl: OKTA_ORG_URL, filter: 'eventType sw "security"' },
      secrets: {},
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
      fireEvent.click(
        screen.getByRole("button", { name: "Test these settings" }),
      );
    });
    expect(await screen.findByText("All checks passed")).toBeVisible();
    const testCall: JSONObject = jest.mocked(API.post).mock
      .calls[0]?.[0] as unknown as JSONObject;
    expect(testCall["data"]).toEqual({
      connectionId: CONNECTION_ID,
      config: { region: "us-east-1", accessKeyId: AWS_LONG_LIVED_KEY_ID },
      secrets: { secretAccessKey: AWS_SECRET, sessionToken: null },
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
  });

  test("refuses to map without a provider", (): void => {
    expect((): void => {
      readSecurityEventConnectionForm({ name: "No provider" });
    }).toThrow("Choose a provider before saving.");
    expect((): void => {
      readSecurityEventConnectionForm({ provider: "google-secops" });
    }).toThrow("Choose a provider before saving.");
  });

  test("the test body carries unsaved settings on create and the id plus overlays on edit", (): void => {
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
    });

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
