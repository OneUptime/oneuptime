import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
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
 * ADMIN DASHBOARD > SETTINGS > EMAILS, WHEN ENVIRONMENT VARIABLES SET THE
 * SERVER'S EMAIL SETTINGS (#7738) - on the real page, cards and Detail, in
 * the Admin Dashboard's own English; only the network, the page chrome and
 * the side menu are stand-ins.
 *
 * Once GLOBAL_EMAIL_SERVER_TYPE is set, the page shows the settings the
 * variables set in place of the saved ones: each field with the variable
 * that sets it, whether each password or key is set (never its value),
 * what is wrong with them, what they set that nothing reads, and no Edit
 * button - the server refuses the write. Variables set without it are read
 * by nothing: the saved settings stay, editable, under a warning that names
 * them. A server that cannot say keeps the page as it was. The Admin
 * Notification Email is not the variables' and stays editable throughout.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: async (): Promise<unknown> => {
        return { data: {} };
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

import AdminI18n from "../../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import EmailSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/Index";
import {
  SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID,
  SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES,
  SERVER_EMAIL_ENVIRONMENT_IGNORED_TEST_ID,
  SERVER_EMAIL_ENVIRONMENT_LOADING_TEST_ID,
  SERVER_EMAIL_ENVIRONMENT_UNUSED_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Email/ServerEmailEnvironmentCard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { EmailServerType } from "../../../Models/DatabaseModels/GlobalConfig";
import Hostname from "../../../Types/API/Hostname";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import ServerEmailEnvironment, {
  SERVER_EMAIL_ENVIRONMENT_ROUTE,
  SERVER_EMAIL_ENVIRONMENT_VARIABLES,
  ServerEmailEnvironmentAnswer,
  ServerEmailEnvironmentVariable,
} from "../../../Types/Email/ServerEmailEnvironment";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";
import { withoutIsolates } from "../../../UI/Utils/CodeReadsAsWritten";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

const WAIT_FOR_TIMEOUT: number = 20000;

const V: typeof ServerEmailEnvironmentVariable = ServerEmailEnvironmentVariable;

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

const ENGLISH: Locale = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Locale;

const EMAIL: Record<string, string> = (
  (ENGLISH["pages"] as Locale)["settings"] as Locale
)["email"] as Record<string, string>;

// The saved settings' Edit buttons, which the variables' settings never have.
const SAVED_EDIT_BUTTONS: Array<string> = [
  EMAIL["serverEditButton"]!,
  EMAIL["smtpEditButton"]!,
];

const PASSWORD: string = "environment-smtp-password-sentinel-7738";
const SAVED_HOST: string = "saved-smtp.example.com";

// The settings an admin saved, which the page reads for its own cards.
const SAVED: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpHost: new Hostname(SAVED_HOST),
  smtpPort: new Port(25),
  smtpUsername: "saved-user",
  smtpFromEmail: new Email("saved@example.com"),
  smtpFromName: "Saved Sender",
  adminNotificationEmail: new Email("admin@example.com"),
};

// What GET /global-config/email-environment answers, per test.
let environmentAnswer: () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;
let fetchSpy: jest.SpyInstance;

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
  select: Record<string, unknown>;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
  Object.assign(item, SAVED);

  return item;
}

type Values = Partial<Record<ServerEmailEnvironmentVariable, string>>;

// The answer the server gives for these variables, as it sends it.
function answerFor(values: Values): () => Promise<HTTPResponse<JSONObject>> {
  const answer: ServerEmailEnvironmentAnswer = ServerEmailEnvironment.toAnswer(
    ServerEmailEnvironment.read(values),
  );

  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      JSON.parse(JSON.stringify(answer)) as JSONObject,
      {},
    );
  };
}

// A mail server the variables set, with its password.
function environmentSmtp(values: Values = {}): Values {
  return {
    [V.ServerType]: "custom-smtp",
    [V.SmtpHost]: "smtp.example.com",
    [V.SmtpPort]: "587",
    [V.SmtpUsername]: "mailer",
    [V.SmtpPassword]: PASSWORD,
    [V.FromEmail]: "alerts@example.com",
    [V.FromName]: "Alerts",
    ...values,
  };
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={instance}>
      <EmailSettings />
    </I18nextProvider>,
  );

  await settle();
}

