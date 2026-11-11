/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AskAI, {
  ASK_AI_BUTTON_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Header/AskAI";
import InvestigationNotStarted from "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationNotStarted";
import MonitorTypeTitle from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTypeTitle";
import MonitorOpenWorkCard from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOpenWorkCard";
import {
  MonitorOpenWorkRow,
  MonitorOpenWorkSide,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import {
  TOPOLOGY_LOADING_LABELS,
  TOPOLOGY_VIEW_LABELS,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Topology/TopologyPage";
import {
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import InvestigationNotStartedReason from "../../../Types/AI/InvestigationNotStartedReason";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * WHAT THE ARABIC DASHBOARD STILL SAID IN ENGLISH, OR READ BACKWARDS
 * (#6633's UI review).
 *
 * Walked in Arabic with real data, a few words stayed English on the pages
 * people open most: the header's Ask AI button on every page, a monitor's
 * Incidents and Alerts tiles and each open record's kind, the monitor list's
 * Monitor Type column ("Manual") and the Overview's Details card, and the
 * Topology page's Service Map tab. The facts under an open record ran its
 * English severity and state together as one English run, and the server's
 * English reason an incident was not investigated put its full stop at its
 * start. Each is drawn here with the real Dashboard locales.
 */

const ARABIC: Record<string, string> = readDashboardLocale("ar");
const GERMAN: Record<string, string> = readDashboardLocale("de");

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const NOW: Date = new Date("2026-11-10T12:00:00.000Z");

const ROW: MonitorOpenWorkRow = {
  key: "incident-aaaaaaaa-0000-4000-8000-000000000001",
  kind: "Incident",
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Checkout API p95 latency above 2s",
  startedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
  severityName: "Critical Incident",
  severityColor: "#DC2626",
  stateName: "Investigating",
};

const side: (
  count: number,
  rows: Array<MonitorOpenWorkRow>,
) => OverviewSection<MonitorOpenWorkSide> = (
  count: number,
  rows: Array<MonitorOpenWorkRow>,
): OverviewSection<MonitorOpenWorkSide> => {
  return resolveSection<MonitorOpenWorkSide>({
    value: { count: count, rows: rows },
    subjectId: MONITOR_ID.toString(),
  });
};

// A reason the server words, in English whatever the reader's language.
const REASON: InvestigationNotStartedReason = {
  code: "automatic_investigation_disabled",
  title: "Automatic investigation is off.",
  description: "Automatic investigation was turned off for this project.",
  nextStep: "Turn on automatic investigation for new incidents.",
  source: "recorded",
  evaluatedAt: "2026-11-10T11:50:00.000Z",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      ar: { translation: ARABIC },
      de: { translation: GERMAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

describe("the header's Ask AI button", () => {
  test("is named in the reader's language, as Search beside it is", async () => {
    await inLanguage("ar");
    render(<AskAI />);

    const words: string = ARABIC[ASK_AI_BUTTON_LABEL]!;

    expect(words).toBe("اسأل الذكاء الاصطناعي");

    const button: HTMLElement = screen.getByRole("button");

    expect(button).toHaveTextContent(words);
    expect(button.getAttribute("title")).toMatch(new RegExp(`^${words} · `));
    expect(screen.queryByText("Ask AI")).toBeNull();
  });

  test("still says Ask AI in English", () => {
    render(<AskAI />);

    expect(screen.getByRole("button")).toHaveTextContent("Ask AI");
  });
});

describe("a monitor's open incidents and alerts", () => {
  const renderCard: () => void = (): void => {
    render(
      <MemoryRouter>
        <MonitorOpenWorkCard
          monitorId={MONITOR_ID}
          openWork={{ incidents: side(1, [ROW]), alerts: side(0, []) }}
        />
      </MemoryRouter>,
    );
  };

  test("its tiles and each record's kind are Arabic", async () => {
    await inLanguage("ar");
    renderCard();

    expect(
      screen.getByTestId("monitor-open-incident-count").closest("a"),
    ).toHaveTextContent(ARABIC["Incidents"]!);
    expect(
      screen.getByTestId("monitor-open-alert-count").closest("a"),
    ).toHaveTextContent(ARABIC["Alerts"]!);
    expect(screen.queryByText("Incidents")).toBeNull();
    expect(screen.queryByText("Alerts")).toBeNull();

    const row: HTMLElement = screen.getByTestId("monitor-open-work-row");

    expect(within(row).getByText(ARABIC["Incident"]!)).toBeInTheDocument();
    expect(within(row).queryByText("Incident")).toBeNull();
  });

  /*
   * One string, "Critical Incident · Investigating" was a single English
   * run in a line read right to left: the state stood before the severity.
   */
  test("each fact is read on its own, the project's English names as written", async () => {
    await inLanguage("ar");
    renderCard();

    const row: HTMLElement = screen.getByTestId("monitor-open-work-row");
    const severity: HTMLElement = within(row).getByText("Critical Incident");
    const state: HTMLElement = within(row).getByText("Investigating");

    expect(severity.tagName).toBe("BDI");
    expect(severity).toHaveAttribute("dir", "ltr");
    expect(state.tagName).toBe("BDI");
    expect(state).toHaveAttribute("dir", "ltr");
    expect(within(row).getByText(ARABIC["Incident"]!).tagName).toBe("BDI");
  });

  test("in English the line reads as it always did", () => {
    renderCard();

    expect(screen.getByTestId("monitor-open-work-row")).toHaveTextContent(
      "Incident · Critical Incident · Investigating · 10 minutes ago",
    );
  });

  // As the tiles beside it on the Overview write theirs.
  test("a count is written as the reader's language writes numbers", async () => {
    const renderCounts: () => void = (): void => {
      render(
        <MemoryRouter>
          <MonitorOpenWorkCard
            monitorId={MONITOR_ID}
            openWork={{ incidents: side(1234, [ROW]), alerts: side(0, []) }}
          />
        </MemoryRouter>,
      );
    };

    await inLanguage("de");
    renderCounts();

    expect(screen.getByTestId("monitor-open-incident-count")).toHaveTextContent(
      /^1\.234$/,
    );
    cleanup();

    await inLanguage("en");
    renderCounts();

    expect(screen.getByTestId("monitor-open-incident-count")).toHaveTextContent(
      /^1,234$/,
    );
  });
});

describe("a monitor's type", () => {
  test("is named as the type picker names it, in the reader's language", async () => {
    await inLanguage("ar");
    const arabic: ReturnType<typeof render> = render(
      <MonitorTypeTitle monitorType={MonitorType.Manual} />,
    );

    expect(arabic.container).toHaveTextContent("يدوي");
    expect(arabic.container).not.toHaveTextContent("Manual");
    arabic.unmount();

    await inLanguage("de");
    const german: ReturnType<typeof render> = render(
      <MonitorTypeTitle monitorType={MonitorType.SSLCertificate} />,
    );

    expect(german.container).toHaveTextContent(GERMAN["SSL Certificate"]!);
    expect(GERMAN["SSL Certificate"]).not.toBe("SSL Certificate");
    german.unmount();

    await inLanguage("en");
    render(<MonitorTypeTitle monitorType={MonitorType.Manual} />);

    expect(screen.getByText("Manual")).toBeInTheDocument();
  });

  test("the monitor list's Monitor Type column and its Type filter draw it so", () => {
    const table: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorTable.tsx",
      ),
      "utf8",
    );
    const typeColumn: string = table.slice(
      table.indexOf('title: "Monitor Type",'),
      table.indexOf('title: "Monitor Status",'),
    );

    expect(typeColumn).toContain(
      "<MonitorTypeTitle monitorType={item.monitorType} />",
    );
    expect(table).toContain(
      "label: translator.translateText(o.label) || o.label,",
    );

    // The name, an English one on an Arabic page, is cut short at its end.
    expect(table).toContain(
      "getLineText: (item: Monitor): string | undefined => {",
    );
  });
});

describe("the Topology page's tabs", () => {
  test("the Service Map tab, and each map's loading line, are worded in every Dashboard language", () => {
    const keys: Array<string> = [
      TOPOLOGY_VIEW_LABELS["Service Map"],
      ...Object.values(TOPOLOGY_LOADING_LABELS),
    ];

    expect(TOPOLOGY_VIEW_LABELS["Service Map"]).toBe("Service Map");

    for (const language of DASHBOARD_LANGUAGES) {
      for (const key of keys) {
        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ language, key, worded: true });
      }
    }

    expect(
      dashboardTranslator("ar").translateText(
        TOPOLOGY_VIEW_LABELS["Service Map"],
      ),
    ).toBe("خريطة الخدمات");
  });
});

describe("why an incident was not investigated", () => {
  const renderReason: () => void = (): void => {
    render(
      <MemoryRouter>
        <InvestigationNotStarted
          subjectType="incident"
          reason={REASON}
          isLoading={false}
          hasError={false}
          hasSuccessfulResponse={true}
          isRefreshing={false}
          onRefresh={() => {}}
        />
      </MemoryRouter>,
    );
  };

  /*
   * The server's English, in a line laid out right to left, put its full
   * stop at its start (".Automatic investigation is off").
   */
  test("the server's English reads as written on an Arabic page", async () => {
    await inLanguage("ar");
    renderReason();

    for (const words of [REASON.title, REASON.description, REASON.nextStep]) {
      const drawn: HTMLElement = screen.getByText(words);

      expect(drawn.tagName).toBe("BDI");
      expect(drawn).toHaveAttribute("dir", "ltr");
    }

    // The card's own words are Arabic, and drawn as the page's.
    expect(screen.getByText(ARABIC["What you can do"]!).tagName).toBe("H3");
  });

  test("and as it always was on an English page", () => {
    renderReason();

    expect(screen.getByText(REASON.title).tagName).toBe("H3");
    expect(screen.getByText(REASON.description).tagName).toBe("P");
    expect(screen.getByText(REASON.nextStep).tagName).toBe("P");
  });
});
