"use strict";

/**
 * Job failures, as the Kubernetes agent sends them.
 *
 * The cluster collector's k8s_cluster receiver sends k8s.job.failed_pods,
 * the Job's status.failed, as an int GAUGE on the Job's own resource, which
 * is keyed by k8s.job.uid (with its name and namespace). The count only
 * grows for the Job's life, and a Job recreated under the same name has a
 * new UID and starts at 0. OneUptime's Job Failures template used to take
 * the count's growth between two samples of the SAME minute (a monitor
 * cannot take the difference of values in different minutes), so a failure
 * between the last sample of one minute and the first of the next was never
 * counted, and a recreated Job read the old one's count against the new
 * one's 0 as failures.
 *
 * So the chart sends k8s.job.failed_pods.increase from the metrics pipeline
 * itself: transform/job-failures-increase copies the count and makes the
 * copy a cumulative sum, and cumulative_to_delta/job-failures-increase turns
 * only the copy into the failures since the previous sample of the same Job;
 * the template sums it. Nothing comes off the resource, unlike the
 * container restarts (KubernetesAgentRestartsIncrease.test.js): the Job's
 * UID is the series a failure is counted in.
 *
 * tests/job-failures-increase_test.yaml in the chart holds the render to
 * that. This suite holds agent-job-failures-increase-behaviour.sh - which
 * runs the rendered processors in the collector the chart pins and in
 * 0.96.0 - to the same arithmetic, to what the receiver sends, and to the
 * chart's pipeline, and holds its check to the export it must pass and the
 * ones it must not.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const behaviour = require("./Utils/KubernetesAgentJobFailuresIncreaseBehaviour");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEPLOYMENT_TEMPLATE =
  "HelmChart/Public/kubernetes-agent/templates/configmap-deployment.yaml";
const WORKFLOW = ".github/workflows/test.ops.yaml";
const SCRIPT = "Tests/Ops/agent-job-failures-increase-behaviour.sh";

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function jobLine(entry) {
  return `${entry.namespace}/${entry.job}`;
}

/*
 * What the collector should export for the fed samples, built from the
 * arithmetic, in the shape the behaviour helper reads an export in: the
 * increases, and everything that came in, as it came.
 */
