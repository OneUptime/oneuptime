import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  getLocalizedNav,
  localizeDocsUrl,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
  RETIRED_ENTERPRISE_FEATURE_VALUES,
} from "Common/Server/Enterprise/EnterpriseFeature";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Community / Enterprise Edition docs against the product they describe.
 *
 * The in-app upsell cards link to /docs/self-hosted/enterprise, which used to
 * 404. These tests keep that page reachable, keep its feature matrix in step
 * with the EnterpriseFeature enum, and keep the facts it repeats (grace
 * period, Helm value, compose tag, environment variables) tied to the files
 * that define them. They also pin the upgrade notes: the new edition-split
 * section must exist in every locale, and the old "sign-in through them is
 * disabled after the upgrade" claim, which was never true on a Community
 * build, must not come back.
 *
 * The public wording is pinned too: no docs page or docs UI string may call
 * OneUptime 100% (or fully) open source in any language, the Helm chart's
 * upgrade notes carry the edition split, and the chart says that production
 * use of the Enterprise Edition needs a subscription while the 14-day trial is
 * for evaluation. The trial (14 days, an install with no license) and the
 * grace period (30 days after a license expires) are different lengths, and
 * every page states each with the constant the license classifier uses.
 *
 * And what a lapse does: after the trial or the grace period SCIM and audit
 * logging stop (the owner's decision; they used to keep running), enterprise
 * configuration becomes read-only, and everything resumes with a license. The
 * page, the upgrade notes in every language and the Helm chart say so.
 * LicenseLapseClaims.test.ts rejects the old promise wherever it could
 * reappear.
 *
 * Single sign-on is not part of that. SAML and OIDC sign-in, global SSO and
 * "Require SSO for login" are in the Community Edition (from the first release
 * after 14.0.10; in 14.0.0 to 14.0.10 they were Enterprise features that
 * stopped with the license). The feature matrix, the identity pages in every
 * language, the edition section of the upgrade notes and the Helm chart say
 * so, and none of them may still tie single sign-on to the license. The
 * upgrade notes for 14.0.0 to 14.0.10 stay as history, under a note that says
 * which of their single sign-on statements no longer apply.
 */

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_ROOT: string = path.resolve(PACKAGES_ROOT, "..");
const CONTENT_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content",
);
const DOCS_LOCALES_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Locales",
);

const PAGE_TITLE: string = "Enterprise Edition";
const PAGE_RELATIVE_PATH: string = "self-hosted/enterprise";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;

const UPSELL_SOURCE_FILES: Array<string> = [
  "App/FeatureSet/Dashboard/src/Components/EnterpriseEdition/EnterpriseFeatureUpgrade.tsx",
  "App/FeatureSet/AdminDashboard/src/Components/EnterpriseEdition/EnterpriseFeatureUpgrade.tsx",
];

const OLD_V11_CLAIM: string =
  "sign-in through them is disabled after the upgrade";

const EDITION_SECTION_HEADING: string =
  "## Community and Enterprise Edition images";

/*
 * A major-version section, in any language: "## Upgrading from OneUptime
 * 13 → 14", "## 从 OneUptime 13 升级到 14", ... The two version numbers are
 * captured so the assertion can check they are consecutive, rather than
 * naming the release: this file is edited on every major bump otherwise, and
 * the thing worth pinning is that the newest hop sits directly below the
 * edition section, not which hop it is.
 */
const VERSION_SECTION_HEADING_PATTERN: RegExp = /^## \D*(\d+)\D{1,24}(\d+)\b/;

// The v10 -> v11 section's heading, in any language.
const V10_TO_V11_HEADING: RegExp = /^## \D*10\D{1,24}11\b/;

const DOCS_LINK_PATTERN: RegExp = /\]\((\/docs\/[^)\s]+)\)/g;

const DOCS_PREFIX_PATTERN: RegExp = /^\/docs\//;

const ONEUPTIME_DOCS_URL_PATTERN: RegExp =
  /https:\/\/oneuptime\.com\/docs\/([a-z0-9-]+)\/([a-z0-9-]+)/g;

const HEADING_PATTERN: RegExp = /^#{1,6}\s+(.+?)\s*$/;

const FENCE_PATTERN: RegExp = /^\s*```/;

/*
 * The phrase in the feature matrix that stands for each licensable feature.
 * A Record over the enum, so adding a feature without a matrix row fails to
 * compile rather than shipping an incomplete comparison.
 */
const MATRIX_ROW_FOR_FEATURE: Record<EnterpriseFeature, string> = {
  [EnterpriseFeature.SCIM]: "SCIM provisioning",
  [EnterpriseFeature.TeamCompliance]: "Team compliance settings",
  [EnterpriseFeature.AuditLogs]: "Audit logs",
  [EnterpriseFeature.InstanceHealth]: "Admin **Health** dashboards",
  [EnterpriseFeature.TelemetryRetention]: "Retention overrides",
};

/*
 * The matrix rows for single sign-on, which is in both editions (the retired
 * "sso" license claim names nothing), with what OneUptime Cloud offers: SSO
 * and OIDC on the Scale plan, and global SSO nowhere, because OneUptime
 * operates that instance.
 */
// Any name the docs give single sign-on.
const SINGLE_SIGN_ON_WORDS: RegExp = /SSO|single sign-on|SAML|OpenID|OIDC/i;

const SSO_MATRIX_ROWS: Array<{ phrase: string; cloud: string }> = [
  {
    phrase:
      "[SAML SSO and OpenID Connect](/docs/identity/sso) for project sign-in",
    cloud: "Scale plan and above",
  },
  {
    phrase: "SAML SSO and OpenID Connect for private status page sign-in",
    cloud: "Scale plan and above",
  },
  {
    phrase: "[Global (instance-wide) SSO and OIDC](/docs/identity/global-sso)",
    cloud: "Not applicable",
  },
];

/*
 * Wording that ties single sign-on to the license or to the Enterprise
 * Edition, for the texts that describe the editions as they are now (the
 * Enterprise Edition page, the edition section of the upgrade notes, the Helm
 * chart). LicenseLapseClaims.test.ts scans every other text for the same
 * claims.
 */
const SSO_LICENSE_WORDING: Array<RegExp> = [
  /\b(?:SSO|OIDC|single sign-on)(?:,? (?:and |or )?(?:SSO|OIDC|SCIM|audit logging))*(?: sign-in| enforcement)? (?:stops?|stop|(?:is|are) refused|(?:is|are) off)\b/i,
  /Require SSO(?: for login)?"?\*{0,2} (?:is|are) (?:no longer|not) enforced/i,
  /\b(?:SSO|single sign-on)\b[^.]{0,40}\b(?:is|are) (?:part of|a|an) (?:the )?\**(?:OneUptime )?Enterprise Edition/i,
];

function ssoLicenseWordingIn(text: string): Array<string> {
  return SSO_LICENSE_WORDING.filter((pattern: RegExp) => {
    return pattern.test(text);
  }).map((pattern: RegExp) => {
    return pattern.source;
  });
}

function readContent(lang: string, relativePath: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${relativePath}.md`),
    "utf8",
  );
}

function readPage(): string {
  return readContent("en", PAGE_RELATIVE_PATH);
}

function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_PATTERN.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(HEADING_PATTERN);

    if (match) {
      slugs.add(slugify(match[1]!));
    }
  }

  return slugs;
}

