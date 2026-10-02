import { describe, expect, test } from "@jest/globals";
import * as React from "react";
import { Location } from "react-router-dom";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import Link from "../../../Types/Link";
import {
  MenuRoute,
  SECTION_TITLES_COLLAPSED_BY_DEFAULT,
  ancestorDepthOfCurrentPage,
  isTitleCollapsedByDefault,
  routesInMenuChildren,
  routesOfMenuEntry,
  sectionsHoldingCurrentPage,
  startsCollapsed,
} from "../../../UI/Components/SideMenu/SideMenuSectionState";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * The rules behind every side menu's sections: which start collapsed, and
 * which one holds the page the user is on (and so must be open).
 */

// Both sources of the current page, as the app keeps them.
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

function route(path: string): Route {
  return new Route(path);
}

function paths(routes: Array<MenuRoute>): Array<string> {
  return routes.map((menuRoute: MenuRoute): string => {
    return menuRoute.toString();
  });
}

describe("isTitleCollapsedByDefault", () => {
  test("Advanced and Developer are the titles that fold away by default", () => {
    expect(SECTION_TITLES_COLLAPSED_BY_DEFAULT).toEqual([
      "Advanced",
      "Developer",
    ]);
    expect(isTitleCollapsedByDefault("Advanced")).toBe(true);
    expect(isTitleCollapsedByDefault("Developer")).toBe(true);
  });

  test.each([
    "advanced",
    "ADVANCED",
    " Advanced ",
    "\tadvanced\n",
    "developer",
    " DEVELOPER ",
  ])("ignores case and surrounding space: %p", (title: string) => {
    expect(isTitleCollapsedByDefault(title)).toBe(true);
  });

  test.each([
    "",
    "Basic",
    "Settings",
    "Advanced Settings",
    "Advanced Options",
    "Not Advanced",
    "Danger Zone",
    "Developers",
    "Developer Tools",
  ])("leaves %p open", (title: string) => {
    expect(isTitleCollapsedByDefault(title)).toBe(false);
  });
});

describe("startsCollapsed", () => {
  test("Advanced starts collapsed, everything else open", () => {
    expect(startsCollapsed({ title: "Advanced" })).toBe(true);
    expect(startsCollapsed({ title: "Basic" })).toBe(false);
  });

  test("an explicit defaultCollapsed wins in both directions", () => {
    expect(
      startsCollapsed({ title: "Advanced", defaultCollapsed: false }),
    ).toBe(false);
    expect(startsCollapsed({ title: "Settings", defaultCollapsed: true })).toBe(
      true,
    );
  });

  test("a section holding the current page always starts open", () => {
    expect(startsCollapsed({ title: "Advanced", isActive: true })).toBe(false);
    expect(
      startsCollapsed({
        title: "Settings",
        defaultCollapsed: true,
        isActive: true,
      }),
    ).toBe(false);
  });

  test("a section that cannot collapse never starts collapsed", () => {
    expect(startsCollapsed({ title: "Advanced", collapsible: false })).toBe(
      false,
    );
    expect(
      startsCollapsed({
        title: "Settings",
        defaultCollapsed: true,
        collapsible: false,
      }),
    ).toBe(false);
  });

  test("collapsible={true} and isActive={false} change nothing", () => {
    expect(
      startsCollapsed({
        title: "Advanced",
        collapsible: true,
        isActive: false,
      }),
    ).toBe(true);
  });
});

describe("routesOfMenuEntry", () => {
  test("an entry stands for where it links", () => {
    expect(
      paths(routesOfMenuEntry({ link: { title: "A", to: route("/a") } })),
    ).toEqual(["/a"]);
  });

  // A link that carries query state names the route that decides selection.
  test("activeRoute stands in for the link", () => {
    expect(
      paths(
        routesOfMenuEntry({
          link: { title: "A", to: route("/a?tab=x") },
          activeRoute: route("/a"),
        }),
      ),
    ).toEqual(["/a"]);
  });

  test("the sub-item under an entry counts too", () => {
    expect(
      paths(
        routesOfMenuEntry({
          link: { title: "Execution Logs", to: route("/logs") },
          subItemLink: { title: "Timeline", to: route("/logs/9") },
        }),
      ),
    ).toEqual(["/logs", "/logs/9"]);
  });

  test("an entry with no link stands for nothing", () => {
    expect(routesOfMenuEntry({})).toEqual([]);
  });
});

/*
 * Stand-ins for SideMenuItem and for a feature's own entry component: only
 * the props matter, so they render nothing.
 */
interface EntryProps {
  link: Link;
  subItemLink?: Link | undefined;
}

const Entry: React.FunctionComponent<EntryProps> = (): null => {
  return null;
};

const FeatureEntry: React.FunctionComponent<EntryProps> = (): null => {
  return null;
};

