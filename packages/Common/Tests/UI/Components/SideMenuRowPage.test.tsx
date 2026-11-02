import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import SideMenu, {
  SideMenuSectionProps,
} from "../../../UI/Components/SideMenu/SideMenu";
import { SIDE_MENU_ITEM_TITLE_TEST_ID } from "../../../UI/Components/SideMenu/SideMenuEntryState";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import {
  getRowListRoute,
  isRowListLink,
} from "../../../UI/Components/SideMenu/SideMenuRowPage";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import { MenuEntryRoutes } from "../../../UI/Components/SideMenu/SideMenuSectionState";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A row's page lights the list it is a row of (SideMenuRowPage).
 *
 * A list's rows open pages of their own - a Docker Swarm node's page under
 * Nodes, a Proxmox guest's under Guests, a storage array's volume under
 * Volumes - and the menu has an entry for the list, never for each row. On
 * a row's page nothing was lit, a screen reader heard nothing marked, and a
 * phone's menu button could not name where the reader was. Kubernetes, a
 * vCenter and an app platform lit their lists by hand, one detail page at a
 * time (#5305); every other menu did not. The shared menu now works it out
 * for every menu: on a page none of its entries is for, the entry that leads
 * to the page's parent holds the page as one of its rows - when that entry
 * has no entries of its own below it.
 */

const DESKTOP_WIDTH: number = 1280;
const PHONE_WIDTH: number = 375;

const SWARM: string = "/dashboard/p1/docker-swarm/c1";
const NODE_PAGE: string = `${SWARM}/nodes/x7k2m9p4q1r8`;

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

async function renderAt(
  path: string,
  element: ReactElement,
): Promise<RenderResult> {
  goTo(path);

  let rendered: RenderResult | undefined;

  await act(async () => {
    rendered = render(element);
  });

  return rendered!;
}

function link(title: string, path: string): MenuEntryRoutes {
  return { link: { title, to: new Route(path) } };
}

// The menu's anchors that tell a screen reader they are current.
function currentAnchors(): Array<{ title: string; current: string }> {
  return Array.from(document.querySelectorAll("a[aria-current]")).map(
    (anchor: Element): { title: string; current: string } => {
      return {
        title:
          anchor.querySelector(
            `[data-testid="${SIDE_MENU_ITEM_TITLE_TEST_ID}"]`,
          )?.textContent || "",
        current: anchor.getAttribute("aria-current") || "",
      };
    },
  );
}

// The menu's lit anchors, by the classes that tint the row.
function litTitles(): Array<string> {
  return Array.from(document.querySelectorAll("a"))
    .filter((anchor: HTMLAnchorElement): boolean => {
      return anchor.className.split(/\s+/).includes("bg-indigo-50");
    })
    .map((anchor: HTMLAnchorElement): string => {
      return (
        anchor.querySelector(`[data-testid="${SIDE_MENU_ITEM_TITLE_TEST_ID}"]`)
          ?.textContent || ""
      );
    });
}

function sectionToggle(title: string): HTMLElement {
  return screen.getByRole("button", { name: title });
}

// A Docker Swarm cluster's menu, as its view layout draws it.
function swarmMenu(): ReactElement {
  return (
    <SideMenu>
      <SideMenuSection title="Overview">
        <SideMenuItem link={{ title: "Overview", to: new Route(SWARM) }} />
        <SideMenuItem
          link={{ title: "Topology", to: new Route(`${SWARM}/topology`) }}
        />
      </SideMenuSection>
      <SideMenuSection title="Workloads">
        <SideMenuItem
          link={{ title: "Services", to: new Route(`${SWARM}/services`) }}
          badge={4}
        />
        <SideMenuItem
          link={{ title: "Tasks", to: new Route(`${SWARM}/tasks`) }}
        />
      </SideMenuSection>
      <SideMenuSection title="Infrastructure">
        <SideMenuItem
          link={{ title: "Nodes", to: new Route(`${SWARM}/nodes`) }}
          badge={2}
        />
        <SideMenuItem
          link={{ title: "Networks", to: new Route(`${SWARM}/networks`) }}
        />
      </SideMenuSection>
      {/* Folded until opened: Config, as the real menu draws it. */}
      <SideMenuSection title="Config" defaultCollapsed={true}>
        <SideMenuItem
          link={{ title: "Secrets", to: new Route(`${SWARM}/secrets`) }}
        />
        <SideMenuItem
          link={{ title: "Configs", to: new Route(`${SWARM}/configs`) }}
        />
      </SideMenuSection>
      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{ title: "Settings", to: new Route(`${SWARM}/settings`) }}
        />
      </SideMenuSection>
    </SideMenu>
  );
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
  goTo("/");
});

