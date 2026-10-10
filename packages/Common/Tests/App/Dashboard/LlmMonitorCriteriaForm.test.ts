import { describe, expect, test } from "@jest/globals";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import { CheckOn, CriteriaFilter, FilterType } from "../../../Types/Monitor/CriteriaFilter";
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

function isRenderable(filter: { checkOn: CheckOn; filterType?: FilterType | undefined }): boolean {
  return (
    values(CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Llm)).includes(
      filter.checkOn,
    ) &&
    values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(filter.checkOn)).includes(
      filter.filterType,
    )
  );
}

describe("what an AI / LLM monitor compares", () => {
  test("the share of bad answers first, then their count, then the answers", () => {
    expect(values(CriteriaFilterUtil.getCheckOnOptionsByMonitorType(MonitorType.Llm))).toEqual(
      LLM_CHECKS,
    );
  });

  test("a new filter starts on the share of bad answers, greater than", () => {
    expect(CriteriaFilterUtil.getDefaultCheckOnByMonitorType(MonitorType.Llm)).toBe(
      CheckOn.LlmBadAnswerPercent,
    );
    expect(
      CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(CheckOn.LlmBadAnswerPercent),
    ).toBe(FilterType.GreaterThan);
  });

  test("no other monitor type offers these numbers", () => {
    for (const monitorType of [MonitorType.Traces, MonitorType.Logs, MonitorType.API]) {
      for (const checkOn of LLM_CHECKS) {
        expect(
          values(CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType)),
        ).not.toContain(checkOn);
      }
    }
  });

  test.each(LLM_CHECKS)("%s is compared as a number, six ways, Greater Than first", (checkOn: CheckOn) => {
    expect(values(CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn))).toEqual(
      NUMBER_COMPARISONS,
    );
  });

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
    for (const filter of [...template.unhealthyFilters, ...template.healthyFilters]) {
      expect({
        filter,
        renderable: isRenderable(filter as LlmMonitorTemplateFilter),
      }).toEqual({ filter, renderable: true });
    }
  });
});
