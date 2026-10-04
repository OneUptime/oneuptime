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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getJestSpyOn } from "../../Spy";

/*
 * ADDING A PROJECT'S MAIL SERVER: Settings > Notification Settings > Custom
 * SMTP Configs, on the real page, through the real ModelFormModal, ModelForm
 * and BasicForm - only the network, the table around the dialog and the
 * dropdown are stand-ins.
 *
 *   Server   Name, Hostname, Port (587 to start with), Username, Password,
 *            and one folded Advanced header that says how mail is sent:
 *            Transport, Require TLS (on), Authentication Type, the OAuth
 *            fields and the Description wait inside it;
 *   Sender   From Email, From Name.
 *
 * Picking Microsoft Graph under Advanced takes the hostname, port, username
 * and password away and shows the OAuth fields it needs. An existing config
 * opens as it is, and saving it untouched sends what it holds - its own
 * port, its own TLS setting. Send Test Email stays the row's own button,
 * with the signed-in person's address to start from.
 */

jest.setTimeout(60000);

const CONFIG_ID: string = "11111111-2222-4333-8444-555555555555";
const SIGNED_IN_EMAIL: string = "maintainer@example.com";

let mode: "create" | "edit" = "create";
let stored: JSONObject = {};
let capturedModels: Array<Record<string, unknown>> = [];
let tableProps: Array<Record<string, unknown>> = [];

