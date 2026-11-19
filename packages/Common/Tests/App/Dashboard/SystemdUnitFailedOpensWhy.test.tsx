/**
 * @timezone UTC
 */
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
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A FAILED SYSTEMD UNIT SAYS WHY (#9748).
 *
 * A host's unit page said "Current State: Failed" and nothing more: not
 * systemd's result (exit-code, signal, timeout, core-dump...), not the exit
 * status, not when, not the error the unit printed. Rendered for real, over
 * the unit's samples and its journal as the host collector's default config
 * files it (each line under its unit, systemd's result and exit status on
 * its own lines - HostCollectorDefaultConfig.test.ts):
 *
 *   - Failed is a pill that opens why, by the shared dialog: the result's
 *     meaning, systemd's result and exit status as written, the last thing
 *     the unit printed, since when, and its lines before that - read again
 *     when pressed;
 *   - the Current State tile says why and since when under Failed;
 *   - Recent logs lists the unit's newest lines, a step from the host's
 *     Logs filtered to the unit;
 *   - a failure the journal does not explain says so, and why it may not;
 *   - the journal is read on opening, when the unit fails or comes back
 *     and on Refresh - not on an auto-refresh tick, nor on a zoom, and a
 *     zoom into a past failure draws the plain state, not the latest why.
 */

const HOST_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";
const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const UNIT: string = "nginx.service";

function at(time: string): Date {
  const withSeconds: string = time.length === 5 ? `${time}:00` : time;
  return new Date(`2026-09-28T${withSeconds}.000Z`);
}

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const lastParamMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      aggregate: (): unknown => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000001");
      },
      getLastParamAsString: (): unknown => {
        return lastParamMock();
      },
      navigate: (): void => {},
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const harness: { StandInLineChart: unknown } = jest.requireActual(
    "./TimeRangeZoomPageHarness",
  ) as { StandInLineChart: unknown };
  return { __esModule: true, default: harness.StandInLineChart };
});

// Covered by its own suite; it fetches counts of its own.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import HostSystemdUnitView from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/SystemdUnitView";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE,
  JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE,
  JOURNALD_SYSTEMD_RESULT_ATTRIBUTE,
  JOURNALD_SYSTEMD_UNIT_ATTRIBUTE,
} from "../../../Utils/HostCollector/HostCollectorDefaultConfig";
import { UNEXPLAINED_ERROR_MESSAGES } from "../../../Types/Exception/UnexplainedError";
import { infoButtonsFor } from "./HostTooltipHarness";
import { AUTO_REFRESH_MS, advance, refreshButton } from "./SlowLoadHarness";
import { dragAcross, flush, zoomChart } from "./TimeRangeZoomPageHarness";

// The Host pages read their ids from the route, not from these props.
const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

type Row = Record<string, unknown>;

interface ListRequest {
  modelType: { name: string };
  query: { time: { startValue: Date; endValue: Date } };
}

// The unit's state now: what every sample in the range says.
let unitState: string = "failed";

// A sample every 30 seconds over the window asked for, newest first.
function unitRows(request: ListRequest): Array<Row> {
  const rows: Array<Row> = [];
  const start: number = request.query.time.startValue.getTime();
  const end: number = request.query.time.endValue.getTime();

  for (let time: number = end; time >= start; time -= 30_000) {
    rows.push({
      time: new Date(time),
      value: 1,
      attributes: {
        "resource.systemd.unit.name": UNIT,
        "systemd.unit.active_state": unitState,
        "resource.host.name": "web-01",
      },
    });
  }

  return rows;
}

function systemdLine(time: string, body: string, attributes: Row): Row {
  return {
    time: at(time),
    body: body,
    severityText: "INFO",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
      "syslog.identifier": "systemd",
      "process.pid": "1",
      ...attributes,
    },
  };
}

function ownLine(time: string, body: string): Row {
  return {
    time: at(time),
    body: body,
    severityText: "ERROR",
    attributes: {
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
      "syslog.identifier": "nginx",
      "process.pid": "4242",
    },
  };
}

const BIND_FAILED: string =
  "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)";

