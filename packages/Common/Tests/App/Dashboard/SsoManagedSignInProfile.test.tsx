import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  MemoryRouter,
  Outlet,
  Route as PageRoute,
  Routes,
} from "react-router-dom";
import UserProfileLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Layout";
import UserProfileSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/SideMenu";
import UserProfileOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Index";
import UserProfilePassword from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Password";
import UserProfilePasskeys from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/Passkeys";
import UserProfileTwoFactorAuth from "../../../../App/FeatureSet/Dashboard/src/Pages/Global/UserProfile/TwoFactorAuth";
import {
  fetchSignInManagement,
  LOCAL_SIGN_IN,
  LocalSignInSettings,
  SignInManagementContext,
  SignInManagementState,
  SsoManagedSignInNotice,
  useSignInManagement,
} from "../../../../App/FeatureSet/Dashboard/src/Components/UserProfile/SignInManagement";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { SignInManagement } from "../../../Types/SSO/SsoManagedSignIn";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * USER PROFILE FOR SOMEBODY WHOSE ORGANIZATION MANAGES THEIR SIGN-IN (#9688).
 *
 * While the server requires single sign-on, everyone but a master admin
 * signs in with SSO alone and sets no password, passkey or two-factor
 * authentication in OneUptime - the server refuses each one. Their profile
 * says so instead of offering settings that would do nothing:
 *
 *   - its side menu has no Security section (nor while the answer is on
 *     its way, so it never shows and then goes);
 *   - its Overview says who manages their sign-in, naming the server's SSO
 *     providers, or "single sign-on" when it names none;
 *   - a Security page reached anyway (a bookmark, Search) says the same,
 *     in place of its settings.
 *
 * Everybody else sees every setting, as before - and so does somebody whose
 * answer cannot be had: the server refuses what it must either way.
 */

/*
 * The Overview's other cards read and write the person's account; they have
 * suites of their own. Only the card this suite is about is drawn for real.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <section data-testid="basic-info">Basic Info</section>;
    },
  };
});

const USER_ID: ObjectID = new ObjectID("47474747-4747-4747-8747-474747474747");

const MANAGED: SignInManagement = {
  isManagedBySso: true,
  ssoProviderNames: ["Okta"],
};

// What the server answers to GET /user/sign-in-management.
let signInAnswer: JSONObject | HTTPErrorResponse | Error;
let readSignIn: jest.SpyInstance;

beforeEach(() => {
  signInAnswer = { isManagedBySso: false, ssoProviderNames: [] };
  window.localStorage.clear();
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(USER_ID);

  readSignIn = jest
    .spyOn(API, "get")
    .mockImplementation(
      async (
        options: Parameters<typeof API.get>[0],
      ): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
        const url: string = options.url?.toString() || "";

        if (url.endsWith("/user/sign-in-management")) {
          if (signInAnswer instanceof Error) {
            throw signInAnswer;
          }
          if (signInAnswer instanceof HTTPErrorResponse) {
            return signInAnswer;
          }
          return new HTTPResponse<JSONObject>(200, signInAnswer, {});
        }

        // The Passkeys page reads where the person stands on two-factor authentication.
        if (url.endsWith("/user/two-factor-auth-status")) {
          return new HTTPResponse<JSONObject>(
            200,
            { status: "NotEnabled", verifiedMethodCount: 0 },
            {},
          );
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const renderMenu: (state?: SignInManagementState | undefined) => void = (
  state?: SignInManagementState | undefined,
): void => {
  render(
    <MemoryRouter initialEntries={["/dashboard/user-profile/overview"]}>
      {state === undefined ? (
        <UserProfileSideMenu />
      ) : (
        <UserProfileSideMenu signInManagement={state} />
      )}
    </MemoryRouter>,
  );
};

const SECURITY_ENTRIES: Array<string | RegExp> = [
  "Password Management",
  "Passkeys",
  /Two.factor authentication/i,
];

describe("the side menu", () => {
  test.each([
    ["is told nothing (a page outside the layout)", undefined],
    ["manages their own sign-in", LOCAL_SIGN_IN],
  ])(
    "lists Security for somebody who %s",
    (_label: string, state: SignInManagementState | undefined) => {
      renderMenu(state);

      for (const entry of SECURITY_ENTRIES) {
        expect(screen.getByRole("link", { name: entry })).toBeInTheDocument();
      }
    },
  );

  test("has no Security section for somebody whose organization manages their sign-in", () => {
    renderMenu(MANAGED);

    expect(screen.queryByText("Security")).not.toBeInTheDocument();
    for (const entry of SECURITY_ENTRIES) {
      expect(
        screen.queryByRole("link", { name: entry }),
      ).not.toBeInTheDocument();
    }
    // The rest of the profile is theirs as ever.
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Profile Picture" }),
    ).toBeInTheDocument();
  });

  test("holds Security back while the answer is on its way, so it never shows and then goes", () => {
    renderMenu(null);

    expect(
      screen.queryByRole("link", { name: "Password Management" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
  });
});

describe("what the profile says instead", () => {
  test("names the server's provider, and says what is managed there", () => {
    render(<SsoManagedSignInNotice ssoProviderNames={["Okta"]} />);

    expect(screen.getByText("Single Sign-On")).toBeVisible();
    expect(
      screen.getByText(
        "Your organization manages how you sign in to OneUptime.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("sso-managed-sign-in")).toHaveTextContent(
      "You sign in with Okta. Your password, passkeys and two-factor authentication are managed there, not in OneUptime.",
    );
  });

  test("names two providers as a sentence lists them", () => {
    render(
      <SsoManagedSignInNotice
        ssoProviderNames={["Okta", "Microsoft Entra ID"]}
      />,
    );

    expect(screen.getByTestId("sso-managed-sign-in")).toHaveTextContent(
      "You sign in with Okta or Microsoft Entra ID.",
    );
  });

  test("says single sign-on when the server names no provider", () => {
    render(<SsoManagedSignInNotice ssoProviderNames={[]} />);

    expect(screen.getByTestId("sso-managed-sign-in")).toHaveTextContent(
      "You sign in with single sign-on (SSO).",
    );
  });

  test("draws a provider's name as it was typed, never as markup", () => {
    render(<SsoManagedSignInNotice ssoProviderNames={["<b>Okta</b> & co"]} />);

    expect(screen.getByTestId("sso-managed-sign-in")).toHaveTextContent(
      "You sign in with <b>Okta</b> & co.",
    );
    expect(
      within(screen.getByTestId("sso-managed-sign-in")).queryByText("Okta", {
        selector: "b",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("a Security page's settings (LocalSignInSettings)", () => {
  const renderGate: (state: SignInManagementState | undefined) => void = (
    state: SignInManagementState | undefined,
  ): void => {
    const content: React.ReactElement = (
      <LocalSignInSettings>
        <p>The settings</p>
      </LocalSignInSettings>
    );

    render(
      state === undefined ? (
        content
      ) : (
        <SignInManagementContext.Provider value={state}>
          {content}
        </SignInManagementContext.Provider>
      ),
    );
  };

  test("are shown to somebody who manages their own sign-in", () => {
    renderGate(LOCAL_SIGN_IN);

    expect(screen.getByText("The settings")).toBeVisible();
    expect(screen.queryByTestId("sso-managed-sign-in")).not.toBeInTheDocument();
  });

  test("are shown on a page drawn without the layout around it", () => {
    renderGate(undefined);

    expect(screen.getByText("The settings")).toBeVisible();
  });

  test("give way to who manages the sign-in, for somebody whose organization does", () => {
    renderGate(MANAGED);

    expect(screen.queryByText("The settings")).not.toBeInTheDocument();
    expect(screen.getByTestId("sso-managed-sign-in")).toHaveTextContent(
      "You sign in with Okta.",
    );
  });

  test("wait for the answer, drawing neither the settings nor the notice", () => {
    renderGate(null);

    expect(screen.queryByText("The settings")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sso-managed-sign-in")).not.toBeInTheDocument();
  });
});

describe("the Security pages, for somebody whose organization manages their sign-in", () => {
  const renderPage: (
    Page: React.FunctionComponent<{
      pageRoute: Route;
      currentProject: null;
      hasPaymentMethod: boolean;
    }>,
    path: string,
    state: SignInManagementState,
  ) => void = (
    Page: React.FunctionComponent<{
      pageRoute: Route;
      currentProject: null;
      hasPaymentMethod: boolean;
    }>,
    path: string,
    state: SignInManagementState,
  ): void => {
    const pageRoute: Route = new Route(path);
    Navigation.setLocation({
      pathname: path,
      search: "",
      hash: "",
      state: null,
      key: "sso-managed-profile-test",
    });
    render(
      <MemoryRouter initialEntries={[path]}>
        <SignInManagementContext.Provider value={state}>
          <Page
            pageRoute={pageRoute}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </SignInManagementContext.Provider>
      </MemoryRouter>,
    );
  };

  test("Password Management offers no password", () => {
    renderPage(
      UserProfilePassword as never,
      "/dashboard/user-profile/password-management",
      MANAGED,
    );

    expect(screen.getByTestId("sso-managed-sign-in")).toBeVisible();
    expect(screen.queryByText("Update Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
  });

  test("Passkeys offers no passkey", async () => {
    renderPage(
      UserProfilePasskeys as never,
      "/dashboard/user-profile/passkeys",
      MANAGED,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("sso-managed-sign-in")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Add Passkey" }),
    ).not.toBeInTheDocument();
  });

  test("Two-factor authentication offers no second step and no switch", () => {
    renderPage(
      UserProfileTwoFactorAuth as never,
      "/dashboard/user-profile/two-factor-auth",
      MANAGED,
    );

    expect(screen.getByTestId("sso-managed-sign-in")).toBeVisible();
    expect(
      screen.queryByRole("button", {
        name: "Enable two-factor authentication",
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Authenticator apps")).not.toBeInTheDocument();
    expect(screen.queryByText("Security keys")).not.toBeInTheDocument();
    // Nothing about two-factor authentication is even read.
    expect(readSignIn).not.toHaveBeenCalled();
  });

  test("the Overview says who manages the sign-in", () => {
    renderPage(
      UserProfileOverview as never,
      "/dashboard/user-profile/overview",
      MANAGED,
    );

    expect(screen.getByTestId("basic-info")).toBeVisible();
    expect(screen.getByTestId("sso-managed-sign-in")).toHaveTextContent(
      "You sign in with Okta.",
    );
  });

  test("the Overview says nothing of it to somebody who manages their own", () => {
    renderPage(
      UserProfileOverview as never,
      "/dashboard/user-profile/overview",
      LOCAL_SIGN_IN,
    );

    expect(screen.getByTestId("basic-info")).toBeVisible();
    expect(screen.queryByTestId("sso-managed-sign-in")).not.toBeInTheDocument();
  });
});

describe("the layout asks the server once, for its menu and its pages", () => {
  // A page that shows what the layout told it.
  const Probe: React.FunctionComponent = (): React.ReactElement => {
    const state: SignInManagementState = useSignInManagement();

    return (
      <p data-testid="probe">
        {state === null
          ? "waiting"
          : state.isManagedBySso
            ? `managed: ${state.ssoProviderNames.join(", ")}`
            : "local"}
      </p>
    );
  };

  const renderLayout: (path?: string) => void = (
    path: string = "/dashboard/user-profile/overview",
  ): void => {
    Navigation.setLocation({
      pathname: path,
      search: "",
      hash: "",
      state: null,
      key: "sso-managed-layout-test",
    });
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <PageRoute element={<UserProfileLayout />}>
            <PageRoute path="/dashboard/user-profile/*" element={<Probe />} />
          </PageRoute>
        </Routes>
        <Outlet />
      </MemoryRouter>,
    );
  };

  test("a managed answer hides Security and reaches the pages", async () => {
    signInAnswer = {
      isManagedBySso: true,
      ssoProviderNames: ["Okta", "Okta", "  Entra ID "],
    };
    renderLayout();

    expect(await screen.findByText("managed: Okta, Entra ID")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Password Management" }),
    ).not.toBeInTheDocument();
    expect(readSignIn).toHaveBeenCalledTimes(1);
  });

  test("an answer for somebody who manages their own sign-in shows Security", async () => {
    renderLayout();

    expect(await screen.findByText("local")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Password Management" }),
    ).toBeInTheDocument();
  });

  test.each([
    ["the server refused the request", new HTTPErrorResponse(500, {}, {})],
    ["the request failed", new Error("Network Error")],
    ["the answer is not one", { isManagedBySso: "yes" }],
  ])(
    "when %s, the settings show: the server still refuses what it must",
    async (_label: string, answer: JSONObject | HTTPErrorResponse | Error) => {
      signInAnswer = answer;
      renderLayout();

      expect(await screen.findByText("local")).toBeVisible();
      expect(
        screen.getByRole("link", { name: "Password Management" }),
      ).toBeInTheDocument();
    },
  );
});

describe("fetchSignInManagement", () => {
  test("reads the answer", async () => {
    signInAnswer = { isManagedBySso: true, ssoProviderNames: ["Okta"] };

    await expect(fetchSignInManagement()).resolves.toEqual(MANAGED);
  });

  test.each([
    ["a refusal", new HTTPErrorResponse(403, {}, {})],
    ["a failure", new Error("timeout")],
    ["no answer", {}],
  ])(
    "reads %s as somebody who manages their own sign-in",
    async (_label: string, answer: JSONObject | HTTPErrorResponse | Error) => {
      signInAnswer = answer;

      await expect(fetchSignInManagement()).resolves.toEqual(LOCAL_SIGN_IN);
    },
  );
});