function docsLinks(markdown: string): Array<string> {
  return Array.from(
    markdown.matchAll(DOCS_LINK_PATTERN),
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

/*
 * A /docs/<category>/<page>[#anchor] link resolves when the English page
 * exists (the docs server falls back to English for every language) and,
 * with an anchor, when a heading on that page slugifies to it.
 */
function unresolvedDocsLinks(markdown: string): Array<string> {
  const unresolved: Array<string> = [];

  for (const link of docsLinks(markdown)) {
    const parts: Array<string> = link.split("#");
    const pathPart: string = parts[0]!;
    const anchor: string | undefined = parts[1];
    const relativePath: string = pathPart.replace(DOCS_PREFIX_PATTERN, "");
    const file: string = path.join(CONTENT_DIR, "en", `${relativePath}.md`);

    if (!fs.existsSync(file)) {
      unresolved.push(link);
      continue;
    }

    if (anchor && !headingSlugs(fs.readFileSync(file, "utf8")).has(anchor)) {
      unresolved.push(link);
    }
  }

  return unresolved;
}

function findNavLink(url: string): { group: NavGroup; link: NavLink } | null {
  for (const group of DocsNav) {
    for (const link of group.links) {
      if (link.url === url) {
        return { group: group, link: link };
      }
    }
  }

  return null;
}

// Absolute links to the docs, as the Helm chart's markdown writes them.
const ABSOLUTE_DOCS_LINK_PATTERN: RegExp =
  /https:\/\/oneuptime\.com(\/docs\/[a-z0-9-]+\/[a-z0-9-]+(?:#[a-z0-9-]+)?)/g;

const DOCS_VIEWS_DIR: string = path.join(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Views",
);

const HELM_CHART_DIR: string = path.join(
  REPOSITORY_ROOT,
  "HelmChart/Public/oneuptime",
);

/*
 * Retired "100% open source" language, in every docs language.
 *
 * The Community Edition is open source (Apache 2.0), but the Enterprise
 * Edition modules in ee/ are licensed under the OneUptime Enterprise License,
 * so "OneUptime is 100% open source" (or "fully open source") is false. The
 * marketing site keeps the full list of retired edition claims in
 * packages/Home/Utils/Claims.ts (RetiredEditionClaims). packages/App cannot
 * import packages/Home, so this is a minimal copy of the ones the docs could
 * repeat, widened to the 17 docs languages. Add a pattern there and here
 * together.
 */
const OPEN_SOURCE_WORDS: string = [
  "open[- ]?source",
  "código\\s+abierto",
  "código\\s+aberto",
  "åpen\\s+kildekode",
  "öppen\\s+källkod",
  "オープンソース",
  "오픈\\s*소스",
  "开源",
  "開源",
  "開放原始碼",
  "открыт\\S*\\s+исходн\\S*\\s+код",
  "ओपन[- ]?सोर्स",
  "متن[\u200c\\s]?باز",
].join("|");

// "100%", "100 %", Persian digits and percent sign, full-width percent sign.
const ONE_HUNDRED_PERCENT: string = "(?:100|۱۰۰)\\s*[%٪％]";

/*
 * Adverbs only ("fully", "vollständig", "完全に"): the adjective ("the
 * complete open-source platform", "vollständige", "完全な") describes the
 * product's scope, not its license.
 */
const FULLY_WORDS: string = [
  "fully",
  "completely",
  "entirely",
  "vollständig\\b",
  "completamente",
  "totalmente",
  "entièrement",
  "complètement",
  "interamente",
  "volledig\\b",
  "fuldt",
  "fullt",
  "helt\\b",
  "полностью",
  "完全(?!な)",
  "완전히",
  "पूरी\\s+तरह",
  "کاملاً",
].join("|");

// Stays inside one sentence, in scripts that end one with 。 or ！ too.
const SAME_SENTENCE: string = "[^.。!?！？]";

interface RetiredDocsClaim {
  pattern: RegExp;
  example: string;
}

const RETIRED_DOCS_CLAIMS: Array<RetiredDocsClaim> = [
  {
    pattern: new RegExp(
      `${ONE_HUNDRED_PERCENT}${SAME_SENTENCE}{0,40}(?:${OPEN_SOURCE_WORDS})`,
      "iu",
    ),
    example: "100% open source",
  },
  {
    pattern: new RegExp(
      `(?:${OPEN_SOURCE_WORDS})${SAME_SENTENCE}{0,20}${ONE_HUNDRED_PERCENT}`,
      "iu",
    ),
    example: "open source al 100%",
  },
  {
    pattern: new RegExp(
      `(?:${FULLY_WORDS})${SAME_SENTENCE}{0,12}(?:${OPEN_SOURCE_WORDS})`,
      "iu",
    ),
    example: "fully open source",
  },
  {
    pattern: /\bnot\s+open[- ]core\b/i,
    example: "not open-core",
  },
  {
    pattern:
      /\b(?:entire|whole)\s+(?:platform|thing)\s+is\s+(?:Apache|open[- ]source)/i,
    example: "the entire platform is Apache-2.0 open source",
  },
];

/*
 * The docs strings the retired patterns were written for, as they stood in
 * every docs language before the edition split ("helpImproveBody", shown on
 * every docs page). Each must still be caught.
 */
const FORMERLY_PUBLISHED_DOCS_CLAIMS: Array<string> = [
  "OneUptime er 100 % open source. Fundet en tastefejl, eller vil du tilføje noget?",
  "OneUptime ist zu 100 % Open Source. Tippfehler gefunden oder möchten Sie etwas hinzufügen?",
  "OneUptime is 100% open-source. Found a typo or want to add something?",
  "OneUptime es 100 % de código abierto. ¿Encontraste un error tipográfico o quieres añadir algo?",
  "OneUptime کاملاً متن\u200cباز است.",
  "OneUptime est 100 % open source. Trouvé une faute de frappe ou envie d'ajouter quelque chose ?",
  "OneUptime 100% ओपन-सोर्स है।",
  "OneUptime è open source al 100%. Hai trovato un errore di battitura o vuoi aggiungere qualcosa?",
  "OneUptime は 100% オープンソースです。",
  "OneUptime은 100% 오픈 소스입니다.",
  "OneUptime is 100% open source. Een typfout gevonden of wilt u iets toevoegen?",
  "OneUptime er 100 % åpen kildekode. Fant du en skrivefeil eller vil legge til noe?",
  "O OneUptime é 100% código aberto. Encontrou um erro de digitação ou deseja adicionar algo?",
  "OneUptime — это 100% открытый исходный код.",
  "OneUptime är 100 % öppen källkod. Hittade du ett stavfel eller vill lägga till något?",
  "OneUptime 是 100% 开源的。",
  "OneUptime 是 100% 開放原始碼。",
  "We're fully open-source, not open-core.",
];

/*
 * Accurate or unrelated docs copy the patterns must leave alone, so nobody
 * narrows true text to get past them.
 */
const ACCURATE_DOCS_COPY: Array<string> = [
  "OneUptime is open source. Found a typo or want to add something?",
  "OneUptime — проект с открытым исходным кодом.",
  "OneUptime: The Complete Open-Source Observability Platform",
  "OneUptime: Die vollständige Open-Source-Observability-Plattform",
  "完全なドキュメント — オープンソース",
  "Without the guard, that condition silently deletes **100% of** `/var/log/syslog`.",
  "CPU percentage (0–100%), disk usage, queue capacity.",
  "Keycloak is a popular open-source identity and access management solution.",
];

function retiredDocsClaimsIn(text: string): Array<string> {
  return RETIRED_DOCS_CLAIMS.filter((retired: RetiredDocsClaim) => {
    return retired.pattern.test(text);
  }).map((retired: RetiredDocsClaim) => {
    return retired.example;
  });
}

function filesUnder(
  directory: string,
  extensions: Array<string>,
): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...filesUnder(fullPath, extensions));
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

// Whitespace-normalized, so a check does not depend on where a line wraps.
function normalized(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/*
 * The text between `start` and the next `end` after it. Throws, naming the
 * marker, when the document no longer has it, so a restructured file fails
 * with a message rather than a TypeError.
 */
function sectionBetween(text: string, start: string, end: string): string {
  const startIndex: number = text.indexOf(start);

  if (startIndex === -1) {
    throw new Error(`Marker not found: ${start}`);
  }

  const rest: string = text.slice(startIndex + start.length);
  const endIndex: number = rest.indexOf(end);

  return endIndex === -1 ? rest : rest.slice(0, endIndex);
}

function readHelmChartFile(relativePath: string): string {
  return fs.readFileSync(path.join(HELM_CHART_DIR, relativePath), "utf8");
}

/*
 * A released entry's title: "- **14.0.0 (2026-09-21)** — ...". An entry still
 * waiting for a release is titled "- **Unreleased (after <version>)**" and
 * does not match.
 */
const HELM_RELEASED_ENTRY_TITLE_PATTERN: RegExp =
  /^- \*\*\d+\.\d+\.\d+ \(\d{4}-\d{2}-\d{2}\)\*\*/;

// An entry that has not shipped yet: "- **Unreleased (after 14.0.10)** — ...".
const HELM_UNRELEASED_ENTRY_TITLE_PATTERN: RegExp =
  /^- \*\*Unreleased \(after \d+\.\d+\.\d+\)\*\*/;

// The entry for the Community / Enterprise split, which shipped in 14.0.0.
const HELM_SPLIT_ENTRY_TITLE: string = "- **14.0.0 (2026-09-21)**";

// The entry that puts single sign-on back in the Community Edition.
const HELM_SSO_ENTRY_MARKER: string =
  "Single sign-on is part of the Community Edition again.";

// The chart's upgrade-notes entries, newest first, one string per "- **" item.
function helmUpgradeNoteEntries(): Array<string> {
  const section: string = sectionBetween(
    readHelmChartFile("docs/upgrade-notes.md"),
    "\n## Upgrade notes\n",
    "\n## ",
  );

  return section
    .split(/^- \*\*/m)
    .slice(1)
    .map((entry: string) => {
      return `- **${entry}`;
    });
}

interface HelmEditionText {
  source: string;
  text: string;
}

// Where the chart describes image.type and what the Enterprise Edition needs.
function helmEditionTexts(): Array<HelmEditionText> {
  const schema: {
    properties: {
      image: { properties: { type: { description: string } } };
    };
  } = JSON.parse(readHelmChartFile("values.schema.json"));

  const imageTypeRow: string | undefined = readHelmChartFile(
    "docs/configuration.md",
  )
    .split("\n")
    .find((line: string) => {
      return line.startsWith("| `image.type`");
    });

  return [
    {
      source: "values.yaml",
      text: sectionBetween(
        readHelmChartFile("values.yaml"),
        "## Which edition of the OneUptime images to run.",
        "type: community-edition",
      ).replace(/^\s*##/gm, ""),
    },
    {
      source: "README.md",
      text: sectionBetween(
        readHelmChartFile("README.md"),
        "## Community vs. Enterprise",
        "\n## ",
      ),
    },
    {
      source: "docs/configuration.md",
      text: imageTypeRow || "",
    },
    {
      source: "values.schema.json",
      text: schema.properties.image.properties.type.description,
    },
  ];
}

/*
 * Every length an English licensing text states for the trial or the grace
 * period, checked against the constants: "N-day trial" must be the trial,
 * and "N days after a license expires" / "N-day grace period" the grace
 * period. Used on the Helm texts and the Enterprise Edition page here;
 * LicensePeriodClaims.test.ts scans every other licensing text the same way.
 */
/*
 * The day counts a sentence states, in order, with Persian digits read as
 * their values: "(after the 14-day trial, or 30 days after a license
 * expires)" in any language gives [14, 30].
 */
function statedDayCounts(text: string): Array<number> {
  const western: string = text.replace(/[۰-۹]/g, (digit: string) => {
    return String(digit.charCodeAt(0) - "۰".charCodeAt(0));
  });

  return Array.from(
    western.matchAll(/(?<![\d.])\d+(?![\d.])/g),
    (match: RegExpMatchArray) => {
      return Number(match[0]);
    },
  );
}

function licensePeriodLengthProblems(text: string): Array<string> {
  const problems: Array<string> = [];

  for (const match of text.matchAll(/\b(\d+)-day trial\b/g)) {
    if (Number(match[1]) !== ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS) {
      problems.push(`wrong trial length: ${match[0]}`);
    }
  }

  for (const match of text.matchAll(
    /\b(\d+)(?: days after a license expires|-day grace period)\b/g,
  )) {
    if (Number(match[1]) !== ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS) {
      problems.push(`wrong grace length: ${match[0]}`);
    }
  }

  return problems;
}

/*
 * What is wrong with a description of the Enterprise Edition's licensing: it
 * must say production use needs a subscription, that the first 14 days are
 * an evaluation trial, that the same happens 30 days after a license expires,
 * that SCIM and audit logging stop after it until a license is activated, and
 * that single sign-on does not depend on the license. It must not describe
 * the license only as a switch for configuration, promise that SCIM and audit
 * logging keep running, say that single sign-on stops or is not enforced,
 * call the unlicensed first 14 days a grace period (the grace period is the
 * 30 days after a license expires), or state either period with another
 * length.
 */
// The sentence each Helm text needs about single sign-on.
const SSO_INDEPENDENT_OF_LICENSE: RegExp =
  /single sign-on[^.;]*does not depend on the license/i;

function helmLicensingWordingProblems(text: string): Array<string> {
  const flat: string = normalized(text);
  const problems: Array<string> = [];

  for (const required of [
    "Production use of the Enterprise Edition requires a subscription",
    `${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial`,
    `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after a license expires`,
    "for evaluation",
    "SCIM and audit logging stop",
    "until a license is activated",
    "core monitoring is never affected",
  ]) {
    if (!flat.includes(required)) {
      problems.push(`missing: ${required}`);
    }
  }

  if (!SSO_INDEPENDENT_OF_LICENSE.test(flat)) {
    problems.push("missing: single sign-on does not depend on the license");
  }

  for (const forbidden of [
    /\bgrace period\b/i,
    /configuring them needs a valid license/i,
    /need a valid license to configure them/i,
    /keeps? (?:running|working)/i,
    /never stop/i,
    ...SSO_LICENSE_WORDING,
    // The enterprise feature list that still named single sign-on.
    /enterprise features \((?:SSO|SAML|OIDC)/i,
  ]) {
    if (forbidden.test(flat)) {
      problems.push(`retired wording: ${forbidden.source}`);
    }
  }

  problems.push(...licensePeriodLengthProblems(flat));

  return problems;
}

/*
 * Links written as https://oneuptime.com/docs/<category>/<page>[#anchor],
 * rewritten to the /docs/... form unresolvedDocsLinks() checks.
 */
function absoluteDocsLinksAsRelative(markdown: string): string {
  return Array.from(
    markdown.matchAll(ABSOLUTE_DOCS_LINK_PATTERN),
    (match: RegExpMatchArray) => {
      return `[link](${match[1]!})`;
    },
  ).join(" ");
}

describe("Enterprise Edition docs page", () => {
  it("is linked from the Self Hosted nav group", () => {
    const found: { group: NavGroup; link: NavLink } | null =
      findNavLink(PAGE_URL);

    expect(found).not.toBeNull();
    expect(found!.group.title).toBe("Self Hosted");
    expect(found!.link.title).toBe(PAGE_TITLE);
  });

  it("exists in English under the linked path, titled as linked", () => {
    expect(readPage().split("\n")[0]).toBe(`# ${PAGE_TITLE}`);
  });

  it("is the only nav entry the docs router can match for its path", () => {
    /*
     * The router picks the nav entry whose url CONTAINS the requested
     * category/page, so a second url containing this path would steal it.
     */
    const matches: Array<NavLink> = DocsNav.flatMap((group: NavGroup) => {
      return group.links;
    }).filter((link: NavLink) => {
      return link.url.toLowerCase().includes(PAGE_RELATIVE_PATH);
    });

    expect(matches).toHaveLength(1);
  });

  it("serves the link the in-app upsell cards point at", () => {
    const upsellPaths: Set<string> = new Set<string>();

    for (const file of UPSELL_SOURCE_FILES) {
      const source: string = fs.readFileSync(
        path.join(PACKAGES_ROOT, file),
        "utf8",
      );

      for (const match of source.matchAll(ONEUPTIME_DOCS_URL_PATTERN)) {
        upsellPaths.add(`${match[1]}/${match[2]}`);
      }
    }

    expect(Array.from(upsellPaths)).toContain(PAGE_RELATIVE_PATH);

    for (const upsellPath of upsellPaths) {
      expect({
        upsellPath: upsellPath,
        exists: fs.existsSync(path.join(CONTENT_DIR, "en", `${upsellPath}.md`)),
        navLinked: findNavLink(`/docs/${upsellPath}`) !== null,
      }).toEqual({ upsellPath: upsellPath, exists: true, navLinked: true });
    }
  });

  it("has a Docs nav translation in every supported language", () => {
    for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
      const locale: { navLinks: Record<string, string> } = JSON.parse(
        fs.readFileSync(path.join(DOCS_LOCALES_DIR, `${lang}.json`), "utf8"),
      );

      expect({ lang: lang, title: locale.navLinks[PAGE_TITLE] }).toEqual({
        lang: lang,
        title: expect.any(String),
      });
      expect(locale.navLinks[PAGE_TITLE]!.trim().length).toBeGreaterThan(0);

      const localizedUrls: Array<string> = getLocalizedNav(lang).flatMap(
        (group: { links: Array<{ url: string }> }) => {
          return group.links.map((link: { url: string }) => {
            return link.url;
          });
        },
      );

      expect(localizedUrls).toContain(localizeDocsUrl(PAGE_URL, lang));
    }
  });

  it("lists every licensable enterprise feature in the comparison", () => {
    const page: string = readPage();

    expect(ALL_ENTERPRISE_FEATURES.length).toBe(
      Object.keys(MATRIX_ROW_FOR_FEATURE).length,
    );

    for (const feature of ALL_ENTERPRISE_FEATURES) {
      const row: string | undefined = page.split("\n").find((line: string) => {
        return (
          line.startsWith("|") && line.includes(MATRIX_ROW_FOR_FEATURE[feature])
        );
      });

      expect({ feature: feature, row: row }).toEqual({
        feature: feature,
        row: expect.stringContaining("| No | Yes |"),
      });
    }
  });

  it("has no licensable feature for single sign-on, and never reuses its retired claim", () => {
    expect(RETIRED_ENTERPRISE_FEATURE_VALUES).toContain("sso");

    for (const feature of ALL_ENTERPRISE_FEATURES) {
      expect(RETIRED_ENTERPRISE_FEATURE_VALUES).not.toContain(feature);
      expect(MATRIX_ROW_FOR_FEATURE[feature]).not.toMatch(SINGLE_SIGN_ON_WORDS);
    }
  });

  it("puts single sign-on in both editions, and on the Scale plan on OneUptime Cloud", () => {
    const lines: Array<string> = readPage().split("\n");

    for (const ssoRow of SSO_MATRIX_ROWS) {
      const row: string | undefined = lines.find((line: string) => {
        return line.startsWith(`| ${ssoRow.phrase} |`);
      });

      expect({ phrase: ssoRow.phrase, row: row }).toEqual({
        phrase: ssoRow.phrase,
        row: `| ${ssoRow.phrase} | Yes | Yes | ${ssoRow.cloud} |`,
      });
    }

    // No matrix row may still put anything about sign-on in Enterprise only.
    const enterpriseOnlySignOnRows: Array<string> = lines.filter(
      (line: string) => {
        return (
          line.startsWith("|") &&
          SINGLE_SIGN_ON_WORDS.test(line) &&
          line.includes("| No | Yes |")
        );
      },
    );

    expect(enterpriseOnlySignOnRows).toEqual([]);
    expect(normalized(readPage())).toContain(
      'Single sign-on includes "Require SSO for login" for projects, private status pages and the whole instance, in both editions.',
    );
  });

  it("says in its introduction that single sign-on is in the Community Edition, and since when", () => {
    const introduction: string = normalized(
      readPage().split("\n## ")[0]!.replace(/^> ?/gm, ""),
    );

    expect(introduction).toContain(
      "platform, including SAML and OpenID Connect single sign-on, open source under the Apache License 2.0",
    );
    expect(introduction).toContain(
      "Those modules add SCIM provisioning, governance and instance-administration features.",
    );
    expect(introduction).toContain("**Single sign-on is in every edition.**");
    expect(introduction).toContain(
      "releases after 14.0.10 serve them in both editions",
    );
    expect(introduction).not.toContain("identity, governance");
  });

  it("no longer ties single sign-on to the license or the Enterprise Edition anywhere", () => {
    const sentences: Array<string> = normalized(
      readPage().replace(/^> ?/gm, ""),
    )
      .split(/(?<=[.!?])\s+/)
      .filter((sentence: string) => {
        // The one dated sentence about 14.0.0 to 14.0.10 is history.
        return !sentence.includes("14.0.10");
      });

    expect(
      sentences.filter((sentence: string) => {
        return ssoLicenseWordingIn(sentence).length > 0;
      }),
    ).toEqual([]);
  });

  it("keeps ClickHouse capacity and pruning in the Community Edition", () => {
    const row: string | undefined = readPage()
      .split("\n")
      .find((line: string) => {
        return line.includes("ClickHouse capacity view");
      });

    expect(row).toContain("| Yes | Yes |");
  });

  it("states the grace period and trial length the licensing code uses", () => {
    const page: string = normalized(readPage());

    expect(page).toContain(
      `**${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial**`,
    );
    expect(page).toContain(
      `Every enterprise feature keeps working during the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial, and for ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after a license expires (the grace period).`,
    );
    expect(page).toContain(
      `(the first ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS} days of an unlicensed install, or ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after a license expires)`,
    );
    expect(licensePeriodLengthProblems(page)).toEqual([]);
  });

  it("names the Helm value the chart actually reads", () => {
    const values: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "HelmChart/Public/oneuptime/values.yaml"),
      "utf8",
    );
    const helpers: string = fs.readFileSync(
      path.join(
        REPOSITORY_ROOT,
        "HelmChart/Public/oneuptime/templates/_helpers.tpl",
      ),
      "utf8",
    );

    expect(readPage()).toContain("  type: enterprise-edition");
    expect(values).toContain("enterprise-edition");
    // The chart prefixes every tag with "enterprise-", which the page explains.
    expect(helpers).toContain('printf "enterprise-%s" $tag');
    expect(readPage()).toContain("oneuptime/app:enterprise-release");
  });

  it("gives Docker Compose a tag that every compose image uses", () => {
    const compose: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, "docker-compose.yml"),
      "utf8",
    );

    expect(readPage()).toContain("APP_TAG=enterprise-release");
    expect(compose).toContain("oneuptime/app:${APP_TAG}");
  });

  it("only names environment variables the server reads", () => {
    const environmentConfig: string = fs.readFileSync(
      path.join(PACKAGES_ROOT, "Common/Server/EnvironmentConfig.ts"),
      "utf8",
    );

    for (const variable of [
      "IS_ENTERPRISE_EDITION",
      "ONEUPTIME_EDITION",
      "ENTERPRISE_LICENSE_SERVER_URL",
    ]) {
      expect(readPage()).toContain(`\`${variable}`);
      expect(environmentConfig).toContain(`process.env["${variable}"]`);
    }
  });

  it("discloses what the daily license sync sends", () => {
    const page: string = readPage();

    for (const disclosed of [
      "the license key",
      "the instance ID",
      "the OneUptime version",
      "the number of users",
      "**SHA-256 hash** of each user's email address",
      "the email addresses of the install's **master admins**",
      "No monitoring data, telemetry, logs or configuration",
    ]) {
      expect(page).toContain(disclosed);
    }
  });

  it("says what stops when a license lapses, what never does, and that it all resumes", () => {
    const section: string = normalized(
      sectionBetween(
        readPage(),
        "### When a license expires or is missing",
        "\n## ",
      ),
    );

    for (const expected of [
      // What stops, said up front and item by item.
      "After that, **SCIM, audit logging and retention overrides stop** until a license is activated",
      "**SCIM provisioning stops.**",
      "SCIM team locks are lifted",
      "**Audit logging stops recording.**",
      "**Retention overrides stop applying.** New telemetry is kept for the project's default retention.",
      "Telemetry already stored keeps the retention it was written with.",
      "Enterprise configuration becomes **read-only**",
      // The one change a lapsed install still accepts.
      "One change always works, so you can respond to an incident: replacing a SCIM bearer token.",
      "send `bearerToken` on its own (at least 32 characters)",
      // What never stops: single sign-on is not an enterprise feature.
      'Single sign-on is not an enterprise feature: SAML and OIDC sign-in, global SSO and "Require SSO for login" work the same in every license state.',
      "**Single sign-on.**",
      "the mobile apps",
      "single sign-on configuration stays editable",
      "**Core monitoring is never affected**",
      "**Master admins can always sign in with their password.**",
      "**Nothing is deleted.** SCIM configuration, audit logs and retention overrides stay as they are.",
      // It all comes back, and an unreadable license state switches nothing off.
      "**Everything resumes as soon as a license is activated**, without a restart",
      "While it cannot read the license state",
      "SCIM, audit logging and retention overrides stay on",
    ]) {
      expect({
        expected: expected,
        present: section.includes(expected),
      }).toEqual({ expected: expected, present: true });
    }

    // The soft-enforcement promises this replaced.
    expect(section).not.toContain("**SSO, OIDC and SCIM keep working**");
    expect(section).not.toContain("**Audit logging continues.**");
    expect(section).not.toContain("never weakens");

    // What single sign-on used to do when the license lapsed (14.0.10 and earlier).
    for (const retired of [
      "**SSO and OIDC sign-in stop**",
      '**"Require SSO for login" is not enforced**',
      "Losing a license never locks anyone out",
      "SSO enforcement, SCIM and audit logging stay on",
      "disabling an SSO or OIDC provider",
      "`isEnabled: false`",
      "**Disable** on an enabled provider",
      '"Require SSO" settings',
    ]) {
      expect({ retired: retired, present: section.includes(retired) }).toEqual({
        retired: retired,
        present: false,
      });
    }

    expect(ssoLicenseWordingIn(section)).toEqual([]);
  });

  it("warns an install whose identity provider deprovisions through SCIM before its license lapses", () => {
    // The warning is a blockquote: drop its "> " markers before joining lines.
    const page: string = normalized(readPage().replace(/^> ?/gm, ""));

    expect(page).toContain(
      "**If your identity provider deprovisions users through SCIM, activate a license before the trial or grace period ends.**",
    );
    expect(page).toContain(
      "SCIM no longer deprovisions the people you remove at your identity provider",
    );
    expect(page).toContain(
      'unless "Require SSO for login" applies to them, anyone who can still reach such an account\'s email inbox can set a password and sign in',
    );
    expect(page).toContain("remove those users in OneUptime yourself");
    expect(page).not.toContain("On an install that enforces SSO");
    expect(page).not.toContain("Once SSO enforcement stops");
  });

  it("tells a new install to activate before the trial ends, and what stops if it does not", () => {
    const licensing: string = normalized(
      readPage().split("\n## Licensing\n")[1]!.split("\n### ")[0]!,
    );

    expect(licensing).toContain(
      "Activate a license before the trial ends: after it, SCIM, audit logging and retention overrides stop and enterprise configuration becomes read-only",
    );
    expect(licensing).toContain("(#when-a-license-expires-or-is-missing)");
    expect(ssoLicenseWordingIn(licensing)).toEqual([]);
  });

  it("says the Community image refuses IS_ENTERPRISE_EDITION=true to protect SCIM and audit logging", () => {
    const page: string = normalized(readPage());

    expect(page).toContain(
      "an upgrade that lands on the Community image can never silently stop SCIM provisioning (deprovisioning included) and audit logging",
    );
    expect(page).not.toContain('silently stop enforcing "Require SSO"');
  });

  it("explains a downgrade: SCIM and audit logging stop, single sign-on does not change", () => {
    const page: string = readPage();
    const section: string = normalized(
      sectionBetween(
        page,
        "## Switching from Enterprise to Community",
        "\n## ",
      ),
    );

    expect(page).toContain("## Switching from Enterprise to Community");
    expect(page).toContain("Switching back to the Enterprise");
    // Switching back restores SCIM only on a licensed (or trial / grace) install.
    expect(section).toContain(
      "as long as the install has a valid license or is still in its trial or grace period",
    );
    expect(section).toContain(
      'Single sign-on does not change: SAML and OIDC sign-in, global SSO and "Require SSO for login" work the same on both images.',
    );
    expect(section).toContain("**SCIM stops.**");
    expect(section).toContain("That includes SCIM deprovisioning.");
    expect(section).toContain("**SCIM team locks are lifted**");
    expect(section).toContain("**Audit logging stops.**");
    expect(section).toContain("**Retention overrides stop applying.**");
    expect(section).toContain(
      "The overrides stay in the database and apply again when you switch back.",
    );
    expect(section).toContain("review who has access");

    // The downgrade used to switch single sign-on off (14.0.10 and earlier).
    expect(section).not.toContain(
      '**"Require SSO for login" is not enforced**',
    );
    expect(section).not.toContain("**SSO, OIDC and SCIM stop.**");
    expect(section).not.toContain("disable an SSO or OIDC provider");
    expect(section).not.toContain("SSO enforcement relaxed");
    expect(ssoLicenseWordingIn(section)).toEqual([]);
  });

  it("says the trial is for evaluation and production needs a subscription", () => {
    const licensing: string = normalized(
      readPage().split("\n## Licensing\n")[1]!.split("\n### ")[0]!,
    );

    expect(licensing).toContain(
      `**${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial**`,
    );
    expect(licensing).toContain(
      "The trial is for evaluation: production use of the Enterprise Edition needs a subscription under the OneUptime Enterprise License.",
    );
  });

  it("marks IS_ENTERPRISE_EDITION as deprecated", () => {
    expect(readPage()).toContain("### `IS_ENTERPRISE_EDITION` is deprecated");
  });

  it("only links to docs pages and headings that exist", () => {
    // The link scan must actually see the page's links to prove anything.
    expect(docsLinks(readPage()).length).toBeGreaterThanOrEqual(4);
    expect(unresolvedDocsLinks(readPage())).toEqual([]);
  });

  it("keeps the anchors other pages deep-link to", () => {
    const slugs: Set<string> = headingSlugs(readPage());

    for (const anchor of [
      "switching-from-enterprise-to-community",
      "when-a-license-expires-or-is-missing",
      "offline-activation-air-gapped-installs",
    ]) {
      expect({ anchor: anchor, present: slugs.has(anchor) }).toEqual({
        anchor: anchor,
        present: true,
      });
    }
  });

  it("reports a link to a missing page or heading as unresolved", () => {
    expect(
      unresolvedDocsLinks(
        "[a](/docs/self-hosted/enterprise#no-such-heading) [b](/docs/self-hosted/no-such-page) [c](/docs/self-hosted/enterprise#licensing)",
      ),
    ).toEqual([
      "/docs/self-hosted/enterprise#no-such-heading",
      "/docs/self-hosted/no-such-page",
    ]);
  });
});

describe("Upgrade notes for the Community / Enterprise image split", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s has the edition-split section before the newest version section",
    (lang: string) => {
      const page: string = readContent(lang, "installation/upgrading");
      const sectionHeadings: Array<string> = page
        .split("\n")
        .filter((line: string) => {
          return line.startsWith("## ");
        });

      // General guidance, then this section, then the version sections.
      expect(sectionHeadings[1]).toBe(EDITION_SECTION_HEADING);
      expect(sectionHeadings[2]).toMatch(VERSION_SECTION_HEADING_PATTERN);

      /*
       * The version sections are newest first, so the one below the edition
       * section is a hop between consecutive majors ("13 → 14"), not a jump.
       */
      const newestHop: RegExpMatchArray | null = sectionHeadings[2]!.match(
        VERSION_SECTION_HEADING_PATTERN,
      );

      expect(Number(newestHop![2])).toBe(Number(newestHop![1]) + 1);
      expect(
        sectionHeadings.filter((heading: string) => {
          return heading === EDITION_SECTION_HEADING;
        }),
      ).toHaveLength(1);

      if (lang !== "en") {
        expect(page).toContain(
          "TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the Community/Enterprise image split).",
        );
      }
    },
  );

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s no longer claims SSO sign-in was disabled on Community builds in v11",
    (lang: string) => {
      const page: string = readContent(lang, "installation/upgrading");

      expect(page).not.toContain(OLD_V11_CLAIM);
      // The corrected v11 paragraph points at the new section.
      expect(page).toContain("(#community-and-enterprise-edition-images)");
      expect(
        headingSlugs(page).has("community-and-enterprise-edition-images"),
      ).toBe(true);
    },
  );

  it("tells Docker Compose users on IS_ENTERPRISE_EDITION to switch images", () => {
    const page: string = readContent("en", "installation/upgrading");

    expect(page).toContain(
      "**Docker Compose with `IS_ENTERPRISE_EDITION=true`:**",
    );
    expect(page).toContain("`APP_TAG=enterprise-release`");
  });

  it("warns Community users with SCIM configured before they upgrade, and tells them single sign-on stays", () => {
    const page: string = readContent("en", "installation/upgrading");
    const section: string = normalized(
      sectionBetween(page, EDITION_SECTION_HEADING, "\n## "),
    );

    expect(section).toContain(
      "**Community image with SCIM already configured:** SCIM provisioning stops with this upgrade, including deprovisioning.",
    );
    expect(section).toContain(
      "Single sign-on is not affected: the Community image serves it too.",
    );
    expect(section).toContain("**Community Edition without SCIM:** nothing.");
    expect(section).toContain(
      "(/docs/self-hosted/enterprise#switching-from-enterprise-to-community)",
    );
    expect(section).not.toContain("with SSO, OIDC or SCIM already configured");
    expect(section).not.toContain("without SSO, OIDC or SCIM");
  });

  it("only links to docs pages and headings that exist", () => {
    expect(
      unresolvedDocsLinks(readContent("en", "installation/upgrading")),
    ).toEqual([]);
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s says what stops when an unlicensed install's trial ends",
    (lang: string) => {
      const section: string = normalized(
        sectionBetween(
          readContent(lang, "installation/upgrading"),
          EDITION_SECTION_HEADING,
          "\n## ",
        ),
      );

      for (const expected of [
        "**If you use SCIM or audit logging, activate a license before the trial ends.**",
        "After the trial, SCIM provisioning stops and audit logging stops recording.",
        "Single sign-on is not affected.",
        "Everything resumes, without a restart, as soon as you activate a license.",
        `If the license expires, everything keeps working for a ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period`,
        `gets a ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial from the first start of this release`,
        "The SCIM endpoints keep their exact paths on the Enterprise Edition",
        "On the Enterprise Edition they refuse requests while the license is lapsed",
        "keep their exact paths and are served by both editions in every license state",
      ]) {
        expect({
          lang: lang,
          expected: expected,
          present: section.includes(expected),
        }).toEqual({
          lang: lang,
          expected: expected,
          present: true,
        });
      }

      expect(section).not.toContain(
        "keep running with the configuration you have",
      );
    },
  );

  /*
   * The edition section describes the editions as they are now, and says
   * once, dated, what changed for single sign-on after 14.0.10. Everything
   * else it says about single sign-on must hold in every edition and license
   * state.
   */
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s puts single sign-on in the Community Edition and ties it to no license",
    (lang: string) => {
      const section: string = normalized(
        sectionBetween(
          readContent(lang, "installation/upgrading"),
          EDITION_SECTION_HEADING,
          "\n## ",
        ).replace(/^> ?/gm, ""),
      );

      for (const expected of [
        'The **Community Edition** is open source under the Apache License 2.0 and includes SAML and OIDC single sign-on, global SSO and "Require SSO for login".',
        "The **Enterprise Edition** adds the enterprise modules from the repository's `ee/` directory: SCIM, team compliance, audit logs and the enterprise Health dashboards in the Admin Dashboard.",
        '**Releases after 14.0.10:** SAML and OIDC single sign-on, global SSO and "Require SSO for login" are part of the Community Edition again, and no license state switches them off.',
        "is enforced again after this upgrade, so check that its provider still works before you upgrade.",
        "instead of silently stopping SCIM provisioning and audit logging.",
      ]) {
        expect({
          lang: lang,
          expected: expected,
          present: section.includes(expected),
        }).toEqual({ lang: lang, expected: expected, present: true });
      }

      const undatedSentences: Array<string> = section
        .split(/(?<=[.!?])\s+/)
        .filter((sentence: string) => {
          return !sentence.includes("14.0.10");
        });

      expect({
        lang: lang,
        ssoLicenseWording: undatedSentences.filter((sentence: string) => {
          return ssoLicenseWordingIn(sentence).length > 0;
        }),
      }).toEqual({ lang: lang, ssoLicenseWording: [] });
      expect(section).not.toContain("SAML SSO, OIDC, SCIM");
      expect(section).not.toContain(
        'silently no longer enforcing "Require SSO"',
      );
    },
  );

  /*
   * The 13 -> 14 notes are history: they describe 14.0.0 to 14.0.10, when
   * single sign-on was an Enterprise feature. Each language opens them with a
   * note, in that language, saying which of their single sign-on statements
   * no longer apply. The version numbers and the setting's name are the same
   * in every language.
   */
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s opens the 13 → 14 notes with a note that single sign-on is Community after 14.0.10",
    (lang: string) => {
      const lines: Array<string> = readContent(
        lang,
        "installation/upgrading",
      ).split("\n");
      const headingIndex: number = lines.findIndex((line: string) => {
        return (
          line.startsWith("## ") && VERSION_SECTION_HEADING_PATTERN.test(line)
        );
      });
      const hop: RegExpMatchArray | null = lines[headingIndex]!.match(
        VERSION_SECTION_HEADING_PATTERN,
      );

      expect([Number(hop![1]), Number(hop![2])]).toEqual([13, 14]);

      // The first paragraph under the heading is the note.
      expect(lines[headingIndex + 1]).toBe("");

      const note: Array<string> = [];

      for (const line of lines.slice(headingIndex + 2)) {
        if (!line.startsWith(">")) {
          break;
        }

        note.push(line.replace(/^> ?/, ""));
      }

      const text: string = normalized(note.join(" "));

      expect({ lang: lang, noteLines: note.length > 0 }).toEqual({
        lang: lang,
        noteLines: true,
      });

      // What it is about, which versions, and what still applies.
      for (const expected of [
        "14.0.10",
        "14.0.0",
        "SAML",
        "OIDC",
        "Require SSO for login",
        "Community",
        "SCIM",
        "Health",
      ]) {
        expect({
          lang: lang,
          expected: expected,
          present: text.includes(expected),
        }).toEqual({ lang: lang, expected: expected, present: true });
      }

      if (lang === "en") {
        expect(text).toBe(
          '**Releases after 14.0.10:** SAML and OIDC single sign-on, global SSO and "Require SSO for login" are part of the Community Edition again, and no license state switches them off. Where this section says that the Community image leaves single sign-on out, or that single sign-on stops or is not enforced without a license, it describes 14.0.0 to 14.0.10. What it says about SCIM, team compliance, audit logs and the Health dashboards still applies.',
        );
      } else {
        // Translated, like the section it sits in: not the English note.
        expect(text).not.toContain("Releases after 14.0.10");
        expect(text).not.toContain("still applies");
      }
    },
  );

  /*
   * The v10 -> v11 notes say SSO, OIDC and SCIM "now require the Enterprise
   * Edition". They stay as history too, with a note that SSO and OIDC are in
   * the Community Edition again after 14.0.10, and without the present-tense
   * claim that the Community image has no single sign-on code.
   */
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s scopes the v11 identity notes to the releases before single sign-on returned",
    (lang: string) => {
      const page: string = readContent(lang, "installation/upgrading");
      const headings: Array<string> = page
        .split("\n")
        .filter((line: string) => {
          return V10_TO_V11_HEADING.test(line);
        });

      expect({ lang: lang, headings: headings.length }).toEqual({
        lang: lang,
        headings: 1,
      });

      const section: string = sectionBetween(page, headings[0]!, "\n## ");
      const note: string | undefined = section
        .split("\n")
        .find((line: string) => {
          return line.startsWith("> **") && line.includes("14.0.10");
        });

      expect({ lang: lang, note: note }).toEqual({
        lang: lang,
        note: expect.stringContaining("OIDC"),
      });
      expect(section).toContain("(#community-and-enterprise-edition-images)");
      expect(section).not.toContain(
        "The Community image no longer contains any SSO,",
      );
      expect(section).not.toContain(
        "- **Self-hosted:** requires the **Enterprise Edition** build.",
      );
      expect(section).not.toContain("so you can restore SSO/OIDC/SCIM");
    },
  );

  it("says in English that the v11 identity notes describe v11 to 14.0.10", () => {
    const page: string = readContent("en", "installation/upgrading");
    const section: string = normalized(
      sectionBetween(
        page,
        "### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition",
        "\n### ",
      ).replace(/^> ?/gm, ""),
    );

    for (const expected of [
      '**Releases after 14.0.10:** SAML SSO, OIDC and global SSO are part of the Community Edition again, together with "Require SSO for login", and need no license.',
      "SCIM provisioning and team compliance settings still need the Enterprise Edition.",
      "The rest of this section describes v11 to 14.0.10.",
      "The Community images of 14.0.0 to 14.0.10 contain no SSO, OIDC or SCIM code",
      "**Self-hosted:** SCIM and team compliance settings require the **Enterprise Edition** build.",
      "**If you rely on SSO and self-host**, upgrade to a release after 14.0.10, where every edition serves SSO and OIDC.",
    ]) {
      expect({
        expected: expected,
        present: section.includes(expected),
      }).toEqual({ expected: expected, present: true });
    }
  });
});

