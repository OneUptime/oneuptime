"use strict";

/**
 * The volume series the Kubernetes agent's node collector keeps and drops.
 *
 * The kubeletstats receiver's volume group sends five series for every
 * volume of every pod. Most of them were a pod's service account token and
 * its configMap, secret and downwardAPI volumes: a few small files in memory,
 * whose capacity says nothing about a disk, and which OneUptime never reads.
 * The node collector's filter/volume-series drops those (issue #9644) by the
 * k8s.volume.type the receiver gives a volume from its pod's spec, and a
 * token by its name, because the receiver types no projected volume yet. A
 * collector that types projected volumes (issue #9842,
 * opentelemetry-collector-contrib#52198) has every one dropped by its type -
 * and without that clause would send every pod's token again, since the name
 * match is only for a volume with no type.
 *
 * tests/volume-series-filter_test.yaml in the chart holds the render to the
 * condition. agent-volume-series-behaviour.sh runs the rendered filter in the
 * collector the chart pins and in 0.96.0. This suite holds the two together:
 * the volumes the script sends cover every type and every token name the
 * condition reads, and the ones it expects kept are the ones the condition
 * keeps; its check passes the export the condition predicts and refuses the
 * ones it must not; and the workflow runs it.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");
const behaviour = require("./Utils/KubernetesAgentVolumeSeriesBehaviour");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATE =
  "HelmChart/Public/kubernetes-agent/templates/configmap-daemonset.yaml";
const SCRIPT = "Tests/Ops/agent-volume-series-behaviour.sh";
const WORKFLOW = ".github/workflows/test.ops.yaml";

const NAME = 'resource.attributes["k8s.volume.name"]';
const TYPE = 'resource.attributes["k8s.volume.type"]';
const CLAIM = 'resource.attributes["k8s.persistentvolumeclaim.name"]';

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

// The filter's one condition, as the template writes it.
function filterCondition() {
  const text = readRepoFile(TEMPLATE);
  const start = text.indexOf(`      ${behaviour.FILTER}:\n`);
  expect(start).toBeGreaterThan(-1);
  const block = text.slice(start, text.indexOf("{{- end }}", start));
  const conditions = [...block.matchAll(/^ {12}- '(.*)'$/gm)].map((match) => {
    return match[1];
  });
  expect(conditions).toHaveLength(1);
  return conditions[0];
}

// The types it drops, in its order.
function droppedTypes(condition) {
  return [
    ...condition.matchAll(
      /resource\.attributes\["k8s\.volume\.type"\] == "([^"]+)"/g,
    ),
  ].map((match) => {
    return match[1];
  });
}

// The token names it matches, as the regular expression OTTL compiles.
function tokenPatternSource(condition) {
  return condition.match(
    /IsMatch\(resource\.attributes\["k8s\.volume\.name"\], "([^"]+)"\)/,
  )[1];
}

/*
 * What the condition does to a volume, read as OTTL reads it. Only true to
 * the condition while it has the shape the first test holds it to.
 */
function dropsVolume(condition, volume) {
  if (!volume.name || volume.claim) {
    return false;
  }
  if (volume.type) {
    return droppedTypes(condition).includes(volume.type);
  }
  return new RegExp(tokenPatternSource(condition)).test(volume.name);
}

// The token names the pattern spells out: its alternatives, a suffix filled in.
function tokenNames(condition) {
  const source = tokenPatternSource(condition);
  const alternatives = source.match(/^\^\((.*)\)\$$/)[1].split("|");
  return alternatives.map((alternative) => {
    return alternative.replace("[a-z0-9]+", "x7k2p");
  });
}

// An export of exactly what the condition keeps, as the file exporter writes it.
function exportOf(volumes, others) {
  const payload = behaviour.scrapePayload();
  const keep = new Set([
    ...volumes.map(behaviour.caseOf),
    ...others.map((other) => {
      return other.label;
    }),
  ]);
  return {
    resourceMetrics: payload.resourceMetrics.filter((resourceMetrics) => {
      const label =
        resourceMetrics.scopeMetrics[0].metrics[0].gauge.dataPoints[0]
          .attributes[0].value.stringValue;
      return keep.has(label);
    }),
  };
}

