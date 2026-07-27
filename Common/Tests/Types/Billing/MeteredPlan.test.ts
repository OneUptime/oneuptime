import MeteredPlan from "../../../Types/Billing/MeteredPlan";

describe("MeteredPlan", () => {
  test("exposes the values passed to the constructor", () => {
    const plan: MeteredPlan = new MeteredPlan({
      priceId: "price_active_monitors",
      pricePerUnitInUSD: 1.5,
      unitName: "Active Monitor",
    });

    expect(plan.getPriceId()).toBe("price_active_monitors");
    expect(plan.getPricePerUnit()).toBe(1.5);
    expect(plan.getUnitName()).toBe("Active Monitor");
  });

  test("supports a zero price per unit", () => {
    const plan: MeteredPlan = new MeteredPlan({
      priceId: "price_free",
      pricePerUnitInUSD: 0,
      unitName: "Log Ingestion",
    });

    expect(plan.getPricePerUnit()).toBe(0);
  });

  test("keeps each instance's data independent", () => {
    const planA: MeteredPlan = new MeteredPlan({
      priceId: "price_a",
      pricePerUnitInUSD: 2,
      unitName: "Unit A",
    });
    const planB: MeteredPlan = new MeteredPlan({
      priceId: "price_b",
      pricePerUnitInUSD: 7,
      unitName: "Unit B",
    });

    expect(planA.getPriceId()).toBe("price_a");
    expect(planA.getPricePerUnit()).toBe(2);
    expect(planA.getUnitName()).toBe("Unit A");

    expect(planB.getPriceId()).toBe("price_b");
    expect(planB.getPricePerUnit()).toBe(7);
    expect(planB.getUnitName()).toBe("Unit B");
  });
});
