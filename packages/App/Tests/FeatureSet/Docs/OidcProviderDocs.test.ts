import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding an OpenID Connect provider asks for its name, issuer URL, client ID
 * and secret; the discovery URL, scopes, claim names and description are
 * filled in under More fields (Common/UI/Components/Sso/OidcProviderFormFields,
 * and the services for API callers). The guides told people to type all of
 * them in, so these pin the guides to the forms, in every docs language:
 *
 *   - Global SSO: the OIDC step asks for the four, says what is filled in
 *     under More fields, and no longer asks for scopes "that must include
 *     openid";
 *   - Status pages: the OIDC page asks for the issuer, client ID and
 *     secret, with the rest filled in;
 *   - Project SSO gains an OpenID Connect section: the four fields, the
 *     members team, the redirect URI dialog, Enabled starting off, and the
 *     test link.
 *
 * The English field and step titles are read from the form's own source, so
 * a renamed field fails here rather than leaving the docs behind.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const SSO_FIELDS_SOURCE: string = path.join(
  REPO_ROOT,
  "Common/UI/Components/Sso/SsoProviderFormFields.ts",
);
const OIDC_FIELDS_SOURCE: string = path.join(
  REPO_ROOT,
  "Common/UI/Components/Sso/OidcProviderFormFields.ts",
);
const OIDC_DEFAULTS_SOURCE: string = path.join(
  REPO_ROOT,
  "Common/Types/SSO/OidcProviderDefaults.ts",
);

const LANGUAGES: ReadonlyArray<string> = [
  "en",
  "fa",
  "da",
  "de",
  "es",
  "fr",
  "hi",
  "it",
  "ja",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

function titlesIn(file: string): Array<string> {
  const source: string = fs.readFileSync(file, "utf8");
  const titles: Array<string> = [];
  const titlePattern: RegExp = /title:\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = titlePattern.exec(source);

  while (match) {
    titles.push(match[1]!);
    match = titlePattern.exec(source);
  }

  return titles;
}

// The text of one "## " section of a page, up to the next one.
function sectionOf(page: string, heading: string): string {
  const start: number = page.indexOf(`\n## ${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const next: number = page.indexOf("\n## ", start + 1);

  return page.slice(start, next < 0 ? undefined : next);
}

// The OIDC bullet of Global SSO's "Create a provider" step.
function globalOidcBullet(language: string): string {
  const page: string = readPage(language, "identity/global-sso");
  const lines: Array<string> = page.split("\n").filter((line: string) => {
    return (
      line.trimStart().startsWith("- ") &&
      line.includes("/.well-known/openid-configuration")
    );
  });

  expect({ language, bullets: lines.length }).toEqual({
    language,
    bullets: 1,
  });

  return lines[0]!;
}

describe("the names the guides use", () => {
  it("are the form's", () => {
    const titles: Array<string> = [
      ...titlesIn(SSO_FIELDS_SOURCE),
      ...titlesIn(OIDC_FIELDS_SOURCE),
    ];

    for (const title of [
      "Provider",
      "Sign-in",
      "Name",
      "Issuer URL",
      "Client ID",
      "Client Secret",
      "Teams",
      "Enabled",
      "Discovery URL",
      "Scopes",
    ]) {
      expect({ title, inTheForm: titles.includes(title) }).toEqual({
        title,
        inTheForm: true,
      });
    }
  });

  it("and the defaults the guides quote are the ones filled in", () => {
    const defaults: string = fs.readFileSync(OIDC_DEFAULTS_SOURCE, "utf8");

    expect(defaults).toContain(
      'OIDC_DISCOVERY_PATH: string = "/.well-known/openid-configuration"',
    );
    expect(defaults).toContain(
      'DEFAULT_OIDC_SCOPES: string = "openid email profile"',
    );
    expect(defaults).toContain(
      'DEFAULT_OIDC_EMAIL_CLAIM_NAME: string = "email"',
    );
    expect(defaults).toContain('DEFAULT_OIDC_NAME_CLAIM_NAME: string = "name"');
  });
});

describe("Global SSO: creating an OIDC provider", () => {
  it("in English: the four fields, then what More fields fills in", () => {
    const bullet: string = globalOidcBullet("en");

    for (const field of [
      "**Name**",
      "**Issuer URL**",
      "**Client ID**",
      "**Client Secret**",
      "**More fields**",
      "**Discovery URL**",
      "**Scopes**",
      "`openid email profile`",
      "`email`",
      "`name`",
    ]) {
      expect({ field, mentioned: bullet.includes(field) }).toEqual({
        field,
        mentioned: true,
      });
    }

    expect(bullet).toContain("discovery URL into **Issuer URL**");
    expect(bullet).toContain("Saving opens the provider's page.");
  });

  it.each(LANGUAGES)(
    "in %s: says what is filled in, and no longer asks for scopes that must include openid",
    (language: string) => {
      const bullet: string = globalOidcBullet(language);

      expect(bullet).toContain("`openid email profile`");
      expect(bullet).not.toMatch(/\(must include `openid`\)|`openid`[^`]*\)/);

      const page: string = readPage(language, "identity/global-sso");

      expect(page).not.toContain("must include `openid`");
    },
  );
});

