"use strict";

/**
 * The OpenStack agent's files, and the rig that records a real OpenStack with
 * them (Tests/Ops/openstack-e2e). What these pin is what monitoring an OpenStack
 * cloud must never get wrong:
 *
 *  - a failing service costs only its own series, so every OpenStack service has
 *    a scrape job of its own (openstack-exporter issue 660);
 *  - monitoring never hurts the cloud: the per-port list, which can saturate
 *    Neutron (issue 540), and the slow per-project metrics are off, and a scrape
 *    never outlasts its interval to stack on the next;
 *  - nothing floats: images are pinned, the exporter by digest;
 *  - the data reaches the cloud and not a phantom Service.
 *
 * The rig's scripts are bash and only run on a DevStack, so CI would otherwise
 * find a typo in them after half an hour of deploying.
 */

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const ROOT = path.resolve(__dirname, "..", "..");
const AGENT = path.join(ROOT, "agents", "OpenStackAgent");
const RIG = path.join(__dirname, "openstack-e2e");
const WORKFLOW = path.join(
  ROOT,
  ".github",
  "workflows",
  "test.openstack-e2e.yaml",
);

const read = (file) => {
  return fs.readFileSync(file, "utf8");
};

/*
 * Each project's quotas: slow to change and four API calls per project, so read once an hour.
 * An exporter reads the same things whichever job asks, so this takes an exporter of its own.
 */
