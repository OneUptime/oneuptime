"use strict";

/**
 * The vulnerabilities in what OneUptime ships that a newer version fixes, read
 * from Grype's JSON reports (one per SBOM, as
 * Scripts/GHA/scan_sbom_vulnerabilities.sh writes them), and what to do about
 * each. Three commands:
 *
 *   gate           The Build workflow's Vulnerability gate, on every pull
 *                  request into `release` (.github/workflows/build.yml), so on
 *                  every release before it ships. It fails while an image the
 *                  release would ship has a vulnerability that counts (below)
 *                  and that Scripts/Security/image-vulnerability-exceptions.json
 *                  does not accept, and says what to upgrade.
 *
 *   issues         The nightly Vulnerability Re-scan of the latest release
 *                  (.github/workflows/vulnerability-rescan.yml). Most CVEs are
 *                  published after the release that ships them, so this keeps
 *                  one GitHub issue, labelled `security`, per thing to upgrade
 *                  (a binary, an OS package, an npm package), with what the one
 *                  who picks it up needs: the images, each vulnerability and
 *                  the versions that fix it, the lines that pin it, and how to
 *                  check the fix. It rewrites an open issue while the release
 *                  still ships what it names, and closes it once a release no
 *                  longer does.
 *
 *   release-sboms  Which of a release's assets are the SBOMs those are.
 *
 * A vulnerability counts when Grype knows a version that fixes it (fix state
 * "fixed") and it is critical or high (--fail-on), or CISA lists it as known
 * to be exploited (KEV) whatever its severity. One with no fix yet is left
 * out: nobody can act on it, and the hundreds in the Debian-based images
 * would bury the few that can be fixed. Only what people run counts: the
 * images in PRODUCT_IMAGES and, in the nightly run, the infrastructure
 * agent's binaries. The test suites' own images (TEST_IMAGES) do not.
 *
 * Scripts/Security/image-vulnerability-exceptions.json accepts a vulnerability
 * until a date, at most 90 days ahead:
 *
 *   {
 *     "exceptions": [
 *       {
 *         "ids": ["CVE-2026-93479"],     the vulnerabilities (or an alias)
 *         "package": "nginx",            as the scanner names it, or its
 *                                        source package (openssl for libssl3)
 *         "images": ["nginx"],           optional: every image when left out
 *         "expires": "2026-11-26",       accepted through this day
 *         "reason": "Why it can wait, and what will fix it.",
 *         "issue": "https://github.com/OneUptime/oneuptime/issues/9709"
 *       }
 *     ]
 *   }
 *
 * An accepted vulnerability does not fail the gate. It still gets its issue
 * from the nightly run, unless the exception names the issue that tracks it:
 * accepted for a release is not fixed. Once an exception expires, what it
 * accepted fails the gate again.
 *
 *   node Scripts/Security/ImageVulnerabilities.js gate --reports vulnerabilities --require-product-images
 *   node Scripts/Security/ImageVulnerabilities.js issues --reports vulnerabilities \
 *     --release 16.0.0 --published-at 2026-11-19T00:34:11Z [--dry-run]
 *   node Scripts/Security/ImageVulnerabilities.js release-sboms --version 16.0.0 --assets assets.txt
 *
 * Plain CommonJS with no dependencies, and `gh` handed in, so
 * Tests/Ops/ImageVulnerabilities.test.js runs it with a fake.
 */

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_REPOSITORY = "OneUptime/oneuptime";
const EXCEPTIONS_FILE = "Scripts/Security/image-vulnerability-exceptions.json";
const RESCAN_WORKFLOW = ".github/workflows/vulnerability-rescan.yml";

const SEVERITIES = [
  "unknown",
  "negligible",
  "low",
  "medium",
  "high",
  "critical",
];

// The longest an exception may accept a vulnerability for, from the day it is
// checked: long enough for an upstream fix to be released, short enough that
// nothing is accepted and forgotten.
const MAX_EXCEPTION_DAYS = 90;

// A broken report or vulnerability database should not open a hundred issues.
const MAX_NEW_ISSUES = 10;

// GitHub refuses an issue body over 65,536 characters.
const MAX_TABLE_ROWS = 150;

const ISSUE_LABEL = "security";
const ISSUE_LABELS = [ISSUE_LABEL, "bug"];
const ISSUE_LABEL_COLOR = "b60205";
const ISSUE_LABEL_DESCRIPTION =
  "A vulnerability in something OneUptime ships, found by the nightly Vulnerability Re-scan";

// The label that has the Build workflow run the gate on a pull request that
// is not into `release`, such as one that upgrades what an issue names.
const GATE_LABEL = "vulnerability-gate";

// Ties an issue to the thing to upgrade it is about, across nightly runs.
const MARKER = "oneuptime-vulnerability-group";

/*
 * The images OneUptime ships to the people who run it, by the name
 * Scripts/GHA/generate_sboms.sh gives their SBOMs, and the file that pins
 * what is in each. Tests/Ops/ImageVulnerabilities.test.js holds every image
 * generate_sboms.sh scans to this list or TEST_IMAGES, and every one here to a
 * job of build.yml that writes its SBOM for the gate.
 */
const PRODUCT_IMAGES = Object.freeze({
  app: "packages/App/Dockerfile.tpl",
  "app-enterprise": "packages/App/Dockerfile.tpl",
  nginx: "packages/Nginx/Dockerfile.tpl",
  probe: "packages/Probe/Dockerfile.tpl",
  runner: "packages/Runner/Dockerfile.tpl",
  "docker-agent": "agents/DockerAgent/Dockerfile.tpl",
  "podman-agent": "agents/PodmanAgent/Dockerfile.tpl",
  "kubernetes-ai-agent": "agents/KubernetesAIAgent/Dockerfile.tpl",
  "kubernetes-cost-agent": "agents/KubernetesCostAgent/Dockerfile.tpl",
  "kubernetes-log-tailer": "agents/KubernetesLogTailer/Dockerfile.tpl",
  "resource-ai-agent": "agents/ResourceAIAgent/Dockerfile.tpl",
});

// Shipped as binaries rather than an image: each release attaches an SBOM of
// the binary for every platform it builds.
const INFRASTRUCTURE_AGENT = "infrastructure-agent";

const SOURCES = Object.freeze({
  ...PRODUCT_IMAGES,
  [INFRASTRUCTURE_AGENT]: "agents/InfrastructureAgent/go.mod",
});

/*
 * Images a release publishes that nobody runs in production: the end-to-end
 * suites' image, the unit and integration test runner, and the server the
 * end-to-end tests monitor. Their findings neither fail the gate nor open
 * issues.
 */
const TEST_IMAGES = Object.freeze(["e2e", "test", "test-server"]);

// What `docker build` builds for each image, in the gate's instructions.
const BUILD_TARGETS = Object.freeze({
  app: "community",
  "app-enterprise": "enterprise",
});

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9._:-]{2,80}$/;
const OS_PACKAGE_TYPES = ["apk", "deb", "rpm"];
const INSTALL_COMMAND =
  /\b(apk add|apt-get install|apt install|dnf install|yum install|microdnf install)\b/;

