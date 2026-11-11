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
import SideMenu, {
  SideMenuSectionProps,
} from "../../../UI/Components/SideMenu/SideMenu";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import SideMenuSection from "../../../UI/Components/SideMenu/SideMenuSection";
import {
  getSideMenuFoldMemoryKey,
  readRememberedSectionFold,
  rememberSectionFold,
  SIDE_MENU_FOLDS_MENUS_REMEMBERED,
  SIDE_MENU_FOLDS_STORAGE_KEY,
  startsCollapsed,
} from "../../../UI/Components/SideMenu/SideMenuSectionState";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * A side menu remembers what its reader folded and opened (#6816).
 *
 * Whether a section was folded used to live only while the page was
 * mounted, so a section someone opens every day - Settings under
 * Incidents - was folded again on the next visit. Now a section folded or
 * opened BY HAND stays that way, per menu, in the browser, as the products
 * menu remembers its categories. The section holding the page the person
 * is on still opens by itself, whatever was remembered, and that opening
 * is never remembered.
 */

const PROJECT_A: string = "65f0000000000000000000aa";
const PROJECT_B: string = "65f0000000000000000000bb";
const MONITOR_1: string = "5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1d11";
const MONITOR_2: string = "5d6b2a0c-6a3e-4c2b-9f43-3f1b0a7c1d22";

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

// The Incidents menu: Overview open, Settings folded by the title rule.
function incidentsSections(project: string): Array<SideMenuSectionProps> {
  return [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "All Incidents",
            to: new Route(`/dashboard/${project}/incidents`),
          },
        },
      ],
    },
    {
      title: "Settings",
      items: [
        {
          link: {
            title: "Incident States",
            to: new Route(`/dashboard/${project}/incidents/settings/states`),
          },
        },
      ],
    },
  ];
}

// The Alerts menu: the same section titles, a different menu.
function alertsSections(project: string): Array<SideMenuSectionProps> {
  return [
    {
      title: "Overview",
      items: [
        {
          link: {
            title: "All Alerts",
            to: new Route(`/dashboard/${project}/alerts`),
          },
        },
      ],
    },
    {
      title: "Settings",
      items: [
        {
          link: {
            title: "Alert States",
            to: new Route(`/dashboard/${project}/alerts/settings/states`),
          },
        },
      ],
    },
  ];
}

// One monitor's own menu, written as JSX the way every record's menu is.
function monitorMenu(monitor: string): ReactElement {
  return (
    <SideMenu>
      <SideMenuSection title="Basic">
        <SideMenuItem
          link={{
            title: "Overview",
            to: new Route(`/dashboard/${PROJECT_A}/monitors/${monitor}`),
          }}
        />
      </SideMenuSection>
      <SideMenuSection title="Advanced">
        <SideMenuItem
          link={{
            title: "Settings",
            to: new Route(
              `/dashboard/${PROJECT_A}/monitors/${monitor}/settings`,
            ),
          }}
        />
      </SideMenuSection>
    </SideMenu>
  );
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

// A section's body is folded when it carries max-h-0 (the menus' contract).
function isFolded(title: string): boolean {
  const button: HTMLElement = screen.getByRole("button", {
    name: new RegExp(title, "i"),
  });
  return button.getAttribute("aria-expanded") === "false";
}

function toggle(title: string): void {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(title, "i") }));
}

beforeEach(() => {
  window.localStorage.clear();
  setViewportWidth(1280);
});

afterEach(() => {
  cleanup();
});

