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
import fs from "fs";
import path from "path";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";

/*
 * A status page's branding was five screens - Essential Branding (at
 * …/branding), Header (…/header-style), Footer (…/footer-style), Overview Page
 * (…/overview-page-branding) and Languages (…/languages) - next to an empty
 * Navbar page (…/navbar-style) no menu linked to. It is one Branding page
 * now, at …/branding. The old URLs stay, so a bookmark or a link in a wiki
 * still arrives somewhere: each forwards to the Branding page.
 *
 * This mounts the REAL status page route group, with the layouts and the
 * pages that matter here replaced by recorders, and visits the old URLs.
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
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Branding",
  () => {
    return mockPage("Branding");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Domains",
  () => {
    return mockPage("Domains");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/CustomHtmlCss",
  () => {
    return mockPage("CustomHtmlCss");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/StatusPageSettings",
  () => {
    return mockPage("StatusPageSettings");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/Index",
  () => {
    return mockPage("StatusPageView");
  },
);

import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import StatusPagesRoutes, {
  MOVED_STATUS_PAGE_BRANDING_PATHS,
} from "../../../../App/FeatureSet/Dashboard/src/Routes/StatusPagesRoutes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const STATUS_PAGE_ID: string = "6e1d2c3b-4a5f-4e6d-8c7b-9a0f1e2d3c4b";
const BASE: string = `/dashboard/${PROJECT_ID}/status-pages`;

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

// The old screens, by URL, and the page each one was.
const OLD_SCREENS: Array<[string, string]> = [
  ["header-style", "HeaderStyle.tsx"],
  ["footer-style", "FooterStyle.tsx"],
  ["overview-page-branding", "OverviewPageBranding.tsx"],
  ["languages", "Languages.tsx"],
  ["navbar-style", "NavBarStyle.tsx"],
];

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

describe("the old branding screens' URLs", () => {
  test("are exactly the five screens the one page replaced", () => {
    expect([...MOVED_STATUS_PAGE_BRANDING_PATHS]).toEqual(
      OLD_SCREENS.map(([oldPath]: [string, string]): string => {
        return oldPath;
      }),
    );
  });

  test.each(OLD_SCREENS)(
    "…/%s arrives at the status page's Branding page, inside its layout",
    (oldPath: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}`);

      expect(pageName()).toBe("Branding");
      expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/branding`);
      // Inside the status page's own layout, drawn once.
      expect(
        screen.getAllByTestId("layout").map((element: HTMLElement) => {
          return element.getAttribute("data-layout");
        }),
      ).toEqual(["status-page-view"]);
    },
  );

  test.each(OLD_SCREENS)(
    "…/%s lands where the route table puts Branding",
    (oldPath: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}`);

      expect(landedOn()).toBe(
        RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING]!.toString()
          .replace(":projectId", PROJECT_ID)
          .replace(":id", STATUS_PAGE_ID),
      );
    },
  );

  test.each(OLD_SCREENS)(
    "…/%s keeps the status page it was for",
    (oldPath: string) => {
      const otherStatusPageId: string = "0a1b2c3d-4e5f-4a6b-8c7d-00000000e0f3";

      visit(`${BASE}/${otherStatusPageId}/${oldPath}`);

      expect(landedOn()).toBe(`${BASE}/${otherStatusPageId}/branding`);
    },
  );

  test.each(OLD_SCREENS)(
    "…/%s keeps its query string and hash",
    (oldPath: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}?from=wiki#links`);

      expect(landedOn()).toBe(
        `${BASE}/${STATUS_PAGE_ID}/branding?from=wiki#links`,
      );
    },
  );

  test.each(OLD_SCREENS)(
    "…/%s replaces the history entry, so Back does not bounce",
    (oldPath: string) => {
      visit(`${BASE}/${STATUS_PAGE_ID}/${oldPath}`);

      expect(screen.getByTestId("navigation-type")).toHaveTextContent(
        "REPLACE",
      );
    },
  );

  test("are spelled out where the routes are, since the route table has none of them", () => {
    for (const key of [
      "STATUS_PAGE_VIEW_HEADER_STYLE",
      "STATUS_PAGE_VIEW_FOOTER_STYLE",
      "STATUS_PAGE_VIEW_OVERVIEW_PAGE_BRANDING",
      "STATUS_PAGE_VIEW_NAVBAR_STYLE",
      "STATUS_PAGE_VIEW_LANGUAGES",
    ]) {
      expect([key, Object.keys(PageMap).includes(key)]).toEqual([key, false]);
    }

    const statusPageRoutes: Array<string> = Object.values(RouteMap)
      .map((route: Route): string => {
        return route.toString();
      })
      .filter((route: string): boolean => {
        return route.includes("/status-pages/");
      });

    for (const oldPath of MOVED_STATUS_PAGE_BRANDING_PATHS) {
      expect([
        oldPath,
        statusPageRoutes.filter((route: string): boolean => {
          return route.endsWith(`/${oldPath}`);
        }),
      ]).toEqual([oldPath, []]);
    }
  });
});

describe("the pages beside it", () => {
  test("Branding, Custom Domains and HTML, CSS & JavaScript open as themselves", () => {
    for (const [segment, name] of [
      ["branding", "Branding"],
      ["domains", "Domains"],
      ["custom-code", "CustomHtmlCss"],
      ["settings", "StatusPageSettings"],
    ] as Array<[string, string]>) {
      visit(`${BASE}/${STATUS_PAGE_ID}/${segment}`);

      expect(pageName()).toBe(name);
      expect(landedOn()).toBe(`${BASE}/${STATUS_PAGE_ID}/${segment}`);
      expect(screen.getByTestId("navigation-type")).toHaveTextContent("POP");

      cleanup();
    }
  });

  test("the Branding page gets its own route, as the page it is", () => {
    visit(`${BASE}/${STATUS_PAGE_ID}/branding`);

    expect(screen.getByTestId("page").getAttribute("data-page-route")).toBe(
      RouteMap[PageMap.STATUS_PAGE_VIEW_BRANDING]!.toString(),
    );
  });
});

describe("the screens that were there", () => {
  test.each(OLD_SCREENS)(
    "…/%s: %s is gone from the source, and no route mounts it",
    (_oldPath: string, file: string) => {
      expect(
        fs.existsSync(
          path.join(DASHBOARD_SRC, "Pages", "StatusPages", "View", file),
        ),
      ).toBe(false);

      const routes: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Routes", "StatusPagesRoutes.tsx"),
        "utf8",
      );

      expect(routes).not.toContain(`View/${file.replace(".tsx", "")}"`);
    },
  );

  test("each forwards through the shared moved-page redirect, to Branding", () => {
    const routes: string = fs
      .readFileSync(
        path.join(DASHBOARD_SRC, "Routes", "StatusPagesRoutes.tsx"),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(routes).toContain(
      "{MOVED_STATUS_PAGE_BRANDING_PATHS.map((path: string): ReactElement => {",
    );
    expect(routes).toContain(
      "<MovedPageRedirect pageMap={PageMap.STATUS_PAGE_VIEW_BRANDING} />",
    );
  });
});