describe("the list a page is one row of (getRowListRoute)", () => {
  const entries: Array<MenuEntryRoutes> = [
    link("Overview", SWARM),
    link("Services", `${SWARM}/services`),
    link("Nodes", `${SWARM}/nodes`),
    link("Settings", `${SWARM}/settings`),
  ];

  test("a page one step below a list is one of its rows", () => {
    goTo(NODE_PAGE);

    expect(getRowListRoute(entries)?.toString()).toBe(`${SWARM}/nodes`);
  });

  test("a row's id may be any word: a name, a path, an id", () => {
    for (const row of [
      "checkout-api-7d9f8b6c5-x2x8k",
      "11111111-1111-4111-8111-111111111111",
      "host%2Fdc-east%2Fesx01.acme.example",
    ]) {
      goTo(`${SWARM}/nodes/${row}`);
      expect(getRowListRoute(entries)?.toString()).toBe(`${SWARM}/nodes`);
    }
  });

  test("on the list's own page there is no row: the list is the page", () => {
    goTo(`${SWARM}/nodes`);

    expect(getRowListRoute(entries)).toBeUndefined();
  });

  test("a page the menu lists has its own entry, however deep", () => {
    goTo(`${SWARM}/services/web`);

    expect(
      getRowListRoute([
        ...entries,
        link("Web service", `${SWARM}/services/web`),
      ]),
    ).toBeUndefined();
  });

  test("an entry lit by its activeRoute is the page, so no list holds it", () => {
    goTo(NODE_PAGE);

    expect(
      getRowListRoute([
        ...entries,
        {
          link: { title: "Nodes", to: new Route(`${SWARM}/nodes`) },
          activeRoute: new Route(`${SWARM}/nodes/:subModelId`),
        },
      ]),
    ).toBeUndefined();
  });

  test("a row's own sub-page, two steps below the list, is not a row", () => {
    goTo(`${NODE_PAGE}/logs`);

    expect(getRowListRoute(entries)).toBeUndefined();
  });

  /*
   * Overview leads to the resource's root, with the resource's other pages
   * below it: a page beside them that the menu does not list (a manual
   * monitor's Criteria) is one of those pages, not a row of Overview.
   */
  test("a page beside the menu's pages is not a row of the entry above them", () => {
    goTo(`${SWARM}/criteria`);

    expect(getRowListRoute(entries)).toBeUndefined();
  });

  /*
   * Open Cases leads to /cases and Assigned to Me to /cases/assigned-to-me:
   * a case's page there cannot be told apart from another view of the
   * list, so nothing is lit for it.
   */
  test("a list with entries of its own below it holds no rows", () => {
    goTo("/security/cases/44444444-4444-4444-8444-444444444444");

    expect(
      getRowListRoute([
        link("Open Cases", "/security/cases"),
        link("Assigned to Me", "/security/cases/assigned-to-me"),
        link("Hunts", "/security/hunts"),
      ]),
    ).toBeUndefined();

    goTo("/security/hunts/3b000000-0000-4000-8000-000000000001");
    expect(
      getRowListRoute([
        link("Open Cases", "/security/cases"),
        link("Assigned to Me", "/security/cases/assigned-to-me"),
        link("Hunts", "/security/hunts"),
      ])?.toString(),
    ).toBe("/security/hunts");
  });

  test("another record's row is not a row of this record's list", () => {
    goTo("/dashboard/p1/docker-swarm/c2/nodes/x7k2m9p4q1r8");

    expect(getRowListRoute(entries)).toBeUndefined();
  });

  test("addresses are matched without case, and a trailing slash is no part", () => {
    goTo(`${SWARM.toUpperCase()}/NODES/x7k2m9p4q1r8/`);

    expect(getRowListRoute(entries)?.toString()).toBe(`${SWARM}/nodes`);
  });

  test("an entry's query or fragment is no part of where it leads", () => {
    goTo("/network/map/site-1");

    expect(
      getRowListRoute([
        link("Map", "/network/map?site="),
        link("Devices", "/network/devices"),
      ])?.toString(),
    ).toBe("/network/map");
  });

  test("a sub-item can be the list", () => {
    goTo("/on-call/logs/timeline/11111111-1111-4111-8111-111111111111");

    expect(
      getRowListRoute([
        {
          link: { title: "Execution Logs", to: new Route("/on-call/logs") },
          subItemLink: {
            title: "Timeline",
            to: new Route("/on-call/logs/timeline"),
          },
        },
      ])?.toString(),
    ).toBe("/on-call/logs/timeline");
  });

  test("an address outside the app leads to no list", () => {
    goTo("/docs/page");

    expect(
      getRowListRoute([
        {
          link: {
            title: "Docs",
            to: URL.fromString("https://oneuptime.com/docs"),
          },
        },
      ]),
    ).toBeUndefined();
  });

  test("the root page is no one's row, and an empty menu holds nothing", () => {
    goTo("/");
    expect(getRowListRoute([link("Home", "/")])).toBeUndefined();

    goTo(NODE_PAGE);
    expect(getRowListRoute([])).toBeUndefined();
  });
});