async function environmentCard(): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(
        screen.getByTestId(SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByTestId(SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID);
}

/*
 * The value a Detail field shows, found by the variable that sets it - the
 * field's description, which only that field has.
 */
function fieldValue(card: HTMLElement, variable: string): string {
  const description: HTMLElement = within(card).getByText(variable);
  let field: HTMLElement | null = description.parentElement;

  // Up to the element that holds the title, the description and the value.
  while (
    field &&
    !(field.textContent || "").includes(
      SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES[
        variable as ServerEmailEnvironmentVariable
      ],
    )
  ) {
    field = field.parentElement;
  }

  while (field && (field.textContent || "").trim() === variable) {
    field = field.parentElement;
  }

  return (field?.parentElement?.textContent || "")
    .replace(variable, "")
    .replace(
      SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES[
        variable as ServerEmailEnvironmentVariable
      ],
      "",
    )
    .trim();
}

async function savedCardEditButton(name: string): Promise<HTMLElement> {
  let button: HTMLElement | null = null;

  await waitFor(
    () => {
      button = screen.getByRole("button", { name: name });
      expect(button).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return button as unknown as HTMLElement;
}

function expectNoSavedSettingsEditButton(): void {
  for (const name of SAVED_EDIT_BUTTONS) {
    expect(screen.queryByRole("button", { name: name })).toBeNull();
  }
}

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

  environmentAnswer = answerFor({});

  fetchSpy = getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const url: string = String((options as { url: URL }).url);

      if (url.endsWith(SERVER_EMAIL_ENVIRONMENT_ROUTE)) {
        return environmentAnswer();
      }

      // Everything else the page asks - the setup checklist - is not answered.
      return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("set by environment variables", () => {
  test("asks the server once, with a GET to its route", async () => {
    environmentAnswer = answerFor(environmentSmtp());

    await renderPage();
    await environmentCard();

    const calls: Array<unknown> = fetchSpy.mock.calls
      .map((call: Array<unknown>): unknown => {
        return call[0];
      })
      .filter((options: unknown): boolean => {
        return String((options as { url: URL }).url).endsWith(
          SERVER_EMAIL_ENVIRONMENT_ROUTE,
        );
      });

    expect(calls).toHaveLength(1);
    expect((calls[0] as { method: HTTPMethod }).method).toBe(HTTPMethod.GET);
    expect(String((calls[0] as { url: URL }).url)).toBe(
      URL.fromURL(APP_API_URL).toString().replace(/\/$/, "") +
        SERVER_EMAIL_ENVIRONMENT_ROUTE,
    );
  });

  test("shows the variables' mail server in place of the saved one, each field with its variable, and no Edit button", async () => {
    environmentAnswer = answerFor(environmentSmtp());

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(within(card).getByText(EMAIL["serverCardTitle"]!)).toBeVisible();
    expect(
      within(card).getByText(EMAIL["environmentCardDescription"]!),
    ).toBeVisible();

    // Each field names the variable that sets it, in the order the page lists them.
    const variables: Array<string> = [
      "GLOBAL_EMAIL_SERVER_TYPE",
      "GLOBAL_EMAIL_SMTP_TRANSPORT",
      "GLOBAL_EMAIL_SMTP_HOST",
      "GLOBAL_EMAIL_SMTP_PORT",
      "GLOBAL_EMAIL_SMTP_REQUIRE_TLS",
      "GLOBAL_EMAIL_SMTP_AUTH_TYPE",
      "GLOBAL_EMAIL_SMTP_USERNAME",
      "GLOBAL_EMAIL_SMTP_PASSWORD",
      "GLOBAL_EMAIL_FROM_EMAIL",
      "GLOBAL_EMAIL_FROM_NAME",
    ];

    for (const variable of variables) {
      expect(within(card).getByText(variable)).toBeVisible();
    }

    const text: string = card.textContent || "";
    const positions: Array<number> = variables.map(
      (variable: string): number => {
        return text.indexOf(variable);
      },
    );

    expect(positions).toEqual(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    );

    // Each value as the saved card would read it.
    expect(fieldValue(card, "GLOBAL_EMAIL_SERVER_TYPE")).toBe("Custom SMTP");
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_TRANSPORT")).toBe("SMTP");
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_HOST")).toBe("smtp.example.com");
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_PORT")).toBe("587");
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_REQUIRE_TLS")).toBe("No");
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_AUTH_TYPE")).toBe(
      "Username and Password",
    );
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_USERNAME")).toBe("mailer");
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_PASSWORD")).toBe(
      EMAIL["environmentValueSet"],
    );
    expect(fieldValue(card, "GLOBAL_EMAIL_FROM_EMAIL")).toBe(
      "alerts@example.com",
    );
    expect(fieldValue(card, "GLOBAL_EMAIL_FROM_NAME")).toBe("Alerts");

    // Nothing to edit here, and the saved settings are not shown at all.
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expectNoSavedSettingsEditButton();
    expect(screen.queryByText(SAVED_HOST)).toBeNull();
    expect(screen.queryByText(EMAIL["smtpCardTitle"]!)).toBeNull();
    expect(
      screen.queryByText(EMAIL["serverCardDescription"]!),
    ).not.toBeInTheDocument();
    // Never the password: the server does not send it, and nothing draws it.
    expect(document.body.textContent).not.toContain(PASSWORD);
    // Nothing to warn about.
    expect(
      within(card).queryByText(EMAIL["environmentProblemsTitle"]!),
    ).toBeNull();
    expect(
      screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_IGNORED_TEST_ID),
    ).toBeNull();
  });

  test("the Admin Notification Email is not the variables': still shown, still editable", async () => {
    environmentAnswer = answerFor(environmentSmtp());

    await renderPage();
    await environmentCard();

    expect(
      await savedCardEditButton(EMAIL["adminNotificationEditButton"]!),
    ).toBeEnabled();
    expect(
      screen.getByRole("heading", {
        name: EMAIL["adminNotificationCardTitle"]!,
      }),
    ).toBeVisible();
    expect(screen.getByText("admin@example.com")).toBeVisible();
  });

  test("SendGrid: its own name, and whether the API key is set", async () => {
    environmentAnswer = answerFor({
      [V.ServerType]: "SendGrid",
      [V.SendgridApiKey]: "SG.environment-key",
      [V.FromEmail]: "alerts@example.com",
      [V.FromName]: "Alerts",
    });

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(fieldValue(card, "GLOBAL_EMAIL_SERVER_TYPE")).toBe("SendGrid");
    expect(fieldValue(card, "GLOBAL_EMAIL_SENDGRID_API_KEY")).toBe(
      EMAIL["environmentValueSet"],
    );
    expect(within(card).queryByText("GLOBAL_EMAIL_SMTP_HOST")).toBeNull();
    expect(document.body.textContent).not.toContain("SG.environment-key");
  });

  test("Amazon SES signed in as the server's IAM role: no keys to set, and the Region", async () => {
    environmentAnswer = answerFor({
      [V.ServerType]: "amazon-ses",
      [V.AmazonSesAuthenticationType]: "server-iam-role",
      [V.AmazonSesRegion]: "eu-west-1",
      [V.FromEmail]: "alerts@example.com",
    });

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(fieldValue(card, "GLOBAL_EMAIL_SERVER_TYPE")).toBe("Amazon SES");
    expect(
      fieldValue(card, "GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE"),
    ).toBe("This Server's IAM Role");
    expect(fieldValue(card, "GLOBAL_EMAIL_AMAZON_SES_REGION")).toBe(
      "eu-west-1",
    );
    expect(
      within(card).queryByText("GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID"),
    ).toBeNull();
    expect(
      within(card).queryByText("GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY"),
    ).toBeNull();
    // Left empty, the name is the product's: nothing wrong.
    expect(fieldValue(card, "GLOBAL_EMAIL_FROM_NAME")).toBe(
      EMAIL["environmentValueNotSet"],
    );
    expect(
      within(card).queryByText(EMAIL["environmentProblemsTitle"]!),
    ).toBeNull();
  });

  test("Microsoft Graph: the OAuth app, its secret only as set, and no mail server", async () => {
    environmentAnswer = answerFor({
      [V.ServerType]: "custom-smtp",
      [V.SmtpTransport]: "microsoft-graph",
      [V.SmtpOAuthClientId]: "client-id",
      [V.SmtpOAuthClientSecret]: "client-secret-sentinel",
      [V.SmtpOAuthTokenUrl]:
        "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
      [V.SmtpOAuthScope]: "https://graph.microsoft.com/.default",
      [V.FromEmail]: "alerts@example.com",
      [V.FromName]: "Alerts",
    });

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_TRANSPORT")).toBe(
      "Microsoft Graph",
    );
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID")).toBe(
      "client-id",
    );
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET")).toBe(
      EMAIL["environmentValueSet"],
    );
    expect(within(card).queryByText("GLOBAL_EMAIL_SMTP_HOST")).toBeNull();
    expect(document.body.textContent).not.toContain("client-secret-sentinel");
  });

  test("with something wrong: that it sends nothing until it is fixed, and each problem, by the variable's name", async () => {
    environmentAnswer = answerFor(
      environmentSmtp({
        [V.SmtpPassword]: "",
        [V.SmtpPort]: "70000",
      }),
    );

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(
      within(card).getByText(EMAIL["environmentProblemsTitle"]!),
    ).toBeVisible();
    expect(
      within(card).getByText(
        'GLOBAL_EMAIL_SMTP_PORT: "70000" is not a port, a number from 1 to 65535 such as 587.',
      ),
    ).toBeVisible();
    expect(
      within(card).getByText(
        "GLOBAL_EMAIL_SMTP_PASSWORD is not set: the mail server is signed in to with GLOBAL_EMAIL_SMTP_USERNAME and a password. Set it, or set GLOBAL_EMAIL_SMTP_AUTH_TYPE to none to send without signing in.",
      ),
    ).toBeVisible();
    expect(fieldValue(card, "GLOBAL_EMAIL_SMTP_PASSWORD")).toBe(
      EMAIL["environmentValueNotSet"],
    );
    /*
     * English, by the variables' names: isolated, so in Persian or Arabic
     * each line still reads left to right, its full stop at its end.
     */
    expect(
      within(card).getByText(
        'GLOBAL_EMAIL_SMTP_PORT: "70000" is not a port, a number from 1 to 65535 such as 587.',
      ).tagName,
    ).toBe("BDI");
    // Still no Edit button: the settings are fixed where the variables are set.
    expectNoSavedSettingsEditButton();
  });

  test("a type that is not one: as written, beside the problem that says so", async () => {
    environmentAnswer = answerFor({ [V.ServerType]: "gmail" });

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(fieldValue(card, "GLOBAL_EMAIL_SERVER_TYPE")).toBe("gmail");
    // As written, isolated: its own direction in a right-to-left language.
    expect(within(card).getByText("gmail").tagName).toBe("BDI");
    expect(
      within(card).getByText(
        'GLOBAL_EMAIL_SERVER_TYPE must be custom-smtp, sendgrid, amazon-ses, mailgun, postmark or resend, not "gmail".',
      ),
    ).toBeVisible();
    expectNoSavedSettingsEditButton();
  });

  test("variables the chosen settings do not read: named, as changing nothing", async () => {
    environmentAnswer = answerFor({
      [V.ServerType]: "postmark",
      [V.PostmarkServerToken]: "postmark-token",
      [V.FromEmail]: "alerts@example.com",
      [V.SmtpHost]: "smtp.example.com",
      [V.SmtpPassword]: PASSWORD,
    });

    await renderPage();

    const card: HTMLElement = await environmentCard();
    const ignored: HTMLElement = within(card).getByTestId(
      SERVER_EMAIL_ENVIRONMENT_IGNORED_TEST_ID,
    );

    expect(
      within(ignored).getByText(EMAIL["environmentIgnoredTitle"]!),
    ).toBeVisible();
    expect(within(ignored).getByText("GLOBAL_EMAIL_SMTP_HOST")).toBeVisible();
    expect(
      within(ignored).getByText("GLOBAL_EMAIL_SMTP_PASSWORD"),
    ).toBeVisible();
    expect(
      within(card).queryByText(EMAIL["environmentProblemsTitle"]!),
    ).toBeNull();
    expect(document.body.textContent).not.toContain(PASSWORD);
    expect(document.body.textContent).not.toContain("postmark-token");
  });
});

