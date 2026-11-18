import { jest } from "@jest/globals";
import IncidentSubscriberAudienceBuilder from "../../../../Server/Utils/StatusPage/IncidentSubscriberAudienceBuilder";
import { IncidentSubscriberAudienceResult } from "../../../../Types/StatusPage/IncidentSubscriberAudience";

/*
 * WHO A DECLARED INCIDENT REACHES, FOR SUITES THAT DECLARE ONE FROM A CHAT.
 *
 * Slack's and Microsoft Teams' Declare Incident confirmations say whether
 * status page subscribers will be told (#7916), from who the incident
 * reaches as the Dashboard's review works it out
 * (IncidentSubscriberAudienceBuilder) - which reads the database. A suite
 * that drives a declare through a chat, without one, stands it in with
 * stubSubscriberAudience, and expects the line its confirmation then ends
 * with.
 */

// Who an incident reaches: by default, on no monitor - most incidents.
export function subscriberAudienceOf(
  values: Partial<IncidentSubscriberAudienceResult> = {},
): IncidentSubscriberAudienceResult {
  return {
    hasMonitors: false,
    isScoped: false,
    isHiddenFromStatusPages: false,
    statusPages: [],
    hiddenStatusPageCount: 0,
    excludedStatusPages: [],
    selectedStatusPagesNotListingMonitors: [],
    ...values,
  };
}

// Every declared incident reaches `audience`.
export function stubSubscriberAudience(
  audience: IncidentSubscriberAudienceResult = subscriberAudienceOf(),
): void {
  jest
    .spyOn(IncidentSubscriberAudienceBuilder, "build")
    .mockResolvedValue(audience);
}

// The confirmation's line for an incident on no monitor.
export const NO_MONITORS_SUBSCRIBERS_LINE: string =
  "Status page subscribers were not notified: the incident has no monitors, so no status page shows it.";

// The line for an incident whose monitors no status page lists.
export const NO_STATUS_PAGE_SUBSCRIBERS_LINE: string =
  "Status page subscribers were not notified: no status page shows this incident's monitors.";
