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
import {
  FIELD_CHOICES_SETTLE_IN_MS,
  SECURITY_EVENT_CONNECTION_FIELD_CHOICES_ROUTE,
  connectorFieldOptions,
  forgetConnectorFieldChoices,
  readConnectorFieldChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorFieldChoicesInput";
import SecurityEventConnectionFormModal, {
  getConnectionStepFields,
  getProviderChoiceFields,
  hasConnectionStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionFormModal";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SecurityConnectorTestReport } from "../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import { ConnectorFieldChoicesReport } from "../../../Types/SecurityEvent/Connectors/ConnectorFieldChoices";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { ComponentProps as CodeEditorProps } from "../../../UI/Components/CodeEditor/CodeEditor";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * THE CLOUDFLARE CONNECTION'S FORM. Its settings are all picked from what
 * its API token reads - the account, then the zones of that account - so
 * the form goes from the provider straight to the credentials, and the
 * pickers sit under the token, reading Cloudflare once the token is pasted
 * whole. Cloudflare's events are requests, not alerts, so the form does not
 * ask which alerts open cases. The real form, CardSelect and Dropdown are
 * exercised; only transport, the project id and Monaco are replaced.
 */

jest.mock("../../../UI/Components/CodeEditor/CodeEditor", () => {
  return {
    __esModule: true,
    default: (props: CodeEditorProps): ReactElement => {
      return (
        <textarea
          aria-labelledby={props.ariaLabelledby}
          value={props.value ?? props.initialValue ?? ""}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>): void => {
            props.onChange?.(event.target.value);
          }}
        />
      );
    },
  };
});

type CallbackMock = Mock<() => void>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: string = "22222222-2222-4222-8222-222222222222";
const TOKEN: string = "cf-api-token-synthetic-0123456789abcdef";
const ACME: string = "0123456789abcdef0123456789abcdef";
const STAGING: string = "fedcba9876543210fedcba9876543210";
const SHOP: string = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const API_ZONE: string = "b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const STAGING_ZONE: string = "c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3c3";
const GONE_ZONE: string = "d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4d4";
// How long a test waits for the pickers' one request.
const SETTLED: { timeout: number } = {
  timeout: FIELD_CHOICES_SETTLE_IN_MS + 2000,
};

const CLOUDFLARE: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.Cloudflare,
  )!;

function choices(
  accounts: Array<{ value: string; label: string }> = [
    { value: ACME, label: "Acme" },
    { value: STAGING, label: "Acme Staging" },
  ],
): ConnectorFieldChoicesReport {
  return {
    provider: SecurityEventConnectorProvider.Cloudflare,
    choices: {
      accountId: accounts,
      zoneIds: [
        {
          value: SHOP,
          label: "shop.example.com",
          description: "Pro",
          parentValue: ACME,
        },
        {
          value: API_ZONE,
          label: "api.example.com",
          description: "Business",
          parentValue: ACME,
        },
        {
          value: STAGING_ZONE,
          label: "staging.example.com",
          description: "Free",
          parentValue: STAGING,
        },
      ],
    },
  };
}

function report(): SecurityConnectorTestReport {
  return {
    provider: SecurityEventConnectorProvider.Cloudflare,
    status: "pass",
    startedAt: "2026-11-20T12:00:00.000Z",
    completedAt: "2026-11-20T12:00:01.000Z",
    durationMs: 1000,
    summary: "Cloudflare is reachable.",
    checks: [],
  };
}

// What the field-choices route answers next: a report, or an error.
let choicesAnswer: () => HTTPResponse<JSONObject> | HTTPErrorResponse;

