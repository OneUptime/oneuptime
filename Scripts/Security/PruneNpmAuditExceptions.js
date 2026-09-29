#!/usr/bin/env node

/*
 * Removes a project's audit exceptions once their advisory has left its
 * dependency tree.
 *
 * ValidateNpmAudit.js fails the build on such an exception, on purpose: an
 * exception that covers nothing is a hole nobody remembers opening. The job
 * most likely to leave one behind is the nightly `npm audit fix`, because
 * fixing an advisory is exactly what makes its exception unused - and its PR
 * then fails Dependency Audit for a reason the bot itself caused. That is how
 * GHSA-vcc3-ghjq-m6fr outlived decode-uri-component in MobileApp and turned
 * master red.
 *
 * npm-audit-fix.sh runs this after each project's fix, so the removal lands in
 * the same PR as the lockfile change that made it true, and is reviewed with
 * it.
 *
 * An exception is removed only when a complete audit report shows its
 * advisory nowhere, at any severity. A report that is broken or suspicious
 * proves nothing, so it changes nothing; neither does an entry too malformed
 * to name an advisory, which the audit gate reports for a human to fix.
 */

const fs = require("fs");
const {
  GHSA_PATTERN,
  auditReportErrors,
  normalizeProject,
  parseArguments,
  reportedAdvisories,
} = require("./ValidateNpmAudit.js");

// The advisory an entry names, read the way the audit gate reads it, or ""
// when the entry is too malformed to name one.
function entryAdvisory(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return "";
  }
  const advisory = String(entry.advisory || "").toUpperCase();
  return GHSA_PATTERN.test(advisory) ? advisory : "";
}

function isProjectMap(configuration) {
  return Boolean(
    configuration &&
      typeof configuration === "object" &&
      !Array.isArray(configuration),
  );
}

/*
 * Returns the configuration with the project's unused exceptions removed,
 * without modifying the one passed in. `skipped` says why nothing could be
 * decided; `removed` lists the advisories that were dropped.
 */
function pruneUnusedExceptions({ configuration, project, report, npmStatus }) {
  const unchanged = (skipped) => {
    return { configuration, removed: [], skipped };
  };

  if (!isProjectMap(configuration)) {
    return unchanged("the exceptions file is not an object keyed by project");
  }

  const key = normalizeProject(project);
  const entries = configuration[key];
  if (!Array.isArray(entries) || entries.length === 0) {
    return unchanged(null);
  }

  const reportErrors = auditReportErrors(report, project, npmStatus);
  if (reportErrors.length > 0) {
    return unchanged(reportErrors.join(" "));
  }

  const vulnerabilities = report.vulnerabilities;
  if (npmStatus !== 0 && Object.keys(vulnerabilities).length === 0) {
    return unchanged(
      `npm audit exited ${npmStatus} without reporting a vulnerability`,
    );
  }

  const present = reportedAdvisories(vulnerabilities);
  const removed = [];
  const kept = entries.filter((entry) => {
    const advisory = entryAdvisory(entry);
    if (!advisory || present.has(advisory)) {
      return true;
    }
    removed.push(advisory);
    return false;
  });

  if (removed.length === 0) {
    return unchanged(null);
  }

  const pruned = { ...configuration };
  if (kept.length > 0) {
    pruned[key] = kept;
  } else {
    delete pruned[key];
  }
  return { configuration: pruned, removed, skipped: null };
}

function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  const project = args.project;
  const auditResultPath = args["audit-result"];
  const exceptionPath = args.exceptions;
  const npmStatus = Number(args["npm-status"] || 0);

  if (!project || !auditResultPath || !exceptionPath) {
    console.error("Missing audit exception pruning arguments.");
    process.exit(2);
  }

  if (!fs.existsSync(exceptionPath)) {
    return;
  }

  let configuration;
  try {
    configuration = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
  } catch (error) {
    console.error(`Cannot parse ${exceptionPath}: ${error.message}`);
    process.exit(1);
  }
  if (!isProjectMap(configuration)) {
    console.error(
      `${exceptionPath} must contain an object keyed by project path.`,
    );
    process.exit(1);
  }

  let report = null;
  try {
    report = JSON.parse(fs.readFileSync(auditResultPath, "utf8"));
  } catch (error) {
    // Left null: auditReportErrors explains it if the project has exceptions.
  }

  const result = pruneUnusedExceptions({
    configuration,
    project,
    report,
    npmStatus,
  });

  if (result.skipped) {
    console.log(
      `${project}: kept audit exceptions unchanged; ${result.skipped}.`,
    );
    return;
  }

  if (result.removed.length === 0) {
    return;
  }

  try {
    fs.writeFileSync(
      exceptionPath,
      `${JSON.stringify(result.configuration, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    console.error(`Cannot write ${exceptionPath}: ${error.message}`);
    process.exit(1);
  }

  console.log(
    `${project}: removed audit exception(s) no longer in the dependency tree: ${result.removed.join(", ")}.`,
  );
}

if (require.main === module) {
  main();
}

module.exports = {
  pruneUnusedExceptions,
};