describe("the agent's hourly read of each project's quotas", () => {
  const config = yaml.load(
    read(path.join(AGENT, "otel-collector-config.yaml")),
  );
  const jobs = config.receivers["prometheus/quotas"].config.scrape_configs;
  const compose = yaml.load(read(path.join(AGENT, "docker-compose.yml")));
  const exporter = compose.services["openstack-quota-exporter"];
  const main = compose.services["openstack-exporter"];
  const flagsOf = (service) => {
    return service.command.filter((flag) => {
      return flag.startsWith("--disable-metric=");
    });
  };
  const seconds = (value) => {
    return Number.parseInt(value, 10);
  };

  test("is a job per service, as the rest are, because one service failing costs only its own", () => {
    expect(
      jobs
        .map((job) => {
          return job.params.include_services;
        })
        .flat()
        .sort(),
    ).toEqual(["compute", "network", "volume"]);
    expect(
      jobs.map((job) => {
        return job.job_name;
      }),
    ).toEqual([
      "oneuptime-openstack-quotas-compute",
      "oneuptime-openstack-quotas-network",
      "oneuptime-openstack-quotas-volume",
    ]);
  });

  test("reads once an hour, and no read runs into the next", () => {
    for (const job of jobs) {
      expect(seconds(job.scrape_interval)).toBe(3600);
      expect(seconds(job.scrape_timeout)).toBeLessThan(
        seconds(job.scrape_interval),
      );
    }
  });

  test("is three of the readings the stale rule and the alert's window wait for", () => {
    // Common/Types/OpenStack/OpenStackQuota.ts: OPENSTACK_QUOTA_STALE_MINUTES.
    const quota = read(
      path.join(ROOT, "packages/Common/Types/OpenStack/OpenStackQuota.ts"),
    );
    expect(quota).toContain("OPENSTACK_QUOTA_STALE_MINUTES: number = 180");
    expect(
      (seconds(jobs[0].scrape_interval) * 3) / 60,
    ).toBe(180);
  });

  test("asks an exporter of its own, for each region, and nothing until someone turns it on", () => {
    for (const job of jobs) {
      expect(job.metrics_path).toBe("/probe");
      expect(job.static_configs[0].targets).toBe(
        "${env:OPENSTACK_QUOTA_CLOUDS}",
      );
      expect(job.relabel_configs).toEqual(
        expect.arrayContaining([
          {
            source_labels: ["__address__"],
            target_label: "__param_cloud",
          },
          {
            source_labels: ["__param_cloud"],
            target_label: "openstack_region",
          },
          {
            target_label: "__address__",
            replacement: "${env:OPENSTACK_QUOTA_EXPORTER_ADDRESS}",
          },
        ]),
      );
    }
    expect(compose.services["oneuptime-openstack-agent"].environment).toEqual(
      expect.arrayContaining([
        "OPENSTACK_QUOTA_CLOUDS=${OPENSTACK_QUOTA_CLOUDS:-[]}",
        "OPENSTACK_QUOTA_EXPORTER_ADDRESS=${OPENSTACK_QUOTA_EXPORTER_ADDRESS:-openstack-quota-exporter:9180}",
      ]),
    );
  });

  test("a service an agent is told not to read, it does not read the quotas of either", () => {
    for (const job of jobs) {
      expect(job.relabel_configs[0]).toEqual({
        source_labels: ["openstack_quota_service"],
        regex: "${env:OPENSTACK_AGENT_SERVICES}",
        action: "keep",
      });
    }
  });

  /*
   * The scan reads a failed scrape's `up`, with its service, as that service's API being down.
   * So a read of one project's limits failing must not carry the service on its `up`:
   * metric_relabel_configs leave the scrape's own series alone, and the target's labels do not.
   */
  test("a failed read never says the service is down", () => {
    for (const job of jobs) {
      expect(job.static_configs[0].labels.openstack_service).toBeUndefined();
      expect(job.relabel_configs).toEqual(
        expect.arrayContaining([
          { regex: "openstack_quota_service", action: "labeldrop" },
        ]),
      );
      expect(job.metric_relabel_configs[1]).toEqual({
        target_label: "openstack_service",
        replacement: job.params.include_services[0],
      });
    }
  });

  test("keeps the quota series alone, and never a service's _up", () => {
    const keptBy = (service) => {
      return new RegExp(
        `^(?:${
          jobs.find((job) => {
            return job.params.include_services[0] === service;
          }).metric_relabel_configs[0].regex
        })$`,
      );
    };

    for (const [service, name] of [
      ["compute", "openstack_nova_limits_vcpus_max"],
      ["compute", "openstack_nova_limits_memory_used"],
      ["network", "openstack_neutron_quota_network"],
      ["network", "openstack_neutron_quota_floatingip"],
      ["volume", "openstack_cinder_limits_volume_max_gb"],
      ["volume", "openstack_cinder_limits_backup_used_gb"],
      ["volume", "openstack_cinder_volume_type_quota_gigabytes"],
    ]) {
      expect({ name, kept: keptBy(service).test(name) }).toEqual({
        name,
        kept: true,
      });
    }

    for (const [service, name] of [
      ["compute", "openstack_nova_up"],
      ["network", "openstack_neutron_up"],
      ["volume", "openstack_cinder_up"],
      ["compute", "openstack_nova_agent_state"],
      ["network", "openstack_neutron_agent_state"],
      ["volume", "openstack_cinder_volume_gb"],
    ]) {
      expect({ name, kept: keptBy(service).test(name) }).toEqual({
        name,
        kept: false,
      });
    }
  });

  test("goes down the metrics pipeline, so it is stamped and sent like everything else", () => {
    expect(config.service.pipelines.metrics.receivers).toContain(
      "prometheus/quotas",
    );
  });

  test("the main exporter still leaves them out, or they would be read every two minutes too", () => {
    expect(flagsOf(main)).toEqual(
      expect.arrayContaining([
        "--disable-metric=nova-limits_vcpus_max",
        "--disable-metric=neutron-quota_network",
        "--disable-metric=cinder-limits_volume_max_gb",
      ]),
    );
  });

  test("its own exporter leaves them on, and starts only when asked", () => {
    expect(exporter.profiles).toEqual(["openstack-quotas"]);
    expect(exporter.image).toBe(main.image);
    for (const flag of [
      "--disable-metric=nova-limits_vcpus_max",
      "--disable-metric=neutron-quota_network",
      "--disable-metric=cinder-limits_volume_max_gb",
    ]) {
      expect(flagsOf(exporter)).not.toContain(flag);
    }
  });

  /*
   * What a read costs: from the pinned exporter's source (exporters/{nova,neutron,cinder}.go), every
   * entry with a read of its own, by the name its flag takes. Turning off a series that only hangs
   * from a read leaves the read running, and at this revision that panics, so these are the
   * reads. Whatever it does not turn off here it reads on every hourly scrape.
   */
  test("turns off every read but the three quotas, by the series that reads it", () => {
    const reads = {
      compute: [
        "nova-flavors",
        "nova-availability_zones",
        "nova-security_groups",
        "nova-total_vms",
        "nova-agent_state",
        "nova-running_vms",
        "nova-server_local_gb",
        "nova-quota_cores",
      ],
      network: [
        "neutron-floating_ips",
        "neutron-networks",
        "neutron-security_groups",
        "neutron-subnets",
        "neutron-port",
        "neutron-ports",
        "neutron-ports_no_ips",
        "neutron-ports_lb_not_active",
        "neutron-routers",
        "neutron-vpn_endpoint_groups",
        "neutron-vpn_ike_policies",
        "neutron-vpn_ipsec_policies",
        "neutron-vpn_services",
        "neutron-vpn_siteconnections",
        "neutron-agent_state",
        "neutron-network_ip_availabilities_total",
        "neutron-subnets_total",
      ],
      volume: [
        "cinder-volumes",
        "cinder-snapshots",
        "cinder-agent_state",
        "cinder-volume_status",
        "cinder-pool_capacity_free_gb",
      ],
    };

    expect(flagsOf(exporter).sort()).toEqual(
      Object.values(reads)
        .flat()
        .map((name) => {
          return `--disable-metric=${name}`;
        })
        .sort(),
    );
  });

  test("without Docker, its unit is started with those same flags", () => {
    const unit = read(
      path.join(
        AGENT,
        "systemd",
        "oneuptime-openstack-quota-exporter-native.service",
      ),
    );

    for (const flag of flagsOf(exporter)) {
      expect(unit).toContain(` ${flag}`);
    }
    expect(unit).toContain("--web.listen-address=127.0.0.1:9182");
    expect(
      read(
        path.join(
          AGENT,
          "systemd",
          "oneuptime-openstack-agent-native.service",
        ),
      ),
    ).toEqual(
      expect.stringContaining(
        "Environment=OPENSTACK_QUOTA_EXPORTER_ADDRESS=127.0.0.1:9182",
      ),
    );
  });

  test("the rig records it with the flags that ship", () => {
    const rig = read(path.join(RIG, "quota-record.sh"));

    expect(rig).toContain(
      "sed -n '/^  openstack-quota-exporter:$/,/^  [a-z-]*:$/p'",
    );
    expect(rig).toContain("otel-collector-config.yaml");
    expect(read(WORKFLOW)).toContain("Tests/Ops/openstack-e2e/quota-record.sh");
  });
});

