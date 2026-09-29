import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, screen } from "@testing-library/react";
import * as React from "react";
import SloViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/View/SideMenu";
import ObjectID from "../../../Types/ObjectID";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionTitlesInOrder,
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

interface DetailPage {
  title: string;
  section: string;
  path: string;
}

const DETAIL_PAGES: ReadonlyArray<DetailPage> = [
  { title: "Overview", section: "Overview", path: SLO_PATH },
  { title: "Metrics", section: "Overview", path: `${SLO_PATH}/metrics` },
  { title: "Incidents", section: "Activity", path: `${SLO_PATH}/incidents` },
  { title: "Alerts", section: "Activity", path: `${SLO_PATH}/alerts` },
  { title: "Feed", section: "Activity", path: `${SLO_PATH}/feed` },
  {
    title: "Monitors",
    section: "Configuration",
    path: `${SLO_PATH}/monitors`,
  },
  {
    title: "Monitor Rules",
    section: "Configuration",
    path: `${SLO_PATH}/monitor-rules`,
  },
  {
    title: "Burn Rate Rules",
    section: "Configuration",
    path: `${SLO_PATH}/burn-rate-rules`,
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

  test("places performance and activity before configuration and management", async () => {
    await renderSloMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Overview",
      "Activity",
      "Configuration",
      "Management",
    ]);
  });

  test.each(["Overview", "Activity", "Configuration", "Management"])(
    "%s contains its intended destinations in order and starts expanded",
    async (section: string) => {
      await renderSloMenu();

      const expectedLinks: Array<MenuLink> = DETAIL_PAGES.filter(
        (page: DetailPage): boolean => {
          return page.section === section;
        },
      ).map((page: DetailPage): MenuLink => {
        return { title: page.title, href: page.path };
      });

      expect(linksIn(section)).toEqual(expectedLinks);
      expect(isExpanded(section)).toBe(true);
    },
  );

  test("keeps all twelve destinations unique and fully populated", async () => {
    await renderSloMenu();

    const hrefs: Array<string> = hrefsInMenu();
    const titles: Array<string> = titlesInMenu();

    expect(hrefs).toHaveLength(12);
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
