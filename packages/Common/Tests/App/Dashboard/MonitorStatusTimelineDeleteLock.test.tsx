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
 * A monitor's Status Timeline: what deleting a status event does, said
 * before anyone deletes one
 * ---------------------------------------------------------------------------
 *
 * Deleting one status event hands its time to the event before it. Two
 * deletes have no event to hand it to, and the server refuses them
 * (MonitorStatusEventDelete): the monitor's only event, and its oldest
 * while it covers part of the last 90 days. The page locks Delete on that
 * event before anyone clicks it, with the server's own refusal as its
 * tooltip - the same words a bulk Delete lists the event with, and the API
 * answers with - and leaves every other row's Delete as it was. Which event
 * that is, it reads from the monitor's two oldest events, oldest first - not
 * from the table's page, which shows the newest and may be filtered - each
 * time the table loads.
 *
 * Every other event can go, and its Delete dialog says which event it is
 * and what happens to the rest of the timeline, read from its neighbours
 * as the server reads them: the status before it becomes current again,
 * or takes over its time, or - an event that ended before anything a status
 * page draws - nothing anyone sees changes. Each row is named by its status
 * and start, not its id, wherever the table names a row.
 *
 * ModelTable is stubbed to record its props; ModelAPI to answer the reads.
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

interface Row {
  _id: string;
  startsAt?: Date;
  endsAt?: Date | null;
  monitorStatus?: { name: string };
}

interface DeleteConfirmationLike {
  title?: string;
  description: string | ReactElement;
}

interface RecordedTableProps {
  isDeleteable?: boolean;
  getDeleteDisabledReason?: (item: Row) => string | undefined;
  getDeleteConfirmation?: (item: Row) => Promise<DeleteConfirmationLike>;
  getItemName?: (item: Row) => string;
  onFetchSuccess?: (data: Array<unknown>, totalCount: number) => void;
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
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
}

type Answer = { data: Array<unknown>; count: number } | Error;

const listReads: Array<ListRead> = [];

/*
 * What each read gets: the lock's read of the two oldest events, the event
 * before a deleted one (sorted newest first, limit 1), and the event after
 * it (oldest first, limit 1, with a lower bound on startsAt).
 */
let lockAnswer: Answer = { data: [], count: 0 };
let beforeAnswer: Answer = { data: [], count: 0 };
let afterAnswer: Answer = { data: [], count: 0 };

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (read: ListRead): Promise<unknown> => {
        listReads.push(read);

        const answer: Answer =
          read.limit === 2
            ? lockAnswer
            : read.query["_id"] !== undefined
              ? beforeAnswer
              : afterAnswer;

        if (answer instanceof Error) {
          throw answer;
        }

        return { ...answer, skip: 0, limit: read.limit };
      },
      count: async (): Promise<number> => {
        return 0;
      },
    },
  };
});

import MonitorStatusTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/StatusTimeline";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import GreaterThan from "../../../Types/BaseDatabase/GreaterThan";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import {
  OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE,
  ONLY_STATUS_EVENT_MESSAGE,
} from "../../../Utils/Monitor/MonitorStatusEventDelete";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;
const WHITESPACE_RUN: RegExp = /\s+/g;

const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);

const OLDEST: string = "cccccccc-0000-4000-8000-000000000001";
const NEXT: string = "cccccccc-0000-4000-8000-000000000002";
const NEWEST: string = "cccccccc-0000-4000-8000-000000000003";

// The tooltip is the server's refusal, word for word.
const ONLY_EVENT_REASON: string = ONLY_STATUS_EVENT_MESSAGE;
const OLDEST_EVENT_REASON: string = OLDEST_STATUS_EVENT_IN_KEPT_HISTORY_MESSAGE;

const daysAgo: (days: number) => Date = (days: number): Date => {
  return new Date(NOW.getTime() - days * DAY_IN_MS);
};

