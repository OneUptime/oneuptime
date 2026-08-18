import { RetiredClaim, RetiredClaims } from "../Utils/Claims";
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

interface Violation {
  file: string;
  line: number;
  text: string;
}

function findViolations(pattern: RegExp): Array<Violation> {
  const violations: Array<Violation> = [];

  for (const file of viewFiles) {
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
): string {
  const locations: string = violations
    .map((violation: Violation) => {
      return `  - Views/${violation.file}:${violation.line}\n      ${violation.text}`;
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
