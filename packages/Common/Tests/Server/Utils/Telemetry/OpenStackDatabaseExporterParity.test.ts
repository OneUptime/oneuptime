import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  OPENSTACK_SNAPSHOT_METRIC_NAMES,
  OpenStackResourceBufferEntry,
  bufferOpenStackSnapshotMetric,
  finishOpenStackBatch,
  isOpenStackSnapshotDatapoint,
} from "../../../../Server/Utils/Telemetry/OpenStackSnapshotScan";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import {
  OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT,
  OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT,
  isOpenStackDatabasePathOffered,
} from "../../../../Types/OpenStack/OpenStackScale";

/*
 * The database path against the exporter of OpenStack's APIs: same names, same labels, and what
 * OneUptime's fold makes of them.
 *
 * What this is, and what it is not. openstack_database_exporter was read from its repository at the
 * tag the agent pins, and not run: Fixtures/OpenStackDatabaseExporter says exactly what came from
 * where. So this proves the series line up, name by name and label by label, and that a row is
 * folded from what its own tests say it writes. Whether those are right on a real database is not
 * proven by anything here. Each thing that is known to differ is written down below, so a new pin
 * that changes one fails here until someone has read it again.
 */

const FIXTURES: string = path.resolve(__dirname, "../../../Fixtures");
const DATABASE_EXPORTER: string = path.join(
  FIXTURES,
  "OpenStackDatabaseExporter/v1.2.0",
);

const DATABASE_SERIES: Record<string, Array<string>> = JSON.parse(
  fs.readFileSync(path.join(DATABASE_EXPORTER, "series.json"), "utf8"),
);

interface ParsedLine {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseLine(line: string): ParsedLine | null {
  const match: RegExpExecArray | null =
    /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{.*\})?\s+(-?[0-9.e+]+)$/.exec(line.trim());

  if (!match) {
    return null;
  }

  const labels: Record<string, string> = {};
  const labelPattern: RegExp = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

  for (;;) {
    const label: RegExpExecArray | null = labelPattern.exec(match[2] || "");

    if (!label) {
      break;
    }

    labels[label[1] as string] = label[2] as string;
  }

  return { name: match[1] as string, labels, value: Number(match[3]) };
}

function parseExposition(text: string): Array<ParsedLine> {
  const lines: Array<ParsedLine> = [];

  for (const line of text.split("\n")) {
    if (line && !line.startsWith("#")) {
      const parsed: ParsedLine | null = parseLine(line);

      if (parsed) {
        lines.push(parsed);
      }
    }
  }

  return lines;
}

// What the API exporter really said about a real cloud, on OVN and on ML2/OVS.
function recordedApiSeries(): Record<string, Set<string>> {
  const series: Record<string, Set<string>> = {};

  for (const release of ["gazpacho-ovn", "gazpacho-ovs"]) {
    const folder: string = path.join(
      FIXTURES,
      "OpenStack",
      release,
      "healthy/exporter",
    );

    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith(".prom")) {
        continue;
      }

      for (const line of parseExposition(
        fs.readFileSync(path.join(folder, file), "utf8"),
      )) {
        const labels: Set<string> = series[line.name] || new Set<string>();

        for (const key of Object.keys(line.labels)) {
          labels.add(key);
        }

        series[line.name] = labels;
      }
    }
  }

  return series;
}

function foldLines(
  lines: ReadonlyArray<ParsedLine>,
  regionName: string = "RegionOne",
): Array<OpenStackResourceBufferEntry> {
  const buffer: Map<string, OpenStackResourceBufferEntry> = new Map();

  for (const line of lines) {
    const attributes: JSONArray = Object.keys(line.labels)
      .filter((key: string): boolean => {
        return line.labels[key] !== "";
      })
      .map((key: string): JSONObject => {
        return {
          key: key,
          value: { stringValue: line.labels[key] as string },
        };
      });

    attributes.push({
      key: "openstack.region.name",
      value: { stringValue: regionName },
    });

    const datapoint: JSONObject = {
      attributes: attributes,
      asDouble: line.value,
      timeUnixNano: "1793800000000000000",
    };

    if (isOpenStackSnapshotDatapoint({ metricName: line.name, datapoint })) {
      bufferOpenStackSnapshotMetric({
        metricName: line.name,
        datapoint: datapoint,
        buffer: buffer,
      });
    }
  }

  return finishOpenStackBatch(buffer.values());
}

const EXPOSITION: Array<ParsedLine> = parseExposition(
  fs.readFileSync(path.join(DATABASE_EXPORTER, "exposition.prom"), "utf8"),
);

