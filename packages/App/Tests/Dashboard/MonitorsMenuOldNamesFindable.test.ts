import {
  buildPageSearchCommandDescriptors,
  getPageSearchCommandRanking,
  PageSearchCommandDescriptor,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/DashboardCommandPaletteHelpers";
import { getPageSearchAreas } from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import {
  filterPaletteCommands,
  PaletteCommandMatch,
} from "Common/UI/Components/CommandPalette/PaletteFilter";
import { PaletteCommand } from "Common/UI/Components/CommandPalette/Types";
import { describe, expect, test } from "@jest/globals";

/*
 * THE MONITORS AND STATUS PAGES MENUS' OLD NAMES STILL FIND THEIR PAGES
 * (#9126; principle 8, nothing to relearn).
 *
 * "Probe Disabled" is "No Probe Enabled" now, and "Probe Disconnected" is
 * "Probes Disconnected", as the monitor's own badge says. Owner Rules and
 * Label Rules moved from Settings to a Rules section, and Announcements from
 * "More" to the Status Pages section. Search (Cmd/Ctrl+K) offers each page
 * by the name people learned, and says where it lives the way the menu now
 * does.
 */

const PROJECT: string = "project-a";

const PAGES: Array<PaletteCommand> = buildPageSearchCommandDescriptors({
  areas: getPageSearchAreas(),
  availability: {
    isBillingEnabled: true,
    isMonitorGroupsEnabled: true,
    canDeleteProject: true,
  },
  getRouteTemplate: (key: string): string => {
    return `/dashboard/:projectId/${key.toLowerCase()}`;
  },
  getRoutePath: (key: string): string => {
    return `/dashboard/${PROJECT}/${key.toLowerCase()}`;
  },
  getProductTitle: (): string | undefined => {
    return undefined;
  },
  translate: (text: string): string => {
    return text;
  },
  catalog: [],
}).map((descriptor: PageSearchCommandDescriptor): PaletteCommand => {
  return {
    id: descriptor.id,
    title: descriptor.title,
    titleAliases: descriptor.titleAliases,
    keywords: descriptor.keywords,
    breadcrumb: descriptor.breadcrumb,
    breadcrumbKeywords: descriptor.breadcrumbKeywords,
    category: descriptor.isAction ? "Actions" : "Pages",
    isSearchOnly: true,
    ...getPageSearchCommandRanking(descriptor),
    onSelect: (): void => {},
  };
});

// A rule still filed under Settings, or a page under the old "More".
const MISFILED: RegExp =
  /^(Monitors|Status Pages) › (Settings › (Owner|Label) Rules|More ›)/;

// The first five results, each as "Breadcrumb › Title".
function offered(query: string): Array<string> {
  return filterPaletteCommands(PAGES, query)
    .slice(0, 5)
    .map((match: PaletteCommandMatch): string => {
      return [...(match.command.breadcrumb || []), match.command.title].join(
        " › ",
      );
    });
}

describe("Search finds the renamed Monitors pages by their old names", () => {
  test.each([
    ["probe disabled", "Monitors › Attention Required › No Probe Enabled"],
    ["probes not enabled", "Monitors › Attention Required › No Probe Enabled"],
    ["no probe enabled", "Monitors › Attention Required › No Probe Enabled"],
    [
      "probe disconnected",
      "Monitors › Attention Required › Probes Disconnected",
    ],
  ])('"%s" offers %s', (query: string, page: string) => {
    expect(offered(query)).toContain(page);
  });

  test("Disabled is found beside the monitors, not under Attention Required", () => {
    const results: Array<string> = offered("disabled monitors");

    expect(results).toContain("Monitors › Disabled");
    expect(results).not.toContain("Monitors › Attention Required › Disabled");
  });
});

describe("Search says where the moved pages live now", () => {
  test.each([
    ["monitor owner rules", "Monitors › Rules › Owner Rules"],
    ["monitor label rules", "Monitors › Rules › Label Rules"],
    ["status page owner rules", "Status Pages › Rules › Owner Rules"],
    ["status page label rules", "Status Pages › Rules › Label Rules"],
    ["announcements", "Status Pages › Announcements"],
  ])('"%s" offers %s', (query: string, page: string) => {
    expect(offered(query)).toContain(page);
  });

  test("no Monitors or Status Pages page is filed under Settings › a rule, or under More", () => {
    const misfiled: Array<string> = PAGES.map(
      (command: PaletteCommand): string => {
        return [...(command.breadcrumb || []), command.title].join(" › ");
      },
    ).filter((path: string): boolean => {
      return MISFILED.test(path);
    });

    expect(misfiled).toEqual([]);
  });
});
