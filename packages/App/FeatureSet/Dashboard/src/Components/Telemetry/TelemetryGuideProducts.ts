import type { TelemetryType } from "./Documentation";
import { OTEL_SIGNALS } from "./OtelSdkLanguages/Shared";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import ProductKey from "Common/Types/Product/ProductKey";
import { PRODUCT_USAGE_MILESTONES } from "Common/Types/Product/ProductUsage";

/*
 * THE PRODUCTS A TELEMETRY GUIDE SETS UP (#8204).
 *
 * The products menu waits for them once the guide's last step sees the
 * guide's data arrive (ResourceConnectionWatch, `products`): the server
 * keeps a telemetry product's first data a few seconds after the guide sees
 * it sent, and the menu asks until the product is in use, rather than
 * saying "Logs - Not set up" beside a guide that says the logs are in.
 *
 * Each is in use once its first data is kept (PRODUCT_USAGE_MILESTONES),
 * and the map of services is drawn from traces. Pure: the guides and their
 * tests read it.
 */
export const PRODUCTS_SET_UP_BY_TYPE: Readonly<
  Record<TelemetryType, ReadonlyArray<ProductKey>>
> = {
  logs: [ProductKey.Logs],
  metrics: [ProductKey.Metrics],
  traces: [ProductKey.Traces, ProductKey.Topology],
  exceptions: [ProductKey.Exceptions],
  profiles: [ProductKey.Profiles],
};

/*
 * A guide's products: its own, and every signal's for a guide of a whole
 * service (`everySignal`), whose snippets send traces, metrics and logs.
 */
export const getProductsSetUpByGuide: (data: {
  telemetryType: TelemetryType;
  everySignal?: boolean | undefined;
}) => Array<ProductKey> = (data: {
  telemetryType: TelemetryType;
  everySignal?: boolean | undefined;
}): Array<ProductKey> => {
  const types: Array<TelemetryType> = [
    data.telemetryType,
    ...(data.everySignal ? OTEL_SIGNALS : []),
  ];

  return Array.from(
    new Set<ProductKey>(
      types.flatMap((type: TelemetryType): ReadonlyArray<ProductKey> => {
        return PRODUCTS_SET_UP_BY_TYPE[type] || [];
      }),
    ),
  );
};

/*
 * THE FIRST DATA A GUIDE WAITS FOR (#7888): the project's first-data mark of
 * each product the guide sets up (PRODUCT_USAGE_MILESTONES, the marks the
 * products menu reads): the first logs for the logs guide, the first traces
 * for the traces guide, all three for a guide of a whole service. The
 * guide's last step finishes when one arrives, whichever key sent the data
 * and whether or not it names a service. Each mark once, in the order the
 * products come.
 */
export const getFirstDataMilestonesOfProducts: (
  products: ReadonlyArray<ProductKey>,
) => Array<ActivationMilestone> = (
  products: ReadonlyArray<ProductKey>,
): Array<ActivationMilestone> => {
  return Array.from(
    new Set<ActivationMilestone>(
      products.flatMap(
        (product: ProductKey): ReadonlyArray<ActivationMilestone> => {
          return PRODUCT_USAGE_MILESTONES[product] || [];
        },
      ),
    ),
  );
};
