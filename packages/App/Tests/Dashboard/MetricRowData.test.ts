import { describe, expect, test } from "@jest/globals";
import Service from "Common/Models/DatabaseModels/Service";
import ObjectID from "Common/Types/ObjectID";
import { getVisibleMetricServices } from "../../FeatureSet/Dashboard/src/Components/Metrics/MetricRowData";

const CHECKOUT_SERVICE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PAYMENTS_SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const createService: (id: ObjectID, name: string) => Service = (
  id: ObjectID,
  name: string,
): Service => {
  const service: Service = new Service();
  service.id = id;
  service.name = name;
  return service;
};

const checkoutService: Service = createService(CHECKOUT_SERVICE_ID, "Checkout");
const paymentsService: Service = createService(PAYMENTS_SERVICE_ID, "Payments");

describe("getVisibleMetricServices", () => {
  test("shows every related service in the unscoped metrics explorer", () => {
    expect(
      getVisibleMetricServices({
        services: [checkoutService, paymentsService],
      }),
    ).toEqual([checkoutService, paymentsService]);
  });

  test("shows only the current service in a service-scoped metrics view", () => {
    expect(
      getVisibleMetricServices({
        services: [checkoutService, paymentsService],
        serviceIds: [CHECKOUT_SERVICE_ID],
      }),
    ).toEqual([checkoutService]);
  });

  test("does not show an unrelated service when scoped", () => {
    expect(
      getVisibleMetricServices({
        services: [paymentsService],
        serviceIds: [CHECKOUT_SERVICE_ID],
      }),
    ).toEqual([]);
  });
});
