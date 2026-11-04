"use strict";

/**
 * Reading what an OpenStack cloud stands on: the agent's optional scrape jobs, and the
 * helper that names their targets on Kolla-Ansible.
 *
 * Nothing here needs a cloud or a daemon. control-plane-targets.py runs for real over a
 * file rendered from Kolla-Ansible's own template. `otelcol validate`
 * (validate-collector-configs.sh) proves the collector builds each shape, and what each
 * exporter really says is in packages/Common/Tests/Fixtures/OpenStack/control-plane.
 *
 * What it must never get wrong:
 *  - with nothing named, nothing is scraped, and the rest of the agent is untouched;
 *  - Alertmanager's own address, which is also under `targets:`, is no exporter;
 *  - a series reaches OneUptime saying which dependency and which machine it is about,
 *    because the prometheus receiver takes job and instance off every datapoint.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const AGENT_DIR = path.join(REPO_ROOT, "agents", "OpenStackAgent");
const HELPER = path.join(AGENT_DIR, "control-plane-targets.py");

function agentFile(...parts) {
  return fs.readFileSync(path.join(AGENT_DIR, ...parts), "utf8");
}

/*
 * ansible/roles/prometheus/templates/prometheus.yml.j2 at Kolla-Ansible master, rendered by
 * hand for three controllers and two compute nodes, down to its quoting and its `labels:`.
 */
const RENDERED_BY_KOLLA = `global:
  scrape_interval: 60s
  scrape_timeout: 10s
  evaluation_interval: 60s
  external_labels:
    monitor: 'kolla'

rule_files:
  - "/etc/prometheus/*.rules"

scrape_configs:
  - job_name: prometheus
    basic_auth:
      username: admin
      password: secret
    static_configs:
      - targets:
        - '10.0.0.11:9091'
  - job_name: node
    static_configs:
      - targets:
        - '10.0.0.11:9100'
        labels:
          instance: "ctl1"
      - targets:
        - '10.0.0.21:9100'
  - job_name: mysqld
    static_configs:
      - targets:
        - '10.0.0.11:9104'
      - targets:
        - '10.0.0.12:9104'
      - targets:
        - '10.0.0.13:9104'
  - job_name: haproxy
    static_configs:
      - targets:
        - '10.0.0.11:9101'
      - targets:
        - '10.0.0.12:9101'
  - job_name: rabbitmq
    static_configs:
      - targets:
        - '10.0.0.11:15692'
      - targets:
        - '10.0.0.12:15692'
      - targets:
        - '10.0.0.13:15692'
  - job_name: memcached
    static_configs:
      - targets:
        - '10.0.0.11:9150'
      - targets:
        - '10.0.0.12:9150'
  - job_name: openstack_exporter
    scrape_interval: 60s
    scrape_timeout: 45s
    honor_labels: true
    static_configs:
      - targets:
        - '10.0.0.254:9198'
  - job_name: libvirt_exporter
    scrape_interval: 60s
    honor_labels: true
    static_configs:
      - targets:
        - '10.0.0.21:9177'
      - targets:
        - '10.0.0.22:9177'
  - job_name: network_exporter
    scrape_interval: 60s
    static_configs:
      - targets:
        - '10.0.0.21:1981'
      - targets:
        - '10.0.0.22:1981'
  - job_name: alertmanager
    static_configs:
      - targets:
        - '10.0.0.11:9093'

alerting:
  alertmanagers:
    - static_configs:
      - targets:
        - '10.0.0.11:9093'
`;

function runHelper(input, args = ["--region", "RegionOne"]) {
  return spawnSync("python3", ["-I", HELPER, ...args], {
    input,
    encoding: "utf8",
    timeout: 60000,
  });
}

function settings(output) {
  const found = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      found[match[1]] = match[2];
    }
  }
  return found;
}