function mockTransport(): void {
  choicesAnswer = () => {
    return new HTTPResponse(200, choices() as unknown as JSONObject, {});
  };
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
  jest.spyOn(API, "post").mockImplementation((async (options: {
    url: URL;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    if (
      options.url
        .toString()
        .endsWith(SECURITY_EVENT_CONNECTION_FIELD_CHOICES_ROUTE)
    ) {
      return choicesAnswer();
    }

    return new HTTPResponse(200, report() as unknown as JSONObject, {});
  }) as never);
}

// The bodies the pickers posted to the field-choices route.
function choicesRequests(): Array<JSONObject> {
  return jest
    .mocked(API.post)
    .mock.calls.filter((call: Array<unknown>): boolean => {
      return (call[0] as { url: URL }).url
        .toString()
        .endsWith(SECURITY_EVENT_CONNECTION_FIELD_CHOICES_ROUTE);
    })
    .map((call: Array<unknown>): JSONObject => {
      return (call[0] as { data: JSONObject }).data;
    });
}

function cloudflareConnection(): SecurityEventConnection {
  const connection: SecurityEventConnection = new SecurityEventConnection();
  connection._id = CONNECTION_ID;
  connection.projectId = PROJECT_ID;
  connection.name = "Acme edge";
  connection.provider = SecurityEventConnectorProvider.Cloudflare;
  connection.config = { accountId: ACME, zoneIds: `${SHOP},${GONE_ZONE}` };
  connection.isEnabled = true;
  connection.pollIntervalInMinutes = 5;
  connection.alertingOnly = true;
  return connection;
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

function steps(): Array<string> {
  return within(progress())
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function footerButton(name: string): HTMLElement {
  return within(dialog()).getByRole("button", { name });
}

async function next(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(footerButton("Next"));
  });
}

/*
 * A picker's input, by the name it is read out by. Found by its label rather
 * than by role: react-select hides a disabled picker's input, and a hidden
 * element has no accessible name to be found by.
 */
function queryPicker(name: string): HTMLElement | null {
  return dialog().querySelector<HTMLElement>(
    `input[role="combobox"][aria-label="${name}"]`,
  );
}

function picker(name: string): HTMLElement {
  const input: HTMLElement | null = queryPicker(name);

  if (!input) {
    throw new Error(`The form has no ${name} picker.`);
  }

  return input;
}

function accountPicker(): HTMLElement {
  return picker("Account");
}

function zonesPicker(): HTMLElement {
  return picker("Zones");
}

// What a picker shows as picked.
function picked(picker: HTMLElement): Array<string> {
  const control: Element | null = picker.closest(".ou-select__control");

  return Array.from(
    control?.querySelectorAll(
      ".ou-select__single-value, .ou-select__multi-value__label",
    ) || [],
  ).map((value: Element): string => {
    return value.textContent || "";
  });
}

async function optionsOf(
  user: UserEvent,
  picker: HTMLElement,
): Promise<Array<string>> {
  await user.click(picker);
  const listbox: HTMLElement = await screen.findByRole("listbox");
  const names: Array<string> = within(listbox)
    .getAllByRole("option")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
  await user.keyboard("{Escape}");

  return names;
}

async function pick(
  user: UserEvent,
  picker: HTMLElement,
  name: string,
): Promise<void> {
  await user.click(picker);
  await user.click(
    await screen.findByRole("option", { name: new RegExp(name) }),
  );
}

async function renderModal(
  props: {
    connection?: SecurityEventConnection;
    credentialsOnly?: boolean;
  } = {},
): Promise<{ onSaved: CallbackMock }> {
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
  return { onSaved };
}

async function reachCredentials(): Promise<UserEvent> {
  await renderModal();
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("radio", { name: /Cloudflare/ }));
  });
  await next();
  expect(activeStep()).toBe("Credentials");
  return userEvent.setup({ delay: null });
}

async function pasteToken(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(screen.getByLabelText(/^API token/), {
      target: { value: TOKEN },
    });
  });
}

async function waitForChoices(): Promise<void> {
  await waitFor((): void => {
    expect(choicesRequests()).toHaveLength(1);
  }, SETTLED);
  await waitFor((): void => {
    expect(
      screen.queryByText("Reading what Cloudflare offers…"),
    ).not.toBeInTheDocument();
    expect(accountPicker()).toBeEnabled();
  }, SETTLED);
}