// nginx could not bind its port at 10:00:02, and systemd failed it.
const FAILED_JOURNAL: Array<Row> = [
  systemdLine("10:00:03", `${UNIT}: Failed with result 'exit-code'.`, {
    [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "exit-code",
  }),
  systemdLine(
    "10:00:03",
    `${UNIT}: Main process exited, code=exited, status=1/FAILURE`,
    {
      [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: "exited",
      [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: "1",
    },
  ),
  ownLine("10:00:02", BIND_FAILED),
  ownLine("10:00:01", "nginx: [warn] the configuration file is deprecated"),
  systemdLine(
    "10:00:00",
    `Starting ${UNIT} - A high performance web server...`,
    {},
  ),
];

// The unit's journal as the host's logs hold it, newest first.
let journal: Array<Row> = FAILED_JOURNAL;
let journalError: Error | null = null;

function journalReads(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((args: Array<unknown>): ListRequest => {
      return args[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType.name === "Log";
    });
}

function serve(): void {
  lastParamMock.mockReturnValue(UNIT);
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      _id: HOST_ID,
      name: "web-01",
      hostIdentifier: "web-01",
      otelCollectorStatus: "connected",
      lastSeenAt: NOW,
      osType: "linux",
    });
  });
  getListMock.mockImplementation((request: unknown): Promise<unknown> => {
    const call: ListRequest = request as ListRequest;

    if (call.modelType.name === "Log") {
      return journalError
        ? Promise.reject(journalError)
        : Promise.resolve({ data: journal });
    }

    return Promise.resolve({ data: unitRows(call) });
  });
}

async function renderUnit(): Promise<void> {
  serve();
  render(<HostSystemdUnitView {...PAGE_PROPS} />);
  await flush();
}

function failedPill(): HTMLElement {
  return screen.getByTestId("systemd-unit-failed");
}

function currentStateTile(): HTMLElement {
  return infoButtonsFor("Current State")[0]!.closest(
    ".rounded-xl",
  ) as HTMLElement;
}

