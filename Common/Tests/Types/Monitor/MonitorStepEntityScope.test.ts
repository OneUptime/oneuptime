import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Log from "../../../Models/AnalyticsModels/Log";
import Span from "../../../Models/AnalyticsModels/Span";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Profile from "../../../Models/AnalyticsModels/Profile";
import Metric from "../../../Models/AnalyticsModels/Metric";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import MonitorStepProfileMonitor, {
  MonitorStepProfileMonitorUtil,
} from "../../../Types/Monitor/MonitorStepProfileMonitor";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import { JSONObject } from "../../../Types/JSON";

/*
 * Entity scoping on telemetry monitor steps (entityKeys -> hasAny membership
 * predicate). The contract these tests lock in:
 *
 *   1. Backward compatibility — monitors saved before the field existed
 *      deserialize with no entityKeys (or an empty array), and the query
 *      compile treats undefined/empty as a strict no-op (no `entityKeys`
 *      predicate in the generated Query<Model>).
 *   2. When 1+ keys are present, the compile emits an Includes on the
 *      `entityKeys` column, which StatementGenerator turns into
 *      hasAny(entityKeys, [...]) for Array(String) columns.
 */

const TWO_KEYS: Array<string> = ["a1b2c3d4e5f60708", "1122334455667788"];

type ExpectIncludesFunction = (
  value: unknown,
  expectedKeys: Array<string>,
) => void;

const expectIncludes: ExpectIncludesFunction = (
  value: unknown,
  expectedKeys: Array<string>,
): void => {
  expect(value).toBeInstanceOf(Includes);
  expect((value as Includes).values).toEqual(expectedKeys);
};

