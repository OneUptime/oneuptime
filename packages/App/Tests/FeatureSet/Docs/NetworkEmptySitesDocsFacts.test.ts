import { bold, boldIn, readRepoFile } from "./InventoryAndApiDocsSupport";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { NETWORK_SITES_PAGE, sectionInLanguage } from "./NetworkDocsLabels";
import {
  DELETE_EMPTY_SITES_ACTION,
  EMPTY_SITE_NAMES_SHOWN,
} from "../../../FeatureSet/Dashboard/src/Components/NetworkSite/DeleteEmptySitesWords";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, it } from "@jest/globals";

/*
 * What Network Sites says about Delete Empty Sites (#10188), held to the
 * code that makes it true: where it is, what an empty site is, how many it
 * names, that it deletes only what it listed, and who may. And every
 * translation names the action and the list as its Dashboard draws them.
 */

const SECTION: string = "## The Hierarchy";
const PARAGRAPH: string = "Sites that hold nothing go in one step:";

const SITES_PAGE_SOURCE: string =
  "App/FeatureSet/Dashboard/src/Pages/NetworkSite/Sites.tsx";
const SITE_USAGE_SOURCE: string =
  "Common/Server/Utils/NetworkSite/NetworkSiteUsage.ts";
const EMPTY_SITES_SOURCE: string =
  "Common/Server/Utils/NetworkSite/EmptyNetworkSites.ts";
const EMPTY_SITES_API: string = "Common/Server/API/NetworkEmptySitesAPI.ts";

function paragraphs(language: string): Array<string> {
  return sectionInLanguage(language, NETWORK_SITES_PAGE, SECTION)
    .split("\n")
    .filter((line: string): boolean => {
      return line.trim().length > 0;
    });
}

function englishParagraph(): string {
  const found: string | undefined = paragraphs("en").find(
    (line: string): boolean => {
      return line.startsWith(PARAGRAPH);
    },
  );

  if (!found) {
    throw new Error(`The Hierarchy section has no paragraph "${PARAGRAPH}"`);
  }

  return found;
}

describe("Network Sites: Delete Empty Sites, held to the code", () => {
  it("is in the Sites list's menu, for who may delete sites", () => {
    expect(DELETE_EMPTY_SITES_ACTION).toBe("Delete Empty Sites");

    const page: string = readRepoFile(SITES_PAGE_SOURCE);
    expect(page).toContain("title: DELETE_EMPTY_SITES_ACTION");
    // An OUTLINE button of the table: the ⋯ menu, beside Import from CSV.
    expect(page).toContain(
      "buttonStyle: ButtonStyleType.OUTLINE,\n                    icon: IconProp.Trash,",
    );
    expect(page).toContain(
      "PermissionGate.check(\n    new NetworkSite(),\n    ModelAction.Delete,",
    );
    expect(readRepoFile(EMPTY_SITES_API)).toContain(
      "allowedPermissions: new NetworkSite().getDeletePermissions()",
    );

    expect(englishParagraph()).toContain(
      `${bold("Delete Empty Sites")}, in the menu at the top of the ${bold("Sites")} list,`,
    );
    expect(englishParagraph()).toContain("It is for whoever may delete sites.");
  });

  it("calls empty what holds nothing and nothing uses: devices, archived too, sites under it, endpoints, links, rules, maintenance", () => {
    const usage: string = readRepoFile(SITE_USAGE_SOURCE);

    for (const service of [
      "NetworkDeviceService.findBy",
      "NetworkSiteService.findSiteIdsWithChildren",
      "NetworkEndpointService.findBy",
      "NetworkSiteLinkService.findBy",
      "NetworkSiteAssignmentRuleService.findBy",
      "NetworkDeviceNamingRuleService.findBy",
      "ScheduledMaintenanceService.findBy",
    ]) {
      expect([service, usage.includes(service)]).toEqual([service, true]);
    }

    expect(englishParagraph()).toContain(
      "lists every site with no devices (archived ones too), no sites under it, and no endpoint, link, rule or maintenance event that uses it.",
    );
  });

  it("names the first ten, and deletes only the sites it listed that are still empty", () => {
    expect(EMPTY_SITE_NAMES_SHOWN).toBe(10);
    expect(readRepoFile(EMPTY_SITES_SOURCE)).toContain(
      "NetworkSiteUsage.findSitesInUse({\n      projectId: data.projectId,\n      siteIds: asked,",
    );

    expect(englishParagraph()).toContain(
      "It names the first ten, and deletes exactly the sites it listed once you confirm: a site that gets a device in the meantime is kept.",
    );
  });
});

describe("Network Sites: Delete Empty Sites, in every language", () => {
  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s names Delete Empty Sites and the Sites list as its Dashboard draws them, in the English paragraph's place",
    (language: string) => {
      const english: Array<string> = paragraphs("en");
      const translated: Array<string> = paragraphs(language);
      const index: number = english.findIndex((line: string): boolean => {
        return line.startsWith(PARAGRAPH);
      });

      expect(translated).toHaveLength(english.length);
      expect(boldIn(translated[index] as string).sort()).toEqual(
        [
          drawnDashboardLabel(language, "Delete Empty Sites"),
          drawnDashboardLabel(language, "Sites"),
        ].sort(),
      );
    },
  );
});