// ─── Small helpers ─────────────────────────────────────────────────────────

function rank(severity) {
  return Math.max(0, SEVERITIES.indexOf(String(severity || "").toLowerCase()));
}

function severityName(severity) {
  const name = SEVERITIES[rank(severity)];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function unique(values) {
  return [...new Set(values)];
}

function compareText(left, right) {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function imageOrder(image) {
  const order = Object.keys(SOURCES).indexOf(image);
  return order < 0 ? Number.MAX_SAFE_INTEGER : order;
}

function compareImages(left, right) {
  return imageOrder(left) - imageOrder(right) || compareText(left, right);
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isScannedImage(image) {
  return hasOwn(SOURCES, image);
}

/*
 * "a", "a and b", "a, b and c".
 */
function listOf(items) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/*
 * Text from an SBOM or a scanner report, as an inline code span: what is in
 * one is never read as Markdown, a link or a mention (`@babel/core`). A pipe
 * is escaped for the tables it sits in.
 */
function code(value) {
  const text = String(value === undefined || value === null ? "" : value)
    .replace(/[\r\n`]+/g, " ")
    .trim()
    .slice(0, 200)
    .replace(/\|/g, "\\|");
  return text ? `\`${text}\`` : "";
}

/*
 * The advisory page of a vulnerability ID, for the IDs whose form says where
 * it is. Anything else is shown as code, unlinked.
 */
function advisoryUrl(id) {
  if (/^CVE-\d{4}-\d{4,}$/.test(id)) {
    return `https://nvd.nist.gov/vuln/detail/${id}`;
  }
  if (/^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/.test(id)) {
    return `https://github.com/advisories/${id}`;
  }
  if (/^GO-\d{4}-\d{4,}$/.test(id)) {
    return `https://pkg.go.dev/vuln/${id}`;
  }
  return null;
}

function vulnerabilityLink(id) {
  const url = advisoryUrl(id);
  return url ? `[${id}](${url})` : code(id);
}

// ─── Reports ───────────────────────────────────────────────────────────────

/*
 * The image (or the infrastructure agent) and platform a report or SBOM is
 * of, from its file name: <image>-<version>-linux-<arch> for a release's
 * images, oneuptime-infrastructure-agent_<os>_<arch> for the agent's binaries,
 * and <image> for the SBOMs the gate's build jobs write.
 */
function reportTarget(fileName) {
  const base = path.basename(fileName).replace(/\.(grype|cdx)\.json$/, "");
  const release = /^(.+)-\d+\.\d+\.\d+-linux-(amd64|arm64)$/.exec(base);
  if (release) {
    return { image: release[1], platform: `linux/${release[2]}` };
  }
  const agent = /^oneuptime-infrastructure-agent_([a-z0-9]+)_([a-z0-9]+)$/.exec(
    base,
  );
  if (agent) {
    return { image: INFRASTRUCTURE_AGENT, platform: `${agent[1]}/${agent[2]}` };
  }
  return { image: base, platform: "" };
}

/*
 * The SBOMs of a release that the nightly run scans: every product image's,
 * for both architectures, and the infrastructure agent binary's for every
 * platform. Not the test images', and not the agent's archives, packages or
 * MSIs, which hold the same binary.
 */
function releaseSboms(assetNames, version) {
  const imageSbom = new RegExp(
    `^(.+)-${escapeRegExp(version)}-linux-(amd64|arm64)\\.cdx\\.json$`,
  );
  return unique(
    assetNames.filter((name) => {
      const image = imageSbom.exec(name);
      if (image) {
        return hasOwn(PRODUCT_IMAGES, image[1]);
      }
      return /^oneuptime-infrastructure-agent_[a-z0-9]+_[a-z0-9]+\.cdx\.json$/.test(
        name,
      );
    }),
  ).sort(compareText);
}

/*
 * Every *.grype.json in a directory, with what it is a report of.
 */
function readReports(directory) {
  return fs
    .readdirSync(directory)
    .filter((name) => {
      return name.endsWith(".grype.json");
    })
    .sort(compareText)
    .map((name) => {
      return {
        file: name,
        ...reportTarget(name),
        report: JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")),
      };
    });
}

/*
 * One finding per match in a Grype report (grype -o json).
 */
function findingsOf(report, target) {
  return ((report && report.matches) || []).map((match) => {
    const vulnerability = match.vulnerability || {};
    const artifact = match.artifact || {};
    const fix = vulnerability.fix || {};
    const fixVersions = (fix.versions || []).map(String).filter(Boolean);
    const id = String(vulnerability.id || "");
    // The day CISA added each entry, when it is one: it is shown as written.
    const exploited = (vulnerability.knownExploited || [])
      .map((entry) => {
        const added = String((entry && entry.dateAdded) || "");
        return /^\d{4}-\d{2}-\d{2}$/.test(added) ? added : "";
      })
      .sort(compareText);

    return {
      image: target.image,
      platforms: target.platform ? [target.platform] : [],
      id,
      aliases: unique(
        (match.relatedVulnerabilities || [])
          .map((related) => {
            return String((related && related.id) || "");
          })
          .filter((alias) => {
            return alias && alias !== id;
          }),
      ),
      severity: SEVERITIES[rank(vulnerability.severity)],
      // The day CISA added it to its catalogue, "" when that is not given,
      // and null when it is not there at all.
      knownExploited: exploited.length > 0 ? exploited[0] : null,
      fixed: fix.state === "fixed" && fixVersions.length > 0,
      fixVersions,
      package: String(artifact.name || ""),
      version: String(artifact.version || ""),
      type: String(artifact.type || ""),
      upstream: String(((artifact.upstreams || [])[0] || {}).name || ""),
      location: String(((artifact.locations || [])[0] || {}).path || ""),
    };
  });
}

/*
 * Whether a finding is one to act on: it has a fix, and it is at least as
 * severe as failOn or known to be exploited.
 */
function counts(finding, failOn) {
  return (
    finding.fixed &&
    (rank(finding.severity) >= rank(failOn) || finding.knownExploited !== null)
  );
}

/*
 * The findings to act on in the scanned images, once each: a finding both
 * architectures share is one finding on both platforms.
 */
function actionableFindings(reports, failOn = "high") {
  const merged = new Map();

  for (const entry of reports) {
    if (!isScannedImage(entry.image)) {
      continue;
    }
    for (const finding of findingsOf(entry.report, entry)) {
      if (!counts(finding, failOn)) {
        continue;
      }
      const key = [
        finding.image,
        finding.id,
        finding.package,
        finding.version,
        finding.location,
      ].join("\u0000");
      const existing = merged.get(key);
      if (existing) {
        existing.platforms = unique([
          ...existing.platforms,
          ...finding.platforms,
        ]).sort(compareText);
      } else {
        merged.set(key, finding);
      }
    }
  }

  return [...merged.values()];
}

/*
 * What is wrong with the images a set of reports is of: product images the
 * gate has no report for, and images it does not know, which belong in
 * PRODUCT_IMAGES or TEST_IMAGES.
 */
function coverageProblems(reports, { requireProductImages = false } = {}) {
  const images = unique(
    reports.map((entry) => {
      return entry.image;
    }),
  );
  const problems = [];

  if (requireProductImages) {
    const missing = Object.keys(PRODUCT_IMAGES).filter((image) => {
      return !images.includes(image);
    });
    if (missing.length > 0) {
      problems.push(
        `No report for ${listOf(missing)}: the job of build.yml that builds ${missing.length === 1 ? "it" : "them"} wrote no SBOM.`,
      );
    }
  }

  const unknown = images.filter((image) => {
    return !isScannedImage(image) && !TEST_IMAGES.includes(image);
  });
  if (unknown.length > 0) {
    problems.push(
      `Reports for images this script does not know: ${listOf(unknown)}. Add each to PRODUCT_IMAGES or TEST_IMAGES in Scripts/Security/ImageVulnerabilities.js.`,
    );
  }

  return problems;
}

// ─── Exceptions ────────────────────────────────────────────────────────────

const EXCEPTION_KEYS = [
  "ids",
  "package",
  "images",
  "expires",
  "reason",
  "issue",
];

/*
 * The exceptions file's entries, checked: what is wrong with any of them is
 * an error, which fails the gate.
 */
function readExceptions(
  raw,
  { today, repository = DEFAULT_REPOSITORY, source = EXCEPTIONS_FILE },
) {
  const exceptions = [];
  const errors = [];

  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw) ||
    !Array.isArray(raw.exceptions)
  ) {
    return {
      exceptions,
      errors: [`${source} must be an object with an "exceptions" list.`],
    };
  }

  const latest = addDays(today, MAX_EXCEPTION_DAYS);
  const issuePattern = new RegExp(
    `^https://github\\.com/${escapeRegExp(repository)}/issues/\\d+$`,
  );

  raw.exceptions.forEach((entry, index) => {
    const label = `${source} exceptions[${index}]`;

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      errors.push(`${label} must be an object.`);
      return;
    }

    const problems = [];
    const unknown = Object.keys(entry).filter((key) => {
      return !EXCEPTION_KEYS.includes(key);
    });
    if (unknown.length > 0) {
      problems.push(
        `has keys it does not take (${unknown.join(", ")}); it takes ${EXCEPTION_KEYS.join(", ")}`,
      );
    }
    if (
      !Array.isArray(entry.ids) ||
      entry.ids.length === 0 ||
      !entry.ids.every((id) => {
        return typeof id === "string" && ID_PATTERN.test(id);
      })
    ) {
      problems.push(
        `needs "ids", a list of vulnerability IDs (CVE-..., GHSA-...)`,
      );
    }
    if (typeof entry.package !== "string" || !entry.package.trim()) {
      problems.push(
        `needs "package", the package as the scanner names it or its source package`,
      );
    }
    if (
      entry.images !== undefined &&
      (!Array.isArray(entry.images) ||
        entry.images.length === 0 ||
        !entry.images.every((image) => {
          return hasOwn(SOURCES, image);
        }))
    ) {
      problems.push(
        `has "images" that are not a list of ${Object.keys(SOURCES).join(", ")}`,
      );
    }
    if (typeof entry.expires !== "string" || !isDay(entry.expires)) {
      problems.push(`needs "expires", a YYYY-MM-DD date`);
    } else if (entry.expires > latest) {
      problems.push(
        `expires on ${entry.expires}, more than ${MAX_EXCEPTION_DAYS} days away (${latest} at the latest)`,
      );
    }
    if (typeof entry.reason !== "string" || !entry.reason.trim()) {
      problems.push(`needs "reason", why it can wait and what will fix it`);
    }
    if (
      entry.issue !== undefined &&
      (typeof entry.issue !== "string" || !issuePattern.test(entry.issue))
    ) {
      problems.push(
        `has an "issue" that is not https://github.com/${repository}/issues/<number>`,
      );
    }

    if (problems.length > 0) {
      errors.push(`${label} ${problems.join("; ")}.`);
      return;
    }

    exceptions.push({
      index,
      ids: unique(entry.ids),
      package: entry.package.trim(),
      images: entry.images ? unique(entry.images) : null,
      expires: entry.expires,
      reason: entry.reason.trim(),
      issue: entry.issue || null,
    });
  });

  return { exceptions, errors };
}

function idsOf(finding) {
  return [finding.id, ...finding.aliases];
}

function covers(exception, finding) {
  const ids = idsOf(finding);
  return (
    exception.ids.some((id) => {
      return ids.includes(id);
    }) &&
    (exception.package === finding.package ||
      (finding.upstream !== "" && exception.package === finding.upstream)) &&
    (exception.images === null || exception.images.includes(finding.image))
  );
}

/*
 * The findings an exception does not accept today (failing: an expired one
 * does not accept), the ones one does (accepted), the exceptions that have
 * expired, and the IDs of each exception that match nothing (stale), so the
 * file can be pruned.
 */
function classify(findings, exceptions, today) {
  const failing = [];
  const accepted = [];
  const matched = new Map(
    exceptions.map((exception) => {
      return [exception, new Set()];
    }),
  );

  for (const finding of findings) {
    const covering = exceptions.filter((exception) => {
      return covers(exception, finding);
    });
    for (const exception of covering) {
      for (const id of exception.ids) {
        if (idsOf(finding).includes(id)) {
          matched.get(exception).add(id);
        }
      }
    }
    const active = covering.find((exception) => {
      return exception.expires >= today;
    });
    if (active) {
      accepted.push({ ...finding, exception: active });
    } else {
      failing.push({
        ...finding,
        expiredException:
          covering.find((exception) => {
            return exception.expires < today;
          }) || null,
      });
    }
  }

  return {
    failing,
    accepted,
    expired: exceptions.filter((exception) => {
      return exception.expires < today;
    }),
    stale: exceptions
      .map((exception) => {
        return {
          exception,
          ids: exception.ids.filter((id) => {
            return !matched.get(exception).has(id);
          }),
        };
      })
      .filter((entry) => {
        return entry.ids.length > 0;
      }),
  };
}

// ─── Groups: one per thing to upgrade ──────────────────────────────────────

/*
 * What a finding is fixed by upgrading: the infrastructure agent's go.mod
 * (its binary is /oneuptime-infrastructure-agent, and .exe on Windows: one
 * upgrade either way), the binary that holds a Go module (all of
 * /otelcol-contrib's modules are fixed by one newer collector), the source
 * package of an OS package (libssl3 and libcrypto3 by one openssl), or the
 * package itself.
 */
function groupKey(finding) {
  if (finding.image === INFRASTRUCTURE_AGENT) {
    return `agent:${INFRASTRUCTURE_AGENT}`;
  }
  if (
    (finding.type === "go-module" || finding.type === "binary") &&
    finding.location
  ) {
    return `binary:${finding.location}`;
  }
  if (OS_PACKAGE_TYPES.includes(finding.type)) {
    return `${finding.type}:${finding.upstream || finding.package}`;
  }
  return `${finding.type || "package"}:${finding.package}`;
}

function splitKey(key) {
  const separator = key.indexOf(":");
  return { kind: key.slice(0, separator), value: key.slice(separator + 1) };
}

function groupName(key) {
  const { kind, value } = splitKey(key);
  return kind === "binary" ? path.posix.basename(value) || value : value;
}

/*
 * A group's findings as rows, one per vulnerability and installed version,
 * with every image it is in; and its counts by severity, each vulnerability
 * counted once.
 */
function describeGroup(key, findings) {
  const { kind, value } = splitKey(key);
  const rows = new Map();
  const platforms = {};

  for (const finding of findings) {
    platforms[finding.image] = unique([
      ...(platforms[finding.image] || []),
      ...finding.platforms,
    ]).sort(compareText);

    const rowKey = [finding.id, finding.package, finding.version].join(
      "\u0000",
    );
    if (!rows.has(rowKey)) {
      rows.set(rowKey, {
        id: finding.id,
        severity: finding.severity,
        knownExploited: finding.knownExploited,
        package: finding.package,
        version: finding.version,
        fixVersions: [],
        images: [],
      });
    }
    const row = rows.get(rowKey);
    row.images = unique([...row.images, finding.image]).sort(compareImages);
    row.fixVersions = unique([...row.fixVersions, ...finding.fixVersions]);
    if (rank(finding.severity) > rank(row.severity)) {
      row.severity = finding.severity;
    }
    if (row.knownExploited === null) {
      row.knownExploited = finding.knownExploited;
    }
  }

  const sorted = [...rows.values()].sort((left, right) => {
    return (
      Number(right.knownExploited !== null) -
        Number(left.knownExploited !== null) ||
      rank(right.severity) - rank(left.severity) ||
      compareText(left.id, right.id) ||
      compareText(left.package, right.package)
    );
  });

  const severityById = new Map();
  for (const row of sorted) {
    if (
      !severityById.has(row.id) ||
      rank(row.severity) > rank(severityById.get(row.id))
    ) {
      severityById.set(row.id, row.severity);
    }
  }
  const severityCounts = {};
  for (const severity of severityById.values()) {
    severityCounts[severity] = (severityCounts[severity] || 0) + 1;
  }

  return {
    key,
    kind,
    location: kind === "binary" ? value : "",
    name: groupName(key),
    images: Object.keys(platforms).sort(compareImages),
    platforms,
    rows: sorted,
    findings,
    severityCounts,
    vulnerabilities: severityById.size,
    knownExploited: unique(
      sorted
        .filter((row) => {
          return row.knownExploited !== null;
        })
        .map((row) => {
          return row.id;
        }),
    ),
  };
}

function groupsOf(findings) {
  const byKey = new Map();
  for (const finding of findings) {
    const key = groupKey(finding);
    if (!byKey.has(key)) {
      byKey.set(key, []);
    }
    byKey.get(key).push(finding);
  }

  return [...byKey.entries()]
    .map(([key, groupFindings]) => {
      return describeGroup(key, groupFindings);
    })
    .sort((left, right) => {
      return (
        right.knownExploited.length - left.knownExploited.length ||
        (right.severityCounts.critical || 0) -
          (left.severityCounts.critical || 0) ||
        (right.severityCounts.high || 0) - (left.severityCounts.high || 0) ||
        right.vulnerabilities - left.vulnerabilities ||
        compareText(left.key, right.key)
      );
    });
}

/*
 * "3 critical and 1 high", worst first.
 */
function severityPhrase(severityCounts) {
  return listOf(
    [...SEVERITIES]
      .reverse()
      .filter((severity) => {
        return (severityCounts[severity] || 0) > 0;
      })
      .map((severity) => {
        return `${severityCounts[severity]} ${severity}`;
      }),
  );
}

/*
 * An issue's title is plain text, so a name from an SBOM is cut to the
 * characters a package or binary name is made of: nothing in it can mention
 * anyone (@babel/core reads babel/core).
 */
function groupTitle(group) {
  if (group.kind === "agent") {
    return "Security: upgrade the infrastructure agent's Go dependencies";
  }
  const name = group.name.replace(/[^A-Za-z0-9._/:+~-]/g, "").slice(0, 80);
  return `Security: upgrade ${name || "a package"} in ${listOf(group.images)}`;
}

function groupHeading(group) {
  if (group.kind === "agent") {
    return `the infrastructure agent's Go dependencies (${code(SOURCES[INFRASTRUCTURE_AGENT])})`;
  }
  const what =
    group.kind === "binary"
      ? `${code(group.name)} (${code(group.location)})`
      : `${code(group.name)} (${group.kind})`;
  return `${what} in ${listOf(group.images)}`;
}

// ─── Where it comes from ───────────────────────────────────────────────────

/*
 * A version as it is written where it is pinned: 1.30.5 for the apk package
 * 1.30.5-r1, 1.26.8 for go1.26.8, 0.58.0 for v0.58.0. Null when it holds no
 * number with three parts: a shorter one (3.24) is in too many lines that
 * have nothing to do with it (alpine3.24).
 */
function versionCore(version) {
  const match = /\d+\.\d+\.\d+(?:\.\d+)*/.exec(String(version || ""));
  return match ? match[0] : null;
}

/*
 * Whether a line names a binary: as a word or a path's last part, not as a
 * directory (/etc/otelcol-contrib/config.yaml is the collector's config, not
 * the collector).
 */
function namesBinary(lower, name) {
  return new RegExp(`(^|[^a-z0-9.-])${escapeRegExp(name)}(?![a-z0-9./-])`).test(
    lower,
  );
}

/*
 * The lines of a Dockerfile (or go.mod) that likely pin what a group is
 * about, most telling first: one with an installed version in it, one that
 * names the binary together with a version, an install command that names
 * the package, Go's go and toolchain lines for its standard library, then
 * any other that names the binary. The base images (FROM, not a stage of the
 * same file) are listed as well, since what a base image carries is pinned
 * by its FROM line alone.
 */
function hintLines(text, group) {
  const versions = new Set();
  const modules = new Set();
  const packages = new Set();
  const binary = group.kind === "binary" ? group.name.toLowerCase() : null;
  let standardLibrary = false;

  for (const finding of group.findings) {
    const core = versionCore(finding.version);
    if (core) {
      versions.add(core);
    }
    if (finding.type === "go-module" && finding.package === "stdlib") {
      standardLibrary = true;
    } else if (finding.type === "go-module") {
      modules.add(finding.package.toLowerCase());
    } else {
      packages.add(finding.package.toLowerCase());
      if (finding.upstream) {
        packages.add(finding.upstream.toLowerCase());
      }
    }
  }

  const named = [];
  const bases = [];
  const stages = new Set();

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (
      !line ||
      line.startsWith("#") ||
      line.startsWith("//") ||
      /^LABEL\s/i.test(line)
    ) {
      return;
    }
    const lower = line.toLowerCase();
    const words = lower.split(/[\s=\\]+/);
    const from = /^from\s+(?:--\S+\s+)*(\S+)(?:\s+as\s+(\S+))?/.exec(lower);
    const ofStage = from !== null && stages.has(from[1]);
    if (from && from[2]) {
      stages.add(from[2]);
    }

    let score = 0;
    if (
      [...versions].some((version) => {
        return lower.includes(version);
      })
    ) {
      score += 4;
    }
    if (binary && namesBinary(lower, binary)) {
      score += /version|\d+\.\d+/.test(lower) ? 3 : 1;
    }
    if (
      [...modules].some((module) => {
        return words.includes(module);
      })
    ) {
      score += 3;
    }
    if (
      INSTALL_COMMAND.test(lower) &&
      [...packages].some((name) => {
        return words.includes(name);
      })
    ) {
      score += 3;
    }
    if (standardLibrary && /^(go|toolchain)\s/.test(line)) {
      score += 3;
    }

    const entry = { line: index + 1, text: line.slice(0, 160), score };
    if (score > 0) {
      named.push(entry);
    } else if (from && !ofStage) {
      bases.push(entry);
    }
  });

  const strongest = [...named]
    .sort((left, right) => {
      return right.score - left.score || left.line - right.line;
    })
    .slice(0, 6)
    .sort((left, right) => {
      return left.line - right.line;
    });
  const strip = ({ line, text: lineText }) => {
    return { line, text: lineText };
  };

  return { named: strongest.map(strip), bases: bases.slice(0, 4).map(strip) };
}

