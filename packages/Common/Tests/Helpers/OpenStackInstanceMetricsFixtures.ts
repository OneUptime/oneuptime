import { JSONArray, JSONObject } from "../../Types/JSON";

/*
 * Prometheus' text format as the OTLP the agent's collector sends, the way its prometheus
 * receiver and its processors leave it: one scrape's timestamp on every datapoint, the
 * labels as attributes, a counter as a sum and everything else as a gauge, and the target's
 * host name on every series (agents/OpenStackAgent/otel-collector-config.yaml). So a recording
 * goes through the same scan a real batch does. Not a test file itself.
 */

export interface PrometheusSeries {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export function parsePrometheusExposition(
  text: string,
): Array<PrometheusSeries> {
  const series: Array<PrometheusSeries> = [];
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) {
      continue;
    }
    const labelsAt: number = line.indexOf("{");
    const valueAt: number = line.lastIndexOf(" ");
    if (labelsAt < 0) {
      series.push({
        name: line.substring(0, valueAt),
        labels: {},
        value: Number(line.substring(valueAt + 1)),
      });
      continue;
    }
    const labels: Record<string, string> = {};
    let at: number = labelsAt + 1;
    while (at < line.length && line[at] !== "}") {
      const equals: number = line.indexOf("=", at);
      const key: string = line.substring(at, equals);
      at = equals + 2;
      let value: string = "";
      while (line[at] !== '"') {
        if (line[at] === "\\") {
          at += 1;
          value += line[at] === "n" ? "\n" : line[at];
        } else {
          value += line[at];
        }
        at += 1;
      }
      labels[key] = value;
      at += 1;
      if (line[at] === ",") {
        at += 1;
      }
    }
    series.push({
      name: line.substring(0, labelsAt),
      labels,
      value: Number(line.substring(valueAt + 1)),
    });
  }
  return series;
}

export function prometheusToEnvelope(data: {
  series: ReadonlyArray<PrometheusSeries>;
  timeMs: number;
  exporterHost?: string | undefined;
  cloudName?: string | undefined;
}): JSONObject {
  const byName: Map<string, Array<JSONObject>> = new Map();
  for (const one of data.series) {
    const attributes: JSONArray = Object.entries(one.labels).map(
      ([key, value]: [string, string]): JSONObject => {
        return { key, value: { stringValue: value } };
      },
    );
    if (data.exporterHost) {
      attributes.push({
        key: "openstack_exporter_host",
        value: { stringValue: data.exporterHost },
      });
    }
    const list: Array<JSONObject> = byName.get(one.name) || [];
    list.push({
      timeUnixNano: `${data.timeMs}000000`,
      asDouble: Number.isFinite(one.value) ? one.value : "NaN",
      attributes,
    });
    byName.set(one.name, list);
  }
  const metrics: Array<JSONObject> = [];
  for (const [name, dataPoints] of byName) {
    metrics.push(
      name.endsWith("_total")
        ? {
            name,
            sum: {
              dataPoints,
              aggregationTemporality: 2,
              isMonotonic: true,
            },
          }
        : { name, gauge: { dataPoints } },
    );
  }
  return {
    resource: {
      attributes: [
        {
          key: "openstack.cloud.name",
          value: { stringValue: data.cloudName || "prod" },
        },
      ],
    },
    scopeMetrics: [
      {
        scope: {
          name: "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/prometheusreceiver",
        },
        metrics,
      },
    ],
  };
}

/*
 * What a real scrape of each exporter looks like for one instance, written from the
 * exporter's own source until a recording replaces it, with the labels it writes.
 */
export const BURNER_ID: string = "a1b2c3d4-0000-4000-8000-000000000001";
export const IDLE_ID: string = "a1b2c3d4-0000-4000-8000-000000000002";
export const STOPPED_ID: string = "a1b2c3d4-0000-4000-8000-000000000003";
export const PROJECT_ID: string = "6f0c7b2e6a0f4f0e9b2e1a2b3c4d5e6f";

export interface InstanceTruth {
  instanceId: string;
  domain: string;
  vcpus: number;
  cpuSeconds: number;
  delaySeconds: number;
  availableBytes?: number | undefined;
  usableBytes?: number | undefined;
  unusedBytes?: number | undefined;
  residentBytes: number;
  diskReadBytes: number;
  diskWriteBytes: number;
  diskReadRequests: number;
  diskWriteRequests: number;
  diskReadSeconds: number;
  diskWriteSeconds: number;
  networkReceiveBytes: number;
  networkTransmitBytes: number;
}