describe("which menu a fold belongs to", () => {
  test("record and project ids are taken out, so every record's menu of a kind shares one memory", () => {
    const one: string = getSideMenuFoldMemoryKey({
      firstRoute: new Route(`/dashboard/${PROJECT_A}/monitors/${MONITOR_1}`),
      sectionTitles: [],
    });
    const two: string = getSideMenuFoldMemoryKey({
      firstRoute: new Route(`/dashboard/${PROJECT_B}/monitors/${MONITOR_2}`),
      sectionTitles: [],
    });

    expect(one).toBe("/dashboard/:id/monitors/:id");
    expect(two).toBe(one);
  });

  test("the Incidents and Alerts menus are two menus, though their sections are named alike", () => {
    expect(
      getSideMenuFoldMemoryKey({
        firstRoute: new Route(`/dashboard/${PROJECT_A}/incidents`),
        sectionTitles: ["Overview", "Settings"],
      }),
    ).not.toBe(
      getSideMenuFoldMemoryKey({
        firstRoute: new Route(`/dashboard/${PROJECT_A}/alerts`),
        sectionTitles: ["Overview", "Settings"],
      }),
    );
  });

  test("a number in the path is a record too; a query string and an anchor are not part of the menu", () => {
    expect(
      getSideMenuFoldMemoryKey({
        firstRoute: new Route(
          `/dashboard/${PROJECT_A}/settings/billing/42?tab=1#cards`,
        ),
        sectionTitles: [],
      }),
    ).toBe("/dashboard/:id/settings/billing/:id");
  });

  test("words of a page are kept, even those spelled in hex letters", () => {
    expect(
      getSideMenuFoldMemoryKey({
        firstRoute: new Route("/dashboard/abc/feed/decade"),
        sectionTitles: [],
      }),
    ).toBe("/dashboard/abc/feed/decade");
  });

  test("a menu with no entry to read is named by its section titles", () => {
    expect(
      getSideMenuFoldMemoryKey({
        firstRoute: undefined,
        sectionTitles: ["Overview", "Settings"],
      }),
    ).toBe("sections:Overview|Settings");
  });
});

describe("what is remembered", () => {
  test("nothing, until a section is toggled", () => {
    expect(readRememberedSectionFold("menu", "Settings")).toBeUndefined();
  });

  test("open and folded, per menu and per section", () => {
    rememberSectionFold("incidents", "Settings", true);
    rememberSectionFold("incidents", "Rules", false);
    rememberSectionFold("alerts", "Settings", false);

    expect(readRememberedSectionFold("incidents", "Settings")).toBe(true);
    expect(readRememberedSectionFold("incidents", "Rules")).toBe(false);
    expect(readRememberedSectionFold("alerts", "Settings")).toBe(false);
    expect(readRememberedSectionFold("alerts", "Rules")).toBeUndefined();
  });

  test("the latest choice wins", () => {
    rememberSectionFold("incidents", "Settings", true);
    rememberSectionFold("incidents", "Settings", false);

    expect(readRememberedSectionFold("incidents", "Settings")).toBe(false);
  });

  test("the oldest menus are forgotten past the limit, the most recently changed kept", () => {
    for (
      let index: number = 0;
      index <= SIDE_MENU_FOLDS_MENUS_REMEMBERED;
      index++
    ) {
      rememberSectionFold(`menu-${index}`, "Settings", true);
    }

    const stored: Array<unknown> = JSON.parse(
      window.localStorage.getItem(SIDE_MENU_FOLDS_STORAGE_KEY) || "[]",
    ) as Array<unknown>;

    expect(stored).toHaveLength(SIDE_MENU_FOLDS_MENUS_REMEMBERED);
    expect(readRememberedSectionFold("menu-0", "Settings")).toBeUndefined();
    expect(
      readRememberedSectionFold(
        `menu-${SIDE_MENU_FOLDS_MENUS_REMEMBERED}`,
        "Settings",
      ),
    ).toBe(true);
  });

  test("changing an old menu moves it to the front, so it is not the one forgotten", () => {
    for (
      let index: number = 0;
      index < SIDE_MENU_FOLDS_MENUS_REMEMBERED;
      index++
    ) {
      rememberSectionFold(`menu-${index}`, "Settings", true);
    }

    rememberSectionFold("menu-0", "Rules", false);
    rememberSectionFold("one-more", "Settings", true);

    expect(readRememberedSectionFold("menu-0", "Settings")).toBe(true);
    expect(readRememberedSectionFold("menu-0", "Rules")).toBe(false);
    expect(readRememberedSectionFold("menu-1", "Settings")).toBeUndefined();
  });

  test("a damaged value reads as nothing remembered, and is written over", () => {
    window.localStorage.setItem(SIDE_MENU_FOLDS_STORAGE_KEY, "{not json");
    expect(readRememberedSectionFold("incidents", "Settings")).toBeUndefined();

    window.localStorage.setItem(
      SIDE_MENU_FOLDS_STORAGE_KEY,
      JSON.stringify([
        "junk",
        ["incidents", { Settings: "yes", Rules: true }],
        [7, { Settings: true }],
      ]),
    );
    expect(readRememberedSectionFold("incidents", "Settings")).toBeUndefined();
    expect(readRememberedSectionFold("incidents", "Rules")).toBe(true);

    rememberSectionFold("incidents", "Settings", true);
    expect(readRememberedSectionFold("incidents", "Settings")).toBe(true);
    expect(readRememberedSectionFold("incidents", "Rules")).toBe(true);
  });

  test("storage that refuses to be read or written is no error: the defaults hold", () => {
    const getItem: Storage["getItem"] = Storage.prototype.getItem;
    const setItem: Storage["setItem"] = Storage.prototype.setItem;

    Storage.prototype.getItem = (): string | null => {
      throw new Error("blocked");
    };
    Storage.prototype.setItem = (): void => {
      throw new Error("blocked");
    };

    try {
      expect(() => {
        rememberSectionFold("incidents", "Settings", true);
      }).not.toThrow();
      expect(
        readRememberedSectionFold("incidents", "Settings"),
      ).toBeUndefined();
    } finally {
      Storage.prototype.getItem = getItem;
      Storage.prototype.setItem = setItem;
    }
  });
});

