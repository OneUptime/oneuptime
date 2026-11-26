import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import CriteriaFilterElement from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import CriteriaFilterUiUtil, {
  CRITERIA_COMPARISON_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import {
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  buildHostMonitorConfig,
  buildHostMonitorStep,
  buildHostOfflineCriteriaInstance,
  buildHostOnlineCriteriaInstance,
} from "../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * NOT EQUAL TO, FOR A METRIC'S VALUE, IN THE CRITERIA FORM (#10449).
 *
 * Many metrics are a state written as a number - a Windows service's status
 * (4 is Running), a unit's state, an enum gauge - and what is asked of one
 * is "anything but the healthy state". The criteria form now offers Not
 * Equal To for a metric's value, right after Equal To. Drawn here as a
 * person meets it: a Host monitor's rule on a Windows service's status, in
 * every language the Dashboard speaks, from the shipped locale files - the
 * Condition list names it as that language does, and picking it keeps the
 * Threshold to type the healthy state in.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];

const STATUS_ALIAS: string = "service_status";

// A Host monitor reading a Windows service's status, as Create Monitor makes one.
function hostStep(): MonitorStep {
  return buildHostMonitorStep({
    hostMonitor: buildHostMonitorConfig({
      hostIdentifier: "web-01",
      metricName: "windows.service.status",
      metricAlias: STATUS_ALIAS,
      rollingTime: RollingTime.Past5Minutes,
      aggregationType: MetricsAggregationType.Max,
      attributes: { name: "Spooler" },
    }),
    offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
      offlineMonitorStatusId: ObjectID.generate(),
      incidentSeverityId: ObjectID.generate(),
      alertSeverityId: ObjectID.generate(),
      monitorName: "Spooler on web-01",
      metricAlias: STATUS_ALIAS,
      filterType: FilterType.NotEqualTo,
      value: 4,
    }),
    onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
      onlineMonitorStatusId: ObjectID.generate(),
      metricAlias: STATUS_ALIAS,
      filterType: FilterType.EqualTo,
      value: 4,
    }),
  });
}

const RUNNING_FILTER: CriteriaFilter = {
  checkOn: CheckOn.MetricValue,
  filterType: FilterType.EqualTo,
  value: 4,
  metricMonitorOptions: {
    metricAlias: STATUS_ALIAS,
    metricAggregationType: EvaluateOverTimeType.AnyValue,
  },
};

// What a language draws for a key: its own word, else the key itself.
function drawn(language: string, key: string): string {
  return readDashboardLocale(language)[key] || key;
}

/*
 * Whether a language words a key: English holds it as written, every other
 * language its own way, as npm run i18n:check counts it.
 */
function isWorded(key: string, language: string): boolean {
  return language === "en"
    ? readDashboardLocale("en")[key] === key
    : isWordedInDashboardLocale(key, language);
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
});

interface Rendered {
  emitted: Array<CriteriaFilter>;
}

function renderFilter(initial: CriteriaFilter): Rendered {
  const emitted: Array<CriteriaFilter> = [];
  const step: MonitorStep = hostStep();

  const Parent: React.FunctionComponent = (): React.ReactElement => {
    const [criteriaFilter, setCriteriaFilter] =
      React.useState<CriteriaFilter>(initial);

    return (
      <CriteriaFilterElement
        monitorType={MonitorType.Host}
        monitorStep={step}
        value={criteriaFilter}
        onChange={(value: CriteriaFilter) => {
          emitted.push(value);
          setCriteriaFilter(value);
        }}
      />
    );
  };

  render(<Parent />);

  return { emitted: emitted };
}

// The Condition list, opened as a reader opens it: its options as drawn.
async function openCondition(language: string): Promise<Array<HTMLElement>> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

  await user.click(
    screen.getByRole("combobox", { name: drawn(language, "Condition") }),
  );

  return screen.getAllByRole("option");
}

describe("the words for Not Equal To, in every language", () => {
  test.each(LANGUAGES)(
    "%s words the condition, apart from Equal To",
    (language: string) => {
      expect(isWorded("Not Equal To", language)).toBe(true);
      expect(drawn(language, "Not Equal To")).not.toBe(
        drawn(language, "Equal To"),
      );
      // And the criteria list's sentence for it, and the rule editor's word.
      expect(
        isWorded(
          CRITERIA_COMPARISON_SENTENCES[FilterType.NotEqualTo]!,
          language,
        ),
      ).toBe(true);
      expect(isWorded("Anything but", language)).toBe(true);
    },
  );
});

describe("the criteria form offers Not Equal To for a metric's value", () => {
  test("right after Equal To, and the default stays Equal To", () => {
    const offered: Array<unknown> =
      CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(
        CheckOn.MetricValue,
      ).map((option: { value: unknown }): unknown => {
        return option.value;
      });

    expect(offered.indexOf(FilterType.NotEqualTo)).toBe(
      offered.indexOf(FilterType.EqualTo) + 1,
    );
    expect(
      CriteriaFilterUiUtil.getDefaultFilterTypeByCheckOn(CheckOn.MetricValue),
    ).toBe(FilterType.EqualTo);
    // A threshold to type, as for every other comparison.
    expect(
      CriteriaFilterUtil.hasValueField({
        checkOn: CheckOn.MetricValue,
        filterType: FilterType.NotEqualTo,
      }),
    ).toBe(true);
  });

  test.each([
    CheckOn.LogCount,
    CheckOn.SpanCount,
    CheckOn.ResponseTime,
    CheckOn.ResponseStatusCode,
  ])("%s keeps the conditions it had", (checkOn: CheckOn) => {
    const offered: Array<unknown> =
      CriteriaFilterUiUtil.getFilterTypeOptionsByCheckOn(checkOn).map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      );

    expect({
      checkOn,
      offersNotEqualTo: offered.includes(FilterType.NotEqualTo),
    }).toEqual({
      checkOn,
      // A status code was compared with it all along; a count and a time never.
      offersNotEqualTo: checkOn === CheckOn.ResponseStatusCode,
    });
  });

  test.each(LANGUAGES)(
    "%s: the Condition list names it after Equal To, and picking it keeps the Threshold",
    async (language: string) => {
      await inLanguage(language);

      const rendered: Rendered = renderFilter(RUNNING_FILTER);
      const options: Array<string> = (await openCondition(language)).map(
        (option: HTMLElement): string => {
          return option.textContent || "";
        },
      );

      expect(options.indexOf(drawn(language, "Not Equal To"))).toBe(
        options.indexOf(drawn(language, "Equal To")) + 1,
      );
      expect(options.indexOf(drawn(language, "Equal To"))).toBeGreaterThan(-1);

      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      await user.click(
        screen.getByRole("option", { name: drawn(language, "Not Equal To") }),
      );

      expect(rendered.emitted[rendered.emitted.length - 1]).toEqual(
        expect.objectContaining({
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.NotEqualTo,
        }),
      );

      // The list now shows the condition picked, in the reader's words.
      expect(
        screen
          .getByRole("combobox", { name: drawn(language, "Condition") })
          .closest(".ou-select__control")?.textContent,
      ).toContain(drawn(language, "Not Equal To"));

      // And the Threshold is still there to type the healthy state in.
      expect(screen.getByText(drawn(language, "Threshold"))).toBeTruthy();
    },
  );
});