describe("routesInMenuChildren", () => {
  test("reads every entry by the shape of its props, through wrappers and fragments", () => {
    const children: React.ReactNode = (
      <>
        <Entry link={{ title: "One", to: route("/one") }} />
        <div>
          <FeatureEntry
            link={{ title: "Two", to: route("/two") }}
            subItemLink={{ title: "Two sub", to: route("/two/sub") }}
          />
        </div>
        {null}
        {false}
        plain text
        <>
          <Entry link={{ title: "Three", to: route("/three") }} />
        </>
      </>
    );

    expect(paths(routesInMenuChildren(children))).toEqual([
      "/one",
      "/two",
      "/two/sub",
      "/three",
    ]);
  });

  test("nothing in, nothing out", () => {
    expect(routesInMenuChildren(undefined)).toEqual([]);
    expect(routesInMenuChildren(<div />)).toEqual([]);
  });
});

describe("ancestorDepthOfCurrentPage", () => {
  test("a route above the current page reaches as deep as its own segments", () => {
    goTo("/dashboard/p/settings/api-keys/42");

    expect(ancestorDepthOfCurrentPage(route("/dashboard/p/settings"))).toBe(3);
    expect(
      ancestorDepthOfCurrentPage(route("/dashboard/p/settings/api-keys")),
    ).toBe(4);
  });

  test("a route beside or below the current page does not count", () => {
    goTo("/dashboard/p/settings/api-keys/42");

    expect(ancestorDepthOfCurrentPage(route("/dashboard/p/monitors"))).toBe(0);
    expect(
      ancestorDepthOfCurrentPage(route("/dashboard/p/settings/api-keys/42/x")),
    ).toBe(0);
  });

  // "api" is not a parent of "api-keys": paths are compared by segment.
  test("compares whole segments, not text", () => {
    goTo("/dashboard/p/settings/api-keys/42");

    expect(ancestorDepthOfCurrentPage(route("/dashboard/p/settings/api"))).toBe(
      0,
    );
  });

  test("matches segments regardless of case, as the router does", () => {
    goTo("/dashboard/p/Settings/API-Keys/42");

    expect(
      ancestorDepthOfCurrentPage(route("/dashboard/p/settings/api-keys")),
    ).toBe(4);
  });

  test("an external URL or an empty route has no place in the path", () => {
    goTo("/dashboard/p/settings");

    expect(
      ancestorDepthOfCurrentPage(URL.fromString("https://example.com/docs")),
    ).toBe(0);
    expect(ancestorDepthOfCurrentPage(route("/"))).toBe(0);
  });
});

describe("sectionsHoldingCurrentPage", () => {
  const BASIC: Array<MenuRoute> = [route("/w/1"), route("/w/1/builder")];
  const ADVANCED: Array<MenuRoute> = [
    route("/w/1/settings"),
    route("/w/1/delete"),
  ];

  test("the section with the entry for the page holds it", () => {
    goTo("/w/1/settings");

    expect(sectionsHoldingCurrentPage([BASIC, ADVANCED])).toEqual([
      false,
      true,
    ]);
  });

  test("a page listed twice is held by both sections", () => {
    goTo("/w/1");

    expect(sectionsHoldingCurrentPage([BASIC, [route("/w/1")]])).toEqual([
      true,
      true,
    ]);
  });

  /*
   * One API key, a single run, a timeline: the menu does not list it, so it
   * belongs under the entry whose route is its deepest ancestor.
   */
  test("a page the menu does not list is held by its deepest ancestor's section", () => {
    goTo("/w/1/settings/history");

    // /w/1 (Basic) is an ancestor too, but /w/1/settings (Advanced) is deeper.
    expect(sectionsHoldingCurrentPage([BASIC, ADVANCED])).toEqual([
      false,
      true,
    ]);
  });

  test("a page under the Overview only stays with the Overview", () => {
    goTo("/w/1/runs/9");

    expect(sectionsHoldingCurrentPage([BASIC, ADVANCED])).toEqual([
      true,
      false,
    ]);
  });

  test("an entry that IS the page beats a deeper-looking ancestor elsewhere", () => {
    goTo("/w/1/builder");

    // Advanced lists /w/1, an ancestor of the builder - but Basic lists the builder itself.
    expect(sectionsHoldingCurrentPage([BASIC, [route("/w/1")]])).toEqual([
      true,
      false,
    ]);
  });

  test("equally deep ancestors in two sections both count", () => {
    goTo("/w/1/settings/history");

    expect(
      sectionsHoldingCurrentPage([
        [route("/w/1/settings")],
        [route("/w/1/settings")],
      ]),
    ).toEqual([true, true]);
  });

  test("a page outside the menu is held by no section", () => {
    goTo("/somewhere/else");

    expect(sectionsHoldingCurrentPage([BASIC, ADVANCED])).toEqual([
      false,
      false,
    ]);
  });

  test("a sub-item that links to the current page holds it", () => {
    goTo("/on-call/logs/9");

    expect(
      sectionsHoldingCurrentPage([
        [route("/on-call/policies")],
        routesOfMenuEntry({
          link: { title: "Execution Logs", to: route("/on-call/logs") },
          subItemLink: { title: "Timeline", to: route("/on-call/logs/9") },
        }),
      ]),
    ).toEqual([false, true]);
  });

  test("no sections, no answer", () => {
    goTo("/w/1");

    expect(sectionsHoldingCurrentPage([])).toEqual([]);
    expect(sectionsHoldingCurrentPage([[]])).toEqual([false]);
  });
});