describe("Identity docs carry an edition note in every language", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s SSO, SCIM and global SSO pages link to the Enterprise Edition page",
    (lang: string) => {
      for (const page of [
        "identity/sso",
        "identity/scim",
        "identity/global-sso",
      ]) {
        const content: string = readContent(lang, page);
        const intro: string = content.split("\n## ")[0]!;

        // The note sits in the introduction, above the first section.
        expect({
          page: page,
          linked: intro.includes(`](${PAGE_URL})`),
        }).toEqual({ page: page, linked: true });
        expect(unresolvedDocsLinks(content)).toEqual([]);
      }

      // SSO and SCIM are on the Scale plan on OneUptime Cloud.
      for (const page of ["identity/sso", "identity/scim"]) {
        const intro: string = readContent(lang, page).split("\n## ")[0]!;

        expect({ page: page, scale: intro.includes("**Scale**") }).toEqual({
          page: page,
          scale: true,
        });
      }
    },
  );

  /*
   * SCIM stops with the license: after the 14-day trial, or 30 days after a
   * license expires, SCIM requests are refused until a license is activated.
   * Each language states the trial first and the grace period second, with
   * the lengths the classifier uses, after the link to the Enterprise Edition
   * page.
   */
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s SCIM page says SCIM stops after the trial or the grace period",
    (lang: string) => {
      const intro: string = readContent(lang, "identity/scim").split(
        "\n## ",
      )[0]!;
      const afterLink: string = intro
        .split(`](${PAGE_URL})`)
        .slice(1)
        .join(" ");

      expect(statedDayCounts(afterLink)).toEqual([
        ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
        ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
      ]);
      expect(intro).toMatch(/SCIM[\s\S]*SCIM/);
    },
  );

  /*
   * Single sign-on does not stop: SSO (with "Require SSO for login") and
   * global SSO are in every edition and need no license. So each language's
   * note names the Community Edition, keeps the setting's English name, and
   * states no trial or grace length (Persian digits included), because there
   * is no deadline to state.
   */
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s SSO and global SSO pages put single sign-on in every edition, with no license deadline",
    (lang: string) => {
      for (const page of ["identity/sso", "identity/global-sso"]) {
        const intro: string = readContent(lang, page).split("\n## ")[0]!;
        // The note is the introduction's paragraph that links the edition page.
        const note: string =
          intro.split("\n").find((line: string) => {
            return line.includes(`](${PAGE_URL})`);
          }) || "";

        expect({
          page: page,
          periods: statedDayCounts(note),
          namesCommunityEdition: note.includes("Community Edition"),
          namesRequireSso: note.includes("Require SSO"),
          namesCloud: note.includes("OneUptime Cloud"),
        }).toEqual({
          page: page,
          periods: [],
          namesCommunityEdition: true,
          namesRequireSso: true,
          namesCloud: true,
        });
      }
    },
  );

  it("says in English exactly what each identity page's edition note means", () => {
    for (const [page, sentence] of [
      [
        "identity/sso",
        '> **Edition:** SSO, including "Require SSO for login", is part of every OneUptime edition: self-hosted installations get it in the Community Edition, with no license needed. On OneUptime Cloud it is available on the **Scale** plan and above.',
      ],
      [
        "identity/scim",
        "Without a valid license (after the 14-day trial, or 30 days after a license expires), SCIM requests are refused until a license is activated.",
      ],
      [
        "identity/global-sso",
        'Global SSO, including the instance-wide "Require SSO for Login" toggle, is part of every OneUptime edition: every self-hosted instance has it, the Community Edition included, and it needs no license. It is instance administration, so it does not apply to OneUptime Cloud.',
      ],
    ] as Array<[string, string]>) {
      expect({
        page: page,
        present: readContent("en", page).split("\n## ")[0]!.includes(sentence),
      }).toEqual({ page: page, present: true });
    }
  });

  it("no longer says in English that single sign-on needs the Enterprise Edition or a license", () => {
    for (const page of ["identity/sso", "identity/global-sso"]) {
      const intro: string = normalized(
        readContent("en", page).split("\n## ")[0]!.replace(/^> ?/gm, ""),
      );

      for (const retired of [
        "Without a valid license",
        "Enterprise Edition image and a license",
        "is only available on instances running the Enterprise Edition build",
        "what happens to SSO requirements on the Community Edition",
      ]) {
        expect({
          page: page,
          retired: retired,
          present: intro.includes(retired),
        }).toEqual({
          page: page,
          retired: retired,
          present: false,
        });
      }

      expect({ page: page, wording: ssoLicenseWordingIn(intro) }).toEqual({
        page: page,
        wording: [],
      });
    }
  });
});