beforeEach((): void => {
  mockTransport();
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
  forgetConnectorFieldChoices();
});

describe("the Cloudflare catalog entry, as the form reads it", () => {
  test("every setting is picked from what the token reads, so there is no Connection step", () => {
    expect(getConnectionStepFields(CLOUDFLARE)).toEqual([]);
    expect(
      getProviderChoiceFields(CLOUDFLARE).map(
        (field: ConnectorField): string => {
          return field.key;
        },
      ),
    ).toEqual(["accountId", "zoneIds"]);
    expect(hasConnectionStep(CLOUDFLARE)).toBe(false);
    // Every other product still asks its settings first.
    expect(
      hasConnectionStep(
        getSecurityEventConnectorDefinition(
          SecurityEventConnectorProvider.OktaSystemLog,
        ),
      ),
    ).toBe(true);
    // Before a provider is chosen, the step is in the list.
    expect(hasConnectionStep(undefined)).toBe(true);
  });

  test("the zones belong to the account, and one token reads both", () => {
    const [account, zones] = getProviderChoiceFields(CLOUDFLARE);

    expect(account!.choicesFromProvider).toEqual({ isMultiple: false });
    expect(account!.required).toBe(true);
    expect(zones!.choicesFromProvider).toEqual({
      isMultiple: true,
      parentKey: "accountId",
    });
    expect(zones!.required).toBe(false);
    expect(
      CLOUDFLARE.secretFields.map((field: ConnectorField): string => {
        return field.key;
      }),
    ).toEqual(["apiToken"]);
    expect(CLOUDFLARE.importsNoAlerts).toBe(true);
  });
});

describe("connectorFieldOptions", () => {
  test("narrows to the parent's pick, and keeps a stored value no longer offered, named by its value", () => {
    expect(
      connectorFieldOptions({
        choices: choices().choices["zoneIds"]!,
        parentValue: ACME,
        storedValues: [SHOP, GONE_ZONE],
      }).map((option: { value: unknown; label: string }): string => {
        return `${option.value}=${option.label}`;
      }),
    ).toEqual([
      `${SHOP}=shop.example.com`,
      `${API_ZONE}=api.example.com`,
      `${GONE_ZONE}=${GONE_ZONE}`,
    ]);
  });

  test("with no parent picked, offers every choice", () => {
    expect(
      connectorFieldOptions({
        choices: choices().choices["zoneIds"]!,
        storedValues: [],
      }),
    ).toHaveLength(3);
  });

  test("draws a product's names and plans as written", () => {
    const [shop] = connectorFieldOptions({
      choices: choices().choices["zoneIds"]!,
      parentValue: ACME,
      storedValues: [],
    });

    expect(shop).toEqual({
      value: SHOP,
      label: "shop.example.com",
      isUserContent: true,
      description: "Pro",
      isDescriptionUserContent: true,
    });
  });
});

