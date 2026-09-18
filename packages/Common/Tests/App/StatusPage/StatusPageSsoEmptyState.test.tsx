import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement, useEffect } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
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
 * sign-on is not available and links back to the password sign-in.
 */

type ProviderRow = { _id: string; name: string };

interface ProviderListProps {
  id: string;
  overrideFetchApiUrl: URL;
  noItemsMessage: string;
  onListLoaded?: (list: Array<ProviderRow>) => void;
}

const providersById: Record<string, Array<ProviderRow>> = {};

jest.mock("../../../UI/Components/ModelList/ModelList", () => {
  return {
    __esModule: true,
    default: (props: ProviderListProps): ReactElement => {
      useEffect(() => {
        props.onListLoaded?.(providersById[props.id] || []);
      }, []);

      return (
        <div data-testid={props.id}>
          {(providersById[props.id] || []).map((provider: ProviderRow) => {
            return <span key={provider._id}>{provider.name}</span>;
          })}
        </div>
      );
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue || key;
        },
      };
    },
  };
});

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const NOT_AVAILABLE: string =
  "Single sign-on is not available for this status page. Sign in with your email and password instead.";

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

describe("Status page SSO sign-in when no provider can be offered", () => {
  let isPreview: boolean = false;

  beforeEach(() => {
    isPreview = false;
    providersById["sso-list"] = [];
    providersById["oidc-list"] = [];

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
    expect(screen.getByText("Back to sign in").closest("a")).toHaveAttribute(
      "href",
      "/login",
    );
  });

  test("on a preview page the link goes back to the preview's sign-in", async () => {
    isPreview = true;

    await renderPage();

    expect(screen.getByText("Back to sign in").closest("a")).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/login`,
    );
  });

  test.each([
    ["a SAML provider", "sso-list"],
    ["an OIDC provider", "oidc-list"],
  ])(
    "with %s it lists it and shows no notice",
    async (_label: string, listId: string) => {
      providersById[listId] = [
        { _id: "22222222-2222-4222-8222-222222222222", name: "Okta" },
      ];

      await renderPage();

      expect(screen.getByText("Okta")).toBeInTheDocument();
      expect(
        screen.queryByTestId("status-page-sso-unavailable"),
      ).not.toBeInTheDocument();
    },
  );
});
