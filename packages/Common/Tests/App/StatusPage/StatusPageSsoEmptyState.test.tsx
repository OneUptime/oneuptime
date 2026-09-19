import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
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
import { JSONArray } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import SsoPage from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/SSO";
import { getJestSpyOn } from "../../Spy";

/*
 * Status page > "Log in with SSO". It lists the page's SAML and OIDC
 * providers. On the Community Edition status page SSO does not exist and the
 * server lists none (design v2 section 0), and a page can also simply have no
 * enabled provider. When BOTH lists come back empty the page says single
 * sign-on is not available and links back to the password sign-in - and that
 * is the only message it shows: not also the SAML list's "No items found."
 * and the OIDC list's "No SSO Providers Configured or Enabled".
 *
 * The lists are the real ModelList, fetching through a stubbed API.post, so
 * what is asserted is what a visitor would see.
 *
 * Translations resolve against the StatusPage's real en.json and NEVER fall
 * back to a call's defaultValue: a key missing from the locales renders as
 * the bare key, so these tests fail instead of passing on the fallback text.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  type TranslateOptions = Record<string, unknown> & {
    keySeparator?: string | false;
  };

  const translate: (key: string, options?: TranslateOptions) => string = (
    key: string,
    options?: TranslateOptions,
  ): string => {
    const segments: Array<string> =
      options?.keySeparator === false ? [key] : key.split(".");
    let node: unknown = english;

    for (const part of segments) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node !== "string") {
      return key;
    }

    return node.replace(
      /\{\{(\w+)\}\}/g,
      (_placeholder: string, name: string): string => {
        return String(options?.[name] ?? "");
      },
    );
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

const NOT_AVAILABLE: string =
  "Single sign-on is not available for this status page. Sign in with your email and password instead.";
const BACK_TO_SIGN_IN: string = "Back to sign in";
// The two empty states the lists used to add on top of the notice.
const MODEL_LIST_FALLBACK: string = "No items found.";
const NO_PROVIDERS: string = "No SSO Providers Configured or Enabled";

const OKTA: ProviderRow = {
  _id: "22222222-2222-4222-8222-222222222222",
  name: "Okta",
};

let samlProviders: Array<ProviderRow> | Error = [];
let oidcProviders: Array<ProviderRow> | Error = [];
let lookedUp: Array<string> = [];

const readLocale: (file: string) => Record<string, any> = (
  file: string,
): Record<string, any> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, any>;
};

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <SsoPage
        statusPageName="Customer Status"
        logoFileId={new ObjectID(STATUS_PAGE_ID.toString())}
      />,
    );
  });
};

const providerLists: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("status-page-sso-provider-lists");
};

describe("Status page SSO sign-in when no provider can be offered", () => {
  let isPreview: boolean = false;

  beforeEach(() => {
    isPreview = false;
    samlProviders = [];
    oidcProviders = [];
    lookedUp = [];

    getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
      STATUS_PAGE_ID,
    );
    getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      false,
    );
    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(null);
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockImplementation(
      (): boolean => {
        return isPreview;
      },
    );
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
    getJestSpyOn(API, "getFriendlyMessage").mockReturnValue(
      "Could not load the SAML providers.",
    );
    getJestSpyOn(API, "post").mockImplementation(
      async (options: {
        url: { toString: () => string };
      }): Promise<HTTPResponse<JSONArray>> => {
        const url: string = options.url.toString();
        lookedUp.push(url);

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

  test("both lists empty (the Community Edition): explains and links back to sign-in", async () => {
    await renderPage();

    const notice: HTMLElement = await screen.findByTestId(
      "status-page-sso-unavailable",
    );

    expect(notice).toHaveTextContent(NOT_AVAILABLE);
    expect(screen.getByText(BACK_TO_SIGN_IN).closest("a")).toHaveAttribute(
      "href",
      "/login",
    );
  });

  test("both lists empty: the notice is the only message on the page", async () => {
    await renderPage();

    expect(
      await screen.findByTestId("status-page-sso-unavailable"),
    ).toBeVisible();
    expect(screen.getAllByText(NOT_AVAILABLE)).toHaveLength(1);
    expect(screen.queryByText(MODEL_LIST_FALLBACK)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_PROVIDERS)).not.toBeInTheDocument();

    // Both lists did load (and stay mounted), but take no room on the page.
    expect(lookedUp).toHaveLength(2);
    expect(providerLists()).toHaveAttribute("hidden");
    expect(providerLists()).not.toBeVisible();
    expect(providerLists()).toHaveTextContent("");
  });

  test("the notice's strings come from the locale files, not the fallback text", async () => {
    await renderPage();

    const english: Record<string, any> = readLocale("en.json");

    expect(english["accounts"]["sso"]["notAvailable"]).toBe(NOT_AVAILABLE);
    expect(english["accounts"]["sso"]["backToLogin"]).toBe(BACK_TO_SIGN_IN);
    // A key missing from en.json would render as the key itself.
    expect(
      screen.queryByText("accounts.sso.notAvailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("accounts.sso.backToLogin"),
    ).not.toBeInTheDocument();
    expect(screen.getByText(BACK_TO_SIGN_IN)).toBeInTheDocument();
  });

  test("every StatusPage locale translates both strings", () => {
    const english: Record<string, any> = readLocale("en.json");
    const locales: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string) => {
        return file.endsWith(".json") && file !== "en.json";
      });

    expect(locales).toHaveLength(16);

    for (const file of locales) {
      const sso: Record<string, unknown> = readLocale(file)["accounts"]["sso"];

      for (const key of ["notAvailable", "backToLogin"]) {
        const value: unknown = sso[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);
        expect((value as string).trim()).not.toBe("");
        expect([file, key, value]).not.toEqual([
          file,
          key,
          english["accounts"]["sso"][key],
        ]);
      }
    }
  });

  test("on a preview page the link goes back to the preview's sign-in", async () => {
    isPreview = true;

    await renderPage();

    expect(screen.getByText(BACK_TO_SIGN_IN).closest("a")).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/login`,
    );
  });

  test.each([
    ["a SAML provider", "saml"],
    ["an OIDC provider", "oidc"],
  ])(
    "with %s it lists it and shows no notice, and no empty message for the other list",
    async (_label: string, protocol: string) => {
      if (protocol === "saml") {
        samlProviders = [OKTA];
      } else {
        oidcProviders = [OKTA];
      }

      await renderPage();

      expect(await screen.findByText("Okta")).toBeVisible();
      expect(providerLists()).not.toHaveAttribute("hidden");
      expect(
        screen.queryByTestId("status-page-sso-unavailable"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(MODEL_LIST_FALLBACK)).not.toBeInTheDocument();
      expect(screen.queryByText(NO_PROVIDERS)).not.toBeInTheDocument();
    },
  );

  test("a list that failed to load is not taken for 'no providers'", async () => {
    samlProviders = new Error("boom");

    await renderPage();

    expect(
      await screen.findByText("Could not load the SAML providers."),
    ).toBeVisible();
    expect(providerLists()).not.toHaveAttribute("hidden");
    expect(
      screen.queryByTestId("status-page-sso-unavailable"),
    ).not.toBeInTheDocument();
  });
});
