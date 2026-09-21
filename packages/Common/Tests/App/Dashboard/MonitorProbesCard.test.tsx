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
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import MonitorProbesCard, {
  ComponentProps,
  getProbeHealthText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard";
import { PROBE_HEALTH_TEXT_CLASS } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTones";
import { MonitorOverviewProbeData } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  failSection,
  forbidSection,
  getLoadingSection,
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import MonitorOverviewProbeUtil, {
  MonitorOverviewProbeHealth,
  MonitorOverviewProbeRow,
  MonitorOverviewProbeSummary,
} from "../../../Utils/Monitor/MonitorOverviewProbeUtil";

/*
 * Where the monitor is checked from. The rows come from the real
 * summarizeProbes over real MonitorProbe rows, so this pins the whole path
 * from what the API returns to what the card says: attention-first order,
 * the per-health wording and colour, "Checked" from the result time (not
 * the claim time), and the states where the probes could not be read.
 */

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBJECT: string = MONITOR_ID.toString();
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
};

let probeCounter: number = 0;

const monitorProbe: (data: {
  name: string;
  isEnabled?: boolean | undefined;
  connectionStatus?: ProbeConnectionStatus | undefined;
  result?:
    | {
        monitoredAt: Date;
        isOnline?: boolean | undefined;
        responseTimeInMs?: number | undefined;
        failureCause?: string | undefined;
      }
    | undefined;
  lastPingAt?: Date | undefined;
  nextPingAt?: Date | undefined;
}) => MonitorProbe = (data: {
  name: string;
  isEnabled?: boolean | undefined;
  connectionStatus?: ProbeConnectionStatus | undefined;
  result?:
    | {
        monitoredAt: Date;
        isOnline?: boolean | undefined;
        responseTimeInMs?: number | undefined;
        failureCause?: string | undefined;
      }
    | undefined;
  lastPingAt?: Date | undefined;
  nextPingAt?: Date | undefined;
}): MonitorProbe => {
  probeCounter += 1;
  const probeId: string = `bbbbbbbb-0000-4000-8000-${String(probeCounter).padStart(12, "0")}`;

  const probe: Probe = new Probe();
  probe._id = probeId;
  probe.name = data.name;
  probe.connectionStatus =
    data.connectionStatus || ProbeConnectionStatus.Connected;

  const row: MonitorProbe = new MonitorProbe();
  row.probeId = new ObjectID(probeId);
  row.isEnabled = data.isEnabled !== false;
  row.probe = probe;

  if (data.lastPingAt) {
    row.lastPingAt = data.lastPingAt;
  }

  if (data.nextPingAt) {
    row.nextPingAt = data.nextPingAt;
  }

  if (data.result) {
    row.lastMonitoringLog = {
      [STEP_ID]: {
        probeId: probeId,
        monitorStepId: STEP_ID,
        ...data.result,
      },
    } as unknown as MonitorStepProbeResponse;
  }

  return row;
};

const summarize: (rows: Array<MonitorProbe>) => MonitorOverviewProbeSummary = (
  rows: Array<MonitorProbe>,
): MonitorOverviewProbeSummary => {
  return MonitorOverviewProbeUtil.summarizeProbes({
    monitorProbes: rows,
    validStepIds: new Set<string>([STEP_ID]),
    primaryStepId: STEP_ID,
    cadenceSeconds: 300,
    now: NOW,
  });
};

const loaded: (
  rows: Array<MonitorProbe>,
) => OverviewSection<MonitorOverviewProbeData> = (
  rows: Array<MonitorProbe>,
): OverviewSection<MonitorOverviewProbeData> => {
  return resolveSection<MonitorOverviewProbeData>({
    value: {
      rows: rows,
      attached: MonitorOverviewProbeUtil.toAttachedProbes(rows),
      fullLoadedAt: NOW,
    },
    subjectId: SUBJECT,
  });
};

const renderCard: (props: Partial<ComponentProps>) => void = (
  props: Partial<ComponentProps>,
): void => {
  render(
    <MemoryRouter>
      <MonitorProbesCard
        monitorId={MONITOR_ID}
        probes={props.probes || loaded([])}
        summary={props.summary === undefined ? null : props.summary}
        minimumProbeAgreement={props.minimumProbeAgreement}
      />
    </MemoryRouter>,
  );
};

const renderRows: (
  rows: Array<MonitorProbe>,
  minimumProbeAgreement?: number,
) => void = (
  rows: Array<MonitorProbe>,
  minimumProbeAgreement?: number,
): void => {
  renderCard({
    probes: loaded(rows),
    summary: summarize(rows),
    minimumProbeAgreement: minimumProbeAgreement,
  });
};

const PROBES_ROUTE: () => string = (): string => {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_VIEW_PROBES] as Route,
    { modelId: MONITOR_ID },
  ).toString();
};

