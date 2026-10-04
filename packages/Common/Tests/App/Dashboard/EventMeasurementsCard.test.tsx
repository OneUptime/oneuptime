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
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission from "../../../Types/Permission";

/*
 * The Measurements card on an incident's, an alert's and a maintenance
 * event's page, drawn for real with only the API, the permissions and the
 * language stubbed.
 *
 * "Someone who sets up 'Time to mitigate' opens an incident and finds it
 * nowhere." - the audit that asked for it. So the card lists the project's
 * measurements for this event, each with what it measures and what it
 * reads; draws nothing at all for the many projects with none; reads again
 * after the page's state changes; and keeps a running clock moving.
 */

const getListMock: MockFunction = getJestMockFunction();

let mockPermissions: Array<Permission> = [Permission.ProjectMember];
let mockLocale: Record<string, string> = {};
let mockLanguage: string = "en";

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return mockPermissions;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      const translateString: (
        value: string | undefined,
      ) => string | undefined = (
        value: string | undefined,
      ): string | undefined => {
        return value === undefined ? undefined : mockLocale[value] ?? value;
      };

      return {
        translateString: translateString,
        translateValue: (value: unknown): unknown => {
          return typeof value === "string" ? translateString(value) : value;
        },
        language: mockLanguage,
      };
    },
  };
});

import EventMeasurementsCard from "../../../../App/FeatureSet/Dashboard/src/Components/Measurement/EventMeasurementsCard";
import {
  ALERT_EVENT_MEASUREMENTS,
  EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS,
  EventMeasurementSource,
  INCIDENT_EVENT_MEASUREMENTS,
  SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/EventMeasurements";
import { MEASUREMENT_PAGE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Utils/Measurement/MeasurementSetup";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import IncidentMeasurementValue from "../../../Models/DatabaseModels/IncidentMeasurementValue";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MeasurementStatus from "../../../Types/Measurement/MeasurementStatus";
import ObjectID from "../../../Types/ObjectID";
import fs from "fs";
import path from "path";

const NOW: Date = new Date("2026-09-14T18:20:00.000Z");
const MINUTE_IN_MS: number = 60 * 1000;

const INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
);

const ACKNOWLEDGE_ID: string = "10000000-0000-4000-8000-000000000001";
const RESOLVE_ID: string = "10000000-0000-4000-8000-000000000002";
const POSTMORTEM_ID: string = "10000000-0000-4000-8000-000000000003";
const MITIGATE_ID: string = "10000000-0000-4000-8000-000000000004";
const DETECT_ID: string = "10000000-0000-4000-8000-000000000005";

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * MINUTE_IN_MS);
};

type MakeFunction = <T extends BaseModel>(
  modelType: { new (): T },
  fields: Record<string, unknown>,
) => T;

// A row as the API hands it back: a model with its columns filled in.
const make: MakeFunction = <T extends BaseModel>(
  modelType: { new (): T },
  fields: Record<string, unknown>,
): T => {
  return Object.assign(new modelType(), fields);
};

const mitigated: IncidentState = make(IncidentState, { name: "Mitigated" });

// Five measurements, in the order the project dragged them into.
const DEFINITIONS: Array<IncidentMeasurement> = [
  make(IncidentMeasurement, {
    _id: ACKNOWLEDGE_ID,
    name: "Time to acknowledge",
    unit: "seconds",
    startAnchorType: "Declared At",
    endAnchorType: "State Role Entered",
    endIncidentStateRole: "Acknowledged",
  }),
  make(IncidentMeasurement, {
    _id: RESOLVE_ID,
    name: "Time to resolve",
    unit: "seconds",
    startAnchorType: "Declared At",
    endAnchorType: "State Role Entered",
    endIncidentStateRole: "Resolved",
  }),
  make(IncidentMeasurement, {
    _id: POSTMORTEM_ID,
    name: "Time to postmortem",
    unit: "hours",
    startAnchorType: "State Role Entered",
    startIncidentStateRole: "Resolved",
    endAnchorType: "Postmortem Posted At",
  }),
  make(IncidentMeasurement, {
    _id: MITIGATE_ID,
    name: "Time to mitigate",
    unit: "seconds",
    startAnchorType: "Declared At",
    endAnchorType: "State Entered",
    endIncidentState: mitigated,
  }),
  make(IncidentMeasurement, {
    _id: DETECT_ID,
    name: "Time to detect",
    unit: "seconds",
    startAnchorType: "Impact Started At",
    endAnchorType: "Declared At",
  }),
];

