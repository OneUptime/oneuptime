import LogRecordingRule from "../../../Models/DatabaseModels/LogRecordingRule";
import LogRecordingRuleService, {
  Service as LogRecordingRuleServiceClass,
} from "../../../Server/Services/LogRecordingRuleService";
import MetricRecordingRuleService from "../../../Server/Services/MetricRecordingRuleService";
import TraceRecordingRuleService from "../../../Server/Services/TraceRecordingRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import BadDataException from "../../../Types/Exception/BadDataException";
import LogRecordingRuleDefinition from "../../../Types/Log/LogRecordingRuleDefinition";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The server holds a log recording rule's definition to what the editor
 * holds it to: the API, MCP and Terraform reach it without the editor, and
 * the worker evaluates whatever is stored. A create or an update that sets
 * a definition the editor would refuse is refused in the editor's words; an
 * accepted one is stored normalized, so the worker runs exactly what the
 * rules list shows.
 */

interface Hooks {
  onBeforeCreate: (
    createBy: CreateBy<LogRecordingRule>,
  ) => Promise<OnCreate<LogRecordingRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<LogRecordingRule>,
  ) => Promise<OnUpdate<LogRecordingRule>>;
}

const hooks: Hooks = LogRecordingRuleService as unknown as Hooks;

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const latencyRule: () => LogRecordingRuleDefinition =
  (): LogRecordingRuleDefinition => {
    return {
      filter: {
        severityTexts: [LogSeverity.Information, LogSeverity.Information],
        body: '  log_type="SD-WAN"  ',
        attributeFilters: [
          { key: " log_component ", value: " SLA " },
          { key: "", value: "" },
        ],
      },
      aggregationType: AggregationType.Avg,
      valueAttribute: " latency ",
      groupByAttributes: ["gw_name", "profile_name"],
      unit: " ms ",
    };
  };

const normalizedLatencyRule: LogRecordingRuleDefinition = {
  filter: {
    telemetryServiceIds: [],
    severityTexts: [LogSeverity.Information],
    body: 'log_type="SD-WAN"',
    attributeFilters: [{ key: "log_component", value: "SLA" }],
  },
  aggregationType: AggregationType.Avg,
  valueAttribute: "latency",
  groupByAttributes: ["gw_name", "profile_name"],
  unit: "ms",
};

const createBy: (data: {
  name?: string;
  outputMetricName?: string;
  definition?: unknown;
}) => CreateBy<LogRecordingRule> = (data: {
  name?: string;
  outputMetricName?: string;
  definition?: unknown;
}): CreateBy<LogRecordingRule> => {
  const rule: LogRecordingRule = new LogRecordingRule();
  rule.projectId = PROJECT_ID;

  if (data.name !== undefined) {
    rule.name = data.name;
  }

  if (data.outputMetricName !== undefined) {
    rule.outputMetricName = data.outputMetricName;
  }

  if (data.definition !== undefined) {
    rule.definition = data.definition as LogRecordingRuleDefinition;
  }

  return {
    data: rule,
    props: { isRoot: true },
  } as CreateBy<LogRecordingRule>;
};

const updateBy: (
  data: Record<string, unknown>,
) => UpdateBy<LogRecordingRule> = (
  data: Record<string, unknown>,
): UpdateBy<LogRecordingRule> => {
  return {
    query: { _id: ObjectID.generate().toString() },
    data: data,
    props: { isRoot: true },
  } as unknown as UpdateBy<LogRecordingRule>;
};

let findBySpies: Array<SpyInstance> = [];

