import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Who can view a dashboard is one choice on its Sharing page (also ⋯ ->
 * Share on the dashboard): only people in this project, anyone with the
 * link, or anyone with the link and a password, with the IP allowlist under
 * More settings. It used to be "Authentication", under Advanced, with an "Is
 * Visible to Public" switch, a "Master Password" card with a "Require Master
 * Password" switch, and an "IP Whitelist" card - and the English guides sent
 * readers to "Dashboard -> Settings" to "flip Public Dashboard on", which
 * never held any of it. Markdown is not compiled, so nothing else notices a
 * guide that still sends readers to the old screens.
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

const CHOICES: Array<string> = [
  "**Only people in this project**",
  "**Anyone with the link**",
  "**Anyone with the link and a password**",
];

function expectInOrder(text: string, parts: Array<string>): void {
  const positions: Array<number> = parts.map((part: string): number => {
    return text.indexOf(part);
  });

  for (const [index, position] of positions.entries()) {
    expect([parts[index], position >= 0]).toEqual([parts[index], true]);
  }

  expect(
    [...positions].sort((a: number, b: number) => {
      return a - b;
    }),
  ).toEqual(positions);
}

const OLD_WORDS: Array<string> = [
  "Is Visible to Public",
  "Require Master Password",
  "Set Master Password",
  "Master Password",
  "IP Whitelist",
  "IP whitelist",
  "Authentication Settings",
  "Dashboard Preview URL",
  "**Public Dashboard** switch",
  "flip **Public Dashboard** on",
  "Turn on **Public Dashboard**",
];

describe("the English sharing guide", () => {
  const page: string = readPage("en/dashboards/sharing.md");
  const section: string = sectionOf(page, "Who can view a dashboard");

  it("sends readers to Sharing, from the dashboard's ⋯ menu or its side menu", () => {
    expect(section).toContain(
      "Open the dashboard and pick **⋯ → Share**, or open **Sharing** in the dashboard's side menu. The **Who can view this dashboard** card is one choice:",
    );
  });

  it("lists the three choices in order, the default first", () => {
    const list: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("- **");
      });

    expect(
      list.map((line: string): string => {
        return line.slice(2, line.indexOf("**", 4) + 2);
      }),
    ).toEqual(CHOICES);
    expect(list[0]).toContain("(the default)");
  });

  it("says a choice asks first, the password is asked for in the same dialog, and where the link and Change Password are", () => {
    expect(section).toContain(
      "Picking a choice asks you to confirm, saying what changes for visitors, then applies at once.",
    );
    expect(section).toContain(
      "asks for the password in the same dialog when the dashboard has none; while it is the choice, **Change Password** replaces it.",
    );
    expect(section).toContain(
      "While the dashboard is public, its **Public link** sits under the choice, with a button that copies it.",
    );
  });

  it("says which choices need a plan, and which do not", () => {
    expect(section).toContain(
      "On OneUptime Cloud, sharing a dashboard needs the **Growth** plan",
    );
    expect(section).toContain(
      "Moving between **Anyone with the link** and **Anyone with the link and a password**, and changing the password, works on every plan.",
    );
  });

  it("says a dashboard can always be made private again, on any plan, and what sharing again takes", () => {
    expect(section).toContain(
      "Making a dashboard private again — **Only people in this project** — works on every plan",
    );
    expect(section).toContain(
      "the dialog says that sharing it again needs **Growth**",
    );
    expect(section).not.toContain("or making it private again, needs");
  });

  it("says what a choice stores, the rule the server keeps, and the locked state", () => {
    expect(section).toContain(
      "`isPublicDashboard`, `enableMasterPassword` and `masterPassword`",
    );
    expect(section).toContain(
      "Only a public dashboard has a public link, and its visitors are asked for the password whenever `enableMasterPassword` is on.",
    );
    expect(section).toContain(
      "A public dashboard with `enableMasterPassword` on but no password set lets nobody in through its public link",
    );
    expect(section).toContain("**Set Password**");
    expect(section).toContain(
      "Picking **Only people in this project** also turns `enableMasterPassword` off, and keeps the password",
    );
  });

  it("says someone who may not edit sees the choice and can copy the link", () => {
    expect(section).toContain(
      "Someone who can see the dashboard but not edit it sees the choice, and can copy the public link, but can't change it.",
    );
  });

  it("has the IP allowlist under More settings on Sharing, with its Scale plan", () => {
    const allowlist: string = sectionOf(page, "IP allowlist");

    expect(allowlist).toContain(
      "Under **More settings** on the **Sharing** page, the **IP Allowlist** section (the `ipWhitelist` column)",
    );
    expect(allowlist).toContain(
      "It saves on its own, apart from the choice, and changing it needs the **Scale** plan on OneUptime Cloud; emptying it works on every plan.",
    );
    expect(allowlist).toContain(
      "the folded **More settings** header shows **IP Allowlist** with the number of entries it holds",
    );
    expect(allowlist).not.toContain("**Configured**");
  });

  it("has the password section, named for the choice", () => {
    const password: string = sectionOf(page, "Sharing with a password");

    expect(password).toContain(
      "Pick **Anyone with the link and a password** and enter the password in the dialog.",
    );
    expect(password).toContain("up to 7 days");
  });

  it("keeps its custom domain section", () => {
    expect(page).toContain("\n## Custom domains\n");
  });

  /*
   * What a visitor sees before they may view the dashboard: the public
   * routes answer only for a dashboard the visitor may see (the server's
   * PublicDashboardAccess decision), and the guide says so.
   */
  it("says a private dashboard's address reads like an address no dashboard has", () => {
    expect(section).toContain(
      "its public address shows the same not-found page as an address no dashboard has, and nothing about the dashboard, not even its name.",
    );
  });

  it("says the password prompt shows the name, page title and favicon, and the rest waits for the password", () => {
    expect(sectionOf(page, "Sharing with a password")).toContain(
      "The prompt shows the dashboard's name, page title and favicon, and nothing else: its description, logo and widgets appear once the password is entered.",
    );
  });

  it("says an address the allowlist refuses sees nothing about the dashboard", () => {
    expect(sectionOf(page, "IP allowlist")).toContain(
      "Requests from any other IP are rejected with an **Access Denied** page that shows nothing about the dashboard: not its name, not its branding, and not its password prompt.",
    );
  });

  it("says which branding shows before a visitor may view the dashboard", () => {
    const branding: string = sectionOf(page, "Branding");

    expect(branding).toContain(
      "Visitors see the branding only once they may view the dashboard.",
    );
    expect(branding).toContain(
      "a dashboard shared with a password shows only its page title and favicon, and search engines and link previews see its page title but not its page description.",
    );
    expect(branding).toContain(
      "A dashboard with an IP allowlist shows its branding only to the addresses on the list, and search engines and link previews see none of it.",
    );
  });

  it("names branding's own page", () => {
    expect(sectionOf(page, "Branding")).toContain(
      "On the dashboard's **Branding** page, you can configure:",
    );
  });

  it.each(OLD_WORDS)("no longer names %s", (gone: string) => {
    expect(page).not.toContain(gone);
  });
});

