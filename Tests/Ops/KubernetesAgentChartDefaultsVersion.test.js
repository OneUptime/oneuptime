"use strict";

/**
 * chartDefaultsVersion: the version of the kubernetes-agent chart a
 * values.yaml comes with.
 *
 * `helm upgrade --reuse-values` renders the new chart with the previous
 * release's values, the old chart's values.yaml included, so the chart's
 * NOTES.txt warns when the values it renders with come from another chart
 * (templates/_stale-defaults.tpl): it compares chartDefaultsVersion with
 * .Chart.Version. That only works when the published chart's values.yaml
 * carries the version it is published as. release.yml packages the chart
 * with `helm package --version <release>`, which sets Chart.yaml's version
 * in the package and leaves values.yaml alone, so it stamps values.yaml
 * itself first. A stamp that is not the chart's version would warn every
 * install; one that never changes would warn nobody. The same step copies
 * the chart's source to the helm-chart repository, with Chart.yaml's own
 * version, so it puts the repository's values.yaml back before that copy:
 * a stamped one beside it would warn every install from the copy.
 *
 * In the repository the stamp equals Chart.yaml's version, so a chart
 * rendered from a checkout (CI, the e2e suites) never warns; the chart's
 * own helm-unittest suites (stale-defaults-*_test.yaml) hold the template
 * side.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHART_DIR = "HelmChart/Public/kubernetes-agent";
const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const DEPLOY_JOB = "helm-chart-deploy";
const RELEASE_VERSION = "${{needs.read-version.outputs.major_minor}}";
const STAMP_LINE = /^chartDefaultsVersion: .*$/gm;

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

// The shell of the step that packages the kubernetes-agent chart.
function packageStepScript() {
  const workflow = yaml.load(read(RELEASE_WORKFLOW));
  const steps = (workflow.jobs[DEPLOY_JOB] || {}).steps || [];
  const packaging = steps.filter((step) => {
    return (
      typeof step.run === "string" &&
      /helm package\b[^\n]*\bkubernetes-agent\b/.test(step.run)
    );
  });
  expect(packaging).toHaveLength(1);
  return packaging[0].run;
}

/**
 * The stamp release.yml runs, as `sed -i 's/<pattern>/<replacement>/'
 * kubernetes-agent/values.yaml`, read so it can be applied here the way
 * GNU sed applies it (BSD sed on a laptop reads `-i` differently).
 */
function stampCommand() {
  const lines = packageStepScript()
    .split("\n")
    .map((line) => {
      return line.trim();
    })
    .filter((line) => {
      return line.startsWith("sed ") && line.includes("chartDefaultsVersion");
    });
  expect(lines).toHaveLength(1);
  const match = lines[0].match(
    /^sed -i 's\/(.+?)\/(.+?)\/' (kubernetes-agent\/values\.yaml)$/,
  );
  expect(match).not.toBeNull();
  return { pattern: match[1], replacement: match[2], file: match[3] };
}

function applyStamp(valuesText, version) {
  const { pattern, replacement } = stampCommand();
  // A sed basic regular expression here: ^, literal text and `.*`.
  expect(pattern).toMatch(/^\^[\w: ]+\.\*$/);
  const regex = new RegExp(pattern, "gm");
  return valuesText.replace(
    regex,
    replacement.split(RELEASE_VERSION).join(version),
  );
}

