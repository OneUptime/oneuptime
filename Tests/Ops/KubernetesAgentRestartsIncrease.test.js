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
 * tests/restarts-increase_test.yaml in the chart holds the render to that.
 * This suite holds agent-restarts-increase-behaviour.sh - which runs the
 * rendered processors in the collector the chart pins and in 0.96.0 - to the
 * same arithmetic, to what the receiver and the kubelet send, and to the
 * chart's pipeline, and holds its check to the export it must pass and the
 * ones it must not.
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

/*
 * What the collector should export for the fed samples, built from the
 * arithmetic, in the shape the behaviour helper reads an export in.
 */
function exportedAsExpected() {
  const points = [];
  for (const entry of behaviour.CONTAINERS) {
    for (const counted of behaviour.restartIncreasesFrom(entry.samples)) {
      const sample = entry.samples[counted.sample];
      points.push({
        resource: {
          "k8s.container.name": entry.container,
          "container.image.name": `docker.io/library/${entry.container}`,
          "container.image.tag": "1.0",
          "k8s.pod.name": entry.pod,
          "k8s.pod.uid": sample.podUid,
          "k8s.namespace.name": entry.namespace,
          "k8s.node.name": "node-1",
          "k8s.cluster.name": behaviour.CLUSTER_NAME,
          "service.name": `kubernetes-agent-${behaviour.CLUSTER_NAME}`,
        },
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
  }
  return points;
}

/*
 * The processors the chart's metrics/restarts-increase pipeline lists, as
 * written in the template: the items between `processors:` and
 * `exporters:`, without the template's directives and comments. The
 * conditional filter/telemetry is reported separately.
 */
function templatePipelineProcessors() {
  const template = readRepoFile(DEPLOYMENT_TEMPLATE);
  const start = template.indexOf("        metrics/restarts-increase:\n");
  expect(start).toBeGreaterThan(-1);
  const block = template.substring(start);
  const processors = block.substring(
    block.indexOf("          processors:\n"),
    block.indexOf("          exporters:\n"),
  );
  return processors
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

  test("its payloads are k8s_cluster's: int gauges on the container's own resource, keyed by container.id, from the receiver's start", () => {
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
        expect(attributes).toEqual(
          expect.objectContaining({
            "container.id": behaviour.containerIdOf(entry.samples[index]),
            "k8s.container.name": entry.container,
            "k8s.pod.name": entry.pod,
            "k8s.pod.uid": entry.samples[index].podUid,
            "k8s.namespace.name": entry.namespace,
          }),
        );
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

  test("it runs the processors the chart's pipeline runs, in that order, all but memory_limiter and batch", () => {
    expect(templatePipelineProcessors()).toEqual([
      "memory_limiter",
      ...behaviour.LIFTED_PROCESSORS.slice(0, 2),
      // Only when filters.metrics or a metrics namespace filter is set.
      "filter/telemetry",
      ...behaviour.LIFTED_PROCESSORS.slice(2),
      "batch",
    ]);

    // Every one it lifts is defined in the template.
    const template = readRepoFile(DEPLOYMENT_TEMPLATE);
    for (const name of behaviour.LIFTED_PROCESSORS) {
      expect(template).toContain(`\n      ${name}:\n`);
    }
  });

  test("the config it builds runs exactly those, from OTLP to a file", () => {
    const pipeline = {
      receivers: ["k8s_cluster"],
      processors: ["memory_limiter", ...behaviour.LIFTED_PROCESSORS, "batch"],
      exporters: ["otlphttp"],
    };
    const collector = {
      processors: Object.fromEntries(
        [...behaviour.LIFTED_PROCESSORS, "memory_limiter", "batch"].map(
          (name) => {
            return [name, { marker: name }];
          },
        ),
      ),
      service: {
        pipelines: {
          metrics: { receivers: ["k8s_cluster", "otlp"] },
          [behaviour.PIPELINE]: pipeline,
        },
      },
    };

    const config = behaviour.behaviourConfig(collector);

    expect(Object.keys(config.processors)).toEqual(behaviour.LIFTED_PROCESSORS);
    for (const name of behaviour.LIFTED_PROCESSORS) {
      expect(config.processors[name]).toEqual({ marker: name });
    }
    expect(config.service.pipelines.metrics).toEqual({
      receivers: ["otlp"],
      processors: behaviour.LIFTED_PROCESSORS,
      exporters: ["file"],
    });
    expect(yaml.load(yaml.dump(config))).toEqual(config);
  });

  test("its check passes the export the arithmetic predicts", () => {
    expect(behaviour.problemsWith(exportedAsExpected())).toEqual([]);
  });

  test("its check fails an export that kept container.id, lost a restart, sent another metric, or is not a delta sum from the previous sample", () => {
    const mutations = {
      "kept container.id": (points) => {
        points[0].resource["container.id"] = "web-uid-run-3";
      },
      "lost a restart": (points) => {
        points.find((point) => {
          return point.value === 2;
        }).value = 1;
      },
      "dropped a point": (points) => {
        points.splice(3, 1);
      },
      "sent the count itself": (points) => {
        points.push({ ...points[0], metric: behaviour.RESTARTS_METRIC });
      },
      "sent readiness": (points) => {
        points.push({ ...points[0], metric: behaviour.READY_METRIC });
      },
      "still a gauge": (points) => {
        points[1].type = "gauge";
      },
      "still cumulative": (points) => {
        points[1].temporality = behaviour.CUMULATIVE;
      },
      "from the receiver's start": (points) => {
        points[2].start = behaviour.START_NANO.toString();
      },
      "no cluster name": (points) => {
        delete points[4].resource["k8s.cluster.name"];
      },
      "lost the pod's UID": (points) => {
        delete points[5].resource["k8s.pod.uid"];
      },
      "the receiver's description": (points) => {
        points[6].description = "How many times the container has restarted";
      },
    };

    for (const [name, mutate] of Object.entries(mutations)) {
      const points = exportedAsExpected().map((point) => {
        return { ...point, resource: { ...point.resource } };
      });
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
    expect(readRepoFile("Tests/Ops/README.md")).toContain(
      "### `agent-restarts-increase-behaviour.sh`",
    );
  });
});
