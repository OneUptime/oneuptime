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
import { ReactElement } from "react";
import KubernetesClusterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/SideMenu";
import HostViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SideMenu";
import DatabaseServerSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/SideMenu";
import ServiceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/SideMenu";
import CloudResourceViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/SideMenu";
import DockerHostSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/View/SideMenu";
import PodmanHostSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/View/SideMenu";
import DataSecurityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataSecurity/DataSecurityApi";
import { forgetResourceScopes } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceDataSecurity/UseResourceDataScope";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import ProjectProducts from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import { DataSecurityResourceScope } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { DataStoreResourceKind } from "../../../Types/DataSecurity/DataStoreResource";
import Link from "../../../Types/Link";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { ServerProductOffReason } from "../../../Types/Product/ServerProducts";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * SECURITY EVENTS AND DATA SECURITY INSIDE A RESOURCE'S MENU (#9547, #9555).
 *
 * A cluster's and a host's menus offer the security events about them
 * beside their Logs, and a cluster with databases on it a Security section
 * with its Data Security and Compliance pages. Each entry is there only
 * when its product is on, shown in the project, in use and readable by the
 * reader, and the Security section only for a cluster with a data store:
 * a project that never set Security Events up sees no entry that always
 * opens an empty page. Drawn for real against the Dashboard's RouteMap.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: () => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

const CLUSTER_ID: ObjectID = new ObjectID(
  "44444444-0000-4000-8000-000000000004",
);
const HOST_ID: ObjectID = new ObjectID("66666666-0000-4000-8000-000000000006");
const STORE_ID: string = "77777777-0000-4000-8000-000000000007";

function pageOf(pageMapKey: PageMap, id: ObjectID): string {
  return RouteUtil.populateRouteParams(RouteMap[pageMapKey] as Route, {
    modelId: id,
  }).toString();
}

