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
import TelemetryUsageMetricType from "../../../Types/Telemetry/TelemetryUsageMetricType";
import TelemetryUsageMetricTypeUtil, {
  TELEMETRY_USAGE_METRIC_NAME_PREFIX,
} from "../../../Utils/Telemetry/TelemetryUsageMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * A recording rule writes its output straight into the metric store, past
 * OTLP ingest, so the telemetry usage names (issue #6355) are refused as
 * its output, as the ingestion budget names are
 * (RecordingRuleReservedIngestionBudgetMetricName.test.ts): those series
 * are left out of usage and billing by name, and read as each resource's
 * own usage, so nothing but the usage sweep may write them.
 */

type AnyRule = MetricRecordingRule | TraceRecordingRule | LogRecordingRule;

interface Hooks<TModel extends DatabaseBaseModel> {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
}

const RESERVED_NAMES: Array<string> = [
  ...TelemetryUsageMetricTypeUtil.getAll(),
  "oneuptime.telemetry.usage.anything.new",
  "OneUptime.Telemetry.Usage.Bytes",
  "  oneuptime.telemetry.usage.bytes  ",
];

const ALLOWED_NAMES: Array<string> = [
  "oneuptime.telemetry.usages",
  "telemetry.usage.bytes",
  "checkout.usage.bytes",
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

describe("MetricRecordingRuleService.assertOutputMetricNameAllowed refuses the telemetry usage names", () => {
  test.each(RESERVED_NAMES)("refuses %p", (name: string) => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
    }).toThrow(BadDataException);
  });

  test("says which prefix is reserved and what to do", () => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(
        TelemetryUsageMetricType.UsageBytes,
      );
    }).toThrow(
      `Metric names that start with "${TELEMETRY_USAGE_METRIC_NAME_PREFIX}" are reserved for OneUptime's telemetry usage metrics. Choose another output metric name.`,
    );
  });

  test.each(ALLOWED_NAMES)("allows %p", (name: string) => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
    }).not.toThrow();
  });
});

describe.each(SERVICES)("$name", ({ hooks, newRule }: ServiceCase) => {
  test("refuses to create a rule whose output is a telemetry usage name", async () => {
    const rule: AnyRule = newRule();
    rule.outputMetricName = TelemetryUsageMetricType.UsageBytes;

    await expect(hooks.onBeforeCreate(createBy(rule))).rejects.toThrow(
      "telemetry usage metrics",
    );
  });

  test("refuses an update that renames the output into the usage namespace", async () => {
    await expect(
      hooks.onBeforeUpdate(
        updateBy({
          outputMetricName: "oneuptime.telemetry.usage.mine",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("TelemetryUsageMetricTypeUtil", () => {
  test("every name the sweep writes is in the namespace, with a unit, a title and a description", () => {
    for (const name of TelemetryUsageMetricTypeUtil.getAll()) {
      expect(name.startsWith(TELEMETRY_USAGE_METRIC_NAME_PREFIX)).toBe(true);
      expect(TelemetryUsageMetricTypeUtil.getUnit(name)).toBe("By");
      expect(TelemetryUsageMetricTypeUtil.getTitle(name)).toBeTruthy();
      expect(TelemetryUsageMetricTypeUtil.getDescription(name)).toContain(
        "Not counted as usage, nor billed.",
      );
    }
  });

  test("a name that is not text is not reserved", () => {
    expect(TelemetryUsageMetricTypeUtil.isReservedMetricName(undefined)).toBe(
      false,
    );
    expect(TelemetryUsageMetricTypeUtil.isReservedMetricName(null)).toBe(false);
  });
});
