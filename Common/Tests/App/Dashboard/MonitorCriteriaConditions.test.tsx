import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import CriteriaFilterElement, {
  NetworkDeviceCriteriaCatalogueContext,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import CriteriaFilters from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilters";
import CriteriaFilterUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";

function renderConditions(
  filters: Array<CriteriaFilter>,
  monitorType: MonitorType = MonitorType.Website,
  filterCondition: FilterCondition = FilterCondition.All,
  monitorStep: MonitorStep = new MonitorStep(),
): { latest: () => Array<CriteriaFilter>; changes: () => number } {
  let latest: Array<CriteriaFilter> = filters;
  let changes: number = 0;
  function Harness(): ReactElement {
    const [value, setValue] = React.useState<Array<CriteriaFilter>>(filters);
    return (
      <CriteriaFilters
        value={value}
        monitorStep={monitorStep}
        monitorType={monitorType}
        filterCondition={filterCondition}
        onChange={(next: Array<CriteriaFilter>) => {
          latest = next;
          changes++;
          setValue(next);
        }}
      />
    );
  }
  render(<Harness />);
  return {
    latest: () => {
      return latest;
    },
    changes: () => {
      return changes;
    },
  };
}

async function choose(label: string, option: string): Promise<void> {
  const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(await screen.findByRole("option", { name: option }));
}

const ONLINE: CriteriaFilter = {
  checkOn: CheckOn.IsOnline,
  filterType: FilterType.True,
};
const RESPONSE_TIME: CriteriaFilter = {
  checkOn: CheckOn.ResponseTime,
  filterType: FilterType.GreaterThan,
  value: 1000,
};

afterEach(cleanup);

describe("Monitor condition editor", () => {
  test("labels primary fields accessibly, displays zero, and preserves it while editing", () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      {
        checkOn: CheckOn.ResponseStatusCode,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ]);
    expect(screen.getByRole("combobox", { name: "Check" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Condition" })).toBeTruthy();
    expect(
      (screen.getByRole("textbox", { name: "Value" }) as HTMLInputElement)
        .value,
    ).toBe("0");
    fireEvent.change(screen.getByRole("textbox", { name: "Value" }), {
      target: { value: "503" },
    });
    expect(harness.latest()[0]!.value).toBe("503");
    expect(harness.latest()[0]!.filterType).toBe(FilterType.EqualTo);
  });

  test("boolean conditions hide the unused value input", () => {
    renderConditions([ONLINE]);
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  });

  test("changing a check resets incompatible settings and supplies a valid comparator", async () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      {
        ...RESPONSE_TIME,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          evaluateOverTimeType: EvaluateOverTimeType.Average,
          timeValueInMinutes: 10,
        },
      },
    ]);
    await choose("Check", CheckOn.IsOnline);
    expect(harness.latest()[0]!.checkOn).toBe(CheckOn.IsOnline);
    expect(harness.latest()[0]!.filterType).toBe(FilterType.True);
    expect(harness.latest()[0]!.value).toBeUndefined();
    expect(harness.latest()[0]!.evaluateOverTime).toBe(false);
    expect(harness.latest()[0]!.evaluateOverTimeOptions).toBeUndefined();
    expect(screen.queryByRole("textbox", { name: "Value" })).toBeNull();
  });

  test("changing comparator clears the old threshold while keeping scope and timing", async () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      {
        ...RESPONSE_TIME,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          evaluateOverTimeType: EvaluateOverTimeType.Average,
          timeValueInMinutes: 10,
        },
      },
    ]);
    await choose("Condition", FilterType.LessThan);
    expect(harness.latest()[0]!.filterType).toBe(FilterType.LessThan);
    expect(harness.latest()[0]!.value).toBeUndefined();
    expect(
      harness.latest()[0]!.evaluateOverTimeOptions!.timeValueInMinutes,
    ).toBe(10);
  });

  test.each([
    MonitorType.Website,
    MonitorType.ExternalStatusPage,
    MonitorType.Metrics,
    MonitorType.Host,
    MonitorType.Kubernetes,
    MonitorType.IncomingRequest,
    MonitorType.NetworkDevice,
    MonitorType.SQLQuery,
    MonitorType.DNS,
    MonitorType.SecurityEvents,
  ])(
    "adds a usable %s condition without changing existing settings",
    (monitorType: MonitorType) => {
      const first: CriteriaFilter =
        CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType);
      const before: string = JSON.stringify(first);
      const harness: ReturnType<typeof renderConditions> = renderConditions(
        [first],
        monitorType,
      );
      fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
      expect(harness.latest()).toHaveLength(2);
      expect(JSON.stringify(harness.latest()[0])).toBe(before);
      expect(harness.latest()[1]).toEqual(
        CriteriaFilterUtil.getDefaultCriteriaFilter(monitorType),
      );
      expect(
        screen.getAllByRole("button", { name: /Remove condition/ }),
      ).toHaveLength(2);
    },
  );

  test("removes only the intended condition and keeps following input values aligned", () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      RESPONSE_TIME,
      { ...RESPONSE_TIME, value: 2000 },
      { ...RESPONSE_TIME, value: 3000 },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Remove condition 2" }));
    expect(
      harness.latest().map((filter: CriteriaFilter) => {
        return filter.value;
      }),
    ).toEqual([1000, 3000]);
    const inputs: Array<HTMLElement> = screen.getAllByRole("textbox", {
      name: "Value",
    });
    expect((inputs[1] as HTMLInputElement).value).toBe("3000");
    fireEvent.change(inputs[1]!, { target: { value: "3500" } });
    expect(harness.latest()[1]!.value).toBe("3500");
    expect(harness.latest()[0]!.value).toBe(1000);
  });

  test("the last condition cannot be removed", () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      ONLINE,
    ]);
    const remove: HTMLButtonElement = screen.getByRole("button", {
      name: "Remove condition 1",
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    expect(harness.changes()).toBe(0);
    expect(harness.latest()).toHaveLength(1);
  });

  test.each([
    [FilterCondition.All, "AND"],
    [FilterCondition.Any, "OR"],
  ])(
    "shows the correct connector for %s",
    (condition: string, text: string) => {
      renderConditions(
        [ONLINE, RESPONSE_TIME],
        MonitorType.Website,
        condition as FilterCondition,
      );
      expect(screen.getByText(text)).toBeTruthy();
      expect(screen.queryByText(text === "AND" ? "OR" : "AND")).toBeNull();
    },
  );

  test("time-window options start hidden and enabling them seeds working values", () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      RESPONSE_TIME,
    ]);
    expect(
      screen.queryByRole("checkbox", { name: "Check over a time window" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Evaluation window" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Check over a time window" }),
    );
    expect(harness.latest()[0]!.evaluateOverTime).toBe(true);
    expect(harness.latest()[0]!.evaluateOverTimeOptions).toEqual({
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      timeValueInMinutes: 5,
      onNoDataPolicy: NoDataPolicy.Ignore,
    });
    expect(screen.getByText("5 Minutes")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Evaluation aggregation" }),
    ).toBeTruthy();
  });

  test("saved time-window controls are visible and keep number durations selected", () => {
    renderConditions([
      {
        ...RESPONSE_TIME,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          evaluateOverTimeType: EvaluateOverTimeType.Average,
          timeValueInMinutes: 10,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
      },
    ]);
    expect(
      screen
        .getByRole("button", { name: "Evaluation window" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("10 Minutes")).toBeTruthy();
    expect(screen.getByText(NoDataPolicy.Trigger)).toBeTruthy();
  });

  test("changing duration persists a number and preserves aggregation and no-data policy", async () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      {
        ...RESPONSE_TIME,
        evaluateOverTime: true,
        evaluateOverTimeOptions: {
          evaluateOverTimeType: EvaluateOverTimeType.Average,
          timeValueInMinutes: 5,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
      },
    ]);
    await choose("Evaluation window", "10 Minutes");
    expect(harness.latest()[0]!.evaluateOverTimeOptions).toEqual({
      evaluateOverTimeType: EvaluateOverTimeType.Average,
      timeValueInMinutes: 10,
      onNoDataPolicy: NoDataPolicy.Trigger,
    });
  });

  test("turning a time window off and back on preserves its settings", () => {
    const settings: CriteriaFilter["evaluateOverTimeOptions"] = {
      evaluateOverTimeType: EvaluateOverTimeType.MaximumValue,
      timeValueInMinutes: 15,
      onNoDataPolicy: NoDataPolicy.TreatAsZero,
    };
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      {
        ...RESPONSE_TIME,
        evaluateOverTime: true,
        evaluateOverTimeOptions: settings,
      },
    ]);
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Check over a time window" }),
    );
    expect(harness.latest()[0]!.evaluateOverTime).toBe(false);
    expect(
      screen.queryByRole("combobox", { name: "Evaluation aggregation" }),
    ).toBeNull();
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Check over a time window" }),
    );
    expect(harness.latest()[0]!.evaluateOverTimeOptions).toEqual(settings);
  });

  test("anomaly detection keeps sensitivity and baseline controls and hides static threshold", async () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions(
      [
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.AnomalouslyHigh,
          metricMonitorOptions: {
            metricAlias: "A",
            metricAggregationType: EvaluateOverTimeType.Average,
            anomalyDetection: {
              sensitivity: AnomalyDetectionSensitivity.Medium,
              windowDays: 28,
            },
          },
        },
      ],
      MonitorType.Metrics,
    );
    expect(screen.queryByRole("textbox", { name: "Threshold" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sensitivity" })).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Baseline window" }),
    ).toBeTruthy();
    await choose("Baseline window", "60 days (monthly seasonality)");
    expect(
      harness.latest()[0]!.metricMonitorOptions!.anomalyDetection!.windowDays,
    ).toBe(60);
    expect(
      harness.latest()[0]!.metricMonitorOptions!.anomalyDetection!.sensitivity,
    ).toBe(AnomalyDetectionSensitivity.Medium);
  });

  test("SNMP OID selection retains the live device catalogue and saved threshold", async () => {
    let latest: CriteriaFilter = {
      checkOn: CheckOn.SnmpOidValue,
      filterType: FilterType.GreaterThan,
      value: 80,
      snmpMonitorOptions: { oid: "1.3.6.1.2.1.1" },
    };
    function Harness(): ReactElement {
      const [value, setValue] = React.useState<CriteriaFilter>(latest);
      return (
        <NetworkDeviceCriteriaCatalogueContext.Provider
          value={{
            oids: [
              { oid: "1.3.6.1.2.1.1", name: "CPU" },
              { oid: "1.3.6.1.2.1.2", name: "Memory" },
            ],
            interfaceNames: [],
            isLoaded: true,
          }}
        >
          <CriteriaFilterElement
            monitorType={MonitorType.NetworkDevice}
            monitorStep={new MonitorStep()}
            value={value}
            onChange={(next: CriteriaFilter) => {
              latest = next;
              setValue(next);
            }}
          />
        </NetworkDeviceCriteriaCatalogueContext.Provider>
      );
    }
    render(<Harness />);
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "OID" }));
    await user.click(await screen.findByRole("option", { name: /Memory/ }));
    expect(latest.snmpMonitorOptions!.oid).toBe("1.3.6.1.2.1.2");
    expect(latest.value).toBe(80);
    expect(latest.filterType).toBe(FilterType.GreaterThan);
  });
  test("metric thresholds keep their unit and a metric change clears an incompatible unit", async () => {
    const step: MonitorStep = new MonitorStep();
    step.data!.metricMonitor = MonitorStepMetricMonitorUtil.getDefault();
    step.data!.metricMonitor.metricViewConfig.queryConfigs = [
      {
        metricQueryData: { filterData: {} },
        metricAliasData: {
          metricVariable: "Latency",
          title: undefined,
          description: undefined,
          legend: undefined,
          legendUnit: "ms",
        },
      },
      {
        metricQueryData: { filterData: {} },
        metricAliasData: {
          metricVariable: "Memory",
          title: undefined,
          description: undefined,
          legend: undefined,
          legendUnit: "By",
        },
      },
    ];
    const harness: ReturnType<typeof renderConditions> = renderConditions(
      [
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 500,
          metricMonitorOptions: {
            metricAlias: "Latency",
            metricAggregationType: EvaluateOverTimeType.Average,
            thresholdUnit: "ms",
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        },
      ],
      MonitorType.Metrics,
      FilterCondition.All,
      step,
    );
    expect(
      screen.getByRole("combobox", { name: "Threshold unit" }),
    ).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Threshold" }), {
      target: { value: "750" },
    });
    expect(harness.latest()[0]!.metricMonitorOptions!.thresholdUnit).toBe("ms");
    await choose("Metric", "Memory");
    expect(harness.latest()[0]!.metricMonitorOptions!.metricAlias).toBe(
      "Memory",
    );
    expect(
      harness.latest()[0]!.metricMonitorOptions!.thresholdUnit,
    ).toBeUndefined();
    expect(harness.latest()[0]!.metricMonitorOptions!.onNoDataPolicy).toBe(
      NoDataPolicy.Trigger,
    );
    expect(harness.latest()[0]!.value).toBe("750");
  });

  test("a saved metric no-data policy stays visible and editable", async () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions(
      [
        {
          checkOn: CheckOn.MetricValue,
          filterType: FilterType.GreaterThan,
          value: 1,
          metricMonitorOptions: {
            metricAlias: "A",
            metricAggregationType: EvaluateOverTimeType.Average,
            onNoDataPolicy: NoDataPolicy.Trigger,
          },
        },
      ],
      MonitorType.Metrics,
    );
    expect(
      screen
        .getByRole("button", { name: "Data gaps" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    await choose("If no data", NoDataPolicy.TreatAsZero);
    expect(harness.latest()[0]!.metricMonitorOptions!.onNoDataPolicy).toBe(
      NoDataPolicy.TreatAsZero,
    );
    expect(
      harness.latest()[0]!.metricMonitorOptions!.metricAggregationType,
    ).toBe(EvaluateOverTimeType.Average);
  });
  test("enabling a partially configured saved window fills only missing defaults", () => {
    const harness: ReturnType<typeof renderConditions> = renderConditions([
      {
        ...RESPONSE_TIME,
        evaluateOverTime: false,
        evaluateOverTimeOptions: {
          evaluateOverTimeType: undefined,
          timeValueInMinutes: 15,
          onNoDataPolicy: NoDataPolicy.Trigger,
        },
      },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Evaluation window" }));
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Check over a time window" }),
    );
    expect(harness.latest()[0]!.evaluateOverTimeOptions).toEqual({
      evaluateOverTimeType: EvaluateOverTimeType.AllValues,
      timeValueInMinutes: 15,
      onNoDataPolicy: NoDataPolicy.Trigger,
    });
  });
});
