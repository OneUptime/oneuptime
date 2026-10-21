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
import React, { ReactElement } from "react";
import {
  getStateTimelineDurationColumn,
  getStateTimelineDurationText,
  getStateTimelineEndsAtColumn,
  STATE_TIMELINE_DURATION_TITLE,
  STATE_TIMELINE_ENDS_AT_TITLE,
  StateTimelineModel,
} from "../../../../UI/Components/StateTimeline/StateTimelineColumns";
import ModelTableColumn from "../../../../UI/Components/ModelTable/Column";
import ModelTableColumns from "../../../../UI/Components/ModelTable/Columns";
import { getColumnIds } from "../../../../UI/Components/ModelTable/ColumnPreference";
import { getSelectFromColumns } from "../../../../UI/Components/ModelTable/SelectFromColumns";
import { PillSize } from "../../../../UI/Components/Pill/Pill";
import Table from "../../../../UI/Components/Table/Table";
import TableColumn from "../../../../UI/Components/Table/Types/Column";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableColumnsToCsv from "../../../../UI/Utils/TableColumnsToCsv";
import AlertEpisodeStateTimeline from "../../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import IncidentEpisodeStateTimeline from "../../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import MonitorStatusTimeline from "../../../../Models/DatabaseModels/MonitorStatusTimeline";
import NetworkSiteStatusTimeline from "../../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import ScheduledMaintenanceStateTimeline from "../../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";