function exportedPoints(exported, dir) {
  const file = path.join(dir, "metrics.json");
  fs.writeFileSync(file, `${JSON.stringify(exported)}\n`);
  return behaviour.readExported(file);
}

describe("the node collector's volume filter", () => {
  const condition = filterCondition();

  test("is one condition of the shape this suite reads: a named volume with no claim, of a type it drops, or with no type and a token's name", () => {
    const types = droppedTypes(condition);
    const rebuilt = `${NAME} != nil and ${CLAIM} == nil and (${types
      .map((type) => {
        return `${TYPE} == "${type}"`;
      })
      .join(
        " or ",
      )} or (${TYPE} == nil and IsMatch(${NAME}, "${tokenPatternSource(condition)}")))`;

    expect(condition).toBe(rebuilt);
  });

  test("drops the types the receiver gives a pod's small volumes, and projected (#9842)", () => {
    expect(droppedTypes(condition)).toEqual([
      "configMap",
      "secret",
      "downwardAPI",
      "projected",
    ]);
  });

  test("tells the tokens of Kubernetes, EKS, Azure Workload Identity, Istio and Linkerd by their whole names", () => {
    expect(tokenNames(condition)).toEqual([
      "kube-api-access-x7k2p",
      "aws-iam-token",
      "eks-pod-identity-token",
      "azure-identity-token",
      "istio-token",
      "linkerd-identity-token",
    ]);
    const pattern = new RegExp(tokenPatternSource(condition));
    expect(pattern.test("kube-api-access-x7k2p-old")).toBe(false);
    expect(pattern.test("my-istio-token")).toBe(false);
  });
});

describe("agent-volume-series-behaviour.sh sends every kind of volume", () => {
  const condition = filterCondition();

  test("each volume it expects kept is one the condition keeps, and each it expects dropped one it drops", () => {
    for (const volume of behaviour.VOLUMES) {
      expect({
        volume: behaviour.caseOf(volume),
        kept: !dropsVolume(condition, volume),
      }).toEqual({ volume: behaviour.caseOf(volume), kept: volume.kept });
    }
  });

  test("every type the condition drops, typed so", () => {
    for (const type of droppedTypes(condition)) {
      expect(
        behaviour.VOLUMES.some((volume) => {
          return volume.type === type && !volume.claim && !volume.kept;
        }),
      ).toBe(true);
    }
  });

  test("every token the condition names, untyped, and a projected token typed", () => {
    for (const name of tokenNames(condition)) {
      expect({
        name,
        sent: behaviour.VOLUMES.some((volume) => {
          return volume.name === name && !volume.type && !volume.kept;
        }),
      }).toEqual({ name, sent: true });
    }
    expect(
      behaviour.VOLUMES.some((volume) => {
        return (
          volume.type === "projected" &&
          new RegExp(tokenPatternSource(condition)).test(volume.name)
        );
      }),
    ).toBe(true);
  });

  test("and the volumes OneUptime reads: a claim's, a generic ephemeral one typed or not, an emptyDir, a hostPath, and a volume it cannot name", () => {
    const kept = behaviour.VOLUMES.filter((volume) => {
      return volume.kept;
    });
    const types = new Set(
      kept.map((volume) => {
        return volume.type || "untyped";
      }),
    );

    expect([...types].sort()).toEqual(
      [
        "emptyDir",
        "ephemeral",
        "hostPath",
        "persistentVolumeClaim",
        "untyped",
      ].sort(),
    );
    // An ephemeral volume whose claim the collector names, and one it does not.
    expect(
      kept
        .filter((volume) => {
          return volume.type === "ephemeral";
        })
        .map((volume) => {
          return volume.claim;
        }),
    ).toEqual([undefined, "web-0-scratch"]);
    // A claim kept though its volume has a token's name.
    expect(
      kept.some((volume) => {
        return (
          volume.claim &&
          new RegExp(tokenPatternSource(condition)).test(volume.name)
        );
      }),
    ).toBe(true);
  });

  test("each as the receiver sends it: its pod, its name, and its type and claim only when it has them", () => {
    const keys = (volume) => {
      return behaviour.volumeResourceAttributes(volume).map((attribute) => {
        return attribute.key;
      });
    };

    expect(keys({ name: "tls", type: "secret" })).toEqual([
      "k8s.pod.uid",
      "k8s.pod.name",
      "k8s.namespace.name",
      "k8s.volume.name",
      "k8s.volume.type",
    ]);
    expect(keys({ name: "scratch" })).not.toContain("k8s.volume.type");
    expect(
      keys({ name: "data", type: "persistentVolumeClaim", claim: "data-0" }),
    ).toContain("k8s.persistentvolumeclaim.name");
  });

  test("five series a volume, as the volume group sends them, beside the node's, a pod's and a container's", () => {
    const payload = behaviour.scrapePayload();

    expect(payload.resourceMetrics).toHaveLength(
      behaviour.VOLUMES.length + behaviour.OTHERS.length,
    );
    for (const resourceMetrics of payload.resourceMetrics.slice(
      0,
      behaviour.VOLUMES.length,
    )) {
      expect(
        resourceMetrics.scopeMetrics[0].metrics.map((metric) => {
          return metric.name;
        }),
      ).toEqual(behaviour.VOLUME_METRICS);
    }
    // Every case named once, so an export says which volume came through.
    const cases = behaviour.VOLUMES.map(behaviour.caseOf);
    expect(new Set(cases).size).toBe(cases.length);
  });
});

