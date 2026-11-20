import ProductType from "../MeteredPlan/ProductType";

/*
 * Where an exception occurrence (a ClickHouse ExceptionInstance row) was
 * found, as its `exception.source` attribute says, and so which product
 * bills it (issue #6590):
 *
 *   - "span": an exception event of a span (OtelTracesIngestService).
 *     Billed with Traces, beside the span it was recorded on.
 *   - "log": a log record that carried an exception, by its exception.*
 *     attributes or a stack trace in its body (OtelLogsIngestService,
 *     LogExceptionExtractor). Billed with Logs, beside the log record it was
 *     found in, and kept for that record's retention.
 *
 * So the product that ingested the record an exception was found in is the
 * product that bills it, and each occurrence is billed once. Logs and traces
 * cost the same per GB, and a resource keeps both for the same billed
 * retention, so this moves what a project is billed between the two products
 * without changing what it pays: a project that sends only logs is no longer
 * billed for Traces it never sent.
 *
 * The logs ingest has stamped "log" on every row it wrote since it first
 * found exceptions in logs, so a row's source is known whenever it was
 * written. A row without the attribute was recorded from a span (the traces
 * ingest, and the REST API's create), as every exception was before. The
 * traces ingest stamps "span" over anything the emitter's own event put
 * under the key, so only the logs ingest can write "log".
 */
export const EXCEPTION_SOURCE_ATTRIBUTE: string = "exception.source";

export enum ExceptionSource {
  Span = "span",
  Log = "log",
}

// The product that bills the exceptions found in each source.
export const EXCEPTION_SOURCE_PRODUCT_TYPES: Readonly<
  Record<ExceptionSource, ProductType.Traces | ProductType.Logs>
> = {
  [ExceptionSource.Span]: ProductType.Traces,
  [ExceptionSource.Log]: ProductType.Logs,
};

/*
 * The source whose exceptions a product bills, or null for a product that
 * bills none (every product but Traces and Logs).
 */
export const getExceptionSourceBilledBy: (
  productType: ProductType,
) => ExceptionSource | null = (
  productType: ProductType,
): ExceptionSource | null => {
  for (const source of Object.values(ExceptionSource)) {
    if (EXCEPTION_SOURCE_PRODUCT_TYPES[source] === productType) {
      return source;
    }
  }

  return null;
};

// The products that bill exceptions, Traces first, as the usage pages list them.
export const EXCEPTION_BILLING_PRODUCT_TYPES: ReadonlyArray<ProductType> = [
  ProductType.Traces,
  ProductType.Logs,
];

export const isExceptionBillingProductType: (
  productType: unknown,
) => boolean = (productType: unknown): boolean => {
  return EXCEPTION_BILLING_PRODUCT_TYPES.includes(productType as ProductType);
};
