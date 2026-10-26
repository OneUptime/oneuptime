import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_STATUS_PAGE_LANGUAGES } from "Common/Types/StatusPage/StatusPageLanguage";
import {
  ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY,
  HistoryChartBarColorRuleValues,
  RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES,
} from "Common/Utils/StatusPage/HistoryChartBarColors";
import StatusPageDisplaySettingsCopy, {
  DISPLAY_SECTIONS,
  DisplaySectionDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageDisplaySettingsCopy";
import StatusPageThemeCopy, {
  STATUS_PAGE_THEME_CHOICES,
  StatusPageThemeChoice,
} from "../../../FeatureSet/Dashboard/src/Components/StatusPage/StatusPageThemeCopy";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageTheme, {
  NEW_STATUS_PAGE_THEME,
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_COLUMN,
} from "Common/Types/StatusPage/StatusPageTheme";

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

// A row of the Theme table: | **Light** | The light page, ... |
const THEME_CHOICE_ROW: RegExp = /^\| \*\*([^*]+)\*\* \|/;

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
      "### Theme",
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
      "**Default Bar Color**",
      "**Bar Color Rules**",
      "**Bar Color Preview**",
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
      "Click it to open it: it is one card, its sections one under the other, each with its own title, separated by dividers.",
    );
    expect(advanced).not.toContain("four cards");
  });

  /*
   * Issue #486. The cards were renamed for what they do, a day without
   * rules takes its most severe status's color (it said "the lowest"), and
   * the recommended rules a new page starts with are listed: from the code,
   * so the page cannot quietly drift from what a new page gets.
   */
  it("names the history chart cards as the page draws them, and says how a day is colored without rules", () => {
    const advanced: string = page.slice(
      page.indexOf("### More settings"),
      page.indexOf("## Uptime percent and downtime statuses"),
    );

    for (const gone of [
      "Default Bar Color of the History Chart",
      "Rules for Bar Colors of History Chart",
      "the lowest monitor status",
    ]) {
      expect([gone, advanced.includes(gone)]).toEqual([gone, false]);
    }

    expect(advanced).toContain(
      "Without rules, a day takes the color of the most severe monitor status it had, however briefly",
    );
    expect(advanced).toContain(
      "A day the page has no data for is always drawn gray with diagonal stripes, whatever the rules say.",
    );
    expect(advanced).toContain(
      "a rule below one with the same or a lower percentage never colors a day",
    );
  });

  it("lists the recommended rules as a new status page gets them", () => {
    // A row of the table: | 99 | `#fde047` pale yellow | ... |
    const ruleRow: RegExp = /^\| (\d+) \| `(#[0-9a-f]{6})` /;

    const rows: Array<[number, string]> = page
      .split("\n")
      .filter((line: string): boolean => {
        return ruleRow.test(line);
      })
      .map((line: string): [number, string] => {
        const match: RegExpMatchArray = line.match(ruleRow)!;

        return [Number(match[1]), match[2]!];
      });

    expect(rows).toEqual(
      RECOMMENDED_HISTORY_CHART_BAR_COLOR_RULES.map(
        (rule: HistoryChartBarColorRuleValues): [number, string] => {
          return [
            rule.uptimePercentGreaterThanOrEqualTo,
            rule.barColor.toString().toLowerCase(),
          ];
        },
      ),
    );
  });

  it("tells an API caller how to ask for the recommended rules", () => {
    expect(page).toContain(
      `\`"miscDataProps": {"${ADD_RECOMMENDED_BAR_COLOR_RULES_MISC_DATA_KEY}": true}\``,
    );
    expect(page).toContain("**Use Recommended Rules**");
  });

  it("says search engine indexing saves when the switch is flipped, with no Edit button", () => {
    expect(page).toContain(
      "There is no **Edit** button: the switch saves the moment you flip it.",
    );
    expect(page).toContain(
      "**Allow Search Engines to Index this Status Page**",
    );
  });

  it("says search engines index a status page only on a custom domain, never at its preview URL", () => {
    expect(page).toContain(
      "The switch covers the page on its custom domains only. Its preview URL is always served with `noindex, nofollow`, so a status page shows up in search results only once it has a custom domain.",
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

  it("says the only built-in colors are the theme and those under More settings on the Branding page", () => {
    expect(page).toContain(
      "the only built-in color controls anywhere are **Default Bar Color** and the history chart bar color rules, under **More settings** on the **Branding** page",
    );
    expect(page).toContain(
      "**There is no brand-color picker.** Besides the **Theme**, which makes the page light or dark,",
    );
    expect(page).toContain(
      "**History chart colors.** Besides the **Theme**, these are the only built-in color controls on a status page.",
    );
    expect(page).not.toContain("There is no theme picker.");
    expect(page).not.toContain("no theme or brand-color setting");
  });
});

/*
 * "Can we have dark mode for the status page as well?" - the maintainer. A
 * status page's Theme is a card on its Branding page: Light, Dark, or as
 * each visitor's device is set. Its names, its values and the two defaults
 * are read from the product, so the page cannot quietly drift from it.
 */
describe("the Theme section", () => {
  const page: string = readPage(BRANDING_PAGE);
  const section: string = page.slice(
    page.indexOf("### Theme"),
    page.indexOf("### Title, description and favicon"),
  );

  const choiceNamed: (theme: StatusPageTheme) => StatusPageThemeChoice = (
    theme: StatusPageTheme,
  ): StatusPageThemeChoice => {
    return STATUS_PAGE_THEME_CHOICES.find(
      (choice: StatusPageThemeChoice): boolean => {
        return choice.value === theme;
      },
    )!;
  };

  // A value as the page writes it, as inline code.
  const code: (value: string) => string = (value: string): string => {
    return `\`${value}\``;
  };

  it("names the card as the Branding page draws it, under the logo, saved when picked", () => {
    expect(section).toContain(
      `The **${StatusPageThemeCopy.title}** card, right under the logo, sets how the page looks to its visitors.`,
    );
    expect(section).toContain(
      "Pick one of its three choices and it is saved at once; there is no **Edit** button.",
    );
  });

  it("lists the three choices as the card names them, in the card's order", () => {
    const rows: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return THEME_CHOICE_ROW.test(line);
      })
      .map((line: string): string => {
        return line.match(THEME_CHOICE_ROW)![1]!;
      });

    expect(rows).toEqual(
      STATUS_PAGE_THEME_CHOICES.map((choice: StatusPageThemeChoice): string => {
        return choice.title;
      }),
    );
  });

  it("says the logo sits on a light backdrop on every dark page, under the choices, as the status page draws it", () => {
    /*
     * A Dark page and one that follows the device both put the page's
     * logo on a light backdrop while dark (StatusPage's LogoPlate), so the
     * sentence is a paragraph of its own under the table, not one row's -
     * with the logo made for the dark theme, shown there instead when the
     * page has one, and the emails, which always show the logo.
     */
    const backdrop: string =
      "On the dark page the logo sits on a light backdrop, so a logo made for a white page still reads. A page with a **Dark Theme Logo** shows that one on the dark page instead, as it is, with no backdrop, in its header and on its sign-in pages. The emails the page sends always show the logo.";
    const lines: Array<string> = section.split("\n");
    const lastRow: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("| **Match each visitor's device** |");
    });

    expect(lastRow).toBeGreaterThan(-1);
    expect(lines.slice(lastRow + 1, lastRow + 3)).toEqual(["", backdrop]);
    expect(lines[lastRow]).not.toContain("logo");
    expect(
      lines.find((line: string): boolean => {
        return line.startsWith("| **Dark** |");
      }),
    ).toBe("| **Dark** | The dark page, whatever their device is set to. |");

    /*
     * No choice asks an owner for a second logo, or tells them their one
     * shows as it is: the logo for the dark theme is optional, an upload
     * beside the logo.
     */
    expect(section).not.toContain("shown as it is");
    expect(section).not.toContain("made for a dark background");
    expect(section).toContain(
      "A sun or moon button in the page's footer lets a visitor switch, and their browser remembers the choice.",
    );
  });

  /*
   * At the page's OneUptime address (StatusPageUtil.isPreviewPage) a Light
   * or Dark page offers the footer's switch too, for the visit only
   * (StatusPageThemeUtil.canVisitorSwitch, switchColorScheme); on its custom
   * domains it offers none.
   */
  it("says a Light or Dark page has the switch at its OneUptime address, for the visit only, and none on its domains", () => {
    const lines: Array<string> = section.split("\n");
    const backdrop: number = lines.findIndex((line: string): boolean => {
      return line.startsWith("On the dark page the logo sits");
    });
    const preview: string = lines[backdrop + 2] || "";

    expect(lines[backdrop + 1]).toBe("");
    expect(preview).toContain(
      "At the page's address on OneUptime, `/status-page/:id`, a **Light** or **Dark** page has the sun or moon button in its footer too",
    );
    expect(preview).toContain(
      "A pick there lasts until the page is reloaded and is not remembered, so the page always opens in its own theme",
    );
    expect(preview).toContain(
      "On the page's custom domains, a **Light** or **Dark** page has no button.",
    );

    // The choices the paragraph names are the Theme card's own.
    for (const theme of [StatusPageTheme.Light, StatusPageTheme.Dark]) {
      expect(preview).toContain(`**${choiceNamed(theme).title}**`);
    }
  });

  it("gives the API and Terraform field and every value it takes, exactly as they are spelled", () => {
    const values: Array<string> = STATUS_PAGE_THEMES.map(
      (theme: StatusPageTheme): string => {
        return code(theme);
      },
    );

    expect(section).toContain(
      `Through the API and Terraform the field is ${code(STATUS_PAGE_THEME_COLUMN)}, one of ${values
        .slice(0, -1)
        .join(", ")} or ${values[values.length - 1]} (**${
        choiceNamed(StatusPageTheme.System).title
      }**), written exactly so; any other value is refused.`,
    );
    expect(STATUS_PAGE_THEMES[STATUS_PAGE_THEMES.length - 1]).toBe(
      StatusPageTheme.System,
    );
  });

  it("says a new page follows the device, and an older one and a Terraform configuration with no theme are Light", () => {
    // What onBeforeCreate gives a page whose create names no theme.
    expect(section).toContain(
      `A status page made from now on starts with **${
        choiceNamed(NEW_STATUS_PAGE_THEME).title
      }**.`,
    );

    /*
     * The column's default: what the migration gave every page that existed,
     * and what the provider sends for a configuration that names no theme.
     */
    const columnDefault: StatusPageTheme =
      new StatusPage().getTableColumnMetadata(STATUS_PAGE_THEME_COLUMN)
        .defaultValue as StatusPageTheme;

    expect(section).toContain(
      `A Terraform configuration that sets no ${code(STATUS_PAGE_THEME_COLUMN)} gets ${code(columnDefault)}`,
    );
    expect(section).toContain(
      `Status pages made before the setting existed are **${
        choiceNamed(columnDefault).title
      }**, so they look as they always have.`,
    );
  });

  it("says the page is drawn in its theme from the start, and sends custom code writers to the dark theme's class", () => {
    expect(section).toContain(
      "a dark page does not flash white while it loads",
    );
    expect(section).toContain(
      "[Custom HTML, CSS and JavaScript](#custom-html-css-and-javascript) says how to style the dark one.",
    );

    const customCode: string = page.slice(
      page.indexOf("## Custom HTML, CSS and JavaScript"),
      page.indexOf("## Custom domains"),
    );

    expect(customCode).toContain(
      "**Custom code in the dark theme.** Your custom CSS and HTML apply in both themes.",
    );
    expect(customCode).toContain(
      `a CSS rule that starts with ${code("html.dark")} styles only the dark theme`,
    );
  });

  // The card's own note says the same: the rule starts with html.dark.
  it("agrees with the note the card shows on a page with custom code", () => {
    expect(StatusPageThemeCopy.customCodeNote).toContain(
      "Your custom CSS and HTML apply in both themes.",
    );
    expect(StatusPageThemeCopy.customCodeNote).toContain(
      "Start a CSS rule with html.dark to style only the dark theme.",
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
    expect(overview).toContain(
      "The page's **Theme** (light, dark, or as each visitor's device is set) is a card near the top of that same page. There is no brand-color setting;",
    );
    expect(overview).not.toContain("There is no theme or brand-color setting");
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
      "showing the overall uptime percent needs **Scale**",
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