// One probe in every health state, deliberately in the wrong order.
const EVERY_HEALTH: () => Array<MonitorProbe> = (): Array<MonitorProbe> => {
  return [
    monitorProbe({
      name: "Attic",
      isEnabled: false,
      result: { monitoredAt: minutesAgo(600), isOnline: true },
    }),
    monitorProbe({
      name: "London",
      result: {
        monitoredAt: minutesAgo(1),
        isOnline: true,
        responseTimeInMs: 118.6,
      },
      nextPingAt: minutesAgo(-4),
    }),
    monitorProbe({ name: "Mumbai", lastPingAt: minutesAgo(1) }),
    monitorProbe({
      name: "Oregon",
      result: { monitoredAt: minutesAgo(60), isOnline: true },
    }),
    monitorProbe({
      name: "Paris",
      connectionStatus: ProbeConnectionStatus.Disconnected,
      result: { monitoredAt: minutesAgo(2), isOnline: true },
    }),
    monitorProbe({
      name: "Sydney",
      result: { monitoredAt: minutesAgo(2) },
    }),
    monitorProbe({
      name: "Ohio",
      result: {
        monitoredAt: minutesAgo(1),
        isOnline: false,
        failureCause: "Connection refused on port 443",
      },
    }),
  ];
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("MonitorProbesCard", () => {
  test("rows are sorted so what needs attention comes first", () => {
    renderRows(EVERY_HEALTH());

    const names: Array<string> = screen
      .getAllByTestId("probe-name")
      .map((element: HTMLElement) => {
        return (element.textContent || "").trim();
      });

    expect(names).toEqual([
      "Ohio",
      "Paris",
      "Oregon",
      "Mumbai",
      "London",
      "Sydney",
      "Attic",
    ]);
  });

  test("each health has its own words and colour", () => {
    renderRows(EVERY_HEALTH());

    // Only the colour class: the chip also carries size and alignment ones.
    const colourClass: RegExp = /^text-[a-z]+-\d{3}$/;

    const health: Array<[string, string]> = screen
      .getAllByTestId("monitor-probe-health")
      .map((element: HTMLElement): [string, string] => {
        return [
          element.textContent || "",
          Array.from(element.classList).find((name: string) => {
            return colourClass.test(name);
          }) || "",
        ];
      });

    expect(health).toEqual([
      ["Down", "text-red-700"],
      ["Disconnected", "text-red-700"],
      ["Late", "text-amber-700"],
      ["No result yet", "text-gray-500"],
      ["Up · 119 ms", "text-emerald-700"],
      ["Reported", "text-gray-700"],
      ["Turned off for this monitor", "text-gray-500"],
    ]);
  });

  test("every health state has a class and a text", () => {
    for (const health of Object.values(MonitorOverviewProbeHealth)) {
      expect(PROBE_HEALTH_TEXT_CLASS[health]).toMatch(/^text-/);

      const row: MonitorOverviewProbeRow = {
        probeId: "p",
        name: "P",
        isEnabled: true,
        isConnected: true,
        health: health,
      };
      expect(getProbeHealthText(row)).toBeTruthy();
    }
  });

  test("'Checked' is when the result arrived, with the next check when it is due", () => {
    renderRows(EVERY_HEALTH());

    const rows: Array<HTMLElement> = screen.getAllByTestId("monitor-probe-row");
    const london: HTMLElement = rows[4]!;

    expect(london).toHaveTextContent(
      "Checked a minute ago · next in 4 minutes",
    );
    const times: Array<Element> = Array.from(london.querySelectorAll("time"));
    expect(times[0]).toHaveAttribute("dateTime", minutesAgo(1).toISOString());
    expect(times[1]).toHaveAttribute("dateTime", minutesAgo(-4).toISOString());

    // Mumbai has claimed a check (lastPingAt) but sent no result.
    const mumbai: HTMLElement = rows[3]!;
    expect(mumbai).toHaveTextContent("No result yet");
    expect(mumbai).not.toHaveTextContent("Checked");
  });

  test("a switched-off probe never promises a next check", () => {
    renderRows([
      monitorProbe({
        name: "Attic",
        isEnabled: false,
        result: { monitoredAt: minutesAgo(10), isOnline: true },
        nextPingAt: minutesAgo(-5),
      }),
    ]);

    const row: HTMLElement = screen.getByTestId("monitor-probe-row");
    expect(row).toHaveTextContent("Checked 10 minutes ago");
    expect(row).not.toHaveTextContent("next");
  });

  test("a down probe shows why, clamped, with the full text on hover", () => {
    renderRows(EVERY_HEALTH());

    const cause: HTMLElement = screen.getByText(
      "Connection refused on port 443",
    );
    expect(cause).toHaveClass("line-clamp-2");
    expect(cause).toHaveAttribute("title", "Connection refused on port 443");
  });

  test("the agreement footnote appears only when it constrains anything", () => {
    const rows: Array<MonitorProbe> = [
      monitorProbe({
        name: "London",
        result: { monitoredAt: minutesAgo(1), isOnline: true },
      }),
      monitorProbe({
        name: "Ohio",
        result: { monitoredAt: minutesAgo(1), isOnline: true },
      }),
      monitorProbe({ name: "Attic", isEnabled: false }),
    ];

    renderRows(rows, 2);
    expect(
      screen.getByText("A status change needs both connected probes to agree."),
    ).toBeInTheDocument();
    cleanup();

    renderRows(rows, 1);
    expect(screen.queryByText(/probes to agree/)).toBeNull();
    cleanup();

    renderRows([rows[0]!], 2);
    expect(screen.queryByText(/probes to agree/)).toBeNull();
  });

  /*
   * The footnote states the rule the server applies: only enabled,
   * connected probes take part, an unset minimum means all of them, and the
   * minimum is capped at how many take part.
   */
  const connected: (name: string) => MonitorProbe = (
    name: string,
  ): MonitorProbe => {
    return monitorProbe({
      name: name,
      result: { monitoredAt: minutesAgo(1), isOnline: true },
    });
  };

  const agreementText: () => string | null = (): string | null => {
    return screen.queryByTestId("monitor-probe-agreement")?.textContent || null;
  };

  test("a minimum below the probes taking part reads as n of m", () => {
    renderRows([connected("London"), connected("Ohio"), connected("Tokyo")], 2);

    expect(agreementText()).toBe(
      "A status change needs 2 of 3 connected probes to agree.",
    );
  });

  test("a minimum above the probes taking part is capped, never 'needs 3 of 2'", () => {
    renderRows(
      [
        connected("London"),
        connected("Ohio"),
        monitorProbe({ name: "Attic", isEnabled: false }),
      ],
      3,
    );

    expect(agreementText()).toBe(
      "A status change needs both connected probes to agree.",
    );
  });

  test("a disconnected probe does not take part", () => {
    const rows: Array<MonitorProbe> = [
      connected("London"),
      connected("Ohio"),
      connected("Tokyo"),
      monitorProbe({
        name: "Sydney",
        connectionStatus: ProbeConnectionStatus.Disconnected,
        result: { monitoredAt: minutesAgo(90), isOnline: true },
      }),
    ];

    renderRows(rows, 2);
    expect(agreementText()).toBe(
      "A status change needs 2 of 3 connected probes to agree.",
    );
    cleanup();

    // 3 required of the three still connected is all of them, not 3 of 4.
    renderRows(rows, 3);
    expect(agreementText()).toBe(
      "A status change needs all 3 connected probes to agree.",
    );
  });

  test("with no minimum set, every connected probe must agree", () => {
    renderRows([connected("London"), connected("Ohio"), connected("Tokyo")]);

    expect(agreementText()).toBe(
      "A status change needs all 3 connected probes to agree.",
    );
  });

  test("no footnote when at most one probe takes part", () => {
    renderRows(
      [
        connected("London"),
        monitorProbe({
          name: "Ohio",
          connectionStatus: ProbeConnectionStatus.Disconnected,
        }),
      ],
      2,
    );

    expect(agreementText()).toBeNull();
  });

  test("Manage links to the monitor's Probes page", () => {
    renderRows(EVERY_HEALTH());

    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute(
      "href",
      PROBES_ROUTE(),
    );
    expect(screen.getByTestId("card-header")).toHaveAttribute(
      "data-header-layout",
      "stacked",
    );
  });

  test("no probes attached says so and offers to add one", () => {
    renderRows([]);

    expect(screen.getByText("No probes attached.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a probe" })).toHaveAttribute(
      "href",
      PROBES_ROUTE(),
    );
  });

  test("forbidden probes say why, never 'No probes attached.'", () => {
    renderCard({
      probes: forbidSection<MonitorOverviewProbeData>({
        reason: "No access",
        subjectId: SUBJECT,
      }),
      summary: null,
    });

    expect(
      screen.getByText(
        "Probes are hidden: you need permission to read this monitor's probes.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("No probes attached.")).toBeNull();
  });

  test("a failed read says what went wrong", () => {
    renderCard({
      probes: failSection<MonitorOverviewProbeData>({
        previous: getLoadingSection<MonitorOverviewProbeData>(),
        message: "Server error.",
        subjectId: SUBJECT,
      }),
      summary: null,
    });

    expect(
      screen.getByText("Couldn't load probes. Server error."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No probes attached.")).toBeNull();
  });

  test("while loading it shows placeholders", () => {
    renderCard({
      probes: getLoadingSection<MonitorOverviewProbeData>(),
      summary: null,
    });

    expect(
      screen.getByRole("status", { name: "Loading probes" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No probes attached.")).toBeNull();
  });

  test("a failed refresh keeps the rows and notes it", () => {
    const rows: Array<MonitorProbe> = EVERY_HEALTH();

    renderCard({
      probes: failSection<MonitorOverviewProbeData>({
        previous: loaded(rows),
        message: "Timeout.",
        subjectId: SUBJECT,
      }),
      summary: summarize(rows),
    });

    expect(screen.getAllByTestId("monitor-probe-row")).toHaveLength(7);
    expect(
      screen.getByText("Couldn't refresh probes. Timeout."),
    ).toBeInTheDocument();
  });

  test("each row names its probe", () => {
    renderRows(EVERY_HEALTH());

    const row: HTMLElement = screen.getAllByTestId("monitor-probe-row")[0]!;
    expect(within(row).getByTestId("probe-name")).toHaveTextContent("Ohio");
  });
});
