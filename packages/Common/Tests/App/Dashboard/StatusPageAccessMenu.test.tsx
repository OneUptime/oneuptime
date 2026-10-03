import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";

// Badge counts: nothing open, nothing to count, no network.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

import StatusPageSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/SideMenu";
import { getStatusPagesBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/StatusPagesBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  renderMenu,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

/*
 * A status page's Security section opens on Access: who can see the page,
 * as one choice (anyone with the link, only people who sign in, anyone with
 * the password). It is the old "Authentication Settings" page, the last of
 * five entries, at the same address - so links and bookmarks still land on
 * it. The entries after it set up the sign-in the second choice uses.
 */

const MODEL_ID: string = "0193c0de-5555-4aaa-8bbb-0000000000c8";

function viewRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: new ObjectID(MODEL_ID),
  }).toString();
}

const SECURITY_SECTION: Array<{ title: string; page: string }> = [
  { title: "Access", page: PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS },
  { title: "Private Users", page: PageMap.STATUS_PAGE_VIEW_PRIVATE_USERS },
  { title: "SSO", page: PageMap.STATUS_PAGE_VIEW_SSO },
  { title: "OIDC", page: PageMap.STATUS_PAGE_VIEW_OIDC },
  { title: "SCIM", page: PageMap.STATUS_PAGE_VIEW_SCIM },
];

async function renderMenuAt(page: string): Promise<void> {
  goTo(viewRoute(page));
  await renderMenu(<StatusPageSideMenu modelId={new ObjectID(MODEL_ID)} />);
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("a status page's Security section", () => {
  test("opens on Access, then the sign-in it uses", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW);

    expect(linksIn("Security")).toEqual(
      SECURITY_SECTION.map(
        (entry: { title: string; page: string }): MenuLink => {
          return { title: entry.title, href: viewRoute(entry.page) };
        },
      ),
    );
    expect(iconCountIn("Security")).toBe(SECURITY_SECTION.length);
  });

  test("Access is the old Authentication Settings page, at the same address", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW);

    expect(viewRoute(PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS)).toBe(
      `/dashboard/${PROJECT_ID}/status-pages/${MODEL_ID}/authentication-settings`,
    );
    expect(titlesInMenu()).not.toContain("Authentication Settings");
  });

  test("opens by itself on Access, with Access marked", async () => {
    await renderMenuAt(PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS);

    expect(isExpanded("Security")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Access"]);
  });
});

describe("the Access page's breadcrumbs", () => {
  test("name it Access", () => {
    const links: Array<Link> | undefined = getStatusPagesBreadcrumbs(
      (
        RouteMap[PageMap.STATUS_PAGE_VIEW_AUTHENTICATION_SETTINGS] as Route
      ).toString(),
    );

    expect(
      (links || []).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Status Pages", "View Status Page", "Access"]);
  });
});
