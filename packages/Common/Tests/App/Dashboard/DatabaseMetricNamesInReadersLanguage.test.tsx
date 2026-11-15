import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import DatabaseMonitorView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/DatabaseMonitorView";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import DatabaseMonitorResponse from "../../../Types/Monitor/DatabaseMonitor/DatabaseMonitorResponse";
import {
  DatabaseMetricCategory,
  DatabaseMetricDefinition,
  DatabaseMetricGroup,
  getAllDatabaseMetrics,
  getDatabaseMetricByMetricType,
  getDatabaseMetricCategoryLabel,
  getDatabaseMetricCategoryOrder,
  getDatabaseMetricsByCategory,
  getDatabaseMetricsForEngine,
} from "../../../Types/Monitor/DatabaseMetricCatalog";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import SqlDatabaseType from "../../../Types/Monitor/SqlDatabaseType";
import {
  NARROW_NO_BREAK_SPACE,
  NO_BREAK_SPACE,
} from "../../../Types/NoBreakSpaces";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import {
  codeReadsAsWrittenPostProcessor,
  getTranslationPostProcess,
  whenCodeCanBeSetApart,
  withoutIsolates,
} from "../../../UI/Utils/CodeReadsAsWritten";
import { productNamePostProcessor } from "../../../UI/Utils/ProductNameTranslation";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * A DATABASE HEALTH MONITOR'S METRIC NAMES AND GROUP HEADINGS, IN THE
 * READER'S LANGUAGE (#8354).
 *
 * The criteria's metric dropdown labelled each option with its catalog's
 * English name and sorted them by it, the summary named each metric in
 * English and headed each group with the category's English value, and a
 * metric the chosen engine does not collect was named in English in its
 * stale label. The names are keys now (DatabaseMetricCatalog's
 * friendlyName), and so are the headings (getDatabaseMetricCategoryLabel):
 * each is looked up once, where it is drawn, and the dropdown sorts by the
 * names the reader reads. A row's "Not collected" is looked up as well.
 *
 * Drawn as the Dashboard sets its words up, in English, German, Arabic and
 * Persian from the Dashboard's own locale files, and again with every name,
 * heading and "Not collected" worded as a probe that is itself a key
 * reading TWICE: a word looked up twice would say it.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const TWICE: string = "TWICE";

const PROBE_MARKS: Readonly<Record<string, string>> = {
  en: "EN› ",
  de: "DE› ",
  ar: "ع› ",
  fa: "ف› ",
};

const NOT_COLLECTED: string = "Not collected";

const STALE_LABEL: string = "{{metric}} - not collected by {{engine}}";

const NAMES: Array<string> = getAllDatabaseMetrics().map(
  (metric: DatabaseMetricDefinition): string => {
    return metric.friendlyName;
  },
);

const HEADINGS: Array<string> = getDatabaseMetricCategoryOrder().map(
  (category: DatabaseMetricCategory): string => {
    return getDatabaseMetricCategoryLabel(category);
  },
);

const PROBED_TEXTS: Array<string> = Array.from(
  new Set<string>([...NAMES, ...HEADINGS, NOT_COLLECTED]),
);

const probeOf: (language: string, text: string) => string = (
  language: string,
  text: string,
): string => {
  return `${PROBE_MARKS[language]}${text}`;
};

const realWords: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  return readDashboardLocale(language);
};

const probedWords: (language: string) => Record<string, string> = (
  language: string,
): Record<string, string> => {
  const words: Record<string, string> = { ...realWords(language) };

  for (const text of PROBED_TEXTS) {
    words[text] = probeOf(language, text);
    words[probeOf(language, text)] = TWICE;
  }

  return words;
};

// What the reader's Dashboard draws for a text.
const wordOf: (words: Record<string, string>, text: string) => string = (
  words: Record<string, string>,
  text: string,
): string => {
  return words[text] || text;
};

const dashboardI18n: i18n = createInstance();
const probedI18n: i18n = createInstance();