describe("readConnectorFieldChoices", () => {
  test("one request per set of credentials, shared by every picker", async () => {
    const fetcher: jest.Mock<
      (body: JSONObject) => Promise<ConnectorFieldChoicesReport>
    > = jest.fn((): Promise<ConnectorFieldChoicesReport> => {
      return Promise.resolve(choices());
    });

    await Promise.all([
      readConnectorFieldChoices("key-1", {}, fetcher),
      readConnectorFieldChoices("key-1", {}, fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);

    await readConnectorFieldChoices("key-2", {}, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("a failed request is forgotten, so Try Again asks again", async () => {
    const fetcher: jest.Mock<
      (body: JSONObject) => Promise<ConnectorFieldChoicesReport>
    > = jest
      .fn<(body: JSONObject) => Promise<ConnectorFieldChoicesReport>>()
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(choices());

    await expect(readConnectorFieldChoices("key", {}, fetcher)).rejects.toThrow(
      "refused",
    );
    await expect(
      readConnectorFieldChoices("key", {}, fetcher),
    ).resolves.toEqual(choices());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("SecurityEventConnectionFormModal (Cloudflare)", () => {
  test("goes from the provider to the credentials: there is no Connection step", async (): Promise<void> => {
    await reachCredentials();

    expect(steps()).toEqual(["Provider", "Credentials", "Polling"]);
    expect(screen.getByText("Cloudflare settings")).toBeVisible();
    expect(
      screen.getByText("Read from Cloudflare with the credentials above."),
    ).toBeVisible();
  });

  test("the pickers wait for the token, and say so, before reading anything", async (): Promise<void> => {
    await reachCredentials();

    expect(accountPicker()).toBeDisabled();
    expect(zonesPicker()).toBeDisabled();
    expect(
      screen.getAllByText("Enter the API token above to see what it can read."),
    ).toHaveLength(2);
    expect(choicesRequests()).toEqual([]);
  });

  test("a pasted token reads the accounts and zones once, for both pickers", async (): Promise<void> => {
    const user: UserEvent = await reachCredentials();
    await pasteToken();

    expect(
      await screen.findAllByText("Reading what Cloudflare offers…"),
    ).toHaveLength(2);
    await waitForChoices();

    expect(choicesRequests()).toEqual([
      expect.objectContaining({
        provider: SecurityEventConnectorProvider.Cloudflare,
        secrets: { apiToken: TOKEN },
      }),
    ]);
    expect(await optionsOf(user, accountPicker())).toEqual([
      "Acme",
      "Acme Staging",
    ]);
    // Two accounts: nothing is picked for the reader.
    expect(picked(accountPicker())).toEqual([]);
  });

  test("the zones offered are the picked account's, with their plans, and a switch of account lets the other's go", async (): Promise<void> => {
    const user: UserEvent = await reachCredentials();
    await pasteToken();
    await waitForChoices();

    await pick(user, accountPicker(), "^Acme$");
    expect(picked(accountPicker())).toEqual(["Acme"]);
    expect(await optionsOf(user, zonesPicker())).toEqual([
      expect.stringContaining("shop.example.com"),
      expect.stringContaining("api.example.com"),
    ]);

    await pick(user, zonesPicker(), "shop.example.com");
    await pick(user, zonesPicker(), "api.example.com");
    expect(picked(zonesPicker())).toEqual([
      "shop.example.com",
      "api.example.com",
    ]);

    await pick(user, accountPicker(), "Acme Staging");
    await waitFor((): void => {
      expect(picked(zonesPicker())).toEqual([]);
    });
    expect(await optionsOf(user, zonesPicker())).toEqual([
      expect.stringContaining("staging.example.com"),
    ]);
    // Picking an account asks Cloudflare nothing more.
    expect(choicesRequests()).toHaveLength(1);
  });

  test("a token that reads one account picks it for the reader", async (): Promise<void> => {
    choicesAnswer = () => {
      return new HTTPResponse(
        200,
        choices([{ value: ACME, label: "Acme" }]) as unknown as JSONObject,
        {},
      );
    };
    await reachCredentials();
    await pasteToken();
    await waitForChoices();

    await waitFor((): void => {
      expect(picked(accountPicker())).toEqual(["Acme"]);
    });
  });

  test("Cloudflare's refusal is said under the picker, and Try Again asks again", async (): Promise<void> => {
    choicesAnswer = () => {
      return new HTTPErrorResponse(
        400,
        {
          message:
            "Cloudflare did not accept the API token: Invalid API Token (1000).",
        },
        {},
      );
    };
    await reachCredentials();
    await pasteToken();

    expect(
      await screen.findAllByText(
        "Cloudflare did not accept the API token: Invalid API Token (1000).",
        {},
        SETTLED,
      ),
    ).toHaveLength(2);

    choicesAnswer = () => {
      return new HTTPResponse(200, choices() as unknown as JSONObject, {});
    };
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getAllByRole("button", { name: "Try Again" })[0]!);
    });

    await waitFor((): void => {
      expect(choicesRequests()).toHaveLength(2);
    }, SETTLED);
  });

  test("an account is required before the connection's polling", async (): Promise<void> => {
    await reachCredentials();
    await pasteToken();
    await waitForChoices();

    await next();

    expect(activeStep()).toBe("Credentials");
    expect(await screen.findByText(/Account is required/)).toBeVisible();
  });

  test("creates the connection with the account, the zones picked, the token as a secret, and opens no case from its records", async (): Promise<void> => {
    const user: UserEvent = await reachCredentials();
    await pasteToken();
    await waitForChoices();
    await pick(user, accountPicker(), "^Acme$");
    await pick(user, zonesPicker(), "shop.example.com");
    await next();

    expect(activeStep()).toBe("Polling");
    // Cloudflare's events are requests, not alerts: no threshold to ask.
    expect(
      screen.queryByRole("combobox", { name: /^Open Cases From/ }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Acme edge" },
    });
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });

    await waitFor((): void => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });
    const created: { model: SecurityEventConnection } = jest.mocked(
      ModelAPI.create,
    ).mock.calls[0]?.[0] as { model: SecurityEventConnection };
    expect(created.model.provider).toBe(
      SecurityEventConnectorProvider.Cloudflare,
    );
    expect(created.model.config).toEqual({ accountId: ACME, zoneIds: SHOP });
    expect(JSON.parse(created.model.secrets || "{}")).toEqual({
      apiToken: TOKEN,
    });
    expect(created.model.caseMinimumSeverity).toBe("");
    expect(created.model.pollIntervalInMinutes).toBe(5);
  });

  test("no zone picked reads every zone: the setting is left out", async (): Promise<void> => {
    const user: UserEvent = await reachCredentials();
    await pasteToken();
    await waitForChoices();
    await pick(user, accountPicker(), "Acme Staging");
    await next();
    fireEvent.change(screen.getByLabelText(/^Name/), {
      target: { value: "Staging edge" },
    });
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Create connection"));
    });

    await waitFor((): void => {
      expect(ModelAPI.create).toHaveBeenCalledTimes(1);
    });
    expect(
      (
        jest.mocked(ModelAPI.create).mock.calls[0]?.[0] as {
          model: SecurityEventConnection;
        }
      ).model.config,
    ).toEqual({ accountId: STAGING });
  });

  test("on edit, reads with the stored token, keeps a zone Cloudflare no longer lists, and saves the picks as they are", async (): Promise<void> => {
    await renderModal({ connection: cloudflareConnection() });

    expect(steps()).toEqual(["Credentials", "Polling"]);
    await waitFor((): void => {
      expect(choicesRequests()).toEqual([
        { connectionId: CONNECTION_ID, secrets: {} },
      ]);
    }, SETTLED);
    await waitFor((): void => {
      expect(picked(accountPicker())).toEqual(["Acme"]);
    }, SETTLED);
    expect(picked(zonesPicker())).toEqual(["shop.example.com", GONE_ZONE]);

    await next();
    await act(async (): Promise<void> => {
      fireEvent.click(footerButton("Save changes"));
    });

    await waitFor((): void => {
      expect(ModelAPI.updateById).toHaveBeenCalledTimes(1);
    });
    const update: { data: JSONObject } = jest.mocked(ModelAPI.updateById).mock
      .calls[0]?.[0] as { data: JSONObject };
    expect(update.data["config"]).toEqual({
      accountId: ACME,
      zoneIds: `${SHOP},${GONE_ZONE}`,
    });
    expect(update.data["caseMinimumSeverity"]).toBe("");
    expect(update.data).not.toHaveProperty("secrets");
  });

  test("Update credentials changes the token alone: no pickers, nothing read", async (): Promise<void> => {
    await renderModal({
      connection: cloudflareConnection(),
      credentialsOnly: true,
    });

    expect(screen.getByLabelText(/^API token/)).toBeVisible();
    expect(queryPicker("Account")).toBeNull();
    expect(queryPicker("Zones")).toBeNull();
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, FIELD_CHOICES_SETTLE_IN_MS + 100);
    });
    expect(choicesRequests()).toEqual([]);
  });
});
