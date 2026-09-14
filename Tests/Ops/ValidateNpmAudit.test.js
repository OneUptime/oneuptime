"use strict";

/**
 * Scripts/Security/ValidateNpmAudit.js — the dependency-vulnerability gate.
 *
 * This script is the only thing standing between a known-vulnerable
 * dependency and a release, and both directions of getting it wrong are
 * expensive and quiet:
 *
 *  - Too permissive and a critical advisory ships. The dangerous shape is an
 *    EXCEPTION that keeps working after it should have stopped: one that has
 *    expired, one whose advisory is no longer in the tree at all (so it is
 *    now just a hole nobody remembers opening), or one that covers a single
 *    path into a package that is reachable by several.
 *  - Too strict and every build goes red for a reason nobody can act on, at
 *    which point the gate gets switched off. An npm audit that crashed, or a
 *    report that came back without vulnerabilities at all, has to be reported
 *    as a broken gate rather than as a clean one.
 *
 * The exported functions are pure, so these tests feed them the report shapes
 * npm actually produces rather than re-running npm audit.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  advisoryId,
  loadProjectExceptions,
  normalizeProject,
  validateAuditReport,
} = require("../../Scripts/Security/ValidateNpmAudit.js");

const GHSA_A = "GHSA-1111-2222-3333";
const GHSA_B = "GHSA-4444-5555-6666";

function advisoryVia(data) {
  return {
    source: data.source || 1,
    name: data.name,
    severity: data.severity,
    url: `https://github.com/advisories/${data.advisory}`,
  };
}

function reportOf(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities };
}

function validate(data) {
  return validateAuditReport({
    report: data.report,
    project: data.project || "Common",
    auditLevel: data.auditLevel || "high",
    exceptions: data.exceptions || [],
    exceptionErrors: data.exceptionErrors || [],
    npmStatus: data.npmStatus || 0,
  });
}

function exception(data) {
  return {
    advisory: data.advisory,
    expires: data.expires || "2099-01-01",
    reason: data.reason || "No fixed release yet.",
    seen: false,
    used: false,
  };
}

const temporaryDirectories = [];

function writeExceptionsFile(contents) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-exceptions-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "npm-audit-exceptions.json");
  fs.writeFileSync(
    filePath,
    typeof contents === "string" ? contents : JSON.stringify(contents, null, 2),
    "utf8",
  );
  return filePath;
}

afterAll(() => {
  temporaryDirectories.forEach((directory) => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe("normalizeProject", () => {
  test("keeps the repo root as itself", () => {
    expect(normalizeProject(".")).toBe(".");
  });

  test("strips the leading ./ so the workflow and the file agree on a key", () => {
    expect(normalizeProject("./Common")).toBe("Common");
    expect(normalizeProject("Common")).toBe("Common");
  });

  test("only strips the leading ./, not one in the middle", () => {
    expect(normalizeProject("Scripts/./TerraformProvider")).toBe(
      "Scripts/./TerraformProvider",
    );
  });
});

describe("advisoryId", () => {
  test("reads the GHSA id out of the advisory url", () => {
    expect(advisoryId({ url: `https://github.com/advisories/${GHSA_A}` })).toBe(
      GHSA_A,
    );
  });

  /*
   * npm writes the id lowercase in some report versions. An exception is
   * matched by exact string, so a case difference would silently stop
   * covering the advisory it was written for.
   */
  test("upper-cases the id so it matches an exception entry", () => {
    expect(
      advisoryId({ url: "https://github.com/advisories/ghsa-1111-2222-3333" }),
    ).toBe(GHSA_A);
  });

  test("falls back to the numeric source when there is no url", () => {
    expect(advisoryId({ source: 1099876 })).toBe("1099876");
  });

  test("is an empty string when there is neither", () => {
    expect(advisoryId({})).toBe("");
  });
});

