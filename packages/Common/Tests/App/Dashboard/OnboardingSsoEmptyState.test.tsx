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
import SSO from "../../../../App/FeatureSet/Dashboard/src/Pages/Onboarding/SSO";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getJestSpyOn } from "../../Spy";

/*
 * Dashboard > project SSO sign-in (Onboarding/SSO): where a user lands when a
 * project requires SSO. It lists the project's providers from
 * /project-sso/:projectId/sso-list.
 *
 * That list is empty when the project has no enabled provider - and always on
 * the Community Edition, where SSO login is part of the Enterprise Edition and
 * the server lists no providers. The page must then explain why and offer a
 * way back to sign-in, rather than a dead end.
 */

type ProviderRow = { _id: string; name: string };

interface ProviderListProps {
  id: string;
  overrideFetchApiUrl: URL;
  noItemsMessage: string;
  onListLoaded?: (list: Array<ProviderRow>) => void;
  onSelectChange?: (list: Array<ProviderRow>) => void;
}

let providersForTest: Array<ProviderRow> = [];

/*
 * The real ModelList fetches over HTTP; this stand-in "loads" the configured
 * providers the same way (onListLoaded after mount) and renders them.
 */
jest.mock("../../../UI/Components/ModelList/ModelList", () => {
  return {
    __esModule: true,
    default: (props: ProviderListProps): ReactElement => {
      useEffect(() => {
        props.onListLoaded?.(providersForTest);
      }, []);

      return (
        <div
          data-testid={props.id}
          data-fetch-url={props.overrideFetchApiUrl.toString()}
        >
          {providersForTest.length === 0 ? (
            <p>{props.noItemsMessage}</p>
          ) : (
            providersForTest.map((provider: ProviderRow) => {
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

const renderPage: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    render(
      <SSO
        pageRoute={new Route("/dashboard/project/sso")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
  });
};

describe("Dashboard project SSO sign-in page", () => {
  beforeEach(() => {
    providersForTest = [];
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      PROJECT_ID,
    );
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("with no provider (always the case on the Community Edition) it explains why and links back to sign-in", async () => {
    await renderPage();

    const help: HTMLElement = await screen.findByTestId(
      "sso-no-providers-help",
    );

    expect(help).toHaveTextContent(
      "This project has no single sign-on provider you can use to log in.",
    );
    expect(help).toHaveTextContent(
      "Single sign-on is part of the OneUptime Enterprise Edition",
    );
    expect(help).toHaveTextContent(
      "sign in with your email and password instead",
    );

    const backToSignIn: HTMLElement = screen.getByText("Back to sign in");

    expect(backToSignIn.closest("a")).toHaveAttribute(
      "href",
      RouteMap[PageMap.LOGOUT]!.toString(),
    );
  });

  test("with providers it lists them, shows no help text, and signs in with the chosen one", async () => {
    providersForTest = [
      { _id: "22222222-2222-4222-8222-222222222222", name: "Okta" },
    ];
    const navigate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation(() => {});

    await renderPage();

    expect(
      screen.queryByTestId("sso-no-providers-help"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Okta"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toContain(
      `/sso/${PROJECT_ID.toString()}/22222222-2222-4222-8222-222222222222`,
    );
  });

  test("lists providers from the project's sso-list endpoint", async () => {
    await renderPage();

    expect(
      screen.getByTestId("sso-list").getAttribute("data-fetch-url"),
    ).toContain(`/project-sso/${PROJECT_ID.toString()}/sso-list`);
  });
});