beforeEach(() => {
  findBySpies = [
    MetricRecordingRuleService,
    TraceRecordingRuleService,
    LogRecordingRuleService,
  ].map((service: unknown): SpyInstance => {
    return jest
      .spyOn(service as { findBy: () => Promise<unknown> }, "findBy")
      .mockResolvedValue([] as never) as unknown as SpyInstance;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("LogRecordingRuleService - a create", () => {
  test("stores the definition normalized and makes the output metric name from the rule's name", async () => {
    const create: CreateBy<LogRecordingRule> = createBy({
      name: "SD-WAN gateway latency",
      definition: latencyRule(),
    });

    const result: OnCreate<LogRecordingRule> =
      await hooks.onBeforeCreate(create);

    expect(result.carryForward).toBeNull();
    expect(create.data.definition).toEqual(normalizedLatencyRule);
    expect(create.data.outputMetricName).toBe("sd_wan_gateway_latency");
  });

  test("keeps an output metric name that was sent", async () => {
    const create: CreateBy<LogRecordingRule> = createBy({
      name: "SD-WAN gateway latency",
      outputMetricName: "sdwan.gateway.latency.ms",
      definition: latencyRule(),
    });

    await hooks.onBeforeCreate(create);

    expect(create.data.outputMetricName).toBe("sdwan.gateway.latency.ms");
  });

  test("reads a definition sent as a JSON string, and stores it as an object", async () => {
    const create: CreateBy<LogRecordingRule> = createBy({
      name: "SD-WAN gateway latency",
      definition: JSON.stringify(latencyRule()),
    });

    await hooks.onBeforeCreate(create);

    expect(create.data.definition).toEqual(normalizedLatencyRule);
  });

  test.each([
    ["no definition", undefined, "Definition is required."],
    [
      "a value aggregation without its attribute",
      { filter: {}, aggregationType: AggregationType.P95 },
      "Choose the numeric attribute to aggregate (e.g. latency).",
    ],
    [
      "an unknown aggregation",
      { filter: {}, aggregationType: "Median" },
      'Unknown aggregation "Median". Choose one of: Count, Avg, Sum, Min, Max, P50, P75, P90, P95, P99.',
    ],
    [
      "an attribute key that is not one",
      {
        filter: {},
        aggregationType: AggregationType.Sum,
        valueAttribute: "bytes) FROM x --",
      },
      "The numeric attribute may only contain letters, digits and . _ : / - characters.",
    ],
    [
      "too many group-by attributes",
      {
        filter: {},
        aggregationType: AggregationType.Count,
        groupByAttributes: ["a", "b", "c", "d", "e", "f"],
      },
      "A rule can group by at most 5 attributes.",
    ],
    [
      "a half-typed attribute filter",
      {
        filter: { attributeFilters: [{ key: "env", value: "" }] },
        aggregationType: AggregationType.Count,
      },
      "Each attribute filter needs both a key and a value (or remove the row).",
    ],
  ])(
    "refuses %s, in the editor's words, before reading anything",
    async (_label: string, definition: unknown, message: string) => {
      await expect(
        hooks.onBeforeCreate(
          createBy({ name: "Broken rule", definition: definition }),
        ),
      ).rejects.toThrow(new BadDataException(message));

      for (const spy of findBySpies) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  test("still refuses a reserved session replay output name", async () => {
    await expect(
      hooks.onBeforeCreate(
        createBy({
          name: "Replay",
          outputMetricName: "oneuptime.rum.session.replay.budget.mine",
          definition: latencyRule(),
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("LogRecordingRuleService - an update", () => {
  test("that sets a valid definition stores it normalized", async () => {
    const update: UpdateBy<LogRecordingRule> = updateBy({
      definition: latencyRule(),
    });

    const result: OnUpdate<LogRecordingRule> =
      await hooks.onBeforeUpdate(update);

    expect(result.carryForward).toBeNull();
    expect(
      (update.data as unknown as Record<string, unknown>)["definition"],
    ).toEqual(normalizedLatencyRule);
  });

  test("that sets an invalid definition is refused", async () => {
    await expect(
      hooks.onBeforeUpdate(
        updateBy({
          definition: {
            filter: { severityTexts: ["WARN"] },
            aggregationType: AggregationType.Count,
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("that clears the definition is refused", async () => {
    await expect(
      hooks.onBeforeUpdate(updateBy({ definition: null })),
    ).rejects.toThrow("Definition is required.");
  });

  test("that leaves the definition alone goes through untouched", async () => {
    const update: UpdateBy<LogRecordingRule> = updateBy({
      isEnabled: false,
      definition: undefined,
    });

    await expect(hooks.onBeforeUpdate(update)).resolves.toBeDefined();
    expect(update.data).toEqual({ isEnabled: false, definition: undefined });
  });

  test("that empties the output metric name is refused, as for every recording rule", async () => {
    await expect(
      hooks.onBeforeUpdate(updateBy({ outputMetricName: " " })),
    ).rejects.toThrow(
      "A recording rule needs an output metric name. Enter the name of the metric it writes.",
    );
  });
});

describe("LogRecordingRuleService.getDefinitionToStore", () => {
  test("hands back the normalized definition, or throws the reason it cannot", () => {
    expect(
      LogRecordingRuleServiceClass.getDefinitionToStore(latencyRule()),
    ).toEqual(normalizedLatencyRule);

    expect(() => {
      LogRecordingRuleServiceClass.getDefinitionToStore("{broken");
    }).toThrow("Definition is not valid JSON.");
  });
});
