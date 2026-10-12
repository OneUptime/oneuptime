import { describe, expect, test } from "@jest/globals";
import {
  HUNTRESS_CONNECTION_STATE_COLORS,
  HUNTRESS_CONNECTION_STATE_LABELS,
  HUNTRESS_OUTCOME_COLORS,
  HUNTRESS_OUTCOME_LABELS,
  HUNTRESS_PAGE_ON_CALL_FOR_DESCRIPTIONS,
  HUNTRESS_PAGE_ON_CALL_FOR_LABELS,
  HUNTRESS_SEVERITY_BY_RANK_LABELS,
  HUNTRESS_SEVERITY_COLORS,
  HUNTRESS_SEVERITY_LABELS,
  HUNTRESS_STATUS_LABELS,
  HuntressConnectionState,
  getHuntressConnectionState,
  getHuntressReportByline,
  getHuntressReportHeadline,
  getHuntressReportPortalLink,
  getHuntressWebhookUrl,
} from "../../FeatureSet/Dashboard/src/Components/Huntress/HuntressConnectionDisplay";
import URL from "Common/Types/API/URL";
import HuntressIncidentReportOutcome from "Common/Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity, {
  AllHuntressSeverities,
} from "Common/Types/Huntress/HuntressSeverity";
import {
  HUNTRESS_WEBHOOK_ROUTE,
  HuntressIncidentReportEvent,
  HuntressIncidentReportStatus,
  HuntressWebhookEventType,
} from "Common/Types/Huntress/HuntressWebhook";
import { getHuntressReportPortalUrl } from "Common/Utils/Huntress/HuntressIncidentReportText";
import ObjectID from "Common/Types/ObjectID";

/*
 * What the Huntress pages say about a connection and its reports: the URL
 * a user pastes into Huntress, the state its pill shows, and every label of
 * a report row. The URL has to be the very route the API serves, or every
 * delivery is a 404 that nobody sees until an incident is missed.
 */

const CONNECTION_ID: string = "6d1a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";

