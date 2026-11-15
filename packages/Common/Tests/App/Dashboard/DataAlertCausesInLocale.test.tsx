import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * WHY A DATA ALERT HAPPENED, IN THE READER'S LANGUAGE (#8343).
 *
 * A data alert's Why This Happened card headed each likely cause with its
 * kind, looked up by its stored value: "Upstream Alert", "Failed Run",
 * "Failing Writes" and "Schema Change" were no keys of any locale, so a
 * German card read "Failed Run · nightly_orders failed" under "Warum das
 * passiert ist". The cause's title came from the server in English too.
 *
 * Each kind has its name now (DataAlertCauseWords), a key every language
 * words. The server sends a title it words itself as its sentence's code,
 * with the names and counts in it (DataAlertCauseTitles): the card says the
 * sentence in the reader's language, the names as they are, the counts in
 * the sentence's digits. A title that is a record's own words - an alert's
 * title, a deploy - is drawn as written, set apart so it keeps its own
 * direction on an Arabic or Persian page, and so is what a source system
 * said about a cause.
 */

import DataObservabilityApi from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import {
  DATA_ALERT_CAUSE_KIND_LABELS,
  getDataAlertCauseKindLabel,
  getDataAlertCauseTitle,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAlertCauseWords";
import DataAlertExplanationCard, {
  DATA_ALERT_CAUSE_DETAIL_TEST_ID,
  DATA_ALERT_CAUSE_KIND_TEST_ID,
  DATA_ALERT_CAUSE_TEST_ID,
  DATA_ALERT_CAUSE_TITLE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataAlertExplanationCard";
import {
  DATA_ALERT_CAUSE_TITLES,
  DataAlertCauseTitleCode,
  getFailedRunCauseTitle,
  getFailedWritesCauseTitle,
  getUpstreamAlertCauseTitle,
  titleAsWritten,
} from "../../../Types/DataObservability/DataAlertCauseTitles";
import {
  DataAlertCauseKind,
  DataAlertExplanation,
  DataAlertLikelyCause,
} from "../../../Types/DataObservability/DataAlertFeedback";
import ObjectID from "../../../Types/ObjectID";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { getJestSpyOn } from "../../Spy";

const ALERT_ID: string = "83430000-0000-4000-8000-000000000001";
const AT: string = "2026-11-04T08:00:00.000Z";
const ENGLISH: Record<string, string> = readDashboardLocale("en");

// The causes a late orders table might have: one of each kind, as the server sends them.
const CAUSES: Array<DataAlertLikelyCause> = [
  {
    kind: DataAlertCauseKind.UpstreamAlert,
    ...getUpstreamAlertCauseTitle({
      alertNumberWithPrefix: "#42",
      title: "raw.orders is late",
    }),
    at: AT,
  },
  {
    kind: DataAlertCauseKind.FailedRun,
    ...getFailedRunCauseTitle("nightly_orders"),
    detail: "relation orders does not exist.",
    at: AT,
  },
  {
    kind: DataAlertCauseKind.Deploy,
    ...titleAsWritten("orders-api: Deployed v2.4.1"),
    at: AT,
  },
  {
    kind: DataAlertCauseKind.FailingWrites,
    ...getFailedWritesCauseTitle({
      serviceName: "orders-api",
      failed: 3,
      total: 1200,
    }),
    at: AT,
  },
  {
    kind: DataAlertCauseKind.SchemaChange,
    title: "A column changed",
    titleWords: { code: DataAlertCauseTitleCode.ColumnChanged, values: {} },
    at: AT,
  },
  {
    kind: DataAlertCauseKind.Database,
    title: "orders-db could not be read",
    titleWords: {
      code: DataAlertCauseTitleCode.DatabaseUnreadable,
      values: { database: "orders-db" },
    },
  },
];

function explanationOf(
  causes: Array<DataAlertLikelyCause>,
): DataAlertExplanation {
  return {
    causes: causes,
    impact: { tables: [], dashboards: [], services: [], people: [] },
    feedback: null,
    isCauseConfirmed: null,
  };
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", "de", "ar", "fa"].map(
        (
          language: string,
        ): [string, { translation: Record<string, string> }] => {
          return [
            language,
            { translation: readDashboardLocaleAsDrawn(language) },
          ];
        },
      ),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await i18next.changeLanguage("en");
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

async function drawCard(
  language: string,
  causes: Array<DataAlertLikelyCause> = CAUSES,
): Promise<void> {
  getJestSpyOn(DataObservabilityApi, "getAlertExplanation").mockResolvedValue(
    explanationOf(causes) as never,
  );

  await act(async () => {
    await i18next.changeLanguage(language);
  });
  await act(async () => {
    render(<DataAlertExplanationCard alertId={new ObjectID(ALERT_ID)} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

// Each cause's kind and title, as the card draws them.
function drawnCauses(): Array<{ kind: string; title: string }> {
  return screen
    .getAllByTestId(DATA_ALERT_CAUSE_TEST_ID)
    .map((line: HTMLElement): { kind: string; title: string } => {
      return {
        kind: withoutIsolateMarks(
          within(line).getByTestId(DATA_ALERT_CAUSE_KIND_TEST_ID).textContent ||
            "",
        ),
        title: withoutIsolateMarks(
          within(line).getByTestId(DATA_ALERT_CAUSE_TITLE_TEST_ID)
            .textContent || "",
        ),
      };
    });
}

describe("a name for every kind of cause", () => {
  test("every kind, and nothing else", () => {
    expect(Object.keys(DATA_ALERT_CAUSE_KIND_LABELS).sort()).toEqual(
      Object.values(DataAlertCauseKind).sort(),
    );
  });

  test("each name is the kind's English value: English reads as before", () => {
    for (const kind of Object.values(DataAlertCauseKind)) {
      expect(DATA_ALERT_CAUSE_KIND_LABELS[kind]).toBe(kind);
      expect({ kind, english: ENGLISH[kind] }).toEqual({ kind, english: kind });
    }
  });

  test("each is worded in every language the Dashboard is read in", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);

    for (const label of Object.values(DATA_ALERT_CAUSE_KIND_LABELS)) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          label,
          language,
          worded: isWordedInDashboardLocale(label, language),
        }).toEqual({ label, language, worded: true });
      }
    }
  });

  test("the four kinds that were no keys before are worded apart from each other", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const kinds: Array<string> = [
        "Upstream Alert",
        "Failed Run",
        "Failing Writes",
        "Schema Change",
      ].map((kind: string): string => {
        return words[kind]!;
      });

      expect({ language, distinct: new Set(kinds).size }).toEqual({
        language,
        distinct: 4,
      });
    }
  });

  test("a deploy is the noun its chart markers use, and a schema change the noun its list is named with", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);

      expect(words["Deploy"]).not.toBe(words["Change"]);
      // "Schemaänderungen" over "Schemaänderung": one of the list's.
      expect({
        language,
        singular: words["Schema Change"]!.length > 0,
      }).toEqual({ language, singular: true });
    }

    expect(readDashboardLocale("de")["Schema Change"]).toBe("Schemaänderung");
    expect(readDashboardLocale("de")["Schema Changes"]).toBe(
      "Schemaänderungen",
    );
  });

  test("a kind this Dashboard does not know is drawn as it is", () => {
    const german: Translator = dashboardTranslator("de");

    expect(getDataAlertCauseKindLabel(german, "Network Partition")).toBe(
      "Network Partition",
    );
    expect(getDataAlertCauseKindLabel(german, "constructor")).toBe(
      "constructor",
    );
    expect(getDataAlertCauseKindLabel(german, "")).toBe("");
    expect(getDataAlertCauseKindLabel(german, undefined)).toBe("");
    expect(
      getDataAlertCauseKindLabel(german, DataAlertCauseKind.FailedRun),
    ).toBe("Fehlgeschlagene Ausführung");
  });
});

