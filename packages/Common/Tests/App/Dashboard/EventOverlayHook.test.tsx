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
  waitFor,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The shared event-overlay hook is what puts "what happened here" on every
 * metric chart: incidents and alerts as solid severity-colored markers
 * with click-through, change events (deploys) as dashed indigo markers.
 * It must fetch nothing on public dashboards and survive any single
 * source failing.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const isPublicDashboardMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factory runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext",
  () => {
    return {
      __esModule: true,
      isPublicDashboard: (...args: Array<any>) => {
        return isPublicDashboardMock(...args);
      },
    };
  },
);

import useEventTimeReferenceLines, {
  EVENT_MARKER_TITLE_MAX_LENGTH,
  EventTimeReferenceLines,
  truncateEventMarkerTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines";
import ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T11:00:00.000Z"),
);

const PROJECT_ID: ObjectID = new ObjectID(
  "9e1b6b0e-0000-4000-8000-000000000011",
);

function Probe(props: {
  enabled: boolean;
  window: InBetween<Date> | null;
}): React.ReactElement {
  const { lines, markerCount }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: props.enabled,
      window: props.window,
    });

  return (
    <div>
      <span data-testid="marker-count">{markerCount}</span>
      {lines.map((line: ChartTimeReferenceLineProps, index: number) => {
        return (
          <div
            key={index}
            data-testid="marker"
            data-color={line.color}
            data-dash={line.strokeDasharray || "solid"}
            data-clickable={line.onClick ? "yes" : "no"}
            data-kind={line.kind || "none"}
            data-subtitle={line.subtitle || ""}
          >
            {line.label}
          </div>
        );
      })}
    </div>
  );
}

beforeEach(() => {
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  isPublicDashboardMock.mockReset();
  isPublicDashboardMock.mockReturnValue(false);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  jest.restoreAllMocks();
  cleanup();
});

