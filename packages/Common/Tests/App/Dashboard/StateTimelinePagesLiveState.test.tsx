/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ---------------------------------------------------------------------------
 * Every status and state timeline shows the current state live
 * ---------------------------------------------------------------------------
 *
 * The row of a timeline that has no end is the state in effect right now. It
 * used to read "Currently Active" in the same grey as every other cell, with
 * a duration worked out once at render that never moved until a reload. Each
 * timeline page now takes its Ends At and Duration columns from the shared
 * StateTimeline builders in Common, so that row shows a pulsing Currently
 * Active marker and a duration that counts up every second.
 *
 * Each real page is rendered with ModelTable stubbed to record its props, and
 * the columns it handed over are then rendered for a row still in effect and
 * a finished one - what the table would render, without the network.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface RecordedColumn {
  field: Record<string, unknown>;
  title: string;
  noValueMessage?: string | undefined;
  getElement?: ((item: TimelineRow) => ReactElement) | undefined;
  getExportValue?: ((item: TimelineRow) => string) | undefined;
}

interface RecordedTableProps {
  columns: Array<RecordedColumn>;
}

let recordedTableProps: RecordedTableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: RecordedTableProps): ReactElement => {
      recordedTableProps = props;
      return React.createElement("div", { "data-testid": "model-table" });
    },
  };
});

// The monitor page's disabled banner and the site page's uptime cards read on mount.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMaintenanceWindows",
  () => {
    const fetchWindows: () => Promise<Array<unknown>> = async (): Promise<
      Array<unknown>
    > => {
      return [];
    };

    return {
      __esModule: true,
      default: fetchWindows,
      fetchSiteMaintenanceWindows: fetchWindows,
    };
  },
);

import MonitorStatusTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline";
import IncidentStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline";
import IncidentEpisodeStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/StateTimeline";
import AlertStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/StateTimeline";
import AlertEpisodeStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/StateTimeline";
import ScheduledMaintenanceStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/StateTimeline";
import NetworkSiteStatusTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { getColumnIds } from "../../../UI/Components/ModelTable/ColumnPreference";
import ModelTableColumns from "../../../UI/Components/ModelTable/Columns";
import { PillSize } from "../../../UI/Components/Pill/Pill";
import Navigation from "../../../UI/Utils/Navigation";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

// What the recorded columns are handed: the two dates every timeline row has.
interface TimelineRow {
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}

const NOW: Date = new Date("2026-10-02T12:45:57.500Z");
const WHOLE_SECOND: Date = new Date("2026-10-02T12:45:57.000Z");

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(WHOLE_SECOND.getTime() - seconds * 1000);
};

// The row in effect: an "Identified" state entered 2 mins 54 secs ago.
const LIVE_ROW: TimelineRow = { startsAt: secondsAgo(174) };

// The state before it, which ended when the current one began.
const FINISHED_ROW: TimelineRow = {
  startsAt: secondsAgo(400),
  endsAt: secondsAgo(174),
};

interface TimelinePage {
  name: string;
  component: FunctionComponent<PageComponentProps>;
  endsAtTitle: string;
  // The marker's size: the same as the status pill in the row.
  indicatorSize: PillSize;
}

const TIMELINE_PAGES: Array<TimelinePage> = [
  {
    name: "Monitor > Status Timeline",
    component: MonitorStatusTimelinePage,
    endsAtTitle: "Ends At",
    indicatorSize: PillSize.Normal,
  },
  {
    name: "Incident > State Timeline",
    component: IncidentStateTimelinePage,
    endsAtTitle: "Ends At",
    indicatorSize: PillSize.Normal,
  },
  {
    name: "Incident Episode > State Timeline",
    component: IncidentEpisodeStateTimelinePage,
    endsAtTitle: "Ends At",
    indicatorSize: PillSize.Normal,
  },
  {
    name: "Alert > State Timeline",
    component: AlertStateTimelinePage,
    endsAtTitle: "Ends At",
    indicatorSize: PillSize.Normal,
  },
  {
    name: "Alert Episode > State Timeline",
    component: AlertEpisodeStateTimelinePage,
    endsAtTitle: "Ends At",
    indicatorSize: PillSize.Normal,
  },
  {
    name: "Scheduled Maintenance > State Timeline",
    component: ScheduledMaintenanceStateTimelinePage,
    endsAtTitle: "Ends At",
    indicatorSize: PillSize.Normal,
  },
  {
    name: "Network Site > Status Timeline",
    component: NetworkSiteStatusTimelinePage,
    endsAtTitle: "Until",
    indicatorSize: PillSize.Small,
  },
];

