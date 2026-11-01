"use strict";

/**
 * Container restarts, as the Kubernetes agent sends them.
 *
 * The cluster collector's k8s_cluster receiver sends k8s.container.restarts,
 * the container status' restartCount, as an int GAUGE on the container's own
 * resource, which is keyed by container.id. The kubelet runs every restart
 * as a new container - a new ID, the count one higher - and a container
 * waiting in its back-off keeps the exited one's ID and count. OneUptime's
 * CrashLoopBackOff Detection template used to take the count's growth
 * between two samples of the SAME minute (a monitor cannot take the
 * difference of values in different minutes), so a restart between the last
 * sample of one minute and the first of the next was never counted.
 *
 * So the chart sends k8s.container.restarts.increase from a pipeline of its
 * own (metrics/restarts-increase): k8s.container.restarts alone, renamed,
 * container.id taken off, the gauge made a cumulative sum, and
 * cumulative_to_delta turning it into the restarts since the previous sample
 * of the same pod and container; the template sums it. Keyed by container.id
 * the same processors would never see a count move.
 *
 * The receiver puts no workload name on a container's resource: the
 * cluster's other container metrics get theirs from k8sattributes in the
 * metrics pipeline. So the restarts pipeline hands its increases to the
 * metrics pipeline (the forward/restarts-increase connector), where the same
 * k8sattributes gives them the same names - after the conversion, so a
 * restart is still counted in the pod's series, whatever k8sattributes
 * found.
 *
 * tests/restarts-increase_test.yaml in the chart holds the render to that.
 * This suite holds agent-restarts-increase-behaviour.sh - which runs the
 * rendered processors, the connector and the metrics pipeline in the
 * collector the chart pins and in 0.96.0 - to the same arithmetic, to what
 * the receiver, the kubelet and k8sattributes send, and to the chart's
 * pipelines, and holds its check to the export it must pass and the ones it
 * must not.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const behaviour = require("./Utils/KubernetesAgentRestartsIncreaseBehaviour");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEPLOYMENT_TEMPLATE =
  "HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml";
const WORKFLOW = ".github/workflows/test.ops.yaml";
const SCRIPT = "Tests/Ops/agent-restarts-increase-behaviour.sh";

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function containerLine(entry) {
  return `${entry.pod}/${entry.container}`;
}

// What the metrics pipeline adds to every resource it sends.
function clusterAttributes() {
  return {
    "k8s.cluster.name": behaviour.CLUSTER_NAME,
    "service.name": `kubernetes-agent-${behaviour.CLUSTER_NAME}`,
    "oneuptime.agent.version": "1.0.0",
  };
}

// A container's resource at a sample, as the metrics pipeline sends it.
function containerResource(entry, sample) {
  return {
    "container.id": behaviour.containerIdOf(sample),
    "k8s.container.name": entry.container,
    "container.image.name": `docker.io/library/${entry.container}`,
    "container.image.tag": "1.0",
    "k8s.pod.name": entry.pod,
    "k8s.pod.uid": sample.podUid,
    "k8s.namespace.name": entry.namespace,
    "k8s.node.name": "node-1",
    ...entry.workload,
    ...clusterAttributes(),
  };
}

function withoutContainerId(resource) {
  const copy = { ...resource };
  delete copy["container.id"];
  return copy;
}

/*
 * What the collector should export for the fed samples, built from the
 * arithmetic, in the shape the behaviour helper reads an export in: the
 * increases, and the count, the readiness and the pod's phase the metrics
 * pipeline sends on beside them.
 */
