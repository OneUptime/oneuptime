// UX rule: Docs/ux/README.md#in-every-language
import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { getMonitorListStatusName } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardMonitorListComponent";
import DashboardResourceHoneycomb, {
  HONEYCOMB_TILE_TEST_ID,
  HONEYCOMB_TOOLTIP_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import {
  AttentionGroup,
  AttentionGroupKey,
  AttentionRow,
  getAttentionGroups,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/NeedsAttention";
import { HomeOverviewData } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import {
  getAlertMarkerSubtitle,
  getIncidentMarkerSubtitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines";
import MonitorOpenWorkCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOpenWorkCard";
import {
  MonitorOpenWorkRow,
  MonitorOpenWorkSide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import { getWhoIsToldSentences } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/WhoIsToldWords";
import { getSeverityOrNothingPicked } from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/Utils/BurnRateRuleLines";
import {
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Color from "../../../Types/Color";
import {
  WhoIsToldCriteria,
  WhoIsToldEvent,
  WhoIsToldOwnersSource,
  WhoIsToldResult,
} from "../../../Types/Monitor/WhoIsTold";
import ObjectID from "../../../Types/ObjectID";
import { OnCallTestPageRecordKind } from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { Translator } from "../../../Types/Translator";
import { StateListType } from "../../../Utils/StateOrder";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A STATE'S OR A SEVERITY'S NAME DRAWN AS TEXT, IN GERMAN (#7894).
 *
 * The places below drew a state's or a severity's stored name as it was
 * stored: on a German page a new project's "Critical Incident" and
 * "Resolved" read English beside badges that say "Kritischer Vorfall" and
 * "Behoben". Each now reads the name by its list
 * (Common/Utils/DefaultRecordNames): a default name in German, a name the
 * project gave its record ("Sev 1", "Urgent") as written.
 */

const GERMAN: Record<string, string> = readDashboardLocale("de");
const german: Translator = dashboardTranslator("de");
const french: Translator = dashboardTranslator("fr");
const english: Translator = dashboardTranslator("en");

let germanInstance: i18n | null = null;

function germanI18n(): i18n {
  if (germanInstance) {
    return germanInstance;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });

  germanInstance = instance;

  return instance;
}

function renderInGerman(element: ReactElement): void {
  render(
    <I18nextProvider i18n={germanI18n()}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the words the cases below lean on", () => {
  test("German has words of its own for the default names", () => {
    expect({
      "Critical Incident": GERMAN["Critical Incident"],
      Resolved: GERMAN["Resolved"],
      High: GERMAN["High"],
      Operational: GERMAN["Operational"],
      Degraded: GERMAN["Degraded"],
      Incident: GERMAN["Incident"],
      Alert: GERMAN["Alert"],
    }).toEqual({
      "Critical Incident": "Kritischer Vorfall",
      Resolved: "Behoben",
      High: "Hoch",
      Operational: "Betriebsbereit",
      Degraded: "Beeinträchtigt",
      Incident: "Vorfall",
      Alert: "Warnung",
    });
  });
});

describe("Home's Needs attention", () => {
  function incident(severity: string, state: string): Incident {
    return Object.assign(new Incident(), {
      _id: "65f00000000000000000a001",
      title: "Checkout is down",
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
      declaredAt: new Date("2026-11-15T10:00:00.000Z"),
      incidentSeverity: Object.assign(new IncidentSeverity(), {
        name: severity,
        color: new Color("#dc2626"),
      }),
      currentIncidentState: Object.assign(new IncidentState(), {
        name: state,
        color: new Color("#ef4444"),
      }),
    });
  }

  function alert(severity: string, state: string): Alert {
    return Object.assign(new Alert(), {
      _id: "65f00000000000000000b001",
      title: "CPU above 90%",
      alertNumber: 7,
      alertNumberWithPrefix: "ALT-7",
      createdAt: new Date("2026-11-15T10:00:00.000Z"),
      alertSeverity: Object.assign(new AlertSeverity(), {
        name: severity,
        color: new Color("#f97316"),
      }),
      currentAlertState: Object.assign(new AlertState(), {
        name: state,
        color: new Color("#f59e0b"),
      }),
    });
  }

  function rowsOf(
    data: { incidents?: Array<Incident>; alerts?: Array<Alert> },
    key: AttentionGroupKey,
  ): Array<AttentionRow> {
    const overview: HomeOverviewData = {
      activeIncidents: {
        items: data.incidents || [],
        count: (data.incidents || []).length,
      },
      activeAlerts: {
        items: data.alerts || [],
        count: (data.alerts || []).length,
      },
      notOperationalMonitors: { items: [], count: 0 },
      ongoingMaintenance: { items: [], count: 0 },
      slosNeedingAttention: { items: [], count: 0 },
      totalMonitors: 1,
      totalSlos: 0,
    };

    return (
      getAttentionGroups(overview, german).find(
        (group: AttentionGroup): boolean => {
          return group.key === key;
        },
      )?.rows || []
    );
  }

  test("an incident's line names the default Critical Incident in German", () => {
    const [row]: Array<AttentionRow> = rowsOf(
      { incidents: [incident("Critical Incident", "Resolved")] },
      AttentionGroupKey.Incidents,
    );

    expect(row!.subtitle).toBe("INC-42 · Kritischer Vorfall");
    // The pill looks the default Resolved up.
    expect(row!.pill).toMatchObject({ text: "Resolved", isUserContent: false });
  });

  test("a severity and a state the project named itself read as written", () => {
    const [row]: Array<AttentionRow> = rowsOf(
      { incidents: [incident("Sev 1", "Open")] },
      AttentionGroupKey.Incidents,
    );

    expect(row!.subtitle).toBe("INC-42 · Sev 1");
    expect(row!.pill).toMatchObject({ text: "Open", isUserContent: true });
  });

  test("an alert's default High reads Hoch, one named Urgent as written", () => {
    expect(
      rowsOf(
        { alerts: [alert("High", "Resolved")] },
        AttentionGroupKey.Alerts,
      )[0]!.subtitle,
    ).toBe("ALT-7 · Hoch");
    expect(
      rowsOf(
        { alerts: [alert("Urgent", "Open")] },
        AttentionGroupKey.Alerts,
      )[0]!.subtitle,
    ).toBe("ALT-7 · Urgent");
  });

  test("an incident severity named High is the project's own: an alert's default is not an incident's", () => {
    expect(
      rowsOf(
        { incidents: [incident("High", "Open")] },
        AttentionGroupKey.Incidents,
      )[0]!.subtitle,
    ).toBe("INC-42 · High");
  });
});

describe("a metric chart's incident and alert markers", () => {
  test("an incident's line names the default severity in German, and in French", () => {
    expect(getIncidentMarkerSubtitle("Critical Incident", german)).toBe(
      "Vorfall · Kritischer Vorfall",
    );
    expect(getIncidentMarkerSubtitle("Critical Incident", french)).toBe(
      `Incident · ${readDashboardLocale("fr")["Critical Incident"]}`,
    );
    expect(getIncidentMarkerSubtitle("Critical Incident", english)).toBe(
      "Incident · Critical Incident",
    );
  });

  test("a severity the project named itself reads as written", () => {
    expect(getIncidentMarkerSubtitle("Sev 1", german)).toBe("Vorfall · Sev 1");
  });

  test("an alert's default High reads Hoch, one named Urgent as written", () => {
    expect(getAlertMarkerSubtitle("High", german)).toBe("Warnung · Hoch");
    expect(getAlertMarkerSubtitle("Urgent", german)).toBe("Warnung · Urgent");
  });

  test("with no severity, the line is the kind alone", () => {
    expect(getIncidentMarkerSubtitle(undefined, german)).toBe("Vorfall");
    expect(getAlertMarkerSubtitle("", german)).toBe("Warnung");
  });
});

describe("a monitor's open incidents and alerts card", () => {
  const MONITOR_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );

  function row(overrides: Partial<MonitorOpenWorkRow>): MonitorOpenWorkRow {
    return {
      key: "incident-1",
      kind: "Incident",
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      title: "Checkout is down",
      startedAt: new Date(Date.now() - 10 * 60 * 1000),
      severityName: "Critical Incident",
      severityColor: "#DC2626",
      stateName: "Resolved",
      ...overrides,
    };
  }

  function side(
    rows: Array<MonitorOpenWorkRow>,
  ): OverviewSection<MonitorOpenWorkSide> {
    return resolveSection<MonitorOpenWorkSide>({
      value: { count: rows.length, rows: rows },
      subjectId: MONITOR_ID.toString(),
    });
  }

  test("an incident's default severity and state read in German", () => {
    renderInGerman(
      <MonitorOpenWorkCard
        monitorId={MONITOR_ID}
        openWork={{ incidents: side([row({})]), alerts: side([]) }}
      />,
    );

    const line: HTMLElement = screen.getByTestId("monitor-open-work-row");

    expect(line).toHaveTextContent("Kritischer Vorfall");
    expect(line).toHaveTextContent("Behoben");
    expect(line).not.toHaveTextContent("Critical Incident");
    expect(line).not.toHaveTextContent("Resolved");
  });

  test("a severity and a state the project named itself read as written", () => {
    renderInGerman(
      <MonitorOpenWorkCard
        monitorId={MONITOR_ID}
        openWork={{
          incidents: side([row({ severityName: "Sev 1", stateName: "Open" })]),
          alerts: side([]),
        }}
      />,
    );

    const line: HTMLElement = screen.getByTestId("monitor-open-work-row");

    expect(line).toHaveTextContent("Sev 1");
    expect(line).toHaveTextContent("Open");
  });

  test("an alert's default High reads Hoch", () => {
    renderInGerman(
      <MonitorOpenWorkCard
        monitorId={MONITOR_ID}
        openWork={{
          incidents: side([]),
          alerts: side([
            row({
              key: "alert-1",
              kind: "Alert",
              severityName: "High",
              stateName: "Acknowledged",
            }),
          ]),
        }}
      />,
    );

    const line: HTMLElement = screen.getByTestId("monitor-open-work-row");

    expect(line).toHaveTextContent("Hoch");
    expect(line).toHaveTextContent(GERMAN["Acknowledged"]!);
  });
});

describe("When this goes down", () => {
  function whoIsTold(data: {
    severityName: string;
    statusName?: string | undefined;
    kind?: OnCallTestPageRecordKind | undefined;
  }): Pick<WhoIsToldResult, "criteria"> {
    const event: WhoIsToldEvent = {
      kind: data.kind || OnCallTestPageRecordKind.Incident,
      title: "Checkout API is offline",
      severityName: data.severityName,
      owners: {
        source: WhoIsToldOwnersSource.ProjectOwners,
        userNames: [],
        teamNames: [],
      },
      ownerRules: [],
      rules: [],
      policies: [],
      statusPages: [],
    };
    const criteria: WhoIsToldCriteria = {
      id: "offline",
      name: "Offline",
      statusName: data.statusName,
      events: [event],
    } as WhoIsToldCriteria;

    return { criteria: [criteria] };
  }

  function firstSentence(
    data: Parameters<typeof whoIsTold>[0],
    translator: Translator,
  ): string {
    return withoutIsolateMarks(
      getWhoIsToldSentences(whoIsTold(data), translator)[0]!,
    );
  }

  test("a new project's default severity and status read in German, the incident named once", () => {
    const sentence: string = firstSentence(
      { severityName: "Critical Incident", statusName: "Degraded" },
      german,
    );

    expect(sentence).toBe(
      "OneUptime setzt den Status auf Beeinträchtigt und öffnet einen Vorfall (Kritischer Vorfall).",
    );
    expect(sentence).not.toContain("Critical Incident");
  });

  test("in English the default severity is named once, in brackets", () => {
    expect(
      firstSentence(
        { severityName: "Critical Incident", statusName: "Offline" },
        english,
      ),
    ).toBe(
      "OneUptime marks it Offline and opens an incident (Critical Incident).",
    );
  });

  test("a severity and a status the project named itself read as written", () => {
    expect(
      firstSentence({ severityName: "Sev 1", statusName: "Down" }, german),
    ).toBe(
      "OneUptime setzt den Status auf Down und öffnet einen Vorfall (Sev 1).",
    );
  });

  test("an alert's default High reads Hoch; an alert severity named Urgent as written", () => {
    expect(
      firstSentence(
        { severityName: "High", kind: OnCallTestPageRecordKind.Alert },
        german,
      ),
    ).toBe("OneUptime öffnet eine Warnung (Hoch).");
    expect(
      firstSentence(
        { severityName: "Urgent", kind: OnCallTestPageRecordKind.Alert },
        german,
      ),
    ).toBe("OneUptime öffnet eine Warnung (Urgent).");
  });
});

describe("an SLO's burn rate rules", () => {
  test("a severity reads by its list: the defaults in German, a project's own as written", () => {
    expect(
      getSeverityOrNothingPicked(StateListType.AlertSeverity, "High", german),
    ).toBe("Hoch");
    expect(
      getSeverityOrNothingPicked(
        StateListType.IncidentSeverity,
        "Critical Incident",
        german,
      ),
    ).toBe("Kritischer Vorfall");
    expect(
      getSeverityOrNothingPicked(StateListType.AlertSeverity, "Urgent", german),
    ).toBe("Urgent");
    // An incident severity named High is the project's, not an alert's default.
    expect(
      getSeverityOrNothingPicked(
        StateListType.IncidentSeverity,
        "High",
        german,
      ),
    ).toBe("High");
  });

  test("no severity picked says the word for the default, in German", () => {
    expect(
      getSeverityOrNothingPicked(
        StateListType.AlertSeverity,
        undefined,
        german,
      ),
    ).toBe(GERMAN["Default"]);
  });
});

describe("the Monitor List widget", () => {
  test("a status reads by its list: the default Operational in German, a project's own as written", () => {
    expect(
      getMonitorListStatusName(
        { text: "Operational", isMonitoringOff: false, color: null } as never,
        german,
      ),
    ).toBe("Betriebsbereit");
    expect(
      getMonitorListStatusName(
        { text: "Open", isMonitoringOff: false, color: null } as never,
        german,
      ),
    ).toBe("Open");
  });

  test("a monitor whose monitoring is off says the product's word for it", () => {
    expect(
      getMonitorListStatusName(
        { text: "Disabled", isMonitoringOff: true, color: null } as never,
        german,
      ),
    ).toBe(GERMAN["Disabled"]);
  });

  // Issue #8899: the row's own words, for a monitor with no status to show.
  test("a monitor nothing has checked yet, or no probe checks, says the product's words for it", () => {
    for (const text of [
      "Waiting for data",
      "No results yet",
      "Paused",
      "Probes Not Enabled",
      "Probes Disconnected",
    ]) {
      expect(
        getMonitorListStatusName(
          {
            text: text,
            isProductWords: true,
            isMonitoringOff: false,
            color: null,
          } as never,
          german,
        ),
      ).toBe(GERMAN[text]);
    }

    // A status of the project's own named like one of them stays as written.
    expect(
      getMonitorListStatusName(
        {
          text: "Paused",
          isProductWords: false,
          isMonitoringOff: false,
          color: null,
        } as never,
        german,
      ),
    ).toBe("Paused");
  });
});

describe("a list widget's honeycomb tile", () => {
  // The honeycomb measures its box; jsdom has nothing to measure with.
  class StillResizeObserver {
    public observe(): void {}
    public unobserve(): void {}
    public disconnect(): void {}
  }

  let originalResizeObserver: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalResizeObserver = Object.getOwnPropertyDescriptor(
      window,
      "ResizeObserver",
    );
    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: StillResizeObserver,
    });
  });

  afterAll(() => {
    if (originalResizeObserver) {
      Object.defineProperty(window, "ResizeObserver", originalResizeObserver);
    } else {
      delete (window as unknown as Record<string, unknown>)["ResizeObserver"];
    }
  });

  function tooltipStatus(tile: {
    status: string;
    isStatusUserContent?: boolean;
  }): string {
    cleanup();
    renderInGerman(
      <DashboardResourceHoneycomb
        tiles={[
          {
            id: "t-1",
            color: "#ef4444",
            tooltip: { title: "Checkout is down" },
            ...tile,
          },
        ]}
      />,
    );

    fireEvent.mouseEnter(screen.getByTestId(HONEYCOMB_TILE_TEST_ID));

    const tooltip: HTMLElement = document.querySelector(
      `[data-testid="${HONEYCOMB_TOOLTIP_TEST_ID}"]`,
    ) as HTMLElement;

    return (
      within(tooltip).getByText(GERMAN["Status"]!).nextElementSibling
        ?.textContent || ""
    );
  }

  test("a status already in the reader's words is drawn as given", () => {
    expect(tooltipStatus({ status: "Open", isStatusUserContent: true })).toBe(
      "Open",
    );
    expect(
      tooltipStatus({ status: "Behoben", isStatusUserContent: true }),
    ).toBe("Behoben");
  });

  test("the product's words are still looked up", () => {
    expect(tooltipStatus({ status: "Disabled" })).toBe(GERMAN["Disabled"]);
  });
});