// An open incident: acknowledged after 3 minutes, declared 19 minutes ago.
const VALUES: Array<IncidentMeasurementValue> = [
  make(IncidentMeasurementValue, {
    incidentMeasurementId: new ObjectID(ACKNOWLEDGE_ID),
    status: MeasurementStatus.Recorded,
    startedAt: minutesAgo(19),
    endedAt: minutesAgo(16),
    valueInSeconds: 180,
    computedAt: minutesAgo(16),
  }),
  make(IncidentMeasurementValue, {
    incidentMeasurementId: new ObjectID(RESOLVE_ID),
    status: MeasurementStatus.Pending,
    startedAt: minutesAgo(19),
    statusMessage: "The resolved state has not been reached yet",
    computedAt: minutesAgo(16),
  }),
  make(IncidentMeasurementValue, {
    incidentMeasurementId: new ObjectID(POSTMORTEM_ID),
    status: MeasurementStatus.Pending,
    statusMessage: "The resolved state has not been reached yet",
    computedAt: minutesAgo(16),
  }),
  make(IncidentMeasurementValue, {
    incidentMeasurementId: new ObjectID(MITIGATE_ID),
    status: MeasurementStatus.NotApplicable,
    startedAt: minutesAgo(19),
    statusMessage: "Mitigated was skipped",
    computedAt: minutesAgo(16),
  }),
  // Time to detect: not worked out for this incident yet.
];

interface ListRequest {
  modelType: { new (): BaseModel };
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface FakeApi {
  definitions: Array<BaseModel>;
  values: Array<BaseModel>;
}

const api: FakeApi = { definitions: [], values: [] };

type ServeFunction = (source?: EventMeasurementSource) => void;

// Answers like the server: the definitions, then this event's values.
const serve: ServeFunction = (
  source: EventMeasurementSource = INCIDENT_EVENT_MEASUREMENTS,
): void => {
  getListMock.mockImplementation(((request: ListRequest) => {
    if (request.modelType === source.measurementModel) {
      return Promise.resolve({
        data: api.definitions,
        count: api.definitions.length,
        skip: 0,
        limit: request.limit,
      });
    }

    if (request.modelType === source.valueModel) {
      return Promise.resolve({
        data: api.values,
        count: api.values.length,
        skip: 0,
        limit: request.limit,
      });
    }

    return Promise.reject(new Error("Unexpected list request"));
  }) as never);
};

const listRequests: () => Array<ListRequest> = (): Array<ListRequest> => {
  return getListMock.mock.calls.map((call: Array<unknown>): ListRequest => {
    return call[0] as ListRequest;
  });
};

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 20; index++) {
      await Promise.resolve();
    }
  });
}

interface CardOptions {
  source?: EventMeasurementSource;
  eventId?: ObjectID;
  isEventOver?: boolean;
  refreshKey?: string;
}

type CardElementFunction = (options?: CardOptions) => ReactElement;

const cardElement: CardElementFunction = (
  options?: CardOptions,
): ReactElement => {
  return (
    <EventMeasurementsCard
      source={options?.source || INCIDENT_EVENT_MEASUREMENTS}
      eventId={options?.eventId || INCIDENT_ID}
      isEventOver={Boolean(options?.isEventOver)}
      refreshKey={options?.refreshKey ?? "created,acknowledged"}
      headerLayout="stacked"
    />
  );
};

