import {
  KUBERNETES_COST_ENGINE_NAMES,
  KUBERNETES_COST_PRICING_SOURCES,
  KubernetesCostEngineInfo,
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
      "rate-card",
      "default-rates",
      "unknown",
    ]);
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

  test("keeps a provider only beside list prices, and only a plain name", () => {
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
    ]) {
      expect(model.getTableColumn(key)?.isLowCardinality).toBe(true);
    }
  });
});
