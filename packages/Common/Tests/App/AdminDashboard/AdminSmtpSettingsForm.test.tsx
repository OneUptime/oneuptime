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
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import UserUtil from "../../../UI/Utils/User";
import { ADMIN_DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

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
      fireEvent.click(last);
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
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
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

  test("the card's Authentication Type reads as the dialog's answer, in the reader's language", async () => {
    stored = {
      ...SMTP_INSTANCE,
      smtpAuthType: SMTPAuthenticationType.None,
      smtpUsername: null,
    };

    await renderPage("de");

    const card: HTMLElement = await smtpCard(GERMAN);

    // The answer "None", in German: not the stored English.
    await waitFor(
      () => {
        expect(within(card).getByText(text(GERMAN, "None"))).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(text(GERMAN, "None")).toBe("Keine");
  });

  test("an instance that never picked a sign-in reads Username and Password, translated", async () => {
    stored = { ...SMTP_INSTANCE, smtpAuthType: null };

    await renderPage("de");

    const card: HTMLElement = await smtpCard(GERMAN);

    await waitFor(
      () => {
        expect(
          within(card).getByText(text(GERMAN, "Username and Password")),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(card).queryByText("Username and Password")).toBeNull();
  });

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
