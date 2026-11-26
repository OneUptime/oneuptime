import {
  CloudCostAllocationSqlContext,
  amountsStatement,
  emptyCloudCostQueryFacts,
  sourceStatement,
  spendColumnOf,
  topStatement,
  topTagValuesStatement,
  wouldMatchStatement,
} from "../../../../Server/Utils/CloudCost/CloudCostAllocationQuery";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { CloudCostBasis } from "../../../../Types/Cloud/CloudCostBasis";
import {
  CloudCostRuleField,
  makeCloudCostRule,
} from "../../../../Types/Cloud/CloudCostRules";
import { describe, expect, test } from "@jest/globals";

/*
 * A COST VIEW'S SUMS ARE ON ONE COST BASIS (#11007).
 *
 * Every statement a view's allocation runs sums `spend`, the cost on the
 * read's basis, which its source statement takes from one of three
 * columns: billed (cost), amortized (amortizedCost) or net (netCost). The
 * column is picked from a fixed list, never from the caller's text, and a
 * read with no basis sums the billed cost, as the reads did before. The
 * sums themselves run on a real ClickHouse in
 * App/Tests/BaseAPI/CloudCostAllocationClickhouse.test.ts.
 */

function context(
  basis?: CloudCostBasis | undefined,
): CloudCostAllocationSqlContext {
  return {
    databaseName: "oneuptime",
    tableName: "CloudCostV1",
    where: new Statement(),
    groups: [
      {
        rules: [
          makeCloudCostRule({
            field: CloudCostRuleField.Tag,
            key: "team",
            value: "payments",
          }),
        ],
      },
    ],
    facts: emptyCloudCostQueryFacts(),
    basis,
  };
}

describe("the column a read sums", () => {
  test.each([
    [CloudCostBasis.Billed, "cost"],
    [CloudCostBasis.Amortized, "amortizedCost"],
    [CloudCostBasis.Net, "netCost"],
  ])("%s reads %s", (basis: CloudCostBasis, column: string) => {
    expect(spendColumnOf({ basis })).toBe(column);
    expect(sourceStatement(context(basis)).query).toContain(
      `SELECT day, ${column} AS spend,`,
    );
  });

  test("no basis, or one that is not, reads the billed cost", () => {
    expect(spendColumnOf({})).toBe("cost");
    expect(spendColumnOf({ basis: "amortizedCost; DROP" as never })).toBe(
      "cost",
    );
    expect(sourceStatement(context()).query).toContain(
      "SELECT day, cost AS spend,",
    );
  });
});

describe("every sum is of the read's spend", () => {
  test.each([
    CloudCostBasis.Billed,
    CloudCostBasis.Amortized,
    CloudCostBasis.Net,
  ])("on %s, no statement sums another column", (basis: CloudCostBasis) => {
    const ctx: CloudCostAllocationSqlContext = context(basis);
    const statements: Array<string> = [
      amountsStatement(ctx, { byMonth: false }).query,
      amountsStatement(ctx, { byMonth: true }).query,
      wouldMatchStatement(ctx, {}).query,
      topStatement(ctx, {
        groupNumber: 0,
        dimension: "service",
        limit: 10,
      }).query,
      topTagValuesStatement(ctx, { groupNumber: 0, limit: 10 }).query,
    ];

    for (const query of statements) {
      expect(query).toContain("spend * weight");
      expect(query).not.toMatch(/\bcost \* weight/);
      expect(query).toContain(`SELECT day, ${spendColumnOf(ctx)} AS spend,`);
    }

    expect(statements[0]).toContain("sum(spend * weight) AS amount");
    expect(statements[2]).toContain("sumIf(spend * weight, ");
  });

  test("a partition of the resources keeps the read's basis", () => {
    const ctx: CloudCostAllocationSqlContext = context(CloudCostBasis.Net);
    const partitioned: CloudCostAllocationSqlContext = {
      ...ctx,
      facts: { ...ctx.facts, resourceHashes: ["0A"], resourceClasses: [1] },
    };

    expect(sourceStatement(partitioned).query).toContain(
      "SELECT day, netCost AS spend,",
    );
  });
});
