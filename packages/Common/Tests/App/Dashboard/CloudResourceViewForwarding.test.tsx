import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { FunctionComponent, ReactElement, ReactNode } from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * One CloudResource table, two products: an environment's pages are App
 * Platforms' (…/app-platforms/:id/…), a resource's Cloud's (…/cloud/:id/…).
 * Every environment page was Cloud's until the split, so years of links -
 * bookmarks, feed entries, Slack and email messages - point at
 * …/cloud/:id/…, and a link that cannot tell the kinds apart goes there too.
 *
 * This mounts the REAL route groups of both products and their REAL view
 * layouts, with the pages replaced by recorders, and visits addresses: an
 * environment at a Cloud address lands on the same tab in App Platforms,
 * keeping its query and hash, a resource at an App Platforms address lands
 * in Cloud, and Cloud's old addresses for the environments list arrive.
 */

interface ItemRequest {
  modelType: { name: string };
  id: { toString: () => string };
  select: Record<string, unknown>;
}

const mockItemRequests: Array<ItemRequest> = [];
// What reading the row answers: its kind, no row, or a failure.
let mockRowKind: string | null | undefined = "environment";
let mockRowMissing: boolean = false;
let mockReadFails: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (request: ItemRequest): Promise<unknown> => {
        mockItemRequests.push(request);
        if (mockReadFails) {
          return Promise.reject(new Error("You cannot read this resource."));
        }
        if (mockRowMissing) {
          return Promise.resolve(null);
        }
        return Promise.resolve({ cloudResourceKind: mockRowKind });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

// The view's frame: its title and what it draws inside.
jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { title: string; children: ReactNode }): ReactElement => {
      return (
        <div data-testid="view" data-title={props.title}>
          {props.children}
        </div>
      );
    },
  };
});

const DASHBOARD: string = "../../../../App/FeatureSet/Dashboard/src";

type RecorderProps = { pageRoute?: { toString: () => string } | undefined };

// A page that says which it is and where it was reached.
function recorder(name: string): {
  __esModule: boolean;
  default: (props: RecorderProps) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: RecorderProps): ReactElement => {
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
          <span data-testid="landed">
            {location.pathname + location.search + location.hash}
          </span>
          <span data-testid="navigation-type">{navigationType}</span>
        </div>
      );
    },
  };
}

