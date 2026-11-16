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
 * It refuses every other host npm start stops on too (#8877), since every
 * pod stops at its start on one: a web address, brackets around anything but
 * an IPv6 address, two colons and no IPv6 address, a port that is no port or
 * has no address before it, and a name that is not a domain name by the rule
 * the app reads HOST by.
 *
 * tests/host_test.yaml holds the same, template by template. These renders
 * add what helm-unittest cannot hold: that every workload of the chart, with
 * all of them on, gets HOST exactly as written; the error of a host with a
 * number on each side of a colon (helm-unittest reads the "1:8080" in such an
 * error as a template's file:line:column, and finds no failed template);
 * what helm makes of an IPv6 host from --set and from a values file; that the
 * chart refuses a host exactly when Scripts/Install/Preflight.js stops
 * npm start on it, host by host; and that the chart's name rule, Preflight's
 * and the app's are one rule.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const yaml = require("js-yaml");
const {
  HOST_NAME,
  IPV6_ADDRESS,
  hostShapeFinding,
} = require("../../Scripts/Install/Preflight");

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

/*
 * A chart of its own, the oneuptime chart's _helpers.tpl and one template,
 * that prints what oneuptime.hostProblem says of each host - the sentence
 * oneuptime.validateHost fails with - in one render: { host: problem }.
 */
function chartProblems(hosts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "helm-host-problems-"));

  try {
    fs.mkdirSync(path.join(dir, "templates"));
    fs.writeFileSync(
      path.join(dir, "Chart.yaml"),
      "apiVersion: v2\nname: host-problems\nversion: 0.1.0\n",
    );
    fs.copyFileSync(
      path.join(ONEUPTIME_CHART, "templates", "_helpers.tpl"),
      path.join(dir, "templates", "_helpers.tpl"),
    );
    fs.writeFileSync(
      path.join(dir, "templates", "problems.yaml"),
      [
        "problems:",
        "{{- range $host := .Values.hosts }}",
        "  - host: {{ $host | toJson }}",
        '    problem: {{ include "oneuptime.hostProblem" (dict "Values" (dict "host" $host)) | toJson }}',
        "{{- end }}",
        "",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(dir, "values.json"),
      JSON.stringify({ hosts: hosts }),
    );

    const result = spawnSync(
      "helm",
      ["template", "p", dir, "--values", path.join(dir, "values.json")],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );

    expect({
      status: result.status,
      stderr: result.status ? result.stderr : "",
    }).toEqual({ status: 0, stderr: "" });

    const [rendered] = yaml.loadAll(result.stdout).filter(Boolean);

    return Object.fromEntries(
      rendered.problems.map((entry) => {
        return [entry.host, entry.problem];
      }),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * HOSTs of every shape: each one npm start takes, and each one it stops on
 * as a shape (Preflight's hostShapeFinding). A HOST written as a web
 * address, a placeholder or a listening address Preflight stops on before
 * its shape, and they are held below by name.
 */
const SHAPES = [
  // Names and IPv4 addresses, with and without a port.
  "localhost",
  "oneuptime",
  "oneuptime.example.com",
  "OneUptime.Example.COM",
  "oneuptime.example.com.",
  "one_uptime.example.com",
  "_service.example.com",
  "oneuptime-1.example.com",
  "xn--bcher-kva.example",
  "status.xn--r8jz45g.xn--zckzah",
  `${"a".repeat(63)}.example.com`,
  "203.0.113.5",
  "999.1.1.1",
  "8080",
  "oneuptime.example.com:8080",
  "oneuptime.example.com:1",
  "oneuptime.example.com:65535",
  "oneuptime.example.com:08080",
  "203.0.113.5:8443",
  // IPv6 in brackets.
  "[2001:db8::1]",
  "[2001:db8::1]:8080",
  "[2001:DB8::1]:8443",
  "[::1]",
  "[::ffff:192.0.2.1]:8080",
  "[2001:db8:0:0:0:0:0:1]",
  "[64:ff9b::192.0.2.33]",
  "[1:2:3:4:5:6:7:8]",
  "[1:2:3:4:5:6:7::]",
  "[::2:3:4:5:6:7:8]",
  "[fe80::1]:65535",
  "[::192.0.2.1]",
  // An IPv4 address at the end the app does not read, which Node.js does.
  "[1:2:3:4:5:6:1.2.3.4]",
  "[2001:db8::1:192.0.2.1]:8080",
  "1:2:3:4:5:6:1.2.3.4",
  // IPv6 without brackets: one reading, the other, or both.
  "2001:db8::1",
  "::1",
  "fd00::7",
  "2001:db8::1:8080",
  "2001:db8::1:abcd",
  "2001:db8::1:0",
  "2001:db8:0:0:0:0:0:1:8080",
  "::ffff:192.0.2.1",
  // Two colons and no IPv6 address either way.
  "a:b:c",
  "oneuptime.example.com:8080:9090",
  "203.0.113.5:80:80",
  "fe80::1%eth0",
  "1:2:3:4:5:6:7:8:9:10",
  "2001:db8:::1",
  "2001:db8::1::2",
  // Brackets around anything else, or not closed.
  "[2001:db8::1",
  "[oneuptime.example.com]",
  "[203.0.113.5]:8080",
  "[2001:db8::1]8080",
  "[2001:db8::1]:8080:9090",
  "[[2001:db8::1]]",
  "[]",
  "[fe80::1%25eth0]",
  "[2001:db8::1::2]",
  "[1:2:3:4:5:6:7:8:9]",
  // Ports that are no port, and ports with no address.
  "[2001:db8::1]:",
  "[2001:db8::1]:http",
  "[2001:db8::1]:0",
  "[2001:db8::1]:65536",
  "oneuptime.example.com:",
  "oneuptime.example.com:https",
  "oneuptime.example.com:0",
  "oneuptime.example.com:80abc",
  "203.0.113.5:99999",
  "localhost:0",
  ":8080",
  ":http",
  // Names that are not domain names (#8877).
  "oneuptime,example.com",
  "oneuptime,example.com:8080",
  "oneuptime.example.com!",
  "admin@oneuptime.example.com",
  "one*uptime,example!com",
  "one_uptime-.example.com",
  "-oneuptime.example.com",
  "oneuptime.-example.com",
  `${"a".repeat(64)}.example.com`,
  "oneuptime..example.com",
  "oneuptime.example.com..",
  ".oneuptime.example.com",
  ".",
  "bücher.example",
  "bücher.example:8080",
  "bü,cher.example",
];

/*
 * IPv6 addresses and near misses of every length, for the chart's IPv6 rule,
 * the app's that Preflight reads HOST by too: 0 to 9 groups, "::" in every
 * place or none, an IPv4 address or a broken one at the end, and a group
 * that is too long, not hex or empty. Each in brackets, in brackets with a
 * port, and bare.
 */
function ipv6Shapes() {
  const groups = ["0", "1", "db8", "FFFF", "abcd"];
  const texts = new Set();

  for (let count = 0; count <= 9; count++) {
    for (let gap = -1; gap <= count; gap++) {
      for (const tail of ["", "192.0.2.1", "256.0.2.1"]) {
        for (const [bad, badGroup] of [
          [-1, ""],
          [0, "00000"],
          [1, "g1"],
        ]) {
          const parts = [];

          for (let index = 0; index < count; index++) {
            parts.push(
              index === bad ? badGroup : groups[(index * 3 + count) % 5],
            );
          }

          let text =
            gap === -1
              ? parts.join(":")
              : `${parts.slice(0, gap).join(":")}::${parts.slice(gap).join(":")}`;

          if (tail) {
            text =
              text && !text.endsWith(":") ? `${text}:${tail}` : text + tail;
          }

          if (text) {
            texts.add(text);
          }
        }
      }
    }
  }

  return [...texts].flatMap((text) => {
    return [`[${text}]`, `[${text}]:8080`, text];
  });
}

const helpers = fs.readFileSync(
  path.join(ONEUPTIME_CHART, "templates", "_helpers.tpl"),
  "utf8",
);

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

  testWithHelm.each(["2001:db8::1", "::1", "fd00::7"])(
    "host: %s, an IPv6 address without brackets, is refused with the value to set",
    (host) => {
      const result = helmTemplate(Object.assign({ host: host }, ALL_ON));

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(refusal(host));
      expect(result.stdout).toBe("");
    },
  );

  /*
   * 2001:db8::1:8080 is an address of its own, and also 2001:db8::1 on port
   * 8080: only the person knows which, so both are said, as npm start says
   * them.
   */
  testWithHelm(
    "host: 2001:db8::1:8080, which reads two ways, is refused with the value to set for each",
    () => {
      const result = helmTemplate(
        Object.assign({ host: "2001:db8::1:8080" }, ALL_ON),
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'host is 2001:db8::1:8080, an IPv6 address without brackets, so no browser can open OneUptime at it. Write it in brackets, with any port after them: --set host=[2001:db8::1:8080], or --set host=[2001:db8::1]:8080 if 8080 is the port people open it on, and in a values file, in quotes so YAML reads it as text, host: "[2001:db8::1:8080]" or host: "[2001:db8::1]:8080".',
      );
      expect(result.stdout).toBe("");
    },
  );

  testWithHelm(
    "host: 2001:db8:0:0:0:0:0:1:8080, an address of all eight groups and a port, is refused with the port after the brackets",
    () => {
      const result = helmTemplate(
        Object.assign({ host: "2001:db8:0:0:0:0:0:1:8080" }, ALL_ON),
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'host is 2001:db8:0:0:0:0:0:1:8080, an IPv6 address and a port, without brackets around the address, so no browser can open OneUptime at it. Write the address in brackets, with the port after them: --set host=[2001:db8:0:0:0:0:0:1]:8080, or in a values file, in quotes so YAML reads it as text, host: "[2001:db8:0:0:0:0:0:1]:8080".',
      );
    },
  );

  /*
   * Hosts whose refusal holds a number on each side of a colon, which
   * helm-unittest cannot hold (tests/host_test.yaml holds the rest): each is
   * refused by the whole chart, with every workload on, before anything is
   * rendered.
   */
  testWithHelm.each([
    [
      "203.0.113.5:99999",
      "host is 203.0.113.5:99999, but 99999 is not a port. A port is a number from 1 to 65535, such as --set host=203.0.113.5:8080; without one, --set host=203.0.113.5.",
    ],
    [
      "203.0.113.5:0",
      "host is 203.0.113.5:0, but 0 is not a port. A port is a number from 1 to 65535, such as --set host=203.0.113.5:8080; without one, --set host=203.0.113.5.",
    ],
    [
      "203.0.113.5:80:80",
      "host is 203.0.113.5:80:80, which is not an address: a domain name or an IPv4 address has one colon at most, before its port, and an IPv6 address goes in brackets, such as [2001:db8::1].",
    ],
    [
      "[203.0.113.5]:8080",
      "host is [203.0.113.5]:8080. Brackets hold an IPv6 address and nothing else, with any port after the closing one, such as [2001:db8::1] or [2001:db8::1]:8080. A domain name or an IPv4 address goes without them.",
    ],
    [
      "https://2001:db8::1:8443/",
      "host is https://2001:db8::1:8443/. Write the address alone, without http:// or a path: --set host=[2001:db8::1:8443], or --set host=[2001:db8::1]:8443 if 8443 is the port people open it on. httpProtocol says whether people use http or https.",
    ],
    [
      "203,0.113.5:8080",
      'host is 203,0.113.5:8080, and 203,0.113.5 is not a domain name: a domain name has the letters a to z, digits, hyphens and dots only, and "," is none of them.',
    ],
  ])("host: %s is refused by the whole chart", (host, message) => {
    const result = helmTemplate(Object.assign({ host: host }, ALL_ON));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(result.stdout).toBe("");
  });

  testWithHelm(
    "host: oneuptime,example.com, a comma typed for a dot, is refused by the whole chart, before anything is rendered",
    () => {
      const result = helmTemplate(
        Object.assign({ host: "oneuptime,example.com" }, ALL_ON),
      );

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'host is oneuptime,example.com, which is not a domain name: a domain name has the letters a to z, digits, hyphens and dots only, and "," is none of them.',
      );
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
      /*
       * In helm's words, which changed with its schema validator in 3.18:
       * "host: Invalid type. Expected: string, given: array" before, and
       * "at '/host': got array, want string" since.
       */
      expect(unquoted.stderr).toMatch(
        /host: Invalid type\. Expected: string, given: array|at '\/host': got array, want string/,
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

/*
 * The chart refuses a host exactly when npm start stops on its shape, so a
 * host one takes the other takes, and each says why it refuses one (#8877).
 */
describe("the chart and npm start refuse the same hosts", () => {
  testWithHelm(
    "the chart refuses a host exactly when Preflight stops on its shape, host by host",
    () => {
      const problems = chartProblems(SHAPES);
      const disagreements = SHAPES.filter((host) => {
        return Boolean(problems[host]) !== Boolean(hostShapeFinding(host));
      }).map((host) => {
        return `${host}: the chart says ${JSON.stringify(problems[host])}, npm start ${JSON.stringify(hostShapeFinding(host))}`;
      });

      expect(disagreements).toEqual([]);
      // Both readings: some taken, some refused.
      expect(
        SHAPES.filter((host) => {
          return !problems[host];
        }).length,
      ).toBeGreaterThan(20);
      expect(
        SHAPES.filter((host) => {
          return problems[host];
        }).length,
      ).toBeGreaterThan(40);
    },
  );

  /*
   * Each refusal says what npm start says, in the chart's words: host for
   * HOST in config.env, --set host= for HOST=, and the same reason.
   */
  testWithHelm(
    "each refusal gives npm start's reason, in the chart's words",
    () => {
      const problems = chartProblems(SHAPES);
      const inChartWords = (message) => {
        return (
          message
            .replace(/^HOST in config\.env is /, "host is ")
            // An example of the shape, which the chart writes bare.
            .replace(
              "such as HOST=[2001:db8::1] or HOST=[2001:db8::1]:8080",
              "such as [2001:db8::1] or [2001:db8::1]:8080",
            )
            .replace(
              "goes in brackets, such as HOST=[2001:db8::1].",
              "goes in brackets, such as [2001:db8::1].",
            )
            // A value to set.
            .replace(
              /; without one, write HOST=/g,
              "; without one, --set host=",
            )
            .replace(/HOST=/g, "--set host=")
            .replace("HTTP_PROTOCOL says", "httpProtocol says")
        );
      };
      const differences = [];

      for (const host of SHAPES) {
        const finding = hostShapeFinding(host);

        if (!finding) {
          continue;
        }

        const preflight = inChartWords(finding.message);
        const chart = problems[host];

        // The chart gives the values-file spelling of a bracketed host too.
        if (
          chart !== preflight &&
          !chart.startsWith(preflight.replace(/\.$/, ""))
        ) {
          differences.push({ host, chart, preflight });
        }
      }

      /*
       * Where the two may differ: the IPv6 lines (the chart adds the values
       * file's quotes, and writes the two readings its own way), and a name
       * with letters beyond a to z, whose ASCII form only Node.js works out.
       */
      const allowed = (difference) => {
        return (
          difference.chart.includes("in quotes so YAML reads it as text") ||
          difference.chart.includes("in the ASCII form DNS writes it in")
        );
      };

      expect(
        differences.filter((difference) => {
          return !allowed(difference);
        }),
      ).toEqual([]);
    },
  );

  testWithHelm(
    "the chart reads an IPv6 address as npm start does, in brackets and out, for every length and near miss",
    () => {
      const hosts = ipv6Shapes();
      const problems = chartProblems(hosts);
      const disagreements = hosts
        .filter((host) => {
          return Boolean(problems[host]) !== Boolean(hostShapeFinding(host));
        })
        .map((host) => {
          return `${host}: the chart ${problems[host] ? "refuses" : "takes"} it, npm start ${hostShapeFinding(host) ? "stops on" : "takes"} it`;
        });

      expect(disagreements).toEqual([]);
      expect(
        hosts.filter((host) => {
          return !problems[host] && host.startsWith("[");
        }).length,
      ).toBeGreaterThan(50);
    },
  );

  testWithHelm("an empty host renders as it always did", () => {
    expect(chartProblems([""])).toEqual({ "": "" });
  });

  /*
   * One rule, three copies: the app reads HOST by Hostname's HOST_REGEX as
   * it starts, npm start by Preflight's HOST_NAME, the chart by
   * oneuptime.hostProblem's $nameRule. A change to one fails here until the
   * other two say the same.
   */
  test("the chart's name rule, npm start's and the app's are one rule", () => {
    const hostname = fs.readFileSync(
      path.join(REPO_ROOT, "packages/Common/Types/API/Hostname.ts"),
      "utf8",
    );
    const appRule = /const HOST_REGEX: RegExp =\s*\/(.+)\/;/.exec(hostname);
    const chartRule = /\{\{- \$nameRule := `([^`]+)` -\}\}/.exec(helpers);

    expect(appRule).not.toBeNull();
    expect(chartRule).not.toBeNull();
    expect(HOST_NAME.source).toBe(appRule[1]);
    expect(chartRule[1]).toBe(appRule[1]);
  });

  /*
   * The same for an IPv6 address: the app reads host's brackets by IP's
   * isIPv6, case-insensitive, as it starts. Node.js's net.isIPv6, which npm
   * start used, takes more - an IPv4 address after six groups, or after
   * groups and "::" - and every service then stopped at its start.
   */
  test("the chart's IPv6 rule, npm start's and the app's are one rule", () => {
    const ip = fs.readFileSync(
      path.join(REPO_ROOT, "packages/Common/Types/IP/IP.ts"),
      "utf8",
    );
    const appRule =
      /private static isIPv6\(str: string\): boolean \{\s*const regexExp: RegExp =\s*\/(.+)\/(\w*);/.exec(
        ip,
      );
    const chartRule = /\{\{- \$ipv6Rule := `([^`]+)` -\}\}/.exec(helpers);

    expect(appRule).not.toBeNull();
    expect(chartRule).not.toBeNull();
    expect({ source: IPV6_ADDRESS.source, flags: IPV6_ADDRESS.flags }).toEqual({
      source: appRule[1],
      flags: appRule[2],
    });
    expect(chartRule[1]).toBe(appRule[1]);
    // Case-insensitive in the chart too, as the app's "i".
    expect(appRule[2]).toBe("i");
    expect(helpers).toContain('(printf "(?i)%s" $ipv6Rule)');
  });

  test("npm start and the chart refuse the IPv6 forms the app refuses, and take ::ffff: and NAT64's", () => {
    const hosts = [
      "[1:2:3:4:5:6:1.2.3.4]",
      "[2001:db8::1:192.0.2.1]",
      "[::ffff:192.0.2.1]",
      "[64:ff9b::192.0.2.33]",
      "[::192.0.2.1]",
    ];
    const problems = chartProblems(hosts);

    expect(
      hosts.map((host) => {
        return {
          host,
          chart: Boolean(problems[host]),
          npmStart: Boolean(hostShapeFinding(host)),
        };
      }),
    ).toEqual([
      { host: "[1:2:3:4:5:6:1.2.3.4]", chart: true, npmStart: true },
      { host: "[2001:db8::1:192.0.2.1]", chart: true, npmStart: true },
      { host: "[::ffff:192.0.2.1]", chart: false, npmStart: false },
      { host: "[64:ff9b::192.0.2.33]", chart: false, npmStart: false },
      { host: "[::192.0.2.1]", chart: false, npmStart: false },
    ]);
  });
});
