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
import { FunctionComponent, ReactElement } from "react";

/*
 * A PRODUCT'S RULES END WITH THEIR HISTORY (#10462), IN THE MENUS THAT KEEP
 * THEIR OWNER AND LABEL RULES UNDER SETTINGS.
 *
 * Services and the infrastructure products (Hosts, Kubernetes, Docker,
 * Docker Swarm, Podman, Proxmox, OpenStack, VMware, Ceph, Storage Arrays and
 * IoT), and Runbooks, list their owner and label rules in their Settings
 * section, folded. Each section now ends with "Rule Audit Logs": who
 * created, changed or deleted those rules, what and when - the history no
 * rule's row can hold. Where the rules have a Rules section of their own
 * (Alerts, Incidents, Monitors, Scheduled Maintenance, Status Pages,
 * Network) the entry is "Audit Logs", pinned by each product's own suite.
 *
 * Runbooks' entry is also where the runbook rules of Alerts, Incidents and
 * Scheduled Maintenance keep their history: one kind of rule for all three.
 *
 * The real menus are rendered against the real RouteMap.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: () => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import CephSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Ceph/SideMenu";
import DockerSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Docker/SideMenu";
import DockerSwarmSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DockerSwarm/SideMenu";
import HostSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/SideMenu";
import IoTSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/SideMenu";
import KubernetesSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/SideMenu";
import OpenStackSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OpenStack/SideMenu";
import PodmanSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Podman/SideMenu";
import ProxmoxSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/SideMenu";
import RunbookSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Runbook/SideMenu";
import ServiceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/SideMenu";
import StorageArraySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/SideMenu";
import VMwareSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  setViewportWidth,
} from "./SideMenuHarness";

interface ProductMenu {
  name: string;
  Menu: FunctionComponent;
  // A page of the product the menu is drawn on, away from its settings.
  landing: string;
  // What its Settings section lists, in order, before the rules' history.
  before: Array<[string, string]>;
  rulesAuditLogs: string;
}

const MENUS: Array<ProductMenu> = [
  {
    name: "Services",
    Menu: ServiceSideMenu,
    landing: PageMap.SERVICES,
    before: [
      ["Owner Rules", PageMap.SERVICE_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.SERVICE_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.SERVICE_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Hosts",
    Menu: HostSideMenu,
    landing: PageMap.HOSTS,
    before: [
      ["Owner Rules", PageMap.HOST_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.HOST_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.HOST_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Kubernetes",
    Menu: KubernetesSideMenu,
    landing: PageMap.KUBERNETES_CLUSTERS,
    before: [
      ["Owner Rules", PageMap.KUBERNETES_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.KUBERNETES_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.KUBERNETES_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Docker",
    Menu: DockerSideMenu,
    landing: PageMap.DOCKER_HOSTS,
    before: [
      ["Owner Rules", PageMap.DOCKER_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.DOCKER_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.DOCKER_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Docker Swarm",
    Menu: DockerSwarmSideMenu,
    landing: PageMap.DOCKER_SWARM_CLUSTERS,
    before: [
      ["Owner Rules", PageMap.DOCKER_SWARM_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.DOCKER_SWARM_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.DOCKER_SWARM_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Podman",
    Menu: PodmanSideMenu,
    landing: PageMap.PODMAN_HOSTS,
    before: [
      ["Owner Rules", PageMap.PODMAN_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.PODMAN_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.PODMAN_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Proxmox",
    Menu: ProxmoxSideMenu,
    landing: PageMap.PROXMOX_CLUSTERS,
    before: [
      ["Owner Rules", PageMap.PROXMOX_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.PROXMOX_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.PROXMOX_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "OpenStack",
    Menu: OpenStackSideMenu,
    landing: PageMap.OPENSTACK_CLOUDS,
    before: [
      ["Owner Rules", PageMap.OPENSTACK_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.OPENSTACK_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.OPENSTACK_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "VMware",
    Menu: VMwareSideMenu,
    landing: PageMap.VMWARE_VCENTERS,
    before: [
      ["Owner Rules", PageMap.VMWARE_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.VMWARE_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.VMWARE_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Ceph",
    Menu: CephSideMenu,
    landing: PageMap.CEPH_CLUSTERS,
    before: [
      ["Owner Rules", PageMap.CEPH_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.CEPH_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.CEPH_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Storage Arrays",
    Menu: StorageArraySideMenu,
    landing: PageMap.STORAGE_ARRAYS,
    before: [
      ["Owner Rules", PageMap.STORAGE_ARRAYS_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.STORAGE_ARRAYS_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.STORAGE_ARRAYS_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "IoT",
    Menu: IoTSideMenu,
    landing: PageMap.IOT_FLEETS,
    before: [
      ["Owner Rules", PageMap.IOT_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.IOT_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.IOT_SETTINGS_RULES_AUDIT_LOGS,
  },
  {
    name: "Runbooks",
    Menu: RunbookSideMenu,
    landing: PageMap.RUNBOOKS,
    before: [
      ["Global Variables", PageMap.RUNBOOKS_VARIABLES],
      ["Owner Rules", PageMap.RUNBOOKS_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.RUNBOOKS_SETTINGS_LABEL_RULES],
    ],
    rulesAuditLogs: PageMap.RUNBOOKS_SETTINGS_RULES_AUDIT_LOGS,
  },
];

async function renderProductMenu(menu: ProductMenu): Promise<void> {
  const Menu: FunctionComponent = menu.Menu;
  const element: ReactElement = <Menu />;

  await renderMenu(element);
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  // In the project first: the routes a test asks for are filled in from it.
  goTo(`/dashboard/${PROJECT_ID}/home`);
});

afterEach(() => {
  cleanup();
});

describe.each(MENUS)("the $name menu", (menu: ProductMenu) => {
  test("its Settings section ends with the rules' history, after the rules", async () => {
    goTo(routeFor(menu.landing));
    await renderProductMenu(menu);

    expect(linksIn("Settings")).toEqual([
      ...menu.before.map(([title, page]: [string, string]): MenuLink => {
        return { title, href: routeFor(page) };
      }),
      { title: "Rule Audit Logs", href: routeFor(menu.rulesAuditLogs) },
    ]);
    expect(routeFor(menu.rulesAuditLogs)).toMatch(
      new RegExp(`^/dashboard/${PROJECT_ID}/.+/settings/rules-audit-logs$`),
    );
  });

  test("every entry of the section carries an icon", async () => {
    goTo(routeFor(menu.landing));
    await renderProductMenu(menu);

    expect(iconCountIn("Settings")).toBe(linksIn("Settings").length);
  });

  test("the section starts folded away from its pages", async () => {
    goTo(routeFor(menu.landing));
    await renderProductMenu(menu);

    expect(isExpanded("Settings")).toBe(false);
    // Folded, its entries are still there to be reached.
    expect(linksIn("Settings")).toHaveLength(menu.before.length + 1);
  });

  test("opens itself on the rules' Audit Logs page, and marks it alone", async () => {
    goTo(routeFor(menu.rulesAuditLogs));
    await renderProductMenu(menu);

    expect(isExpanded("Settings")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Rule Audit Logs"]);
  });

  test("on a phone, the button says where the page is: Settings, then Rule Audit Logs", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(routeFor(menu.rulesAuditLogs));
    await renderProductMenu(menu);

    const summary: string = mobileSummaryText();

    expect(summary).toContain("Settings");
    expect(summary).toContain("Rule Audit Logs");
    expect(summary.indexOf("Settings")).toBeLessThan(
      summary.indexOf("Rule Audit Logs"),
    );
  });
});
