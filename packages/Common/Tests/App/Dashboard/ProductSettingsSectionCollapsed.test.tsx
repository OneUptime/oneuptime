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
import fs from "fs";
import path from "path";
import * as React from "react";
import { FunctionComponent } from "react";

/*
 * ModelAPI backs the badge counts in the Alerts, Incidents, Monitor and
 * Scheduled Maintenance menus. Stubbed inline because jest.mock is hoisted
 * above the imports.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionBody,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Every product's list menu ends in a Settings section of rules and
 * configuration that people visit rarely, and it starts collapsed so the pages
 * they use every day sit at the top. That is a per-menu `defaultCollapsed`
 * flag, so a new product (or a menu rewritten by hand) quietly ships with its
 * Settings open — which is how the SLO menu ended up that way.
 *
 * So this renders every Pages/<Product>/SideMenu.tsx against the real RouteMap
 * and checks two things for each one with a Settings section:
 *
 *  - on the product's landing page, Settings is collapsed;
 *  - on each page inside Settings, it is open — collapsing a section must
 *    never hide the page you are on.
 *
 * The products are listed here rather than inferred, and the last test sweeps
 * the Pages directory so a new product with a Settings section cannot skip
 * the list.
 */

const PAGES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
);

// Products whose list menu starts with Settings collapsed.
const COLLAPSED_SETTINGS_PRODUCTS: Array<string> = [
  "Alerts",
  "Ceph",
  "Cloud",
  "Dashboards",
  "Database",
  "Docker",
  "DockerSwarm",
  "Host",
  "Incidents",
  "Inventory",
  "IoT",
  "Kubernetes",
  "MessageQueue",
  "Monitor",
  // Both wrap the one shared Network menu.
  "NetworkDevice",
  "NetworkSite",
  "OnCallDuty",
  "Podman",
  "Proxmox",
  "Runbook",
  "ScheduledMaintenanceEvents",
  "Serverless",
  "Service",
  "Slo",
  "StatusPages",
  "Teams",
  "Users",
  "VMware",
  "Workflow",
];

/*
 * The deliberate exception. RUM's Settings holds the project-wide Session
 * Replay switch that every piece of replay copy points people to, so it is
 * kept open (see the note in Rum/SideMenu.tsx). Listed so that changing it
 * either way is a decision, not an accident.
 */
const OPEN_SETTINGS_PRODUCTS: Array<string> = ["Rum"];

function productMenuDirectories(): Array<string> {
  return fs
    .readdirSync(PAGES_DIR, { withFileTypes: true })
    .filter((entry: fs.Dirent): boolean => {
      return (
        entry.isDirectory() &&
        fs.existsSync(path.join(PAGES_DIR, entry.name, "SideMenu.tsx"))
      );
    })
    .map((entry: fs.Dirent): string => {
      return entry.name;
    })
    .sort();
}

function productMenu(product: string): FunctionComponent {
  return (
    jest.requireActual(path.join(PAGES_DIR, product, "SideMenu")) as {
      default: FunctionComponent;
    }
  ).default;
}

async function renderProductMenuAt(
  product: string,
  currentPath: string,
): Promise<void> {
  const ProductMenu: FunctionComponent = productMenu(product);

  goTo(currentPath);
  await renderMenu(<ProductMenu />);
}

// The page a product opens to: the first entry in its menu.
async function landingPathOf(product: string): Promise<string> {
  await renderProductMenuAt(product, `/dashboard/${PROJECT_ID}`);

  const firstLink: HTMLAnchorElement | null =
    document.querySelector("nav a[href]");

  cleanup();

  if (!firstLink) {
    throw new Error(`The ${product} side menu rendered no links.`);
  }

  return firstLink.getAttribute("href")!;
}

async function settingsPathsOf(product: string): Promise<Array<string>> {
  await renderProductMenuAt(product, `/dashboard/${PROJECT_ID}`);

  const hrefs: Array<string> = linksIn("Settings").map(
    (link: MenuLink): string => {
      return link.href;
    },
  );

  cleanup();

  return hrefs;
}

describe("product list menus keep Settings collapsed", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    // Route population reads the project id from the current URL.
    goTo(`/dashboard/${PROJECT_ID}`);
  });

  afterEach(() => {
    cleanup();
  });

  test.each(COLLAPSED_SETTINGS_PRODUCTS)(
    "%s opens on its landing page with Settings collapsed",
    async (product: string) => {
      const landingPath: string = await landingPathOf(product);

      await renderProductMenuAt(product, landingPath);

      expect(isExpanded("Settings")).toBe(false);
      expect(sectionBody("Settings")).toHaveClass("max-h-0", "opacity-0");
    },
  );

  test.each(COLLAPSED_SETTINGS_PRODUCTS)(
    "%s opens Settings on every page inside it",
    async (product: string) => {
      const settingsPaths: Array<string> = await settingsPathsOf(product);

      expect(settingsPaths.length).toBeGreaterThan(0);

      for (const settingsPath of settingsPaths) {
        await renderProductMenuAt(product, settingsPath);

        expect({
          page: settingsPath,
          expanded: isExpanded("Settings"),
        }).toEqual({ page: settingsPath, expanded: true });

        cleanup();
      }
    },
  );

  test.each(OPEN_SETTINGS_PRODUCTS)(
    "%s keeps Settings open on purpose",
    async (product: string) => {
      const landingPath: string = await landingPathOf(product);

      await renderProductMenuAt(product, landingPath);

      expect(isExpanded("Settings")).toBe(true);
    },
  );

  test("every product menu with a Settings section is listed above", async () => {
    const listed: Set<string> = new Set([
      ...COLLAPSED_SETTINGS_PRODUCTS,
      ...OPEN_SETTINGS_PRODUCTS,
    ]);
    const products: Array<string> = productMenuDirectories();
    const unlistedWithSettings: Array<string> = [];

    // Guards the sweep itself: a wrong PAGES_DIR would find nothing.
    expect(products).toEqual(expect.arrayContaining([...listed]));

    for (const product of products) {
      if (listed.has(product)) {
        continue;
      }

      await renderProductMenuAt(product, `/dashboard/${PROJECT_ID}`);

      if (sectionTitlesInOrder().includes("Settings")) {
        unlistedWithSettings.push(product);
      }

      cleanup();
    }

    expect(unlistedWithSettings).toEqual([]);
  });
});
