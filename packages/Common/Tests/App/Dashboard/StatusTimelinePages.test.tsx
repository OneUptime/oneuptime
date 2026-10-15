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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ---------------------------------------------------------------------------
 * Every status timeline page, as a timeline - and as the table it was
 * ---------------------------------------------------------------------------
 *
 * Seven pages show a record's status history: a monitor's, an incident's,
 * an alert's, a scheduled maintenance event's, the two kinds of episode's
 * and a network site's. Each opens on the shared timeline
 * (ModelStatusTimeline) and keeps its table one click away, through the
 * Timeline | Table switch in the card's header (StatusTimelineView).
 *
 * The timeline offers what the table did, with the same rules: the same
 * rows (this record's, in this project), the same Create form, Create and
 * Delete where the table had them, the same locked Delete with the server's
 * own refusal, the same Delete dialog naming the state and what deleting it
 * does, and - on an incident's and a maintenance event's - the subscriber
 * notification and its Retry. Those rules are read off each view and held
 * equal here, so a change to one view that the other did not get fails.
 *
 * ModelStatusTimeline and ModelTable are stubbed to record their props
 * (each is tested on its own); ModelAPI answers from an in-memory timeline.
 */

let mockTranslations: Record<string, string> = {};

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return mockTranslations[key] ?? opts?.defaultValue ?? key;
        },
      };
    },
  };
});

interface TimelineRow {
  _id: string;
  id?: { toString: () => string };
  startsAt: Date;
  endsAt: Date | null;
  [column: string]: unknown;
}

interface DeleteConfirmationLike {
  title?: string;
  description: string | ReactElement;
}

// What both views are handed: the props this suite reads.
interface RecordedProps {
  modelType: { name: string };
  query: Record<string, unknown>;
  isCreateable?: boolean;
  isDeleteable?: boolean;
  formFields?: Array<unknown>;
  onBeforeCreate?: (item: TimelineRow) => Promise<TimelineRow>;
  getDeleteDisabledReason?: (item: TimelineRow) => string | undefined;
  getDeleteConfirmation?: (
    item: TimelineRow,
  ) => Promise<DeleteConfirmationLike>;
  getItemName?: (item: TimelineRow) => string;
  deleteConfirmationWarning?: string;
  bulkActions?: { deleteConfirmationWarning?: string };
  onFetchSuccess?: (...args: Array<unknown>) => void;
  // The timeline's own.
  stateColumn?: string;
  stateSelect?: Record<string, unknown>;
  isFinalState?: (state: Record<string, unknown>) => boolean;
  defaultRange?: unknown;
  headerElement?: ReactElement;
  renderEntryDetails?: (
    item: TimelineRow,
    refresh: () => void,
  ) => ReactElement | null;
  refreshToggle?: string;
  selectMoreFields?: Record<string, unknown>;
  causeColumn?: string;
  logColumn?: string;
  // The table's own.
  cardProps?: { title?: string; rightElement?: ReactElement };
  selectMoreFieldsOfTable?: Record<string, unknown>;
}

let recordedTimelineProps: RecordedProps | null = null;
let recordedTableProps: RecordedProps | null = null;

