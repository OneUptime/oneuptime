import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import Navigation from "../../../UI/Utils/Navigation";
import UserUtil from "../../../UI/Utils/User";
import i18n from "../../../../App/FeatureSet/Accounts/src/Utils/i18n";
import english from "../../../../App/FeatureSet/Accounts/src/Locales/en.json";
import german from "../../../../App/FeatureSet/Accounts/src/Locales/de.json";
import persian from "../../../../App/FeatureSet/Accounts/src/Locales/fa.json";
import LoginWithSSOPage from "../../../../App/FeatureSet/Accounts/src/Pages/LoginWithSSO";
import {
  SSO_EMAIL_LINKS_BUTTON_TEST_ID,
  SSO_EMAIL_LINKS_SENT_TEST_ID,
  SSO_EMAIL_LINKS_TEST_ID,
} from "../../../../App/FeatureSet/Accounts/src/Components/SsoSignInLinksOffer/SsoSignInLinksOffer";

/*
 * "EMAIL ME MY SIGN-IN LINKS" ON "SIGN IN WITH SSO" (#9987).
 *
 * When the lookup by an address's domain finds no provider - an address on
 * another domain than its organization's - the page offers to email the
 * address the SSO sign-in links of its organizations. What is held:
 *
 *   - offered only once a lookup found nothing, for the address looked up,
 *     and not on a server that cannot send email;
 *   - it asks POST /identity/send-sso-sign-in-links with the address, and
 *     the captcha where it is on;
 *   - whatever the address, the page then says the same thing - "if this
 *     address belongs to an organization that uses single sign-on, we have
 *     emailed it the links" - never that something was or was not sent;
 *   - a refusal (too many requests, the server's own) says why, and the
 *     offer stays;
 *   - a new lookup starts the offer again;
 *   - every Accounts locale words its sentences.
 */

let captchaEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "IDENTITY_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/identity");
    },
  });

  Object.defineProperty(mocked, "CAPTCHA_ENABLED", {
    get: (): boolean => {
      return captchaEnabledForTest;
    },
  });

  Object.defineProperty(mocked, "CAPTCHA_SITE_KEY", {
    get: (): string => {
      return captchaEnabledForTest ? "site-key" : "";
    },
  });

  return mocked;
});

// The captcha widget, as a button that hands the page a token.
jest.mock("../../../UI/Components/Captcha/Captcha", () => {
  return {
    __esModule: true,
    default: (props: { onTokenChange?: (token: string) => void }) => {
      const react: typeof React = jest.requireActual("react");

      return react.createElement(
        "button",
        {
          type: "button",
          "data-testid": "captcha",
          onClick: () => {
            props.onTokenChange?.("captcha-token");
          },
        },
        "I am not a robot",
      );
    },
  };
});

const IDENTITY_ORIGIN: string = "https://oneuptime.example.com/identity";
const SEND_URL: string = `${IDENTITY_ORIGIN}/send-sso-sign-in-links`;

// Where a sentence ends, in the scripts the Accounts locales are written in.
const SENTENCE_END: RegExp = /[.。।]$/u;

const ACCOUNTS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Accounts",
  "src",
  "Locales",
);

let canSendEmail: boolean = true;
let sendAnswer: { status: number; data: JSONObject };
let posts: Array<{ url: string; data: unknown }>;

const toResponse: (value: {
  status: number;
  data: JSONObject;
}) => HTTPResponse<JSONObject> | HTTPErrorResponse = (value: {
  status: number;
  data: JSONObject;
}): HTTPResponse<JSONObject> | HTTPErrorResponse => {
  if (value.status >= 400) {
    return new HTTPErrorResponse(value.status, value.data, {});
  }

  return new HTTPResponse<JSONObject>(value.status, value.data, {});
};

const renderSso: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <MemoryRouter>
        <LoginWithSSOPage />
      </MemoryRouter>,
    );
  });
};

// Looks an address up, as the person does: the lookup finds nothing.
const lookUp: (email: string) => Promise<void> = async (
  email: string,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });
  const field: HTMLElement = await screen.findByTestId("email");

  await user.clear(field);
  await user.type(field, email);

  // The form's own button, named by its words in the page's language.
  await act(async () => {
    await user.click(screen.getByTestId(i18n.t("sso.submitButton")));
  });
};