beforeAll(async () => {
  await whenCodeCanBeSetApart("ar");

  for (const [instance, wordsOf] of [
    [dashboardI18n, realWords],
    [probedI18n, probedWords],
  ] as Array<[i18n, (language: string) => Record<string, string>]>) {
    const resources: Record<string, { translation: Record<string, string> }> =
      {};

    for (const language of LANGUAGES) {
      resources[language] = { translation: wordsOf(language) };
    }

    await instance
      .use(productNamePostProcessor)
      .use(codeReadsAsWrittenPostProcessor)
      .init({
        lng: "en",
        fallbackLng: "en",
        postProcess: getTranslationPostProcess(),
        resources: resources,
        interpolation: { escapeValue: false },
      });
  }
});

afterEach(() => {
  cleanup();
});

const drawIn: (
  instance: i18n,
  language: string,
  element: ReactElement,
) => HTMLElement = (
  instance: i18n,
  language: string,
  element: ReactElement,
): HTMLElement => {
  void instance.changeLanguage(language);

  return render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>)
    .container;
};

// What an element shows, without the isolates' marks, with plain spaces.
const shownIn: (element: Element) => string = (element: Element): string => {
  return withoutIsolates(element.textContent || "")
    .split(NO_BREAK_SPACE)
    .join(" ")
    .split(NARROW_NO_BREAK_SPACE)
    .join(" ")
    .trim();
};

// The one metric the check below collected; every other row is not collected.
const COLLECTED: DatabaseMetricDefinition = getDatabaseMetricByMetricType(
  MonitorMetricType.DatabaseConnectionsTotal,
) as DatabaseMetricDefinition;

const RESPONSE: ProbeMonitorResponse = {
  isOnline: true,
  probeId: ObjectID.generate(),
  monitorId: ObjectID.generate(),
  monitorStepId: ObjectID.generate(),
  failureCause: "",
  monitoredAt: new Date(),
  databaseMonitorResponse: {
    isOnline: true,
    responseTimeInMs: 12,
    failureCause: "",
    metrics: { [COLLECTED.metricType]: 12 },
    collectedGroups: Object.values(DatabaseMetricGroup),
    unavailableGroups: [],
    connectionError: null,
  } as DatabaseMonitorResponse,
} as unknown as ProbeMonitorResponse;

const drawSummary: (instance: i18n, language: string) => HTMLElement = (
  instance: i18n,
  language: string,
): HTMLElement => {
  return drawIn(
    instance,
    language,
    <DatabaseMonitorView probeMonitorResponse={RESPONSE} />,
  );
};

const headingsIn: (container: HTMLElement) => Array<string> = (
  container: HTMLElement,
): Array<string> => {
  return Array.from(container.querySelectorAll("h3")).map(shownIn);
};

// Each metric row of the summary: its name and its value, as drawn.
const rowsIn: (container: HTMLElement) => Array<[string, string]> = (
  container: HTMLElement,
): Array<[string, string]> => {
  return Array.from(container.querySelectorAll("tbody tr")).map(
    (row: Element): [string, string] => {
      const cells: Array<Element> = Array.from(row.querySelectorAll("td"));

      return [shownIn(cells[0] as Element), shownIn(cells[1] as Element)];
    },
  );
};

// The summary's rows, group by group, as the catalog orders them.
const SUMMARY_ROWS: Array<DatabaseMetricDefinition> =
  getDatabaseMetricCategoryOrder().flatMap(
    (category: DatabaseMetricCategory): Array<DatabaseMetricDefinition> => {
      return getDatabaseMetricsByCategory(category);
    },
  );