function sourceHints(group, { root = REPO_ROOT } = {}) {
  return unique(
    group.images
      .map((image) => {
        return SOURCES[image];
      })
      .filter(Boolean),
  ).map((file) => {
    let text;
    try {
      text = fs.readFileSync(path.join(root, file), "utf8");
    } catch {
      return { file, named: [], bases: [], missing: true };
    }
    return { file, ...hintLines(text, group), missing: false };
  });
}

function lineLink(file, line, { repository, ref }) {
  return `[${file}:${line}](https://github.com/${repository}/blob/${ref}/${file}#L${line})`;
}

function renderHints(hints, options) {
  const lines = [];
  for (const hint of hints) {
    if (hint.missing) {
      lines.push(`- ${code(hint.file)}: not found on ${options.ref}.`);
      continue;
    }
    for (const entry of hint.named) {
      lines.push(
        `- ${lineLink(hint.file, entry.line, options)}: ${code(entry.text)}`,
      );
    }
    for (const entry of hint.bases) {
      lines.push(
        `- ${lineLink(hint.file, entry.line, options)} (base image): ${code(entry.text)}`,
      );
    }
    if (hint.named.length === 0 && hint.bases.length === 0) {
      lines.push(`- ${code(hint.file)}: no line names it.`);
    }
  }
  return lines;
}

