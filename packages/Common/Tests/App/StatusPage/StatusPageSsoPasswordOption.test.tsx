import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONArray } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import { getSignInOptionClassName } from "../../../UI/Components/SignInOption/SignInOptionStyle";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import SsoPage, {
  PASSWORD_SIGN_IN_OPTION_TEST_ID,
  SSO_SIGN_IN_OPTIONS_TEST_ID,
} from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/SSO";
import { getJestSpyOn } from "../../Spy";

/*
 * Status page > "Log in with SSO", while it lists the page's providers.
 *
 * The sign-in page offers single sign-on under "or" (Log in with SSO), but
 * the SSO page had no way back: a visitor who opened it by mistake, or whose
 * provider was not the one they sign in with, had to edit the address. Now,
 * under the providers, it offers the password form the way the sign-in page
 * offers SSO - "or", then an outlined "Log in with password" button with a
 * lock - except on a page that requires SSO, where a password cannot sign
 * anyone in (the sign-in page sends them straight back here), and on a page
 * with no provider to list, which says so with its own link back.
 *
 * The lists are the real ModelList, fetching through a stubbed API.post.
 * Translations resolve against the StatusPage's real en.json, and a missing
 * key renders as the key itself, so the tests fail instead of passing on a
 * fallback.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node !== "string") {
      return key;
    }

    return node
      .split("{{statusPageName}}")
      .join(String(options?.["statusPageName"] ?? ""));
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

type ProviderRow = { _id: string; name: string };

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
  "Locales",
);

const OKTA: ProviderRow = {
  _id: "22222222-2222-4222-8222-222222222222",
  name: "Okta",
};

const ENTRA: ProviderRow = {
  _id: "33333333-3333-4333-8333-333333333333",
  name: "Entra ID",
};

const LOG_IN_WITH_PASSWORD: string = "Log in with password";

let samlProviders: Array<ProviderRow> | Error = [];
let oidcProviders: Array<ProviderRow> | Error = [];
let isPreview: boolean = false;
let redirectUrl: string | null = null;

const readLocale: (file: string) => Record<string, any> = (
  file: string,
): Record<string, any> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, any>;
};

const renderPage: (forceSSO?: boolean) => Promise<void> = async (
  forceSSO?: boolean,
): Promise<void> => {
  await act(async () => {
    render(
      <SsoPage
        statusPageName="Customer Status"
        logoFileId={new ObjectID(STATUS_PAGE_ID.toString())}
        forceSSO={forceSSO}
      />,
    );
  });
};

// Whether `later` comes after `earlier` in the document.
const comesAfter: (later: Element, earlier: Element) => boolean = (
  later: Element,
  earlier: Element,
): boolean => {
  return Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
};

const passwordOption: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId(PASSWORD_SIGN_IN_OPTION_TEST_ID);
};

describe("Status page SSO page: the way back to the password form", () => {
  beforeEach(() => {
    isPreview = false;
    redirectUrl = null;
    samlProviders = [OKTA];
    oidcProviders = [ENTRA];

    getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
      STATUS_PAGE_ID,
    );
    getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      false,
    );
    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockImplementation(
      (): string | null => {
        return redirectUrl;
      },
    );
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockImplementation(
      (): boolean => {
        return isPreview;
      },
    );
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
    getJestSpyOn(API, "getFriendlyMessage").mockReturnValue(
      "Could not load the providers.",
    );
    getJestSpyOn(API, "post").mockImplementation(
      async (options: {
        url: { toString: () => string };
      }): Promise<HTTPResponse<JSONArray>> => {
        const url: string = options.url.toString();

        const answer: Array<ProviderRow> | Error = url.endsWith(
          `/oidc/${STATUS_PAGE_ID.toString()}`,
        )
          ? oidcProviders
          : samlProviders;

        if (answer instanceof Error) {
          throw answer;
        }

        return new HTTPResponse<JSONArray>(200, answer, {});
      },
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("under the providers: 'or', then 'Log in with password', a link to the page's sign-in", async () => {
    await renderPage();

    const okta: HTMLElement = await screen.findByText("Okta");
    const entra: HTMLElement = await screen.findByText("Entra ID");
    const divider: HTMLElement = screen.getByTestId("sign-in-options-divider");

    expect(divider).toHaveTextContent(/^or$/);
    expect(comesAfter(divider, okta)).toBe(true);
    expect(comesAfter(divider, entra)).toBe(true);
    expect(comesAfter(passwordOption(), divider)).toBe(true);
    expect(passwordOption().tagName).toBe("A");
    expect(passwordOption()).toHaveAttribute("href", "/login");
    expect(passwordOption()).toHaveAccessibleName(LOG_IN_WITH_PASSWORD);
  });

  test("it is drawn like the sign-in page's Log in with SSO: a full-width outlined button with a lock", async () => {
    await renderPage();

    for (const name of getSignInOptionClassName("ready").split(" ")) {
      expect(passwordOption()).toHaveClass(name);
    }

    // The icon is decoration: the button is named by its words alone.
    const icon: SVGElement | null = passwordOption().querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  test("a click opens the password form without leaving the app", async () => {
    await renderPage();

    fireEvent.click(passwordOption());

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(
      (jest.mocked(Navigation.navigate).mock.calls[0]![0] as Route).toString(),
    ).toBe("/login");
  });

  test("in the Dashboard's preview, it opens the preview's sign-in", async () => {
    isPreview = true;

    await renderPage();

    expect(passwordOption()).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/login`,
    );
  });

  test("a visitor sent to sign in from a page goes back to it either way", async () => {
    redirectUrl = "/incidents/44444444-4444-4444-8444-444444444444";

    await renderPage();

    expect(passwordOption()).toHaveAttribute(
      "href",
      `/login?redirectUrl=${encodeURIComponent(redirectUrl)}`,
    );
  });

  test("offered while the providers load, so the way back never waits on them", async () => {
    let answerSaml: () => void = (): void => {};

    getJestSpyOn(API, "post").mockImplementation(
      (): Promise<HTTPResponse<JSONArray>> => {
        return new Promise<HTTPResponse<JSONArray>>(
          (resolve: (value: HTTPResponse<JSONArray>) => void) => {
            answerSaml = (): void => {
              resolve(new HTTPResponse<JSONArray>(200, [OKTA], {}));
            };
          },
        );
      },
    );

    await renderPage();

    expect(passwordOption()).toBeVisible();

    await act(async () => {
      answerSaml();
    });
  });

  test("offered when a list could not be loaded: the password form still works", async () => {
    samlProviders = new Error("boom");
    oidcProviders = [];

    await renderPage();

    expect(
      await screen.findByText("Could not load the providers."),
    ).toBeVisible();
    expect(passwordOption()).toHaveAttribute("href", "/login");
  });

  test("not on a page that requires SSO: a password signs nobody in there", async () => {
    await renderPage(true);

    expect(await screen.findByText("Okta")).toBeVisible();
    expect(
      screen.queryByTestId(PASSWORD_SIGN_IN_OPTION_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(SSO_SIGN_IN_OPTIONS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });

  test("not with no provider to list: the notice and its own link back say it", async () => {
    samlProviders = [];
    oidcProviders = [];

    await renderPage();

    expect(
      await screen.findByTestId("status-page-sso-unavailable"),
    ).toBeVisible();
    expect(
      screen.queryByTestId(PASSWORD_SIGN_IN_OPTION_TEST_ID),
    ).not.toBeInTheDocument();
    // One way back on the page, not two.
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/login");
  });

  /*
   * The SAML and OpenID Connect providers are one list: neither draws a
   * frame of its own (padding, a margin under it, a scroll box), so a page
   * with both showed two lists far apart, and the cards sat a frame's
   * padding in from Log in with password.
   */
  test("the SAML and OpenID Connect providers read as one list, with no frame of either's", async () => {
    await renderPage();

    await screen.findByText("Okta");
    await screen.findByText("Entra ID");

    for (const list of ["sso-list-rows", "oidc-list-rows"]) {
      expect([list, screen.getByTestId(list).getAttribute("class")]).toEqual([
        list,
        null,
      ]);
    }

    // The rows' own outer margins are taken back at the card's edge.
    expect(screen.getByTestId("status-page-sso-provider-lists").className).toBe(
      "-my-2",
    );
  });

  /*
   * A provider is chosen from the keyboard too: it was a box only a mouse
   * could click, and Tab went past every provider to Log in with password.
   */
  test("each provider is a button the keyboard reaches and Enter chooses", async () => {
    await renderPage();

    const okta: HTMLElement = (await screen.findByText("Okta")).closest(
      "[role='button']",
    ) as HTMLElement;
    const entra: HTMLElement = (await screen.findByText("Entra ID")).closest(
      "[role='button']",
    ) as HTMLElement;

    expect(okta).toHaveAttribute("tabindex", "0");
    expect(entra).toHaveAttribute("tabindex", "0");
    // In the order they are read: the providers, then the way back.
    expect(comesAfter(entra, okta)).toBe(true);
    expect(comesAfter(passwordOption(), entra)).toBe(true);

    await act(async () => {
      fireEvent.keyDown(entra, { key: "Enter" });
    });

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(
      String(jest.mocked(Navigation.navigate).mock.calls[0]![0]),
    ).toContain(`/${STATUS_PAGE_ID.toString()}/${ENTRA._id}`);
  });

  test("the words come from the locale, translated in all 16 other languages", () => {
    const english: Record<string, any> = readLocale("en.json");

    expect(english["accounts"]["sso"]["logInWithPassword"]).toBe(
      LOG_IN_WITH_PASSWORD,
    );

    const locales: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      });

    expect(locales).toHaveLength(16);

    for (const file of locales) {
      const locale: Record<string, any> = readLocale(file);
      const value: unknown = locale["accounts"]["sso"]["logInWithPassword"];

      expect([file, typeof value]).toEqual([file, "string"]);
      expect((value as string).trim()).not.toBe("");
      expect([file, value]).not.toEqual([file, LOG_IN_WITH_PASSWORD]);
      // One line, like the sign-in page's other ways in.
      expect([file, (value as string).includes("\n")]).toEqual([file, false]);
      // The same "or" as the sign-in page's divider, in every language.
      expect([file, typeof locale["accounts"]["login"]["or"]]).toEqual([
        file,
        "string",
      ]);
    }
  });
});