describe("Status pages: the OIDC page", () => {
  it("in English: asks for the issuer, client ID and secret, and fills in the rest", () => {
    const page: string = readPage("en", "status-pages/index");

    expect(page).toContain(
      "configures OpenID Connect: you enter the issuer, client ID and secret, and the discovery URL, scopes and claim names are filled in under **More fields**.",
    );
    expect(page).not.toContain(
      "(discovery URL, issuer, client ID and secret, scopes, claim names)",
    );
  });

  it.each(LANGUAGES)(
    "in %s: the rest is filled in under More fields",
    (language: string) => {
      const page: string = readPage(language, "status-pages/index");
      const sentence: string =
        page.split("\n").find((line: string) => {
          return line.includes("OpenID Connect") && line.includes("SCIM");
        }) || "";

      // More fields, as the reader's dashboard words it.
      expect(sentence).toMatch(
        /\*\*(More fields|Weitere Felder|Plus de champs|Más campos|Altri campi|Mais campos|Meer velden|Flere felter|Flere felt|Fler fält|Дополнительные поля|その他の項目|추가 필드|更多字段|更多欄位|और फ़ील्ड|فیلدهای بیشتر)\*\*/,
      );
    },
  );
});

describe("Project SSO: the OpenID Connect section", () => {
  it("in English: the whole setup, in order", () => {
    const section: string = sectionOf(
      readPage("en", "identity/sso"),
      "OpenID Connect (OIDC)",
    );

    const steps: Array<string> = [
      "**Project Settings** > **Security** > **OIDC**",
      "**Create OIDC**",
      "**Name**",
      "**Issuer URL**",
      "**Client ID**",
      "**Client Secret**",
      "**Sign-in**",
      "**Teams** starts on your project's members team",
      "**More fields**",
      "`/.well-known/openid-configuration`",
      "`openid email profile`",
      "**OIDC Configuration**",
      "**Redirect URI**",
      "**Enabled**",
      "**Test OpenID Connect (OIDC)**",
    ];

    let at: number = -1;

    for (const step of steps) {
      const found: number = section.indexOf(step, at + 1);

      expect({ step, inOrder: found > at }).toEqual({ step, inOrder: true });
      at = found;
    }

    expect(section).toContain("A new provider starts switched off");
  });

  it.each(LANGUAGES)(
    "in %s: is there, before the closing notes on roles",
    (language: string) => {
      const page: string = readPage(language, "identity/sso");
      const at: number = page.indexOf("\n## OpenID Connect (OIDC)\n");

      expect(at).toBeGreaterThan(0);
      // Exactly once.
      expect(page.indexOf("\n## OpenID Connect (OIDC)\n", at + 1)).toBe(-1);

      const section: string = sectionOf(page, "OpenID Connect (OIDC)");

      expect(section).toContain("`/.well-known/openid-configuration`");
      expect(section).toContain("`openid email profile`");
      expect(section).toContain("**OIDC**");

      // Six steps.
      expect(section.match(/^\d\. /gm)).toHaveLength(6);

      // The notes on SAML roles still close the page.
      expect(page.lastIndexOf("\n## ")).toBeGreaterThan(at);
    },
  );
});
