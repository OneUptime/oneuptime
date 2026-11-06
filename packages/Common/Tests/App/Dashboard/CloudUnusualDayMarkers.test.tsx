import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import Route from "../../../Types/API/Route";
import {
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CloudCostState,
  readCloudAccountCostSummary,
} from "../../../Types/Cloud/CloudCost";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { createTranslator, Translator } from "../../../Types/Translator";
import ChartEventKind from "../../../UI/Components/Charts/Types/ChartEventKind";
import ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import Navigation from "../../../UI/Utils/Navigation";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudDailySpendChart from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudDailySpendChart";
import {
  UNUSUAL_DAY_MARKER_KIND,
  UNUSUAL_DAY_MARKER_LABEL,
  UNUSUAL_DAY_MARKER_SUBTITLE,
  getCloudUnusualDayMarkers,
  getCloudUnusualDaysMarked,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudUnusualDayMarkers";
import {
  CloudUnusualDayRow,
  UNUSUAL_DAY_WHOLE_ACCOUNT,
  getCloudUnusualDayRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudUnusualDaysCard";
import { CloudAccountRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import persianLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json";

/*
 * The unusual days, marked on Costs' Daily spend: each day the Unusual days
 * card lists gets a mark on the chart's annotation rail, at its own bar in
 * any time zone - the same rows, in the same order, saying what ran high,
 * what it cost and how far above its usual, with whose account it was on a
 * page over every account (where a mark opens that account's Costs). And
 * the chart hands the marks to the bar chart it draws on.
 */

jest.mock("../../../UI/Components/Charts/Bar/BarChart", () => {
  const ReactActual: typeof React = jest.requireActual("react") as typeof React;

  return {
    __esModule: true,
    default: (props: {
      timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
    }): React.ReactElement => {
      return ReactActual.createElement("div", {
        "data-testid": "bar-chart-stub",
        "data-marks": JSON.stringify(
          (props.timeReferenceLines || []).map(
            (mark: ChartTimeReferenceLineProps) => {
              return {
                date: mark.date.toISOString(),
                label: mark.label,
                subtitle: mark.subtitle,
                kind: mark.kind,
              };
            },
          ),
        ),
        "data-has-marks": String(props.timeReferenceLines !== undefined),
      });
    },
  };
});

const WEB_ROW: string = "10000000-0000-4000-8000-0000000000b1";
const DATA_ROW: string = "10000000-0000-4000-8000-0000000000b2";

function translatorOf(
  locale: Record<string, string>,
  language: string,
): Translator {
  return createTranslator((text: string): string | undefined => {
    return locale[text];
  }, language);
}

const english: Translator = translatorOf(
  englishLocale as unknown as Record<string, string>,
  "en",
);
const german: Translator = translatorOf(
  germanLocale as unknown as Record<string, string>,
  "de",
);
const persian: Translator = translatorOf(
  persianLocale as unknown as Record<string, string>,
  "fa",
);

function anomaly(fields: Partial<CloudCostAnomaly>): CloudCostAnomaly {
  return {
    day: "2026-11-19",
    service: "AWS Lambda",
    amount: 412,
    usual: 180,
    ...fields,
  };
}

function summary(
  overrides: Record<string, unknown> = {},
): CloudAccountCostSummary {
  return readCloudAccountCostSummary({
    state: CloudCostState.Reading,
    currency: "USD",
    monthToDate: 2000,
    lastMonth: 4000,
    monthFullDays: 2000,
    lastMonthToDate: 1600,
    projectedMonth: 3900,
    last30Days: 3800,
    topServices: [],
    readAt: "2026-11-20T06:00:00.000Z",
    ...overrides,
  })!;
}

function row(
  overrides: Omit<Partial<CloudAccountRow>, "id"> & { id: string },
): CloudAccountRow {
  return {
    name: "",
    provider: "aws",
    accountId: "",
    lastSeenAt: new Date(),
    hasConnection: true,
    resourceCount: 10,
    costSummary: summary(),
    savingsSummary: null,
    ...overrides,
    id: new ObjectID(overrides.id),
  };
}

const WEB: CloudAccountRow = row({
  id: WEB_ROW,
  name: "web-prod",
  accountId: "123456789012",
  costSummary: summary({
    anomalies: [
      anomaly({ service: "", amount: 2400, usual: 1500 }),
      anomaly({}),
      anomaly({ day: "2026-11-12", service: "AWS Glue", amount: 40, usual: 0 }),
    ],
  }),
});
const DATA: CloudAccountRow = row({
  id: DATA_ROW,
  name: "data-lake",
  accountId: "210987654321",
  costSummary: summary({
    anomalies: [
      anomaly({ service: "Amazon Athena", amount: 96.4, usual: 45.9 }),
      anomaly({
        day: "2026-11-17",
        service: "Amazon S3",
        amount: 60,
        usual: 20,
      }),
    ],
  }),
});

const ROWS: Array<CloudUnusualDayRow> = getCloudUnusualDayRows({
  accounts: [WEB, DATA],
  currency: "USD",
});

// The calendar day and hour a moment is at on a zone's clock.
function wallClock(date: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

afterEach(() => {
  OneUptimeDate.setUserTimezone(null);
  jest.restoreAllMocks();
  cleanup();
});

describe("the marks: one per line of the Unusual days card", () => {
  test("in the card's order, each saying what ran high and what it cost, and how far above usual", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const marks: Array<ChartTimeReferenceLineProps> = getCloudUnusualDayMarkers(
      {
        rows: ROWS,
        currency: "USD",
        translator: english,
        showAccounts: true,
      },
    );

    expect(
      marks.map((mark: ChartTimeReferenceLineProps) => {
        return [mark.date.toISOString(), mark.label, mark.subtitle];
      }),
    ).toEqual([
      [
        "2026-11-19T12:00:00.000Z",
        "Amazon Athena: $96.40",
        "data-lake · 2.1 times its usual $45.90",
      ],
      [
        "2026-11-19T12:00:00.000Z",
        `${UNUSUAL_DAY_WHOLE_ACCOUNT}: $2,400`,
        "web-prod · 1.6 times its usual $1,500",
      ],
      [
        "2026-11-19T12:00:00.000Z",
        "AWS Lambda: $412.00",
        "web-prod · 2.3 times its usual $180.00",
      ],
      [
        "2026-11-17T12:00:00.000Z",
        "Amazon S3: $60.00",
        "data-lake · 3 times its usual $20.00",
      ],
      [
        "2026-11-12T12:00:00.000Z",
        "AWS Glue: $40.00",
        "web-prod · Usually costs nothing",
      ],
    ]);
    // Amber, as an alert is marked on a chart: one to look at.
    expect(UNUSUAL_DAY_MARKER_KIND).toBe(ChartEventKind.Alert);
    for (const mark of marks) {
      expect(mark.kind).toBe(ChartEventKind.Alert);
      // The kind's own colour, as every other chart's alert marks are drawn.
      expect(mark.color).toBeUndefined();
    }
    expect(UNUSUAL_DAY_MARKER_LABEL).toBe("{{what}}: {{amount}}");
    expect(UNUSUAL_DAY_MARKER_SUBTITLE).toBe("{{account}} · {{comparison}}");
  });

  test.each([
    [Timezone.AmericaNew_York, "America/New_York"],
    [Timezone.AsiaTokyo, "Asia/Tokyo"],
    [Timezone.PacificAuckland, "Pacific/Auckland"],
    [Timezone.AsiaTehran, "Asia/Tehran"],
  ])(
    "%s: each mark at noon of its day, where that day's bar is",
    (zone: Timezone, name: string) => {
      OneUptimeDate.setUserTimezone(zone);
      expect(OneUptimeDate.getCurrentTimezone()).toBe(zone);

      const marks: Array<ChartTimeReferenceLineProps> =
        getCloudUnusualDayMarkers({
          rows: ROWS,
          currency: "USD",
          translator: english,
          showAccounts: true,
        });

      expect(
        marks.map((mark: ChartTimeReferenceLineProps): string => {
          return wallClock(mark.date, name);
        }),
      ).toEqual([
        "2026-11-19, 12",
        "2026-11-19, 12",
        "2026-11-19, 12",
        "2026-11-17, 12",
        "2026-11-12, 12",
      ]);
    },
  );

  test("over every account a mark opens its account's Costs; on one account's own it opens nothing", () => {
    goTo(`/dashboard/${PROJECT_ID}/cloud/costs`);
    const navigated: Array<string> = [];
    getJestSpyOn(Navigation, "navigate").mockImplementation(
      (to: Route | unknown): void => {
        navigated.push(String(to));
      },
    );

    const marks: Array<ChartTimeReferenceLineProps> = getCloudUnusualDayMarkers(
      {
        rows: ROWS,
        currency: "USD",
        translator: english,
        showAccounts: true,
      },
    );

    marks[0]!.onClick!();
    marks[1]!.onClick!();
    expect(navigated).toEqual([
      `/dashboard/${PROJECT_ID}/cloud/accounts/${DATA_ROW}/costs`,
      `/dashboard/${PROJECT_ID}/cloud/accounts/${WEB_ROW}/costs`,
    ]);

    const own: Array<ChartTimeReferenceLineProps> = getCloudUnusualDayMarkers({
      rows: getCloudUnusualDayRows({ accounts: [WEB], currency: "USD" }),
      currency: "USD",
      translator: english,
      showAccounts: false,
    });

    expect(own).toHaveLength(3);
    for (const mark of own) {
      expect(mark.onClick).toBeUndefined();
    }
    // Its own page needs no account's name: what ran high, and how far.
    expect(own[0]!.subtitle).toBe("1.6 times its usual $1,500");
  });

  test("in the reader's language: German and Persian", () => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);

    const inGerman: Array<ChartTimeReferenceLineProps> =
      getCloudUnusualDayMarkers({
        rows: ROWS.slice(0, 2),
        currency: "EUR",
        translator: german,
        showAccounts: true,
      });

    expect(inGerman[0]!.label).toBe(
      german.translateTemplate(UNUSUAL_DAY_MARKER_LABEL, {
        what: "Amazon Athena",
        amount: "96,40 €",
      }),
    );
    // The template is German's own, not English's.
    expect(german.hasTranslation(UNUSUAL_DAY_MARKER_LABEL)).toBe(true);
    expect(german.hasTranslation(UNUSUAL_DAY_MARKER_SUBTITLE)).toBe(true);
    expect(inGerman[1]!.label).toContain(
      german.translateText(UNUSUAL_DAY_WHOLE_ACCOUNT)!,
    );
    expect(inGerman[0]!.subtitle).toContain("data-lake");
    expect(inGerman[0]!.subtitle).toContain("45,90");

    const inPersian: Array<ChartTimeReferenceLineProps> =
      getCloudUnusualDayMarkers({
        rows: ROWS.slice(0, 1),
        currency: "USD",
        translator: persian,
        showAccounts: false,
      });

    expect(persian.hasTranslation(UNUSUAL_DAY_MARKER_LABEL)).toBe(true);
    // The service's name as its cloud writes it, beside Persian words.
    expect(inPersian[0]!.label).toContain("Amazon Athena");
  });
});

describe("the days marked", () => {
  test("each once, the newest first", () => {
    expect(getCloudUnusualDaysMarked(ROWS)).toEqual([
      "2026-11-19",
      "2026-11-17",
      "2026-11-12",
    ]);
    expect(getCloudUnusualDaysMarked([])).toEqual([]);
  });
});

describe("the chart, drawn", () => {
  beforeEach(() => {
    OneUptimeDate.setUserTimezone(Timezone.UTC);
  });

  const POINTS: Array<{ x: Date; y: number }> = Array.from(
    { length: 30 },
    (_: unknown, index: number) => {
      return {
        x: new Date(Date.UTC(2026, 9, 22 + index)),
        y: 100 + index,
      };
    },
  );

  test("hands its marks to the bar chart, and says how many it drew", async () => {
    const marks: Array<ChartTimeReferenceLineProps> = getCloudUnusualDayMarkers(
      {
        rows: ROWS,
        currency: "USD",
        translator: english,
        showAccounts: true,
      },
    );

    await act(async () => {
      render(
        <CloudDailySpendChart points={POINTS} currency="USD" markers={marks} />,
      );
    });

    expect(screen.getByTestId("cloud-daily-spend-chart")).toHaveAttribute(
      "data-marks",
      "5",
    );
    const handed: Array<{ date: string; label: string; kind: string }> =
      JSON.parse(
        screen.getByTestId("bar-chart-stub").getAttribute("data-marks") || "[]",
      ) as Array<{ date: string; label: string; kind: string }>;
    expect(handed).toHaveLength(5);
    expect(handed[0]).toEqual(
      expect.objectContaining({
        date: "2026-11-19T12:00:00.000Z",
        label: "Amazon Athena: $96.40",
        kind: ChartEventKind.Alert,
      }),
    );
  });

  test("with no unusual day, no mark and no rail", async () => {
    await act(async () => {
      render(<CloudDailySpendChart points={POINTS} currency="USD" />);
    });

    expect(screen.getByTestId("cloud-daily-spend-chart")).toHaveAttribute(
      "data-marks",
      "0",
    );
    // No empty list either: the rail reserves its row only for marks.
    expect(screen.getByTestId("bar-chart-stub")).toHaveAttribute(
      "data-has-marks",
      "false",
    );

    cleanup();

    await act(async () => {
      render(
        <CloudDailySpendChart points={POINTS} currency="USD" markers={[]} />,
      );
    });

    expect(screen.getByTestId("bar-chart-stub")).toHaveAttribute(
      "data-has-marks",
      "false",
    );
  });
});
