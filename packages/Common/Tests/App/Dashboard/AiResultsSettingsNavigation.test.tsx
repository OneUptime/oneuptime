import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import * as React from "react";
import SettingsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/SideMenu";
import {
  PAGE_SEARCH_AREAS,
  PageSearchArea,
  PageSearchPage,
  PageSearchSection,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import { getSettingsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SettingsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
  SettingsRoutePath,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import IconProp from "../../../Types/Icon/IconProp";
import Link from "../../../Types/Link";
import Icon from "../../../UI/Components/Icon/Icon";
import {
  activeLinkTitles,
  currentEntries,
  DESKTOP_WIDTH,
  entryTitle,
  goTo,
  isExpanded,
  linksIn,
  MenuLink,
  MOBILE_WIDTH,
  mobileSummaryText,
  PROJECT_ID,
  renderMenu,
  routeFor,
  sectionRoot,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * PROJECT SETTINGS → AI → AI RESULTS: WHERE THE PAGE IS FOUND.
 *
 * The page that proves what OneUptime AI did (#6800) sits in the AI section
 * of the project's Settings menu, right before AI Logs - the results first,
 * then the record of every call behind them - on every install: unlike AI
 * Credits it is not a billing page, so an install without billing lists it
 * too. It lives at settings/ai-results, its breadcrumbs read Project ›
 * Settings › AI Results, and Search (Cmd/Ctrl+K) finds it in the same place
 * the menu shows it. Each expectation below is written out in full: a list
 * generated from the menu would agree with the menu whatever it said.
 */

/*
 * Whether this install has billing on, pinned by the suite rather than read
 * from the environment (CI's test-setup.sh exports BILLING_ENABLED=true; a
 * bare `npx jest` leaves it unset). A getter, so each test chooses.
 */
let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

const AI_RESULTS_PATH: string = `/dashboard/${PROJECT_ID}/settings/ai-results`;

const AI_SECTION_WITHOUT_BILLING: Array<string> = [
  "AI Features",
  "LLM Providers",
  "External MCP Servers",
  "AI Results",
  "AI Logs",
  "MCP Server",
];

const AI_SECTION_WITH_BILLING: Array<string> = [
  "AI Features",
  "LLM Providers",
  "External MCP Servers",
  "AI Credits",
  "AI Results",
  "AI Logs",
  "MCP Server",
];

function titlesOf(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

function aiResultsLink(): MenuLink | undefined {
  return linksIn("AI").find((link: MenuLink): boolean => {
    return link.title === "AI Results";
  });
}

// The outline an icon draws: the d attributes of its <svg>'s paths.
function pathsIn(container: Element | null): Array<string> {
  return Array.from(container?.querySelectorAll("svg path") ?? []).map(
    (path: Element): string => {
      return path.getAttribute("d") ?? "";
    },
  );
}

function pathsOfIcon(icon: IconProp): Array<string> {
  const drawn: RenderResult = render(<Icon icon={icon} />);
  const paths: Array<string> = pathsIn(drawn.container);

  drawn.unmount();

  return paths;
}

function menuRowNamed(title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    sectionRoot("AI").querySelectorAll("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return entryTitle(candidate) === title;
  });

  if (!anchor) {
    throw new Error(`The AI section has no row titled "${title}".`);
  }

  return anchor;
}

function projectSettingsAiSection(): PageSearchSection {
  const area: PageSearchArea | undefined = PAGE_SEARCH_AREAS.find(
    (candidate: PageSearchArea): boolean => {
      return candidate.id === "project-settings";
    },
  );

  const section: PageSearchSection | undefined = area?.sections.find(
    (candidate: PageSearchSection): boolean => {
      return candidate.title === "AI";
    },
  );

  if (!section) {
    throw new Error("Search's Project Settings area has no AI section.");
  }

  return section;
}

function searchPagesFor(page: PageMap): Array<PageSearchPage> {
  return PAGE_SEARCH_AREAS.flatMap(
    (area: PageSearchArea): Array<PageSearchPage> => {
      return area.sections.flatMap(
        (section: PageSearchSection): Array<PageSearchPage> => {
          return section.pages.filter((candidate: PageSearchPage): boolean => {
            return candidate.page === page;
          });
        },
      );
    },
  );
}

function crumbsOf(pageMapKey: PageMap): Array<Link> {
  return getSettingsBreadcrumbs(RouteMap[pageMapKey]!.toString()) ?? [];
}

beforeEach(() => {
  billingEnabledForTest = false;
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/settings`);
});

afterEach(() => {
  cleanup();
});

describe("AI Results in the Project Settings menu", () => {
  test("an install without billing lists it in AI, right before AI Logs", async () => {
    billingEnabledForTest = false;
    await renderMenu(<SettingsSideMenu />);

    expect(titlesOf(linksIn("AI"))).toEqual(AI_SECTION_WITHOUT_BILLING);
  });

  test("an install with billing lists it after AI Credits, still right before AI Logs", async () => {
    billingEnabledForTest = true;
    await renderMenu(<SettingsSideMenu />);

    expect(titlesOf(linksIn("AI"))).toEqual(AI_SECTION_WITH_BILLING);
  });

  test("is listed once, in AI and nowhere else", async () => {
    billingEnabledForTest = true;
    await renderMenu(<SettingsSideMenu />);

    const everywhere: Array<string> = Array.from(
      document.querySelectorAll("a"),
    ).map((anchor: HTMLAnchorElement): string => {
      return anchor.getAttribute("href") ?? "";
    });

    expect(
      everywhere.filter((href: string): boolean => {
        return href === AI_RESULTS_PATH;
      }),
    ).toHaveLength(1);
    expect(aiResultsLink()?.href).toBe(AI_RESULTS_PATH);
  });

  test("opens the page at …/settings/ai-results of the project the reader is in", async () => {
    await renderMenu(<SettingsSideMenu />);

    expect(aiResultsLink()).toEqual({
      title: "AI Results",
      href: AI_RESULTS_PATH,
    });
    expect(routeFor(PageMap.SETTINGS_AI_RESULTS)).toBe(AI_RESULTS_PATH);
  });

  test("draws a rising-trend icon beside its title, not another row's", async () => {
    await renderMenu(<SettingsSideMenu />);

    const drawn: Array<string> = pathsIn(menuRowNamed("AI Results"));

    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn).toEqual(pathsOfIcon(IconProp.ArrowTrendingUp));
    expect(drawn).not.toEqual(pathsIn(menuRowNamed("AI Logs")));
    expect(drawn).not.toEqual(pathsIn(menuRowNamed("AI Features")));
  });

  test("on its own page, AI is open and AI Results is the one entry marked", async () => {
    goTo(AI_RESULTS_PATH);
    await renderMenu(<SettingsSideMenu />);

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["AI Results"]);
    expect(currentEntries()).toEqual([
      { title: "AI Results", current: "page" },
    ]);
  });

  test("on its own page with billing on, AI Credits is not marked with it", async () => {
    billingEnabledForTest = true;
    goTo(AI_RESULTS_PATH);
    await renderMenu(<SettingsSideMenu />);

    expect(activeLinkTitles()).toEqual(["AI Results"]);
  });

  test("its neighbours' pages do not mark it", async () => {
    billingEnabledForTest = true;

    for (const [page, entry] of [
      [PageMap.SETTINGS_AI_LOGS, "AI Logs"],
      [PageMap.SETTINGS_AI_CREDITS, "AI Credits"],
      [PageMap.SETTINGS_AI_FEATURES, "AI Features"],
    ] as Array<[PageMap, string]>) {
      goTo(routeFor(page));
      await renderMenu(<SettingsSideMenu />);

      expect({ page, marked: activeLinkTitles() }).toEqual({
        page,
        marked: [entry],
      });

      cleanup();
    }
  });

  test("on a phone, the closed menu's button reads AI / AI Results", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(AI_RESULTS_PATH);
    await renderMenu(<SettingsSideMenu />);

    expect(mobileSummaryText()).toContain("AI / AI Results");
  });
});

describe("where the page lives", () => {
  test("at settings/ai-results", () => {
    expect(PageMap.SETTINGS_AI_RESULTS).toBe("SETTINGS_AI_RESULTS");
    expect(SettingsRoutePath[PageMap.SETTINGS_AI_RESULTS]).toBe("ai-results");
    expect(RouteMap[PageMap.SETTINGS_AI_RESULTS]?.toString()).toBe(
      "/dashboard/:projectId/settings/ai-results",
    );
    // What the Settings route group mounts the page on.
    expect(RouteUtil.getLastPathForKey(PageMap.SETTINGS_AI_RESULTS)).toBe(
      "ai-results",
    );
  });

  test("no other page shares its address", () => {
    const sharing: Array<string> = Object.keys(RouteMap).filter(
      (key: string): boolean => {
        return (
          key !== PageMap.SETTINGS_AI_RESULTS &&
          RouteMap[key]?.toString() ===
            "/dashboard/:projectId/settings/ai-results"
        );
      },
    );

    expect(sharing).toEqual([]);
  });

  test("its breadcrumbs read Project › Settings › AI Results", () => {
    expect(
      crumbsOf(PageMap.SETTINGS_AI_RESULTS).map((link: Link): string => {
        return link.title;
      }),
    ).toEqual(["Project", "Settings", "AI Results"]);
  });

  test("its Project and Settings crumbs lead where AI Logs' do", () => {
    goTo(AI_RESULTS_PATH);

    const results: Array<Link> = crumbsOf(PageMap.SETTINGS_AI_RESULTS);
    const logs: Array<Link> = crumbsOf(PageMap.SETTINGS_AI_LOGS);

    expect(results).toHaveLength(3);
    expect(
      results.slice(0, 2).map((link: Link): string => {
        return link.to.toString();
      }),
    ).toEqual(
      logs.slice(0, 2).map((link: Link): string => {
        return link.to.toString();
      }),
    );
    // Real addresses of this project, not route patterns.
    for (const link of results) {
      expect(link.to.toString()).not.toContain(":projectId");
    }
  });
});

describe("in Search's page index", () => {
  test("Project Settings › AI lists AI Results between AI Credits and AI Logs, as the menu does", () => {
    const titles: Array<string> = projectSettingsAiSection().pages.map(
      (page: PageSearchPage): string => {
        return page.title;
      },
    );

    expect(titles).toEqual(AI_SECTION_WITH_BILLING);
  });

  test("is indexed once, by the menu's title and icon, with the words a reader would type", () => {
    const pages: Array<PageSearchPage> = searchPagesFor(
      PageMap.SETTINGS_AI_RESULTS,
    );

    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual({
      page: PageMap.SETTINGS_AI_RESULTS,
      title: "AI Results",
      icon: IconProp.ArrowTrendingUp,
      keywords: [
        "pages avoided",
        "fixes verified",
        "root causes confirmed",
        "ai quality",
        "ai outcomes",
      ],
    });
  });

  test("is found on every install: no billing gate, unlike AI Credits", () => {
    const section: PageSearchSection = projectSettingsAiSection();
    const results: PageSearchPage | undefined = section.pages.find(
      (page: PageSearchPage): boolean => {
        return page.page === PageMap.SETTINGS_AI_RESULTS;
      },
    );
    const credits: PageSearchPage | undefined = section.pages.find(
      (page: PageSearchPage): boolean => {
        return page.page === PageMap.SETTINGS_AI_CREDITS;
      },
    );

    expect(results?.gate).toBeUndefined();
    expect(section.gate).toBeUndefined();
    // The neighbour the gate does belong to, so the check above means something.
    expect(credits?.gate).toBeDefined();
  });
});
