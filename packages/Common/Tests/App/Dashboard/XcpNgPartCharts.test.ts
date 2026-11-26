import { describe, expect, test } from "@jest/globals";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import AggregatedModel from "../../../Types/BaseDatabase/AggregatedModel";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XcpNgLabel,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import { getXcpNgMetricByMetricName } from "../../../Types/Monitor/XcpNgMetricCatalog";
import {
  XCP_NG_HOST_MEMORY_FREE_VARIABLE,
  XCP_NG_HOST_MEMORY_TOTAL_VARIABLE,
  XCP_NG_SR_SIZE_VARIABLE,
  XCP_NG_SR_USED_VARIABLE,
  XcpNgPartCharts,
  getXcpNgHostCharts,
  getXcpNgStorageCharts,
  getXcpNgVmCharts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/XcpNg/XcpNgPartCharts";

/*
 * The charts of an XCP-ng host's, VM's and storage repository's Metrics
 * tab (Components/XcpNg/XcpNgPartCharts): which series each reads, for
 * which object, split by what, in which unit - and that Xen Orchestra's
 * per-second rates are drawn as they come, never as the rate of a counter.
 */

const POOL: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
const HOST: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
const VM: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
const SR: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";
const ENGLISH: Translator = createTranslator(undefined, "en");

const host: XcpNgPartCharts = getXcpNgHostCharts({
  poolIdentifier: POOL,
  hostExternalId: HOST,
  translator: ENGLISH,
});
const vm: XcpNgPartCharts = getXcpNgVmCharts({
  poolIdentifier: POOL,
  vmExternalId: VM,
  translator: ENGLISH,
});
const repository: XcpNgPartCharts = getXcpNgStorageCharts({
  poolIdentifier: POOL,
  storageRepositoryExternalId: SR,
  translator: ENGLISH,
});

function metricNames(charts: XcpNgPartCharts): Array<string> {
  return charts.queryConfigs.map((query: MetricQueryConfigData): string => {
    return String(query.metricQueryData.filterData.metricName);
  });
}

function query(
  charts: XcpNgPartCharts,
  metricName: string,
): MetricQueryConfigData {
  const found: MetricQueryConfigData | undefined = charts.queryConfigs.find(
    (candidate: MetricQueryConfigData): boolean => {
      return candidate.metricQueryData.filterData.metricName === metricName;
    },
  );
  if (!found) {
    throw new Error(`no ${metricName} chart`);
  }
  return found;
}

function point(attributes: Record<string, unknown>): AggregatedModel {
  return { attributes: attributes } as unknown as AggregatedModel;
}

describe("a host's charts", () => {
  test("CPU, load, memory, network per interface, disks per storage repository, power", () => {
    expect(metricNames(host)).toEqual([
      "xcp_host_cpu_average",
      "xcp_host_load",
      "xcp_host_memory_total_bytes",
      "xcp_host_memory_free_bytes",
      "xcp_host_network_receive_bytes_total",
      "xcp_host_network_transmit_bytes_total",
      "xcp_host_disk_throughput_total_bytes",
      "xcp_host_disk_iops_total",
      "xcp_host_disk_latency_seconds",
      "xcp_host_power_consumption_watts",
    ]);
  });

  test("each reads this host of this pool, by the attributes ingest stamps", () => {
    for (const metricName of metricNames(host)) {
      if (metricName === "xcp_host_power_consumption_watts") {
        continue;
      }
      expect({
        metricName,
        attributes: query(host, metricName).metricQueryData.filterData
          .attributes,
      }).toEqual({
        metricName,
        attributes: {
          "resource.xcp_ng.pool.id": POOL,
          "xcp_ng.scope": "host",
          "xcp_ng.id": HOST,
        },
      });
    }
  });

  test("power is read by the host's UUID alone: Xen Orchestra sends its sensor's reading with no pool_id", () => {
    expect(
      query(host, "xcp_host_power_consumption_watts").metricQueryData.filterData
        .attributes,
    ).toEqual({ uuid: HOST });
  });

  test("a ratio is drawn as a percent", () => {
    const cpu: MetricQueryConfigData = query(host, "xcp_host_cpu_average");
    expect(cpu.metricAliasData?.legendUnit).toBe("%");
    expect(cpu.transformValue!(0.42, point({}))).toBeCloseTo(42);
  });

  test("memory: its total with what is free on one chart, and what share is in use", () => {
    const free: MetricQueryConfigData = query(
      host,
      "xcp_host_memory_free_bytes",
    );
    expect(free.overlayWithPreviousQuery).toBe(true);
    expect(free.yAxisValueFormatter!(1024 * 1024 * 1024)).toBe("1\u00A0GiB");
    expect(free.metricAliasData?.legendUnit).toBe("");
    expect(host.formulaConfigs).toHaveLength(1);
    expect(host.formulaConfigs[0]!.metricFormulaData.metricFormula).toBe(
      `((${XCP_NG_HOST_MEMORY_TOTAL_VARIABLE} - ${XCP_NG_HOST_MEMORY_FREE_VARIABLE}) / ${XCP_NG_HOST_MEMORY_TOTAL_VARIABLE}) * 100`,
    );
    // The High Host Memory Usage alert's line.
    expect(host.formulaConfigs[0]!.criticalThreshold).toBe(95);
    expect(host.formulaConfigs[0]!.metricAliasData.legendUnit).toBe("%");
  });

  test("network per physical interface, received and sent on one chart, each line named", () => {
    const receive: MetricQueryConfigData = query(
      host,
      "xcp_host_network_receive_bytes_total",
    );
    const transmit: MetricQueryConfigData = query(
      host,
      "xcp_host_network_transmit_bytes_total",
    );
    expect(receive.metricQueryData.groupByAttributeKeys).toEqual([
      XcpNgLabel.Interface,
    ]);
    expect(transmit.overlayWithPreviousQuery).toBe(true);
    expect(receive.metricAliasData?.legendUnit).toBe("bytes/s");
    expect(receive.getSeries!(point({ interface: "eth0" })).title).toBe(
      "Receive · eth0",
    );
    expect(transmit.getSeries!(point({ interface: "eth0" })).title).toBe(
      "Transmit · eth0",
    );
    // A line with no interface says the legend alone.
    expect(receive.getSeries!(point({})).title).toBe("Receive");
  });

  test("disks per storage repository: throughput, IOPS and latency", () => {
    for (const metricName of [
      "xcp_host_disk_throughput_total_bytes",
      "xcp_host_disk_iops_total",
      "xcp_host_disk_latency_seconds",
    ]) {
      expect(
        query(host, metricName).metricQueryData.groupByAttributeKeys,
      ).toEqual([XcpNgLabel.SrName]);
    }
    expect(
      query(host, "xcp_host_disk_latency_seconds").metricAliasData?.legendUnit,
    ).toBe("s");
    expect(
      query(host, "xcp_host_disk_iops_total").metricAliasData?.legendUnit,
    ).toBe("ops/s");
  });
});

describe("a VM's charts", () => {
  test("CPU, contention, memory, network per VIF with errors, disks per device", () => {
    expect(metricNames(vm)).toEqual([
      "xcp_vm_cpu_usage",
      "xcp_vm_runstate_full_contention",
      "xcp_vm_memory_bytes",
      "xcp_vm_memory_internal_free_bytes",
      "xcp_vm_network_receive_bytes_total",
      "xcp_vm_network_transmit_bytes_total",
      "xcp_vm_network_receive_errors_total",
      "xcp_vm_network_transmit_errors_total",
      "xcp_vm_disk_read_bytes_total",
      "xcp_vm_disk_write_bytes_total",
      "xcp_vm_disk_iops_total",
      "xcp_vm_disk_latency_seconds",
    ]);
    expect(vm.formulaConfigs).toEqual([]);
  });

  test("each reads this VM of this pool", () => {
    for (const metricName of metricNames(vm)) {
      expect(
        query(vm, metricName).metricQueryData.filterData.attributes,
      ).toEqual({
        "resource.xcp_ng.pool.id": POOL,
        "xcp_ng.scope": "vm",
        "xcp_ng.id": VM,
      });
    }
  });

  test("CPU contention as a percent, with the VM Starved of CPU alert's line", () => {
    const contention: MetricQueryConfigData = query(
      vm,
      "xcp_vm_runstate_full_contention",
    );
    expect(contention.metricAliasData?.legendUnit).toBe("%");
    expect(contention.transformValue!(0.15, point({}))).toBeCloseTo(15);
    expect(contention.criticalThreshold).toBeCloseTo(10);
  });

  test("errors per second keep their slash on the chart", () => {
    const errors: MetricQueryConfigData = query(
      vm,
      "xcp_vm_network_receive_errors_total",
    );
    expect(errors.metricAliasData?.legendUnit).toBe("{errors}/s");
    expect(
      query(vm, "xcp_vm_network_transmit_errors_total")
        .overlayWithPreviousQuery,
    ).toBe(true);
    expect(errors.metricQueryData.groupByAttributeKeys).toEqual([
      XcpNgLabel.Vif,
    ]);
  });

  test("disks per device: read and write on one chart", () => {
    const read: MetricQueryConfigData = query(
      vm,
      "xcp_vm_disk_read_bytes_total",
    );
    expect(read.metricQueryData.groupByAttributeKeys).toEqual([
      XcpNgLabel.Device,
    ]);
    expect(read.getSeries!(point({ device: "xvda" })).title).toBe(
      "Read · xvda",
    );
    expect(
      query(vm, "xcp_vm_disk_write_bytes_total").overlayWithPreviousQuery,
    ).toBe(true);
  });
});

describe("a storage repository's charts", () => {
  test("its size, use and allocation on one chart, then what the hosts see of it", () => {
    expect(metricNames(repository)).toEqual([
      "xcp_sr_physical_size_bytes",
      "xcp_sr_physical_usage_bytes",
      "xcp_sr_virtual_size_bytes",
      "xcp_host_disk_latency_seconds",
      "xcp_host_disk_iops_total",
      "xcp_host_disk_throughput_total_bytes",
    ]);
    expect(
      query(repository, "xcp_sr_physical_usage_bytes").overlayWithPreviousQuery,
    ).toBe(true);
    expect(
      query(repository, "xcp_sr_virtual_size_bytes").overlayWithPreviousQuery,
    ).toBe(true);
  });

  test("its own series by its UUID; the hosts' disk series by the sr_uuid that names it, one line per host", () => {
    expect(
      query(repository, "xcp_sr_physical_size_bytes").metricQueryData.filterData
        .attributes,
    ).toEqual({
      "resource.xcp_ng.pool.id": POOL,
      "xcp_ng.scope": "sr",
      "xcp_ng.id": SR,
    });
    const latency: MetricQueryConfigData = query(
      repository,
      "xcp_host_disk_latency_seconds",
    );
    expect(latency.metricQueryData.filterData.attributes).toEqual({
      "resource.xcp_ng.pool.id": POOL,
      "xcp_ng.scope": "host",
      sr_uuid: SR,
    });
    expect(latency.metricQueryData.groupByAttributeKeys).toEqual([
      XcpNgLabel.HostName,
    ]);
    expect(latency.getSeries!(point({ host_name: "xcp-01" })).title).toBe(
      "Latency · xcp-01",
    );
  });

  test("how full it is, against its alert's line and the critical one", () => {
    expect(repository.formulaConfigs).toHaveLength(1);
    expect(repository.formulaConfigs[0]!.metricFormulaData.metricFormula).toBe(
      `(${XCP_NG_SR_USED_VARIABLE} / ${XCP_NG_SR_SIZE_VARIABLE}) * 100`,
    );
    expect(repository.formulaConfigs[0]!.warningThreshold).toBe(90);
    expect(repository.formulaConfigs[0]!.criticalThreshold).toBe(95);
  });
});

describe("every chart", () => {
  const all: Array<MetricQueryConfigData> = [
    ...host.queryConfigs,
    ...vm.queryConfigs,
    ...repository.queryConfigs,
  ];

  test("draws Xen Orchestra's per-second rates as they come: never the rate of a counter", () => {
    const rates: Array<MetricQueryConfigData> = all.filter(
      (candidate: MetricQueryConfigData): boolean => {
        return XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.includes(
          String(candidate.metricQueryData.filterData.metricName),
        );
      },
    );
    // All eight trap series are charted somewhere.
    expect(
      new Set(
        rates.map((candidate: MetricQueryConfigData): string => {
          return String(candidate.metricQueryData.filterData.metricName);
        }),
      ).size,
    ).toBe(XCP_NG_RATE_TYPED_AS_COUNTER_SERIES.length);
    for (const candidate of all) {
      expect({
        metric: candidate.metricQueryData.filterData.metricName,
        transformAsRate: candidate.transformAsRate,
      }).toEqual({
        metric: candidate.metricQueryData.filterData.metricName,
        transformAsRate: undefined,
      });
    }
  });

  test("reads each series with the catalog's own aggregation", () => {
    for (const candidate of all) {
      const metricName: string = String(
        candidate.metricQueryData.filterData.metricName,
      );
      expect({
        metricName,
        aggregation: candidate.metricQueryData.filterData.aggegationType,
      }).toEqual({
        metricName,
        aggregation: getXcpNgMetricByMetricName(metricName)?.defaultAggregation,
      });
    }
  });

  test("has a unique variable, so a formula and an overlay find their query", () => {
    const variables: Array<string> = all.map(
      (candidate: MetricQueryConfigData): string => {
        return candidate.metricAliasData?.metricVariable || "";
      },
    );
    const perPage: Array<Array<string>> = [host, vm, repository].map(
      (charts: XcpNgPartCharts): Array<string> => {
        return charts.queryConfigs.map(
          (candidate: MetricQueryConfigData): string => {
            return candidate.metricAliasData?.metricVariable || "";
          },
        );
      },
    );
    for (const page of perPage) {
      expect(new Set(page).size).toBe(page.length);
    }
    expect(variables.every(Boolean)).toBe(true);
  });

  test("its words are looked up where they are written, in the reader's language", () => {
    const german: Translator = createTranslator((text: string) => {
      return (
        {
          "CPU Usage": "CPU-Auslastung",
          Receive: "Empfangen",
        } as Record<string, string>
      )[text];
    }, "de");
    const charts: XcpNgPartCharts = getXcpNgHostCharts({
      poolIdentifier: POOL,
      hostExternalId: HOST,
      translator: german,
    });
    expect(query(charts, "xcp_host_cpu_average").metricAliasData?.title).toBe(
      "CPU-Auslastung",
    );
    expect(
      query(charts, "xcp_host_network_receive_bytes_total").getSeries!(
        point({ interface: "eth1" }),
      ).title,
    ).toBe("Empfangen · eth1");
    // Words the language has none for stay English.
    expect(query(charts, "xcp_host_load").metricAliasData?.title).toBe("Load");
  });
});