/*
 * The Ends At and Duration columns every status and state timeline now takes
 * from one place. Pinned here: what they render for the row still in effect
 * and for a finished one, that they keep the column ids viewers' saved
 * layouts are keyed by, what they put in a CSV export, and - rendered through
 * the real Table - that the live duration ticks without re-rendering the
 * table around it.
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

const NOW: Date = new Date("2026-10-02T12:45:57.500Z");
const WHOLE_SECOND: Date = new Date("2026-10-02T12:45:57.000Z");

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(WHOLE_SECOND.getTime() - seconds * 1000);
};

type MakeRowFunction = (data: {
  id: string;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}) => IncidentStateTimeline;

const makeRow: MakeRowFunction = (data: {
  id: string;
  startsAt?: Date | undefined;
  endsAt?: Date | undefined;
}): IncidentStateTimeline => {
  const row: IncidentStateTimeline = new IncidentStateTimeline();
  row._id = data.id;

  if (data.startsAt) {
    row.startsAt = data.startsAt;
  }

  if (data.endsAt) {
    row.endsAt = data.endsAt;
  }

  return row;
};

// The newest row is the one in effect; the two before it have ended.
const LIVE_ROW: IncidentStateTimeline = makeRow({
  id: "11111111-1111-4111-8111-000000000001",
  startsAt: secondsAgo(174),
});

const FINISHED_ROW: IncidentStateTimeline = makeRow({
  id: "11111111-1111-4111-8111-000000000002",
  startsAt: secondsAgo(400),
  endsAt: secondsAgo(174),
});

const OLDEST_ROW: IncidentStateTimeline = makeRow({
  id: "11111111-1111-4111-8111-000000000003",
  startsAt: secondsAgo(4000),
  endsAt: secondsAgo(400),
});

function advance(milliseconds: number): void {
  act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

function renderCell(element: ReactElement): void {
  render(<div data-testid="cell">{element}</div>);
}

function cell(): HTMLElement {
  return screen.getByTestId("cell");
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("getStateTimelineEndsAtColumn", () => {
  const column: ModelTableColumn<IncidentStateTimeline> =
    getStateTimelineEndsAtColumn<IncidentStateTimeline>();

  test("is the Ends At column it replaces: same title, field and type", () => {
    expect(column.title).toBe("Ends At");
    expect(STATE_TIMELINE_ENDS_AT_TITLE).toBe("Ends At");
    expect(column.field).toEqual({ endsAt: true });
    // Still a DateTime underneath, for filtering, sorting and export.
    expect(column.type).toBe(FieldType.DateTime);
  });

  test("the row in effect gets the pulsing Currently Active marker", () => {
    renderCell(column.getElement!(LIVE_ROW));

    expect(
      within(cell()).getByTestId("currently-active-indicator"),
    ).toHaveTextContent(/^Currently Active$/);
    expect(within(cell()).getByTestId("pill-dot-pulse")).toHaveClass(
      "motion-safe:animate-ping",
    );
  });

  test("a finished row gets its end, written as the table writes a DateTime", () => {
    renderCell(column.getElement!(FINISHED_ROW));

    expect(cell()).toHaveTextContent(
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        FINISHED_ROW.endsAt!,
        false,
      ),
    );
    expect(within(cell()).queryByText("Currently Active")).toBeNull();
  });

  test("no longer relies on a grey noValueMessage", () => {
    expect(column.noValueMessage).toBeUndefined();
  });

  test("takes a page's own wording and pill size", () => {
    const untilColumn: ModelTableColumn<NetworkSiteStatusTimeline> =
      getStateTimelineEndsAtColumn<NetworkSiteStatusTimeline>({
        title: "Until",
        indicatorSize: PillSize.Small,
      });

    expect(untilColumn.title).toBe("Until");
    expect(untilColumn.field).toEqual({ endsAt: true });

    const row: NetworkSiteStatusTimeline = new NetworkSiteStatusTimeline();
    row.startsAt = secondsAgo(30);

    renderCell(untilColumn.getElement!(row));

    expect(within(cell()).getByTestId("pill")).toHaveStyle({
      fontSize: PillSize.Small,
    });
  });
});

describe("getStateTimelineDurationColumn", () => {
  const column: ModelTableColumn<IncidentStateTimeline> =
    getStateTimelineDurationColumn<IncidentStateTimeline>();

  test("is the Duration column it replaces: same title, primary field and type", () => {
    expect(column.title).toBe("Duration");
    expect(STATE_TIMELINE_DURATION_TITLE).toBe("Duration");
    // endsAt first, as before: it is the column's id and its sort key.
    expect(Object.keys(column.field)[0]).toBe("endsAt");
    expect(column.type).toBe(FieldType.Text);
  });

  test("declares startsAt too, which the duration cannot be worked out without", () => {
    expect(column.field).toEqual({ endsAt: true, startsAt: true });
  });

  test("the row in effect counts up every second", () => {
    renderCell(column.getElement!(LIVE_ROW));

    const timer: HTMLElement = within(cell()).getByRole("timer");

    expect(timer).toHaveTextContent(/^2 mins 54 secs$/);

    advance(500);
    expect(timer).toHaveTextContent(/^2 mins 55 secs$/);

    advance(1000);
    expect(timer).toHaveTextContent(/^2 mins 56 secs$/);
  });

  test("a finished row shows start to end, worded as it always was", () => {
    renderCell(column.getElement!(FINISHED_ROW));

    expect(cell()).toHaveTextContent(
      OneUptimeDate.differenceBetweenTwoDatesAsFromattedString(
        FINISHED_ROW.startsAt!,
        FINISHED_ROW.endsAt!,
      ),
    );
    expect(within(cell()).queryByRole("timer")).toBeNull();
  });

  test("exports the duration, not the end date its field holds", () => {
    expect(column.getExportValue!(FINISHED_ROW)).toBe("3 mins 46 secs");
    expect(column.getExportValue!(OLDEST_ROW)).toBe("1 hour");
  });

  test("exports the row in effect's duration as of the export", () => {
    expect(column.getExportValue!(LIVE_ROW)).toBe("2 mins 54 secs");

    act(() => {
      jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    });

    expect(column.getExportValue!(LIVE_ROW)).toBe("3 mins 54 secs");
  });

  test("takes a page's own wording", () => {
    expect(
      getStateTimelineDurationColumn<IncidentStateTimeline>({
        title: "How long",
      }).title,
    ).toBe("How long");
  });
});

describe("getStateTimelineDurationText", () => {
  test("a finished row: start to end, whatever now is", () => {
    expect(
      getStateTimelineDurationText(
        FINISHED_ROW,
        new Date("2030-01-01T00:00:00.000Z"),
      ),
    ).toBe("3 mins 46 secs");
  });

  test("the row in effect: start to the given now", () => {
    expect(
      getStateTimelineDurationText(
        LIVE_ROW,
        new Date(WHOLE_SECOND.getTime() + 6 * 1000),
      ),
    ).toBe("3 mins");
  });

  test("the row in effect: start to the current time when no now is given", () => {
    expect(getStateTimelineDurationText(LIVE_ROW)).toBe("2 mins 54 secs");
  });

  test("a row with no start exports nothing", () => {
    expect(getStateTimelineDurationText({})).toBe("");
  });
});

describe("on every timeline model", () => {
  type SelectForFunction = <TModel extends StateTimelineModel>(
    model: TModel,
  ) => Record<string, unknown>;

  const selectFor: SelectForFunction = <TModel extends StateTimelineModel>(
    model: TModel,
  ): Record<string, unknown> => {
    return getSelectFromColumns<TModel>({
      columns: [
        getStateTimelineEndsAtColumn<TModel>(),
        getStateTimelineDurationColumn<TModel>(),
      ],
      model: model,
    }) as Record<string, unknown>;
  };

  /*
   * Every model these columns are used with selects both fields, so neither
   * column can throw the table away in getSelectFromColumns (a primary field
   * the model lacks is a hard error there).
   */
  test.each([
    ["MonitorStatusTimeline", new MonitorStatusTimeline()],
    ["IncidentStateTimeline", new IncidentStateTimeline()],
    ["IncidentEpisodeStateTimeline", new IncidentEpisodeStateTimeline()],
    ["AlertStateTimeline", new AlertStateTimeline()],
    ["AlertEpisodeStateTimeline", new AlertEpisodeStateTimeline()],
    [
      "ScheduledMaintenanceStateTimeline",
      new ScheduledMaintenanceStateTimeline(),
    ],
    ["NetworkSiteStatusTimeline", new NetworkSiteStatusTimeline()],
  ])(
    "%s selects startsAt and endsAt",
    (_name: string, model: StateTimelineModel) => {
      const select: Record<string, unknown> = selectFor(model);

      expect(select["endsAt"]).toBe(true);
      expect(select["startsAt"]).toBe(true);
    },
  );
});