async function renderPage(page: TimelinePage): Promise<void> {
  const Page: FunctionComponent<PageComponentProps> = page.component;

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Page
          pageRoute={new Route("/dashboard/timeline")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  expect(recordedTableProps).not.toBeNull();
}

function columnTitled(title: string): RecordedColumn {
  const matches: Array<RecordedColumn> = recordedTableProps!.columns.filter(
    (column: RecordedColumn): boolean => {
      return column.title === title;
    },
  );

  expect(matches).toHaveLength(1);

  return matches[0]!;
}

function renderCell(column: RecordedColumn, row: TimelineRow): HTMLElement {
  render(<div data-testid="cell">{column.getElement!(row)}</div>);

  return screen.getByTestId("cell");
}

function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  recordedTableProps = null;
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID("aaaaaaaa-0000-4000-8000-000000000001"));
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe.each(TIMELINE_PAGES)("$name", (page: TimelinePage) => {
  test("the row in effect reads a pulsing Currently Active, not grey text", async () => {
    await renderPage(page);

    const cell: HTMLElement = renderCell(
      columnTitled(page.endsAtTitle),
      LIVE_ROW,
    );

    const indicator: HTMLElement = within(cell).getByTestId(
      "currently-active-indicator",
    );

    expect(indicator).toHaveTextContent(/^Currently Active$/);
    expect(within(indicator).getByTestId("pill-dot-pulse")).toHaveClass(
      "motion-safe:animate-ping",
    );
    expect(within(indicator).getByTestId("pill")).toHaveStyle({
      fontSize: page.indicatorSize,
    });
  });

  test("a finished row reads its end date and time", async () => {
    await renderPage(page);

    const cell: HTMLElement = renderCell(
      columnTitled(page.endsAtTitle),
      FINISHED_ROW,
    );

    expect(cell).toHaveTextContent(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        FINISHED_ROW.endsAt!,
        false,
      ),
    );
    expect(within(cell).queryByTestId("currently-active-indicator")).toBeNull();
  });

  test("the row in effect's duration counts up every second", async () => {
    await renderPage(page);

    const cell: HTMLElement = renderCell(columnTitled("Duration"), LIVE_ROW);
    const timer: HTMLElement = within(cell).getByRole("timer");

    expect(timer).toHaveTextContent(/^2 mins 54 secs$/);
    expect(timer).toHaveAttribute("aria-live", "off");

    advance(500);
    expect(timer).toHaveTextContent(/^2 mins 55 secs$/);

    advance(1000);
    expect(timer).toHaveTextContent(/^2 mins 56 secs$/);

    advance(4000);
    expect(timer).toHaveTextContent(/^3 mins$/);
  });

  test("a finished row's duration is start to end, and still", async () => {
    await renderPage(page);

    const cell: HTMLElement = renderCell(
      columnTitled("Duration"),
      FINISHED_ROW,
    );

    expect(cell).toHaveTextContent(/^3 mins 46 secs$/);
    expect(within(cell).queryByRole("timer")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("the duration exports as a duration in the CSV", async () => {
    await renderPage(page);

    expect(columnTitled("Duration").getExportValue!(FINISHED_ROW)).toBe(
      "3 mins 46 secs",
    );
    expect(columnTitled("Duration").getExportValue!(LIVE_ROW)).toBe(
      "2 mins 54 secs",
    );
  });

  test("uses the shared columns: endsAt first, startsAt for the duration", async () => {
    await renderPage(page);

    expect(columnTitled(page.endsAtTitle).field).toEqual({ endsAt: true });
    expect(columnTitled("Duration").field).toEqual({
      endsAt: true,
      startsAt: true,
    });
  });

  test("no column still writes Currently Active as grey placeholder text", async () => {
    await renderPage(page);

    for (const column of recordedTableProps!.columns) {
      expect(column.noValueMessage).not.toBe("Currently Active");
    }
  });
});

describe("the six event and monitor timelines", () => {
  /*
   * A viewer's saved column layout is keyed by these ids (derived from the
   * primary field, then the title where two columns share a field). They
   * are the ids the hand-written columns had, so no layout is lost.
   */
  test.each(TIMELINE_PAGES.slice(0, 6))(
    "$name keeps its Ends At and Duration column ids",
    async (page: TimelinePage) => {
      await renderPage(page);

      const ids: Array<string> = getColumnIds(
        recordedTableProps!
          .columns as unknown as ModelTableColumns<IncidentStateTimeline>,
      );

      expect(ids).toContain("endsAt:ends-at");
      expect(ids).toContain("endsAt:duration");
    },
  );
});
