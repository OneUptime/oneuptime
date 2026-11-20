/*
 * The Kubernetes agent's renamed collector components, by collector
 * (Utils/CollectorComponentTypes.js, #9930).
 *
 * The collector renamed seven of the components the chart's configs use, and
 * its own OTLP HTTP exporter, and keeps each old type as a deprecated alias:
 * 0.165.0, the chart's pin, warns about every one on every start, and a later
 * release drops it and refuses the config. A collector before a rename knows
 * only the old type and refuses a whole config that names the new one. The
 * chart renders configs for the collector it pins and for the 0.96.0 a
 * `helm upgrade --reuse-values` keeps, so it writes each type as the collector
 * it renders for knows it (kubernetes-agent.componentType). 14.0.100's first
 * gate found it naming cumulative_to_delta for 0.96.0, which refused the
 * Deployment collector's config: an upgraded agent that would not start.
 */

const fs = require("fs");
const path = require("path");
const types = require("./Utils/CollectorComponentTypes");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES = path.join(
  REPO_ROOT,
  "HelmChart/Public/kubernetes-agent/templates",
);
const TEMPLATE_COMMENT = /\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g;

const PINNED = "otel/opentelemetry-collector-contrib:0.165.0";
const REUSE_VALUES = "otel/opentelemetry-collector-contrib:0.96.0";

function readTemplate(file) {
  return fs.readFileSync(path.join(TEMPLATES, file), "utf8");
}

function image(version) {
  return `otel/opentelemetry-collector-contrib:${version}`;
}

const NEW_TYPES = Object.keys(types.RENAMED_TYPES);
const ALIASES = NEW_TYPES.map((type) => {
  return types.RENAMED_TYPES[type].alias;
});

describe("the type a collector knows each component by", () => {
  test.each([
    ["otlp_http", "0.143.0", "otlphttp"],
    ["otlp_http", "0.144.0", "otlp_http"],
    ["k8s_attributes", "0.145.0", "k8sattributes"],
    ["k8s_attributes", "0.146.0", "k8s_attributes"],
    ["file_log", "0.148.0", "filelog"],
    ["file_log", "0.149.0", "file_log"],
    ["host_metrics", "0.150.0", "hostmetrics"],
    ["host_metrics", "0.151.0", "host_metrics"],
    ["k8s_objects", "0.150.0", "k8sobjects"],
    ["k8s_objects", "0.151.0", "k8s_objects"],
    ["kubelet_stats", "0.151.0", "kubeletstats"],
    ["kubelet_stats", "0.152.0", "kubelet_stats"],
    ["resource_detection", "0.152.0", "resourcedetection"],
    ["resource_detection", "0.153.0", "resource_detection"],
    ["cumulative_to_delta", "0.156.0", "cumulativetodelta"],
    ["cumulative_to_delta", "0.156.9", "cumulativetodelta"],
    ["cumulative_to_delta", "0.157.0", "cumulative_to_delta"],
    ["cumulative_to_delta", "0.157.1", "cumulative_to_delta"],
  ])("%s on %s is %s", (type, version, expected) => {
    expect(types.componentTypeFor(type, image(version))).toBe(expected);
  });

  test("the pinned collector knows every new type, and 0.96.0 only the old ones", () => {
    for (const type of NEW_TYPES) {
      expect(types.componentTypeFor(type, PINNED)).toBe(type);
      expect(types.componentTypeFor(type, REUSE_VALUES)).toBe(
        types.RENAMED_TYPES[type].alias,
      );
    }
  });

  test("reads the version from a mirror's tag, a v and a digest", () => {
    expect(
      types.componentTypeFor(
        "kubelet_stats",
        "registry.example.com/mirror/otelcol:v0.96.0",
      ),
    ).toBe("kubeletstats");
    expect(
      types.componentTypeFor(
        "kubelet_stats",
        "otel/opentelemetry-collector-contrib:0.165.0@sha256:0123abcd",
      ),
    ).toBe("kubelet_stats");
    expect(types.componentTypeFor("kubelet_stats", image("1.0.0"))).toBe(
      "kubelet_stats",
    );
  });

  test("an image whose tag names no version is refused, never guessed", () => {
    expect(() => {
      types.componentTypeFor(
        "kubelet_stats",
        "otel/opentelemetry-collector-contrib:latest",
      );
    }).toThrow("no collector version");
  });

  test("a type that was never renamed is refused", () => {
    expect(() => {
      types.componentTypeFor("k8s_cluster", PINNED);
    }).toThrow("no renamed component type");
  });

  test("each new type is its alias in snake_case", () => {
    for (const type of NEW_TYPES) {
      expect(type.replace(/_/g, "")).toBe(types.RENAMED_TYPES[type].alias);
    }
  });
});

