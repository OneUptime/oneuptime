import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Adding a SAML provider asks for its name, sign-on URL, issuer and
 * certificate; the signature method (RSA-SHA256), the digest method
 * (SHA256) and the description are filled in under More fields
 * (Common/UI/Components/Sso/SamlProviderFormFields, and the services for API
 * callers), and the dialog with the Entity ID and Reply URL opens once the
 * provider is saved. Adding a SCIM connection asks for its name (and, in a
 * project, starts Default Teams on the members team); provisioning,
 * deprovisioning and push groups wait under More fields at their defaults.
 *
 * The guides told people to pick the two algorithms - quoting `RSA-SHA-256`,
 * a value the form never had - and to switch the SCIM options on. These pin
 * the guides to the forms, in every docs language:
 *
 *   - Project SSO: the set-up steps ask for the four, start Teams on the
 *     members team, say what More fields fills in, open the SSO Configuration
 *     dialog on save and say a new provider starts switched off; the
 *     identity provider walkthroughs no longer ask for the algorithms;
 *   - Global SSO: the SAML step says what is filled in under More fields, as the
 *     OIDC step does;
 *   - Status pages: SAML, like OIDC, has its methods filled in under More fields;
 *   - SCIM: the set-up steps ask for the name, and say the options start on
 *     (push groups off) under More fields.
 *
 * The English field names are read from the forms' and the models' own
 * sources, so a renamed field fails here rather than leaving the docs behind.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const SOURCES: Record<string, string> = {
  ssoFields: "Common/UI/Components/Sso/SsoProviderFormFields.ts",
  samlFields: "Common/UI/Components/Sso/SamlProviderFormFields.ts",
  samlDefaults: "Common/Types/SSO/SamlProviderDefaults.ts",
  signatureMethod: "Common/Types/SSO/SignatureMethod.ts",
  digestMethod: "Common/Types/SSO/DigestMethod.ts",
  projectScim: "Common/Models/DatabaseModels/ProjectSCIM.ts",
};

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

// "More fields" as each language's guides word the folded section.
const MORE_FIELDS: RegExp =
  /\*\*(More fields|Weitere Felder|Plus de champs|Más campos|Altri campi|Mais campos|Meer velden|Flere felter|Flere felt|Fler fält|Дополнительные поля|その他の項目|추가 필드|更多字段|更多欄位|और फ़ील्ड|فیلدهای بیشتر)\*\*/g;

function readSource(key: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, SOURCES[key]!), "utf8");
}

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

function titlesIn(source: string): Array<string> {
  const titles: Array<string> = [];
  const titlePattern: RegExp = /title:\s*"([^"]+)"/g;

  let match: RegExpExecArray | null = titlePattern.exec(source);

  while (match) {
    titles.push(match[1]!);
    match = titlePattern.exec(source);
  }

  return titles;
}

function moreFieldsCount(text: string): number {
  return (text.match(MORE_FIELDS) || []).length;
}