describe("useEventTimeReferenceLines", () => {
  test("maps incidents, alerts, and change events onto distinct marker styles", async () => {
    getListMock.mockImplementation((args: { modelType: { name: string } }) => {
      if (args.modelType.name === "Incident") {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID("11111111-0000-4000-8000-000000000001"),
              createdAt: "2026-08-20T10:10:00.000Z",
              title: "API is down",
              incidentSeverity: { color: "#123456" },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            id: new ObjectID("22222222-0000-4000-8000-000000000002"),
            createdAt: "2026-08-20T10:20:00.000Z",
            title: "High latency",
            alertSeverity: undefined,
          },
        ],
      });
    });
    analyticsGetListMock.mockResolvedValue({
      data: [
        {
          time: "2026-08-20T10:03:00.000Z",
          title: "v2.31.0",
          eventType: "deployment",
        },
      ],
    });

    render(<Probe enabled={true} window={WINDOW} />);

    await waitFor(() => {
      expect(screen.getByTestId("marker-count").textContent).toBe("3");
    });

    const markers: Array<HTMLElement> = screen.getAllByTestId("marker");
    const byLabel: (needle: string) => HTMLElement = (
      needle: string,
    ): HTMLElement => {
      const found: HTMLElement | undefined = markers.find(
        (marker: HTMLElement) => {
          return (marker.textContent || "").includes(needle);
        },
      );
      if (!found) {
        throw new Error(`no marker containing ${needle}`);
      }
      return found;
    };

    const incident: HTMLElement = byLabel("Incident: API is down");
    expect(incident.dataset["color"]).toBe("#123456");
    expect(incident.dataset["dash"]).toBe("solid");
    expect(incident.dataset["clickable"]).toBe("yes");

    // Alert without a severity color falls back to amber.
    expect(byLabel("Alert: High latency").dataset["color"]).toBe("#fbbf24");

    const deploy: HTMLElement = byLabel("Deploy: v2.31.0");
    expect(deploy.dataset["color"]).toBe("#6366f1");
    expect(deploy.dataset["dash"]).toBe("4 4");
    // Change events have no detail page — no dead-end click handler.
    expect(deploy.dataset["clickable"]).toBe("no");
  });

  test("markers carry the kind and subtitle the rail chip reads", async () => {
    /*
     * `kind` is what lets a chip holding a deploy AND an incident paint
     * itself as the incident; `subtitle` is the card's second line. Both
     * are additions — the label strings the surfaces reverse-engineer are
     * deliberately unchanged.
     */
    getListMock.mockImplementation((args: { modelType: { name: string } }) => {
      if (args.modelType.name === "Incident") {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID("11111111-0000-4000-8000-000000000001"),
              createdAt: "2026-08-20T10:10:00.000Z",
              title: "API is down",
              incidentSeverity: { name: "Sev1", color: "#123456" },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            id: new ObjectID("22222222-0000-4000-8000-000000000002"),
            createdAt: "2026-08-20T10:20:00.000Z",
            title: "High latency",
            alertSeverity: { name: "Warning" },
          },
        ],
      });
    });
    analyticsGetListMock.mockResolvedValue({
      data: [
        {
          time: "2026-08-20T10:03:00.000Z",
          title: "v2.31.0",
          eventType: "deployment",
        },
      ],
    });

    render(<Probe enabled={true} window={WINDOW} />);

    await waitFor(() => {
      expect(screen.getByTestId("marker-count").textContent).toBe("3");
    });

    const markers: Array<HTMLElement> = screen.getAllByTestId("marker");
    const byLabel: (needle: string) => HTMLElement = (
      needle: string,
    ): HTMLElement => {
      const found: HTMLElement | undefined = markers.find(
        (marker: HTMLElement) => {
          return (marker.textContent || "").includes(needle);
        },
      );
      if (!found) {
        throw new Error(`no marker containing ${needle}`);
      }
      return found;
    };

    const incident: HTMLElement = byLabel("Incident: API is down");
    expect(incident.dataset["kind"]).toBe("incident");
    expect(incident.dataset["subtitle"]).toBe("Incident · Sev1");

    const alert: HTMLElement = byLabel("Alert: High latency");
    expect(alert.dataset["kind"]).toBe("alert");
    expect(alert.dataset["subtitle"]).toBe("Alert · Warning");

    const deploy: HTMLElement = byLabel("Deploy: v2.31.0");
    expect(deploy.dataset["kind"]).toBe("change");
    expect(deploy.dataset["subtitle"]).toBe("Change event");
  });

  test("a severity with no name still names the marker's kind", async () => {
    getListMock.mockImplementation((args: { modelType: { name: string } }) => {
      if (args.modelType.name === "Incident") {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID("11111111-0000-4000-8000-000000000001"),
              createdAt: "2026-08-20T10:10:00.000Z",
              title: "API is down",
              incidentSeverity: undefined,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    analyticsGetListMock.mockResolvedValue({ data: [] });

    render(<Probe enabled={true} window={WINDOW} />);

    await waitFor(() => {
      expect(screen.getByTestId("marker-count").textContent).toBe("1");
    });

    const marker: HTMLElement = screen.getAllByTestId("marker")[0]!;
    expect(marker.dataset["kind"]).toBe("incident");
    expect(marker.dataset["subtitle"]).toBe("Incident");
  });

  test("a long title keeps enough of itself to be recognisable", () => {
    /*
     * The cap exists so a card listing a dozen clustered events stays
     * scannable, not because the label has to fit inside the plot any
     * more — it is generous now, and only bites well past a real title.
     */
    const ordinary: string = "Checkout API p99 latency breached its SLO";
    expect(truncateEventMarkerTitle(ordinary)).toBe(ordinary);

    const overlong: string = "x".repeat(EVENT_MARKER_TITLE_MAX_LENGTH + 20);
    const truncated: string = truncateEventMarkerTitle(overlong);
    expect(truncated.endsWith("…")).toBe(true);
    expect(truncated.length).toBeLessThanOrEqual(
      EVENT_MARKER_TITLE_MAX_LENGTH + 1,
    );
  });

  test("one source failing never takes the others down", async () => {
    getListMock.mockImplementation((args: { modelType: { name: string } }) => {
      if (args.modelType.name === "Incident") {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID("11111111-0000-4000-8000-000000000001"),
              createdAt: "2026-08-20T10:10:00.000Z",
              title: "Still here",
              incidentSeverity: undefined,
            },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });
    analyticsGetListMock.mockRejectedValue(new Error("clickhouse hiccup"));

    render(<Probe enabled={true} window={WINDOW} />);

    await waitFor(() => {
      expect(screen.getByTestId("marker-count").textContent).toBe("1");
    });
    expect(screen.getByText(/Incident: Still here/)).toBeInTheDocument();
  });

  test("public dashboards fetch nothing at all", async () => {
    isPublicDashboardMock.mockReturnValue(true);

    render(<Probe enabled={true} window={WINDOW} />);

    // Give any (wrong) fetch a chance to fire.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });

    expect(getListMock).not.toHaveBeenCalled();
    expect(analyticsGetListMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("marker-count").textContent).toBe("0");
  });

  test("disabled and windowless states fetch nothing and yield no lines", async () => {
    render(<Probe enabled={false} window={WINDOW} />);
    render(<Probe enabled={true} window={null} />);

    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });

    expect(getListMock).not.toHaveBeenCalled();
    expect(analyticsGetListMock).not.toHaveBeenCalled();
  });
});

