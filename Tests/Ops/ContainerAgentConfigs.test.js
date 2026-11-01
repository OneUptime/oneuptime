"use strict";

/**
 * What the container agents' collector configs send, read from the parsed
 * YAML the collector loads.
 *
 * Docker Swarm. A Swarm monitor's Service Name and Node Name filters could
 * never match: the worker filtered on attributes no agent sent. The agent now
 * copies Swarm's own task labels onto each task's metrics - the receiver puts
 * them on the RESOURCE, beside the container's identity, so ingest stores
 * them `resource.`-prefixed, the keys the worker filters on
 * (MonitorTelemetryMonitorDockerSwarmFilters.test.ts) - and stamps the node's
 * name from DOCKER_SWARM_NODE_NAME, which install.sh writes
 * (ContainerAgentInstallers.test.js). Swarm labels a task with its node's ID
 * only. And still never `host.name`: with the `container.runtime=docker` the
 * receiver stamps on every container, that registers each node as a Docker
 * host of its own.
 *
 * Docker and Podman. Their images copy only the collector config onto the
 * upstream collector image, which has no shell: an entrypoint.sh and an
 * inventory poller sat beside the config and never ran, and the
 * `filelog/inventory` receiver tailed a file nothing wrote, while the docs
 * promised an inventory every 5 minutes. Every receiver now reads something
 * that exists, and every script in the agent's folder is one that runs.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const AGENTS = ["DockerAgent", "PodmanAgent", "DockerSwarmAgent"];

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function readConfig(agent) {
  return yaml.load(readRepoFile(`agents/${agent}/otel-collector-config.yaml`));
}

const SWARM_NODE_NAME_STATEMENTS = [
  {
    context: "resource",
    statements: [
      'set(attributes["docker.swarm.node.name"], "${env:DOCKER_SWARM_NODE_NAME}")',
      'delete_key(attributes, "docker.swarm.node.name") where attributes["docker.swarm.node.name"] == ""',
    ],
  },
];

describe("DockerSwarmAgent: each task's service and node", () => {
  const config = readConfig("DockerSwarmAgent");

  test("the receiver copies Swarm's service and node labels onto each task's metrics", () => {
    expect(
      config.receivers.docker_stats.container_labels_to_metric_labels,
    ).toEqual({
      "com.docker.swarm.service.name": "docker.swarm.service.name",
      "com.docker.swarm.node.id": "docker.swarm.node.id",
    });
  });

  test("the node's name is stamped from DOCKER_SWARM_NODE_NAME, and left off when that is empty", () => {
    expect(config.processors["transform/swarm-node-name"]).toEqual({
      error_mode: "ignore",
      metric_statements: SWARM_NODE_NAME_STATEMENTS,
      log_statements: SWARM_NODE_NAME_STATEMENTS,
    });
  });

  test("on the node's metrics and container logs, before the resource processor, and not on the cluster's inventory", () => {
    const pipelines = config.service.pipelines;

    for (const name of ["metrics", "logs"]) {
      const processors = pipelines[name].processors;
      expect({ name, processors }).toEqual({
        name,
        processors: expect.arrayContaining(["transform/swarm-node-name"]),
      });
      expect(processors.indexOf("transform/swarm-node-name")).toBeLessThan(
        processors.indexOf("resource"),
      );
    }

    expect(pipelines["logs/inventory"].processors).not.toContain(
      "transform/swarm-node-name",
    );
  });

  test("the keys the worker's Service Name and Node Name filters read are the keys the agent sends, resource.-prefixed", () => {
    const worker = readRepoFile(
      "packages/App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts",
    );
    const sent = [
      config.receivers.docker_stats.container_labels_to_metric_labels[
        "com.docker.swarm.service.name"
      ],
      "docker.swarm.node.name",
    ];

    for (const key of sent) {
      expect(worker).toContain(`attributes["resource.${key}"]`);
      expect(worker).not.toContain(`attributes["${key}"]`);
    }
  });

  test("never host.name, and no resourcedetection: the swarm's nodes are not Docker hosts", () => {
    const resourceKeys = config.processors.resource.attributes.map(
      (attribute) => {
        return attribute.key;
      },
    );

    expect(resourceKeys).toEqual([
      "docker.swarm.cluster.name",
      "oneuptime.agent.version",
    ]);
    expect(
      Object.keys(config.processors).filter((name) => {
        return name.startsWith("resourcedetection");
      }),
    ).toEqual([]);
    expect(JSON.stringify(config.processors)).not.toContain("host.name");
  });
});

describe.each(AGENTS)("%s: every receiver has a source", (agent) => {
  const config = readConfig(agent);
  const pipelines = config.service.pipelines;

  test("every receiver is in a pipeline, and every pipeline's receivers are defined", () => {
    const used = new Set(
      Object.values(pipelines).flatMap((pipeline) => {
        return pipeline.receivers;
      }),
    );

    expect([...used].sort()).toEqual(Object.keys(config.receivers).sort());
  });
});

describe.each(["DockerAgent", "PodmanAgent"])(
  "%s: no inventory that never runs",
  (agent) => {
    const config = readConfig(agent);

    test("no receiver tails an inventory snapshot, and no pipeline carries one", () => {
      expect(config.receivers["filelog/inventory"]).toBeUndefined();
      expect(config.service.pipelines["logs/inventory"]).toBeUndefined();
      expect(JSON.stringify(config.receivers)).not.toContain("inventory");
    });

    /*
     * The image is the upstream collector with the config copied in: it has
     * no shell, so a script beside the config runs only if the image is
     * built to run it. install.sh runs on the host.
     */
    test("every script in the agent's folder is install.sh or one the image copies in", () => {
      const dockerfile = readRepoFile(`agents/${agent}/Dockerfile.tpl`);
      const scripts = fs
        .readdirSync(path.join(REPO_ROOT, "agents", agent))
        .filter((name) => {
          return name.endsWith(".sh");
        });

      for (const script of scripts) {
        expect({
          script,
          runs:
            script === "install.sh" ||
            dockerfile.includes(`COPY ./agents/${agent}/${script} `),
        }).toEqual({ script, runs: true });
      }
    });
  },
);
