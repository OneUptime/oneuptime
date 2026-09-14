import DefaultNetworkSiteType from "./DefaultNetworkSiteType";

/*
 * One shared hierarchy policy for new-project seeding and the idempotent data
 * migration that repairs projects created before parent site types existed.
 * Keep parents before children in creation order so every FK can be resolved
 * from a row that has already been found or created.
 */
export const DefaultNetworkSiteTypeParent: Readonly<
  Record<DefaultNetworkSiteType, DefaultNetworkSiteType | null>
> = Object.freeze({
  [DefaultNetworkSiteType.AccountType]: null,
  [DefaultNetworkSiteType.Region]: DefaultNetworkSiteType.AccountType,
  [DefaultNetworkSiteType.Franchisee]: DefaultNetworkSiteType.Region,
  [DefaultNetworkSiteType.Market]: DefaultNetworkSiteType.Franchisee,
  [DefaultNetworkSiteType.Unit]: DefaultNetworkSiteType.Market,
  [DefaultNetworkSiteType.DataCenter]: null,
  [DefaultNetworkSiteType.Other]: null,
});

export const DefaultNetworkSiteTypeCreationOrder: ReadonlyArray<DefaultNetworkSiteType> =
  Object.freeze([
    DefaultNetworkSiteType.AccountType,
    DefaultNetworkSiteType.Region,
    DefaultNetworkSiteType.Franchisee,
    DefaultNetworkSiteType.Market,
    DefaultNetworkSiteType.Unit,
    DefaultNetworkSiteType.DataCenter,
    DefaultNetworkSiteType.Other,
  ]);
