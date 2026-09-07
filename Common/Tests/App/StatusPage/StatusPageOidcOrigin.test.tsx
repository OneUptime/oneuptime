import type * as StatusPageConfig from "../../../../App/FeatureSet/StatusPage/src/Utils/Config";
import type { ComponentProps } from "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/SSO";
import type * as SharedConfig from "../../../UI/Config";
import type NavigationUtil from "../../../UI/Utils/Navigation";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

interface ProviderListProps {
  id: string;
  overrideFetchApiUrl: URL;
  onSelectChange: (list: Array<{ _id: string }>) => void;
}

interface LoginEnvironment {
  pageUrl: string;
  host: string;
  protocol: string;
}

/*
 * Keep provider discovery local to this test while exercising the real SSO
 * page's selection handler, URL construction, and redirect storage.
 */
jest.mock("Common/UI/Components/ModelList/ModelList", () => {
  return {
    __esModule: true,
    default: (props: ProviderListProps): ReactElement => {
      return (
        <button
          data-testid={props.id}
          data-fetch-url={props.overrideFetchApiUrl.toString()}
          onClick={() => {
            props.onSelectChange([
              { _id: "22222222-2222-4222-8222-222222222222" },
            ]);
          }}
        >
          {props.id}
        </button>
      );
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

/*
 * Isolated imports re-evaluate the build's environment-dependent constants.
 * Share React with Testing Library so rendered cases use one hook dispatcher.
 */
jest.doMock("react", () => {
  return React;
});

const originalLocation: Location = window.location;
const originalHost: string | undefined = process.env["HOST"];
const originalProtocol: string | undefined = process.env["HTTP_PROTOCOL"];
const statusPageId: string = "11111111-1111-4111-8111-111111111111";
const providerId: string = "22222222-2222-4222-8222-222222222222";

function configureEnvironment(data: LoginEnvironment): void {
  process.env["HOST"] = data.host;
  process.env["HTTP_PROTOCOL"] = data.protocol;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: new globalThis.URL(data.pageUrl),
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  jest.restoreAllMocks();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  if (originalHost === undefined) {
    delete process.env["HOST"];
  } else {
    process.env["HOST"] = originalHost;
  }
  if (originalProtocol === undefined) {
    delete process.env["HTTP_PROTOCOL"];
  } else {
    process.env["HTTP_PROTOCOL"] = originalProtocol;
  }
});

describe("Status Page OIDC login origin", () => {
  test.each([
    {
      name: "custom status-page domain",
      pageUrl: "https://status.example.com/sso",
      host: "oneuptime.example.com",
      protocol: "https",
    },
    {
      name: "preview on the OneUptime domain",
      pageUrl: `https://oneuptime.example.com/status-page/${statusPageId}/sso`,
      host: "oneuptime.example.com",
      protocol: "https",
    },
    {
      name: "HTTP development with a configured port",
      pageUrl: "http://status.localhost:3002/sso",
      host: "localhost:3000",
      protocol: "http",
    },
    {
      name: "configured HTTPS and port differing from the page",
      pageUrl: "http://status.example.com/sso",
      host: "oneuptime.example.com:8443",
      protocol: "https",
    },
  ])("uses the identity origin for $name", (data: LoginEnvironment) => {
    configureEnvironment(data);

    jest.isolateModules(() => {
      const config: typeof StatusPageConfig = jest.requireActual(
        "../../../../App/FeatureSet/StatusPage/src/Utils/Config",
      ) as typeof StatusPageConfig;
      const shared: typeof SharedConfig = jest.requireActual(
        "../../../UI/Config",
      ) as typeof SharedConfig;
      const identityOrigin: string = `${data.protocol}://${data.host}`;
      const pageOrigin: string = new globalThis.URL(data.pageUrl).origin;

      expect(config.STATUS_PAGE_OIDC_API_URL.toString()).toBe(
        `${identityOrigin}/identity/status-page-oidc`,
      );
      // Deriving the OIDC endpoint must not mutate the shared identity URL.
      expect(shared.IDENTITY_URL.toString()).toBe(`${identityOrigin}/identity`);
      expect(config.STATUS_PAGE_API_URL.toString()).toBe(
        `${pageOrigin}/status-page-api`,
      );
      expect(config.STATUS_PAGE_SSO_API_URL.toString()).toBe(
        `${pageOrigin}/status-page-sso-api`,
      );
      expect(config.STATUS_PAGE_IDENTITY_API_URL.toString()).toBe(
        `${pageOrigin}/status-page-identity-api`,
      );
    });
  });

  test.each([
    {
      name: "custom domain",
      pageOrigin: "https://status.example.com",
      loginPath: "/sso",
      redirectPath: "/incidents/incident-id?tab=timeline#update",
    },
    {
      name: "preview",
      pageOrigin: "https://oneuptime.example.com",
      loginPath: `/status-page/${statusPageId}/sso`,
      redirectPath: `/status-page/${statusPageId}/incidents/incident-id`,
    },
  ])(
    "selecting an OIDC provider from $name navigates to identity and preserves the return path",
    (data: { pageOrigin: string; loginPath: string; redirectPath: string }) => {
      configureEnvironment({
        pageUrl: `${data.pageOrigin}${data.loginPath}?redirectUrl=${encodeURIComponent(data.redirectPath)}`,
        host: "oneuptime.example.com",
        protocol: "https",
      });
      localStorage.setItem("statusPageId", statusPageId);
      localStorage.setItem(`isPrivateStatusPage-${statusPageId}`, "true");

      jest.isolateModules(() => {
        const SSO: FunctionComponent<ComponentProps> = (
          jest.requireActual(
            "../../../../App/FeatureSet/StatusPage/src/Pages/Accounts/SSO",
          ) as { default: FunctionComponent<ComponentProps> }
        ).default;
        const Navigation: typeof NavigationUtil = (
          jest.requireActual("../../../UI/Utils/Navigation") as {
            default: typeof NavigationUtil;
          }
        ).default;
        const navigate: ReturnType<typeof jest.spyOn> = jest
          .spyOn(Navigation, "navigate")
          .mockImplementation(() => {});

        render(
          <SSO
            statusPageName="Example Status"
            logoFileId={new ObjectID(statusPageId)}
          />,
        );
        expect(
          screen.getByTestId("oidc-list").getAttribute("data-fetch-url"),
        ).toBe(`${data.pageOrigin}/status-page-api/oidc/${statusPageId}`);

        fireEvent.click(screen.getByTestId("oidc-list"));

        expect(navigate).toHaveBeenCalledTimes(1);
        expect(navigate.mock.calls[0]?.[0]?.toString()).toBe(
          `https://oneuptime.example.com/identity/status-page-oidc/${statusPageId}/${providerId}`,
        );
        expect(localStorage.getItem("redirectUrl")).toBe(data.redirectPath);
      });
    },
  );
});
