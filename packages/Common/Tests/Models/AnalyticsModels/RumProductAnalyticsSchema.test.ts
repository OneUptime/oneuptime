import { ClickhouseAppInstance } from "../../../Server/Infrastructure/ClickhouseDatabase";
import StatementGenerator from "../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import { applyClusterToMaterializedViewQuery } from "../../../Server/Utils/AnalyticsDatabase/ClusterConfig";
import "../../Server/TestingUtils/Init";
import AnalyticsModels from "../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import RumProductAnalyticsSession, {
  PRODUCT_ANALYTICS_READ_PERMISSIONS,
} from "../../../Models/AnalyticsModels/RumProductAnalyticsSession";
import RumProductAnalyticsUser from "../../../Models/AnalyticsModels/RumProductAnalyticsUser";
import RumProductAnalyticsSessionService from "../../../Server/Services/RumProductAnalyticsSessionService";
import RumProductAnalyticsUserService from "../../../Server/Services/RumProductAnalyticsUserService";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import AnalyticsTableEngine from "../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../../Types/AnalyticsDatabase/AnalyticsTableName";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import { PRODUCT_ANALYTICS_RETENTION_MONTHS } from "../../../Types/Rum/ProductAnalytics";
import { describe, expect, test } from "@jest/globals";

/*
 * The two product analytics tables (issue #6444), and the views that fill
 * them from session replay's headers.
 *
 * Boot-time schema reconciliation only ever adds: a sort key, partition,
 * TTL or engine that is wrong ships for good, and a view that writes a
 * state its target column does not declare fails every insert into
 * RumSessionV1 - session replay with it. So the shape is pinned here, and
 * so is the one privacy promise the tables make: they keep no name.
 */

type ModelType = { new (): AnalyticsBaseModel };

const MODELS: Array<{ name: string; modelType: ModelType }> = [
  { name: "RumProductAnalyticsSession", modelType: RumProductAnalyticsSession },
  { name: "RumProductAnalyticsUser", modelType: RumProductAnalyticsUser },
];

function fullText(statement: Statement): string {
  return statement.query + " :: " + JSON.stringify(statement.query_params);
}

function createStatementFor(modelType: ModelType): Statement {
  return new StatementGenerator<AnalyticsBaseModel>({
    modelType: modelType,
    database: ClickhouseAppInstance,
  }).toTableCreateStatement();
}

/*
 * The view's SELECT list, one entry per output column: the alias of an
 * `expression AS alias` line, or a bare column's own name.
 */
function viewColumns(query: string): Map<string, string> {
  const select: string = query.slice(
    query.indexOf("\nSELECT\n") + "\nSELECT\n".length,
    query.indexOf("\nFROM "),
  );

  const columns: Map<string, string> = new Map<string, string>();

  for (const rawLine of select.split("\n")) {
    const line: string = rawLine.trim().replace(/,$/, "");

    if (!line) {
      continue;
    }

    const asIndex: number = line.lastIndexOf(" AS ");

    if (asIndex === -1) {
      columns.set(line, line);
    } else {
      columns.set(line.slice(asIndex + " AS ".length), line.slice(0, asIndex));
    }
  }

  return columns;
}

/* The -State combinator a view must use to write a column of this type. */
function expectedStatePrefix(column: AnalyticsTableColumn): string | null {
  if (column.simpleAggregateFunction) {
    return `${column.simpleAggregateFunction}SimpleState(`;
  }

  if (column.type === TableColumnType.AggregateFunction) {
    const fn: string = (column.aggregateFunctionDefinition || "")
      .split(",")[0]!
      .trim();

    return `${fn}State`;
  }

  return null;
}

