#!/usr/bin/env node

const fs = require("fs");

const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function normalizeProject(project) {
  if (project === ".") {
    return ".";
  }
  return project.replace(/^\.\//, "");
}

function advisoryId(via) {
  const urlMatch = String(via.url || "").match(/GHSA-[a-z0-9-]+/i);
  if (urlMatch) {
    return urlMatch[0].toUpperCase();
  }
  return String(via.source || "");
}

function loadProjectExceptions(exceptionPath, project, today) {
  if (!fs.existsSync(exceptionPath)) {
    return { entries: [], errors: [] };
  }

  let configuration;
  try {
    configuration = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
  } catch (error) {
    return {
      entries: [],
      errors: [`Cannot parse ${exceptionPath}: ${error.message}`],
    };
  }

  if (
    !configuration ||
    Array.isArray(configuration) ||
    typeof configuration !== "object"
  ) {
    return {
      entries: [],
      errors: [
        `${exceptionPath} must contain an object keyed by project path.`,
      ],
    };
  }

  const configuredEntries = configuration[normalizeProject(project)] || [];
  if (!Array.isArray(configuredEntries)) {
    return {
      entries: [],
      errors: [`Exceptions for ${project} must be an array.`],
    };
  }

  const entries = [];
  const errors = [];
  configuredEntries.forEach((entry, index) => {
    const label = `${project} exception ${index + 1}`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label} must be an object.`);
      return;
    }

    const advisory = String(entry.advisory || "").toUpperCase();
    const expires = String(entry.expires || "");
    const reason = String(entry.reason || "").trim();

    if (!/^GHSA(?:-[A-Z0-9]{4}){3}$/.test(advisory)) {
      errors.push(`${label} has an invalid GHSA advisory identifier.`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires)) {
      errors.push(`${label} must have an ISO YYYY-MM-DD expiry date.`);
      return;
    }
    if (!reason) {
      errors.push(`${label} must explain why a fix cannot yet be used.`);
      return;
    }
    if (expires < today) {
      errors.push(`${label} for ${advisory} expired on ${expires}.`);
      return;
    }

    entries.push({ advisory, expires, reason, seen: false, used: false });
  });

  return { entries, errors };
}

function validateAuditReport({
  report,
  project,
  auditLevel,
  exceptions,
  exceptionErrors = [],
  npmStatus = 0,
}) {
  const errors = [...exceptionErrors];
  const vulnerabilities = report && report.vulnerabilities;
  const threshold = SEVERITY_RANK[auditLevel];

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    errors.push(`${project}: npm audit did not return a JSON object.`);
  } else if (report.error) {
    const summary =
      report.error.summary || report.error.code || "unknown npm audit error";
    errors.push(`${project}: ${summary}`);
  } else if (
    typeof report.auditReportVersion !== "number" ||
    !vulnerabilities ||
    Array.isArray(vulnerabilities) ||
    typeof vulnerabilities !== "object"
  ) {
    errors.push(
      `${project}: npm audit returned an incomplete report (exit ${npmStatus}).`,
    );
  }

  if (errors.length > 0) {
    return { ok: false, errors, blocked: [], allowed: [], unused: [] };
  }

  const exceptionByAdvisory = new Map(
    exceptions.map((entry) => [entry.advisory, entry]),
  );

  Object.values(vulnerabilities).forEach((vulnerability) => {
    (vulnerability.via || []).forEach((via) => {
      if (typeof via === "string") {
        return;
      }
      const exception = exceptionByAdvisory.get(advisoryId(via));
      if (exception) {
        exception.seen = true;
      }
    });
  });

  const memo = new Map();
  const visiting = new Set();

  function isRelevantSeverity(severity) {
    return (SEVERITY_RANK[severity] ?? Number.POSITIVE_INFINITY) >= threshold;
  }

  function isAllowed(name) {
    if (memo.has(name)) {
      return memo.get(name);
    }

    const vulnerability = vulnerabilities[name];
    if (!vulnerability || !isRelevantSeverity(vulnerability.severity)) {
      memo.set(name, true);
      return true;
    }
    if (visiting.has(name)) {
      memo.set(name, false);
      return false;
    }

    visiting.add(name);
    const relevantVia = (vulnerability.via || []).filter((via) => {
      if (typeof via === "string") {
        const child = vulnerabilities[via];
        return child && isRelevantSeverity(child.severity);
      }
      return isRelevantSeverity(via.severity || vulnerability.severity);
    });

    const allowed =
      relevantVia.length > 0 &&
      relevantVia.every((via) => {
        if (typeof via === "string") {
          return isAllowed(via);
        }

        const exception = exceptionByAdvisory.get(advisoryId(via));
        if (!exception) {
          return false;
        }
        exception.used = true;
        return true;
      });

    visiting.delete(name);
    memo.set(name, allowed);
    return allowed;
  }

  const relevantNames = Object.keys(vulnerabilities).filter((name) => {
    return isRelevantSeverity(vulnerabilities[name].severity);
  });
  const allowed = relevantNames.filter(isAllowed);
  const blocked = relevantNames.filter((name) => !isAllowed(name));
  const unused = exceptions.filter((entry) => !entry.seen);

  if (npmStatus !== 0 && relevantNames.length === 0) {
    errors.push(
      `${project}: npm audit exited ${npmStatus} without reporting a vulnerability.`,
    );
  }

  if (unused.length > 0) {
    errors.push(
      `${project}: remove unused audit exception(s): ${unused
        .map((entry) => entry.advisory)
        .join(", ")}.`,
    );
  }

  return {
    ok: blocked.length === 0 && errors.length === 0,
    errors,
    blocked,
    allowed,
    unused,
  };
}

function parseArguments(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key || !key.startsWith("--") || value === undefined) {
      throw new Error("Arguments must be provided as --name value pairs.");
    }
    args[key.slice(2)] = value;
  }
  return args;
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
  const auditLevel = args["audit-level"];
  const auditResultPath = args["audit-result"];
  const exceptionPath = args.exceptions;
  const npmStatus = Number(args["npm-status"] || 0);

  if (
    !project ||
    !auditResultPath ||
    !exceptionPath ||
    !(auditLevel in SEVERITY_RANK)
  ) {
    console.error("Missing or invalid audit validator arguments.");
    process.exit(2);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(auditResultPath, "utf8"));
  } catch (error) {
    console.error(
      `${project}: cannot parse npm audit output: ${error.message}`,
    );
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const loaded = loadProjectExceptions(exceptionPath, project, today);
  const result = validateAuditReport({
    report,
    project,
    auditLevel,
    exceptions: loaded.entries,
    exceptionErrors: loaded.errors,
    npmStatus,
  });

  if (result.allowed.length > 0) {
    const usedAdvisories = loaded.entries
      .filter((entry) => entry.used)
      .map((entry) => `${entry.advisory} (review by ${entry.expires})`);
    console.log(
      `${project}: allowed ${result.allowed.length} dependency node(s) through ${usedAdvisories.join(", ")}.`,
    );
  } else if (result.blocked.length === 0 && result.errors.length === 0) {
    console.log(`${project}: no vulnerabilities at or above ${auditLevel}.`);
  }

  if (!result.ok) {
    result.errors.forEach((error) => console.error(error));
    if (result.blocked.length > 0) {
      console.error(
        `${project}: unapproved vulnerabilities: ${result.blocked
          .map((name) => `${name} (${report.vulnerabilities[name].severity})`)
          .join(", ")}.`,
      );
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  advisoryId,
  loadProjectExceptions,
  normalizeProject,
  validateAuditReport,
};