/*
 * The incident or alert a page is about is marked by the page itself (its
 * declared, acknowledged and resolved moments: issue #5954), so the hook
 * leaves it off the markers it reads, and keeps every other one.
 */
describe("useEventTimeReferenceLines: leaving out the page's own event", () => {
  const THIS_INCIDENT_ID: string = "11111111-0000-4000-8000-000000000001";
  const OTHER_INCIDENT_ID: string = "33333333-0000-4000-8000-000000000003";
  const THIS_ALERT_ID: string = "22222222-0000-4000-8000-000000000002";

  function ExcludingProbe(props: {
    excludedIncidentIds?: Array<string> | undefined;
    excludedAlertIds?: Array<string> | undefined;
  }): React.ReactElement {
    const { lines }: EventTimeReferenceLines = useEventTimeReferenceLines({
      enabled: true,
      window: WINDOW,
      excludedIncidentIds: props.excludedIncidentIds,
      excludedAlertIds: props.excludedAlertIds,
    });

    return (
      <div data-testid="excluding-probe" data-count={lines.length}>
        {lines.map((line: ChartTimeReferenceLineProps, index: number) => {
          return (
            <div key={index} data-testid="excluding-marker">
              {line.label}
            </div>
          );
        })}
      </div>
    );
  }

  beforeEach(() => {
    getListMock.mockImplementation((args: { modelType: { name: string } }) => {
      if (args.modelType.name === "Incident") {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID(THIS_INCIDENT_ID),
              createdAt: "2026-08-20T10:10:00.000Z",
              title: "This incident",
            },
            {
              id: new ObjectID(OTHER_INCIDENT_ID),
              createdAt: "2026-08-20T10:30:00.000Z",
              title: "Another incident",
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            id: new ObjectID(THIS_ALERT_ID),
            createdAt: "2026-08-20T10:20:00.000Z",
            title: "This alert",
          },
        ],
      });
    });
    analyticsGetListMock.mockResolvedValue({ data: [] });
  });

  async function markerLabels(): Promise<Array<string>> {
    await waitFor(() => {
      expect(
        Number(
          screen.getByTestId("excluding-probe").getAttribute("data-count"),
        ),
      ).toBeGreaterThan(0);
    });

    return screen
      .getAllByTestId("excluding-marker")
      .map((marker: HTMLElement): string => {
        return marker.textContent || "";
      })
      .sort();
  }

  test("nothing left out reads every event, as before", async () => {
    render(<ExcludingProbe />);

    expect(await markerLabels()).toEqual([
      "Alert: This alert",
      "Incident: Another incident",
      "Incident: This incident",
    ]);
  });

  test("an incident's page leaves its incident off, and keeps the others", async () => {
    render(<ExcludingProbe excludedIncidentIds={[THIS_INCIDENT_ID]} />);

    expect(await markerLabels()).toEqual([
      "Alert: This alert",
      "Incident: Another incident",
    ]);
  });

  test("an alert's page leaves its alert off", async () => {
    render(<ExcludingProbe excludedAlertIds={[THIS_ALERT_ID]} />);

    expect(await markerLabels()).toEqual([
      "Incident: Another incident",
      "Incident: This incident",
    ]);
  });

  test("an id of one kind never leaves out an event of the other", async () => {
    render(<ExcludingProbe excludedAlertIds={[THIS_INCIDENT_ID]} />);

    expect(await markerLabels()).toEqual([
      "Alert: This alert",
      "Incident: Another incident",
      "Incident: This incident",
    ]);
  });
});

/*
 * A dashboard widget's live preview, in its settings dialog, is drawn over
 * a board being edited, and nothing asks before leaving a board with
 * widgets not saved yet (issue #6859). There an incident's or an alert's
 * marker is drawn as on the board, and its click opens nothing
 * (opensEvents: false). Anywhere else - the option left out - it opens the
 * event, as it always has.
 */