describe("its check", () => {
  const condition = filterCondition();
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "volume-series-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const keptVolumes = () => {
    return behaviour.VOLUMES.filter((volume) => {
      return !dropsVolume(condition, volume);
    });
  };

  test("passes the export the condition predicts", () => {
    const points = exportedPoints(
      exportOf(keptVolumes(), behaviour.OTHERS),
      dir,
    );

    expect(points).toHaveLength(behaviour.expectedLines().length);
    expect(behaviour.problemsWith(points)).toEqual([]);
  });

  test("refuses an export that dropped a claim's volume", () => {
    const points = exportedPoints(
      exportOf(
        keptVolumes().filter((volume) => {
          return volume.claim !== "data-web-0";
        }),
        behaviour.OTHERS,
      ),
      dir,
    );

    expect(behaviour.problemsWith(points).join("\n")).toContain(
      "it dropped k8s.volume.available persistentVolumeClaim data claim=data-web-0",
    );
  });

  test("refuses the export of a filter that typed projected volumes nothing, which sends their tokens again", () => {
    const projected = behaviour.VOLUMES.filter((volume) => {
      return volume.type === "projected";
    });
    const points = exportedPoints(
      exportOf([...keptVolumes(), ...projected], behaviour.OTHERS),
      dir,
    );

    expect(behaviour.problemsWith(points).join("\n")).toContain(
      "it sent k8s.volume.available projected bundle",
    );
    expect(behaviour.problemsWith(points).join("\n")).toContain(
      "k8s.volume.available projected kube-api-access-x7k2p",
    );
  });

  test("refuses an export that dropped the node's own series", () => {
    const points = exportedPoints(
      exportOf(
        keptVolumes(),
        behaviour.OTHERS.filter((other) => {
          return other.label !== "node";
        }),
      ),
      dir,
    );

    expect(behaviour.problemsWith(points).join("\n")).toContain(
      "it dropped k8s.node.filesystem.available node",
    );
  });

  test("refuses a kept series that came out twice, or with its resource changed", () => {
    const exported = exportOf(keptVolumes(), behaviour.OTHERS);
    const twice = {
      resourceMetrics: [
        ...exported.resourceMetrics,
        exported.resourceMetrics[0],
      ],
    };
    expect(
      behaviour.problemsWith(exportedPoints(twice, dir)).join("\n"),
    ).toMatch(/it sent more than once/);

    const changed = JSON.parse(JSON.stringify(exported));
    changed.resourceMetrics[0].resource.attributes.pop();
    expect(
      behaviour.problemsWith(exportedPoints(changed, dir)).join("\n"),
    ).toMatch(/came out with/);
  });

  test("refuses an empty export", () => {
    expect(
      behaviour.problemsWith(exportedPoints({ resourceMetrics: [] }, dir)),
    ).toEqual(expect.arrayContaining(["nothing came out"]));
  });
});

