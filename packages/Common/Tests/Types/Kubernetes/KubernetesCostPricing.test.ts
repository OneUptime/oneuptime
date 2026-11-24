import {
  KUBERNETES_COST_ENGINE_NAMES,
  KUBERNETES_COST_MEMORY_PEAKS_SOURCES,
  KUBERNETES_COST_PRICING_SOURCES,
  KubernetesCostEngineInfo,
  KubernetesCostMemoryPeaksSource,
  KubernetesCostPricingSource,
  getKubernetesCostProviderDisplayName,
  readKubernetesCostEngineInfo,
} from "../../../Types/Kubernetes/KubernetesCostPricing";
import KubernetesCostAllocation from "../../../Models/AnalyticsModels/KubernetesCostAllocation";
import AnalyticsTableColumn from "../../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";

/*
 * #9633 / #9634: what the cost agent says about the engine that priced a
 * shipment. The payload is the agent's word, so every field is read
 * through readKubernetesCostEngineInfo: what the agent can send is kept,
 * anything else is dropped before it is stored or drawn on a page.
 */

const FULL: KubernetesCostEngineInfo = {
  engine: "Kubecost",
  service: "kubecost/kubecost-cost-analyzer",
  bundledEngineUnused: true,
  pricingSource: KubernetesCostPricingSource.ListPrices,
  pricingProvider: "AWS",
  memoryPeaksFrom: KubernetesCostMemoryPeaksSource.Engine,
};

describe("readKubernetesCostEngineInfo", () => {
  test("keeps everything the agent sends", () => {
    expect(readKubernetesCostEngineInfo({ ...FULL })).toEqual(FULL);
  });

  test("is null for a payload that says nothing: an older agent", () => {
    expect(readKubernetesCostEngineInfo(undefined)).toBeNull();
    expect(readKubernetesCostEngineInfo(null)).toBeNull();
    expect(readKubernetesCostEngineInfo("Kubecost")).toBeNull();
    expect(readKubernetesCostEngineInfo([FULL])).toBeNull();
  });

  test("knows the engines and the pricing sources the agent names", () => {
    expect(KUBERNETES_COST_ENGINE_NAMES).toEqual(["OpenCost", "Kubecost"]);
    expect(KUBERNETES_COST_PRICING_SOURCES).toEqual([
      "list-prices",
      "billing-integration",
      "rate-card",
      "default-rates",
      "unknown",
    ]);
  });

  // #9851: a Kubecost that reads the cloud's bill, at that cloud's list prices.
  test("keeps a bill-reading Kubecost's source and the cloud it names", () => {
    expect(
      readKubernetesCostEngineInfo({
        ...FULL,
        pricingSource: "billing-integration",
        pricingProvider: "Azure",
      }),
    ).toEqual({
      ...FULL,
      pricingSource: KubernetesCostPricingSource.BillingIntegration,
      pricingProvider: "Azure",
    });
    // Its provider is held to a plain name, as list prices' is.
    expect(
      readKubernetesCostEngineInfo({
        ...FULL,
        pricingSource: "billing-integration",
        pricingProvider: "<b>AWS</b>",
      })?.pricingProvider,
    ).toBe("");
  });

  test("drops an engine it does not know", () => {
    expect(
      readKubernetesCostEngineInfo({ ...FULL, engine: "<b>Evil</b>" })?.engine,
    ).toBe("");
  });

  test("keeps a Service only as namespace/name, as Kubernetes allows them", () => {
    for (const service of [
      "kubecost",
      "a/b/c",
      "Kubecost/Cost",
      "kubecost/<script>",
      `${"a".repeat(64)}/x`,
      " /x",
    ]) {
      expect(readKubernetesCostEngineInfo({ ...FULL, service })?.service).toBe(
        "",
      );
    }

    expect(
      readKubernetesCostEngineInfo({ ...FULL, service: " opencost/opencost " })
        ?.service,
    ).toBe("opencost/opencost");
  });

  test("reads only true as an unused bundled engine", () => {
    for (const value of ["true", 1, "yes", null]) {
      expect(
        readKubernetesCostEngineInfo({ ...FULL, bundledEngineUnused: value })
          ?.bundledEngineUnused,
      ).toBe(false);
    }
  });

  test("reads a source it does not know as unknown, never as list prices", () => {
    expect(
      readKubernetesCostEngineInfo({ ...FULL, pricingSource: "free" })
        ?.pricingSource,
    ).toBe(KubernetesCostPricingSource.Unknown);
  });

  test("keeps a provider only beside list prices (or a bill-reading Kubecost's), and only a plain name", () => {
    expect(
      readKubernetesCostEngineInfo({
        ...FULL,
        pricingSource: KubernetesCostPricingSource.DefaultRates,
      })?.pricingProvider,
    ).toBe("");
    expect(
      readKubernetesCostEngineInfo({
        ...FULL,
        pricingProvider: "<img src=x>",
      })?.pricingProvider,
    ).toBe("");
    expect(
      readKubernetesCostEngineInfo({ ...FULL, pricingProvider: "x".repeat(40) })
        ?.pricingProvider,
    ).toBe("");
    // A cloud a newer OpenCost knows still reads as its name.
    expect(
      readKubernetesCostEngineInfo({ ...FULL, pricingProvider: "Linode" })
        ?.pricingProvider,
    ).toBe("Linode");
  });
});