// ─── Rendering ─────────────────────────────────────────────────────────────

function severityCell(row) {
  if (row.knownExploited === null) {
    return severityName(row.severity);
  }
  return `${severityName(row.severity)}, known exploited${row.knownExploited ? ` (CISA, ${row.knownExploited})` : " (CISA)"}`;
}

function vulnerabilityTable(group) {
  const shown = group.rows.slice(0, MAX_TABLE_ROWS);
  const lines = [
    "| Vulnerability | Severity | Package | Installed | Fixed in | Images |",
    "| --- | --- | --- | --- | --- | --- |",
    ...shown.map((row) => {
      return `| ${vulnerabilityLink(row.id)} | ${severityCell(row)} | ${code(row.package)} | ${code(row.version)} | ${row.fixVersions.map(code).join(", ")} | ${row.images.join(", ")} |`;
    }),
  ];
  if (group.rows.length > shown.length) {
    lines.push("", `And ${group.rows.length - shown.length} more.`);
  }
  return lines;
}

/*
 * How to check an upgrade on one's own machine, for one image of a group.
 */
function checkCommands(image) {
  if (image === INFRASTRUCTURE_AGENT) {
    return [
      "cd agents/InfrastructureAgent",
      "go get <module>@<fixed version> && go mod tidy   # or the go line, for stdlib",
      "go build ./... && go test ./...",
      "go run golang.org/x/vuln/cmd/govulncheck@latest ./...",
    ];
  }
  const dockerfile = `./${PRODUCT_IMAGES[image].replace(/\.tpl$/, "")}`;
  const target = BUILD_TARGETS[image]
    ? ` --target ${BUILD_TARGETS[image]}`
    : "";
  return [
    "npm run prerun   # renders each Dockerfile from its Dockerfile.tpl",
    `docker build${target} -t oneuptime-check:${image} -f ${dockerfile} .`,
    `grype oneuptime-check:${image} --only-fixed --fail-on high`,
  ];
}