const click: (testId: string) => Promise<void> = async (
  testId: string,
): Promise<void> => {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
    delay: null,
  });

  await act(async () => {
    await user.click(await screen.findByTestId(testId));
  });
};

describe("Email me my sign-in links", () => {
  beforeEach(() => {
    captchaEnabledForTest = false;
    canSendEmail = true;
    sendAnswer = { status: 200, data: {} };
    posts = [];

    jest.spyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
    jest
      .spyOn(GlobalConfigUtil, "fetchVars")
      .mockImplementation(async (): Promise<GlobalConfigVars> => {
        return {
          disableUserProjectCreation: false,
          disablePushNotifications: false,
          canSendEmail: canSendEmail,
        };
      });

    jest
      .spyOn(API, "get")
      .mockImplementation(
        async (
          options: Parameters<typeof API.get>[0],
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          const url: string = options.url?.toString() || "";

          if (url.endsWith("/sign-in-methods")) {
            return toResponse({
              status: 200,
              data: {
                isSsoRequired: false,
                ssoProviders: [],
                hasProjectSsoProviders: false,
              },
            });
          }

          // Every lookup by domain finds nothing.
          return new HTTPResponse<JSONObject>(
            200,
            [] as unknown as JSONObject,
            {},
          );
        },
      );

    jest
      .spyOn(API, "post")
      .mockImplementation(
        async (
          options: Parameters<typeof API.post>[0],
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          posts.push({
            url: options.url?.toString() || "",
            data: options.data,
          });

          return toResponse(sendAnswer);
        },
      );
  });

  afterEach(async () => {
    cleanup();
    jest.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  test("offered only once a lookup found nothing", async () => {
    await renderSso();

    expect(
      screen.queryByTestId(SSO_EMAIL_LINKS_TEST_ID),
    ).not.toBeInTheDocument();

    await lookUp("contractor@gmail.example");

    expect(
      await screen.findByTestId(SSO_EMAIL_LINKS_TEST_ID),
    ).toHaveTextContent(english.sso.emailLinksPrompt);
    expect(
      screen.getByTestId(SSO_EMAIL_LINKS_BUTTON_TEST_ID),
    ).toHaveTextContent(english.sso.emailLinksButton);
  });

  test("asks for the links of the address looked up, and nothing else", async () => {
    await renderSso();
    await lookUp("contractor@gmail.example");
    await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

    expect(posts).toEqual([
      {
        url: SEND_URL,
        data: { data: { email: "contractor@gmail.example" } },
      },
    ]);
  });

  test("whatever the address, the page then says the same thing", async () => {
    const said: Array<string> = [];

    for (const email of [
      "contractor@gmail.example",
      "nobody@nowhere.example",
      "blocked@gmail.example",
    ]) {
      await renderSso();
      await lookUp(email);
      await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

      const sent: HTMLElement = await screen.findByTestId(
        SSO_EMAIL_LINKS_SENT_TEST_ID,
      );

      expect(sent).toHaveAttribute("role", "status");
      said.push(sent.textContent || "");
      cleanup();
    }

    expect(new Set(said).size).toBe(1);
    expect(said[0]).toBe(english.sso.emailLinksSent);
    // Never that something was, or was not, sent.
    expect(said[0]).toMatch(/^If this address belongs to an organization/);
  });

  test("a refusal says why, and the offer stays to try again", async () => {
    sendAnswer = {
      status: 429,
      data: {
        message:
          "Too many sign-in links asked for this email address in the last hour. Please use the links in the latest email, or try again later.",
      },
    };

    await renderSso();
    await lookUp("contractor@gmail.example");
    await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

    expect(
      await screen.findByTestId("sso-email-links-error"),
    ).toHaveTextContent("Too many sign-in links asked for this email address");
    expect(
      screen.queryByTestId(SSO_EMAIL_LINKS_SENT_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(SSO_EMAIL_LINKS_BUTTON_TEST_ID),
    ).toBeInTheDocument();
  });

  test("not offered on a server that cannot send email", async () => {
    canSendEmail = false;

    await renderSso();
    await lookUp("contractor@gmail.example");

    // The lookup's own message is still there, and nothing else is offered.
    expect(
      await screen.findByText(/Single sign-on is not set up for/),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(SSO_EMAIL_LINKS_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("where the captcha is on, the request carries it, and waits for it", async () => {
    captchaEnabledForTest = true;

    await renderSso();
    await lookUp("contractor@gmail.example");
    await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

    expect(posts).toEqual([]);
    expect(
      await screen.findByTestId("sso-email-links-error"),
    ).toHaveTextContent(english.sso.emailLinksCaptchaRequired);

    await click("captcha");
    await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

    expect(posts).toEqual([
      {
        url: SEND_URL,
        data: {
          data: { email: "contractor@gmail.example" },
          miscDataProps: { captchaToken: "captcha-token" },
        },
      },
    ]);
  });

  test("a new lookup starts the offer again, for the new address", async () => {
    await renderSso();
    await lookUp("first@gmail.example");
    await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);
    await screen.findByTestId(SSO_EMAIL_LINKS_SENT_TEST_ID);

    await lookUp("second@gmail.example");

    expect(
      await screen.findByTestId(SSO_EMAIL_LINKS_BUTTON_TEST_ID),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(SSO_EMAIL_LINKS_SENT_TEST_ID),
    ).not.toBeInTheDocument();

    await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

    expect(
      posts.map((post: { data: unknown }) => {
        return ((post.data as JSONObject)["data"] as JSONObject)["email"];
      }),
    ).toEqual(["first@gmail.example", "second@gmail.example"]);
  });

  describe("in the visitor's language", () => {
    test("German reads German", async () => {
      await i18n.changeLanguage("de");

      await renderSso();
      await lookUp("contractor@gmail.example");

      expect(
        await screen.findByTestId(SSO_EMAIL_LINKS_TEST_ID),
      ).toHaveTextContent(german.sso.emailLinksPrompt);

      await click(SSO_EMAIL_LINKS_BUTTON_TEST_ID);

      expect(
        await screen.findByTestId(SSO_EMAIL_LINKS_SENT_TEST_ID),
      ).toHaveTextContent(german.sso.emailLinksSent);
    });

    test("Persian reads Persian", async () => {
      await i18n.changeLanguage("fa");

      await renderSso();
      await lookUp("contractor@gmail.example");

      expect(
        await screen.findByTestId(SSO_EMAIL_LINKS_BUTTON_TEST_ID),
      ).toHaveTextContent(persian.sso.emailLinksButton);
    });

    test("every Accounts locale words the offer, each in its own words, a sentence ending where one does", () => {
      const files: Array<string> = fs
        .readdirSync(ACCOUNTS_LOCALES_DIR)
        .filter((file: string): boolean => {
          return file.endsWith(".json");
        });

      expect(files).toHaveLength(18);

      for (const file of files) {
        const sso: Record<string, string> = (
          JSON.parse(
            fs.readFileSync(path.join(ACCOUNTS_LOCALES_DIR, file), "utf8"),
          ) as JSONObject
        )["sso"] as Record<string, string>;

        for (const key of [
          "emailLinksPrompt",
          "emailLinksButton",
          "emailLinksSent",
          "emailLinksCaptchaRequired",
        ]) {
          const value: string = sso[key] || "";

          expect({ file, key, isWorded: value.length > 0 }).toEqual({
            file,
            key,
            isWorded: true,
          });

          if (file !== "en.json") {
            expect({ file, key, value }).not.toEqual({
              file,
              key,
              value: (english.sso as Record<string, string>)[key],
            });
          }
        }

        // The sentences end as sentences; the button's words do not.
        for (const key of ["emailLinksPrompt", "emailLinksSent"]) {
          expect({
            file,
            key,
            ends: SENTENCE_END.test(sso[key] || ""),
          }).toEqual({
            file,
            key,
            ends: true,
          });
        }

        expect({
          file,
          buttonEndsLikeASentence: SENTENCE_END.test(
            sso["emailLinksButton"] || "",
          ),
        }).toEqual({ file, buttonEndsLikeASentence: false });
      }
    });
  });
});
