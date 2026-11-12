import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * THE INCIDENT AND ALERT SIDEBAR'S AFFECTED RESOURCES ON AN ARABIC OR
 * PERSIAN PAGE (#6866, #6471).
 *
 * The sidebar card (AffectedResourcesDisplay) lists what an incident or an
 * alert is about under each kind's heading: one name to a row, cut short
 * with "..." where the sidebar ends. Each row's box laid the link's bare
 * name out as a block that truncates ([&_span.flex]:block truncate) - a
 * line of the page's - so on a Persian page an English monitor's name too
 * long for the sidebar was cut at its start, "...Utilization on
 * AllNodesInEuWest1", the "..." where the name begins.
 *
 * A row that draws a name alone is a line that reads the way the name does
 * now (IsolatedLine): its "..." at the name's own end, and a short one still
 * starting where the page's lines do. A service's row draws its colour
 * before its name, whose own line already reads its way (ServiceElement):
 * it keeps the page's way, so the colour stays at the line's start. Either
 * way the whole row is still the link's click area, with its focus ring
 * round the row.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
        dir?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          {
            href: props.to?.toString(),
            className: props.className,
            dir: props.dir,
          },
          props.children,
        );
      },
    };
  },
);

import AffectedResourcesDisplay, {
  AFFECTED_RESOURCE_ITEM_CLASS_NAME,
  AFFECTED_RESOURCE_ITEM_TEST_ID,
  ComponentProps as AffectedResources,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Host from "../../../Models/DatabaseModels/Host";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import Service from "../../../Models/DatabaseModels/Service";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import Color from "../../../Types/Color";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const ENGLISH_MONITOR: string =
  "oneuptime-test - High Node Memory Utilization on AllNodesInEuWest1";
const ARABIC_MONITOR: string = "ذاكرة العقد مرتفعة في الاتحاد الأوروبي";
const ENGLISH_SERVICE: string = "checkout-api (payments, EU West)";
const ARABIC_SERVICE: string = "واجهة الدفع";

const RIGHT_TO_LEFT_LANGUAGES: Array<string> = ["ar", "fa"];

// The classes that make the whole row the link's click area and focus ring.
const CLICK_AREA_CLASSES: Array<string> = [
  "[&_a]:after:absolute",
  "[&_a]:after:inset-0",
  "[&_a]:after:rounded-md",
  "[&_a:focus-visible]:outline-none",
  "[&_a:focus-visible]:after:ring-2",
  "[&_a:focus-visible]:after:ring-indigo-500",
];

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "ar", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: {} },
        ar: { translation: {} },
        fa: { translation: {} },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

beforeEach(() => {
  // Route population reads the project id from the current URL.
  goTo(`/dashboard/${PROJECT_ID}/incidents`);
});

afterEach(() => {
  cleanup();
});

let nextId: number = 1;

type NamedModel = { _id?: string | undefined; name?: string | undefined };

const named: <T extends NamedModel>(model: T, name: string) => T = <
  T extends NamedModel,
>(
  model: T,
  name: string,
): T => {
  model._id = `0193c0de-6866-4aaa-8bbb-${String(nextId++).padStart(12, "0")}`;
  model.name = name;
  return model;
};

const serviceNamed: (name: string) => Service = (name: string): Service => {
  const service: Service = named(new Service(), name);

  service.serviceColor = new Color("#6366f1");
  return service;
};

/*
 * One English name of every kind the card lists by a bare name (a record
 * link with no icon): each kind's heading carries its icon instead.
 */