describe("every sentence a cause is titled with", () => {
  test("is a key of the Dashboard's English file, which reads it as written", () => {
    for (const sentence of Object.values(DATA_ALERT_CAUSE_TITLES)) {
      expect({ sentence, english: ENGLISH[sentence] }).toEqual({
        sentence,
        english: sentence,
      });
    }
  });

  test("is worded in every language, with the same names and counts in it", () => {
    for (const sentence of Object.values(DATA_ALERT_CAUSE_TITLES)) {
      for (const language of DASHBOARD_LANGUAGES) {
        const words: Record<string, string> = readDashboardLocale(language);

        expect({
          sentence,
          language,
          worded: isWordedInDashboardLocale(sentence, language),
          placeholders: placeholdersOf(words[sentence] || ""),
        }).toEqual({
          sentence,
          language,
          worded: true,
          placeholders: placeholdersOf(sentence),
        });
      }
    }
  });

  test("a named sentence never words its name's stand-in: German 'Ein Dienst' only where no service is named", () => {
    const german: Record<string, string> = readDashboardLocale("de");

    expect(
      german["{{service}}: {{failed}} of {{total}} writes failed"],
    ).not.toContain("Ein Dienst");
    expect(
      german["A service: {{failed}} of {{total}} writes failed"],
    ).toContain("Ein Dienst");
  });
});