export function libvirtText(truths: ReadonlyArray<InstanceTruth>): string {
  const lines: Array<string> = ["libvirt_up 1"];
  for (const truth of truths) {
    const d: string = `domain="${truth.domain}"`;
    lines.push(
      `libvirt_domain_openstack_info{${d},flavor_name="ou.tiny",instance_id="${truth.instanceId}",instance_name="${truth.domain}-name",project_id="${PROJECT_ID}",project_name="ou-research",user_id="u",user_name="admin"} 1`,
      `libvirt_domain_info_virtual_cpus{${d}} ${truth.vcpus}`,
      `libvirt_domain_info_cpu_time_seconds_total{${d}} ${truth.cpuSeconds}`,
      // The trap: this is the balloon's size, which is the flavor's memory on any idle guest.
      `libvirt_domain_info_memory_usage_bytes{${d}} 134217728`,
      `libvirt_domain_memory_stats_rss_bytes{${d}} ${truth.residentBytes}`,
    );
    if (truth.availableBytes !== undefined) {
      lines.push(
        `libvirt_domain_memory_stats_available_bytes{${d}} ${truth.availableBytes}`,
      );
    }
    if (truth.usableBytes !== undefined) {
      lines.push(
        `libvirt_domain_memory_stats_usable_bytes{${d}} ${truth.usableBytes}`,
      );
    }
    if (truth.unusedBytes !== undefined) {
      lines.push(
        `libvirt_domain_memory_stats_unused_bytes{${d}} ${truth.unusedBytes}`,
      );
    }
    for (let vcpu: number = 0; vcpu < truth.vcpus; vcpu++) {
      lines.push(
        `libvirt_domain_vcpu_delay_seconds_total{${d},vcpu="${vcpu}"} ${truth.delaySeconds / truth.vcpus}`,
      );
    }
    const disk: string = `${d},target_device="vda"`;
    lines.push(
      `libvirt_domain_block_stats_read_bytes_total{${disk}} ${truth.diskReadBytes}`,
      `libvirt_domain_block_stats_write_bytes_total{${disk}} ${truth.diskWriteBytes}`,
      `libvirt_domain_block_stats_read_requests_total{${disk}} ${truth.diskReadRequests}`,
      `libvirt_domain_block_stats_write_requests_total{${disk}} ${truth.diskWriteRequests}`,
      `libvirt_domain_block_stats_read_time_seconds_total{${disk}} ${truth.diskReadSeconds}`,
      `libvirt_domain_block_stats_write_time_seconds_total{${disk}} ${truth.diskWriteSeconds}`,
    );
    const nic: string = `${d},target_device="tap1234abcd-ef"`;
    lines.push(
      `libvirt_domain_interface_stats_receive_bytes_total{${nic}} ${truth.networkReceiveBytes}`,
      `libvirt_domain_interface_stats_transmit_bytes_total{${nic}} ${truth.networkTransmitBytes}`,
    );
  }
  return lines.join("\n");
}

const MIB: number = 1024 * 1024;

function ceilometerLabels(data: {
  plugin: string;
  pluginValue: string;
  type: string;
  counter: string;
  unit: string;
  resource: string;
}): string {
  return `${data.plugin}="${data.pluginValue}",counter="${data.counter}",flavor_id="ou",flavor_name="ou.tiny",project="${PROJECT_ID}",publisher="ceilometer",resource="${data.resource}",resource_name="burner:instance-00000001",server_group="none",type="${data.type}",unit="${data.unit}",user="u",vm_instance="abc"`;
}

export function ceilometerText(truths: ReadonlyArray<InstanceTruth>): string {
  const lines: Array<string> = [];
  for (const truth of truths) {
    const id: string = truth.instanceId;
    lines.push(
      `ceilometer_vcpus{${ceilometerLabels({ plugin: "vcpus", pluginValue: id, type: "vcpus", counter: "vcpus", unit: "vcpu", resource: id })}} ${truth.vcpus}`,
      `ceilometer_cpu{${ceilometerLabels({ plugin: "cpu", pluginValue: id, type: "cpu", counter: "cpu", unit: "ns", resource: id })}} ${truth.cpuSeconds * 1e9}`,
      `ceilometer_cpu_delay{${ceilometerLabels({ plugin: "cpu", pluginValue: id, type: "delay", counter: "cpu.delay", unit: "ns", resource: id })}} ${truth.delaySeconds * 1e9}`,
      `ceilometer_memory_resident{${ceilometerLabels({ plugin: "memory", pluginValue: id, type: "resident", counter: "memory.resident", unit: "MiB", resource: id })}} ${truth.residentBytes / MIB}`,
    );
    if (truth.availableBytes !== undefined && truth.usableBytes !== undefined) {
      lines.push(
        `ceilometer_memory_usage{${ceilometerLabels({ plugin: "memory", pluginValue: id, type: "usage", counter: "memory.usage", unit: "MiB", resource: id })}} ${(truth.availableBytes - truth.usableBytes) / MIB}`,
      );
    }
    const disk: string = `${id}-vda`;
    const diskSeries: Array<[string, string, number]> = [
      ["read", "bytes", truth.diskReadBytes],
      ["write", "bytes", truth.diskWriteBytes],
      ["read", "requests", truth.diskReadRequests],
      ["write", "requests", truth.diskWriteRequests],
      ["read", "latency", truth.diskReadSeconds * 1e9],
      ["write", "latency", truth.diskWriteSeconds * 1e9],
    ];
    for (const [direction, what, value] of diskSeries) {
      lines.push(
        `ceilometer_disk_device_${direction}_${what}{${ceilometerLabels({ plugin: "disk", pluginValue: direction, type: "device", counter: `disk.device.${direction}.${what}`, unit: what === "latency" ? "ns" : what === "bytes" ? "B" : "request", resource: disk })}} ${value}`,
      );
    }
    const nic: string = `instance-00000001-${id}-tap1234abcd-ef`;
    lines.push(
      `ceilometer_network_incoming_bytes{${ceilometerLabels({ plugin: "network", pluginValue: "bytes", type: "incoming", counter: "network.incoming.bytes", unit: "B", resource: nic })}} ${truth.networkReceiveBytes}`,
      `ceilometer_network_outgoing_bytes{${ceilometerLabels({ plugin: "network", pluginValue: "bytes", type: "outgoing", counter: "network.outgoing.bytes", unit: "B", resource: nic })}} ${truth.networkTransmitBytes}`,
    );
  }
  return lines.join("\n");
}
