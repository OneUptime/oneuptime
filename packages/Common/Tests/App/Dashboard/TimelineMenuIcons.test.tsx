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
import * as React from "react";
import { ReactElement } from "react";
import Link from "../../../Types/Link";
import IconProp from "../../../Types/Icon/IconProp";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import SideMenuItem from "../../../UI/Components/SideMenu/SideMenuItem";
import {
  getGlyphOfIcon,
  getGlyphOfSvg,
} from "../../UI/Components/MenuItemIcons";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  goTo,
  renderMenu,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Every page that draws a timeline is reached from its menu by an entry with
 * the timeline's own icon - the one its Timeline | Table switch shows - so
 * the entry looks like what it opens: the Status Timeline of a monitor and a
 * network site, the State Timeline of an incident, an alert, a scheduled
 * maintenance event and both kinds of episode, and the on-call Schedule
 * Timeline.
 *
 * The status and state timelines' entries used to draw the list icon, the
 * same as the Audit Logs entry a few rows below them in every one of those
 * menus; the Schedule Timeline's drew ViewColumns. The menus are rendered
 * for real, and an entry's icon is compared by what it draws, so an entry
 * that falls back to another icon - or to none - fails here.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string): string => {
          return key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 10 });
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceState",
  () => {
    return {
      __esModule: true,
      default: {
        getActiveScheduledMaintenanceStates: (): Promise<Array<unknown>> => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem",
  () => {
    return {
      __esModule: true,
      default: (props: { link: Link }): ReactElement => {
        return <SideMenuItem link={props.link} />;
      },
    };
  },
);

import MonitorViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu";
import IncidentViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/SideMenu";
import IncidentEpisodeViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/SideMenu";
import AlertViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/SideMenu";
import AlertEpisodeViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/SideMenu";
import ScheduledMaintenanceViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/SideMenu";
import NetworkSiteViewSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/SideMenu";
import OnCallDutySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu";

const MODEL_ID: ObjectID = new ObjectID("0193c0de-3333-4aaa-8bbb-000000000003");

interface TimelineMenuCase {
  name: string;
  menu: () => ReactElement;
  // The entry that opens the timeline, by the title the menu shows.
  timelineEntry: string;
  // The audit log entry that used to share the timeline entry's icon.
  auditEntry: string | null;
}

const TIMELINE_MENUS: Array<TimelineMenuCase> = [
  {
    name: "a monitor",
    menu: (): ReactElement => {
      return (
        <MonitorViewSideMenu
          modelId={MODEL_ID}
          monitorType={MonitorType.Website}
        />
      );
    },
    timelineEntry: "Status Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "a manual monitor (its status is changed from the timeline)",
    menu: (): ReactElement => {
      return (
        <MonitorViewSideMenu
          modelId={MODEL_ID}
          monitorType={MonitorType.Manual}
        />
      );
    },
    timelineEntry: "Status Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "an incident",
    menu: (): ReactElement => {
      return <IncidentViewSideMenu modelId={MODEL_ID} />;
    },
    timelineEntry: "State Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "an incident episode",
    menu: (): ReactElement => {
      return <IncidentEpisodeViewSideMenu modelId={MODEL_ID} />;
    },
    timelineEntry: "State Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "an alert",
    menu: (): ReactElement => {
      return <AlertViewSideMenu modelId={MODEL_ID} />;
    },
    timelineEntry: "State Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "an alert episode",
    menu: (): ReactElement => {
      return <AlertEpisodeViewSideMenu modelId={MODEL_ID} />;
    },
    timelineEntry: "State Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "a scheduled maintenance event",
    menu: (): ReactElement => {
      return <ScheduledMaintenanceViewSideMenu modelId={MODEL_ID} />;
    },
    timelineEntry: "State Timeline",
    auditEntry: "Audit Logs",
  },
  {
    name: "a network site",
    menu: (): ReactElement => {
      return <NetworkSiteViewSideMenu modelId={MODEL_ID} />;
    },
    timelineEntry: "Status Timeline",
    auditEntry: null,
  },
  {
    name: "On-Call Duty",
    menu: (): ReactElement => {
      return <OnCallDutySideMenu />;
    },
    timelineEntry: "Schedule Timeline",
    auditEntry: null,
  },
];

// Every entry of the rendered menu, by the title it shows.
const entries: () => Array<HTMLAnchorElement> =
  (): Array<HTMLAnchorElement> => {
    return Array.from(document.querySelectorAll<HTMLAnchorElement>("a"));
  };

const titleOf: (anchor: HTMLAnchorElement) => string = (
  anchor: HTMLAnchorElement,
): string => {
  return (
    anchor.querySelector('[data-testid="side-menu-item-title"]')?.textContent ??
    anchor.textContent ??
    ""
  ).trim();
};

const entryTitled: (title: string) => HTMLAnchorElement = (
  title: string,
): HTMLAnchorElement => {
  const matches: Array<HTMLAnchorElement> = entries().filter(
    (anchor: HTMLAnchorElement): boolean => {
      return titleOf(anchor) === title;
    },
  );

  if (matches.length !== 1) {
    throw new Error(
      `Expected one "${title}" entry in the menu, found ${matches.length}. Entries: ${entries()
        .map(titleOf)
        .join(", ")}`,
    );
  }

  return matches[0] as HTMLAnchorElement;
};

const glyphOfEntry: (title: string) => string = (title: string): string => {
  return getGlyphOfSvg(entryTitled(title).querySelector("svg"));
};

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}`);
});

afterEach(() => {
  cleanup();
});

describe("the menus of the pages that draw a timeline", () => {
  test.each(TIMELINE_MENUS)(
    "$name: the $timelineEntry entry draws the timeline's icon",
    async (menuCase: TimelineMenuCase) => {
      await renderMenu(menuCase.menu());

      expect(glyphOfEntry(menuCase.timelineEntry)).toBe(
        getGlyphOfIcon(IconProp.Timeline),
      );
    },
  );

  test.each(TIMELINE_MENUS)(
    "$name: no other entry draws the timeline's icon, so it marks the one timeline",
    async (menuCase: TimelineMenuCase) => {
      await renderMenu(menuCase.menu());

      const timeline: string = getGlyphOfIcon(IconProp.Timeline);
      const drawingIt: Array<string> = entries()
        .filter((anchor: HTMLAnchorElement): boolean => {
          return getGlyphOfSvg(anchor.querySelector("svg")) === timeline;
        })
        .map(titleOf);

      expect(drawingIt).toEqual([menuCase.timelineEntry]);
    },
  );

  test.each(
    TIMELINE_MENUS.filter((menuCase: TimelineMenuCase): boolean => {
      return menuCase.auditEntry !== null;
    }),
  )(
    "$name: the timeline no longer looks like Audit Logs, which keeps its list icon",
    async (menuCase: TimelineMenuCase) => {
      await renderMenu(menuCase.menu());

      const audit: string = glyphOfEntry(menuCase.auditEntry as string);

      expect(audit).toBe(getGlyphOfIcon(IconProp.List));
      expect(glyphOfEntry(menuCase.timelineEntry)).not.toBe(audit);
    },
  );

  test("the Schedule Timeline's neighbours keep their own icons: the schedules' calendar, the feeds' link", async () => {
    await renderMenu(<OnCallDutySideMenu />);

    expect(glyphOfEntry("On-Call Schedules")).toBe(
      getGlyphOfIcon(IconProp.Calendar),
    );
    expect(glyphOfEntry("Calendar Feeds")).toBe(getGlyphOfIcon(IconProp.Link));
    expect(glyphOfEntry("Schedule Timeline")).not.toBe(
      getGlyphOfIcon(IconProp.ViewColumns),
    );
  });
});
