import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Who can see a status page is one choice on its Security -> Access page:
 * anyone with the link, only people who sign in, or anyone with the
 * password. It used to be "Authentication Settings", with an "Is Visible to
 * Public" switch, a "Master Password" card with a "Require Master Password"
 * switch, and an "IP Whitelist" card - and the SSO page's "Force SSO for
 * Login" card. The English status pages guide describes the page as it is
 * now; markdown is not compiled, so nothing else notices a guide that still
 * sends readers to the old screens.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text of a "## " section, up to the next one.
function sectionOf(page: string, heading: string): string {
  const start: number = page.indexOf(`\n## ${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = page.slice(start + heading.length + 5);
  const end: number = rest.indexOf("\n## ");

  return end >= 0 ? rest.slice(0, end) : rest;
}

const GUIDE: string = "en/status-pages/index.md";

describe("the English status pages guide", () => {
  const page: string = readPage(GUIDE);
  const section: string = sectionOf(page, "Restricting who can see the page");

  it("keeps its anchor, which other guides link to", () => {
    expect(page).toContain("\n## Restricting who can see the page\n");
    expect(
      readPage("en/status-pages/one-status-page-per-audience.md"),
    ).toContain("(/docs/status-pages/index#restricting-who-can-see-the-page)");
  });

  it("sends readers to Access, and lists the three choices in order", () => {
    expect(section).toContain(
      "**Status Pages → your page → Security → Access**, **Who can see this status page**",
    );

    const choices: Array<number> = [
      "- **Anyone with the link**",
      "- **Only people who sign in**",
      "- **Anyone with the password**",
    ].map((choice: string): number => {
      return section.indexOf(choice);
    });

    for (const position of choices) {
      expect(position).toBeGreaterThan(0);
    }

    expect(
      [...choices].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(choices);
  });

  it("says what a choice stores, and the rule the server keeps", () => {
    expect(section).toContain(
      "`isPublicStatusPage`, `enableMasterPassword` and `masterPassword`",
    );
    expect(section).toContain(
      "Visitors are asked for the password only on a page that is not public, with `enableMasterPassword` on and a password set; a private page with the switch on but no password is a sign-in page.",
    );
    expect(section).toContain(
      "Picking **Anyone with the link** also turns `enableMasterPassword` off",
    );
  });

  it("says which choices need a plan, and which do not", () => {
    expect(section).toContain(
      "On OneUptime Cloud, making a page private needs the **Growth** plan",
    );
    expect(section).toContain(
      "Moving between **Only people who sign in** and **Anyone with the password** works on every plan",
    );
  });

  it("says a page can always be made public again, on any plan, and what making it private again takes", () => {
    expect(section).toContain(
      "Making it public again — **Anyone with the link** — works on every plan",
    );
    expect(section).toContain(
      "the dialog says that making it private again needs **Growth**",
    );
    expect(section).not.toContain("or public again, needs");
  });

  it("names Change Password, and asks for the password in the same dialog", () => {
    expect(section).toContain("**Change Password**");
    expect(section).toContain(
      "Picking it asks for the password in the same dialog when the page has none",
    );
  });

  it("describes Require SSO for Login as a switch that asks first", () => {
    expect(section).toContain(
      "the **SSO Settings** card holds the **Require SSO for Login** switch (`requireSsoForLogin`, off by default), which saves the moment you flip it.",
    );
    expect(section).toContain(
      "from then on private users can't sign in with an email and password",
    );
  });

  it("has the IP allowlist under More settings, with its Scale plan", () => {
    expect(section).toContain("\n### IP allowlist\n");
    expect(section).toContain(
      "Under **More settings** on **Access**, the **IP Allowlist** section (the `ipWhitelist` column)",
    );
    expect(section).toContain(
      "While the list is in force, the folded **More settings** header shows **IP Allowlist** with the number of entries it holds.",
    );
    expect(section).toContain(
      "changing it needs the **Scale** plan; emptying it works on every plan.",
    );
  });

  it("keeps the SSO, OIDC and SCIM paragraph whole", () => {
    expect(section).toContain("\n### SSO and OIDC\n");
    expect(section).toContain(
      "configures SAML: you enter the sign-on URL, issuer and x509 certificate",
    );
  });

  it("maps the Security section with Access first", () => {
    const row: string | undefined = page
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| **Security** ");
      });

    expect(row).toContain(
      "**Access** (who can see the page), **Private Users**, **SSO**, **OIDC**, **SCIM**.",
    );
  });

  it.each([
    "Authentication Settings",
    "Is Visible to Public",
    "Require Master Password",
    "Force SSO for Login",
    "IP Whitelist",
    "IP whitelist",
    "Three ways to make it private",
  ])("no longer names %s", (gone: string) => {
    expect(page).not.toContain(gone);
  });
});
