import Pricing, {
  PricingCategory,
  PricingFeature,
  PricingPlan,
  PricingPlans,
} from "../Utils/Pricing";

/*
 * The pricing matrix is the single source for the /pricing page and every
 * machine-readable pricing surface (/data/pricing.json, /pricing.md,
 * /llms-full.txt). A feature whose per-plan cells reference a mistyped or
 * missing plan key renders a column that is silently blank for buyers and for
 * the LLM catalogue, so these tests pin the structural contract between the
 * plan list and the feature matrix rather than any specific price.
 */

const planKeys: Array<string> = PricingPlans.map((plan: PricingPlan): string => {
  return plan.key;
});
const planKeySet: Set<string> = new Set(planKeys);

describe("PricingPlans", () => {
  test("there is at least one plan", () => {
    expect(PricingPlans.length).toBeGreaterThan(0);
  });

  test("the four public plans are present in order", () => {
    expect(planKeys).toEqual(["free", "growth", "scale", "enterprise"]);
  });

  test("plan keys are unique", () => {
    expect(planKeySet.size).toBe(planKeys.length);
  });

  test.each(PricingPlans)("plan %# has every required field", (plan: PricingPlan) => {
    for (const field of [
      "key",
      "name",
      "monthlyPricePerUser",
      "yearlyMonthlyPricePerUser",
      "description",
    ] as Array<keyof PricingPlan>) {
      expect(typeof plan[field]).toBe("string");
      expect(plan[field].trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Pricing feature matrix", () => {
  test("there is at least one category", () => {
    expect(Pricing.length).toBeGreaterThan(0);
  });

  test("every category has a name and at least one feature", () => {
    for (const category of Pricing as Array<PricingCategory>) {
      expect(category.name.trim().length).toBeGreaterThan(0);
      expect(category.data.length).toBeGreaterThan(0);
    }
  });

  test("every feature covers exactly the known plans — no missing or stray columns", () => {
    for (const category of Pricing as Array<PricingCategory>) {
      for (const feature of category.data as Array<PricingFeature>) {
        expect(feature.name.trim().length).toBeGreaterThan(0);

        const featurePlanKeys: Array<string> = Object.keys(feature.plans);

        // Every plan column that exists must reference a real plan key. A typo
        // like "grwoth" would otherwise render as an orphaned, invisible cell.
        for (const key of featurePlanKeys) {
          expect(planKeySet.has(key)).toBe(true);
        }

        // And every plan must have a cell for this feature, so no plan column
        // is silently blank in the rendered matrix.
        for (const key of planKeys) {
          expect(
            Object.prototype.hasOwnProperty.call(feature.plans, key),
          ).toBe(true);
        }
      }
    }
  });

  test("every plan cell is a string or a boolean", () => {
    for (const category of Pricing as Array<PricingCategory>) {
      for (const feature of category.data as Array<PricingFeature>) {
        for (const value of Object.values(feature.plans)) {
          expect(["string", "boolean"]).toContain(typeof value);
          if (typeof value === "string") {
            // An empty string renders as a blank cell rather than an explicit
            // "not included" — the data uses `false` for that instead.
            expect(value.trim().length).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  test("feature names are unique within a category", () => {
    for (const category of Pricing as Array<PricingCategory>) {
      const names: Array<string> = category.data.map(
        (feature: PricingFeature): string => {
          return feature.name;
        },
      );
      expect(new Set(names).size).toBe(names.length);
    }
  });
});
