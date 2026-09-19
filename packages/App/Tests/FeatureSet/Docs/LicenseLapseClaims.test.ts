import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * No doc, Helm text, README, config comment, email template or UI string may
 * claim that SSO, SCIM or audit logging keep running once the Enterprise
 * license lapses.
 *
 * They used to say exactly that. The edition split first shipped "soft
 * enforcement" (a lapsed license only made configuration read-only), and the
 * promise was written into the docs in 17 languages, the Helm chart,
 * config.example.env and the edition dialog. The owner then decided the
 * opposite: after the 14-day trial or grace period, SSO and OIDC sign-in stop
 * (and "Require SSO" is no longer enforced, so users sign in with a
 * password), SCIM provisioning stops and audit logging stops recording - the
 * Community Edition's behaviour - until a license is activated. A sentence
 * left behind would tell an admin that SSO still guards an install where
 * anyone with an account can now set a password and sign in.
 *
 * The scan is phrase-based, like the retired "100% open source" claims in
 * EnterpriseEditionDocs.test.ts: every pattern carries the published sentence
 * it was written for (it must catch it), and the accurate copy that replaced
 * those sentences must pass. Sentences about an UNREADABLE license state are
 * exempt: while the license cannot be read the server keeps SSO, SCIM and
 * audit logging on, and the docs say so - but not when the same sentence also
 * talks about a lapse.
 *
 * ee/ is deleted in the core CI jobs, so ee/README.md and the ee UI are not
 * scanned here; the ee UI copy is pinned by ee/Tests/UI.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");

// Who (or what) the claim is about.
const SUBJECT: string =
  '(?:SSO|single sign-on|OIDC|SCIM|audit log(?:s|ging)?|"Require SSO"|Require SSO for login)';

// Up to one clause of the same sentence between the subject and the verb.
const SAME_CLAUSE: string = "[^.;:!?]{0,100}?";

interface RetiredLapseClaim {
  pattern: RegExp;
  // The published sentence the pattern was written for.
  example: string;
}

const RETIRED_LAPSE_CLAIMS: Array<RetiredLapseClaim> = [
  {
    pattern: new RegExp(
      `\\b${SUBJECT}\\b${SAME_CLAUSE}\\bnever stops?\\b`,
      "i",
    ),
    example:
      "Everything already configured keeps working — SSO, SCIM and audit logging never stop — and core monitoring is never affected.",
  },
  {
    pattern: new RegExp(
      `\\b${SUBJECT}\\b${SAME_CLAUSE}\\bkeeps? (?:running|working)\\b`,
      "i",
    ),
    example:
      "SSO, OIDC, SCIM and audit logging keep running with the configuration you have.",
  },
  {
    pattern: new RegExp(
      `\\b${SUBJECT}\\b${SAME_CLAUSE}\\b(?:continues?|still works?|still runs?)\\b`,
      "i",
    ),
    example: "Audit logging continues.",
  },
  {
    pattern:
      /\b(?:everything|anything) (?:you )?(?:have )?(?:already )?configured keeps working\b/i,
    example:
      "After the trial enterprise configuration becomes read-only. Everything you already configured keeps working.",
  },
  {
    pattern:
      /\bnothing (?:you )?(?:have )?(?:already )?configured stops working\b/i,
    example: "Nothing you already configured stops working without one.",
  },
  {
    pattern: /\bnever (?:silently )?weakens? (?:a |any )?security control/i,
    example:
      "Enforcement is soft. Losing a license never locks anyone out and never weakens a security control.",
  },
  {
    pattern: /\bnever tied to the licen[cs]e\b/i,
    example:
      "SSO enforcement is never tied to the license, so a lapsed license never silently weakens a security control.",
  },
  {
    pattern: /\bkeeps? working either way\b/i,
    example:
      "You can still change this configuration during the grace period; after it ends the configuration becomes read-only. Single sign-on and SCIM keep working either way.",
  },
  {
    pattern: /\bmembers can still sign in\b/i,
    example:
      "Members can still sign in, and your identity provider can still provision and deprovision users.",
  },
];

/*
 * The copy that replaced the retired claims, including the sentences built to
 * sit close to them. None may be flagged, or somebody will reword the truth
 * to get past the scan.
 */