function titles(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

// Both products in use, unless a test says otherwise.
function givenProducts(extra: Partial<ProjectProductsAnswer> = {}): void {
  ProjectProducts.setAnswer(PROJECT_ID, {
    ...getEmptyProjectProductsAnswer(),
    usage: {
      [ProductKey.SecurityEvents]: ProductUsage.InUse,
      [ProductKey.DataSecurity]: ProductUsage.InUse,
    },
    ...extra,
  });
}

function scopeWith(
  dataStoreIds: Array<string>,
  kind: DataStoreResourceKind = DataStoreResourceKind.KubernetesCluster,
): DataSecurityResourceScope {
  return {
    kind,
    id: CLUSTER_ID.toString(),
    name: "prod-eu",
    dataStoreIds,
    ownedDataStoreIds: dataStoreIds,
    complianceOwner: null,
    isTruncated: false,
  };
}

let scopeSpy: jest.SpiedFunction<typeof DataSecurityApi.getResourceScope>;
let isAllowed: boolean;

beforeEach(() => {
  window.localStorage.clear();
  ProjectProducts.reset();
  forgetResourceScopes();
  givenProducts();
  isAllowed = true;
  jest.spyOn(PermissionGate, "check").mockImplementation(() => {
    return { isAllowed } as PermissionGateResult;
  });
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  scopeSpy = jest
    .spyOn(DataSecurityApi, "getResourceScope")
    .mockResolvedValue(scopeWith([STORE_ID]));
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/kubernetes`);
  goTo(pageOf(PageMap.KUBERNETES_CLUSTER_VIEW, CLUSTER_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ProjectProducts.reset();
  forgetResourceScopes();
});

async function renderClusterMenu(): Promise<void> {
  await renderMenu(<KubernetesClusterSideMenu modelId={CLUSTER_ID} />);
}

describe("a Kubernetes cluster's menu", () => {
  test("lists Security Events beside the cluster's Logs and Events", async () => {
    await renderClusterMenu();

    expect(titles(linksIn("Telemetry"))).toEqual([
      "Metrics",
      "Traces",
      "Logs",
      "Events",
      "Security Events",
      "Profiles",
    ]);
    expect(
      linksIn("Telemetry").find((link: MenuLink): boolean => {
        return link.title === "Security Events";
      })?.href,
    ).toBe(pageOf(PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS, CLUSTER_ID));
  });

  test("adds a Security section after Activity, with Data Security and Compliance, folded", async () => {
    await renderClusterMenu();

    const sections: Array<string> = sectionTitlesInOrder();

    expect(sections).toContain("Security");
    expect(sections.indexOf("Security")).toBe(sections.indexOf("Activity") + 1);
    expect(linksIn("Security")).toEqual([
      {
        title: "Data Security",
        href: pageOf(PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY, CLUSTER_ID),
      },
      {
        title: "Compliance",
        href: pageOf(PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE, CLUSTER_ID),
      },
    ]);
    // A section most visits never need folds by its title, as every Security section does.
    expect(isExpanded("Security")).toBe(false);
    expect(scopeSpy).toHaveBeenCalledWith({
      kind: DataStoreResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
    });
  });

  test.each([
    [PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY, "Data Security"],
    [PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE, "Compliance"],
  ])(
    "%s opens the Security section by itself and lights %s",
    async (page: PageMap, title: string): Promise<void> => {
      goTo(pageOf(page, CLUSTER_ID));

      await renderClusterMenu();

      expect(isExpanded("Security")).toBe(true);
      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  test("its Security Events page lights Security Events", async () => {
    goTo(pageOf(PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS, CLUSTER_ID));

    await renderClusterMenu();

    expect(activeLinkTitles()).toEqual(["Security Events"]);
  });

  test.each([
    [
      "switched off on the server",
      {
        offOnServer: {
          [ProductKey.SecurityEvents]: ServerProductOffReason.SwitchedOff,
          [ProductKey.DataSecurity]: ServerProductOffReason.SwitchedOff,
        },
      },
    ],
    [
      "hidden in the project",
      { hidden: [ProductKey.SecurityEvents, ProductKey.DataSecurity] },
    ],
    ["never set up", { usage: {} }],
    [
      "set up but empty",
      {
        usage: {
          [ProductKey.SecurityEvents]: ProductUsage.NotSetUp,
          [ProductKey.DataSecurity]: ProductUsage.NotSetUp,
        },
      },
    ],
  ])(
    "leaves both products out while they are %s, and asks nothing",
    async (
      _label: string,
      extra: Partial<ProjectProductsAnswer>,
    ): Promise<void> => {
      givenProducts(extra);

      await renderClusterMenu();

      expect(titles(linksIn("Telemetry"))).not.toContain("Security Events");
      expect(sectionTitlesInOrder()).not.toContain("Security");
      expect(scopeSpy).not.toHaveBeenCalled();
    },
  );

  test("leaves both out for someone who may read neither product", async () => {
    isAllowed = false;

    await renderClusterMenu();

    expect(titles(linksIn("Telemetry"))).not.toContain("Security Events");
    expect(sectionTitlesInOrder()).not.toContain("Security");
    expect(scopeSpy).not.toHaveBeenCalled();
  });

  test("each product follows its own switch: Security Events without Data Security", async () => {
    givenProducts({
      offOnServer: {
        [ProductKey.DataSecurity]: ServerProductOffReason.SwitchedOff,
      },
    });

    await renderClusterMenu();

    expect(titles(linksIn("Telemetry"))).toContain("Security Events");
    expect(sectionTitlesInOrder()).not.toContain("Security");
  });

  test("and Data Security without Security Events", async () => {
    givenProducts({ hidden: [ProductKey.SecurityEvents] });

    await renderClusterMenu();

    expect(titles(linksIn("Telemetry"))).not.toContain("Security Events");
    expect(titles(linksIn("Security"))).toEqual([
      "Data Security",
      "Compliance",
    ]);
  });

  test("a cluster with no data store has no Security section: it would always be empty", async () => {
    scopeSpy.mockResolvedValue(scopeWith([]));

    await renderClusterMenu();

    expect(sectionTitlesInOrder()).not.toContain("Security");
    expect(titles(linksIn("Telemetry"))).toContain("Security Events");
  });

  test("a cluster whose stores could not be read has no Security section, and the menu carries on", async () => {
    scopeSpy.mockRejectedValue(new Error("Refused") as never);

    await renderClusterMenu();

    expect(sectionTitlesInOrder()).not.toContain("Security");
    expect(sectionTitlesInOrder()).toContain("Activity");
  });

  test("the cluster's stores are asked once for its menu, however often it is drawn", async () => {
    await renderClusterMenu();
    cleanup();
    await renderClusterMenu();

    expect(scopeSpy).toHaveBeenCalledTimes(1);
  });
});

describe("a host's menu", () => {
  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/host`);
    goTo(pageOf(PageMap.HOST_VIEW, HOST_ID));
  });

  async function renderHostMenu(): Promise<void> {
    await renderMenu(<HostViewSideMenu modelId={HOST_ID} />);
  }

  test("lists Security Events right after the host's Logs, and no Security section", async () => {
    await renderHostMenu();

    const observability: Array<string> = titles(linksIn("Observability"));

    expect(observability.indexOf("Security Events")).toBe(
      observability.indexOf("Logs") + 1,
    );
    expect(
      linksIn("Observability").find((link: MenuLink): boolean => {
        return link.title === "Security Events";
      })?.href,
    ).toBe(pageOf(PageMap.HOST_VIEW_SECURITY_EVENTS, HOST_ID));
    // Nothing records the host a data store is on: no Data Security here.
    expect(sectionTitlesInOrder()).not.toContain("Security");
    expect(scopeSpy).not.toHaveBeenCalled();
  });

  test("its Security Events page lights Security Events", async () => {
    goTo(pageOf(PageMap.HOST_VIEW_SECURITY_EVENTS, HOST_ID));

    await renderHostMenu();

    expect(activeLinkTitles()).toEqual(["Security Events"]);
  });

  test("leaves Security Events out in a project that does not use it", async () => {
    givenProducts({ usage: {} });

    await renderHostMenu();

    expect(titles(linksIn("Observability"))).not.toContain("Security Events");
    expect(titles(linksIn("Observability"))).toContain("Logs");
  });
});

