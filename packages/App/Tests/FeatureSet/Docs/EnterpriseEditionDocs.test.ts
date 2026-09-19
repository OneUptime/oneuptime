import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  getLocalizedNav,
  localizeDocsUrl,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "Common/Server/Enterprise/EnterpriseFeature";
import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";
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
 * for evaluation.
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
 * The newest version section, in any language: "## Upgrading from OneUptime
 * 12 → 13", "## 从 OneUptime 12 升级到 13", ...
 */
const UPGRADE_FROM_12_HEADING_PATTERN: RegExp = /^## .*12\D+13/;

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
  [EnterpriseFeature.SSO]: "SAML SSO and OpenID Connect",
  [EnterpriseFeature.SCIM]: "SCIM provisioning",
  [EnterpriseFeature.TeamCompliance]: "Team compliance settings",
  [EnterpriseFeature.AuditLogs]: "Audit logs",
  [EnterpriseFeature.InstanceHealth]: "Admin **Health** dashboards",
};

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
 * What is wrong with a description of the Enterprise Edition's licensing: it
 * must say production use needs a subscription and that the first 14 days are
 * an evaluation trial, and it must not describe the license only as a switch
 * for configuration, or call the unlicensed first 14 days a grace period
 * (the grace period is the 14 days after a license expires).
 */
function helmLicensingWordingProblems(text: string): Array<string> {
  const flat: string = normalized(text);
  const problems: Array<string> = [];

  for (const required of [
    "Production use of the Enterprise Edition requires a subscription",
    `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day trial`,
    "for evaluation",
  ]) {
    if (!flat.includes(required)) {
      problems.push(`missing: ${required}`);
    }
  }

  for (const forbidden of [
    /\bgrace period\b/i,
    /configuring them needs a valid license/i,
    /need a valid license to configure them/i,
  ]) {
    if (forbidden.test(flat)) {
      problems.push(`retired wording: ${forbidden.source}`);
    }
  }

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

  it("keeps ClickHouse capacity and pruning in the Community Edition", () => {
    const row: string | undefined = readPage()
      .split("\n")
      .find((line: string) => {
        return line.includes("ClickHouse capacity view");
      });

    expect(row).toContain("| Yes | Yes |");
  });

  it("states the grace period and trial length the licensing code uses", () => {
    const page: string = readPage();
    const days: string = `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day`;
    const daysAfter: string = `${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS} days after a license expires`;

    expect(page).toContain(`**${days} trial**`);
    expect(page).toContain(daysAfter);
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

  it("promises soft enforcement: lapsed licenses never weaken security or core monitoring", () => {
    const page: string = readPage();

    expect(page).toContain("**SSO, OIDC and SCIM keep working**");
    expect(page).toContain("**Audit logging continues.**");
    expect(page).toContain("**Core monitoring is never affected**");
    expect(page).toContain(
      "**Master admins can always sign in with their password.**",
    );
    expect(page).toContain("Enterprise configuration becomes **read-only**");
  });

  it("explains a downgrade, including the SSO enforcement it relaxes", () => {
    const page: string = readPage();

    expect(page).toContain("## Switching from Enterprise to Community");
    expect(page).toContain('**"Require SSO for login" is not enforced**');
    expect(page).toContain("Switching back to the Enterprise");
    expect(page).toContain("review who has access");
  });

  it("says the trial is for evaluation and production needs a subscription", () => {
    const licensing: string = normalized(
      readPage().split("\n## Licensing\n")[1]!.split("\n### ")[0]!,
    );

    expect(licensing).toContain(
      `**${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day trial**`,
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
      expect(sectionHeadings[2]).toMatch(UPGRADE_FROM_12_HEADING_PATTERN);
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

  it("warns Community users with SSO configured before they upgrade", () => {
    const page: string = readContent("en", "installation/upgrading");

    expect(page).toContain(
      "**Community image with SSO, OIDC or SCIM already configured:**",
    );
    expect(page).toContain(
      "(/docs/self-hosted/enterprise#switching-from-enterprise-to-community)",
    );
  });

  it("only links to docs pages and headings that exist", () => {
    expect(
      unresolvedDocsLinks(readContent("en", "installation/upgrading")),
    ).toEqual([]);
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

        expect({
          page: page,
          linked: content.includes(`](${PAGE_URL})`),
        }).toEqual({ page: page, linked: true });
        expect(unresolvedDocsLinks(content)).toEqual([]);
      }

      for (const page of ["identity/sso", "identity/scim"]) {
        const intro: string = readContent(lang, page).split("\n## ")[0]!;

        // The note sits in the introduction, above the first section.
        expect(intro).toContain(PAGE_URL);
        expect(intro).toContain("**Scale**");
      }
    },
  );
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

describe("Helm chart upgrade notes for the Community / Enterprise split", () => {
  it("has an Unreleased entry for the split as the newest entry", () => {
    const entries: Array<string> = helmUpgradeNoteEntries();

    // The older entries are still there, so the split parsed the list.
    expect(entries.length).toBeGreaterThanOrEqual(5);
    expect(
      entries.some((entry: string) => {
        return entry.startsWith("- **13.0.0 (2026-09-07)**");
      }),
    ).toBe(true);

    expect(entries[0]!.startsWith("- **Unreleased")).toBe(true);
    expect(entries[0]).toContain("`image.type: enterprise-edition`");
    expect(
      entries.filter((entry: string) => {
        return entry.includes("The app ships as two editions");
      }),
    ).toHaveLength(1);
  });

  it("covers every case an operator can be in", () => {
    const entry: string = normalized(helmUpgradeNoteEntries()[0]!);

    for (const expected of [
      // Community Edition installs with no SSO, OIDC or SCIM: nothing to do.
      "**Community Edition with no SSO, OIDC or SCIM configured:** nothing to do.",
      "do not contain the repository's `ee/` directory",
      // Enterprise Edition installs: the enterprise- images now contain ee/.
      "The chart already pulls the `enterprise-` images, which now contain `ee/`.",
      // Unlicensed Enterprise Edition installs: the trial, then read-only.
      `**${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day trial**`,
      "The trial is for evaluation: production use of the Enterprise Edition requires a subscription under the OneUptime Enterprise License",
      "enterprise configuration becomes read-only and the Health dashboards are locked",
      "SSO, OIDC, SCIM and audit logging keep running",
      // Community Edition installs with SSO, OIDC or SCIM configured.
      "**Community Edition with SSO, OIDC or SCIM configured:** set `image.type: enterprise-edition` before you upgrade to keep them.",
      '"Require SSO for login" is no longer enforced and SCIM provisioning stops',
      // IS_ENTERPRISE_EDITION.
      "`IS_ENTERPRISE_EDITION` is deprecated and informational only.",
    ]) {
      expect(entry).toContain(expected);
    }
  });

  it("links to the Enterprise Edition page and the upgrading guide, and every link resolves", () => {
    const links: string = absoluteDocsLinksAsRelative(
      helmUpgradeNoteEntries()[0]!,
    );

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
});