jest.mock("../../../UI/Components/StatusTimeline/ModelStatusTimeline", () => {
  return {
    __esModule: true,
    default: (props: RecordedProps): ReactElement => {
      recordedTimelineProps = props;
      return React.createElement(
        "div",
        { "data-testid": "model-status-timeline" },
        props.headerElement || null,
      );
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: RecordedProps): ReactElement => {
      recordedTableProps = props;
      return React.createElement(
        "div",
        { "data-testid": "model-table" },
        props.cardProps?.rightElement || null,
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/SiteMaintenanceWindows",
  () => {
    const fetcher: () => Promise<Array<unknown>> = async (): Promise<
      Array<unknown>
    > => {
      return [];
    };

    return {
      __esModule: true,
      default: fetcher,
      fetchSiteMaintenanceWindows: fetcher,
    };
  },
);

interface ListRead {
  modelType: { name: string };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
}

const listReads: Array<ListRead> = [];
const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

// The record's timeline, in any order; the column naming the record.
let timeline: Array<TimelineRow> = [];
let recordColumn: string = "";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  const time: (value: unknown) => number = (value: unknown): number => {
    return new Date(value as Date).getTime();
  };

  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      updateById: async (data: {
        id: { toString: () => string };
        data: Record<string, unknown>;
      }): Promise<void> => {
        updates.push({ id: data.id.toString(), data: data.data });
      },
      getList: async (read: ListRead): Promise<unknown> => {
        listReads.push(read);

        const ofThisRecord: boolean =
          String(read.query[recordColumn]) === RECORD_ID.toString() &&
          (read.query["projectId"] === undefined ||
            String(read.query["projectId"]) === PROJECT_ID.toString());

        let rows: Array<TimelineRow> = ofThisRecord ? [...timeline] : [];

        const startsAt: unknown = read.query["startsAt"];

        if (startsAt instanceof LessThanOrEqual) {
          rows = rows.filter((row: TimelineRow): boolean => {
            return row.startsAt.getTime() <= time(startsAt.value);
          });
        } else if (startsAt instanceof GreaterThan) {
          rows = rows.filter((row: TimelineRow): boolean => {
            return row.startsAt.getTime() > time(startsAt.value);
          });
        }

        const id: unknown = read.query["_id"];

        if (id instanceof NotEqual) {
          rows = rows.filter((row: TimelineRow): boolean => {
            return row._id !== String(id.value);
          });
        }

        rows.sort((a: TimelineRow, b: TimelineRow): number => {
          return read.sort["startsAt"] === SortOrder.Descending
            ? b.startsAt.getTime() - a.startsAt.getTime()
            : a.startsAt.getTime() - b.startsAt.getTime();
        });

        return {
          data: rows.slice(read.skip, read.skip + read.limit),
          count: rows.length,
          skip: read.skip,
          limit: read.limit,
        };
      },
    },
  };
});

import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import TimeRange from "../../../Types/Time/TimeRange";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import Project from "../../../Models/DatabaseModels/Project";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateTimelineRecord,
} from "../../../Utils/StateTimeline/StateTimelineRowDelete";
import {
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
  ONLY_STATUS_EVENT_MESSAGE,
} from "../../../Utils/Monitor/MonitorStatusEventDelete";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import NetworkSiteStatusTimeline from "../../../Models/DatabaseModels/NetworkSiteStatusTimeline";
import MonitorStatusTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline";
import IncidentStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline";
import AlertStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/StateTimeline";
import ScheduledMaintenanceStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/StateTimeline";
import IncidentEpisodeStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/StateTimeline";
import AlertEpisodeStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/StateTimeline";
import NetworkSiteStatusTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/StatusTimeline";
import {
  forgetStatusTimelineView,
  showStatusTimelinesAsTable,
} from "../../Helpers/StatusTimelineViewChoice";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const WHITESPACE_RUN: RegExp = /\s+/g;

const RECORD_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-0000000000ff",
);

const daysAgo: (days: number) => Date = (days: number): Date => {
  return new Date(NOW.getTime() - days * DAY_IN_MS);
};

interface PageProps {
  pageRoute: Route;
  currentProject: Project | null;
  hasPaymentMethod: boolean;
}

interface PageCase {
  name: string;
  page: (props: PageProps) => ReactElement;
  modelType: { name: string };
  recordColumn: string;
  stateColumn: string;
  // The record's rows are of one project: the query says which.
  isProjectScoped: boolean;
  // A monitor's and a site's history grows for ever: a period, last month first.
  defaultRange: TimeRange | undefined;
  isCreateable: boolean;
  isDeleteable: boolean;
  // The row's cause and log, where the table had View Cause and View Logs.
  causeColumn: string | undefined;
  logColumn: string | undefined;
  // The subscriber notification under each state change.
  hasSubscriberNotification: boolean;
  /*
   * The record's only row, whose Delete is locked; for a monitor, also its
   * oldest while it covers part of the last 90 days.
   */
  onlyRowRefusal: string | undefined;
  /*
   * The states a record is done with: its band ends with its last change.
   * Undefined for a monitor and a site, which are never done.
   */
  finalStates: Array<Record<string, boolean>> | undefined;
}

