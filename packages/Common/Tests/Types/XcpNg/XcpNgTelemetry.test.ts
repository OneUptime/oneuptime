import {
  XCP_NG_DERIVED_SERIES_SCOPE_NAME,
  XCP_NG_ID_ATTRIBUTE,
  XCP_NG_POOL_ID_ATTRIBUTE,
  XCP_NG_POOL_NAME_ATTRIBUTE,
  XCP_NG_RATE_TYPED_AS_COUNTER_SERIES,
  XCP_NG_SCOPE_ATTRIBUTE,
  XCP_NG_VM_RAN_RECENTLY_HOURS,
  XEN_ORCHESTRA_NAME_ATTRIBUTE,
  XcpNgDerivedSeries,
  XcpNgLabel,
  XcpNgScope,
  XcpNgSeries,
  XcpNgTelemetryUtil,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import XcpNgResourceKind, {
  XcpNgResourceKindUtil,
} from "../../../Types/XcpNg/XcpNgResourceKind";
import MonitorStepXcpNgMonitor, {
  MonitorStepXcpNgMonitorUtil,
} from "../../../Types/Monitor/MonitorStepXcpNgMonitor";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The contract of what an XCP-ng pool's telemetry looks like when it
 * reaches OneUptime: the names the agent, the probe of #10996, the ingest,
 * the catalog and the templates share. Every name is pinned: renaming one
 * strands stored data and the monitors people configured.
 */

describe("XcpNgTelemetry - the names", () => {
  test("resource attributes", () => {
    expect(XCP_NG_POOL_ID_ATTRIBUTE).toBe("xcp_ng.pool.id");
    expect(XCP_NG_POOL_NAME_ATTRIBUTE).toBe("xcp_ng.pool.name");
    expect(XEN_ORCHESTRA_NAME_ATTRIBUTE).toBe("xen_orchestra.name");
  });

  test("the attributes ingest stamps on every datapoint", () => {
    expect(XCP_NG_SCOPE_ATTRIBUTE).toBe("xcp_ng.scope");
    expect(XCP_NG_ID_ATTRIBUTE).toBe("xcp_ng.id");
  });

  test("scopes", () => {
    expect(Object.values(XcpNgScope).sort()).toEqual(
      ["host", "pool", "sr", "vdi", "vm", "xostor"].sort(),
    );
  });

  test("Xen Orchestra's labels, as its plugin names them", () => {
    expect(XcpNgLabel).toEqual({
      PoolId: "pool_id",
      PoolName: "pool_name",
      Uuid: "uuid",
      Type: "type",
      HostId: "host_id",
      HostName: "host_name",
      VmName: "vm_name",
      VmUuid: "vm_uuid",
      IsControlDomain: "is_control_domain",
      PowerState: "power_state",
      Enabled: "enabled",
      Tags: "tags",
      SrUuid: "sr_uuid",
      SrName: "sr_name",
      SrType: "sr_type",
      ContentType: "content_type",
      VdiUuid: "vdi_uuid",
      VdiName: "vdi_name",
      Device: "device",
      Vif: "vif",
      Interface: "interface",
      NetworkName: "network_name",
      Sr: "sr",
      Core: "core",
    });
  });

  test("every series name OneUptime reads is an xcp_ series of the plugin", () => {
    for (const name of Object.values(XcpNgSeries)) {
      expect(name).toMatch(/^xcp_(pool|host|vm|sr|vdi|xostor)_[a-z0-9_]+$/);
    }
  });

  test("the derived series are OneUptime's own, dotted, and can never collide with the plugin's", () => {
    expect(Object.values(XcpNgDerivedSeries)).toEqual([
      "xcp_ng.host.running",
      "xcp_ng.host.enabled",
      "xcp_ng.vm.running",
      "xcp_ng.vm.stopped_after_running",
    ]);
    for (const name of Object.values(XcpNgDerivedSeries)) {
      expect(name.startsWith("xcp_ng.")).toBe(true);
      expect((Object.values(XcpNgSeries) as Array<string>).includes(name)).toBe(
        false,
      );
    }
    expect(XCP_NG_DERIVED_SERIES_SCOPE_NAME).toBe("oneuptime.xcp-ng.health");
    expect(XCP_NG_VM_RAN_RECENTLY_HOURS).toBe(24);
  });

  test("the trap: exactly the eight PIF, VIF and VBD series typed counter that hold rates", () => {
    expect([...XCP_NG_RATE_TYPED_AS_COUNTER_SERIES].sort()).toEqual(
      [
        "xcp_host_network_receive_bytes_total",
        "xcp_host_network_transmit_bytes_total",
        "xcp_vm_disk_read_bytes_total",
        "xcp_vm_disk_write_bytes_total",
        "xcp_vm_network_receive_bytes_total",
        "xcp_vm_network_receive_errors_total",
        "xcp_vm_network_transmit_bytes_total",
        "xcp_vm_network_transmit_errors_total",
      ].sort(),
    );
    for (const name of XCP_NG_RATE_TYPED_AS_COUNTER_SERIES) {
      expect(name.endsWith("_total")).toBe(true);
    }
  });
});

describe("XcpNgTelemetryUtil", () => {
  test.each([
    ["xcp_pool_connected", XcpNgScope.Pool],
    ["xcp_host_status", XcpNgScope.Host],
    ["xcp_host_disk_latency_seconds", XcpNgScope.Host],
    ["xcp_vm_status", XcpNgScope.VM],
    ["xcp_vm_network_receive_bytes_total", XcpNgScope.VM],
    ["xcp_sr_physical_size_bytes", XcpNgScope.StorageRepository],
    ["xcp_vdi_virtual_size_bytes", XcpNgScope.VDI],
    ["xcp_xostor_up", XcpNgScope.Xostor],
    ["xcp_ng.host.running", XcpNgScope.Host],
    ["xcp_ng.host.enabled", XcpNgScope.Host],
    ["xcp_ng.vm.running", XcpNgScope.VM],
    ["xcp_ng.vm.stopped_after_running", XcpNgScope.VM],
  ])("%s describes a %s", (name: string, scope: XcpNgScope) => {
    expect(XcpNgTelemetryUtil.getScopeOfSeries(name)).toBe(scope);
  });

  test.each([
    ["xo_pool_total"],
    ["pve_up"],
    ["xcp_"],
    ["xcp_something_new"],
    [""],
  ])("%s is not an XCP-ng series", (name: string) => {
    expect(XcpNgTelemetryUtil.getScopeOfSeries(name)).toBe(null);
  });

  test("no name, no scope", () => {
    expect(XcpNgTelemetryUtil.getScopeOfSeries(null)).toBe(null);
    expect(XcpNgTelemetryUtil.getScopeOfSeries(undefined)).toBe(null);
  });

  test("the label each scope names its object by", () => {
    expect(XcpNgTelemetryUtil.getIdLabelOfScope(XcpNgScope.Host)).toBe("uuid");
    expect(XcpNgTelemetryUtil.getIdLabelOfScope(XcpNgScope.VM)).toBe("uuid");
    expect(
      XcpNgTelemetryUtil.getIdLabelOfScope(XcpNgScope.StorageRepository),
    ).toBe("sr_uuid");
    expect(XcpNgTelemetryUtil.getIdLabelOfScope(XcpNgScope.Xostor)).toBe(
      "sr_uuid",
    );
    expect(XcpNgTelemetryUtil.getIdLabelOfScope(XcpNgScope.VDI)).toBe(
      "vdi_uuid",
    );
    expect(XcpNgTelemetryUtil.getIdLabelOfScope(XcpNgScope.Pool)).toBe(null);
  });

  test("isRateTypedAsCounter", () => {
    expect(
      XcpNgTelemetryUtil.isRateTypedAsCounter("xcp_vm_disk_read_bytes_total"),
    ).toBe(true);
    expect(
      XcpNgTelemetryUtil.isRateTypedAsCounter(
        "xcp_host_network_aggregated_receive_bytes",
      ),
    ).toBe(false);
    expect(XcpNgTelemetryUtil.isRateTypedAsCounter("")).toBe(false);
    expect(XcpNgTelemetryUtil.isRateTypedAsCounter(null)).toBe(false);
  });

  test("a pool identifier is trimmed and lower-cased", () => {
    expect(
      XcpNgTelemetryUtil.normalizePoolIdentifier(
        "  B7569D99-30F8-178A-7D94-801DE3E29B5B ",
      ),
    ).toBe("b7569d99-30f8-178a-7d94-801de3e29b5b");
    expect(XcpNgTelemetryUtil.normalizePoolIdentifier(null)).toBe("");
    expect(XcpNgTelemetryUtil.normalizePoolIdentifier(undefined)).toBe("");
  });

  test("a pool is named after Xen Orchestra's name, or the start of its UUID", () => {
    expect(
      XcpNgTelemetryUtil.getDefaultPoolName({
        poolName: " Production ",
        poolIdentifier: "b7569d99-30f8-178a-7d94-801de3e29b5b",
      }),
    ).toBe("Production");
    expect(
      XcpNgTelemetryUtil.getDefaultPoolName({
        poolName: "",
        poolIdentifier: "B7569D99-30F8-178A-7D94-801DE3E29B5B",
      }),
    ).toBe("Pool b7569d99");
    expect(
      XcpNgTelemetryUtil.getDefaultPoolName({
        poolName: null,
        poolIdentifier: "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1",
      }),
    ).toBe("Pool 2ad2c2ec");
  });

  test("the short identifier is the UUID's first block, at most 8 characters", () => {
    expect(XcpNgTelemetryUtil.getShortIdentifier("abcdef0123456789")).toBe(
      "abcdef01",
    );
    expect(XcpNgTelemetryUtil.getShortIdentifier("ab-cd")).toBe("ab");
  });
});

describe("XcpNgResourceKind", () => {
  test("the four kinds, stored as written", () => {
    expect(XcpNgResourceKindUtil.getAllKinds()).toEqual([
      "Host",
      "VM",
      "StorageRepository",
      "VDI",
    ]);
  });

  test("labels", () => {
    expect(XcpNgResourceKindUtil.getSingularLabel(XcpNgResourceKind.Host)).toBe(
      "Host",
    );
    expect(XcpNgResourceKindUtil.getPluralLabel(XcpNgResourceKind.VM)).toBe(
      "VMs",
    );
    expect(
      XcpNgResourceKindUtil.getSingularLabel(
        XcpNgResourceKind.StorageRepository,
      ),
    ).toBe("Storage Repository");
    expect(XcpNgResourceKindUtil.getPluralLabel(XcpNgResourceKind.VDI)).toBe(
      "Virtual Disks",
    );
  });

  test("isKind reads only the four values, never an inherited name", () => {
    expect(XcpNgResourceKindUtil.isKind("Host")).toBe(true);
    expect(XcpNgResourceKindUtil.isKind("StorageRepository")).toBe(true);
    expect(XcpNgResourceKindUtil.isKind("host")).toBe(false);
    expect(XcpNgResourceKindUtil.isKind("constructor")).toBe(false);
    expect(XcpNgResourceKindUtil.isKind("toString")).toBe(false);
    expect(XcpNgResourceKindUtil.isKind(undefined)).toBe(false);
    expect(XcpNgResourceKindUtil.isKind(1)).toBe(false);
  });
});

describe("MonitorStepXcpNgMonitor", () => {
  test("a new step has no pool yet and a one-minute window", () => {
    const step: MonitorStepXcpNgMonitor =
      MonitorStepXcpNgMonitorUtil.getDefault();
    expect(step.poolIdentifier).toBe("");
    expect(step.resourceFilters).toEqual({});
    expect(step.metricViewConfig).toEqual({
      queryConfigs: [],
      formulaConfigs: [],
    });
    expect(step.rollingTime).toBe(RollingTime.Past1Minute);
  });

  test("JSON round trip", () => {
    const step: MonitorStepXcpNgMonitor = {
      ...MonitorStepXcpNgMonitorUtil.getDefault(),
      poolIdentifier: "b7569d99-30f8-178a-7d94-801de3e29b5b",
      resourceFilters: {
        scope: XcpNgScope.VM,
        xcpNgId: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
      },
    };
    const json: JSONObject = MonitorStepXcpNgMonitorUtil.toJSON(step);
    expect(MonitorStepXcpNgMonitorUtil.fromJSON(json)).toEqual(step);
  });
});

describe("MonitorType.XcpNg", () => {
  test("is stored as XCP-ng", () => {
    expect(MonitorType.XcpNg).toBe("XCP-ng");
  });

  test("is an infrastructure, metric-backed, telemetry monitor", () => {
    expect(MonitorTypeHelper.isMetricBackedMonitor(MonitorType.XcpNg)).toBe(
      true,
    );
    expect(MonitorTypeHelper.isInfrastructureMonitor(MonitorType.XcpNg)).toBe(
      true,
    );
    expect(MonitorTypeHelper.isTelemetryMonitor(MonitorType.XcpNg)).toBe(true);
  });

  test("is listed under Infrastructure, beside the other hypervisors", () => {
    const infrastructure: Array<MonitorType> =
      MonitorTypeHelper.getMonitorTypeCategories().find(
        (c: { label: string }) => {
          return c.label === "Infrastructure";
        },
      )!.monitorTypes;
    expect(infrastructure).toContain(MonitorType.XcpNg);
    expect(infrastructure.indexOf(MonitorType.XcpNg)).toBe(
      infrastructure.indexOf(MonitorType.VMware) + 1,
    );
  });

  test("is found by the words its users know: Xen, XenServer, Xen Orchestra, XO", () => {
    const props: { keywords: Array<string>; title: string } | undefined =
      MonitorTypeHelper.getAllMonitorTypeProps().find(
        (p: { monitorType: MonitorType }) => {
          return p.monitorType === MonitorType.XcpNg;
        },
      );
    expect(props?.title).toBe("XCP-ng");
    for (const keyword of ["xen", "xenserver", "xen orchestra", "xo"]) {
      expect(props?.keywords).toContain(keyword);
    }
  });
});
