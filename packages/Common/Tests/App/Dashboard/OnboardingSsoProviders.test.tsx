import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import ProjectUtil from "../../../UI/Utils/Project";
import API from "../../../UI/Utils/API/API";
import Navigation from "../../../UI/Utils/Navigation";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import {
  getSignInOptionClassName,
  SIGN_IN_OPTION_PRIMARY_CLASS,
} from "../../../UI/Components/SignInOption/SignInOptionStyle";
import OnboardingSsoPage, {
  getProjectSignInMethodsUrl,
  NO_PROVIDER_HELP,
  SIGN_IN_WITH_PROVIDER,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/SSO";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";

/*
 * Dashboard > a project's single sign-on page (Onboarding/SSO,
 * /dashboard/<project>/sso): where a user lands when a project requires
 * SSO - itself, or because the whole server does - and what the project's
 * Test Single Sign On (SSO) link opens.
 *
 * It lists every provider that signs people in to the project, one button
 * each, read from the identity server (GET
 * /identity/project-sign-in-methods/<project>): the project's own SAML and
 * OpenID Connect providers that are on, and the server's instance-wide ones
 * that sign people in to it. It read the project's own two lists alone, so
 * a project that signs in through the server's provider - every project,
 * once the whole server requires SSO (#5193) - told the person it had no
 * provider, and to ask an admin.
 *
 * With no provider it says so and offers the way back to sign-in, without a
 * word about editions or licenses: single sign-on is in every edition. A
 * list that cannot be read says so, with Refresh.
 *
 * The real page, the real buttons and the real parsing of the answer run
 * here; API.get answers, and Navigation.navigate records where a button
 * goes.
 */

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

  return mocked;
});

jest.mock("../../../UI/Components/Page/Page", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
  };
});

const IDENTITY_ORIGIN: string = "https://oneuptime.example.com/identity";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SIGN_IN_METHODS_URL: string = `${IDENTITY_ORIGIN}/project-sign-in-methods/${PROJECT_ID.toString()}`;

// The project's own SAML provider, with the description it gets by default.
const PROJECT_SAML: JSONObject = {
  type: SsoProviderType.ProjectSSO,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Okta SAML",
  description: "Sign in with Okta SAML",
};

const PROJECT_OIDC: JSONObject = {
  type: SsoProviderType.ProjectOIDC,
  id: "33333333-3333-4333-8333-333333333333",
  name: "Google",
  description: "",
};

// The server's providers, one with a description its admin wrote.
const GLOBAL_SAML: JSONObject = {
  type: SsoProviderType.GlobalSSO,
  id: "44444444-4444-4444-8444-444444444444",
  name: "Acme Entra ID",
  description: "Use your Acme email address",
};

const GLOBAL_OIDC: JSONObject = {
  type: SsoProviderType.GlobalOIDC,
  id: "55555555-5555-4555-8555-555555555555",
  name: "Keycloak",
  description: "",
};

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Answer = { status: number; data: JSONObject };

let answers: Array<Answer>;
let requestedUrls: Array<string>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

const providers: (list: Array<JSONObject>) => Answer = (
  list: Array<JSONObject>,
): Answer => {
  return { status: 200, data: { ssoProviders: list } };
};

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <OnboardingSsoPage
        pageRoute={new Route("/dashboard/project/sso")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
  });
};

const providerButtons: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByTestId("project-sso-provider");
};

const buttonTitles: () => Array<string> = (): Array<string> => {
  return providerButtons().map((button: HTMLElement): string => {
    return button.textContent || "";
  });
};

const navigatedTo: () => Array<string> = (): Array<string> => {
  return navigateSpy.mock.calls.map(
    (call: Parameters<typeof Navigation.navigate>) => {
      return call[0].toString();
    },
  );
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readLocale("en") },
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