describe("the English configuration guide", () => {
  const page: string = readPage("en/dashboards/configuration.md");
  const section: string = sectionOf(page, "Access for public dashboards");

  it("names Sharing and its three choices, in order", () => {
    expect(section).toContain(
      "is one choice on its **Sharing** page (also **⋯ → Share** on the dashboard itself;",
    );
    expectInOrder(section, CHOICES);
    expect(section).toContain("the **IP Allowlist** (Scale plan)");
  });

  it.each(OLD_WORDS)("no longer names %s", (gone: string) => {
    expect(page).not.toContain(gone);
  });
});

describe("the English dashboards overview", () => {
  const page: string = readPage("en/dashboards/index.md");

  it("maps Sharing in the page table, and Settings to what it holds", () => {
    const rows: Array<string> = page.split("\n").filter((line: string) => {
      return line.startsWith("| **Dashboard → ");
    });

    const sharing: string | undefined = rows.find((row: string) => {
      return row.startsWith("| **Dashboard → Sharing**");
    });
    const settings: string | undefined = rows.find((row: string) => {
      return row.startsWith("| **Dashboard → Settings**");
    });

    expect(sharing).toContain(
      "Who can view it, its public link, and an IP allowlist under More settings.",
    );
    expect(settings).toContain("Duplicate, export, or archive the dashboard.");
    expect(settings).not.toContain("Public sharing");
  });

  it("shares publicly from the dashboard's ⋯ menu, not a switch in Settings", () => {
    expect(page).toContain(
      "5. **(Optional) Share publicly** — pick **⋯ → Share** on the dashboard and choose who can view it",
    );
    expect(page).not.toContain("flip the switch in Settings");
  });

  it.each(OLD_WORDS)("no longer names %s", (gone: string) => {
    expect(page).not.toContain(gone);
  });
});