describe("viewers' saved column layouts", () => {
  /*
   * A layout is keyed by column id (ColumnPreference.getColumnIds), which is
   * derived from the primary field and, where two columns share one, the
   * title. The hand-written columns these replace had exactly these ids.
   */
  test("keep the ids the hand-written columns had", () => {
    const columns: ModelTableColumns<IncidentStateTimeline> = [
      {
        field: { incidentState: { name: true, color: true } },
        title: "Incident Status",
        type: FieldType.Text,
      },
      {
        field: { startsAt: true },
        title: "Starts At",
        type: FieldType.DateTime,
      },
      getStateTimelineEndsAtColumn<IncidentStateTimeline>(),
      getStateTimelineDurationColumn<IncidentStateTimeline>(),
    ];

    const before: ModelTableColumns<IncidentStateTimeline> = [
      columns[0]!,
      columns[1]!,
      {
        field: { endsAt: true },
        title: "Ends At",
        type: FieldType.DateTime,
        noValueMessage: "Currently Active",
      },
      { field: { endsAt: true }, title: "Duration", type: FieldType.Text },
    ];

    expect(getColumnIds(columns)).toEqual(getColumnIds(before));
    expect(getColumnIds(columns)).toEqual([
      "incidentState",
      "startsAt",
      "endsAt:ends-at",
      "endsAt:duration",
    ]);
  });
});

/*
 * The ModelTable hands Table its columns keyed by their primary field (see
 * BaseModelTable); the same is done here so the real Table and the CSV
 * exporter see what they see in the product.
 */
type ToTableColumnsFunction = (
  columns: ModelTableColumns<IncidentStateTimeline>,
) => Array<TableColumn<IncidentStateTimeline>>;

const toTableColumns: ToTableColumnsFunction = (
  columns: ModelTableColumns<IncidentStateTimeline>,
): Array<TableColumn<IncidentStateTimeline>> => {
  return columns.map(
    (
      column: ModelTableColumn<IncidentStateTimeline>,
    ): TableColumn<IncidentStateTimeline> => {
      return {
        title: column.title,
        type: column.type,
        key: Object.keys(column.field)[0] as keyof IncidentStateTimeline,
        getElement: column.getElement,
        getExportValue: column.getExportValue,
      };
    },
  );
};

