import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What turning an SSO provider off, deleting it or changing it does to the
 * people it signed in, as the English guides say it:
 *
 *   - a project's SAML or OIDC provider turned off or deleted ends the
 *     sign-ins it gave, on the API, on open pages' live updates and for MCP
 *     clients, and turning it on again does not bring them back
 *     (Common/Server/Utils/ProjectSsoProviderStanding);
 *   - a new certificate or client secret, other URLs, a new name or other
 *     teams keep everyone signed in;
 *   - a project that requires SSO keeps a way in: its last provider, or the
 *     one it requires, cannot be turned off or deleted
 *     (Common/Server/Utils/ProjectSsoProviderChanges);
 *   - a global provider turned off, deleted or restricted ends its sign-ins
 *     where it no longer signs people in, live updates included.
 *
 * Markdown is not compiled, so nothing else notices a guide that falls
 * behind. Other languages follow in the translated docs catch-up.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text of a "## " heading's section, up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const marker: string = `\n${heading}\n`;
  const start: number = page.indexOf(marker);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = page.slice(start + marker.length);
  const stops: Array<number> = ["\n# ", "\n## "]
    .map((stop: string): number => {
      return rest.indexOf(stop);
    })
    .filter((position: number): boolean => {
      return position >= 0;
    });

  return stops.length > 0 ? rest.slice(0, Math.min(...stops)) : rest;
}

describe("the SSO guide: turning a provider off or deleting it", () => {
  const page: string = readPage("en/identity/sso.md");
  const section: string = sectionOf(
    page,
    "## Turning a provider off or deleting it",
  );

  it("comes right after Requiring SSO for Your Project", () => {
    expect(page.indexOf("## Requiring SSO for Your Project")).toBeLessThan(
      page.indexOf("## Turning a provider off or deleting it"),
    );
    expect(
      page.indexOf("## Turning a provider off or deleting it"),
    ).toBeLessThan(page.indexOf("## Providers left below the Scale plan"));
  });

  it("says turning a provider off or deleting it ends its sign-ins, on requests and live updates alike", () => {
    expect(section).toContain(
      "Turning a SAML or OIDC provider off, or deleting it, ends the sign-ins it gave. In a project that requires SSO, itself or because the whole server does:",
    );
    expect(section).toContain(
      "- Anyone who signed in with it has to sign in with SSO again at their next request, and the pages they have open stop receiving live updates at once.",
    );
  });

  it("says MCP clients connected with such a sign-in stop, and how to connect them again", () => {
    expect(section).toContain(
      "- An MCP client someone connected after signing in with it stops working in the project. Connect it again after signing in with SSO.",
    );
  });

  it("says turning it on again does not bring the sign-ins back", () => {
    expect(section).toContain(
      "- Turning the provider on again does not bring those sign-ins back: people sign in with it again.",
    );
  });

  it("says a new certificate, secret, URLs, name or teams keep everyone signed in", () => {
    expect(section).toContain(
      "Changing anything else about a provider keeps everyone signed in: a new certificate or client secret, other URLs, a new name or other teams.",
    );
  });

  it("says a project that requires SSO keeps a way in", () => {
    expect(section).toContain(
      "While the project requires SSO, OneUptime keeps a way in: you cannot turn off or delete the last provider people can sign in to the project with, counting global providers that sign people in to it, or the provider the project requires. Turn off **Require SSO for Login** first.",
    );
  });

  it("says a server that requires SSO for everyone keeps a way in to each project too", () => {
    expect(section).toContain(
      "When the whole server requires SSO (**Admin** > **Settings** > **Authentication** > **Require SSO for Login**), every project keeps a way in the same way, even one that does not require SSO itself: turn on another provider for it first.",
    );
  });

  it("says what changes where SSO is not required", () => {
    expect(section).toContain(
      "Where neither the project nor the server requires SSO, turning a provider off stops new sign-ins with it.",
    );
  });

  it("no longer says turning the last provider off leaves nobody able to sign in", () => {
    expect(page).not.toContain(
      "turn it off before you turn the last provider off, or nobody can sign in with SSO any more.",
    );
  });
});

describe("the Global SSO guide: turning a provider off or deleting it", () => {
  const section: string = sectionOf(
    readPage("en/identity/global-sso.md"),
    "## Turning a provider off or deleting it",
  );

  it("says turning off, deleting or restricting ends the sign-ins where it no longer signs people in, live updates included", () => {
    expect(section).toContain(
      "Turning a global provider off, deleting it, or restricting it to its attached projects ends the sign-ins it gave where it no longer signs people in.",
    );
    expect(section).toContain(
      "the pages they have open stop receiving live updates at once,",
    );
  });

  it("says a new certificate or secret keeps everyone signed in", () => {
    expect(section).toContain(
      "A new certificate or client secret, other URLs or a new name keep everyone signed in.",
    );
  });
});

describe("the MCP server guide", () => {
  const page: string = readPage("en/ai/mcp-server.md");

  it("says a client connected with an SSO sign-in stops when its provider is turned off", () => {
    expect(page).toContain(
      "when it lapses, or the SSO provider you signed in with is turned off or deleted, connect the client again.",
    );
    expect(page).toContain(
      "or the project's SSO sign-in lapsed or its provider was turned off. Connect it again.",
    );
  });
});

describe("the upgrade notes", () => {
  // Markdown wraps the note's lines; read it as one line of text.
  const page: string = readPage("en/installation/upgrading.md").replace(
    /\s+/g,
    " ",
  );

  it("say what turning a project's SSO provider off now does, and link to the SSO guide", () => {
    expect(page).toContain(
      "**Turning a project's SSO provider off, or deleting it, ends the sign-ins it gave.**",
    );
    expect(page).toContain(
      "Turning the provider on again does not bring those sign-ins back, and a provider that is already off when you upgrade counts as turned off at the upgrade.",
    );
    expect(page).toContain(
      "A new certificate or client secret keeps everyone signed in.",
    );
    expect(page).toContain(
      "[SSO](/docs/identity/sso#turning-a-provider-off-or-deleting-it)",
    );
  });
});
