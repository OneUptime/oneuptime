import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The two periods a self-hosted Enterprise install runs without a current
 * license, as the docs, the Helm chart, the READMEs, config.example.env and
 * the license expiry email state them, against the constants the license
 * classifier uses:
 *
 *   trial  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS (14): an install that has
 *          no license, counted from its first run of the Enterprise Edition
 *   grace  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS (30): after a license
 *          expires
 *
 * One constant used to do both jobs (14 days), so a lot of copy said "the
 * 14-day trial or grace period" or "14 days after a license expires". The
 * owner then gave expired licenses 30 days. Every licensing sentence that
 * states a length must state the right one, the key pages must state both,
 * and no text may still describe a 14-day grace period.
 *
 * The scan reads English: the translated identity pages are pinned
 * separately, number by number, in EnterpriseEditionDocs.test.ts.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const DOCS_CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);

const TRIAL: number = ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS;
const GRACE: number = ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS;

// A sentence is about the Enterprise license when it says so.
const LICENSING_SENTENCE: RegExp = /\blicen[cs]e|\bEnterprise\b/i;

// "<N>-day trial", "<N> day trial"
const TRIAL_LENGTH: RegExp = /\b(\d+)[- ]day (?:evaluation )?trial\b/gi;

/*
 * "<N>-day grace period", "<N> days after a license expires", "<N> days
 * after the expiry date", "grace period of <N> days", "expired more than <N>
 * days ago", "gets <N> days before the same happens"
 */
const GRACE_LENGTHS: ReadonlyArray<RegExp> = [
  /\b(\d+)[- ]day grace\b/gi,
  /\b(\d+) days after (?:a|the|its) (?:license expires|license expired|expiry|expiration)/gi,
  /\bgrace period of (\d+) days\b/gi,
  /\bexpired more than (\d+) days ago\b/gi,
  /\bgets (\d+) days before the same happens\b/gi,
];

/*
 * One length for both periods: "the 14-day trial or grace period" reads as a
 * 14-day grace period.
 */
const CONFLATED_LENGTH: RegExp =
  /\b\d+[- ]day trial or (?:the )?grace period\b/i;

/*
 * The text a file shows its reader, one sentence per entry: comment markers
 * of YAML and env files dropped (a sentence wraps across them), whitespace
 * normalized (markdown and comments wrap mid-sentence).
 */
