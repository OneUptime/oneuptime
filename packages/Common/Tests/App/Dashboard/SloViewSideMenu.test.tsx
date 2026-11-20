import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import SloViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/SideMenu";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import SliType from "../../../Types/ServiceLevelObjective/SliType";
import Icon from "../../../UI/Components/Icon/Icon";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionBody,
  sectionRoot,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

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

// The count suite covers badge data; these tests exercise the real navigation.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

const SLO_ID: string = "0193c0de-9999-4aaa-8bbb-000000000009";
const SLO_PATH: string = `/dashboard/${PROJECT_ID}/slos/${SLO_ID}`;
// One monitor rule of the SLO: its own page sits below Monitor Rules.
const MONITOR_RULE_ID: string = "0193c0de-9999-4aaa-8bbb-00000000000a";

interface DetailPage {
  title: string;
  section: string;
  path: string;
}

const DETAIL_PAGES: ReadonlyArray<DetailPage> = [
  { title: "Overview", section: "Overview", path: SLO_PATH },
  /*
   * The monitors the SLO measures, right after its overview. They had a
   * Configuration section of their own, holding nothing else, until #9216.
   */
  { title: "Monitors", section: "Overview", path: `${SLO_PATH}/monitors` },
  { title: "Metrics", section: "Overview", path: `${SLO_PATH}/metrics` },
  {
    title: "Monthly Report",
    section: "Overview",
    path: `${SLO_PATH}/monthly-report`,
  },
  { title: "Incidents", section: "Activity", path: `${SLO_PATH}/incidents` },
  { title: "Alerts", section: "Activity", path: `${SLO_PATH}/alerts` },
  { title: "Feed", section: "Activity", path: `${SLO_PATH}/feed` },
  {
    title: "Monitor Rules",
    section: "Rules",
    path: `${SLO_PATH}/monitor-rules`,
  },
  {
    title: "Burn Rate Rules",
    section: "Rules",
    path: `${SLO_PATH}/burn-rate-rules`,
  },
  {
    title: "Error Budget Policy",
    section: "Rules",
    path: `${SLO_PATH}/error-budget-policy`,
  },
  {
    title: "Terraform",
    section: "Developer",
    path: `${SLO_PATH}/developer/terraform`,
  },
  {
    title: "Crossplane",
    section: "Developer",
    path: `${SLO_PATH}/developer/crossplane`,
  },
  { title: "API", section: "Developer", path: `${SLO_PATH}/developer/api` },
  { title: "CLI", section: "Developer", path: `${SLO_PATH}/developer/cli` },
  {
    title: "AI Assistants",
    section: "Developer",
    path: `${SLO_PATH}/developer/ai-assistants`,
  },
  { title: "Owners", section: "Management", path: `${SLO_PATH}/owners` },
  { title: "Settings", section: "Management", path: `${SLO_PATH}/settings` },
  {
    title: "Audit Logs",
    section: "Management",
    path: `${SLO_PATH}/audit-logs`,
  },
  { title: "Delete SLO", section: "Management", path: `${SLO_PATH}/delete` },
];

async function renderSloMenu(): Promise<void> {
  await renderMenu(<SloViewSideMenu modelId={new ObjectID(SLO_ID)} />);
}

