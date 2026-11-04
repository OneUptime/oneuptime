"use strict";

/**
 * The agent's files as they stand at a very large cloud: what a scrape of it needs from the
 * collector, sharing it between agents without sending anything twice, and the database path.
 *
 * These read the YAML. The real collector builds it in validate-collector-configs.sh, which needs
 * Docker. Neither runs a scrape: what a real collector does with these at size has not been run
 * anywhere yet, and the docs say so.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const AGENT = path.join(ROOT, "agents", "OpenStackAgent");

const read = (file) => {
  return fs.readFileSync(file, "utf8");
};

const config = yaml.load(read(path.join(AGENT, "otel-collector-config.yaml")));
const compose = yaml.load(read(path.join(AGENT, "docker-compose.yml")));

describe("a scrape of a very large cloud", () => {
  test("is cut into requests the server takes", () => {
    /*
     * GzipRequestBody refuses a request over 50 MiB once inflated, and a scrape is otherwise one
     * batch however large. An instance's series, the longest there is, is about 1.3 KB as JSON
     * (OpenStackScaleBudget.test.ts measures it) and less on the wire.
     */
    const maximum = config.processors.batch.send_batch_max_size;

    expect(maximum).toBeGreaterThanOrEqual(
      config.processors.batch.send_batch_size,
    );
    expect(maximum * 1300).toBeLessThan(50 * 1024 * 1024);
  });

  test("gets the memory someone gives it, and a cloud that is small keeps what it had", () => {
    expect(config.processors.memory_limiter.limit_mib).toBe(
      "${env:OPENSTACK_AGENT_MEMORY_LIMIT_MIB}",
    );
    expect(
      compose.services["oneuptime-openstack-agent"].environment,
    ).toContain(
      "OPENSTACK_AGENT_MEMORY_LIMIT_MIB=${OPENSTACK_AGENT_MEMORY_LIMIT_MIB:-512}",
    );
  });
});

describe("sharing a cloud between agents", () => {
  const jobs = config.receivers.prometheus.config.scrape_configs;

  test("every service's job can be turned off by name, in one setting", () => {
    expect(jobs).toHaveLength(6);

    for (const job of jobs) {
      expect(job.relabel_configs).toEqual(
        expect.arrayContaining([
          {
            source_labels: ["openstack_service"],
            regex: "${env:OPENSTACK_AGENT_SERVICES}",
            action: "keep",
          },
        ]),
      );
      // The rule reads the label each job's target carries.
      expect(job.static_configs[0].labels.openstack_service).toBeTruthy();
    }
  });

  test("an agent that has not been told reads everything, as it always did", () => {
    expect(
      compose.services["oneuptime-openstack-agent"].environment,
    ).toContain("OPENSTACK_AGENT_SERVICES=${OPENSTACK_AGENT_SERVICES:-.*}");
    expect(
      read(
        path.join(AGENT, "systemd", "oneuptime-openstack-agent-native.service"),
      ),
    ).toContain("Environment=OPENSTACK_AGENT_SERVICES=.*");
  });

  test.each([
    ["compute|placement", ["compute", "placement"]],
    ["identity|image", ["identity", "image"]],
    ["network", ["network"]],
    [".*", ["identity", "compute", "placement", "network", "volume", "image"]],
  ])("%s keeps the jobs it names, and no others", (regex, expected) => {
    // Prometheus anchors a relabel regex at both ends.
    const anchored = new RegExp(`^(?:${regex})$`);

    expect(
      jobs
        .map((job) => {
          return job.static_configs[0].labels.openstack_service;
        })
        .filter((service) => {
          return anchored.test(service);
        }),
    ).toEqual(expected);
  });
});

