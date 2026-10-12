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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * The Network Map, rendered for the two cases that used to dead-end.
 *
 *  - A project with devices and no sites opened the Map on "No network
 *    sites yet", as if there were nothing to see. It draws the devices now
 *    (the same topology explorer Device Topology shows without sites).
 *  - Drilling into a site that has no sites under it but devices of its own
 *    opened an empty container view unless its site type was flagged unit
 *    level. It opens those devices' topology now, whatever the type is
 *    called.
 *
 * The two network endpoints the page reads (/network-site/children and
 * /network-site/map) are answered here; the heavy views are replaced by
 * markers, so what is checked is which view the page chooses.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SITE_ID: string = "50000000-0000-4000-8000-000000000001";
const CHILD_ID: string = "50000000-0000-4000-8000-000000000002";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyExplorer",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="topology-explorer" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyLiveView",
  () => {
    return {
      __esModule: true,
      default: (props: { siteId?: string }): ReactElement => {
        return (
          <div data-testid="topology-live-view" data-site-id={props.siteId} />
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteGeoMap",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="geo-map" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteContainerGraph",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="site-container-graph" />;
      },
    };
  },
);

import NetworkSiteMap from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/NetworkMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";

const MAP_PATH: string = `/dashboard/${PROJECT_ID}/network-sites/map`;

let childrenAnswer: JSONObject = {};
let mapAnswer: JSONObject = {};
let postSpy: ReturnType<typeof jest.spyOn>;

function site(
  overrides: Partial<{
    id: string;
    name: string;
    siteType: string;
    isUnitLevel: boolean;
    deviceCount: number;
  }>,
): JSONObject {
  return {
    id: overrides.id || CHILD_ID,
    name: overrides.name || "Springfield",
    siteType: overrides.siteType || "Store",
    isUnitLevel: overrides.isUnitLevel || false,
    childSiteCount: 0,
    deviceCount: overrides.deviceCount || 0,
  };
}

function breadcrumbTo(isUnitLevel: boolean): Array<JSONObject> {
  return [
    {
      id: SITE_ID,
      name: "Springfield",
      siteType: "Store",
      isUnitLevel: isUnitLevel,
    },
  ];
}

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderMapAt(search: string): Promise<void> {
  window.history.replaceState(null, "", `${MAP_PATH}${search}`);

  const props: PageComponentProps = {} as PageComponentProps;

  render(
    <MemoryRouter initialEntries={[`${MAP_PATH}${search}`]}>
      <NetworkSiteMap {...props} />
    </MemoryRouter>,
  );

  await flush();
}

beforeEach(() => {
  childrenAnswer = {};
  mapAnswer = {};
  postSpy = jest.spyOn(API, "post").mockImplementation((async (options: {
    url: unknown;
  }) => {
    const url: string = String(options.url);

    return new HTTPResponse<JSONObject>(
      200,
      url.includes("/network-site/children") ? childrenAnswer : mapAnswer,
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  postSpy.mockRestore();
  window.history.replaceState(null, "", "/");
});

describe("the top of the map", () => {
  test("a project with no sites is shown its devices, not an empty map", async () => {
    childrenAnswer = { breadcrumb: [], children: [], links: [] };
    mapAnswer = { sites: [], links: [] };

    await renderMapAt("");

    expect(screen.getByTestId("topology-explorer")).toBeInTheDocument();
    expect(screen.queryByTestId("geo-map")).toBeNull();
    expect(screen.queryByText("No network sites yet")).toBeNull();
  });

  test("a project with sites gets the geographic map", async () => {
    childrenAnswer = {
      breadcrumb: [],
      children: [site({ id: SITE_ID, deviceCount: 4 })],
      links: [],
    };
    mapAnswer = {
      sites: [
        {
          id: SITE_ID,
          name: "Springfield",
          siteType: "Store",
          latitude: 39.78,
          longitude: -89.65,
        },
      ],
      links: [],
    };

    await renderMapAt("");

    expect(screen.getByTestId("geo-map")).toBeInTheDocument();
    expect(screen.queryByTestId("topology-explorer")).toBeNull();
  });

  test("a project whose sites have no map pins still gets its sites, not the device graph", async () => {
    childrenAnswer = {
      breadcrumb: [],
      children: [site({ id: SITE_ID })],
      links: [],
    };
    mapAnswer = { sites: [], links: [] };

    await renderMapAt("");

    expect(screen.queryByTestId("topology-explorer")).toBeNull();
    expect(screen.getAllByText("Springfield").length).toBeGreaterThan(0);
  });
});

describe("drilling into a site", () => {
  test("a site with no sites under it and devices of its own opens their topology", async () => {
    childrenAnswer = {
      breadcrumb: breadcrumbTo(false),
      children: [],
      links: [],
      ownDeviceStats: { healthy: 3, total: 3 },
    };
    mapAnswer = { sites: [], links: [] };

    await renderMapAt(`?site=${SITE_ID}`);

    const liveView: HTMLElement = screen.getByTestId("topology-live-view");

    expect(liveView).toHaveAttribute("data-site-id", SITE_ID);
    expect(screen.queryByTestId("site-container-graph")).toBeNull();
  });

  test("a unit-level site opens its topology, as it always did", async () => {
    childrenAnswer = {
      breadcrumb: breadcrumbTo(true),
      children: [],
      links: [],
      ownDeviceStats: { total: 0 },
    };
    mapAnswer = { sites: [], links: [] };

    await renderMapAt(`?site=${SITE_ID}`);

    expect(screen.getByTestId("topology-live-view")).toHaveAttribute(
      "data-site-id",
      SITE_ID,
    );
  });

  test("a site with sites under it shows them, on the map and as a graph", async () => {
    childrenAnswer = {
      breadcrumb: breadcrumbTo(false),
      children: [site({ id: CHILD_ID, name: "Springfield East" })],
      links: [],
      ownDeviceStats: { healthy: 2, total: 2 },
    };
    mapAnswer = { sites: [], links: [] };

    await renderMapAt(`?site=${SITE_ID}`);

    expect(screen.getByTestId("site-container-graph")).toBeInTheDocument();
    expect(screen.queryByTestId("topology-live-view")).toBeNull();
  });

  test("an empty site (nothing under it, no devices) stays a site view", async () => {
    childrenAnswer = {
      breadcrumb: breadcrumbTo(false),
      children: [],
      links: [],
      ownDeviceStats: { total: 0 },
    };
    mapAnswer = { sites: [], links: [] };

    await renderMapAt(`?site=${SITE_ID}`);

    expect(screen.queryByTestId("topology-live-view")).toBeNull();
    expect(screen.queryByTestId("topology-explorer")).toBeNull();
    expect(screen.getByTestId("site-container-graph")).toBeInTheDocument();
  });
});
