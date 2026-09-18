import {
  RetiredClaim,
  RetiredClaims,
  RetiredEditionClaims,
} from "../Utils/Claims";
import fs from "fs";
import path from "path";

/*
 * Governance enforcement.
 *
 * The claims matrix is only worth something if the pages obey it. This suite
 * walks every template under Home/Views and fails when retired language
 * reappears — with the reason it was retired and the approved replacement, so
 * whoever trips it does not have to go digging.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

interface ViewFile {
  relativePath: string;
  contents: string;
}

function collectViewFiles(directory: string): Array<ViewFile> {
  const files: Array<ViewFile> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectViewFiles(fullPath));
      continue;
    }

    if (!entry.name.endsWith(".ejs")) {
      continue;
    }

    files.push({
      relativePath: path.relative(VIEWS_ROOT, fullPath),
      contents: fs.readFileSync(fullPath, "utf-8"),
    });
  }

  return files;
}

const viewFiles: Array<ViewFile> = collectViewFiles(VIEWS_ROOT);

const UTILS_ROOT: string = path.join(__dirname, "..", "Utils");

/*
 * The Utils modules that carry page copy: comparison tables, the self-hosted
 * page's content, SEO descriptions and structured data. Claims.ts is left
 * out because it defines the retired patterns, and so quotes every one.
 */
function collectPageDataFiles(directory: string): Array<ViewFile> {
  return fs
    .readdirSync(directory)
    .filter((name: string) => {
      return name.endsWith(".ts") && name !== "Claims.ts";
    })
    .map((name: string): ViewFile => {
      return {
        relativePath: name,
        contents: fs.readFileSync(path.join(directory, name), "utf-8"),
      };
    });
}

