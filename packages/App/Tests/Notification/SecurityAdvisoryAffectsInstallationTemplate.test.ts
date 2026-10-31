import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import SecurityAdvisoryEmail, {
  MAX_ADVISORIES_IN_EMAIL,
  SecurityAdvisoryEmailContent,
  SecurityAdvisoryEmailData,
} from "Common/Server/Utils/UpdateCheck/SecurityAdvisoryEmail";
import Dictionary from "Common/Types/Dictionary";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import { SecurityAdvisorySeverity } from "Common/Types/UpdateCheck/SecurityAdvisory";
import { AffectingAdvisory } from "Common/Types/UpdateCheck/UpdateStatus";
import {
  decodeHtmlEntities,
  htmlAsText,
  visibleText,
} from "Common/Tests/Helpers/HtmlText";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real ifCond / ifNotCond / concat and brand
 * helpers on the shared Handlebars instance as a side effect of import, so
 * this suite renders with what MailService renders with. The partials are
 * registered from disk below.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * The email a self-hosted installation's owners get, once per advisory, when
 * a security advisory OneUptime published affects the version it runs. The
 * vars come from the real builder (SecurityAdvisoryEmail.build) and are
 * rendered as MailService renders them, so a var the template stops reading,
 * or a branch the builder never takes, fails here:
 *
 *   - the subject names the product, the version and how many advisories;
 *   - it says what is affected and the release that fixes it - or that none
 *     does yet - and lists each advisory with its severity, identifiers, the
 *     versions it affects and its fix;
 *   - its one link is the installation's own upgrade guide, with a copyable
 *     fallback; it links nothing outside the installation (EmailsLoadNothing
 *     FromOutside holds every template to that too);
 *   - everything an advisory says is plain text, escaped once.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

const UPGRADE_GUIDE: string =
  "https://oneuptime.acme.io/docs/installation/upgrading";

const advisory: (
  overrides?: Partial<AffectingAdvisory>,
) => AffectingAdvisory = (
  overrides?: Partial<AffectingAdvisory>,
): AffectingAdvisory => {
  return {
    ghsaId: "GHSA-9q6r-9h5m-572w",
    cveId: "CVE-2026-12345",
    summary: "Any user can read every user's TOTP secret",
    severity: SecurityAdvisorySeverity.High,
    url: "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-9q6r-9h5m-572w",
    publishedAt: "2026-08-10T00:00:00.000Z",
    affectedVersions: "<= 14.0.66",
    fixedIn: "14.0.67",
    ...(overrides || {}),
  };
};

const data: (
  overrides?: Partial<SecurityAdvisoryEmailData>,
) => SecurityAdvisoryEmailData = (
  overrides?: Partial<SecurityAdvisoryEmailData>,
): SecurityAdvisoryEmailData => {
  return {
    productName: "OneUptime",
    host: "oneuptime.acme.io",
    currentVersion: "14.0.60",
    recommendedVersion: "14.0.80",
    advisories: [advisory()],
    upgradeGuideUrl: UPGRADE_GUIDE,
    homeUrl: "https://oneuptime.acme.io/",
    ...(overrides || {}),
  };
};

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), "utf8");
}

function render(
  content: SecurityAdvisoryEmailContent,
  extraVars: Dictionary<string> = {},
): string {
  const vars: Dictionary<string | JSONObject> = {
    year: "2026",
    ...content.vars,
    ...extraVars,
  };

  return Handlebars.compile(
    templateSource(EmailTemplateType.SecurityAdvisoryAffectsInstallation),
  )(vars).toString();
}

function detailFields(html: string): Dictionary<string> {
  const fields: Dictionary<string> = {};

  for (const match of html.matchAll(
    /<p class="st-DetailCard-label"[^>]*>([^<]*)<\/p>\s*<div class="st-DetailCard-value"[^>]*>([^<]*)<\/div>/g,
  )) {
    fields[decodeHtmlEntities(match[1] ?? "").trim()] = decodeHtmlEntities(
      match[2] ?? "",
    ).trim();
  }

  return fields;
}

interface Row {
  title: string;
  details: string;
}

