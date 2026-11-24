import {
  CLOUD_PLAN_DAYS_PER_MONTH,
  CLOUD_PLAN_HOURS_PER_MONTH,
  CloudCommitmentPlan,
  getCloudCommitmentBreakEvenMonths,
  getCloudCommitmentBreakEvenUtilization,
  getCloudCommitmentPurchasePlan,
  getCloudCommitmentRenewalPlan,
  readCloudCommitmentRecommendationDetails,
} from "../../../Types/Cloud/CloudCommitmentPlans";
import {
  CloudCommitmentFigures,
  CloudCommitmentPaymentOption,
} from "../../../Types/Cloud/CloudCommitmentInventory";
import { describe, expect, test } from "@jest/globals";

/*
 * Renewal and purchase plans (#11011): what to buy, what it costs and
 * saves a month, when it breaks even, and how coverage changes.
 */

// A Compute Savings Plan: $10 an hour, 70% used, its 30 days' figures.
const FIGURES: CloudCommitmentFigures = {
  days: 30,
  commitmentCost: 7200,
  usedCost: 5040,
  unusedCost: 2160,
  coveredOnDemandCost: 7920,
  netSavings: 720,
  weekCommitmentCost: 1680,
  weekUnusedCost: 504,
};

describe("when a commitment breaks even", () => {
  test("one paid as it runs saves from its first month", () => {
    expect(
      getCloudCommitmentBreakEvenMonths({
        upfrontCost: 0,
        monthlyOnDemandCost: 1000,
        monthlyRecurringCost: 700,
      }),
    ).toBe(0);
  });

  test("one paid up front is made back by what it saves in cash each month", () => {
    // $8,400 up front against $1,000 a month on demand: 8.4 months.
    expect(
      getCloudCommitmentBreakEvenMonths({
        upfrontCost: 8400,
        monthlyOnDemandCost: 1000,
        monthlyRecurringCost: 0,
      }),
    ).toBe(8.4);
    // Partial: $4,200 up front, $350 a month after.
    expect(
      getCloudCommitmentBreakEvenMonths({
        upfrontCost: 4200,
        monthlyOnDemandCost: 1000,
        monthlyRecurringCost: 350,
      }),
    ).toBe(6.5);
  });

  test("one whose fee is more than the usage it covers costs never pays back", () => {
    expect(
      getCloudCommitmentBreakEvenMonths({
        upfrontCost: 100,
        monthlyOnDemandCost: 500,
        monthlyRecurringCost: 600,
      }),
    ).toBeNull();
    expect(
      getCloudCommitmentBreakEvenMonths({
        upfrontCost: 100,
        monthlyOnDemandCost: null,
        monthlyRecurringCost: 0,
      }),
    ).toBeNull();
  });

  test("it pays off above the use at which it costs what on demand would", () => {
    expect(
      getCloudCommitmentBreakEvenUtilization({
        monthlyCost: 700,
        monthlyOnDemandCost: 1000,
      }),
    ).toBe(70);
    expect(
      getCloudCommitmentBreakEvenUtilization({
        monthlyCost: 1200,
        monthlyOnDemandCost: 1000,
      }),
    ).toBe(100);
    expect(
      getCloudCommitmentBreakEvenUtilization({
        monthlyCost: null,
        monthlyOnDemandCost: 1000,
      }),
    ).toBeNull();
  });
});