describe("control-plane-targets.py, over the file Kolla-Ansible renders", () => {
  test("prints each exporter's targets as a setting the agent reads", () => {
    const run = runHelper(RENDERED_BY_KOLLA);

    expect(run.status).toBe(0);
    expect(settings(run.stdout)).toEqual({
      OPENSTACK_CONTROL_PLANE_REGION: "RegionOne",
      OPENSTACK_RABBITMQ_TARGETS:
        "[10.0.0.11:15692,10.0.0.12:15692,10.0.0.13:15692]",
      OPENSTACK_MARIADB_TARGETS: "[10.0.0.11:9104,10.0.0.12:9104,10.0.0.13:9104]",
      OPENSTACK_MEMCACHED_TARGETS: "[10.0.0.11:9150,10.0.0.12:9150]",
      OPENSTACK_HAPROXY_TARGETS: "[10.0.0.11:9101,10.0.0.12:9101]",
      OPENSTACK_NETWORK_EXPORTER_TARGETS: "[10.0.0.21:1981,10.0.0.22:1981]",
      OPENSTACK_LIBVIRT_HEALTH_TARGETS: "[10.0.0.21:9177,10.0.0.22:9177]",
    });
  });

  test("Alertmanager's address never lands on the job before it", () => {
    const run = runHelper(
      RENDERED_BY_KOLLA.replace(/ {2}- job_name: alertmanager[\s\S]*?\n\n/, "\n"),
    );

    expect(settings(run.stdout).OPENSTACK_NETWORK_EXPORTER_TARGETS).toBe(
      "[10.0.0.21:1981,10.0.0.22:1981]",
    );
    expect(run.stdout).not.toContain("9093");
  });

  test("its own exporter is only offered, with what reading it costs", () => {
    const run = runHelper(RENDERED_BY_KOLLA);

    expect(settings(run.stdout).OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS).toBe(
      undefined,
    );
    expect(run.stdout).toContain(
      "# OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=[10.0.0.254:9198]",
    );
    expect(run.stdout).toContain("# OPENSTACK_EXPORTER_CLOUDS=[]");
    expect(run.stdout).toContain("exporter 1.7.0");
  });

  test("a job it does not have is said to be missing, and nothing else is invented", () => {
    const run = runHelper(
      RENDERED_BY_KOLLA.replace(
        / {2}- job_name: network_exporter[\s\S]*?(?= {2}- job_name: alertmanager)/,
        "",
      ),
    );

    expect(settings(run.stdout).OPENSTACK_NETWORK_EXPORTER_TARGETS).toBe(
      undefined,
    );
    expect(run.stdout).toContain(
      "# OPENSTACK_NETWORK_EXPORTER_TARGETS: Kolla-Ansible's Prometheus has no network_exporter job.",
    );
  });

  test("an IPv6 target goes in quotes, as install.sh writes it", () => {
    const run = runHelper(`scrape_configs:
  - job_name: rabbitmq
    static_configs:
      - targets:
        - '[fd00::11]:15692'
      - targets:
        - '[fd00::12]:15692'
`);

    expect(settings(run.stdout).OPENSTACK_RABBITMQ_TARGETS).toBe(
      '["[fd00::11]:15692","[fd00::12]:15692"]',
    );
    // And that is a list of two for the collector, which reads it as YAML.
    expect(
      yaml.load(settings(run.stdout).OPENSTACK_RABBITMQ_TARGETS),
    ).toEqual(["[fd00::11]:15692", "[fd00::12]:15692"]);
  });

  test("a list written on one line is read too", () => {
    const run = runHelper(`scrape_configs:
  - job_name: mysqld
    static_configs:
      - targets: ['10.0.0.11:9104', "10.0.0.12:9104"]
`);

    expect(settings(run.stdout).OPENSTACK_MARIADB_TARGETS).toBe(
      "[10.0.0.11:9104,10.0.0.12:9104]",
    );
  });

  test("the region is only written when it was given", () => {
    const run = runHelper(RENDERED_BY_KOLLA, []);

    expect(run.status).toBe(0);
    expect(settings(run.stdout).OPENSTACK_CONTROL_PLANE_REGION).toBe(undefined);
  });

  test("anything else stops it, with the reason", () => {
    const run = runHelper("not a prometheus file\n");

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("No scrape jobs found");
  });

  test("uses only the standard library, because it runs on a controller", () => {
    const imports = Array.from(
      agentFile("control-plane-targets.py").matchAll(/^import (\w+)$/gm),
    ).map((match) => {
      return match[1];
    });

    expect(imports.sort()).toEqual(["argparse", "re", "sys"]);
  });

  test("can be run as it comes", () => {
    expect(fs.statSync(HELPER).mode & 0o111).not.toBe(0);
    expect(agentFile("control-plane-targets.py").split("\n")[0]).toBe(
      "#!/usr/bin/env python3",
    );
  });
});