/*
 * #9970: where the memory peaks right-sizing reads come from. The note that
 * advises stopping the bundled engine reads it: with the bundled Prometheus,
 * stopping it stops the peaks too.
 */
describe("readKubernetesCostEngineInfo: where the memory peaks come from", () => {
  test("knows the sources the agent names, none included", () => {
    expect(KUBERNETES_COST_MEMORY_PEAKS_SOURCES).toEqual([
      "engine",
      "bundled",
      "configured",
      "",
    ]);
  });

  test.each([
    ["engine", KubernetesCostMemoryPeaksSource.Engine],
    ["bundled", KubernetesCostMemoryPeaksSource.Bundled],
    ["configured", KubernetesCostMemoryPeaksSource.Configured],
    ["", KubernetesCostMemoryPeaksSource.None],
  ])(
    "keeps %j as the agent sends it",
    (sent: string, read: KubernetesCostMemoryPeaksSource) => {
      expect(
        readKubernetesCostEngineInfo({ ...FULL, memoryPeaksFrom: sent })
          ?.memoryPeaksFrom,
      ).toBe(read);
    },
  );

  test("an agent older than #9970 says nothing: no source", () => {
    const older: Record<string, unknown> = { ...FULL };
    delete older["memoryPeaksFrom"];

    expect(readKubernetesCostEngineInfo(older)?.memoryPeaksFrom).toBe(
      KubernetesCostMemoryPeaksSource.None,
    );
  });

  test("drops what the agent cannot send, never storing it", () => {
    for (const value of ["Bundled", "thanos", "<b>engine</b>", 1, true, null]) {
      expect(
        readKubernetesCostEngineInfo({ ...FULL, memoryPeaksFrom: value })
          ?.memoryPeaksFrom,
      ).toBe(KubernetesCostMemoryPeaksSource.None);
    }
  });
});

describe("getKubernetesCostProviderDisplayName", () => {
  test.each([
    ["AWS", "AWS"],
    ["GCP", "Google Cloud"],
    ["gcp", "Google Cloud"],
    ["Azure", "Azure"],
    ["Alibaba", "Alibaba Cloud"],
    ["Oracle", "Oracle Cloud"],
    ["OTC", "Open Telekom Cloud"],
    ["OVH", "OVHcloud"],
    ["IBM", "IBM Cloud"],
    ["Scaleway", "Scaleway"],
    ["DigitalOcean", "DigitalOcean"],
    ["STACKIT", "STACKIT"],
  ])("names %s as people say it: %s", (provider: string, name: string) => {
    expect(getKubernetesCostProviderDisplayName(provider)).toBe(name);
  });

  test("reads a cloud it does not list as the engine wrote it", () => {
    expect(getKubernetesCostProviderDisplayName(" Linode ")).toBe("Linode");
  });
});

describe("KubernetesCostAllocation stores how each row was priced", () => {
  const model: KubernetesCostAllocation = new KubernetesCostAllocation();

  test.each([
    ["costEngine", TableColumnType.Text, ""],
    ["costEngineService", TableColumnType.Text, ""],
    ["pricingSource", TableColumnType.Text, ""],
    ["pricingProvider", TableColumnType.Text, ""],
    ["bundledEngineUnused", TableColumnType.Boolean, false],
    ["memoryPeaksFrom", TableColumnType.Text, ""],
    ["isCostAdjustment", TableColumnType.Boolean, false],
  ])(
    "%s is a %s column, empty on rows from older agents",
    (key: string, type: TableColumnType, empty: string | boolean) => {
      const column: AnalyticsTableColumn | null = model.getTableColumn(key);

      expect(column).not.toBeNull();
      expect(column!.type).toBe(type);
      expect(column!.required).toBe(true);
      expect(column!.defaultValue).toBe(empty);
      // Nobody rewrites how an hour was priced.
      expect(column!.accessControl?.update).toEqual([]);
    },
  );

  test("the names repeat on every row, so they are stored once per part", () => {
    for (const key of [
      "costEngine",
      "costEngineService",
      "pricingSource",
      "pricingProvider",
      "memoryPeaksFrom",
    ]) {
      expect(model.getTableColumn(key)?.isLowCardinality).toBe(true);
    }
  });
});
