import Route from "Common/Types/API/Route";
import Color from "Common/Types/Color";
import { Gray500 } from "Common/Types/BrandColors";
import Dictionary from "Common/Types/Dictionary";
import {
  SecurityAttackCampaign,
  getCampaignGotThroughCount,
  getCampaignNotFollowedCount,
} from "Common/Types/SecurityEvent/SecurityAttackCampaign";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { WebAttackKind } from "Common/Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { buildSecurityEventFacetLinkParams } from "./SecurityEventsFacets";
import { getSecurityEventsTimeRangeLinkParams } from "./SecurityEventsTimeRange";
import { getRequestOutcomeColor } from "./SecurityEventRequestStory";

/*
 * THE CAMPAIGNS PAGE, as data: the windows it reads, the words it says each
 * campaign in, the bar of how far its requests got, and the links to its
 * requests and to the attacker in Correlate.
 *
 * A campaign is every attack request one address sent
 * (Types/SecurityEvent/SecurityAttackCampaign). React-free, so a plain test
 * pins every sentence and link.
 */

export enum CampaignWindow {
  Day = "day",
  Week = "week",
  Month = "month",
}

export interface CampaignWindowDefinition {
  window: CampaignWindow;
  label: string;
  days: number;
}

export const CAMPAIGN_WINDOWS: ReadonlyArray<CampaignWindowDefinition> = [
  {
    window: CampaignWindow.Day,
    label: translationKey("Last 24 hours"),
    days: 1,
  },
  {
    window: CampaignWindow.Week,
    label: translationKey("Last 7 days"),
    days: 7,
  },
  {
    window: CampaignWindow.Month,
    label: translationKey("Last 30 days"),
    days: 30,
  },
];

export const DEFAULT_CAMPAIGN_WINDOW: CampaignWindow = CampaignWindow.Week;

export function getCampaignWindowRange(
  window: CampaignWindow,
  now: Date,
): { startTime: Date; endTime: Date } {
  const definition: CampaignWindowDefinition =
    CAMPAIGN_WINDOWS.find((item: CampaignWindowDefinition): boolean => {
      return item.window === window;
    }) || CAMPAIGN_WINDOWS[1]!;

  return {
    startTime: new Date(now.getTime() - definition.days * 24 * 60 * 60 * 1000),
    endTime: now,
  };
}

// ---------- Words ----------

export const CAMPAIGNS_TITLE: string = translationKey("Campaigns");

export const CAMPAIGNS_DESCRIPTION: string = translationKey(
  "Every address that sent attack requests, as one row, and whether any of its requests got through. The ones that reached your app come first.",
);

export const UNKNOWN_ADDRESS: string = translationKey("Unknown address");

export const ATTACKERS_LABEL: string = translationKey("Attackers");
export const ATTACK_REQUESTS_LABEL: string = translationKey("Attack requests");
export const GOT_THROUGH_LABEL: string = translationKey("Got through");

export const VIEW_REQUESTS: string = translationKey("View requests");
export const CORRELATE_ADDRESS: string = translationKey("Correlate");

export const NO_CAMPAIGNS_TITLE: string = translationKey(
  "No attack campaigns in this window",
);
export const NO_CAMPAIGNS_DESCRIPTION: string = translationKey(
  "When an attack string shows up in your logs or traces, whoever sent it shows up here, with how far each request got.",
);

export const CAMPAIGNS_TRUNCATED: string = translationKey(
  "Showing the {{count}} most serious campaigns in this window.",
);

export const LOAD_CAMPAIGNS_FAILED: string = translationKey(
  "The campaigns could not be loaded.",
);

export const REQUESTS_COUNT: PluralTemplate = {
  one: translationKey("1 request"),
  other: translationKey("{{count}} requests"),
};

export const DIFFERENT_REQUESTS: PluralTemplate = {
  one: translationKey("1 different request"),
  other: translationKey("{{count}} different requests"),
};

export const GOT_THROUGH_COUNT: PluralTemplate = {
  one: translationKey("1 request got through"),
  other: translationKey("{{count}} requests got through"),
};

export const ALL_TURNED_AWAY: string = translationKey(
  "Every request was turned away",
);

export const NONE_FOLLOWED_GOT_THROUGH: string = translationKey(
  "None of the requests OneUptime followed got through",
);

export const NOT_FOLLOWED: string = translationKey(
  "Not followed: these requests carry no trace",
);

export const NOT_FOLLOWED_SEGMENT: string = translationKey("Not followed");

export const CAMPAIGN_ATTACK_KIND_LABELS: Record<WebAttackKind, string> = {
  [WebAttackKind.SqlInjection]: translationKey("SQL injection"),
  [WebAttackKind.PathTraversal]: translationKey("Path traversal"),
  [WebAttackKind.Log4Shell]: translationKey("Log4Shell"),
};