function exportedAsExpected() {
  const points = [];
  const cluster = {
    "k8s.cluster.name": behaviour.CLUSTER_NAME,
    "service.name": `kubernetes-agent-${behaviour.CLUSTER_NAME}`,
  };

  for (const entry of behaviour.JOBS) {
    const resourceOf = (sample) => {
      return {
        "k8s.job.uid": sample.jobUid,
        "k8s.job.name": entry.job,
        "k8s.namespace.name": entry.namespace,
        ...cluster,
      };
    };

    entry.samples.forEach((sample, index) => {
      for (const metric of [
        behaviour.ACTIVE_METRIC,
        behaviour.FAILED_METRIC,
        behaviour.SUCCESSFUL_METRIC,
      ]) {
        points.push({
          resource: resourceOf(sample),
          metric: metric,
          unit: behaviour.POD_UNIT,
          description:
            metric === behaviour.FAILED_METRIC
              ? behaviour.FAILED_DESCRIPTION
              : "",
          type: "gauge",
          time: behaviour.sampleTimeNano(index),
          start: behaviour.START_NANO.toString(),
          value: metric === behaviour.FAILED_METRIC ? sample.count : 0,
          scope: behaviour.K8S_CLUSTER_SCOPE,
        });
      }
    });

    for (const counted of behaviour.failureIncreasesFrom(entry.samples)) {
      points.push({
        resource: resourceOf(entry.samples[counted.sample]),
        metric: behaviour.INCREASE_METRIC,
        unit: behaviour.POD_UNIT,
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

  behaviour.SAMPLE_SECONDS.forEach((_seconds, index) => {
    points.push({
      resource: { "k8s.container.name": "api", ...cluster },
      metric: behaviour.RESTARTS_METRIC,
      unit: "{restart}",
      type: "gauge",
      time: behaviour.sampleTimeNano(index),
      value: 3,
      scope: behaviour.K8S_CLUSTER_SCOPE,
    });
    points.push({
      resource: { "service.name": "kube-apiserver" },
      metric: behaviour.COUNTER_METRIC,
      unit: "",
      type: "sum",
      time: behaviour.sampleTimeNano(index),
      value: behaviour.COUNTER_VALUES[index],
      temporality: behaviour.CUMULATIVE,
      monotonic: true,
      scope: behaviour.PROMETHEUS_SCOPE,
    });
  });

  return points;
}

/*
 * The metrics pipeline's processors as written in the template: the items
 * between its `processors:` and `exporters:`, without the template's
 * directives and comments.
 */
function templatePipelineProcessors() {
  const template = readRepoFile(DEPLOYMENT_TEMPLATE);
  const start = template.indexOf("        metrics:\n          receivers:\n");
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

describe("agent-job-failures-increase-behaviour.sh: what it feeds the collector and expects back", () => {
  test("it expects what the arithmetic says of the samples it posts", () => {
    const expected = behaviour.JOBS.flatMap((entry) => {
      return behaviour.failureIncreasesFrom(entry.samples).map((counted) => {
        return `${jobLine(entry)} ${counted.sample} ${counted.increase}`;
      });
    });

    expect([...behaviour.EXPECTED_INCREASES].sort()).toEqual(expected.sort());
  });

  test("keyed by the Job's UID, every increase is one Job's own, and a Job recreated under its name is no failure", () => {
    // Never the old Job's count against the new one's.
    for (const entry of behaviour.JOBS) {
      for (const counted of behaviour.failureIncreasesFrom(entry.samples)) {
        expect(entry.samples[counted.since].jobUid).toBe(
          entry.samples[counted.sample].jobUid,
        );
      }
    }

    // The new Job's first sample sends nothing, its own failure one.
    const migrate = behaviour.JOBS.find((entry) => {
      return entry.job === "db-migrate";
    });
    expect(
      behaviour.failureIncreasesFrom(migrate.samples).map((counted) => {
        return [counted.sample, counted.increase];
      }),
    ).toEqual([
      [1, 0],
      [2, 0],
      [4, 0],
      [5, 1],
      [6, 0],
    ]);

    // While a failing Job's five failures after its first sample all count.
    const nightly = behaviour.JOBS.find((entry) => {
      return entry.job === "nightly-export";
    });
    expect(
      behaviour
        .failureIncreasesFrom(nightly.samples)
        .reduce((total, counted) => {
          return total + counted.increase;
        }, 0),
    ).toBe(
      nightly.samples[nightly.samples.length - 1].count -
        nightly.samples[0].count,
    );
  });

  test("its samples are what k8s_cluster reports: a Job's UID changes only when it is recreated, and a recreated Job starts at 0", () => {
    for (const entry of behaviour.JOBS) {
      entry.samples.forEach((sample, index) => {
        if (index === 0) {
          return;
        }
        const previous = entry.samples[index - 1];

        if (sample.jobUid !== previous.jobUid) {
          expect({ job: jobLine(entry), index, count: sample.count }).toEqual({
            job: jobLine(entry),
            index,
            count: 0,
          });
        }
      });
    }
  });

  test("its samples cover a failing Job, a Job recreated under its name, a count that went down, a Job done long ago, and gaps of minutes and of an hour", () => {
    const gaps = behaviour.SAMPLE_SECONDS.slice(1).map((seconds, index) => {
      return seconds - behaviour.SAMPLE_SECONDS[index];
    });

    expect(gaps).toContain(30);
    expect(gaps).toContain(300);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(60 * 60);
    // Within the 2 hours a Job's previous sample is kept.
    expect(Math.max(...gaps)).toBeLessThan(2 * 60 * 60);

    const byJob = Object.fromEntries(
      behaviour.JOBS.map((entry) => {
        return [entry.job, entry.samples];
      }),
    );

    // A failing Job: the count grows across a 30-second gap and an hour's.
    expect(byJob["nightly-export"][6].count).toBeGreaterThan(
      byJob["nightly-export"][5].count,
    );
    expect(byJob["nightly-export"][1].count).toBeLessThan(
      byJob["nightly-export"][2].count,
    );
    // The same name under two UIDs, the second from 0.
    expect(
      new Set(
        byJob["db-migrate"].map((sample) => {
          return sample.jobUid;
        }),
      ).size,
    ).toBe(2);
    // A count that went down under one UID.
    expect(
      byJob["legacy-sync"].some((sample, index) => {
        return (
          index > 0 &&
          sample.jobUid === byJob["legacy-sync"][index - 1].jobUid &&
          sample.count < byJob["legacy-sync"][index - 1].count
        );
      }),
    ).toBe(true);
    // A Job that failed long ago and no more.
    expect(
      new Set(
        byJob["report-28851120"].map((sample) => {
          return sample.count;
        }),
      ),
    ).toEqual(new Set([1]));
  });

  test("its payloads are the metrics pipeline's: k8s_cluster's int gauges on the Job's own resource, keyed by its UID, beside a container's count and a Prometheus counter", () => {
    for (let index = 0; index < behaviour.SAMPLE_SECONDS.length; index++) {
      const payload = behaviour.scrapePayload(index);

      // A resource per Job, a container's and the API server's.
      expect(payload.resourceMetrics).toHaveLength(behaviour.JOBS.length + 2);

      behaviour.JOBS.forEach((entry, position) => {
        const resourceMetric = payload.resourceMetrics[position];
        const attributes = Object.fromEntries(
          resourceMetric.resource.attributes.map((attribute) => {
            return [attribute.key, attribute.value.stringValue];
          }),
        );
        const metrics = resourceMetric.scopeMetrics[0].metrics;
        const failed = metrics.find((metric) => {
          return metric.name === behaviour.FAILED_METRIC;
        });

        expect(resourceMetric.scopeMetrics[0].scope.name).toBe(
          behaviour.K8S_CLUSTER_SCOPE,
        );
        expect(attributes).toEqual({
          "k8s.job.uid": entry.samples[index].jobUid,
          "k8s.job.name": entry.job,
          "k8s.namespace.name": entry.namespace,
        });
        expect(
          metrics.map((metric) => {
            return metric.name;
          }),
        ).toEqual([
          behaviour.ACTIVE_METRIC,
          behaviour.FAILED_METRIC,
          behaviour.SUCCESSFUL_METRIC,
        ]);
        expect(failed.unit).toBe(behaviour.POD_UNIT);
        expect(failed.description).toBe(behaviour.FAILED_DESCRIPTION);
        // A gauge, which cumulative_to_delta alone would leave as it is.
        expect(failed.sum).toBeUndefined();
        expect(failed.gauge.dataPoints).toEqual([
          {
            startTimeUnixNano: behaviour.START_NANO.toString(),
            timeUnixNano: behaviour.sampleTimeNano(index),
            asInt: String(entry.samples[index].count),
          },
        ]);
      });

      const container = payload.resourceMetrics[behaviour.JOBS.length];
      expect(container.scopeMetrics[0].metrics[0].name).toBe(
        behaviour.RESTARTS_METRIC,
      );
      const counter = payload.resourceMetrics[behaviour.JOBS.length + 1];
      expect(counter.scopeMetrics[0].metrics[0].name).toBe(
        behaviour.COUNTER_METRIC,
      );
      expect(counter.scopeMetrics[0].metrics[0].sum).toEqual(
        expect.objectContaining({
          aggregationTemporality: behaviour.CUMULATIVE,
          isMonotonic: true,
        }),
      );
    }
  });

  test("it runs the processors the chart's metrics pipeline runs first, in that order, and its resource processor", () => {
    const processors = templatePipelineProcessors();

    expect(processors.slice(0, 3)).toEqual([
      "memory_limiter",
      ...behaviour.INCREASE_PROCESSORS,
    ]);
    expect(processors).toContain("resource");
    expect(processors.indexOf("resource")).toBeGreaterThan(
      processors.indexOf("cumulative_to_delta/job-failures-increase"),
    );

    // Every one it lifts is defined in the template.
    const template = readRepoFile(DEPLOYMENT_TEMPLATE);
    for (const name of behaviour.LIFTED_PROCESSORS) {
      expect(template).toContain(`\n      ${name}:\n`);
    }
  });

  test("the config it builds runs exactly those, from OTLP to a file", () => {
    const collector = {
      processors: Object.fromEntries(
        [
          ...behaviour.LIFTED_PROCESSORS,
          "memory_limiter",
          "k8sattributes",
          "batch",
        ].map((name) => {
          return [name, { marker: name }];
        }),
      ),
      service: {
        pipelines: {
          metrics: {
            receivers: ["k8s_cluster", "otlp"],
            processors: [
              "memory_limiter",
              ...behaviour.INCREASE_PROCESSORS,
              "k8sattributes",
              "resource",
              "batch",
            ],
            exporters: ["otlphttp"],
          },
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

  test("its check fails an export that lost a failure, lost the Job's UID, is not a delta sum from the previous sample, or changed what it copies from", () => {
    const firstIncrease = (points) => {
      return points.find((point) => {
        return point.metric === behaviour.INCREASE_METRIC;
      });
    };
    const mutations = {
      "lost a failure": (points) => {
        points.find((point) => {
          return (
            point.metric === behaviour.INCREASE_METRIC && point.value === 2
          );
        }).value = 1;
      },
      "dropped a point": (points) => {
        points.splice(points.indexOf(firstIncrease(points)), 1);
      },
      "sent the first sample's count": (points) => {
        points.push({
          ...firstIncrease(points),
          time: behaviour.sampleTimeNano(0),
          value: 1,
        });
      },
      "still a gauge": (points) => {
        firstIncrease(points).type = "gauge";
      },
      "still cumulative": (points) => {
        firstIncrease(points).temporality = behaviour.CUMULATIVE;
      },
      "from the receiver's start": (points) => {
        firstIncrease(points).start = behaviour.START_NANO.toString();
      },
      "lost the Job's UID": (points) => {
        delete firstIncrease(points).resource["k8s.job.uid"];
      },
      "no cluster name": (points) => {
        delete firstIncrease(points).resource["k8s.cluster.name"];
      },
      "the receiver's description": (points) => {
        firstIncrease(points).description = behaviour.FAILED_DESCRIPTION;
      },
      "renamed the count instead of copying it": (points) => {
        for (let index = points.length - 1; index >= 0; index--) {
          if (points[index].metric === behaviour.FAILED_METRIC) {
            points.splice(index, 1);
          }
        }
      },
      "made the count itself a sum": (points) => {
        points.find((point) => {
          return point.metric === behaviour.FAILED_METRIC;
        }).type = "sum";
      },
      "turned the Prometheus counter into deltas": (points) => {
        points.find((point) => {
          return point.metric === behaviour.COUNTER_METRIC;
        }).temporality = behaviour.DELTA;
      },
      "made the restart count a sum": (points) => {
        points.find((point) => {
          return point.metric === behaviour.RESTARTS_METRIC;
        }).type = "sum";
      },
      "sent another metric": (points) => {
        points.push({ ...firstIncrease(points), metric: "k8s.job.failed" });
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

  test("the copy carries what the count carries at every sample: the Job's name, UID and namespace, and the cluster's attributes", () => {
    const points = exportedAsExpected();
    const increases = points.filter((point) => {
      return point.metric === behaviour.INCREASE_METRIC;
    });

    expect(increases.length).toBe(behaviour.EXPECTED_INCREASES.length);
    for (const point of increases) {
      const original = points.find((candidate) => {
        return (
          candidate.metric === behaviour.FAILED_METRIC &&
          candidate.time === point.time &&
          candidate.resource["k8s.job.uid"] === point.resource["k8s.job.uid"]
        );
      });

      expect(point.resource).toEqual(original.resource);
      // The workload: the Job itself, which Job Failures groups by.
      expect(Object.keys(point.resource).sort()).toEqual([
        "k8s.cluster.name",
        "k8s.job.name",
        "k8s.job.uid",
        "k8s.namespace.name",
        "service.name",
      ]);
    }
  });

  test("a Job's retries are new pods on the same Job, so every failure of a failing Job counts in one series", () => {
    // nightly-export fails a pod at a time, retrying with a new pod each
    // time; its resource, and so its series, stays the Job's.
    const nightly = behaviour.JOBS.find((entry) => {
      return entry.job === "nightly-export";
    });
    expect(
      new Set(
        nightly.samples.map((sample) => {
          return sample.jobUid;
        }),
      ).size,
    ).toBe(1);
    const increases = behaviour.failureIncreasesFrom(nightly.samples);
    expect(
      increases.filter((counted) => {
        return counted.increase > 0;
      }).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      increases.reduce((total, counted) => {
        return total + counted.increase;
      }, 0),
    ).toBe(nightly.samples[6].count - nightly.samples[0].count);

    // Its payloads carry nothing of the pods: only the Job's own keys.
    for (let index = 0; index < behaviour.SAMPLE_SECONDS.length; index++) {
      const resource = behaviour
        .scrapePayload(index)
        .resourceMetrics[0].resource.attributes.map((attribute) => {
          return attribute.key;
        });
      expect(resource.sort()).toEqual([
        "k8s.job.name",
        "k8s.job.uid",
        "k8s.namespace.name",
      ]);
    }
  });

  test("its check fails an export whose copy carries other workload attributes than the count, or whose Job series split", () => {
    const increasesOf = (points, job) => {
      return points.filter((point) => {
        return (
          point.metric === behaviour.INCREASE_METRIC &&
          point.resource["k8s.job.name"] === job
        );
      });
    };
    const mutations = {
      "the copy lost the Job's name": (points) => {
        delete increasesOf(points, "nightly-export")[2].resource[
          "k8s.job.name"
        ];
      },
      "the copy lost the namespace": (points) => {
        delete increasesOf(points, "db-migrate")[0].resource[
          "k8s.namespace.name"
        ];
      },
      "the copy names a CronJob the count does not": (points) => {
        increasesOf(points, "report-28851120")[1].resource["k8s.cronjob.name"] =
          "report";
      },
      "the count names a CronJob the copy does not": (points) => {
        points.find((point) => {
          return (
            point.metric === behaviour.FAILED_METRIC &&
            point.resource["k8s.job.name"] === "report-28851120" &&
            point.time === behaviour.sampleTimeNano(3)
          );
        }).resource["k8s.cronjob.name"] = "report";
      },
      "the copy carries another Job's UID": (points) => {
        increasesOf(points, "legacy-sync")[1].resource["k8s.job.uid"] =
          "nightly-export-uid";
      },
      "a retry split the Job's series, the count's too": (points) => {
        // A retry's pod name on one sample of both: they still agree.
        for (const point of points) {
          if (
            point.resource["k8s.job.name"] === "nightly-export" &&
            point.time === behaviour.sampleTimeNano(4)
          ) {
            point.resource["k8s.pod.name"] = "nightly-export-q7x2c";
          }
        }
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

describe("agent-job-failures-increase-behaviour.sh runs where it says", () => {
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
    expect(fs.statSync(path.join(REPO_ROOT, SCRIPT)).mode & 0o111).not.toBe(0);
  });

  test("in the Ops Config Test workflow, right after the restarts one", () => {
    const workflow = yaml.load(readRepoFile(WORKFLOW));
    const runs = workflow.jobs.test.steps
      .map((step) => {
        return step.run;
      })
      .filter(Boolean);

    const restarts = runs.indexOf(
      "bash Tests/Ops/agent-restarts-increase-behaviour.sh",
    );
    const jobFailures = runs.indexOf(`bash ${SCRIPT}`);

    expect(restarts).toBeGreaterThan(-1);
    expect(jobFailures).toBe(restarts + 1);
  });

  test("and the README says what it checks", () => {
    const readme = readRepoFile("Tests/Ops/README.md");

    expect(readme).toContain("### `agent-job-failures-increase-behaviour.sh`");
    expect(readme).toContain(
      "### `KubernetesAgentJobFailuresIncrease.test.js`",
    );
  });
});
