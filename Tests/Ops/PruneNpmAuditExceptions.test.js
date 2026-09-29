"use strict";

/**
 * Scripts/Security/PruneNpmAuditExceptions.js — run by the nightly
 * `npm audit fix` job to drop exceptions whose advisory the fix removed.
 *
 * The audit gate fails on an exception that covers nothing, so a fix that
 * removes an advisory breaks the job's own PR unless the exception goes with
 * it. That is how GHSA-vcc3-ghjq-m6fr outlived decode-uri-component in
 * MobileApp and turned master red.
 *
 * The danger in the other direction is removing an exception that is still
 * needed, which turns a reviewed, accepted risk into a red build for the next
 * person. So an exception may only go when a report npm actually completed
 * shows its advisory nowhere; anything less leaves the file alone.
 */

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  pruneUnusedExceptions,
} = require("../../Scripts/Security/PruneNpmAuditExceptions.js");
const {
  auditReportErrors,
  loadProjectExceptions,
  reportedAdvisories,
  validateAuditReport,
} = require("../../Scripts/Security/ValidateNpmAudit.js");

const SCRIPT = path.join(
  __dirname,
  "..",
  "..",
  "Scripts",
  "Security",
  "PruneNpmAuditExceptions.js",
);

const GHSA_A = "GHSA-1111-2222-3333";
const GHSA_B = "GHSA-4444-5555-6666";

function exceptionFor(advisory, extra) {
  return {
    advisory,
    expires: "2099-01-01",
    reason: "No fixed release yet.",
    ...extra,
  };
}

function reportNaming(...advisories) {
  const vulnerabilities = {};
  advisories.forEach((advisory, index) => {
    vulnerabilities[`leaf-${index}`] = {
      name: `leaf-${index}`,
      severity: "low",
      via: [
        {
          source: index + 1,
          name: `leaf-${index}`,
          severity: "low",
          url: `https://github.com/advisories/${advisory}`,
        },
      ],
    };
  });
  return { auditReportVersion: 2, vulnerabilities };
}

function prune(data) {
  return pruneUnusedExceptions({
    configuration: data.configuration,
    project: data.project || "./MobileApp",
    report: data.report,
    npmStatus: data.npmStatus || 0,
  });
}

describe("pruneUnusedExceptions: what goes", () => {
  test("removes an exception whose advisory is not in the report", () => {
    const configuration = {
      MobileApp: [exceptionFor(GHSA_A), exceptionFor(GHSA_B)],
    };

    const result = prune({ configuration, report: reportNaming(GHSA_B) });

    expect(result.removed).toEqual([GHSA_A]);
    expect(result.skipped).toBeNull();
    expect(result.configuration).toEqual({
      MobileApp: [exceptionFor(GHSA_B)],
    });
  });

  test("removes the project key once nothing is left under it", () => {
    const result = prune({
      configuration: { MobileApp: [exceptionFor(GHSA_A)], Probe: [] },
      report: reportNaming(),
    });

    expect(result.configuration).toEqual({ Probe: [] });
  });

  test("does not modify the configuration it was given", () => {
    const configuration = { MobileApp: [exceptionFor(GHSA_A)] };
    const snapshot = JSON.parse(JSON.stringify(configuration));

    prune({ configuration, report: reportNaming() });

    expect(configuration).toEqual(snapshot);
  });

  /*
   * An expired exception whose advisory has gone is dead twice over. The gate
   * would reject it for either reason, so there is nothing to keep it for.
   */
  test("removes an expired exception once its advisory has gone", () => {
    const result = prune({
      configuration: {
        MobileApp: [exceptionFor(GHSA_A, { expires: "2000-01-01" })],
      },
      report: reportNaming(),
    });

    expect(result.removed).toEqual([GHSA_A]);
  });

  test("reads the project the way the gate does, with or without ./", () => {
    const configuration = { MobileApp: [exceptionFor(GHSA_A)] };

    expect(
      prune({ configuration, project: "MobileApp", report: reportNaming() })
        .removed,
    ).toEqual([GHSA_A]);
    expect(
      prune({ configuration, project: "./MobileApp", report: reportNaming() })
        .removed,
    ).toEqual([GHSA_A]);
  });

  test("keys the repository root as .", () => {
    const result = prune({
      configuration: { ".": [exceptionFor(GHSA_A)] },
      project: ".",
      report: reportNaming(),
    });

    expect(result.configuration).toEqual({});
  });

  /*
   * The first bot run after this lands has to clean up exactly the entry that
   * broke master, so pin it down with the real advisory and the report shape
   * MobileApp now produces.
   */
  test("removes the MobileApp exception that broke master", () => {
    const result = prune({
      configuration: {
        MobileApp: [
          {
            advisory: "GHSA-vcc3-ghjq-m6fr",
            expires: "2026-10-11",
            reason:
              "The latest stable React Navigation depends on query-string 7.",
          },
        ],
      },
      report: {
        auditReportVersion: 2,
        vulnerabilities: {},
        metadata: { vulnerabilities: { total: 0 } },
      },
    });

    expect(result.removed).toEqual(["GHSA-VCC3-GHJQ-M6FR"]);
    expect(result.configuration).toEqual({});
  });
});

