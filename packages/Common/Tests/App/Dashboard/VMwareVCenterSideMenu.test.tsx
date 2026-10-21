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
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  linksIn,
  mobileSummaryText,
  renderMenu,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * A vCenter's side menu on the page of one of its hosts, VMs, datastores or
 * clusters: the list the row came from stays the marked entry (and the
 * phone menu's button names it), so the page never reads as being nowhere
 * in the menu. The list's own page keeps it marked too, and no other page
 * of the vCenter marks it.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      count: async () => {
        return 0;
      },
      getItem: async () => {
        return null;
      },
    },
  };
});

import VMwareVCenterSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/VMware/View/SideMenu";

const VCENTER_ID: string = "31000000-0000-4000-8000-000000000001";
const VCENTER_PATH: string = `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`;

async function renderVCenterMenu(): Promise<void> {
  await renderMenu(
    <VMwareVCenterSideMenu
      modelId={new ObjectID(VCENTER_ID)}
      resourceCounts={{
        hosts: 3,
        virtualMachines: 12,
        datastores: 2,
        clusters: 1,
        resourcePools: 4,
      }}
    />,
  );
}

describe("VMware vCenter side menu on a resource's own page", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
  });

  afterEach(() => {
    cleanup();
  });

  test.each([
    ["an ESXi host", "hosts/host%2Fdc-east%2Fesx01.acme.example", "Hosts"],
    [
      "a virtual machine",
      "virtual-machines/vm%2F4210a1b2-0000-4000-8000-000000000001",
      "Virtual Machines",
    ],
    ["a datastore", "datastores/datastore%2Fdc-east%2Fds-ssd-01", "Datastores"],
    ["a cluster", "clusters/cluster%2Fdc-east%2Fprod", "Clusters"],
  ])(
    "the page of %s marks its list",
    async (_: string, path: string, list: string) => {
      goTo(`${VCENTER_PATH}/${path}`);

      await renderVCenterMenu();

      expect(activeLinkTitles()).toEqual([list]);
    },
  );

  test("the Hosts entry still opens the list from a host's page", async () => {
    goTo(`${VCENTER_PATH}/hosts/host%2Fdc-east%2Fesx01.acme.example`);

    await renderVCenterMenu();

    expect(
      linksIn("Resources").find((link: { title: string }): boolean => {
        return link.title === "Hosts";
      }),
    ).toEqual({ title: "Hosts", href: `${VCENTER_PATH}/hosts` });
  });

  test("each list's own page keeps its entry marked", async () => {
    for (const [path, list] of [
      ["hosts", "Hosts"],
      ["virtual-machines", "Virtual Machines"],
      ["datastores", "Datastores"],
      ["clusters", "Clusters"],
      ["resource-pools", "Resource Pools"],
    ] as Array<[string, string]>) {
      goTo(`${VCENTER_PATH}/${path}`);

      await renderVCenterMenu();

      expect(activeLinkTitles()).toEqual([list]);
      cleanup();
    }
  });

  test("the overview marks Overview, not a list", async () => {
    goTo(VCENTER_PATH);

    await renderVCenterMenu();

    expect(activeLinkTitles()).toEqual(["Overview"]);
  });

  test("another vCenter's host page marks nothing here", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/vmware/31000000-0000-4000-8000-000000000002/hosts/host%2Fdc-east%2Fesx01.acme.example`,
    );

    await renderVCenterMenu();

    expect(activeLinkTitles()).toEqual([]);
  });

  test("on a phone, a host's page names Hosts in the menu button", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`${VCENTER_PATH}/hosts/host%2Fdc-east%2Fesx01.acme.example`);

    await renderVCenterMenu();

    expect(mobileSummaryText()).toContain("Resources / Hosts");
  });
});
