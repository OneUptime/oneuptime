/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import arabicLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/ar.json";
import MonitorProbesCard, {
  ComponentProps,
  getProbeAgreementText,
  getProbeHealthParts,
  getProbeHealthText,
  PROBE_HEALTH_CLASS_NAME,
  PROBE_HEALTH_FIGURE_CLASS_NAME,
  PROBE_HEALTH_WORDS,
  PROBE_ROW_CLASS_NAME,
  PROBE_ROW_DETAILS_CLASS_NAME,
  PROBE_ROWS_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorProbesCard";
import {
  PROBE_TIMEOUT_FAILURE_CAUSE,
  writeProbeTimeoutFailureCause,
} from "../../../Utils/Monitor/ProbeFailureReading";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";
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
        now={props.now || NOW}
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
      expect(
        getProbeHealthText(row, createTranslator(undefined, "en")),
      ).toBeTruthy();
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

  /*
   * A paused monitor's rows are set aside by the probes' claim a quarter of
   * an hour at a time, so their nextPingAt is in the future without being a
   * check that will happen (Server/Utils/Probe/ClaimSetAside).
   */
  test("a paused monitor's probe never promises a next check", () => {
    const rows: Array<MonitorProbe> = [
      monitorProbe({
        name: "London",
        isEnabled: true,
        result: { monitoredAt: minutesAgo(30), isOnline: true },
        nextPingAt: minutesAgo(-12),
      }),
    ];

    renderCard({
      probes: loaded(rows),
      summary: MonitorOverviewProbeUtil.summarizeProbes({
        monitorProbes: rows,
        validStepIds: new Set<string>([STEP_ID]),
        primaryStepId: STEP_ID,
        cadenceSeconds: 300,
        now: NOW,
        isScheduled: false,
      }),
    });

    const row: HTMLElement = screen.getByTestId("monitor-probe-row");
    expect(row).toHaveTextContent("Checked 30 minutes ago");
    expect(row).not.toHaveTextContent("next");
  });

  test("whether a next check is still ahead is judged at the summary's now, not the browser's clock", () => {
    // The browser's clock is ten minutes slow; the summary was judged at NOW.
    jest.setSystemTime(minutesAgo(10));

    const rows: Array<MonitorProbe> = [
      monitorProbe({
        name: "London",
        result: { monitoredAt: minutesAgo(3), isOnline: true },
        // Two minutes past on the server's clock, eight ahead on the browser's.
        nextPingAt: minutesAgo(2),
      }),
      monitorProbe({
        name: "Oregon",
        result: { monitoredAt: minutesAgo(1), isOnline: true },
        nextPingAt: minutesAgo(-4),
      }),
    ];

    renderCard({ probes: loaded(rows), summary: summarize(rows), now: NOW });

    const rowFor: (name: string) => HTMLElement = (
      name: string,
    ): HTMLElement => {
      return screen
        .getAllByTestId("monitor-probe-row")
        .find((row: HTMLElement) => {
          return (
            within(row).getByTestId("probe-name").textContent?.trim() === name
          );
        })!;
    };
    const london: HTMLElement = rowFor("London");
    const oregon: HTMLElement = rowFor("Oregon");

    // The hero would not promise London's next check either.
    expect(london).not.toHaveTextContent("next");
    expect(oregon).toHaveTextContent("next");
  });

  test("a down probe shows why, clamped, with the full text on hover", () => {
    renderRows(EVERY_HEALTH());

    const cause: HTMLElement = screen.getByText(
      "Connection refused on port 443",
    );
    expect(cause).toHaveClass("line-clamp-2");
    expect(cause).toHaveAttribute("title", "Connection refused on port 443");
  });

  /*
   * The card sits in a third of the overview at 1280px (a body about 14rem
   * wide). A state kept on one line beside the name - "Turned off for this
   * monitor", "Für diesen Monitor ausgeschaltet" - squeezed the probe's name
   * to a letter a line. So the list is a container: under 22rem a row is
   * one column (name, then its state, then when it was checked), and from
   * 22rem the state sits beside the name, at most 10rem wide, with the
   * details under both. jsdom lays nothing out, so the classes that do it
   * are pinned, and the order the narrow column reads in.
   */
  test("a row reads name, state, details: the state under the name in a narrow card, beside it from 22rem", () => {
    renderRows(EVERY_HEALTH());

    const list: HTMLElement = screen.getByRole("list", { name: "Probes" });

    expect(list).toHaveClass("[container-type:inline-size]");
    expect(PROBE_ROWS_CLASS_NAME.split(" ")).toContain(
      "[container-type:inline-size]",
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("monitor-probe-row");

    expect(rows).toHaveLength(7);

    for (const row of rows) {
      // One column under 22rem; the name and its state side by side from it.
      expect(row).toHaveClass(
        "grid",
        "grid-cols-1",
        "[@container(min-width:22rem)]:grid-cols-[minmax(0,1fr)_auto]",
      );
      expect(row).not.toHaveClass("flex");

      const parts: Array<Element> = Array.from(row.children);

      expect(parts).toHaveLength(3);
      expect(within(parts[0] as HTMLElement).getByTestId("probe-name")).toBe(
        within(row).getByTestId("probe-name"),
      );
      expect(parts[1]).toBe(within(row).getByTestId("monitor-probe-health"));
      expect(parts[2]).toBe(within(row).getByTestId("monitor-probe-details"));

      // The state: under the name, or at the row's end, capped at 10rem.
      expect(parts[1]).toHaveClass(
        "mt-1",
        "[@container(min-width:22rem)]:mt-0",
        "[@container(min-width:22rem)]:max-w-[10rem]",
        "[@container(min-width:22rem)]:text-right",
      );
      // Never kept on one line whatever its length.
      expect(parts[1]).not.toHaveClass("flex-shrink-0");
      expect(parts[1]).not.toHaveClass("whitespace-nowrap");

      // When it was checked and why it failed: the full width of the row.
      expect(parts[2]).toHaveClass(
        "min-w-0",
        "[@container(min-width:22rem)]:col-span-2",
      );
    }

    // The failure line is one of the details, under both.
    expect(
      within(rows[0]!.lastElementChild as HTMLElement).getByTestId(
        "monitor-probe-failure-cause",
      ),
    ).toHaveTextContent("Connection refused on port 443");

    expect(PROBE_ROW_CLASS_NAME).toContain(
      "[@container(min-width:22rem)]:grid-cols-[minmax(0,1fr)_auto]",
    );
    expect(PROBE_HEALTH_CLASS_NAME).toContain(
      "[@container(min-width:22rem)]:max-w-[10rem]",
    );
    expect(PROBE_ROW_DETAILS_CLASS_NAME).toContain(
      "[@container(min-width:22rem)]:col-span-2",
    );
  });

  /*
   * A state that wraps (beside a long name, or a long word in a narrow
   * card) wraps between its facts: an up probe's time is one figure with
   * its unit, moved whole to the next line ("Up ·" / "119 ms").
   */
  test("an up probe's time never breaks from its unit, and the state reads as one line", () => {
    renderRows(EVERY_HEALTH());

    const health: Array<HTMLElement> = screen.getAllByTestId(
      "monitor-probe-health",
    );
    const london: HTMLElement = health[4]!;
    const figure: Element | null = london.querySelector("span");

    expect(london).toHaveTextContent("Up · 119 ms");
    expect(figure).toHaveTextContent("119 ms");
    expect(figure).toHaveClass(PROBE_HEALTH_FIGURE_CLASS_NAME);
    expect(PROBE_HEALTH_FIGURE_CLASS_NAME).toBe("whitespace-nowrap");
    // "Up" and its separator are not inside the kept-whole part.
    expect(figure!.textContent).toBe("119 ms");

    // A state with no time has no part kept whole.
    for (const index of [0, 1, 2, 3, 5, 6]) {
      expect(health[index]!.querySelector("span")).toBeNull();
    }
  });

  /*
   * A probe that has sent nothing and has no check ahead used to say "No
   * result yet" twice: its state, and the line under it. The state says it
   * once; a probe that is disconnected or turned off with no result still
   * says so under its state.
   */
  test("a probe with no result says 'No result yet' once, as its state", () => {
    renderRows([
      monitorProbe({ name: "Mumbai", lastPingAt: minutesAgo(1) }),
      monitorProbe({
        name: "Paris",
        connectionStatus: ProbeConnectionStatus.Disconnected,
      }),
    ]);

    const rows: Array<HTMLElement> = screen.getAllByTestId("monitor-probe-row");
    const mumbai: HTMLElement = rows.find((row: HTMLElement) => {
      return row.textContent?.includes("Mumbai");
    })!;
    const paris: HTMLElement = rows.find((row: HTMLElement) => {
      return row.textContent?.includes("Paris");
    })!;

    expect(
      within(mumbai).getByTestId("monitor-probe-health"),
    ).toHaveTextContent("No result yet");
    expect(mumbai.textContent!.split("No result yet")).toHaveLength(2);
    expect(
      within(mumbai).getByTestId("monitor-probe-details"),
    ).toBeEmptyDOMElement();

    expect(within(paris).getByTestId("monitor-probe-health")).toHaveTextContent(
      "Disconnected",
    );
    expect(
      within(paris).getByTestId("monitor-probe-details"),
    ).toHaveTextContent("No result yet");
  });

  /*
   * A new monitor's probes have sent nothing and each has a check ahead:
   * the state says "No result yet", the line under it only when the check
   * is due - never "No result yet" twice on every row. A probe in another
   * state with no result still says so on that line.
   */
  test("a probe with no result but a check ahead says when it is due, and 'No result yet' once", () => {
    renderRows([
      monitorProbe({
        name: "Mumbai",
        lastPingAt: minutesAgo(1),
        nextPingAt: minutesAgo(-4),
      }),
    ]);

    const row: HTMLElement = screen.getByTestId("monitor-probe-row");

    expect(within(row).getByTestId("monitor-probe-health")).toHaveTextContent(
      "No result yet",
    );
    expect(within(row).getByTestId("monitor-probe-details")).toHaveTextContent(
      /^Next check in 4 minutes$/,
    );
    expect(row.textContent!.split("No result yet")).toHaveLength(2);
  });

  test("a disconnected probe with no result and a check ahead keeps 'No result yet' on its line", () => {
    renderRows([
      monitorProbe({
        name: "Paris",
        connectionStatus: ProbeConnectionStatus.Disconnected,
        nextPingAt: minutesAgo(-4),
      }),
    ]);

    const row: HTMLElement = screen.getByTestId("monitor-probe-row");

    expect(within(row).getByTestId("monitor-probe-health")).toHaveTextContent(
      "Disconnected",
    );
    expect(within(row).getByTestId("monitor-probe-details")).toHaveTextContent(
      "No result yet · next in 4 minutes",
    );
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

/*
 * The card as a reader of another language sees it (#7416), rendered with
 * the Dashboard's real locale files: each probe's state is the reader's
 * word for it - the hero's word for the same state - an up probe's
 * response time is written as every monitor summary writes a duration, in
 * the language's digits and unit, and the counts in the agreement
 * footnote are the language's digits. A probe's own message stays as it
 * wrote it, read left to right on an Arabic or Persian page.
 */
const LOCALES: Record<string, Record<string, unknown>> = {
  en: englishLocale as Record<string, unknown>,
  de: germanLocale as Record<string, unknown>,
  fa: persianLocale as Record<string, unknown>,
  ar: arabicLocale as Record<string, unknown>,
};

const instances: Record<string, i18n> = {};

const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const locale: Record<string, unknown> = LOCALES[language]!;

  return createTranslator((text: string): string | undefined => {
    const value: unknown = locale[text];

    return typeof value === "string" ? value : undefined;
  }, language);
};

const renderRowsIn: (
  language: string,
  rows: Array<MonitorProbe>,
  minimumProbeAgreement?: number,
) => void = (
  language: string,
  rows: Array<MonitorProbe>,
  minimumProbeAgreement?: number,
): void => {
  setDateDisplayLanguage(language);

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <MonitorProbesCard
          monitorId={MONITOR_ID}
          probes={loaded(rows)}
          summary={summarize(rows)}
          now={NOW}
          minimumProbeAgreement={minimumProbeAgreement}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
};

// A probe that is on, connected and up.
const upProbe: (name: string) => MonitorProbe = (
  name: string,
): MonitorProbe => {
  return monitorProbe({
    name: name,
    result: { monitoredAt: minutesAgo(1), isOnline: true },
  });
};

const healthTexts: () => Array<string> = (): Array<string> => {
  return screen
    .getAllByTestId("monitor-probe-health")
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
};

describe("MonitorProbesCard in the reader's language", () => {
  beforeAll(async () => {
    for (const [language, locale] of Object.entries(LOCALES)) {
      const instance: i18n = createInstance();

      // The Dashboard's own configuration (Utils/i18n.ts).
      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: englishLocale },
          [language]: { translation: locale },
        },
        interpolation: { escapeValue: false },
      });

      instances[language] = instance;
    }
  });

  afterEach(() => {
    setDateDisplayLanguage(null);
    forgetRememberedDateTexts();
  });

  test("English reads as it always did", () => {
    renderRowsIn("en", EVERY_HEALTH());

    expect(healthTexts()).toEqual([
      "Down",
      "Disconnected",
      "Late",
      "No result yet",
      "Up · 119 ms",
      "Reported",
      "Turned off for this monitor",
    ]);
  });

  test("German: each state in German, the hero's words for it", () => {
    renderRowsIn("de", EVERY_HEALTH());

    expect(healthTexts()).toEqual([
      "Ausgefallen",
      "Getrennt",
      "Verspätet",
      "Noch kein Ergebnis",
      // "Up" is drawn as the German network pages and docs draw it.
      "Up · 119 ms",
      "Gemeldet",
      "Für diesen Monitor ausgeschaltet",
    ]);
  });

  test("Persian: no English word, Persian digits and unit, a bullet between", () => {
    renderRowsIn("fa", EVERY_HEALTH());

    const texts: Array<string> = healthTexts();

    expect(texts).toHaveLength(7);
    for (const text of texts) {
      expect(text).not.toMatch(/[A-Za-z0-9]/);
    }
    expect(texts[4]).toBe("فعال \u2022 ۱۱۹ میلی\u200cثانیه");
  });

  test("Arabic: the unit as Arabic writes it, never a Latin ms", () => {
    renderRowsIn("ar", EVERY_HEALTH());

    const texts: Array<string> = healthTexts();

    expect(texts[4]).toBe("يعمل · 119 ملي ث");
    expect(texts[6]).toBe("معطّل لهذه المراقبة");
    for (const text of texts) {
      expect(text).not.toMatch(/[A-Za-z]/);
    }
  });

  test("Persian: the agreement footnote counts in Persian digits", () => {
    renderRowsIn(
      "fa",
      [upProbe("London"), upProbe("Ohio"), upProbe("Tokyo")],
      2,
    );

    const footnote: string =
      screen.getByTestId("monitor-probe-agreement").textContent || "";

    expect(footnote).toBe(
      translatorFor("fa").translateTemplate(
        "A status change needs {{required}} of {{count}} connected probes to agree.",
        { required: "۲", count: "۳" },
      ),
    );
    expect(footnote).toContain("۲");
    expect(footnote).toContain("۳");
    expect(footnote).not.toMatch(/[0-9]/);
  });

  test("a probe's English message reads left to right on an Arabic or Persian page, and as the page on an English one", () => {
    for (const language of ["ar", "fa"]) {
      renderRowsIn(language, EVERY_HEALTH());

      const cause: HTMLElement = screen.getByTestId(
        "monitor-probe-failure-cause",
      );

      expect(cause).toHaveTextContent("Connection refused on port 443");
      expect(cause).toHaveAttribute("dir", "ltr");
      // Still clamped to two lines, with the whole message on hover.
      expect(cause).toHaveClass("line-clamp-2");
      expect(cause).toHaveAttribute("title", "Connection refused on port 443");
      cleanup();
    }

    renderRowsIn("en", EVERY_HEALTH());
    expect(
      screen.getByTestId("monitor-probe-failure-cause"),
    ).not.toHaveAttribute("dir");
  });

  /*
   * #8003: the probe's own timeout sentence, which every monitor summary
   * draws in the reader's words since #7944, read in English on the
   * overview one click away. It is now the same words, the count in the
   * reader's digits, and on an Arabic or Persian page it reads as the page
   * does (no dir of its own); the whole sentence is its hover title.
   */
  const timedOutProbe: (triedCount: number) => MonitorProbe = (
    triedCount: number,
  ): MonitorProbe => {
    return monitorProbe({
      name: "Tokyo",
      result: {
        monitoredAt: minutesAgo(1),
        isOnline: false,
        failureCause: writeProbeTimeoutFailureCause(triedCount),
      },
    });
  };

  test.each([
    ["en", "Request was tried 3 times and it timed out."],
    [
      "de",
      "Die Anfrage wurde 3-mal versucht und hat das Zeitlimit überschritten.",
    ],
    ["fa", "درخواست ۳ بار امتحان شد و مهلت آن تمام شد."],
    ["ar", "عدد محاولات الطلب: 3، وانتهت مهلته."],
  ])(
    "%s: a probe's timeout sentence reads as every summary words it",
    (language: string, sentence: string) => {
      renderRowsIn(language, [timedOutProbe(3)]);

      const cause: HTMLElement = screen.getByTestId(
        "monitor-probe-failure-cause",
      );

      expect(withoutIsolateMarks(cause.textContent || "")).toBe(sentence);
      expect(withoutIsolateMarks(cause.getAttribute("title") || "")).toBe(
        sentence,
      );
      expect(sentence).toBe(
        withoutIsolateMarks(
          translatorFor(language).translatePlural(
            PROBE_TIMEOUT_FAILURE_CAUSE,
            3,
          ),
        ),
      );
      // Worded, it reads as the page does: no direction of its own.
      expect(cause).not.toHaveAttribute("dir");
      expect(cause).toHaveClass("line-clamp-2");
    },
  );

  test("one try reads the language's one form", () => {
    renderRowsIn("de", [timedOutProbe(1)]);

    expect(screen.getByTestId("monitor-probe-failure-cause").textContent).toBe(
      "Die Anfrage wurde einmal versucht und hat das Zeitlimit überschritten.",
    );
  });

  test("a message that only looks like the timeout sentence stays as the probe wrote it", () => {
    const nearMiss: string =
      "Request was tried 3 times and it timed out after 30 seconds.";

    for (const language of ["de", "fa"]) {
      renderRowsIn(language, [
        monitorProbe({
          name: "Tokyo",
          result: {
            monitoredAt: minutesAgo(1),
            isOnline: false,
            failureCause: nearMiss,
          },
        }),
      ]);

      const cause: HTMLElement = screen.getByTestId(
        "monitor-probe-failure-cause",
      );

      expect(cause.textContent).toBe(nearMiss);
      expect(cause.getAttribute("dir")).toBe(language === "fa" ? "ltr" : null);
      cleanup();
    }
  });

  test("Persian: an up probe's time is kept whole in Persian digits, after a bullet", () => {
    renderRowsIn("fa", EVERY_HEALTH());

    const london: HTMLElement = screen.getAllByTestId(
      "monitor-probe-health",
    )[4]!;
    const figure: Element | null = london.querySelector(
      `span.${PROBE_HEALTH_FIGURE_CLASS_NAME}`,
    );

    expect(figure?.textContent).toBe("۱۱۹ میلی\u200cثانیه");
    expect(london.textContent).toBe(
      getProbeHealthText(
        {
          probeId: "p",
          name: "London",
          isEnabled: true,
          isConnected: true,
          health: MonitorOverviewProbeHealth.Up,
          latestResult: {
            monitoredAt: NOW,
            isOnline: true,
            responseTimeInMs: 118.6,
          },
        } as MonitorOverviewProbeRow,
        translatorFor("fa"),
      ),
    );
  });
});