describe("getDataAlertCauseTitle", () => {
  test("says a worded title in the reader's language, the names put in as they are", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      withoutIsolateMarks(
        getDataAlertCauseTitle(german, getFailedRunCauseTitle("nightly_orders"))
          .text,
      ),
    ).toBe("nightly_orders fehlgeschlagen");
    expect(
      getDataAlertCauseTitle(german, getFailedRunCauseTitle(undefined)),
    ).toEqual({ text: "Eine Pipeline ist fehlgeschlagen", isAsWritten: false });
  });

  test("writes the counts in the digits of the sentence's language", () => {
    const writes: DataAlertLikelyCause = {
      kind: DataAlertCauseKind.FailingWrites,
      ...getFailedWritesCauseTitle({
        serviceName: "orders-api",
        failed: 3,
        total: 1200,
      }),
    };

    expect(
      withoutIsolateMarks(
        getDataAlertCauseTitle(dashboardTranslator("en"), writes).text,
      ),
    ).toBe("orders-api: 3 of 1,200 writes failed");
    expect(
      withoutIsolateMarks(
        getDataAlertCauseTitle(dashboardTranslator("de"), writes).text,
      ),
    ).toBe("orders-api: 3 von 1.200 Schreibzugriffen fehlgeschlagen");
    expect(
      withoutIsolateMarks(
        getDataAlertCauseTitle(dashboardTranslator("fa"), writes).text,
      ),
    ).toBe("orders-api: ۳ از ۱٬۲۰۰ نوشتن ناموفق بود");
    // Arabic is written in Latin digits.
    expect(
      withoutIsolateMarks(
        getDataAlertCauseTitle(dashboardTranslator("ar"), writes).text,
      ),
    ).toBe("orders-api: عمليات الكتابة الفاشلة 3 من 1,200");
  });

  test("sets each name apart from the sentence, so a Latin name keeps its direction on a Persian page", () => {
    const text: string = getDataAlertCauseTitle(
      dashboardTranslator("fa"),
      getFailedRunCauseTitle("nightly_orders"),
    ).text;

    expect(text).not.toBe(withoutIsolateMarks(text));
    expect(withoutIsolateMarks(text)).toBe("nightly_orders ناموفق بود");
  });

  test("a title with no sentence, or a sentence this Dashboard does not know, is the server's English as written", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getDataAlertCauseTitle(german, titleAsWritten("#42 raw.orders is late")),
    ).toEqual({ text: "#42 raw.orders is late", isAsWritten: true });
    expect(
      getDataAlertCauseTitle(german, {
        title: "orders-db replica lags 40s",
        titleWords: {
          code: "ReplicaLagging" as DataAlertCauseTitleCode,
          values: { lag: 40 },
        },
      }),
    ).toEqual({ text: "orders-db replica lags 40s", isAsWritten: true });
    expect(
      getDataAlertCauseTitle(german, {
        title: "x",
        titleWords: {
          code: "toString" as DataAlertCauseTitleCode,
          values: {},
        },
      }),
    ).toEqual({ text: "x", isAsWritten: true });
  });

  test("a sentence missing one of its names is the server's English, never a placeholder on the page", () => {
    const german: Translator = dashboardTranslator("de");

    expect(
      getDataAlertCauseTitle(german, {
        title: "nightly_orders failed",
        titleWords: {
          code: DataAlertCauseTitleCode.PipelineFailed,
          values: undefined as never,
        },
      }),
    ).toEqual({ text: "nightly_orders failed", isAsWritten: true });
    expect(
      getDataAlertCauseTitle(german, {
        title: "orders-api: 3 of 120 writes failed",
        titleWords: {
          code: DataAlertCauseTitleCode.WritesFailed,
          values: { service: "orders-api", failed: 3 },
        },
      }),
    ).toEqual({
      text: "orders-api: 3 of 120 writes failed",
      isAsWritten: true,
    });
    // A value it does not use changes nothing.
    expect(
      withoutIsolateMarks(
        getDataAlertCauseTitle(german, {
          title: "A pipeline failed",
          titleWords: {
            code: DataAlertCauseTitleCode.UnnamedPipelineFailed,
            values: { pipeline: "ignored" },
          },
        }).text,
      ),
    ).toBe("Eine Pipeline ist fehlgeschlagen");
  });
});