describe("pruneUnusedExceptions: what stays", () => {
  test("keeps an exception whose advisory is still reported", () => {
    const configuration = { MobileApp: [exceptionFor(GHSA_A)] };

    const result = prune({ configuration, report: reportNaming(GHSA_A) });

    expect(result.removed).toEqual([]);
    expect(result.configuration).toBe(configuration);
  });

  test("keeps an advisory written in lower case that is still reported", () => {
    const result = prune({
      configuration: { MobileApp: [exceptionFor(GHSA_A.toLowerCase())] },
      report: reportNaming(GHSA_A),
    });

    expect(result.removed).toEqual([]);
  });

  /*
   * The keep above would also pass if lower case were simply not understood,
   * because an entry that names no advisory is kept. Removing a stale
   * lower-case entry is what shows it is read the way the gate reads it.
   */
  test("removes a stale advisory written in lower case", () => {
    const result = prune({
      configuration: { MobileApp: [exceptionFor(GHSA_A.toLowerCase())] },
      report: reportNaming(GHSA_B),
    });

    expect(result.removed).toEqual([GHSA_A]);
    expect(result.configuration).toEqual({});
  });

  /*
   * The gate treats an advisory as present at any severity, so the prune must
   * too; otherwise it would remove an exception the gate still counts as seen.
   */
  test("keeps an exception for an advisory reported below any threshold", () => {
    const report = reportNaming(GHSA_A);
    report.vulnerabilities["leaf-0"].severity = "info";
    report.vulnerabilities["leaf-0"].via[0].severity = "info";

    const result = prune({
      configuration: { MobileApp: [exceptionFor(GHSA_A)] },
      report,
    });

    expect(result.removed).toEqual([]);
  });

  test("keeps an exception for an advisory reached only transitively", () => {
    const report = reportNaming(GHSA_A);
    report.vulnerabilities.parent = {
      name: "parent",
      severity: "low",
      via: ["leaf-0"],
    };

    const result = prune({
      configuration: { MobileApp: [exceptionFor(GHSA_A)] },
      report,
    });

    expect(result.removed).toEqual([]);
  });

  test("leaves other projects' exceptions alone", () => {
    const configuration = {
      MobileApp: [exceptionFor(GHSA_B)],
      Common: [exceptionFor(GHSA_A)],
    };

    const result = prune({ configuration, report: reportNaming(GHSA_B) });

    expect(result.configuration).toBe(configuration);
  });

  test.each([
    ["not an object", "GHSA-1111-2222-3333"],
    ["null", null],
    ["missing its advisory", { expires: "2099-01-01", reason: "x" }],
    ["naming no GHSA", { advisory: "CVE-2026-0001" }],
    ["naming a GHSA with extra text", { advisory: `${GHSA_A} (moderate)` }],
  ])("keeps an entry %s for a human to fix", (_label, entry) => {
    const result = prune({
      configuration: { MobileApp: [entry, exceptionFor(GHSA_B)] },
      report: reportNaming(),
    });

    expect(result.removed).toEqual([GHSA_B]);
    expect(result.configuration).toEqual({ MobileApp: [entry] });
  });

  test("does nothing for a project with no exceptions", () => {
    const configuration = { Common: [exceptionFor(GHSA_A)] };

    const result = prune({ configuration, report: reportNaming() });

    expect(result).toEqual({ configuration, removed: [], skipped: null });
  });

  test("does not look at the report for a project with no exceptions", () => {
    const result = prune({ configuration: {}, report: null, npmStatus: 1 });

    expect(result.skipped).toBeNull();
  });
});

