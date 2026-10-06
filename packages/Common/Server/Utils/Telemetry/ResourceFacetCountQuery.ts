import { JSONObject } from "../../../Types/JSON";
import {
  ResourceEntityScope,
  renderResourceScope,
} from "./ResourceEntityFilter";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";

/**
 * Shared SQL for per-resource facet COUNTS.
 *
 * Issue #3251: a resource facet's count used to be
 * `SELECT toString(primaryEntityId), count() ... WHERE primaryEntityType =
 * '<type>' GROUP BY val` — which only counts rows whose PRIMARY entity is the
 * resource. Pure-OTLP telemetry is primary-keyed on its Service and carries
 * the cluster / host only in `entityKeys`, so those rows were invisible to the
 * count while selection (which matches id OR entity key) found them all: the
 * sidebar said 0, clicking the value showed every row.
 *
 * The fix counts each listed resource with the SAME membership test selection
 * uses, in one statement: one `countIf(...)` column per resource, whose predicate
 * is that resource's resolved scope (id OR entity key OR resource attribute).
 * `countIf` with the branches OR-ed — rather than one grouped query per
 * resource — is what keeps a row that satisfies both the id branch and the
 * key branch (agent-ingested rows do) counted exactly once.
 *
 * Cost (benchmarked on 30M rows, PERF audit in the #3251 PR): reading the
 * `attributes` map for every row made the single-pass count ~20x slower than
 * the old primaryEntityId count. So the count is split in two passes, summed:
 *
 *   - main pass, every row: id OR the scalar key column (hostEntityKey /
 *     k8sClusterEntityKey) — or `hasAny(entityKeys)` for types without one.
 *     ~2x the old count.
 *   - legacy pass, only rows that predate the scalar key columns
 *     (`serviceEntityKey = ''`, which ClickHouse moves to PREWHERE): rows the
 *     main pass missed that the full selection predicate matches. Near free
 *     once those rows age out of retention.
 *
 * `NOT main AND full` keeps the passes disjoint, so no row counts twice, and
 * the sum equals `countIf(full)` — the selection predicate — as long as
 * ingest stamps the scalar column and `entityKeys` from the same resolver.
 *
 * `appendFromWhere` appends ` FROM <table> WHERE <project/time/retention/
 * common filters>`; the caller appends the query settings after.
 */
export function buildResourceFacetCountStatement(data: {
  ids: Array<string>;
  scopes: Map<string, ResourceEntityScope>;
  appendFromWhere: (statement: Statement) => void;
}): Statement {
  const { ids, scopes, appendFromWhere } = data;
  const statement: Statement = new Statement();

  const needsLegacyPass: boolean = ids.some((id: string): boolean => {
    return legacyPredicate(scopes.get(id)) !== null;
  });

  if (!needsLegacyPass) {
    appendCountColumns(
      statement,
      ids,
      scopes,
      (scope?: ResourceEntityScope) => {
        return renderResourceScope(scope);
      },
    );
    appendFromWhere(statement);
    return statement;
  }

  statement.append(
    `SELECT ${ids
      .map((_id: string, index: number): string => {
        return `sum(cnt_${index}) AS cnt_${index}`;
      })
      .join(", ")} FROM (`,
  );
  appendCountColumns(statement, ids, scopes, (scope?: ResourceEntityScope) => {
    return renderResourceScope(scope, { keyedOnly: true });
  });
  appendFromWhere(statement);
  statement.append(" UNION ALL ");
  appendCountColumns(statement, ids, scopes, legacyPredicate);
  appendFromWhere(statement);
  statement.append(SQL` AND serviceEntityKey = ''`);
  statement.append(")");
  return statement;
}

/*
 * `NOT main AND full`, or null when the main pass already IS the full
 * predicate (no key, or a key with neither scalar column nor attribute).
 */
function legacyPredicate(scope?: ResourceEntityScope): Statement | null {
  const main: Statement | null = renderResourceScope(scope, {
    keyedOnly: true,
  });
  const full: Statement | null = renderResourceScope(scope);

  if (!main || !full || main.query === full.query) {
    return null;
  }

  return new Statement()
    .append("(NOT ")
    .append(main)
    .append(" AND ")
    .append(full)
    .append(")");
}

function appendCountColumns(
  statement: Statement,
  ids: Array<string>,
  scopes: Map<string, ResourceEntityScope>,
  predicateFor: (scope?: ResourceEntityScope) => Statement | null,
): void {
  statement.append("SELECT ");

  ids.forEach((id: string, index: number) => {
    if (index > 0) {
      statement.append(", ");
    }

    const predicate: Statement | null = predicateFor(scopes.get(id));

    statement.append("countIf(");
    if (predicate) {
      statement.append(predicate);
    } else {
      /*
       * An id with no usable branch cannot match anything; `countIf(0)`
       * counts nothing, which keeps the column count equal to the id count so
       * the caller can map columns back by position.
       */
      statement.append("0");
    }
    statement.append(`) AS cnt_${index}`);
  });
}

/**
 * Read one row of `cnt_0..cnt_n` back into `{value, count}` pairs, in the
 * order the ids were passed. Missing or unparseable columns read as 0 — a
 * partially-written row must not shift the mapping onto another resource.
 */
export function readResourceFacetCounts(
  row: JSONObject | undefined,
  ids: Array<string>,
): Array<{ value: string; count: number }> {
  return ids.map((id: string, index: number) => {
    const raw: unknown = row ? row[`cnt_${index}`] : 0;
    const count: number = Number(raw);
    return {
      value: id,
      count: Number.isFinite(count) ? count : 0,
    };
  });
}
