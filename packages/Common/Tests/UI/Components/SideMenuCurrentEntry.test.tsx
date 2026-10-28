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
import Link from "../../../Types/Link";
import Breadcrumbs from "../../../UI/Components/Breadcrumbs/Breadcrumbs";
import UILink from "../../../UI/Components/Link/Link";
import SideMenu, {
  SideMenuSectionProps,
} from "../../../UI/Components/SideMenu/SideMenu";
import {
  getSideMenuEntryCurrent,
  pageOfLink,
  SIDE_MENU_ITEM_TITLE_TEST_ID,
} from "../../../UI/Components/SideMenu/SideMenuEntryState";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * The side menu's entry for the page you are on is lit: a tinted row with
 * a rail beside it. It was shown by colour only, so a screen reader read
 * every entry alike and never said which one was open (#5037's follow-up).
 * It now says so with aria-current, as the nav bar's lit product does:
 *
 *  - "page" on the entry that is the page you are on;
 *  - "true" ("current") on the entry that holds it, lit for a page under
 *    it and linking elsewhere: Roles on one role's page, a runbook's
 *    Executions on one run's page. "Current page" there would say the link
 *    opens the page you are on.
 *
 * A trail's last crumb, the page you are on, says aria-current="page" too.
 */

const DESKTOP_WIDTH: number = 1280;
const PHONE_WIDTH: number = 375;

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

function entry(title: string, path: string, activeRoute?: Route): ReactElement {
  return (
    <SideMenuItem
      link={{ title, to: new Route(path) }}
      {...(activeRoute ? { activeRoute } : {})}
    />
  );
}

// A team settings menu: Roles opens a list whose rows open a role's page.
function teamsMenu(activeRoute?: Route): ReactElement {
  return (
    <SideMenu>
      <SideMenuSection title="Teams">
        {entry("All Teams", "/teams")}
        {entry("Archived Teams", "/teams/archived")}
      </SideMenuSection>
      <SideMenuSection title="Settings">
        {entry("Roles", "/teams/roles", activeRoute)}
        {entry("Custom Fields", "/teams/custom-fields")}
      </SideMenuSection>
    </SideMenu>
  );
}

const ROLE_PAGE: string = "/teams/roles/11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
  goTo("/");
});

describe("which current item an entry is (getSideMenuEntryCurrent)", () => {
  test("an entry that links to the page you are on is that page", () => {
    goTo("/teams/roles");

    expect(
      getSideMenuEntryCurrent({
        link: { title: "Roles", to: new Route("/teams/roles") },
      }),
    ).toBe("page");
  });

  test("an entry that links elsewhere is not current", () => {
    goTo("/teams/roles");

    expect(
      getSideMenuEntryCurrent({
        link: { title: "All Teams", to: new Route("/teams") },
      }),
    ).toBeUndefined();
  });

  test("an entry lit on a page under it, by its activeRoute, holds the page", () => {
    goTo(ROLE_PAGE);

    expect(
      getSideMenuEntryCurrent({
        link: { title: "Roles", to: new Route("/teams/roles") },
        activeRoute: new Route(ROLE_PAGE),
      }),
    ).toBe("true");
  });

  test("an activeRoute with a placeholder holds every row's page", () => {
    goTo("/k8s/1/pods/checkout-7d9f");

    expect(
      getSideMenuEntryCurrent({
        link: { title: "Pods", to: new Route("/k8s/1/pods") },
        activeRoute: new Route("/k8s/1/pods/:subModelId"),
      }),
    ).toBe("true");
  });

  test("an activeRoute that is the link itself, or the same address, is the page", () => {
    goTo("/teams/roles");
    const to: Route = new Route("/teams/roles");

    expect(
      getSideMenuEntryCurrent({
        link: { title: "Roles", to },
        activeRoute: to,
      }),
    ).toBe("page");
    expect(
      getSideMenuEntryCurrent({
        link: { title: "Roles", to },
        activeRoute: new Route("/teams/roles"),
      }),
    ).toBe("page");
  });

  /*
   * The network map's entry links to the map with a query that resets it
   * ("?site="), and is lit by the bare map route: it is still the page.
   */
  test("an entry whose link carries a query is the page its link leads to", () => {
    goTo("/network/map");

    expect(
      getSideMenuEntryCurrent({
        link: { title: "Map", to: new Route("/network/map?site=") },
        activeRoute: new Route("/network/map"),
      }),
    ).toBe("page");
  });

  test("an entry lit on no page is not current, whatever its link", () => {
    goTo("/teams");

    expect(
      getSideMenuEntryCurrent({
        link: { title: "Roles", to: new Route("/teams/roles") },
        activeRoute: new Route(ROLE_PAGE),
      }),
    ).toBeUndefined();
  });
});