function recentLines(): Array<string> {
  return screen
    .queryAllByTestId("systemd-unit-recent-log")
    .map((row: HTMLElement): string => {
      return row.querySelector("bdi")?.textContent || "";
    });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
  getListMock.mockReset();
  lastParamMock.mockReset();
  unitState = "failed";
  journal = FAILED_JOURNAL;
  journalError = null;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a failed unit says why", () => {
  test("Failed is a pill that opens why, as the shared dialog lists it", async () => {
    await renderUnit();

    const pill: HTMLElement = failedPill();
    expect(pill).toHaveTextContent("Failed");
    expect(pill).toHaveAttribute("aria-haspopup", "dialog");
    expect(pill).toHaveAttribute("title", "Show why");

    const readsBefore: number = journalReads().length;
    fireEvent.click(pill);
    await flush();

    // Read again when pressed: never the page's older read.
    expect(journalReads()).toHaveLength(readsBefore + 1);

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(`Why ${UNIT} failed`);

    const items: Array<HTMLElement> = within(dialog).getAllByTestId(
      "systemd-unit-failed-dialog-item",
    );
    expect(items).toHaveLength(1);
    const row: HTMLElement = items[0]!;

    // The page's own unit: "This unit", and no View to the page it is on.
    expect(row).toHaveAttribute("data-current", "true");
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-name"),
    ).toHaveTextContent("This unit");
    expect(
      within(row).queryByTestId("systemd-unit-failed-dialog-view"),
    ).toBeNull();

    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-reason"),
    ).toHaveTextContent("Exited with code 1");

    const facts: Array<string> = within(row)
      .getAllByTestId("systemd-unit-failed-dialog-fact")
      .map((fact: HTMLElement): string => {
        return (fact.textContent || "").replace(/\s+/g, " ").trim();
      });
    expect(facts).toEqual([
      expect.stringMatching(/^Result:? ?exit-code$/),
      expect.stringMatching(/^Exit status:? ?1\/FAILURE$/),
    ]);

    // What it printed last before it failed, as it wrote it.
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-message"),
    ).toHaveTextContent(BIND_FAILED);
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-since"),
    ).toHaveTextContent("Failed 1 hour ago");
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-events"),
    ).toHaveTextContent("nginx: [warn] the configuration file is deprecated");
  });

  test("the Current State tile says why and since when under Failed", async () => {
    await renderUnit();

    const tile: HTMLElement = currentStateTile();
    expect(tile).toHaveTextContent("Failed");
    expect(within(tile).getByTestId("stat-tile-sublabel")).toHaveTextContent(
      "Exited with code 1 · Failed 1 hour ago",
    );
  });

  test("Recent logs lists the unit's newest lines, a step from the host's Logs on them", async () => {
    await renderUnit();

    expect(screen.getByTestId("systemd-unit-recent-logs")).toHaveTextContent(
      "Recent logs",
    );
    expect(recentLines()).toEqual([
      `${UNIT}: Failed with result 'exit-code'.`,
      `${UNIT}: Main process exited, code=exited, status=1/FAILURE`,
      BIND_FAILED,
      "nginx: [warn] the configuration file is deprecated",
      `Starting ${UNIT} - A high performance web server...`,
    ]);

    const link: HTMLElement = screen.getByTestId("systemd-unit-open-in-logs");
    expect(link).toHaveTextContent("Open in Logs");
    const href: string = link.getAttribute("href") || "";
    const [path, query] = href.split("?") as [string, string];
    const params: URLSearchParams = new URLSearchParams(query);

    expect(path).toBe(
      `/dashboard/10000000-0000-4000-8000-000000000001/host/${HOST_ID}/logs`,
    );
    expect(JSON.parse(params.get("filters")!)).toEqual([
      [`attributes.${JOURNALD_SYSTEMD_UNIT_ATTRIBUTE}`, [UNIT]],
    ]);
    expect(params.get("range")).toBe("Custom");
    expect(new Date(params.get("end")!).toISOString()).toBe(NOW.toISOString());
  });

  test("the journal asked for is this host's lines, filed under this unit", async () => {
    await renderUnit();

    const read: ListRequest & {
      query: { attributes?: Record<string, string> };
    } = journalReads()[0] as never;
    expect(read.query.attributes).toEqual({
      "resource.host.name": "web-01",
      [JOURNALD_SYSTEMD_UNIT_ATTRIBUTE]: UNIT,
    });
  });

  test("a failure its journal does not explain says so, and why it may not", async () => {
    journal = [];
    await renderUnit();

    // No reason to give: the tile keeps its usual line.
    expect(
      within(currentStateTile()).getByTestId("stat-tile-sublabel"),
    ).not.toHaveTextContent("Exited");
    expect(
      screen.getByTestId("systemd-unit-recent-logs-empty"),
    ).toHaveTextContent(
      "Nothing from this unit in the last 7 days. OneUptime's default collector config sends each journal line with its unit.",
    );

    fireEvent.click(failedPill());
    await flush();

    const row: HTMLElement = screen.getByTestId(
      "systemd-unit-failed-dialog-item",
    );
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-reason"),
    ).toHaveTextContent("Failed");
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-explanation"),
    ).toHaveTextContent(
      "Its journal of the last 7 days does not say why. OneUptime's default collector config sends each journal line with its unit.",
    );
  });

  test("a failure its journal does not explain still lists what the unit printed, and who wrote each line", async () => {
    // A collector that files the unit's own lines, but not systemd's.
    journal = [
      ownLine("10:00:02", BIND_FAILED),
      ownLine("10:00:01", "nginx: [warn] the configuration file is deprecated"),
    ];
    await renderUnit();

    fireEvent.click(failedPill());
    await flush();

    const row: HTMLElement = screen.getByTestId(
      "systemd-unit-failed-dialog-item",
    );
    expect(
      within(row).getByTestId("systemd-unit-failed-dialog-explanation"),
    ).toHaveTextContent("does not say why");
    const events: HTMLElement = within(row).getByTestId(
      "systemd-unit-failed-dialog-events",
    );
    expect(events).toHaveTextContent(BIND_FAILED);
    // Who wrote it, as the row with a reason names it: nginx, not the unit.
    expect(
      within(events).getAllByTestId("systemd-unit-failed-dialog-event")[0],
    ).toHaveTextContent("nginx");
  });

  test("a journal that cannot be read says so where its lines go, and Try again reads it again", async () => {
    // An error nobody explained: what failed is said first.
    journalError = new Error(UNEXPLAINED_ERROR_MESSAGES.server);
    await renderUnit();

    const card: HTMLElement = screen.getByTestId("systemd-unit-recent-logs");
    expect(card).toHaveTextContent("Couldn't read this unit's journal.");
    // The unit's state still shows.
    expect(failedPill()).toBeInTheDocument();

    journalError = null;
    const reads: number = journalReads().length;
    fireEvent.click(within(card).getByTestId("refresh-button"));
    await flush();

    expect(journalReads()).toHaveLength(reads + 1);
    expect(recentLines()).toHaveLength(5);
  });

  test("the server's own words, when it said why", async () => {
    journalError = new Error("Server is not available");
    await renderUnit();

    expect(screen.getByTestId("systemd-unit-recent-logs")).toHaveTextContent(
      "Server is not available",
    );
  });
});