function advisoryRows(html: string): Array<Row> {
  return Array.from(
    html.matchAll(
      /<p style="margin: 0; font-size: 15px; line-height: 24px; font-weight: 600; color: #0f172a;">([^<]*)<\/p>\s*<p style="margin: 2px 0 0; font-size: 13px; line-height: 21px; color: #64748b;">([^<]*)<\/p>/g,
    ),
  ).map((match: RegExpMatchArray): Row => {
    return {
      title: decodeHtmlEntities(match[1] ?? "").trim(),
      details: decodeHtmlEntities(match[2] ?? "").trim(),
    };
  });
}

interface Anchor {
  href: string;
  text: string;
  isButton: boolean;
}

function anchors(html: string): Array<Anchor> {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(
    (match: RegExpMatchArray): Anchor => {
      const attributes: string = match[1] ?? "";

      return {
        href: decodeHtmlEntities(
          attributes.match(/\bhref="([^"]*)"/i)?.[1] ?? "",
        ),
        text: htmlAsText(match[2] ?? "").trim(),
        isButton: attributes.includes("st-Button-link"),
      };
    },
  );
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), "utf8"),
    );
  }
});

describe("the security advisory email", () => {
  test("is a template file of its own", () => {
    expect(
      fs.existsSync(
        Path.resolve(
          TEMPLATES_DIR,
          EmailTemplateType.SecurityAdvisoryAffectsInstallation,
        ),
      ),
    ).toBe(true);
  });

  test("its subject says what to do, the product, the version and the host", () => {
    expect(SecurityAdvisoryEmail.build(data()).subject).toBe(
      "ACTION REQUIRED: a security advisory affects OneUptime 14.0.60 on oneuptime.acme.io",
    );
    expect(
      SecurityAdvisoryEmail.build(
        data({
          advisories: [advisory(), advisory({ ghsaId: "GHSA-aaaa-bbbb-cccc" })],
          host: "",
        }),
      ).subject,
    ).toBe("ACTION REQUIRED: 2 security advisories affect OneUptime 14.0.60");
  });

  test("names an installation that goes by a name of its own by that name", () => {
    const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
      data({ productName: "Acme Watch" }),
    );

    expect(content.subject).toContain("Acme Watch 14.0.60");
    expect(content.subject).not.toContain("OneUptime");
    expect(String(content.vars["leadSentence"])).not.toContain("OneUptime");
    expect(String(content.vars["reasonSentence"])).toContain("Acme Watch");
  });

  test("is headed with its subject, and says what is affected and the release that fixes it", () => {
    const html: string = render(SecurityAdvisoryEmail.build(data()));
    const text: string = visibleText(html);

    expect(text).toContain(
      "ACTION REQUIRED: a security advisory affects OneUptime 14.0.60 on oneuptime.acme.io",
    );
    expect(text).toContain(
      "OneUptime 14.0.60 on oneuptime.acme.io is affected by a security advisory published for it. Upgrade to 14.0.80 to fix it.",
    );
    expect(text).toContain("Security Update");
  });

  test("lists the host, the version it runs and the release to upgrade to", () => {
    expect(detailFields(render(SecurityAdvisoryEmail.build(data())))).toEqual({
      "OneUptime Host:": "oneuptime.acme.io",
      "Running Version:": "14.0.60",
      "Upgrade To:": "14.0.80",
    });
  });

  test("lists each advisory: severity and summary, then its identifiers, what it affects and its fix", () => {
    const html: string = render(
      SecurityAdvisoryEmail.build(
        data({
          advisories: [
            advisory({ severity: SecurityAdvisorySeverity.Medium }),
            advisory({
              ghsaId: "GHSA-aaaa-bbbb-cccc",
              cveId: null,
              summary: "Unauthenticated workflow execution",
              severity: SecurityAdvisorySeverity.Critical,
              affectedVersions: null,
              fixedIn: null,
            }),
          ],
        }),
      ),
    );

    expect(advisoryRows(html)).toEqual([
      {
        title: "Critical: Unauthenticated workflow execution",
        details: "GHSA-aaaa-bbbb-cccc · No fixed release yet",
      },
      {
        title: "Medium: Any user can read every user's TOTP secret",
        details:
          "GHSA-9q6r-9h5m-572w · CVE-2026-12345 · Affects <= 14.0.66 · Fixed in 14.0.67",
      },
    ]);
  });

  test("with no release that fixes them, says so and draws no release to move to", () => {
    const content: SecurityAdvisoryEmailContent = SecurityAdvisoryEmail.build(
      data({ recommendedVersion: null }),
    );
    const html: string = render(content);

    expect(visibleText(html)).toContain("No release fixes it yet.");
    expect(detailFields(html)["Upgrade To:"]).toBeUndefined();
    expect(content.vars["badgeText"]).toBe("Security Advisory");
  });

  test("is critical when an advisory is critical or high, a warning otherwise", () => {
    expect(SecurityAdvisoryEmail.build(data()).vars["badgeType"]).toBe(
      "critical",
    );
    expect(
      SecurityAdvisoryEmail.build(
        data({
          advisories: [advisory({ severity: SecurityAdvisorySeverity.Low })],
        }),
      ).vars["badgeType"],
    ).toBe("warning");
  });

  test("lists at most MAX_ADVISORIES_IN_EMAIL, most severe first, and says how many more", () => {
    const many: Array<AffectingAdvisory> = Array.from(
      { length: MAX_ADVISORIES_IN_EMAIL + 5 },
      (_: unknown, index: number): AffectingAdvisory => {
        return advisory({
          ghsaId: `GHSA-aaaa-bbbb-${String(index).padStart(4, "0")}`,
          severity:
            index === 24
              ? SecurityAdvisorySeverity.Critical
              : SecurityAdvisorySeverity.Low,
        });
      },
    );

    const html: string = render(
      SecurityAdvisoryEmail.build(data({ advisories: many })),
    );
    const rows: Array<Row> = advisoryRows(html);

    expect(rows).toHaveLength(MAX_ADVISORIES_IN_EMAIL);
    expect(rows[0]!.details).toContain("GHSA-aaaa-bbbb-0024");
    expect(visibleText(html)).toContain(
      "...and 5 more. The Admin Dashboard lists them all.",
    );
  });

  test("links only to the installation's upgrade guide, as a button and a copyable link", () => {
    const html: string = render(SecurityAdvisoryEmail.build(data()));

    expect(
      anchors(html).filter((anchor: Anchor): boolean => {
        return anchor.href === UPGRADE_GUIDE;
      }),
    ).toEqual([
      { href: UPGRADE_GUIDE, text: "How to Upgrade", isButton: true },
      { href: UPGRADE_GUIDE, text: UPGRADE_GUIDE, isButton: false },
    ]);

    // GitHub's advisory pages are linked from the Admin Dashboard, not here.
    expect(html).not.toContain("github.com");
  });

  test("with no HOST, has no host row and no link to follow", () => {
    const html: string = render(
      SecurityAdvisoryEmail.build(data({ host: "", upgradeGuideUrl: "" })),
    );

    expect(detailFields(html)["OneUptime Host:"]).toBeUndefined();
    expect(
      anchors(html).filter((anchor: Anchor): boolean => {
        return anchor.text === "How to Upgrade";
      }),
    ).toEqual([]);
  });

  test("says why it was sent", () => {
    expect(visibleText(render(SecurityAdvisoryEmail.build(data())))).toContain(
      "You are receiving this email because you administer this OneUptime installation. Its master admins, and its admin notification email, are told once about each published security advisory that affects the version it runs.",
    );
  });

  test("writes whatever an advisory says as text, escaped once", () => {
    const html: string = render(
      SecurityAdvisoryEmail.build(
        data({
          advisories: [
            advisory({
              summary: '<img src=x onerror="alert(1)"> & {{subject}}',
              affectedVersions: "<= 1.0.0 & <script>",
            }),
          ],
        }),
      ),
    );

    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src");
    expect(html).not.toContain("&amp;amp;");
    expect(advisoryRows(html)[0]!.title).toBe(
      'High: <img src=x onerror="alert(1)"> & {{subject}}',
    );
  });
});