/*
 * Exceptions file entries that would accept a group, one per package, for the
 * one who decides it cannot be fixed yet.
 */
function exceptionTemplate(group, { issueUrl, expires }) {
  const byPackage = new Map();
  for (const row of group.rows) {
    const finding = group.findings.find((candidate) => {
      return candidate.id === row.id && candidate.package === row.package;
    });
    const name =
      finding && OS_PACKAGE_TYPES.includes(finding.type) && finding.upstream
        ? finding.upstream
        : row.package;
    if (!byPackage.has(name)) {
      byPackage.set(name, { ids: [], images: [] });
    }
    const entry = byPackage.get(name);
    entry.ids = unique([...entry.ids, row.id]);
    entry.images = unique([...entry.images, ...row.images]).sort(compareImages);
  }

  return [...byPackage.entries()].map(([name, entry]) => {
    return {
      ids: entry.ids,
      package: name,
      images: entry.images,
      expires,
      reason: "Why it can wait, and what will fix it.",
      issue: issueUrl,
    };
  });
}

function fixSteps(group) {
  const images = group.images.filter((image) => {
    return image !== INFRASTRUCTURE_AGENT;
  });
  const goBinary =
    group.kind === "binary" &&
    group.findings.some((finding) => {
      return finding.type === "go-module";
    })
      ? ` ${code(group.name)} is a Go binary: a release of it built with the fixed versions${
          group.findings.some((finding) => {
            return finding.package === "stdlib";
          })
            ? " (and, for `stdlib`, a newer Go)"
            : ""
        } fixes them.`
      : "";
  return [
    `1. Upgrade what the lines above pin to a version that has the fixed versions in the table: a newer base image, binary or package.${goBinary}`,
    "2. Change what the Ops tests keep in step with it (`IronBank/`, `.oss-scanner/`): `cd Tests/Ops && npx jest IronBank OssScannerImage` names what you missed.",
    `3. Check it on your machine${images.length > 1 ? ` (here for ${images[0]}; the same for ${listOf(images.slice(1))})` : ""}:`,
    "",
    "   ```bash",
    ...checkCommands(group.images[0]).map((line) => {
      return `   ${line}`;
    }),
    "   ```",
    "",
    `4. Open the pull request titled \`fix(security): ...\`, ending its description with \`Closes #<this issue>\`, and add the \`${GATE_LABEL}\` label before your last push: the Build workflow then runs the Vulnerability gate on it, as it does on every release.`,
  ];
}