// A start as the table's Starts At column shows it.
const shown: (date: Date) => string = (date: Date): string => {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date, false);
};

function event(
  id: string,
  startsAt: Date,
  endsAt: Date | null,
  statusName?: string,
): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = id;
  row.startsAt = startsAt;
  row.endsAt = endsAt as Date;
  if (statusName) {
    (row as unknown as Row).monitorStatus = { name: statusName };
  }
  return row;
}

async function renderPage(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <MonitorStatusTimelinePage
          pageRoute={new Route("/dashboard/monitor/status-timeline")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  expect(recordedTableProps).not.toBeNull();
}

// The table has loaded a page: the page reads which event to lock.
async function tableLoaded(): Promise<void> {
  await act(async (): Promise<void> => {
    recordedTableProps!.onFetchSuccess!([], 0);
  });
}

function reasonFor(id: string): string | undefined {
  return recordedTableProps!.getDeleteDisabledReason!({ _id: id });
}

// The Delete dialog's words for this row, as the dialog draws them.
async function confirmationFor(row: MonitorStatusTimeline): Promise<{
  text: string;
  bold: Array<string>;
}> {
  const confirmation: DeleteConfirmationLike = await recordedTableProps!
    .getDeleteConfirmation!(row as unknown as Row);

  const { container } = render(<div>{confirmation.description}</div>);

  // The dialog keeps its own title: "Delete Monitor Status Event".
  expect(confirmation.title).toBeUndefined();

  return {
    text: (container.textContent || "").replace(WHITESPACE_RUN, " ").trim(),
    bold: Array.from(container.querySelectorAll("strong")).map(
      (element: Element): string => {
        return element.textContent || "";
      },
    ),
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  recordedTableProps = null;
  listReads.length = 0;
  lockAnswer = { data: [], count: 0 };
  beforeAnswer = { data: [], count: 0 };
  afterAnswer = { data: [], count: 0 };
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(MONITOR_ID);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the monitor's Status Timeline locks the Delete the server refuses", () => {
  test("reads the monitor's two oldest events, oldest first, whenever the table loads", async () => {
    await renderPage();

    expect(listReads).toEqual([]);

    await tableLoaded();
    await tableLoaded();

    expect(listReads.length).toBe(2);
    expect(listReads[0]!.modelType).toBe(MonitorStatusTimeline);
    expect(listReads[0]!.query).toEqual({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });
    expect(listReads[0]!.limit).toBe(2);
    expect(listReads[0]!.skip).toBe(0);
    expect(listReads[0]!.sort).toEqual({ startsAt: SortOrder.Ascending });
  });

  test("locks Delete on the only event, saying why in the server's words", async () => {
    lockAnswer = { data: [event(OLDEST, daysAgo(365), null)], count: 1 };

    await renderPage();
    await tableLoaded();

    expect(recordedTableProps!.isDeleteable).toBe(true);
    expect(reasonFor(OLDEST)).toBe(ONLY_EVENT_REASON);
  });

  test("locks Delete on the oldest event while it covers part of the last 90 days, and on no other", async () => {
    lockAnswer = {
      data: [
        event(OLDEST, daysAgo(365), daysAgo(20)),
        event(NEXT, daysAgo(20), daysAgo(1)),
      ],
      count: 3,
    };

    await renderPage();
    await tableLoaded();

    expect(reasonFor(OLDEST)).toBe(OLDEST_EVENT_REASON);
    expect(reasonFor(NEXT)).toBeUndefined();
    expect(reasonFor(NEWEST)).toBeUndefined();
  });

  test("says what to do instead, in both refusals", () => {
    expect(ONLY_EVENT_REASON).toContain("add a new status event");
    expect(OLDEST_EVENT_REASON).toContain(
      "add a status event that starts before it, then delete this one",
    );
  });

  test("matches the event whatever case its id is written in", async () => {
    lockAnswer = { data: [event(OLDEST, daysAgo(365), null)], count: 1 };

    await renderPage();
    await tableLoaded();

    expect(reasonFor(OLDEST.toUpperCase())).toBe(ONLY_EVENT_REASON);
  });

  test("locks nothing once the oldest event ended before the last 90 days", async () => {
    lockAnswer = {
      data: [
        event(OLDEST, daysAgo(365), daysAgo(100)),
        event(NEXT, daysAgo(100), null),
      ],
      count: 2,
    };

    await renderPage();
    await tableLoaded();

    expect(reasonFor(OLDEST)).toBeUndefined();
    expect(reasonFor(NEXT)).toBeUndefined();
  });

  test("follows the timeline as it changes: a new event unlocks the only one", async () => {
    lockAnswer = { data: [event(OLDEST, daysAgo(1), null)], count: 1 };

    await renderPage();
    await tableLoaded();
    expect(reasonFor(OLDEST)).toBe(ONLY_EVENT_REASON);

    // A second event, inside the last 90 days: the first is now the oldest, still locked.
    lockAnswer = {
      data: [
        event(OLDEST, daysAgo(1), daysAgo(0.5)),
        event(NEXT, daysAgo(0.5), null),
      ],
      count: 2,
    };
    await tableLoaded();
    expect(reasonFor(OLDEST)).toBe(OLDEST_EVENT_REASON);
  });

  test("locks nothing when the read fails: the server still refuses, saying why", async () => {
    lockAnswer = new Error("offline");

    await renderPage();
    await tableLoaded();

    expect(reasonFor(OLDEST)).toBeUndefined();
  });
});

describe("each status event is named by its status and start, never its id", () => {
  test("wherever the table names a row: its checkbox and menu, and a bulk Delete's lists", async () => {
    await renderPage();

    const name: string = recordedTableProps!.getItemName!(
      event(NEXT, daysAgo(20), daysAgo(1), "Offline") as unknown as Row,
    );

    expect(name).toBe(`Offline (${shown(daysAgo(20))})`);
    expect(name).not.toContain(NEXT);
  });

  test("an event whose status was not read is named by its start alone", async () => {
    await renderPage();

    expect(
      recordedTableProps!.getItemName!(
        event(NEXT, daysAgo(20), null) as unknown as Row,
      ),
    ).toBe(shown(daysAgo(20)));
  });
});

describe("the Delete dialog says what deleting the event does", () => {
  test("reads the event before it and the event after it, as the server does", async () => {
    await renderPage();

    const middle: MonitorStatusTimeline = event(
      NEXT,
      daysAgo(20),
      daysAgo(1),
      "Offline",
    );

    beforeAnswer = {
      data: [event(OLDEST, daysAgo(365), daysAgo(20), "Operational")],
      count: 1,
    };
    afterAnswer = { data: [event(NEWEST, daysAgo(1), null)], count: 1 };

    await confirmationFor(middle);

    const before: ListRead = listReads.find((read: ListRead) => {
      return read.query["_id"] !== undefined;
    })!;
    const after: ListRead = listReads.find((read: ListRead) => {
      return read.limit === 1 && read.query["_id"] === undefined;
    })!;

    // The latest other event that starts at or before it.
    expect(before.query["monitorId"]).toEqual(MONITOR_ID);
    expect(before.query["projectId"]).toEqual(PROJECT_ID);
    expect(before.query["startsAt"]).toBeInstanceOf(LessThanOrEqual);
    expect((before.query["startsAt"] as LessThanOrEqual<Date>).value).toEqual(
      daysAgo(20),
    );
    expect(before.query["_id"]).toBeInstanceOf(NotEqual);
    expect((before.query["_id"] as NotEqual<string>).value).toBe(NEXT);
    expect(before.sort).toEqual({ startsAt: SortOrder.Descending });
    expect(before.limit).toBe(1);
    expect(before.select["monitorStatus"]).toEqual({ name: true });

    // The first event that starts after it.
    expect(after.query["monitorId"]).toEqual(MONITOR_ID);
    expect(after.query["startsAt"]).toBeInstanceOf(GreaterThan);
    expect((after.query["startsAt"] as GreaterThan<Date>).value).toEqual(
      daysAgo(20),
    );
    expect(after.sort).toEqual({ startsAt: SortOrder.Ascending });
    expect(after.limit).toBe(1);
  });

  test("the newest event: the status before it becomes the monitor's current status again", async () => {
    await renderPage();

    beforeAnswer = {
      data: [event(NEXT, daysAgo(20), daysAgo(1), "Offline")],
      count: 1,
    };
    afterAnswer = { data: [], count: 0 };

    const confirmation: { text: string; bold: Array<string> } =
      await confirmationFor(event(NEWEST, daysAgo(1), null, "Operational"));

    expect(confirmation.text).toBe(
      `Are you sure you want to delete the Operational status event that started ${shown(daysAgo(1))}? Offline, the status before it, becomes the monitor's current status again. This action cannot be undone.`,
    );
    expect(confirmation.bold).toEqual([
      "Operational",
      shown(daysAgo(1)),
      "Offline",
    ]);
  });

  test("an event in the middle: the status before it takes over its time", async () => {
    await renderPage();

    beforeAnswer = {
      data: [event(OLDEST, daysAgo(365), daysAgo(20), "Operational")],
      count: 1,
    };
    afterAnswer = { data: [event(NEWEST, daysAgo(1), null)], count: 1 };

    const confirmation: { text: string; bold: Array<string> } =
      await confirmationFor(event(NEXT, daysAgo(20), daysAgo(1), "Offline"));

    expect(confirmation.text).toBe(
      `Are you sure you want to delete the Offline status event that started ${shown(daysAgo(20))}? Operational, the status before it, takes over its time. This action cannot be undone.`,
    );
  });

  test("the oldest event, over before the last 90 days: no status page shows it any more", async () => {
    await renderPage();

    beforeAnswer = { data: [], count: 0 };
    afterAnswer = { data: [event(NEXT, daysAgo(120), null)], count: 1 };

    const confirmation: { text: string; bold: Array<string> } =
      await confirmationFor(
        event(OLDEST, daysAgo(400), daysAgo(120), "Operational"),
      );

    expect(confirmation.text).toBe(
      `Are you sure you want to delete the Operational status event that started ${shown(daysAgo(400))}? It ended more than 90 days ago, so status pages no longer show it. This action cannot be undone.`,
    );
  });

  test("when its neighbours can't be read, it only asks: the server still decides", async () => {
    await renderPage();

    beforeAnswer = new Error("offline");

    const confirmation: { text: string; bold: Array<string> } =
      await confirmationFor(event(NEXT, daysAgo(20), daysAgo(1), "Offline"));

    expect(confirmation.text).toBe(
      `Are you sure you want to delete the Offline status event that started ${shown(daysAgo(20))}? This action cannot be undone.`,
    );
  });

  test("an event that became the only one since the table loaded says why it can't go, instead of asking", async () => {
    await renderPage();

    beforeAnswer = { data: [], count: 0 };
    afterAnswer = { data: [], count: 0 };

    await expect(
      recordedTableProps!.getDeleteConfirmation!(
        event(OLDEST, daysAgo(10), null, "Operational") as unknown as Row,
      ),
    ).rejects.toThrow(ONLY_EVENT_REASON);
  });

  test("the oldest event, still in the last 90 days, says why it can't go", async () => {
    await renderPage();

    beforeAnswer = { data: [], count: 0 };
    afterAnswer = { data: [event(NEXT, daysAgo(20), null)], count: 1 };

    await expect(
      recordedTableProps!.getDeleteConfirmation!(
        event(
          OLDEST,
          daysAgo(365),
          daysAgo(20),
          "Operational",
        ) as unknown as Row,
      ),
    ).rejects.toThrow(OLDEST_EVENT_REASON);
  });
});
