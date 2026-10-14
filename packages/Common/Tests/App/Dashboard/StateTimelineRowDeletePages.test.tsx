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
import { act, cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * ---------------------------------------------------------------------------
 * An incident's, alert's, scheduled maintenance event's or episode's Status
 * Timeline: deleting one state, said before anyone clicks
 * ---------------------------------------------------------------------------
 *
 * Each of the five pages hands its ModelTable what useStateTimelineRowDelete
 * gives it - what the monitor's page does for its status events
 * (MonitorStatusTimelineDeleteLock):
 *
 *   - the record's only state has its Delete locked, with the server's own
 *     refusal as its reason (ONLY_STATE_DELETE_MESSAGES);
 *   - a row is named by its state and when it began, never its id;
 *   - each Delete dialog names the state and its start and says what deleting
 *     it does: the state before it becomes current again (the newest), takes
 *     over its time (one in the middle), or only the question (the oldest);
 *     one that has become the only state since the table loaded says why it
 *     can't go, instead of asking;
 *   - a bulk Delete says the rule.
 *
 * ModelTable is stubbed to record its props; ModelAPI answers from an
 * in-memory timeline, and only reads of this record, in this project, by the
 * page's own record column - so a page wired to the wrong column reads
 * nothing and locks nothing.
 */

// The reader's language, when a test sets one: English text -> theirs.
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
  startsAt: Date;
  endsAt: Date | null;
  [state: string]: unknown;
}

interface DeleteConfirmationLike {
  title?: string;
  description: string | ReactElement;
}

