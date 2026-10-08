import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "If you look at More Settings, it looks like a card inside of a card. ...
 * More Settings should look like one card instead of a card inside of a
 * card, and it should have dividers." - the maintainer.
 *
 * The English docs that walk through what a page folds under More settings
 * called each thing in it a card. Open, More settings is one card now and
 * each of them is a section of it, so the docs say so. Markdown is not
 * compiled: nothing else notices a page that still describes cards inside
 * a card. English only, as earlier changes to these pages were.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content/en",
);

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

describe("AI SRE: the limits folded under More settings", () => {
  const page: string = readPage("ai/ai-sre.md");

  it("calls what the AI settings pages fold under More settings sections, each with its own Edit", () => {
    expect(page).toContain(
      "in three sections that each edit on one page: **Which incidents are investigated**",
    );
    expect(page).not.toContain("in three cards that each edit on one page");
  });

  it("says that, open, More settings is one card whose sections are parted by dividers", () => {
    expect(page).toContain(
      "Open, it is one card: each table and each set of limits is a section of it, with its own title and **Edit** or **Create** button, separated from the next by a divider.",
    );
  });

  it("says what the folded header names, and shows the table or section a set rule or limit is in", () => {
    expect(page).toContain(
      "Folded, **More settings** names the two rules tables and the three sections and says what the defaults do",
    );
    expect(page).toContain("shows the table or section that holds it.");
  });

  it("places the project's own daily limits in More settings' Daily limits section", () => {
    expect(page).toContain(
      "folded under **More settings**, in its **Daily limits** section:",
    );
    expect(page).not.toContain("in the **Daily limits** card:");
  });
});

describe("the IP allowlists folded under More settings", () => {
  it("on a status page's Access, it is a section", () => {
    const page: string = readPage("status-pages/index.md");

    expect(page).toContain(
      "Under **More settings** on **Access**, the **IP Allowlist** section",
    );
    expect(page).not.toContain("the **IP Allowlist** card");
  });

  it("on a dashboard's Sharing, it is a section", () => {
    const page: string = readPage("dashboards/sharing.md");

    expect(page).toContain(
      "Under **More settings** on the **Sharing** page, the **IP Allowlist** section",
    );
    expect(page).not.toContain("the **IP Allowlist** card");
  });
});