const NOW: Date = new Date("2026-10-09T10:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

describe("the webhook URL a connection shows", () => {
  test("is the API's Huntress webhook route followed by the connection's id", () => {
    expect(
      getHuntressWebhookUrl({
        apiUrl: URL.fromString("https://oneuptime.com/api"),
        connectionId: CONNECTION_ID,
      }),
    ).toBe(`https://oneuptime.com/api/huntress/webhook/${CONNECTION_ID}`);
    expect(HUNTRESS_WEBHOOK_ROUTE).toBe("/huntress/webhook");
  });

  test("works for a self-hosted host, a port, and an ObjectID", () => {
    expect(
      getHuntressWebhookUrl({
        apiUrl: URL.fromString("https://status.example.com:8443/api"),
        connectionId: new ObjectID(CONNECTION_ID),
      }),
    ).toBe(
      `https://status.example.com:8443/api/huntress/webhook/${CONNECTION_ID}`,
    );
  });

  test("never doubles a slash when the API URL ends with one", () => {
    const url: string = getHuntressWebhookUrl({
      apiUrl: URL.fromString("https://oneuptime.com/api/"),
      connectionId: CONNECTION_ID,
    });

    expect(url).toBe(
      `https://oneuptime.com/api/huntress/webhook/${CONNECTION_ID}`,
    );
  });

  test("leaves the API URL it was handed as it was", () => {
    const apiUrl: URL = URL.fromString("https://oneuptime.com/api");

    getHuntressWebhookUrl({ apiUrl, connectionId: CONNECTION_ID });

    expect(apiUrl.toString()).toBe("https://oneuptime.com/api");
  });
});

describe("a connection's state", () => {
  test("needs the signing secret until one is saved, whatever else happened", () => {
    expect(getHuntressConnectionState({})).toBe(
      HuntressConnectionState.NeedsSigningSecret,
    );
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: false,
        lastEventReceivedAt: minutesAgo(1),
        lastError: "A request arrived but was refused",
        lastErrorAt: minutesAgo(2),
      }),
    ).toBe(HuntressConnectionState.NeedsSigningSecret);
  });

  test("waits for Huntress once the secret is saved and nothing arrived", () => {
    expect(getHuntressConnectionState({ isSigningSecretSet: true })).toBe(
      HuntressConnectionState.Waiting,
    );
  });

  test("receives once an event was handled", () => {
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(3),
      }),
    ).toBe(HuntressConnectionState.Receiving);
  });

  test("fails while the newest thing that happened is a refused request", () => {
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(30),
        lastError: "The request's signature does not match the signing secret.",
        lastErrorAt: minutesAgo(1),
      }),
    ).toBe(HuntressConnectionState.Failing);
  });

  test("fails when a request was refused and none ever got through", () => {
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: true,
        lastError: "The request body is not valid JSON.",
        lastErrorAt: minutesAgo(1),
      }),
    ).toBe(HuntressConnectionState.Failing);
  });

  test("is receiving again once an event got through after the error", () => {
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(1),
        lastError: "The request's signature does not match the signing secret.",
        lastErrorAt: minutesAgo(10),
      }),
    ).toBe(HuntressConnectionState.Receiving);
  });

  test("reads dates sent as text, the way the API returns them", () => {
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: true,
        lastEventReceivedAt: minutesAgo(30).toISOString(),
        lastError: "Refused",
        lastErrorAt: minutesAgo(1).toISOString(),
      }),
    ).toBe(HuntressConnectionState.Failing);
  });

  test("ignores a date it cannot read", () => {
    expect(
      getHuntressConnectionState({
        isSigningSecretSet: true,
        lastEventReceivedAt: "not a date",
      }),
    ).toBe(HuntressConnectionState.Waiting);
  });

  test("has a label and a colour for every state, each label different", () => {
    const states: Array<HuntressConnectionState> = Object.values(
      HuntressConnectionState,
    );

    for (const state of states) {
      expect(HUNTRESS_CONNECTION_STATE_LABELS[state]).toBeTruthy();
      expect(HUNTRESS_CONNECTION_STATE_COLORS[state]).toBeTruthy();
    }

    expect(
      new Set(
        states.map((state: HuntressConnectionState): string => {
          return HUNTRESS_CONNECTION_STATE_LABELS[state];
        }),
      ).size,
    ).toBe(states.length);
  });
});

describe("the labels for Huntress severities", () => {
  test("cover every severity, in every map", () => {
    for (const severity of AllHuntressSeverities) {
      expect(HUNTRESS_SEVERITY_LABELS[severity]).toBeTruthy();
      expect(HUNTRESS_SEVERITY_COLORS[severity]).toBeTruthy();
      expect(HUNTRESS_SEVERITY_BY_RANK_LABELS[severity]).toBeTruthy();
      expect(HUNTRESS_PAGE_ON_CALL_FOR_LABELS[severity]).toBeTruthy();
      expect(HUNTRESS_PAGE_ON_CALL_FOR_DESCRIPTIONS[severity]).toBeTruthy();
    }
  });

  test("say which reports page, from critical only to every report", () => {
    expect(HUNTRESS_PAGE_ON_CALL_FOR_LABELS).toEqual({
      [HuntressSeverity.Critical]: "Critical reports only",
      [HuntressSeverity.High]: "High and critical reports",
      [HuntressSeverity.Low]: "Every report",
    });
  });

  test("name the rank a severity falls back to, most severe first", () => {
    expect(HUNTRESS_SEVERITY_BY_RANK_LABELS).toEqual({
      [HuntressSeverity.Critical]: "Most severe (by rank)",
      [HuntressSeverity.High]: "Second most severe (by rank)",
      [HuntressSeverity.Low]: "Third most severe (by rank)",
    });
  });
});

