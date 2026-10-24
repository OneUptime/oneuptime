import { describe, expect, it } from "@jest/globals";
import {
  SESSION_REPLAY_PRICE_IN_USD_PER_GB,
  TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
  TELEMETRY_PRICE_IN_USD_PER_GB,
  TELEMETRY_PRICE_RETENTION_IN_DAYS,
} from "../../../../Types/Billing/PayAsYouGoPricing";
import AllMeteredPlans, {
  LogDataIngestMeteredPlan,
  MeteredPlanUtil,
  MetricsDataIngestMeteredPlan,
  ProfilesDataIngestMeteredPlan,
  SecurityEventsDataIngestMeteredPlan,
  SessionReplayDataIngestMeteredPlan,
  TracesDataIngestMetredPlan,
} from "../../../../Server/Types/Billing/MeteredPlan/AllMeteredPlans";
import ServerMeteredPlan from "../../../../Server/Types/Billing/MeteredPlan/ServerMeteredPlan";
import TelemetryMeteredPlan from "../../../../Server/Types/Billing/MeteredPlan/TelemetryMeteredPlan";
import ProductType from "../../../../Types/MeteredPlan/ProductType";

/*
 * Telemetry is billed per GB per day it is kept, but ingesting a GB costs
 * the same however soon it is deleted. Before the minimum, a project that
 * kept its logs for a day paid 1/15 of the advertised $0.10 per GB - less
 * than the GB costs to ingest. Logs, metrics, traces, profiles and security
 * events are now billed for at least 7 days; session replay, at twenty
 * times their rate, is still billed for exactly the days it is kept.
 */

const TELEMETRY_UNIT_COST_IN_USD: number =
  TELEMETRY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;
const SESSION_REPLAY_UNIT_COST_IN_USD: number =
  SESSION_REPLAY_PRICE_IN_USD_PER_GB / TELEMETRY_PRICE_RETENTION_IN_DAYS;

interface FlooredPlan {
  name: string;
  productType: ProductType;
  plan: TelemetryMeteredPlan;
}

const FLOORED_PLANS: Array<FlooredPlan> = [
  {
    name: "logs",
    productType: ProductType.Logs,
    plan: LogDataIngestMeteredPlan,
  },
  {
    name: "metrics",
    productType: ProductType.Metrics,
    plan: MetricsDataIngestMeteredPlan,
  },
  {
    name: "traces",
    productType: ProductType.Traces,
    plan: TracesDataIngestMetredPlan,
  },
  {
    name: "profiles",
    productType: ProductType.Profiles,
    plan: ProfilesDataIngestMeteredPlan,
  },
  {
    name: "security events",
    productType: ProductType.SecurityEvents,
    plan: SecurityEventsDataIngestMeteredPlan,
  },
];

// What the billing formula charges: GB x billed days x the per-GB-day rate.
function expectedTelemetryCost(gigabytes: number, days: number): number {
  return (
    gigabytes *
    Math.max(days, TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS) *
    TELEMETRY_UNIT_COST_IN_USD
  );
}

describe("The minimum billable telemetry retention", () => {
  it("is 7 days, under the 15 days the advertised price is quoted for", () => {
    expect(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS).toBe(7);
    expect(TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS).toBeLessThan(
      TELEMETRY_PRICE_RETENTION_IN_DAYS,
    );
  });

  it.each(FLOORED_PLANS)(
    "$name is billed for at least 7 days",
    ({ plan }: FlooredPlan) => {
      expect(plan.minimumBillableRetentionInDays).toBe(
        TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
      );
    },
  );

  it.each(FLOORED_PLANS)(
    "$name: the plan billing looks up for the product type is the floored one",
    ({ productType, plan }: FlooredPlan) => {
      const found: TelemetryMeteredPlan =
        MeteredPlanUtil.getMeteredPlanByProductType(
          productType,
        ) as TelemetryMeteredPlan;

      expect(found).toBe(plan);
      expect(found.minimumBillableRetentionInDays).toBe(
        TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
      );
    },
  );

  it("session replay has no minimum", () => {
    expect(
      SessionReplayDataIngestMeteredPlan.minimumBillableRetentionInDays,
    ).toBe(0);
    expect(
      (
        MeteredPlanUtil.getMeteredPlanByProductType(
          ProductType.SessionReplay,
        ) as TelemetryMeteredPlan
      ).minimumBillableRetentionInDays,
    ).toBe(0);
  });

  it("every telemetry plan but session replay is floored, so a plan added later is not left out", () => {
    const telemetryPlans: Array<TelemetryMeteredPlan> = AllMeteredPlans.filter(
      (plan: ServerMeteredPlan): plan is TelemetryMeteredPlan => {
        return plan instanceof TelemetryMeteredPlan;
      },
    );

    expect(telemetryPlans).toHaveLength(FLOORED_PLANS.length + 1);

    for (const plan of telemetryPlans) {
      expect({
        productType: plan.getProductType(),
        minimum: plan.minimumBillableRetentionInDays,
      }).toEqual({
        productType: plan.getProductType(),
        minimum:
          plan.getProductType() === ProductType.SessionReplay
            ? 0
            : TELEMETRY_MINIMUM_BILLABLE_RETENTION_IN_DAYS,
      });
    }
  });
});