const ACCURATE_LAPSE_COPY: Array<string> = [
  "Every enterprise feature keeps working during the 14-day trial, and for 14 days after a license expires (the grace period).",
  "After that, **SSO, OIDC, SCIM and audit logging stop** until a license is activated, the same as on the Community Edition.",
  'After the trial, SSO and OIDC sign-in stop, "Require SSO for login" is no longer enforced (users sign in with their password), SCIM provisioning stops and audit logging stops recording.',
  "If the license expires, everything keeps working for a 14-day grace period, and after that the same happens as for an install with no license.",
  "While it cannot read the license state, for example for a moment while the server starts, SSO enforcement, SCIM and audit logging stay on.",
  "While the license state cannot be read, SSO, SCIM and audit logging keep running.",
  "**Core monitoring is never affected**: monitors, alerts, incidents, on-call, status pages and telemetry all keep working.",
  "ClickHouse capacity, the instance log, Global Probes, Migrations and the Support Bundle keep working without it.",
  "**Master admins can always sign in with their password.**",
  "A valid license keeps single sign-on, SCIM provisioning and audit logging running, enterprise configuration editable and the enterprise admin dashboards unlocked.",
  'Losing a license never locks anyone out: "Require SSO for login" stops being enforced at the same moment SSO sign-in stops, so users sign in with a password.',
  "Everything resumes, without a restart, as soon as a license is activated, and core monitoring is never affected.",
  "Your self-hosted OneUptime instances keep every enterprise feature for 14 days after the expiry date above (the grace period).",
];

// An unreadable license state keeps things on - unless the sentence also talks about a lapse.
const UNREADABLE_LICENSE_STATE: RegExp =
  /\b(?:cannot (?:be )?read|could not be read|unreadable|unknown)\b/i;
const LAPSE_WORDS: RegExp =
  /\b(?:laps(?:e|es|ed|ing)|expire[sd]?|expiry|missing|invalid|after the (?:\d+-day )?(?:trial|grace))\b/i;

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

function retiredClaimsIn(sentence: string): Array<string> {
  if (UNREADABLE_LICENSE_STATE.test(sentence) && !LAPSE_WORDS.test(sentence)) {
    return [];
  }

  return RETIRED_LAPSE_CLAIMS.filter((claim: RetiredLapseClaim) => {
    return claim.pattern.test(sentence);
  }).map((claim: RetiredLapseClaim) => {
    return claim.pattern.source;
  });
}