describe("SLO detail side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(SLO_PATH);
  });

  afterEach(() => {
    cleanup();
  });

  test("places performance and activity before rules and management, with no Configuration section (#9216)", async () => {
    await renderSloMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Overview",
      "Activity",
      "Rules",
      "Developer",
      "Management",
    ]);
  });

  /*
   * Overview and Activity are what an SLO's page is opened for. Its rules
   * and its management pages are set up once and
   * visited rarely, so they fold down to their titles, like every rarely
   * used section, and open by themselves on their own pages (below).
   */
  test.each([
    ["Overview", true],
    ["Activity", true],
    ["Rules", false],
    ["Management", false],
  ])(
    "%s contains its intended destinations in order, and starts expanded: %s",
    async (section: string, expanded: boolean) => {
      await renderSloMenu();

      const expectedLinks: Array<MenuLink> = DETAIL_PAGES.filter(
        (page: DetailPage): boolean => {
          return page.section === section;
        },
      ).map((page: DetailPage): MenuLink => {
        return { title: page.title, href: page.path };
      });

      expect(linksIn(section)).toEqual(expectedLinks);
      expect(isExpanded(section)).toBe(expanded);
    },
  );

  test("keeps all nineteen destinations unique and fully populated", async () => {
    await renderSloMenu();

    const hrefs: Array<string> = hrefsInMenu();
    const titles: Array<string> = titlesInMenu();

    expect(hrefs).toHaveLength(19);
    expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    expect(titles).toEqual(Array.from(new Set(titles)));
    expect(hrefs).toEqual(
      DETAIL_PAGES.map((page: DetailPage): string => {
        return page.path;
      }),
    );
  });

  test.each(DETAIL_PAGES)(
    "marks only $title active on desktop in $section",
    async (page: DetailPage) => {
      goTo(page.path);
      await renderSloMenu();

      const activeLink: HTMLElement = screen.getByRole("link", {
        name: page.title,
      });

      expect(activeLink).toHaveAttribute("href", page.path);
      expect(activeLink).toHaveClass(
        "bg-indigo-50",
        "text-indigo-700",
        "font-semibold",
      );
      expect(isExpanded(page.section)).toBe(true);
      expect(document.querySelectorAll("a.bg-indigo-50")).toHaveLength(1);
    },
  );

  test.each(DETAIL_PAGES)(
    "the mobile summary identifies $section / $title",
    async (page: DetailPage) => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(page.path);
      await renderSloMenu();

      // A page named like its section (Overview) is named once.
      if (page.section === page.title) {
        expect(mobileSummaryText()).toContain(page.title);
        expect(mobileSummaryText()).not.toContain(
          `${page.section} / ${page.title}`,
        );
        return;
      }

      expect(mobileSummaryText()).toContain(`${page.section} / ${page.title}`);
    },
  );

  test("every destination retains its label and icon", async () => {
    await renderSloMenu();

    sectionTitlesInOrder().forEach((section: string) => {
      const links: Array<MenuLink> = linksIn(section);

      expect(iconCountIn(section)).toBe(links.length);
      links.forEach((link: MenuLink) => {
        expect(link.title.trim()).not.toBe("");
      });
    });
  });

  test("keeps deletion last in Management with its danger hover treatment", async () => {
    await renderSloMenu();

    const managementLinks: Array<MenuLink> = linksIn("Management");

    expect(managementLinks[managementLinks.length - 1]).toEqual({
      title: "Delete SLO",
      href: `${SLO_PATH}/delete`,
    });
    expect(screen.getByRole("link", { name: "Delete SLO" })).toHaveClass(
      "danger-on-hover",
    );
  });
});

/*
 * The d attributes an icon is drawn with, as the Icon component draws it on
 * its own: what tells a funnel from a flame.
 */
function drawnIconPaths(icon: IconProp): Array<string> {
  const { container, unmount } = render(<Icon icon={icon} />);
  const paths: Array<string> = Array.from(
    container.querySelectorAll("svg path"),
  ).map((path: Element): string => {
    return path.getAttribute("d") ?? "";
  });

  unmount();

  return paths;
}

// The d attributes of the icon a menu row draws beside its title.
function rowIconPaths(title: string): Array<string> {
  const row: HTMLElement = screen.getByRole("link", { name: title });

  return Array.from(row.querySelectorAll("svg path")).map(
    (path: Element): string => {
      return path.getAttribute("d") ?? "";
    },
  );
}