describe("the OpenStack agent's collector config", () => {
  const config = yaml.load(
    read(path.join(AGENT, "otel-collector-config.yaml")),
  );
  const jobs = config.receivers.prometheus.config.scrape_configs;
  const includeServicesOf = (job) => {
    return job.params.include_services;
  };

  test("gives every core OpenStack service a scrape job of its own", () => {
    const services = jobs.map(includeServicesOf);
    for (const included of services) {
      expect(included).toHaveLength(1);
      // A comma would put two services back in one failure.
      expect(included[0]).not.toContain(",");
    }
    expect(services.flat().sort()).toEqual(
      ["compute", "identity", "image", "network", "placement", "volume"].sort(),
    );
  });

  test("no scrape can run into the next one", () => {
    const seconds = (value) => {
      return Number.parseInt(value, 10);
    };
    for (const job of jobs) {
      expect(seconds(job.scrape_timeout)).toBeLessThan(
        seconds(job.scrape_interval),
      );
      // Every scrape logs in to Keystone and walks real APIs.
      expect(seconds(job.scrape_interval)).toBeGreaterThanOrEqual(60);
    }
  });

  test("asks the exporter for each configured cloud, and scrapes the exporter", () => {
    for (const job of jobs) {
      expect(job.metrics_path).toBe("/probe");
      expect(job.static_configs[0].targets).toBe(
        "${env:OPENSTACK_EXPORTER_CLOUDS}",
      );
      expect(job.relabel_configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source_labels: ["__address__"],
            target_label: "__param_cloud",
          }),
          expect.objectContaining({
            target_label: "__address__",
            replacement: "${env:OPENSTACK_EXPORTER_ADDRESS}",
          }),
        ]),
      );
    }
  });

  test("says which service and region each series is from, which the exporter does not", () => {
    for (const job of jobs) {
      expect(job.static_configs[0].labels.openstack_service).toBe(
        job.params.include_services[0],
      );
      expect(job.relabel_configs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source_labels: ["__param_cloud"],
            target_label: "openstack_region",
          }),
        ]),
      );
    }
    const statements = JSON.stringify(
      config.processors["transform/openstack-identity"],
    );
    expect(statements).toContain('attributes[\\"openstack_region\\"]');
    expect(statements).toContain("delete_key");
  });

  test("stamps the cloud and never registers a phantom Service", () => {
    const attributes = config.processors.resource.attributes;
    expect(attributes).toEqual(
      expect.arrayContaining([
        {
          key: "openstack.cloud.name",
          value: "${env:OPENSTACK_CLOUD_NAME}",
          action: "upsert",
        },
        { key: "service.name", action: "delete" },
        { key: "service.instance.id", action: "delete" },
      ]),
    );
  });

  test("runs the processors that say which cloud and region a series is from", () => {
    expect(config.service.pipelines.metrics.processors).toEqual([
      "memory_limiter",
      "transform/openstack-identity",
      "resource",
      "batch",
    ]);
    expect(
      JSON.stringify(config.processors["transform/openstack-identity"]),
    ).toContain("openstack.region.name");
  });
});