function sentencesOf(text: string): Array<string> {
  return text
    .replace(/^[ \t]*#+[ \t]?/gm, "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|\\n|",\s*"/)
    .map((sentence: string) => {
      return sentence.trim();
    })
    .filter((sentence: string) => {
      return sentence.length > 0;
    });
}

// What is wrong with the lengths one piece of licensing text states.
function periodProblemsIn(label: string, text: string): Array<string> {
  const problems: Array<string> = [];

  for (const sentence of sentencesOf(text)) {
    if (!LICENSING_SENTENCE.test(sentence)) {
      continue;
    }

    for (const match of sentence.matchAll(TRIAL_LENGTH)) {
      if (Number(match[1]) !== TRIAL) {
        problems.push(`${label}: trial stated as ${match[0]}: ${sentence}`);
      }
    }

    for (const pattern of GRACE_LENGTHS) {
      for (const match of sentence.matchAll(pattern)) {
        if (Number(match[1]) !== GRACE) {
          problems.push(
            `${label}: grace period stated as ${match[0]}: ${sentence}`,
          );
        }
      }
    }

    if (CONFLATED_LENGTH.test(sentence)) {
      problems.push(
        `${label}: one length for the trial and the grace period: ${sentence}`,
      );
    }
  }

  return problems;
}

function filesUnder(
  directory: string,
  extensions: Array<string>,
): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") {
        files.push(...filesUnder(fullPath, extensions));
      }

      continue;
    }

    if (
      extensions.some((extension: string) => {
        return entry.name.endsWith(extension);
      })
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function fromRepository(relativePath: string): string {
  return path.join(REPOSITORY_ROOT, relativePath);
}

function readFile(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function read(relativePath: string): string {
  return sentencesOf(readFile(fromRepository(relativePath))).join(" ");
}

/*
 * Everything a self-hoster reads about the license. ee/README.md is scanned
 * when it is there: the core CI jobs delete ee/.
 */
function scannedFiles(): Array<string> {
  return [
    ...filesUnder(DOCS_CONTENT_DIR, [".md"]),
    fromRepository("HelmChart/Public/oneuptime/README.md"),
    fromRepository("HelmChart/Public/oneuptime/values.yaml"),
    fromRepository("HelmChart/Public/oneuptime/values.schema.json"),
    ...filesUnder(fromRepository("HelmChart/Public/oneuptime/docs"), [".md"]),
    fromRepository("README.md"),
    ...filesUnder(fromRepository("Docs/translations"), [".md"]),
    fromRepository("config.example.env"),
    fromRepository("Scripts/Install/MergeEnvTemplate.js"),
    ...filesUnder(
      path.join(PACKAGES_ROOT, "App/FeatureSet/Notification/Templates"),
      [".hbs"],
    ),
    fromRepository("ee/README.md"),
  ].filter((file: string) => {
    return fs.existsSync(file);
  });
}

describe("the license period scan", () => {
  it("uses a 14-day trial and a 30-day grace period", () => {
    expect(TRIAL).toBe(14);
    expect(GRACE).toBe(30);
  });

  it.each([
    "If the license expires, everything keeps working for a 14-day grace period.",
    "After the trial (or 14 days after a license expires), SSO stops until a license is activated.",
    "Your self-hosted OneUptime instances keep every enterprise feature for 14 days after the expiry date above (the grace period).",
    "Audit logging stops once the 14-day trial or grace period is over without a valid license.",
    "Valid, in the 14-day grace period after it expired, or inside the 14-day trial of an Enterprise install.",
    "A license that expires later gets 14 days before the same happens.",
    "A self-hosted license has lapsed when the license expired more than 14 days ago.",
    "An Enterprise install with no license runs as a 30-day trial.",
  ])("catches: %s", (sentence: string) => {
    expect(periodProblemsIn("example", sentence).length).toBeGreaterThan(0);
  });

  it.each([
    "Every enterprise feature keeps working during the 14-day trial, and for 30 days after a license expires (the grace period).",
    "If the license expires, everything keeps working for a 30-day grace period, and after that the same happens as for an install with no license.",
    "After the trial (or 30 days after a license expires), SSO, OIDC, SCIM and audit logging stop until a license is activated.",
    "Your self-hosted OneUptime instances keep every enterprise feature for 30 days after the expiry date above (the grace period).",
    "An install with no license runs as a 14-day trial, which is for evaluation.",
    "The license is refused while it is lapsed (after the trial or grace period).",
    // Not about the license: another feature's grace period is its own business.
    "Regenerate moves the old token into a 14-day grace period.",
  ])("leaves alone: %s", (sentence: string) => {
    expect(periodProblemsIn("example", sentence)).toEqual([]);
  });

  it("reads through YAML and env comment markers", () => {
    expect(
      periodProblemsIn(
        "values.yaml",
        [
          "  ##   license runs as a 14-day trial, which is for evaluation. After the trial",
          "  ##   (or 14 days after a license expires), until a license is activated, SSO,",
        ].join("\n"),
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("no licensing text states the wrong trial or grace length", () => {
  it("scans the files it says it does", () => {
    const files: Array<string> = scannedFiles().map((file: string) => {
      return path.relative(REPOSITORY_ROOT, file);
    });

    for (const expected of [
      "packages/App/FeatureSet/Docs/Content/en/self-hosted/enterprise.md",
      "packages/App/FeatureSet/Docs/Content/en/installation/upgrading.md",
      "packages/App/FeatureSet/Docs/Content/en/slo/feed-and-audit-logs.md",
      "packages/App/FeatureSet/Docs/Content/en/identity/sso.md",
      "HelmChart/Public/oneuptime/README.md",
      "HelmChart/Public/oneuptime/values.yaml",
      "HelmChart/Public/oneuptime/values.schema.json",
      "HelmChart/Public/oneuptime/docs/upgrade-notes.md",
      "HelmChart/Public/oneuptime/docs/configuration.md",
      "README.md",
      "config.example.env",
      "packages/App/FeatureSet/Notification/Templates/EnterpriseLicenseExpiryReminder.hbs",
    ]) {
      expect({ file: expected, scanned: files.includes(expected) }).toEqual({
        file: expected,
        scanned: true,
      });
    }

    expect(files.length).toBeGreaterThan(1000);
  });

  it("finds none", () => {
    const problems: Array<string> = [];

    for (const file of scannedFiles()) {
      problems.push(
        ...periodProblemsIn(
          path.relative(REPOSITORY_ROOT, file),
          readFile(file),
        ),
      );
    }

    expect(problems).toEqual([]);
  });
});

describe("the key pages state both lengths, from the constants", () => {
  it("the Enterprise Edition docs page", () => {
    const page: string = read(
      "packages/App/FeatureSet/Docs/Content/en/self-hosted/enterprise.md",
    );

    expect(page).toContain(`**${TRIAL}-day trial**`);
    expect(page).toContain(
      `during the ${TRIAL}-day trial, and for ${GRACE} days after a license expires (the grace period)`,
    );
    expect(page).toContain(
      `the first ${TRIAL} days of an unlicensed install, or ${GRACE} days after a license expires`,
    );
  });

  it("the upgrade notes, in every language", () => {
    const pages: Array<string> = filesUnder(DOCS_CONTENT_DIR, [
      "upgrading.md",
    ]).filter((file: string) => {
      return file.endsWith(path.join("installation", "upgrading.md"));
    });

    expect(pages.length).toBe(17);

    for (const file of pages) {
      const page: string = sentencesOf(readFile(file)).join(" ");

      expect({
        file: path.relative(DOCS_CONTENT_DIR, file),
        grace: page.includes(
          `everything keeps working for a ${GRACE}-day grace period`,
        ),
        trial: page.includes(`gets a ${TRIAL}-day trial`),
      }).toEqual({
        file: path.relative(DOCS_CONTENT_DIR, file),
        grace: true,
        trial: true,
      });
    }
  });

  it("the English identity and SLO audit log pages", () => {
    for (const page of [
      "identity/sso",
      "identity/scim",
      "identity/global-sso",
      "slo/feed-and-audit-logs",
    ]) {
      expect({
        page,
        states: read(
          `packages/App/FeatureSet/Docs/Content/en/${page}.md`,
        ).includes(
          `(after the ${TRIAL}-day trial, or ${GRACE} days after a license expires)`,
        ),
      }).toEqual({ page, states: true });
    }
  });

  it("the Helm chart", () => {
    const schema: {
      properties: {
        image: { properties: { type: { description: string } } };
      };
    } = JSON.parse(
      readFile(fromRepository("HelmChart/Public/oneuptime/values.schema.json")),
    );

    for (const [source, text] of [
      ["README.md", read("HelmChart/Public/oneuptime/README.md")],
      ["values.yaml", read("HelmChart/Public/oneuptime/values.yaml")],
      [
        "values.schema.json",
        schema.properties.image.properties.type.description,
      ],
      [
        "docs/configuration.md",
        read("HelmChart/Public/oneuptime/docs/configuration.md"),
      ],
    ] as Array<[string, string]>) {
      expect({
        source,
        trial: text.includes(`runs as a ${TRIAL}-day trial`),
        grace: text.includes(
          `After the trial (or ${GRACE} days after a license expires)`,
        ),
      }).toEqual({ source, trial: true, grace: true });
    }

    const upgradeNotes: string = read(
      "HelmChart/Public/oneuptime/docs/upgrade-notes.md",
    );

    expect(upgradeNotes).toContain(`**${TRIAL}-day trial**`);
    expect(upgradeNotes).toContain(
      `A license that expires later gets a ${GRACE}-day grace period before the same happens.`,
    );
  });

  it("config.example.env", () => {
    const example: string = read("config.example.env");

    expect(example).toContain(`${TRIAL}-day trial`);
    expect(example).toContain(
      `After the trial (or ${GRACE} days after a license expires)`,
    );
  });

  it("the license expiry reminder email", () => {
    expect(
      read(
        "packages/App/FeatureSet/Notification/Templates/EnterpriseLicenseExpiryReminder.hbs",
      ),
    ).toContain(
      `keep every enterprise feature for ${GRACE} days after the expiry date above (the grace period)`,
    );
  });

  it("ee/README.md, when ee/ is present", () => {
    if (!fs.existsSync(fromRepository("ee/README.md"))) {
      return;
    }

    const readme: string = read("ee/README.md");

    expect(readme).toContain(
      `valid, in the ${GRACE}-day grace period after it expired, or, with no license at all, inside the ${TRIAL}-day trial`,
    );
    expect(readme).toContain(`the license expired more than ${GRACE} days ago`);
    expect(readme).toContain(
      `An unlicensed Enterprise install gets a ${TRIAL}-day trial`,
    );
  });
});
