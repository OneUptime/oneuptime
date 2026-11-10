import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";
import ObjectID from "../../../Types/ObjectID";
import RumApplicationViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SideMenu";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  currentEntries,
  goTo,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

const APP_ID: string = "0193c0de-1111-4aaa-8bbb-000000000001";
const APPLICATION_PATH: string = `/dashboard/${PROJECT_ID}/rum/${APP_ID}`;

async function renderApplicationMenu(): Promise<void> {
  await renderMenu(
    <RumApplicationViewSideMenu modelId={new ObjectID(APP_ID)} />,
  );
}

/*
 * Every page the Session Replay category holds. Named once so the length
 * assertions and the list above cannot disagree about what "every" means.
 * User Flows moved to Product Analytics with its events pages (issue #6444,
 * part two).
 */
const REPLAY_PAGE_COUNT: number = 7;

describe("RUM application Session Replay navigation", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`${APPLICATION_PATH}/session-replay`);
  });

  afterEach(() => {
    cleanup();
  });

  test("groups every replay page in one expanded category", async () => {
    await renderApplicationMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Basic",
      "Observability",
      "Product Analytics",
      "Session Replay",
      "Settings",
      "Developer",
      "Advanced",
    ]);
    expect(isExpanded("Session Replay")).toBe(true);
    expect(linksIn("Session Replay")).toEqual([
      { title: "Session Replay", href: `${APPLICATION_PATH}/session-replay` },
      {
        title: "Replay Users",
        href: `${APPLICATION_PATH}/session-replay-users`,
      },
      {
        title: "Health",
        href: `${APPLICATION_PATH}/session-replay-health`,
      },
      {
        title: "Replay Policy",
        href: `${APPLICATION_PATH}/session-replay-settings`,
      },
      {
        title: "Frustration Signals",
        href: `${APPLICATION_PATH}/session-replay-frustration-signals`,
      },
      {
        title: "Replay Access Log",
        href: `${APPLICATION_PATH}/session-replay-audit`,
      },
      {
        title: "Documentation",
        href: `${APPLICATION_PATH}/session-replay-documentation`,
      },
    ]);
    expect(iconCountIn("Session Replay")).toBe(REPLAY_PAGE_COUNT);
  });

  test("preserves observability and advanced destinations without duplicate replay links", async () => {
    await renderApplicationMenu();

    expect(
      linksIn("Observability").map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(["Metrics", "Logs", "Traces", "Clients"]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Audit Logs", href: `${APPLICATION_PATH}/audit-logs` },
      { title: "Delete Application", href: `${APPLICATION_PATH}/delete` },
    ]);
    expect(
      titlesInMenu().filter((title: string): boolean => {
        return title === "Session Replay";
      }),
    ).toHaveLength(1);
    expect(titlesInMenu()).toContain("Documentation");
  });

  test("the replay category can be collapsed and reopened", async () => {
    await renderApplicationMenu();
    fireEvent.click(sectionToggle("Session Replay"));
    expect(isExpanded("Session Replay")).toBe(false);
    fireEvent.click(sectionToggle("Session Replay"));
    expect(isExpanded("Session Replay")).toBe(true);
    expect(linksIn("Session Replay")).toHaveLength(REPLAY_PAGE_COUNT);
  });

  test.each([
    ["session-replay", "Session Replay"],
    ["session-replay-users", "Replay Users"],
    ["session-replay-health", "Health"],
    ["session-replay-settings", "Replay Policy"],
    ["session-replay-frustration-signals", "Frustration Signals"],
    ["session-replay-audit", "Replay Access Log"],
    ["session-replay-documentation", "Documentation"],
  ])(
    "mobile navigation locates %s inside the replay category",
    async (path: string, label: string) => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(`${APPLICATION_PATH}/${path}`);
      await renderApplicationMenu();

      // A page named like its section (Session Replay) is named once.
      if (label === "Session Replay") {
        expect(mobileSummaryText()).toContain(label);
        expect(mobileSummaryText()).not.toContain(`Session Replay / ${label}`);
        return;
      }

      expect(mobileSummaryText()).toContain(`Session Replay / ${label}`);
    },
  );
});

