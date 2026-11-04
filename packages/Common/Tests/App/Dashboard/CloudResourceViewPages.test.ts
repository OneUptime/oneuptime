import { beforeEach, describe, expect, test } from "@jest/globals";
import {
  CLOUD_RESOURCE_VIEW_TAB_PATHS,
  CloudResourceViewTab,
  ENVIRONMENT_VIEW_PAGES,
  RESOURCE_VIEW_PAGES,
  getCloudResourceForwardRoute,
  getCloudResourceViewPageKey,
  getCloudResourceViewRoute,
  getCloudResourceViewTabOfPath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/CloudResourceViewPages";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../Types/ObjectID";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * One CloudResource table, two products: an environment's pages are App
 * Platforms' (…/app-platforms/:id/…), a resource's Cloud's (…/cloud/:id/…).
 * Every link to a row is built here, and each product's view forwards a row
 * that is not its own to the same tab in the other.
 */

const ROW_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const APP_PLATFORMS: string = `/dashboard/${PROJECT_ID}/app-platforms`;
const CLOUD: string = `/dashboard/${PROJECT_ID}/cloud`;

const TABS: Array<CloudResourceViewTab> = Object.values(
  CloudResourceViewTab,
) as Array<CloudResourceViewTab>;

// What an address of the tab ends with: …/:id, or …/:id/<path>.
function suffixOf(tab: CloudResourceViewTab): string {
  const tabPath: string = CLOUD_RESOURCE_VIEW_TAB_PATHS[tab];
  return tabPath ? `/${tabPath}` : "";
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

describe("each kind's pages are in its own product", () => {
  test.each(
    TABS.filter((tab: CloudResourceViewTab): boolean => {
      return Boolean(ENVIRONMENT_VIEW_PAGES[tab]);
    }),
  )("an environment's %s is App Platforms'", (tab: CloudResourceViewTab) => {
    const key: string = ENVIRONMENT_VIEW_PAGES[tab]!;

    expect(key.startsWith("APP_PLATFORMS_ENVIRONMENT_VIEW")).toBe(true);
    expect(
      getCloudResourceViewRoute({
        cloudResourceKind: CloudResourceKind.Environment,
        modelId: new ObjectID(ROW_ID),
        tab,
      }).toString(),
    ).toBe(`${APP_PLATFORMS}/${ROW_ID}${suffixOf(tab)}`);
  });

  test.each(
    TABS.filter((tab: CloudResourceViewTab): boolean => {
      return Boolean(RESOURCE_VIEW_PAGES[tab]);
    }),
  )("a resource's %s is Cloud's", (tab: CloudResourceViewTab) => {
    const key: string = RESOURCE_VIEW_PAGES[tab]!;

    expect(key.startsWith("CLOUD_RESOURCE_VIEW")).toBe(true);
    expect(
      getCloudResourceViewRoute({
        cloudResourceKind: CloudResourceKind.Resource,
        modelId: ROW_ID,
        tab,
      }).toString(),
    ).toBe(`${CLOUD}/${ROW_ID}${suffixOf(tab)}`);
  });

  test("every tab page of each product is in its map, so a new tab cannot be left out", () => {
    /*
     * The pages under a row that are not its tabs are the pages of its own
     * records - an environment's app (…/:id/apps/:appId) - and end in
     * _DETAIL, as a cluster's pod's page does.
     */
    const routed: (prefix: string) => Array<string> = (
      prefix: string,
    ): Array<string> => {
      return Object.keys(RouteMap)
        .filter((key: string): boolean => {
          return (
            (key === prefix || key.startsWith(`${prefix}_`)) &&
            !key.endsWith("_DETAIL")
          );
        })
        .sort();
    };

    expect(Object.values(ENVIRONMENT_VIEW_PAGES).sort()).toEqual(
      routed(PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW),
    );
    expect(Object.values(RESOURCE_VIEW_PAGES).sort()).toEqual(
      routed(PageMap.CLOUD_RESOURCE_VIEW),
    );
  });

  test("an environment has its apps' telemetry and no cloud changes; a resource the reverse", () => {
    for (const tab of [
      CloudResourceViewTab.Traces,
      CloudResourceViewTab.Instances,
    ]) {
      expect(ENVIRONMENT_VIEW_PAGES[tab]).toBeDefined();
      expect(RESOURCE_VIEW_PAGES[tab]).toBeUndefined();
    }

    // Both have logs: an environment's apps', a resource's streamed ones.
    expect(ENVIRONMENT_VIEW_PAGES[CloudResourceViewTab.Logs]).toBe(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_LOGS,
    );
    expect(RESOURCE_VIEW_PAGES[CloudResourceViewTab.Logs]).toBe(
      PageMap.CLOUD_RESOURCE_VIEW_LOGS,
    );

    expect(
      ENVIRONMENT_VIEW_PAGES[CloudResourceViewTab.Changes],
    ).toBeUndefined();
    expect(RESOURCE_VIEW_PAGES[CloudResourceViewTab.Changes]).toBe(
      PageMap.CLOUD_RESOURCE_VIEW_CHANGES,
    );
  });

  test("a tab the kind does not have opens its Overview", () => {
    expect(
      getCloudResourceViewPageKey(
        CloudResourceKind.Resource,
        CloudResourceViewTab.Traces,
      ),
    ).toBe(PageMap.CLOUD_RESOURCE_VIEW);
    expect(
      getCloudResourceViewPageKey(
        CloudResourceKind.Environment,
        CloudResourceViewTab.Changes,
      ),
    ).toBe(PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW);
  });

  test("a row that names no kind is an environment; a link that did not read it goes to Cloud, which forwards", () => {
    // Every row was an environment before resources existed.
    expect(getCloudResourceViewPageKey(null)).toBe(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    );
    expect(getCloudResourceViewPageKey("")).toBe(
      PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW,
    );
    expect(getCloudResourceViewPageKey(undefined)).toBe(
      PageMap.CLOUD_RESOURCE_VIEW,
    );
    expect(
      getCloudResourceViewRoute({
        cloudResourceKind: undefined,
        modelId: ROW_ID,
      }).toString(),
    ).toBe(`${CLOUD}/${ROW_ID}`);
  });

  test("the address carries the project in use and the row, and no placeholder", () => {
    for (const kind of [
      CloudResourceKind.Environment,
      CloudResourceKind.Resource,
    ]) {
      for (const tab of TABS) {
        const href: string = getCloudResourceViewRoute({
          cloudResourceKind: kind,
          modelId: ROW_ID,
          tab,
        }).toString();

        expect(href).toContain(PROJECT_ID);
        expect(href).toContain(ROW_ID);
        expect(href).not.toContain(":");
        expect(
          (
            RouteMap[getCloudResourceViewPageKey(kind, tab)] as Route
          ).toString(),
        ).toContain(":id");
      }
    }
  });
});

describe("which tab an address is on", () => {
  test.each(TABS)(
    "reads %s back from its own address",
    (tab: CloudResourceViewTab) => {
      for (const product of [APP_PLATFORMS, CLOUD]) {
        expect(
          getCloudResourceViewTabOfPath({
            pathname: `${product}/${ROW_ID}${suffixOf(tab)}`,
            modelId: ROW_ID,
          }),
        ).toBe(tab);
      }
    },
  );

  test("a trailing slash is the same tab", () => {
    expect(
      getCloudResourceViewTabOfPath({
        pathname: `${CLOUD}/${ROW_ID}/logs/`,
        modelId: ROW_ID,
      }),
    ).toBe(CloudResourceViewTab.Logs);
    expect(
      getCloudResourceViewTabOfPath({
        pathname: `${CLOUD}/${ROW_ID}/`,
        modelId: ROW_ID,
      }),
    ).toBe(CloudResourceViewTab.Overview);
  });

  test("an address with a tab it does not know, or without the row, is the Overview", () => {
    expect(
      getCloudResourceViewTabOfPath({
        pathname: `${CLOUD}/${ROW_ID}/not-a-tab`,
        modelId: ROW_ID,
      }),
    ).toBe(CloudResourceViewTab.Overview);
    expect(
      getCloudResourceViewTabOfPath({
        pathname: `${CLOUD}/${ROW_ID}/developer`,
        modelId: ROW_ID,
      }),
    ).toBe(CloudResourceViewTab.Overview);
    expect(
      getCloudResourceViewTabOfPath({
        pathname: `${CLOUD}/accounts`,
        modelId: ROW_ID,
      }),
    ).toBe(CloudResourceViewTab.Overview);
    expect(
      getCloudResourceViewTabOfPath({
        pathname: `${CLOUD}/${ROW_ID}/logs`,
        modelId: "",
      }),
    ).toBe(CloudResourceViewTab.Overview);
  });
});

describe("where a row's page in the other product forwards to", () => {
  test("an environment opened at an old Cloud address lands on the same tab in App Platforms", () => {
    expect(
      getCloudResourceForwardRoute({
        cloudResourceKind: CloudResourceKind.Environment,
        modelId: ROW_ID,
        pathname: `${CLOUD}/${ROW_ID}/logs`,
        search: "?query=error",
        hash: "#live",
      }),
    ).toBe(`${APP_PLATFORMS}/${ROW_ID}/logs?query=error#live`);
    expect(
      getCloudResourceForwardRoute({
        cloudResourceKind: CloudResourceKind.Environment,
        modelId: ROW_ID,
        pathname: `${CLOUD}/${ROW_ID}/developer/terraform`,
      }),
    ).toBe(`${APP_PLATFORMS}/${ROW_ID}/developer/terraform`);
  });

  test("a resource opened in App Platforms lands on the same tab in Cloud", () => {
    expect(
      getCloudResourceForwardRoute({
        cloudResourceKind: CloudResourceKind.Resource,
        modelId: ROW_ID,
        pathname: `${APP_PLATFORMS}/${ROW_ID}/metrics`,
        search: "",
        hash: "",
      }),
    ).toBe(`${CLOUD}/${ROW_ID}/metrics`);
  });

  test("a tab the row's own product does not have lands on its Overview", () => {
    expect(
      getCloudResourceForwardRoute({
        cloudResourceKind: CloudResourceKind.Environment,
        modelId: ROW_ID,
        pathname: `${CLOUD}/${ROW_ID}/changes`,
      }),
    ).toBe(`${APP_PLATFORMS}/${ROW_ID}`);
    expect(
      getCloudResourceForwardRoute({
        cloudResourceKind: CloudResourceKind.Resource,
        modelId: ROW_ID,
        pathname: `${APP_PLATFORMS}/${ROW_ID}/instances`,
      }),
    ).toBe(`${CLOUD}/${ROW_ID}`);
  });

  test("a row that names no kind is forwarded as the environment it is", () => {
    expect(
      getCloudResourceForwardRoute({
        cloudResourceKind: null,
        modelId: ROW_ID,
        pathname: `${CLOUD}/${ROW_ID}/traces`,
      }),
    ).toBe(`${APP_PLATFORMS}/${ROW_ID}/traces`);
  });
});
