import { describe, expect, test } from "@jest/globals";
import {
  DataAssetColumn,
  DataAssetColumnChangeKind,
} from "../../../../Types/DataObservability/DataAssetColumn";
import { ProductionReviewDataStagingJSON } from "../../../../Types/CodeRepository/ProductionReview";
import { describeStagingMarkdown } from "../../../../Server/Utils/CodeRepository/ProductionReview/ProductionReviewComposer";
import {
  compareColumns,
  describeColumnDifference,
} from "../../../../Server/Utils/DataObservability/StagingTableComparison";

/*
 * How a table's copy on staging differs from production, for the review of a
 * pull request that changes it.
 */

function column(name: string, dataType: string): DataAssetColumn {
  return { name, dataType, isNullable: true, position: 1 };
}

describe("how a column differs on staging", () => {
  test("each way, in words", () => {
    expect(
      describeColumnDifference({
        kind: DataAssetColumnChangeKind.Added,
        column: "total",
        position: 1,
      }),
    ).toBe("total is only on staging");
    expect(
      describeColumnDifference({
        kind: DataAssetColumnChangeKind.Removed,
        column: "total",
        position: 1,
      }),
    ).toBe("total is only in production");
    expect(
      describeColumnDifference({
        kind: DataAssetColumnChangeKind.TypeChanged,
        column: "total",
        position: 1,
        dataType: "text",
        previousDataType: "numeric",
      }),
    ).toBe("total is text on staging, numeric in production");
    expect(
      describeColumnDifference({
        kind: DataAssetColumnChangeKind.NullabilityChanged,
        column: "total",
        position: 1,
      }),
    ).toBe("total allows empty values differently on staging");
  });

  test("the same columns have no differences", () => {
    expect(compareColumns([column("a", "int")], [column("a", "int")])).toEqual(
      [],
    );
  });

  test("production is what staging is compared with", () => {
    expect(
      compareColumns(
        [column("a", "int")],
        [column("a", "text"), column("zzz", "int")],
      ),
    ).toEqual([
      "zzz is only on staging",
      "a is text on staging, int in production",
    ]);
  });
});

describe("what the review says of it", () => {
  const STAGING: ProductionReviewDataStagingJSON = {
    storeName: "orders-staging",
    productionRows: 100,
    stagingRows: 10,
    columnDifferences: ["total is only on staging"],
    areChecksRun: true,
    checks: [{ name: "Totals", production: 0, staging: 3 }],
  };

  test("rows, columns and checks", () => {
    const text: string = describeStagingMarkdown(STAGING).toString();

    expect(text).toContain("orders-staging");
    expect(text).toContain("10 rows there, 100 in production");
    expect(text).toContain("total is only on staging");
    expect(text).toContain("**Totals** reads 3 there, 0 in production");
  });

  test("a check that could not run says why", () => {
    expect(
      describeStagingMarkdown({
        ...STAGING,
        checks: [
          {
            name: "Totals",
            production: 0,
            staging: null,
            error: "no such column",
          },
        ],
      }).toString(),
    ).toContain("could not run there: no such column");
  });

  test("a store only a probe reaches says its checks were not run", () => {
    expect(
      describeStagingMarkdown({
        ...STAGING,
        checks: [],
        areChecksRun: false,
      }).toString(),
    ).toContain("its checks were not run");
  });

  test("nothing different says so", () => {
    expect(
      describeStagingMarkdown({
        storeName: "s",
        productionRows: null,
        stagingRows: null,
        columnDifferences: [],
        areChecksRun: true,
        checks: [],
      }).toString(),
    ).toContain("it looks the same");
  });
});
