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
import SessionReplayBudgetMetricType from "../../../Types/Rum/SessionReplayBudgetMetricType";
import { describe, expect, test } from "@jest/globals";

/*
 * Recording rules write their output straight into the metric store, past
 * OTLP ingest - which is where every other customer-chosen metric name is
 * checked against the reserved session replay namespace. The budget series
 * under it open incidents and are left out of telemetry billing by name, so
 * a rule must not be able to write one either: all three services refuse a
 * reserved output name when a rule is created, and when an update sets it.
 */

type AnyRule = MetricRecordingRule | TraceRecordingRule | LogRecordingRule;

interface Hooks<TModel extends DatabaseBaseModel> {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
}

const RESERVED_NAMES: Array<string> = [
  ...Object.values(SessionReplayBudgetMetricType),
  "oneuptime.rum.session.replay.anything.new",
  "OneUptime.RUM.Session.Replay.Budget.Project.Daily.Used.Percent",
  "  oneuptime.rum.session.replay.budget.project.daily.used.bytes  ",
];

const ALLOWED_NAMES: Array<string> = [
  "web_vital.lcp",
  "checkout.latency.p99",
  "oneuptime.llm.budget.percent.used",
  "oneuptime.rum.application.id",
  "oneuptime.rum.session.replayed",
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

describe("MetricRecordingRuleService.assertOutputMetricNameAllowed", () => {
  test.each(RESERVED_NAMES)("refuses %p", (name: string) => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
    }).toThrow(BadDataException);
  });

  test("says which prefix is reserved and what to do", () => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(
        SessionReplayBudgetMetricType.ProjectDailyUsedPercent,
      );
    }).toThrow(
      'Metric names that start with "oneuptime.rum.session.replay." are reserved for OneUptime\'s session replay budget metrics. Choose another output metric name.',
    );
  });

  test.each(ALLOWED_NAMES)("allows %p", (name: string) => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
    }).not.toThrow();
  });

  test.each([undefined, null, "", 42])(
    "leaves a missing or non-string name %p to the model's own validation",
    (name: unknown) => {
      expect(() => {
        MetricRecordingRuleServiceClass.assertOutputMetricNameAllowed(name);
      }).not.toThrow();
    },
  );
});

describe.each(SERVICES)("$name", ({ hooks, newRule }: ServiceCase) => {
  test("refuses to create a rule whose output name is reserved", async () => {
    const rule: AnyRule = newRule();
    rule.outputMetricName =
      SessionReplayBudgetMetricType.ApplicationMonthlyUsedPercent;

    await expect(hooks.onBeforeCreate(createBy(rule))).rejects.toThrow(
      BadDataException,
    );
  });

  test("creates a rule with any other output name, untouched", async () => {
    const rule: AnyRule = newRule();
    rule.outputMetricName = "checkout.latency.p99";

    const result: OnCreate<AnyRule> = await hooks.onBeforeCreate(
      createBy(rule),
    );

    expect(result.createBy.data.outputMetricName).toBe("checkout.latency.p99");
    expect(result.carryForward).toBeNull();
  });

  test("refuses an update that renames the output into the reserved namespace", async () => {
    await expect(
      hooks.onBeforeUpdate(
        updateBy({
          outputMetricName: "oneuptime.rum.session.replay.budget.mine",
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("lets through an update that does not touch the output name", async () => {
    const result: OnUpdate<AnyRule> = await hooks.onBeforeUpdate(
      updateBy({ isEnabled: false }),
    );

    expect(result.carryForward).toBeNull();
    expect(
      (result.updateBy.data as unknown as Record<string, unknown>)["isEnabled"],
    ).toBe(false);
  });

  test("lets through an update to an allowed output name", async () => {
    await expect(
      hooks.onBeforeUpdate(updateBy({ outputMetricName: "web_vital.lcp.p75" })),
    ).resolves.toBeDefined();
  });
});