/*
 * Product analytics (issue #6444): who uses the application and how their
 * sessions go, a category of its own beside Observability, ahead of the
 * replay pages its numbers are counted from - and, since part two, what
 * they do: events, funnels, retention, the journeys between pages, and the
 * switch that sends the events.
 */
const PRODUCT_ANALYTICS_LINKS: Array<MenuLink> = [
  { title: "Users", href: `${APPLICATION_PATH}/product-analytics-users` },
  {
    title: "Sessions",
    href: `${APPLICATION_PATH}/product-analytics-sessions`,
  },
  { title: "Events", href: `${APPLICATION_PATH}/product-analytics-events` },
  { title: "Funnels", href: `${APPLICATION_PATH}/product-analytics-funnels` },
  {
    title: "User Retention",
    href: `${APPLICATION_PATH}/product-analytics-retention`,
  },
  { title: "User Flows", href: `${APPLICATION_PATH}/user-flows` },
  {
    title: "Analytics Settings",
    href: `${APPLICATION_PATH}/product-analytics-settings`,
  },
];

describe("RUM application Product Analytics navigation", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
  });

  afterEach(() => {
    cleanup();
  });

  test("holds who, what and the journeys, then the settings, each with its icon", async () => {
    goTo(`${APPLICATION_PATH}/product-analytics-users`);
    await renderApplicationMenu();

    expect(isExpanded("Product Analytics")).toBe(true);
    expect(linksIn("Product Analytics")).toEqual(PRODUCT_ANALYTICS_LINKS);
    expect(iconCountIn("Product Analytics")).toBe(
      PRODUCT_ANALYTICS_LINKS.length,
    );
    expect(activeLinkTitles()).toEqual(["Users"]);
    /* Each page is linked once in the whole menu. */
    for (const link of PRODUCT_ANALYTICS_LINKS) {
      expect(
        titlesInMenu().filter((title: string): boolean => {
          return title === link.title;
        }),
      ).toHaveLength(1);
    }
  });

  test.each([
    ["product-analytics-events", "Events"],
    ["product-analytics-funnels", "Funnels"],
    ["product-analytics-retention", "User Retention"],
    ["user-flows", "User Flows"],
    ["product-analytics-settings", "Analytics Settings"],
  ])("%s lights %s only", async (path: string, label: string) => {
    goTo(`${APPLICATION_PATH}/${path}`);
    await renderApplicationMenu();

    expect(activeLinkTitles()).toEqual([label]);
  });

  test("the Sessions page lights Sessions only", async () => {
    goTo(`${APPLICATION_PATH}/product-analytics-sessions`);
    await renderApplicationMenu();

    expect(activeLinkTitles()).toEqual(["Sessions"]);
  });

  test("a person's page keeps Users lit, as one of the people Users lists", async () => {
    goTo(
      `${APPLICATION_PATH}/product-analytics-users/u-9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`,
    );
    await renderApplicationMenu();

    expect(activeLinkTitles()).toEqual(["Users"]);
    expect(currentEntries()).toEqual([{ title: "Users", current: "true" }]);
  });

  test("the replay pages light nothing in Product Analytics", async () => {
    goTo(`${APPLICATION_PATH}/session-replay-users`);
    await renderApplicationMenu();

    expect(activeLinkTitles()).toEqual(["Replay Users"]);
  });

  test.each([
    ["product-analytics-users", "Users"],
    ["product-analytics-sessions", "Sessions"],
    ["product-analytics-events", "Events"],
    ["product-analytics-funnels", "Funnels"],
    ["product-analytics-retention", "User Retention"],
    ["user-flows", "User Flows"],
    ["product-analytics-settings", "Analytics Settings"],
  ])(
    "mobile navigation locates %s inside Product Analytics",
    async (path: string, label: string) => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(`${APPLICATION_PATH}/${path}`);
      await renderApplicationMenu();

      expect(mobileSummaryText()).toContain(`Product Analytics / ${label}`);
    },
  );
});
