import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * A TILE OR A CHART WITH NO NUMBER SAYS WHAT WOULD GIVE ONE, IN THE
 * READER'S LANGUAGE.
 *
 * A queue no traced application consumes from has no processing time: no
 * broker measures how long a consumer takes with a message (#5771). Its P95
 * tile and chart drew a dash and "No data in this time range", which read
 * as a fault. ResourceOverview's tiles take a valueNote and ChartCard an
 * emptyMessage and emptyAction for that, which the page hands over in
 * English:
 *
 *   - the tile draws the note in place of its value, smaller and muted so
 *     it never reads as a figure, saying its language, and keeps the line
 *     under it;
 *   - the chart's empty box says the page's message instead of "No data in
 *     this time range", with the page's link under it;
 *   - both are drawn as the Dashboard's locale words them, in all sixteen
 *     languages, and a note no locale words reads as given;
 *   - a tile or a chart with a number, or still loading, never shows them.
 */

// recharts draws nothing in a 0x0 jsdom box: whether a chart is drawn is what is checked.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="line-chart" />;
    },
  };
});

import ResourceOverview, {
  RESOURCE_OVERVIEW_DETAILS_DESCRIPTION,
  ResourceOverviewTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import ChartCard from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard";
import {
  MESSAGE_QUEUE_NEEDS_CONSUMER_TRACES,
  MESSAGE_QUEUE_TRACE_CONSUMERS_LINK_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewFigures";
import IconProp from "../../../Types/Icon/IconProp";
import SeriesPoint from "../../../UI/Components/Charts/Types/SeriesPoints";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [...DASHBOARD_LANGUAGES];

const NOTE: string = "Needs consumer traces";
const ACTION: string = "Trace your consumers →";
const NO_DATA: string = "No data in this time range";
const SUBLABEL: string = "consumer spans, selected range";
// A note a page worded itself: no locale has words for it.
const WORDED_NOTE: string = "Waiting for checkout-api";
const DOCS_HREF: string = "/docs/telemetry/queues#instrumenting-applications";

const WINDOW_START: Date = new Date("2026-11-09T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-11-09T11:00:00.000Z");

const SERIES: Array<SeriesPoint> = [
  { seriesName: "p95 processing time", data: [{ x: WINDOW_START, y: 12 }] },
];

const locales: Record<string, Record<string, unknown>> = {};
const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

// What the Dashboard draws for this English, in this language.
function drawn(language: string, english: string): string {
  const value: unknown = locales[language]?.[english];

  return typeof value === "string" && value.length > 0 ? value : english;
}

beforeAll(async () => {
  locales["en"] = readLocale("en");

  for (const language of ["en", ...LANGUAGES]) {
    const locale: Record<string, unknown> =
      locales[language] || readLocale(language);
    locales[language] = locale;

    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"] },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function tile(extra: Partial<ResourceOverviewTile> = {}): ResourceOverviewTile {
  return {
    title: "p95 processing time",
    value: "—",
    icon: IconProp.Clock,
    iconColor: "blue",
    description: "What the number means, in plain words.",
    ...extra,
  };
}

function renderTiles(
  language: string,
  tiles: Array<ResourceOverviewTile>,
): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter initialEntries={["/dashboard/queues/overview"]}>
        <ResourceOverview
          icon={IconProp.QueueList}
          title="orders"
          identifier="orders"
          identifierLabel="messaging.destination.name"
          status="connected"
          lastSeenAt={undefined}
          chips={[]}
          tiles={tiles}
          detailRows={[]}
          detailsDescription={RESOURCE_OVERVIEW_DETAILS_DESCRIPTION}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function tileRoot(): HTMLElement {
  return document.querySelector("[aria-busy]") as HTMLElement;
}

function noteOf(): HTMLElement | null {
  return screen.queryByTestId("resource-overview-tile-value-note");
}

// The big figure a tile draws, or null.
function figureOf(): HTMLElement | null {
  return tileRoot().querySelector<HTMLElement>("div.text-2xl");
}

function renderChartCard(
  language: string,
  extra: {
    series?: Array<SeriesPoint>;
    loading?: boolean;
    emptyMessage?: string;
    withAction?: boolean;
  },
): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <ChartCard
        title="p95 processing time"
        icon={IconProp.Clock}
        iconColor="blue"
        series={extra.series || []}
        windowStart={WINDOW_START}
        windowEnd={WINDOW_END}
        syncId="value-notes-test"
        loading={Boolean(extra.loading)}
        description="What the line means, in plain words."
        emptyMessage={extra.emptyMessage}
        emptyAction={
          extra.withAction ? (
            <a href={DOCS_HREF}>{drawn(language, ACTION)}</a>
          ) : undefined
        }
      />
    </I18nextProvider>,
  );
}

describe("the notes the queue page hands over", () => {
  test("are keys of the English locale, the page's own constants among them", () => {
    expect(MESSAGE_QUEUE_NEEDS_CONSUMER_TRACES).toBe(NOTE);
    expect(MESSAGE_QUEUE_TRACE_CONSUMERS_LINK_LABEL).toBe(ACTION);
    for (const english of [NOTE, ACTION, NO_DATA]) {
      expect({ english, key: locales["en"]![english] }).toEqual({
        english,
        key: english,
      });
    }
  });

  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    for (const english of [NOTE, ACTION]) {
      expect({
        language,
        english,
        isWorded: drawn(language, english) !== english,
      }).toEqual({ language, english, isWorded: true });
    }
    expect(drawn(language, WORDED_NOTE)).toBe(WORDED_NOTE);
  });
});

