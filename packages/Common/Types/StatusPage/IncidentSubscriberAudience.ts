import { JSONObject } from "../JSON";

/*
 * Who an incident's status page notifications reach, shown before anything is
 * sent: on the last step of declaring an incident, and above a public note
 * while it is being written. "Will notify: Site 03 (up to 41 email), Site 07
 * (up to 18 email)".
 *
 * POST /incident/subscriber-audience (IncidentAPI) answers it, from the same
 * helper the subscriber jobs send through (IncidentStatusPageScope), so the
 * preview and the send cannot disagree about which pages an incident reaches.
 * It takes either an incident that is being declared - the monitors and the
 * status pages picked on the form - or one that exists.
 *
 * The counts are "up to": they count the confirmed subscribers of each page
 * who have not unsubscribed, per channel. A subscriber who picked only some
 * of a page's resources, or only some event types, is filtered out at send
 * time; and for an incident limited to specific pages an email address or
 * phone number on two of them gets one message, not two. Addresses themselves
 * never leave the server - only counts do.
 *
 * Everything here is shared by the server, which builds the answer, and the
 * dashboard, which reads it, so the two cannot drift apart.
 */

// Why a status page that lists the incident's monitors is not notified.
export enum IncidentSubscriberAudienceExclusionReason {
  // The incident is limited to other status pages.
  OutsideIncidentScope = "OutsideIncidentScope",
  // The page only shows incidents limited to it, and this one is not.
  OnlyShowsScopedIncidents = "OnlyShowsScopedIncidents",
  // The page does not show incidents at all (Show Incidents is off).
  HidesIncidents = "HidesIncidents",
}

// How many subscribers of one status page each channel reaches, at most.
export interface IncidentSubscriberAudienceCounts {
  email: number;
  sms: number;
  slack: number;
  microsoftTeams: number;
  webhook: number;
}

export type IncidentSubscriberAudienceChannel =
  keyof IncidentSubscriberAudienceCounts;

export interface IncidentSubscriberAudienceNamedStatusPage {
  statusPageId: string;
  name: string;
}

// A status page that will be notified.
export interface IncidentSubscriberAudienceStatusPage
  extends IncidentSubscriberAudienceNamedStatusPage {
  subscriberCounts: IncidentSubscriberAudienceCounts;
}

// A status page that lists the incident's monitors but will not be notified.
export interface IncidentSubscriberAudienceExcludedStatusPage
  extends IncidentSubscriberAudienceNamedStatusPage {
  reason: IncidentSubscriberAudienceExclusionReason;
}

export interface IncidentSubscriberAudienceResult {
  /*
   * Whether the incident is on any monitor. Status page subscribers hear
   * about an incident through its monitors, so one on none notifies nobody.
   */
  hasMonitors: boolean;
  /*
   * Whether it is limited to specific status pages. Only then are email and
   * SMS sent once per address across pages.
   */
  isScoped: boolean;
  /*
   * For an incident that exists: it is hidden from status pages (not
   * visible, or private), so nothing is sent whatever pages it reaches.
   */
  isHiddenFromStatusPages: boolean;
  // The status pages that will be notified that the caller can see, by name.
  statusPages: Array<IncidentSubscriberAudienceStatusPage>;
  /*
   * How many more status pages will be notified that the caller cannot see.
   * Status pages are label-scoped, and a page the caller may not read is not
   * named in this answer, nor are its subscribers counted. (The names of the
   * pages an incident is limited to are part of the incident itself, and
   * readable by anyone who can read it.)
   */
  hiddenStatusPageCount: number;
  /*
   * Status pages the caller can see that list the monitors but will not be
   * notified, with why. Pages the caller cannot see are left out.
   */
  excludedStatusPages: Array<IncidentSubscriberAudienceExcludedStatusPage>;
  /*
   * Status pages the incident is limited to that list none of its monitors.
   * The scope only narrows where the monitors already reach, so the incident
   * does not show on, or notify, these. Only pages the caller can see.
   */
  selectedStatusPagesNotListingMonitors: Array<IncidentSubscriberAudienceNamedStatusPage>;
}

// The order channels are listed in, and what each is called on screen.
export const INCIDENT_SUBSCRIBER_AUDIENCE_CHANNELS: ReadonlyArray<{
  channel: IncidentSubscriberAudienceChannel;
  label: string;
}> = [
  { channel: "email", label: "email" },
  { channel: "sms", label: "SMS" },
  { channel: "slack", label: "Slack" },
  { channel: "microsoftTeams", label: "Microsoft Teams" },
  { channel: "webhook", label: "webhook" },
];

export default class IncidentSubscriberAudience {
  // The route, under the API's base URL.
  public static readonly apiPath: string = "/incident/subscriber-audience";

  // How many monitors or status pages one request may name.
  public static readonly maxIdsPerRequest: number = 1000;

  public static getEmptyCounts(): IncidentSubscriberAudienceCounts {
    return {
      email: 0,
      sms: 0,
      slack: 0,
      microsoftTeams: 0,
      webhook: 0,
    };
  }

  public static getTotal(counts: IncidentSubscriberAudienceCounts): number {
    return INCIDENT_SUBSCRIBER_AUDIENCE_CHANNELS.reduce(
      (
        total: number,
        entry: { channel: IncidentSubscriberAudienceChannel },
      ): number => {
        return total + (counts[entry.channel] || 0);
      },
      0,
    );
  }