describe("the database path", () => {
  const database = compose.services["openstack-database-exporter"];
  const workers = compose.services["openstack-worker-state-exporter"];
  const jobs = config.receivers["prometheus/database-exporter"].config
    .scrape_configs;
  const job = (name) => {
    return jobs.find((candidate) => {
      return candidate.job_name === name;
    });
  };

  test("starts only when asked, pinned, with nothing a read-only exporter does not need", () => {
    expect(database.profiles).toEqual(["openstack-database-exporter"]);
    expect(database.image).toMatch(
      /^ghcr\.io\/vexxhost\/openstack-database-exporter:v1\.2\.0@sha256:[0-9a-f]{64}$/,
    );
    expect(database.read_only).toBe(true);
    expect(database.cap_drop).toEqual(["ALL"]);
    expect(database.security_opt).toEqual(["no-new-privileges:true"]);
    expect(database.ports).toBeUndefined();
    expect(database.user).toBe("65532:65532");
  });

  test("names each database by what it reads, as the exporter's flags do, and each stays out of the command line", () => {
    expect(database.command).toBeUndefined();

    for (const url of [
      "NOVA_DATABASE_URL",
      "NOVA_API_DATABASE_URL",
      "PLACEMENT_DATABASE_URL",
      "NEUTRON_DATABASE_URL",
      "CINDER_DATABASE_URL",
      "GLANCE_DATABASE_URL",
      "KEYSTONE_DATABASE_URL",
    ]) {
      expect(database.environment).toContain(`${url}=\${${url}:-}`);
    }
  });

  test("a re-run of the installer keeps what was set by hand, and writes nothing that was not", () => {
    const install = read(path.join(AGENT, "install.sh"));

    for (const name of [
      "OPENSTACK_AGENT_SERVICES",
      "OPENSTACK_AGENT_MEMORY_LIMIT_MIB",
      "OPENSTACK_DATABASE_EXPORTER_TARGETS",
      "OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX",
      "OPENSTACK_WORKER_STATE_CLOUDS",
      "OPENSTACK_WORKER_STATE_EXPORTER_ADDRESS",
      "NOVA_DATABASE_URL",
      "KEYSTONE_DATABASE_URL",
    ]) {
      expect(install).toContain(name);
    }

    expect(install).toContain('for name in $VERY_LARGE_CLOUD_NAMES; do');
  });

  test("is read on /metrics, with the service and region the per-service jobs give", () => {
    const main = job("oneuptime-openstack-database-exporter");

    expect(main.metrics_path).toBeUndefined();
    expect(main.static_configs[0].targets).toBe(
      "${env:OPENSTACK_DATABASE_EXPORTER_TARGETS}",
    );
    expect(main.static_configs[0].labels.openstack_region).toBe(
      "${env:OPENSTACK_CONTROL_PLANE_REGION}",
    );

    const replacements = main.metric_relabel_configs
      .filter((rule) => {
        return rule.target_label === "openstack_service";
      })
      .map((rule) => {
        return rule.replacement;
      });

    expect(replacements.sort()).toEqual(
      ["compute", "identity", "image", "network", "placement", "volume"].sort(),
    );
  });

  test("drops what it says wrongly, and what it costs nothing to read but a lot to keep", () => {
    const main = job("oneuptime-openstack-database-exporter");
    const dropped = main.metric_relabel_configs
      .filter((rule) => {
        return rule.action === "drop";
      })
      .map((rule) => {
        return new RegExp(`^(?:${rule.regex})$`);
      });
    const isDropped = (name) => {
      return dropped.some((regex) => {
        return regex.test(name);
      });
    };

    for (const name of [
      // Reads 1 for a service that is enabled, whether or not it is alive.
      "openstack_nova_agent_state",
      "openstack_nova_security_groups",
      "openstack_nova_server_local_gb",
      "openstack_neutron_port",
      "openstack_neutron_ports",
      "openstack_nova_quota_cores",
      "openstack_nova_limits_vcpus_max",
      "openstack_neutron_quota_port",
      "openstack_cinder_limits_volume_max_gb",
      "openstack_cinder_volume_type_quota_gigabytes",
    ]) {
      expect(isDropped(name)).toBe(true);
    }

    for (const name of [
      "openstack_nova_server_status",
      "openstack_nova_running_vms",
      "openstack_neutron_agent_state",
      "openstack_cinder_agent_state",
      "openstack_cinder_volume_gb",
      "openstack_placement_resource_total",
      "openstack_identity_project_info",
      "openstack_nova_up",
    ]) {
      expect(isDropped(name)).toBe(false);
    }
  });

  test("an instance is told which hypervisor it runs on, when the two names differ", () => {
    const main = job("oneuptime-openstack-database-exporter");
    const rule = main.metric_relabel_configs.find((candidate) => {
      return candidate.target_label === "hypervisor_hostname";
    });

    expect(rule.source_labels).toEqual(["__name__", "hypervisor_hostname"]);
    expect(rule.replacement).toBe(
      "$$1${env:OPENSTACK_DATABASE_EXPORTER_HOST_SUFFIX}",
    );
    // A rule that matched an instance with no host would name a host of just the suffix.
    expect(rule.regex).toBe("openstack_nova_server_status;(.+)");
  });

  test.each([
    ["oneuptime-openstack-worker-states", "compute", "openstack_nova_agent_state"],
    [
      "oneuptime-openstack-storage-pools",
      "volume",
      "openstack_cinder_pool_capacity_(free|total)_gb",
    ],
  ])(
    "%s reads only what the database cannot say, and a failed scrape of it says nothing of the API",
    (name, service, regex) => {
      const light = job(name);

      expect(light.params.include_services).toEqual([service]);
      expect(light.metric_relabel_configs[0]).toEqual({
        source_labels: ["__name__"],
        regex: regex,
        action: "keep",
      });

      /*
       * On the target, this label would be on the scrape's own `up` too, and ingest reads a failed
       * one as that whole API being down. On the datapoints it is on the series kept, and no more.
       */
      expect(light.static_configs[0].labels).toBeUndefined();
      expect(light.metric_relabel_configs[1]).toEqual({
        target_label: "openstack_service",
        replacement: service,
      });
    },
  );

  test("what reads Nova's workers and Cinder's pools reads nothing else of them", () => {
    expect(workers.profiles).toEqual(["openstack-database-exporter"]);

    const off = workers.command.filter((flag) => {
      return flag.startsWith("--disable-metric=");
    });

    for (const flag of [
      // Each names the series whose read fills the rest.
      "nova-total_vms",
      "nova-current_workload",
      "nova-flavors",
      "nova-availability_zones",
      "cinder-volumes",
      "cinder-snapshots",
      "cinder-backups",
      "cinder-agent_state",
    ]) {
      expect(off).toContain(`--disable-metric=${flag}`);
    }

    expect(workers.image).toBe(
      compose.services["openstack-exporter"].image,
    );
  });

  test("goes through the same pipeline as everything else", () => {
    expect(config.service.pipelines.metrics.receivers).toContain(
      "prometheus/database-exporter",
    );
  });
});