describe("the page a link leads to (pageOfLink)", () => {
  test("drops a query, a fragment, or both", () => {
    expect(pageOfLink(new Route("/network/map?site=")).toString()).toBe(
      "/network/map",
    );
    expect(pageOfLink(new Route("/docs/page#heading")).toString()).toBe(
      "/docs/page",
    );
    expect(pageOfLink(new Route("/a/b#x?y")).toString()).toBe("/a/b");
    expect(pageOfLink(new Route("/a/b?y=1#x")).toString()).toBe("/a/b");
  });

  test("keeps a plain route, and an address outside the app, as they are", () => {
    const plain: Route = new Route("/teams/roles");
    const outside: URL = URL.fromString("https://oneuptime.com/docs?x=1");

    expect(pageOfLink(plain)).toBe(plain);
    expect(pageOfLink(outside)).toBe(outside);
  });
});

describe("a link that is the current item (UILink ariaCurrent)", () => {
  test("says which current item it is, on a link and on text", async () => {
    await renderAt(
      "/somewhere",
      <>
        <UILink to={new Route("/a")} ariaCurrent="page">
          A link
        </UILink>
        <UILink ariaCurrent="true">Some text</UILink>
      </>,
    );

    expect(screen.getByText("A link").closest("a")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByText("Some text").closest("span[aria-current]"),
    ).toHaveAttribute("aria-current", "true");
  });

  test("isCurrentPage still says page, and ariaCurrent wins over it", async () => {
    await renderAt(
      "/somewhere",
      <>
        <UILink to={new Route("/a")} isCurrentPage={true}>
          Lit product
        </UILink>
        <UILink to={new Route("/b")} isCurrentPage={true} ariaCurrent="true">
          Holder
        </UILink>
        <UILink to={new Route("/c")}>Plain</UILink>
      </>,
    );

    expect(screen.getByText("Lit product").closest("a")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("Holder").closest("a")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(screen.getByText("Plain").closest("a")).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("a side menu entry tells a screen reader it is current", () => {
  test("the entry for the page you are on says page, and is the one lit", async () => {
    await renderAt("/teams/custom-fields", teamsMenu());

    expect(currentAnchors()).toEqual([
      { title: "Custom Fields", current: "page" },
    ]);
    expect(litTitles()).toEqual(["Custom Fields"]);
  });

  test("on a role's page, Roles holds it: current, not the current page", async () => {
    await renderAt(ROLE_PAGE, teamsMenu(new Route(ROLE_PAGE)));

    expect(currentAnchors()).toEqual([{ title: "Roles", current: "true" }]);
    expect(litTitles()).toEqual(["Roles"]);
    // The entry still opens the list, not the role.
    expect(screen.getByText("Roles").closest("a")!.getAttribute("href")).toBe(
      "/teams/roles",
    );
  });

  test("on a page the menu does not list, nothing says it is current", async () => {
    await renderAt("/teams/elsewhere", teamsMenu());

    expect(currentAnchors()).toEqual([]);
    expect(litTitles()).toEqual([]);
  });

  test("every entry the colour leaves out says nothing", async () => {
    await renderAt("/teams", teamsMenu());

    for (const title of ["Archived Teams", "Roles", "Custom Fields"]) {
      expect(screen.getByText(title).closest("a")).not.toHaveAttribute(
        "aria-current",
      );
    }
  });

  test("a sub item says it is the page; the entry above it, not lit, says nothing", async () => {
    await renderAt(
      "/on-call/logs/1/timeline",
      <SideMenu>
        <SideMenuSection title="Logs">
          <SideMenuItem
            link={{ title: "Execution Logs", to: new Route("/on-call/logs") }}
            subItemLink={{
              title: "Timeline",
              to: new Route("/on-call/logs/1/timeline"),
            }}
          />
        </SideMenuSection>
      </SideMenu>,
    );

    expect(currentAnchors()).toEqual([{ title: "Timeline", current: "page" }]);
    expect(screen.getByText("Execution Logs").closest("a")).not.toHaveAttribute(
      "aria-current",
    );
  });

  test("a menu built from a sections array, or bare items, says the same", async () => {
    const sections: Array<SideMenuSectionProps> = [
      {
        title: "Teams",
        items: [{ link: { title: "All Teams", to: new Route("/teams") } }],
      },
      {
        title: "Settings",
        items: [
          {
            link: { title: "Roles", to: new Route("/teams/roles") },
            activeRoute: new Route(ROLE_PAGE),
          },
        ],
      },
    ];

    await renderAt(ROLE_PAGE, <SideMenu sections={sections} />);
    expect(currentAnchors()).toEqual([{ title: "Roles", current: "true" }]);
    cleanup();

    await renderAt(
      "/teams",
      <SideMenu
        items={[
          { link: { title: "All Teams", to: new Route("/teams") } },
          { link: { title: "Roles", to: new Route("/teams/roles") } },
        ]}
      />,
    );
    expect(currentAnchors()).toEqual([{ title: "All Teams", current: "page" }]);
  });

  test("on a phone, the opened menu marks the same entry", async () => {
    setViewportWidth(PHONE_WIDTH);
    await renderAt(ROLE_PAGE, teamsMenu(new Route(ROLE_PAGE)));

    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    expect(currentAnchors()).toEqual([{ title: "Roles", current: "true" }]);
  });
});

/*
 * An Enterprise plugin draws its own menu entries (the Admin Dashboard's
 * Custom Channels, say), so SideMenu's route scan sees the component and not
 * the rows it draws. The row still says aria-current, and a folded section
 * must open for it: collapsing must never hide where the reader is.
 */
describe("a folded section opens for an entry the route scan cannot see", () => {
  const OpaqueEntry: () => ReactElement = (): ReactElement => {
    return entry("Custom Channels", "/admin/settings/custom-channels");
  };

  function settingsMenu(): ReactElement {
    return (
      <SideMenu>
        <SideMenuSection title="Basic">
          {entry("Authentication", "/admin/settings/authentication")}
        </SideMenuSection>
        <SideMenuSection title="Notifications" defaultCollapsed={true}>
          {entry("Push Notifications", "/admin/settings/push-notifications")}
          <OpaqueEntry />
        </SideMenuSection>
      </SideMenu>
    );
  }

  function isSectionOpen(title: string): boolean {
    const heading: HTMLElement | undefined = Array.from(
      document.querySelectorAll("h6"),
    ).find((candidate: HTMLElement): boolean => {
      return candidate.textContent?.trim() === title;
    });

    return (
      heading
        ?.closest("div.mb-2")
        ?.querySelector("button")
        ?.getAttribute("aria-expanded") === "true"
    );
  }

  test("opens on the page the opaque entry links to", async () => {
    await renderAt("/admin/settings/custom-channels", settingsMenu());

    expect(isSectionOpen("Notifications")).toBe(true);
    expect(isSectionOpen("Basic")).toBe(true);
  });

  test("opens when the user arrives on that page from another one", async () => {
    const rendered: RenderResult = await renderAt(
      "/admin/settings/authentication",
      settingsMenu(),
    );

    expect(isSectionOpen("Notifications")).toBe(false);

    goTo("/admin/settings/custom-channels");
    rendered.rerender(settingsMenu());

    expect(isSectionOpen("Notifications")).toBe(true);
  });

  test("a section the reader folded by hand stays folded on that page", async () => {
    const rendered: RenderResult = await renderAt(
      "/admin/settings/custom-channels",
      settingsMenu(),
    );

    const heading: HTMLElement = Array.from(
      document.querySelectorAll("h6"),
    ).find((candidate: HTMLElement): boolean => {
      return candidate.textContent?.trim() === "Notifications";
    }) as HTMLElement;
    const toggle: HTMLButtonElement = heading
      .closest("div.mb-2")!
      .querySelector("button") as HTMLButtonElement;

    fireEvent.click(toggle);

    expect(isSectionOpen("Notifications")).toBe(false);

    rendered.rerender(settingsMenu());

    expect(isSectionOpen("Notifications")).toBe(false);
  });
});

/*
 * The phone's menu button is named by what it shows, "Navigate to Settings
 * / Roles", and says with aria-expanded whether its menu is open. A name of
 * its own ("Open navigation menu") hid where the reader is from a screen
 * reader, and someone speaking the words on the button could not press it.
 */
describe("the phone's menu button", () => {
  beforeEach(() => {
    setViewportWidth(PHONE_WIDTH);
  });

  test("is named by the words it shows, and says whether the menu is open", async () => {
    await renderAt(ROLE_PAGE, teamsMenu(new Route(ROLE_PAGE)));

    const button: HTMLElement = screen.getByTestId("mobile-sidemenu-toggle");

    expect(button).not.toHaveAttribute("aria-label");
    expect(
      screen.getByRole("button", { name: "Navigate to Settings / Roles" }),
    ).toBe(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).not.toHaveAttribute("aria-controls");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    const panelId: string | null = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toHaveAttribute(
      "role",
      "navigation",
    );
    expect(document.getElementById(panelId!)).toContainElement(
      screen.getByRole("link", { name: "Roles" }),
    );
  });
});

describe("a trail's last crumb is the current page", () => {
  test("it says aria-current=page, and the crumbs before it say nothing", async () => {
    const links: Array<Link> = [
      { title: "Project", to: new Route("/dashboard/p/home") },
      { title: "Teams", to: new Route("/dashboard/p/teams") },
      { title: "Roles", to: new Route("/dashboard/p/teams/roles") },
    ];

    await renderAt("/dashboard/p/teams/roles", <Breadcrumbs links={links} />);

    const current: HTMLElement = screen
      .getByText("Roles")
      .closest("[aria-current]") as HTMLElement;

    expect(current).toHaveAttribute("aria-current", "page");
    // Text, not a link to itself.
    expect(current.tagName).toBe("SPAN");
    expect(current.closest("a")).toBeNull();
    for (const title of ["Project", "Teams"]) {
      expect(screen.getByText(title).closest("a")).not.toHaveAttribute(
        "aria-current",
      );
    }
    expect(document.querySelectorAll("[aria-current]")).toHaveLength(1);
  });

  test("a trail that does not end on this page marks nothing", async () => {
    await renderAt(
      "/dashboard/p/teams/roles/1",
      <Breadcrumbs
        links={[
          { title: "Project", to: new Route("/dashboard/p/home") },
          { title: "Roles", to: new Route("/dashboard/p/teams/roles") },
        ]}
      />,
    );

    expect(document.querySelectorAll("[aria-current]")).toHaveLength(0);
  });
});
