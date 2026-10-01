import { describe, expect, it } from "@jest/globals";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import fs from "fs";
import path from "path";

/*
 * What a lapsed Enterprise license does, as every doc, Helm text, README,
 * config comment, email template and UI string must tell it.
 *
 * SCIM and audit logging stop. The edition split first shipped "soft
 * enforcement" (a lapsed license only made configuration read-only), and the
 * promise that everything keeps running was written into the docs in 17
 * languages, the Helm chart, config.example.env and the edition dialog. The
 * owner then decided the opposite: after the 14-day trial (an install with no
 * license) or the 30-day grace period (after a license expires), SCIM
 * provisioning stops and audit logging stops recording - the Community
 * Edition's behaviour - until a license is activated. A sentence left behind
 * would tell an admin that their identity provider still deprovisions people,
 * or that changes are still recorded, when neither is true.
 *
 * Single sign-on does not stop. SAML and OIDC sign-in, global SSO and "Require
 * SSO for login" are part of every edition, the Community Edition included.
 * So no text may say single sign-on stops, is refused or is not enforced when
 * the license lapses, or that it needs the Enterprise Edition - the upgrade
 * notes of released versions included. The one exception is a sentence that
 * says it describes 14.0.10 or earlier: oneuptime.com sends the license expiry
 * email to installs on every version, and on those releases single sign-on
 * did stop with the license.
 *
 * Both scans are phrase-based, like the retired "100% open source" claims in
 * EnterpriseEditionDocs.test.ts: every pattern carries the published sentence
 * it was written for (it must catch it), and the accurate copy that replaced
 * those sentences must pass. Sentences about an UNREADABLE license state are
 * exempt from the first scan: while the license cannot be read the server
 * keeps SCIM and audit logging on, and the docs say so - but not when the same
 * sentence also talks about a lapse.
 *
 * ee/ is deleted in the core CI jobs, so ee/README.md and the ee UI are not
 * scanned here; the ee UI copy is pinned by ee/Tests/UI.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");

/*
 * Who (or what) a "keeps running" claim is about: what stops with the
 * license. Single sign-on is not among them - it does keep running.
 */
const SUBJECT: string = "(?:SCIM|audit log(?:s|ging)?)";

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
    pattern: new RegExp(
      `\\b${SUBJECT}\\b${SAME_CLAUSE}\\bnever tied to the licen[cs]e\\b`,
      "i",
    ),
    example:
      "SCIM provisioning is never tied to the license, so a lapsed license never stops deprovisioning.",
  },
  {
    pattern: new RegExp(
      `\\b${SUBJECT}\\b${SAME_CLAUSE}\\bkeeps? working either way\\b`,
      "i",
    ),
    example:
      "You can still change this configuration during the grace period; after it ends the configuration becomes read-only. Single sign-on and SCIM keep working either way.",
  },
  {
    pattern: new RegExp(
      `\\b(?:identity provider|IdP)\\b${SAME_CLAUSE}\\bcan still (?:provision|deprovision)\\b`,
      "i",
    ),
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
  "Every enterprise feature keeps working during the 14-day trial, and for 30 days after a license expires (the grace period).",
  "After that, **SCIM and audit logging stop** until a license is activated, the same as on the Community Edition, and enterprise configuration becomes read-only.",
  "After the trial, SCIM provisioning stops and audit logging stops recording.",
  "If the license expires, everything keeps working for a 30-day grace period, and after that the same happens as for an install with no license.",
  "While it cannot read the license state, for example for a moment while the server starts, SCIM and audit logging stay on.",
  "While the license state cannot be read, SCIM and audit logging keep running.",
  "**Core monitoring is never affected**: monitors, alerts, incidents, on-call, status pages and telemetry all keep working.",
  "ClickHouse capacity, the instance log, Global Probes, Migrations and the Support Bundle keep working without it.",
  "**Master admins can always sign in with their password.**",
  "A valid license that includes them keeps SCIM provisioning and audit logging running, enterprise configuration editable and the enterprise admin dashboards unlocked.",
  "When the grace period ends, until a renewed license is activated: SCIM provisioning stops, so your identity provider can no longer provision or deprovision users; audit logging stops recording; and enterprise configuration becomes read-only.",
  "Everything resumes, without a restart, as soon as a license is activated, and core monitoring is never affected.",
  "Your self-hosted OneUptime instances keep every enterprise feature for 30 days after the expiry date above (the grace period).",
];

/*
 * Retired claims about single sign-on that are true now, so they must pass:
 * the scan above was narrowed to what really stops, not to keep the old
 * promise out of the SSO copy.
 */