const EVERY_BARE_NAMED_KIND: () => {
  resources: AffectedResources;
  names: Array<string>;
} = (): { resources: AffectedResources; names: Array<string> } => {
  const names: Array<string> = [
    ENGLISH_MONITOR,
    "web-prod-03.eu-west-1.acme-commerce.internal",
    "core-switch-02 (rack B, Frankfurt)",
    "prod-eu-west-1 (EKS)",
    "docker-build-01.ci.internal",
    "podman-edge-07.lab",
    "pve-cluster-frankfurt",
    "openstack-region-one",
    "vcenter-01.dc2.acme.example",
    "ceph-prod (object storage)",
    "netapp-a400-primary",
    "swarm-payments-eu",
    "warehouse-sensors (Hamburg)",
    "orders-db-primary.postgres",
    "arn:aws:rds:eu-west-1:123456789012:db:orders",
    "Frankfurt DC2 (cage 14)",
    "Checkout availability (30d, 99.9%)",
  ];

  return {
    names: names,
    resources: {
      monitors: [named(new Monitor(), names[0]!)],
      hosts: [named(new Host(), names[1]!)],
      networkDevices: [named(new NetworkDevice(), names[2]!)],
      kubernetesClusters: [named(new KubernetesCluster(), names[3]!)],
      dockerHosts: [named(new DockerHost(), names[4]!)],
      podmanHosts: [named(new PodmanHost(), names[5]!)],
      proxmoxClusters: [named(new ProxmoxCluster(), names[6]!)],
      openStackClouds: [named(new OpenStackCloud(), names[7]!)],
      vmwareVCenters: [named(new VMwareVCenter(), names[8]!)],
      cephClusters: [named(new CephCluster(), names[9]!)],
      storageArrays: [named(new StorageArray(), names[10]!)],
      dockerSwarmClusters: [named(new DockerSwarmCluster(), names[11]!)],
      iotFleets: [named(new IoTFleet(), names[12]!)],
      databaseServers: [named(new DatabaseServer(), names[13]!)],
      cloudResources: [named(new CloudResource(), names[14]!)],
      networkSites: [named(new NetworkSite(), names[15]!)],
      serviceLevelObjectives: [named(new ServiceLevelObjective(), names[16]!)],
    },
  };
};

const drawCard: (language: string, resources: AffectedResources) => void = (
  language: string,
  resources: AffectedResources,
): void => {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <AffectedResourcesDisplay {...resources} columns={1} />
    </I18nextProvider>,
  );
};

// The row's box that names `name`.
const itemNaming: (name: string) => HTMLElement = (
  name: string,
): HTMLElement => {
  const item: HTMLElement | undefined = screen
    .getAllByTestId(AFFECTED_RESOURCE_ITEM_TEST_ID)
    .find((each: HTMLElement): boolean => {
      return each.textContent?.trim() === name;
    });

  if (!item) {
    throw new Error(`No affected resource reads "${name}"`);
  }

  return item;
};