describe("a Database monitor's summary", () => {
  test.each(LANGUAGES)(
    "%s heads each group in the reader's words",
    (language: string) => {
      const words: Record<string, string> = realWords(language);

      expect(headingsIn(drawSummary(dashboardI18n, language))).toEqual(
        HEADINGS.map((heading: string): string => {
          return wordOf(words, heading);
        }),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s names each metric in the reader's words, and says so of one not collected",
    (language: string) => {
      const words: Record<string, string> = realWords(language);
      const rows: Array<[string, string]> = rowsIn(
        drawSummary(dashboardI18n, language),
      );

      expect(
        rows.map((row: [string, string]): string => {
          return row[0];
        }),
      ).toEqual(
        SUMMARY_ROWS.map((metric: DatabaseMetricDefinition): string => {
          return wordOf(words, metric.friendlyName);
        }),
      );

      for (const [index, metric] of SUMMARY_ROWS.entries()) {
        if (metric.metricType === COLLECTED.metricType) {
          expect((rows[index] as [string, string])[1]).toBe("12");
        } else {
          expect((rows[index] as [string, string])[1]).toBe(
            wordOf(words, NOT_COLLECTED),
          );
        }
      }
    },
  );

  test.each(["de", "ar", "fa"])(
    "%s heads no group and names no metric in English",
    (language: string) => {
      const container: HTMLElement = drawSummary(dashboardI18n, language);
      const shown: Array<string> = [
        ...headingsIn(container),
        ...rowsIn(container).map((row: [string, string]): string => {
          return row[0];
        }),
      ];
      // What the language keeps as written: product names and a few shared words.
      const keptAsWritten: Array<string> = PROBED_TEXTS.filter(
        (text: string): boolean => {
          return realWords(language)[text] === text;
        },
      );

      expect(keptAsWritten.length).toBeLessThan(3);

      for (const text of [...HEADINGS, ...NAMES]) {
        if (!keptAsWritten.includes(text)) {
          expect({ text, inEnglish: shown.includes(text) }).toEqual({
            text,
            inEnglish: false,
          });
        }
      }
    },
  );

  test.each(LANGUAGES)(
    "%s looks each heading, name and Not collected up once",
    (language: string) => {
      const container: HTMLElement = drawSummary(probedI18n, language);

      expect(headingsIn(container)).toEqual(
        HEADINGS.map((heading: string): string => {
          return probeOf(language, heading);
        }),
      );

      const rows: Array<[string, string]> = rowsIn(container);

      expect(
        rows.map((row: [string, string]): string => {
          return row[0];
        }),
      ).toEqual(
        SUMMARY_ROWS.map((metric: DatabaseMetricDefinition): string => {
          return probeOf(language, metric.friendlyName);
        }),
      );
      expect(
        rows.filter((row: [string, string]): boolean => {
          return row[1] === probeOf(language, NOT_COLLECTED);
        }).length,
      ).toBe(SUMMARY_ROWS.length - 1);
      expect(shownIn(container)).not.toContain(TWICE);
    },
  );
});

const doNothing: () => void = (): void => {};

const drawCriteria: (
  engine: SqlDatabaseType,
  metric: DatabaseMetricDefinition,
) => ReactElement = (
  engine: SqlDatabaseType,
  metric: DatabaseMetricDefinition,
): ReactElement => {
  const step: MonitorStep = new MonitorStep();

  step.data = {
    ...(step.data || {}),
    databaseMonitor: { databaseType: engine },
  } as MonitorStep["data"];

  return (
    <CriteriaFilterElement
      monitorType={MonitorType.Database}
      monitorStep={step}
      value={{
        checkOn: CheckOn.DatabaseMetric,
        filterType: FilterType.GreaterThan,
        value: 1,
        databaseMonitorOptions: { metricType: metric.metricType },
      }}
      onChange={doNothing}
    />
  );
};

// The metric's field: the dropdown and the line under it.
const metricFieldIn: (container: HTMLElement) => HTMLElement = (
  container: HTMLElement,
): HTMLElement => {
  const line: HTMLElement | null = container.querySelector(
    '[data-testid="database-metric-description"]',
  );

  expect(line).not.toBeNull();

  return (line as HTMLElement).parentElement as HTMLElement;
};

const pickedIn: (container: HTMLElement) => string = (
  container: HTMLElement,
): string => {
  const picked: Element | null = metricFieldIn(container).querySelector(
    ".ou-select__single-value",
  );

  expect(picked).not.toBeNull();

  return shownIn(picked as Element);
};

const withUnit: (name: string, metric: DatabaseMetricDefinition) => string = (
  name: string,
  metric: DatabaseMetricDefinition,
): string => {
  return metric.unit ? `${name} (${metric.unit})` : name;
};

// A PostgreSQL metric with a unit, and one MySQL does not collect.
const WITH_UNIT: DatabaseMetricDefinition = getDatabaseMetricByMetricType(
  MonitorMetricType.DatabaseConnectionsUsedPercent,
) as DatabaseMetricDefinition;

const POSTGRESQL_ONLY: DatabaseMetricDefinition = getDatabaseMetricByMetricType(
  MonitorMetricType.DatabaseDeadTuples,
) as DatabaseMetricDefinition;

describe("a Database Health criteria's metric dropdown", () => {
  test("its two metrics are what this test needs", () => {
    expect(WITH_UNIT.unit).toBe("%");
    expect(WITH_UNIT.engines).toContain(SqlDatabaseType.PostgreSQL);
    expect(POSTGRESQL_ONLY.engines).toEqual([SqlDatabaseType.PostgreSQL]);
  });

  test.each(LANGUAGES)(
    "%s names the chosen metric and its unit in the reader's words",
    (language: string) => {
      const words: Record<string, string> = realWords(language);
      const container: HTMLElement = drawIn(
        dashboardI18n,
        language,
        drawCriteria(SqlDatabaseType.PostgreSQL, WITH_UNIT),
      );

      expect(pickedIn(container)).toBe(
        withUnit(wordOf(words, WITH_UNIT.friendlyName), WITH_UNIT),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s lists each group's metrics by the names the reader reads, in the language's order",
    async (language: string) => {
      const words: Record<string, string> = realWords(language);
      const container: HTMLElement = drawIn(
        dashboardI18n,
        language,
        drawCriteria(SqlDatabaseType.PostgreSQL, WITH_UNIT),
      );
      const input: HTMLElement | null = metricFieldIn(container).querySelector(
        'input[role="combobox"]',
      );

      expect(input).not.toBeNull();

      await act(async () => {
        fireEvent.keyDown(input as HTMLElement, { key: "ArrowDown" });
      });

      const order: Array<DatabaseMetricCategory> =
        getDatabaseMetricCategoryOrder();
      const expected: Array<string> = [
        ...getDatabaseMetricsForEngine(SqlDatabaseType.PostgreSQL),
      ]
        .sort(
          (
            a: DatabaseMetricDefinition,
            b: DatabaseMetricDefinition,
          ): number => {
            return (
              order.indexOf(a.category) - order.indexOf(b.category) ||
              wordOf(words, a.friendlyName).localeCompare(
                wordOf(words, b.friendlyName),
                language,
              )
            );
          },
        )
        .map((metric: DatabaseMetricDefinition): string => {
          return withUnit(wordOf(words, metric.friendlyName), metric);
        });

      expect(screen.getAllByRole("option").map(shownIn)).toEqual(expected);
    },
  );

  test.each(LANGUAGES)(
    "%s names a metric the chosen engine does not collect in the reader's words",
    (language: string) => {
      const words: Record<string, string> = realWords(language);
      const container: HTMLElement = drawIn(
        dashboardI18n,
        language,
        drawCriteria(SqlDatabaseType.MySQL, POSTGRESQL_ONLY),
      );

      expect(pickedIn(container)).toBe(
        wordOf(words, STALE_LABEL)
          .replace("{{metric}}", wordOf(words, POSTGRESQL_ONLY.friendlyName))
          .replace("{{engine}}", SqlDatabaseType.MySQL),
      );
    },
  );

  test.each(LANGUAGES)(
    "%s looks the chosen metric's name up once, and a stale one's too",
    (language: string) => {
      expect(
        pickedIn(
          drawIn(
            probedI18n,
            language,
            drawCriteria(SqlDatabaseType.PostgreSQL, WITH_UNIT),
          ),
        ),
      ).toBe(withUnit(probeOf(language, WITH_UNIT.friendlyName), WITH_UNIT));

      cleanup();

      const stale: string = pickedIn(
        drawIn(
          probedI18n,
          language,
          drawCriteria(SqlDatabaseType.MySQL, POSTGRESQL_ONLY),
        ),
      );

      expect(stale).toContain(probeOf(language, POSTGRESQL_ONLY.friendlyName));
      expect(stale).not.toContain(TWICE);
    },
  );
});