// A product's layout, drawing its page.
function frame(name: string): {
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

const LAYOUTS: Array<string> = [
  "Pages/Cloud/Layout",
  "Pages/Cloud/Accounts/View/Layout",
  "Pages/AppPlatforms/Layout",
];

const PAGES: Array<string> = [
  "Pages/Cloud/View/MonitoredResourceOverview",
  "Pages/Cloud/View/Settings",
  "Pages/Cloud/View/Metrics",
  "Pages/Cloud/View/Feed",
  "Pages/Cloud/View/Owners",
  "Pages/Cloud/View/Documentation",
  "Pages/Cloud/View/Delete",
  "Pages/Cloud/View/Incidents",
  "Pages/Cloud/View/Alerts",
  "Pages/Cloud/View/Changes",
  "Pages/Cloud/Settings/LabelRules",
  "Pages/Cloud/Settings/OwnerRules",
  "Pages/Cloud/Archived",
  "Pages/Cloud/MonitoredResources",
  "Pages/Cloud/Connect",
  "Pages/Cloud/Overview",
  "Pages/Cloud/Costs",
  "Pages/Cloud/Savings",
  "Pages/Cloud/Budgets",
  "Pages/Cloud/Accounts/Accounts",
  "Pages/Cloud/Accounts/View/Overview",
  "Pages/Cloud/Accounts/View/Resources",
  "Pages/Cloud/Accounts/View/Changes",
  "Pages/Cloud/Accounts/View/Topology",
  "Pages/Cloud/Accounts/View/Costs",
  "Pages/Cloud/Accounts/View/Settings",
  "Pages/Cloud/Accounts/View/Delete",
  "Pages/Cloud/Accounts/View/AI/Agent",
  "Pages/Cloud/Accounts/View/AI/Logs",
  "Pages/Cloud/Accounts/View/Feed",
  "Pages/AppPlatforms/Overview",
  "Pages/AppPlatforms/Environments",
  "Pages/AppPlatforms/Archived",
  "Pages/AppPlatforms/Settings/LabelRules",
  "Pages/AppPlatforms/Settings/OwnerRules",
  "Pages/AppPlatforms/View/Overview",
  "Pages/AppPlatforms/View/Metrics",
  "Pages/AppPlatforms/View/Logs",
  "Pages/AppPlatforms/View/Traces",
  "Pages/AppPlatforms/View/Instances",
  "Pages/AppPlatforms/View/Feed",
  "Pages/AppPlatforms/View/Incidents",
  "Pages/AppPlatforms/View/Alerts",
  "Pages/AppPlatforms/View/Documentation",
  "Pages/AppPlatforms/View/Settings",
  "Pages/AppPlatforms/View/Owners",
  "Pages/AppPlatforms/View/Delete",
  "Pages/PageNotFound/PageNotFound",
  "Components/DeveloperDocs/DeveloperDocsPage",
];

/*
 * Not hoisted (doMock), so the route groups are required after it below:
 * they import every page at the top.
 */
for (const layout of LAYOUTS) {
  jest.doMock(`${DASHBOARD}/${layout}`, () => {
    return frame(layout);
  });
}

for (const page of PAGES) {
  jest.doMock(`${DASHBOARD}/${page}`, () => {
    return recorder(page);
  });
}

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const AppPlatformsRoutes: FunctionComponent<Record<string, unknown>> = require(
  `${DASHBOARD}/Routes/AppPlatformsRoutes`,
).default;
const CloudResourceRoutes: FunctionComponent<Record<string, unknown>> = require(
  `${DASHBOARD}/Routes/CloudResourceRoutes`,
).default;
const PageMap: Record<string, string> = require(
  `${DASHBOARD}/Utils/PageMap`,
).default;
const { RouteUtil } = require(`${DASHBOARD}/Utils/RouteMap`) as {
  RouteUtil: { getRouteString: (key: string) => string };
};
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

const ROW_ID: string = "0193c0de-9999-4aaa-8bbb-000000000009";
const CLOUD: string = `/dashboard/${PROJECT_ID}/cloud`;
const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;

const PAGE_PROPS: Record<string, unknown> = {
  pageRoute: {
    toString: (): string => {
      return `/dashboard/${PROJECT_ID}/home`;
    },
  },
  currentProject: null,
  hasPaymentMethod: true,
};

async function visit(url: string): Promise<void> {
  // RouteUtil reads the project id from window.location.
  goTo(url.split(/[?#]/)[0]!);

  await act(async () => {
    render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <RouterRoute
            path={RouteUtil.getRouteString(PageMap["APP_PLATFORMS_ROOT"]!)}
            element={<AppPlatformsRoutes {...PAGE_PROPS} />}
          />
          <RouterRoute
            path={RouteUtil.getRouteString(PageMap["CLOUD_ROOT"]!)}
            element={<CloudResourceRoutes {...PAGE_PROPS} />}
          />
        </Routes>
      </MemoryRouter>,
    );
  });
}

function landedOn(): string {
  return screen.getByTestId("landed").textContent || "";
}

function pageName(): string | null {
  const pages: Array<HTMLElement> = screen.queryAllByTestId("page");

  expect(pages).toHaveLength(1);

  return pages[0]!.getAttribute("data-page");
}

// The view the page is drawn in: "Cloud Resource" or "Cloud Environment".
function viewTitle(): string | null {
  return screen.getByTestId("view").getAttribute("data-title");
}

beforeEach(() => {
  mockItemRequests.length = 0;
  mockRowKind = "environment";
  mockRowMissing = false;
  mockReadFails = false;
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("an environment at an address from before the split", () => {
  test.each([
    ["", "Pages/AppPlatforms/View/Overview"],
    ["/logs", "Pages/AppPlatforms/View/Logs"],
    ["/traces", "Pages/AppPlatforms/View/Traces"],
    ["/instances", "Pages/AppPlatforms/View/Instances"],
    ["/metrics", "Pages/AppPlatforms/View/Metrics"],
    ["/settings", "Pages/AppPlatforms/View/Settings"],
    ["/owners", "Pages/AppPlatforms/View/Owners"],
    ["/developer/terraform", "Components/DeveloperDocs/DeveloperDocsPage"],
  ])(
    "…/cloud/:id%s lands on the same tab in App Platforms",
    async (suffix: string, page: string) => {
      await visit(`${CLOUD}/${ROW_ID}${suffix}`);

      expect(landedOn()).toBe(`${APP_PLATFORMS}/${ROW_ID}${suffix}`);
      expect(pageName()).toBe(page);
      expect(viewTitle()).toBe("Cloud Environment");
      // Replaced in the history, so Back does not bounce through Cloud.
      expect(screen.getByTestId("navigation-type")).toHaveTextContent(
        "REPLACE",
      );
    },
  );

  test("keeps the query string and the hash", async () => {
    await visit(`${CLOUD}/${ROW_ID}/logs?query=error&live=true#tail`);

    expect(landedOn()).toBe(
      `${APP_PLATFORMS}/${ROW_ID}/logs?query=error&live=true#tail`,
    );
  });

  test("a tab only Cloud's resources have lands on the environment's Overview", async () => {
    await visit(`${CLOUD}/${ROW_ID}/changes`);

    expect(landedOn()).toBe(`${APP_PLATFORMS}/${ROW_ID}`);
    expect(pageName()).toBe("Pages/AppPlatforms/View/Overview");
  });

  test("a row written before resources existed, naming no kind, is an environment", async () => {
    mockRowKind = null;

    await visit(`${CLOUD}/${ROW_ID}/traces`);

    expect(landedOn()).toBe(`${APP_PLATFORMS}/${ROW_ID}/traces`);
  });

  test("the row's kind is read once, and nothing else of it", async () => {
    await visit(`${CLOUD}/${ROW_ID}/logs`);

    // Cloud's view reads it, forwards, and App Platforms' reads it again.
    expect(
      mockItemRequests.map((request: ItemRequest): Array<unknown> => {
        return [request.modelType.name, request.id.toString(), request.select];
      }),
    ).toEqual([
      ["CloudResource", ROW_ID, { cloudResourceKind: true }],
      ["CloudResource", ROW_ID, { cloudResourceKind: true }],
    ]);
  });
});

describe("a cloud resource", () => {
  beforeEach(() => {
    mockRowKind = "resource";
  });

  test.each([
    ["", "Pages/Cloud/View/MonitoredResourceOverview"],
    ["/metrics", "Pages/Cloud/View/Metrics"],
    ["/changes", "Pages/Cloud/View/Changes"],
    ["/settings", "Pages/Cloud/View/Settings"],
  ])("…/cloud/:id%s stays in Cloud", async (suffix: string, page: string) => {
    await visit(`${CLOUD}/${ROW_ID}${suffix}`);

    expect(landedOn()).toBe(`${CLOUD}/${ROW_ID}${suffix}`);
    expect(pageName()).toBe(page);
    expect(viewTitle()).toBe("Cloud Resource");
  });

  test("at an App Platforms address, it lands on the same tab in Cloud", async () => {
    await visit(`${APP_PLATFORMS}/${ROW_ID}/metrics?range=1h`);

    expect(landedOn()).toBe(`${CLOUD}/${ROW_ID}/metrics?range=1h`);
    expect(pageName()).toBe("Pages/Cloud/View/Metrics");
  });

  test("at a tab only environments have, it lands on its Overview in Cloud", async () => {
    await visit(`${APP_PLATFORMS}/${ROW_ID}/instances`);

    expect(landedOn()).toBe(`${CLOUD}/${ROW_ID}`);
    expect(pageName()).toBe("Pages/Cloud/View/MonitoredResourceOverview");
  });

  test("a tab Cloud's resources do not have is Page Not Found, under the resource's menu", async () => {
    await visit(`${CLOUD}/${ROW_ID}/logs`);

    expect(landedOn()).toBe(`${CLOUD}/${ROW_ID}/logs`);
    expect(pageName()).toBe("Pages/PageNotFound/PageNotFound");
    expect(viewTitle()).toBe("Cloud Resource");
  });
});

describe("a row that cannot be read", () => {
  test("Cloud draws its own page, whose tabs say what went wrong", async () => {
    mockReadFails = true;

    await visit(`${CLOUD}/${ROW_ID}/metrics`);

    expect(landedOn()).toBe(`${CLOUD}/${ROW_ID}/metrics`);
    expect(viewTitle()).toBe("Cloud Resource");
  });

  test("one that is gone is not sent anywhere either", async () => {
    mockRowMissing = true;

    await visit(`${CLOUD}/${ROW_ID}`);

    expect(landedOn()).toBe(`${CLOUD}/${ROW_ID}`);
  });

  test("App Platforms draws its own page too", async () => {
    mockReadFails = true;

    await visit(`${APP_PLATFORMS}/${ROW_ID}/logs`);

    expect(landedOn()).toBe(`${APP_PLATFORMS}/${ROW_ID}/logs`);
    expect(viewTitle()).toBe("Cloud Environment");
  });
});

describe("Cloud's own addresses", () => {
  test("Cloud's own address opens its Overview, where it stays", async () => {
    await visit(CLOUD);

    expect(landedOn()).toBe(CLOUD);
    expect(pageName()).toBe("Pages/Cloud/Overview");
    expect(mockItemRequests).toEqual([]);
  });

  test.each([
    ["/costs", "Pages/Cloud/Costs"],
    ["/savings", "Pages/Cloud/Savings"],
    ["/budgets", "Pages/Cloud/Budgets"],
    ["/accounts", "Pages/Cloud/Accounts/Accounts"],
    [`/accounts/${ROW_ID}/costs`, "Pages/Cloud/Accounts/View/Costs"],
  ])("…/cloud%s is its page", async (suffix: string, page: string) => {
    await visit(`${CLOUD}${suffix}`);

    expect(landedOn()).toBe(`${CLOUD}${suffix}`);
    expect(pageName()).toBe(page);
    // Spend pages are Cloud's own words, never read as a resource's id.
    expect(mockItemRequests).toEqual([]);
  });
});

describe("Cloud's old addresses for the environments list", () => {
  test.each(["terraform", "api", "ai-assistants"])(
    "the list's Developer page (%s) is All Resources' now",
    async (page: string) => {
      await visit(`${CLOUD}/developer/${page}?tab=1`);

      expect(landedOn()).toBe(`${CLOUD}/resources/developer/${page}?tab=1`);
      expect(pageName()).toBe("Components/DeveloperDocs/DeveloperDocsPage");
    },
  );
});

describe("App Platforms' own addresses", () => {
  test.each([
    ["", "Pages/AppPlatforms/Overview"],
    ["/environments", "Pages/AppPlatforms/Environments"],
    ["/archived", "Pages/AppPlatforms/Archived"],
    ["/settings/owner-rules", "Pages/AppPlatforms/Settings/OwnerRules"],
    ["/settings/label-rules", "Pages/AppPlatforms/Settings/LabelRules"],
    [
      "/environments/developer/terraform",
      "Components/DeveloperDocs/DeveloperDocsPage",
    ],
  ])("…/app-platforms%s is its page", async (suffix: string, page: string) => {
    await visit(`${APP_PLATFORMS}${suffix}`);

    expect(landedOn()).toBe(`${APP_PLATFORMS}${suffix}`);
    expect(pageName()).toBe(page);
    expect(mockItemRequests).toEqual([]);
  });

  test("an address it does not have is Page Not Found", async () => {
    await visit(`${APP_PLATFORMS}/not/a/page`);

    expect(pageName()).toBe("Pages/PageNotFound/PageNotFound");
  });
});
