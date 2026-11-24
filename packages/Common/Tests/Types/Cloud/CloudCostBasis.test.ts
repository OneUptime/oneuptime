import {
  CLOUD_COST_BASES,
  CLOUD_COST_BASIS_COLUMNS,
  CLOUD_COST_BASIS_DESCRIPTIONS,
  CLOUD_COST_BASIS_LABELS,
  CLOUD_COST_DEFAULT_BASIS,
  CloudCostBasis,
  getCloudCostBasisColumn,
  isCloudCostBasis,
  readCloudCostBases,
  resolveCloudCostBasis,
} from "../../../Types/Cloud/CloudCostBasis";
import CloudCost from "../../../Models/AnalyticsModels/CloudCost";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import { describe, expect, test } from "@jest/globals";

/*
 * Billed, amortized and net (#11007): which cost a figure is, the column it
 * is read from, and which of a person's, a budget's and a project's picks
 * holds.
 */

describe("the three bases", () => {
  test("are billed, amortized and net, in the order the switch offers them", () => {
    expect(CLOUD_COST_BASES).toEqual([
      CloudCostBasis.Billed,
      CloudCostBasis.Amortized,
      CloudCostBasis.Net,
    ]);
  });

  test("amortized is the default: a commitment bought up front does not make a month spike", () => {
    expect(CLOUD_COST_DEFAULT_BASIS).toBe(CloudCostBasis.Amortized);
  });

  test("each is read from its own column of the costs", () => {
    expect(CLOUD_COST_BASIS_COLUMNS).toEqual({
      billed: "cost",
      amortized: "amortizedCost",
      net: "netCost",
    });

    const model: CloudCost = new CloudCost();

    for (const basis of CLOUD_COST_BASES) {
      const column: AnalyticsTableColumn | null = model.getTableColumn(
        getCloudCostBasisColumn(basis),
      );
      expect(column).not.toBeNull();
    }
  });

  test("anything that is not a basis reads the billed column, as every read did before", () => {
    expect(getCloudCostBasisColumn(undefined)).toBe("cost");
    expect(getCloudCostBasisColumn(null)).toBe("cost");
    expect(getCloudCostBasisColumn("AMORTIZED")).toBe("cost");
    expect(getCloudCostBasisColumn("netCost")).toBe("cost");
    expect(getCloudCostBasisColumn(42)).toBe("cost");
    expect(getCloudCostBasisColumn(CloudCostBasis.Net)).toBe("netCost");
  });

  test("each has a label and a sentence a person reads", () => {
    for (const basis of CLOUD_COST_BASES) {
      expect(CLOUD_COST_BASIS_LABELS[basis].length).toBeGreaterThan(0);
      expect(CLOUD_COST_BASIS_DESCRIPTIONS[basis]).toMatch(/\.$/);
    }

    expect(CLOUD_COST_BASIS_LABELS[CloudCostBasis.Billed]).toBe("Billed");
    expect(CLOUD_COST_BASIS_LABELS[CloudCostBasis.Amortized]).toBe(
      "Amortized",
    );
    expect(CLOUD_COST_BASIS_LABELS[CloudCostBasis.Net]).toBe("Net");
    expect(CLOUD_COST_BASIS_DESCRIPTIONS[CloudCostBasis.Net]).toContain(
      "credits",
    );
  });
});

describe("a basis as stored", () => {
  test("only the three words are bases", () => {
    expect(isCloudCostBasis("billed")).toBe(true);
    expect(isCloudCostBasis("amortized")).toBe(true);
    expect(isCloudCostBasis("net")).toBe(true);
    expect(isCloudCostBasis("Billed")).toBe(false);
    expect(isCloudCostBasis("")).toBe(false);
    expect(isCloudCostBasis(undefined)).toBe(false);
    expect(isCloudCostBasis(null)).toBe(false);
    expect(isCloudCostBasis({ basis: "net" })).toBe(false);
  });
});

describe("which pick holds", () => {
  test("the first that is a basis: a person's, then a budget's, then the project's", () => {
    expect(
      resolveCloudCostBasis(
        CloudCostBasis.Net,
        CloudCostBasis.Billed,
        CloudCostBasis.Amortized,
      ),
    ).toBe(CloudCostBasis.Net);
    expect(
      resolveCloudCostBasis(null, CloudCostBasis.Billed, CloudCostBasis.Net),
    ).toBe(CloudCostBasis.Billed);
    expect(resolveCloudCostBasis(undefined, "", CloudCostBasis.Net)).toBe(
      CloudCostBasis.Net,
    );
  });

  test("with no pick at all, the default", () => {
    expect(resolveCloudCostBasis()).toBe(CloudCostBasis.Amortized);
    expect(resolveCloudCostBasis(null, undefined, "nonsense")).toBe(
      CloudCostBasis.Amortized,
    );
  });
});

describe("the bases a read brought", () => {
  test("are read back in the bases' order, the unknown left out", () => {
    expect(readCloudCostBases(["net", "amortized"])).toEqual([
      CloudCostBasis.Amortized,
      CloudCostBasis.Net,
    ]);
    expect(readCloudCostBases(["net", "gross", 3])).toEqual([
      CloudCostBasis.Net,
    ]);
  });

  test("none, or none that is a basis, means every basis", () => {
    expect(readCloudCostBases(undefined)).toBeUndefined();
    expect(readCloudCostBases([])).toBeUndefined();
    expect(readCloudCostBases(["gross"])).toBeUndefined();
    expect(readCloudCostBases("amortized")).toBeUndefined();
  });
});

describe("the cost table's columns", () => {
  test("amortizedCost and netCost read a row's billed cost until it is read again", () => {
    const model: CloudCost = new CloudCost();

    for (const key of ["amortizedCost", "netCost"]) {
      const column: AnalyticsTableColumn | null = model.getTableColumn(key);
      expect(column).not.toBeNull();
      expect(column!.defaultExpression).toBe("cost");
      expect(column!.required).toBe(true);
    }

    // Billed keeps its own column, with no default: every row writes it.
    expect(model.getTableColumn("cost")!.defaultExpression).toBeUndefined();
  });

  test("the sort key is unchanged: no column of the bases is in it", () => {
    const model: CloudCost = new CloudCost();
    expect(model.sortKeys).toEqual([
      "projectId",
      "cloudAccountId",
      "day",
      "service",
    ]);
  });
});