/*
 * Every other resource a data store belongs to (DataStoreResource): a
 * database, a service's telemetry, a cloud bucket or database, and the
 * Docker or Podman host a database runs on. Each has the same Security
 * section after its Activity, for the same reasons, and none without a store.
 */
interface DataStoreResourceMenu {
  kind: DataStoreResourceKind;
  overview: PageMap;
  dataSecurity: PageMap;
  compliance: PageMap;
  draw: (modelId: ObjectID) => ReactElement;
}

const RESOURCE_ID: ObjectID = new ObjectID(
  "88888888-0000-4000-8000-000000000008",
);

const DATA_STORE_RESOURCE_MENUS: Array<[string, DataStoreResourceMenu]> = [
  [
    "a database",
    {
      kind: DataStoreResourceKind.DatabaseServer,
      overview: PageMap.DATABASE_SERVER_VIEW,
      dataSecurity: PageMap.DATABASE_SERVER_VIEW_DATA_SECURITY,
      compliance: PageMap.DATABASE_SERVER_VIEW_COMPLIANCE,
      draw: (modelId: ObjectID): ReactElement => {
        return <DatabaseServerSideMenu modelId={modelId} />;
      },
    },
  ],
  [
    "a service",
    {
      kind: DataStoreResourceKind.Service,
      overview: PageMap.SERVICE_VIEW,
      dataSecurity: PageMap.SERVICE_VIEW_DATA_SECURITY,
      compliance: PageMap.SERVICE_VIEW_COMPLIANCE,
      draw: (modelId: ObjectID): ReactElement => {
        return <ServiceSideMenu modelId={modelId} />;
      },
    },
  ],
  [
    "a cloud resource",
    {
      kind: DataStoreResourceKind.CloudResource,
      overview: PageMap.CLOUD_RESOURCE_VIEW,
      dataSecurity: PageMap.CLOUD_RESOURCE_VIEW_DATA_SECURITY,
      compliance: PageMap.CLOUD_RESOURCE_VIEW_COMPLIANCE,
      draw: (modelId: ObjectID): ReactElement => {
        return <CloudResourceViewSideMenu modelId={modelId} />;
      },
    },
  ],
  [
    "a Docker host",
    {
      kind: DataStoreResourceKind.DockerHost,
      overview: PageMap.DOCKER_HOST_VIEW,
      dataSecurity: PageMap.DOCKER_HOST_VIEW_DATA_SECURITY,
      compliance: PageMap.DOCKER_HOST_VIEW_COMPLIANCE,
      draw: (modelId: ObjectID): ReactElement => {
        return <DockerHostSideMenu modelId={modelId} />;
      },
    },
  ],
  [
    "a Podman host",
    {
      kind: DataStoreResourceKind.PodmanHost,
      overview: PageMap.PODMAN_HOST_VIEW,
      dataSecurity: PageMap.PODMAN_HOST_VIEW_DATA_SECURITY,
      compliance: PageMap.PODMAN_HOST_VIEW_COMPLIANCE,
      draw: (modelId: ObjectID): ReactElement => {
        return <PodmanHostSideMenu modelId={modelId} />;
      },
    },
  ],
];