describe("the database exporter's series, name by name", () => {
  const api: Record<string, Set<string>> = recordedApiSeries();

  test("it says every series the API exporter does, but for what its database cannot know", () => {
    const missing: Array<string> = Object.keys(api)
      .filter((name: string): boolean => {
        return name.startsWith("openstack_") && !DATABASE_SERIES[name];
      })
      .sort();

    /*
     * A pool's capacity is reported by each backend to Cinder's scheduler, and is not in Cinder's
     * database: the agent reads those two from the API. A provider's generation and each
     * consumer's allocation nothing reads, and summary mode has no use for the second anyway.
     */
    expect(missing).toEqual([
      "openstack_cinder_pool_capacity_free_gb",
      "openstack_cinder_pool_capacity_total_gb",
      "openstack_placement_resource_generation",
      "openstack_placement_resource_provider_allocations",
    ]);
  });

  test("the series they share have the same labels, but for what is written here", () => {
    const differences: Record<string, { onlyApi: Array<string>; onlyDatabase: Array<string> }> = {};

    for (const name of Object.keys(api)) {
      const database: Array<string> | undefined = DATABASE_SERIES[name];

      if (!database) {
        continue;
      }

      const apiLabels: Array<string> = Array.from(api[name] as Set<string>);
      const onlyApi: Array<string> = apiLabels
        .filter((label: string): boolean => {
          return !database.includes(label);
        })
        .sort();
      const onlyDatabase: Array<string> = database
        .filter((label: string): boolean => {
          return !apiLabels.includes(label);
        })
        .sort();

      if (onlyApi.length > 0 || onlyDatabase.length > 0) {
        differences[name] = { onlyApi, onlyDatabase };
      }
    }

    expect(differences).toEqual({
      // The fold reads either name for an agent's zone.
      openstack_neutron_agent_state: {
        onlyApi: ["availability_zone"],
        onlyDatabase: ["zone"],
      },
      // A network's MTU reads as not known.
      openstack_neutron_network: { onlyApi: ["mtu"], onlyDatabase: [] },
    });
  });

  test("of what the fold reads, all but the pools come from it, whatever it adds beside", () => {
    const missing: Array<string> = Array.from(OPENSTACK_SNAPSHOT_METRIC_NAMES)
      .filter((name: string): boolean => {
        return !DATABASE_SERIES[name];
      })
      .sort();

    expect(missing).toEqual([
      // Probe only, on the API path too.
      "openstack_cinder_backup_gb",
      "openstack_cinder_pool_capacity_free_gb",
      "openstack_cinder_pool_capacity_total_gb",
      "openstack_cinder_snapshot_gb",
      "openstack_neutron_quota_floatingip",
      "openstack_neutron_quota_network",
      "openstack_neutron_quota_port",
    ]);
  });
});