describe("loadProjectExceptions", () => {
  const today = "2026-09-12";

  test("treats a missing file as no exceptions rather than an error", () => {
    const loaded = loadProjectExceptions(
      path.join(os.tmpdir(), "does-not-exist-npm-audit-exceptions.json"),
      "Common",
      today,
    );

    expect(loaded).toEqual({ entries: [], errors: [] });
  });

  test("reports a file that is not JSON", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile("{ not json"),
      "Common",
      today,
    );

    expect(loaded.entries).toEqual([]);
    expect(loaded.errors[0]).toMatch(/Cannot parse/);
  });

  test.each([["[]"], ['"a string"'], ["null"]])(
    "reports %s, which is not an object keyed by project",
    (contents) => {
      const loaded = loadProjectExceptions(
        writeExceptionsFile(contents),
        "Common",
        today,
      );

      expect(loaded.errors[0]).toMatch(/must contain an object keyed by/);
    },
  );

  test("reports a project whose exceptions are not a list", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({ Common: { advisory: GHSA_A } }),
      "Common",
      today,
    );

    expect(loaded.errors[0]).toMatch(/must be an array/);
  });

  test("loads a well-formed exception", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({
        Common: [
          {
            advisory: GHSA_A,
            expires: "2099-01-01",
            reason: "Upstream has no fixed release.",
          },
        ],
      }),
      "Common",
      today,
    );

    expect(loaded.errors).toEqual([]);
    expect(loaded.entries).toEqual([
      {
        advisory: GHSA_A,
        expires: "2099-01-01",
        reason: "Upstream has no fixed release.",
        seen: false,
        used: false,
      },
    ]);
  });

  test("finds the entry whether the key is written with or without ./", () => {
    const filePath = writeExceptionsFile({
      Common: [
        { advisory: GHSA_A, expires: "2099-01-01", reason: "No fix yet." },
      ],
    });

    expect(
      loadProjectExceptions(filePath, "./Common", today).entries,
    ).toHaveLength(1);
  });

  test("returns nothing for a project with no entry of its own", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({
        Common: [
          { advisory: GHSA_A, expires: "2099-01-01", reason: "No fix yet." },
        ],
      }),
      "Probe",
      today,
    );

    expect(loaded.entries).toEqual([]);
    expect(loaded.errors).toEqual([]);
  });

  /*
   * An exception is a decision someone has to be able to review later, so
   * every field that makes it reviewable is mandatory - and a malformed one
   * must be an ERROR, not an entry that is quietly dropped and then found
   * missing only when the advisory it was meant to cover blocks a build.
   */
  test.each([
    [
      { advisory: "CVE-2026-1", expires: "2099-01-01", reason: "x" },
      /invalid GHSA/,
    ],
    [
      { advisory: "GHSA-11-22-33", expires: "2099-01-01", reason: "x" },
      /invalid GHSA/,
    ],
    [
      { advisory: GHSA_A, expires: "01-01-2099", reason: "x" },
      /ISO YYYY-MM-DD/,
    ],
    [{ advisory: GHSA_A, reason: "x" }, /ISO YYYY-MM-DD/],
    [{ advisory: GHSA_A, expires: "2099-01-01" }, /must explain why/],
    [
      { advisory: GHSA_A, expires: "2099-01-01", reason: "   " },
      /must explain why/,
    ],
  ])("rejects %j", (entry, expectedMessage) => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({ Common: [entry] }),
      "Common",
      today,
    );

    expect(loaded.entries).toEqual([]);
    expect(loaded.errors[0]).toMatch(expectedMessage);
  });

  test.each([[null], ["a string"], [["nested"]]])(
    "rejects %j, which is not an exception object",
    (entry) => {
      const loaded = loadProjectExceptions(
        writeExceptionsFile({ Common: [entry] }),
        "Common",
        today,
      );

      expect(loaded.errors[0]).toMatch(/must be an object/);
    },
  );

  /*
   * The expiry is the whole point of the mechanism: an exception is a
   * deadline, not a permanent waiver.
   */
  test("refuses an exception that has expired", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({
        Common: [
          { advisory: GHSA_A, expires: "2026-09-11", reason: "No fix yet." },
        ],
      }),
      "Common",
      today,
    );

    expect(loaded.entries).toEqual([]);
    expect(loaded.errors[0]).toMatch(/expired on 2026-09-11/);
  });

  test("accepts an exception that expires today", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({
        Common: [{ advisory: GHSA_A, expires: today, reason: "No fix yet." }],
      }),
      "Common",
      today,
    );

    expect(loaded.errors).toEqual([]);
    expect(loaded.entries).toHaveLength(1);
  });

  test("accepts a lower-case advisory id and stores it upper-case", () => {
    const loaded = loadProjectExceptions(
      writeExceptionsFile({
        Common: [
          {
            advisory: GHSA_A.toLowerCase(),
            expires: "2099-01-01",
            reason: "No fix yet.",
          },
        ],
      }),
      "Common",
      today,
    );

    expect(loaded.entries[0].advisory).toBe(GHSA_A);
  });
});