/*
 * The status pages overview says who gets SSO, OIDC and SCIM on a private
 * status page. It used to say they were "gated behind a plan feature, so they
 * may not be available on every installation", which is not true of single
 * sign-on on a self-hosted installation.
 */
describe("The status pages overview says who gets status page SSO, OIDC and SCIM", () => {
  const paragraphOf: (lang: string) => string = (lang: string): string => {
    const paragraphs: Array<string> = readContent(lang, "status-pages/index")
      .split("\n")
      .filter((line: string) => {
        return (
          line.includes("**SCIM**") &&
          line.includes("OIDC") &&
          !line.startsWith("|")
        );
      });

    expect({ lang: lang, paragraphs: paragraphs.length }).toEqual({
      lang: lang,
      paragraphs: 1,
    });

    return paragraphs[0] || "";
  };

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s names the Scale plan and links to the Enterprise Edition page",
    (lang: string) => {
      const paragraph: string = paragraphOf(lang);

      expect(paragraph).toContain(`](${PAGE_URL})`);
      expect(paragraph).toContain("Scale");
      expect(unresolvedDocsLinks(paragraph)).toEqual([]);
    },
  );

  it("says in English that SSO and OIDC are in every self-hosted edition", () => {
    const paragraph: string = paragraphOf("en");

    expect(paragraph).toContain(
      "On OneUptime Cloud all three need the Scale plan or above. On a self-hosted installation, SSO and OIDC are part of every edition, and SCIM needs the [Enterprise Edition](/docs/self-hosted/enterprise).",
    );
    expect(paragraph).not.toContain(
      "may not be available on every installation",
    );
  });
});