describe("getBillableRetentionInDays", () => {
  it.each([
    [0, 7],
    [1, 7],
    [2, 7],
    [3, 7],
    [6, 7],
    [6.5, 7],
    [7, 7],
    [7.5, 7.5],
    [8, 8],
    [14, 14],
    [15, 15],
    [30, 30],
    [90, 90],
    [180, 180],
    [3650, 3650],
  ])(
    "telemetry kept %p days is billed for %p",
    (keptDays: number, billedDays: number) => {
      for (const { plan } of FLOORED_PLANS) {
        expect(plan.getBillableRetentionInDays(keptDays)).toBe(billedDays);
      }
    },
  );

  it.each([1, 3, 6, 7, 14, 30, 90])(
    "session replay kept %p days is billed for exactly those days",
    (keptDays: number) => {
      expect(
        SessionReplayDataIngestMeteredPlan.getBillableRetentionInDays(keptDays),
      ).toBe(keptDays);
    },
  );
});

describe("getTotalCostInUSD with the minimum", () => {
  it.each(FLOORED_PLANS)(
    "$name: a GB kept for 1 day costs what a GB kept for 7 days costs",
    ({ plan }: FlooredPlan) => {
      const oneDay: number = plan.getTotalCostInUSD({
        dataIngestedInGB: 1,
        retentionInDays: 1,
      });

      expect(oneDay).toBeCloseTo(
        plan.getTotalCostInUSD({ dataIngestedInGB: 1, retentionInDays: 7 }),
        12,
      );
      expect(oneDay).toBeCloseTo(7 * TELEMETRY_UNIT_COST_IN_USD, 12);
    },
  );

  it.each(FLOORED_PLANS)(
    "$name: a GB kept for 1 day costs 7/15 of the advertised price, not 1/15",
    ({ plan }: FlooredPlan) => {
      expect(
        plan.getTotalCostInUSD({ dataIngestedInGB: 1, retentionInDays: 1 }) /
          TELEMETRY_PRICE_IN_USD_PER_GB,
      ).toBeCloseTo(7 / 15, 12);
    },
  );

  it.each(FLOORED_PLANS)(
    "$name: the advertised $0.10 per GB at 15 days is unchanged",
    ({ plan }: FlooredPlan) => {
      expect(
        plan.getTotalCostInUSD({
          dataIngestedInGB: 1,
          retentionInDays: TELEMETRY_PRICE_RETENTION_IN_DAYS,
        }),
      ).toBeCloseTo(TELEMETRY_PRICE_IN_USD_PER_GB, 12);
    },
  );

  it.each([
    [1, 1, 0.046666666667],
    [1, 6, 0.046666666667],
    [1, 7, 0.046666666667],
    [1, 8, 0.053333333333],
    [1, 15, 0.1],
    [10, 3, 0.466666666667],
    [10, 30, 2],
    [100, 2, 4.666666666667],
    [100, 15, 10],
    [1000, 180, 1200],
    [0.5, 1, 0.023333333333],
  ])(
    "%p GB kept %p days costs $%p",
    (gigabytes: number, days: number, costInUSD: number) => {
      for (const { plan } of FLOORED_PLANS) {
        expect(
          plan.getTotalCostInUSD({
            dataIngestedInGB: gigabytes,
            retentionInDays: days,
          }),
        ).toBeCloseTo(costInUSD, 9);
      }
    },
  );

  it("matches the billing formula for every whole retention from 1 to 180 days", () => {
    for (let days: number = 1; days <= 180; days++) {
      for (const gigabytes of [0.001, 1, 37.5, 1000]) {
        expect({
          days,
          gigabytes,
          cost: LogDataIngestMeteredPlan.getTotalCostInUSD({
            dataIngestedInGB: gigabytes,
            retentionInDays: days,
          }).toFixed(10),
        }).toEqual({
          days,
          gigabytes,
          cost: expectedTelemetryCost(gigabytes, days).toFixed(10),
        });
      }
    }
  });

  it("never costs less for a longer retention", () => {
    let previous: number = 0;

    for (let days: number = 1; days <= 180; days++) {
      const cost: number = MetricsDataIngestMeteredPlan.getTotalCostInUSD({
        dataIngestedInGB: 3,
        retentionInDays: days,
      });

      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
  });

  it("costs the same for every retention up to the minimum, then grows by the day", () => {
    const flat: Array<number> = [1, 2, 3, 4, 5, 6, 7].map(
      (days: number): number => {
        return TracesDataIngestMetredPlan.getTotalCostInUSD({
          dataIngestedInGB: 2,
          retentionInDays: days,
        });
      },
    );

    for (const cost of flat) {
      expect(cost).toBeCloseTo(flat[0] as number, 12);
    }

    expect(
      TracesDataIngestMetredPlan.getTotalCostInUSD({
        dataIngestedInGB: 2,
        retentionInDays: 8,
      }) - (flat[6] as number),
    ).toBeCloseTo(2 * TELEMETRY_UNIT_COST_IN_USD, 12);
  });

  it("adds up across a day's usage, so a row staged in parts bills what it would in one go", () => {
    for (const days of [1, 3, 7, 15]) {
      const inParts: number =
        ProfilesDataIngestMeteredPlan.getTotalCostInUSD({
          dataIngestedInGB: 0.25,
          retentionInDays: days,
        }) +
        ProfilesDataIngestMeteredPlan.getTotalCostInUSD({
          dataIngestedInGB: 1.75,
          retentionInDays: days,
        });

      expect(inParts).toBeCloseTo(
        ProfilesDataIngestMeteredPlan.getTotalCostInUSD({
          dataIngestedInGB: 2,
          retentionInDays: days,
        }),
        12,
      );
    }
  });

  it("charges nothing for no data, however short the retention", () => {
    for (const { plan } of FLOORED_PLANS) {
      expect(
        plan.getTotalCostInUSD({ dataIngestedInGB: 0, retentionInDays: 1 }),
      ).toBe(0);
    }
  });

  it.each([
    [1, 1],
    [3, 3],
    [7, 7],
    [14, 14],
  ])(
    "session replay kept %p days costs %p days of the replay rate",
    (keptDays: number, billedDays: number) => {
      expect(
        SessionReplayDataIngestMeteredPlan.getTotalCostInUSD({
          dataIngestedInGB: 1,
          retentionInDays: keptDays,
        }),
      ).toBeCloseTo(billedDays * SESSION_REPLAY_UNIT_COST_IN_USD, 12);
    },
  );

  it("session replay kept 1 day costs a seventh of 7 days", () => {
    expect(
      SessionReplayDataIngestMeteredPlan.getTotalCostInUSD({
        dataIngestedInGB: 1,
        retentionInDays: 1,
      }) /
        SessionReplayDataIngestMeteredPlan.getTotalCostInUSD({
          dataIngestedInGB: 1,
          retentionInDays: 7,
        }),
    ).toBeCloseTo(1 / 7, 12);
  });
});

describe("TelemetryMeteredPlan", () => {
  it("bills exactly the days kept when it is given no minimum", () => {
    const plan: TelemetryMeteredPlan = new TelemetryMeteredPlan({
      productType: ProductType.Logs,
      unitCostInUSD: 1,
    });

    expect(plan.minimumBillableRetentionInDays).toBe(0);
    expect(plan.getBillableRetentionInDays(1)).toBe(1);
    expect(
      plan.getTotalCostInUSD({ dataIngestedInGB: 2, retentionInDays: 3 }),
    ).toBe(6);
  });

  it("treats an undefined minimum as none", () => {
    const plan: TelemetryMeteredPlan = new TelemetryMeteredPlan({
      productType: ProductType.Logs,
      unitCostInUSD: 1,
      minimumBillableRetentionInDays: undefined,
    });

    expect(plan.minimumBillableRetentionInDays).toBe(0);
    expect(plan.getBillableRetentionInDays(2)).toBe(2);
  });

  it("bills the minimum it is given for a shorter retention", () => {
    const plan: TelemetryMeteredPlan = new TelemetryMeteredPlan({
      productType: ProductType.Metrics,
      unitCostInUSD: 1,
      minimumBillableRetentionInDays: 5,
    });

    expect(plan.getBillableRetentionInDays(2)).toBe(5);
    expect(plan.getBillableRetentionInDays(9)).toBe(9);
    expect(
      plan.getTotalCostInUSD({ dataIngestedInGB: 2, retentionInDays: 2 }),
    ).toBe(10);
  });

  it("follows a minimum changed after it was made", () => {
    const plan: TelemetryMeteredPlan = new TelemetryMeteredPlan({
      productType: ProductType.Traces,
      unitCostInUSD: 1,
    });

    plan.minimumBillableRetentionInDays = 10;

    expect(plan.minimumBillableRetentionInDays).toBe(10);
    expect(
      plan.getTotalCostInUSD({ dataIngestedInGB: 1, retentionInDays: 4 }),
    ).toBe(10);
  });
});