interface RecordedTableProps {
  isDeleteable?: boolean;
  deleteConfirmationWarning?: string;
  getDeleteDisabledReason?: (item: TimelineRow) => string | undefined;
  getDeleteConfirmation?: (
    item: TimelineRow,
  ) => Promise<DeleteConfirmationLike>;
  getItemName?: (item: TimelineRow) => string;
  onFetchSuccess?: (data: Array<unknown>, totalCount: number) => void;
  singularName?: string;
  pluralName?: string;
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

interface ListRead {
  modelType: { name: string };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
}

const listReads: Array<ListRead> = [];

// The record's timeline, in any order; the column naming the record.
let timeline: Array<TimelineRow> = [];
let recordColumn: string = "";
let readsFail: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getList: async (read: ListRead): Promise<unknown> => {
        listReads.push(read);

        if (readsFail) {
          throw new Error("offline");
        }

        const ofThisRecord: boolean =
          String(read.query[recordColumn]) === RECORD_ID.toString() &&
          String(read.query["projectId"]) === PROJECT_ID.toString();

        let rows: Array<TimelineRow> = ofThisRecord ? [...timeline] : [];

        const startsAt: unknown = read.query["startsAt"];

        if (startsAt instanceof LessThanOrEqual) {
          const bound: number = new Date(startsAt.value as Date).getTime();
          rows = rows.filter((row: TimelineRow): boolean => {
            return row.startsAt.getTime() <= bound;
          });
        } else if (startsAt instanceof GreaterThan) {
          const bound: number = new Date(startsAt.value as Date).getTime();
          rows = rows.filter((row: TimelineRow): boolean => {
            return row.startsAt.getTime() > bound;
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

import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  ONLY_STATE_DELETE_MESSAGES,
  StateTimelineRecord,
} from "../../../Utils/StateTimeline/StateTimelineRowDelete";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import {
  PREVIOUS_STATE_TAKES_OVER,
  STATE_ROW_DELETE_QUESTION,
  STATE_TIMELINE_DELETE_WORDS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StateTimeline/StateTimelineRowDelete";
import IncidentStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/StateTimeline";
import AlertStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/StateTimeline";
import ScheduledMaintenanceStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/View/StateTimeline";
import IncidentEpisodeStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/EpisodeView/StateTimeline";
import AlertEpisodeStateTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/EpisodeView/StateTimeline";

const WHITESPACE_RUN: RegExp = /\s+/g;

const RECORD_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-0000000000ff",
);

interface PageProps {
  pageRoute: Route;
  currentProject: null;
  hasPaymentMethod: boolean;
}

interface PageCase {
  name: string;
  page: (props: PageProps) => ReactElement;
  modelType: { name: string };
  record: StateTimelineRecord;
  recordColumn: string;
  stateColumn: string;
}

const PAGES: Array<PageCase> = [
  {
    name: "an incident's Status Timeline",
    page: IncidentStateTimelinePage as unknown as PageCase["page"],
    modelType: IncidentStateTimeline,
    record: StateTimelineRecord.Incident,
    recordColumn: "incidentId",
    stateColumn: "incidentState",
  },
  {
    name: "an alert's Status Timeline",
    page: AlertStateTimelinePage as unknown as PageCase["page"],
    modelType: AlertStateTimeline,
    record: StateTimelineRecord.Alert,
    recordColumn: "alertId",
    stateColumn: "alertState",
  },
  {
    name: "a scheduled maintenance event's Status Timeline",
    page: ScheduledMaintenanceStateTimelinePage as unknown as PageCase["page"],
    modelType: ScheduledMaintenanceStateTimeline,
    record: StateTimelineRecord.ScheduledMaintenance,
    recordColumn: "scheduledMaintenanceId",
    stateColumn: "scheduledMaintenanceState",
  },
  {
    name: "an incident episode's Status Timeline",
    page: IncidentEpisodeStateTimelinePage as unknown as PageCase["page"],
    modelType: IncidentEpisodeStateTimeline,
    record: StateTimelineRecord.IncidentEpisode,
    recordColumn: "incidentEpisodeId",
    stateColumn: "incidentState",
  },
  {
    name: "an alert episode's Status Timeline",
    page: AlertEpisodeStateTimelinePage as unknown as PageCase["page"],
    modelType: AlertEpisodeStateTimeline,
    record: StateTimelineRecord.AlertEpisode,
    recordColumn: "alertEpisodeId",
    stateColumn: "alertState",
  },
];

const AT_ONE: Date = new Date("2026-10-01T10:00:00.000Z");
const AT_TWO: Date = new Date("2026-10-01T11:00:00.000Z");
const AT_THREE: Date = new Date("2026-10-01T12:00:00.000Z");

const ROW_ONE: string = "7b000000-0000-4000-8000-0000000000a1";
const ROW_TWO: string = "7b000000-0000-4000-8000-0000000000a2";
const ROW_THREE: string = "7b000000-0000-4000-8000-0000000000a3";

type StateRowFunction = (
  pageCase: PageCase,
  id: string,
  state: string,
  startsAt: Date,
  endsAt: Date | null,
) => TimelineRow;

const stateRow: StateRowFunction = (
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

// Created -> Acknowledged -> Resolved, the last one current.
const threeStates: (pageCase: PageCase) => Array<TimelineRow> = (
  pageCase: PageCase,
): Array<TimelineRow> => {
  return [
    stateRow(pageCase, ROW_ONE, "Created", AT_ONE, AT_TWO),
    stateRow(pageCase, ROW_TWO, "Acknowledged", AT_TWO, AT_THREE),
    stateRow(pageCase, ROW_THREE, "Resolved", AT_THREE, null),
  ];
};

// A start as the table's Starts At column shows it.
const shown: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, false);
};

const fill: (template: string, values: Record<string, string>) => string = (
  template: string,
  values: Record<string, string>,
): string => {
  let text: string = template;
  for (const [key, value] of Object.entries(values)) {
    text = text.split(`{{${key}}}`).join(value);
  }
  return text;
};

const renderPage: (pageCase: PageCase) => Promise<void> = async (
  pageCase: PageCase,
): Promise<void> => {
  const Page: PageCase["page"] = pageCase.page;

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <Page
          pageRoute={new Route("/dashboard/status-timeline")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  expect(recordedTableProps).not.toBeNull();
};

// The table has loaded a page: the page reads which row is the only one.
const tableLoaded: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    recordedTableProps!.onFetchSuccess!([], 0);
  });
};

interface DrawnConfirmation {
  // Everything the dialog says, as one line.
  text: string;
  bold: Array<string>;
  /*
   * What deleting it does, drawn as a paragraph of its own under the
   * question: its text and its classes. Null when the dialog only asks.
   */
  effect: { text: string; className: string } | null;
  // The classes of the bolded start, which is kept on one line.
  startsAtClassName: string;
}

const readText: (element: Element | null) => string = (
  element: Element | null,
): string => {
  return (element?.textContent || "").replace(WHITESPACE_RUN, " ").trim();
};

// The Delete dialog's words for this row, as the dialog draws them.
const confirmationFor: (
  row: TimelineRow,
) => Promise<DrawnConfirmation> = async (
  row: TimelineRow,
): Promise<DrawnConfirmation> => {
  const confirmation: DeleteConfirmationLike =
    await recordedTableProps!.getDeleteConfirmation!(row);

  // The dialog keeps its own title.
  expect(confirmation.title).toBeUndefined();

  const { container } = render(<div>{confirmation.description}</div>);

  const effect: Element | null = container.querySelector(
    '[data-testid="state-row-delete-effect"]',
  );

  return {
    text: readText(container),
    bold: Array.from(container.querySelectorAll("strong")).map(
      (element: Element): string => {
        return element.textContent || "";
      },
    ),
    effect: effect
      ? { text: readText(effect), className: effect.className }
      : null,
    startsAtClassName:
      container.querySelector('[data-testid="delete-confirmation-starts-at"]')
        ?.className || "",
  };
};

beforeEach(() => {
  mockTranslations = {};
  recordedTableProps = null;
  listReads.length = 0;
  timeline = [];
  recordColumn = "";
  readsFail = false;
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RECORD_ID);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(PAGES)("$name", (pageCase: PageCase) => {
  beforeEach(() => {
    recordColumn = pageCase.recordColumn;
  });

  /*
   * The Delete dialog's title, a bulk Delete's and its result, the selection
   * bar and the Create button name one row: a state change, not the model's
   * "Incident State Timeline", which is the whole history.
   */
  test("calls its rows state changes", async () => {
    await renderPage(pageCase);

    expect(recordedTableProps!.singularName).toBe("State Change");
    expect(recordedTableProps!.pluralName).toBe("State Changes");
  });

  test("reads the record's oldest state, in this project, whenever the table loads", async () => {
    await renderPage(pageCase);

    expect(listReads).toEqual([]);

    await tableLoaded();
    await tableLoaded();

    expect(listReads.length).toBe(2);
    expect(listReads[0]!.modelType).toBe(pageCase.modelType);
    expect(listReads[0]!.query).toEqual({
      [pageCase.recordColumn]: RECORD_ID,
      projectId: PROJECT_ID,
    });
    expect(listReads[0]!.limit).toBe(1);
    expect(listReads[0]!.sort).toEqual({ startsAt: SortOrder.Ascending });
  });

  test("locks Delete on the record's only state, saying why in the server's words", async () => {
    timeline = [stateRow(pageCase, ROW_ONE, "Created", AT_ONE, null)];

    await renderPage(pageCase);
    await tableLoaded();

    expect(recordedTableProps!.isDeleteable).toBe(true);
    expect(recordedTableProps!.getDeleteDisabledReason!(timeline[0]!)).toBe(
      ONLY_STATE_DELETE_MESSAGES[pageCase.record],
    );
    // Whatever case its id is written in.
    expect(
      recordedTableProps!.getDeleteDisabledReason!({
        ...timeline[0]!,
        _id: ROW_ONE.toUpperCase(),
      }),
    ).toBe(ONLY_STATE_DELETE_MESSAGES[pageCase.record]);
  });

  test("locks nothing while the record has more than one state", async () => {
    timeline = threeStates(pageCase);

    await renderPage(pageCase);
    await tableLoaded();

    for (const row of timeline) {
      expect(recordedTableProps!.getDeleteDisabledReason!(row)).toBeUndefined();
    }
  });

  test("follows the timeline as it changes: a new state unlocks the only one", async () => {
    timeline = [stateRow(pageCase, ROW_ONE, "Created", AT_ONE, null)];

    await renderPage(pageCase);
    await tableLoaded();
    expect(
      recordedTableProps!.getDeleteDisabledReason!(timeline[0]!),
    ).toBeDefined();

    timeline = [
      stateRow(pageCase, ROW_ONE, "Created", AT_ONE, AT_TWO),
      stateRow(pageCase, ROW_TWO, "Acknowledged", AT_TWO, null),
    ];
    await tableLoaded();

    expect(
      recordedTableProps!.getDeleteDisabledReason!(timeline[0]!),
    ).toBeUndefined();
  });

  test("locks nothing when the read fails: the server still refuses, saying why", async () => {
    timeline = [stateRow(pageCase, ROW_ONE, "Created", AT_ONE, null)];
    readsFail = true;

    await renderPage(pageCase);
    await tableLoaded();

    expect(
      recordedTableProps!.getDeleteDisabledReason!(timeline[0]!),
    ).toBeUndefined();
  });

  test("names a row by its state and when it began, never its id", async () => {
    await renderPage(pageCase);

    const row: TimelineRow = stateRow(
      pageCase,
      ROW_TWO,
      "Acknowledged",
      AT_TWO,
      AT_THREE,
    );
    const name: string = recordedTableProps!.getItemName!(row);

    expect(name).toBe(`Acknowledged (${shown(AT_TWO)})`);
    expect(name).not.toContain(ROW_TWO);
  });

  test("the newest state: the one before it becomes current again, said in a paragraph of its own", async () => {
    timeline = threeStates(pageCase);

    await renderPage(pageCase);

    const confirmation: DrawnConfirmation = await confirmationFor(timeline[2]!);

    const effect: string = fill(
      STATE_TIMELINE_DELETE_WORDS[pageCase.record].previousIsCurrentAgain,
      { state: "Acknowledged" },
    );

    // The question and that it cannot be undone, then what it does.
    expect(confirmation.text).toBe(
      [
        fill(STATE_ROW_DELETE_QUESTION, {
          state: "Resolved",
          startsAt: shown(AT_THREE),
        }),
        "This action cannot be undone.",
        effect,
      ].join(" "),
    );
    expect(confirmation.effect?.text).toBe(effect);
    expect(confirmation.effect?.className.split(" ")).toEqual(
      expect.arrayContaining(["block", "mt-3"]),
    );
    expect(confirmation.bold).toEqual([
      "Resolved",
      shown(AT_THREE),
      "Acknowledged",
    ]);
  });

  test("a state in the middle: the one before it takes over its time, said in a paragraph of its own", async () => {
    timeline = threeStates(pageCase);

    await renderPage(pageCase);

    const confirmation: DrawnConfirmation = await confirmationFor(timeline[1]!);

    const effect: string = fill(PREVIOUS_STATE_TAKES_OVER, {
      state: "Created",
    });

    expect(confirmation.text).toBe(
      [
        fill(STATE_ROW_DELETE_QUESTION, {
          state: "Acknowledged",
          startsAt: shown(AT_TWO),
        }),
        "This action cannot be undone.",
        effect,
      ].join(" "),
    );
    expect(confirmation.effect?.text).toBe(effect);
  });

  test("the oldest state: only the question", async () => {
    timeline = threeStates(pageCase);

    await renderPage(pageCase);

    const confirmation: DrawnConfirmation = await confirmationFor(timeline[0]!);

    expect(confirmation.text).toBe(
      `${fill(STATE_ROW_DELETE_QUESTION, {
        state: "Created",
        startsAt: shown(AT_ONE),
      })} This action cannot be undone.`,
    );
    expect(confirmation.effect).toBeNull();
  });

  test("keeps when the state began on one line: a date broken after its month read as two things", async () => {
    timeline = threeStates(pageCase);

    await renderPage(pageCase);

    const confirmation: DrawnConfirmation = await confirmationFor(timeline[2]!);

    expect(confirmation.startsAtClassName.split(" ")).toContain(
      "whitespace-nowrap",
    );
  });

  test("one that has become the only state says why it can't go, instead of asking", async () => {
    timeline = threeStates(pageCase);

    await renderPage(pageCase);
    await tableLoaded();

    const row: TimelineRow = timeline[1]!;

    // The other two were deleted since the table loaded.
    timeline = [row];

    await expect(
      recordedTableProps!.getDeleteConfirmation!(row),
    ).rejects.toThrow(ONLY_STATE_DELETE_MESSAGES[pageCase.record]);
  });

  test("when its neighbours can't be read, the dialog only asks", async () => {
    timeline = threeStates(pageCase);
    readsFail = true;

    await renderPage(pageCase);

    const confirmation: DrawnConfirmation = await confirmationFor(timeline[2]!);

    expect(confirmation.text).toBe(
      `${fill(STATE_ROW_DELETE_QUESTION, {
        state: "Resolved",
        startsAt: shown(AT_THREE),
      })} This action cannot be undone.`,
    );
    expect(confirmation.effect).toBeNull();
  });

  test("a bulk Delete says the rule", async () => {
    await renderPage(pageCase);

    expect(recordedTableProps!.deleteConfirmationWarning).toBe(
      STATE_TIMELINE_DELETE_WORDS[pageCase.record].bulkWarning,
    );
  });
});

describe("in the reader's language", () => {
  const pageCase: PageCase = PAGES[0]!;

  beforeEach(() => {
    recordColumn = pageCase.recordColumn;
  });

  test("a built-in state is named as its pill shows it, and the lock and the dialog are translated", async () => {
    const reason: string = ONLY_STATE_DELETE_MESSAGES[pageCase.record];
    mockTranslations = {
      Acknowledged: "Bestätigt",
      Created: "Erstellt",
      [reason]: "Der einzige Status eines Vorfalls kann nicht gelöscht werden.",
      [PREVIOUS_STATE_TAKES_OVER]:
        "{{state}}, der Status davor, übernimmt seine Zeit.",
    };

    timeline = [stateRow(pageCase, ROW_ONE, "Created", AT_ONE, null)];

    await renderPage(pageCase);
    await tableLoaded();

    expect(recordedTableProps!.getDeleteDisabledReason!(timeline[0]!)).toBe(
      "Der einzige Status eines Vorfalls kann nicht gelöscht werden.",
    );

    timeline = threeStates(pageCase);

    expect(recordedTableProps!.getItemName!(timeline[1]!)).toBe(
      `Bestätigt (${shown(AT_TWO)})`,
    );

    const confirmation: DrawnConfirmation = await confirmationFor(timeline[1]!);

    expect(confirmation.effect?.text).toBe(
      "Erstellt, der Status davor, übernimmt seine Zeit.",
    );
    expect(confirmation.bold).toContain("Bestätigt");
    expect(confirmation.text).not.toContain("Acknowledged");
  });
});

describe("the words", () => {
  test.each(Object.values(StateTimelineRecord))(
    "%s: the page's lock says what the server refuses with, word for word",
    (record: StateTimelineRecord) => {
      expect(STATE_TIMELINE_DELETE_WORDS[record].onlyStateReason).toBe(
        ONLY_STATE_DELETE_MESSAGES[record],
      );
    },
  );

  test("every record whose history is a state timeline has its words", () => {
    expect(Object.keys(STATE_TIMELINE_DELETE_WORDS).sort()).toEqual(
      Object.values(StateTimelineRecord).sort(),
    );
  });

  test.each(Object.values(StateTimelineRecord))(
    "%s: a bulk Delete says the state before takes over, and that deleting the newest changes the current state",
    (record: StateTimelineRecord) => {
      const words: string = STATE_TIMELINE_DELETE_WORDS[record].bulkWarning;
      expect(words).toContain(
        "The state before each deleted state takes over its time",
      );
      expect(words).toContain("deleting the newest one changes the");
    },
  );
});
