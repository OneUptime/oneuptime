import { describe, expect, test } from "@jest/globals";
import {
  UNTYPED_SITE_TYPE_NAME,
  getNetworkSiteTypeName,
} from "../../../Utils/NetworkSite/SiteTypeName";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "../../../Models/DatabaseModels/NetworkSiteType";
import fs from "fs";
import path from "path";

/*
 * The name of a site's type, as every surface prints it (Utils/NetworkSite/
 * SiteTypeName.ts). Site types became rows of their own - the
 * `networkSiteType` relation - and the inline `siteType` column was kept
 * only for the backfill; a site made since has it empty. The site header,
 * the Sites hierarchy and the Overview's "Sites needing attention" read the
 * old column, so every new site's type showed as a dash there.
 */

describe("getNetworkSiteTypeName", () => {
  test("is the site type's name", () => {
    expect(
      getNetworkSiteTypeName({ networkSiteType: { name: "Data Center" } }),
    ).toBe("Data Center");
  });

  test("reads a real site row with its relation", () => {
    const type: NetworkSiteType = new NetworkSiteType();
    type.name = "Branch";
    const site: NetworkSite = new NetworkSite();
    site.networkSiteType = type;

    expect(getNetworkSiteTypeName(site)).toBe("Branch");
  });

  test("wins over the old column", () => {
    expect(
      getNetworkSiteTypeName({
        networkSiteType: { name: "Branch" },
        siteType: "Store",
      }),
    ).toBe("Branch");
  });

  test("a site the backfill has not reached keeps its old type", () => {
    expect(getNetworkSiteTypeName({ siteType: "Store" })).toBe("Store");
    expect(
      getNetworkSiteTypeName({ networkSiteType: null, siteType: "Store" }),
    ).toBe("Store");
  });

  test("a relation with no name falls back to the old column", () => {
    expect(
      getNetworkSiteTypeName({
        networkSiteType: { name: "   " },
        siteType: "Market",
      }),
    ).toBe("Market");
  });

  test("names around spaces are trimmed", () => {
    expect(
      getNetworkSiteTypeName({ networkSiteType: { name: "  Region " } }),
    ).toBe("Region");
    expect(getNetworkSiteTypeName({ siteType: " Unit  " })).toBe("Unit");
  });

  test("a site with neither reads Other, never a blank", () => {
    expect(UNTYPED_SITE_TYPE_NAME).toBe("Other");
    expect(getNetworkSiteTypeName({})).toBe("Other");
    expect(
      getNetworkSiteTypeName({ networkSiteType: undefined, siteType: null }),
    ).toBe("Other");
    expect(getNetworkSiteTypeName({ siteType: "" })).toBe("Other");
  });

  test("an old column holding something other than text is read as text", () => {
    expect(getNetworkSiteTypeName({ siteType: 7 })).toBe("7");
  });
});

/*
 * Every surface that names a site's type reads it through the one rule, so
 * none of them can go back to the old column on its own.
 */
describe("the surfaces that name a site's type", () => {
  const PACKAGES: string = path.join(__dirname, "..", "..", "..", "..");

  function read(...parts: Array<string>): string {
    return fs
      .readFileSync(path.join(PACKAGES, ...parts), "utf8")
      .replace(/\s+/g, " ");
  }

  test.each([
    [
      "the Overview's Sites needing attention",
      ["App", "FeatureSet", "BaseAPI", "API", "NetworkSummary.ts"],
    ],
    [
      "the Sites hierarchy",
      ["App", "FeatureSet", "BaseAPI", "API", "NetworkSiteHierarchy.ts"],
    ],
    [
      "the site page's header",
      [
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "NetworkSite",
        "SiteStatusHero.tsx",
      ],
    ],
  ])("%s reads it through getNetworkSiteTypeName", (_surface: string, parts: Array<string>) => {
    const code: string = read(...parts);

    expect(code).toContain("getNetworkSiteTypeName(");
    expect(code).toContain('from "Common/Utils/NetworkSite/SiteTypeName"');
  });

  test("the site header and the Overview list read the relation's name with the site", () => {
    expect(
      read(
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Components",
        "NetworkSite",
        "SiteStatusHero.tsx",
      ),
    ).toMatch(/networkSiteType: \{ name: true,? \}/);
    expect(
      read("App", "FeatureSet", "BaseAPI", "API", "NetworkSummary.ts"),
    ).toMatch(/networkSiteType: \{ name: true,? \}/);
  });
});