function violationsIn(label: string, text: string): Array<string> {
  const violations: Array<string> = [];

  for (const sentence of sentencesOf(text)) {
    const found: Array<string> = retiredClaimsIn(sentence);

    if (found.length > 0) {
      violations.push(`${label}: ${sentence}`);
    }
  }

  return violations;
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

// Everything a self-hoster, an admin or a customer reads about the license.
function scannedFiles(): Array<string> {
  return [
    ...filesUnder(path.join(PACKAGES_ROOT, "App/FeatureSet/Docs/Content"), [
      ".md",
    ]),
    fromRepository("HelmChart/Public/oneuptime/README.md"),
    fromRepository("HelmChart/Public/oneuptime/values.yaml"),
    fromRepository("HelmChart/Public/oneuptime/values.schema.json"),
    ...filesUnder(fromRepository("HelmChart/Public/oneuptime/docs"), [".md"]),
    fromRepository("README.md"),
    ...filesUnder(fromRepository("Docs/translations"), [".md"]),
    fromRepository("config.example.env"),
    ...filesUnder(
      path.join(PACKAGES_ROOT, "App/FeatureSet/Notification/Templates"),
      [".hbs"],
    ),
    ...filesUnder(
      path.join(PACKAGES_ROOT, "Common/UI/Components/EditionLabel"),
      [".ts", ".tsx"],
    ),
    ...["Dashboard", "AdminDashboard", "Accounts", "StatusPage"].flatMap(
      (frontend: string) => {
        return filesUnder(
          path.join(PACKAGES_ROOT, `App/FeatureSet/${frontend}/src/Locales`),
          [".json"],
        );
      },
    ),
    ...filesUnder(path.join(PACKAGES_ROOT, "Home/Views"), [".ejs"]),
  ];
}

function readFile(file: string): string {
  return fs.readFileSync(file, "utf8");
}

describe("the retired license-lapse claims", () => {
  it.each(RETIRED_LAPSE_CLAIMS)(
    "catches: $example",
    (claim: RetiredLapseClaim) => {
      expect(claim.pattern.test(claim.example)).toBe(true);
      expect(violationsIn("example", claim.example).length).toBeGreaterThan(0);
    },
  );

  it.each(ACCURATE_LAPSE_COPY)("leaves alone: %s", (sentence: string) => {
    expect(violationsIn("copy", sentence)).toEqual([]);
  });

  it("does not exempt a sentence about an unreadable license state that also claims SSO survives a lapse", () => {
    expect(
      violationsIn(
        "copy",
        "SSO, SCIM and audit logging keep running when the license is unknown or has expired.",
      ).length,
    ).toBeGreaterThan(0);
  });

  /*
   * The published claims wrapped across lines, and in values.yaml across
   * "##" comment markers. The scan must see through both, or it would pass
   * the very files it was written for.
   */
  it("catches a claim wrapped across markdown lines and YAML comment markers", () => {
    expect(
      violationsIn(
        "README.md",
        [
          "the enterprise admin dashboards are locked. Everything already configured keeps",
          "working — SSO, SCIM and audit logging never stop — and core monitoring is never",
          "affected.",
        ].join("\n"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      violationsIn(
        "values.yaml",
        [
          "  ##   read-only and the enterprise admin dashboards are locked. Everything",
          "  ##   already configured keeps working (SSO, SCIM and audit logging never",
          "  ##   stop), and core monitoring is never affected.",
        ].join("\n"),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("catches a claim inside a JSON locale file, one string at a time", () => {
    const locale: string = JSON.stringify(
      {
        "Enterprise license required.": "Enterprise license required.",
        "Single sign-on and SCIM keep working as configured.":
          "Single sign-on and SCIM keep working as configured.",
      },
      null,
      2,
    );

    expect(violationsIn("en.json", locale).length).toBeGreaterThan(0);
  });

  it("catches the claim when it is added back to a file that is clean today", () => {
    const page: string = readFile(
      path.join(
        PACKAGES_ROOT,
        "App/FeatureSet/Docs/Content/en/self-hosted/enterprise.md",
      ),
    );

    expect(violationsIn("enterprise.md", page)).toEqual([]);
    expect(
      violationsIn(
        "enterprise.md",
        `${page}\n- **SSO, OIDC and SCIM keep working** with the configuration you already have.\n`,
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("no doc, Helm text, README, template or UI string claims SSO, SCIM or audit logging survive a lapse", () => {
  it("scans the files it says it does", () => {
    const files: Array<string> = scannedFiles().map((file: string) => {
      return path.relative(REPOSITORY_ROOT, file);
    });

    for (const expected of [
      "packages/App/FeatureSet/Docs/Content/en/self-hosted/enterprise.md",
      "packages/App/FeatureSet/Docs/Content/ja/installation/upgrading.md",
      "HelmChart/Public/oneuptime/README.md",
      "HelmChart/Public/oneuptime/values.yaml",
      "HelmChart/Public/oneuptime/values.schema.json",
      "HelmChart/Public/oneuptime/docs/upgrade-notes.md",
      "HelmChart/Public/oneuptime/docs/configuration.md",
      "README.md",
      "config.example.env",
      "packages/App/FeatureSet/Notification/Templates/EnterpriseLicenseExpiryReminder.hbs",
      "packages/Common/UI/Components/EditionLabel/EditionLabel.tsx",
      "packages/App/FeatureSet/Dashboard/src/Locales/en.json",
      "packages/App/FeatureSet/AdminDashboard/src/Locales/de.json",
    ]) {
      expect({ file: expected, scanned: files.includes(expected) }).toEqual({
        file: expected,
        scanned: true,
      });
    }

    // Every docs language, every page.
    expect(files.length).toBeGreaterThan(1000);
  });

  it("finds none", () => {
    const violations: Array<string> = [];

    for (const file of scannedFiles()) {
      violations.push(
        ...violationsIn(path.relative(REPOSITORY_ROOT, file), readFile(file)),
      );
    }

    expect(violations).toEqual([]);
  });
});

/*
 * Not claiming the opposite is not enough: the places a self-hoster reads
 * before the lapse must say what stops, and when. (The docs page, the upgrade
 * notes and the Helm chart are pinned in EnterpriseEditionDocs.test.ts.)
 */
describe("the lapse is announced where people read about the license", () => {
  it("config.example.env says what stops after the trial and that a license brings it back", () => {
    const example: string = sentencesOf(
      readFile(fromRepository("config.example.env")),
    ).join(" ");

    expect(example).toContain(
      "After the trial (or 14 days after a license expires), SSO, OIDC, SCIM and audit logging stop",
    );
    expect(example).toContain('"Require SSO" is no longer enforced');
    expect(example).toContain("until a license is activated");
  });

  it("the license expiry reminder email says when the grace period ends and what stops then", () => {
    const template: string = sentencesOf(
      readFile(
        path.join(
          PACKAGES_ROOT,
          "App/FeatureSet/Notification/Templates/EnterpriseLicenseExpiryReminder.hbs",
        ),
      ),
    ).join(" ");

    for (const expected of [
      "keep every enterprise feature for 14 days after the expiry date above (the grace period)",
      "When the grace period ends, until a renewed license is activated",
      "SSO and OIDC sign-in stop",
      "is no longer enforced, so your users sign in with their password",
      "SCIM provisioning stops",
      "audit logging stops recording",
      "enterprise configuration becomes read-only",
      "Everything resumes as soon as the renewed license is activated",
      "Monitoring, alerts, incidents, on-call and status pages are not affected",
    ]) {
      expect({
        expected: expected,
        present: template.includes(expected),
      }).toEqual({ expected: expected, present: true });
    }

    // The old line said features "will stop working" at expiry, with no grace period.
    expect(template).not.toContain("enterprise features will stop working");
  });
});