describe("pruneUnusedExceptions: an audit that did not finish proves nothing", () => {
  const configuration = { MobileApp: [exceptionFor(GHSA_A)] };

  test.each([
    ["no report", null],
    ["a report that is not an object", "garbage"],
    ["a report that is a list", []],
    ["npm's own error", { error: { code: "ENOTFOUND", summary: "offline" } }],
    ["a report without a version", { vulnerabilities: {} }],
    ["a report without vulnerabilities", { auditReportVersion: 2 }],
    [
      "a report whose vulnerabilities are a list",
      { auditReportVersion: 2, vulnerabilities: [] },
    ],
  ])("keeps everything given %s", (_label, report) => {
    const result = prune({ configuration, report });

    expect(result.removed).toEqual([]);
    expect(result.configuration).toBe(configuration);
    expect(result.skipped).toEqual(expect.any(String));
  });

  test("keeps everything when npm failed but reported nothing", () => {
    const result = prune({
      configuration,
      report: reportNaming(),
      npmStatus: 1,
    });

    expect(result.removed).toEqual([]);
    expect(result.skipped).toMatch(/exited 1 without reporting/);
  });

  test("still prunes when npm failed because it found something else", () => {
    const result = prune({
      configuration,
      report: reportNaming(GHSA_B),
      npmStatus: 1,
    });

    expect(result.removed).toEqual([GHSA_A]);
  });

  test.each([[null], [[]], ["a string"]])(
    "keeps a configuration that is not a project map (%p)",
    (bad) => {
      const result = prune({ configuration: bad, report: reportNaming() });

      expect(result.configuration).toBe(bad);
      expect(result.removed).toEqual([]);
      expect(result.skipped).toMatch(/not an object keyed by project/);
    },
  );
});

