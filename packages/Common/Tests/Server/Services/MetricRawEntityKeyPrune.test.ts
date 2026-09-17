import "../TestingUtils/Init";
import { MetricService } from "../../../Server/Services/MetricService";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import EqualTo from "../../../Types/BaseDatabase/EqualTo";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import NotEqual from "../../../Types/BaseDatabase/NotEqual";
import Search from "../../../Types/BaseDatabase/Search";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  keyForHost,
  keyForKubernetesCluster,
} from "../../../Utils/Telemetry/EntityKey";
import { keyForContainer } from "../../../Server/Utils/Telemetry/TelemetryEntity";

/*
 * Regression suite for the raw-table entity prune
 * (MetricService.applyRawEntityKeyPrune).
 *
 * The bug: a metric query that filters on an entity attribute PLUS
 * anything the per-entity rollups cannot express (a second attribute
 * filter, a group-by, a percentile, a distribution metric, a `Total`
 * interval) declines every MV route and reads the raw table. `attributes`
 * is an unindexed Map column, so the entity filter pruned nothing and the
 * scan grew with the query window — a real 1-week chart for one host
 * blew the 45s max_execution_time and returned a 500 (or, under
 * timeout_overflow_mode='break', a silently partial chart).
 *
 * The fix ANDs a predicate on the bloom-indexed scalar entity-key column.
 * These tests pin down BOTH halves of what makes that safe:
 *   1. it is applied on every raw path, and
 *   2. it never fires for a filter shape whose matching rows are not
 *      exactly the union of a derivable key set (negations, substring
 *      operators, non-string values), and
 *   3. it never displaces the MV fast paths it backstops, and
 *   4. it always carries '' so rows predating the key columns survive.
 */
