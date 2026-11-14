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
 *   Provider     Name, a card a provider (SMTP Server picked), and the
 *                Description folded under More fields;
 *   Server       an SMTP server's Hostname, Port (587 to start with),
 *                Username and Password, with Require TLS (on) and the
 *                Authentication Type folded under a header that says how
 *                mail is sent;
 *   OAuth        Microsoft Graph's app, or an SMTP server's with OAuth;
 *   Amazon SES, SendGrid, Mailgun, Postmark, Resend   that provider's key;
 *   Sender       From Email, From Name.
 *
 * Each provider shows only its own step, and a config is saved with
 * nothing the form hid once its provider was picked. An existing config
 * opens as it is, and saving it untouched sends what it holds. Send Test
 * Email stays the row's own button, with the signed-in person's address to
 * start from.
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
import MailgunRegion from "../../../Types/Email/MailgunRegion";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";
import API from "../../../UI/Utils/API/API";
import { setChips } from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const PLACEHOLDER: Record<string, string> = {
  name: "Company SMTP Server",
  description: "Company SMTP server hosted on AWS",
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
  amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
  amazonSesSecretAccessKey: "Secret access key",
  amazonSesRegion: "us-east-1",
  sendgridApiKey: "SG.xxxxxxxxxxxxxxxx",
  mailgunApiKey: "Mailgun API key",
  mailgunDomain: "mg.example.com",
  postmarkServerToken: "00000000-0000-0000-0000-000000000000",
  resendApiKey: "re_xxxxxxxxxxxxxxxx",
};

const OPEN_ON_SERVER: Array<string> = [
  "hostname",
  "port",
  "username",
  "password",
];

// Every provider's key, and the server's fields: what one provider never keeps of another.
const SERVER_KEYS: Array<string> = ["hostname", "port", "username", "password"];

const PROVIDER_KEYS: Array<string> = [
  "amazonSesAccessKeyId",
  "amazonSesSecretAccessKey",
  "amazonSesRegion",
  "sendgridApiKey",
  "mailgunApiKey",
  "mailgunDomain",
  "mailgunRegion",
  "postmarkServerToken",
  "resendApiKey",
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
  return within(dialog()).getByRole("button", { name: "More fields" });
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

// A provider: its card on the Provider step.
async function pickProvider(transport: MailTransportType): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByTestId(`card-select-option-${transport}`),
    );
  });
  await settle();
}

function providerCard(transport: MailTransportType): HTMLElement {
  return within(dialog()).getByTestId(`card-select-option-${transport}`);
}

// A step the list lets the reader open: one walked through, or any on an edit form.
async function openStep(title: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(
        within(dialog()).getByRole("navigation", { name: "Progress" }),
      ).getByText(title),
    );
  });
  await settle();
}

// Authentication Type, OAuth Provider Type and Mailgun's region are plain answers.
async function pick(option: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByRole("radio", { name: option }));
  });
  await settle();
}

async function clickFooter(testId: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId(testId));
  });
  await settle();
}

/*
 * The footer's one way on from the step on screen: a plain Next on every
 * step but the last, the dialog's action (Create SMTP Config, Save Changes)
 * on the last step only.
 */
async function clickWayOn(): Promise<void> {
  await clickFooter(
    within(dialog()).queryByTestId("modal-footer-next-button")
      ? "modal-footer-next-button"
      : "modal-footer-submit-button",
  );
}

/*
 * An edit dialog's step list opens any step: Sender, the last one, where
 * Save Changes is - then Save Changes.
 */
