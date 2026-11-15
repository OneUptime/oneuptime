import type { TelemetryType } from "./Documentation";
import { OTEL_SIGNALS } from "./OtelSdkLanguages/Shared";
import ProductKey from "Common/Types/Product/ProductKey";

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