/*
 * The SLO audit-logs page tells a self-hosted reader that audit logs need the
 * Enterprise Edition. It must also say that recording stops once the license
 * lapses: "Enable Audit Logs" alone stays on while nothing is recorded. Only
 * English and Persian have this page.
 */
describe("The SLO audit logs page says recording stops with the license", () => {
  const SLO_AUDIT_LOGS_PAGE: string = "slo/feed-and-audit-logs";
  const LAPSE_ANCHOR: string =
    "/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing";

  // The paragraph that says audit logs need the **Enterprise** plan or edition.
  const turningOnSection: (lang: string) => string = (lang: string): string => {
    const paragraph: string | undefined = readContent(lang, SLO_AUDIT_LOGS_PAGE)
      .split("\n")
      .find((line: string) => {
        return line.includes("**Enterprise**");
      });

    expect(paragraph).toBeDefined();

    return paragraph || "";
  };

  it.each(["en", "fa"])(
    "%s: the Enterprise note links to what happens when a license lapses",
    (lang: string) => {
      const paragraph: string = turningOnSection(lang);

      expect(paragraph).toContain(`](${LAPSE_ANCHOR})`);
      // The trial, then the grace period after an expiry (Persian digits too).
      expect(statedDayCounts(paragraph)).toEqual([
        ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
        ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
      ]);
      expect(unresolvedDocsLinks(paragraph)).toEqual([]);
    },
  );

  it("says in English that recording stops and resumes with a license", () => {
    expect(turningOnSection("en")).toContain(
      "On a self-hosted installation, audit logging stops recording without a valid license (after the 14-day trial, or 30 days after a license expires), and resumes as soon as a license is activated",
    );
  });

  it("no other language has the page, so no translation is missing the note", () => {
    const languagesWithPage: Array<string> =
      SUPPORTED_DOCS_LANGUAGE_CODES.filter((lang: string) => {
        try {
          readContent(lang, SLO_AUDIT_LOGS_PAGE);
          return true;
        } catch {
          return false;
        }
      });

    expect(languagesWithPage.sort()).toEqual(["en", "fa"]);
  });
});