export function getCampaignAttackKindLabel(kind: string): string {
  return CAMPAIGN_ATTACK_KIND_LABELS[kind as WebAttackKind] || kind;
}

/*
 * What a campaign's requests came to, in one line: how many got through, or
 * that none did, or that OneUptime could not follow them.
 */
export function describeCampaignResult(
  campaign: SecurityAttackCampaign,
  translator: Translator,
): string {
  const gotThrough: number = getCampaignGotThroughCount(campaign);

  if (gotThrough > 0) {
    return translator.translatePlural(GOT_THROUGH_COUNT, gotThrough);
  }

  if (campaign.rejectedCount === 0) {
    return translator.translateText(NOT_FOLLOWED) || NOT_FOLLOWED;
  }

  if (campaign.rejectedCount === campaign.requestCount) {
    return translator.translateText(ALL_TURNED_AWAY) || ALL_TURNED_AWAY;
  }

  return (
    translator.translateText(NONE_FOLLOWED_GOT_THROUGH) ||
    NONE_FOLLOWED_GOT_THROUGH
  );
}

export interface CampaignOutcomeSegment {
  key: string;
  // An outcome, or "Not followed".
  label: string;
  count: number;
  color: Color;
}

/*
 * The bar of how far a campaign's requests got, worst first: the slices a
 * reader's eye should find before the long green run of turned-away probes.
 */
export function getCampaignOutcomeSegments(
  campaign: SecurityAttackCampaign,
): Array<CampaignOutcomeSegment> {
  const segments: Array<CampaignOutcomeSegment> = [
    {
      key: SecurityEventRequestOutcome.ReachedDatabase,
      label: SecurityEventRequestOutcome.ReachedDatabase,
      count: campaign.reachedDatabaseCount,
      color: getRequestOutcomeColor(SecurityEventRequestOutcome.ReachedDatabase),
    },
    {
      key: SecurityEventRequestOutcome.Errored,
      label: SecurityEventRequestOutcome.Errored,
      count: campaign.erroredCount,
      color: getRequestOutcomeColor(SecurityEventRequestOutcome.Errored),
    },
    {
      key: SecurityEventRequestOutcome.ReachedApp,
      label: SecurityEventRequestOutcome.ReachedApp,
      count: campaign.reachedAppCount,
      color: getRequestOutcomeColor(SecurityEventRequestOutcome.ReachedApp),
    },
    {
      key: SecurityEventRequestOutcome.Rejected,
      label: SecurityEventRequestOutcome.Rejected,
      count: campaign.rejectedCount,
      color: getRequestOutcomeColor(SecurityEventRequestOutcome.Rejected),
    },
    {
      key: "not-followed",
      label: NOT_FOLLOWED_SEGMENT,
      count: getCampaignNotFollowedCount(campaign),
      color: Gray500,
    },
  ];

  return segments.filter((segment: CampaignOutcomeSegment): boolean => {
    return segment.count > 0;
  });
}

export interface CampaignsSummary {
  attackers: number;
  requests: number;
  gotThrough: number;
}

export function summarizeCampaigns(
  campaigns: ReadonlyArray<SecurityAttackCampaign>,
): CampaignsSummary {
  let requests: number = 0;
  let gotThrough: number = 0;

  for (const campaign of campaigns) {
    requests += campaign.requestCount;
    gotThrough += getCampaignGotThroughCount(campaign);
  }

  return { attackers: campaigns.length, requests, gotThrough };
}

/*
 * The campaign's requests in the events list: its web attacks from its
 * address, over the window the page read. A campaign whose address nobody
 * knew opens every web attack of the window.
 */
export function buildCampaignEventsRoute(data: {
  campaign: SecurityAttackCampaign;
  startTime: Date;
  endTime: Date;
}): Route {
  const pairs: Array<[string, string]> = [["className", "HTTP Activity"]];

  if (data.campaign.sourceIp) {
    pairs.push(["principalIp", data.campaign.sourceIp]);
  }

  const params: Dictionary<string> = {
    ...buildSecurityEventFacetLinkParams(pairs),
    ...getSecurityEventsTimeRangeLinkParams(data.startTime, data.endTime),
  };

  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS]!,
    ).toString(),
  ).addQueryParams(params);
}

// The attacker's address in Correlate: everything else it touched.
export function buildCampaignCorrelateRoute(
  campaign: SecurityAttackCampaign,
): Route | null {
  if (!campaign.sourceIp) {
    return null;
  }

  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.SECURITY_EVENTS_CORRELATE]!,
    ).toString(),
  ).addQueryParams({ observable: encodeURIComponent(campaign.sourceIp) });
}
