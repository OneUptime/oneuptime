import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import { getSignInOptionClassName } from "../../../UI/Components/SignInOption/SignInOptionStyle";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UserUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/User";
import LoginPage from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/Login";
import english from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import { getJestSpyOn } from "../../Spy";

/*
 * Status page > "Welcome back!", the sign-in page of a private status page.
 *
 * When the page has a single sign-on provider turned on, it offers it the
 * way OneUptime's own sign-in page offers its other ways in: under Login, an
 * "or" divider, then a full-width outlined "Log in with SSO" button, named
 * like the page it opens. It was a small text link, "Use single sign-on
 * (SSO) instead". Without a provider, there is neither the divider nor the
 * button.
 *
 * Translations resolve against the StatusPage's real en.json and never fall
 * back to a call's defaultValue: a key missing from the locale renders as
 * the bare key, so these tests fail instead of passing on fallback text.
 */

jest.mock("react-i18next", () => {
  const locale: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = locale;

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

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

// A filled button - what a primary button looks like, whatever its colour.
const FILLED_BUTTON_CLASS: RegExp = /\bbg-(indigo|red|green|yellow)-600\b/;

let isPreview: boolean = false;

const renderPage: (hasEnabledSSOConfig: boolean) => Promise<void> = async (
  hasEnabledSSOConfig: boolean,
): Promise<void> => {
  await act(async () => {
    render(
      <LoginPage
        statusPageName="Customer Status"
        logoFileId={new ObjectID("22222222-2222-4222-8222-222222222222")}
        forceSSO={false}
        hasEnabledSSOConfig={hasEnabledSSOConfig}
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

describe("Status page sign-in: single sign-on as a button under 'or'", () => {
  beforeEach(() => {
    isPreview = false;
    getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
      STATUS_PAGE_ID,
    );
    getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockReturnValue(true);
    getJestSpyOn(StatusPageUtil, "requiresMasterPassword").mockReturnValue(
      false,
    );
    getJestSpyOn(StatusPageUtil, "isMasterPasswordValidated").mockReturnValue(
      true,
    );
    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(null);
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockImplementation(
      (): boolean => {
        return isPreview;
      },
    );
    getJestSpyOn(UserUtil, "isLoggedIn").mockReturnValue(false);
    getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("with a provider turned on: under Login, 'or', then 'Log in with SSO'", async () => {
    await renderPage(true);

    const signIn: HTMLElement = screen.getByTestId(
      english.accounts.login.submit,
    );
    const divider: HTMLElement = screen.getByTestId("sign-in-options-divider");
    const sso: HTMLElement = screen.getByTestId("sso-login");

    expect(divider).toHaveTextContent(/^or$/);
    expect(comesAfter(divider, signIn)).toBe(true);
    expect(comesAfter(sso, divider)).toBe(true);
    expect(sso.tagName).toBe("A");
    expect(sso).toHaveAttribute("href", "/sso");
    expect(sso).toHaveAccessibleName("Log in with SSO");
  });

  test("the button is named like the page it opens", async () => {
    await renderPage(true);

    expect(english.accounts.login.logInWithSso).toBe(
      english.accounts.sso.title,
    );
    expect(screen.getByTestId("sso-login")).toHaveAccessibleName(
      english.accounts.sso.title,
    );
  });

  test("it is a full-width outlined button with a shield; Login is the one filled button", async () => {
    await renderPage(true);

    const sso: HTMLElement = screen.getByTestId("sso-login");
    const filled: Array<HTMLElement> = [
      ...screen.getAllByRole("button"),
      ...screen.getAllByRole("link"),
    ].filter((control: HTMLElement) => {
      return FILLED_BUTTON_CLASS.test(control.className);
    });

    for (const name of getSignInOptionClassName("ready").split(" ")) {
      expect(sso).toHaveClass(name);
    }
    expect(sso).not.toHaveClass("text-indigo-500");
    expect(sso.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(filled).toEqual([screen.getByTestId(english.accounts.login.submit)]);
  });

  test("the retired link is gone", async () => {
    await renderPage(true);

    expect(
      screen.queryByText("Use single sign-on (SSO) instead"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("accounts.login.useSSO")).not.toBeInTheDocument();
  });

  test("a click opens the status page's SSO page", async () => {
    await renderPage(true);

    fireEvent.click(screen.getByTestId("sso-login"));

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(
      (jest.mocked(Navigation.navigate).mock.calls[0]![0] as Route).toString(),
    ).toBe("/sso");
  });

  test("in the Dashboard's preview, it opens the preview's SSO page", async () => {
    isPreview = true;
    await renderPage(true);

    expect(screen.getByTestId("sso-login")).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/sso`,
    );
  });

  test("a visitor sent to sign in from a page keeps going there through SSO", async () => {
    const incident: string = "/incidents/44444444-4444-4444-8444-444444444444";

    getJestSpyOn(StatusPageUtil, "getSafeRedirectUrl").mockReturnValue(
      incident,
    );

    await renderPage(true);

    expect(screen.getByTestId("sso-login")).toHaveAttribute(
      "href",
      `/sso?redirectUrl=${encodeURIComponent(incident)}`,
    );
  });

  test("without a provider turned on: neither the divider nor the button", async () => {
    await renderPage(false);

    expect(
      screen.getByTestId(english.accounts.login.submit),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("sign-in-options-divider"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-login")).not.toBeInTheDocument();
    expect(screen.queryByText("or")).not.toBeInTheDocument();
  });
});