describe("the collector's jobs for what the cloud stands on", () => {
  const config = yaml.load(agentFile("otel-collector-config.yaml"));
  const jobs = config.receivers["prometheus/control-plane"].config.scrape_configs;

  const JOBS = {
    "oneuptime-openstack-rabbitmq": ["rabbitmq", "OPENSTACK_RABBITMQ_TARGETS"],
    "oneuptime-openstack-mariadb": ["mariadb", "OPENSTACK_MARIADB_TARGETS"],
    "oneuptime-openstack-memcached": ["memcached", "OPENSTACK_MEMCACHED_TARGETS"],
    "oneuptime-openstack-haproxy": ["haproxy", "OPENSTACK_HAPROXY_TARGETS"],
    "oneuptime-openstack-network-exporter": [
      "network",
      "OPENSTACK_NETWORK_EXPORTER_TARGETS",
    ],
    "oneuptime-openstack-libvirt-health": [
      "libvirt",
      "OPENSTACK_LIBVIRT_HEALTH_TARGETS",
    ],
  };

  function jobNamed(name) {
    return jobs.find((job) => {
      return job.job_name === name;
    });
  }

  test("has one per dependency, each with its own list and nothing else", () => {
    expect(
      jobs.map((job) => {
        return job.job_name;
      }),
    ).toEqual(Object.keys(JOBS));

    for (const [name, [dependency, variable]] of Object.entries(JOBS)) {
      const staticConfig = jobNamed(name).static_configs[0];

      expect(staticConfig.targets).toBe(`\${env:${variable}}`);
      expect(staticConfig.labels.openstack_dependency).toBe(dependency);
      expect(staticConfig.labels.openstack_region).toBe(
        "${env:OPENSTACK_CONTROL_PLANE_REGION}",
      );
    }
  });

  test("collects once a minute, and no scrape can run into the next", () => {
    for (const job of jobs) {
      expect(job.scrape_interval).toBe("60s");
      expect(Number.parseInt(job.scrape_timeout, 10)).toBeLessThan(60);
    }
  });

  test("keeps only the series something reads, on every job", () => {
    for (const job of jobs) {
      const keep = job.metric_relabel_configs.find((rule) => {
        return rule.action === "keep" || rule.action === undefined;
      });

      expect(keep).toBeDefined();
      expect(keep.source_labels).toEqual(["__name__"]);
    }
  });

  test("says which machine a series is about, and lets a target say its own region", () => {
    const rules = jobNamed("oneuptime-openstack-rabbitmq").relabel_configs;
    const region = rules.find((rule) => {
      return rule.target_label === "openstack_region";
    });
    const host = rules.find((rule) => {
      return rule.target_label === "openstack_exporter_host";
    });

    expect(region).toBeDefined();
    expect(host).toBeDefined();

    // A target with a region: RE2 and JavaScript read this one the same.
    const named = new RegExp(`^(?:${region.regex})$`).exec(
      "RegionTwo@10.1.0.11:15692",
    );

    expect(named[1]).toBe("RegionTwo");
    expect(named[2]).toBe("10.1.0.11:15692");
    expect(new RegExp(`^(?:${region.regex})$`).test("10.0.0.11:15692")).toBe(
      false,
    );
  });

  test("nothing named is nothing scraped: the empty list is the default everywhere", () => {
    const compose = agentFile("docker-compose.yml");
    const native = agentFile(
      "systemd",
      "oneuptime-openstack-agent-native.service",
    );

    for (const [, variable] of Object.values(JOBS)) {
      expect(compose).toContain(`${variable}=\${${variable}:-[]}`);
      expect(native).toContain(`Environment=${variable}=[]`);
    }
    expect(compose).toContain(
      "OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS=${OPENSTACK_SINGLE_CLOUD_EXPORTER_TARGETS:-[]}",
    );
  });

  test("an exporter's counters also go out as how much each grew, stamped like the rest", () => {
    const pipelines = config.service.pipelines;

    expect(pipelines.metrics.receivers).toEqual(
      expect.arrayContaining([
        "prometheus/control-plane",
        "prometheus/single-cloud-exporter",
        "forward/control-plane-increases",
      ]),
    );
    expect(pipelines["metrics/control-plane-increases"].exporters).toEqual([
      "forward/control-plane-increases",
    ]);
    expect(pipelines.metrics.processors).toContain("resource");
    expect(pipelines.metrics.processors).toContain("transform/openstack-identity");
  });

  test("the single-cloud job gives up before Kolla-Ansible's HAProxy does, and asks no more than the bundled exporter", () => {
    const job = config.receivers["prometheus/single-cloud-exporter"].config
      .scrape_configs[0];

    expect(job.job_name).toBe("oneuptime-openstack-single-cloud-exporter");
    expect(Number.parseInt(job.scrape_timeout, 10)).toBeLessThan(45);
    expect(job.scrape_interval).toBe("120s");
    expect(job.metrics_path === undefined || job.metrics_path === "/metrics").toBe(
      true,
    );
  });
});

describe("validate-collector-configs.sh runs each shape a guide leaves behind", () => {
  const script = fs.readFileSync(
    path.join(__dirname, "validate-collector-configs.sh"),
    "utf8",
  );

  test.each([
    "OpenStackAgent / Kolla-Ansible's exporter, as its guide leaves it",
    "OpenStackAgent / nothing under the cloud named",
    "OpenStackAgent / IPv6 targets, as control-plane-targets.py writes them",
  ])("%s", (label) => {
    expect(script).toContain(`validate "${label}"`);
  });
});