describe("not set by environment variables", () => {
  test("the saved settings and their Edit buttons, with nothing to warn about", async () => {
    environmentAnswer = answerFor({});

    await renderPage();

    for (const name of SAVED_EDIT_BUTTONS) {
      expect(await savedCardEditButton(name)).toBeEnabled();
    }

    expect(
      screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_UNUSED_TEST_ID),
    ).toBeNull();
    expect(screen.getByText(EMAIL["serverCardDescription"]!)).toBeVisible();
  });

  test("variables set without the type: the saved settings stay editable, under a warning that names them", async () => {
    environmentAnswer = answerFor({
      [V.SmtpHost]: "smtp.example.com",
      [V.SmtpPassword]: PASSWORD,
    });

    await renderPage();

    expect(await savedCardEditButton(EMAIL["serverEditButton"]!)).toBeEnabled();

    const warning: HTMLElement = screen.getByTestId(
      SERVER_EMAIL_ENVIRONMENT_UNUSED_TEST_ID,
    );

    expect(
      within(warning).getByText(EMAIL["environmentUnusedTitle"]!),
    ).toBeVisible();
    expect(
      within(warning).getByText(
        "GLOBAL_EMAIL_SMTP_HOST and GLOBAL_EMAIL_SMTP_PASSWORD are set, but GLOBAL_EMAIL_SERVER_TYPE is not, so nothing reads them: the email settings saved in the Admin Dashboard are used. Set GLOBAL_EMAIL_SERVER_TYPE too, or remove them.",
      ),
    ).toBeVisible();
    expect(document.body.textContent).not.toContain(PASSWORD);
  });

  test.each([
    [
      "answers with an error",
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(500, { message: "Server error" }, {});
      },
    ],
    [
      "cannot be reached",
      async (): Promise<never> => {
        throw new Error("Network error");
      },
    ],
    [
      "answers with something that is not the answer",
      async (): Promise<HTTPResponse<JSONObject>> => {
        return new HTTPResponse<JSONObject>(
          200,
          { isSetByEnvironment: "yes" } as JSONObject,
          {},
        );
      },
    ],
  ] as Array<[string, () => Promise<HTTPErrorResponse>]>)(
    "a server that %s: the page as it was, the saved settings and their Edit buttons",
    async (_case: string, answer: () => Promise<HTTPErrorResponse>) => {
      environmentAnswer = answer;

      await renderPage();

      for (const name of SAVED_EDIT_BUTTONS) {
        expect(await savedCardEditButton(name)).toBeEnabled();
      }

      expect(
        screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID),
      ).toBeNull();
      expect(
        screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_UNUSED_TEST_ID),
      ).toBeNull();
    },
  );

  test("until the server says, neither settings and no Edit button: the card's title over a loader", async () => {
    environmentAnswer = (): Promise<never> => {
      return new Promise<never>(() => {
        // Never answers.
      });
    };

    await renderPage();

    const loading: HTMLElement = await waitFor(
      () => {
        return screen.getByTestId(SERVER_EMAIL_ENVIRONMENT_LOADING_TEST_ID);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(within(loading).getByText(EMAIL["serverCardTitle"]!)).toBeVisible();
    expectNoSavedSettingsEditButton();
    expect(
      screen.queryByTestId(SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID),
    ).toBeNull();
  });
});