describe("MetricService raw-table entity-key prune", () => {
  const projectId: ObjectID = ObjectID.generate();
  const startDate: Date = new Date("2026-07-09T19:08:00.000Z");
  const endDate: Date = new Date("2026-07-16T19:08:00.000Z");

  let service: MetricService;

  beforeEach(() => {
    service = new MetricService();
  });

  type BuildAggregateByFunction = (
    overrides?: Partial<AggregateBy<Metric>>,
  ) => AggregateBy<Metric>;

  const buildAggregateBy: BuildAggregateByFunction = (
    overrides?: Partial<AggregateBy<Metric>>,
  ): AggregateBy<Metric> => {
    return {
      query: {
        projectId: projectId,
        name: "system.cpu.utilization",
        time: new InBetween(startDate, endDate),
      } as AggregateBy<Metric>["query"],
      aggregationType: AggregationType.Avg,
      aggregateColumnName: "value",
      aggregationTimestampColumnName: "time",
      startTimestamp: startDate,
      endTimestamp: endDate,
      limit: 10000,
      skip: 0,
      sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
      props: { isRoot: true },
      ...overrides,
    };
  };

  /**
   * The exact shape from the reported bug: one host plus a second
   * attribute filter ("state is any of system, user"), which is what
   * knocks the query off the per-host rollup.
   */
  type BuildFilteredFunction = (
    attributes: Record<string, unknown>,
    overrides?: Partial<AggregateBy<Metric>>,
  ) => AggregateBy<Metric>;

  const buildFiltered: BuildFilteredFunction = (
    attributes: Record<string, unknown>,
    overrides?: Partial<AggregateBy<Metric>>,
  ): AggregateBy<Metric> => {
    return buildAggregateBy({
      query: {
        projectId: projectId,
        name: "system.cpu.utilization",
        time: new InBetween(startDate, endDate),
        attributes,
      } as unknown as AggregateBy<Metric>["query"],
      ...overrides,
    });
  };

  const HOST_AND_STATE: Record<string, unknown> = {
    "resource.host.name": "pirmsazuresql06",
    state: new Includes(["system", "user"]),
  };

  type BuildFunction = (aggregateBy: AggregateBy<Metric>) => {
    statement: Statement;
    columns: Array<string>;
  };

  const build: BuildFunction = (
    aggregateBy: AggregateBy<Metric>,
  ): { statement: Statement; columns: Array<string> } => {
    return service.toAggregateStatement(aggregateBy);
  };

  type ParamsOfFunction = (result: { statement: Statement }) => Array<unknown>;

  const paramsOf: ParamsOfFunction = (result: {
    statement: Statement;
  }): Array<unknown> => {
    return Object.values(result.statement.query_params);
  };

  type PrunedKeysFunction = (
    result: { statement: Statement },
    keyColumn: string,
  ) => Array<string> | null;

  /**
   * The key set the prune bound for `keyColumn`, or null when it emitted
   * no `IN` predicate for that column.
   *
   * Column names reach ClickHouse as bound `Identifier` parameters rather
   * than literal SQL text (and the aliased builders bind them as a
   * `{pN_t}.{pN_c}` pair), so "did we prune?" cannot be answered by
   * grepping the query string — `toContain("hostEntityKey")` would be
   * false in every case, passing the negative tests for the wrong reason.
   * Resolve the column's parameter name first, then read the list it is
   * compared against.
   */
  const prunedKeys: PrunedKeysFunction = (
    result: { statement: Statement },
    keyColumn: string,
  ): Array<string> | null => {
    const params: Record<string, unknown> = result.statement
      .query_params as unknown as Record<string, unknown>;

    const identifierNames: Array<string> = Object.entries(params)
      .filter(([, value]: [string, unknown]): boolean => {
        return value === keyColumn;
      })
      .map(([name]: [string, unknown]): string => {
        return name;
      });

    for (const name of identifierNames) {
      const match: RegExpMatchArray | null = result.statement.query.match(
        new RegExp(
          `\\{${name}:Identifier\\} IN \\{(p\\d+):Array\\(String\\)\\}`,
        ),
      );
      if (match && match[1]) {
        return params[match[1]] as Array<string>;
      }
    }

    return null;
  };

  describe("the reported regression", () => {
    it("prunes a host + second-attribute aggregation on the raw table", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(HOST_AND_STATE),
      );

      // It really is the raw path — no rollup can serve this filter.
      expect(result.statement.query).not.toContain("MetricItemAggMV1m");
      // ...but the scan is now bounded by the bloom-indexed key column.
      expect(prunedKeys(result, "hostEntityKey")).toEqual(
        expect.arrayContaining([
          keyForHost(projectId.toString(), "pirmsazuresql06"),
        ]),
      );
    });

    it("keeps the original attributes predicate — the prune is additive, not a replacement", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(HOST_AND_STATE),
      );

      /*
       * The map lookups that actually express the user's filter survive —
       * the prune only narrows which granules are read.
       */
      expect(paramsOf(result)).toContain("attributes");
      expect(paramsOf(result)).toContain("pirmsazuresql06");
      expect(paramsOf(result)).toContainEqual(["system", "user"]);
      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });

    it("carries '' so rows ingested before the key columns existed are not dropped", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(HOST_AND_STATE),
      );

      expect(prunedKeys(result, "hostEntityKey")).toContain("");
    });

    it("binds the key as a parameter and never inlines it into SQL", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(HOST_AND_STATE),
      );

      expect(result.statement.query).not.toContain("pirmsazuresql06");
      expect(result.statement.query).not.toContain(
        keyForHost(projectId.toString(), "pirmsazuresql06"),
      );
    });
  });

  describe("recognized entity attributes", () => {
    it("prunes a k8s.cluster.name filter on the raw path", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.k8s.cluster.name": "Prod-EU-1",
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "k8sClusterEntityKey")).toEqual(
        expect.arrayContaining([
          keyForKubernetesCluster(projectId.toString(), "Prod-EU-1"),
          "",
        ]),
      );
    });

    it("prunes a container.id filter on the raw path", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.container.id": "abc123def456",
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "containerEntityKey")).toEqual(
        expect.arrayContaining([
          keyForContainer(projectId.toString(), "abc123def456"),
          "",
        ]),
      );
    });

    it("prunes on BOTH key columns when two recognized entity attributes are filtered together", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": "web-01",
          "resource.container.id": "abc123def456",
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toContain(
        keyForHost(projectId.toString(), "web-01"),
      );
      expect(prunedKeys(result, "containerEntityKey")).toContain(
        keyForContainer(projectId.toString(), "abc123def456"),
      );
    });

    it("canonicalizes the attribute value exactly like ingest (case/whitespace drift)", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": "  WEB-01  ",
          state: new Includes(["system"]),
        }),
      );

      /*
       * keyForHost trims + lowercases, so the derived key must be
       * byte-identical to the one for the canonical spelling — otherwise
       * the predicate would match nothing.
       */
      expect(prunedKeys(result, "hostEntityKey")).toContain(
        keyForHost(projectId.toString(), "web-01"),
      );
    });

    it("does NOT prune on service.name — namespaced variants are not derivable from a bare name", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.service.name": "checkout",
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "serviceEntityKey")).toBeNull();
    });

    it("ignores attributes that are not entity identities", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({ state: new Includes(["system", "user"]) }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toBeNull();
      expect(prunedKeys(result, "containerEntityKey")).toBeNull();
      expect(prunedKeys(result, "k8sClusterEntityKey")).toBeNull();
    });
  });

  describe("accepted filter shapes", () => {
    it("accepts a bare string value", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": "web-01",
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toContain(
        keyForHost(projectId.toString(), "web-01"),
      );
    });

    it("accepts EqualTo(string)", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": new EqualTo("web-01"),
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toContain(
        keyForHost(projectId.toString(), "web-01"),
      );
    });

    it("accepts Includes([...]) — 'is any of' — as the union of every listed host's key", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": new Includes(["web-01", "web-02"]),
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toEqual(
        expect.arrayContaining([
          keyForHost(projectId.toString(), "web-01"),
          keyForHost(projectId.toString(), "web-02"),
          "",
        ]),
      );
    });

    it("deduplicates keys when two spellings canonicalize to the same entity", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": new Includes(["web-01", "WEB-01"]),
          state: new Includes(["system"]),
        }),
      );

      // One derived key + the '' fallback.
      expect(prunedKeys(result, "hostEntityKey")).toEqual([
        keyForHost(projectId.toString(), "web-01"),
        "",
      ]);
    });
  });

  describe("refused filter shapes (no predicate is provably lossless)", () => {
    type ExpectNoPruneFunction = (attributeValue: unknown) => void;

    const expectNoPrune: ExpectNoPruneFunction = (
      attributeValue: unknown,
    ): void => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({
          "resource.host.name": attributeValue,
          state: new Includes(["system"]),
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toBeNull();
    };

    it("refuses NotEqual — the complement is not an enumerable key set", () => {
      expectNoPrune(new NotEqual("web-01"));
    });

    it("refuses IncludesNone ('is none of')", () => {
      expectNoPrune(new IncludesNone(["web-01", "web-02"]));
    });

    it("refuses Search (substring) — matches hosts whose keys are unknown", () => {
      expectNoPrune(new Search("web"));
    });

    it("refuses an empty string value", () => {
      expectNoPrune("");
    });

    it("refuses a non-string value", () => {
      expectNoPrune(42);
    });

    it("refuses an Includes containing a non-string member", () => {
      expectNoPrune(new Includes(["web-01", 7] as unknown as Array<string>));
    });

    it("refuses an empty Includes", () => {
      expectNoPrune(new Includes([]));
    });

    it("refuses an array of AND-ed operators on one attribute", () => {
      expectNoPrune([new Search("web"), new Search("01")]);
    });
  });

  describe("guards", () => {
    it("does not prune a query with no projectId — entity keys fold the tenant in", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildAggregateBy({
          query: {
            name: "system.cpu.utilization",
            time: new InBetween(startDate, endDate),
            attributes: HOST_AND_STATE,
          } as unknown as AggregateBy<Metric>["query"],
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toBeNull();
    });

    it("never overwrites a caller-supplied predicate on the key column", () => {
      const callerKey: string = "deadbeefdeadbeef";
      const result: { statement: Statement; columns: Array<string> } = build(
        buildAggregateBy({
          query: {
            projectId: projectId,
            name: "system.cpu.utilization",
            time: new InBetween(startDate, endDate),
            attributes: HOST_AND_STATE,
            hostEntityKey: callerKey,
          } as unknown as AggregateBy<Metric>["query"],
        }),
      );

      expect(paramsOf(result)).toContain(callerKey);
      // The caller's equality stands; no second IN predicate is added.
      expect(prunedKeys(result, "hostEntityKey")).toBeNull();
    });

    it("is a no-op when the query has no attributes at all", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildAggregateBy({ aggregationType: AggregationType.P95 }),
      );

      expect(prunedKeys(result, "hostEntityKey")).toBeNull();
    });

    it("does not mutate the caller's query object in place", () => {
      const aggregateBy: AggregateBy<Metric> = buildFiltered(HOST_AND_STATE);
      const originalQuery: AggregateBy<Metric>["query"] = aggregateBy.query;

      build(aggregateBy);

      expect(
        (originalQuery as unknown as Record<string, unknown>)["hostEntityKey"],
      ).toBeUndefined();
    });

    it("is idempotent — compiling the same aggregateBy twice yields the same SQL", () => {
      const aggregateBy: AggregateBy<Metric> = buildFiltered(HOST_AND_STATE);

      const first: { statement: Statement; columns: Array<string> } =
        build(aggregateBy);
      const second: { statement: Statement; columns: Array<string> } =
        build(aggregateBy);

      expect(second.statement.query).toBe(first.statement.query);
      expect(second.statement.query_params).toStrictEqual(
        first.statement.query_params,
      );
      // Exactly one prune predicate, not one per compile.
      expect(prunedKeys(second, "hostEntityKey")).toHaveLength(2);
    });
  });

  describe("does not displace the fast paths it backstops", () => {
    it("still routes a lone host filter to the per-host rollup", () => {
      const query: string = build(
        buildFiltered({ "resource.host.name": "web-01" }),
      ).statement.query;

      /*
       * The prune runs only AFTER MV routing declines. If it ran first,
       * the extra key column would fail the MV's mvQueryableColumns gate
       * and silently demote every entity page to the raw table.
       */
      expect(query).toContain("MetricItemAggMV1mByHostV2");
      expect(query).toMatch(/ AND hostEntityKey = \{p\d+:String\}/);
      expect(query).not.toContain("hostEntityKey IN");
    });

    it("still routes an unfiltered aggregation to the minute rollup", () => {
      const result: { statement: Statement; columns: Array<string> } =
        build(buildAggregateBy());

      expect(result.statement.query).toContain("MetricItemAggMV1m");
      expect(prunedKeys(result, "hostEntityKey")).toBeNull();
    });
  });

  describe("applies on every raw path", () => {
    it("prunes the count-weighted distribution path", () => {
      const aggregateBy: AggregateBy<Metric> = buildFiltered(HOST_AND_STATE);
      (
        service as unknown as {
          pointTypeHintByAggregate: WeakMap<AggregateBy<Metric>, string | null>;
        }
      ).pointTypeHintByAggregate.set(aggregateBy, "Histogram");

      const result: { statement: Statement; columns: Array<string> } =
        build(aggregateBy);

      expect(result.statement.query).not.toContain("MetricItemAggMV1m");
      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });

    it("prunes the percentile path", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(HOST_AND_STATE, {
          aggregationType: AggregationType.P95,
        }),
      );

      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });

    it("prunes a percentile query whose only filter is the host (percentiles never route to an MV)", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(
          { "resource.host.name": "web-01" },
          { aggregationType: AggregationType.P99 },
        ),
      );

      expect(result.statement.query).not.toContain("MetricItemAggMV1m");
      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });

    it("prunes an attribute-key group-by (which blocks every MV)", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered({ "resource.host.name": "web-01" }, {
          groupByAttributeKeys: ["state"],
        } as Partial<AggregateBy<Metric>>),
      );

      expect(result.statement.query).not.toContain("MetricItemAggMV1m");
      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });

    it("prunes a Total (whole-window) aggregation", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(
          { "resource.host.name": "web-01" },
          { aggregationInterval: AggregationInterval.Total },
        ),
      );

      expect(result.statement.query).not.toContain("MetricItemAggMV1m");
      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });

    it("prunes a model-column group-by", () => {
      const result: { statement: Statement; columns: Array<string> } = build(
        buildFiltered(HOST_AND_STATE, {
          groupBy: { name: true } as AggregateBy<Metric>["groupBy"],
        }),
      );

      expect(result.statement.query).not.toContain("MetricItemAggMV1m");
      expect(prunedKeys(result, "hostEntityKey")).not.toBeNull();
    });
  });
});