/*
 * "Create a new section for rules and have monitor rules there. The section
 * should be collapsed by default" (the maintainer). An SLO has two kinds of
 * rule: Monitor Rules attach the monitors it measures, and Burn Rate Rules
 * raise its alerts and declare its incidents - and its Error Budget Policy
 * says what the team does as its budget runs down. All three are written
 * once and then run by themselves, so they have a section of their own,
 * Rules, folded down to its title until opened - as a status page's Monitor
 * Rules do (StatusPageRulesMenu.test.tsx) - apart from the monitors
 * themselves, which sit in Overview, right after the Overview page (they had
 * a Configuration section of their own until #9216).
 */
describe("the SLO's Rules section", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(SLO_PATH);
  });

  afterEach(() => {
    cleanup();
  });

  test("sits right after Activity, while the monitors sit in Overview, right after Overview", async () => {
    await renderSloMenu();

    const titles: Array<string> = sectionTitlesInOrder();

    expect(titles.indexOf("Rules")).toBe(titles.indexOf("Activity") + 1);
    expect(titles).not.toContain("Configuration");
    expect(linksIn("Overview").slice(0, 2)).toEqual([
      { title: "Overview", href: SLO_PATH },
      { title: "Monitors", href: `${SLO_PATH}/monitors` },
    ]);
    expect(linksIn("Rules")).toEqual([
      { title: "Monitor Rules", href: `${SLO_PATH}/monitor-rules` },
      { title: "Burn Rate Rules", href: `${SLO_PATH}/burn-rate-rules` },
      {
        title: "Error Budget Policy",
        href: `${SLO_PATH}/error-budget-policy`,
      },
    ]);
  });

  test("is the one section that holds rules: no other section lists a rules page", async () => {
    await renderSloMenu();

    for (const section of sectionTitlesInOrder()) {
      if (section === "Rules") {
        continue;
      }

      const rulesPages: Array<string> = linksIn(section)
        .filter((link: MenuLink): boolean => {
          return link.title.endsWith("Rules");
        })
        .map((link: MenuLink): string => {
          return link.title;
        });

      expect({ section, rulesPages }).toEqual({ section, rulesPages: [] });
    }
  });

  test("keeps each rule's icon: the funnel for Monitor Rules, the flame for Burn Rate Rules, the scale for Error Budget Policy", async () => {
    await renderSloMenu();

    expect(iconCountIn("Rules")).toBe(3);
    expect(rowIconPaths("Monitor Rules")).toEqual(
      drawnIconPaths(IconProp.Filter),
    );
    expect(rowIconPaths("Burn Rate Rules")).toEqual(
      drawnIconPaths(IconProp.Fire),
    );
    // The icon of the tier model and of the feed's tier changes.
    expect(rowIconPaths("Error Budget Policy")).toEqual(
      drawnIconPaths(IconProp.Scale),
    );
  });

  test("is folded on the overview: its rows out of sight and out of the keyboard's way", async () => {
    await renderSloMenu();

    expect(isExpanded("Rules")).toBe(false);
    expect(sectionBody("Rules")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
    // The toggle names the rows it shows and hides.
    expect(sectionToggle("Rules")).toHaveAttribute(
      "aria-controls",
      sectionBody("Rules").id,
    );
  });

  test("opens from its title, and folds again, without touching the other sections", async () => {
    await renderSloMenu();

    fireEvent.click(sectionToggle("Rules"));

    expect(isExpanded("Rules")).toBe(true);
    expect(sectionBody("Rules")).not.toHaveClass("invisible");
    expect(sectionBody("Rules")).toHaveClass("opacity-100");
    expect(sectionBody("Rules").className).not.toContain("max-h-");
    expect(isExpanded("Developer")).toBe(false);
    expect(isExpanded("Management")).toBe(false);
    expect(isExpanded("Overview")).toBe(true);

    fireEvent.click(sectionToggle("Rules"));

    expect(isExpanded("Rules")).toBe(false);
    expect(sectionBody("Rules")).toHaveClass("invisible");
  });

  test.each([
    { title: "Monitor Rules", path: `${SLO_PATH}/monitor-rules` },
    { title: "Burn Rate Rules", path: `${SLO_PATH}/burn-rate-rules` },
    { title: "Error Budget Policy", path: `${SLO_PATH}/error-budget-policy` },
  ])(
    "$title opens Rules by itself, and leaves Developer and Management folded",
    async (page: { title: string; path: string }) => {
      goTo(page.path);
      await renderSloMenu();

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules")).not.toHaveClass("invisible");
      expect(activeLinkTitles()).toEqual([page.title]);
      expect(isExpanded("Developer")).toBe(false);
      expect(isExpanded("Management")).toBe(false);
    },
  );

  /*
   * One rule's page is not in the menu; its list is. The section that holds
   * the list opens, so the way back to the other rules is in sight.
   */
  test("one monitor rule's own page opens Rules too", async () => {
    goTo(`${SLO_PATH}/monitor-rules/${MONITOR_RULE_ID}`);
    await renderSloMenu();

    expect(isExpanded("Rules")).toBe(true);
    expect(sectionBody("Rules")).not.toHaveClass("invisible");
    expect(isExpanded("Developer")).toBe(false);
    expect(isExpanded("Management")).toBe(false);
  });

  test("stays folded on the Monitors page, which sits in the open Overview", async () => {
    goTo(`${SLO_PATH}/monitors`);
    await renderSloMenu();

    expect(isExpanded("Overview")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Monitors"]);
    expect(isExpanded("Rules")).toBe(false);
  });

  test("the marked entry sits inside the Rules section's own body", async () => {
    goTo(`${SLO_PATH}/burn-rate-rules`);
    await renderSloMenu();

    const marked: HTMLElement = screen.getByRole("link", {
      name: "Burn Rate Rules",
    });

    expect(sectionRoot("Rules")).toContainElement(marked);
    expect(sectionBody("Rules")).toContainElement(marked);
  });

  test("on a phone, the menu names Rules and the rules page you are on", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(`${SLO_PATH}/monitor-rules`);
    await renderSloMenu();

    expect(mobileSummaryText()).toContain("Rules / Monitor Rules");
    expect(mobileSummaryText()).not.toContain("Configuration");
  });
});

