/*
 * What each number on the network site pages means, in plain words: the site
 * Overview hero, the Status Timeline tab, the Child Sites list and the
 * summary strip above the Sites list. Shown in the (i) tooltip beside a
 * tile, column or section title.
 *
 * Each text describes what the page actually computes:
 *
 *   - a site's health is rolled up from the devices at the site AND at every
 *     site beneath it, while the hero's Devices and Endpoints tiles count
 *     only what is assigned to the site itself;
 *   - uptime counts any non-operational status (Degraded as well as
 *     Offline) as down, subtracts scheduled maintenance from both sides of
 *     the fraction, and counts time before the site's first rollup as up -
 *     the daily strip is the one place that leaves those days blank.
 *
 * Change the fetch, change the words.
 */

export type NetworkSiteMetric =
  | "health"
  | "uptime24h"
  | "uptime30d"
  | "devices"
  | "childSites"
  | "endpoints"
  | "uptimeWindow"
  | "dailyUptime"
  | "childSiteStatus"
  | "totalSites"
  | "unhealthySites"
  | "sitesWithoutData"
  | "unassignedDevices";

export const NETWORK_SITE_METRIC_DESCRIPTIONS: Record<
  NetworkSiteMetric,
  string
> = {
  // Site Overview hero (Components/NetworkSite/SiteStatusHero.tsx).
  health:
    "This site's overall status, rolled up from the devices here and at every site beneath it: the worst device status by default, or a share-of-devices-down rule set in Settings. Maintenance on this site does not hide its own outage.",
  uptime24h:
    "Share of the last 24 hours this site spent outside a non-operational status such as Degraded or Offline. Scheduled maintenance is left out, and time before the site's first health rollup counts as up.",
  uptime30d:
    "Share of the last 30 days this site spent outside a non-operational status, with scheduled maintenance left out. One full day of outage lowers it by only about 3.3 points; time before the first rollup counts as up.",
  devices:
    "Devices assigned directly to this site, not counting those in child sites. Up and down use each device's most recent check; devices still pending are in neither.",
  childSites:
    "Sites directly beneath this one in the hierarchy, one level down. Their own child sites are not counted here.",
  endpoints:
    "Hosts such as PCs, phones and printers that devices assigned to this site found in their address tables (ARP and MAC forwarding tables). Every host found so far is counted, including ones not seen recently.",

  // Status Timeline tab (Pages/NetworkSite/View/StatusTimeline.tsx).
  uptimeWindow:
    "Share of the period in the title this site spent outside a non-operational status such as Degraded or Offline, leaving out scheduled maintenance on the site or its parents. Time before the first rollup counts as up; red means below 99%.",
  dailyUptime:
    "Green is 99.9% uptime or better, amber 95% or better and red below that. A pale amber bar was entirely scheduled maintenance, and a hollow outline is a day before the site's first health rollup.",

  // Child Sites tab (Pages/NetworkSite/View/ChildSites.tsx).
  childSiteStatus:
    "Each child site's health, rolled up from the devices at that site and at every site beneath it. No Data means nothing below it has reported yet.",

  // Sites list summary strip (SiteSummaryTiles.ts).
  totalSites:
    "Every network site in the project at every level of the hierarchy, from regions down to single units. Selecting this tile clears the filters on the list below.",
  unhealthySites:
    "Sites whose health, rolled up from the devices at and beneath them, is non-operational, such as Degraded or Offline. Counts the whole project, whatever filters are set below.",
  sitesWithoutData:
    "Sites with no health status yet because no device at or beneath them has reported, including sites whose last status was deleted. They are not counted as unhealthy.",
  unassignedDevices:
    "Devices in the project that are not assigned to any site, so they count toward no site's health. Selecting this tile opens them on the device list.",
};
