/*
 * Site types are no longer a fixed enum: they are a per-project configurable
 * lookup table (the NetworkSiteType database model), so a project can rename
 * "Unit" to "Store" or add its own levels. This enum survives ONLY as the list
 * of default type names seeded into every project (and re-used by the backfill
 * data migration for existing projects). Never compare a site's type against
 * these values to decide behaviour — use the NetworkSiteType row's
 * `isUnitLevel` flag instead, since the names are user-editable.
 */
export enum DefaultNetworkSiteType {
  AccountType = "Account Type",
  Region = "Region",
  Franchisee = "Franchisee",
  Market = "Market",
  Unit = "Unit",
  DataCenter = "Data Center",
  Other = "Other",
}

export default DefaultNetworkSiteType;
