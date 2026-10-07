import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English guides say about global and status page SSO providers
 * ending their sign-ins, about changes that would leave a project with no
 * provider to sign in with, and about turning Require SSO for Login on:
 *
 *   - a global provider turned off or deleted ends its sign-ins, and turning
 *     it on again does not bring them back (Common/Server/Utils/
 *     SsoSignInsEnded);
 *   - a change to a global provider or its attachments that would strand a
 *     project that requires SSO is refused, naming the projects
 *     (Common/Server/Utils/GlobalSsoProviderChanges);
 *   - Require SSO for Login, for a project or for the whole server, needs a
 *     provider that signs people in (Common/Server/Utils/
 *     SsoRequirementChanges);
 *   - a status page provider turned off or deleted signs out the private
 *     users it signed in (StatusPagePrivateUserSessionService.addSignInRule).
 *
 * Markdown is not compiled, so nothing else notices a guide that falls
 * behind. Other languages follow in the translated docs catch-up.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text of a heading's section, up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const marker: string = `\n${heading}\n`;
  const start: number = page.indexOf(marker);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const level: number = heading.indexOf(" ");
  const rest: string = page.slice(start + marker.length);
  const stops: Array<number> = [];

  for (let hashes: number = 1; hashes <= level; hashes++) {
    const position: number = rest.indexOf(`\n${"#".repeat(hashes)} `);

    if (position >= 0) {
      stops.push(position);
    }
  }

  return stops.length > 0 ? rest.slice(0, Math.min(...stops)) : rest;
}

describe("the Global SSO guide", () => {
  const page: string = readPage("en/identity/global-sso.md");

  describe("turning a provider off or deleting it", () => {
    const section: string = sectionOf(
      page,
      "## Turning a provider off or deleting it",
    );

    it("says turning it on again does not bring the sign-ins back, and that providers off at the upgrade count as turned off then", () => {
      expect(section).toContain(
        "Turning the provider on again does not bring those sign-ins back: people sign in with it again. A provider that was already off when you upgraded counts as turned off at the upgrade.",
      );
    });

    it("says MCP clients connected with such a sign-in stop", () => {
      expect(section).toContain(
        "an MCP client someone connected after signing in with it stops working in the project.",
      );
    });
  });

  describe("every project that requires SSO keeps a way in", () => {
    const section: string = sectionOf(
      page,
      "### Every project that requires SSO keeps a way in",
    );

    it("lists the changes that are refused, provider and attachment alike", () => {
      expect(section).toContain(
        "- turning a global provider off, deleting it, or restricting it to its attached projects;",
      );
      expect(section).toContain(
        "- for a provider restricted to its attached projects: attaching its first project (until then it signs people in to every project), turning an attachment off, moving it to another project or provider, or removing it.",
      );
    });

    it("says the refusal names the projects, and what to do first", () => {
      expect(section).toContain(
        "The message names the projects, or the first few and how many there are. Turn on another provider for them first, one of their own or a global one, or turn off **Require SSO for Login** there.",
      );
    });

    it("says changes that let a provider sign more people in are never refused", () => {
      expect(section).toContain(
        "Changes that let a provider sign more people in - turning it or an attachment on, lifting the restriction - are never refused.",
      );
    });
  });

  describe("enforcing SSO", () => {
    const section: string = sectionOf(page, "## Enforcing SSO");

    it("says turning the instance-wide switch on needs a provider for every project, naming those without one", () => {
      expect(section).toContain(
        "Turning **Require SSO for Login** on needs an SSO provider that signs people in, so nobody is locked out by it:",
      );
      expect(section).toContain(
        "While a project has none, turning the switch on is refused, and the message names the projects (or, when there are many, the first few and how many). Turn on a global provider, or a provider in those projects, first.",
      );
    });

    it("keeps master admins exempt, and turning it off never refused", () => {
      expect(section).toContain(
        "Master admins remain exempt so they cannot be locked out.",
      );
      expect(section).toContain("Turning it off is never refused.");
    });
  });
});

describe("the SSO guide", () => {
  const page: string = readPage("en/identity/sso.md");

  it("says requiring SSO for a project needs a provider that signs people in to it", () => {
    const section: string = sectionOf(
      page,
      "## Requiring SSO for Your Project",
    );

    expect(section).toContain(
      "Turning **Require SSO for Login** on needs a provider that signs people in to the project: one of its own SAML or OIDC providers that is on, or a global provider that is on and signs people in to it.",
    );
    expect(section).toContain(
      "If you pick a provider the project requires, it has to be one of those, and the same is asked when you require another provider later.",
    );
  });

  it("points to the global providers' rule", () => {
    const section: string = sectionOf(
      page,
      "## Turning a provider off or deleting it",
    );

    expect(section).toContain(
      "[Global SSO](/docs/identity/global-sso#turning-a-provider-off-or-deleting-it)",
    );
  });
});

describe("the status pages guide", () => {
  const section: string = sectionOf(
    readPage("en/status-pages/index.md"),
    "### SSO and OIDC",
  );

  it("says turning a provider off or deleting it signs out the private users it signed in", () => {
    expect(section).toContain(
      "Turning a status page's SSO or OIDC provider off, or deleting it, signs out the private users it signed in: their sessions end at their next request, and turning the provider on again does not bring them back - they sign in with it again.",
    );
  });

  it("says a page that requires SSO keeps only sessions a provider signed in", () => {
    expect(section).toContain(
      "While it is on, a private user signed in with an email and password is signed out at their next request too: only sessions an SSO or OIDC provider signed in count.",
    );
  });
});

describe("the upgrade notes", () => {
  // Markdown wraps the note's lines; read it as one line of text.
  const page: string = readPage("en/installation/upgrading.md").replace(
    /\s+/g,
    " ",
  );

  it("say what changes for global and status page providers and for Require SSO for Login, and link to the guides", () => {
    expect(page).toContain(
      "**Global and status page SSO providers end their sign-ins the same way, and turning on Require SSO for Login needs a provider.**",
    );
    expect(page).toContain(
      "Turning on Require SSO for Login, for a project or for the whole server, is refused while no provider would sign people in there; the message says what to set up first.",
    );
    expect(page).toContain(
      "Private users whom only SSO ever signed in sign in once more after the upgrade.",
    );
    expect(page).toContain(
      "[Global SSO](/docs/identity/global-sso#turning-a-provider-off-or-deleting-it)",
    );
    expect(page).toContain("[Status Pages](/docs/status-pages/index#sso-and-oidc)");
  });
});