async function saveFromTheLastStep(): Promise<void> {
  expect(
    within(dialog()).queryByTestId("modal-footer-submit-button"),
  ).toBeNull();

  await act(async (): Promise<void> => {
    fireEvent.click(
      within(
        within(dialog()).getByRole("navigation", { name: "Progress" }),
      ).getByText("Sender"),
    );
  });
  await settle();

  expect(activeStep()).toContain("Sender");
  expect(
    within(dialog()).getByTestId("modal-footer-submit-button"),
  ).toHaveTextContent("Save Changes");

  await clickFooter("modal-footer-submit-button");
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
  test("opens on Provider: its name, and a card a provider with SMTP Server picked", async () => {
    await renderPage();

    expect(stepTitles()).toEqual(["Provider", "Server", "Sender"]);
    expect(activeStep()).toContain("Provider");
    expect(within(dialog()).getByText("Create New SMTP Config")).toBeVisible();

    expect(input("name")).toBeVisible();
    expect(input("name").value).toBe("");

    expect(
      within(dialog())
        .getAllByRole("radio")
        .map((card: HTMLElement): string | null => {
          return card.getAttribute("data-card-select-value");
        }),
    ).toEqual([
      MailTransportType.SMTP,
      MailTransportType.AmazonSES,
      MailTransportType.SendGrid,
      MailTransportType.Mailgun,
      MailTransportType.Postmark,
      MailTransportType.Resend,
      MailTransportType.MicrosoftGraph,
    ]);
    expect(providerCard(MailTransportType.SMTP)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(providerCard(MailTransportType.AmazonSES)).toHaveTextContent(
      "Amazon SES",
    );
    expect(providerCard(MailTransportType.AmazonSES)).toHaveTextContent(
      "Send through Amazon Simple Email Service with an IAM access key.",
    );

    // The server's fields wait for their own step; the description is folded.
    expect(queryInput("hostname")).toBeNull();
    expect(input("description")).not.toBeVisible();

    // Create is on Sender, the last step, only: a plain Next here.
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toHaveTextContent("Next");
  });

  test("asks for a name before walking on", async () => {
    await renderPage();

    await clickWayOn();

    expect(activeStep()).toContain("Provider");
    expect(capturedModels).toEqual([]);
  });

  test("a mail server: Server opens on its hostname, port 587, username and password", async () => {
    await renderPage();

    await type("name", "Company SMTP");
    await clickWayOn();

    expect(activeStep()).toContain("Server");

    for (const key of OPEN_ON_SERVER) {
      expect(input(key)).toBeVisible();
    }

    expect(input("port").value).toBe("587");
    expect(queryInput("fromEmail")).toBeNull();
  });

  test("folds TLS and the sign-in type on Server, under a header that says how mail is sent", async () => {
    await renderPage();

    await type("name", "Company SMTP");
    await clickWayOn();

    const header: HTMLElement = advancedHeader();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(SMTP_SUMMARY);
    // The summary says what is set: no bare badge beside it.
    expect(setChips(header)).toEqual([]);

    // Rendered, but folded away.
    expect(
      within(dialog()).getByRole("switch", {
        name: "Require TLS",
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
      within(dialog()).getByRole("radio", { name: "Username and Password" }),
    ).toBeChecked();
    expect(
      within(dialog()).getByRole("radio", { name: "OAuth" }),
    ).toBeVisible();
    expect(
      within(dialog()).getByText("For a relay that needs no sign-in."),
    ).toBeVisible();

    // The transport is the Provider's cards now: not asked again here.
    expect(
      within(dialog()).queryByRole("radio", {
        name: "Microsoft Graph",
        hidden: true,
      }),
    ).toBeNull();
    // No OAuth fields until OAuth is picked.
    expect(queryInput("clientId")).toBeNull();
  });

  test("saves a complete SMTP config, port 587 and TLS required, and no provider's key", async () => {
    await renderPage();

    await type("name", "Company SMTP");
    await clickWayOn();
    await type("hostname", "smtp.sendgrid.net");
    await type("username", "apikey");
    await type("password", "SG.secret-key");

    await clickWayOn();

    expect(activeStep()).toContain("Sender");
    expect(input("fromEmail")).toBeVisible();
    expect(input("fromName")).toBeVisible();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create SMTP Config");

    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");

    await clickWayOn();

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

    for (const key of PROVIDER_KEYS) {
      expect({ key, saved: model[key] ?? null }).toEqual({ key, saved: null });
    }
  });

  test("asks for the server before walking on", async () => {
    await renderPage();

    await type("name", "Company SMTP");
    await clickWayOn();
    await clickWayOn();

    expect(activeStep()).toContain("Server");
    expect(capturedModels).toEqual([]);
  });

  test("a relay that needs no sign-in drops the username and password", async () => {
    await renderPage();

    await type("name", "Relay");
    await clickWayOn();
    await openAdvanced();
    await pick("None");

    expect(queryInput("username")).toBeNull();
    expect(queryInput("password")).toBeNull();
    expect(input("hostname")).toBeVisible();
    expect(input("port")).toBeVisible();
  });

  test("SMTP with OAuth: the mailbox to sign in as on Server, then an OAuth step with the grant and the app", async () => {
    await renderPage();

    await type("name", "Google Workspace");
    await clickWayOn();
    await openAdvanced();
    await pick("OAuth");

    expect(stepTitles()).toEqual(["Provider", "Server", "OAuth", "Sender"]);
    expect(input("username")).toBeVisible();
    expect(queryInput("password")).toBeNull();

    await type("hostname", "smtp.gmail.com");
    await type("username", "alerts@example.com");
    await clickWayOn();

    expect(activeStep()).toContain("OAuth");
    // The grant, Client Credentials to start with.
    expect(
      within(dialog()).getByRole("radio", { name: "Client Credentials" }),
    ).toBeChecked();
    expect(
      within(dialog()).getByRole("radio", { name: "JWT Bearer" }),
    ).toBeVisible();

    for (const key of ["clientId", "clientSecret", "tokenUrl", "scope"]) {
      expect(input(key)).toBeVisible();
    }
  });

  /*
   * The config is refused without the mailbox when it is sent with
   * (ProjectSmtpConfigService.toEmailServer), and the mail service could
   * not sign in without it: the form says so on Server (#7833).
   */
  test("SMTP with OAuth asks the mailbox before walking on: a blank Username says it is required", async () => {
    await renderPage();

    await type("name", "Microsoft 365 SMTP");
    await clickWayOn();
    await openAdvanced();
    await pick("OAuth");
    await type("hostname", "smtp.office365.com");
    await clickWayOn();

    expect(activeStep()).toContain("Server");
    expect(within(dialog()).getByText("Username is required.")).toBeVisible();
    expect(capturedModels).toEqual([]);

    await type("username", "alerts@example.com");
    await clickWayOn();

    expect(activeStep()).toContain("OAuth");
  });

  test("Microsoft Graph: its OAuth app in the Server's place, and none of a server saved", async () => {
    await renderPage();

    await type("name", "Microsoft 365");
    await pickProvider(MailTransportType.MicrosoftGraph);

    expect(stepTitles()).toEqual(["Provider", "OAuth", "Sender"]);

    await clickWayOn();
    expect(activeStep()).toContain("OAuth");

    // Graph always uses Client Credentials: not asked.
    expect(
      within(dialog()).queryByRole("radio", { name: "JWT Bearer" }),
    ).toBeNull();

    await type("clientId", "0f0e0d0c-0b0a-4000-8000-000000000001");
    await type("clientSecret", "graph-client-secret");
    await type(
      "tokenUrl",
      "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
    );
    await type("scope", "https://graph.microsoft.com/.default");

    await clickWayOn();
    expect(activeStep()).toContain("Sender");

    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickWayOn();

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

    // Not the port the form started on.
    for (const key of SERVER_KEYS) {
      expect({ key, saved: model[key] ?? null }).toEqual({ key, saved: null });
    }
  });

  test("asks Microsoft Graph's OAuth app before walking on", async () => {
    await renderPage();

    await type("name", "Microsoft 365");
    await pickProvider(MailTransportType.MicrosoftGraph);
    await clickWayOn();
    await clickWayOn();

    expect(activeStep()).toContain("OAuth");
    expect(input("clientId")).toBeVisible();
    expect(capturedModels).toEqual([]);
  });

  test("Amazon SES: its access key, secret and Region on a step of its own, and nothing of a server saved", async () => {
    await renderPage();

    await type("name", "Amazon SES");
    await pickProvider(MailTransportType.AmazonSES);

    expect(stepTitles()).toEqual(["Provider", "Amazon SES", "Sender"]);

    await clickWayOn();
    expect(activeStep()).toContain("Amazon SES");

    for (const key of OPEN_ON_SERVER) {
      expect({ key, shown: queryInput(key) }).toEqual({ key, shown: null });
    }

    await type("amazonSesAccessKeyId", "AKIAIOSFODNN7EXAMPLE");
    await type(
      "amazonSesSecretAccessKey",
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    await type("amazonSesRegion", "email.us-east-1.amazonaws.com");

    // A Region is a Region code: the step does not walk on with a host.
    await clickWayOn();
    expect(activeStep()).toContain("Amazon SES");
    expect(
      within(dialog()).getByText(
        "Enter an AWS Region code, such as us-east-1.",
      ),
    ).toBeVisible();

    await type("amazonSesRegion", "eu-west-1");
    await clickWayOn();
    expect(activeStep()).toContain("Sender");

    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickWayOn();

    const model: Record<string, unknown> = await saved();

    expect({
      transportType: model["transportType"],
      amazonSesAccessKeyId: model["amazonSesAccessKeyId"],
      amazonSesSecretAccessKey: model["amazonSesSecretAccessKey"],
      amazonSesRegion: model["amazonSesRegion"],
      fromEmail: text(model["fromEmail"]),
    }).toEqual({
      transportType: MailTransportType.AmazonSES,
      amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      amazonSesSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      amazonSesRegion: "eu-west-1",
      fromEmail: "alerts@example.com",
    });

    for (const key of [...SERVER_KEYS, "clientId", "clientSecret"]) {
      expect({ key, saved: model[key] ?? null }).toEqual({ key, saved: null });
    }
  });

  test("Mailgun: its key, domain and region, US to start", async () => {
    await renderPage();

    await type("name", "Mailgun EU");
    await pickProvider(MailTransportType.Mailgun);
    await clickWayOn();

    expect(activeStep()).toContain("Mailgun");
    expect(within(dialog()).getByRole("radio", { name: "US" })).toBeChecked();

    await type("mailgunApiKey", "key-0123456789abcdef");
    await type("mailgunDomain", "mg.example.com");
    await pick("EU");
    await clickWayOn();

    await type("fromEmail", "alerts@mg.example.com");
    await type("fromName", "Example Alerts");
    await clickWayOn();

    const model: Record<string, unknown> = await saved();

    expect({
      transportType: model["transportType"],
      mailgunApiKey: model["mailgunApiKey"],
      mailgunDomain: model["mailgunDomain"],
      mailgunRegion: model["mailgunRegion"],
    }).toEqual({
      transportType: MailTransportType.Mailgun,
      mailgunApiKey: "key-0123456789abcdef",
      mailgunDomain: "mg.example.com",
      mailgunRegion: MailgunRegion.EU,
    });
  });

  test.each([
    [
      MailTransportType.SendGrid,
      "SendGrid",
      "sendgridApiKey",
      "SG.project-key",
    ],
    [
      MailTransportType.Postmark,
      "Postmark",
      "postmarkServerToken",
      "11111111-2222-4333-8444-555555555555",
    ],
    [MailTransportType.Resend, "Resend", "resendApiKey", "re_project_key"],
  ])(
    "%s: one key on a step of its own, saved alone",
    async (
      transport: MailTransportType,
      stepTitle: string,
      key: string,
      value: string,
    ) => {
      await renderPage();

      await type("name", stepTitle);
      await pickProvider(transport);

      expect(stepTitles()).toEqual(["Provider", stepTitle, "Sender"]);

      await clickWayOn();
      expect(activeStep()).toContain(stepTitle);

      // The key first: the step does not walk on without it.
      await clickWayOn();
      expect(activeStep()).toContain(stepTitle);

      await type(key, value);
      await clickWayOn();
      await type("fromEmail", "alerts@example.com");
      await type("fromName", "Example Alerts");
      await clickWayOn();

      const model: Record<string, unknown> = await saved();

      expect(model["transportType"]).toBe(transport);
      expect(model[key]).toBe(value);

      for (const other of [...SERVER_KEYS, ...PROVIDER_KEYS]) {
        if (other === key) {
          continue;
        }

        expect({ key: other, saved: model[other] ?? null }).toEqual({
          key: other,
          saved: null,
        });
      }
    },
  );

  test("a key typed for one provider is never saved on a config of another", async () => {
    await renderPage();

    await type("name", "Switched");
    await pickProvider(MailTransportType.SendGrid);
    await clickWayOn();
    await type("sendgridApiKey", "SG.typed-then-left");

    await openStep("Provider");
    await pickProvider(MailTransportType.Resend);
    await clickWayOn();
    await type("resendApiKey", "re_kept");
    await clickWayOn();
    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickWayOn();

    const model: Record<string, unknown> = await saved();

    expect(model["transportType"]).toBe(MailTransportType.Resend);
    expect(model["resendApiKey"]).toBe("re_kept");
    expect(model["sendgridApiKey"] ?? null).toBeNull();
  });

  test("turning Require TLS off is saved, and the header says TLS is optional once folded", async () => {
    await renderPage();

    await type("name", "Internal relay");
    await clickWayOn();
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

    await clickWayOn();
    await type("fromEmail", "alerts@example.com");
    await type("fromName", "Example Alerts");
    await clickWayOn();

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
    expect(stepTitles()).toEqual(["Provider", "Server", "Sender"]);
    expect(input("name").value).toBe("Company SMTP");
    expect(providerCard(MailTransportType.SMTP)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await openStep("Server");

    expect(input("hostname").value).toBe("smtp.example.com");
    // Its own port, never the 587 a new config starts on.
    expect(input("port").value).toBe("2525");

    expect(
      within(dialog()).getByTestId("collapsible-section-summary"),
    ).toHaveTextContent(
      "Mail is sent over SMTP, signing in with the username and password. TLS is used only if the server offers it.",
    );

    // Save Changes is on the last step only, one click away in the list.
    await saveFromTheLastStep();

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

  test("opens a Microsoft Graph config on its OAuth step, and saves it without a port", async () => {
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

    expect(stepTitles()).toEqual(["Provider", "OAuth", "Sender"]);
    expect(providerCard(MailTransportType.MicrosoftGraph)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await openStep("OAuth");

    expect(input("clientId").value).toBe(
      "0f0e0d0c-0b0a-4000-8000-000000000001",
    );
    expect(queryInput("hostname")).toBeNull();
    expect(queryInput("port")).toBeNull();

    await saveFromTheLastStep();

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

  test("opens an Amazon SES config with its key, and saves it untouched", async () => {
    mode = "edit";
    stored = {
      name: "Amazon SES",
      transportType: MailTransportType.AmazonSES,
      secure: true,
      authType: SMTPAuthenticationType.UsernamePassword,
      amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      amazonSesSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      amazonSesRegion: "eu-west-1",
      fromEmail: "alerts@example.com",
      fromName: "Example Alerts",
    };

    await renderPage();

    expect(stepTitles()).toEqual(["Provider", "Amazon SES", "Sender"]);

    await openStep("Amazon SES");

    expect(input("amazonSesAccessKeyId").value).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(input("amazonSesRegion").value).toBe("eu-west-1");

    await saveFromTheLastStep();

    const model: Record<string, unknown> = await saved();

    expect({
      transportType: model["transportType"],
      amazonSesAccessKeyId: model["amazonSesAccessKeyId"],
      amazonSesSecretAccessKey: model["amazonSesSecretAccessKey"],
      amazonSesRegion: model["amazonSesRegion"],
    }).toEqual({
      transportType: MailTransportType.AmazonSES,
      amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      amazonSesSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      amazonSesRegion: "eu-west-1",
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

/*
 * The table waits folded under Notification Settings' More settings, whose
 * header says how many configs it lists: the table tells the page after
 * each load (NotificationSettingsOwnSenders holds the page).
 */
describe("what the table tells its page", () => {
  test("how many configs it lists, after each load", async () => {
    const counts: Array<number> = [];

    render(
      <MemoryRouter>
        <CustomSMTPTable
          onCountChange={(count: number) => {
            counts.push(count);
          }}
        />
      </MemoryRouter>,
    );

    await settle();

    const onFetchSuccess: (items: Array<unknown>, count: number) => void =
      tableProps[tableProps.length - 1]!["onFetchSuccess"] as (
        items: Array<unknown>,
        count: number,
      ) => void;

    expect(typeof onFetchSuccess).toBe("function");

    await act(async () => {
      onFetchSuccess([], 3);
    });

    await act(async () => {
      onFetchSuccess([], 0);
    });

    expect(counts).toEqual([3, 0]);
  });

  test("a table told nothing to tell still lists", async () => {
    render(
      <MemoryRouter>
        <CustomSMTPTable />
      </MemoryRouter>,
    );

    await settle();

    const onFetchSuccess: (items: Array<unknown>, count: number) => void =
      tableProps[tableProps.length - 1]!["onFetchSuccess"] as (
        items: Array<unknown>,
        count: number,
      ) => void;

    expect(() => {
      onFetchSuccess([], 2);
    }).not.toThrow();
  });
});