describe("how a section starts", () => {
  test("a remembered choice beats the title rule and an explicit default, either way", () => {
    expect(startsCollapsed({ title: "Settings", rememberedOpen: true })).toBe(
      false,
    );
    expect(startsCollapsed({ title: "Overview", rememberedOpen: false })).toBe(
      true,
    );
    expect(
      startsCollapsed({
        title: "Calendar",
        defaultCollapsed: true,
        rememberedOpen: true,
      }),
    ).toBe(false);
  });

  test("the section holding the page is open, even when it was remembered folded", () => {
    expect(
      startsCollapsed({
        title: "Settings",
        isActive: true,
        rememberedOpen: false,
      }),
    ).toBe(false);
  });

  test("a section that cannot fold is never folded by a remembered choice", () => {
    expect(
      startsCollapsed({
        title: "Overview",
        collapsible: false,
        rememberedOpen: false,
      }),
    ).toBe(false);
  });

  test("without a remembered choice, the rule is as it was", () => {
    expect(startsCollapsed({ title: "Settings" })).toBe(true);
    expect(startsCollapsed({ title: "Overview" })).toBe(false);
    expect(startsCollapsed({ title: "Overview", defaultCollapsed: true })).toBe(
      true,
    );
  });
});

describe("in a side menu", () => {
  test("Settings under Incidents, opened by hand, is open on the next visit", async () => {
    const path: string = `/dashboard/${PROJECT_A}/incidents`;
    const first: RenderResult = await renderAt(
      path,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );

    expect(isFolded("Settings")).toBe(true);
    toggle("Settings");
    expect(isFolded("Settings")).toBe(false);

    first.unmount();
    await renderAt(path, <SideMenu sections={incidentsSections(PROJECT_A)} />);

    expect(isFolded("Settings")).toBe(false);
    expect(isFolded("Overview")).toBe(false);
  });

  test("a section folded by hand stays folded on the next visit", async () => {
    const path: string = `/dashboard/${PROJECT_A}/incidents/settings/states`;
    const first: RenderResult = await renderAt(
      `/dashboard/${PROJECT_A}/incidents/settings/states`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );

    // Overview does not hold this page, so folding it is a free choice.
    toggle("Overview");
    expect(isFolded("Overview")).toBe(true);
    first.unmount();

    await renderAt(path, <SideMenu sections={incidentsSections(PROJECT_A)} />);
    expect(isFolded("Overview")).toBe(true);
  });

  test("in every project: the memory is the menu's, not one project's", async () => {
    const first: RenderResult = await renderAt(
      `/dashboard/${PROJECT_A}/incidents`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );
    toggle("Settings");
    first.unmount();

    await renderAt(
      `/dashboard/${PROJECT_B}/incidents`,
      <SideMenu sections={incidentsSections(PROJECT_B)} />,
    );
    expect(isFolded("Settings")).toBe(false);
  });

  test("opening Settings under Incidents leaves Settings under Alerts folded", async () => {
    const first: RenderResult = await renderAt(
      `/dashboard/${PROJECT_A}/incidents`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );
    toggle("Settings");
    first.unmount();

    await renderAt(
      `/dashboard/${PROJECT_A}/alerts`,
      <SideMenu sections={alertsSections(PROJECT_A)} />,
    );
    expect(isFolded("Settings")).toBe(true);
  });

  test("a remembered fold never hides the section of the page the person is on", async () => {
    const first: RenderResult = await renderAt(
      `/dashboard/${PROJECT_A}/incidents`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );
    // Opened, then folded again: remembered folded.
    toggle("Settings");
    toggle("Settings");
    expect(isFolded("Settings")).toBe(true);
    first.unmount();

    await renderAt(
      `/dashboard/${PROJECT_A}/incidents/settings/states`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );
    expect(isFolded("Settings")).toBe(false);
  });

  test("a section that opened by itself for the page is not remembered open", async () => {
    const first: RenderResult = await renderAt(
      `/dashboard/${PROJECT_A}/incidents/settings/states`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );
    expect(isFolded("Settings")).toBe(false);
    first.unmount();

    expect(window.localStorage.getItem(SIDE_MENU_FOLDS_STORAGE_KEY)).toBeNull();

    await renderAt(
      `/dashboard/${PROJECT_A}/incidents`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );
    expect(isFolded("Settings")).toBe(true);
  });

  test("a record's own menu, written as JSX, remembers for every record of its kind", async () => {
    const first: RenderResult = await renderAt(
      `/dashboard/${PROJECT_A}/monitors/${MONITOR_1}`,
      monitorMenu(MONITOR_1),
    );
    expect(isFolded("Advanced")).toBe(true);
    toggle("Advanced");
    first.unmount();

    await renderAt(
      `/dashboard/${PROJECT_A}/monitors/${MONITOR_2}`,
      monitorMenu(MONITOR_2),
    );
    expect(isFolded("Advanced")).toBe(false);
  });

  test("on a phone too: the phone menu lists the same remembered sections", async () => {
    setViewportWidth(375);
    rememberSectionFold(
      getSideMenuFoldMemoryKey({
        firstRoute: new Route(`/dashboard/${PROJECT_A}/incidents`),
        sectionTitles: [],
      }),
      "Settings",
      true,
    );

    await renderAt(
      `/dashboard/${PROJECT_A}/incidents`,
      <SideMenu sections={incidentsSections(PROJECT_A)} />,
    );

    // The phone shows the menu behind a button that names the page.
    fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

    expect(isFolded("Settings")).toBe(false);
  });

  test("a section rendered on its own, outside a side menu, remembers nothing", async () => {
    const first: RenderResult = await renderAt(
      "/somewhere",
      <SideMenuSection title="Settings">
        <SideMenuItem link={{ title: "One", to: new Route("/one") }} />
      </SideMenuSection>,
    );
    toggle("Settings");
    first.unmount();

    expect(window.localStorage.getItem(SIDE_MENU_FOLDS_STORAGE_KEY)).toBeNull();
  });
});