// The "## " sections of a page, in order.
function sectionsOf(page: string): Array<string> {
  return page.split(/\n(?=## )/);
}

// A numbered step's bullet lines: "N. **...**", then its "   - " lines.
function stepBullets(section: string, step: number): Array<string> {
  const lines: Array<string> = section.split("\n");
  const at: number = lines.findIndex((line: string): boolean => {
    return line.startsWith(`${step}. **`);
  });

  expect({ step, found: at >= 0 }).toEqual({ step, found: true });

  const bullets: Array<string> = [];

  for (let i: number = at + 1; i < lines.length; i++) {
    const line: string = lines[i]!;

    if (line === "" && bullets.length === 0) {
      continue;
    }

    if (!line.startsWith("   - ")) {
      break;
    }

    bullets.push(line);
  }

  return bullets;
}

// The "Setting Up SSO" section of identity/sso.md: the second "## ".
function ssoSetUp(language: string): string {
  return sectionsOf(readPage(language, "identity/sso"))[2]!;
}

// The SAML step of Global SSO's "Create a provider".
function globalSamlBullet(language: string): string {
  const lines: Array<string> = readPage(language, "identity/global-sso")
    .split("\n")
    .filter((line: string): boolean => {
      return line.trimStart().startsWith("- ") && line.includes("RSA-SHA256");
    });

  expect({ language, bullets: lines.length }).toEqual({
    language,
    bullets: 1,
  });

  return lines[0]!;
}

// A step heading such as "2. **Configure SCIM Settings**", on a line of its own.
const SECOND_STEP_HEADING: RegExp = /^2\. \*\*[^*]+\*\*\s*$/;

// SCIM's two set-up steps: the project's, then the status page's.
function scimSettingsSteps(language: string): Array<Array<string>> {
  const page: string = readPage(language, "identity/scim");
  const steps: Array<Array<string>> = [];
  const lines: Array<string> = page.split("\n");

  for (let i: number = 0; i < lines.length && steps.length < 2; i++) {
    if (SECOND_STEP_HEADING.test(lines[i]!) && lines[i + 1] === "") {
      const bullets: Array<string> = [];
      let j: number = i + 2;

      while (j < lines.length && lines[j]!.startsWith("   - ")) {
        bullets.push(lines[j]!);
        j++;
      }

      steps.push(bullets);
    }
  }

  expect({ language, steps: steps.length }).toEqual({ language, steps: 2 });

  return steps;
}

describe("the names and values the guides use", () => {
  it("are the SAML form's", () => {
    const titles: Array<string> = [
      ...titlesIn(readSource("ssoFields")),
      ...titlesIn(readSource("samlFields")),
    ];

    for (const title of [
      "Provider",
      "Sign-in",
      "Name",
      "Sign On URL",
      "Issuer",
      "Public Certificate",
      "Teams",
      "Enabled",
      "Signature Method",
      "Digest Method",
    ]) {
      expect({ title, inTheForm: titles.includes(title) }).toEqual({
        title,
        inTheForm: true,
      });
    }
  });

  it("are the SCIM columns'", () => {
    const titles: Array<string> = titlesIn(readSource("projectScim"));

    for (const title of [
      "Default Teams",
      "Auto Provision Users",
      "Auto Deprovision Users",
      "Enable Push Groups",
    ]) {
      expect({ title, inTheModel: titles.includes(title) }).toEqual({
        title,
        inTheModel: true,
      });
    }
  });

  it("and the methods the guides quote are the ones filled in", () => {
    expect(readSource("signatureMethod")).toContain('SHA256 = "RSA-SHA256"');
    expect(readSource("digestMethod")).toContain('SHA256 = "SHA256"');

    const defaults: string = readSource("samlDefaults");

    expect(defaults).toContain(
      "DEFAULT_SAML_SIGNATURE_METHOD: SignatureMethod =\n  SignatureMethod.SHA256;",
    );
    expect(defaults).toContain(
      "DEFAULT_SAML_DIGEST_METHOD: DigestMethod = DigestMethod.SHA256;",
    );
  });
});

describe("Project SSO: setting up a SAML provider", () => {
  it("in English: the four fields, the members team, More fields, then the dialog and Enabled, in order", () => {
    const section: string = ssoSetUp("en");

    const steps: Array<string> = [
      "**Create SSO**",
      "**Name**",
      "**Sign On URL**",
      "**Issuer**",
      "**Public Certificate**",
      "**Sign-in**",
      "**Teams** starts on your project's members team",
      "**More fields**",
      "**Signature Method** (`RSA-SHA256`)",
      "**Digest Method** (`SHA256`)",
      "**SSO Configuration**",
      "**View SSO Config**",
      "**Identifier (Entity ID)**",
      "**Reply URL (Assertion Consumer Service URL)**",
      "A new provider starts switched off",
      "**Enabled**",
    ];

    let at: number = -1;

    for (const step of steps) {
      const found: number = section.indexOf(step, at + 1);

      expect({ step, inOrder: found > at }).toEqual({ step, inOrder: true });
      at = found;
    }

    expect(section).not.toContain("Select the **Signature Algorithm**");
  });

  it("in English: the identity provider walkthroughs no longer ask for the algorithms", () => {
    const page: string = readPage("en", "identity/sso");

    expect(page).not.toContain("**Signature Algorithm**");
    expect(page).not.toContain("**Digest Algorithm**");
    expect(
      page.split(
        "   - **Signature Method** and **Digest Method**: already set under **More fields** (`RSA-SHA256` and `SHA256`)",
      ).length - 1,
    ).toBe(3);
    expect(page).toContain(
      "4. The **Signature Method** (`RSA-SHA256`) and **Digest Method** (`SHA256`) are already set under **More fields**; change them only if your identity provider signs differently",
    );
  });

  it.each(LANGUAGES)(
    "in %s: never quotes RSA-SHA-256, a value the form never had, and says More fields holds the methods",
    (language: string) => {
      const page: string = readPage(language, "identity/sso");
      const setUp: string = ssoSetUp(language);

      expect(page).not.toContain("RSA-SHA-256");
      expect(page.split("`RSA-SHA256`").length - 1).toBeGreaterThanOrEqual(3);

      // Step 2 says what More fields fills in.
      const fills: Array<string> = stepBullets(setUp, 2).filter(
        (bullet: string): boolean => {
          return bullet.includes("`RSA-SHA256`");
        },
      );

      expect(fills).toHaveLength(1);
      expect(moreFieldsCount(fills[0]!)).toBe(1);
      expect(fills[0]).toContain("`SHA256`");

      /*
       * Step 3: the dialog opens on save, the two values to copy, and the
       * provider starts off.
       */
      expect(stepBullets(setUp, 3)).toHaveLength(4);
    },
  );
});

describe("Global SSO: creating a SAML provider", () => {
  it("in English: the four fields, then what More fields fills in, then the provider's page", () => {
    const bullet: string = globalSamlBullet("en");

    for (const part of [
      "**Name**",
      "**Sign On URL**",
      "**Issuer**",
      "**Public Certificate**",
      "**More fields**",
      "**Signature Method** (`RSA-SHA256`)",
      "**Digest Method** (`SHA256`)",
      "`Sign in with`",
      "Saving opens the provider's page.",
    ]) {
      expect({ part, mentioned: bullet.includes(part) }).toEqual({
        part,
        mentioned: true,
      });
    }
  });

  it.each(LANGUAGES)(
    "in %s: the methods are filled in under More fields, no longer chosen",
    (language: string) => {
      const bullet: string = globalSamlBullet(language);

      expect(moreFieldsCount(bullet)).toBe(1);
      expect(bullet).toContain("`SHA256`");
      expect(bullet).toContain("`Sign in with`");
      // The old "leave the defaults (RSA-SHA256 / SHA256)" choice.
      expect(bullet).not.toContain("`RSA-SHA256` / `SHA256`");
    },
  );
});

describe("Status pages: the SSO page", () => {
  it("in English: SAML has its methods filled in under More fields, as OIDC has its endpoints", () => {
    const page: string = readPage("en", "status-pages/index");

    expect(page).toContain(
      "configures SAML: you enter the sign-on URL, issuer and x509 certificate, and the signature and digest methods are filled in under **More fields**.",
    );
    expect(page).not.toContain(
      "(sign-on URL, issuer, x509 certificate, signature and digest methods)",
    );
  });

  it.each(LANGUAGES)(
    "in %s: More fields is named for SAML and for OIDC",
    (language: string) => {
      const page: string = readPage(language, "status-pages/index");
      const sentence: string =
        page.split("\n").find((line: string) => {
          return line.includes("OpenID Connect") && line.includes("SCIM");
        }) || "";

      expect(moreFieldsCount(sentence)).toBe(2);
    },
  );
});

describe("SCIM: setting up a connection", () => {
  it("in English: the name and the members team, the options on under More fields, then the dialog", () => {
    const [project, statusPage] = scimSettingsSteps("en");

    expect(project).toEqual([
      "   - Enter a **Name**. **Default Teams** starts on your project's members team: new users are added to these teams",
      "   - Under **More fields**, **Auto Provision Users** (add users when they're assigned in your IdP) and **Auto Deprovision Users** (remove users when they're unassigned in your IdP) are on, and **Enable Push Groups** is off. Change them there if you need to",
      "   - Save. The dialog with the **SCIM Base URL** and **Bearer Token** for your IdP configuration opens straight away",
    ]);
    expect(statusPage).toEqual([
      "   - Enter a **Name**. Under **More fields**, **Auto Provision Users** (add private users when they're assigned in your IdP) and **Auto Deprovision Users** (delete private users when they're unassigned in your IdP) are on. Change them there if you need to",
      "   - Save. The dialog with the **SCIM Base URL** and **Bearer Token** for your IdP configuration opens straight away",
    ]);

    const page: string = readPage("en", "identity/scim");

    expect(page).not.toContain("Enable **Auto Provision Users**");
    expect(page).not.toContain(
      "**Auto Provision Users**: Enable to automatically create users",
    );
    expect(
      page.split(
        "   - **Default Teams**: starts on your project's members team; new users are added to these teams",
      ).length - 1,
    ).toBe(2);
  });

  it.each(LANGUAGES)(
    "in %s: both set-up steps name More fields, and the project's starts on the members team",
    (language: string) => {
      const [project, statusPage] = scimSettingsSteps(language);

      expect(project).toHaveLength(3);
      expect(statusPage).toHaveLength(2);
      expect(moreFieldsCount(project!.join("\n"))).toBe(1);
      expect(moreFieldsCount(statusPage!.join("\n"))).toBe(1);
    },
  );
});
