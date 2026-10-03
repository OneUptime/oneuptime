import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement, useEffect } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProjectUtil from "../../../UI/Utils/Project";
import Navigation from "../../../UI/Utils/Navigation";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import OnboardingSsoPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/SSO";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getJestSpyOn } from "../../Spy";

/*
 * Dashboard > project SSO sign-in (Onboarding/SSO): where a user lands when a
 * project requires SSO, and what the Settings > SSO and Settings > OIDC test
 * links open. It lists the project's enabled providers of both kinds: SAML
 * from /project-sso/:projectId/sso-list and OpenID Connect from
 * /project-oidc/:projectId/oidc-list. It listed SAML only, so a project that
 * signs in with OIDC was told it had no provider at all.
 *
 * With no enabled provider of either kind the page explains why and offers
 * a way back to sign-in, rather than a dead end. Single sign-on is part of
 * every edition, so the explanation makes no claim about editions or
 * licenses.
 */

type ProviderRow = { _id: string; name: string };

interface ProviderListProps {
  id: string;
  overrideFetchApiUrl: URL;
  noItemsMessage: string;
  hideEmptyState?: boolean | undefined;
  onListLoaded?: (list: Array<ProviderRow>) => void;
  onSelectChange?: (list: Array<ProviderRow>) => void;
}

// The enabled providers each list loads, by the list's id.
let providersForTest: Record<string, Array<ProviderRow>> = {};

/*
 * The real ModelList fetches over HTTP; this stand-in "loads" the configured
 * providers the same way (onListLoaded after mount) and renders them - or,
 * when the list is empty, its own empty message unless the page hides it.
 */
jest.mock("../../../UI/Components/ModelList/ModelList", () => {
  return {
    __esModule: true,
    default: (props: ProviderListProps): ReactElement => {
      const providers: Array<ProviderRow> = providersForTest[props.id] || [];

      useEffect(() => {
        props.onListLoaded?.(providers);
      }, []);

      return (
        <div
          data-testid={props.id}
          data-fetch-url={props.overrideFetchApiUrl.toString()}
          data-hide-empty-state={String(Boolean(props.hideEmptyState))}
        >
          {providers.length === 0 ? (
            props.hideEmptyState ? (
              <></>
            ) : (
              <p>{props.noItemsMessage}</p>
            )
          ) : (
            providers.map((provider: ProviderRow) => {
              return (
                <button
                  key={provider._id}
                  onClick={() => {
                    props.onSelectChange?.([provider]);
                  }}
                >
                  {provider.name}
                </button>
              );
            })
          )}
        </div>
      );
    },
  };
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const SAML_PROVIDER: ProviderRow = {
  _id: "22222222-2222-4222-8222-222222222222",
  name: "Okta SAML",
};

const OIDC_PROVIDER: ProviderRow = {
  _id: "33333333-3333-4333-8333-333333333333",
  name: "Google",
};

const NO_PROVIDERS_HELP: string =
  "This project has no single sign-on provider you can use to log in. Ask a project admin to enable one.";

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

describe("Dashboard project SSO sign-in page", () => {
  beforeEach(() => {
    providersForTest = {};
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      PROJECT_ID,
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("with no provider it explains why and links back to sign-in", async () => {
    await renderPage();

    const help: HTMLElement = await screen.findByTestId(
      "sso-no-providers-help",
    );

    expect(help).toHaveTextContent(NO_PROVIDERS_HELP);

    const backToSignIn: HTMLElement = screen.getByText("Back to sign in");

    expect(backToSignIn.closest("a")).toHaveAttribute(
      "href",
      RouteMap[PageMap.LOGOUT]!.toString(),
    );

    // Said once, by the page: the two empty lists say nothing of their own.
    expect(
      screen.queryByText("No SSO Providers Configured or Enabled"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("sso-list")).toHaveAttribute(
      "data-hide-empty-state",
      "true",
    );
    expect(screen.getByTestId("oidc-list")).toHaveAttribute(
      "data-hide-empty-state",
      "true",
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

  test("with SAML providers it lists them, shows no help text, and signs in with the chosen one", async () => {
    providersForTest = { "sso-list": [SAML_PROVIDER] };
    const navigate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});

    await renderPage();

    expect(
      screen.queryByTestId("sso-no-providers-help"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Okta SAML"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toContain(
      `/sso/${PROJECT_ID.toString()}/${SAML_PROVIDER._id}`,
    );
  });

  test("with only an OIDC provider it lists it, shows no help text, and signs in through /oidc", async () => {
    providersForTest = { "oidc-list": [OIDC_PROVIDER] };
    const navigate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});

    await renderPage();

    expect(
      screen.queryByTestId("sso-no-providers-help"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Google"));

    expect(navigate).toHaveBeenCalledTimes(1);

    const target: string = String(navigate.mock.calls[0]![0]);

    expect(target).toContain(
      `/identity/oidc/${PROJECT_ID.toString()}/${OIDC_PROVIDER._id}`,
    );
    expect(target).not.toContain("/sso/");
  });

  test("lists both kinds side by side", async () => {
    providersForTest = {
      "sso-list": [SAML_PROVIDER],
      "oidc-list": [OIDC_PROVIDER],
    };

    await renderPage();

    expect(screen.getByText("Okta SAML")).toBeInTheDocument();
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(
      screen.queryByTestId("sso-no-providers-help"),
    ).not.toBeInTheDocument();
  });

  test("lists providers from the project's sso-list and oidc-list endpoints", async () => {
    await renderPage();

    expect(
      screen.getByTestId("sso-list").getAttribute("data-fetch-url"),
    ).toContain(`/project-sso/${PROJECT_ID.toString()}/sso-list`);
    expect(
      screen.getByTestId("oidc-list").getAttribute("data-fetch-url"),
    ).toContain(`/project-oidc/${PROJECT_ID.toString()}/oidc-list`);
  });

  /*
   * Settings > SSO and Settings > OIDC link here to test a provider before it
   * is forced on everyone (their pages print
   * <dashboard>/<projectId>/sso, pinned in SsoPages.test.tsx).
   */
  test("is the page the Settings test links open", () => {
    expect(RouteMap[PageMap.PROJECT_SSO]!.toString()).toBe(
      "/dashboard/:projectId/sso",
    );
  });
});