describe("what the fold makes of what it writes", () => {
  const rows: Array<OpenStackResourceBufferEntry> = foldLines(EXPOSITION);

  const ofKind: (kind: OpenStackResourceKind) => Array<OpenStackResourceBufferEntry> = (
    kind: OpenStackResourceKind,
  ): Array<OpenStackResourceBufferEntry> => {
    return rows.filter((row: OpenStackResourceBufferEntry): boolean => {
      return row.kind === kind;
    });
  };

  test("a hypervisor's capacity comes from Placement, which the database has whole", () => {
    const hosts: Array<OpenStackResourceBufferEntry> = ofKind(
      OpenStackResourceKind.Hypervisor,
    );

    expect(hosts.length).toBeGreaterThan(0);

    const host: OpenStackResourceBufferEntry = hosts.find(
      (row: OpenStackResourceBufferEntry): boolean => {
        return row.name === "cmp-1-svr8204.localdomain";
      },
    ) as OpenStackResourceBufferEntry;

    // (total - reserved) * ratio, from the exporter's own test's numbers.
    expect(host.vcpuCapacity).toBeGreaterThan(0);
    expect(host.memoryCapacityBytes).toBeGreaterThan(0);
    expect(host.diskCapacityBytes).toBeGreaterThan(0);
  });

  test("Neutron's and Cinder's workers say whether they are alive, from their heartbeats", () => {
    const workers: Array<OpenStackResourceBufferEntry> = ofKind(
      OpenStackResourceKind.Service,
    );
    const families: Set<unknown> = new Set(
      workers.map((row: OpenStackResourceBufferEntry): unknown => {
        return row.facts["family"];
      }),
    );

    expect(families).toEqual(new Set(["network", "volume"]));

    for (const worker of workers) {
      expect(["up", "down"]).toContain(worker.status);
      expect(worker.adminState).toBeTruthy();
    }
  });

  test.each([
    [OpenStackResourceKind.Network],
    [OpenStackResourceKind.Subnet],
    [OpenStackResourceKind.Router],
    [OpenStackResourceKind.FloatingIp],
    [OpenStackResourceKind.Volume],
    [OpenStackResourceKind.Image],
    [OpenStackResourceKind.Project],
    [OpenStackResourceKind.Domain],
  ])("%s rows are folded", (kind: OpenStackResourceKind) => {
    const found: Array<OpenStackResourceBufferEntry> = ofKind(kind);

    expect(found.length).toBeGreaterThan(0);

    for (const row of found) {
      expect(row.externalId).toBeTruthy();
    }
  });

  test("an API's row says up, and vouches for its rows as the API exporter's does", () => {
    const apis: Array<OpenStackResourceBufferEntry> = ofKind(
      OpenStackResourceKind.Api,
    );

    for (const api of apis) {
      if (api.status === "up") {
        expect(api.facts["vouchedAt"]).toBeTruthy();
      }
    }
  });

  /*
   * Nova's tests pin no lines of the exposition's form, so these are written from its collector's
   * source: nova/server.go, nova/compute_nodes.go, nova/services.go at the pinned tag.
   */
  describe("Nova, as its collectors write it", () => {
    const nova: Array<ParsedLine> = parseExposition(
      [
        `openstack_nova_server_status{address_ipv4="",address_ipv6="",availability_zone="nova",flavor_id="f-1",host_id="abc",hypervisor_hostname="compute-01",id="i-1",instance_libvirt="instance-00000001",name="vm-1",status="ERROR",tenant_id="p-1",user_id="u-1",uuid="i-1"} 3`,
        `openstack_nova_running_vms{aggregates="",availability_zone="",hostname="compute-01.example.org"} 40`,
        `openstack_nova_vcpus_available{aggregates="",availability_zone="",hostname="compute-01.example.org"} 56`,
        `openstack_nova_vcpus_used{aggregates="",availability_zone="",hostname="compute-01.example.org"} 40`,
        `openstack_nova_agent_state{adminState="enabled",disabledReason="",hostname="compute-01",id="s-1",service="nova-compute",zone="nova"} 1`,
      ].join("\n"),
    );

    test("an instance reads its status, and its project", () => {
      const instance: OpenStackResourceBufferEntry | undefined = foldLines(
        nova,
      ).find((row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Instance;
      });

      expect(instance?.status).toBe("ERROR");
      expect(instance?.openStackProjectId).toBe("p-1");
    });

    test("an instance names its host where a hypervisor names its full name, which the agent's suffix puts right", () => {
      const before: Array<OpenStackResourceBufferEntry> = foldLines(nova);
      const instance: OpenStackResourceBufferEntry | undefined = before.find(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Instance;
        },
      );
      const host: OpenStackResourceBufferEntry | undefined = before.find(
        (row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Hypervisor;
        },
      );

      expect(instance?.hypervisorName).toBe("compute-01");
      expect(host?.hypervisorName).toBe("compute-01.example.org");

      // OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX=.example.org, on what the fold is then handed.
      const after: Array<OpenStackResourceBufferEntry> = foldLines(
        nova.map((line: ParsedLine): ParsedLine => {
          return line.name === "openstack_nova_server_status"
            ? {
                ...line,
                labels: {
                  ...line.labels,
                  hypervisor_hostname: `${line.labels["hypervisor_hostname"]}.example.org`,
                },
              }
            : line;
        }),
      );

      expect(
        after.find((row: OpenStackResourceBufferEntry): boolean => {
          return row.kind === OpenStackResourceKind.Instance;
        })?.hypervisorName,
      ).toBe("compute-01.example.org");
    });

    test("its agent_state reads enabled and not alive, which is why the agent reads that one from the API", () => {
      /*
       * services.go writes 1 for a service that is enabled. So a stopped nova-compute that is
       * still enabled folds as up, which is exactly what must not reach a page.
       */
      const worker: OpenStackResourceBufferEntry | undefined = foldLines(
        nova,
      ).find((row: OpenStackResourceBufferEntry): boolean => {
        return row.kind === OpenStackResourceKind.Service;
      });

      expect(worker?.status).toBe("up");
      expect(
        fs.readFileSync(
          path.resolve(
            __dirname,
            "../../../../../../agents/OpenStackAgent/otel-collector-config.yaml",
          ),
          "utf8",
        ),
      ).toContain("regex: openstack_nova_agent_state|");
    });
  });
});

describe("where it is offered", () => {
  test("only past a stated size", () => {
    expect(
      isOpenStackDatabasePathOffered({ hypervisors: 500, instances: 20000 }),
    ).toBe(false);
    expect(
      isOpenStackDatabasePathOffered({
        hypervisors: OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT + 1,
        instances: 100,
      }),
    ).toBe(true);
    expect(
      isOpenStackDatabasePathOffered({
        hypervisors: 10,
        instances: OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT + 1,
      }),
    ).toBe(true);
    expect(
      isOpenStackDatabasePathOffered({
        hypervisors: OPENSTACK_DATABASE_PATH_HYPERVISOR_LIMIT,
        instances: OPENSTACK_DATABASE_PATH_INSTANCE_LIMIT,
      }),
    ).toBe(false);
  });
});