describe.each(MODELS)("$name", ({ modelType }: { modelType: ModelType }) => {
  const model: AnalyticsBaseModel = new modelType();

  test("is an AggregatingMergeTree with no base columns, every column off the key an aggregate", () => {
    expect(model.tableEngine).toBe(AnalyticsTableEngine.AggregatingMergeTree);
    expect(model.getTableColumn("_id")).toBeNull();
    expect(model.getTableColumn("createdAt")).toBeNull();
    expect(model.getTableColumn("updatedAt")).toBeNull();
    expect(model.sortKeys).toContain(model.defaultSortColumn);
    expect(model.primaryKeys).toEqual(model.sortKeys);
    expect(model.sortKeys.slice(0, 2)).toEqual([
      "projectId",
      "rumApplicationId",
    ]);

    for (const column of model.tableColumns) {
      if (model.sortKeys.includes(column.key)) {
        expect(column.simpleAggregateFunction).toBeFalsy();
        continue;
      }

      expect(
        column.type === TableColumnType.AggregateFunction ||
          Boolean(column.simpleAggregateFunction),
      ).toBe(true);
    }
  });

  test("creates its Replicated local table ON CLUSTER with a monthly partition and a 13 month TTL", () => {
    const statement: Statement = createStatementFor(modelType);
    const ddl: string = fullText(statement);

    expect(statement.query).toContain(
      "ENGINE = ReplicatedAggregatingMergeTree",
    );
    expect(statement.query).toContain("ON CLUSTER");
    expect(ddl).toContain(`${model.tableName}Local`);
    expect(ddl).not.toContain('"_id"');
    expect(statement.query).toMatch(
      /PARTITION BY \(toYYYYMM\((startTime|month)\)\)/,
    );
    expect(statement.query).toContain(`TTL ${model.ttlExpression}`);
    expect(model.ttlExpression).toContain(
      `INTERVAL ${PRODUCT_ANALYTICS_RETENTION_MONTHS} MONTH DELETE`,
    );
    expect(PRODUCT_ANALYTICS_RETENTION_MONTHS).toBe(13);

    /* Whole monthly parts expire together: dropped, never rewritten. */
    expect(statement.query).toContain("ttl_only_drop_parts = 1");
    expect(statement.query).toContain("replicated_deduplication_window");
    expect(statement.query).not.toContain(
      "non_replicated_deduplication_window",
    );
  });

  test("has one view, from RumSessionV1, writing every column of the table with the state its type declares", () => {
    expect(model.materializedViews).toHaveLength(1);

    const query: string = model.materializedViews[0]!.query;

    expect(model.materializedViews[0]!.name).toBe(`${model.tableName}_mv`);
    expect(query).toContain(`TO ${model.tableName}\n`);
    expect(query).toContain(`\nFROM ${AnalyticsTableName.RumSession}\n`);

    const columns: Map<string, string> = viewColumns(query);

    expect([...columns.keys()].sort()).toEqual(
      model.tableColumns
        .map((column: AnalyticsTableColumn): string => {
          return column.key;
        })
        .sort(),
    );

    for (const column of model.tableColumns) {
      const prefix: string | null = expectedStatePrefix(column);

      if (prefix) {
        expect(`${column.key}: ${columns.get(column.key)}`).toContain(
          `${column.key}: ${prefix}`,
        );
      }
    }

    /* The view's GROUP BY is the table's key. */
    expect(query).toContain(`GROUP BY ${model.sortKeys.join(", ")}`);
  });

  test("in cluster mode the view reads and writes the shard's own tables", () => {
    const rewritten: string = applyClusterToMaterializedViewQuery(
      model.materializedViews[0]!.query,
    );

    expect(rewritten).toContain("ON CLUSTER");
    expect(rewritten).toContain(`TO ${model.tableName}Local`);
    expect(rewritten).toContain(`FROM ${AnalyticsTableName.RumSession}Local`);
    expect(rewritten).not.toMatch(/\bJOIN\b/);
  });

  test("keeps no name: neither the signed-in user's reference nor their traits", () => {
    expect(model.getTableColumn("identifiedUserLabel")).toBeNull();
    expect(model.getTableColumn("identifiedUserTraits")).toBeNull();

    const query: string = model.materializedViews[0]!.query;

    expect(query).not.toContain("identifiedUserLabel");
    expect(query).not.toContain("identifiedUserTraits");
    expect(query).not.toContain("clientIp");
  });

  test("is read like the session list, on session replay's plan, and has no generic API", () => {
    const listPermissions: Array<string> = [
      ...(new RumSession().accessControl?.read || []),
    ].sort();

    expect([...(model.accessControl?.read || [])].sort()).toEqual(
      listPermissions,
    );
    expect([...PRODUCT_ANALYTICS_READ_PERMISSIONS].sort()).toEqual(
      listPermissions,
    );
    expect(model.accessControl?.create).toEqual([]);
    expect(model.accessControl?.update).toEqual([]);
    expect(model.accessControl?.delete).toEqual([]);

    for (const column of model.tableColumns) {
      expect([...(column.accessControl?.read || [])].sort()).toEqual(
        listPermissions,
      );
      expect(column.accessControl?.create).toEqual([]);
    }

    expect(model.getReadBillingPlan()).toBe(
      new RumSession().getReadBillingPlan(),
    );
    expect(model.crudApiPath).toBeUndefined();
    expect(model.enableMCP).toBe(false);
  });

  test("is registered, with a service on its own table", () => {
    expect(
      AnalyticsModels.some((registered: ModelType): boolean => {
        return registered === modelType;
      }),
    ).toBe(true);

    const service: { model: AnalyticsBaseModel } =
      modelType === RumProductAnalyticsSession
        ? RumProductAnalyticsSessionService
        : RumProductAnalyticsUserService;

    expect(service.model.tableName).toBe(model.tableName);
  });
});