function exceptionSteps(group, options) {
  const template = exceptionTemplate(group, options);
  return [
    `If it cannot be fixed yet (no release of it has the fix, or the upgrade needs work), accept it for now in ${code(EXCEPTIONS_FILE)}, at most ${MAX_EXCEPTION_DAYS} days ahead, saying why. The release pull request's Vulnerability gate fails on it otherwise.`,
    "",
    "<details><summary>Entries that accept these</summary>",
    "",
    "```json",
    // A backtick in a package name must not end the fence.
    ...JSON.stringify(template, null, 2)
      .replace(/`/g, "")
      .split("\n")
      .slice(1, -1)
      .map((line) => {
        return line.replace(/^ {2}/, "");
      }),
    "```",
    "",
    "</details>",
  ];
}

/*
 * The issue for a group: its title, and a body that starts with the marker the
 * nightly run finds it by.
 */
function renderIssue(group, options) {
  const {
    release,
    repository = DEFAULT_REPOSITORY,
    ref = "main",
    root = REPO_ROOT,
    today = todayUtc(),
    issueUrl = `https://github.com/${repository}/issues/<this issue>`,
  } = options;
  const linkOptions = { repository, ref };
  const exploited =
    group.knownExploited.length > 0
      ? ` CISA lists ${listOf(group.knownExploited.map(code))} as exploited in the wild: fix ${group.knownExploited.length === 1 ? "it" : "them"} first.`
      : "";

  const body = [
    markerFor(group.key),
    `OneUptime ${code(release)} ships ${groupHeading(group)}, with ${plural(group.vulnerabilities, "vulnerability", "vulnerabilities")} (${severityPhrase(group.severityCounts)}) that a newer version fixes.${exploited}`,
    "",
    "| Image | Platforms |",
    "| --- | --- |",
    ...group.images.map((image) => {
      return `| ${image} | ${(group.platforms[image] || []).join(", ")} |`;
    }),
    "",
    "### Vulnerabilities",
    "",
    ...vulnerabilityTable(group),
    "",
    "### Where it comes from",
    "",
    `Lines on ${code(ref)} that likely pin it:`,
    "",
    ...renderHints(sourceHints(group, { root }), linkOptions),
    "",
    "### How to fix it",
    "",
    ...fixSteps(group),
    "",
    ...exceptionSteps(group, { issueUrl, expires: addDays(today, 30) }),
    "",
    "---",
    "",
    `Kept by the nightly [Vulnerability Re-scan](https://github.com/${repository}/blob/${ref}/${RESCAN_WORKFLOW}) of the latest release: it rewrites this while a release still ships these, and closes it once one does not. The advisories are linked, not quoted.`,
  ].join("\n");

  return { title: groupTitle(group), body };
}

function renderGate(result, options) {
  const {
    failOn = "high",
    repository = DEFAULT_REPOSITORY,
    ref = "main",
    root = REPO_ROOT,
    today = todayUtc(),
  } = options;
  const linkOptions = { repository, ref };
  const groups = groupsOf(result.failing);
  const lines = ["## Vulnerability gate", ""];

  if (result.errors.length > 0) {
    lines.push(
      `❌ The gate cannot judge this release until these are fixed:`,
      "",
      ...result.errors.map((error) => {
        return `- ${error}`;
      }),
      "",
    );
  }

  if (groups.length === 0) {
    lines.push(
      `✅ No image this release ships has a ${failOn} or more severe vulnerability, or a known exploited one, that a newer version fixes and that ${code(EXCEPTIONS_FILE)} does not accept.`,
      "",
    );
  } else {
    const vulnerabilities = groups.reduce((total, group) => {
      return total + group.vulnerabilities;
    }, 0);
    lines.push(
      `❌ ${plural(groups.length, "thing", "things")} to upgrade before this release ships: ${plural(vulnerabilities, "vulnerability", "vulnerabilities")} that a newer version fixes, ${failOn} or more severe or known to be exploited.`,
      "",
    );
    for (const group of groups) {
      lines.push(
        `### ${groupHeading(group)}`,
        "",
        ...vulnerabilityTable(group),
        "",
        "Where it comes from:",
        "",
        ...renderHints(sourceHints(group, { root }), linkOptions),
        "",
      );
      const expired = unique(
        group.findings
          .map((finding) => {
            return finding.expiredException;
          })
          .filter(Boolean),
      );
      for (const exception of expired) {
        lines.push(
          `Entry ${exception.index} of ${code(EXCEPTIONS_FILE)} (${code(exception.package)}) accepted some of these until ${exception.expires}, and has expired: upgrade, or give the entry a new date and reason.`,
          "",
        );
      }
    }
    lines.push(
      "### How to clear it",
      "",
      "Fix it in the release branch like any red check (RELEASING.md, step 5):",
      "",
      `1. Upgrade what the lines above pin to a version that has the fixed versions (a newer base image, binary or package), and what the Ops tests keep in step with it (\`IronBank/\`, \`.oss-scanner/\`).`,
      `2. Or, when no release of it has the fix yet, accept it until a date at most ${MAX_EXCEPTION_DAYS} days ahead in ${code(EXCEPTIONS_FILE)}, with the reason and, if there is one, the issue that tracks it. That file's header (Scripts/Security/ImageVulnerabilities.js) says how.`,
      "",
    );
  }

  if (result.accepted.length > 0) {
    const soonest = result.accepted
      .map((finding) => {
        return finding.exception.expires;
      })
      .sort(compareText)[0];
    lines.push(
      `<details><summary>${plural(result.accepted.length, "finding", "findings")} accepted until a date by ${code(EXCEPTIONS_FILE)}, the first until ${soonest}</summary>`,
      "",
      "| Vulnerability | Package | Image | Until | Tracked in |",
      "| --- | --- | --- | --- | --- |",
      ...result.accepted.map((finding) => {
        return `| ${vulnerabilityLink(finding.id)} | ${code(finding.package)} | ${finding.image} | ${finding.exception.expires} | ${finding.exception.issue || ""} |`;
      }),
      "",
      "</details>",
      "",
    );
  }

  if (result.stale.length > 0) {
    lines.push(
      "### Exceptions that match nothing any more",
      "",
      `Remove these IDs from ${code(EXCEPTIONS_FILE)}:`,
      "",
      ...result.stale.map((entry) => {
        return `- entry ${entry.exception.index} (${code(entry.exception.package)}): ${entry.ids.map(code).join(", ")}`;
      }),
      "",
    );
  }

  lines.push(`Checked on ${today}.`);
  return lines.join("\n");
}

// ─── The gate ──────────────────────────────────────────────────────────────

function readExceptionsFile(file, options) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return {
      exceptions: [],
      errors: [`${options.source || file} cannot be read: ${error.message}`],
    };
  }
  return readExceptions(raw, options);
}

/*
 * The gate's verdict on a directory of reports: what fails it and why.
 */
function gate({
  reports,
  exceptions,
  exceptionErrors = [],
  today,
  failOn = "high",
  requireProductImages = false,
}) {
  const findings = actionableFindings(reports, failOn);
  const result = classify(findings, exceptions, today);
  const errors = [
    ...exceptionErrors,
    ...coverageProblems(reports, { requireProductImages }),
  ];
  return {
    ...result,
    errors,
    passed: errors.length === 0 && result.failing.length === 0,
  };
}

