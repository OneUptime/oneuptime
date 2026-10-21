import { JSONObject } from "../../../Types/JSON";
import IncidentSubscriberAudience, {
  INCIDENT_SUBSCRIBER_AUDIENCE_CHANNELS,
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceExclusionReason,
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "../../../Types/StatusPage/IncidentSubscriberAudience";
import { describe, expect, test } from "@jest/globals";

/*
 * The audience the server sends and the dashboard reads (see
 * IncidentSubscriberAudience). The dashboard reads it defensively: the
 * summary is advisory, so a missing or malformed field must read as
 * "nothing", never break the form it sits on.
 */

function counts(
  partial: Partial<IncidentSubscriberAudienceCounts>,
): IncidentSubscriberAudienceCounts {
  return {
    ...IncidentSubscriberAudience.getEmptyCounts(),
    ...partial,
  };
}

function audience(
  partial: Partial<IncidentSubscriberAudienceResult>,
): IncidentSubscriberAudienceResult {
  return {
    hasMonitors: true,
    isScoped: false,
    isHiddenFromStatusPages: false,
    statusPages: [],
    hiddenStatusPageCount: 0,
    excludedStatusPages: [],
    selectedStatusPagesNotListingMonitors: [],
    ...partial,
  };
}

const FULL: IncidentSubscriberAudienceResult = audience({
  isScoped: true,
  statusPages: [
    {
      statusPageId: "b0000000-0000-4000-8000-000000000003",
      name: "Site 03",
      subscriberCounts: counts({ email: 41, sms: 2 }),
    },
    {
      statusPageId: "b0000000-0000-4000-8000-000000000007",
      name: "Site 07",
      subscriberCounts: counts({ email: 18 }),
    },
  ],
  hiddenStatusPageCount: 2,
  excludedStatusPages: [
    {
      statusPageId: "b0000000-0000-4000-8000-000000000005",
      name: "Site 05",
      reason: IncidentSubscriberAudienceExclusionReason.OutsideIncidentScope,
    },
  ],
  selectedStatusPagesNotListingMonitors: [
    {
      statusPageId: "b0000000-0000-4000-8000-000000000009",
      name: "Site 09",
    },
  ],
});

describe("IncidentSubscriberAudience", () => {
  test("the route is the one IncidentAPI registers", () => {
    expect(IncidentSubscriberAudience.apiPath).toBe(
      "/incident/subscriber-audience",
    );
  });

  test("channels are listed email, SMS, Slack, Microsoft Teams, webhook", () => {
    expect(
      INCIDENT_SUBSCRIBER_AUDIENCE_CHANNELS.map(
        (entry: { label: string }): string => {
          return entry.label;
        },
      ),
    ).toEqual(["email", "SMS", "Slack", "Microsoft Teams", "webhook"]);

    // Every count has a channel, and every channel a count.
    expect(
      INCIDENT_SUBSCRIBER_AUDIENCE_CHANNELS.map(
        (entry: { channel: string }): string => {
          return entry.channel;
        },
      ).sort(),
    ).toEqual(Object.keys(IncidentSubscriberAudience.getEmptyCounts()).sort());
  });

  test("getEmptyCounts is zero everywhere, and a fresh object each time", () => {
    const first: IncidentSubscriberAudienceCounts =
      IncidentSubscriberAudience.getEmptyCounts();
    first.email = 5;

    expect(IncidentSubscriberAudience.getEmptyCounts()).toEqual({
      email: 0,
      sms: 0,
      slack: 0,
      microsoftTeams: 0,
      webhook: 0,
    });
  });

  test("getTotal adds every channel", () => {
    expect(
      IncidentSubscriberAudience.getTotal(
        counts({ email: 3, sms: 2, slack: 1, microsoftTeams: 4, webhook: 5 }),
      ),
    ).toBe(15);
    expect(IncidentSubscriberAudience.getTotal(counts({}))).toBe(0);
  });

  test("getNonEmptyChannels lists the channels that reach anyone, in order", () => {
    expect(
      IncidentSubscriberAudience.getNonEmptyChannels(
        counts({ webhook: 2, email: 41, microsoftTeams: 1 }),
      ),
    ).toEqual([
      { channel: "email", label: "email", count: 41 },
      { channel: "microsoftTeams", label: "Microsoft Teams", count: 1 },
      { channel: "webhook", label: "webhook", count: 2 },
    ]);
    expect(IncidentSubscriberAudience.getNonEmptyChannels(counts({}))).toEqual(
      [],
    );
  });

  describe("reachesAnyone", () => {
    test("a page with subscribers reaches them", () => {
      expect(IncidentSubscriberAudience.reachesAnyone(FULL)).toBe(true);
    });

    test("pages with no subscribers reach nobody", () => {
      expect(
        IncidentSubscriberAudience.reachesAnyone(
          audience({
            statusPages: [
              {
                statusPageId: "b0000000-0000-4000-8000-000000000003",
                name: "Site 03",
                subscriberCounts: counts({}),
              },
            ],
          }),
        ),
      ).toBe(false);
    });

    test("pages the caller cannot see may reach someone", () => {
      expect(
        IncidentSubscriberAudience.reachesAnyone(
          audience({ hiddenStatusPageCount: 1 }),
        ),
      ).toBe(true);
    });

    test("a hidden incident reaches nobody, whatever its pages", () => {
      expect(
        IncidentSubscriberAudience.reachesAnyone({
          ...FULL,
          isHiddenFromStatusPages: true,
        }),
      ).toBe(false);
    });

    test("an incident on no monitor reaches nobody", () => {
      expect(
        IncidentSubscriberAudience.reachesAnyone({
          ...FULL,
          hasMonitors: false,
        }),
      ).toBe(false);
    });
  });

  describe("JSON", () => {
    test("round-trips", () => {
      expect(
        IncidentSubscriberAudience.fromJSON(
          IncidentSubscriberAudience.toJSON(FULL),
        ),
      ).toEqual(FULL);
    });

    test("toJSON writes only the declared fields", () => {
      const withExtras: IncidentSubscriberAudienceResult = {
        ...FULL,
        statusPages: FULL.statusPages.map(
          (statusPage: IncidentSubscriberAudienceStatusPage) => {
            return {
              ...statusPage,
              subscriberEmail: "someone@example.com",
            };
          },
        ),
      };

      const text: string = JSON.stringify(
        IncidentSubscriberAudience.toJSON(withExtras),
      );

      expect(text).not.toContain("someone@example.com");
    });

    test("an empty object reads as nobody", () => {
      expect(IncidentSubscriberAudience.fromJSON({})).toEqual({
        hasMonitors: false,
        isScoped: false,
        isHiddenFromStatusPages: false,
        statusPages: [],
        hiddenStatusPageCount: 0,
        excludedStatusPages: [],
        selectedStatusPagesNotListingMonitors: [],
      });
    });

    test("malformed fields read as nothing rather than throwing", () => {
      const json: JSONObject = {
        hasMonitors: "yes",
        isScoped: 1,
        statusPages: [
          null,
          "Site 01",
          {
            statusPageId: "b0000000-0000-4000-8000-000000000001",
            name: "Site 01",
            subscriberCounts: {
              email: "12",
              sms: -4,
              slack: "lots",
              microsoftTeams: 2.7,
            },
          },
        ],
        hiddenStatusPageCount: "3",
        excludedStatusPages: [
          { statusPageId: "x", name: "Unknown reason", reason: "Because" },
          {
            statusPageId: "y",
            name: "Site 02",
            reason: IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          },
        ],
        selectedStatusPagesNotListingMonitors: "Site 09",
      } as unknown as JSONObject;

      expect(IncidentSubscriberAudience.fromJSON(json)).toEqual({
        hasMonitors: false,
        isScoped: false,
        isHiddenFromStatusPages: false,
        statusPages: [
          {
            statusPageId: "b0000000-0000-4000-8000-000000000001",
            name: "Site 01",
            subscriberCounts: {
              email: 12,
              sms: 0,
              slack: 0,
              microsoftTeams: 2,
              webhook: 0,
            },
          },
        ],
        hiddenStatusPageCount: 3,
        excludedStatusPages: [
          {
            statusPageId: "y",
            name: "Site 02",
            reason: IncidentSubscriberAudienceExclusionReason.HidesIncidents,
          },
        ],
        selectedStatusPagesNotListingMonitors: [],
      });
    });
  });
});