const pageDataFiles: Array<ViewFile> = collectPageDataFiles(UTILS_ROOT);

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findViolations(
  pattern: RegExp,
  files: Array<ViewFile> = viewFiles,
): Array<Violation> {
  const violations: Array<Violation> = [];

  for (const file of files) {
    const lines: Array<string> = file.contents.split("\n");

    lines.forEach((line: string, index: number) => {
      /*
       * Reset lastIndex defensively — a global flag on a shared regex would
       * otherwise make results depend on call order.
       */
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        violations.push({
          file: file.relativePath,
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }

  return violations;
}

function describeViolations(
  retired: RetiredClaim,
  violations: Array<Violation>,
  rootLabel: string = "Views",
): string {
  const locations: string = violations
    .map((violation: Violation) => {
      return `  - ${rootLabel}/${violation.file}:${violation.line}\n      ${violation.text}`;
    })
    .join("\n");

  return [
    "",
    `Retired claim language found: "${retired.example}"`,
    `Why it was retired: ${retired.reason}`,
    `Approved replacement: ${retired.replacement}`,
    `Governed by claim: ${retired.claimId} (see Home/Utils/Claims.ts)`,
    "Found in:",
    locations,
    "",
  ].join("\n");
}

describe("Claims governance over Home/Views", () => {
  test("the scanner actually found templates to scan", () => {
    expect(viewFiles.length).toBeGreaterThan(50);
  });

  test.each(
    RetiredClaims.map((retired: RetiredClaim) => {
      return [retired.example, retired] as [string, RetiredClaim];
    }),
  )(
    'no template uses retired language: "%s"',
    (_example: string, retired: RetiredClaim) => {
      const violations: Array<Violation> = findViolations(retired.pattern);

      if (violations.length > 0) {
        throw new Error(describeViolations(retired, violations));
      }

      expect(violations).toHaveLength(0);
    },
  );
});

describe("Edition claims governance over the Home/Utils page data", () => {
  test("the scanner found the modules that carry page copy, and skipped Claims.ts", () => {
    const names: Array<string> = pageDataFiles.map((file: ViewFile) => {
      return file.relativePath;
    });

    expect(names).toContain("ProductCompare.ts");
    expect(names).toContain("SelfHosted.ts");
    expect(names).toContain("PageSEO.ts");
    expect(names).not.toContain("Claims.ts");
  });

  test.each(
    RetiredEditionClaims.map((retired: RetiredClaim) => {
      return [retired.example, retired] as [string, RetiredClaim];
    }),
  )(
    'no page data uses retired edition language: "%s"',
    (_example: string, retired: RetiredClaim) => {
      const violations: Array<Violation> = findViolations(
        retired.pattern,
        pageDataFiles,
      );

      if (violations.length > 0) {
        throw new Error(describeViolations(retired, violations, "Utils"));
      }

      expect(violations).toHaveLength(0);
    },
  );
});

describe("Edition retired claims catch what the split made false", () => {
  /*
   * The exact sentences the Community / Enterprise split made false, as they
   * stood on the site before it. Each must still be caught, so none of them
   * can quietly come back.
   */
  const formerlyPublished: Array<string> = [
    "100% open source under Apache 2.0 - not open-core. Every line ships on GitHub, and the community edition is the full feature set.",
    "We're fully open-source, not open-core. Every line of code is on GitHub.",
    "That's why we built OneUptime as a fully open-source platform that combines monitoring, incident management, status pages, and on-call scheduling into one unified solution.",
    "<span>100% Open Source</span>",
    "The entire platform is Apache-2.0 licensed and developed in public on GitHub.",
    "The entire platform is open source on GitHub.",
    "Telemetry is priced per GB ingested, the whole thing is Apache-2.0 open source, and you can self-host the exact same product for free.",
    "The whole platform is Apache-2.0 open source, and you can self-host this exact product for free.",
    "OneUptime is fully open-source. Monitor your applications, manage incidents,",
    "Every product feature — the community edition is not feature-limited",
    "Same product as our cloud, no feature gates, no telemetry leaving your network.",
    "Hardened enterprise images",
    "Hardened Enterprise Edition container images",
    "No hardened Enterprise Edition images",
    "Enterprise agreements add hardened images, deployment support, and custom data residency",
    "Community and Enterprise run the same product. What the Enterprise Edition changes is the container image.",
    "Both editions are the same product. The difference is accountability.",
    "Self-host the entire Apache 2.0 platform for free with full data ownership, or use the managed cloud",
    "Self-host the entire OneUptime platform under Apache 2.0",
    "OneUptime is Apache 2.0 and the whole platform self-hosts for free, without operating Mimir, Loki, and Tempo as separate systems.",
    "Self-host the Apache 2.0 platform on your own infrastructure with the full feature set",
    "OneUptime is open source under Apache 2.0 and can be self-hosted on your own infrastructure with the full feature set, so you pay only for the compute you run.",
  ];

  test.each(formerlyPublished)("catches: %s", (sentence: string) => {
    const caughtBy: Array<RetiredClaim> = RetiredEditionClaims.filter(
      (retired: RetiredClaim) => {
        return retired.pattern.test(sentence);
      },
    );

    expect(caughtBy.length).toBeGreaterThan(0);
  });

  /*
   * Comparison pages describe other products in the same Utils files. The
   * edition patterns must only catch statements about OneUptime.
   */
  const competitorCopy: Array<string> = [
    "Zabbix is a mature, fully open-source monitoring system built for infrastructure, network, and server metrics.",
    "Fully open source (GPL), no license fee",
    "SigNoz follows an open-core model - its core is permissively licensed.",
    "Sentry is source-available under the Functional Source License, not OSI open source at release.",
    "Open-core (ee module)",
  ];

  test.each(competitorCopy)(
    "leaves competitor copy alone: %s",
    (sentence: string) => {
      for (const retired of RetiredEditionClaims) {
        expect(retired.pattern.test(sentence)).toBe(false);
      }
    },
  );

  test("every edition claim is also enforced over the templates", () => {
    for (const retired of RetiredEditionClaims) {
      expect(RetiredClaims).toContain(retired);
    }
  });
});

describe("Pages state the edition split accurately", () => {
  function readView(relativePath: string): string {
    return fs.readFileSync(path.join(VIEWS_ROOT, relativePath), "utf-8");
  }

  test("the home page's open-source section names the separately licensed ee/ directory", () => {
    const contents: string = readView("Partials/home-own-it.ejs");

    expect(contents).toContain("Open source under Apache 2.0");
    expect(contents).toContain("separately licensed ee/ directory");
  });

  test("the about page says the core is Apache 2.0 and the enterprise modules are on GitHub too", () => {
    const contents: string = readView("about.ejs");

    expect(contents).toContain(
      "The core platform is open source under Apache 2.0",
    );
    expect(contents).toContain(
      "including the enterprise modules, is on GitHub",
    );
  });

  test("the trust center still promises the whole source is auditable", () => {
    expect(readView("trust.ejs")).toContain(
      "The entire platform's source code is public on",
    );
  });

  test("the demo FAQ names what the Enterprise Edition adds", () => {
    expect(readView("demo.ejs")).toContain(
      "Enterprise agreements add the Enterprise Edition (SSO, SCIM, audit logs, and instance health dashboards)",
    );
  });
});

describe("Aligned pages state the governed numbers", () => {
  function readView(relativePath: string): string {
    return fs.readFileSync(path.join(VIEWS_ROOT, relativePath), "utf-8");
  }

  test("the enterprise overview quotes the SLA's Enterprise target", () => {
    const contents: string = readView("enterprise-overview.ejs");

    expect(contents).toContain("99.95%");
    expect(contents).toContain("/legal/sla");
  });

  test("the pricing page does not advertise an SLA on the free plan", () => {
    const contents: string = readView("pricing.ejs");

    expect(contents).toContain("No uptime SLA (best effort)");
    expect(contents).not.toContain("99.00% SLA");
  });

  test("the pricing page states paid uptime as a 99.9% target", () => {
    const contents: string = readView("pricing.ejs");

    expect(contents).toContain("99.9% uptime target");
    expect(contents).not.toContain("99.95% SLA");
  });

  test("the demo page points self-hosting buyers at the canonical page", () => {
    expect(readView("demo.ejs")).toContain("/enterprise/self-hosted");
  });

  test("the demo page separates certified, attested, and contractual claims", () => {
    const contents: string = readView("demo.ejs");

    expect(contents).toContain("CSA STAR Level 2 are certified");
    expect(contents).toContain("attested by third-party auditors");
    expect(contents).toContain("backed by a DPA or BAA");
    expect(contents).toContain("/trust#claims");
  });

  test("the security page points at the canonical trust center", () => {
    const contents: string = readView("security.ejs");

    expect(contents).toContain("/trust#claims");
    expect(contents).toContain("Trust Center");
  });

  test("the security page no longer calls internal targets an SLA", () => {
    const contents: string = readView("security.ejs");

    expect(contents).not.toContain("industry-standard SLAs");
    expect(contents).toContain("internal remediation targets");
  });

  test("the trust center renders the governed claims matrix", () => {
    const contents: string = readView("trust.ejs");

    expect(contents).toContain("./Partials/claims-matrix");
    expect(contents).toContain('href="#claims"');
  });

  test("the claims matrix partial reads from the Claims util, not hard-coded copy", () => {
    const contents: string = readView("Partials/claims-matrix.ejs");

    expect(contents).toContain("claimsMatrix.forEach");
    expect(contents).toContain("claimStatuses.forEach");
    expect(contents).toContain("claim.statement");
    expect(contents).toContain("claim.qualifier");
    expect(contents).toContain("claim.evidence");
  });

  test("the self-hosted page links back to the claims matrix", () => {
    expect(readView("self-hosted.ejs")).toContain("/trust#claims");
  });
});

describe("Compliance pages use the governed status words", () => {
  function readView(relativePath: string): string {
    return fs.readFileSync(path.join(VIEWS_ROOT, relativePath), "utf-8");
  }

  test.each([["21-cfr-part-11.ejs"], ["annex-11.ejs"], ["gamp-5.ejs"]])(
    "%s states an aligned status and links to the matrix",
    (file: string) => {
      const contents: string = readView(file);

      expect(contents).toContain("<strong>aligned</strong>");
      expect(contents).toContain("/trust#claims");
    },
  );

  test("the CSA STAR page states Level 2 certification, and which level it is", () => {
    const contents: string = readView("csa-star.ejs");

    expect(contents).toContain("<strong>certified</strong>");
    expect(contents).toContain("STAR Level 2");
    expect(contents).toContain("/trust#claims");
    // The distinction between the levels has to stay on the page.
    expect(contents).toContain("third-party assessor");
  });

  test("the PCI page offers an Attestation of Compliance, not a certificate", () => {
    const contents: string = readView("pci.ejs");

    expect(contents).toContain("Attestation of Compliance");
    expect(contents).toContain("Qualified Security Assessor");
    expect(contents).toContain("/trust#claims");
    expect(contents).not.toContain("To request the certificate please");
  });

  test("the ISO 27017 page explains it extends the ISO 27001 certificate", () => {
    const contents: string = readView("iso-27017.ejs");

    expect(contents).toContain("extension of our ISO/IEC 27001 certification");
  });

  test("the trust center badges use the governed status words", () => {
    const contents: string = readView("trust.ejs");

    for (const label of [
      ">Certified</span>",
      ">Attested</span>",
      ">Compliant</span>",
      ">Aligned</span>",
      ">In progress</span>",
    ]) {
      expect(contents).toContain(label);
    }

    // Words that are not in the vocabulary must not appear as a status badge.
    for (const stale of [
      ">Available</span>",
      ">CAIQ on file</span>",
      ">BAA available</span>",
    ]) {
      expect(contents).not.toContain(stale);
    }
  });
});