// ─── The issues ────────────────────────────────────────────────────────────

/*
 * The hidden line an issue is found by, its group's key percent-encoded but
 * for what reads plainly in one (binary:/otelcol-contrib stays as it is): a
 * package name from an SBOM cannot end the comment (-->) or mention anyone.
 */
function markerFor(key) {
  const encoded = String(key).replace(/[^A-Za-z0-9._/:+~-]/g, (character) => {
    return encodeURIComponent(character).replace(/[!'()*]/g, (reserved) => {
      return `%${reserved.charCodeAt(0).toString(16).toUpperCase()}`;
    });
  });
  return `<!-- ${MARKER}: ${encoded} -->`;
}

function markerOf(body) {
  const match = new RegExp(`<!-- ${MARKER}: ([A-Za-z0-9._/:+~%-]+) -->`).exec(
    body || "",
  );
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/*
 * What to do with the issues, from this run's groups and the issues that
 * carry a marker:
 *
 *   - a group with an open issue: update it;
 *   - a group whose last issue was closed as not planned: leave it, someone
 *     decided so;
 *   - a group whose last issue was closed after the scanned release was
 *     published: leave it, the fix ships in the next release;
 *   - any other group: create an issue, at most maxNew in one run;
 *   - an open issue whose group this run did not find: close it.
 */
function planIssues({ groups, issues, publishedAt, maxNew = MAX_NEW_ISSUES }) {
  const known = new Map();
  for (const issue of issues) {
    const key = markerOf(issue.body);
    if (!key) {
      continue;
    }
    if (!known.has(key)) {
      known.set(key, { open: null, closed: [] });
    }
    const entry = known.get(key);
    if (String(issue.state).toUpperCase() === "OPEN") {
      if (!entry.open || issue.number < entry.open.number) {
        entry.open = issue;
      }
    } else {
      entry.closed.push(issue);
    }
  }

  const published = publishedAt ? Date.parse(publishedAt) : NaN;
  const actions = [];
  let created = 0;

  for (const group of groups) {
    const entry = known.get(group.key) || { open: null, closed: [] };
    if (entry.open) {
      actions.push({ type: "update", group, issue: entry.open });
      continue;
    }

    const last = [...entry.closed].sort((left, right) => {
      return (
        (Date.parse(right.closedAt) || 0) - (Date.parse(left.closedAt) || 0)
      );
    })[0];
    if (last && String(last.stateReason).toUpperCase() === "NOT_PLANNED") {
      actions.push({
        type: "skip",
        group,
        issue: last,
        reason: `#${last.number} was closed as not planned`,
      });
      continue;
    }
    if (
      last &&
      !Number.isNaN(published) &&
      Date.parse(last.closedAt) > published
    ) {
      actions.push({
        type: "skip",
        group,
        issue: last,
        reason: `#${last.number} was closed after this release was published: its fix ships in the next one`,
      });
      continue;
    }
    if (created >= maxNew) {
      actions.push({
        type: "skip",
        group,
        issue: null,
        reason: `more than ${maxNew} new issues in one run; the next run opens it`,
      });
      continue;
    }
    created += 1;
    actions.push({ type: "create", group, previous: last || null });
  }

  const found = new Set(
    groups.map((group) => {
      return group.key;
    }),
  );
  for (const [key, entry] of known) {
    if (entry.open && !found.has(key)) {
      actions.push({ type: "close", key, issue: entry.open });
    }
  }

  return actions;
}

function listIssues(gh) {
  return JSON.parse(
    gh([
      "issue",
      "list",
      "--label",
      ISSUE_LABEL,
      "--state",
      "all",
      "--limit",
      "1000",
      "--json",
      "number,title,body,state,stateReason,closedAt,url",
    ]) || "[]",
  );
}

function ensureLabel(gh) {
  const labels = JSON.parse(
    gh(["label", "list", "--limit", "500", "--json", "name"]) || "[]",
  );
  const present = labels.some((label) => {
    return String(label.name).toLowerCase() === ISSUE_LABEL;
  });
  if (!present) {
    gh([
      "label",
      "create",
      ISSUE_LABEL,
      "--color",
      ISSUE_LABEL_COLOR,
      "--description",
      ISSUE_LABEL_DESCRIPTION,
    ]);
  }
  return !present;
}

/*
 * Opens, rewrites and closes the issues as planIssues says. `gh` is
 * (args: string[]) => string, its standard output. With dryRun it only reads.
 */
function syncIssues({
  groups,
  release,
  publishedAt,
  repository = DEFAULT_REPOSITORY,
  ref = "main",
  root = REPO_ROOT,
  today = todayUtc(),
  gh,
  dryRun = false,
  maxNew = MAX_NEW_ISSUES,
  runUrl = "",
}) {
  const actions = planIssues({
    groups,
    issues: listIssues(gh),
    publishedAt,
    maxNew,
  });
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vulnerability-issues-"),
  );

  try {
    if (
      !dryRun &&
      actions.some((action) => {
        return action.type === "create";
      })
    ) {
      ensureLabel(gh);
    }

    actions.forEach((action, index) => {
      if (action.type === "create" || action.type === "update") {
        const issueUrl = action.issue
          ? action.issue.url ||
            `https://github.com/${repository}/issues/${action.issue.number}`
          : `https://github.com/${repository}/issues/<this issue>`;
        const rendered = renderIssue(action.group, {
          release,
          repository,
          ref,
          root,
          today,
          issueUrl,
        });
        const body =
          action.type === "create" && action.previous
            ? `${rendered.body}\n\nOpened again: #${action.previous.number} was closed, and OneUptime ${release} still ships these.`
            : rendered.body;
        action.title = rendered.title;

        if (
          action.type === "update" &&
          action.issue.title === rendered.title &&
          String(action.issue.body || "").trim() === body.trim()
        ) {
          action.type = "unchanged";
          return;
        }
        if (dryRun) {
          return;
        }

        const bodyFile = path.join(directory, `issue-${index}.md`);
        fs.writeFileSync(bodyFile, body);
        if (action.type === "create") {
          action.url = String(
            gh([
              "issue",
              "create",
              "--title",
              rendered.title,
              "--body-file",
              bodyFile,
              ...ISSUE_LABELS.flatMap((label) => {
                return ["--label", label];
              }),
            ]) || "",
          ).trim();
        } else {
          gh([
            "issue",
            "edit",
            String(action.issue.number),
            "--title",
            rendered.title,
            "--body-file",
            bodyFile,
          ]);
        }
      } else if (action.type === "close" && !dryRun) {
        gh([
          "issue",
          "close",
          String(action.issue.number),
          "--reason",
          "completed",
          "--comment",
          `OneUptime ${release} no longer ships a fixable critical or high vulnerability for this that nothing tracks: it was upgraded, or an entry in ${EXCEPTIONS_FILE} names the issue that tracks what is left.${runUrl ? ` (${runUrl})` : ""}`,
        ]);
      }
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }

  return actions;
}

function renderSync(actions, { release, dryRun }) {
  const lines = [
    `## Vulnerability Re-scan of OneUptime ${release}${dryRun ? " (dry run: nothing written)" : ""}`,
    "",
  ];
  if (actions.length === 0) {
    lines.push(
      "No fixable critical, high or known exploited vulnerability in what this release ships that nothing tracks, and no issue to close.",
    );
    return lines.join("\n");
  }
  lines.push(
    "| Thing to upgrade | Images | Vulnerabilities | Issue |",
    "| --- | --- | --- | --- |",
  );
  const would = (done, planned) => {
    return dryRun ? planned : done;
  };
  for (const action of actions) {
    if (action.type === "close") {
      lines.push(
        `| ${code(action.key)} | | | #${action.issue.number}: ${would("closed", "would be closed")} |`,
      );
      continue;
    }
    let issue;
    if (action.type === "create") {
      issue = action.url || would("opened", "would be opened");
    } else if (action.type === "skip") {
      issue = `not opened: ${action.reason}`;
    } else if (action.type === "unchanged") {
      issue = `#${action.issue.number}: unchanged`;
    } else {
      issue = `#${action.issue.number}: ${would("rewritten", "would be rewritten")}`;
    }
    const exploited =
      action.group.knownExploited.length > 0
        ? `, ${action.group.knownExploited.length} known exploited`
        : "";
    lines.push(
      `| ${code(action.group.name)} | ${action.group.images.join(", ")} | ${severityPhrase(action.group.severityCounts)}${exploited} | ${issue} |`,
    );
  }
  return lines.join("\n");
}

// ─── Command line ──────────────────────────────────────────────────────────

const VALUE_FLAGS = {
  "--reports": "reports",
  "--exceptions": "exceptions",
  "--fail-on": "failOn",
  "--release": "release",
  "--published-at": "publishedAt",
  "--repository": "repository",
  "--ref": "ref",
  "--run-url": "runUrl",
  "--version": "version",
  "--assets": "assets",
  "--today": "today",
  "--max-new-issues": "maxNew",
};

const BOOLEAN_FLAGS = {
  "--dry-run": "dryRun",
  "--require-product-images": "requireProductImages",
};

const COMMANDS = ["gate", "issues", "release-sboms"];

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) {
    throw new Error(
      `Usage: ImageVulnerabilities.js <${COMMANDS.join("|")}> [options] (its header says which)`,
    );
  }
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (hasOwn(BOOLEAN_FLAGS, flag)) {
      options[BOOLEAN_FLAGS[flag]] = true;
    } else if (hasOwn(VALUE_FLAGS, flag) && rest[index + 1] !== undefined) {
      options[VALUE_FLAGS[flag]] = rest[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
  }

  const required = {
    gate: ["reports"],
    issues: ["reports", "release"],
    "release-sboms": ["version", "assets"],
  }[command];
  for (const name of required) {
    if (!options[name]) {
      const flag = Object.keys(VALUE_FLAGS).find((candidate) => {
        return VALUE_FLAGS[candidate] === name;
      });
      throw new Error(`${command} needs ${flag}`);
    }
  }
  if (options.failOn && !SEVERITIES.includes(options.failOn)) {
    throw new Error(`--fail-on must be one of ${SEVERITIES.join(", ")}`);
  }
  if (options.today && !isDay(options.today)) {
    throw new Error("--today must be a YYYY-MM-DD date");
  }
  if (options.maxNew !== undefined) {
    options.maxNew = Number(options.maxNew);
    if (!Number.isInteger(options.maxNew) || options.maxNew < 0) {
      throw new Error("--max-new-issues must be a whole number");
    }
  }
  return options;
}

function writeSummary(text, env) {
  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  }
}