describe("a name drawn alone, on an Arabic or Persian page", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an English monitor's row reads left to right, lined up as the page's lines, cut at its own end",
    (language: string) => {
      drawCard(language, {
        monitors: [named(new Monitor(), ENGLISH_MONITOR)],
      });

      const item: HTMLElement = itemNaming(ENGLISH_MONITOR);

      expect(item).toHaveAttribute("dir", "ltr");
      expect(item.getAttribute("class")).toBe(
        `${AFFECTED_RESOURCE_ITEM_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );
      expect(item).toHaveAttribute("title", ENGLISH_MONITOR);

      /*
       * The link's bare name, which the row lays out as a block that
       * truncates ([&_span.flex]:block truncate): inside the row's line, so
       * its "..." is at the name's own end.
       */
      const link: HTMLElement = within(item).getByRole("link");
      const bareName: Element | undefined = Array.from(link.children).find(
        (child: Element): boolean => {
          return child.matches("span.flex");
        },
      );

      expect(bareName).toBeDefined();
      expect(bareName!.textContent).toBe(` ${ENGLISH_MONITOR}`);
      expect(bareName!.closest("[dir]")).toBe(item);
      // The link itself takes no dir of its own: it reads its row's.
      expect(link).not.toHaveAttribute("dir");
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: every kind listed by its bare name reads its own way",
    (language: string) => {
      const every: { resources: AffectedResources; names: Array<string> } =
        EVERY_BARE_NAMED_KIND();

      drawCard(language, every.resources);

      expect(
        screen.getAllByTestId(AFFECTED_RESOURCE_ITEM_TEST_ID),
      ).toHaveLength(every.names.length);

      for (const name of every.names) {
        const item: HTMLElement = itemNaming(name);

        expect(item).toHaveAttribute("dir", "ltr");
        expect(item).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        expect(within(item).getByRole("link")).toBeInTheDocument();
      }
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic monitor's row is drawn as it was: no dir, its own classes",
    (language: string) => {
      drawCard(language, { monitors: [named(new Monitor(), ARABIC_MONITOR)] });

      const item: HTMLElement = itemNaming(ARABIC_MONITOR);

      expect(item).not.toHaveAttribute("dir");
      expect(item.getAttribute("class")).toBe(
        AFFECTED_RESOURCE_ITEM_CLASS_NAME,
      );
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the whole row is still the link's click area, its focus ring round the row",
    (language: string) => {
      drawCard(language, {
        monitors: [named(new Monitor(), ENGLISH_MONITOR)],
      });

      const item: HTMLElement = itemNaming(ENGLISH_MONITOR);
      const row: HTMLElement = item.closest("li") as HTMLElement;

      expect(item).toHaveClass(...CLICK_AREA_CLASSES);
      expect(row).toHaveClass("relative", "rounded-md", "hover:bg-gray-50");
      expect(row).not.toHaveAttribute("dir");

      // Nothing between the row and the link is positioned.
      let node: HTMLElement | null = within(item).getByRole("link");

      while (node && node !== row) {
        expect(node.getAttribute("class") || "").not.toMatch(
          /(^|\s)(relative|absolute)(\s|$)/,
        );
        node = node.parentElement;
      }

      expect(within(row).getAllByRole("link")).toHaveLength(1);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: each kind's heading keeps the page's way",
    (language: string) => {
      drawCard(language, {
        monitors: [named(new Monitor(), ENGLISH_MONITOR)],
      });

      const category: HTMLElement = screen.getByTestId(
        "affected-resource-category",
      );

      expect(category.querySelector("h3")).not.toHaveAttribute("dir");
      expect(category).not.toHaveAttribute("dir");
      expect(category.querySelector("ul")).not.toHaveAttribute("dir");
    },
  );
});

describe("a service: its colour, then its name's own line", () => {
  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: the row keeps the page's way, so the colour stays at the line's start; the English name reads left to right",
    (language: string) => {
      drawCard(language, { services: [serviceNamed(ENGLISH_SERVICE)] });

      const item: HTMLElement = itemNaming(ENGLISH_SERVICE);

      expect(item).not.toHaveAttribute("dir");
      expect(item.getAttribute("class")).toBe(
        AFFECTED_RESOURCE_ITEM_CLASS_NAME,
      );
      expect(item).toHaveAttribute("title", ENGLISH_SERVICE);

      const name: HTMLElement = within(item).getByText(ENGLISH_SERVICE);

      expect(name).toHaveAttribute("dir", "ltr");
      expect(name.getAttribute("class")).toBe(
        `min-w-0 truncate ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
      );

      // The colour's box comes first in a row of the page's way.
      const colourRow: HTMLElement = name.parentElement as HTMLElement;

      expect(colourRow).not.toHaveAttribute("dir");
      expect(colourRow.firstElementChild).not.toBe(name);
      expect(colourRow.lastElementChild).toBe(name);
    },
  );

  test.each(RIGHT_TO_LEFT_LANGUAGES)(
    "%s: an Arabic service's name is drawn as it was",
    (language: string) => {
      drawCard(language, { services: [serviceNamed(ARABIC_SERVICE)] });

      const name: HTMLElement = within(itemNaming(ARABIC_SERVICE)).getByText(
        ARABIC_SERVICE,
      );

      expect(name).not.toHaveAttribute("dir");
      expect(name.getAttribute("class")).toBe("min-w-0 truncate");
    },
  );
});

describe("on an English page", () => {
  test("every row is drawn as it was: no dir, its own classes", () => {
    const every: { resources: AffectedResources; names: Array<string> } =
      EVERY_BARE_NAMED_KIND();

    drawCard("en", {
      ...every.resources,
      services: [serviceNamed(ENGLISH_SERVICE)],
    });

    for (const name of [...every.names, ENGLISH_SERVICE]) {
      const item: HTMLElement = itemNaming(name);

      expect(item).not.toHaveAttribute("dir");
      expect(item.getAttribute("class")).toBe(
        AFFECTED_RESOURCE_ITEM_CLASS_NAME,
      );
      expect(item.tagName).toBe("DIV");
    }

    expect(
      within(itemNaming(ENGLISH_SERVICE)).getByText(ENGLISH_SERVICE),
    ).not.toHaveAttribute("dir");
  });

  test("an Arabic monitor's row reads right to left, lined up as the page's lines", () => {
    drawCard("en", { monitors: [named(new Monitor(), ARABIC_MONITOR)] });

    const item: HTMLElement = itemNaming(ARABIC_MONITOR);

    expect(item).toHaveAttribute("dir", "rtl");
    expect(item.getAttribute("class")).toBe(
      `${AFFECTED_RESOURCE_ITEM_CLASS_NAME} ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME}`,
    );
  });
});
