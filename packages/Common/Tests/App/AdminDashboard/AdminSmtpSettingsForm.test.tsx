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
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE INSTANCE'S MAIL SERVER: Admin Dashboard > Settings > Email > Host
 * Settings, on the real page and card, through the real ModelFormModal,
 * ModelForm and BasicForm, in the Admin Dashboard's own languages - only
 * the network, the page chrome, the side menu and the dropdown are
 * stand-ins.
 *
 * It walked five steps (Transport, SMTP Server, Authentication, OAuth
 * Settings, Email), the first of them one dropdown. It is the Dashboard's
 * Custom SMTP form now, from the same builder:
 *
 *   Server   Hostname, Port, Username, Password, and one folded Advanced
 *            header that says how mail is sent - Transport, Require TLS,
 *            Authentication Type and the OAuth fields wait inside it;
 *   Sender   From Email, From Name.
 *
 * It edits the one GlobalConfig row, so nothing is filled in: an instance
 * opens with what it holds and saves it unchanged, its port included (587
 * is only the empty port's placeholder). The card's own rows leave out
 * what the server does not send with, as the form does.
 */

jest.setTimeout(60000);

// The page and its cards read and save GlobalConfig through the shared model API.
const mockGetItem: MockFunction = getJestMockFunction();
const mockCreateOrUpdate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return mockCreateOrUpdate(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

interface MockPageProps {
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

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

import EmailSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/Index";
import GlobalConfig, {
  EmailServerType,
} from "../../../Models/DatabaseModels/GlobalConfig";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AmazonSesAuthenticationType from "../../../Types/Email/AmazonSesAuthenticationType";
import {
  SERVER_AWS_IDENTITY_ROUTE,
  ServerAwsIdentityVia,
} from "../../../Types/Email/ServerAwsIdentity";
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ServerSendingTopAlert, {
  ServerSendingAlertKind,
} from "../../../UI/Components/ServerSending/ServerSendingTopAlert";
import API from "../../../UI/Utils/API/API";
import ServerSendingStatusLoader from "../../../UI/Utils/ServerSending";
import ServerSetupChecklistLoader, {
  SERVER_SETUP_CHECKLIST_ROUTE,
} from "../../../UI/Utils/ServerSetupChecklist";
import { SERVER_EMAIL_ENVIRONMENT_ROUTE } from "../../../Types/Email/ServerEmailEnvironment";
import {
  SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID,
  SERVER_EMAIL_ENVIRONMENT_LOADING_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/ServerEmailEnvironmentCard";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import {
  ServerSendingChannel,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import {
  SMTP_SUMMARY_NO_SIGN_IN,
  SMTP_SUMMARY_OAUTH,
  SMTP_SUMMARY_PASSWORD,
} from "../../../UI/Components/SmtpConfig/SmtpConfigFormFields";
import UserUtil from "../../../UI/Utils/User";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";
import { formStepButton } from "../../Helpers/FormStepButton";

const WAIT_FOR_TIMEOUT: number = 20000;

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");
const GERMAN: Locale = readLocale("de");

// A page's nested entry ("pages.settings.email.smtpEditButton"), or a flat one.
function text(locale: Locale, key: string): string {
  if (typeof locale[key] === "string") {
    return locale[key] as string;
  }

  let node: unknown = locale;

  for (const part of key.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }

  if (typeof node !== "string") {
    throw new Error(`No locale entry ${key}`);
  }

  return node;
}

// What the server holds for the instance.
let stored: Record<string, unknown> = {};

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
  Object.assign(item, stored);

  return item;
}

interface SaveCall {
  model: BaseModel;
  modelType: { new (): BaseModel };
  formType: FormType;
}

function savedValues(): Record<string, unknown> {
  expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);

  const call: SaveCall = mockCreateOrUpdate.mock.calls[0]![0] as SaveCall;

  expect(call.formType).toBe(FormType.Update);
  expect(call.modelType).toBe(GlobalConfig);

  return call.model as unknown as Record<string, unknown>;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(locale: string = "en"): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(
    <I18nextProvider i18n={instance}>
      <EmailSettings />
    </I18nextProvider>,
  );

  await settle();
}

// The Host Settings card, by its title.
async function smtpCard(locale: Locale = ENGLISH): Promise<HTMLElement> {
  const title: string = text(locale, "pages.settings.email.smtpCardTitle");

  let card: HTMLElement | undefined = undefined;

  await waitFor(
    () => {
      card = screen
        .getAllByTestId("card")
        .find((candidate: HTMLElement): boolean => {
          return within(candidate).queryByText(title) !== null;
        });

      expect(card).toBeDefined();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return card!;
}

async function openEditDialog(locale: Locale = ENGLISH): Promise<HTMLElement> {
  const card: HTMLElement = await smtpCard(locale);
  const editButton: string = text(
    locale,
    "pages.settings.email.smtpEditButton",
  );

  await waitFor(
    () => {
      expect(
        within(card).getByRole("button", { name: editButton }),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  fireEvent.click(within(card).getByRole("button", { name: editButton }));

  await waitFor(
    () => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByTestId("modal");
}

/*
 * The step list, by its name in the page's language: the Admin Dashboard's
 * locales word the shared form's "Progress" since 2807833b3d5, so a German
 * reader's screen reader announces "Fortschritt".
 */
function stepTitles(
  dialog: HTMLElement,
  locale: Locale = ENGLISH,
): Array<string> {
  const progress: HTMLElement = within(dialog).getByRole("navigation", {
    name: text(locale, "Progress"),
  });

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function advancedHeader(dialog: HTMLElement, title: string): HTMLElement {
  return within(dialog).getByRole("button", { name: new RegExp(title) });
}

function summaryOf(dialog: HTMLElement): string {
  return (
    within(dialog).getByTestId("collapsible-section-summary").textContent || ""
  );
}

async function waitForField(
  dialog: HTMLElement,
  placeholder: string,
): Promise<HTMLInputElement> {
  await waitFor(
    () => {
      expect(within(dialog).getByPlaceholderText(placeholder)).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
  await settle();

  return within(dialog).getByPlaceholderText(placeholder) as HTMLInputElement;
}

/*
 * Save Changes is on the last step only. Every step of the edit dialog is
 * filled in already, so its step list opens the last one directly.
 */
async function openLastStep(dialog: HTMLElement): Promise<void> {
  const steps: Array<HTMLElement> = within(
    within(dialog).getByRole("navigation", { name: "Progress" }),
  ).getAllByRole("listitem");
  const last: HTMLElement = steps[steps.length - 1] as HTMLElement;

  if (!last.querySelector('[aria-current="step"]')) {
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(formStepButton(last));
    });
    await settle();
  }
}

async function save(dialog: HTMLElement): Promise<void> {
  await openLastStep(dialog);

  await act(async () => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  });

  await waitFor(
    () => {
      expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
}

function asText(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

const SMTP_INSTANCE: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpTransportType: MailTransportType.SMTP,
  smtpHost: "smtp.example.com",
  smtpPort: 465,
  smtpUsername: "postmaster@example.com",
  smtpPassword: "smtp-password",
  isSMTPSecure: true,
  smtpAuthType: SMTPAuthenticationType.UsernamePassword,
  smtpOAuthProviderType: null,
  smtpClientId: null,
  smtpClientSecret: null,
  smtpTokenUrl: null,
  smtpScope: null,
  smtpFromEmail: "noreply@example.com",
  smtpFromName: "Example Status",
};

const GRAPH_INSTANCE: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpTransportType: MailTransportType.MicrosoftGraph,
  smtpHost: null,
  smtpPort: null,
  smtpUsername: null,
  smtpPassword: null,
  isSMTPSecure: null,
  smtpAuthType: SMTPAuthenticationType.UsernamePassword,
  smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
  smtpClientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
  smtpClientSecret: "graph-client-secret",
  smtpTokenUrl: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
  smtpScope: "https://graph.microsoft.com/.default",
  smtpFromEmail: "noreply@example.com",
  smtpFromName: "Example Status",
};

beforeEach(() => {
  stored = { ...SMTP_INSTANCE };

  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);
  mockCreateOrUpdate.mockReset();
  mockCreateOrUpdate.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as SaveCall).model };
    },
  );

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

  /*
   * The network is a stand-in for every test, not only the ones that answer
   * it. The page asks the server for its setup checklist and whether the
   * GLOBAL_EMAIL_ variables set its mail server, and its cards wait on that
   * answer. Sent for real, the answer depended on the machine: refused at
   * once with config.env's HOST=localhost and no server there, a real answer
   * from a local OneUptime, and a wait on a name that does not resolve
   * ("http://api/...") with no config.env at all, long enough for the cards'
   * waits to run out - so the suite passed for some and failed four or five
   * tests for others. Here the server knows neither, at once, as it does
   * when the variables are unset; a describe that answers them stubs
   * API.fetch again. The checklist loader keeps its answer for the whole
   * page, so it starts each test empty, as a page load does.
   */
  ServerSetupChecklistLoader.clear();
  ServerSendingStatusLoader.clear();
  getJestSpyOn(API, "fetch").mockImplementation((async (): Promise<unknown> => {
    return new HTTPErrorResponse(404, { message: "Not found." }, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Admin > Settings > Email: the server's answers are stand-ins", () => {
  test("the page asks for its checklist and its mail environment, and the stand-in answers both at once", async () => {
    await renderPage();

    await waitFor(
      () => {
        expect(
          screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_LOADING_TEST_ID),
        ).toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const asked: Array<string> = (
      API.fetch as unknown as MockFunction
    ).mock.calls.map((call: Array<unknown>): string => {
      return String((call[0] as { url: unknown }).url);
    });

    expect(
      asked.some((url: string): boolean => {
        return url.endsWith(SERVER_EMAIL_ENVIRONMENT_ROUTE);
      }),
    ).toBe(true);
    expect(
      asked.some((url: string): boolean => {
        return url.endsWith(SERVER_SETUP_CHECKLIST_ROUTE);
      }),
    ).toBe(true);

    // With no answer the saved settings are shown, as on a server without the variables.
    expect(
      screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID),
    ).toBeNull();
    expect(
      screen.getByText(text(ENGLISH, "pages.settings.email.serverCardTitle")),
    ).toBeVisible();
  });
});

describe("Admin > Settings > Email > Host Settings", () => {
  test("edits the instance's server in two steps, Server then Sender", async () => {
    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    const titles: Array<string> = stepTitles(dialog);

    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain("Server");
    expect(titles[1]).toContain("Sender");
    expect(titles.join(" ")).not.toMatch(
      /Transport|Authentication|OAuth|SMTP Server|Email/,
    );
  });

  test("opens on the server and its sign-in, with the rest folded and summed up", async () => {
    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    expect((await waitForField(dialog, "smtp.server.com")).value).toBe(
      "smtp.example.com",
    );
    // Its own port, never a 587 the form filled in.
    expect(within(dialog).getByPlaceholderText("587")).toHaveValue("465");
    expect(
      within(dialog).getByPlaceholderText("emailuser@company.com"),
    ).toHaveValue("postmaster@example.com");
    expect(within(dialog).getByPlaceholderText("Password")).toBeVisible();

    const header: HTMLElement = advancedHeader(dialog, "More fields");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(summaryOf(dialog)).toBe(
      "Mail is sent over SMTP, signing in with the username and password. TLS is required.",
    );
    expect(
      within(dialog).getByRole("switch", { name: "Require TLS", hidden: true }),
    ).not.toBeVisible();

    await act(async () => {
      fireEvent.click(header);
    });

    expect(
      within(dialog).getByRole("switch", { name: "Require TLS" }),
    ).toHaveAttribute("aria-checked", "true");
    // The transport is two plain answers, the stored one picked.
    expect(within(dialog).getByRole("radio", { name: "SMTP" })).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Microsoft Graph" }),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "For a Microsoft 365 tenant with SMTP AUTH turned off.",
      ),
    ).toBeVisible();

    // Save Changes is on the last step only: a plain Next here.
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(
      within(dialog).getByTestId("modal-footer-next-button"),
    ).toHaveTextContent("Next");

    await openLastStep(dialog);

    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save Changes");
  });

  test("saves an untouched server exactly as the instance holds it", async () => {
    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");
    await save(dialog);

    const saved: Record<string, unknown> = savedValues();

    expect({
      smtpTransportType: saved["smtpTransportType"],
      smtpHost: asText(saved["smtpHost"]),
      smtpPort: asText(saved["smtpPort"]),
      smtpUsername: saved["smtpUsername"],
      smtpPassword: saved["smtpPassword"],
      isSMTPSecure: saved["isSMTPSecure"],
      smtpAuthType: saved["smtpAuthType"],
      smtpOAuthProviderType: saved["smtpOAuthProviderType"] ?? null,
      smtpClientId: saved["smtpClientId"] ?? null,
      smtpFromEmail: asText(saved["smtpFromEmail"]),
      smtpFromName: saved["smtpFromName"],
    }).toEqual({
      smtpTransportType: MailTransportType.SMTP,
      smtpHost: "smtp.example.com",
      smtpPort: "465",
      smtpUsername: "postmaster@example.com",
      smtpPassword: "smtp-password",
      isSMTPSecure: true,
      smtpAuthType: SMTPAuthenticationType.UsernamePassword,
      smtpOAuthProviderType: null,
      smtpClientId: null,
      smtpFromEmail: "noreply@example.com",
      smtpFromName: "Example Status",
    });
  });

  test("an instance without a port starts on 587, and Next goes on without typing it (#6875)", async () => {
    stored = { ...SMTP_INSTANCE, smtpPort: null, isSMTPSecure: null };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    // A value, not only the box's example: a newcomer does not type it.
    expect(within(dialog).getByPlaceholderText("587")).toHaveValue("587");
    // Never set: the mail service does not require TLS.
    expect(summaryOf(dialog)).toBe(
      "Mail is sent over SMTP, signing in with the username and password. TLS is used only if the server offers it.",
    );

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    });
    await settle();

    // On to the Sender step, with no error under Port.
    expect(within(dialog).queryByText(/NaN/)).toBeNull();
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });
    await settle();

    expect(asText(savedValues()["smtpPort"])).toBe("587");
  });

  test("a port emptied by hand says Port is required, not Invalid number: NaN (#6875)", async () => {
    stored = { ...SMTP_INSTANCE, smtpPort: null, isSMTPSecure: null };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    await act(async () => {
      fireEvent.change(within(dialog).getByPlaceholderText("587"), {
        target: { value: "" },
      });
    });
    await settle();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    });
    await settle();

    expect(within(dialog).queryByText(/NaN/)).toBeNull();
    expect(within(dialog).getByText("Port is required.")).toBeVisible();
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  /*
   * Over SMTP, OAuth signs in as a mailbox, and the mail service refuses
   * every email without one (#7833): the form says so before saving, not
   * the server's log after. Signing in with a password, a blank username is
   * saved as before - the instance then sends without signing in.
   */
  test("signing in with OAuth over SMTP, a blank Username says Username is required, and saves once the mailbox is typed (#7833)", async () => {
    stored = {
      ...SMTP_INSTANCE,
      smtpPort: 587,
      smtpUsername: null,
      smtpPassword: null,
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
      smtpClientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
      smtpClientSecret: "smtp-client-secret",
      smtpTokenUrl:
        "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      smtpScope: "https://outlook.office365.com/.default",
    };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();
    const username: HTMLInputElement = await waitForField(
      dialog,
      "emailuser@company.com",
    );

    expect(username.value).toBe("");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    });
    await settle();

    expect(within(dialog).getByText("Username is required.")).toBeVisible();
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.change(username, { target: { value: "alerts@example.com" } });
    });
    await settle();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    });
    await settle();

    expect(within(dialog).queryByText("Username is required.")).toBeNull();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });
    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect({
      smtpAuthType: savedValues()["smtpAuthType"],
      smtpUsername: savedValues()["smtpUsername"],
    }).toEqual({
      smtpAuthType: SMTPAuthenticationType.OAuth,
      smtpUsername: "alerts@example.com",
    });
  });

  test("signing in with a password, a blank Username still goes on: the instance sends without signing in", async () => {
    stored = {
      ...SMTP_INSTANCE,
      smtpPort: 25,
      smtpUsername: null,
      smtpPassword: null,
      isSMTPSecure: false,
    };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "emailuser@company.com");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    });
    await settle();

    expect(within(dialog).queryByText("Username is required.")).toBeNull();
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toBeVisible();
  });

  test("a relay with no sign-in is summed up as one, as the mail service sends to it", async () => {
    stored = {
      ...SMTP_INSTANCE,
      smtpPort: 25,
      smtpUsername: null,
      smtpPassword: null,
      isSMTPSecure: false,
    };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    expect(summaryOf(dialog)).toBe(
      "Mail is sent over SMTP without signing in. TLS is used only if the server offers it.",
    );
  });

  test("port 465 with Require TLS off is summed up as always encrypted", async () => {
    stored = { ...SMTP_INSTANCE, isSMTPSecure: false };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    expect(summaryOf(dialog)).toBe(
      "Mail is sent over SMTP, signing in with the username and password. Port 465 is always encrypted, but the certificate is not checked.",
    );
  });

  test("a Microsoft Graph instance opens folded on Graph, and saves untouched without a server", async () => {
    stored = { ...GRAPH_INSTANCE };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitFor(
      () => {
        expect(summaryOf(dialog)).toBe(
          "Mail is sent through Microsoft Graph, signing in with OAuth.",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    expect(within(dialog).queryByPlaceholderText("smtp.server.com")).toBeNull();
    expect(within(dialog).queryByPlaceholderText("587")).toBeNull();
    expect(advancedHeader(dialog, "More fields")).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    await save(dialog);

    const saved: Record<string, unknown> = savedValues();

    expect({
      smtpTransportType: saved["smtpTransportType"],
      smtpHost: saved["smtpHost"] ?? null,
      smtpPort: saved["smtpPort"] ?? null,
      smtpClientId: saved["smtpClientId"],
      smtpClientSecret: saved["smtpClientSecret"],
      smtpScope: saved["smtpScope"],
      smtpFromEmail: asText(saved["smtpFromEmail"]),
    }).toEqual({
      smtpTransportType: MailTransportType.MicrosoftGraph,
      smtpHost: null,
      smtpPort: null,
      smtpClientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
      smtpClientSecret: "graph-client-secret",
      smtpScope: "https://graph.microsoft.com/.default",
      smtpFromEmail: "noreply@example.com",
    });
  });

  test("picking Microsoft Graph swaps the server for the OAuth app", async () => {
    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    await act(async () => {
      fireEvent.click(advancedHeader(dialog, "More fields"));
    });
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("radio", { name: "Microsoft Graph" }),
      );
    });
    await settle();

    expect(within(dialog).queryByPlaceholderText("smtp.server.com")).toBeNull();
    expect(within(dialog).queryByPlaceholderText("587")).toBeNull();
    expect(
      within(dialog).queryByPlaceholderText("emailuser@company.com"),
    ).toBeNull();
    expect(
      within(dialog).getByPlaceholderText(
        "12345678-1234-1234-1234-123456789012",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByPlaceholderText(
        "https://graph.microsoft.com/.default",
      ),
    ).toBeVisible();
  });

  test("the card lists what an SMTP server sends with, TLS by its new name", async () => {
    await renderPage();

    const card: HTMLElement = await smtpCard();

    await waitFor(
      () => {
        expect(within(card).getByText("smtp.example.com")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    for (const shown of [
      "Transport",
      "SMTP Host",
      "SMTP Port",
      "Require TLS",
      "Authentication Type",
      "Username",
      "From Email",
      "From Name",
    ]) {
      expect({
        shown,
        found: within(card).queryByText(shown) !== null,
      }).toEqual({ shown, found: true });
    }

    for (const left of [
      "Use SSL/TLS",
      "OAuth Provider Type",
      "OAuth Client ID",
      "OAuth Token URL",
      "OAuth Scope",
    ]) {
      expect({ left, found: within(card).queryByText(left) }).toEqual({
        left,
        found: null,
      });
    }
  });

  test("the card lists a Microsoft Graph server's OAuth app, and no host, port or TLS", async () => {
    stored = { ...GRAPH_INSTANCE };

    await renderPage();

    const card: HTMLElement = await smtpCard();

    await waitFor(
      () => {
        expect(
          within(card).getByText("0f0e0d0c-0b0a-4000-8000-000000000001"),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    for (const shown of [
      "Transport",
      "OAuth Client ID",
      "OAuth Token URL",
      "OAuth Scope",
      "From Email",
    ]) {
      expect({
        shown,
        found: within(card).queryByText(shown) !== null,
      }).toEqual({ shown, found: true });
    }

    for (const left of [
      "SMTP Host",
      "SMTP Port",
      "Require TLS",
      "Authentication Type",
      "Username",
      // Graph always uses Client Credentials.
      "OAuth Provider Type",
    ]) {
      expect({ left, found: within(card).queryByText(left) }).toEqual({
        left,
        found: null,
      });
    }
  });

  test("the dialog is titled like the button that opens it, not after the model", async () => {
    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    // It read "Edit Global Config", the name of the row it edits.
    expect(within(dialog).getByTestId("modal-title").textContent).toBe(
      text(ENGLISH, "pages.settings.email.smtpEditButton"),
    );
    expect(dialog).not.toHaveTextContent("Global Config");
  });

  test("the card says what it holds, in a line", async () => {
    await renderPage();

    const card: HTMLElement = await smtpCard();

    expect(
      within(card).getByText(
        "The mail server OneUptime sends through, and who the emails come from.",
      ),
    ).toBeInTheDocument();
    expect(card).not.toHaveTextContent("Please configure");
  });

  test("the card's Authentication Type says what the dialog says, in the reader's language", async () => {
    stored = {
      ...SMTP_INSTANCE,
      smtpAuthType: SMTPAuthenticationType.None,
      smtpUsername: null,
    };

    await renderPage("de");

    const card: HTMLElement = await smtpCard(GERMAN);

    // The dialog's sentence, in German: not the stored English.
    await waitFor(
      () => {
        expect(
          within(card).getByText(text(GERMAN, SMTP_SUMMARY_NO_SIGN_IN)),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(text(GERMAN, SMTP_SUMMARY_NO_SIGN_IN)).toBe(
      "E-Mails werden ohne Anmeldung über SMTP gesendet.",
    );
    expect(within(card).queryByText(SMTP_SUMMARY_NO_SIGN_IN)).toBeNull();
    expect(within(card).queryByText("None")).toBeNull();
  });

  test("an instance that never picked a sign-in, with a username and password, signs in with them, translated", async () => {
    stored = { ...SMTP_INSTANCE, smtpAuthType: null };

    await renderPage("de");

    const card: HTMLElement = await smtpCard(GERMAN);

    await waitFor(
      () => {
        expect(
          within(card).getByText(text(GERMAN, SMTP_SUMMARY_PASSWORD)),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).queryByText(SMTP_SUMMARY_PASSWORD)).toBeNull();
  });

  /*
   * #7458: the card showed the stored Authentication Type, "Username and
   * Password", on a server that was given no username or password - and
   * so sends without signing in, as the Edit dialog's own summary said -
   * and on one that never picked a sign-in at all. It says what the dialog
   * says now, in the dialog's own sentence.
   */
  describe("the card and the dialog say the same thing about signing in (#7458)", () => {
    const FRESH_SERVER_SAVED: Record<string, unknown> = {
      ...SMTP_INSTANCE,
      smtpPort: 587,
      isSMTPSecure: false,
      smtpUsername: null,
      smtpPassword: null,
      smtpAuthType: null,
    };

    // The card's Authentication Type row, as its words read.
    async function cardSignIn(card: HTMLElement): Promise<string> {
      let words: string = "";

      await waitFor(
        () => {
          const sentence: HTMLElement | undefined = [
            SMTP_SUMMARY_PASSWORD,
            SMTP_SUMMARY_OAUTH,
            SMTP_SUMMARY_NO_SIGN_IN,
          ]
            .map((candidate: string): HTMLElement | null => {
              return within(card).queryByText(candidate);
            })
            .find((found: HTMLElement | null): boolean => {
              return found !== null;
            }) as HTMLElement | undefined;

          expect(sentence).toBeDefined();
          words = sentence!.textContent || "";
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      return words;
    }

    test.each([
      [
        "saved with no username and no password, never having picked a sign-in",
        FRESH_SERVER_SAVED,
        SMTP_SUMMARY_NO_SIGN_IN,
      ],
      [
        "Username and Password picked, with no username and no password",
        {
          ...FRESH_SERVER_SAVED,
          smtpAuthType: SMTPAuthenticationType.UsernamePassword,
        },
        SMTP_SUMMARY_NO_SIGN_IN,
      ],
      [
        "a username with no password",
        { ...FRESH_SERVER_SAVED, smtpUsername: "postmaster@example.com" },
        SMTP_SUMMARY_NO_SIGN_IN,
      ],
      [
        "a password with no username",
        { ...FRESH_SERVER_SAVED, smtpPassword: "smtp-password" },
        SMTP_SUMMARY_NO_SIGN_IN,
      ],
      [
        "a username and a password",
        {
          ...FRESH_SERVER_SAVED,
          smtpUsername: "postmaster@example.com",
          smtpPassword: "smtp-password",
        },
        SMTP_SUMMARY_PASSWORD,
      ],
      [
        "a relay picked with no sign-in",
        { ...FRESH_SERVER_SAVED, smtpAuthType: SMTPAuthenticationType.None },
        SMTP_SUMMARY_NO_SIGN_IN,
      ],
      [
        "OAuth",
        {
          ...FRESH_SERVER_SAVED,
          smtpUsername: "alerts@example.com",
          smtpAuthType: SMTPAuthenticationType.OAuth,
          smtpOAuthProviderType: OAuthProviderType.ClientCredentials,
          smtpClientId: "0f0e0d0c-0b0a-4000-8000-000000000001",
          smtpClientSecret: "smtp-client-secret",
          smtpTokenUrl:
            "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
          smtpScope: "https://outlook.office365.com/.default",
        },
        SMTP_SUMMARY_OAUTH,
      ],
    ] as Array<[string, Record<string, unknown>, string]>)(
      "%s",
      async (
        _name: string,
        instance: Record<string, unknown>,
        expected: string,
      ) => {
        stored = { ...instance };

        await renderPage();

        const card: HTMLElement = await smtpCard();

        expect(await cardSignIn(card)).toBe(expected);

        const dialog: HTMLElement = await openEditDialog();

        await waitForField(dialog, "smtp.server.com");

        // The dialog's summary opens with the same sentence.
        expect(summaryOf(dialog).startsWith(expected)).toBe(true);
      },
    );

    test('never "Username and Password" for a server that signs in with nothing', async () => {
      stored = {
        ...FRESH_SERVER_SAVED,
        smtpAuthType: SMTPAuthenticationType.UsernamePassword,
      };

      await renderPage();

      const card: HTMLElement = await smtpCard();

      expect(await cardSignIn(card)).toBe(SMTP_SUMMARY_NO_SIGN_IN);
      expect(within(card).queryByText("Username and Password")).toBeNull();
      expect(card).not.toHaveTextContent(SMTP_SUMMARY_PASSWORD);
    });

    test("the card reads whether a password is set, and never shows it", async () => {
      stored = { ...SMTP_INSTANCE };

      await renderPage();

      const card: HTMLElement = await smtpCard();

      expect(await cardSignIn(card)).toBe(SMTP_SUMMARY_PASSWORD);

      const selects: Array<Record<string, unknown>> = mockGetItem.mock.calls
        .map((call: Array<unknown>): Record<string, unknown> => {
          return ((call[0] as { select?: Record<string, unknown> }).select ||
            {}) as Record<string, unknown>;
        })
        .filter((select: Record<string, unknown>): boolean => {
          return Boolean(select["smtpHost"]);
        });

      expect(selects.length).toBeGreaterThan(0);

      for (const select of selects) {
        expect({
          smtpUsername: select["smtpUsername"],
          smtpPassword: select["smtpPassword"],
        }).toEqual({ smtpUsername: true, smtpPassword: true });
      }

      expect(card).not.toHaveTextContent("smtp-password");
    });
  });

  /*
   * #7458: a fresh server was seeded with port 25 when SMTP_PORT was not
   * set. Seeded with none, its card says so, and Edit SMTP Config starts on
   * 587 as its help says.
   */
  test("a fresh server's card shows no port, and Edit SMTP Config starts on 587 (#7458)", async () => {
    stored = {
      emailServerType: EmailServerType.CustomSMTP,
      smtpTransportType: null,
      smtpHost: null,
      smtpPort: null,
      smtpUsername: "",
      smtpPassword: "",
      isSMTPSecure: false,
      smtpAuthType: null,
      smtpFromEmail: null,
      smtpFromName: "",
    };

    await renderPage();

    const card: HTMLElement = await smtpCard();

    await waitFor(
      () => {
        expect(within(card).getByText("SMTP Port")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    // Host, Port, Username, From Email and From Name: each "None", no 25.
    expect(card).not.toHaveTextContent("25");
    expect(within(card).getAllByText("None").length).toBeGreaterThanOrEqual(3);
    expect(
      await within(card).findByText(SMTP_SUMMARY_NO_SIGN_IN),
    ).toBeVisible();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    expect(within(dialog).getByPlaceholderText("587")).toHaveValue("587");
    expect(summaryOf(dialog)).toBe(
      "Mail is sent over SMTP without signing in. TLS is used only if the server offers it.",
    );
  });

  /*
   * #8183: the From Name started empty on a fresh server, and it is
   * required, so a newcomer had to make a name up before Save worked. It
   * starts on the product's name, as the port starts on 587, and the
   * newcomer types only the host and the address.
   */
  /*
   * The row a fresh server holds: the columns' own defaults (SMTP, signing
   * in with a username and password), and what UpdateGlobalConfigFromEnv
   * writes when no SMTP variable is set - blank text, and no host or port.
   */
  const FRESH_SERVER: Record<string, unknown> = {
    emailServerType: EmailServerType.CustomSMTP,
    smtpTransportType: MailTransportType.SMTP,
    smtpHost: null,
    smtpPort: null,
    smtpUsername: "",
    smtpPassword: "",
    isSMTPSecure: false,
    smtpAuthType: SMTPAuthenticationType.UsernamePassword,
    smtpFromEmail: "",
    smtpFromName: "",
  };

  async function fillFreshServer(dialog: HTMLElement): Promise<void> {
    await act(async () => {
      fireEvent.change(within(dialog).getByPlaceholderText("smtp.server.com"), {
        target: { value: "smtp.example.com" },
      });
    });
    await settle();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
    });
    await settle();

    const fromEmail: HTMLInputElement = await waitForField(
      dialog,
      "email@company.com",
    );

    await act(async () => {
      fireEvent.change(fromEmail, { target: { value: "alerts@example.com" } });
    });
    await settle();
  }

  test.each([
    ["blank, as the migration writes it", ""],
    ["null", null],
    ["only spaces", "   "],
  ])(
    "a fresh server's From Name (%s) starts on OneUptime, and Save goes through with only the host and the address typed (#8183)",
    async (_label: string, fromName: string | null) => {
      stored = { ...FRESH_SERVER, smtpFromName: fromName };

      await renderPage();

      const dialog: HTMLElement = await openEditDialog();

      await waitForField(dialog, "smtp.server.com");
      await fillFreshServer(dialog);

      // A value, not only the box's example, which is still a company's.
      expect(within(dialog).getByPlaceholderText("Company, Inc.")).toHaveValue(
        "OneUptime",
      );
      expect(within(dialog).queryByText("From Name is required.")).toBeNull();

      await act(async () => {
        fireEvent.click(
          within(dialog).getByTestId("modal-footer-submit-button"),
        );
      });

      await waitFor(
        () => {
          expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const saved: Record<string, unknown> = savedValues();

      expect({
        smtpHost: asText(saved["smtpHost"]),
        smtpPort: asText(saved["smtpPort"]),
        smtpFromEmail: asText(saved["smtpFromEmail"]),
        smtpFromName: saved["smtpFromName"],
      }).toEqual({
        smtpHost: "smtp.example.com",
        smtpPort: "587",
        smtpFromEmail: "alerts@example.com",
        smtpFromName: "OneUptime",
      });
    },
  );

  test("a From Name the server holds is kept, and one cleared by hand says From Name is required (#8183)", async () => {
    stored = { ...SMTP_INSTANCE, smtpFromName: "Example Status" };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");
    await openLastStep(dialog);

    const fromName: HTMLInputElement = await waitForField(
      dialog,
      "Company, Inc.",
    );

    expect(fromName).toHaveValue("Example Status");

    // Emptied by hand, it stays empty: the default is a start, not a refill.
    await act(async () => {
      fireEvent.change(fromName, { target: { value: "" } });
    });
    await settle();

    expect(fromName).toHaveValue("");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });
    await settle();

    expect(within(dialog).getByText("From Name is required.")).toBeVisible();
    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
  });

  test.each(["de", "ar", "fa"])(
    "%s: a fresh server's From Name starts on OneUptime, as written, under the field's own words (#8183)",
    async (language: string) => {
      const locale: Locale = readLocale(language);

      stored = { ...FRESH_SERVER };

      await renderPage(language);

      const dialog: HTMLElement = await openEditDialog(locale);

      await waitForField(dialog, "smtp.server.com");

      // The Sender step, from the step list, named in the page's language.
      const steps: Array<HTMLElement> = within(
        within(dialog).getByRole("navigation", {
          name: text(locale, "Progress"),
        }),
      ).getAllByRole("listitem");

      await act(async () => {
        fireEvent.click(formStepButton(steps[steps.length - 1]!));
      });
      await settle();

      // The product's name is never translated.
      expect(await waitForField(dialog, "Company, Inc.")).toHaveValue(
        "OneUptime",
      );
      expect(text(locale, "From Name")).not.toBe("From Name");
      expect(within(dialog).getByText(text(locale, "From Name"))).toBeVisible();
      expect(within(dialog).queryByText("From Name")).toBeNull();
    },
  );

  test("reads in the Admin Dashboard's languages: German", async () => {
    await renderPage("de");

    const dialog: HTMLElement = await openEditDialog(GERMAN);

    await waitForField(dialog, "smtp.server.com");

    const titles: Array<string> = stepTitles(dialog, GERMAN);

    expect(text(GERMAN, "Progress")).toBe("Fortschritt");
    expect(text(GERMAN, "Sender")).toBe("Absender");
    expect(titles[0]).toContain(text(GERMAN, "Server"));
    expect(titles[1]).toContain("Absender");

    expect(summaryOf(dialog)).toBe(
      `${text(GERMAN, "Mail is sent over SMTP, signing in with the username and password.")} ${text(GERMAN, "TLS is required.")}`,
    );
    expect(summaryOf(dialog)).not.toContain("Mail is sent");

    await act(async () => {
      fireEvent.click(advancedHeader(dialog, text(GERMAN, "More fields")));
    });

    expect(
      within(dialog).getByRole("switch", { name: "TLS erzwingen" }),
    ).toBeVisible();
    expect(within(dialog).getByText(text(GERMAN, "Username"))).toBeVisible();

    // The transport's answers, each with its line, in German too.
    expect(
      within(dialog).getByText(text(GERMAN, "Works with most mail servers.")),
    ).toBeVisible();
    expect(text(GERMAN, "Works with most mail servers.")).not.toBe(
      "Works with most mail servers.",
    );
  });
});

/*
 * #7459: THE BANNER FOLLOWS A SAVE, WITHOUT A RELOAD.
 *
 * "Email is not set up" sits at the top of every Admin Dashboard page
 * (ServerSendingTopAlert, mounted once by the MasterPage), and read where
 * email stands once, when it mounted. Saved settings and a test email
 * that arrived left it saying email was not set up until a reload, while
 * the Test email card under it said email was set up. Here the real page
 * and the real banner are drawn together, the server's answer is the only
 * stand-in, and a save takes the banner away by itself.
 */
describe("Admin > Settings > Email: the banner follows a save (#7459)", () => {
  // What the server says of email, as GET /global-config/sending-status answers.
  let emailState: ServerSendingState = ServerSendingState.NotSetUp;
  let statusReads: number = 0;

  function sendingStatus(state: ServerSendingState): JSONObject {
    const channels: Array<Record<string, unknown>> = [
      ServerSendingChannel.Email,
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
      ServerSendingChannel.Push,
    ].map((channel: ServerSendingChannel): Record<string, unknown> => {
      const channelState: ServerSendingState =
        channel === ServerSendingChannel.Email
          ? state
          : channel === ServerSendingChannel.Push
            ? ServerSendingState.Untested
            : ServerSendingState.NotSetUp;

      return {
        channel: channel,
        state: channelState,
        hasWorked: channelState === ServerSendingState.Working,
        lastWorkedAt: null,
        failingSince: null,
        lastFailure: null,
        setUpProblem:
          channelState === ServerSendingState.NotSetUp
            ? "Nothing is set up under Settings > Emails yet."
            : null,
      };
    });

    return { channels: channels, globalProbes: null } as unknown as JSONObject;
  }

  beforeEach(() => {
    emailState = ServerSendingState.NotSetUp;
    statusReads = 0;
    ServerSendingStatusLoader.clear();

    getJestSpyOn(API, "fetch").mockImplementation((async (
      options: unknown,
    ): Promise<unknown> => {
      const url: string = String((options as { url: unknown }).url);

      if (url.endsWith("/global-config/sending-status")) {
        statusReads++;
        return new HTTPResponse<JSONObject>(200, sendingStatus(emailState), {});
      }

      // The checklist and the environment variables: not asked about here.
      return new HTTPErrorResponse(404, { message: "Not found." }, {});
    }) as never);
  });

  afterEach(() => {
    ServerSendingStatusLoader.clear();
  });

  async function renderPageWithBanner(): Promise<void> {
    const instance: i18n = await instanceFor("en");

    render(
      <I18nextProvider i18n={instance}>
        <ServerSendingTopAlert
          emailSettingsLink={new Route("/admin/settings/smtp")}
          globalProbesLink={new Route("/admin/settings/probes")}
        />
        <EmailSettings />
      </I18nextProvider>,
    );

    await settle();
  }

  async function bannerSaysEmailIsNotSetUp(): Promise<void> {
    await waitFor(
      () => {
        expect(screen.getByTestId("server-sending-alert")).toHaveAttribute(
          "data-kind",
          ServerSendingAlertKind.EmailNotSetUp,
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  test('saving the mail server takes "Email is not set up" away, without a reload', async () => {
    stored = { ...SMTP_INSTANCE };

    await renderPageWithBanner();
    await bannerSaysEmailIsNotSetUp();

    // Saved, the server holds working settings: set up, not tested yet.
    emailState = ServerSendingState.Untested;

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");
    await save(dialog);

    await waitFor(
      () => {
        expect(screen.queryByTestId("server-sending-alert")).toBeNull();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(statusReads).toBe(2);
  });

  test("a save that leaves email not set up keeps the banner, read again", async () => {
    stored = { ...SMTP_INSTANCE };

    await renderPageWithBanner();
    await bannerSaysEmailIsNotSetUp();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");
    await save(dialog);

    await waitFor(
      () => {
        expect(statusReads).toBe(2);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await bannerSaysEmailIsNotSetUp();
  });

  test("saved settings whose sends now fail: the banner says email is failing", async () => {
    stored = { ...SMTP_INSTANCE };

    await renderPageWithBanner();
    await bannerSaysEmailIsNotSetUp();

    emailState = ServerSendingState.Failing;

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");
    await save(dialog);

    await waitFor(
      () => {
        expect(screen.getByTestId("server-sending-alert")).toHaveAttribute(
          "data-kind",
          ServerSendingAlertKind.EmailFailing,
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("opening and closing the dialog without saving asks nothing again", async () => {
    stored = { ...SMTP_INSTANCE };

    await renderPageWithBanner();
    await bannerSaysEmailIsNotSetUp();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));
    });
    await settle();

    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    expect(statusReads).toBe(1);
    await bannerSaysEmailIsNotSetUp();
  });
});

/*
 * How the instance sends its email: two plain answers, each with its line,
 * where a dropdown listed the enum's names (Sendgrid first) under a
 * description that only said "Email Server Type" again. The stored values
 * are the enum's, as before, and the card names the answer the way the
 * dialog does.
 */
// One answer of the Email Server Type: a card in the card picker.
function serverTypeCard(dialog: HTMLElement, value: string): HTMLElement {
  return within(dialog).getByTestId(`card-select-option-${value}`);
}

describe("Admin > Settings > Email > Email Server Settings", () => {
  async function serverCard(locale: Locale = ENGLISH): Promise<HTMLElement> {
    const title: string = text(locale, "pages.settings.email.serverCardTitle");
    let card: HTMLElement | undefined = undefined;

    await waitFor(
      () => {
        card = screen
          .getAllByTestId("card")
          .find((candidate: HTMLElement): boolean => {
            return within(candidate).queryByText(title) !== null;
          });

        expect(card).toBeDefined();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    return card!;
  }

  async function openServerDialog(card: HTMLElement): Promise<HTMLElement> {
    const editButton: string = text(
      ENGLISH,
      "pages.settings.email.serverEditButton",
    );

    await waitFor(
      () => {
        expect(
          within(card).getByRole("button", { name: editButton }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    fireEvent.click(within(card).getByRole("button", { name: editButton }));

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    return screen.getByTestId("modal");
  }

  test("the dialog is titled like the button that opens it", async () => {
    await renderPage();

    const dialog: HTMLElement = await openServerDialog(await serverCard());

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      /^Edit Server$/,
    );
    expect(text(ENGLISH, "pages.settings.email.serverEditButton")).toBe(
      "Edit Server",
    );
  });

  test("each card says what it is for, not what to do", () => {
    const email: Record<string, string> = (
      (ENGLISH["pages"] as Record<string, unknown>)["settings"] as Record<
        string,
        Record<string, string>
      >
    )["email"] as Record<string, string>;

    expect(email["adminNotificationCardDescription"]).toBe(
      "Where OneUptime writes about this server, such as when a probe goes offline.",
    );
    expect(email["serverCardDescription"]).toBe(
      "How this server sends its email.",
    );
    expect(email["smtpCardDescription"]).toBe(
      "The mail server OneUptime sends through, and who the emails come from.",
    );
    // SendGrid as the company writes it, as the dialog's answer does.
    expect(email["sendgridCardTitle"]).toBe("SendGrid Settings");
    expect(email["sendgridCardDescription"]).toBe(
      "Your SendGrid API key, and who the emails come from.",
    );

    for (const description of [
      email["adminNotificationCardDescription"],
      email["serverCardDescription"],
      email["smtpCardDescription"],
      email["sendgridCardDescription"],
    ]) {
      expect(description).not.toMatch(
        /^(Enter|Pick|Please)\b|would like to|Sendgrid/,
      );
    }
  });

  test("the SendGrid card and field say SendGrid, in every language", async () => {
    stored = { ...SMTP_INSTANCE, emailServerType: EmailServerType.Sendgrid };

    await renderPage();

    await waitFor(
      () => {
        expect(screen.getByText("SendGrid Settings")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(screen.queryByText(/Sendgrid/)).toBeNull();

    for (const locale of ["en", ...ADMIN_DASHBOARD_LANGUAGES]) {
      const strings: Locale = readLocale(locale);

      expect({
        locale,
        title: text(strings, "pages.settings.email.sendgridCardTitle"),
      }).toEqual({
        locale,
        title: expect.stringContaining("SendGrid"),
      });
      expect({ locale, field: text(strings, "SendGrid API Key") }).toEqual({
        locale,
        field: expect.stringContaining("SendGrid"),
      });
      expect({ locale, old: strings["Sendgrid API Key"] }).toEqual({
        locale,
        old: undefined,
      });
    }
  });

  test("the card names the stored answer as the dialog does", async () => {
    stored = { ...SMTP_INSTANCE, emailServerType: EmailServerType.Sendgrid };

    await renderPage();

    const card: HTMLElement = await serverCard();

    await waitFor(
      () => {
        expect(within(card).getByText("SendGrid")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).queryByText("Sendgrid")).toBeNull();
  });

  test("the dialog offers a card an answer, each with its line, the stored one picked, and saves the one picked", async () => {
    stored = { ...SMTP_INSTANCE, emailServerType: EmailServerType.Sendgrid };

    await renderPage();

    const dialog: HTMLElement = await openServerDialog(await serverCard());

    await waitFor(
      () => {
        expect(
          serverTypeCard(dialog, EmailServerType.Sendgrid),
        ).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const answers: Array<string | null> = within(dialog)
      .getAllByRole("radio")
      .map((card: HTMLElement): string | null => {
        return card.getAttribute("data-card-select-value");
      });

    // Its own mail server first: the default.
    expect(answers).toEqual([
      EmailServerType.CustomSMTP,
      EmailServerType.AmazonSES,
      EmailServerType.Sendgrid,
      EmailServerType.Mailgun,
      EmailServerType.Postmark,
      EmailServerType.Resend,
    ]);
    for (const line of [
      "Send through your own mail server.",
      "Send through your SendGrid account.",
      "Send through Amazon SES with an access key or this server's IAM role.",
      "Send through Mailgun's API with an API key and a sending domain.",
      "Send through Postmark's API with a server API token.",
      "Send through Resend's API with an API key.",
    ]) {
      expect(within(dialog).getByText(line)).toBeVisible();
    }
    // No dropdown of the enum's names.
    expect(
      within(dialog).queryByRole("button", { name: "Pick Sendgrid" }),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(serverTypeCard(dialog, EmailServerType.CustomSMTP));
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(savedValues()["emailServerType"]).toBe(EmailServerType.CustomSMTP);
  });

  test("an instance that never picked one reads, and opens on, Custom SMTP: what the mail service sends through", async () => {
    // The record comes back without the column at all.
    stored = { ...SMTP_INSTANCE };
    delete stored["emailServerType"];

    await renderPage();

    const card: HTMLElement = await serverCard();

    await waitFor(
      () => {
        expect(within(card).getByText("Custom SMTP")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const dialog: HTMLElement = await openServerDialog(card);

    await waitFor(
      () => {
        expect(
          serverTypeCard(dialog, EmailServerType.CustomSMTP),
        ).toHaveAttribute("aria-checked", "true");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(serverTypeCard(dialog, EmailServerType.Sendgrid)).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a record that holds no answer (null) reads Custom SMTP on the card too", async () => {
    stored = { ...SMTP_INSTANCE, emailServerType: null };

    await renderPage();

    const card: HTMLElement = await serverCard();

    await waitFor(
      () => {
        expect(within(card).getByText("Custom SMTP")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("reads in the Admin Dashboard's languages: German", async () => {
    await renderPage("de");

    const card: HTMLElement = await serverCard(GERMAN);

    await waitFor(
      () => {
        expect(
          within(card).getByText(text(GERMAN, "Custom SMTP")),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(text(GERMAN, "Custom SMTP")).toBe("Benutzerdefiniertes SMTP");
  });
});

/*
 * THE SERVER'S OWN PROVIDERS: an Email Server Type of Amazon SES, Mailgun,
 * Postmark or Resend shows that provider's card in the Custom SMTP card's
 * place - its status, what tells the account apart, and its sender - and
 * the card's dialog asks the provider's own step, then Sender, from the
 * builder a project's form is made from.
 */
describe("Admin > Settings > Email > a provider's own card", () => {
  async function cardTitled(title: string): Promise<HTMLElement> {
    let card: HTMLElement | undefined = undefined;

    await waitFor(
      () => {
        card = screen
          .getAllByTestId("card")
          .find((candidate: HTMLElement): boolean => {
            return within(candidate).queryByText(title) !== null;
          });

        expect(card).toBeDefined();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    return card!;
  }

  const SES_INSTANCE: Record<string, unknown> = {
    ...SMTP_INSTANCE,
    emailServerType: EmailServerType.AmazonSES,
    amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
    amazonSesSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    amazonSesRegion: "eu-west-1",
    amazonSesFromEmail: "alerts@example.com",
    amazonSesFromName: "Example Alerts",
  };

  test("Amazon SES: its card in the Custom SMTP card's place, Enabled, with its Region and access key ID - never its secret", async () => {
    stored = { ...SES_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(within(card).getByText("Enabled")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).getByText("eu-west-1")).toBeVisible();
    expect(within(card).getByText("AKIAIOSFODNN7EXAMPLE")).toBeVisible();
    expect(within(card).getByText("alerts@example.com")).toBeVisible();
    expect(card.textContent).not.toContain(
      "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    );
    expect(
      within(card).getByText(
        "How this server signs in to Amazon SES, its Region, and who the emails come from.",
      ),
    ).toBeVisible();

    // The SMTP card and SendGrid's are not drawn.
    expect(
      screen.queryByText(text(ENGLISH, "pages.settings.email.smtpCardTitle")),
    ).toBeNull();
    expect(screen.queryByText("SendGrid Settings")).toBeNull();
  });

  test("Amazon SES: says what it still needs, the key first", async () => {
    stored = {
      ...SES_INSTANCE,
      amazonSesSecretAccessKey: null,
    };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(
          within(card).getByText("Not Enabled. Please add the access key."),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("Amazon SES: its dialog asks Amazon SES's step, then Sender, and saves what it holds", async () => {
    stored = { ...SES_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    fireEvent.click(
      within(card).getByRole("button", { name: "Edit Amazon SES" }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const dialog: HTMLElement = screen.getByTestId("modal");

    expect(within(dialog).getByTestId("modal-title")).toHaveTextContent(
      /^Edit Amazon SES$/,
    );

    await waitForField(dialog, "AKIAIOSFODNN7EXAMPLE");
    expect(stepTitles(dialog)).toEqual(["Amazon SES", "Sender"]);
    expect(
      (within(dialog).getByPlaceholderText("us-east-1") as HTMLInputElement)
        .value,
    ).toBe("eu-west-1");

    await act(async () => {
      fireEvent.change(within(dialog).getByPlaceholderText("us-east-1"), {
        target: { value: "us-west-2" },
      });
    });

    await save(dialog);

    expect({
      amazonSesAccessKeyId: savedValues()["amazonSesAccessKeyId"],
      amazonSesRegion: savedValues()["amazonSesRegion"],
      amazonSesFromName: savedValues()["amazonSesFromName"],
    }).toEqual({
      amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      amazonSesRegion: "us-west-2",
      amazonSesFromName: "Example Alerts",
    });
  });

  /*
   * How the server signs in to Amazon SES (#7000): an access key, or the IAM
   * role AWS gives the server itself, with no key stored.
   */
  const SES_ROLE_INSTANCE: Record<string, unknown> = {
    ...SES_INSTANCE,
    amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
    amazonSesAccessKeyId: null,
    amazonSesSecretAccessKey: null,
  };

  async function openSesDialog(): Promise<HTMLElement> {
    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    fireEvent.click(
      within(card).getByRole("button", { name: "Edit Amazon SES" }),
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const dialog: HTMLElement = screen.getByTestId("modal");

    await waitForField(dialog, "us-east-1");

    return dialog;
  }

  function signIn(dialog: HTMLElement, name: string): HTMLElement {
    return within(
      within(dialog).getByTestId("amazon-ses-authentication-type"),
    ).getByRole("radio", { name });
  }

  test("Amazon SES: the card says it signs in with an access key, when the server never picked how", async () => {
    stored = { ...SES_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(within(card).getByText("Authentication Type")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).getByText("Access Key")).toBeVisible();
    expect(within(card).getByText("Access Key ID")).toBeVisible();
  });

  test("Amazon SES with this server's IAM role: Enabled with no key, the role named, and no access key ID", async () => {
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(within(card).getByText("Enabled")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).getByText("This Server's IAM Role")).toBeVisible();
    expect(within(card).getByText("eu-west-1")).toBeVisible();
    expect(within(card).getByText("alerts@example.com")).toBeVisible();
    // No key to tell apart: the row is not drawn, not drawn empty.
    expect(within(card).queryByText("Access Key ID")).toBeNull();
    expect(
      within(card).queryByText("Not Enabled. Please add the access key."),
    ).toBeNull();
  });

  test("Amazon SES with this server's IAM role still needs its Region", async () => {
    stored = { ...SES_ROLE_INSTANCE, amazonSesRegion: null };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(
          within(card).getByText(
            text(ENGLISH, "pages.settings.email.pillNoRegion"),
          ),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("Amazon SES: the dialog starts on the access key; picking this server's IAM role asks for no key, and saves the role", async () => {
    // A server set up before the choice: its row holds null, as the migration left it.
    stored = { ...SES_INSTANCE, amazonSesAuthenticationType: null };

    await renderPage();

    const dialog: HTMLElement = await openSesDialog();

    // A server that never picked one signs in with its access key.
    expect(signIn(dialog, "Access Key")).toBeChecked();
    expect(signIn(dialog, "This Server's IAM Role")).not.toBeChecked();
    expect(
      within(dialog).getByPlaceholderText("AKIAIOSFODNN7EXAMPLE"),
    ).toBeVisible();
    // Each answer says what it is.
    expect(
      within(dialog).getByText(
        "The role AWS gives this server on Amazon EKS, ECS or EC2. No key is stored, and its credentials renew on their own.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText("How OneUptime signs in to Amazon SES."),
    ).toBeVisible();

    await act(async () => {
      fireEvent.click(signIn(dialog, "This Server's IAM Role"));
    });
    await settle();

    expect(signIn(dialog, "This Server's IAM Role")).toBeChecked();
    expect(
      within(dialog).queryByPlaceholderText("AKIAIOSFODNN7EXAMPLE"),
    ).toBeNull();
    expect(
      within(dialog).queryByPlaceholderText("Secret access key"),
    ).toBeNull();
    expect(
      (within(dialog).getByPlaceholderText("us-east-1") as HTMLInputElement)
        .value,
    ).toBe("eu-west-1");

    await save(dialog);

    expect({
      amazonSesAuthenticationType: savedValues()["amazonSesAuthenticationType"],
      amazonSesRegion: savedValues()["amazonSesRegion"],
    }).toEqual({
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
    });
  });

  test("Amazon SES: a server on its IAM role opens on it with no key asked, and an access key asks for one again", async () => {
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage();

    const dialog: HTMLElement = await openSesDialog();

    expect(signIn(dialog, "This Server's IAM Role")).toBeChecked();
    expect(
      within(dialog).queryByPlaceholderText("AKIAIOSFODNN7EXAMPLE"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(signIn(dialog, "Access Key"));
    });
    await settle();

    expect(
      within(dialog).getByPlaceholderText("AKIAIOSFODNN7EXAMPLE"),
    ).toBeVisible();
    expect(
      within(dialog).getByPlaceholderText("Secret access key"),
    ).toBeVisible();
  });

  test("Amazon SES: the sign-in reads in the Admin Dashboard's languages: German", async () => {
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage("de");

    const card: HTMLElement = await cardTitled(
      text(GERMAN, "pages.settings.email.amazonSesCardTitle"),
    );

    await waitFor(
      () => {
        expect(
          within(card).getByText(text(GERMAN, "This Server's IAM Role")),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(text(GERMAN, "This Server's IAM Role")).toBe(
      "IAM-Rolle dieses Servers",
    );
    expect(
      within(card).getByText(text(GERMAN, "Authentication Type")),
    ).toBeVisible();
  });

  /*
   * Which AWS identity the server signs in as (#7380): asked of the server
   * when the card shows in role mode, never in access key mode.
   */
  const identityAsks: () => Array<string> = (): Array<string> => {
    return (API.fetch as unknown as MockFunction).mock.calls
      .map((call: Array<unknown>): string => {
        return String((call[0] as { url: unknown }).url);
      })
      .filter((url: string): boolean => {
        return url.includes(SERVER_AWS_IDENTITY_ROUTE);
      });
  };

  // The server's answers, in order: the last one again once they run out.
  const answerIdentityWith: (answers: Array<JSONObject | null>) => void = (
    answers: Array<JSONObject | null>,
  ): void => {
    let asked: number = 0;

    getJestSpyOn(API, "fetch").mockImplementation((async (
      options: unknown,
    ): Promise<unknown> => {
      const url: string = String((options as { url: unknown }).url);

      if (url.includes(SERVER_AWS_IDENTITY_ROUTE)) {
        const answer: JSONObject | null =
          answers[Math.min(asked, answers.length - 1)] || null;

        asked++;

        return answer
          ? new HTTPResponse<JSONObject>(200, answer, {})
          : new HTTPErrorResponse(
              422,
              {
                message:
                  "Unauthorized: Only master admins can perform this action.",
              },
              {},
            );
      }

      return new HTTPErrorResponse(404, { message: "Not found." }, {});
    }) as never);
  };

  const SIGNED_IN_AS_ROLE: JSONObject = {
    isSignedIn: true,
    arn: "arn:aws:sts::111122223333:assumed-role/oneuptime-ses/eks-oneuptime-app",
    account: "111122223333",
    via: ServerAwsIdentityVia.EksPodIdentity,
  };

  test("Amazon SES with this server's IAM role: the card names the identity it signs in as, asked in its Region", async () => {
    answerIdentityWith([SIGNED_IN_AS_ROLE]);
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(
          within(card).getByTestId("server-aws-identity-arn"),
        ).toHaveTextContent(
          "arn:aws:sts::111122223333:assumed-role/oneuptime-ses/eks-oneuptime-app",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).getByText("Signs In As")).toBeVisible();
    expect(
      within(card).getByText(
        "From EKS Pod Identity. A test email shows whether it may send.",
      ),
    ).toBeVisible();

    // GET, once, for the card's own Region.
    expect(identityAsks()).toHaveLength(1);
    expect(identityAsks()[0]).toContain("region=eu-west-1");

    const asked: { method?: unknown } = (
      API.fetch as unknown as MockFunction
    ).mock.calls
      .map((call: Array<unknown>): { url: unknown; method?: unknown } => {
        return call[0] as { url: unknown; method?: unknown };
      })
      .find((options: { url: unknown }): boolean => {
        return String(options.url).includes(SERVER_AWS_IDENTITY_ROUTE);
      })!;

    expect(String(asked.method).toLowerCase()).toBe("get");
  });

  test("Amazon SES with this server's IAM role and no AWS credentials: the card says why, and Check again asks again", async () => {
    answerIdentityWith([
      {
        isSignedIn: false,
        problem:
          "This server has no AWS credentials. Give it an IAM role: IAM roles for service accounts or EKS Pod Identity on Amazon EKS, a task role on Amazon ECS, or an instance profile on Amazon EC2.",
      },
      SIGNED_IN_AS_ROLE,
    ]);
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(
          within(card).getByTestId("server-aws-identity-not-signed-in"),
        ).toHaveTextContent(
          "This server cannot sign in to AWS. This server has no AWS credentials. Give it an IAM role:",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await act(async () => {
      fireEvent.click(
        within(card).getByRole("button", { name: "Check again" }),
      );
    });

    await waitFor(
      () => {
        expect(
          within(card).getByTestId("server-aws-identity-arn"),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(identityAsks()).toHaveLength(2);
  });

  test("Amazon SES with this server's IAM role: a refused request says so, and is not taken for the server's answer", async () => {
    answerIdentityWith([null]);
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(
          within(card).getByTestId("server-aws-identity-error"),
        ).toHaveTextContent(
          "Couldn't ask the server which AWS identity it signs in as.",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).queryByTestId("server-aws-identity-arn")).toBeNull();
    expect(
      within(card).getByRole("button", { name: "Check again" }),
    ).toBeVisible();
  });

  test("Amazon SES with an access key: no identity row, and the server is never asked", async () => {
    answerIdentityWith([SIGNED_IN_AS_ROLE]);
    stored = { ...SES_INSTANCE };

    await renderPage();

    const card: HTMLElement = await cardTitled("Amazon SES Settings");

    await waitFor(
      () => {
        expect(within(card).getByText("Access Key ID")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    expect(within(card).queryByText("Signs In As")).toBeNull();
    expect(identityAsks()).toHaveLength(0);
  });

  test("Amazon SES: the identity row reads in the Admin Dashboard's languages: German", async () => {
    answerIdentityWith([SIGNED_IN_AS_ROLE]);
    stored = { ...SES_ROLE_INSTANCE };

    await renderPage("de");

    const card: HTMLElement = await cardTitled(
      text(GERMAN, "pages.settings.email.amazonSesCardTitle"),
    );

    await waitFor(
      () => {
        expect(
          within(card).getByTestId("server-aws-identity-arn"),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).getByText(text(GERMAN, "Signs In As"))).toBeVisible();
    expect(text(GERMAN, "Signs In As")).toBe("Meldet sich an als");
    expect(
      within(card).getByText(
        `${text(GERMAN, "From EKS Pod Identity.")} ${text(GERMAN, "A test email shows whether it may send.")}`,
      ),
    ).toBeVisible();
  });

  /*
   * #8183: a provider card's From Name starts on the product's name too,
   * as the sender sends a blank one (Notification/Config.ts).
   */
  test("Mailgun: a server that never named its sender starts the From Name on OneUptime, and saves it", async () => {
    stored = {
      ...SMTP_INSTANCE,
      emailServerType: EmailServerType.Mailgun,
      mailgunApiKey: "key-0123",
      mailgunDomain: "mg.example.com",
      mailgunRegion: "EU",
      mailgunFromEmail: "alerts@mg.example.com",
      mailgunFromName: null,
    };

    await renderPage();

    const card: HTMLElement = await cardTitled("Mailgun Settings");

    fireEvent.click(within(card).getByRole("button", { name: "Edit Mailgun" }));

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const dialog: HTMLElement = screen.getByTestId("modal");

    await settle();
    await openLastStep(dialog);

    expect(await waitForField(dialog, "Company, Inc.")).toHaveValue(
      "OneUptime",
    );

    await save(dialog);

    expect(savedValues()["mailgunFromName"]).toBe("OneUptime");
  });

  test("Amazon SES: a sender named by the server keeps its name (#8183)", async () => {
    stored = { ...SES_INSTANCE };

    await renderPage();

    const dialog: HTMLElement = await openSesDialog();

    await openLastStep(dialog);

    expect(await waitForField(dialog, "Company, Inc.")).toHaveValue(
      "Example Alerts",
    );
  });

  test("Mailgun: its domain and region on the card", async () => {
    stored = {
      ...SMTP_INSTANCE,
      emailServerType: EmailServerType.Mailgun,
      mailgunApiKey: "key-0123",
      mailgunDomain: "mg.example.com",
      mailgunRegion: "EU",
      mailgunFromEmail: "alerts@mg.example.com",
    };

    await renderPage();

    const card: HTMLElement = await cardTitled("Mailgun Settings");

    await waitFor(
      () => {
        expect(within(card).getByText("Enabled")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).getByText("mg.example.com")).toBeVisible();
    expect(within(card).getByText("EU")).toBeVisible();
  });

  test.each([
    [
      EmailServerType.Postmark,
      "Postmark Settings",
      "Not Enabled. Please add the server API token.",
    ],
    [
      EmailServerType.Resend,
      "Resend Settings",
      "Not Enabled. Please add the API key.",
    ],
  ])(
    "%s: a card that says what it still needs",
    async (serverType: EmailServerType, title: string, pill: string) => {
      stored = { ...SMTP_INSTANCE, emailServerType: serverType };

      await renderPage();

      const card: HTMLElement = await cardTitled(title);

      await waitFor(
        () => {
          expect(within(card).getByText(pill)).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
    },
  );

  test("Resend is Resend in every language, never the verb it is in the locales", async () => {
    stored = {
      ...SMTP_INSTANCE,
      emailServerType: EmailServerType.Resend,
      resendApiKey: "re_key",
      resendFromEmail: "alerts@example.com",
    };

    await renderPage("de");

    const serverCardTitle: string = text(
      GERMAN,
      "pages.settings.email.serverCardTitle",
    );
    const server: HTMLElement = await cardTitled(serverCardTitle);

    await waitFor(
      () => {
        expect(within(server).getByText("Resend")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const resendTitle: string = text(
      GERMAN,
      "pages.settings.email.resendCardTitle",
    );

    expect(resendTitle).toContain("Resend");
    await cardTitled(resendTitle);
  });

  test("every card's words are in every language the Admin Dashboard speaks", () => {
    for (const locale of ["en", ...ADMIN_DASHBOARD_LANGUAGES]) {
      const strings: Locale = readLocale(locale);

      for (const [key, product] of [
        ["amazonSesCardTitle", "Amazon SES"],
        ["amazonSesEditButton", "Amazon SES"],
        ["mailgunCardTitle", "Mailgun"],
        ["mailgunEditButton", "Mailgun"],
        ["postmarkCardTitle", "Postmark"],
        ["postmarkEditButton", "Postmark"],
        ["resendCardTitle", "Resend"],
        ["resendEditButton", "Resend"],
      ] as Array<[string, string]>) {
        expect({
          locale,
          key,
          names: text(strings, `pages.settings.email.${key}`).includes(product),
        }).toEqual({ locale, key, names: true });
      }

      for (const key of [
        "amazonSesCardDescription",
        "mailgunCardDescription",
        "postmarkCardDescription",
        "resendCardDescription",
        "pillNoAccessKey",
        "pillNoRegion",
        "pillNoDomain",
        "pillNoServerToken",
      ]) {
        expect({
          locale,
          key,
          translated: text(strings, `pages.settings.email.${key}`).length > 0,
        }).toEqual({ locale, key, translated: true });
      }
    }
  });
});