function exportedAsExpected() {
  const points = [];
  for (const entry of behaviour.CONTAINERS) {
    for (const counted of behaviour.restartIncreasesFrom(entry.samples)) {
      const sample = entry.samples[counted.sample];
      points.push({
        resource: withoutContainerId(containerResource(entry, sample)),
        metric: behaviour.INCREASE_METRIC,
        unit: behaviour.RESTARTS_UNIT,
        description: behaviour.INCREASE_DESCRIPTION,
        type: "sum",
        time: behaviour.sampleTimeNano(counted.sample),
        start: behaviour.sampleTimeNano(counted.since),
        value: counted.increase,
        temporality: behaviour.DELTA,
        monotonic: true,
        scope: behaviour.K8S_CLUSTER_SCOPE,
      });
    }
    entry.samples.forEach((sample, index) => {
      for (const [metric, value] of [
        [behaviour.RESTARTS_METRIC, sample.count],
        [behaviour.READY_METRIC, 0],
      ]) {
        points.push({
          resource: containerResource(entry, sample),
          metric,
          unit: metric === behaviour.RESTARTS_METRIC ? "{restart}" : "",
          description: "",
          type: "gauge",
          time: behaviour.sampleTimeNano(index),
          start: behaviour.START_NANO.toString(),
          value,
          temporality: undefined,
          monotonic: undefined,
          scope: behaviour.K8S_CLUSTER_SCOPE,
        });
      }
    });
  }
  const web = behaviour.CONTAINERS[0];
  behaviour.SAMPLE_SECONDS.forEach((_seconds, index) => {
    points.push({
      resource: {
        "k8s.pod.name": web.pod,
        "k8s.pod.uid": "web-uid",
        "k8s.namespace.name": web.namespace,
        "k8s.node.name": "node-1",
        ...web.workload,
        ...clusterAttributes(),
      },
      metric: behaviour.PHASE_METRIC,
      unit: "",
      description: "",
      type: "gauge",
      time: behaviour.sampleTimeNano(index),
      start: behaviour.START_NANO.toString(),
      value: 2,
      temporality: undefined,
      monotonic: undefined,
      scope: behaviour.K8S_CLUSTER_SCOPE,
    });
  });
  return points;
}

function copyOf(points) {
  return points.map((point) => {
    return { ...point, resource: { ...point.resource } };
  });
}

function increasesOf(points) {
  return points.filter((point) => {
    return point.metric === behaviour.INCREASE_METRIC;
  });
}

/*
 * The processors a pipeline of the chart's lists, as written in the
 * template: the items between its `processors:` and `exporters:`, without
 * the template's directives and comments; and its exporters, up to the
 * next blank line or pipeline.
 */
function templatePipeline(name) {
  const template = readRepoFile(DEPLOYMENT_TEMPLATE);
  const start = template.indexOf(`        ${name}:\n          receivers:\n`);
  expect(start).toBeGreaterThan(-1);
  const block = template.substring(start);
  const items = (text) => {
    return text
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return line.startsWith("- ");
      })
      .map((line) => {
        return line.substring(2);
      });
  };
  const exportersAt = block.indexOf("          exporters:\n");
  const exporters = block
    .substring(exportersAt + "          exporters:\n".length)
    .split("\n");
  return {
    receivers: items(
      block.substring(
        block.indexOf("          receivers:\n"),
        block.indexOf("          processors:\n"),
      ),
    ),
    processors: items(
      block.substring(block.indexOf("          processors:\n"), exportersAt),
    ),
    exporters: items(
      exporters
        .slice(
          0,
          exporters.findIndex((line) => {
            return !line.startsWith("            ");
          }),
        )
        .join("\n"),
    ),
  };
}

