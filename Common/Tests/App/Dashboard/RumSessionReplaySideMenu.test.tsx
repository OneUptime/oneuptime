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
 */
const REPLAY_PAGE_COUNT: number = 4;

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
      "Session Replay",
      "Settings",
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
        title: "Replay Policy",
        href: `${APPLICATION_PATH}/session-replay-settings`,
      },
      {
        title: "Replay Access Log",
        href: `${APPLICATION_PATH}/session-replay-audit`,
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
    ["session-replay-settings", "Replay Policy"],
    ["session-replay-audit", "Replay Access Log"],
  ])(
    "mobile navigation locates %s inside the replay category",
    async (path: string, label: string) => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(`${APPLICATION_PATH}/${path}`);
      await renderApplicationMenu();
      expect(mobileSummaryText()).toContain(`Session Replay / ${label}`);
    },
  );
});