describe("the config it runs", () => {
  function stubCollector(processors) {
    return {
      processors: Object.fromEntries(
        [behaviour.FILTER, "memory_limiter", "filter/cpu-utilization"].map(
          (name) => {
            return [name, { marker: name }];
          },
        ),
      ),
      service: {
        pipelines: {
          metrics: {
            receivers: ["kubeletstats", "hostmetrics"],
            processors,
            exporters: ["otlphttp"],
          },
        },
      },
    };
  }

  test("is the filter as rendered, alone, from OTLP to a file", () => {
    const config = behaviour.behaviourConfig(
      stubCollector([
        "memory_limiter",
        behaviour.FILTER,
        "filter/cpu-utilization",
        "batch",
      ]),
    );

    expect(config.processors).toEqual({
      [behaviour.FILTER]: { marker: behaviour.FILTER },
    });
    expect(config.service.pipelines.metrics).toEqual({
      receivers: ["otlp"],
      processors: [behaviour.FILTER],
      exporters: ["file"],
    });
    expect(yaml.load(yaml.dump(config))).toEqual(config);
  });

  test("and refuses a render whose metrics pipeline runs it anywhere but first after the memory limiter", () => {
    const exit = jest.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`exit ${code}`);
    });
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => {
        behaviour.behaviourConfig(
          stubCollector([
            "memory_limiter",
            "filter/cpu-utilization",
            behaviour.FILTER,
          ]),
        );
      }).toThrow("exit 1");
      expect(() => {
        behaviour.behaviourConfig(
          stubCollector(["memory_limiter", "filter/cpu-utilization"]),
        );
      }).toThrow("exit 1");
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
});

describe("agent-volume-series-behaviour.sh", () => {
  test("lifts the filter from the chart's default render, and runs it on the collector the chart pins and on 0.96.0", () => {
    const script = readRepoFile(SCRIPT);
    const render = script.substring(
      script.indexOf("helm template behaviour"),
      script.indexOf('>"${dir}/rendered.yaml"'),
    );

    expect(render).toContain("--set clusterName=behaviour-test");
    // No override that would leave the filter out or move it.
    expect(render).not.toMatch(/volumeMetrics|filters|preset/);
    expect(script).toContain('node "${HELPER}" config "${dir}/rendered.yaml"');
    expect(script).toContain("\nrun_case pinned\n");
    expect(script).toContain(
      "\nrun_case reuse-values --set image.tag=0.96.0\n",
    );
  });

  test("in the Ops Config Test workflow, after the Job failures test", () => {
    const workflow = yaml.load(readRepoFile(WORKFLOW));
    const runs = workflow.jobs.test.steps
      .map((step) => {
        return step.run;
      })
      .filter(Boolean);

    const jobFailures = runs.indexOf(
      "bash Tests/Ops/agent-job-failures-increase-behaviour.sh",
    );
    expect(jobFailures).toBeGreaterThan(-1);
    expect(runs.indexOf(`bash ${SCRIPT}`)).toBe(jobFailures + 1);
  });

  test("and the README says what it checks", () => {
    const readme = readRepoFile("Tests/Ops/README.md");

    expect(readme).toContain("### `agent-volume-series-behaviour.sh`");
    expect(readme).toContain("### `KubernetesAgentVolumeSeries.test.js`");
  });
});