describe("pruneUnusedExceptions agrees with the audit gate", () => {
  /*
   * Whatever the prune leaves, the gate must not call unused; whatever it
   * removes, the gate must have called unused. Checked over a spread of
   * reports so the two cannot drift apart silently.
   */
  const reports = [
    reportNaming(),
    reportNaming(GHSA_A),
    reportNaming(GHSA_B),
    reportNaming(GHSA_A, GHSA_B),
  ];

  test.each(reports.map((report, index) => [index, report]))(
    "report %i",
    (_index, report) => {
      const configuration = {
        MobileApp: [exceptionFor(GHSA_A), exceptionFor(GHSA_B)],
      };
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "prune-gate-"));
      const filePath = path.join(directory, "exceptions.json");
      try {
        fs.writeFileSync(filePath, JSON.stringify(configuration));
        const loaded = loadProjectExceptions(
          filePath,
          "./MobileApp",
          "2026-01-01",
        );
        const gate = validateAuditReport({
          report,
          project: "./MobileApp",
          auditLevel: "low",
          exceptions: loaded.entries,
        });

        const result = prune({ configuration, report });

        expect(result.removed.sort()).toEqual(
          gate.unused.map((entry) => entry.advisory).sort(),
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("shared report helpers", () => {
  test("auditReportErrors accepts a complete report", () => {
    expect(auditReportErrors(reportNaming(), "Common", 0)).toEqual([]);
  });

  test("auditReportErrors names the project and npm's exit status", () => {
    expect(auditReportErrors({ vulnerabilities: {} }, "Common", 7)).toEqual([
      "Common: npm audit returned an incomplete report (exit 7).",
    ]);
  });

  test("reportedAdvisories ignores the package-name links between nodes", () => {
    const report = reportNaming(GHSA_A);
    report.vulnerabilities.parent = { via: ["leaf-0"] };

    expect([...reportedAdvisories(report.vulnerabilities)]).toEqual([GHSA_A]);
  });

  test("reportedAdvisories tolerates a node without via", () => {
    expect([...reportedAdvisories({ bare: { name: "bare" } })]).toEqual([]);
  });
});

describe("PruneNpmAuditExceptions.js command line", () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "prune-cli-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function write(name, contents) {
    const filePath = path.join(directory, name);
    fs.writeFileSync(
      filePath,
      typeof contents === "string" ? contents : JSON.stringify(contents),
      "utf8",
    );
    return filePath;
  }

  function run(args) {
    return childProcess.spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
    });
  }

  test("rewrites the file without the stale exception", () => {
    const exceptions = write("exceptions.json", {
      MobileApp: [exceptionFor(GHSA_A)],
      Common: [exceptionFor(GHSA_B)],
    });
    const report = write("report.json", reportNaming());

    const result = run([
      "--audit-result",
      report,
      "--exceptions",
      exceptions,
      "--project",
      "MobileApp",
      "--npm-status",
      "0",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `MobileApp: removed audit exception(s) no longer in the dependency tree: ${GHSA_A}.`,
    );
    expect(fs.readFileSync(exceptions, "utf8")).toBe(
      `${JSON.stringify({ Common: [exceptionFor(GHSA_B)] }, null, 2)}\n`,
    );
  });

  test("does not touch the file when nothing is stale", () => {
    const original = `{"MobileApp":[${JSON.stringify(exceptionFor(GHSA_A))}]}`;
    const exceptions = write("exceptions.json", original);
    const report = write("report.json", reportNaming(GHSA_A));

    const result = run([
      "--audit-result",
      report,
      "--exceptions",
      exceptions,
      "--project",
      "MobileApp",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(fs.readFileSync(exceptions, "utf8")).toBe(original);
  });

  test("keeps the file and says why when the report is unreadable", () => {
    const original = JSON.stringify({ MobileApp: [exceptionFor(GHSA_A)] });
    const exceptions = write("exceptions.json", original);
    const report = write("report.json", "npm ERR! network");

    const result = run([
      "--audit-result",
      report,
      "--exceptions",
      exceptions,
      "--project",
      "MobileApp",
      "--npm-status",
      "1",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "MobileApp: kept audit exceptions unchanged; MobileApp: npm audit did not return a JSON object.",
    );
    expect(fs.readFileSync(exceptions, "utf8")).toBe(original);
  });

  test("does nothing, and creates nothing, without an exceptions file", () => {
    const exceptions = path.join(directory, "missing.json");
    const report = write("report.json", reportNaming());

    const result = run([
      "--audit-result",
      report,
      "--exceptions",
      exceptions,
      "--project",
      "MobileApp",
    ]);

    expect(result.status).toBe(0);
    expect(fs.existsSync(exceptions)).toBe(false);
  });

  test.each([
    ["not JSON", "{ nope", /Cannot parse/],
    ["not a project map", "[]", /must contain an object keyed by project/],
  ])("fails on an exceptions file that is %s", (_label, contents, message) => {
    const exceptions = write("exceptions.json", contents);
    const report = write("report.json", reportNaming());

    const result = run([
      "--audit-result",
      report,
      "--exceptions",
      exceptions,
      "--project",
      "MobileApp",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(message);
    expect(fs.readFileSync(exceptions, "utf8")).toBe(contents);
  });

  test.each([
    [["--project", "MobileApp"]],
    [["--audit-result"]],
    [["project", "MobileApp"]],
  ])("rejects incomplete arguments %p", (args) => {
    expect(run(args).status).toBe(2);
  });
});