describe("a renewal plan", () => {
  test("renews a Savings Plan at what it used, with what that saves and when it breaks even", () => {
    const plan: CloudCommitmentPlan | null = getCloudCommitmentRenewalPlan({
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.NoUpfront,
      hourlyCommitment: 10,
      quantity: null,
      upfrontCost: 0,
      utilizationPercent: 70,
      figures: FIGURES,
      currency: "USD",
      coverage: { coveredSpend: 7920, onDemandSpend: 2080 },
    });

    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe("renewal");
    // $7 an hour: 70% of $10.
    expect(plan!.hourlyCommitment).toBe(7);
    const month: number = CLOUD_PLAN_DAYS_PER_MONTH / 30;
    expect(plan!.monthlyCost).toBeCloseTo(7200 * 0.7 * month, 1);
    expect(plan!.monthlyOnDemandCost).toBeCloseTo(7920 * month, 1);
    expect(plan!.monthlySavings).toBeCloseTo((7920 - 5040) * month, 1);
    expect(plan!.breakEvenMonths).toBe(0);
    expect(plan!.breakEvenUtilizationPercent).toBeCloseTo(
      (5040 / 7920) * 100,
      1,
    );
    // If it lapses: its covered spend goes back on demand.
    expect(plan!.coverageNowPercent).toBeCloseTo(79.2, 1);
    expect(plan!.coverageAfterPercent).toBe(0);
  });

  test("an all-upfront plan breaks even in the months its upfront takes", () => {
    const plan: CloudCommitmentPlan | null = getCloudCommitmentRenewalPlan({
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      hourlyCommitment: 10,
      quantity: null,
      upfrontCost: 87600,
      utilizationPercent: 100,
      figures: { ...FIGURES, usedCost: 7200, unusedCost: 0 },
      currency: "USD",
    });

    expect(plan!.hourlyCommitment).toBe(10);
    expect(plan!.upfrontCost).toBe(87600);
    // Cash saved each month: the on-demand price, as nothing is paid monthly.
    expect(plan!.breakEvenMonths).toBeCloseTo(
      87600 / (7920 * (CLOUD_PLAN_DAYS_PER_MONTH / 30)),
      1,
    );
    expect(plan!.coverageNowPercent).toBeNull();
  });

  test("a reservation renews the instances it used", () => {
    const plan: CloudCommitmentPlan | null = getCloudCommitmentRenewalPlan({
      termMonths: 36,
      paymentOption: CloudCommitmentPaymentOption.PartialUpfront,
      hourlyCommitment: null,
      quantity: 10,
      upfrontCost: 30000,
      utilizationPercent: 60,
      figures: FIGURES,
      currency: "USD",
    });

    expect(plan!.quantity).toBe(6);
    expect(plan!.hourlyCommitment).toBeNull();
    expect(plan!.upfrontCost).toBe(18000);
    expect(plan!.termMonths).toBe(36);
  });

  test("a commitment its cloud says too little of has no plan", () => {
    const base: Parameters<typeof getCloudCommitmentRenewalPlan>[0] = {
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.NoUpfront,
      hourlyCommitment: 5,
      quantity: null,
      upfrontCost: null,
      utilizationPercent: 50,
      figures: FIGURES,
      currency: "USD",
    };

    expect(getCloudCommitmentRenewalPlan({ ...base, figures: null })).toBeNull();
    expect(
      getCloudCommitmentRenewalPlan({
        ...base,
        figures: { ...FIGURES, coveredOnDemandCost: null },
      }),
    ).toBeNull();
    expect(
      getCloudCommitmentRenewalPlan({ ...base, utilizationPercent: 0 }),
    ).toBeNull();
  });

  test("with no utilization of its own, the used share of its cost stands in", () => {
    const plan: CloudCommitmentPlan | null = getCloudCommitmentRenewalPlan({
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.NoUpfront,
      hourlyCommitment: 10,
      quantity: null,
      upfrontCost: 0,
      utilizationPercent: null,
      figures: FIGURES,
      currency: "EUR",
    });

    expect(plan!.hourlyCommitment).toBe(7);
    expect(plan!.currency).toBe("EUR");
  });
});