describe.each(DATA_STORE_RESOURCE_MENUS)(
  "%s's menu",
  (_label: string, menu: DataStoreResourceMenu) => {
    beforeEach(() => {
      scopeSpy.mockResolvedValue(scopeWith([STORE_ID], menu.kind));
      goTo(pageOf(menu.overview, RESOURCE_ID));
    });

    async function renderResourceMenu(): Promise<void> {
      await renderMenu(menu.draw(RESOURCE_ID));
    }

    test("adds a Security section after Activity, with Data Security and Compliance, folded", async () => {
      await renderResourceMenu();

      const sections: Array<string> = sectionTitlesInOrder();

      expect(sections.indexOf("Security")).toBe(
        sections.indexOf("Activity") + 1,
      );
      expect(linksIn("Security")).toEqual([
        {
          title: "Data Security",
          href: pageOf(menu.dataSecurity, RESOURCE_ID),
        },
        {
          title: "Compliance",
          href: pageOf(menu.compliance, RESOURCE_ID),
        },
      ]);
      expect(isExpanded("Security")).toBe(false);
      expect(scopeSpy).toHaveBeenCalledWith({
        kind: menu.kind,
        id: RESOURCE_ID,
      });
    });

    test("its Compliance page opens the Security section by itself and lights Compliance", async () => {
      goTo(pageOf(menu.compliance, RESOURCE_ID));

      await renderResourceMenu();

      expect(isExpanded("Security")).toBe(true);
      expect(activeLinkTitles()).toEqual(["Compliance"]);
    });

    test("has no Security section without a data store: it would always be empty", async () => {
      scopeSpy.mockResolvedValue(scopeWith([], menu.kind));

      await renderResourceMenu();

      expect(sectionTitlesInOrder()).not.toContain("Security");
      expect(sectionTitlesInOrder()).toContain("Activity");
    });

    test("has none, and asks nothing, in a project that does not use Data Security", async () => {
      givenProducts({ usage: {} });

      await renderResourceMenu();

      expect(sectionTitlesInOrder()).not.toContain("Security");
      expect(scopeSpy).not.toHaveBeenCalled();
    });

    test("has none for someone who may not read data stores", async () => {
      isAllowed = false;

      await renderResourceMenu();

      expect(sectionTitlesInOrder()).not.toContain("Security");
      expect(scopeSpy).not.toHaveBeenCalled();
    });
  },
);
