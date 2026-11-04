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

describe("the OpenStack agent's collector config", () => {
  const config = yaml.load(read(path.join(AGENT, "otel-collector-config.yaml")));
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
    expect(exporter.command).toEqual(
      expect.arrayContaining([
        "--multi-cloud",
        "--disable-slow-metrics",
        "--disable-metric=neutron-ports",
        "--disable-metric=neutron-port",
        "--disable-metric=neutron-ports_no_ips",
        "--disable-metric=neutron-ports_lb_not_active",
      ]),
    );
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
        path.join(
          AGENT,
          "access",
          "application-credential-access-rules.json",
        ),
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
    // The exporter is started as the compose file starts it.
    const compose = yaml.load(read(path.join(AGENT, "docker-compose.yml")));
    for (const flag of compose.services["openstack-exporter"].command) {
      if (flag.startsWith("--disable")) {
        expect(script).toContain(flag);
      }
    }
  });

  test("the recording only replaces where the data goes", () => {
    const recording = yaml.load(read(path.join(RIG, "collector-recording.yaml")));
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