describe("Dashboard project SSO sign-in page", () => {
  beforeEach(async () => {
    await i18next.changeLanguage("en");

    answers = [providers([])];
    requestedUrls = [];

    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
    navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
      return undefined;
    });
    jest
      .spyOn(API, "get")
      .mockImplementation(
        async (
          options: Parameters<typeof API.get>[0],
        ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
          requestedUrls.push(options.url?.toString() || "");

          // Each read takes the next answer; the last one repeats.
          const answer: Answer =
            answers.length > 1 ? answers.shift()! : answers[0]!;

          if (answer.status >= 400) {
            return new HTTPErrorResponse(answer.status, answer.data, {});
          }

          return new HTTPResponse<JSONObject>(answer.status, answer.data, {});
        },
      );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("reads the project's providers from the identity server, once", async () => {
    await renderPage();

    expect(getProjectSignInMethodsUrl(PROJECT_ID).toString()).toBe(
      SIGN_IN_METHODS_URL,
    );
    expect(requestedUrls).toEqual([SIGN_IN_METHODS_URL]);
    // Not the project's own two lists any more.
    expect(requestedUrls.join(" ")).not.toMatch(/sso-list|oidc-list/);
  });

  test("with no provider it explains why and links back to sign-in", async () => {
    await renderPage();

    const help: HTMLElement = await screen.findByTestId(
      "sso-no-providers-help",
    );

    expect(help).toHaveTextContent(NO_PROVIDER_HELP);
    expect(providerButtons()).toHaveLength(0);

    const backToSignIn: HTMLElement = screen.getByText("Back to sign in");

    expect(backToSignIn.closest("a")).toHaveAttribute(
      "href",
      RouteMap[PageMap.LOGOUT]!.toString(),
    );
  });

  /*
   * The help used to tell every user that single sign-on is part of the
   * Enterprise Edition and to sign in with a password on a Community server,
   * which is no longer true anywhere.
   */
  test("the help makes no claim about editions or licenses", async () => {
    await renderPage();

    const help: HTMLElement = await screen.findByTestId(
      "sso-no-providers-help",
    );

    expect(help).not.toHaveTextContent(/Enterprise/i);
    expect(help).not.toHaveTextContent(/Community/i);
    expect(help).not.toHaveTextContent(/licen[cs]e/i);
    expect(help).not.toHaveTextContent(/edition/i);
    expect(help).not.toHaveTextContent(
      "sign in with your email and password instead",
    );
  });

  test("a project's own SAML provider is the page's one filled button, and starts its sign-in under the project", async () => {
    answers = [providers([PROJECT_SAML])];

    await renderPage();

    expect(screen.getByText("Single Sign On (SSO)")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Please select an SSO provider to log in to this project.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("sso-no-providers-help"),
    ).not.toBeInTheDocument();

    // Its default description is not repeated: "Sign in with" and its name.
    expect(buttonTitles()).toEqual(["Sign in with Okta SAML"]);

    const button: HTMLElement = providerButtons()[0]!;

    expect(button.className).toBe(SIGN_IN_OPTION_PRIMARY_CLASS);
    expect(button).not.toHaveAttribute("aria-describedby");

    fireEvent.click(button);

    expect(navigatedTo()).toEqual([
      `${IDENTITY_ORIGIN}/sso/${PROJECT_ID.toString()}/${PROJECT_SAML["id"]}`,
    ]);
    // On its way: the page waits rather than offering the button again.
    expect(providerButtons()).toHaveLength(0);
  });

  test("a project's OpenID Connect provider starts its sign-in through /oidc", async () => {
    answers = [providers([PROJECT_OIDC])];

    await renderPage();

    expect(buttonTitles()).toEqual(["Sign in with Google"]);

    fireEvent.click(providerButtons()[0]!);

    expect(navigatedTo()).toEqual([
      `${IDENTITY_ORIGIN}/oidc/${PROJECT_ID.toString()}/${PROJECT_OIDC["id"]}`,
    ]);
  });

  /*
   * #5193: the server's providers sign people in to the project too, so
   * they are on the page - after the project's own, as the server lists
   * them.
   */
  test("lists the server's providers that reach the project after its own, each starting its own sign-in", async () => {
    answers = [
      providers([PROJECT_SAML, PROJECT_OIDC, GLOBAL_SAML, GLOBAL_OIDC]),
    ];

    await renderPage();

    expect(buttonTitles()).toEqual([
      "Sign in with Okta SAML",
      "Sign in with Google",
      "Acme Entra ID",
      "Sign in with Keycloak",
    ]);

    // Several ways in: each one an outlined option.
    for (const button of providerButtons()) {
      expect(button.className).toBe(getSignInOptionClassName("ready"));
    }

    fireEvent.click(providerButtons()[2]!);

    expect(navigatedTo()).toEqual([
      `${IDENTITY_ORIGIN}/global-sso/${GLOBAL_SAML["id"]}`,
    ]);
  });

  test("the server's OpenID Connect provider starts its sign-in by its own id", async () => {
    answers = [providers([GLOBAL_OIDC])];

    await renderPage();

    fireEvent.click(providerButtons()[0]!);

    expect(navigatedTo()).toEqual([
      `${IDENTITY_ORIGIN}/global-oidc/${GLOBAL_OIDC["id"]}`,
    ]);
  });

  // The customer's provider: a name, and the line its admin wrote under it.
  test("a description its admin wrote is a line under the provider's name, read out with its button", async () => {
    answers = [providers([GLOBAL_SAML])];

    await renderPage();

    const button: HTMLElement = providerButtons()[0]!;

    expect(button).toHaveTextContent("Acme Entra ID");
    expect(button).not.toHaveTextContent("Sign in with");

    const description: HTMLElement = screen.getByText(
      "Use your Acme email address",
    );
    const descriptionId: string = description.getAttribute("id") || "";

    expect(descriptionId).not.toBe("");
    expect(button).toHaveAttribute("aria-describedby", descriptionId);
    expect(description).toHaveAttribute("dir", "auto");
  });

  test("leaves out what is no provider it can start", async () => {
    answers = [
      providers([
        { ...PROJECT_SAML, id: "not-an-id" },
        { ...PROJECT_OIDC, type: "SomethingElse" },
        { ...GLOBAL_OIDC, name: "  " },
        GLOBAL_SAML,
        // Listed twice: one button.
        GLOBAL_SAML,
      ]),
    ];

    await renderPage();

    expect(buttonTitles()).toEqual(["Acme Entra ID"]);
  });

  test("a list that cannot be read says so, with Refresh, and reads again", async () => {
    answers = [
      { status: 500, data: { message: "The identity server is restarting." } },
      providers([PROJECT_SAML]),
    ];

    await renderPage();

    expect(
      screen.getByText("The identity server is restarting."),
    ).toBeInTheDocument();
    expect(providerButtons()).toHaveLength(0);
    // Not "no provider": nothing is known yet.
    expect(
      screen.queryByTestId("sso-no-providers-help"),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    expect(requestedUrls).toEqual([SIGN_IN_METHODS_URL, SIGN_IN_METHODS_URL]);
    expect(buttonTitles()).toEqual(["Sign in with Okta SAML"]);
    expect(
      screen.queryByText("The identity server is restarting."),
    ).not.toBeInTheDocument();
  });

  test("without a project it reads nothing and says there is no provider", async () => {
    jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);

    await renderPage();

    expect(requestedUrls).toEqual([]);
    expect(screen.getByTestId("sso-no-providers-help")).toHaveTextContent(
      NO_PROVIDER_HELP,
    );
  });

  test("reads in the person's language: the buttons, and the help", async () => {
    const german: Record<string, string> = readLocale("de");

    await act(async () => {
      await i18next.changeLanguage("de");
    });

    answers = [providers([PROJECT_SAML, GLOBAL_OIDC])];

    await renderPage();

    const signInWith: string = german[SIGN_IN_WITH_PROVIDER]!;

    expect(signInWith).toContain("{{name}}");
    expect(signInWith).not.toBe(SIGN_IN_WITH_PROVIDER);
    expect(buttonTitles()).toEqual([
      signInWith.replace("{{name}}", "Okta SAML"),
      signInWith.replace("{{name}}", "Keycloak"),
    ]);

    cleanup();
    answers = [providers([])];

    await renderPage();

    const help: HTMLElement = screen.getByTestId("sso-no-providers-help");

    expect(german[NO_PROVIDER_HELP]).toBeDefined();
    expect(
      within(help).getByText(german[NO_PROVIDER_HELP]!),
    ).toBeInTheDocument();
  });

  /*
   * The project's Test Single Sign On (SSO) card links here to test a
   * provider before it is required of everyone (it prints
   * <dashboard>/<projectId>/sso, pinned in SsoPages.test.tsx).
   */
  test("is the page the Settings test links open", () => {
    expect(RouteMap[PageMap.PROJECT_SSO]!.toString()).toBe(
      "/dashboard/:projectId/sso",
    );
  });
});