describe("No docs text calls OneUptime 100% or fully open source", () => {
  it.each(FORMERLY_PUBLISHED_DOCS_CLAIMS)("catches: %s", (sentence: string) => {
    expect(retiredDocsClaimsIn(sentence).length).toBeGreaterThan(0);
  });

  it.each(ACCURATE_DOCS_COPY)("leaves alone: %s", (sentence: string) => {
    expect(retiredDocsClaimsIn(sentence)).toEqual([]);
  });

  it("scans every docs locale file, docs page and docs view", () => {
    expect(filesUnder(DOCS_LOCALES_DIR, [".json"])).toHaveLength(
      SUPPORTED_DOCS_LANGUAGE_CODES.length,
    );
    expect(filesUnder(CONTENT_DIR, [".md"]).length).toBeGreaterThan(
      SUPPORTED_DOCS_LANGUAGE_CODES.length * 10,
    );
    expect(
      filesUnder(DOCS_VIEWS_DIR, [".ejs"]).map((file: string) => {
        return path.basename(file);
      }),
    ).toContain("OpenSourceCommitment.ejs");
  });

  it("finds retired open-source language in no docs locale string, page or view", () => {
    const violations: Array<string> = [];

    for (const file of [
      ...filesUnder(DOCS_LOCALES_DIR, [".json"]),
      ...filesUnder(CONTENT_DIR, [".md"]),
      ...filesUnder(DOCS_VIEWS_DIR, [".ejs"]),
    ]) {
      fs.readFileSync(file, "utf8")
        .split("\n")
        .forEach((line: string, index: number) => {
          const found: Array<string> = retiredDocsClaimsIn(line);

          if (found.length > 0) {
            violations.push(
              `${path.relative(PACKAGES_ROOT, file)}:${index + 1} (${found.join(", ")}): ${line.trim()}`,
            );
          }
        });
    }

    expect(violations).toEqual([]);
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: the edit card on every docs page no longer says 100% open source",
    (lang: string) => {
      const locale: { ui: Record<string, string> } = JSON.parse(
        fs.readFileSync(path.join(DOCS_LOCALES_DIR, `${lang}.json`), "utf8"),
      );
      const body: string = locale.ui["helpImproveBody"] || "";

      expect(body.trim().length).toBeGreaterThan(0);
      expect(body).not.toMatch(/100\s*[%٪％]|۱۰۰/);
      expect(retiredDocsClaimsIn(body)).toEqual([]);

      if (lang === "en") {
        expect(body).toBe(
          "OneUptime is open source. Found a typo or want to add something?",
        );
      }
    },
  );

  it("renders the edit card from the locale string the scan checks", () => {
    const partial: string = fs.readFileSync(
      path.join(DOCS_VIEWS_DIR, "Partials/OpenSourceCommitment.ejs"),
      "utf8",
    );

    expect(partial).toContain("t('ui.helpImproveBody')");
  });
});

describe("The upgrade notes say what the Community image leaves out", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s says the Community image has no ee/ directory, not that it has no enterprise code at all",
    (lang: string) => {
      const page: string = readContent(lang, "installation/upgrading");

      expect(page).not.toContain("no enterprise code at all");
      expect(page).toContain(
        "the Community image does not contain the `ee/` directory.",
      );
    },
  );
});