/*
 * The table is not under test: it draws the dialog its Create (or a row's
 * Edit) button opens, from its own props, as ModelTable does.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      tableProps.push(props as unknown as Record<string, unknown>);

      const isCreate: boolean = mode === "create";
      const singularName: string = new props.modelType().singularName || "";
      const ObjectIDClass: any = (
        jest.requireActual("../../../Types/ObjectID") as any
      ).default;

      return (
        <ModelFormModal<TBaseModel>
          title={`${isCreate ? "Create New" : "Edit"} ${singularName}`}
          name={`${props.name} > ${isCreate ? "Create New" : "Edit"} ${singularName}`}
          modelType={props.modelType}
          initialValues={isCreate ? props.createInitialValues : undefined}
          onBeforeCreate={props.onBeforeCreate}
          submitButtonText={
            isCreate ? `Create ${singularName}` : "Save Changes"
          }
          onClose={() => {}}
          onSuccess={() => {}}
          modelIdToEdit={isCreate ? undefined : new ObjectIDClass(CONFIG_ID)}
          formProps={{
            id: `create-${props.modelType.name}-from`,
            name: `create-${props.modelType.name}-from`,
            modelType: props.modelType,
            fields: (props.formFields || []).filter(
              (field: ModelField<TBaseModel>): boolean => {
                return isCreate
                  ? !field.doNotShowWhenCreating
                  : !field.doNotShowWhenEditing;
              },
            ),
            steps: props.formSteps || [],
            formType: isCreate ? FormType.Create : FormType.Update,
          }}
        />
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: async (data: {
        modelType: { new (): Record<string, unknown> };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType();
        Object.assign(item, { _id: CONFIG_ID, ...stored });
        return item;
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return { tenantid: "99999999-9999-4999-8999-999999999999" };
      },
      createOrUpdate: async (data: {
        model: Record<string, unknown>;
      }): Promise<{ data: Record<string, unknown> }> => {
        capturedModels.push(data.model);
        return { data: data.model };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
      getEmail: (): { toString: () => string } => {
        return {
          toString: (): string => {
            return "maintainer@example.com";
          },
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDClass("99999999-9999-4999-8999-999999999999");
      },
    },
  };
});

interface DropdownOptionStub {
  label: string;
  value: string;
}

// react-select stood in for: one button per option.
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: {
      options: Array<DropdownOptionStub>;
      onChange?: ((value: string) => void) | undefined;
    }): ReactElement => {
      return (
        <div>
          {props.options.map((option: DropdownOptionStub) => {
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  props.onChange?.(option.value);
                }}
              >
                {`Pick ${option.label}`}
              </button>
            );
          })}
        </div>
      );
    },
  };
});

import CustomSMTPTable from "../../../../App/FeatureSet/Dashboard/src/Components/CustomSMTP/CustomSMTPTable";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import API from "../../../UI/Utils/API/API";

const PLACEHOLDER: Record<string, string> = {
  name: "Company SMTP Server",
  hostname: "smtp.server.com",
  port: "587",
  username: "emailuser@company.com",
  password: "Password",
  fromEmail: "email@company.com",
  fromName: "Company, Inc.",
  clientId: "12345678-1234-1234-1234-123456789012",
  clientSecret: "Client secret value",
  tokenUrl: "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
  scope: "https://graph.microsoft.com/.default",
};

const OPEN_ON_SERVER: Array<string> = [
  "name",
  "hostname",
  "port",
  "username",
  "password",
];

const SMTP_SUMMARY: string =
  "Mail is sent over SMTP, signing in with the username and password. TLS is required.";

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function input(key: string): HTMLInputElement | HTMLTextAreaElement {
  return within(dialog()).getByPlaceholderText(PLACEHOLDER[key]!) as
    | HTMLInputElement
    | HTMLTextAreaElement;
}

function queryInput(key: string): HTMLElement | null {
  return within(dialog()).queryByPlaceholderText(PLACEHOLDER[key]!);
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function renderPage(): Promise<void> {
  render(
    <MemoryRouter>
      <CustomSMTPTable />
    </MemoryRouter>,
  );

  await waitFor(() => {
    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).not.toBeNull();
  });

  await settle();
}

function stepTitles(): Array<string> {
  const progress: HTMLElement = within(dialog()).getByRole("navigation", {
    name: "Progress",
  });

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").replace(/^\d+/, "").trim();
    });
}

function activeStep(): string {
  return (
    within(dialog())
      .getByRole("navigation", { name: "Progress" })
      .querySelector('[aria-current="step"]')?.textContent || ""
  );
}

function advancedHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: /Advanced/ });
}

async function openAdvanced(): Promise<void> {
  if (advancedHeader().getAttribute("aria-expanded") === "true") {
    return;
  }

  await act(async (): Promise<void> => {
    fireEvent.click(advancedHeader());
  });
}

async function type(key: string, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(input(key), { target: { value } });
  });
}

async function pick(option: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: `Pick ${option}` }),
    );
  });
  await settle();
}

async function clickFooter(testId: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId(testId));
  });
  await settle();
}

async function saved(): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function text(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

beforeEach(() => {
  mode = "create";
  stored = {};
  capturedModels = [];
  tableProps = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("creating a project's mail server", () => {
  test("walks two steps, Server then Sender, with no Transport step", async () => {
    await renderPage();

    expect(stepTitles()).toEqual(["Server", "Sender"]);
    expect(activeStep()).toContain("Server");
    expect(within(dialog()).getByText("Create New SMTP Config")).toBeVisible();
  });

  test("opens on the name, the server and its sign-in, starting on port 587", async () => {
    await renderPage();

    for (const key of OPEN_ON_SERVER) {
      expect(input(key)).toBeVisible();
    }

    expect(input("port").value).toBe("587");
    expect(input("name").value).toBe("");

    // Sender's fields wait for their own step.
    expect(queryInput("fromEmail")).toBeNull();

    // Sender still has to be filled in: Next, not Create, on this step.
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Next");
  });

  test("folds the rest under Advanced, whose header says how mail is sent", async () => {
    await renderPage();

    const header: HTMLElement = advancedHeader();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(SMTP_SUMMARY);
    // The summary says what is set: no bare badge beside it.
    expect(within(header).queryByText("Configured")).toBeNull();

    // Rendered, but folded away.
    expect(
      within(dialog()).getByRole("switch", {
        name: "Require TLS",
        hidden: true,
      }),
    ).not.toBeVisible();
    expect(
      within(dialog()).getByRole("button", {
        name: "Pick Microsoft Graph",
        hidden: true,
      }),
    ).not.toBeVisible();

    await openAdvanced();

    const requireTls: HTMLElement = within(dialog()).getByRole("switch", {
      name: "Require TLS",
    });

    expect(requireTls).toBeVisible();
    // On: what the column starts a new config with.
    expect(requireTls).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog()).getByRole("button", { name: "Pick Microsoft Graph" }),
    ).toBeVisible();
    expect(
      within(dialog()).getByRole("button", { name: "Pick OAuth" }),
    ).toBeVisible();
    expect(
      within(dialog()).getByPlaceholderText(
        "Company SMTP server hosted on AWS",
      ),
    ).toBeVisible();

    // No OAuth fields until OAuth or Microsoft Graph is picked.
    expect(queryInput("clientId")).toBeNull();
  });

  test("saves a complete config from the two steps, port 587 and TLS required", async () => {
    await renderPage();

    await type("name", "Company SMTP");
    await type("hostname", "smtp.sendgrid.net");
    await type("username", "apikey");
    await type("password", "SG.secret-key");

    await clickFooter("modal-footer-submit-button");

    expect(activeStep()).toContain("Sender");
    expect(input("fromEmail")).toBeVisible();
    expect(input("fromName")).toBeVisible();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create SMTP Config");

    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");

    await clickFooter("modal-footer-submit-button");

    const model: Record<string, unknown> = await saved();

    expect({
      name: model["name"],
      hostname: text(model["hostname"]),
      port: text(model["port"]),
      username: model["username"],
      password: model["password"],
      fromEmail: text(model["fromEmail"]),
      fromName: model["fromName"],
      transportType: model["transportType"],
      authType: model["authType"],
      secure: model["secure"],
    }).toEqual({
      name: "Company SMTP",
      hostname: "smtp.sendgrid.net",
      port: "587",
      username: "apikey",
      password: "SG.secret-key",
      fromEmail: "alerts@example.com",
      fromName: "Example Alerts",
      transportType: MailTransportType.SMTP,
      authType: SMTPAuthenticationType.UsernamePassword,
      secure: true,
    });
  });

  test("asks for the server before walking on", async () => {
    await renderPage();

    await clickFooter("modal-footer-submit-button");

    expect(activeStep()).toContain("Server");
    expect(capturedModels).toEqual([]);
  });

  test("a relay that needs no sign-in drops the username and password", async () => {
    await renderPage();

    await openAdvanced();
    await pick("None");

    expect(queryInput("username")).toBeNull();
    expect(queryInput("password")).toBeNull();
    expect(input("hostname")).toBeVisible();
    expect(input("port")).toBeVisible();
  });

  test("Microsoft Graph takes the server and sign-in away, asks for the OAuth app, and saves none of what it hid", async () => {
    await renderPage();

    await type("name", "Microsoft 365");
    // Typed before Graph was picked: hidden by it, and not saved with it.
    await type("hostname", "smtp.office365.com");
    await type("username", "alerts@example.com");
    await type("password", "an-old-password");
    await openAdvanced();
    await pick("Microsoft Graph");

    for (const key of ["hostname", "port", "username", "password"]) {
      expect({ key, shown: queryInput(key) }).toEqual({ key, shown: null });
    }

    expect(
      within(dialog()).queryByRole("switch", { name: "Require TLS" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByRole("button", { name: "Pick OAuth" }),
    ).toBeNull();
    // Graph always uses Client Credentials: not asked.
    expect(
      within(dialog()).queryByRole("button", { name: "Pick JWT Bearer" }),
    ).toBeNull();

    for (const key of ["clientId", "clientSecret", "tokenUrl", "scope"]) {
      expect(input(key)).toBeVisible();
    }

    await type("clientId", "0f0e0d0c-0b0a-4000-8000-000000000001");
    await type("clientSecret", "graph-client-secret");
    await type(
      "tokenUrl",
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
    );
    await type("scope", "https://graph.microsoft.com/.default");

    await clickFooter("modal-footer-submit-button");
    expect(activeStep()).toContain("Sender");

    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickFooter("modal-footer-submit-button");

    const model: Record<string, unknown> = await saved();

    expect({
      name: model["name"],
      transportType: model["transportType"],
      clientId: model["clientId"],
      clientSecret: model["clientSecret"],
      tokenUrl: text(model["tokenUrl"]),
      scope: model["scope"],
      fromEmail: text(model["fromEmail"]),
    }).toEqual({
      name: "Microsoft 365",
      transportType: MailTransportType.MicrosoftGraph,
      clientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
      clientSecret: "graph-client-secret",
      tokenUrl: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      scope: "https://graph.microsoft.com/.default",
      fromEmail: "alerts@example.com",
    });

    // Not the port the form started on, nor what was typed before Graph.
    for (const key of ["hostname", "port", "username", "password"]) {
      expect({ key, saved: model[key] ?? null }).toEqual({ key, saved: null });
    }
  });

  test("an SMTP config keeps everything it was given", async () => {
    await renderPage();

    await type("name", "Relay");
    await type("hostname", "smtp.example.com");
    await type("username", "relay-user");
    await type("password", "relay-password");
    await clickFooter("modal-footer-submit-button");
    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickFooter("modal-footer-submit-button");

    const model: Record<string, unknown> = await saved();

    expect({
      hostname: text(model["hostname"]),
      port: text(model["port"]),
      username: model["username"],
      password: model["password"],
    }).toEqual({
      hostname: "smtp.example.com",
      port: "587",
      username: "relay-user",
      password: "relay-password",
    });
  });

  test("opens Advanced by itself when Microsoft Graph's OAuth fields are missing", async () => {
    await renderPage();

    await type("name", "Microsoft 365");
    await openAdvanced();
    await pick("Microsoft Graph");

    // Folded again, with the required OAuth fields empty inside.
    await act(async (): Promise<void> => {
      fireEvent.click(advancedHeader());
    });
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");

    await clickFooter("modal-footer-submit-button");

    expect(activeStep()).toContain("Server");
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(input("clientId")).toBeVisible();
    expect(capturedModels).toEqual([]);
  });

  test("SMTP with OAuth keeps the mailbox to sign in as, drops the password, and asks for the grant", async () => {
    await renderPage();

    await openAdvanced();
    await pick("OAuth");

    expect(input("username")).toBeVisible();
    expect(queryInput("password")).toBeNull();
    expect(
      within(dialog()).getByRole("button", { name: "Pick JWT Bearer" }),
    ).toBeVisible();

    for (const key of ["clientId", "clientSecret", "tokenUrl", "scope"]) {
      expect(input(key)).toBeVisible();
    }
  });

  test("turning Require TLS off is saved, and the header says TLS is optional once folded", async () => {
    await renderPage();

    await type("name", "Internal relay");
    await type("hostname", "relay.internal.example.com");
    await type("port", "25");
    await openAdvanced();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("switch", { name: "Require TLS" }),
      );
    });
    await pick("None");

    // Fold it to read the header.
    await act(async (): Promise<void> => {
      fireEvent.click(advancedHeader());
    });

    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(
      "Mail is sent over SMTP without signing in. TLS is used only if the server offers it.",
    );

    await clickFooter("modal-footer-submit-button");
    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickFooter("modal-footer-submit-button");

    const model: Record<string, unknown> = await saved();

    expect({
      port: text(model["port"]),
      secure: model["secure"],
      authType: model["authType"],
    }).toEqual({
      port: "25",
      secure: false,
      authType: SMTPAuthenticationType.None,
    });
  });
});

describe("editing a project's mail server", () => {
  test("opens an SMTP config as it is, and saves it untouched exactly as stored", async () => {
    mode = "edit";
    stored = {
      name: "Company SMTP",
      description: "Our mail relay",
      transportType: MailTransportType.SMTP,
      hostname: "smtp.example.com",
      port: 2525,
      username: "relay-user",
      password: "relay-password",
      secure: false,
      authType: SMTPAuthenticationType.UsernamePassword,
      oauthProviderType: null,
      clientId: null,
      clientSecret: null,
      tokenUrl: null,
      scope: null,
      fromEmail: "alerts@example.com",
      fromName: "Example Alerts",
    };

    await renderPage();

    expect(within(dialog()).getByText("Edit SMTP Config")).toBeVisible();
    expect(input("hostname").value).toBe("smtp.example.com");
    // Its own port, never the 587 a new config starts on.
    expect(input("port").value).toBe("2525");

    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(
      "Mail is sent over SMTP, signing in with the username and password. TLS is used only if the server offers it.",
    );

    // An edit dialog saves from any step.
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save Changes");

    await clickFooter("modal-footer-submit-button");

    const model: Record<string, unknown> = await saved();

    expect({
      name: model["name"],
      description: model["description"],
      transportType: model["transportType"],
      hostname: text(model["hostname"]),
      port: text(model["port"]),
      username: model["username"],
      password: model["password"],
      secure: model["secure"],
      authType: model["authType"],
      oauthProviderType: model["oauthProviderType"] ?? null,
      fromEmail: text(model["fromEmail"]),
      fromName: model["fromName"],
    }).toEqual({
      name: "Company SMTP",
      description: "Our mail relay",
      transportType: MailTransportType.SMTP,
      hostname: "smtp.example.com",
      port: "2525",
      username: "relay-user",
      password: "relay-password",
      secure: false,
      authType: SMTPAuthenticationType.UsernamePassword,
      oauthProviderType: null,
      fromEmail: "alerts@example.com",
      fromName: "Example Alerts",
    });
  });

  test("opens a Microsoft Graph config folded, its header naming Graph, and saves it without a port", async () => {
    mode = "edit";
    stored = {
      name: "Microsoft 365",
      transportType: MailTransportType.MicrosoftGraph,
      hostname: null,
      port: null,
      username: null,
      password: null,
      secure: true,
      authType: SMTPAuthenticationType.OAuth,
      oauthProviderType: OAuthProviderType.ClientCredentials,
      clientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
      clientSecret: "graph-client-secret",
      tokenUrl: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      scope: "https://graph.microsoft.com/.default",
      fromEmail: "alerts@example.com",
      fromName: "Example Alerts",
    };

    await renderPage();

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(
      "Mail is sent through Microsoft Graph, signing in with OAuth.",
    );
    expect(queryInput("hostname")).toBeNull();
    expect(queryInput("port")).toBeNull();

    await clickFooter("modal-footer-submit-button");

    const model: Record<string, unknown> = await saved();

    expect({
      transportType: model["transportType"],
      port: model["port"] ?? null,
      hostname: model["hostname"] ?? null,
      clientId: model["clientId"],
      clientSecret: model["clientSecret"],
      scope: model["scope"],
    }).toEqual({
      transportType: MailTransportType.MicrosoftGraph,
      port: null,
      hostname: null,
      clientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
      clientSecret: "graph-client-secret",
      scope: "https://graph.microsoft.com/.default",
    });
  });
});

describe("Send Test Email", () => {
  function sendTestAction(): ActionButtonSchema<ProjectSmtpConfig> {
    const props: Record<string, unknown> = tableProps[tableProps.length - 1]!;
    const actions: Array<ActionButtonSchema<ProjectSmtpConfig>> = props[
      "actionButtons"
    ] as Array<ActionButtonSchema<ProjectSmtpConfig>>;

    expect(actions).toHaveLength(1);

    return actions[0]!;
  }

  test("is each row's own button, so a new config is one click from a test", async () => {
    await renderPage();

    const action: ActionButtonSchema<ProjectSmtpConfig> = sendTestAction();

    expect(action.title).toBe("Send Test Email");
    expect(action.placement).toBe(ActionButtonPlacement.Primary);
  });

  test("starts from the signed-in person's address and sends the config's test", async () => {
    const posts: Array<{ url: string; data: JSONObject; headers: unknown }> =
      [];

    getJestSpyOn(API, "post").mockImplementation((request: any) => {
      posts.push({
        url: request.url.toString(),
        data: request.data as JSONObject,
        headers: request.headers,
      });

      return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    });

    await renderPage();

    const config: ProjectSmtpConfig = new ProjectSmtpConfig();
    config._id = CONFIG_ID;

    await act(async (): Promise<void> => {
      // The row's button: what a click on it runs.
      sendTestAction().onClick(
        config,
        () => {},
        () => {},
      );
    });
    await settle();

    const testDialog: HTMLElement = screen
      .getAllByTestId("modal")
      .find((modal: HTMLElement): boolean => {
        return (
          within(modal).queryByRole("heading", { name: "Send Test Email" }) !==
          null
        );
      })!;

    const email: HTMLInputElement = within(testDialog).getByPlaceholderText(
      "test@company.com",
    ) as HTMLInputElement;

    expect(email.value).toBe(SIGNED_IN_EMAIL);

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(testDialog).getByTestId("modal-footer-submit-button"),
      );
    });

    await waitFor(() => {
      expect(posts).toHaveLength(1);
    });

    expect(posts[0]!.url).toContain("/smtp-config/test");
    expect(posts[0]!.data).toEqual({
      toEmail: SIGNED_IN_EMAIL,
      smtpConfigId: CONFIG_ID,
    });
  });
});
