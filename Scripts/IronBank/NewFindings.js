"use strict";

/**
 * What Iron Bank will ask OneUptime about: the findings in the Iron Bank image
 * of the App that need a fix or a justification.
 *
 * Iron Bank scans every image it builds, and the vendor must fix or justify
 * each finding in VAT (vat.dso.mil) before the image is approved, except the
 * ones the image inherits from Iron Bank's own base image, which VAT marks
 * inherited and Iron Bank answers for. The Iron Bank Preflight workflow scans
 * the image it builds the same way, with Grype (the open-source Anchore
 * engine) and Trivy, and scans the base image too. This reads those reports
 * and sorts every finding into one of three groups:
 *
 *   inherited   the base image has it too
 *   justified   IronBank/Justifications/App.yaml has an entry for its ID (or
 *               one of its aliases) and package: OneUptime has answered it
 *   new         neither: it needs a fix in the release, or a justification
 *
 * and writes a Markdown summary (the workflow adds it to the run's summary).
 * It exits 1 when a new finding is at least as severe as --fail-on, so a
 * scheduled run turns red the day a new one appears. Justifications that
 * match nothing any more are listed, so the file can be pruned.
 *
 *   node Scripts/IronBank/NewFindings.js \
 *     --grype grype.json --trivy trivy.json \
 *     --base-grype base-grype.json --base-trivy base-trivy.json \
 *     --justifications justifications.json --fail-on high
 *
 * The scanners' JSON reports are read as Grype (`-o json`) and Trivy
 * (`--format json`) write them. The justifications are the YAML file as JSON
 * (the workflow converts it with yq), so this needs nothing but Node.js.
 */

const fs = require("fs");

const JUSTIFICATIONS_FILE = "IronBank/Justifications/App.yaml";

const SEVERITIES = [
  "unknown",
  "negligible",
  "low",
  "medium",
  "high",
  "critical",
];

/**
 * A severity as a rank, unknown lowest.
 * @param {string} severity
 * @returns {number}
 */
function rank(severity) {
  return Math.max(0, SEVERITIES.indexOf(String(severity || "").toLowerCase()));
}

/*
 * One finding's ID: the CVE when the scanner or an alias names one, so
 * Grype's GHSA-... and Trivy's CVE-... for the same advisory meet.
 */
function canonicalId(ids) {
  const cves = ids
    .filter((id) => {
      return /^CVE-/i.test(id);
    })
    .sort();
  return (cves[0] || ids[0]).toUpperCase();
}

/*
 * A path without the manifest file a package was found by, which says nothing
 * a reader needs.
 */