const PAGES: Array<PageCase> = [
  {
    name: "a monitor's Status Timeline",
    page: MonitorStatusTimelinePage as unknown as PageCase["page"],
    modelType: MonitorStatusTimeline,
    recordColumn: "monitorId",
    stateColumn: "monitorStatus",
    isProjectScoped: true,
    defaultRange: TimeRange.PAST_ONE_MONTH,
    isCreateable: true,
    isDeleteable: true,
    causeColumn: "rootCause",
    logColumn: "statusChangeLog",
    hasSubscriberNotification: false,
    onlyRowRefusal: ONLY_STATUS_EVENT_MESSAGE,
    finalStates: undefined,
  },
  {
    name: "an incident's Status Timeline",
    page: IncidentStateTimelinePage as unknown as PageCase["page"],
    modelType: IncidentStateTimeline,
    recordColumn: "incidentId",
    stateColumn: "incidentState",
    isProjectScoped: true,
    defaultRange: undefined,
    isCreateable: true,
    isDeleteable: true,
    causeColumn: "rootCause",
    logColumn: "stateChangeLog",
    hasSubscriberNotification: true,
    onlyRowRefusal: ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.Incident],
    finalStates: [{ isResolvedState: true }],
  },
  {
    name: "an alert's Status Timeline",
    page: AlertStateTimelinePage as unknown as PageCase["page"],
    modelType: AlertStateTimeline,
    recordColumn: "alertId",
    stateColumn: "alertState",
    isProjectScoped: true,
    defaultRange: undefined,
    isCreateable: true,
    isDeleteable: true,
    causeColumn: "rootCause",
    logColumn: "stateChangeLog",
    hasSubscriberNotification: false,
    onlyRowRefusal: ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.Alert],
    finalStates: [{ isResolvedState: true }],
  },
  {
    name: "a scheduled maintenance event's Status Timeline",
    page: ScheduledMaintenanceStateTimelinePage as unknown as PageCase["page"],
    modelType: ScheduledMaintenanceStateTimeline,
    recordColumn: "scheduledMaintenanceId",
    stateColumn: "scheduledMaintenanceState",
    isProjectScoped: true,
    defaultRange: undefined,
    isCreateable: true,
    isDeleteable: true,
    causeColumn: undefined,
    logColumn: undefined,
    hasSubscriberNotification: true,
    onlyRowRefusal:
      ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.ScheduledMaintenance],
    finalStates: [{ isEndedState: true }, { isResolvedState: true }],
  },
  {
    name: "an incident episode's Status Timeline",
    page: IncidentEpisodeStateTimelinePage as unknown as PageCase["page"],
    modelType: IncidentEpisodeStateTimeline,
    recordColumn: "incidentEpisodeId",
    stateColumn: "incidentState",
    isProjectScoped: true,
    defaultRange: undefined,
    isCreateable: true,
    isDeleteable: true,
    causeColumn: undefined,
    logColumn: undefined,
    hasSubscriberNotification: false,
    onlyRowRefusal:
      ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.IncidentEpisode],
    finalStates: [{ isResolvedState: true }],
  },
  {
    name: "an alert episode's Status Timeline",
    page: AlertEpisodeStateTimelinePage as unknown as PageCase["page"],
    modelType: AlertEpisodeStateTimeline,
    recordColumn: "alertEpisodeId",
    stateColumn: "alertState",
    isProjectScoped: true,
    defaultRange: undefined,
    isCreateable: true,
    isDeleteable: true,
    causeColumn: undefined,
    logColumn: undefined,
    hasSubscriberNotification: false,
    onlyRowRefusal:
      ONLY_STATE_DELETE_MESSAGES[StateTimelineRecord.AlertEpisode],
    finalStates: [{ isResolvedState: true }],
  },
  {
    name: "a network site's Status Timeline",
    page: NetworkSiteStatusTimelinePage as unknown as PageCase["page"],
    modelType: NetworkSiteStatusTimeline,
    recordColumn: "siteId",
    stateColumn: "monitorStatus",
    isProjectScoped: false,
    defaultRange: TimeRange.PAST_ONE_MONTH,
    isCreateable: false,
    isDeleteable: false,
    causeColumn: undefined,
    logColumn: undefined,
    hasSubscriberNotification: false,
    onlyRowRefusal: undefined,
    finalStates: undefined,
  },
];

