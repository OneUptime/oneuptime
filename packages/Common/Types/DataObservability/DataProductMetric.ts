/*
 * THE METRICS A DATA PRODUCT WRITES.
 *
 * Every five minutes each data product's tables are checked against its SLA
 * (DataProductFreshness): how many are late, and how old its data is - the
 * oldest last change among them. Each row is tagged with its product, so
 * its monitor watches it alone, and a dashboard can chart every product's
 * freshness side by side.
 */
export enum DataProductMetricName {
  // How many of the product's tables are late: 0 while it is on time.
  LateTables = "oneuptime.data.product.late_tables",
  // How old the product's data is, in seconds: since the oldest last change among its tables.
  DataAge = "oneuptime.data.product.data_age",
}

export const DataProductAttribute: {
  readonly ProductId: string;
  readonly ProductName: string;
} = {
  ProductId: "oneuptime.data.product.id",
  ProductName: "oneuptime.data.product.name",
};

export interface DataProductMetricDefinition {
  name: DataProductMetricName;
  description: string;
  unit: string;
}

export const DATA_PRODUCT_METRICS: ReadonlyArray<DataProductMetricDefinition> =
  [
    {
      name: DataProductMetricName.LateTables,
      description:
        "How many of a data product's tables are late by its SLA: 0 while it is on time.",
      unit: "",
    },
    {
      name: DataProductMetricName.DataAge,
      description:
        "How old a data product's data is, in seconds: since the oldest last change among its tables.",
      unit: "s",
    },
  ];