describe("useEventTimeReferenceLines: markers that open nothing (opensEvents)", () => {
  const INCIDENT_ID: string = "11111111-0000-4000-8000-000000006859";
  const ALERT_ID: string = "22222222-0000-4000-8000-000000006859";

  function OpeningProbe(props: {
    opensEvents?: boolean | undefined;
  }): React.ReactElement {
    const { lines, markerCount }: EventTimeReferenceLines =
      useEventTimeReferenceLines({
        enabled: true,
        window: WINDOW,
        opensEvents: props.opensEvents,
      });

    return (
      <div data-testid="opening-probe" data-count={markerCount}>
        {lines.map((line: ChartTimeReferenceLineProps, index: number) => {
          return (
            <button
              key={index}
              type="button"
              data-testid="opening-marker"
              data-clickable={line.onClick ? "yes" : "no"}
              data-color={line.color}
              data-kind={line.kind || "none"}
              onClick={() => {
                line.onClick?.();
              }}
            >
              {line.label}
            </button>
          );
        })}
      </div>
    );
  }

  let navigateSpy: SpyInstance<typeof Navigation.navigate>;

  beforeEach(() => {
    navigateSpy = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    getListMock.mockImplementation((args: { modelType: { name: string } }) => {
      if (args.modelType.name === "Incident") {
        return Promise.resolve({
          data: [
            {
              id: new ObjectID(INCIDENT_ID),
              createdAt: "2026-08-20T10:10:00.000Z",
              title: "API is down",
              incidentSeverity: { color: "#123456" },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            id: new ObjectID(ALERT_ID),
            createdAt: "2026-08-20T10:20:00.000Z",
            title: "High latency",
          },
        ],
      });
    });
    analyticsGetListMock.mockResolvedValue({
      data: [
        {
          time: "2026-08-20T10:03:00.000Z",
          title: "v2.31.0",
          eventType: "deployment",
        },
      ],
    });
  });

  async function openingMarkers(): Promise<Array<HTMLElement>> {
    await waitFor(() => {
      expect(
        screen.getByTestId("opening-probe").getAttribute("data-count"),
      ).toBe("3");
    });

    return screen.getAllByTestId("opening-marker");
  }

  function markerNamed(
    markers: Array<HTMLElement>,
    label: string,
  ): HTMLElement {
    const found: HTMLElement | undefined = markers.find(
      (marker: HTMLElement): boolean => {
        return marker.textContent === label;
      },
    );

    if (!found) {
      throw new Error(`no marker named ${label}`);
    }

    return found;
  }

  test("left out, an incident's and an alert's markers open them", async () => {
    render(<OpeningProbe />);

    const markers: Array<HTMLElement> = await openingMarkers();
    const incident: HTMLElement = markerNamed(markers, "Incident: API is down");
    const alert: HTMLElement = markerNamed(markers, "Alert: High latency");

    expect(incident.dataset["clickable"]).toBe("yes");
    expect(alert.dataset["clickable"]).toBe("yes");
    expect(markerNamed(markers, "Deploy: v2.31.0").dataset["clickable"]).toBe(
      "no",
    );

    fireEvent.click(incident);
    fireEvent.click(alert);

    expect(navigateSpy).toHaveBeenCalledTimes(2);
    expect(String(navigateSpy.mock.calls[0]?.[0])).toContain(INCIDENT_ID);
    expect(String(navigateSpy.mock.calls[1]?.[0])).toContain(ALERT_ID);
  });

  test("true is the same as left out", async () => {
    render(<OpeningProbe opensEvents={true} />);

    const markers: Array<HTMLElement> = await openingMarkers();

    fireEvent.click(markerNamed(markers, "Incident: API is down"));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(String(navigateSpy.mock.calls[0]?.[0])).toContain(INCIDENT_ID);
  });

  test("false: every marker drawn as it is, and none opens anything", async () => {
    render(<OpeningProbe opensEvents={false} />);

    const markers: Array<HTMLElement> = await openingMarkers();

    expect(
      markers.map((marker: HTMLElement): string => {
        return marker.textContent || "";
      }),
    ).toEqual(
      expect.arrayContaining([
        "Incident: API is down",
        "Alert: High latency",
        "Deploy: v2.31.0",
      ]),
    );

    for (const marker of markers) {
      expect(marker.dataset["clickable"]).toBe("no");
      fireEvent.click(marker);
    }

    // Each keeps its colour and its kind: only the click is gone.
    const incident: HTMLElement = markerNamed(markers, "Incident: API is down");
    expect(incident.dataset["color"]).toBe("#123456");
    expect(incident.dataset["kind"]).not.toBe("none");
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  test("turned off and on again, the markers stay and nothing is read again", async () => {
    const { rerender } = render(<OpeningProbe />);

    await openingMarkers();

    const incidentReads: number = getListMock.mock.calls.length;
    const changeReads: number = analyticsGetListMock.mock.calls.length;

    rerender(<OpeningProbe opensEvents={false} />);

    let markers: Array<HTMLElement> = screen.getAllByTestId("opening-marker");
    expect(markers).toHaveLength(3);
    expect(
      markerNamed(markers, "Incident: API is down").dataset["clickable"],
    ).toBe("no");

    rerender(<OpeningProbe opensEvents={true} />);

    markers = screen.getAllByTestId("opening-marker");
    expect(markers).toHaveLength(3);
    expect(
      markerNamed(markers, "Incident: API is down").dataset["clickable"],
    ).toBe("yes");

    expect(getListMock.mock.calls.length).toBe(incidentReads);
    expect(analyticsGetListMock.mock.calls.length).toBe(changeReads);
  });
});