  /*
   * The channels of one page that reach anyone, in display order, with their
   * counts: [{channel: "email", label: "email", count: 41}, ...].
   */
  public static getNonEmptyChannels(
    counts: IncidentSubscriberAudienceCounts,
  ): Array<{
    channel: IncidentSubscriberAudienceChannel;
    label: string;
    count: number;
  }> {
    return INCIDENT_SUBSCRIBER_AUDIENCE_CHANNELS.map(
      (entry: {
        channel: IncidentSubscriberAudienceChannel;
        label: string;
      }) => {
        return {
          channel: entry.channel,
          label: entry.label,
          count: counts[entry.channel] || 0,
        };
      },
    ).filter((entry: { count: number }): boolean => {
      return entry.count > 0;
    });
  }

  // Whether anyone at all will be sent anything.
  public static reachesAnyone(
    audience: IncidentSubscriberAudienceResult,
  ): boolean {
    if (audience.isHiddenFromStatusPages || !audience.hasMonitors) {
      return false;
    }

    return (
      audience.hiddenStatusPageCount > 0 ||
      audience.statusPages.some(
        (statusPage: IncidentSubscriberAudienceStatusPage): boolean => {
          return this.getTotal(statusPage.subscriberCounts) > 0;
        },
      )
    );
  }

  /*
   * The server's answer as the dashboard receives it. Read defensively: the
   * summary is advisory, and a field that is missing or of the wrong type
   * must read as "nothing" rather than break the form it sits on.
   */
  public static fromJSON(json: JSONObject): IncidentSubscriberAudienceResult {
    const toArray: (value: unknown) => Array<JSONObject> = (
      value: unknown,
    ): Array<JSONObject> => {
      return Array.isArray(value)
        ? (value.filter((item: unknown): boolean => {
            return Boolean(item) && typeof item === "object";
          }) as Array<JSONObject>)
        : [];
    };

    const toCount: (value: unknown) => number = (value: unknown): number => {
      const count: number = Number(value);
      return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    };

    const toNamed: (
      item: JSONObject,
    ) => IncidentSubscriberAudienceNamedStatusPage = (
      item: JSONObject,
    ): IncidentSubscriberAudienceNamedStatusPage => {
      return {
        statusPageId: String(item["statusPageId"] || ""),
        name: String(item["name"] || ""),
      };
    };

    const reasons: Array<string> = Object.values(
      IncidentSubscriberAudienceExclusionReason,
    );

    return {
      hasMonitors: json["hasMonitors"] === true,
      isScoped: json["isScoped"] === true,
      isHiddenFromStatusPages: json["isHiddenFromStatusPages"] === true,
      statusPages: toArray(json["statusPages"]).map(
        (item: JSONObject): IncidentSubscriberAudienceStatusPage => {
          const counts: JSONObject =
            (item["subscriberCounts"] as JSONObject | undefined) || {};

          return {
            ...toNamed(item),
            subscriberCounts: {
              email: toCount(counts["email"]),
              sms: toCount(counts["sms"]),
              slack: toCount(counts["slack"]),
              microsoftTeams: toCount(counts["microsoftTeams"]),
              webhook: toCount(counts["webhook"]),
            },
          };
        },
      ),
      hiddenStatusPageCount: toCount(json["hiddenStatusPageCount"]),
      excludedStatusPages: toArray(json["excludedStatusPages"])
        .filter((item: JSONObject): boolean => {
          return reasons.includes(String(item["reason"]));
        })
        .map(
          (item: JSONObject): IncidentSubscriberAudienceExcludedStatusPage => {
            return {
              ...toNamed(item),
              reason: item[
                "reason"
              ] as IncidentSubscriberAudienceExclusionReason,
            };
          },
        ),
      selectedStatusPagesNotListingMonitors: toArray(
        json["selectedStatusPagesNotListingMonitors"],
      ).map(toNamed),
    };
  }

  public static toJSON(audience: IncidentSubscriberAudienceResult): JSONObject {
    return {
      hasMonitors: audience.hasMonitors,
      isScoped: audience.isScoped,
      isHiddenFromStatusPages: audience.isHiddenFromStatusPages,
      statusPages: audience.statusPages.map(
        (statusPage: IncidentSubscriberAudienceStatusPage): JSONObject => {
          return {
            statusPageId: statusPage.statusPageId,
            name: statusPage.name,
            subscriberCounts: {
              ...statusPage.subscriberCounts,
            },
          };
        },
      ),
      hiddenStatusPageCount: audience.hiddenStatusPageCount,
      excludedStatusPages: audience.excludedStatusPages.map(
        (
          statusPage: IncidentSubscriberAudienceExcludedStatusPage,
        ): JSONObject => {
          return {
            statusPageId: statusPage.statusPageId,
            name: statusPage.name,
            reason: statusPage.reason,
          };
        },
      ),
      selectedStatusPagesNotListingMonitors:
        audience.selectedStatusPagesNotListingMonitors.map(
          (
            statusPage: IncidentSubscriberAudienceNamedStatusPage,
          ): JSONObject => {
            return {
              statusPageId: statusPage.statusPageId,
              name: statusPage.name,
            };
          },
        ),
    };
  }
}
