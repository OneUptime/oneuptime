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
import MailTransportType from "../../../Types/Email/MailTransportType";
import OAuthProviderType from "../../../Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "../../../Types/Email/SMTPAuthenticationType";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import UserUtil from "../../../UI/Utils/User";

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

function stepTitles(dialog: HTMLElement): Array<string> {
  const progress: HTMLElement = within(dialog).getByRole("navigation", {
    name: "Progress",
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

async function save(dialog: HTMLElement): Promise<void> {
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

    const header: HTMLElement = advancedHeader(dialog, "Advanced");

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
    expect(
      within(dialog).getByRole("button", { name: "Pick Microsoft Graph" }),
    ).toBeVisible();

    // Saves from any step.
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

  test("an instance without a port shows 587 only as a placeholder", async () => {
    stored = { ...SMTP_INSTANCE, smtpPort: null, isSMTPSecure: null };

    await renderPage();

    const dialog: HTMLElement = await openEditDialog();

    await waitForField(dialog, "smtp.server.com");

    expect(within(dialog).getByPlaceholderText("587")).toHaveValue("");
    // Never set: the mail service does not require TLS.
    expect(summaryOf(dialog)).toBe(
      "Mail is sent over SMTP, signing in with the username and password. TLS is used only if the server offers it.",
    );

    // The port is still asked for: nothing is saved without one.
    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });
    await settle();

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
    expect(advancedHeader(dialog, "Advanced")).toHaveAttribute(
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
      fireEvent.click(advancedHeader(dialog, "Advanced"));
    });
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Pick Microsoft Graph" }),
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

  test("reads in the Admin Dashboard's languages: German", async () => {
    await renderPage("de");

    const dialog: HTMLElement = await openEditDialog(GERMAN);

    await waitForField(dialog, "smtp.server.com");

    const titles: Array<string> = stepTitles(dialog);

    expect(text(GERMAN, "Sender")).toBe("Absender");
    expect(titles[0]).toContain(text(GERMAN, "Server"));
    expect(titles[1]).toContain("Absender");

    expect(summaryOf(dialog)).toBe(
      `${text(GERMAN, "Mail is sent over SMTP, signing in with the username and password.")} ${text(GERMAN, "TLS is required.")}`,
    );
    expect(summaryOf(dialog)).not.toContain("Mail is sent");

    await act(async () => {
      fireEvent.click(advancedHeader(dialog, text(GERMAN, "Advanced")));
    });

    expect(
      within(dialog).getByRole("switch", { name: "TLS erzwingen" }),
    ).toBeVisible();
    expect(within(dialog).getByText(text(GERMAN, "Username"))).toBeVisible();
  });
});
