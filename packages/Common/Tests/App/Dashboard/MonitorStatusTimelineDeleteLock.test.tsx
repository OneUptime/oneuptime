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
 * A monitor's Status Timeline locks Delete on the one event a delete is
 * refused for, saying why
 * ---------------------------------------------------------------------------
 *
 * Deleting one status event hands its time to the event before it. Two
 * deletes have no event to hand it to, and the server refuses them
 * (MonitorStatusEventDelete): the monitor's only event, and its oldest
 * while it covers part of the last 90 days. The page locks Delete on that
 * event before anyone clicks it, with the reason as its tooltip, and leaves
 * every other row's Delete as it was. Which event that is, it reads from the
 * monitor's two oldest events, oldest first - not from the table's page,
 * which shows the newest and may be filtered - each time the table loads.
 *
 * ModelTable is stubbed to record its props; ModelAPI to answer the read.
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
}

interface RecordedTableProps {
  isDeleteable?: boolean;
  getDeleteDisabledReason?: (item: Row) => string | undefined;
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

const listReads: Array<ListRead> = [];
let answer: { data: Array<unknown>; count: number } | Error = {
  data: [],
  count: 0,
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<null> => {
        return null;
      },
      getList: async (read: ListRead): Promise<unknown> => {
        listReads.push(read);

        if (answer instanceof Error) {
          throw answer;
        }

        return { ...answer, skip: 0, limit: 2 };
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
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "bbbbbbbb-0000-4000-8000-000000000001",
);

const OLDEST: string = "cccccccc-0000-4000-8000-000000000001";
const NEXT: string = "cccccccc-0000-4000-8000-000000000002";
const NEWEST: string = "cccccccc-0000-4000-8000-000000000003";

const ONLY_EVENT_REASON: string =
  "This is the monitor's only status event, so it can't be deleted: the monitor would have no status, and status pages would show it gray.";
const OLDEST_EVENT_REASON: string =
  "This is the monitor's oldest status event and it covers part of the last 90 days, so it can't be deleted: status pages would show that time gray.";

const daysAgo: (days: number) => Date = (days: number): Date => {
  return new Date(NOW.getTime() - days * DAY_IN_MS);
};

function event(
  id: string,
  startsAt: Date,
  endsAt: Date | null,
): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = id;
  row.startsAt = startsAt;
  row.endsAt = endsAt as Date;
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

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  recordedTableProps = null;
  listReads.length = 0;
  answer = { data: [], count: 0 };
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(MONITOR_ID);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("the monitor's Status Timeline", () => {
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

  test("locks Delete on the only event, saying why", async () => {
    answer = { data: [event(OLDEST, daysAgo(365), null)], count: 1 };

    await renderPage();
    await tableLoaded();

    expect(recordedTableProps!.isDeleteable).toBe(true);
    expect(reasonFor(OLDEST)).toBe(ONLY_EVENT_REASON);
  });

  test("locks Delete on the oldest event while it covers part of the last 90 days, and on no other", async () => {
    answer = {
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

  test("matches the event whatever case its id is written in", async () => {
    answer = { data: [event(OLDEST, daysAgo(365), null)], count: 1 };

    await renderPage();
    await tableLoaded();

    expect(reasonFor(OLDEST.toUpperCase())).toBe(ONLY_EVENT_REASON);
  });

  test("locks nothing once the oldest event ended before the last 90 days", async () => {
    answer = {
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
    answer = { data: [event(OLDEST, daysAgo(1), null)], count: 1 };

    await renderPage();
    await tableLoaded();
    expect(reasonFor(OLDEST)).toBe(ONLY_EVENT_REASON);

    // A second event, inside the last 90 days: the first is now the oldest, still locked.
    answer = {
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
    answer = new Error("offline");

    await renderPage();
    await tableLoaded();

    expect(reasonFor(OLDEST)).toBeUndefined();
  });
});