describe("in a CSV export", () => {
  test("Ends At writes the end, or nothing for the row in effect; Duration writes the duration", () => {
    const csv: string = TableColumnsToCsv.convertToCsv<IncidentStateTimeline>({
      items: [LIVE_ROW, FINISHED_ROW],
      columns: toTableColumns([
        getStateTimelineEndsAtColumn<IncidentStateTimeline>(),
        getStateTimelineDurationColumn<IncidentStateTimeline>(),
      ]),
    });

    const lines: Array<string> = csv.split("\r\n");
    const finishedEnd: string =
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        FINISHED_ROW.endsAt!,
        false,
      );

    expect(lines[0]).toBe("Ends At,Duration");
    expect(lines[1]).toBe(",2 mins 54 secs");
    expect(lines[2]).toBe(
      `${TableColumnsToCsv.escapeCsvValue(finishedEnd)},3 mins 46 secs`,
    );
  });
});

describe("in a real table", () => {
  let statusCellRenders: number = 0;

  const statusColumn: ModelTableColumn<IncidentStateTimeline> = {
    field: { _id: true },
    title: "Incident Status",
    type: FieldType.Text,
    getElement: (): ReactElement => {
      statusCellRenders++;
      return <span>Identified</span>;
    },
  };

  type RenderTimelineFunction = (rows: Array<IncidentStateTimeline>) => void;

  const renderTimeline: RenderTimelineFunction = (
    rows: Array<IncidentStateTimeline>,
  ): void => {
    render(
      <Table<IncidentStateTimeline>
        id="state-timeline-table"
        data={rows}
        columns={toTableColumns([
          statusColumn,
          getStateTimelineEndsAtColumn<IncidentStateTimeline>(),
          getStateTimelineDurationColumn<IncidentStateTimeline>(),
        ])}
        currentPageNumber={1}
        totalItemsCount={rows.length}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="State Timeline"
        pluralLabel="State Timelines"
        sortOrder={SortOrder.Descending}
        sortBy={null}
        onSortChanged={() => {}}
        onNavigateToPage={() => {}}
      />,
    );
  };

  beforeEach(() => {
    statusCellRenders = 0;
  });

  test("marks only the row in effect as Currently Active", () => {
    renderTimeline([LIVE_ROW, FINISHED_ROW, OLDEST_ROW]);

    expect(screen.getAllByTestId("currently-active-indicator")).toHaveLength(1);
    expect(screen.getAllByRole("timer")).toHaveLength(1);
    expect(screen.getAllByTestId("state-timeline-ends-at")).toHaveLength(2);
  });

  test("its duration ticks every second while the rest of the table stands still", () => {
    renderTimeline([LIVE_ROW, FINISHED_ROW, OLDEST_ROW]);

    const rendersBeforeTicking: number = statusCellRenders;
    const timer: HTMLElement = screen.getByRole("timer");

    advance(500);
    expect(timer).toHaveTextContent(/^2 mins 55 secs$/);

    for (let tick: number = 0; tick < 5; tick++) {
      advance(1000);
    }
    expect(timer).toHaveTextContent(/^3 mins$/);

    // Six ticks, and not one of them re-rendered a row.
    expect(statusCellRenders).toBe(rendersBeforeTicking);

    // The finished rows never moved.
    expect(
      screen.getAllByTestId("state-timeline-duration")[1],
    ).toHaveTextContent(/^3 mins 46 secs$/);
    expect(
      screen.getAllByTestId("state-timeline-duration")[2],
    ).toHaveTextContent(/^1 hour$/);
  });

  test("a table of finished rows arms no timer at all", () => {
    renderTimeline([FINISHED_ROW, OLDEST_ROW]);

    expect(screen.queryByRole("timer")).toBeNull();
    expect(screen.queryByTestId("currently-active-indicator")).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });

  test("the timer goes when the table does", () => {
    /*
     * Unmounting the table schedules a couple of timers of its own; measured
     * first, with nothing live in it, so only the live row's is compared.
     */
    renderTimeline([FINISHED_ROW, OLDEST_ROW]);
    cleanup();
    const leftByTheTableItself: number = jest.getTimerCount();
    jest.clearAllTimers();

    renderTimeline([LIVE_ROW, FINISHED_ROW]);

    expect(jest.getTimerCount()).toBe(1);

    cleanup();

    expect(jest.getTimerCount()).toBe(leftByTheTableItself);
  });
});
