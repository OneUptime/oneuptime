import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";

/*
 * A status page's sign-on providers were two pages - SSO (…/sso, SAML) and
 * OIDC (…/oidc) - two menu entries with the same lock icon, and are one
 * Single Sign-On page with a tab per protocol now (#9130). The SAML tab
 * kept the SSO page's address; the OIDC page's address stays, so a bookmark
 * or a link in a wiki still arrives: it forwards to the Single Sign-On page,
 * on its OIDC tab.
 *
 * This mounts the REAL status page route group, with the layouts and the
 * page that matters here replaced by recorders, and visits the old URL.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
      getItem: () => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

type MockPageProps = { pageRoute?: { toString: () => string } | undefined };

// A page that says which it is, where it was reached, and how.
function mockPage(name: string): {
  __esModule: boolean;
  default: (props: MockPageProps) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      const router: typeof import("react-router-dom") = jest.requireActual(
        "react-router-dom",
      ) as typeof import("react-router-dom");
      const location: ReturnType<typeof router.useLocation> =
        router.useLocation();
      const navigationType: string = router.useNavigationType();

      return (
        <div
          data-testid="page"
          data-page={name}
          data-page-route={props.pageRoute?.toString() || ""}
        >
          <span data-testid="pathname">{location.pathname}</span>
          <span data-testid="search">{location.search}</span>
          <span data-testid="hash">{location.hash}</span>
          <span data-testid="navigation-type">{navigationType}</span>
        </div>
      );
    },
  };
}

function mockLayout(name: string): {
  __esModule: boolean;
  default: () => ReactElement;
} {
  return {
    __esModule: true,
    default: (): ReactElement => {
      const router: typeof import("react-router-dom") = jest.requireActual(
        "react-router-dom",
      ) as typeof import("react-router-dom");

      return (
        <div data-testid="layout" data-layout={name}>
          <router.Outlet />
        </div>
      );
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Layout",
  () => {
    return mockLayout("status-pages");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Layout",
  () => {
    return mockLayout("status-page-view");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SingleSignOn",
  () => {
    return mockPage("SingleSignOn");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SCIM",
  () => {
    return mockPage("SCIM");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index",
  () => {
    return mockPage("StatusPageView");
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesRoutes from "../../../../App/FeatureSet/Dashboard/src/Routes/StatusPagesRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import StatusPageSingleSignOnProtocol, {
  DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL,
  MOVED_SINGLE_SIGN_ON_PATHS,
  getStatusPageSingleSignOnProtocolQuery,
  readStatusPageSingleSignOnProtocol,
} from "../../../Types/StatusPage/StatusPageSingleSignOnProtocol";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const STATUS_PAGE_ID: string = "6e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const BASE: string = `/dashboard/${PROJECT_ID}/status-pages`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/home`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

function visit(url: string): void {
  // RouteUtil reads the project id from window.location.
  goTo(url.split(/[?#]/)[0]!);

  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <RouterRoute
          path={RouteUtil.getRouteString(PageMap.STATUS_PAGES_ROOT)}
          element={<StatusPagesRoutes {...PAGE_PROPS} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

function landedOn(): string {
  return (
    (screen.getByTestId("pathname").textContent ?? "") +
    (screen.getByTestId("search").textContent ?? "") +
    (screen.getByTestId("hash").textContent ?? "")
  );
}

function pageName(): string | null {
  const pages: Array<HTMLElement> = screen.queryAllByTestId("page");

  expect(pages).toHaveLength(1);

  return pages[0]!.getAttribute("data-page");
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the Single Sign-On page", () => {
  test("keeps the old SSO page's address, and opens as itself there", () => {
    expect(
      RouteMap[PageMap.STATUS_PAGE_VIEW_SSO]!.toString().endsWith("/:id/sso"),
    ).toBe(true);

    visit(`${BASE}/${STATUS_PAGE_ID}/sso`);

    expect(pageName()).toBe("SingleSignOn");
    expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/sso`);
    expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");
  });

  test("opens on the OIDC tab when its address says so", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/sso?protocol=oidc`);

    expect(pageName()).toBe("SingleSignOn");
    expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/sso?protocol=oidc`);
  });

  test("SCIM keeps a page of its own beside it", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/scim`);

    expect(pageName()).toBe("SCIM");
  });
});

describe("the old OIDC page's URL", () => {
  test("is the one page the tabs replaced", () => {
    expect(MOVED_SINGLE_SIGN_ON_PATHS).toEqual({
      oidc: StatusPageSingleSignOnProtocol.OIDC,
    });
  });

  test("arrives at the Single Sign-On page, on its OIDC tab, inside the status page's layout", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/oidc`);

    expect(pageName()).toBe("SingleSignOn");
    expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/sso?protocol=oidc`);
    expect(
      screen.getAllByTestId("layout").map((element: HTMLElement) => {
        return element.getAttribute("data-layout");
      }),
    ).toEqual(["status-page-view"]);
  });

  test("keeps the status page it was for, its own query string and its hash", () => {
    const otherStatusPageId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

    visit(`${BASE}/${otherStatusPageId}/oidc?from=wiki#providers`);

    expect(landedOn()).toBe(
      `${BASE}/${otherStatusPageId}/sso?from=wiki&protocol=oidc#providers`,
    );
  });

  test("replaces the history entry, so Back does not bounce", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/oidc`);

    expect(screen.getByTestId("navigation-type")).toHaveTextContent("REPLACE");
  });

  test("has no page of its own in the route table", () => {
    expect(
      Object.values(RouteMap)
        .map((route: Route): string => {
          return route.toString();
        })
        .filter((route: string): boolean => {
          return route.includes("/status-pages/") && route.endsWith("/oidc");
        }),
    ).toEqual([]);
  });
});

describe("the protocol in the address", () => {
  test("SAML is the first tab, and a bare address", () => {
    expect(DEFAULT_STATUS_PAGE_SINGLE_SIGN_ON_PROTOCOL).toBe(
      StatusPageSingleSignOnProtocol.SAML,
    );
    expect(
      getStatusPageSingleSignOnProtocolQuery(
        StatusPageSingleSignOnProtocol.SAML,
      ),
    ).toEqual({});
    expect(
      getStatusPageSingleSignOnProtocolQuery(
        StatusPageSingleSignOnProtocol.OIDC,
      ),
    ).toEqual({ protocol: "oidc" });
  });

  test.each([
    ["oidc", StatusPageSingleSignOnProtocol.OIDC],
    [" OIDC ", StatusPageSingleSignOnProtocol.OIDC],
    ["saml", StatusPageSingleSignOnProtocol.SAML],
    ["sso", null],
    ["", null],
    [null, null],
    [undefined, null],
  ])(
    "%p reads as %p",
    (
      value: string | null | undefined,
      expected: StatusPageSingleSignOnProtocol | null,
    ) => {
      expect(readStatusPageSingleSignOnProtocol(value)).toBe(expected);
    },
  );
});