describe("component ids as an image knows them", () => {
  const IDS = [
    "memory_limiter",
    "transform/x",
    "k8s_attributes",
    "cumulative_to_delta/x",
    "file_log/audit",
    "otlp_http",
    "k8s_cluster",
    "batch",
  ];

  test("on 0.96.0 every renamed one is its alias, its name after the slash kept", () => {
    expect(types.componentNamesFor(IDS, REUSE_VALUES)).toEqual([
      "memory_limiter",
      "transform/x",
      "k8sattributes",
      "cumulativetodelta/x",
      "filelog/audit",
      "otlphttp",
      "k8s_cluster",
      "batch",
    ]);
  });

  test("between two renames, only the ones before it change", () => {
    expect(types.componentNamesFor(IDS, image("0.150.0"))).toEqual([
      "memory_limiter",
      "transform/x",
      "k8s_attributes",
      "cumulativetodelta/x",
      "file_log/audit",
      "otlp_http",
      "k8s_cluster",
      "batch",
    ]);
  });

  test("the pinned collector, and no image at all, keep every id", () => {
    expect(types.componentNamesFor(IDS, PINNED)).toEqual(IDS);
    expect(types.componentNamesFor(IDS, undefined)).toEqual(IDS);
  });

  test("an id that only starts like a type is left alone", () => {
    expect(
      types.componentNamesFor(
        ["cumulative_to_delta_extra/x", "file_logs"],
        REUSE_VALUES,
      ),
    ).toEqual(["cumulative_to_delta_extra/x", "file_logs"]);
  });
});

describe("the chart", () => {
  test("switches each type at the version the table here does", () => {
    const helpers = readTemplate("_helpers.tpl");
    const define = helpers.substring(
      helpers.indexOf(
        '{{- define "kubernetes-agent.renamedComponentTypes" -}}',
      ),
    );
    const table = define.substring(0, define.indexOf("{{- end -}}"));
    const pairs = [
      ...table.matchAll(
        /"([a-z0-9_]+)" \(list "([a-z0-9]+)" "(\d+\.\d+\.\d+)"\)/g,
      ),
    ].map((match) => {
      return [match[1], { alias: match[2], since: match[3] }];
    });

    expect(Object.fromEntries(pairs)).toEqual(
      Object.fromEntries(
        NEW_TYPES.map((type) => {
          return [
            type,
            {
              alias: types.RENAMED_TYPES[type].alias,
              since: types.RENAMED_TYPES[type].since.join("."),
            },
          ];
        }),
      ),
    );
  });

  test("names a renamed component nowhere but through the helper, outside comments", () => {
    const component = new RegExp(
      `^(?:- )?(?:${[...NEW_TYPES, ...ALIASES].join("|")})(?:/[a-z-]+)?:?$`,
    );
    const named = [];
    for (const file of fs.readdirSync(TEMPLATES)) {
      /*
       * The profiler's config runs in its own distribution, the eBPF
       * profiler's (profiling.image), which names its exporter otlp_http and
       * nothing else, whatever image.tag says.
       */
      if (file === "configmap-profiling.yaml") {
        continue;
      }
      const lines = readTemplate(file)
        .replace(TEMPLATE_COMMENT, "")
        .split("\n");
      lines.forEach((line) => {
        const code = line.trim();
        if (!code.startsWith("#") && component.test(code)) {
          named.push(`${file}: ${code}`);
        }
      });
    }

    expect(named).toEqual([]);
  });

  test("declares each type a collector template uses once, and uses each one it declares", () => {
    for (const file of [
      "configmap-daemonset.yaml",
      "configmap-deployment.yaml",
    ]) {
      const template = readTemplate(file);
      const variables = types.templateVariables(template);
      const used = new Set(
        [...template.matchAll(/\{\{ \$([A-Za-z0-9]+) \}\}/g)].map((match) => {
          return match[1];
        }),
      );

      expect(Object.keys(variables).length).toBeGreaterThan(0);
      for (const variable of used) {
        expect(variables).toHaveProperty(variable);
      }
      for (const variable of Object.keys(variables)) {
        expect(used.has(variable)).toBe(true);
      }
      // A variable holds the type its name says.
      for (const [variable, type] of Object.entries(variables)) {
        expect(variable.toLowerCase()).toBe(type.replace(/_/g, ""));
      }
    }
  });

  test("reads as written for the pinned collector once the types are in", () => {
    const daemonSet = types.templateForPinnedCollector(
      readTemplate("configmap-daemonset.yaml"),
    );
    const deployment = types.templateForPinnedCollector(
      readTemplate("configmap-deployment.yaml"),
    );

    for (const template of [daemonSet, deployment]) {
      expect(template).not.toMatch(/\{\{ \$[A-Za-z0-9]+ \}\}/);
      expect(template).toContain("\n      k8s_attributes:\n");
      expect(template).toContain("\n      otlp_http:\n");
    }
    expect(daemonSet).toContain("\n      kubelet_stats:\n");
    expect(daemonSet).toContain("\n      host_metrics:\n");
    expect(daemonSet).toContain("\n      file_log:\n");
    expect(daemonSet).toContain("\n      file_log/audit:\n");
    expect(daemonSet).toContain("\n            - kubelet_stats\n");
    expect(deployment).toContain("\n      k8s_objects:\n");
    expect(deployment).toContain(
      "\n      cumulative_to_delta/restarts-increase:\n",
    );
    expect(deployment).toContain(
      "\n            - cumulative_to_delta/job-failures-increase\n",
    );
    expect(deployment).toContain("\n            - k8s_objects/compliance\n");
  });

  test("and the openshift detector's helper names the detector through it too", () => {
    const helpers = types.templateForPinnedCollector(
      readTemplate("_helpers.tpl"),
    );
    const define = helpers.substring(
      helpers.indexOf('{{- define "kubernetes-agent.openshiftDetector" -}}'),
    );

    expect(define).toMatch(
      /^\{\{- define "[^"]+" -\}\}\nresource_detection\/openshift:\n/,
    );
  });
});