async function renderCard(options?: CardOptions): Promise<RenderResult> {
  const result: RenderResult = render(cardElement(options));
  await flush();
  return result;
}

interface Row {
  name: string;
  summary: string;
  value: string;
  reason: string | null;
  state: string | null;
}

const rows: () => Array<Row> = (): Array<Row> => {
  return screen
    .queryAllByTestId("event-measurement")
    .map((row: HTMLElement): Row => {
      return {
        name: within(row).getByTestId("event-measurement-name").textContent!,
        // The arrow is spaced by its margins, not by text.
        summary: within(row)
          .getByTestId("measurement-summary")
          .textContent!.replace("→", " → ")
          .replace(/\s+/g, " ")
          .trim(),
        value: within(row).getByTestId("event-measurement-value").textContent!,
        reason:
          within(row).queryByTestId("event-measurement-reason")?.textContent ||
          null,
        state: row.getAttribute("data-measurement-state"),
      };
    });
};

const valueOf: (name: string) => string = (name: string): string => {
  const row: Row | undefined = rows().find((candidate: Row): boolean => {
    return candidate.name === name;
  });

  if (!row) {
    throw new Error(`No row for ${name}`);
  }

  return row.value;
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockPermissions = [Permission.ProjectMember];
  mockLocale = {};
  mockLanguage = "en";
  api.definitions = DEFINITIONS;
  api.values = VALUES;
  getListMock.mockReset();
  serve();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("EventMeasurementsCard", () => {
  test("draws nothing, and reads no values, for a project that shows no measurements", async () => {
    api.definitions = [];

    const view: RenderResult = await renderCard();

    expect(view.container).toBeEmptyDOMElement();
    expect(
      listRequests().map((request: ListRequest) => {
        return request.modelType;
      }),
    ).toEqual([IncidentMeasurement]);
  });

  test("lists the measurements in their order, each with what it measures and what it reads", async () => {
    await renderCard();

    expect(
      screen.getByRole("heading", { level: 2, name: "Measurements" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        MEASUREMENT_PAGE_COPY[INCIDENT_EVENT_MEASUREMENTS.domain]
          .eventCardDescription,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );

    expect(rows()).toEqual([
      {
        name: "Time to acknowledge",
        summary: "Declared → Acknowledged",
        value: "3 minutes",
        reason: null,
        state: "recorded",
      },
      {
        name: "Time to resolve",
        summary: "Declared → Resolved",
        value: "Running for 19 minutes",
        reason: null,
        state: "running",
      },
      {
        name: "Time to postmortem",
        summary: "Resolved → Postmortem published",
        value: "Not started yet",
        reason: null,
        state: "not-started",
      },
      {
        name: "Time to mitigate",
        // A state you pick reads as the state's own name.
        summary: "Declared → Mitigated",
        value: "Not measured",
        reason: "Mitigated was skipped",
        state: "not-measured",
      },
      {
        name: "Time to detect",
        summary: "Impact started → Declared",
        value: "Not worked out yet",
        reason: "OneUptime works it out in the background.",
        state: "not-worked-out",
      },
    ]);
  });

  test("asks for the enabled measurements shown on incident pages, in order, then this incident's values", async () => {
    await renderCard();

    const [definitions, values] = listRequests();

    expect(definitions!.modelType).toBe(IncidentMeasurement);
    expect(definitions!.query).toEqual({
      isEnabled: true,
      showOnIncidentView: true,
    });
    expect(definitions!.sort).toEqual({ order: SortOrder.Ascending });
    expect(definitions!.select).toEqual(
      expect.objectContaining({ name: true, unit: true }),
    );
    expect(definitions!.skip).toBe(0);
    expect(definitions!.limit).toBeGreaterThanOrEqual(100);

    expect(values!.modelType).toBe(IncidentMeasurementValue);
    expect(values!.query).toEqual({ incidentId: INCIDENT_ID });
    expect(listRequests()).toHaveLength(2);
  });

  test("a name is shown as the project typed it, never translated", async () => {
    mockLocale = { "Time to acknowledge": "Zeit bis zur Bestätigung" };

    await renderCard();

    expect(rows()[0]!.name).toBe("Time to acknowledge");
  });

  test("the rows are a description list: each name with its value", async () => {
    await renderCard();

    const list: HTMLElement = screen.getByTestId("event-measurements");

    expect(list.tagName).toBe("DL");
    expect(list.querySelectorAll("dt")).toHaveLength(5);
    expect(
      within(list).getAllByTestId("event-measurement-value")[0]!.tagName,
    ).toBe("DD");
  });

  test("a number stands out; a state is quieter; an end before its start is a warning", async () => {
    api.values = [
      ...VALUES,
      make(IncidentMeasurementValue, {
        incidentMeasurementId: new ObjectID(DETECT_ID),
        status: MeasurementStatus.Invalid,
        startedAt: minutesAgo(2),
        endedAt: minutesAgo(19),
        statusMessage: "Declared At precedes Impact Started At by 17m",
        computedAt: minutesAgo(1),
      }),
    ];

    await renderCard();

    const values: Array<HTMLElement> = screen.getAllByTestId(
      "event-measurement-value",
    );

    expect(values[0]).toHaveClass("font-medium", "text-gray-900");
    expect(values[2]).toHaveClass("text-gray-500");
    expect(values[4]).toHaveTextContent("Ends before it starts");
    expect(values[4]).toHaveClass("font-medium", "text-amber-700");
    expect(rows()[4]!.reason).toBe(
      "Declared At precedes Impact Started At by 17m",
    );
  });

  test("a running clock moves on its own, every 30 seconds", async () => {
    await renderCard();

    expect(valueOf("Time to resolve")).toBe("Running for 19 minutes");

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(valueOf("Time to resolve")).toBe("Running for 20 minutes");
    // Moving the clock reads nothing again.
    expect(listRequests()).toHaveLength(2);
  });

  test("a clock that starts at a time still ahead starts when it comes", async () => {
    api.definitions = [
      make(SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS.measurementModel, {
        _id: ACKNOWLEDGE_ID,
        name: "Start delay",
        unit: "seconds",
        startAnchorType: "Scheduled Starts At",
        endAnchorType: "State Role Entered",
        endScheduledMaintenanceStateRole: "Ongoing",
      }),
    ];
    api.values = [
      make(SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS.valueModel, {
        scheduledMaintenanceMeasurementId: new ObjectID(ACKNOWLEDGE_ID),
        status: MeasurementStatus.Pending,
        // Scheduled to start in a minute.
        startedAt: new Date(NOW.getTime() + MINUTE_IN_MS),
        computedAt: minutesAgo(30),
      }),
    ];
    serve(SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS);

    await renderCard({ source: SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS });

    expect(rows()[0]).toEqual(
      expect.objectContaining({
        summary: "Scheduled start → Started",
        value: "Not started yet",
      }),
    );

    act(() => {
      jest.advanceTimersByTime(2 * MINUTE_IN_MS);
    });

    expect(rows()[0]!.value).toBe("Running for 1 minute");
  });

  test("told the event is over, a state it waited for is not reached, with nothing read again", async () => {
    const view: RenderResult = await renderCard();

    view.rerender(cardElement({ isEventOver: true }));
    await flush();

    // Never resolved before it ended: no clock running on.
    expect(rows()[1]).toEqual(
      expect.objectContaining({
        name: "Time to resolve",
        value: "Not reached",
        state: "not-reached",
      }),
    );
    expect(listRequests()).toHaveLength(2);
  });

  test("reads again when the event's state changes, and once more a moment later", async () => {
    const view: RenderResult = await renderCard();

    expect(listRequests()).toHaveLength(2);

    // The page resolved the incident... the server has not worked it out yet.
    view.rerender(cardElement({ refreshKey: "created,acknowledged,resolved" }));
    await flush();

    expect(listRequests()).toHaveLength(4);
    expect(valueOf("Time to resolve")).toBe("Running for 19 minutes");

    // ...and has, by the time of the second read.
    api.values = VALUES.map((value: IncidentMeasurementValue) => {
      return value.incidentMeasurementId?.toString() === RESOLVE_ID
        ? make(IncidentMeasurementValue, {
            incidentMeasurementId: new ObjectID(RESOLVE_ID),
            status: MeasurementStatus.Recorded,
            startedAt: minutesAgo(19),
            endedAt: NOW,
            valueInSeconds: 19 * 60,
            computedAt: NOW,
          })
        : value;
    });

    await act(async () => {
      jest.advanceTimersByTime(EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS);
    });
    await flush();

    expect(listRequests()).toHaveLength(6);
    expect(valueOf("Time to resolve")).toBe("19 minutes");

    // Just the one extra read.
    await act(async () => {
      jest.advanceTimersByTime(10 * EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS);
    });
    await flush();

    expect(listRequests()).toHaveLength(6);
  });

  test("a page re-render with the same state reads nothing again", async () => {
    const view: RenderResult = await renderCard();

    view.rerender(cardElement({ refreshKey: "created,acknowledged" }));
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(5 * EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS);
    });
    await flush();

    expect(listRequests()).toHaveLength(2);
  });

  test("the first read is no refresh: no extra read follows it", async () => {
    await renderCard();

    await act(async () => {
      jest.advanceTimersByTime(5 * EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS);
    });
    await flush();

    expect(listRequests()).toHaveLength(2);
  });

  test("a first read that fails draws nothing", async () => {
    getListMock.mockImplementation((() => {
      return Promise.reject(new Error("Gateway timeout"));
    }) as never);

    const view: RenderResult = await renderCard();

    expect(view.container).toBeEmptyDOMElement();
  });

  test("a values read that fails draws nothing either", async () => {
    getListMock.mockImplementation(((request: ListRequest) => {
      if (request.modelType === IncidentMeasurement) {
        return Promise.resolve({
          data: DEFINITIONS,
          count: DEFINITIONS.length,
          skip: 0,
          limit: request.limit,
        });
      }

      return Promise.reject(new Error("Gateway timeout"));
    }) as never);

    const view: RenderResult = await renderCard();

    expect(view.container).toBeEmptyDOMElement();
  });

  test("a refresh that fails keeps what is on screen", async () => {
    const view: RenderResult = await renderCard();

    getListMock.mockImplementation((() => {
      return Promise.reject(new Error("Gateway timeout"));
    }) as never);

    view.rerender(cardElement({ refreshKey: "created,acknowledged,resolved" }));
    await flush();

    expect(rows()).toHaveLength(5);
    expect(valueOf("Time to acknowledge")).toBe("3 minutes");
  });

  test("a reader who may not read the measurements gets no card, and nothing is asked", async () => {
    // May read alerts only.
    mockPermissions = [Permission.AlertViewer];

    const view: RenderResult = await renderCard();

    expect(view.container).toBeEmptyDOMElement();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("while the reader's permissions are still on their way, it asks: the server decides", async () => {
    mockPermissions = [];

    await renderCard();

    expect(listRequests()).toHaveLength(2);
    expect(rows()).toHaveLength(5);
  });

  test("an answer for the event the reader has left never shows on the next one", async () => {
    let answerFirstValues: (value: unknown) => void = (): void => {};

    getListMock.mockImplementation(((request: ListRequest) => {
      if (request.modelType === IncidentMeasurement) {
        return Promise.resolve({
          data: DEFINITIONS,
          count: DEFINITIONS.length,
          skip: 0,
          limit: request.limit,
        });
      }

      const eventId: string = String(request.query["incidentId"]);

      if (eventId === INCIDENT_ID.toString()) {
        return new Promise((resolve: (value: unknown) => void) => {
          answerFirstValues = resolve;
        });
      }

      return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
    }) as never);

    const view: RenderResult = await renderCard();

    view.rerender(cardElement({ eventId: OTHER_INCIDENT_ID }));
    await flush();

    // The next incident has no values yet.
    expect(valueOf("Time to acknowledge")).toBe("Not worked out yet");

    await act(async () => {
      answerFirstValues({ data: VALUES, count: 5, skip: 0, limit: 5 });
    });
    await flush();

    expect(valueOf("Time to acknowledge")).toBe("Not worked out yet");
  });

  test("once gone, it reads nothing more", async () => {
    const view: RenderResult = await renderCard();

    view.rerender(cardElement({ refreshKey: "created,acknowledged,resolved" }));
    await flush();

    const readsBefore: number = listRequests().length;

    view.unmount();

    await act(async () => {
      jest.advanceTimersByTime(10 * EVENT_MEASUREMENT_SETTLE_DELAY_IN_MS);
    });

    expect(listRequests()).toHaveLength(readsBefore);
  });

  test.each([
    {
      label: "an alert",
      source: ALERT_EVENT_MEASUREMENTS,
      query: { isEnabled: true, showOnAlertView: true },
      eventIdColumn: "alertId",
    },
    {
      label: "a maintenance event",
      source: SCHEDULED_MAINTENANCE_EVENT_MEASUREMENTS,
      query: { isEnabled: true, showOnScheduledMaintenanceView: true },
      eventIdColumn: "scheduledMaintenanceId",
    },
  ])(
    "on $label's page it reads that kind's measurements, and says so",
    async ({
      source,
      query,
      eventIdColumn,
    }: {
      source: EventMeasurementSource;
      query: Record<string, unknown>;
      eventIdColumn: string;
    }) => {
      api.definitions = [
        make(source.measurementModel, {
          _id: ACKNOWLEDGE_ID,
          name: "Our measurement",
          unit: "minutes",
        }),
      ];
      api.values = [
        make(source.valueModel, {
          [source.measurementIdColumn]: new ObjectID(ACKNOWLEDGE_ID),
          status: MeasurementStatus.Recorded,
          valueInSeconds: 90,
        }),
      ];
      serve(source);

      await renderCard({ source: source });

      const [definitions, values] = listRequests();

      expect(definitions!.modelType).toBe(source.measurementModel);
      expect(definitions!.query).toEqual(query);
      expect(values!.modelType).toBe(source.valueModel);
      expect(values!.query).toEqual({ [eventIdColumn]: INCIDENT_ID });
      expect(
        screen.getByText(
          MEASUREMENT_PAGE_COPY[source.domain].eventCardDescription,
        ),
      ).toBeInTheDocument();
      // Pinned to minutes: 90 seconds is 1.5 minutes.
      expect(valueOf("Our measurement")).toBe("1.5 minutes");
    },
  );

  test("in the reader's language", async () => {
    mockLocale = JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Locales",
          "de.json",
        ),
        "utf8",
      ),
    );
    mockLanguage = "de";

    await renderCard();

    expect(
      screen.getByRole("heading", { level: 2, name: "Messungen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Die Messungen Ihres Teams, berechnet für diesen Vorfall.",
      ),
    ).toBeInTheDocument();
    expect(rows().slice(0, 4)).toEqual([
      expect.objectContaining({
        name: "Time to acknowledge",
        value: "3 Minuten",
      }),
      expect.objectContaining({ value: "Läuft bereits 19 Minuten" }),
      expect.objectContaining({ value: "Noch nicht gestartet" }),
      expect.objectContaining({
        value: "Nicht gemessen",
        // The server's reason is the server's English.
        reason: "Mitigated was skipped",
      }),
    ]);
  });
});