describe("RumProductAnalyticsSession", () => {
  const model: RumProductAnalyticsSession = new RumProductAnalyticsSession();

  test("is keyed by the session, ordered by its start within one application", () => {
    expect(model.tableName).toBe("RumProductAnalyticsSessionV1");
    expect(model.sortKeys).toEqual([
      "projectId",
      "rumApplicationId",
      "startTime",
      "sessionId",
    ]);
    expect(model.partitionKey).toBe("toYYYYMM(startTime)");
    expect(model.ttlExpression).toBe(
      "toStartOfMonth(startTime) + INTERVAL 13 MONTH DELETE",
    );
  });

  test("files every write of a session, the provisional and the pinned included", () => {
    const query: string = model.materializedViews[0]!.query;

    /* No WHERE: the reads fold a session's writes, and leave pinned copies out by the key. */
    expect(query).not.toMatch(/\nWHERE /);
    expect(query).toContain(
      "maxSimpleState(retentionDate) AS replayRetentionDate",
    );
    expect(query).toContain("groupUniqArrayArraySimpleState(routes) AS pages");
  });

  test("the people-finding columns carry bloom filters", () => {
    for (const key of ["sessionId", "identifiedUserKey", "visitorId"]) {
      expect(model.getTableColumn(key)?.skipIndex?.type).toBeDefined();
    }
  });
});

describe("RumProductAnalyticsUser", () => {
  const model: RumProductAnalyticsUser = new RumProductAnalyticsUser();

  test("is one row per person per month", () => {
    expect(model.tableName).toBe("RumProductAnalyticsUserV1");
    expect(model.sortKeys).toEqual([
      "projectId",
      "rumApplicationId",
      "personKey",
      "month",
    ]);
    expect(model.partitionKey).toBe("toYYYYMM(month)");
    expect(model.ttlExpression).toBe("month + INTERVAL 13 MONTH DELETE");
  });

  test("files a person only from finished sessions that are not pinned copies, and only someone", () => {
    const query: string = model.materializedViews[0]!.query;

    expect(query).toContain(
      "WHERE isFinalized = 1 AND isPinnedCopy = 0 AND (identifiedUserKey != '' OR visitorId != '')",
    );
    expect(query).toContain("toStartOfMonth(startTime) AS month");
    expect(query).toContain(
      "if(identifiedUserKey != '', concat('u:', identifiedUserKey), concat('v:', visitorId)) AS personKey",
    );
  });

  test("keeps the latest session's device and country, not the first", () => {
    expect(
      model.getTableColumn("deviceType")?.aggregateFunctionDefinition,
    ).toBe("argMax, String, DateTime64(9)");
    expect(
      model.getTableColumn("countryCode")?.aggregateFunctionDefinition,
    ).toBe("argMax, String, DateTime64(9)");
    expect(model.getTableColumn("sessions")?.aggregateFunctionDefinition).toBe(
      "uniq, String",
    );
  });
});
