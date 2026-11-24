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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

configure({ asyncUtilTimeout: 15000 });
jest.setTimeout(60000);

/*
 * SECURITY EVENTS: THE SOURCE FACET AND ITS CHIPS, PAST THE PROJECT'S FIRST
 * 10,000 SERVICES (#10921).
 *
 * The aggregate route hands back the id a row is attributed to, and the
 * explorer named its Source facet and chips from the project's first
 * 10,000 services by name: a source past them read as its bare id in the
 * sidebar and on its chip, and so did one deleted since. They are read by
 * the ids the page shows now - the facet's values, the chips', the page's
 * own scope's - each once: every source named, however many services the
 * project has, and a chip of one gone reads "No longer available", taken
 * off like any other. ModelAPI answers from a project faked whole
 * (CappedListServer); the events are stood in for.
 */

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;

    return {
      __esModule: true,
      default: (props: { value: { range: string } }): ReactElement => {
        return react.createElement(
          "div",
          { "data-testid": "time-range-picker" },
          props.value.range,
        );
      },
    };
  },
);

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;
  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    BarChart: (props: { children?: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import SecurityEventsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsViewer";
import SecurityEventAttributeUtil from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventAttributeUtil";
import { SECURITY_EVENT_SOURCE_FACET_KEY } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import Service from "../../../Models/DatabaseModels/Service";
import AggregateBy from "../../../Types/BaseDatabase/AggregateBy";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import OneUptimeDate from "../../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EARLY_SOURCE_ID: string = "22222222-2222-4222-8222-000000000001";
const LATE_SOURCE_ID: string = "22222222-2222-4222-8222-0000000000aa";
const OTHER_LATE_SOURCE_ID: string = "22222222-2222-4222-8222-0000000000ab";
const DELETED_SOURCE_ID: string = "22222222-2222-4222-8222-0000000000dd";

const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

let server: CappedListServer;

beforeEach(() => {
  window.history.replaceState(null, "", "/dashboard/project/security-events");
  window.localStorage.clear();

  server = new CappedListServer();
  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: EARLY_SOURCE_ID, name: "AA early detector" },
    { _id: LATE_SOURCE_ID, name: "WB kiosk payments" },
    { _id: OTHER_LATE_SOURCE_ID, name: "WB kiosk login" },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });

  // The Source facet counts three sources: one early, one late, one gone.
  getJestSpyOn(AnalyticsModelAPI, "aggregate").mockImplementation(
    (async (data: {
      aggregateBy: AggregateBy<SecurityEvent>;
    }): Promise<AggregatedResult> => {
      const groupBy: Record<string, boolean> =
        (data.aggregateBy.groupBy as unknown as Record<string, boolean>) || {};

      if (
        String(data.aggregateBy.aggregationInterval) === "Total" &&
        Object.keys(groupBy)[0] === SECURITY_EVENT_SOURCE_FACET_KEY
      ) {
        return {
          data: [
            {
              timestamp: NOW,
              value: 13,
              [SECURITY_EVENT_SOURCE_FACET_KEY]: LATE_SOURCE_ID,
            },
            {
              timestamp: NOW,
              value: 7,
              [SECURITY_EVENT_SOURCE_FACET_KEY]: DELETED_SOURCE_ID,
            },
            {
              timestamp: NOW,
              value: 2,
              [SECURITY_EVENT_SOURCE_FACET_KEY]: EARLY_SOURCE_ID,
            },
          ],
        } as unknown as AggregatedResult;
      }

      return { data: [] } as unknown as AggregatedResult;
    }) as never,
  );
  getJestSpyOn(AnalyticsModelAPI, "getList").mockImplementation((async (data: {
    limit: number;
  }): Promise<ListResult<SecurityEvent>> => {
    const event: SecurityEvent = Object.assign(new SecurityEvent(), {
      time: new Date("2026-11-24T10:00:00.000Z"),
      eventUid: "uid-1",
      severityName: OcsfSeverity.Critical,
      className: "Authentication",
      message: "Failed logon for alice",
    });

    return { data: [event], count: 1, skip: 0, limit: data.limit };
  }) as never);
  getJestSpyOn(
    SecurityEventAttributeUtil,
    "getAttributeKeys",
  ).mockResolvedValue([] as never);
  getJestSpyOn(
    SecurityEventAttributeUtil,
    "getAttributeValues",
  ).mockResolvedValue([] as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderViewer(
  filters?: Array<[string, Array<string>]>,
): Promise<void> {
  if (filters) {
    window.history.replaceState(
      null,
      "",
      `/dashboard/project/security-events?filters=${encodeURIComponent(
        JSON.stringify(filters),
      )}`,
    );
  }

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityEventsViewer />
      </MemoryRouter>,
    );
  });
}