describe("the OpenStack agent's compose file", () => {
  const compose = yaml.load(read(path.join(AGENT, "docker-compose.yml")));
  const exporter = compose.services["openstack-exporter"];

  test("pins the exporter by version and digest", () => {
    expect(exporter.image).toMatch(
      /^ghcr\.io\/openstack-exporter\/openstack-exporter:[^@:]+@sha256:[0-9a-f]{64}$/,
    );
    expect(exporter.image).not.toContain(":latest");
  });

  test("keeps the exporter gentle by default", () => {
    expect(exporter.command).toContain("--multi-cloud");
    expect(
      exporter.command.filter((flag) => {
        return flag.startsWith("--disable");
      }),
    ).toEqual([
      // One call per project, on each scrape.
      "--disable-metric=nova-quota_cores",
      "--disable-metric=nova-limits_vcpus_max",
      "--disable-metric=nova-server_local_gb",
      "--disable-metric=neutron-quota_network",
      "--disable-metric=cinder-limits_volume_max_gb",
      // Every port in the cloud, which can saturate Neutron (issue 540).
      "--disable-metric=neutron-ports",
      "--disable-metric=neutron-port",
      "--disable-metric=neutron-ports_no_ips",
      "--disable-metric=neutron-ports_lb_not_active",
      // Many series saying what the address pools already say.
      "--disable-metric=neutron-subnets_total",
      // A route Nova no longer has, which only fills the exporter's log.
      "--disable-metric=nova-security_groups",
    ]);
  });

  test("leaves each read out by name: --disable-slow-metrics also takes the image list the Images page reads", () => {
    expect(exporter.command).not.toContain("--disable-slow-metrics");
  });

  test("mounts the credential read-only", () => {
    expect(exporter.volumes).toContain(
      "./clouds.yaml:/etc/openstack/clouds.yaml:ro",
    );
  });
});

describe("the access the agent asks for", () => {
  const policyDir = path.join(AGENT, "access", "policy");

  test.each(fs.readdirSync(policyDir))(
    "%s only adds the monitoring role to rules, keeping each default",
    (file) => {
      const policy = yaml.load(read(path.join(policyDir, file)));
      const rules = Object.entries(policy);
      expect(rules.length).toBeGreaterThan(0);
      for (const [name, rule] of rules) {
        expect(rule).toContain("role:oneuptime_monitoring");
        // Widening one of these makes the role an admin of that service.
        expect(name).not.toMatch(/context_is_admin|admin_required|admin_only/);
        // A rule that reads is the only kind this role may be given.
        expect(name).not.toMatch(
          /:(create|update|delete|set|add|remove)\b|^(create|update|delete)_/,
        );
      }
    },
  );

  test("application credential access rules only ever read", () => {
    const rules = JSON.parse(
      read(
        path.join(AGENT, "access", "application-credential-access-rules.json"),
      ),
    );
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.method).toBe("GET");
      expect(Object.keys(rule).sort()).toEqual(["method", "path", "service"]);
    }
  });
});

