import DashboardThemeCopy, {
  DASHBOARD_THEME_CHOICES,
  DashboardThemeChoice,
} from "../../../FeatureSet/Dashboard/src/Components/Dashboard/Branding/DashboardThemeCopy";
import { THEME_MENU_CHOICES } from "../../../FeatureSet/PublicDashboard/src/Components/ThemeMenuCopy";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_COLUMN,
  DASHBOARD_THEME_LINK_PARAMETER,
  NEW_DASHBOARD_THEME,
  getDashboardThemeProblem,
  parseDashboardLinkTheme,
} from "Common/Types/Dashboard/DashboardTheme";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboards guides on a public dashboard's theme, held to the product:
 * the Theme card on the dashboard's Branding page (DashboardThemeCopy), the
 * theme column and what a write may hold (Common/Types/Dashboard/
 * DashboardTheme.ts, the Dashboard model, DashboardService), the visitor's
 * menu in the public dashboard's toolbar (ThemeMenu) and a link's own theme
 * (?theme=). Markdown is not compiled, so a guide that drifts from any of
 * them fails here. Every language's copy is held to the English one by
 * DashboardsDocsTranslations.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

function readPage(relativePath: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, relativePath), "utf8");
}

// The text under a heading (any level), up to the next heading of its level or above.
function sectionOf(page: string, heading: string): string {
  const level: number = heading.indexOf(" ");
  const start: number = page.indexOf(`\n${heading}\n`);

  expect([heading, start >= 0]).toEqual([heading, true]);

  const rest: string = page.slice(start + heading.length + 2);
  const ends: Array<number> = [];

  for (let depth: number = 1; depth <= level; depth++) {
    const end: number = rest.indexOf(`\n${"#".repeat(depth)} `);

    if (end >= 0) {
      ends.push(end);
    }
  }

  return ends.length > 0 ? rest.slice(0, Math.min(...ends)) : rest;
}

const sharing: string = readPage("en/dashboards/sharing.md");

describe("the Theme section of the sharing guide", () => {
  const section: string = sectionOf(sharing, "### Theme");

  it("sits under Branding, after what shows before a visitor may view the dashboard", () => {
    const branding: string = sectionOf(sharing, "## Branding");

    expect(branding).toContain("\n### Theme\n");
    expect(branding.indexOf("\n### Theme\n")).toBeGreaterThan(
      branding.indexOf("Visitors see the branding only once"),
    );
  });

  it("names the card as the Branding page draws it, and says a pick saves at once", () => {
    expect(DashboardThemeCopy.title).toBe("Theme");
    expect(section).toContain(
      `The **${DashboardThemeCopy.title}** card, right under the logo, sets how the public dashboard looks to its visitors. Pick one of its three choices and it is saved at once; there is no **Edit** button.`,
    );
  });

  it("lists the card's three choices, in its order, by their names", () => {
    const rows: Array<string> = section
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("| **");
      });

    expect(
      rows.map((row: string): string => {
        return row.slice(4, row.indexOf("**", 4));
      }),
    ).toEqual(
      DASHBOARD_THEME_CHOICES.map((choice: DashboardThemeChoice): string => {
        return choice.title;
      }),
    );
  });

  it("says a dashboard made before the setting is Light, as the migration and the column give it", () => {
    const migration: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "Common/Server/Infrastructure/Postgres/SchemaMigrations/1804860000000-AddDashboardTheme.ts",
      ),
      "utf8",
    );

    expect(migration).toContain(`DEFAULT '${DashboardTheme.Light}'`);
    expect(section).toContain(
      "Dashboards made before the setting existed are **Light**, so they look as they always have.",
    );
  });

  it("says a dashboard made from now on follows each visitor's device", () => {
    expect(NEW_DASHBOARD_THEME).toBe(DashboardTheme.System);
    expect(section).toContain(
      "A dashboard made from now on starts with **Match each visitor's device**.",
    );
  });

  it("names the field and its three values as the API reads them, and says any other is refused", () => {
    expect(DASHBOARD_THEME_COLUMN).toBe("theme");
    expect([...DASHBOARD_THEMES]).toEqual(["Light", "Dark", "System"]);
    expect(getDashboardThemeProblem("Sepia")).not.toBeNull();
    expect(getDashboardThemeProblem("dark")).not.toBeNull();
    expect(section).toContain(
      "Through the API and Terraform the field is `theme`, one of `Light`, `Dark` or `System` (**Match each visitor's device**), written exactly so; any other value is refused.",
    );
  });

  it("says a Terraform configuration with no theme gets Light, the column's documented default", () => {
    expect(
      new Dashboard().getTableColumnMetadata(DASHBOARD_THEME_COLUMN)
        .defaultValue,
    ).toBe(DashboardTheme.Light);
    expect(section).toContain(
      "A Terraform configuration that sets no `theme` gets `Light`, so a configuration written before the setting never plans a change on a dashboard it manages.",
    );
  });

  it("says every visitor can switch from the toolbar, back to the dashboard's theme too", () => {
    // Light, Dark, and Auto: the dashboard's own theme again.
    expect(THEME_MENU_CHOICES).toHaveLength(3);
    expect(section).toContain(
      "a sun or moon button in the dashboard's toolbar lets each visitor switch to the light or the dark dashboard, or back to the theme you set, and their browser remembers the pick for every public dashboard at that address.",
    );
  });

  it("says the pages that show no dashboard follow the visitor", () => {
    expect(section).toContain(
      "The **Access Denied** and not-found pages show nothing of a dashboard, so they follow the visitor: their own pick, else their device.",
    );
  });
});

describe("a link's own theme", () => {
  const embedding: string = sectionOf(sharing, "## Embedding");
  const link: string = sectionOf(sharing, "## Sending a link");

  it("is the theme parameter, with the three values a link may name", () => {
    expect(DASHBOARD_THEME_LINK_PARAMETER).toBe("theme");
    expect(parseDashboardLinkTheme("light")).toBe("light");
    expect(parseDashboardLinkTheme("dark")).toBe("dark");
    expect(parseDashboardLinkTheme("system")).toBe("system");

    for (const value of ["light", "dark", "system"]) {
      expect(embedding).toContain(`\`?theme=${value}\``);
      expect(link).toContain(`\`theme=${value}\``);
    }
  });

  it("wins over the dashboard's theme and the visitor's pick, takes the menu away, and stays through the password prompt", () => {
    expect(embedding).toContain(
      "the dashboard is drawn in that theme for everyone who opens that address, whatever its own theme and the visitor's pick, and its toolbar has no theme button.",
    );
    expect(embedding).toContain("The theme stays through the password prompt.");
  });
});

describe("the other dashboards guides", () => {
  it("the overview names the theme among the Branding page's settings", () => {
    expect(readPage("en/dashboards/index.md")).toContain(
      "| **Branding** | Page title, description, logo, theme and favicon of the public dashboard. |",
    );
  });

  it("the widgets guide says how an HTML widget styles the dark theme", () => {
    expect(readPage("en/dashboards/widgets.md")).toContain(
      "In the dark theme its text starts light, and its `<html>` element has the `dark` class: start a CSS rule with `html.dark` to style only the dark theme.",
    );
  });
});
