"use strict";

/**
 * The volume series the Kubernetes agent's node collector keeps and drops.
 *
 * The kubelet receiver's volume group sends five series for every volume of
 * every pod. Most of them were a pod's service account token and its
 * configMap, secret and downwardAPI volumes: a few small files in memory,
 * whose capacity says nothing about a disk, and which OneUptime never reads.
 * The node collector's filter/volume-series drops those (issue #9644) by the
 * type the receiver gives a volume from its pod's spec, and a token by its
 * name, because the receiver types no projected volume yet. A collector that
 * types projected volumes (issue #9842, opentelemetry-collector-contrib#52198)
 * has every one dropped by its type - and without that clause would send
 * every pod's token again, since the name match is only for a volume with no
 * type.
 *
 * A volume goes by two names (#10055): the receiver's k8s.volume.name and
 * k8s.volume.type, and the k8s.pod.volume.name and k8s.pod.volume.type
 * semantic conventions renamed them to (semantic-conventions#4272), which the
 * receiver is to follow, perhaps sending both for a while. The filter has a
 * condition for each name, the same rules over each, so every volume is kept
 * or dropped alike under either name and both.
 *
 * tests/volume-series-filter_test.yaml in the chart holds the render to the
 * conditions. agent-volume-series-behaviour.sh runs the rendered filter in the
 * collector the chart pins and in 0.96.0. This suite holds the two together:
 * the volumes the script sends cover every type and every token name the
 * conditions read, under every name, and the ones it expects kept are the ones
 * the conditions keep; its check passes the export they predict and refuses
 * the ones it must not; and the workflow runs it.
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

const PINNED_IMAGE = "otel/opentelemetry-collector-contrib:0.165.0";
const REUSE_VALUES_IMAGE = "otel/opentelemetry-collector-contrib:0.96.0";

const CLAIM_KEY = "k8s.persistentvolumeclaim.name";

/*
 * The two names a volume's attributes go by, in the order the filter's
 * conditions read them: the receiver's, and semantic conventions'.
 */
const NAMES = [
  { name: "k8s.volume.name", type: "k8s.volume.type" },
  { name: "k8s.pod.volume.name", type: "k8s.pod.volume.type" },
];

function attributeOf(key) {
  return `resource.attributes["${key}"]`;
}