describe("the recording rig", () => {
  const workflow = yaml.load(read(WORKFLOW));

  test("limits its token and pins the action that deploys DevStack", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    const deploy = workflow.jobs.record.steps.find((step) => {
      return step.name === "Deploy DevStack";
    });
    expect(deploy.uses).toMatch(/^gophercloud\/devstack-action@[0-9a-f]{40}$/);
  });

  test("never runs on every pull request", () => {
    expect(Object.keys(workflow.on).sort()).toEqual([
      "pull_request",
      "schedule",
      "workflow_dispatch",
    ]);
    expect(workflow.on.pull_request.paths).toEqual(
      expect.arrayContaining(["agents/OpenStackAgent/**"]),
    );
  });

  test("records both network backends", () => {
    const entries = workflow.jobs.record.strategy.matrix.include;
    expect(
      entries.some((entry) => {
        return /-ovn$/.test(entry.name);
      }),
    ).toBe(true);
    expect(
      entries.some((entry) => {
        return /-ovs$/.test(entry.name);
      }),
    ).toBe(true);
  });

  test("runs only scripts that exist", () => {
    const scripts = workflow.jobs.record.steps
      .map((step) => {
        return step.run || "";
      })
      .join("\n")
      .match(/Tests\/Ops\/openstack-e2e\/[a-z-]+\.sh/g);
    expect(scripts.length).toBeGreaterThanOrEqual(5);
    for (const script of scripts) {
      expect(fs.existsSync(path.join(ROOT, script))).toBe(true);
    }
  });

  test.each(
    fs.readdirSync(RIG).filter((file) => {
      return file.endsWith(".sh");
    }),
  )("%s parses, and stops at its first failure", (file) => {
    const script = path.join(RIG, file);
    childProcess.execFileSync("bash", ["-n", script]);
    expect(read(script)).toMatch(/^set -[eu]+o? ?(pipefail)?/m);
  });

  test("start-agent.sh tests the images the agent ships, not a copy of them", () => {
    const script = read(path.join(RIG, "start-agent.sh"));
    expect(script).toContain('"$AGENT_DIR/docker-compose.yml"');
    expect(script).toContain("otel-collector-config.yaml");
    // The exporter is started as the compose file starts it: the flags are read
    // from that file, so run the line that reads them and see what it reads.
    const compose = yaml.load(read(path.join(AGENT, "docker-compose.yml")));
    const flags = compose.services["openstack-exporter"].command.filter(
      (flag) => {
        return flag.startsWith("--disable");
      },
    );
    const line = script.match(/^EXPORTER_FLAGS=.*$/m);
    expect(line).not.toBeNull();
    expect(script).toMatch(/^\s+\$EXPORTER_FLAGS$/m);
    const readFlags = childProcess.execFileSync(
      "bash",
      ["-c", `${line[0]}\nprintf '%s' "$EXPORTER_FLAGS"`],
      { env: { ...process.env, AGENT_DIR: AGENT }, encoding: "utf8" },
    );
    expect(readFlags.trim().split(" ")).toEqual(flags);
  });

  test.each(["start-agent.sh", "control-plane-clusters.sh"])(
    "%s starts the collector with every variable its config reads",
    (name) => {
      // A collector missing one refuses its config and exits as it starts, and a run
      // only learns that at its end, from a recording with no OTLP in it.
      const config = read(path.join(AGENT, "otel-collector-config.yaml"));
      const readByConfig = [
        ...new Set(
          [...config.matchAll(/\$\{env:([A-Z0-9_]+)\}/g)].map((match) => {
            return match[1];
          }),
        ),
      ];
      expect(readByConfig.length).toBeGreaterThan(10);
      const script = read(path.join(RIG, name));
      const missing = readByConfig.filter((variable) => {
        return !new RegExp(`-e '?"?${variable}\\b`).test(script);
      });
      expect(missing).toEqual([]);
    },
  );

  test("a recording survives a step that ran out of time", () => {
    const workflow = yaml.load(read(WORKFLOW));
    const steps = workflow.jobs.record.steps;
    const logs = steps.find((step) => {
      return step.run === "bash Tests/Ops/openstack-e2e/logs-record.sh";
    });
    expect(logs["continue-on-error"]).toBe(true);
    expect(logs["timeout-minutes"]).toBeLessThan(
      workflow.jobs.record["timeout-minutes"] / 2,
    );
    const names = steps.findIndex((step) => {
      return String(step.run).includes("safe-artifact-names.sh");
    });
    const upload = steps.findIndex((step) => {
      return step.name === "Upload the recordings";
    });
    expect(names).toBeGreaterThan(-1);
    expect(names).toBeLessThan(upload);
    expect(steps[names].if).toBe("always()");
    expect(steps[names].run).toContain("chown -R");
  });

  test("the recording only replaces where the data goes", () => {
    const recording = yaml.load(
      read(path.join(RIG, "collector-recording.yaml")),
    );
    expect(recording.service.pipelines.metrics).toEqual({
      exporters: ["file/recording"],
    });
    expect(Object.keys(recording).sort()).toEqual(["exporters", "service"]);
  });

  test("access-matrix.py fails the run if a recommended credential can write", () => {
    const script = read(path.join(RIG, "access-matrix.py"));
    expect(script).toContain('name.startswith("monitoring")');
    expect(script).toContain("raise SystemExit(1)");
    childProcess.execFileSync("python3", [
      "-I",
      "-c",
      `import ast,sys; ast.parse(open(${JSON.stringify(path.join(RIG, "access-matrix.py"))}).read())`,
    ]);
  });
});
