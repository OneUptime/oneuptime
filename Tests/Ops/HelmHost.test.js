"use strict";

/**
 * The oneuptime chart's host, rendered by helm itself (helm on PATH; CI has
 * it, see .github/workflows/test.ops.yaml).
 *
 * host is the address people open OneUptime at, and every workload reads it
 * as HOST: the app builds every link from it, and nginx names its primary
 * server by it, without the port. It is a domain name or an IPv4 address,
 * with or without :port, or an IPv6 address in brackets, with or without
 * :port after them: [2001:db8::1], [2001:db8::1]:8080.
 *
 * Without brackets an IPv6 host never worked (#8022), and the chart now
 * refuses one (oneuptime.validateHost), with the value to set. The brackets
 * are not put in for the person: 2001:db8::1:8080 is an address of its own,
 * and also 2001:db8::1 on port 8080.
 *
 * tests/host_test.yaml holds the same, template by template. These renders
 * add what helm-unittest cannot hold: that every workload of the chart, with
 * all of them on, gets HOST exactly as written; the error of a host whose
 * last group could be a port (helm-unittest reads the "1:8080" in such an
 * error as a template's file:line:column, and finds no failed template); and
 * what helm makes of an IPv6 host from --set and from a values file.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ONEUPTIME_CHART = path.join(
  REPO_ROOT,
  "HelmChart",
  "Public",
  "oneuptime",
);

const WORKLOAD_KINDS = ["Deployment", "StatefulSet", "Job", "DaemonSet"];

// Every workload the chart runs, switched on at once.
const ALL_ON = {
  worker: { enabled: true },
  home: { enabled: true },
  telemetryWriter: { enabled: true },
  testServer: { enabled: true },
  vllm: { enabled: true },
  cronJobs: { cleanup: { enabled: true }, e2e: { enabled: true } },
};

const HELM_PROBE = spawnSync("helm", ["version", "--short"], {
  encoding: "utf8",
});
const HELM_MISSING = Boolean(HELM_PROBE.error) || HELM_PROBE.status !== 0;

if (HELM_MISSING && !process.env.CI) {
  // eslint-disable-next-line no-console
  console.warn(
    "Helm host renders skipped: helm is not on PATH (CI has it, see .github/workflows/test.ops.yaml).",
  );
}

const testWithHelm = HELM_MISSING && !process.env.CI ? test.skip : test;

/*
 * `helm template` of the chart with a values file (`values`, written as
 * YAML text when it is a string, as JSON otherwise) and `args`:
 * { status, stdout, stderr }.
 */
function helmTemplate(values, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helm-host-"));
  const file = path.join(dir, "values.yaml");

  try {
    fs.writeFileSync(
      file,
      typeof values === "string" ? values : JSON.stringify(values),
    );

    return spawnSync(
      "helm",
      [
        "template",
        "ou",
        ONEUPTIME_CHART,
        "--namespace",
        "oneuptime",
        "--values",
        file,
      ].concat(args || []),
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// HOST of every container of every workload of a render, as "<workload>": "<HOST>".
function hostOfEveryWorkload(stdout) {
  const hosts = {};

  for (const document of yaml.loadAll(stdout).filter(Boolean)) {
    let pod = null;

    if (WORKLOAD_KINDS.includes(document.kind)) {
      pod = document.spec.template.spec;
    } else if (document.kind === "CronJob") {
      pod = document.spec.jobTemplate.spec.template.spec;
    }

    if (!pod) {
      continue;
    }

    for (const container of pod.containers || []) {
      const entry = (container.env || []).find((env) => {
        return env.name === "HOST";
      });

      if (entry) {
        hosts[`${document.kind}/${document.metadata.name}/${container.name}`] =
          entry.value;
      }
    }
  }

  return hosts;
}

// What the chart says to an IPv6 host without brackets.
function refusal(host) {
  return `host is ${host}, an IPv6 address without brackets, so no browser can open OneUptime at it. Write it in brackets, with any port after them, such as [2001:db8::1]:8080: --set host=[${host}], or in a values file, in quotes so YAML reads it as text, host: "[${host}]".`;
}

describe("the chart's host", () => {
  testWithHelm.each([
    "oneuptime.example.com",
    "oneuptime.example.com:8080",
    "203.0.113.5",
    "203.0.113.5:8080",
    "[2001:db8::1]",
    "[2001:db8::1]:8080",
  ])(
    "host: %s reaches every workload that reads HOST, as it was written",
    (host) => {
      const result = helmTemplate(Object.assign({ host: host }, ALL_ON));

      expect({
        status: result.status,
        stderr: result.status ? result.stderr : "",
      }).toEqual({
        status: 0,
        stderr: "",
      });

      const hosts = hostOfEveryWorkload(result.stdout);
      const workloads = Object.keys(hosts);

      // The app, nginx (whose primary server it names), the worker and the rest.
      expect(workloads).toEqual(
        expect.arrayContaining([
          "Deployment/ou-app/ou-app",
          "Deployment/ou-nginx/ou-nginx",
          "Deployment/ou-worker/ou-worker",
        ]),
      );

      for (const workload of workloads) {
        expect({ workload, host: hosts[workload] }).toEqual({
          workload,
          host,
        });
      }
    },
  );

  testWithHelm.each(["2001:db8::1", "2001:db8::1:8080", "::1", "fd00::7"])(
    "host: %s, an IPv6 address without brackets, is refused with the value to set",
    (host) => {
      const result = helmTemplate(Object.assign({ host: host }, ALL_ON));

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(refusal(host));
      expect(result.stdout).toBe("");
    },
  );

  testWithHelm(
    "--set host=[2001:db8::1]:8080 from the command line is the text it says",
    () => {
      const result = helmTemplate({}, ["--set", "host=[2001:db8::1]:8080"]);

      expect(result.status).toBe(0);
      expect(
        Object.values(hostOfEveryWorkload(result.stdout)).every((value) => {
          return value === "[2001:db8::1]:8080";
        }),
      ).toBe(true);
    },
  );

  /*
   * In YAML, [2001:db8::1] without quotes is a list of one item: the values
   * schema refuses it, which is why the docs and the refusal say to quote it.
   */
  testWithHelm(
    "in a values file the brackets go in quotes: without them YAML reads a list, which the schema refuses",
    () => {
      const unquoted = helmTemplate("host: [2001:db8::1]\n");

      expect(unquoted.status).not.toBe(0);
      expect(unquoted.stderr).toContain(
        "host: Invalid type. Expected: string, given: array",
      );

      const quoted = helmTemplate('host: "[2001:db8::1]"\n');

      expect(quoted.status).toBe(0);
      expect(
        Object.values(hostOfEveryWorkload(quoted.stdout)).every((value) => {
          return value === "[2001:db8::1]";
        }),
      ).toBe(true);
    },
  );
});