function facetSection(title: string): HTMLElement {
  const label: Element | undefined = Array.from(
    document.querySelectorAll("span.uppercase"),
  ).find((node: Element): boolean => {
    return (node.textContent || "").trim() === title;
  });

  if (!label) {
    throw new Error(`No facet section titled "${title}".`);
  }

  return label.closest("div.border-b") as HTMLElement;
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

describe("Security Events: the sources it names", () => {
  test("the Source facet names a source past the project's first 10,000 services, read by its id", async () => {
    await renderViewer();

    await waitFor(() => {
      expect(facetSection("Source")).toHaveTextContent("WB kiosk payments");
    });
    expect(facetSection("Source")).toHaveTextContent("AA early detector");
    expect(facetSection("Source")).not.toHaveTextContent(LATE_SOURCE_ID);

    // By the ids the facet lists: never the first 10,000 by name.
    expect(serviceReads().length).toBeGreaterThan(0);

    for (const call of serviceReads()) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }

    const asked: Array<string> = serviceReads().flatMap(
      (call: CappedListCall): Array<string> => {
        return (call.query["_id"] as Includes).values.map(
          (value: unknown): string => {
            return String(value).toLowerCase();
          },
        );
      },
    );

    expect(asked.sort()).toEqual(
      [EARLY_SOURCE_ID, LATE_SOURCE_ID, DELETED_SOURCE_ID].sort(),
    );
  });

  test("a chip a link holds names a source past the 10,000th, and narrows the list by it", async () => {
    await renderViewer([
      [SECURITY_EVENT_SOURCE_FACET_KEY, [OTHER_LATE_SOURCE_ID]],
    ]);

    await waitFor(() => {
      expect(
        screen.getByTitle("Remove Source: WB kiosk login"),
      ).toBeInTheDocument();
    });
  });

  test("a chip of a source deleted since reads No longer available, and is taken off by its x", async () => {
    await renderViewer([
      [SECURITY_EVENT_SOURCE_FACET_KEY, [LATE_SOURCE_ID, DELETED_SOURCE_ID]],
    ]);

    const gone: HTMLElement = await screen.findByTitle(
      "Remove Source: No longer available",
    );

    expect(
      screen.getByTitle("Remove Source: WB kiosk payments"),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(gone);
    });

    await waitFor(() => {
      expect(
        screen.queryByTitle("Remove Source: No longer available"),
      ).toBeNull();
    });

    // The one gone came off the address; the late source stays, as held.
    const filters: string = new URLSearchParams(window.location.search).get(
      "filters",
    )!;

    expect(filters).toContain(LATE_SOURCE_ID);
    expect(filters).not.toContain(DELETED_SOURCE_ID);
  });

  test("each source is read once, however often the page draws it", async () => {
    await renderViewer([[SECURITY_EVENT_SOURCE_FACET_KEY, [LATE_SOURCE_ID]]]);

    await waitFor(() => {
      expect(facetSection("Source")).toHaveTextContent("WB kiosk payments");
    });

    const asked: Array<string> = serviceReads().flatMap(
      (call: CappedListCall): Array<string> => {
        return (call.query["_id"] as Includes).values.map(
          (value: unknown): string => {
            return String(value).toLowerCase();
          },
        );
      },
    );

    expect(new Set(asked).size).toBe(asked.length);
  });

  test("a read that fails leaves the sources by their ids, still filtering", async () => {
    jest.spyOn(server, "list").mockImplementation((() => {
      throw new Error("The server is unavailable.");
    }) as never);

    await renderViewer([[SECURITY_EVENT_SOURCE_FACET_KEY, [LATE_SOURCE_ID]]]);

    await waitFor(() => {
      expect(
        screen.getByTitle(`Remove Source: ${LATE_SOURCE_ID}`),
      ).toBeInTheDocument();
    });
  });
});