describe("agent-restarts-increase-behaviour.sh: what it feeds the collector and expects back", () => {
  test("it expects what the arithmetic says of the samples it posts", () => {
    const expected = behaviour.CONTAINERS.flatMap((entry) => {
      return behaviour.restartIncreasesFrom(entry.samples).map((counted) => {
        return `${containerLine(entry)} ${counted.sample} ${counted.increase}`;
      });
    });

    expect([...behaviour.EXPECTED_INCREASES].sort()).toEqual(expected.sort());
  });

  test("keyed by container.id, as a copy of the Docker agent's processors would be, the same samples count no restart", () => {
    for (const entry of behaviour.CONTAINERS) {
      const keyedById = behaviour.restartIncreasesFrom(
        entry.samples,
        "container-id",
      );

      expect({
        container: containerLine(entry),
        increases: keyedById.map((counted) => {
          return counted.increase;
        }),
      }).toEqual({
        container: containerLine(entry),
        increases: keyedById.map(() => {
          return 0;
        }),
      });
    }

    // While keyed by pod, the crash loop's five restarts all count.
    const web = behaviour.CONTAINERS.find((entry) => {
      return entry.pod === "web-7d9f-abc";
    });
    expect(
      behaviour.restartIncreasesFrom(web.samples).reduce((total, counted) => {
        return total + counted.increase;
      }, 0),
    ).toBe(5);
  });

  test("its samples are what the kubelet reports: a new container ID with every count, a recreated pod under a new UID from 0", () => {
    for (const entry of behaviour.CONTAINERS) {
      entry.samples.forEach((sample, index) => {
        if (index === 0) {
          return;
        }
        const previous = entry.samples[index - 1];
        const sameContainer =
          behaviour.containerIdOf(sample) === behaviour.containerIdOf(previous);

        // A container's count never moves while it runs under one ID.
        expect({
          container: containerLine(entry),
          index,
          sameContainer,
        }).toEqual({
          container: containerLine(entry),
          index,
          sameContainer:
            sample.podUid === previous.podUid &&
            sample.count === previous.count,
        });

        // A new pod starts at 0.
        if (sample.podUid !== previous.podUid) {
          expect(sample.count).toBe(0);
        }
      });
    }
  });

  test("its samples cover a crash loop, a pod recreated under its name, a count that went down, a quiet container, and gaps of minutes and of an hour", () => {
    const gaps = behaviour.SAMPLE_SECONDS.slice(1).map((seconds, index) => {
      return seconds - behaviour.SAMPLE_SECONDS[index];
    });

    expect(gaps).toContain(30);
    expect(gaps).toContain(300);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(60 * 60);
    // Within the 2 hours a container's previous sample is kept.
    expect(Math.max(...gaps)).toBeLessThan(2 * 60 * 60);

    const byPod = Object.fromEntries(
      behaviour.CONTAINERS.map((entry) => {
        return [entry.pod, entry.samples];
      }),
    );

    // A crash loop: the count grows across a 30-second gap and an hour's.
    expect(byPod["web-7d9f-abc"][6].count).toBeGreaterThan(
      byPod["web-7d9f-abc"][5].count,
    );
    // The same pod name under two UIDs, the second from 0.
    expect(
      new Set(
        byPod["db-0"].map((sample) => {
          return sample.podUid;
        }),
      ).size,
    ).toBe(2);
    // A count that went down under one UID.
    expect(
      byPod["cache-6b7f-k2m"].some((sample, index) => {
        return (
          index > 0 &&
          sample.podUid === byPod["cache-6b7f-k2m"][index - 1].podUid &&
          sample.count < byPod["cache-6b7f-k2m"][index - 1].count
        );
      }),
    ).toBe(true);
    // A quiet container with a long history.
    expect(
      new Set(
        byPod["ledger-66f8-q9z"].map((sample) => {
          return sample.count;
        }),
      ),
    ).toEqual(new Set([40]));
  });

  test("its pods belong to every kind of workload the chart's k8sattributes names, and one to none", () => {
    const template = readRepoFile(DEPLOYMENT_TEMPLATE);
    const extracted = template
      .substring(
        template.indexOf("      k8sattributes:\n"),
        template.indexOf("          labels:\n"),
      )
      .split("\n")
      .map((line) => {
        return line.trim();
      })
      .filter((line) => {
        return /^- k8s\.(deployment|replicaset|statefulset|daemonset|job|cronjob)\.name$/.test(
          line,
        );
      })
      .map((line) => {
        return line.substring(2);
      });

    // The keys the check holds the increases to are the chart's.
    expect([...extracted].sort()).toEqual([...behaviour.WORKLOAD_KEYS].sort());
    for (const key of behaviour.LABEL_KEYS) {
      expect(template).toContain(`- tag_name: ${key}\n`);
    }

    const named = new Set(
      behaviour.CONTAINERS.flatMap((entry) => {
        return Object.keys(entry.workload);
      }),
    );
    for (const key of [...behaviour.WORKLOAD_KEYS, ...behaviour.LABEL_KEYS]) {
      expect({ key, named: named.has(key) }).toEqual({ key, named: true });
    }
    // Only the keys k8sattributes adds.
    for (const key of named) {
      expect([...behaviour.WORKLOAD_KEYS, ...behaviour.LABEL_KEYS]).toContain(
        key,
      );
    }

    // A pod of no workload still has its restarts counted.
    const bare = behaviour.CONTAINERS.find((entry) => {
      return Object.keys(entry.workload).length === 0;
    });
    expect(bare).toBeDefined();
    expect(
      behaviour.restartIncreasesFrom(bare.samples).some((counted) => {
        return counted.increase > 0;
      }),
    ).toBe(true);
  });

  test("a pod's workload names stay with it through every restart, and with its name when it is recreated", () => {
    // Every container restarts under new container IDs in the samples...
    const restarting = behaviour.CONTAINERS.filter((entry) => {
      return (
        new Set(
          entry.samples.map((sample) => {
            return behaviour.containerIdOf(sample);
          }),
        ).size > 1
      );
    });
    expect(restarting.length).toBeGreaterThanOrEqual(5);

    // ...while k8sattributes finds one set of names per pod UID.
    const pods = behaviour.podsByUid();
    for (const entry of behaviour.CONTAINERS) {
      for (const sample of entry.samples) {
        expect(pods.get(sample.podUid).workload).toBe(entry.workload);
      }
    }
    // A StatefulSet's pod recreated under its name: a new UID, the same names.
    const db = behaviour.CONTAINERS.find((entry) => {
      return entry.pod === "db-0";
    });
    expect(pods.get("db-0-old-uid").workload).toBe(db.workload);
    expect(pods.get("db-0-new-uid").workload).toBe(db.workload);
    expect(db.workload["k8s.statefulset.name"]).toBe("db");
  });

  test("the names come after the conversion: added before it, a pod k8sattributes had not seen yet would lose a restart", () => {
    /*
     * k8sattributes finds a pod in its own cache, which can lag the
     * receiver's: a new pod, or every pod while the agent starts. If the
     * names were part of the series cumulative_to_delta counts in, the
     * sample they first appear at would start a new series and send
     * nothing - the restarts since the sample before would be lost. Added
     * after it, they cannot be.
     */
    const web = behaviour.CONTAINERS.find((entry) => {
      return entry.pod === "web-7d9f-abc";
    });
    const total = (increases) => {
      return increases.reduce((sum, counted) => {
        return sum + counted.increase;
      }, 0);
    };

    expect(total(behaviour.restartIncreasesFrom(web.samples))).toBe(5);
    for (let namesFrom = 1; namesFrom < web.samples.length; namesFrom++) {
      const restartsThen =
        web.samples[namesFrom].count - web.samples[namesFrom - 1].count;
      expect({
        namesFrom,
        counted: total(
          behaviour.restartIncreasesFrom(web.samples, "names-from", namesFrom),
        ),
      }).toEqual({ namesFrom, counted: 5 - restartsThen });
    }
    // At least one such sample brought restarts, so the order matters.
    expect(
      web.samples.slice(1).some((sample, index) => {
        return sample.count > web.samples[index].count;
      }),
    ).toBe(true);
  });

  test("its payloads are k8s_cluster's: int gauges on the container's own resource, keyed by container.id, with no workload name", () => {
    for (let index = 0; index < behaviour.SAMPLE_SECONDS.length; index++) {
      const payload = behaviour.scrapePayload(index);

      // A resource per container, and one pod's.
      expect(payload.resourceMetrics).toHaveLength(
        behaviour.CONTAINERS.length + 1,
      );

      behaviour.CONTAINERS.forEach((entry, position) => {
        const resourceMetric = payload.resourceMetrics[position];
        const attributes = Object.fromEntries(
          resourceMetric.resource.attributes.map((attribute) => {
            return [attribute.key, attribute.value.stringValue];
          }),
        );
        const [restarts, ready] = resourceMetric.scopeMetrics[0].metrics;

        expect(resourceMetric.scopeMetrics[0].scope.name).toBe(
          behaviour.K8S_CLUSTER_SCOPE,
        );
        expect(attributes).toEqual({
          "container.id": behaviour.containerIdOf(entry.samples[index]),
          "k8s.container.name": entry.container,
          "container.image.name": `docker.io/library/${entry.container}`,
          "container.image.tag": "1.0",
          "k8s.pod.name": entry.pod,
          "k8s.pod.uid": entry.samples[index].podUid,
          "k8s.namespace.name": entry.namespace,
          "k8s.node.name": "node-1",
        });
        expect(restarts.name).toBe(behaviour.RESTARTS_METRIC);
        expect(restarts.unit).toBe(behaviour.RESTARTS_UNIT);
        // A gauge, which cumulative_to_delta alone would leave as it is.
        expect(restarts.sum).toBeUndefined();
        expect(restarts.gauge.dataPoints).toEqual([
          {
            startTimeUnixNano: behaviour.START_NANO.toString(),
            timeUnixNano: behaviour.sampleTimeNano(index),
            asInt: String(entry.samples[index].count),
          },
        ]);
        expect(ready.name).toBe(behaviour.READY_METRIC);
      });

      const pod = payload.resourceMetrics[behaviour.CONTAINERS.length];
      expect(pod.scopeMetrics[0].metrics[0].name).toBe(behaviour.PHASE_METRIC);
    }
  });

  test("its stand-in for k8sattributes adds each pod's names by its UID, and never one a resource already carries", () => {
    const standIn = behaviour.k8sAttributesStandIn();

    expect(standIn.error_mode).toBe("ignore");
    expect(standIn.metric_statements).toHaveLength(1);
    expect(standIn.metric_statements[0].context).toBe("resource");

    const statements = standIn.metric_statements[0].statements;
    const expected = [];
    for (const [podUid, { workload }] of behaviour.podsByUid()) {
      for (const [key, value] of Object.entries(workload)) {
        expected.push(
          `set(attributes["${key}"], "${value}") where attributes["k8s.pod.uid"] == "${podUid}" and attributes["${key}"] == nil`,
        );
      }
    }
    expect(statements).toEqual(expected);
    // Nothing for the pod of no workload, and nothing but setting names.
    expect(statements.join("\n")).not.toContain("debug-shell-uid");
    for (const statement of statements) {
      expect(statement).toMatch(
        /^set\(attributes\["k8s\.[a-z.]+(?:\/name)?"\], /,
      );
      expect(statement).not.toContain("container.id");
    }
  });

  test("it runs the processors the chart's restarts pipeline runs, in that order, all but memory_limiter, into the connector", () => {
    const pipeline = templatePipeline(behaviour.PIPELINE);

    expect(pipeline.receivers).toEqual(["k8s_cluster"]);
    expect(pipeline.processors).toEqual([
      "memory_limiter",
      ...behaviour.LIFTED_PROCESSORS.slice(0, 2),
      // Only when filters.metrics or a metrics namespace filter is set.
      "filter/telemetry",
      ...behaviour.LIFTED_PROCESSORS.slice(2),
    ]);
    expect(pipeline.exporters).toEqual([behaviour.CONNECTOR]);

    // Every one it lifts is defined in the template, and the connector too.
    const template = readRepoFile(DEPLOYMENT_TEMPLATE);
    for (const name of behaviour.LIFTED_PROCESSORS) {
      expect(template).toContain(`\n      ${name}:\n`);
    }
    expect(template).toContain("\n    connectors:\n      # ");
    expect(template).toContain(`\n      ${behaviour.CONNECTOR}: {}\n`);
  });

  test("and the metrics pipeline's, which receives from the connector, with its stand-in where k8sattributes runs", () => {
    const pipeline = templatePipeline(behaviour.METRICS_PIPELINE);

    expect(pipeline.receivers.slice(0, 2)).toEqual([
      "k8s_cluster",
      behaviour.CONNECTOR,
    ]);
    // The template's list, but the processors only some values turn on;
    // the script's render has the eBPF filter (eBPF is on by default).
    expect(
      pipeline.processors.filter((name) => {
        return name !== "filter/telemetry";
      }),
    ).toEqual(behaviour.METRICS_PIPELINE_PROCESSORS);
    expect(pipeline.exporters).toEqual(["otlphttp"]);

    expect(behaviour.liftedMetricsProcessors()).toEqual(
      behaviour.METRICS_PIPELINE_PROCESSORS.filter((name) => {
        return name !== "memory_limiter" && name !== "batch";
      }).map((name) => {
        return name === behaviour.K8S_ATTRIBUTES
          ? behaviour.K8S_ATTRIBUTES_STAND_IN
          : name;
      }),
    );
    // In k8sattributes' place: after the pod-level mark, before the unmark.
    const lifted = behaviour.liftedMetricsProcessors();
    expect(
      lifted.indexOf(behaviour.K8S_ATTRIBUTES_STAND_IN) -
        lifted.indexOf("transform/pod-level-mark"),
    ).toBe(1);
    expect(lifted.indexOf("transform/pod-level-unmark")).toBe(
      lifted.indexOf(behaviour.K8S_ATTRIBUTES_STAND_IN) + 1,
    );
  });

  function stubCollector() {
    const names = [
      ...behaviour.LIFTED_PROCESSORS,
      ...behaviour.METRICS_PIPELINE_PROCESSORS,
    ];
    return {
      processors: Object.fromEntries(
        names.map((name) => {
          return [name, { marker: name }];
        }),
      ),
      connectors: { [behaviour.CONNECTOR]: {} },
      service: {
        pipelines: {
          metrics: {
            receivers: ["k8s_cluster", behaviour.CONNECTOR, "otlp"],
            processors: [...behaviour.METRICS_PIPELINE_PROCESSORS],
            exporters: ["otlphttp"],
          },
          logs: {
            receivers: ["k8sobjects"],
            processors: ["memory_limiter", "k8sattributes", "batch"],
            exporters: ["otlphttp"],
          },
          [behaviour.PIPELINE]: {
            receivers: ["k8s_cluster"],
            processors: ["memory_limiter", ...behaviour.LIFTED_PROCESSORS],
            exporters: [behaviour.CONNECTOR],
          },
        },
      },
    };
  }

  test("the config it builds runs both pipelines from OTLP, the increases through the connector, the rest into a file", () => {
    const config = behaviour.behaviourConfig(stubCollector());
    const metricsProcessors = behaviour.liftedMetricsProcessors();

    expect(Object.keys(config.processors)).toEqual([
      ...behaviour.LIFTED_PROCESSORS,
      ...metricsProcessors,
    ]);
    for (const name of [...behaviour.LIFTED_PROCESSORS, ...metricsProcessors]) {
      expect(config.processors[name]).toEqual(
        name === behaviour.K8S_ATTRIBUTES_STAND_IN
          ? behaviour.k8sAttributesStandIn()
          : { marker: name },
      );
    }
    // The real k8sattributes is never run: it needs the cluster's API.
    expect(config.processors[behaviour.K8S_ATTRIBUTES]).toBeUndefined();
    expect(config.connectors).toEqual({ [behaviour.CONNECTOR]: {} });
    expect(config.service.pipelines).toEqual({
      [behaviour.PIPELINE]: {
        receivers: ["otlp"],
        processors: behaviour.LIFTED_PROCESSORS,
        exporters: [behaviour.CONNECTOR],
      },
      [behaviour.METRICS_PIPELINE]: {
        receivers: ["otlp", behaviour.CONNECTOR],
        processors: metricsProcessors,
        exporters: ["file"],
      },
    });
    expect(yaml.load(yaml.dump(config))).toEqual(config);
  });

  test("it refuses a render whose pipelines are not wired as the chart says", () => {
    const refusals = {
      "the restarts pipeline exports to the exporter": (collector) => {
        collector.service.pipelines[behaviour.PIPELINE].exporters = [
          "otlphttp",
        ];
      },
      "the metrics pipeline does not take them": (collector) => {
        collector.service.pipelines.metrics.receivers = ["k8s_cluster"];
      },
      "another pipeline takes them too": (collector) => {
        collector.service.pipelines.logs.receivers.push(behaviour.CONNECTOR);
      },
      "no connector": (collector) => {
        delete collector.connectors;
      },
      "k8sattributes runs before the conversion": (collector) => {
        collector.service.pipelines[behaviour.PIPELINE].processors.splice(
          1,
          0,
          "k8sattributes",
        );
      },
      "the metrics pipeline runs no k8sattributes": (collector) => {
        collector.service.pipelines.metrics.processors =
          collector.service.pipelines.metrics.processors.filter((name) => {
            return name !== "k8sattributes";
          });
      },
    };

    const exit = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const [name, mutate] of Object.entries(refusals)) {
        const collector = stubCollector();
        mutate(collector);

        expect({
          refusal: name,
          refused: (() => {
            try {
              behaviour.behaviourConfig(collector);
              return false;
            } catch (thrown) {
              return thrown.message === "exit 1";
            }
          })(),
        }).toEqual({ refusal: name, refused: true });
      }
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });

  test("its check passes the export the arithmetic predicts", () => {
    expect(behaviour.problemsWith(exportedAsExpected())).toEqual([]);
  });

  test("its check fails an export that kept container.id, lost a restart, sent another metric, or is not a delta sum from the previous sample", () => {
    const mutations = {
      "kept container.id": (points) => {
        increasesOf(points)[0].resource["container.id"] = "web-uid-run-3";
      },
      "lost a restart": (points) => {
        increasesOf(points).find((point) => {
          return point.value === 2;
        }).value = 1;
      },
      "dropped a point": (points) => {
        points.splice(points.indexOf(increasesOf(points)[3]), 1);
      },
      "sent the count itself twice": (points) => {
        points.push({
          ...increasesOf(points)[0],
          metric: behaviour.RESTARTS_METRIC,
        });
      },
      "sent readiness twice": (points) => {
        points.push({
          ...increasesOf(points)[0],
          metric: behaviour.READY_METRIC,
          type: "gauge",
        });
      },
      "sent another metric": (points) => {
        points.push({ ...increasesOf(points)[0], metric: "k8s.pod.ready" });
      },
      "still a gauge": (points) => {
        increasesOf(points)[1].type = "gauge";
      },
      "still cumulative": (points) => {
        increasesOf(points)[1].temporality = behaviour.CUMULATIVE;
      },
      "from the receiver's start": (points) => {
        increasesOf(points)[2].start = behaviour.START_NANO.toString();
      },
      "no cluster name": (points) => {
        delete increasesOf(points)[4].resource["k8s.cluster.name"];
      },
      "lost the pod's UID": (points) => {
        delete increasesOf(points)[5].resource["k8s.pod.uid"];
      },
      "the receiver's description": (points) => {
        increasesOf(points)[6].description =
          "How many times the container has restarted";
      },
    };

    for (const [name, mutate] of Object.entries(mutations)) {
      const points = copyOf(exportedAsExpected());
      mutate(points);

      expect({
        mutation: name,
        caught: behaviour.problemsWith(points).length > 0,
      }).toEqual({ mutation: name, caught: true });
    }
  });

  test("its check fails an export whose increases lost their workload names, carry another pod's, or differ from the count they are made from", () => {
    const mutations = {
      "lost the Deployment": (points) => {
        for (const point of increasesOf(points)) {
          delete point.resource["k8s.deployment.name"];
        }
      },
      "lost the ReplicaSet of one sample": (points) => {
        delete increasesOf(points).find((point) => {
          return point.resource["k8s.replicaset.name"] === "web-7d9f";
        }).resource["k8s.replicaset.name"];
      },
      "lost the StatefulSet of the recreated pod": (points) => {
        for (const point of increasesOf(points)) {
          if (point.resource["k8s.pod.uid"] === "db-0-new-uid") {
            delete point.resource["k8s.statefulset.name"];
          }
        }
      },
      "lost the DaemonSet": (points) => {
        for (const point of increasesOf(points)) {
          delete point.resource["k8s.daemonset.name"];
        }
      },
      "lost the CronJob": (points) => {
        for (const point of increasesOf(points)) {
          delete point.resource["k8s.cronjob.name"];
        }
      },
      "lost the app label": (points) => {
        for (const point of increasesOf(points)) {
          delete point.resource["k8s.pod.label.app"];
        }
      },
      "another pod's Deployment": (points) => {
        increasesOf(points).find((point) => {
          return point.resource["k8s.pod.uid"] === "cache-uid";
        }).resource["k8s.deployment.name"] = "web";
      },
      "a name on the pod of no workload": (points) => {
        for (const point of increasesOf(points)) {
          if (point.resource["k8s.pod.uid"] === "debug-shell-uid") {
            point.resource["k8s.deployment.name"] = "debug-shell";
          }
        }
      },
      "names the count does not carry": (points) => {
        for (const point of points) {
          if (point.metric === behaviour.RESTARTS_METRIC) {
            delete point.resource["k8s.replicaset.name"];
            delete point.resource["k8s.deployment.name"];
            delete point.resource["k8s.pod.label.app"];
          }
        }
      },
      "a restart split the series: one sample under other attributes": (
        points,
      ) => {
        const later = increasesOf(points).filter((point) => {
          return point.resource["k8s.pod.uid"] === "node-agent-uid";
        })[3];
        later.resource["container.image.tag"] = "1.1";
      },
      "the count lost container.id": (points) => {
        delete points.find((point) => {
          return point.metric === behaviour.RESTARTS_METRIC;
        }).resource["container.id"];
      },
      "the count lost a sample": (points) => {
        points.splice(
          points.findIndex((point) => {
            return point.metric === behaviour.RESTARTS_METRIC;
          }),
          1,
        );
      },
      "no pod phase": (points) => {
        for (let index = points.length - 1; index >= 0; index--) {
          if (points[index].metric === behaviour.PHASE_METRIC) {
            points.splice(index, 1);
          }
        }
      },
    };

    for (const [name, mutate] of Object.entries(mutations)) {
      const points = copyOf(exportedAsExpected());
      mutate(points);

      expect({
        mutation: name,
        caught: behaviour.problemsWith(points).length > 0,
      }).toEqual({ mutation: name, caught: true });
    }
  });
});

