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
  return Array.from(markdown.matchAll(DOCS_LINK_PATTERN), (match: RegExpMatchArray) => {
    return match[1]!;
  });
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
      const row: string | undefined = page
        .split("\n")
        .find((line: string) => {
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
      expect(headingSlugs(page).has("community-and-enterprise-edition-images")).toBe(
        true,
      );
    },
  );

  it("tells Docker Compose users on IS_ENTERPRISE_EDITION to switch images", () => {
    const page: string = readContent("en", "installation/upgrading");

    expect(page).toContain("**Docker Compose with `IS_ENTERPRISE_EDITION=true`:**");
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
    expect(unresolvedDocsLinks(readContent("en", "installation/upgrading"))).toEqual(
      [],
    );
  });
});

describe("Identity docs carry an edition note in every language", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s SSO, SCIM and global SSO pages link to the Enterprise Edition page",
    (lang: string) => {
      for (const page of ["identity/sso", "identity/scim", "identity/global-sso"]) {
        const content: string = readContent(lang, page);

        expect({ page: page, linked: content.includes(`](${PAGE_URL})`) }).toEqual(
          { page: page, linked: true },
        );
        expect(unresolvedDocsLinks(content)).toEqual([]);
      }

      for (const page of ["identity/sso", "identity/scim"]) {
        const intro: string = readContent(lang, page)
          .split("\n## ")[0]!;

        // The note sits in the introduction, above the first section.
        expect(intro).toContain(PAGE_URL);
        expect(intro).toContain("**Scale**");
      }
    },
  );
});