describe("a report's outcome", () => {
  test("has a label and a colour for every outcome", () => {
    for (const outcome of Object.values(HuntressIncidentReportOutcome)) {
      expect(HUNTRESS_OUTCOME_LABELS[outcome]).toBeTruthy();
      expect(HUNTRESS_OUTCOME_COLORS[outcome]).toBeTruthy();
    }
  });

  test("says why a skipped report opened nothing", () => {
    expect(
      HUNTRESS_OUTCOME_LABELS[
        HuntressIncidentReportOutcome.OrganizationNotWatched
      ],
    ).toBe("Skipped: organization not watched");
    expect(
      HUNTRESS_OUTCOME_LABELS[
        HuntressIncidentReportOutcome.ClosedBeforeReceived
      ],
    ).toBe("Skipped: already closed in Huntress");
  });
});

describe("a report row", () => {
  test("is headed by the host or identity it is about", () => {
    expect(
      getHuntressReportHeadline({
        affectedName: "DESKTOP-01",
        subject: "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
        huntressIncidentReportId: "1234",
      }),
    ).toBe("DESKTOP-01");
  });

  test("falls back to the subject without its severity, then to the number", () => {
    expect(
      getHuntressReportHeadline({
        subject: "HIGH - Suspicious inbox rule",
        huntressIncidentReportId: "1234",
      }),
    ).toBe("Suspicious inbox rule");
    expect(
      getHuntressReportHeadline({ huntressIncidentReportId: "1234" }),
    ).toBe("#1234");
  });

  test("is bylined with its organization and number", () => {
    expect(
      getHuntressReportByline({
        organizationName: "Acme Corp",
        huntressIncidentReportId: "1234",
      }),
    ).toBe("Acme Corp · #1234");
    expect(getHuntressReportByline({ huntressIncidentReportId: "1234" })).toBe(
      "#1234",
    );
    expect(getHuntressReportByline({ organizationName: "Acme Corp" })).toBe(
      "Acme Corp",
    );
  });

  test("names every status Huntress gives a report", () => {
    for (const status of Object.values(HuntressIncidentReportStatus)) {
      expect({ status, label: HUNTRESS_STATUS_LABELS[status] }).toEqual({
        status,
        label: expect.any(String),
      });
    }

    expect(HUNTRESS_STATUS_LABELS["partner_dismissed"]).toBe(
      "Dismissed by your team",
    );
  });

  test("links to the report in Huntress, where the incident's description does", () => {
    const event: HuntressIncidentReportEvent = {
      eventType: HuntressWebhookEventType.IncidentReportCreated,
      reportId: "1234",
      account: { id: "5", name: "Example MSP" },
      organization: { id: "42", name: "Acme Corp" },
      agentId: null,
      severity: HuntressSeverity.Critical,
      status: "sent",
      subject: null,
      summary: null,
      platform: null,
      indicatorCounts: [],
      createdAt: null,
      closedAt: null,
      comment: null,
    };

    expect(
      getHuntressReportPortalLink({ organizationId: "42", reportId: "1234" }),
    ).toBe("https://huntress.io/org/42/incident_reports/1234");
    expect(
      getHuntressReportPortalLink({ organizationId: "42", reportId: "1234" }),
    ).toBe(getHuntressReportPortalUrl(event));
  });

  test("has no link without an organization or a report number", () => {
    expect(getHuntressReportPortalLink({ reportId: "1234" })).toBeNull();
    expect(getHuntressReportPortalLink({ organizationId: "42" })).toBeNull();
  });

  test("never lets an id change the link's path", () => {
    expect(
      getHuntressReportPortalLink({
        organizationId: "42/../../evil",
        reportId: "1?x=1",
      }),
    ).toBe(
      "https://huntress.io/org/42%2F..%2F..%2Fevil/incident_reports/1%3Fx%3D1",
    );
  });
});
