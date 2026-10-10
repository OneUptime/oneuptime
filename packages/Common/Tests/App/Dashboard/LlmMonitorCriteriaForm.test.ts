import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import CriteriaFilterUtil, {
  LLM_CHECK_ON_LABELS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
  LlmMonitorTemplateFilter,
} from "../../../Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";

/*
 * The criteria form of an AI / LLM monitor: which numbers it compares
 * (the share of bad answers, their count, the count of answers), with which
 * comparisons, and what a new filter starts with. Every criteria the
 * product ships for this monitor - the defaults a new monitor gets and the
 * ready-made alerts - must draw in that form without a blank dropdown.
 */

const LLM_CHECKS: Array<CheckOn> = [
  CheckOn.LlmBadAnswerPercent,
  CheckOn.LlmBadAnswerCount,
  CheckOn.LlmAnswerCount,
];

const NUMBER_COMPARISONS: Array<FilterType> = [
  FilterType.GreaterThan,
  FilterType.GreaterThanOrEqualTo,
  FilterType.LessThan,
  FilterType.LessThanOrEqualTo,
  FilterType.EqualTo,
  FilterType.NotEqualTo,
];

function values(options: Array<DropdownOption>): Array<unknown> {
  return options.map((option: DropdownOption): unknown => {
    return option.value;
  });
}

function isRenderable(filter: {
  checkOn: CheckOn;
  filterType?: FilterType | undefined;
}): boolean {
  return (
    values(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Llm),
    ).includes(filter.checkOn) &&
    values(
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(filter.checkOn),
    ).includes(filter.filterType)
  );
}

describe("what an AI / LLM monitor compares", () => {
  test("the share of bad answers first, then their count, then the answers", () => {
    expect(
      values(
        CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Llm),
      ),
    ).toEqual(LLM_CHECKS);
  });

  test("a new filter starts on the share of bad answers, greater than", () => {
    expect(
      CriteriaFilterUtil.getDefaultCheckOnByMonitorType(MonitorType.Llm),
    ).toBe(CheckOn.LlmBadAnswerPercent);
    expect(
      CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(
        CheckOn.LlmBadAnswerPercent,
      ),
    ).toBe(FilterType.GreaterThan);
  });

  test("no other monitor type offers these numbers", () => {
    for (const monitorType of [
      MonitorType.Traces,
      MonitorType.Logs,
      MonitorType.API,
    ]) {
      for (const checkOn of LLM_CHECKS) {
        expect(
          values(
            CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType),
          ),
        ).not.toContain(checkOn);
      }
    }
  });

  test.each(LLM_CHECKS)(
    "%s is compared as a number, six ways, Greater Than first",
    (checkOn: CheckOn) => {
      expect(
        values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn)),
      ).toEqual(NUMBER_COMPARISONS);
    },
  );

  test("the value placeholders suggest the ready-made thresholds", () => {
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.Llm,
        checkOn: CheckOn.LlmBadAnswerPercent,
      }),
    ).toBe("5");
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.Llm,
        checkOn: CheckOn.LlmBadAnswerCount,
      }),
    ).toBe("3");
    expect(
      CriteriaFilterUtil.getFilterTypePlaceholderValueByCheckOn({
        monitorType: MonitorType.Llm,
        checkOn: CheckOn.LlmAnswerCount,
      }),
    ).toBe("0");
  });

  test("the share reads as a percentage in the criteria's sentence", () => {
    const text: string = CriteriaFilterUtil.translateFilterToText({
      checkOn: CheckOn.LlmBadAnswerPercent,
      filterType: FilterType.GreaterThan,
      value: 5,
    } as CriteriaFilter);

    expect(text).toContain(CheckOn.LlmBadAnswerPercent);
    expect(text).toContain("5%");
  });

  test("a count does not", () => {
    const text: string = CriteriaFilterUtil.translateFilterToText({
      checkOn: CheckOn.LlmBadAnswerCount,
      filterType: FilterType.GreaterThanOrEqualTo,
      value: 3,
    } as CriteriaFilter);

    expect(text).toContain(CheckOn.LlmBadAnswerCount);
    expect(text).not.toContain("%");
  });
});

describe("every criteria the product ships draws in the form", () => {
  test("the defaults a new AI / LLM monitor gets", () => {
    const statusId: ObjectID = ObjectID.generate();
    const defaults: Array<MonitorCriteriaInstance | null> = [
      MonitorCriteriaInstance.getDefaultOnlineMonitorCriteriaInstance({
        monitorType: MonitorType.Llm,
        monitorStatusId: statusId,
        monitorName: "Support bot",
      }),
      MonitorCriteriaInstance.getDefaultOfflineMonitorCriteriaInstance({
        monitorType: MonitorType.Llm,
        monitorStatusId: statusId,
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        monitorName: "Support bot",
      }),
    ];

    for (const instance of defaults) {
      expect(instance?.data?.filters.length).toBeGreaterThan(0);

      for (const filter of instance?.data?.filters || []) {
        expect({ filter, renderable: isRenderable(filter) }).toEqual({
          filter,
          renderable: true,
        });
      }
    }
  });

  test.each(
    LlmMonitorTemplates.getAll().map((template: LlmMonitorTemplate) => {
      return [template.id, template];
    }),
  )("the ready-made alert %s", (_id: unknown, template: LlmMonitorTemplate) => {
    for (const filter of [
      ...template.unhealthyFilters,
      ...template.healthyFilters,
    ]) {
      expect({
        filter,
        renderable: isRenderable(filter as LlmMonitorTemplateFilter),
      }).toEqual({ filter, renderable: true });
    }
  });
});

/*
 * The dropdown draws each option's label (its CheckOn value) in the
 * reader's language, so the three numbers an AI / LLM monitor compares
 * read in German for a German reader only when every locale has them.
 */
describe("the numbers it compares, in every language", () => {
  const LOCALES_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );
  const LOCALES: Array<string> = [
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ];

  function readLocale(locale: string): Record<string, unknown> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
    ) as Record<string, unknown>;
  }

  test("the labels spelled out for the locale files are the options' labels, in order", () => {
    expect([...LLM_CHECK_ON_LABELS]).toEqual(LLM_CHECKS);
    expect(
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Llm).map(
        (option: DropdownOption): unknown => {
          return option.label;
        },
      ),
    ).toEqual([...LLM_CHECK_ON_LABELS]);
  });

  test("English ships each label as a key", () => {
    const english: Record<string, unknown> = readLocale("en");

    for (const label of LLM_CHECK_ON_LABELS) {
      expect({ label, value: english[label] }).toEqual({ label, value: label });
    }
  });

  test.each(LOCALES)("%s has its own words for each", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    for (const label of LLM_CHECK_ON_LABELS) {
      const value: unknown = translations[label];

      expect({
        label,
        translated:
          typeof value === "string" && value.trim() !== "" && value !== label,
      }).toEqual({
        label,
        translated: true,
      });
    }
  });

  // The percent sign, Latin or Persian.
  const PERCENT_SIGN: RegExp = /[%٪]/;

  test("the share keeps its percent sign in every language", () => {
    for (const locale of LOCALES) {
      const value: string = readLocale(locale)[
        "Bad AI Answers (in %)"
      ] as string;

      expect({ locale, percent: PERCENT_SIGN.test(value) }).toEqual({
        locale,
        percent: true,
      });
    }
  });
});