function realGh(args) {
  return childProcess.execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/*
 * Runs a command; returns the exit code: 0, or 1 when the gate fails.
 */
function main(
  argv,
  { env = process.env, gh = realGh, out = process.stdout } = {},
) {
  const options = parseArgs(argv);
  const repository =
    options.repository ||
    env.GH_REPO ||
    env.GITHUB_REPOSITORY ||
    DEFAULT_REPOSITORY;
  const today = options.today || todayUtc();
  const ref = options.ref || "main";

  if (options.command === "release-sboms") {
    const names = fs
      .readFileSync(options.assets, "utf8")
      .split(/\r?\n/)
      .map((name) => {
        return name.trim();
      })
      .filter(Boolean);
    const selected = releaseSboms(names, options.version);
    out.write(selected.length > 0 ? `${selected.join("\n")}\n` : "");
    return selected.length > 0 ? 0 : 1;
  }

  const reports = readReports(options.reports);
  const exceptionsFile =
    options.exceptions || path.join(REPO_ROOT, EXCEPTIONS_FILE);
  const { exceptions, errors } = readExceptionsFile(exceptionsFile, {
    today,
    repository,
    source: options.exceptions || EXCEPTIONS_FILE,
  });

  if (options.command === "gate") {
    const result = gate({
      reports,
      exceptions,
      exceptionErrors: errors,
      today,
      failOn: options.failOn || "high",
      requireProductImages: Boolean(options.requireProductImages),
    });
    const summary = renderGate(result, {
      failOn: options.failOn || "high",
      repository,
      ref,
      today,
    });
    out.write(`${summary}\n`);
    writeSummary(summary, env);
    return result.passed ? 0 : 1;
  }

  // issues: a finding an exception accepts is still to fix, unless the
  // exception names the issue that tracks it.
  if (errors.length > 0) {
    out.write(
      `${errors
        .map((error) => {
          return `::warning title=Vulnerability exceptions::${error}`;
        })
        .join("\n")}\n`,
    );
  }
  const findings = actionableFindings(reports, options.failOn || "high");
  const { failing, accepted } = classify(findings, exceptions, today);
  const untracked = [
    ...failing,
    ...accepted.filter((finding) => {
      return !finding.exception.issue;
    }),
  ];
  const actions = syncIssues({
    groups: groupsOf(untracked),
    release: options.release,
    publishedAt: options.publishedAt,
    repository,
    ref,
    today,
    gh,
    dryRun: Boolean(options.dryRun),
    maxNew: options.maxNew === undefined ? MAX_NEW_ISSUES : options.maxNew,
    runUrl: options.runUrl || "",
  });
  const summary = renderSync(actions, {
    release: options.release,
    dryRun: Boolean(options.dryRun),
  });
  out.write(`${summary}\n`);
  writeSummary(summary, env);
  return 0;
}

module.exports = {
  BUILD_TARGETS,
  EXCEPTIONS_FILE,
  GATE_LABEL,
  INFRASTRUCTURE_AGENT,
  ISSUE_LABEL,
  MARKER,
  MAX_EXCEPTION_DAYS,
  MAX_NEW_ISSUES,
  PRODUCT_IMAGES,
  SOURCES,
  TEST_IMAGES,
  actionableFindings,
  classify,
  coverageProblems,
  exceptionTemplate,
  findingsOf,
  gate,
  groupKey,
  groupsOf,
  hintLines,
  main,
  markerOf,
  parseArgs,
  planIssues,
  readExceptions,
  readReports,
  releaseSboms,
  renderGate,
  renderIssue,
  reportTarget,
  syncIssues,
  versionCore,
};

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