describe("agent-restarts-increase-behaviour.sh runs where it says", () => {
  test("on the collector the chart pins and on 0.96.0, which --reuse-values keeps", () => {
    const script = readRepoFile(SCRIPT);

    expect(script).toContain("\nrun_case pinned\n");
    expect(script).toContain(
      "\nrun_case reuse-values --set image.tag=0.96.0\n",
    );
    // The image is the render's, so it is the chart's pin either way.
    expect(script).toContain('image="$(cat "${dir}/image")"');
    expect(script).toContain(
      'node "${HELPER}" config "${dir}/rendered.yaml" "${dir}"',
    );
  });

  test("on the chart's defaults, so its metrics pipeline is the one the helper expects", () => {
    const script = readRepoFile(SCRIPT);
    const render = script.substring(
      script.indexOf("helm template behaviour"),
      script.indexOf('>"${dir}/rendered.yaml"'),
    );

    expect(render).toContain("--set clusterName=behaviour-test");
    // No eBPF, filter or preset override that would change the pipeline.
    expect(render).not.toMatch(/ebpf|filters|namespaceFilters|preset/);
  });

  test("in the Ops Config Test workflow, after the kubelet CPU names test", () => {
    const workflow = yaml.load(readRepoFile(WORKFLOW));
    const runs = workflow.jobs.test.steps
      .map((step) => {
        return step.run;
      })
      .filter(Boolean);

    const cpuNames = runs.indexOf(
      "bash Tests/Ops/agent-cpu-names-behaviour.sh",
    );
    const restarts = runs.indexOf(`bash ${SCRIPT}`);

    expect(cpuNames).toBeGreaterThan(-1);
    expect(restarts).toBe(cpuNames + 1);
  });

  test("and the README says what it checks", () => {
    const readme = readRepoFile("Tests/Ops/README.md");

    expect(readme).toContain("### `agent-restarts-increase-behaviour.sh`");
    expect(readme).toContain("forward/restarts-increase");
  });
});
