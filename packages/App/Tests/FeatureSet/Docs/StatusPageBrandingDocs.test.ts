import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_STATUS_PAGE_LANGUAGES } from "Common/Types/StatusPage/StatusPageLanguage";
import StatusPageDisplaySettingsCopy, {
  DISPLAY_SECTIONS,
  DisplaySectionDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";

/*
 * A status page's branding is one Branding page now, where it was five
 * screens (Essential Branding, Header, Footer, Overview Page, Languages).
 * The English docs opened by warning that "branding is split across seven
 * separate screens, and the split is not always where you would guess",
 * with a map table so readers would "stop hunting". Markdown is not
 * compiled, so nothing else notices a page that still sends readers to a
 * screen that is gone.
 *
 * English only, as earlier changes to these pages did: the translated pages
 * still describe the old screens, whose URLs forward to the Branding page.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

function markdownFilesUnder(dir: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...markdownFilesUnder(entryPath));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

const BRANDING_PAGE: string = "en/status-pages/branding-and-domains.md";

// A row of a table whose first cell is a bold name: | **Branding** | ... |
const BOLD_TABLE_ROW: RegExp = /^\| \*\*[^*]+\*\* +\|/;

// A bold menu path through Branding to one of the screens that are gone.
const OLD_SCREEN_PATH: RegExp =
  /\*\*[^*\n]*Branding → (Essential Branding|Header|Footer|Overview Page|Languages)\*\*/;

describe("Status Page Branding & Domains (English)", () => {
  const page: string = readPage(BRANDING_PAGE);

  it("no longer says branding is split across separate screens", () => {
    expect(page).not.toContain("seven separate screens");
    expect(page).not.toContain("has seven items");
    expect(page).not.toContain("so you stop hunting");
  });

  it("maps the Branding section as its three pages, in the menu's order", () => {
    expect(page).toContain(
      "the side menu's **Branding** section has three items",
    );

    const rows: Array<string> = page
      .split("\n")
      .filter((line: string): boolean => {
        return BOLD_TABLE_ROW.test(line);
      })
      .slice(0, 3)
      .map((line: string): string => {
        return line.match(/^\| \*\*([^*]+)\*\*/)![1]!;
      });

    expect(rows).toEqual([
      "Branding",
      "Custom Domains",
      "HTML, CSS & JavaScript",
    ]);
  });

  it("walks the Branding page, at its own URL, card by card", () => {
    expect(page).toContain("## The Branding page");
    expect(page).toContain(
      "**Status Pages → your page → Branding → Branding** (`{id}/branding`)",
    );

    let previous: number = page.indexOf("## The Branding page");

    for (const heading of [
      "### Logo and cover image",
      "### Title, description and favicon",
      "### Header links",
      "### Overview page description",
      "### Footer",
      "### More settings",
    ]) {
      const at: number = page.indexOf(heading);

      expect([heading, at > previous]).toEqual([heading, true]);
      previous = at;
    }
  });

  it("says what the folded More settings section holds, and what its header shows folded", () => {
    const advanced: string = page.slice(
      page.indexOf("### More settings"),
      page.indexOf("## Uptime percent and downtime statuses"),
    );

    for (const card of [
      "**Default Bar Color of the History Chart**",
      "**Rules for Bar Colors of History Chart**",
      "**Languages**",
      "**Search Engine Indexing.**",
    ]) {
      expect([card, advanced.includes(card)]).toEqual([card, true]);
    }

    // Folded, its header names the four sections by the names the chips use.
    expect(advanced).toContain(
      "Folded, its header names its four sections — **Default Bar Color**, **Bar Color Rules**, **Languages** and **Search Engine Indexing** — and shows each one that differs from what a new status page starts with",
    );
    expect(advanced).not.toContain("**Configured**");
  });

  /*
   * "More Settings should look like one card instead of a card inside of a
   * card, and it should have dividers." - the maintainer.
   */
  it("says that, open, More settings is one card whose sections are parted by dividers", () => {
    const advanced: string = page.slice(
      page.indexOf("### More settings"),
      page.indexOf("## Uptime percent and downtime statuses"),
    );

    expect(advanced).toContain(
      "Click it to open it: it is one card, the four sections one under the other, each with its own title and button, separated by dividers.",
    );
    expect(advanced).not.toContain("four cards");
  });

  it("says search engine indexing saves when the switch is flipped, with no Edit button", () => {
    expect(page).toContain(
      "There is no **Edit** button: the switch saves the moment you flip it.",
    );
    expect(page).toContain(
      "**Allow Search Engines to Index this Status Page**",
    );
  });

  it("says the languages are one card and one dialog", () => {
    expect(page).toContain("**Edit Languages** opens two fields");
    expect(page).not.toContain("**Edit Default Language**");
    expect(page).not.toContain("**Edit Enabled Languages**");
  });

  it("names every language a status page ships in", () => {
    expect(SUPPORTED_STATUS_PAGE_LANGUAGES).toHaveLength(17);
    expect(page).toContain("Seventeen languages ship with OneUptime:");

    const sentence: string = page.split("\n").find((line: string): boolean => {
      return line.startsWith("Seventeen languages ship with OneUptime:");
    })!;

    for (const language of SUPPORTED_STATUS_PAGE_LANGUAGES) {
      expect([
        language.englishName,
        sentence.includes(language.englishName),
      ]).toEqual([language.englishName, true]);
    }
  });

  it("sends readers to Advanced Settings for the overall uptime % and the downtime statuses", () => {
    expect(page).toContain("## Uptime percent and downtime statuses");

    const section: string = page.slice(
      page.indexOf("## Uptime percent and downtime statuses"),
      page.indexOf("## Custom HTML, CSS and JavaScript"),
    );

    expect(section).toContain(
      "**Status Pages → your page → Advanced → Advanced Settings** (`{id}/settings`)",
    );
  });

  /*
   * The overall uptime % and the downtime statuses were two cards with an
   * Edit button each; they are rows of the "What your status page shows"
   * card's uptime row now, named here as the card names them.
   */
  it("describes the overall uptime % and the downtime statuses as rows of the card, with no Edit dialog", () => {
    const section: string = page.slice(
      page.indexOf("## Uptime percent and downtime statuses"),
      page.indexOf("## Custom HTML, CSS and JavaScript"),
    );

    const uptime: DisplaySectionDefinition = DISPLAY_SECTIONS.find(
      (candidate: DisplaySectionDefinition) => {
        return candidate.id === "uptime-history";
      },
    )!;

    for (const name of [
      StatusPageDisplaySettingsCopy.cardTitle,
      StatusPageDisplaySettingsCopy.uptimeTitle,
      uptime.options[0]!.title,
      StatusPageDisplaySettingsCopy.precisionLabel,
      StatusPageDisplaySettingsCopy.downtimeLabel,
    ]) {
      expect([name, section.includes(`**${name}**`)]).toEqual([name, true]);
    }

    expect(section).toContain("There is no **Edit** button");

    for (const gone of [
      "**Edit Statuses** opens",
      "**Edit Settings** opens",
      "**Select Uptime Precision**",
      "These monitor statuses are considered as down",
    ]) {
      expect([gone, section.includes(gone)]).toEqual([gone, false]);
    }
  });

  it("tells readers the old screens' addresses open the Branding page", () => {
    for (const oldPath of [
      "`{id}/header-style`",
      "`{id}/footer-style`",
      "`{id}/overview-page-branding`",
      "`{id}/languages`",
    ]) {
      expect([oldPath, page.includes(oldPath)]).toEqual([oldPath, true]);
    }

    expect(page).toContain("now open the **Branding** page");
  });

  it("says the only built-in colors are under More settings on the Branding page", () => {
    expect(page).toContain(
      "the only built-in color controls anywhere are **Default Bar Color** and the history chart bar color rules, under **More settings** on the **Branding** page",
    );
  });
});

describe("the rest of the English docs", () => {
  it("send nobody to a branding screen that is gone", () => {
    const pages: Array<string> = markdownFilesUnder(
      path.join(CONTENT_DIR, "en"),
    )
      .filter((file: string): boolean => {
        return OLD_SCREEN_PATH.test(fs.readFileSync(file, "utf8"));
      })
      .map((file: string): string => {
        return path.relative(CONTENT_DIR, file);
      });

    expect(pages).toEqual([]);
  });

  it("the status pages overview maps the Branding section as three entries", () => {
    const overview: string = readPage("en/status-pages/index.md");

    const row: string | undefined = overview
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("| **Branding** ");
      });

    expect(row).toContain("**Custom Domains**, **HTML, CSS & JavaScript**");
    expect(row).not.toContain("**Essential Branding**");
    expect(row).not.toContain("**Header**");
    expect(overview).toContain(
      "the **Default Bar Color** and the bar-color rules are under **More settings** on **Status Pages → your page → Branding → Branding**",
    );
  });

  it("the status pages overview puts the overall uptime % and the downtime statuses in the card's uptime row", () => {
    const overview: string = readPage("en/status-pages/index.md");

    expect(overview).toContain(
      "**Show Overall Uptime Percent** (`showOverallUptimePercentOnStatusPage`)",
    );
    expect(overview).toContain(
      "**Precision** (`overallUptimePercentPrecision`)",
    );
    expect(overview).toContain(
      "**Counts as downtime** (`downtimeMonitorStatuses`)",
    );
    expect(overview).not.toContain(
      "Below the card are **Overall Uptime Percent** and **Downtime Monitor Statuses**",
    );

    // Its precision saves on every plan, the switch needs Scale.
    expect(overview).toContain(
      'showing the overall uptime percent and hiding the "Powered by OneUptime" line need **Scale**',
    );
  });

  it("resources and groups no longer send readers to an Overview Page screen", () => {
    const resources: string = readPage(
      "en/status-pages/resources-and-groups.md",
    );

    expect(resources).not.toContain("**Overview Page** branding screen");
    expect(resources).not.toContain("**Downtime Monitor Statuses** card");
    expect(resources).toContain(
      "in **Counts as downtime**, in the **What your status page shows** card on **Advanced Settings**",
    );
    expect(resources).toContain(
      "The colors of the history chart bars are set under **More settings** on the **Branding** page",
    );
  });
});
