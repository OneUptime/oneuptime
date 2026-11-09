import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogRecordingRule from "../../../Models/DatabaseModels/LogRecordingRule";
import MetricRecordingRule from "../../../Models/DatabaseModels/MetricRecordingRule";
import TraceRecordingRule from "../../../Models/DatabaseModels/TraceRecordingRule";
import LogRecordingRuleService from "../../../Server/Services/LogRecordingRuleService";
import MetricRecordingRuleService, {
  Service as MetricRecordingRuleServiceClass,
} from "../../../Server/Services/MetricRecordingRuleService";
import TraceRecordingRuleService from "../../../Server/Services/TraceRecordingRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import { LogRecordingRuleDefinitionUtil } from "../../../Types/Log/LogRecordingRuleDefinition";
import ObjectID from "../../../Types/ObjectID";
import TelemetryIngestionBudgetMetricType from "../../../Types/Telemetry/TelemetryIngestionBudgetMetricType";
import { TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX } from "../../../Utils/Telemetry/TelemetryIngestionBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * A recording rule writes its output straight into the metric store, past
 * OTLP ingest, so the telemetry ingestion budget names (issue #5917) are
 * refused as its output too, as the session replay budget names are
 * (RecordingRuleReservedMetricName.test.ts): those series open budget
 * incidents and are left out of usage and billing by name, so nothing but
 * the budget sweep may write them. All three services refuse a reserved
 * output name when a rule is created, and when an update sets it.
 */

type AnyRule = MetricRecordingRule | TraceRecordingRule | LogRecordingRule;

interface Hooks<TModel extends DatabaseBaseModel> {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
}

const RESERVED_NAMES: Array<string> = [
  ...Object.values(TelemetryIngestionBudgetMetricType),
  "oneuptime.telemetry.budget.anything.new",
  "OneUptime.Telemetry.Budget.Used.Percent",
  "  oneuptime.telemetry.budget.used.bytes  ",
];

const ALLOWED_NAMES: Array<string> = [
  "oneuptime.telemetry.budgets",
  "oneuptime.telemetry.usage.bytes.mine",
  "telemetry.budget.used.bytes",
  "checkout.latency.p99",
];

interface ServiceCase {
  name: string;
  hooks: Hooks<AnyRule>;
  newRule: () => AnyRule;
}

const SERVICES: Array<ServiceCase> = [
  {
    name: "MetricRecordingRuleService",
    hooks: MetricRecordingRuleService as unknown as Hooks<AnyRule>,
    newRule: (): MetricRecordingRule => {
      return new MetricRecordingRule();
    },
  },
  {
    name: "LogRecordingRuleService",
    hooks: LogRecordingRuleService as unknown as Hooks<AnyRule>,
    // A log recording rule is created with a definition or not at all.
    newRule: (): LogRecordingRule => {
      const rule: LogRecordingRule = new LogRecordingRule();
      rule.definition = LogRecordingRuleDefinitionUtil.getEmptyDefinition();
      return rule;
    },
  },
  {
    name: "TraceRecordingRuleService",
    hooks: TraceRecordingRuleService as unknown as Hooks<AnyRule>,
    newRule: (): TraceRecordingRule => {
      return new TraceRecordingRule();
    },
  },
];

function createBy(rule: AnyRule): CreateBy<AnyRule> {
  return {
    data: rule,
    props: { isRoot: true },
  } as unknown as CreateBy<AnyRule>;
}

function updateBy(data: Record<string, unknown>): UpdateBy<AnyRule> {
  return {
    query: { _id: ObjectID.generate().toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<AnyRule>;
}

describe("MetricRecordingRuleService.assertOutputMetricNameAllowed refuses the ingestion budget names", () => {
  test.each(RESERVED_NAMES)("refuses %p", (name: string) => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
    }).toThrow(BadDataException);
  });

  test("says which prefix is reserved and what to do", () => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(
        TelemetryIngestionBudgetMetricType.UsedPercent,
      );
    }).toThrow(
      `Metric names that start with "${TELEMETRY_INGESTION_BUDGET_METRIC_NAME_PREFIX}" are reserved for OneUptime's telemetry ingestion budget metrics. Choose another output metric name.`,
    );
  });

  test.each(ALLOWED_NAMES)("allows %p", (name: string) => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
    }).not.toThrow();
  });
});

describe.each(SERVICES)("$name", ({ hooks, newRule }: ServiceCase) => {
  test("refuses to create a rule whose output is an ingestion budget name", async () => {
    const rule: AnyRule = newRule();
    rule.outputMetricName = TelemetryIngestionBudgetMetricType.DroppedBytes;

    await expect(hooks.onBeforeCreate(createBy(rule))).rejects.toThrow(
      "telemetry ingestion budget metrics",
    );
  });

  test("refuses an update that renames the output into the budget namespace", async () => {
    await expect(
      hooks.onBeforeUpdate(
        updateBy({
          outputMetricName: "oneuptime.telemetry.budget.mine",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("creates a rule with a name that merely looks alike, untouched", async () => {
    const rule: AnyRule = newRule();
    rule.outputMetricName = "oneuptime.telemetry.budgets";

    const result: OnCreate<AnyRule> = await hooks.onBeforeCreate(
      createBy(rule),
    );

    expect(result.createBy.data.outputMetricName).toBe(
      "oneuptime.telemetry.budgets",
    );
  });
});