function packageLocation(location) {
  const trimmed = location.replace(/\/(package\.json|package-lock\.json)$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/**
 * Grype's report as findings.
 * @param {object} report - `grype -o json`
 * @returns {Array<object>}
 */
function fromGrype(report) {
  return (report.matches || []).map((match) => {
    const vulnerability = match.vulnerability || {};
    const artifact = match.artifact || {};
    const ids = [
      vulnerability.id,
      ...(match.relatedVulnerabilities || []).map((related) => {
        return related.id;
      }),
    ].filter(Boolean);

    return {
      ids,
      package: artifact.name,
      version: artifact.version,
      severity: String(vulnerability.severity || "unknown").toLowerCase(),
      fixedIn: (vulnerability.fix && vulnerability.fix.versions) || [],
      paths: (artifact.locations || []).map((location) => {
        return packageLocation(location.path);
      }),
      scanner: "Grype",
    };
  });
}

/**
 * Trivy's report as findings.
 * @param {object} report - `trivy image --format json`
 * @returns {Array<object>}
 */
function fromTrivy(report) {
  return (report.Results || []).flatMap((result) => {
    return (result.Vulnerabilities || []).map((vulnerability) => {
      return {
        ids: [
          vulnerability.VulnerabilityID,
          ...(vulnerability.VendorIDs || []),
        ].filter(Boolean),
        package: vulnerability.PkgName,
        version: vulnerability.InstalledVersion,
        severity: String(vulnerability.Severity || "unknown").toLowerCase(),
        fixedIn: vulnerability.FixedVersion
          ? vulnerability.FixedVersion.split(/,\s*/)
          : [],
        paths: vulnerability.PkgPath
          ? [packageLocation(vulnerability.PkgPath)]
          : [],
        scanner: "Trivy",
      };
    });
  });
}

/**
 * Findings from several scanners, one per advisory, package and version.
 * @param {Array<object>} findings - From fromGrype and fromTrivy
 * @returns {Map<string, object>} key -> merged finding
 */
function merge(findings) {
  const merged = new Map();

  for (const finding of findings) {
    const id = canonicalId(finding.ids);
    const key = `${id}|${finding.package}|${finding.version}`;
    const entry = merged.get(key) || {
      id,
      aliases: new Set(),
      package: finding.package,
      version: finding.version,
      severity: "unknown",
      fixedIn: new Set(),
      paths: new Set(),
      scanners: new Set(),
    };

    for (const alias of finding.ids) {
      if (alias.toUpperCase() !== id) {
        entry.aliases.add(alias.toUpperCase());
      }
    }
    if (rank(finding.severity) > rank(entry.severity)) {
      entry.severity = finding.severity;
    }
    finding.fixedIn.forEach((version) => {
      entry.fixedIn.add(version);
    });
    finding.paths.forEach((location) => {
      entry.paths.add(location);
    });
    entry.scanners.add(finding.scanner);
    merged.set(key, entry);
  }

  return merged;
}

/**
 * The justifications file's entries, checked.
 * @param {Array<object>|null} entries - The YAML file as JSON
 * @returns {Array<{id: string, package: string, justification: string}>}
 */
function readJustifications(entries) {
  if (entries === null || entries === undefined) {
    return [];
  }
  if (!Array.isArray(entries)) {
    throw new Error(`${JUSTIFICATIONS_FILE} must be a list`);
  }

  return entries.map((entry, index) => {
    for (const field of ["id", "package", "justification"]) {
      if (
        !entry ||
        typeof entry[field] !== "string" ||
        entry[field].trim() === ""
      ) {
        throw new Error(
          `${JUSTIFICATIONS_FILE}: entry ${index + 1} has no ${field}`,
        );
      }
    }
    return {
      id: entry.id.trim().toUpperCase(),
      package: entry.package.trim(),
      justification: entry.justification.trim(),
    };
  });
}

function justifies(justification, finding) {
  return (
    justification.package === finding.package &&
    (justification.id === finding.id || finding.aliases.has(justification.id))
  );
}

/**
 * The image's findings sorted into new, justified and inherited, most severe
 * first, and the justifications that match nothing.
 * @param {{image: Array<object>, base: Array<object>, justifications: Array<object>}} input
 */
function classify(input) {
  const image = merge(input.image);
  const base = merge(input.base);
  const justifications = readJustifications(input.justifications);
  const result = { new: [], justified: [], inherited: [], unused: [] };
  const used = new Set();

  for (const [key, finding] of image) {
    if (base.has(key)) {
      result.inherited.push(finding);
      continue;
    }
    const justification = justifications.find((candidate) => {
      return justifies(candidate, finding);
    });
    if (justification) {
      used.add(justification);
      result.justified.push(finding);
    } else {
      result.new.push(finding);
    }
  }
  result.unused = justifications.filter((justification) => {
    return !used.has(justification);
  });

  const order = (a, b) => {
    return (
      rank(b.severity) - rank(a.severity) ||
      a.id.localeCompare(b.id) ||
      a.package.localeCompare(b.package)
    );
  };
  result.new.sort(order);
  result.justified.sort(order);
  result.inherited.sort(order);

  return result;
}

/*
 * Text placed in one cell of the summary's Markdown tables. A "|" ends a cell
 * and a line ending ends the row, so each backslash and each "|" is escaped in
 * one pass: a backslash already in the text cannot turn the "|" escape into
 * the end of the cell ("C:\|" reads "C:\|"). Each line ending becomes a space.
 */
function cell(text) {
  return String(text)
    .replace(/[\\|]/g, (character) => {
      return `\\${character}`;
    })
    .replace(/\r\n|\r|\n/g, " ");
}

function capitalized(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * @param {ReturnType<typeof classify>} result
 * @param {{title?: string, failOn?: string}} options
 * @returns {string} Markdown
 */
function summary(result, options) {
  const lines = ["## Iron Bank preflight: findings", ""];
  if (options.title) {
    lines.push(options.title, "");
  }
  lines.push(
    "| | Findings |",
    "| --- | --- |",
    `| New: need a fix in the release, or a justification in VAT | ${result.new.length} |`,
    `| Justified in ${JUSTIFICATIONS_FILE} | ${result.justified.length} |`,
    `| Inherited from Iron Bank's base image (Iron Bank answers these) | ${result.inherited.length} |`,
    "",
  );

  if (result.new.length > 0) {
    lines.push(
      "### New findings",
      "",
      "Fix each in the release, or justify it in VAT and add it, with the same text, to " +
        `\`${JUSTIFICATIONS_FILE}\`.`,
      "",
      "| Severity | Finding | Package | Version | Fixed in | Found by | Where |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const finding of result.new) {
      const aliases = [...finding.aliases].sort();
      const paths = [...finding.paths].sort();
      lines.push(
        [
          "",
          capitalized(finding.severity),
          cell(finding.id + (aliases.length ? ` (${aliases.join(", ")})` : "")),
          cell(finding.package),
          cell(finding.version),
          cell([...finding.fixedIn].join(", ") || "no fix yet"),
          [...finding.scanners].sort().join(", "),
          cell(
            paths.slice(0, 2).join(", ") +
              (paths.length > 2 ? ` and ${paths.length - 2} more` : ""),
          ),
          "",
        ]
          .join(" | ")
          .trim(),
      );
    }
    lines.push("");
  }

  if (result.unused.length > 0) {
    lines.push(
      "### Justifications that match nothing any more",
      "",
      `No scanner reports these now: remove them from \`${JUSTIFICATIONS_FILE}\`.`,
      "",
    );
    for (const justification of result.unused) {
      lines.push(`- ${justification.id} in ${justification.package}`);
    }
    lines.push("");
  }

  if (options.failOn) {
    const failing = failures(result, options.failOn).length;
    lines.push(
      failing > 0
        ? `**${failing} new finding(s) at ${options.failOn} or above.**`
        : `No new finding at ${options.failOn} or above.`,
      "",
    );
  }

  return lines.join("\n");
}

/**
 * The new findings at least as severe as `threshold`.
 * @param {ReturnType<typeof classify>} result
 * @param {string} threshold
 */
function failures(result, threshold) {
  return result.new.filter((finding) => {
    return rank(finding.severity) >= rank(threshold);
  });
}

function parseArgs(argv) {
  const options = {
    grype: null,
    trivy: null,
    baseGrype: null,
    baseTrivy: null,
    justifications: null,
    failOn: null,
    title: null,
  };
  const flags = {
    "--grype": "grype",
    "--trivy": "trivy",
    "--base-grype": "baseGrype",
    "--base-trivy": "baseTrivy",
    "--justifications": "justifications",
    "--fail-on": "failOn",
    "--title": "title",
  };

  for (let index = 0; index < argv.length; index += 2) {
    const name = flags[argv[index]];
    if (!name || argv[index + 1] === undefined) {
      throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    }
    options[name] = argv[index + 1];
  }

  if (!options.grype && !options.trivy) {
    throw new Error("Give at least one report: --grype or --trivy");
  }
  if (options.failOn && !SEVERITIES.includes(options.failOn)) {
    throw new Error(`--fail-on must be one of ${SEVERITIES.join(", ")}`);
  }

  return options;
}

function readJson(file) {
  return file ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function findingsOf(grypeFile, trivyFile) {
  return [
    ...(grypeFile ? fromGrype(readJson(grypeFile)) : []),
    ...(trivyFile ? fromTrivy(readJson(trivyFile)) : []),
  ];
}

function main(argv) {
  const options = parseArgs(argv);
  const result = classify({
    image: findingsOf(options.grype, options.trivy),
    base: findingsOf(options.baseGrype, options.baseTrivy),
    justifications: readJson(options.justifications),
  });

  process.stdout.write(`${summary(result, options)}\n`);

  if (options.failOn && failures(result, options.failOn).length > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  fromGrype,
  fromTrivy,
  merge,
  readJustifications,
  classify,
  summary,
  failures,
  parseArgs,
};

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
