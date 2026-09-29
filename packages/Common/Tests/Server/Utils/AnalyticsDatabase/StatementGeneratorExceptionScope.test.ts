import { ClickhouseAppInstance } from "../../../../Server/Infrastructure/ClickhouseDatabase";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import StatementGenerator from "../../../../Server/Utils/AnalyticsDatabase/StatementGenerator";
import "../../TestingUtils/Init";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../../../Types/API/Route";
import AnalyticsTableEngine from "../../../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";
import AnalyticsTableColumn from "../../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../../Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * "exceptionScope" narrows a span query to the spans one exception group's
 * occurrences were raised in. It must only ever narrow: a missing project or
 * a malformed scope has to match nothing, never fall back to every span.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const SERVICE_ID: string = "60000000-0000-4000-8000-000000000001";
const FINGERPRINT: string = "fp-9f86d081884c7d65";

function column(key: string, type: TableColumnType): AnalyticsTableColumn {
  return new AnalyticsTableColumn({
    key,
    title: "<title>",
    description: "<description>",
    required: true,
    type,
  });
}

class SpanLikeModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<span-like-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("projectId", TableColumnType.ObjectID),
        column("traceId", TableColumnType.Text),
        column("spanId", TableColumnType.Text),
        column("name", TableColumnType.Text),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["projectId"],
      sortKeys: ["projectId"],
      partitionKey: "projectId",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

class NoSpanColumnsModel extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "<no-span-table>",
      singularName: "<singular>",
      pluralName: "<plural>",
      tableColumns: [
        column("projectId", TableColumnType.ObjectID),
        column("name", TableColumnType.Text),
      ],
      crudApiPath: new Route("route"),
      primaryKeys: ["projectId"],
      sortKeys: ["projectId"],
      partitionKey: "projectId",
      tableEngine: AnalyticsTableEngine.MergeTree,
    });
  }
}

describe("StatementGenerator exceptionScope synthetic key", () => {
  const spanGenerator: StatementGenerator<SpanLikeModel> =
    new StatementGenerator<SpanLikeModel>({
      modelType: SpanLikeModel,
      database: ClickhouseAppInstance,
    });

  const where: (query: Record<string, unknown>) => Statement = (
    query: Record<string, unknown>,
  ): Statement => {
    return spanGenerator.toWhereStatement(query as any);
  };

  const subqueryParams: (statement: Statement) => Array<unknown> = (
    statement: Statement,
  ): Array<unknown> => {
    return Object.values(statement.query_params).map((value: unknown) => {
      return value instanceof ObjectID ? value.toString() : value;
    });
  };

  test("compiles to a (traceId, spanId) GLOBAL IN subquery pinned to the project", () => {
    const statement: Statement = where({
      exceptionScope: { fingerprint: FINGERPRINT },
      projectId: new ObjectID(PROJECT_ID),
    });

    expect(statement.query).toContain(
      "AND ({p0:Identifier}, {p1:Identifier}) GLOBAL IN (SELECT traceId, spanId FROM {p2:Identifier} WHERE projectId = {p3:String} AND fingerprint = {p4:String})",
    );
    expect(subqueryParams(statement).slice(0, 5)).toEqual([
      "traceId",
      "spanId",
      AnalyticsTableName.ExceptionInstance,
      PROJECT_ID,
      FINGERPRINT,
    ]);
  });

  test("never emits a plain IN, which multi-shard clusters reject", () => {
    const statement: Statement = where({
      exceptionScope: { fingerprint: FINGERPRINT, primaryEntityId: SERVICE_ID },
      projectId: PROJECT_ID,
    });

    expect(statement.query).toMatch(/\) GLOBAL IN \(SELECT/);
    expect(statement.query).not.toMatch(/\) IN \(SELECT/);
  });

  test("adds the exception's service when the scope names one", () => {
    const statement: Statement = where({
      projectId: PROJECT_ID,
      exceptionScope: { fingerprint: FINGERPRINT, primaryEntityId: SERVICE_ID },
    });

    expect(statement.query.replace(/\s+/g, " ")).toMatch(
      /AND fingerprint = \{p\d+:String\} AND primaryEntityId = \{p\d+:String\}\)$/,
    );
    expect(subqueryParams(statement)).toContain(SERVICE_ID);
  });

  test("reads the project id whether it is an ObjectID or a string", () => {
    for (const projectId of [new ObjectID(PROJECT_ID), PROJECT_ID]) {
      const statement: Statement = where({
        projectId,
        exceptionScope: { fingerprint: FINGERPRINT },
      });

      expect(subqueryParams(statement)).toContain(PROJECT_ID);
      expect(statement.query).not.toContain("AND 0");
    }
  });

  test("composes with the other predicates, in either key order", () => {
    const statement: Statement = where({
      name: "POST /api/checkout",
      exceptionScope: { fingerprint: FINGERPRINT },
      projectId: PROJECT_ID,
    });
    const query: string = statement.query.replace(/\s+/g, " ");

    expect(query.startsWith("AND {p0:Identifier} = {p1:String} AND (")).toBe(
      true,
    );
    expect(query).toContain(") GLOBAL IN (SELECT traceId, spanId FROM");
    expect(query).toMatch(/AND \{p\d+:Identifier\} = \{p\d+:String\}$/);
  });

  test("matches nothing without a project, rather than every span", () => {
    const statement: Statement = where({
      exceptionScope: { fingerprint: FINGERPRINT },
    });

    expect(statement.query).toBe("AND 0");
    expect(statement.query_params).toStrictEqual({});
  });

  test.each([
    ["a blank fingerprint", { fingerprint: "  " }],
    ["a non-object scope", "fp"],
    ["a non-UUID service", { fingerprint: FINGERPRINT, primaryEntityId: "x" }],
  ])("matches nothing for %s", (_name: string, scope: unknown) => {
    const statement: Statement = where({
      projectId: PROJECT_ID,
      exceptionScope: scope,
    });

    expect(statement.query).toContain("AND 0");
    expect(statement.query).not.toContain("IN (SELECT");
  });

  test("keeps separators intact when it is not the first predicate", () => {
    const statement: Statement = where({
      projectId: PROJECT_ID,
      exceptionScope: { fingerprint: "  " },
      name: "x",
    });

    expect(statement.query.replace(/\s+/g, " ")).toMatch(
      /^AND \{p0:Identifier\} = \{p1:String\} AND 0 AND \{p2:Identifier\} = \{p3:String\}$/,
    );
  });

  test("is ignored for models without traceId and spanId columns", () => {
    const generator: StatementGenerator<NoSpanColumnsModel> =
      new StatementGenerator<NoSpanColumnsModel>({
        modelType: NoSpanColumnsModel,
        database: ClickhouseAppInstance,
      });

    const statement: Statement = generator.toWhereStatement({
      exceptionScope: { fingerprint: FINGERPRINT },
    } as any);

    expect(statement.query).toBe("");
  });

  test("qualifies the outer columns when a table alias is used", () => {
    const statement: Statement = spanGenerator.toWhereStatement(
      {
        projectId: PROJECT_ID,
        exceptionScope: { fingerprint: FINGERPRINT },
      } as any,
      { tableAlias: "s" },
    );

    expect(statement.query).toContain(
      "({p2_t:Identifier}.{p2_c:Identifier}, {p3_t:Identifier}.{p3_c:Identifier}) GLOBAL IN (SELECT traceId, spanId FROM",
    );
  });
});
