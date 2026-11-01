/*
 * The cumulative-to-delta processor's name, by collector
 * (Utils/CumulativeToDeltaProcessor.js).
 *
 * Collector 0.157.0 renamed the processor cumulative_to_delta and keeps
 * cumulativetodelta as a deprecated alias. A collector before 0.157.0 knows
 * only cumulativetodelta and refuses a whole config that names the new type.
 * The kubernetes-agent chart renders configs for the collector it pins and
 * for the 0.96.0 a `helm upgrade --reuse-values` keeps. 14.0.100's first gate
 * found it naming cumulative_to_delta for 0.96.0, which refused the
 * Deployment collector's config ("unknown type") in Ops Config Test's
 * validate-collector-configs.sh: an upgraded agent that would not start.
 */

const fs = require("fs");
const path = require("path");
const names = require("./Utils/CumulativeToDeltaProcessor");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEMPLATES = path.join(
  REPO_ROOT,
  "HelmChart/Public/kubernetes-agent/templates",
);
const HELPER_DEFINE =
  '{{- define "kubernetes-agent.cumulativeToDeltaProcessor" -}}';
const TEMPLATE_COMMENT = /\{\{-?\s*\/\*[\s\S]*?\*\/\s*-?\}\}/g;
const NAMED_TYPE = /\b(?:cumulative_to_delta|cumulativetodelta)\//;

const PINNED = "otel/opentelemetry-collector-contrib:0.161.0";
const REUSE_VALUES = "otel/opentelemetry-collector-contrib:0.96.0";

function readTemplate(file) {
  return fs.readFileSync(path.join(TEMPLATES, file), "utf8");
}

describe("the type a collector knows the processor by", () => {
  test.each([
    ["otel/opentelemetry-collector-contrib:0.96.0", "cumulativetodelta"],
    ["otel/opentelemetry-collector-contrib:0.156.0", "cumulativetodelta"],
    ["otel/opentelemetry-collector-contrib:0.156.9", "cumulativetodelta"],
    ["otel/opentelemetry-collector-contrib:0.157.0", "cumulative_to_delta"],
    ["otel/opentelemetry-collector-contrib:0.157.1", "cumulative_to_delta"],
    ["otel/opentelemetry-collector-contrib:0.161.0", "cumulative_to_delta"],
    ["otel/opentelemetry-collector-contrib:1.0.0", "cumulative_to_delta"],
    ["registry.example.com/mirror/otelcol:v0.96.0", "cumulativetodelta"],
    [
      "otel/opentelemetry-collector-contrib:0.161.0@sha256:0123abcd",
      "cumulative_to_delta",
    ],
  ])("%s knows it as %s", (image, type) => {
    expect(names.cumulativeToDeltaType(image)).toBe(type);
  });

  test("an image whose tag names no version is refused, never guessed", () => {
    expect(() => {
      names.cumulativeToDeltaType(
        "otel/opentelemetry-collector-contrib:latest",
      );
    }).toThrow("no collector version");
  });

  test("the two types are the new name and its alias", () => {
    expect(names.RENAMED_TYPE).toBe("cumulative_to_delta");
    expect(names.ALIAS_TYPE).toBe("cumulativetodelta");
  });
});

describe("processor names as an image knows them", () => {
  const PROCESSORS = [
    "memory_limiter",
    "transform/x",
    "cumulative_to_delta/x",
    "cumulative_to_delta/y",
    "batch",
  ];

  test("on a collector before 0.157.0, only the cumulative-to-delta ones change", () => {
    expect(names.processorNamesFor(PROCESSORS, REUSE_VALUES)).toEqual([
      "memory_limiter",
      "transform/x",
      "cumulativetodelta/x",
      "cumulativetodelta/y",
      "batch",
    ]);
  });

  test("the pinned collector, and no image at all, keep every name", () => {
    expect(names.processorNamesFor(PROCESSORS, PINNED)).toEqual(PROCESSORS);
    expect(names.processorNamesFor(PROCESSORS, undefined)).toEqual(PROCESSORS);
  });

  test("a name that only starts like the type is left alone", () => {
    expect(
      names.processorNamesFor(["cumulative_to_delta_extra/x"], REUSE_VALUES),
    ).toEqual(["cumulative_to_delta_extra/x"]);
  });
});

describe("the chart", () => {
  test("switches the type at the version the helpers here switch it", () => {
    const helpers = readTemplate("_helpers.tpl");
    const at = helpers.indexOf(HELPER_DEFINE);
    expect(at).toBeGreaterThan(-1);
    const define = helpers.substring(
      at,
      helpers.indexOf("{{- end -}}\n{{- end -}}", at),
    );

    expect(define).toContain(
      `(dict "root" . "version" "${names.RENAMED_IN.join(".")}")`,
    );
    // The new name from that version on, the alias before it.
    expect(define.indexOf(`\n${names.RENAMED_TYPE}\n`)).toBeGreaterThan(-1);
    expect(define.indexOf(`\n${names.ALIAS_TYPE}\n`)).toBeGreaterThan(
      define.indexOf(`\n${names.RENAMED_TYPE}\n`),
    );
  });

  test("asks that helper wherever it names the processor, outside comments", () => {
    const named = [];
    for (const file of fs.readdirSync(TEMPLATES)) {
      const lines = readTemplate(file)
        .replace(TEMPLATE_COMMENT, "")
        .split("\n");
      lines.forEach((line, index) => {
        const code = line.trim();
        if (!code.startsWith("#") && NAMED_TYPE.test(code)) {
          named.push(`${file}: ${code}`);
        }
      });
    }

    expect(named).toEqual([]);
  });

  test("and the Deployment collector's two increase processors do ask it, where they are defined and where they run", () => {
    const template = readTemplate("configmap-deployment.yaml");

    for (const processor of ["restarts-increase", "job-failures-increase"]) {
      expect(template).toContain(
        `\n      ${names.TEMPLATE_TYPE}/${processor}:\n`,
      );
      expect(template).toContain(
        `\n            - ${names.TEMPLATE_TYPE}/${processor}\n`,
      );
    }
  });

  test("reads as written for the pinned collector once the helper's answer is in", () => {
    const template = names.templateForPinnedCollector(
      readTemplate("configmap-deployment.yaml"),
    );

    expect(template).not.toContain(names.TEMPLATE_TYPE);
    expect(template).toContain(
      "\n      cumulative_to_delta/restarts-increase:\n",
    );
    expect(template).toContain(
      "\n            - cumulative_to_delta/job-failures-increase\n",
    );
  });
});