/*
 * A request SLO measures the requests its services serve, so it has no
 * monitors to list and no monitor rules to attach them: the menu leaves
 * out Monitors (in Overview) and Monitor Rules, and keeps every other
 * page where it was. Until the layout has read what the SLO measures,
 * every page is listed.
 */
describe("the side menu of a request SLO", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(SLO_PATH);
  });

  afterEach(() => {
    cleanup();
  });

  test.each([SliType.RequestSuccess, SliType.RequestLatency])(
    "a %s SLO has no Monitors or Monitor Rules pages",
    async (sliType: SliType) => {
      await renderMenu(
        <SloViewSideMenu modelId={new ObjectID(SLO_ID)} sliType={sliType} />,
      );

      expect(sectionTitlesInOrder()).toEqual([
        "Overview",
        "Activity",
        "Rules",
        "Developer",
        "Management",
      ]);
      expect(titlesInMenu()).not.toContain("Monitors");
      expect(titlesInMenu()).not.toContain("Monitor Rules");
      expect(linksIn("Rules")).toEqual([
        {
          title: "Burn Rate Rules",
          href: `${SLO_PATH}/burn-rate-rules`,
        },
        {
          title: "Error Budget Policy",
          href: `${SLO_PATH}/error-budget-policy`,
        },
      ]);
    },
  );

  test.each([SliType.MonitorUptime, null, undefined])(
    "an SLO measuring %s lists Monitors and Monitor Rules",
    async (sliType: SliType | null | undefined) => {
      await renderMenu(
        <SloViewSideMenu modelId={new ObjectID(SLO_ID)} sliType={sliType} />,
      );

      expect(linksIn("Overview")[1]).toEqual({
        title: "Monitors",
        href: `${SLO_PATH}/monitors`,
      });
      expect(titlesInMenu()).toContain("Monitors");
      expect(titlesInMenu()).toContain("Monitor Rules");
    },
  );
});
