/*
 * The name of a site's type, as every surface prints it.
 *
 * Site types are rows of their own now (NetworkSiteType, picked on the site
 * as the `networkSiteType` relation). The old inline `siteType` string column
 * is deprecated: it exists only for the backfill migration, and a site made
 * since the relation came in has it empty. Three surfaces still read the old
 * column - the site page's header, the Sites list's hierarchy and the Network
 * Overview's "Sites needing attention" - so every new site showed its type as
 * a dash there, while its Settings said "Data Center".
 *
 * One rule, then, for every reader: the relation's name, the old column for
 * a row the backfill has not reached yet, and "Other" as the last resort, so
 * a site never shows a blank type. The site hierarchy API answered this way
 * already; it reads it from here too.
 */

export const UNTYPED_SITE_TYPE_NAME: string = "Other";

export interface SiteTypeNameSource {
  networkSiteType?: { name?: string | null | undefined } | null | undefined;
  // The deprecated inline column: a string, or whatever the row holds.
  siteType?: unknown;
}

export function getNetworkSiteTypeName(site: SiteTypeNameSource): string {
  const relationName: string = (site.networkSiteType?.name || "").trim();

  if (relationName) {
    return relationName;
  }

  const legacyName: string =
    site.siteType === undefined || site.siteType === null
      ? ""
      : String(site.siteType).trim();

  if (legacyName) {
    return legacyName;
  }

  return UNTYPED_SITE_TYPE_NAME;
}