describe("a golden-metric tile's value note", () => {
  test("in English stands in place of the value, muted, and says no language", () => {
    renderTiles("en", [tile({ valueNote: NOTE })]);

    const note: HTMLElement = noteOf()!;
    expect(note).toHaveTextContent(NOTE);
    expect(note).not.toHaveAttribute("lang");
    // Smaller and muted: it never reads as a figure.
    expect(note).toHaveClass("text-sm", "text-gray-500", "min-h-6");
    expect(note).not.toHaveClass("text-2xl");
    expect(figureOf()).toBeNull();
    expect(tileRoot()).not.toHaveTextContent("—");
  });

  test.each(LANGUAGES)(
    "%s: reads as the locale words it, saying its language",
    (language: string) => {
      renderTiles(language, [tile({ valueNote: NOTE })]);

      const note: HTMLElement = noteOf()!;
      expect({
        text: note.textContent,
        lang: note.getAttribute("lang"),
      }).toEqual({ text: drawn(language, NOTE), lang: language });
      expect(tileRoot()).not.toHaveTextContent(NOTE);
      expect(figureOf()).toBeNull();
    },
  );

  test("German and Japanese read their own words", () => {
    renderTiles("de", [tile({ valueNote: NOTE })]);
    expect(noteOf()).toHaveTextContent("Benötigt Consumer-Traces");
    cleanup();

    renderTiles("ja", [tile({ valueNote: NOTE })]);
    expect(noteOf()).toHaveTextContent("コンシューマーのトレースが必要");
  });

  test.each(["en", "de", "fa"])(
    "%s: a note no locale words reads as given, with no language",
    (language: string) => {
      renderTiles(language, [tile({ valueNote: WORDED_NOTE })]);

      expect(noteOf()).toHaveTextContent(WORDED_NOTE);
      expect(noteOf()).not.toHaveAttribute("lang");
    },
  );

  test("keeps the line under it, so the tile lines up with its neighbours", () => {
    renderTiles("de", [tile({ valueNote: NOTE, sublabel: SUBLABEL })]);

    const line: HTMLElement =
      tileRoot().querySelector<HTMLElement>("div.line-clamp-2")!;
    expect(line).toHaveTextContent(drawn("de", SUBLABEL));
    // The note comes first, the line under it.
    expect(noteOf()!.nextElementSibling).toBe(line);
  });

  test("a tile without a note draws its value, never a note", () => {
    renderTiles("de", [tile({ value: "1.2 s" })]);

    expect(noteOf()).toBeNull();
    expect(figureOf()).toHaveTextContent("1.2 s");
  });

  test("a loading tile draws its skeleton, never the note", () => {
    renderTiles("de", [tile({ valueNote: NOTE, loading: true })]);

    expect(noteOf()).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("a chart card's empty box", () => {
  test("says No data in this time range when the page says nothing else", () => {
    renderChartCard("en", {});

    expect(screen.getByText(NO_DATA)).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).toBeNull();
  });

  test("in English says the page's message instead, the link under it", () => {
    renderChartCard("en", { emptyMessage: NOTE, withAction: true });

    const message: HTMLElement = screen.getByText(NOTE);
    const link: HTMLElement = screen.getByRole("link", { name: ACTION });
    expect(link).toHaveAttribute("href", DOCS_HREF);
    // One column: the message, then the link.
    expect(message.nextElementSibling).toBe(link);
    expect(screen.queryByText(NO_DATA)).toBeNull();
  });

  test.each(LANGUAGES)(
    "%s: says the page's message as the locale words it, the link under it",
    (language: string) => {
      renderChartCard(language, { emptyMessage: NOTE, withAction: true });

      const message: HTMLElement = screen.getByText(drawn(language, NOTE));
      const link: HTMLElement = screen.getByRole("link", {
        name: drawn(language, ACTION),
      });
      expect(message.nextElementSibling).toBe(link);
      expect(screen.queryByText(NOTE)).toBeNull();
      expect(screen.queryByText(drawn(language, NO_DATA))).toBeNull();
    },
  );

  test.each(["en", "de"])(
    "%s: a message with no link is the box's only words",
    (language: string) => {
      renderChartCard(language, { emptyMessage: NOTE });

      const box: HTMLElement = screen.getByText(drawn(language, NOTE));
      expect(box.textContent).toBe(drawn(language, NOTE));
      expect(box).toHaveClass("h-44");
      expect(screen.queryByRole("link")).toBeNull();
    },
  );

  test("a chart with data draws its chart, never the message", () => {
    renderChartCard("de", {
      series: SERIES,
      emptyMessage: NOTE,
      withAction: true,
    });

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(screen.queryByText(drawn("de", NOTE))).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("a loading chart draws its skeleton, never the message", () => {
    renderChartCard("de", {
      loading: true,
      emptyMessage: NOTE,
      withAction: true,
    });

    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(screen.queryByText(drawn("de", NOTE))).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