/*
 * The released entry for the split, found by its title: newer entries sit
 * above it. Throws, naming the title, when the notes no longer have it.
 */
function helmSplitEntry(): string {
  const entry: string | undefined = helmUpgradeNoteEntries().find(
    (candidate: string) => {
      return candidate.startsWith(HELM_SPLIT_ENTRY_TITLE);
    },
  );

  if (!entry) {
    throw new Error(`Helm upgrade note not found: ${HELM_SPLIT_ENTRY_TITLE}`);
  }

  return entry;
}

describe("Helm chart upgrade notes for the Community / Enterprise split", () => {
  it("keeps the released entry for the split, once", () => {
    const entries: Array<string> = helmUpgradeNoteEntries();

    // The older entries are still there, so the split parsed the list.
    expect(entries.length).toBeGreaterThanOrEqual(6);
    expect(
      entries.some((entry: string) => {
        return entry.startsWith("- **13.0.0 (2026-09-07)**");
      }),
    ).toBe(true);

    /*
     * The split shipped in 14.0.0, so the entry that was "Unreleased" while it
     * sat on master carries a released title, "- **<semver> (<date>)**".
     */
    expect(HELM_SPLIT_ENTRY_TITLE).toMatch(HELM_RELEASED_ENTRY_TITLE_PATTERN);
    expect(helmSplitEntry()).toContain("`image.type: enterprise-edition`");
    expect(
      entries.filter((entry: string) => {
        return entry.includes("The app ships as two editions");
      }),
    ).toHaveLength(1);
  });

  /*
   * The 14.0.0 entry is history: it says what 14.0.0 did, single sign-on
   * included. The entry above it says what changed after 14.0.10.
   */
  it("covers every case an operator could be in when upgrading to 14.0.0", () => {
    const entry: string = normalized(helmSplitEntry());

    for (const expected of [
      // Community Edition installs with no SSO, OIDC or SCIM: nothing to do.
      "**Community Edition with no SSO, OIDC or SCIM configured:** nothing to do.",
      "do not contain the repository's `ee/` directory",
      // Enterprise Edition installs: the enterprise- images now contain ee/.
      "The chart already pulls the `enterprise-` images, which now contain `ee/`.",
      // Unlicensed Enterprise Edition installs: the trial, then read-only.
      `**${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial**`,
      "The trial is for evaluation: production use of the Enterprise Edition requires a subscription under the OneUptime Enterprise License",
      // A license that expires later: the grace period, not the trial's length.
      `A license that expires later gets a ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period before the same happens.`,
      "enterprise configuration becomes read-only and the Health dashboards are locked",
      // What stopped after the trial in 14.0.0, and the warning to act before it ended.
      "**If you use SSO, OIDC, SCIM or audit logging, activate a license before the trial ends.**",
      "SSO, OIDC, SCIM and audit logging stop",
      "Everything resumes, without a restart, when a license is activated",
      // Community Edition installs with SSO, OIDC or SCIM configured.
      "**Community Edition with SSO, OIDC or SCIM configured:** set `image.type: enterprise-edition` before you upgrade to keep them.",
      // IS_ENTERPRISE_EDITION.
      "`IS_ENTERPRISE_EDITION` is deprecated and informational only.",
    ]) {
      expect(entry).toContain(expected);
    }

    expect(entry).not.toMatch(/keep running|never stop/);
  });

  it("links the split entry to the Enterprise Edition page and the upgrading guide, and every link resolves", () => {
    const links: string = absoluteDocsLinksAsRelative(helmSplitEntry());

    expect(links).toContain("(/docs/self-hosted/enterprise)");
    expect(links).toContain(
      "(/docs/installation/upgrading#community-and-enterprise-edition-images)",
    );
    expect(links).toContain(
      "(/docs/self-hosted/enterprise#switching-from-enterprise-to-community)",
    );
    expect(unresolvedDocsLinks(links)).toEqual([]);
  });

  it("reports an absolute docs link to a missing heading as unresolved", () => {
    expect(
      unresolvedDocsLinks(
        absoluteDocsLinksAsRelative(
          "See https://oneuptime.com/docs/installation/upgrading#no-such-heading and https://oneuptime.com/docs/self-hosted/enterprise.",
        ),
      ),
    ).toEqual(["/docs/installation/upgrading#no-such-heading"]);
  });
});