describe("the entry that leads to the list (isRowListLink)", () => {
  const nodes: Route = new Route(`${SWARM}/nodes`);

  test("is the one whose link leads to the list, query and case aside", () => {
    expect(
      isRowListLink({ title: "Nodes", to: new Route(`${SWARM}/nodes`) }, nodes),
    ).toBe(true);
    expect(
      isRowListLink(
        { title: "Nodes", to: new Route(`${SWARM}/NODES?sort=name`) },
        nodes,
      ),
    ).toBe(true);
  });

  test("is no other entry, and none without a list", () => {
    expect(
      isRowListLink(
        { title: "Networks", to: new Route(`${SWARM}/networks`) },
        nodes,
      ),
    ).toBe(false);
    expect(
      isRowListLink({ title: "Overview", to: new Route(SWARM) }, nodes),
    ).toBe(false);
    expect(
      isRowListLink({ title: "Nodes", to: new Route(`${SWARM}/nodes`) }, null),
    ).toBe(false);
    expect(isRowListLink(undefined, nodes)).toBe(false);
    expect(
      isRowListLink(
        { title: "Docs", to: URL.fromString("https://oneuptime.com/x") },
        nodes,
      ),
    ).toBe(false);
  });
});

describe("a menu lights the list a page is one row of", () => {
  test("on a node's page, Nodes holds it: lit, current, and still leading to the list", async () => {
    await renderAt(NODE_PAGE, swarmMenu());

    expect(litTitles()).toEqual(["Nodes"]);
    expect(currentAnchors()).toEqual([{ title: "Nodes", current: "true" }]);
    expect(screen.getByText("Nodes").closest("a")!.getAttribute("href")).toBe(
      `${SWARM}/nodes`,
    );
  });

  test("on the list itself, Nodes is the page", async () => {
    await renderAt(`${SWARM}/nodes`, swarmMenu());

    expect(currentAnchors()).toEqual([{ title: "Nodes", current: "page" }]);
  });

  test("a list folded away opens for its row's page", async () => {
    await renderAt(`${SWARM}/secrets/db-password`, swarmMenu());

    expect(sectionToggle("Config")).toHaveAttribute("aria-expanded", "true");
    expect(currentAnchors()).toEqual([{ title: "Secrets", current: "true" }]);
  });

  test("a row's own sub-page, and a page beside the menu's, light nothing", async () => {
    await renderAt(`${NODE_PAGE}/logs`, swarmMenu());
    expect(currentAnchors()).toEqual([]);
    expect(litTitles()).toEqual([]);
    cleanup();

    await renderAt(`${SWARM}/criteria`, swarmMenu());
    expect(currentAnchors()).toEqual([]);
    expect(litTitles()).toEqual([]);
  });

  test("another cluster's node lights nothing here", async () => {
    await renderAt(
      "/dashboard/p1/docker-swarm/c2/nodes/x7k2m9p4q1r8",
      swarmMenu(),
    );

    expect(currentAnchors()).toEqual([]);
  });

  test("on a phone, the button names the section and the list", async () => {
    setViewportWidth(PHONE_WIDTH);
    await renderAt(NODE_PAGE, swarmMenu());

    const toggle: HTMLElement = screen.getByTestId("mobile-sidemenu-toggle");
    expect(toggle).toHaveTextContent("Infrastructure / Nodes");
    expect(toggle).not.toHaveTextContent("Navigation");

    fireEvent.click(toggle);
    expect(currentAnchors()).toEqual([{ title: "Nodes", current: "true" }]);
  });

  test("a menu built from a sections array, or bare items, lights its list too", async () => {
    const sections: Array<SideMenuSectionProps> = [
      {
        title: "Settings",
        items: [
          { link: { title: "API Keys", to: new Route("/settings/api-keys") } },
          { link: { title: "Labels", to: new Route("/settings/labels") } },
        ],
      },
    ];

    await renderAt(
      "/settings/api-keys/11111111-1111-4111-8111-111111111111",
      <SideMenu sections={sections} />,
    );
    expect(currentAnchors()).toEqual([{ title: "API Keys", current: "true" }]);
    cleanup();

    await renderAt(
      "/settings/labels/22222222-2222-4222-8222-222222222222",
      <SideMenu
        items={[
          { link: { title: "API Keys", to: new Route("/settings/api-keys") } },
          { link: { title: "Labels", to: new Route("/settings/labels") } },
        ]}
      />,
    );
    expect(currentAnchors()).toEqual([{ title: "Labels", current: "true" }]);
  });

  test("an entry's activeRoute still wins: it is the entry lit", async () => {
    await renderAt(
      NODE_PAGE,
      <SideMenu>
        <SideMenuSection title="Infrastructure">
          <SideMenuItem
            link={{ title: "Nodes", to: new Route(`${SWARM}/nodes`) }}
          />
          <SideMenuItem
            link={{ title: "Hosts", to: new Route(`${SWARM}/hosts`) }}
            activeRoute={new Route(NODE_PAGE)}
          />
        </SideMenuSection>
      </SideMenu>,
    );

    expect(currentAnchors()).toEqual([{ title: "Hosts", current: "true" }]);
  });

  test("an entry drawn outside a menu lights nothing for a row", async () => {
    await renderAt(
      NODE_PAGE,
      <SideMenuItem
        link={{ title: "Nodes", to: new Route(`${SWARM}/nodes`) }}
      />,
    );

    expect(currentAnchors()).toEqual([]);
  });
});