describe("the kubernetes-agent chart carries its own version in values.yaml", () => {
  test("values.yaml's chartDefaultsVersion is Chart.yaml's version, on one top-level line", () => {
    const valuesText = read(`${CHART_DIR}/values.yaml`);
    const chart = yaml.load(read(`${CHART_DIR}/Chart.yaml`));
    const values = yaml.load(valuesText);

    expect(valuesText.match(STAMP_LINE)).toEqual([
      `chartDefaultsVersion: "${chart.version}"`,
    ]);
    expect(values.chartDefaultsVersion).toBe(String(chart.version));
  });

  test("the values schema accepts it as a string", () => {
    const schema = JSON.parse(read(`${CHART_DIR}/values.schema.json`));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.chartDefaultsVersion.type).toBe("string");
    expect(schema.required).not.toContain("chartDefaultsVersion");
  });

  test("release.yml stamps it with the version it packages the chart as, before packaging, and checks the stamp", () => {
    const script = packageStepScript();
    const { file } = stampCommand();
    expect(file).toBe("kubernetes-agent/values.yaml");

    const stamp = script.indexOf("sed -i 's/^chartDefaultsVersion: ");
    const check = script.indexOf(
      `grep -qx 'chartDefaultsVersion: "${RELEASE_VERSION}"' kubernetes-agent/values.yaml`,
    );
    const lint = script.indexOf("helm lint kubernetes-agent");
    const packageLine = script.split("\n").find((line) => {
      return /helm package\b.*\bkubernetes-agent\b/.test(line);
    });
    const packaging = script.indexOf(packageLine);

    expect(stamp).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(stamp);
    expect(lint).toBeGreaterThan(check);
    expect(packaging).toBeGreaterThan(lint);
    // The same version the package gets.
    expect(packageLine).toContain(`--version ${RELEASE_VERSION}`);
    expect(stampCommand().replacement).toBe(
      `chartDefaultsVersion: "${RELEASE_VERSION}"`,
    );
  });

  test("release.yml puts the repository's values.yaml back after packaging, before it copies the chart's source", () => {
    const lines = packageStepScript()
      .split("\n")
      .map((line) => {
        return line.trim();
      });
    const packageLine = lines.findIndex((line) => {
      return /^helm package\b.*\bkubernetes-agent\b/.test(line);
    });
    const restores = lines
      .map((line, index) => {
        return { line, index };
      })
      .filter((entry) => {
        return /^git checkout\b/.test(entry.line);
      });
    const copy = lines.findIndex((line) => {
      return /^cp -r \.\/Public\/\* /.test(line);
    });

    expect(
      restores.map((entry) => {
        return entry.line;
      }),
    ).toEqual(["git checkout -- kubernetes-agent/values.yaml"]);
    expect(packageLine).toBeGreaterThan(-1);
    expect(restores[0].index).toBeGreaterThan(packageLine);
    expect(copy).toBeGreaterThan(restores[0].index);
    // It runs where the chart was packaged, so its path is the stamped file.
    expect(
      lines.slice(packageLine, restores[0].index).filter((line) => {
        return /^cd\b/.test(line);
      }),
    ).toEqual([]);
  });

  test("the stamp sets exactly that one value, and the grep after it accepts the result", () => {
    const valuesText = read(`${CHART_DIR}/values.yaml`);
    const stamped = applyStamp(valuesText, "14.0.15");

    expect(stamped.match(STAMP_LINE)).toEqual([
      'chartDefaultsVersion: "14.0.15"',
    ]);
    // `grep -qx` matches a whole line.
    expect(stamped.split("\n")).toContain('chartDefaultsVersion: "14.0.15"');

    const before = yaml.load(valuesText);
    const after = yaml.load(stamped);
    expect(after.chartDefaultsVersion).toBe("14.0.15");
    delete before.chartDefaultsVersion;
    delete after.chartDefaultsVersion;
    expect(after).toEqual(before);
    // Nothing else changed, comments included.
    expect(stamped.split("\n").length).toBe(valuesText.split("\n").length);
  });

  test("the chart's notes compare it with the chart's version", () => {
    const helper = read(`${CHART_DIR}/templates/_stale-defaults.tpl`);
    expect(helper).toContain(
      '{{- $from := toString (.Values.chartDefaultsVersion | default "") -}}',
    );
    expect(helper).toContain(
      "{{- $stale := ne $from (toString .Chart.Version) -}}",
    );
    expect(read(`${CHART_DIR}/templates/NOTES.txt`)).toContain(
      'include "kubernetes-agent.staleDefaults" . | fromJson',
    );
  });
});