describe("getProbeHealthText and getProbeAgreementText write in the translator's language", () => {
  const row: (
    health: MonitorOverviewProbeHealth,
    responseTimeInMs?: number,
  ) => MonitorOverviewProbeRow = (
    health: MonitorOverviewProbeHealth,
    responseTimeInMs?: number,
  ): MonitorOverviewProbeRow => {
    return {
      probeId: "p",
      name: "P",
      isEnabled: true,
      isConnected: true,
      health: health,
      ...(responseTimeInMs === undefined
        ? {}
        : {
            latestResult: {
              monitoredAt: NOW,
              isOnline: true,
              responseTimeInMs: responseTimeInMs,
            },
          }),
    } as MonitorOverviewProbeRow;
  };

  test("each state is looked up: a pseudo-locale wraps every one", () => {
    const pseudo: Translator = createTranslator(
      (text: string): string | undefined => {
        return `[${text}]`;
      },
      "en",
    );

    for (const health of Object.values(MonitorOverviewProbeHealth)) {
      expect(getProbeHealthText(row(health), pseudo)).toBe(
        `[${PROBE_HEALTH_WORDS[health]}]`,
      );
    }
  });

  test("getProbeHealthParts: the state, and an up probe's time as a fact of its own", () => {
    const english: Translator = translatorFor("en");
    const persian: Translator = translatorFor("fa");

    expect(
      getProbeHealthParts(row(MonitorOverviewProbeHealth.Up, 182.4), english),
    ).toEqual(["Up", "182 ms"]);
    expect(
      getProbeHealthParts(row(MonitorOverviewProbeHealth.Up, 182.4), persian),
    ).toEqual([persian.translateTemplate("Up"), "۱۸۲ میلی\u200cثانیه"]);
    // An up probe whose result had no time, and every other state: one part.
    expect(
      getProbeHealthParts(row(MonitorOverviewProbeHealth.Up), english),
    ).toEqual(["Up"]);
    for (const health of Object.values(MonitorOverviewProbeHealth)) {
      if (health === MonitorOverviewProbeHealth.Up) {
        continue;
      }

      expect(getProbeHealthParts(row(health, 182.4), english)).toEqual([
        english.translateTemplate(PROBE_HEALTH_WORDS[health]),
      ]);
    }
    // The one line is the parts set apart as the language sets two facts.
    expect(
      getProbeHealthText(row(MonitorOverviewProbeHealth.Up, 182.4), persian),
    ).toBe(`${persian.translateTemplate("Up")} \u2022 ۱۸۲ میلی\u200cثانیه`);
  });

  test("an up probe's time in German grouping; only an up probe shows one", () => {
    const german: Translator = translatorFor("de");

    expect(
      getProbeHealthText(row(MonitorOverviewProbeHealth.Up, 2410.4), german),
    ).toBe("Up · 2.410 ms");
    expect(
      getProbeHealthText(row(MonitorOverviewProbeHealth.Late, 2410.4), german),
    ).toBe("Verspätet");
  });

  test("Persian: the footnote's both and all forms are Persian, their counts in Persian digits", () => {
    const persian: Translator = translatorFor("fa");
    const rows: Array<MonitorOverviewProbeRow> = [
      row(MonitorOverviewProbeHealth.Up),
      row(MonitorOverviewProbeHealth.Up),
      row(MonitorOverviewProbeHealth.Up),
      row(MonitorOverviewProbeHealth.Up),
    ];

    const all: string | null = getProbeAgreementText({
      rows: rows,
      minimumProbeAgreement: undefined,
      translator: persian,
    });

    expect(all).toBe(
      persian.translateTemplate(
        "A status change needs all {{count}} connected probes to agree.",
        { count: "۴" },
      ),
    );
    expect(all).not.toMatch(/[A-Za-z0-9]/);
    expect(
      getProbeAgreementText({
        rows: rows.slice(0, 2),
        minimumProbeAgreement: 2,
        translator: persian,
      }),
    ).toBe(
      persian.translateTemplate(
        "A status change needs both connected probes to agree.",
      ),
    );
  });
});
