import MetricRecordingRule from "../../../Models/DatabaseModels/MetricRecordingRule";
import TraceRecordingRule from "../../../Models/DatabaseModels/TraceRecordingRule";
import MetricRecordingRuleService, {
  Service as MetricRecordingRuleServiceClass,
} from "../../../Server/Services/MetricRecordingRuleService";
import TraceRecordingRuleService from "../../../Server/Services/TraceRecordingRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
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
 * A recording rule's Output Metric Name - the metric it writes - is made
 * from the rule's name when a create leaves it out, as the dashboard does
 * unless someone typed one ("HTTP 5xx error rate" writes
 * http_5xx_error_rate). Metric and trace recording rules write into the
 * same metric store, so a made name is numbered past every output name of
 * the project's rules of both kinds: two rules writing one series would mix
 * their data. A name that is sent is kept as sent, and an update may rename
 * the output but never empty it.
 */

type AnyRule = MetricRecordingRule | TraceRecordingRule;

interface Hooks {
  onBeforeCreate: (createBy: CreateBy<AnyRule>) => Promise<OnCreate<AnyRule>>;
  onBeforeUpdate: (updateBy: UpdateBy<AnyRule>) => Promise<OnUpdate<AnyRule>>;
}

interface RuleKind {
  label: string;
  hooks: Hooks;
  newRule: () => AnyRule;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const TENANT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const KINDS: Array<RuleKind> = [
  {
    label: "metric recording rules",
    hooks: MetricRecordingRuleService as unknown as Hooks,
    newRule: (): AnyRule => {
      return new MetricRecordingRule();
    },
  },
  {
    label: "trace recording rules",
    hooks: TraceRecordingRuleService as unknown as Hooks,
    newRule: (): AnyRule => {
      return new TraceRecordingRule();
    },
  },
];

let metricFindBy: SpyInstance;
let traceFindBy: SpyInstance;

// The output names the project's rules of each kind write.
function answerNames(names: {
  metric?: Array<string | undefined>;
  trace?: Array<string | undefined>;
}): void {
  const rows: (
    list: Array<string | undefined> | undefined,
    make: () => AnyRule,
  ) => Array<AnyRule> = (
    list: Array<string | undefined> | undefined,
    make: () => AnyRule,
  ): Array<AnyRule> => {
    return (list || []).map((name: string | undefined) => {
      const rule: AnyRule = make();

      if (name !== undefined) {
        rule.outputMetricName = name;
      }

      return rule;
    });
  };

  metricFindBy.mockResolvedValue(
    rows(names.metric, () => {
      return new MetricRecordingRule();
    }) as never,
  );
  traceFindBy.mockResolvedValue(
    rows(names.trace, () => {
      return new TraceRecordingRule();
    }) as never,
  );
}

beforeEach(() => {
  metricFindBy = jest
    .spyOn(MetricRecordingRuleService, "findBy")
    .mockResolvedValue([] as never) as unknown as SpyInstance;
  traceFindBy = jest
    .spyOn(TraceRecordingRuleService, "findBy")
    .mockResolvedValue([] as never) as unknown as SpyInstance;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("$label", (kind: RuleKind) => {
  const createBy: (input: {
    name?: string | undefined;
    outputMetricName?: string | null | undefined;
    projectId?: ObjectID | undefined;
    tenantId?: ObjectID | undefined;
  }) => CreateBy<AnyRule> = (input: {
    name?: string | undefined;
    outputMetricName?: string | null | undefined;
    projectId?: ObjectID | undefined;
    tenantId?: ObjectID | undefined;
  }): CreateBy<AnyRule> => {
    const rule: AnyRule = kind.newRule();

    if (input.name !== undefined) {
      rule.name = input.name;
    }

    if (input.outputMetricName !== undefined) {
      rule.outputMetricName = input.outputMetricName as string;
    }

    if (input.projectId) {
      rule.projectId = input.projectId;
    }

    return {
      data: rule,
      props: input.tenantId
        ? { tenantId: input.tenantId, userId: ObjectID.generate() }
        : { isRoot: true },
    } as CreateBy<AnyRule>;
  };

  const updateBy: (data: Record<string, unknown>) => UpdateBy<AnyRule> = (
    data: Record<string, unknown>,
  ): UpdateBy<AnyRule> => {
    return {
      query: { _id: ObjectID.generate().toString() },
      data: data,
      props: { isRoot: true },
    } as unknown as UpdateBy<AnyRule>;
  };

  describe("a create that leaves the output metric name out", () => {
    test("writes the metric the rule's name makes", async () => {
      const create: CreateBy<AnyRule> = createBy({
        name: "HTTP 5xx error rate",
        projectId: PROJECT_ID,
      });

      await kind.hooks.onBeforeCreate(create);

      expect(create.data.outputMetricName).toBe("http_5xx_error_rate");
    });

    test.each([
      ["an empty name", ""],
      ["a blank name", "  "],
      ["a null name", null],
    ])("treats %s as left out", async (_label: string, name: string | null) => {
      const create: CreateBy<AnyRule> = createBy({
        name: "HTTP 5xx error rate",
        outputMetricName: name,
        projectId: PROJECT_ID,
      });

      await kind.hooks.onBeforeCreate(create);

      expect(create.data.outputMetricName).toBe("http_5xx_error_rate");
    });

    test("numbers the name past a metric recording rule that writes it", async () => {
      answerNames({ metric: ["http_5xx_error_rate"] });

      const create: CreateBy<AnyRule> = createBy({
        name: "HTTP 5xx error rate",
        projectId: PROJECT_ID,
      });

      await kind.hooks.onBeforeCreate(create);

      expect(create.data.outputMetricName).toBe("http_5xx_error_rate_2");
    });

    test("numbers the name past a trace recording rule that writes it", async () => {
      answerNames({
        metric: ["http_5xx_error_rate"],
        trace: ["http_5xx_error_rate_2", undefined],
      });

      const create: CreateBy<AnyRule> = createBy({
        name: "HTTP 5xx error rate",
        projectId: PROJECT_ID,
      });

      await kind.hooks.onBeforeCreate(create);

      expect(create.data.outputMetricName).toBe("http_5xx_error_rate_3");
    });

    test("reads both kinds of rule of the project, as root, names only", async () => {
      await kind.hooks.onBeforeCreate(
        createBy({ name: "HTTP 5xx error rate", projectId: PROJECT_ID }),
      );

      for (const spy of [metricFindBy, traceFindBy]) {
        expect(spy).toHaveBeenCalledTimes(1);

        const query: Record<string, unknown> = spy.mock.calls[0]![0] as Record<
          string,
          unknown
        >;

        expect(query["query"]).toEqual({ projectId: PROJECT_ID });
        expect(query["select"]).toEqual({ outputMetricName: true });
        expect(query["props"]).toEqual({ isRoot: true });
      }
    });

    test("reads the request's project when the create does not name one", async () => {
      await kind.hooks.onBeforeCreate(
        createBy({ name: "HTTP 5xx error rate", tenantId: TENANT_ID }),
      );

      const query: Record<string, unknown> = metricFindBy.mock
        .calls[0]![0] as Record<string, unknown>;

      expect(query["query"]).toEqual({ projectId: TENANT_ID });
    });

    test("with no project, reads nothing and still makes the name", async () => {
      const create: CreateBy<AnyRule> = createBy({
        name: "HTTP 5xx error rate",
      });

      await kind.hooks.onBeforeCreate(create);

      expect(metricFindBy).not.toHaveBeenCalled();
      expect(traceFindBy).not.toHaveBeenCalled();
      expect(create.data.outputMetricName).toBe("http_5xx_error_rate");
    });

    test("a rule name with nothing usable in it writes recording_rule", async () => {
      const create: CreateBy<AnyRule> = createBy({
        name: "!!!",
        projectId: PROJECT_ID,
      });

      await kind.hooks.onBeforeCreate(create);

      expect(create.data.outputMetricName).toBe("recording_rule");
    });
  });

  describe("a create that sends an output metric name", () => {
    test("keeps it exactly as sent, without reading anything", async () => {
      answerNames({ metric: ["http.server.error_rate"] });

      const create: CreateBy<AnyRule> = createBy({
        name: "HTTP 5xx error rate",
        outputMetricName: "http.server.error_rate",
        projectId: PROJECT_ID,
      });

      await kind.hooks.onBeforeCreate(create);

      expect(create.data.outputMetricName).toBe("http.server.error_rate");
      expect(metricFindBy).not.toHaveBeenCalled();
    });

    test("still refuses a reserved session replay name", async () => {
      await expect(
        kind.hooks.onBeforeCreate(
          createBy({
            name: "Replay budget",
            outputMetricName: "oneuptime.rum.session.replay.mine",
            projectId: PROJECT_ID,
          }),
        ),
      ).rejects.toThrow(BadDataException);
    });
  });

  describe("an update", () => {
    test.each([
      ["empties", ""],
      ["blanks", "   "],
      ["nulls", null],
    ])(
      "that %s the output metric name is refused",
      async (_label: string, name: string | null) => {
        await expect(
          kind.hooks.onBeforeUpdate(updateBy({ outputMetricName: name })),
        ).rejects.toThrow(
          "A recording rule needs an output metric name. Enter the name of the metric it writes.",
        );
      },
    );

    test("that renames the output metric goes through", async () => {
      await expect(
        kind.hooks.onBeforeUpdate(
          updateBy({ outputMetricName: "http.server.error_rate" }),
        ),
      ).resolves.toBeDefined();
    });

    test("that leaves the output metric name alone goes through", async () => {
      await expect(
        kind.hooks.onBeforeUpdate(
          updateBy({ name: "Renamed", outputMetricName: undefined }),
        ),
      ).resolves.toBeDefined();

      await expect(
        kind.hooks.onBeforeUpdate(updateBy({ isEnabled: false })),
      ).resolves.toBeDefined();
    });
  });
});

describe("MetricRecordingRuleService.assertOutputMetricNameNotCleared", () => {
  test("lets through data that does not set the name, or is not data at all", () => {
    for (const data of [
      undefined,
      null,
      "text",
      {},
      { outputMetricName: undefined },
      new MetricRecordingRule(),
    ]) {
      expect(() => {
        MetricRecordingRuleServiceClass.assertOutputMetricNameNotCleared(data);
      }).not.toThrow();
    }
  });

  test("refuses data that empties it", () => {
    expect(() => {
      MetricRecordingRuleServiceClass.assertOutputMetricNameNotCleared({
        outputMetricName: "",
      });
    }).toThrow(BadDataException);
  });
});