describe("a unit that has not failed", () => {
  test("its state is the plain pill, and Recent logs still lists its lines", async () => {
    unitState = "active";
    journal = [ownLine("11:59:00", "nginx: reloaded")];
    await renderUnit();

    expect(screen.queryByTestId("systemd-unit-failed")).toBeNull();
    expect(
      within(currentStateTile()).getByTestId("stat-tile-sublabel"),
    ).toHaveTextContent("as of");
    expect(recentLines()).toEqual(["nginx: reloaded"]);
  });

  test("with nothing to say and nothing wrong, Recent logs takes no room", async () => {
    unitState = "active";
    journal = [];
    await renderUnit();

    expect(screen.queryByTestId("systemd-unit-recent-logs")).toBeNull();
  });
});

describe("when the journal is read", () => {
  test("on opening and on Refresh, not on an auto-refresh tick", async () => {
    await renderUnit();
    expect(journalReads()).toHaveLength(1);

    await advance(AUTO_REFRESH_MS);
    await advance(AUTO_REFRESH_MS);
    expect(journalReads()).toHaveLength(1);

    fireEvent.click(refreshButton());
    await flush();
    expect(journalReads()).toHaveLength(2);
  });

  test("when the unit fails, so the tick that finds it failed says why", async () => {
    unitState = "active";
    journal = [ownLine("11:59:00", "nginx: reloaded")];
    await renderUnit();
    expect(journalReads()).toHaveLength(1);
    expect(screen.queryByTestId("systemd-unit-failed")).toBeNull();

    unitState = "failed";
    journal = [
      systemdLine("12:00:20", `${UNIT}: Failed with result 'signal'.`, {
        [JOURNALD_SYSTEMD_RESULT_ATTRIBUTE]: "signal",
      }),
      systemdLine(
        "12:00:20",
        `${UNIT}: Main process exited, code=killed, status=9/KILL`,
        {
          [JOURNALD_SYSTEMD_EXIT_CODE_ATTRIBUTE]: "killed",
          [JOURNALD_SYSTEMD_EXIT_STATUS_ATTRIBUTE]: "9",
        },
      ),
    ];
    await advance(AUTO_REFRESH_MS);

    expect(journalReads()).toHaveLength(2);
    expect(failedPill()).toBeInTheDocument();
    expect(
      within(currentStateTile()).getByTestId("stat-tile-sublabel"),
    ).toHaveTextContent("Killed by SIGKILL · Failed now");
  });

  test("a zoom into a past failure draws the plain state, and reads no journal", async () => {
    await renderUnit();
    expect(failedPill()).toBeInTheDocument();
    const reads: number = journalReads().length;

    await dragAcross(zoomChart(0), at("11:46"), at("11:49"));

    // Failed then - but the journal's latest failure is now's, not then's.
    expect(screen.queryByTestId("systemd-unit-failed")).toBeNull();
    expect(currentStateTile()).toHaveTextContent("Failed");
    expect(
      within(currentStateTile()).getByTestId("stat-tile-sublabel"),
    ).not.toHaveTextContent("Exited");
    expect(journalReads()).toHaveLength(reads);
    // Recent logs is the unit's latest, whatever the range.
    expect(recentLines()).toHaveLength(5);
  });
});