describe("the Why This Happened card", () => {
  test("in English, reads every cause as it always did", async () => {
    await drawCard("en");

    expect(drawnCauses()).toEqual([
      { kind: "Upstream Alert", title: "#42 raw.orders is late" },
      { kind: "Failed Run", title: "nightly_orders failed" },
      { kind: "Deploy", title: "orders-api: Deployed v2.4.1" },
      { kind: "Failing Writes", title: "orders-api: 3 of 1,200 writes failed" },
      { kind: "Schema Change", title: "A column changed" },
      { kind: "Database", title: "orders-db could not be read" },
    ]);
  });

  test("in German, reads every kind and every worded title in German, the records' own words as written", async () => {
    await drawCard("de");

    expect(drawnCauses()).toEqual([
      { kind: "Vorgelagerte Warnung", title: "#42 raw.orders is late" },
      {
        kind: "Fehlgeschlagene Ausführung",
        title: "nightly_orders fehlgeschlagen",
      },
      { kind: "Deployment", title: "orders-api: Deployed v2.4.1" },
      {
        kind: "Fehlschlagende Schreibzugriffe",
        title: "orders-api: 3 von 1.200 Schreibzugriffen fehlgeschlagen",
      },
      { kind: "Schemaänderung", title: "Eine Spalte hat sich geändert" },
      { kind: "Datenbank", title: "orders-db konnte nicht gelesen werden" },
    ]);
    // The bug: no kind reads its stored English.
    expect(screen.queryByText("Failed Run")).not.toBeInTheDocument();
    expect(screen.queryByText("Upstream Alert")).not.toBeInTheDocument();
  });

  test("in Arabic, reads every kind and worded title in Arabic", async () => {
    await drawCard("ar");

    expect(drawnCauses()).toEqual([
      { kind: "تنبيه في المصدر", title: "#42 raw.orders is late" },
      { kind: "تشغيل فاشل", title: "فشل nightly_orders" },
      { kind: "النشر", title: "orders-api: Deployed v2.4.1" },
      {
        kind: "عمليات كتابة فاشلة",
        title: "orders-api: عمليات الكتابة الفاشلة 3 من 1,200",
      },
      { kind: "تغيير في المخطط", title: "تغيّر عمود" },
      { kind: "قاعدة بيانات", title: "تعذّرت قراءة orders-db" },
    ]);
  });

  test("in Persian, reads every kind and worded title in Persian, its counts in Persian digits", async () => {
    await drawCard("fa");

    expect(drawnCauses()).toEqual([
      { kind: "هشدار بالادستی", title: "#42 raw.orders is late" },
      { kind: "اجرای ناموفق", title: "nightly_orders ناموفق بود" },
      { kind: "استقرار", title: "orders-api: Deployed v2.4.1" },
      {
        kind: "نوشتن‌های ناموفق",
        title: "orders-api: ۳ از ۱٬۲۰۰ نوشتن ناموفق بود",
      },
      { kind: "تغییر طرح‌واره", title: "یک ستون تغییر کرد" },
      { kind: "پایگاه داده", title: "orders-db خوانده نشد" },
    ]);
  });

  test("on a Persian page, a record's own words are set apart, and the facts are parted by its own mark", async () => {
    await drawCard("fa");

    const lines: Array<HTMLElement> = screen.getAllByTestId(
      DATA_ALERT_CAUSE_TEST_ID,
    );
    const upstream: HTMLElement = within(lines[0]!).getByTestId(
      DATA_ALERT_CAUSE_TITLE_TEST_ID,
    );

    // An alert's title: its own direction, in a bdi.
    expect(upstream.querySelector("bdi")).toHaveTextContent(
      "#42 raw.orders is late",
    );
    // A worded title is a sentence of the page's language: no bdi of its own.
    expect(
      within(lines[1]!)
        .getByTestId(DATA_ALERT_CAUSE_TITLE_TEST_ID)
        .querySelector("bdi"),
    ).toBeNull();
    // Persian parts facts with "•": a middle dot beside its digits reads as a zero.
    expect(lines[1]!.textContent).toContain("•");
    expect(lines[1]!.textContent).not.toContain("·");
  });

  test("what a source system said is drawn as written, set apart in its own direction", async () => {
    await drawCard("fa");

    const detail: HTMLElement = screen.getByTestId(
      DATA_ALERT_CAUSE_DETAIL_TEST_ID,
    );

    expect(detail).toHaveTextContent("relation orders does not exist.");
    // An English message on a right-to-left page reads left to right.
    expect(detail).toHaveAttribute("dir", "ltr");
  });

  test("in English, the facts are parted by the middle dot, as before", async () => {
    await drawCard("en", [CAUSES[1]!]);

    const line: HTMLElement = screen.getByTestId(DATA_ALERT_CAUSE_TEST_ID);

    expect(line.textContent).toContain(" · ");
    expect(
      within(line).getByTestId(DATA_ALERT_CAUSE_DETAIL_TEST_ID),
    ).toHaveTextContent("relation orders does not exist.");
  });

  test("a cause from an older server, with no sentence, reads its English title in every language", async () => {
    await drawCard("de", [
      {
        kind: DataAlertCauseKind.FailedRun,
        title: "nightly_orders failed",
        at: AT,
      },
    ]);

    expect(drawnCauses()).toEqual([
      { kind: "Fehlgeschlagene Ausführung", title: "nightly_orders failed" },
    ]);
  });

  test("a kind from a newer server is drawn as it is sent", async () => {
    await drawCard("de", [
      {
        kind: "Replica Lag" as DataAlertCauseKind,
        title: "orders-db replica lags 40s",
      },
    ]);

    expect(drawnCauses()).toEqual([
      { kind: "Replica Lag", title: "orders-db replica lags 40s" },
    ]);
  });

  test("with no cause, says so in the reader's language", async () => {
    await drawCard("de", []);

    expect(screen.queryAllByTestId(DATA_ALERT_CAUSE_TEST_ID)).toEqual([]);
    expect(
      screen.getByText(
        readDashboardLocaleAsDrawn("de")[
          "Nothing around this alert explains it: no alert upstream, failed run, deploy, failing write, schema change or database failure."
        ]!,
      ),
    ).toBeInTheDocument();
  });
});