describe("validateAuditReport: a broken gate is not a clean one", () => {
  test.each([[null], ["not a report"], [[]]])(
    "refuses %j instead of reading it as no vulnerabilities",
    (report) => {
      const result = validate({ report });

      expect(result.ok).toBe(false);
      expect(result.errors[0]).toMatch(/did not return a JSON object/);
    },
  );

  test("surfaces npm's own error", () => {
    const result = validate({
      report: { error: { summary: "ENOLOCK: no lockfile" } },
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/ENOLOCK/);
  });

  test("refuses a report with no vulnerabilities key at all", () => {
    const result = validate({
      report: { auditReportVersion: 2 },
      npmStatus: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/incomplete report \(exit 1\)/);
  });

  /*
   * npm exits non-zero when it found something at or above the level it was
   * asked about. Nothing relevant in the report contradicts that, and the
   * contradiction is the interesting part - it means the report and the exit
   * code disagree, so neither can be trusted.
   */
  test("refuses a non-zero npm exit that reported nothing", () => {
    const result = validate({
      report: reportOf({}),
      npmStatus: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/without reporting a vulnerability/);
  });

  test("passes a clean report", () => {
    const result = validate({ report: reportOf({}) });

    expect(result).toEqual({
      ok: true,
      errors: [],
      blocked: [],
      allowed: [],
      unused: [],
    });
  });

  test("carries exception-file errors through without looking at the report", () => {
    const result = validate({
      report: reportOf({}),
      exceptionErrors: ["Common exception 1 has an invalid GHSA identifier."],
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([
      "Common exception 1 has an invalid GHSA identifier.",
    ]);
  });
});

describe("validateAuditReport: severity threshold", () => {
  const report = reportOf({
    "low-package": {
      severity: "low",
      via: [advisoryVia({ advisory: GHSA_A, severity: "low" })],
    },
    "high-package": {
      severity: "high",
      via: [advisoryVia({ advisory: GHSA_B, severity: "high" })],
    },
  });

  test("blocks only what is at or above the level asked for", () => {
    const result = validate({ report, auditLevel: "high" });

    expect(result.blocked).toEqual(["high-package"]);
  });

  test("blocks the lower one too when the level is lowered", () => {
    const result = validate({ report, auditLevel: "low" });

    expect(result.blocked.sort()).toEqual(["high-package", "low-package"]);
  });

  test("critical alone leaves a high advisory through", () => {
    const result = validate({ report, auditLevel: "critical" });

    expect(result.blocked).toEqual([]);
    expect(result.ok).toBe(true);
  });

  /*
   * An unrecognised severity string is treated as above every threshold. A
   * severity npm invents later must not become a hole.
   */
  test("treats an unknown severity as relevant", () => {
    const result = validate({
      report: reportOf({
        odd: {
          severity: "catastrophic",
          via: [advisoryVia({ advisory: GHSA_A, severity: "catastrophic" })],
        },
      }),
      auditLevel: "critical",
    });

    expect(result.blocked).toEqual(["odd"]);
  });
});

describe("validateAuditReport: exceptions", () => {
  const directReport = reportOf({
    "vulnerable-package": {
      severity: "high",
      via: [advisoryVia({ advisory: GHSA_A, severity: "high" })],
    },
  });

  test("blocks a vulnerability nobody has approved", () => {
    const result = validate({ report: directReport });

    expect(result.ok).toBe(false);
    expect(result.blocked).toEqual(["vulnerable-package"]);
    expect(result.allowed).toEqual([]);
  });

  test("allows one that is covered, and records which exception did it", () => {
    const exceptions = [exception({ advisory: GHSA_A })];
    const result = validate({ report: directReport, exceptions });

    expect(result.ok).toBe(true);
    expect(result.allowed).toEqual(["vulnerable-package"]);
    expect(exceptions[0].used).toBe(true);
    expect(exceptions[0].seen).toBe(true);
  });

  test("does not allow one covered by an exception for a different advisory", () => {
    const result = validate({
      report: directReport,
      exceptions: [exception({ advisory: GHSA_B })],
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toEqual(["vulnerable-package"]);
  });

  /*
   * A package reachable through two advisories is only approved when BOTH
   * are - otherwise one exception silently covers a second vulnerability
   * that was never reviewed.
   */
  test("requires every advisory into a package to be approved", () => {
    const report = reportOf({
      "vulnerable-package": {
        severity: "high",
        via: [
          advisoryVia({ advisory: GHSA_A, severity: "high" }),
          advisoryVia({ advisory: GHSA_B, severity: "high" }),
        ],
      },
    });

    expect(
      validate({ report, exceptions: [exception({ advisory: GHSA_A })] }).ok,
    ).toBe(false);

    expect(
      validate({
        report,
        exceptions: [
          exception({ advisory: GHSA_A }),
          exception({ advisory: GHSA_B }),
        ],
      }).ok,
    ).toBe(true);
  });

  /*
   * A dependent is only as approved as what it depends on: the exception
   * lives on the advisory, and the package that merely pulls it in inherits
   * that decision rather than needing one of its own.
   */
  test("follows a transitive path to the advisory that caused it", () => {
    const report = reportOf({
      "leaf-package": {
        severity: "high",
        via: [advisoryVia({ advisory: GHSA_A, severity: "high" })],
      },
      "parent-package": {
        severity: "high",
        via: ["leaf-package"],
      },
    });

    const blockedResult = validate({ report });
    expect(blockedResult.blocked.sort()).toEqual([
      "leaf-package",
      "parent-package",
    ]);

    const allowedResult = validate({
      report,
      exceptions: [exception({ advisory: GHSA_A })],
    });
    expect(allowedResult.ok).toBe(true);
    expect(allowedResult.allowed.sort()).toEqual([
      "leaf-package",
      "parent-package",
    ]);
  });

  /*
   * Dependency graphs have cycles. The gate has to terminate, and has to
   * come down on the side of blocking when it cannot prove otherwise.
   */
  test("terminates on a cycle and blocks it", () => {
    const report = reportOf({
      a: { severity: "high", via: ["b"] },
      b: { severity: "high", via: ["a"] },
    });

    const result = validate({ report });

    expect(result.blocked.sort()).toEqual(["a", "b"]);
    expect(result.ok).toBe(false);
  });

  /*
   * An exception whose advisory is no longer anywhere in the tree is a hole
   * nobody remembers opening. It has to be removed, and the only moment
   * anyone will notice is a failing gate.
   */
  test("fails when an exception is no longer needed", () => {
    const result = validate({
      report: reportOf({}),
      exceptions: [exception({ advisory: GHSA_A })],
    });

    expect(result.ok).toBe(false);
    expect(result.unused.map((entry) => entry.advisory)).toEqual([GHSA_A]);
    expect(result.errors[0]).toMatch(/remove unused audit exception/);
  });

  /*
   * "Seen" is deliberately looser than "used": an advisory that is present
   * but below the audit level is still in the tree, so the exception is
   * doing nothing today but is not stale either.
   */
  test("keeps an exception for an advisory that is present but below the level", () => {
    const result = validate({
      report: reportOf({
        "low-package": {
          severity: "low",
          via: [advisoryVia({ advisory: GHSA_A, severity: "low" })],
        },
      }),
      auditLevel: "high",
      exceptions: [exception({ advisory: GHSA_A })],
    });

    expect(result.ok).toBe(true);
    expect(result.unused).toEqual([]);
  });

  test("blocks a package whose only via entries are strings pointing nowhere", () => {
    const result = validate({
      report: reportOf({
        orphan: { severity: "critical", via: ["missing-package"] },
      }),
      auditLevel: "high",
    });

    expect(result.blocked).toEqual(["orphan"]);
  });

  test("blocks a package with no via information at all", () => {
    const result = validate({
      report: reportOf({ mystery: { severity: "critical", via: [] } }),
      auditLevel: "high",
    });

    expect(result.blocked).toEqual(["mystery"]);
  });

  test("does not treat a non-zero npm exit as an error once it has something to report", () => {
    const result = validate({
      report: directReport,
      exceptions: [exception({ advisory: GHSA_A })],
      npmStatus: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
