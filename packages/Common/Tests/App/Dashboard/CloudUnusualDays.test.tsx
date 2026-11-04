import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import {
  CloudAccountCostSummary,
  CloudCostAnomaly,
  CloudCostState,
  readCloudAccountCostSummary,
} from "../../../Types/Cloud/CloudCost";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import CloudUnusualDaysCard, {
  CloudUnusualDayRow,
  UNUSUAL_DAYS_DESCRIPTION,
  UNUSUAL_DAYS_SHOWN,
  UNUSUAL_DAYS_TITLE,
  UNUSUAL_DAY_WHOLE_ACCOUNT,
  getCloudUnusualDayComparison,
  getCloudUnusualDayRows,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudUnusualDaysCard";
import { CloudAccountRow } from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/UseCloudAccounts";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";

/*
 * Unusual days on Costs: the days of the last two weeks each account's
 * summary says cost far more than usual - which accounts count (read, in
 * the page's currency), in what order, and what each row says: the day,
 * the service or the whole account, how far above usual, what it cost and,
 * over every account, whose it was. In English and German.
 */

const WEB_ROW: string = "10000000-0000-4000-8000-0000000000b1";
const DATA_ROW: string = "10000000-0000-4000-8000-0000000000b2";

const english: Translator = createTranslator(
  (text: string): string | undefined => {
    return (englishLocale as unknown as Record<string, string>)[text];
  },
  "en",
);
const german: Translator = createTranslator(
  (text: string): string | undefined => {
    return (germanLocale as unknown as Record<string, string>)[text];
  },
  "de",
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

function describeRows(rows: Array<CloudUnusualDayRow>): Array<string> {
  return rows.map((entry: CloudUnusualDayRow): string => {
    return `${entry.anomaly.day} ${entry.account.name} ${entry.anomaly.service || "(account)"}`;
  });
}

describe("which days, in what order", () => {
  test("the newest day first; then by account, its own line first and its services the furthest above usual first", () => {
    expect(
      describeRows(
        getCloudUnusualDayRows({ accounts: [WEB, DATA], currency: "usd" }),
      ),
    ).toEqual([
      "2026-11-19 data-lake Amazon Athena",
      "2026-11-19 web-prod (account)",
      "2026-11-19 web-prod AWS Lambda",
      "2026-11-17 data-lake Amazon S3",
      "2026-11-12 web-prod AWS Glue",
    ]);
  });

  test("only accounts read in the page's currency count", () => {
    expect(
      getCloudUnusualDayRows({
        accounts: [
          row({
            id: "10000000-0000-4000-8000-0000000000b3",
            name: "eu-shop",
            costSummary: summary({
              currency: "EUR",
              anomalies: [anomaly({})],
            }),
          }),
          row({
            id: "10000000-0000-4000-8000-0000000000b4",
            name: "analytics",
            costSummary: summary({
              state: CloudCostState.NotAllowed,
              anomalies: [anomaly({})],
            }),
          }),
          row({
            id: "10000000-0000-4000-8000-0000000000b5",
            name: "staging",
            costSummary: null,
          }),
          // Read, with nothing unusual.
          row({ id: "10000000-0000-4000-8000-0000000000b6", name: "dev" }),
        ],
        currency: "USD",
      }),
    ).toEqual([]);
  });
});

describe("what a row says of its day", () => {
  test("how far above usual, in the reader's numbers; or that it usually costs nothing", () => {
    expect(
      getCloudUnusualDayComparison({
        anomaly: anomaly({}),
        currency: "USD",
        translator: english,
      }),
    ).toBe("2.3 times its usual $180.00");
    expect(
      getCloudUnusualDayComparison({
        anomaly: anomaly({ amount: 2400, usual: 1500 }),
        currency: "USD",
        translator: english,
      }),
    ).toBe("1.6 times its usual $1,500");
    expect(
      getCloudUnusualDayComparison({
        anomaly: anomaly({ usual: 0 }),
        currency: "USD",
        translator: english,
      }),
    ).toBe("Usually costs nothing");

    expect(
      getCloudUnusualDayComparison({
        anomaly: anomaly({}),
        currency: "EUR",
        translator: german,
      }),
    ).toBe("2,3-mal so viel wie üblich (180,00\u00a0€)");
    expect(
      getCloudUnusualDayComparison({
        anomaly: anomaly({ usual: 0 }),
        currency: "EUR",
        translator: german,
      }),
    ).toBe("Kostet sonst nichts");
  });
});

describe("the card, drawn", () => {
  let instance: i18n;

  beforeAll(async () => {
    instance = createInstance();
    await instance.init({
      lng: "de",
      fallbackLng: "en",
      resources: {
        en: { translation: englishLocale },
        de: { translation: germanLocale },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  beforeEach(() => {
    goTo(`/dashboard/${PROJECT_ID}/cloud/costs`);
  });

  afterEach(() => {
    cleanup();
  });

  async function drawCard(
    props: Partial<React.ComponentProps<typeof CloudUnusualDaysCard>> = {},
    inGerman: boolean = false,
  ): Promise<void> {
    const card: React.ReactElement = (
      <MemoryRouter>
        <CloudUnusualDaysCard
          rows={getCloudUnusualDayRows({
            accounts: [WEB, DATA],
            currency: "USD",
          })}
          currency="USD"
          showAccounts={true}
          {...props}
        />
      </MemoryRouter>
    );

    await act(async () => {
      render(
        inGerman ? (
          <I18nextProvider i18n={instance}>{card}</I18nextProvider>
        ) : (
          card
        ),
      );
    });
  }

  test("each day: when, what, how far above usual, what it cost, and whose - linked to its Costs", async () => {
    await drawCard();

    expect(screen.getByText(UNUSUAL_DAYS_TITLE)).toBeInTheDocument();
    expect(screen.getByText(UNUSUAL_DAYS_DESCRIPTION)).toBeInTheDocument();
    /*
     * What makes a day unusual, in one sentence: which budgets alert on
     * one is said on Budgets, beside the switch that turns it off.
     */
    expect(UNUSUAL_DAYS_DESCRIPTION).toBe(
      "Days of the last two weeks that cost far more than usual: a service at twice its usual day, or a whole account at one and a half times.",
    );

    const days: Array<HTMLElement> = within(
      screen.getByTestId("cloud-unusual-days"),
    ).getAllByTestId("cloud-unusual-day");
    expect(days).toHaveLength(5);
    expect(
      days.map((day: HTMLElement): string | null => {
        return day.getAttribute("data-day");
      }),
    ).toEqual([
      "2026-11-19",
      "2026-11-19",
      "2026-11-19",
      "2026-11-17",
      "2026-11-12",
    ]);

    const athena: HTMLElement = days[0]!;
    const date: HTMLElement = within(athena).getByTestId(
      "cloud-unusual-day-date",
    );
    expect(date).toHaveTextContent("19 Nov");
    /*
     * One width down the list so the names line up, yet never narrower
     * than a longer day in another language: it grows rather than runs
     * into the name beside it.
     */
    expect(date.className.split(" ")).toEqual(
      expect.arrayContaining(["w-16", "min-w-max", "whitespace-nowrap"]),
    );
    // A service's name as its cloud writes it, in its own direction.
    const what: HTMLElement = within(athena).getByTestId(
      "cloud-unusual-day-what",
    );
    expect(what).toHaveTextContent("Amazon Athena");
    expect(what.querySelector("bdi")).toHaveTextContent("Amazon Athena");
    expect(
      within(athena).getByTestId("cloud-unusual-day-usual"),
    ).toHaveTextContent("2.1 times its usual $45.90");
    expect(
      within(athena).getByTestId("cloud-unusual-day-amount"),
    ).toHaveTextContent("$96.40");
    expect(
      within(athena).getByRole("link", { name: "data-lake" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/cloud/accounts/${DATA_ROW}/costs`),
    );

    // The account's own line names no service.
    expect(
      within(days[1]!).getByTestId("cloud-unusual-day-what"),
    ).toHaveTextContent(UNUSUAL_DAY_WHOLE_ACCOUNT);
    expect(
      within(days[1]!).getByTestId("cloud-unusual-day-amount"),
    ).toHaveTextContent("$2,400");

    expect(
      within(days[4]!).getByTestId("cloud-unusual-day-usual"),
    ).toHaveTextContent("Usually costs nothing");
  });

  test("on one account's own Costs, no row names its account", async () => {
    await drawCard({
      rows: getCloudUnusualDayRows({ accounts: [WEB], currency: "USD" }),
      showAccounts: false,
    });

    expect(screen.getAllByTestId("cloud-unusual-day")).toHaveLength(3);
    expect(screen.queryByTestId("cloud-unusual-day-account")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  test(`the first ${UNUSUAL_DAYS_SHOWN}, then the rest on asking`, async () => {
    const many: CloudAccountRow = row({
      id: WEB_ROW,
      name: "web-prod",
      costSummary: summary({
        anomalies: Array.from({ length: 9 }, (_: unknown, index: number) => {
          return anomaly({
            day: `2026-11-${String(19 - index).padStart(2, "0")}`,
          });
        }),
      }),
    });

    await drawCard({
      rows: getCloudUnusualDayRows({ accounts: [many], currency: "USD" }),
    });

    expect(screen.getAllByTestId("cloud-unusual-day")).toHaveLength(
      UNUSUAL_DAYS_SHOWN,
    );
    const toggle: HTMLElement = screen.getByTestId("cloud-unusual-days-toggle");
    expect(toggle).toHaveTextContent("Show 3 more");
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(toggle);
    });

    expect(screen.getAllByTestId("cloud-unusual-day")).toHaveLength(9);
    expect(toggle).toHaveTextContent("Show less");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("no unusual day: no card", async () => {
    await drawCard({ rows: [] });

    expect(screen.queryByTestId("cloud-unusual-days")).toBeNull();
    expect(screen.queryByText(UNUSUAL_DAYS_TITLE)).toBeNull();
  });

  test("in German, every word the Dashboard's German", async () => {
    await drawCard({}, true);

    const german: Record<string, string> = germanLocale as unknown as Record<
      string,
      string
    >;
    expect(screen.getByText(german[UNUSUAL_DAYS_TITLE]!)).toBeInTheDocument();
    expect(
      screen.getByText(german[UNUSUAL_DAYS_DESCRIPTION]!),
    ).toBeInTheDocument();

    const days: Array<HTMLElement> = screen.getAllByTestId("cloud-unusual-day");
    expect(
      within(days[1]!).getByTestId("cloud-unusual-day-what"),
    ).toHaveTextContent(german[UNUSUAL_DAY_WHOLE_ACCOUNT]!);
    expect(
      within(days[0]!).getByTestId("cloud-unusual-day-usual"),
    ).toHaveTextContent("2,1-mal so viel wie üblich (45,90 $)");
    expect(
      within(days[0]!).getByTestId("cloud-unusual-day-amount"),
    ).toHaveTextContent("96,40 $");
    expect(
      within(days[4]!).getByTestId("cloud-unusual-day-usual"),
    ).toHaveTextContent("Kostet sonst nichts");
  });
});