// The pages a row can be deleted from: both views hold it to the same rules.
const DELETABLE_PAGES: Array<PageCase> = PAGES.filter(
  (pageCase: PageCase): boolean => {
    return pageCase.isDeleteable;
  },
);

const SUBSCRIBER_PAGES: Array<PageCase> = PAGES.filter(
  (pageCase: PageCase): boolean => {
    return pageCase.hasSubscriberNotification;
  },
);

const ROW_ONE: string = "7c000000-0000-4000-8000-0000000000a1";
const ROW_TWO: string = "7c000000-0000-4000-8000-0000000000a2";
const ROW_THREE: string = "7c000000-0000-4000-8000-0000000000a3";

const stateRow: (
  pageCase: PageCase,
  id: string,
  state: string,
  startsAt: Date,
  endsAt: Date | null,
) => TimelineRow = (
  pageCase: PageCase,
  id: string,
  state: string,
  startsAt: Date,
  endsAt: Date | null,
): TimelineRow => {
  return {
    _id: id,
    startsAt,
    endsAt,
    [pageCase.stateColumn]: { name: state },
  };
};

/*
 * Three states, the last current. The first began 100 days ago and ended
 * 10 days ago: for a monitor, the oldest event while it covers part of the
 * last 90 days.
 */
const threeStates: (pageCase: PageCase) => Array<TimelineRow> = (
  pageCase: PageCase,
): Array<TimelineRow> => {
  return [
    stateRow(pageCase, ROW_ONE, "Created", daysAgo(100), daysAgo(10)),
    stateRow(pageCase, ROW_TWO, "Acknowledged", daysAgo(10), daysAgo(2)),
    stateRow(pageCase, ROW_THREE, "Resolved", daysAgo(2), null),
  ];
};

const onlyState: (pageCase: PageCase) => Array<TimelineRow> = (
  pageCase: PageCase,
): Array<TimelineRow> => {
  return [stateRow(pageCase, ROW_ONE, "Created", daysAgo(365), null)];
};

const renderPage: (pageCase: PageCase) => Promise<void> = async (
  pageCase: PageCase,
): Promise<void> => {
  const Page: PageCase["page"] = pageCase.page;
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Page
          pageRoute={new Route("/dashboard/status-timeline")}
          currentProject={project}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });
};

const readText: (element: Element | null) => string = (
  element: Element | null,
): string => {
  return (element?.textContent || "").replace(WHITESPACE_RUN, " ").trim();
};

enum View {
  Timeline = "timeline",
  Table = "table",
}

interface Decision {
  row: string;
  name: string;
  lockedBecause: string | undefined;
  // The Delete dialog's words, or the refusal said in its place.
  dialog: string;
}

/*
 * What a view decides about each row, read the way it is used: the view
 * has loaded (onFetchSuccess), then each row's name, its Delete's lock and
 * its Delete dialog.
 */
const decisionsOf: (
  pageCase: PageCase,
  view: View,
) => Promise<Array<Decision>> = async (
  pageCase: PageCase,
  view: View,
): Promise<Array<Decision>> => {
  cleanup();
  forgetStatusTimelineView();
  recordedTableProps = null;
  recordedTimelineProps = null;

  if (view === View.Table) {
    showStatusTimelinesAsTable();
  }

  await renderPage(pageCase);

  const recorded: () => RecordedProps = (): RecordedProps => {
    const props: RecordedProps | null =
      view === View.Table ? recordedTableProps : recordedTimelineProps;

    expect(props).not.toBeNull();

    return props!;
  };

  await act(async (): Promise<void> => {
    recorded().onFetchSuccess!([], 0);
  });

  const decisions: Array<Decision> = [];

  for (const row of timeline) {
    let dialog: string = "";

    try {
      const confirmation: DeleteConfirmationLike =
        await recorded().getDeleteConfirmation!(row);
      const { container, unmount } = render(
        <div>{confirmation.description}</div>,
      );
      dialog = readText(container);
      unmount();
    } catch (error) {
      dialog = `refused: ${(error as Error).message}`;
    }

    decisions.push({
      row: row._id,
      name: recorded().getItemName!(row),
      lockedBecause: recorded().getDeleteDisabledReason!(row),
      dialog: dialog,
    });
  }

  return decisions;
};

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockTranslations = {};
  recordedTableProps = null;
  recordedTimelineProps = null;
  listReads.length = 0;
  updates.length = 0;
  timeline = [];
  recordColumn = "";
  forgetStatusTimelineView();
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
  forgetStatusTimelineView();
});