describe("Helm chart upgrade notes for single sign-on in the Community Edition", () => {
  const ssoEntryIndex: () => number = (): number => {
    return helmUpgradeNoteEntries().findIndex((entry: string) => {
      return normalized(entry).includes(HELM_SSO_ENTRY_MARKER);
    });
  };

  it("has one entry, above the split entry, titled as unreleased or as a release after 14.0.10", () => {
    const entries: Array<string> = helmUpgradeNoteEntries();
    const index: number = ssoEntryIndex();
    const splitIndex: number = entries.indexOf(helmSplitEntry());

    expect(
      entries.filter((entry: string) => {
        return normalized(entry).includes(HELM_SSO_ENTRY_MARKER);
      }),
    ).toHaveLength(1);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(splitIndex);

    // Renamed to "- **<semver> (<date>)**" when it ships; either title is fine.
    const title: string = entries[index]!.split("\n")[0]!;

    expect(
      HELM_UNRELEASED_ENTRY_TITLE_PATTERN.test(title) ||
        HELM_RELEASED_ENTRY_TITLE_PATTERN.test(title),
    ).toBe(true);

    if (HELM_UNRELEASED_ENTRY_TITLE_PATTERN.test(title)) {
      expect(title).toContain("- **Unreleased (after 14.0.10)**");
    }
  });

  it("tells each edition what changes, and that nothing needs to be set", () => {
    const entry: string = normalized(
      helmUpgradeNoteEntries()[ssoEntryIndex()]!,
    );

    for (const expected of [
      HELM_SSO_ENTRY_MARKER,
      'SAML and OIDC sign-in for projects and status pages, global SSO and "Require SSO for login" run on both `image.type` values, and no license state switches them off.',
      "No values change and no migration",
      "(SAML ACS URLs, OIDC redirect URIs) stay the same",
      // Community Edition: served again, and a saved requirement is enforced again.
      "**`image.type: community-edition`:** single sign-on you configured is served again.",
      'A "Require SSO for login" setting that was saved but not enforced is enforced again after the upgrade',
      // Enterprise Edition: a lapse now stops only SCIM and audit logging.
      "**`image.type: enterprise-edition`:**",
      `after the **${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial**, or ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after a license expires, only SCIM and audit logging stop`,
      "Single sign-on is not affected.",
      "SCIM, team compliance, audit logs and the Health dashboards still need the Enterprise Edition.",
    ]) {
      expect({ expected: expected, present: entry.includes(expected) }).toEqual(
        {
          expected: expected,
          present: true,
        },
      );
    }

    expect(entry).not.toMatch(/keep running|never stop/);
    expect(ssoLicenseWordingIn(entry)).toEqual([]);
    expect(licensePeriodLengthProblems(entry)).toEqual([]);
  });

  it("links to the Enterprise Edition page and the upgrading guide, and every link resolves", () => {
    const links: string = absoluteDocsLinksAsRelative(
      helmUpgradeNoteEntries()[ssoEntryIndex()]!,
    );

    expect(links).toContain("(/docs/self-hosted/enterprise)");
    expect(links).toContain(
      "(/docs/installation/upgrading#community-and-enterprise-edition-images)",
    );
    expect(unresolvedDocsLinks(links)).toEqual([]);
  });
});

describe("Helm chart licensing wording", () => {
  it("finds the four places the chart describes the Enterprise Edition", () => {
    const texts: Array<HelmEditionText> = helmEditionTexts();

    expect(
      texts.map((text: HelmEditionText) => {
        return text.source;
      }),
    ).toEqual([
      "values.yaml",
      "README.md",
      "docs/configuration.md",
      "values.schema.json",
    ]);

    for (const text of texts) {
      expect({
        source: text.source,
        mentionsEnterprise:
          text.text.includes("enterprise-edition") ||
          text.text.includes("Enterprise Edition"),
      }).toEqual({
        source: text.source,
        mentionsEnterprise: true,
      });
    }
  });

  it.each(helmEditionTexts())(
    "$source says production needs a subscription and the trial is for evaluation",
    (text: HelmEditionText) => {
      expect(helmLicensingWordingProblems(text.text)).toEqual([]);
    },
  );

  it("rejects the wording that described the license only as a configuration gate", () => {
    expect(
      helmLicensingWordingProblems(
        "enterprise-edition runs the Enterprise Edition images (the same tags with an enterprise- prefix), which add the enterprise features under the OneUptime Enterprise License and need a valid license to configure them.",
      ).length,
    ).toBeGreaterThan(0);
    expect(
      helmLicensingWordingProblems(
        "They need a valid license: without one (after a 14-day grace period) enterprise configuration becomes read-only and the enterprise admin dashboards are locked.",
      ).length,
    ).toBeGreaterThan(0);
  });

  /*
   * The chart's README said this until SSO, SCIM and audit logging began to
   * stop with the license. Every other requirement it meets, so only the
   * lapse checks can reject it.
   */
  it("rejects the wording that promised SSO, SCIM and audit logging never stop", () => {
    const problems: Array<string> = helmLicensingWordingProblems(
      "Production use of the Enterprise Edition requires a subscription under the OneUptime Enterprise License. An install with no license runs as a 14-day trial, which is for evaluation. After the trial (or 14 days after a license expires) enterprise configuration becomes read-only and the enterprise admin dashboards are locked. Everything already configured keeps working — SSO, SCIM and audit logging never stop — and core monitoring is never affected.",
    );

    expect(problems).toEqual([
      "missing: 30 days after a license expires",
      "missing: SCIM and audit logging stop",
      "missing: until a license is activated",
      "missing: single sign-on does not depend on the license",
      "retired wording: keeps? (?:running|working)",
      "retired wording: never stop",
      "wrong grace length: 14 days after a license expires",
    ]);
  });

  /*
   * What the chart's README said from 14.0.0 to 14.0.10, when single sign-on
   * stopped with the license. It says the lengths, the subscription and the
   * evaluation trial right, so only the single sign-on checks can reject it.
   */
  it("rejects the wording that said single sign-on stops with the license", () => {
    const problems: Array<string> = helmLicensingWordingProblems(
      'Production use of the Enterprise Edition requires a subscription under the OneUptime Enterprise License. An install with no license runs as a 14-day trial, which is for evaluation. After the trial (or 30 days after a license expires), until a license is activated, SSO, OIDC, SCIM and audit logging stop: SSO sign-in is refused and "Require SSO" is no longer enforced (users sign in with their password), your identity provider\'s SCIM requests are refused, and audit logging stops recording. Everything resumes as soon as a license is activated, and core monitoring is never affected.',
    );

    expect(problems).toEqual([
      "missing: single sign-on does not depend on the license",
      `retired wording: ${SSO_LICENSE_WORDING[0]!.source}`,
      `retired wording: ${SSO_LICENSE_WORDING[1]!.source}`,
    ]);
    expect(
      helmLicensingWordingProblems(
        "Everything in the Community Edition plus the enterprise features (SSO/SAML, OIDC, SCIM, audit logs), licensed under the OneUptime Enterprise License.",
      ),
    ).toContain("retired wording: enterprise features \\((?:SSO|SAML|OIDC)");
  });
});