const NOW_ACCURATE_SSO_COPY: Array<string> = [
  "SSO enforcement is never tied to the license.",
  "Members can still sign in.",
  "Single sign-on keeps working either way.",
  'Single sign-on keeps working when the license lapses: SAML and OIDC sign-in, global SSO and "Require SSO for login" are part of every edition.',
  "SSO, OIDC and global SSO keep running after the trial and the grace period, because they are part of the Community Edition.",
  "Single sign-on never stops with the license.",
];

// An unreadable license state keeps things on - unless the sentence also talks about a lapse.
const UNREADABLE_LICENSE_STATE: RegExp =
  /\b(?:cannot (?:be )?read|could not be read|unreadable|unknown)\b/i;
const LAPSE_WORDS: RegExp =
  /\b(?:laps(?:e|es|ed|ing)|expire[sd]?|expiry|missing|invalid|after the (?:\d+-day )?(?:trial|grace))\b/i;

/*
 * Single sign-on, in the names the copy gives it: "SSO", "single sign-on",
 * "SAML SSO", "OIDC", "OpenID Connect", "SSO/SAML", and the "sign-in through
 * these providers" the provider pages said.
 */
const SSO_NAME: string =
  "(?:single sign-on|SSO(?:\\/SAML)?|OIDC|OpenID Connect|SAML(?: SSO)?|sign-in through (?:these|this|SSO|OIDC) providers?)";
const FEATURE: string = `(?:${SSO_NAME}|SCIM(?: provisioning)?|audit logging|audit logs)`;
// ", ", ", and ", " and ", " or ": between the names of a list.
const LIST_SEPARATOR: string =
  "(?:,\\s*(?:and\\s+|or\\s+)?|\\s+(?:and|or)\\s+)";
// "(SAML and OIDC)" after a name.
const ASIDE: string = "(?:\\s*\\([^)]{0,40}\\))?";
// "SSO", "SSO and OIDC", "SSO, OIDC, SCIM and audit logging": a list naming single sign-on.
const LIST_NAMING_SSO: string = `(?:${FEATURE}${ASIDE}${LIST_SEPARATOR})*${SSO_NAME}${ASIDE}(?:${LIST_SEPARATOR}${FEATURE}${ASIDE})*`;
// Text between a name and its verb that does not change the subject to another feature.
const SAME_SUBJECT: string =
  "(?:(?!SCIM|audit|team compliance|Health)[^.;:!?])";

// A sentence that is about the license or the editions.
const LICENSE_CONTEXT: RegExp =
  /\b(?:licen[cs]e[sd]?|trial|grace|laps(?:e|es|ed|ing)|expir(?:e|es|ed|y)|Community Edition|Enterprise Edition)\b/i;

// A sentence that names single sign-on at all.
const NAMES_SINGLE_SIGN_ON: RegExp = /\bSSO\b|single sign-on/i;

// A sentence dated to the releases where single sign-on was an Enterprise feature.
const DATED_TO_OLD_RELEASES: RegExp = /\b14\.0\.10\b/;

interface RetiredSsoClaim extends RetiredLapseClaim {
  // Only a claim when the sentence is about the license or the editions.
  needsLicenseContext: boolean;
}