describe.each(PAGES)("$name", (pageCase: PageCase) => {
  beforeEach(() => {
    recordColumn = pageCase.recordColumn;
  });

  test("opens on the timeline of this record's rows", async () => {
    await renderPage(pageCase);

    expect(screen.getByTestId("model-status-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("model-table")).toBeNull();

    const props: RecordedProps = recordedTimelineProps!;

    expect(props.modelType).toBe(pageCase.modelType);
    expect(props.stateColumn).toBe(pageCase.stateColumn);
    expect(props.query).toEqual(
      pageCase.isProjectScoped
        ? { [pageCase.recordColumn]: RECORD_ID, projectId: PROJECT_ID }
        : { [pageCase.recordColumn]: RECORD_ID },
    );
    expect(props.defaultRange).toBe(pageCase.defaultRange);
  });

  test("Table shows the table it was, the switch beside its title; Timeline brings the timeline back", async () => {
    await renderPage(pageCase);

    fireEvent.click(
      within(screen.getByTestId("model-status-timeline")).getByRole("button", {
        name: "Table",
      }),
    );

    expect(screen.queryByTestId("model-status-timeline")).toBeNull();
    expect(recordedTableProps!.modelType).toBe(pageCase.modelType);
    expect(recordedTableProps!.cardProps?.title).toBe("Status Timeline");

    const table: HTMLElement = screen.getByTestId("model-table");

    expect(
      within(table).getByRole("button", { name: "Table" }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(table).getByRole("button", { name: "Timeline" }));

    expect(screen.getByTestId("model-status-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("model-table")).toBeNull();
  });

  test("the timeline reads the rows the table read, and offers Create and Delete where the table did", async () => {
    await renderPage(pageCase);

    const timelineProps: RecordedProps = recordedTimelineProps!;

    cleanup();
    showStatusTimelinesAsTable();
    await renderPage(pageCase);

    const tableProps: RecordedProps = recordedTableProps!;

    expect(timelineProps.query).toEqual(tableProps.query);
    expect(Boolean(timelineProps.isCreateable)).toBe(pageCase.isCreateable);
    expect(Boolean(tableProps.isCreateable)).toBe(pageCase.isCreateable);
    expect(Boolean(timelineProps.isDeleteable)).toBe(pageCase.isDeleteable);
    expect(Boolean(tableProps.isDeleteable)).toBe(pageCase.isDeleteable);
    // One Create form for both: the same fields, in the same order.
    expect(timelineProps.formFields).toBe(tableProps.formFields);
    // View Cause and View Logs, where the table had them.
    expect(timelineProps.causeColumn).toBe(pageCase.causeColumn);
    expect(timelineProps.logColumn).toBe(pageCase.logColumn);
  });

  test("a record still open runs to now: the page says which states it is done in", async () => {
    await renderPage(pageCase);

    const props: RecordedProps = recordedTimelineProps!;

    if (!pageCase.finalStates) {
      // A monitor and a site are never done: they show a period instead.
      expect(props.isFinalState).toBeUndefined();
      return;
    }

    for (const flags of pageCase.finalStates) {
      // The flag is read with the state, and makes it final.
      for (const flag of Object.keys(flags)) {
        expect(props.stateSelect?.[flag]).toBe(true);
      }

      expect(props.isFinalState!({ name: "Done", ...flags })).toBe(true);
    }

    expect(props.isFinalState!({ name: "Acknowledged" })).toBe(false);
    expect(
      props.isFinalState!({ name: "Acknowledged", isResolvedState: false }),
    ).toBe(false);
  });

  if (pageCase.isCreateable) {
    test("a new row is made this record's, in this project, from either view", async () => {
      await renderPage(pageCase);

      const fromTimeline: TimelineRow = await recordedTimelineProps!
        .onBeforeCreate!({} as TimelineRow);

      expect(String(fromTimeline[pageCase.recordColumn])).toBe(
        RECORD_ID.toString(),
      );
      expect(String(fromTimeline["projectId"])).toBe(PROJECT_ID.toString());
    });
  }
});

describe.each(DELETABLE_PAGES)(
  "$name: Delete in the timeline is the table's Delete",
  (pageCase: PageCase) => {
    beforeEach(() => {
      recordColumn = pageCase.recordColumn;
    });

    test("the record's only row: locked, in the server's words, in both views", async () => {
      timeline = onlyState(pageCase);

      const inTable: Array<Decision> = await decisionsOf(pageCase, View.Table);
      const inTimeline: Array<Decision> = await decisionsOf(
        pageCase,
        View.Timeline,
      );

      expect(inTable[0]!.lockedBecause).toBe(pageCase.onlyRowRefusal);
      expect(inTimeline).toEqual(inTable);
    });

    test("three rows: the same names, locks and dialogs in both views", async () => {
      timeline = threeStates(pageCase);

      const inTable: Array<Decision> = await decisionsOf(pageCase, View.Table);
      const inTimeline: Array<Decision> = await decisionsOf(
        pageCase,
        View.Timeline,
      );

      // The dialogs say something of each row, so this is not vacuous.
      for (const decision of inTable) {
        expect(decision.dialog.length).toBeGreaterThan(0);
        expect(decision.name).not.toContain(decision.row);
      }

      // Deleting the current state makes the one before it current again.
      expect(inTable[2]!.dialog).toContain("Acknowledged");

      if (pageCase.modelType === MonitorStatusTimeline) {
        // The oldest event while it covers part of the last 90 days.
        expect(inTable[0]!.lockedBecause).toBe(
          OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
        );
      }

      expect(inTimeline).toEqual(inTable);
    });

    test("the timeline is handed the table's Delete rule, for a dialog the page does not word", async () => {
      await renderPage(pageCase);

      const timelineWarning: string | undefined =
        recordedTimelineProps!.deleteConfirmationWarning;

      cleanup();
      showStatusTimelinesAsTable();
      await renderPage(pageCase);

      const tableWarning: string | undefined =
        recordedTableProps!.bulkActions?.deleteConfirmationWarning ??
        recordedTableProps!.deleteConfirmationWarning;

      /*
       * The monitor's dialog says what deleting each event does instead
       * (getDeleteConfirmation): a bulk rule would repeat it.
       */
      if (pageCase.modelType !== MonitorStatusTimeline) {
        expect(timelineWarning).toBe(tableWarning);
      }
    });
  },
);

describe.each(SUBSCRIBER_PAGES)(
  "$name: the subscriber notification under each state change",
  (pageCase: PageCase) => {
    beforeEach(() => {
      recordColumn = pageCase.recordColumn;
    });

    test("reads it with the rows, says it under the entry, and Retry sends it again", async () => {
      await renderPage(pageCase);

      expect(recordedTimelineProps!.selectMoreFields).toEqual({
        subscriberNotificationStatus: true,
        subscriberNotificationStatusMessage: true,
      });

      const row: TimelineRow = {
        ...stateRow(pageCase, ROW_TWO, "Acknowledged", daysAgo(1), null),
        id: new ObjectID(ROW_TWO),
        subscriberNotificationStatus:
          StatusPageSubscriberNotificationStatus.Failed,
        subscriberNotificationStatusMessage: "SMTP server refused the message.",
      };
      const refreshBefore: string | undefined =
        recordedTimelineProps!.refreshToggle;

      render(
        <div data-testid="entry-details">
          {recordedTimelineProps!.renderEntryDetails!(row, () => {})}
        </div>,
      );

      const details: HTMLElement = screen.getByTestId("entry-details");

      expect(readText(details)).toContain("Status page subscribers:");
      expect(readText(details)).toContain("Failed");

      fireEvent.click(
        within(details).getByRole("button", { name: "more details" }),
      );

      await act(async (): Promise<void> => {
        fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      });

      expect(updates).toEqual([
        {
          id: ROW_TWO,
          data: {
            subscriberNotificationStatus:
              StatusPageSubscriberNotificationStatus.Pending,
            subscriberNotificationStatusMessage: null,
          },
        },
      ]);
      // The timeline reads its rows again, to show it pending.
      expect(recordedTimelineProps!.refreshToggle).not.toBe(refreshBefore);
    });
  },
);
