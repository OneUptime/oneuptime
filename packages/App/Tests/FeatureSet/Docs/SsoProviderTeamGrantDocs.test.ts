import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A project's SSO and SCIM providers are saved only with teams the person
 * saving them could invite someone to (Common/Server/Utils
 * /SsoProviderTeamGrant), and a SCIM connection, which can add people to any
 * team, only by a project owner - who alone may see its bearer token. The
 * guides say so where people set them up, in every docs language:
 *
 *   - Project SSO, SAML: the Teams bullet of the set-up steps;
 *   - Project SSO, OIDC: step 4, which picks the teams;
 *   - the closing notes: why, that every save checks again, that providers
 *     saved earlier keep working, and that anyone who may edit a provider
 *     can still switch it off;
 *   - SCIM: before the project set-up steps, who may add or change a
 *     connection or see its token, and why.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

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

// The "## " sections of a page, in order.
function sectionsOf(page: string): Array<string> {
  return page.split(/\n(?=## )/);
}

// The SAML set-up's Teams bullet: the one before the bullet with the methods.
function samlTeamsBullet(language: string): string {
  const lines: Array<string> = sectionsOf(
    readPage(language, "identity/sso"),
  )[2]!.split("\n");
  const methods: number = lines.findIndex((line: string): boolean => {
    return line.includes("`RSA-SHA256`");
  });

  expect({ language, found: methods > 0 }).toEqual({ language, found: true });

  return lines[methods - 1]!;
}

function oidcStepFour(language: string): string {
  const page: string = readPage(language, "identity/sso");
  const section: string = sectionsOf(
    page.slice(page.indexOf("\n## OpenID Connect (OIDC)\n") + 1),
  )[0]!;

  return (
    section.split("\n").find((line: string): boolean => {
      return line.startsWith("4. ");
    }) || ""
  );
}

// The paragraphs of the page's last section, after its heading.
function closingParagraphs(language: string): Array<string> {
  const page: string = readPage(language, "identity/sso");
  const last: string = page.slice(page.lastIndexOf("\n## ") + 1);

  return last
    .split(/\n\s*\n/)
    .slice(1)
    .map((paragraph: string): string => {
      return paragraph.trim();
    })
    .filter((paragraph: string): boolean => {
      return paragraph.length > 0;
    });
}

// What the SCIM page says before the project set-up's first step.
function scimLeadIn(language: string): string {
  const lines: Array<string> = readPage(language, "identity/scim").split("\n");
  const firstStep: number = lines.findIndex((line: string): boolean => {
    return line.startsWith("1. **");
  });

  expect({
    language,
    heading: lines[firstStep - 4]?.startsWith("### "),
  }).toEqual({ language, heading: true });

  return lines[firstStep - 2]!;
}

function boldTermsOf(line: string): Array<string> {
  return Array.from(line.matchAll(/\*\*([^*]+)\*\*/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

describe("in English", () => {
  it("the SAML set-up's Teams bullet says which teams are accepted", () => {
    expect(samlTeamsBullet("en")).toBe(
      "   - On the **Sign-in** step, **Teams** starts on your project's members team: people who sign in for the first time join these teams. Only teams you could invite someone to are accepted: a team that gives more access than you have is named under **Teams**",
    );
  });

  it("the OIDC step that picks the teams says the same", () => {
    expect(oidcStepFour("en")).toContain(
      " Only teams you could invite someone to are accepted: a team that gives more access than you have is named under **Teams**.",
    );
  });

  it("the closing notes say why, that every save checks again, that earlier providers keep working, and that a provider can always be switched off", () => {
    expect(closingParagraphs("en")).toContain(
      "A provider's teams decide what people who sign in with it can do, so a provider is saved only with teams the person saving it could invite someone to. Every save checks them again: a provider whose teams give more access than you have can only be changed by someone whose access covers them, such as a project owner. Providers saved before this check keep signing people in to their teams. Anyone who may edit a provider can still switch it off, so it can be stopped at once.",
    );
  });

  it("the SCIM page says who may add or change a connection, and why, before the steps", () => {
    expect(scimLeadIn("en")).toBe(
      "Only a project owner can add or change a project's SCIM connection, or see or reset its bearer token: through SCIM, your identity provider can add people to any team in the project.",
    );
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  it("the SAML Teams bullet names the Teams field again, in the rule it adds", () => {
    const terms: Array<string> = boldTermsOf(samlTeamsBullet(language));

    // The step, the field, and the field again.
    expect(terms).toHaveLength(3);
    expect(terms[2]).toBe(terms[1]);
  });

  it("the OIDC step 4 names the Teams field again, in the rule it ends with", () => {
    const terms: Array<string> = boldTermsOf(oidcStepFour(language));
    const teams: string = boldTermsOf(samlTeamsBullet(language))[1]!;

    expect(
      terms.filter((term: string): boolean => {
        return term === teams;
      }),
    ).toHaveLength(2);
    expect(terms[terms.length - 1]).toBe(teams);
  });

  it("the closing notes have the provider-teams paragraph after the note on roles", () => {
    const paragraphs: Array<string> = closingParagraphs(language);

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]!.length).toBeGreaterThan(100);
  });

  it("the SCIM page names SCIM twice before the project set-up steps", () => {
    const leadIn: string = scimLeadIn(language);

    expect(leadIn).not.toMatch(/^\d\. /);
    // The connection, and what SCIM lets the identity provider do.
    expect(leadIn.split("SCIM").length - 1).toBe(2);
    expect(boldTermsOf(leadIn)).toHaveLength(0);
  });
});