const RETIRED_SSO_CLAIMS: Array<RetiredSsoClaim> = [
  {
    // Single sign-on stops, is refused or is off.
    pattern: new RegExp(
      `\\b${LIST_NAMING_SSO}(?:\\*\\*)?\\s+(?:sign-in\\s+|sign-on\\s+|login\\s+|enforcement\\s+)?(?:stops?|stopped|(?:is|are)\\s+(?:refused|off|unavailable|not available|switched off|turned off))\\b`,
      "i",
    ),
    needsLicenseContext: true,
    example:
      'Without a valid license (after the 14-day trial, or 30 days after a license expires), SSO sign-in stops and "Require SSO" is not enforced until a license is activated.',
  },
  {
    // "Require SSO" is not enforced.
    pattern:
      /Require SSO(?: for login)?["”»“」]?(?:\*\*)?\s+(?:is|are)\s+(?:no longer|not)\s+enforced/i,
    needsLicenseContext: true,
    example:
      'After the trial (or 30 days after a license expires), SSO, OIDC, SCIM and audit logging stop, "Require SSO" is no longer enforced and enterprise configuration becomes read-only, until a license is activated.',
  },
  {
    // Single sign-on is (part of) the Enterprise Edition.
    pattern: new RegExp(
      `\\b${LIST_NAMING_SSO}(?:\\*\\*)?\\s+(?:is|are)\\s+(?:part of|a|an|only available (?:on|in)${SAME_SUBJECT}{0,40}?)\\s+(?:the\\s+)?(?:\\*\\*)?(?:OneUptime\\s+)?Enterprise Edition`,
      "i",
    ),
    needsLicenseContext: false,
    example:
      "Global SSO is a **OneUptime Enterprise Edition** feature and is only available on instances running the Enterprise Edition build.",
  },
  {
    // Single sign-on needs the Enterprise Edition or an Enterprise license.
    pattern: new RegExp(
      `\\b${LIST_NAMING_SSO}${SAME_SUBJECT}{0,60}?\\b(?:needs?|requires?)\\s+(?:the\\s+|an?\\s+)?(?:OneUptime\\s+)?Enterprise (?:Edition|license)`,
      "i",
    ),
    needsLicenseContext: false,
    example:
      "Self-hosted SSO/SAML and audit logs need the Enterprise Edition and an Enterprise license.",
  },
  {
    // The enterprise features, listed with single sign-on among them.
    pattern: new RegExp(
      `\\benterprise (?:features|modules)\\b[^.;]{0,80}?[(:]\\s*(?:${FEATURE}${ASIDE}${LIST_SEPARATOR})*${SSO_NAME}`,
      "i",
    ),
    needsLicenseContext: false,
    example:
      "They add the enterprise features (SSO/SAML, OIDC, SCIM, audit logs, team compliance, instance health dashboards), licensed under the OneUptime Enterprise License.",
  },
];

/*
 * The other sentences the single sign-on patterns were written for, as they
 * were published (docs, Helm chart, README, edition dialog, email, locales).
 */
const FORMERLY_PUBLISHED_SSO_CLAIMS: Array<string> = [
  "After that, **SSO, OIDC, SCIM and audit logging stop** until a license is activated, the same as on the Community Edition.",
  'After the trial, SSO and OIDC sign-in stop, "Require SSO for login" is no longer enforced (users sign in with their password), SCIM provisioning stops and audit logging stops recording.',
  "> **Edition:** SSO is part of the OneUptime Enterprise Edition.",
  'Without a valid license (after the 14-day trial, or 30 days after a license expires), global SSO sign-in stops and instance-wide "Require SSO" is not enforced until a license is activated.',
  'After the trial (or 30 days after a license expires), until a license is activated, SSO, OIDC, SCIM and audit logging stop: SSO sign-in is refused and "Require SSO" is no longer enforced (users sign in with their password), your identity provider\'s SCIM requests are refused, and audit logging stops recording.',
  'Without a valid license (after the 30-day grace period), single sign-on (SAML and OIDC) stops and "Require SSO" is no longer enforced, so users sign in with their password.',
  "When the grace period ends, until a renewed license is activated: SSO and OIDC sign-in stop and &quot;Require SSO&quot; is no longer enforced, so your users sign in with their password.",
  "Everything in the Community Edition plus the enterprise features (SSO/SAML, OIDC, SCIM, audit logs, team compliance, instance health dashboards), licensed under the OneUptime Enterprise License.",
  "The **Enterprise Edition** adds the enterprise modules from the repository's `ee/` directory: SAML SSO, OIDC, SCIM, team compliance, audit logs and the enterprise Health dashboards in the Admin Dashboard.",
  "Single sign-on (SSO) is not available on this server: it needs the OneUptime Enterprise Edition with an active license.",
  "Without a valid Enterprise license this configuration is read-only and sign-in through these providers is off, but disabling a provider is always allowed, because it can only tighten security.",
  "Sign-in through this provider is off while the Enterprise license is missing or expired, and resumes as soon as a license is activated.",
  "Single sign-on is part of the OneUptime Enterprise Edition; on a Community Edition server, sign in with your email and password instead.",
];

/*
 * Accurate copy about single sign-on, including sentences that name it next
 * to what does stop. None may be flagged.
 */
const ACCURATE_SSO_COPY: Array<string> = [
  '> **Edition:** SSO, including "Require SSO for login", is part of every OneUptime edition: self-hosted installations get it in the Community Edition, with no license needed.',
  "On OneUptime Cloud it is available on the **Scale** plan and above.",
  'Single sign-on is not an enterprise feature: SAML and OIDC sign-in, global SSO and "Require SSO for login" work the same in every license state.',
  "After that, **SCIM and audit logging stop** until a license is activated, the same as on the Community Edition, and enterprise configuration becomes read-only.",
  "On a self-hosted installation, SSO and OIDC are part of every edition, and SCIM needs the [Enterprise Edition](/docs/self-hosted/enterprise).",
  "The **Enterprise Edition** adds the enterprise modules from the repository's `ee/` directory: SCIM, team compliance, audit logs and the enterprise Health dashboards in the Admin Dashboard.",
  "They add the enterprise features (SCIM, audit logs, team compliance, instance health dashboards), licensed under the OneUptime Enterprise License.",
  'Single sign-on (SAML, OIDC and "Require SSO for login") is part of both editions and does not depend on the license.',
  "OneUptime Cloud runs the Enterprise Edition, and your plan still decides which features you get: SSO, OIDC, SCIM and team compliance on the Scale plan and above, and audit logs on the Enterprise plan.",
  "The SSO and OIDC endpoints (SAML sign-in and ACS URLs, OIDC redirect URIs, and the global SSO endpoints) keep their exact paths and are served by both editions in every license state.",
  // Not about the license: a status page with no provider says so.
  "Single sign-on is not available for this status page. Sign in with your email and password instead.",
  // Dated to the releases where it was true, as the license expiry email says it.
  "On OneUptime 14.0.10 and earlier, SSO and OIDC sign-in stop too and &quot;Require SSO&quot; is no longer enforced, so your users sign in with their password.",
];

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

function retiredSsoClaimsIn(sentence: string): Array<string> {
  if (DATED_TO_OLD_RELEASES.test(sentence)) {
    return [];
  }

  return RETIRED_SSO_CLAIMS.filter((claim: RetiredSsoClaim) => {
    return (
      claim.pattern.test(sentence) &&
      (!claim.needsLicenseContext || LICENSE_CONTEXT.test(sentence))
    );
  }).map((claim: RetiredSsoClaim) => {
    return claim.pattern.source;
  });
}

// A version section of the upgrade notes: "## Upgrading from OneUptime 13 → 14".
const VERSION_SECTION_HEADING: RegExp = /^## \D*\d+\D{1,24}\d+\b/;

function ssoViolationsIn(label: string, text: string): Array<string> {
  const violations: Array<string> = [];

  for (const sentence of sentencesOf(text)) {
    if (retiredSsoClaimsIn(sentence).length > 0) {
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

  it.each(NOW_ACCURATE_SSO_COPY)(
    "leaves alone what became true of single sign-on: %s",
    (sentence: string) => {
      expect(violationsIn("copy", sentence)).toEqual([]);
      expect(ssoViolationsIn("copy", sentence)).toEqual([]);
    },
  );

  it("does not exempt a sentence about an unreadable license state that also claims SCIM survives a lapse", () => {
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

describe("no doc, Helm text, README, template or UI string claims SCIM or audit logging survive a lapse", () => {
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

describe("the retired single sign-on license claims", () => {
  it.each(RETIRED_SSO_CLAIMS)("catches: $example", (claim: RetiredSsoClaim) => {
    expect(claim.pattern.test(claim.example)).toBe(true);
    expect(retiredSsoClaimsIn(claim.example)).toContain(claim.pattern.source);
  });

  it.each(FORMERLY_PUBLISHED_SSO_CLAIMS)("catches: %s", (sentence: string) => {
    expect(ssoViolationsIn("example", sentence).length).toBeGreaterThan(0);
  });

  it.each(ACCURATE_SSO_COPY)("leaves alone: %s", (sentence: string) => {
    expect(ssoViolationsIn("copy", sentence)).toEqual([]);
  });

  it("dates a claim to 14.0.10 and earlier only when the sentence says so", () => {
    const claim: string =
      'SSO and OIDC sign-in stop too and "Require SSO" is no longer enforced once the license lapses.';

    expect(ssoViolationsIn("copy", claim).length).toBeGreaterThan(0);
    expect(
      ssoViolationsIn("copy", `On OneUptime 14.0.10 and earlier, ${claim}`),
    ).toEqual([]);
    // Another version is not the one single sign-on left the Enterprise Edition after.
    expect(
      ssoViolationsIn("copy", `On OneUptime 14.0.100 and earlier, ${claim}`)
        .length,
    ).toBeGreaterThan(0);
  });

  it("reads the upgrade notes of released versions like any other text", () => {
    const claim: string =
      "After the trial, SSO and OIDC sign-in stop until a license is activated.";
    const upgrading: string = [
      "# Upgrading OneUptime",
      "",
      "## Community and Enterprise Edition images",
      "",
      "Single sign-on is in both editions.",
      "",
      "## Upgrading from OneUptime 13 → 14",
      "",
      claim,
    ].join("\n");

    // A version section is not history that may keep the claim.
    expect(
      ssoViolationsIn(
        path.join("Content", "de", "installation", "upgrading.md"),
        upgrading,
      ),
    ).toEqual([expect.stringContaining(claim)]);

    const upgradeNotes: string = [
      "## Upgrade notes",
      "",
      `- **14.0.0 (2026-09-21)** — ${claim}`,
    ].join("\n");

    // Nor is an entry with a released title.
    expect(
      ssoViolationsIn(
        path.join("oneuptime", "docs", "upgrade-notes.md"),
        upgradeNotes,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("catches the claim when it is added back to a page that is clean today", () => {
    const relativePath: string =
      "packages/App/FeatureSet/Docs/Content/en/identity/sso.md";
    const page: string = readFile(fromRepository(relativePath));

    expect(ssoViolationsIn(relativePath, page)).toEqual([]);
    expect(
      ssoViolationsIn(
        relativePath,
        `${page}\nWithout a valid license (after the 14-day trial, or 30 days after a license expires), SSO sign-in stops.\n`,
      ).length,
    ).toBeGreaterThan(0);
  });
});

describe("no doc, Helm text, README, template or UI string says single sign-on stops with the license or needs the Enterprise Edition", () => {
  /*
   * The upgrade notes used to be read only down to their first version
   * section: the 13 -> 14 and 10 -> 11 notes kept "single sign-on needs the
   * Enterprise Edition" as history. They are read to the end now, in every
   * language, so a claim in the oldest version section is caught too.
   */
  it("reads every language's upgrade notes to the last version section", () => {
    const claim: string =
      "After the trial, SSO and OIDC sign-in stop until a license is activated.";
    const upgradingPages: Array<string> = scannedFiles().filter(
      (file: string) => {
        return file.endsWith(path.join("installation", "upgrading.md"));
      },
    );

    expect(upgradingPages).toHaveLength(17);

    for (const file of upgradingPages) {
      const relativePath: string = path.relative(REPOSITORY_ROOT, file);
      const text: string = readFile(file);

      // The page has version sections, and the scan reaches below the last one.
      expect({
        file: relativePath,
        hasVersionSections: text.split("\n").some((line: string) => {
          return VERSION_SECTION_HEADING.test(line);
        }),
      }).toEqual({ file: relativePath, hasVersionSections: true });
      expect(ssoViolationsIn(relativePath, `${text}\n\n${claim}\n`)).toEqual([
        expect.stringContaining(claim),
      ]);
    }
  });

  it("finds none", () => {
    const violations: Array<string> = [];

    for (const file of scannedFiles()) {
      violations.push(
        ...ssoViolationsIn(
          path.relative(REPOSITORY_ROOT, file),
          readFile(file),
        ),
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
    const sentences: Array<string> = sentencesOf(
      readFile(fromRepository("config.example.env")),
    );
    const example: string = sentences.join(" ");

    expect(example).toContain(
      `After the trial (or ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after a license expires), SCIM and audit logging stop`,
    );
    expect(example).toContain("until a license is activated");
    expect(example).toContain("Single sign-on does not depend on the license");

    // What stops after the trial names no single sign-on.
    const afterTheTrial: Array<string> = sentences.filter(
      (sentence: string) => {
        return sentence.includes("After the trial");
      },
    );

    expect(afterTheTrial.length).toBeGreaterThan(0);

    for (const sentence of afterTheTrial) {
      expect(sentence).not.toMatch(/SSO|single sign-on|OIDC|SAML/i);
    }

    expect(example).not.toContain("Require SSO");
  });

  it("the license expiry reminder email says when the grace period ends and what stops then", () => {
    const sentences: Array<string> = sentencesOf(
      readFile(
        path.join(
          PACKAGES_ROOT,
          "App/FeatureSet/Notification/Templates/EnterpriseLicenseExpiryReminder.hbs",
        ),
      ),
    );
    const template: string = sentences.join(" ");

    for (const expected of [
      `keep every enterprise feature for ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after the expiry date above (the grace period)`,
      "When the grace period ends, until a renewed license is activated",
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

    /*
     * oneuptime.com sends this email to installs on any version. Single sign-on
     * stops with the license only on 14.0.10 and earlier, so every sentence
     * that says it stops says so, and one does.
     */
    const ssoSentences: Array<string> = sentences.filter((sentence: string) => {
      return NAMES_SINGLE_SIGN_ON.test(sentence);
    });

    expect(ssoSentences.length).toBeGreaterThan(0);

    for (const sentence of ssoSentences) {
      expect({
        sentence: sentence,
        dated: sentence.includes("14.0.10"),
      }).toEqual({ sentence: sentence, dated: true });
    }
  });
});