describe("a purchase plan", () => {
  test("from a recommender's details: its fees, saving, break-even and coverage once bought", () => {
    const plan: CloudCommitmentPlan = getCloudCommitmentPurchasePlan({
      monthlySavings: 300,
      monthlyCost: null,
      details: {
        termMonths: 12,
        paymentOption: CloudCommitmentPaymentOption.AllUpfront,
        hourlyCommitment: 1,
        quantity: null,
        configuration: "Compute Savings Plans",
        upfrontCost: 8766,
        monthlyRecurringCost: 0,
        monthlyCost: 730.5,
      },
      currency: "USD",
      coverage: { coveredSpend: 2000, onDemandSpend: 3000 },
    });

    expect(plan.kind).toBe("purchase");
    expect(plan.monthlyCost).toBe(730.5);
    expect(plan.monthlyOnDemandCost).toBe(1030.5);
    expect(plan.upfrontCost).toBe(8766);
    expect(plan.breakEvenMonths).toBeCloseTo(8766 / 1030.5, 1);
    expect(plan.coverageNowPercent).toBe(40);
    expect(plan.coverageAfterPercent!).toBeGreaterThan(40);
    expect(plan.coverageAfterPercent!).toBeLessThanOrEqual(100);
  });

  test("without a cost of its own, its fees make it, else its hourly commitment does", () => {
    const fromFees: CloudCommitmentPlan = getCloudCommitmentPurchasePlan({
      monthlySavings: 100,
      monthlyCost: null,
      details: {
        termMonths: 12,
        paymentOption: CloudCommitmentPaymentOption.PartialUpfront,
        hourlyCommitment: null,
        quantity: 4,
        configuration: "m5.large",
        upfrontCost: 1200,
        monthlyRecurringCost: 100,
        monthlyCost: null,
      },
      currency: "USD",
    });

    expect(fromFees.monthlyCost).toBe(200);
    expect(fromFees.breakEvenMonths).toBeCloseTo(1200 / (300 - 100), 1);

    const fromHourly: CloudCommitmentPlan = getCloudCommitmentPurchasePlan({
      monthlySavings: 100,
      monthlyCost: null,
      details: {
        termMonths: 36,
        paymentOption: CloudCommitmentPaymentOption.NoUpfront,
        hourlyCommitment: 2,
        quantity: null,
        configuration: "",
        upfrontCost: null,
        monthlyRecurringCost: null,
        monthlyCost: null,
      },
      currency: "USD",
    });

    expect(fromHourly.monthlyCost).toBeCloseTo(2 * CLOUD_PLAN_HOURS_PER_MONTH, 1);
    expect(fromHourly.upfrontCost).toBe(0);
    expect(fromHourly.breakEvenMonths).toBe(0);
  });

  test("with nothing but the recommender's saving and cost", () => {
    const plan: CloudCommitmentPlan = getCloudCommitmentPurchasePlan({
      monthlySavings: 50,
      monthlyCost: 150,
      details: null,
      currency: "USD",
    });

    expect(plan.monthlyCost).toBe(150);
    expect(plan.monthlyOnDemandCost).toBe(200);
    expect(plan.breakEvenUtilizationPercent).toBe(75);
    // No payment option: the upfront is not known, nor so the break-even month.
    expect(plan.breakEvenMonths).toBe(0);
    expect(plan.termMonths).toBeNull();
  });

  test("with nothing at all, it says only what it saves", () => {
    const plan: CloudCommitmentPlan = getCloudCommitmentPurchasePlan({
      monthlySavings: 50,
      monthlyCost: null,
      details: null,
      currency: "USD",
    });

    expect(plan.monthlySavings).toBe(50);
    expect(plan.monthlyCost).toBeNull();
    expect(plan.breakEvenMonths).toBeNull();
  });
});

describe("a recommendation's details as stored", () => {
  test("are read back, the malformed as nothing", () => {
    expect(
      readCloudCommitmentRecommendationDetails({
        termMonths: 12,
        paymentOption: "AllUpfront",
        hourlyCommitment: "1.25",
        quantity: null,
        configuration: "Compute Savings Plans",
        upfrontCost: "x",
        monthlyRecurringCost: 0,
        monthlyCost: 900,
      }),
    ).toEqual({
      termMonths: 12,
      paymentOption: CloudCommitmentPaymentOption.AllUpfront,
      hourlyCommitment: 1.25,
      quantity: null,
      configuration: "Compute Savings Plans",
      upfrontCost: null,
      monthlyRecurringCost: 0,
      monthlyCost: 900,
    });
    expect(readCloudCommitmentRecommendationDetails(null)).toBeNull();
    expect(readCloudCommitmentRecommendationDetails([1])).toBeNull();
  });
});