describe("in a right-to-left language", () => {
  /*
   * Between a Latin word and Persian or Arabic text, GLOBAL_EMAIL_'s last
   * underscore takes the line's direction: laid out as the locale file
   * words the description, it is drawn before the word, "_GLOBAL_EMAIL"
   * (#7804). The Admin Dashboard's i18next sets the code of an Arabic or
   * Persian sentence apart as it hands it to the page, and leaves those
   * marks out of what is copied (src/Utils/i18n.ts,
   * Common/UI/Utils/CodeReadsAsWritten). So the locale files put no mark
   * of their own after it: copying keeps such a mark, and the prefix
   * pasted into config.env would hold an invisible character
   * (CodeInRightToLeftSentences).
   */
  const PREFIX: string = "GLOBAL_EMAIL_";

  // The Admin Dashboard's i18next, in a language, as its language menu sets it.
  const readIn: (code: string) => Promise<void> = async (
    code: string,
  ): Promise<void> => {
    await act(async () => {
      await AdminI18n.changeLanguage(code);
    });

    expect(AdminI18n.resolvedLanguage).toBe(code);
  };

  // The card's description as a language's locale file words it.
  const descriptionIn: (language: string) => string = (
    language: string,
  ): string => {
    const locale: Locale = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Locale;

    return (
      ((locale["pages"] as Locale)["settings"] as Locale)["email"] as Record<
        string,
        string
      >
    )["environmentCardDescription"]!;
  };

  // What copying an element's text from the page puts on the clipboard.
  const copyFromPage: (element: HTMLElement) => string = (
    element: HTMLElement,
  ): string => {
    const range: Range = document.createRange();

    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const copied: Record<string, string> = {};
    const event: Event = new Event("copy", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, data: string): void => {
          copied[type] = data;
        },
      },
    });
    element.dispatchEvent(event);

    // A copy no handler takes is the browser's: the selection as it is.
    return event.defaultPrevented
      ? (copied["text/plain"] as string)
      : (window.getSelection()?.toString() as string);
  };

  afterEach(async () => {
    window.getSelection()?.removeAllRanges();
    await readIn("en");
  });

  test.each(["fa", "ar"])(
    "%s: the card's description draws GLOBAL_EMAIL_ as it is written, and copies it as it is written",
    async (language: string) => {
      environmentAnswer = answerFor(environmentSmtp());

      // The page through the Admin Dashboard's own i18next (src/Utils/i18n.ts).
      await readIn(language);
      render(
        <I18nextProvider i18n={AdminI18n}>
          <EmailSettings />
        </I18nextProvider>,
      );
      await settle();

      const card: HTMLElement = await environmentCard();
      const written: string = descriptionIn(language);

      expect(written.split(PREFIX).length - 1).toBe(1);

      // The description as the page shows it: the sentence, its code set apart.
      const description: HTMLElement = within(card).getByText(
        (content: string): boolean => {
          return withoutIsolates(content) === written;
        },
      );
      const shown: string = description.textContent as string;
      const line: DrawnLine = drawLine(shown, "rtl");
      const at: number = shown.indexOf(PREFIX);

      expect({
        drawn: getDrawnText(line),
        isDrawnAsWritten: isDrawnAsWritten(line, at, at + PREFIX.length),
      }).toEqual({ drawn: getDrawnText(line), isDrawnAsWritten: true });

      // Copied from the page: the prefix with nothing after it, in the locale file's sentence.
      const copied: string = copyFromPage(description);

      expect(
        copied.split(/\s+/u).filter((word: string): boolean => {
          return word.includes(PREFIX);
        }),
      ).toEqual([PREFIX]);
      expect(copied).toBe(written);

      // The negative control: as the locale file words it, the underscore is drawn first.
      expect(getDrawnText(drawLine(written, "rtl"))).toContain("_GLOBAL_EMAIL");
    },
  );
});

describe("the field titles", () => {
  test("one for each variable, each a title the Admin Dashboard already shows", () => {
    expect(Object.keys(SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES).sort()).toEqual(
      [...SERVER_EMAIL_ENVIRONMENT_VARIABLES].sort(),
    );

    for (const title of Object.values(SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES)) {
      expect({ title, isKey: title in ENGLISH }).toEqual({
        title,
        isKey: true,
      });
    }
  });
});
