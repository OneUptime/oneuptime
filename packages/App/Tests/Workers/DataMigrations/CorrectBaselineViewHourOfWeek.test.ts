import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The baseline views numbered the week from mode 1 of toDayOfWeek, which
 * starts Monday at 0: Monday landed at 232..255 and every other day one slot
 * early. The models now use mode 0, the readers accept both encodings, and
 * this migration points the views of existing installs at the models' query.
 *
 * What is pinned:
 *
 *   - the models encode the week with mode 0;
 *   - the statements: per view, the model's CREATE ... IF NOT EXISTS and an
 *     in-place MODIFY QUERY, both ON CLUSTER, with the model's SELECT reading
 *     the local source table - never a DROP, a copy or a mutation;
 *   - the check: positive, against the model's own hourOfWeek expression,
 *     on every host of the cluster;
 *   - a host that lacks a view gets the corrected one;
 *   - a host that has not applied the DDL, or cannot be reached, is named in
 *     a warning and does not fail the run; a failing statement does;
 *   - it runs on the clustered schema instead of being baselined, its
 *     rollback does nothing, and it is registered once, before the last slot.
 *
 * CorrectBaselineViewHourOfWeekClickhouse.test.ts runs it, and the readers,
 * against a real ClickHouse server.
 */

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { execute: jest.fn(), executeQuery: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import LogCountBaseline from "Common/Models/AnalyticsModels/LogCountBaseline";
import MetricBaselineHourly from "Common/Models/AnalyticsModels/MetricBaselineHourly";
import SpanCountBaseline from "Common/Models/AnalyticsModels/SpanCountBaseline";
import { MigrationExecuteOptions } from "Common/Server/Services/AnalyticsDatabaseService";
import MetricService from "Common/Server/Services/MetricService";
import { applyClusterToMaterializedViewQuery } from "Common/Server/Utils/AnalyticsDatabase/ClusterConfig";
import logger from "Common/Server/Utils/Logger";
import MaterializedView from "Common/Types/AnalyticsDatabase/MaterializedView";
import CorrectBaselineViewHourOfWeek from "../../../FeatureSet/Workers/DataMigrations/CorrectBaselineViewHourOfWeek";

type MockFunction = ReturnType<typeof jest.fn>;

const metricService: { execute: MockFunction; executeQuery: MockFunction } =
  MetricService as unknown as {
    execute: MockFunction;
    executeQuery: MockFunction;
  };

const warn: MockFunction = (logger as unknown as { warn: MockFunction }).warn;

const MIGRATION_NAME: string = "CorrectBaselineViewHourOfWeek";

const MODELS: Array<AnalyticsBaseModel> = [
  new LogCountBaseline(),
  new SpanCountBaseline(),
  new MetricBaselineHourly(),
];

const MODEL_ROWS: Array<{ tableName: string; model: AnalyticsBaseModel }> =
  MODELS.map((model: AnalyticsBaseModel) => {
    return { tableName: model.tableName, model: model };
  });

const HOSTS: Array<string> = ["ch-0", "ch-1"];

function viewOf(model: AnalyticsBaseModel): MaterializedView {
  return model.materializedViews[0]!;
}

function timeColumnOf(view: MaterializedView): string {
  return view.name.startsWith("Span") ? "startTime" : "time";
}

// How ClickHouse stores a view's hourOfWeek item: re-parenthesised.
function storedDefinition(view: MaterializedView, mode1: boolean): string {
  const t: string = timeColumnOf(view);
  const weekday: string = mode1 ? `toDayOfWeek(${t}, 1)` : `toDayOfWeek(${t})`;
  return `CREATE MATERIALIZED VIEW oneuptime.${view.name} TO oneuptime.X (\`day\` Date, \`hourOfWeek\` UInt8) AS SELECT toDate(${t}) AS day, toUInt8(((${weekday} - 1) * 24) + toHour(${t})) AS hourOfWeek FROM oneuptime.Y`;
}

/*
 * A stand-in for the cluster: each host's stored view definitions, the
 * hosts that do not apply DDL, and the hosts that cannot be reached.
 */
let definitions: Map<string, Map<string, string>>;
let lagging: Set<string>;
let unreachable: Set<string>;

function statements(): Array<string> {
  return metricService.execute.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

function rows(data: Array<Record<string, unknown>>): {
  json: () => Promise<unknown>;
} {
  return {
    json: async (): Promise<unknown> => {
      return { data: data };
    },
  };
}

function startOn(mode1: boolean): void {
  for (const host of HOSTS) {
    definitions.set(
      host,
      new Map(
        MODELS.map((model: AnalyticsBaseModel): [string, string] => {
          return [viewOf(model).name, storedDefinition(viewOf(model), mode1)];
        }),
      ),
    );
  }
}

function everyHostCorrected(): boolean {
  return HOSTS.every((host: string) => {
    return MODELS.every((model: AnalyticsBaseModel) => {
      const stored: string | undefined = definitions
        .get(host)
        ?.get(viewOf(model).name);
      return (
        stored !== undefined &&
        CorrectBaselineViewHourOfWeek.carriesModelEncoding(
          stored,
          viewOf(model),
        )
      );
    });
  });
}

beforeEach(() => {
  definitions = new Map();
  lagging = new Set();
  unreachable = new Set();

  metricService.execute.mockReset();
  metricService.executeQuery.mockReset();
  warn.mockReset();

  metricService.execute.mockImplementation((async (statement: string) => {
    const created: RegExpMatchArray | null = statement.match(
      /^CREATE MATERIALIZED VIEW IF NOT EXISTS (\w+) ON CLUSTER '\w+'/,
    );
    const altered: RegExpMatchArray | null = statement.match(
      /^ALTER TABLE oneuptime\.(\w+) ON CLUSTER '\w+' MODIFY QUERY (SELECT[\s\S]*)$/,
    );
    if (!created && !altered) {
      throw new Error(`unexpected statement: ${statement}`);
    }

    for (const host of HOSTS) {
      if (lagging.has(host)) {
        continue;
      }
      const views: Map<string, string> =
        definitions.get(host) ?? new Map<string, string>();
      definitions.set(host, views);

      if (created && !views.has(created[1]!)) {
        views.set(created[1]!, statement);
      }
      if (altered && views.has(altered[1]!)) {
        views.set(
          altered[1]!,
          `CREATE MATERIALIZED VIEW oneuptime.${altered[1]} TO oneuptime.X AS ${altered[2]}`,
        );
      }
    }
  }) as never);

  metricService.executeQuery.mockImplementation((async (statement: string) => {
    if (statement.includes("FROM system.clusters")) {
      return rows([{ hosts: String(HOSTS.length) }]);
    }

    const view: RegExpMatchArray | null = statement.match(
      /clusterAllReplicas\('oneuptime', system\.tables\) WHERE database = 'oneuptime' AND name = '(\w+)'/,
    );
    if (view) {
      if (unreachable.size > 0) {
        throw new Error(`cannot reach ${Array.from(unreachable).join(", ")}`);
      }
      return rows(
        HOSTS.filter((host: string) => {
          return definitions.get(host)?.has(view[1]!);
        }).map((host: string) => {
          return { host: host, query: definitions.get(host)!.get(view[1]!) };
        }),
      );
    }

    throw new Error(`unexpected query: ${statement}`);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CorrectBaselineViewHourOfWeek", () => {
  test.each(MODEL_ROWS)(
    "$tableName encodes the week with mode 0",
    ({ model }: { model: AnalyticsBaseModel }) => {
      const t: string = timeColumnOf(viewOf(model));

      expect(viewOf(model).query).toContain(
        `toUInt8((toDayOfWeek(${t}) - 1) * 24 + toHour(${t})) AS hourOfWeek`,
      );
      expect(viewOf(model).query).not.toMatch(/toDayOfWeek\(\w+, 1\)/);
    },
  );

  test.each(MODEL_ROWS)(
    "replaces the query of $tableName's view in place, reading the local source",
    ({ model }: { model: AnalyticsBaseModel }) => {
      const view: MaterializedView = viewOf(model);
      const source: string = view.query.match(/\bFROM\s+(\w+)/)![1]!;
      const statement: string =
        CorrectBaselineViewHourOfWeek.getModifyQueryStatement(view);

      expect(statement).toMatch(
        new RegExp(
          `^ALTER TABLE oneuptime\\.${view.name} ON CLUSTER 'oneuptime' MODIFY QUERY SELECT\\b`,
        ),
      );
      expect(statement).toContain(`FROM oneuptime.${source}Local`);
      expect(statement).toContain(
        view.query.match(/^\s*(.+ AS hourOfWeek),$/m)![1]!,
      );
      expect(statement).not.toMatch(/\bCREATE\b|\bTO\s/);
    },
  );

  test.each(MODEL_ROWS)(
    "recognises $tableName's view by the model's expression, as ClickHouse stores it",
    ({ model }: { model: AnalyticsBaseModel }) => {
      const view: MaterializedView = viewOf(model);

      expect(
        CorrectBaselineViewHourOfWeek.carriesModelEncoding(
          storedDefinition(view, false),
          view,
        ),
      ).toBe(true);
      expect(
        CorrectBaselineViewHourOfWeek.carriesModelEncoding(
          storedDefinition(view, true),
          view,
        ),
      ).toBe(false);
      expect(CorrectBaselineViewHourOfWeek.carriesModelEncoding("", view)).toBe(
        false,
      );
    },
  );

  test("does not take one view's definition for another's", () => {
    const logView: MaterializedView = viewOf(new LogCountBaseline());
    const spanView: MaterializedView = viewOf(new SpanCountBaseline());

    expect(
      CorrectBaselineViewHourOfWeek.carriesModelEncoding(
        storedDefinition(logView, false),
        spanView,
      ),
    ).toBe(false);
  });

  test("sends each view the model's CREATE IF NOT EXISTS and MODIFY QUERY, and nothing else", async () => {
    startOn(true);

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(statements()).toEqual(
      MODELS.flatMap((model: AnalyticsBaseModel) => {
        return [
          applyClusterToMaterializedViewQuery(viewOf(model).query),
          CorrectBaselineViewHourOfWeek.getModifyQueryStatement(viewOf(model)),
        ];
      }),
    );
    for (const call of metricService.execute.mock.calls) {
      expect(call[1]).toBe(MigrationExecuteOptions);
    }
    expect(everyHostCorrected()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test("re-sends the same idempotent DDL to views already corrected", async () => {
    startOn(false);

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(statements()).toHaveLength(6);
    expect(everyHostCorrected()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test("gives the corrected view to a host that lacks it", async () => {
    startOn(true);
    definitions.get("ch-1")!.delete(viewOf(new MetricBaselineHourly()).name);

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(everyHostCorrected()).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  test("names a host that has not applied the DDL in a warning, and still completes", async () => {
    startOn(true);
    lagging.add("ch-1");

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain(
      "LogCountBaseline_mv@ch-1 holds the old definition",
    );
  });

  test("names a view missing on a host that has not applied the DDL", async () => {
    startOn(false);
    lagging.add("ch-1");
    definitions.get("ch-1")!.delete(viewOf(new SpanCountBaseline()).name);

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(String(warn.mock.calls[0]![0])).toContain(
      "SpanCountBaseline_mv is missing on 1 host(s)",
    );
  });

  test("names an unreachable host in a warning, and still completes", async () => {
    startOn(true);
    unreachable.add("ch-1");

    await new CorrectBaselineViewHourOfWeek().migrate();

    expect(String(warn.mock.calls[0]![0])).toContain("cannot reach ch-1");
  });

  test("fails when a statement fails", async () => {
    startOn(true);
    metricService.execute.mockRejectedValueOnce(
      new Error("Code: 48. NOT_IMPLEMENTED") as never,
    );

    await expect(new CorrectBaselineViewHourOfWeek().migrate()).rejects.toThrow(
      "NOT_IMPLEMENTED",
    );
  });

  test("runs on the clustered schema instead of being baselined", () => {
    expect(new CorrectBaselineViewHourOfWeek().runsInClusterMode()).toBe(true);
  });

  test("its rollback does nothing", async () => {
    await new CorrectBaselineViewHourOfWeek().rollback();

    expect(statements()).toEqual([]);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const index: string = fs
      .readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "FeatureSet",
          "Workers",
          "DataMigrations",
          "Index.ts",
        ),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );
    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    expect(index).not.toContain("ReencodeBaselineHourOfWeek");
  });
});