function readRepoFile(file) {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

// The filter's conditions, as the template writes them.
function filterConditions() {
  const text = readRepoFile(TEMPLATE);
  const start = text.indexOf(`      ${behaviour.FILTER}:\n`);
  expect(start).toBeGreaterThan(-1);
  const block = text.slice(start, text.indexOf("{{- end }}", start));
  return [...block.matchAll(/^ {12}- '(.*)'$/gm)].map((match) => {
    return match[1];
  });
}

// The types a condition drops, in its order, read from the type key it names.
function droppedTypes(condition, typeKey) {
  const escaped = typeKey.replace(/\./g, "\\.");
  return [
    ...condition.matchAll(
      new RegExp(`resource\\.attributes\\["${escaped}"\\] == "([^"]+)"`, "g"),
    ),
  ].map((match) => {
    return match[1];
  });
}

// The token names a condition matches, as the regular expression OTTL compiles.
function tokenPatternSource(condition) {
  return condition.match(
    /IsMatch\(resource\.attributes\["[^"]+"\], "([^"]+)"\)/,
  )[1];
}

/*
 * A condition read as this suite reads it: the name it is for, the type keys,
 * the types it drops and the token pattern. Only true to the condition while
 * it has the shape the first test holds it to.
 */
function parsedConditions() {
  return filterConditions().map((condition, index) => {
    const names = NAMES[index];
    const other = NAMES[1 - index];
    return {
      text: condition,
      nameKey: names.name,
      typeKey: names.type,
      otherTypeKey: other.type,
      types: droppedTypes(condition, names.type),
      pattern: tokenPatternSource(condition),
    };
  });
}

// What one condition says of a resource's attributes, as OTTL evaluates it.
function conditionDrops(condition, attributes) {
  const name = attributes[condition.nameKey];
  if (name === undefined || attributes[CLAIM_KEY] !== undefined) {
    return false;
  }
  const type = attributes[condition.typeKey];
  if (type !== undefined) {
    return condition.types.includes(type);
  }
  if (attributes[condition.otherTypeKey] !== undefined) {
    return false;
  }
  return new RegExp(condition.pattern).test(name);
}

function attributesOf(volume, naming) {
  return Object.fromEntries(
    behaviour.volumeResourceAttributes(volume, naming).map((attribute) => {
      return [attribute.key, attribute.value.stringValue];
    }),
  );
}

// The filter drops a metric when any of its conditions does.
function dropsVolume(conditions, volume, naming) {
  const attributes = attributesOf(volume, naming);
  return conditions.some((condition) => {
    return conditionDrops(condition, attributes);
  });
}

// The token names the pattern spells out: its alternatives, a suffix filled in.
function tokenNames(pattern) {
  const alternatives = pattern.match(/^\^\((.*)\)\$$/)[1].split("|");
  return alternatives.map((alternative) => {
    return alternative.replace("[a-z0-9]+", "x7k2p");
  });
}

// Every volume of the script, under every naming it sends them by.
function everyCase() {
  return behaviour.NAMINGS.flatMap((naming) => {
    return behaviour.VOLUMES.map((volume) => {
      return { volume, naming };
    });
  });
}

// An export of exactly the cases kept, as the file exporter writes it.
function exportOf(cases, others) {
  const payload = behaviour.scrapePayload();
  const keep = new Set([
    ...cases.map((entry) => {
      return behaviour.caseOf(entry.volume, entry.naming);
    }),
    ...others.map((other) => {
      return other.label;
    }),
  ]);
  return {
    resourceMetrics: payload.resourceMetrics.filter((resourceMetrics) => {
      const metric = resourceMetrics.scopeMetrics[0].metrics[0];
      const label = (metric.gauge || metric.sum).dataPoints[0].attributes[0]
        .value.stringValue;
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
  const conditions = parsedConditions();

  test("is a condition for each name a volume goes by, the receiver's first", () => {
    expect(conditions).toHaveLength(2);
    expect(
      conditions.map((condition) => {
        return condition.nameKey;
      }),
    ).toEqual(["k8s.volume.name", "k8s.pod.volume.name"]);
  });

  test("each of the shape this suite reads: a named volume with no claim, of a type it drops, or that no name types, with a token's name", () => {
    for (const condition of conditions) {
      const name = attributeOf(condition.nameKey);
      const type = attributeOf(condition.typeKey);
      const rebuilt = `${name} != nil and ${attributeOf(CLAIM_KEY)} == nil and (${condition.types
        .map((dropped) => {
          return `${type} == "${dropped}"`;
        })
        .join(
          " or ",
        )} or (${type} == nil and ${attributeOf(condition.otherTypeKey)} == nil and IsMatch(${name}, "${condition.pattern}")))`;

      expect(condition.text).toBe(rebuilt);
    }
  });

  test("the same rules for both: the types and the tokens alike", () => {
    expect(conditions[1].types).toEqual(conditions[0].types);
    expect(conditions[1].pattern).toBe(conditions[0].pattern);
    // Each reads only its own name's type, but for the type no name gives.
    expect(conditions[0].text).not.toMatch(/k8s\.pod\.volume\.type"\] == "/);
    expect(conditions[1].text).not.toMatch(/k8s\.volume\.type"\] == "/);
  });

  test("drops the types the receiver gives a pod's small volumes, and projected (#9842)", () => {
    expect(conditions[0].types).toEqual([
      "configMap",
      "secret",
      "downwardAPI",
      "projected",
    ]);
  });

  test("tells the tokens of Kubernetes, EKS, Azure Workload Identity, Istio and Linkerd by their whole names", () => {
    expect(tokenNames(conditions[0].pattern)).toEqual([
      "kube-api-access-x7k2p",
      "aws-iam-token",
      "eks-pod-identity-token",
      "azure-identity-token",
      "istio-token",
      "linkerd-identity-token",
    ]);
    const pattern = new RegExp(conditions[0].pattern);
    expect(pattern.test("kube-api-access-x7k2p-old")).toBe(false);
    expect(pattern.test("my-istio-token")).toBe(false);
  });

  test("leaves the claim's name as it is: semantic conventions renamed only the pod's volume", () => {
    for (const condition of conditions) {
      expect(condition.text).toContain(`${attributeOf(CLAIM_KEY)} == nil`);
    }
  });
});

describe("agent-volume-series-behaviour.sh sends every kind of volume", () => {
  const conditions = parsedConditions();

  test("each volume it expects kept is one the conditions keep, under every name, and each it expects dropped one they drop", () => {
    for (const { volume, naming } of everyCase()) {
      const label = behaviour.caseOf(volume, naming);
      expect({
        volume: label,
        kept: !dropsVolume(conditions, volume, naming),
      }).toEqual({ volume: label, kept: volume.kept });
    }
  });

  test("under the receiver's names, semantic conventions' on either series, and both at once", () => {
    expect(
      behaviour.NAMINGS.map((naming) => {
        return {
          label: naming.label,
          names: naming.names,
          types: naming.types,
          metrics: naming.metrics,
        };
      }),
    ).toEqual([
      {
        label: "receiver",
        names: ["k8s.volume.name"],
        types: ["k8s.volume.type"],
        metrics: behaviour.VOLUME_METRICS,
      },
      {
        label: "semconv-attributes",
        names: ["k8s.pod.volume.name"],
        types: ["k8s.pod.volume.type"],
        metrics: behaviour.VOLUME_METRICS,
      },
      {
        label: "semconv",
        names: ["k8s.pod.volume.name"],
        types: ["k8s.pod.volume.type"],
        metrics: behaviour.POD_VOLUME_METRICS,
      },
      {
        label: "both",
        names: ["k8s.volume.name", "k8s.pod.volume.name"],
        types: ["k8s.volume.type", "k8s.pod.volume.type"],
        metrics: behaviour.VOLUME_METRICS,
      },
    ]);
    expect(behaviour.POD_VOLUME_METRICS).toEqual([
      "k8s.pod.volume.available",
      "k8s.pod.volume.capacity",
      "k8s.pod.volume.inode.count",
      "k8s.pod.volume.inode.free",
      "k8s.pod.volume.inode.used",
    ]);
  });

  test("every type the conditions drop, typed so", () => {
    for (const type of conditions[0].types) {
      expect(
        behaviour.VOLUMES.some((volume) => {
          return volume.type === type && !volume.claim && !volume.kept;
        }),
      ).toBe(true);
    }
  });

  test("every token the conditions name, untyped, and a projected token typed", () => {
    for (const name of tokenNames(conditions[0].pattern)) {
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
          new RegExp(conditions[0].pattern).test(volume.name)
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
          volume.claim && new RegExp(conditions[0].pattern).test(volume.name)
        );
      }),
    ).toBe(true);
  });

  test("a volume typed under one name and not the other is judged by its type, never by a token's name", () => {
    const attributes = {
      "k8s.volume.name": "kube-api-access-x7k2p",
      "k8s.pod.volume.name": "kube-api-access-x7k2p",
      "k8s.pod.volume.type": "emptyDir",
    };
    expect(
      conditions.some((condition) => {
        return conditionDrops(condition, attributes);
      }),
    ).toBe(false);
    attributes["k8s.pod.volume.type"] = "projected";
    expect(
      conditions.some((condition) => {
        return conditionDrops(condition, attributes);
      }),
    ).toBe(true);
  });

  test("each as a collector sends it: its pod, its name, and its type and claim only when it has them, under the naming's names", () => {
    const keys = (volume, naming) => {
      return behaviour
        .volumeResourceAttributes(volume, naming)
        .map((attribute) => {
          return attribute.key;
        });
    };
    const [receiver, semconvAttributes, semconv, both] = behaviour.NAMINGS;

    expect(keys({ name: "tls", type: "secret" })).toEqual([
      "k8s.pod.uid",
      "k8s.pod.name",
      "k8s.namespace.name",
      "k8s.volume.name",
      "k8s.volume.type",
    ]);
    expect(keys({ name: "tls", type: "secret" }, receiver)).toEqual(
      keys({ name: "tls", type: "secret" }),
    );
    for (const naming of [semconvAttributes, semconv]) {
      expect(keys({ name: "tls", type: "secret" }, naming)).toEqual([
        "k8s.pod.uid",
        "k8s.pod.name",
        "k8s.namespace.name",
        "k8s.pod.volume.name",
        "k8s.pod.volume.type",
      ]);
    }
    expect(keys({ name: "tls", type: "secret" }, both)).toEqual([
      "k8s.pod.uid",
      "k8s.pod.name",
      "k8s.namespace.name",
      "k8s.volume.name",
      "k8s.pod.volume.name",
      "k8s.volume.type",
      "k8s.pod.volume.type",
    ]);
    expect(keys({ name: "scratch" }, both)).not.toContain("k8s.volume.type");
    expect(keys({ name: "scratch" }, both)).not.toContain(
      "k8s.pod.volume.type",
    );
    expect(
      keys({ name: "data", type: "persistentVolumeClaim", claim: "data-0" }),
    ).toContain(CLAIM_KEY);
  });

  test("five series a volume under every naming, as each sends them, beside the node's, a pod's and a container's", () => {
    const payload = behaviour.scrapePayload();
    const volumeCount = behaviour.NAMINGS.length * behaviour.VOLUMES.length;

    expect(payload.resourceMetrics).toHaveLength(
      volumeCount + behaviour.OTHERS.length,
    );
    behaviour.NAMINGS.forEach((naming, index) => {
      const sent = payload.resourceMetrics.slice(
        index * behaviour.VOLUMES.length,
        (index + 1) * behaviour.VOLUMES.length,
      );
      for (const resourceMetrics of sent) {
        const metrics = resourceMetrics.scopeMetrics[0].metrics;
        expect(
          metrics.map((metric) => {
            return metric.name;
          }),
        ).toEqual(naming.metrics);
        // Semantic conventions' series are up-down counters; the receiver's gauges.
        for (const metric of metrics) {
          if (naming.metrics === behaviour.POD_VOLUME_METRICS) {
            expect(metric.sum).toEqual(
              expect.objectContaining({
                aggregationTemporality: 2,
                isMonotonic: false,
              }),
            );
            expect(metric.gauge).toBeUndefined();
          } else {
            expect(metric.gauge).toBeDefined();
          }
        }
      }
    });
    // Every case named once, so an export says which volume came through.
    const cases = everyCase().map((entry) => {
      return behaviour.caseOf(entry.volume, entry.naming);
    });
    expect(new Set(cases).size).toBe(cases.length);
  });
});

describe("its check", () => {
  const conditions = parsedConditions();
  let dir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(require("os").tmpdir(), "volume-series-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const keptCases = () => {
    return everyCase().filter((entry) => {
      return !dropsVolume(conditions, entry.volume, entry.naming);
    });
  };

  test("passes the export the conditions predict", () => {
    const points = exportedPoints(exportOf(keptCases(), behaviour.OTHERS), dir);

    expect(points).toHaveLength(behaviour.expectedLines().length);
    expect(behaviour.problemsWith(points)).toEqual([]);
  });

  test("refuses an export that dropped a claim's volume, under any name", () => {
    for (const label of ["receiver", "semconv"]) {
      const points = exportedPoints(
        exportOf(
          keptCases().filter((entry) => {
            return !(
              entry.volume.claim === "data-web-0" &&
              entry.naming.label === label
            );
          }),
          behaviour.OTHERS,
        ),
        dir,
      );
      const metric =
        label === "semconv"
          ? "k8s.pod.volume.available"
          : "k8s.volume.available";

      expect(behaviour.problemsWith(points).join("\n")).toContain(
        `it dropped ${metric} ${label} persistentVolumeClaim data claim=data-web-0`,
      );
    }
  });

  test("refuses the export of a filter that typed projected volumes nothing, which sends their tokens again", () => {
    const projected = everyCase().filter((entry) => {
      return entry.volume.type === "projected";
    });
    const points = exportedPoints(
      exportOf([...keptCases(), ...projected], behaviour.OTHERS),
      dir,
    );

    expect(behaviour.problemsWith(points).join("\n")).toContain(
      "it sent k8s.volume.available receiver projected bundle",
    );
    expect(behaviour.problemsWith(points).join("\n")).toContain(
      "k8s.volume.available receiver projected kube-api-access-x7k2p",
    );
  });

  test("refuses the export of a filter that read the receiver's names alone, which sends every small volume semantic conventions name", () => {
    const receiverOnly = [conditions[0]];
    const leaked = everyCase().filter((entry) => {
      return !dropsVolume(receiverOnly, entry.volume, entry.naming);
    });
    const problems = behaviour
      .problemsWith(exportedPoints(exportOf(leaked, behaviour.OTHERS), dir))
      .join("\n");

    expect(problems).toContain("it sent ");
    expect(problems).toContain(
      "k8s.pod.volume.available semconv configMap config",
    );
    expect(problems).toContain(
      "k8s.volume.available semconv-attributes untyped kube-api-access-x7k2p",
    );
    // Both names at once were dropped by the receiver's alone.
    expect(problems).not.toContain(" both ");
  });

  test("refuses an export that dropped the node's own series", () => {
    const points = exportedPoints(
      exportOf(
        keptCases(),
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
    const exported = exportOf(keptCases(), behaviour.OTHERS);
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
  function stubCollector(processors, receiver = "kubelet_stats") {
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
            receivers: [receiver, "host_metrics"],
            processors,
            exporters: ["otlp_http"],
          },
        },
      },
    };
  }

  const PIPELINE = [
    "memory_limiter",
    behaviour.FILTER,
    "filter/cpu-utilization",
    "batch",
  ];

  test("is the filter as rendered, alone, from OTLP to a file", () => {
    const config = behaviour.behaviourConfig(stubCollector(PIPELINE));

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

  test("reads the receiver by the type the image knows: kubelet_stats on the pin, kubeletstats on 0.96.0", () => {
    expect(behaviour.RECEIVER).toBe("kubelet_stats");
    expect(() => {
      behaviour.behaviourConfig(stubCollector(PIPELINE), PINNED_IMAGE);
      behaviour.behaviourConfig(
        stubCollector(PIPELINE, "kubeletstats"),
        REUSE_VALUES_IMAGE,
      );
    }).not.toThrow();
  });

  test("and refuses a render whose metrics pipeline runs it anywhere but first after the memory limiter, or on a receiver the image does not know", () => {
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
      // The old type on the pin, the new one on 0.96.0: neither is what it runs.
      expect(() => {
        behaviour.behaviourConfig(
          stubCollector(PIPELINE, "kubeletstats"),
          PINNED_IMAGE,
        );
      }).toThrow("exit 1");
      expect(() => {
        behaviour.behaviourConfig(stubCollector(PIPELINE), REUSE_VALUES_IMAGE);
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