describe("MonitorStepLogMonitorUtil.toQuery entity scoping", () => {
  test("omits entityKeys predicate when field is undefined (pre-existing saved monitors)", () => {
    const step: MonitorStepLogMonitor = MonitorStepLogMonitorUtil.getDefault();
    delete step.entityKeys;

    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(step);

    expect(query.entityKeys).toBeUndefined();
    expect(Object.keys(query)).not.toContain("entityKeys");
  });

  test("omits entityKeys predicate when field is an empty array", () => {
    const step: MonitorStepLogMonitor = MonitorStepLogMonitorUtil.getDefault();
    step.entityKeys = [];

    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("compiles two entity keys to an Includes on entityKeys", () => {
    const step: MonitorStepLogMonitor = MonitorStepLogMonitorUtil.getDefault();
    step.entityKeys = TWO_KEYS;

    const query: Query<Log> = MonitorStepLogMonitorUtil.toQuery(step);

    expectIncludes(query.entityKeys, TWO_KEYS);
  });

  test("fromJSON tolerates legacy JSON without entityKeys and round-trips keys", () => {
    const legacyJson: JSONObject = MonitorStepLogMonitorUtil.toJSON(
      MonitorStepLogMonitorUtil.getDefault(),
    );
    delete legacyJson["entityKeys"];

    const legacyStep: MonitorStepLogMonitor =
      MonitorStepLogMonitorUtil.fromJSON(legacyJson);
    expect(legacyStep.entityKeys).toEqual([]);

    const stepWithKeys: MonitorStepLogMonitor =
      MonitorStepLogMonitorUtil.getDefault();
    stepWithKeys.entityKeys = TWO_KEYS;

    const roundTripped: MonitorStepLogMonitor =
      MonitorStepLogMonitorUtil.fromJSON(
        MonitorStepLogMonitorUtil.toJSON(stepWithKeys),
      );
    expect(roundTripped.entityKeys).toEqual(TWO_KEYS);
  });
});

describe("MonitorStepTraceMonitorUtil.toQuery entity scoping", () => {
  test("omits entityKeys predicate when field is undefined", () => {
    const step: MonitorStepTraceMonitor =
      MonitorStepTraceMonitorUtil.getDefault();
    delete step.entityKeys;

    const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("omits entityKeys predicate when field is an empty array", () => {
    const step: MonitorStepTraceMonitor =
      MonitorStepTraceMonitorUtil.getDefault();
    step.entityKeys = [];

    const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("compiles two entity keys to an Includes on entityKeys", () => {
    const step: MonitorStepTraceMonitor =
      MonitorStepTraceMonitorUtil.getDefault();
    step.entityKeys = TWO_KEYS;

    const query: Query<Span> = MonitorStepTraceMonitorUtil.toQuery(step);

    expectIncludes(query.entityKeys, TWO_KEYS);
  });

  test("fromJSON tolerates legacy JSON without entityKeys", () => {
    const legacyJson: JSONObject = MonitorStepTraceMonitorUtil.toJSON(
      MonitorStepTraceMonitorUtil.getDefault(),
    );
    delete legacyJson["entityKeys"];

    const legacyStep: MonitorStepTraceMonitor =
      MonitorStepTraceMonitorUtil.fromJSON(legacyJson);
    expect(legacyStep.entityKeys).toEqual([]);
  });
});

describe("MonitorStepExceptionMonitorUtil.toAnalyticsQuery entity scoping", () => {
  test("omits entityKeys predicate when field is undefined", () => {
    const step: MonitorStepExceptionMonitor =
      MonitorStepExceptionMonitorUtil.getDefault();
    delete step.entityKeys;

    const query: Query<ExceptionInstance> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("omits entityKeys predicate when field is an empty array", () => {
    const step: MonitorStepExceptionMonitor =
      MonitorStepExceptionMonitorUtil.getDefault();
    step.entityKeys = [];

    const query: Query<ExceptionInstance> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("compiles two entity keys to an Includes on entityKeys", () => {
    const step: MonitorStepExceptionMonitor =
      MonitorStepExceptionMonitorUtil.getDefault();
    step.entityKeys = TWO_KEYS;

    const query: Query<ExceptionInstance> =
      MonitorStepExceptionMonitorUtil.toAnalyticsQuery(step);

    expectIncludes(query.entityKeys, TWO_KEYS);
  });

  test("fromJSON tolerates legacy JSON without entityKeys", () => {
    const legacyJson: JSONObject = MonitorStepExceptionMonitorUtil.toJSON(
      MonitorStepExceptionMonitorUtil.getDefault(),
    );
    delete legacyJson["entityKeys"];

    const legacyStep: MonitorStepExceptionMonitor =
      MonitorStepExceptionMonitorUtil.fromJSON(legacyJson);
    expect(legacyStep.entityKeys).toEqual([]);
  });
});

describe("MonitorStepProfileMonitorUtil.toQuery entity scoping", () => {
  test("omits entityKeys predicate when field is undefined", () => {
    const step: MonitorStepProfileMonitor =
      MonitorStepProfileMonitorUtil.getDefault();
    delete step.entityKeys;

    const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("omits entityKeys predicate when field is an empty array", () => {
    const step: MonitorStepProfileMonitor =
      MonitorStepProfileMonitorUtil.getDefault();
    step.entityKeys = [];

    const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery(step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("compiles two entity keys to an Includes on entityKeys", () => {
    const step: MonitorStepProfileMonitor =
      MonitorStepProfileMonitorUtil.getDefault();
    step.entityKeys = TWO_KEYS;

    const query: Query<Profile> = MonitorStepProfileMonitorUtil.toQuery(step);

    expectIncludes(query.entityKeys, TWO_KEYS);
  });
});

describe("MonitorStepMetricMonitorUtil.applyEntityScopeToQuery", () => {
  test("is a no-op when entityKeys is undefined (pre-existing saved monitors)", () => {
    const step: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.getDefault();
    delete step.entityKeys;

    const query: Query<Metric> = {};
    MonitorStepMetricMonitorUtil.applyEntityScopeToQuery(query, step);

    expect(query.entityKeys).toBeUndefined();
    expect(Object.keys(query)).toHaveLength(0);
  });

  test("is a no-op when entityKeys is an empty array", () => {
    const step: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.getDefault();
    step.entityKeys = [];

    const query: Query<Metric> = {};
    MonitorStepMetricMonitorUtil.applyEntityScopeToQuery(query, step);

    expect(query.entityKeys).toBeUndefined();
  });

  test("stamps an Includes on entityKeys for two keys and preserves other predicates", () => {
    const step: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.getDefault();
    step.entityKeys = TWO_KEYS;

    const query: Query<Metric> = { name: "cpu.usage" };
    const returned: Query<Metric> =
      MonitorStepMetricMonitorUtil.applyEntityScopeToQuery(query, step);

    expect(returned).toBe(query);
    expect(query.name).toBe("cpu.usage");
    expectIncludes(query.entityKeys, TWO_KEYS);
  });

  test("fromJSON preserves entityKeys (pass-through serialization)", () => {
    const step: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.getDefault();
    step.entityKeys = TWO_KEYS;

    const roundTripped: MonitorStepMetricMonitor =
      MonitorStepMetricMonitorUtil.fromJSON(
        MonitorStepMetricMonitorUtil.toJSON(step),
      );

    expect(roundTripped.entityKeys).toEqual(TWO_KEYS);
  });
});
