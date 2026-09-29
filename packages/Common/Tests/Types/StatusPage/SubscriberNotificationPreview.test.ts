import { describe, expect, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";
import IncidentSubscriberAudience from "../../../Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoiceReason,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewResult,
} from "../../../Types/StatusPage/SubscriberNotificationPreview";

/*
 * The preview's shape, shared by the server that answers and the dashboard
 * that shows it: what travels (and nothing else - no address), how the
 * dashboard reads an answer defensively, and the sample unsubscribe link.
 */

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";

function result(): SubscriberNotificationPreviewResult {
  return {
    event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
    nothingSentReason: null,
    statusPages: [
      {
        statusPageId: SITE_1,
        name: "Site 01",
        subscriberCounts: {
          ...IncidentSubscriberAudience.getEmptyCounts(),
          email: 41,
          sms: 3,
        },
        subject: "[Update Incident] Checkout",
        html: "<p>Checkout</p>",
        templateChoice: {
          usesCustomTemplate: false,
          reason:
            SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
          customTemplateName: "Branded",
        },
      },
    ],
    audience: {
      hasMonitors: true,
      isScoped: true,
      isHiddenFromStatusPages: false,
      statusPages: [
        {
          statusPageId: SITE_1,
          name: "Site 01",
          subscriberCounts: {
            ...IncidentSubscriberAudience.getEmptyCounts(),
            email: 41,
            sms: 3,
          },
        },
      ],
      hiddenStatusPageCount: 2,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: [],
    },
  };
}

describe("SubscriberNotificationPreview", () => {
  test("an answer survives the trip to the dashboard", () => {
    const json: JSONObject = JSON.parse(
      JSON.stringify(SubscriberNotificationPreview.toJSON(result())),
    ) as JSONObject;

    expect(SubscriberNotificationPreview.fromJSON(json)).toEqual(result());
  });

  test("only these fields travel for each page: no address, no mail settings", () => {
    const json: JSONObject = SubscriberNotificationPreview.toJSON(result());
    const page: JSONObject = (json["statusPages"] as Array<JSONObject>)[0]!;

    expect(Object.keys(json).sort()).toEqual(
      ["audience", "event", "nothingSentReason", "statusPages"].sort(),
    );
    expect(Object.keys(page).sort()).toEqual(
      [
        "html",
        "name",
        "statusPageId",
        "subject",
        "subscriberCounts",
        "templateChoice",
      ].sort(),
    );
  });

  test("a malformed answer reads as nothing rather than breaking the dialog", () => {
    const parsed: SubscriberNotificationPreviewResult =
      SubscriberNotificationPreview.fromJSON({
        event: "Unknown",
        nothingSentReason: "Nope",
        statusPages: [
          null,
          "x",
          {
            statusPageId: SITE_1,
            subscriberCounts: { email: "12", sms: -4, slack: "lots" },
            templateChoice: { reason: "Made up", customTemplateName: 7 },
          },
        ],
      } as unknown as JSONObject);

    expect(parsed.event).toBe(
      SubscriberNotificationPreviewEvent.IncidentCreated,
    );
    expect(parsed.nothingSentReason).toBeNull();
    expect(parsed.statusPages).toEqual([
      {
        statusPageId: SITE_1,
        name: "",
        subscriberCounts: {
          ...IncidentSubscriberAudience.getEmptyCounts(),
          email: 12,
        },
        subject: "",
        html: "",
        templateChoice: {
          usesCustomTemplate: false,
          reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
          customTemplateName: undefined,
        },
      },
    ]);
    expect(parsed.audience.statusPages).toEqual([]);
  });

  test("a reason nothing will be sent is read back", () => {
    expect(
      SubscriberNotificationPreview.fromJSON({
        event: "IncidentCreated",
        nothingSentReason: "NoMonitors",
      }).nothingSentReason,
    ).toBe(SubscriberNotificationPreviewNothingSentReason.NoMonitors);
  });

  test("requests travel with their dates as ISO strings, and a test names its page", () => {
    expect(
      SubscriberNotificationPreview.requestToJSON({
        event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
        incidentId: "a0000000-0000-4000-8000-00000000000a",
        note: "Update",
        postedAt: new Date("2026-09-27T10:30:00.000Z"),
        statusPageId: SITE_1,
      }),
    ).toEqual({
      event: "IncidentPublicNoteCreated",
      incidentId: "a0000000-0000-4000-8000-00000000000a",
      note: "Update",
      postedAt: "2026-09-27T10:30:00.000Z",
      statusPageId: SITE_1,
    });

    expect(
      SubscriberNotificationPreview.requestToJSON({
        event: SubscriberNotificationPreviewEvent.IncidentCreated,
        incident: {
          title: "Down",
          description: "",
          incidentSeverityId: null,
          monitorIds: ["c0000000-0000-4000-8000-000000000001"],
          statusPageIds: [],
          labelIds: [],
          customFields: { Impact: "High" },
          isPrivate: false,
          shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
        },
      }),
    ).toEqual({
      event: "IncidentCreated",
      incident: {
        title: "Down",
        description: "",
        incidentSeverityId: null,
        monitorIds: ["c0000000-0000-4000-8000-000000000001"],
        statusPageIds: [],
        labelIds: [],
        customFields: { Impact: "High" },
        isPrivate: false,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
    });
  });

  test("the preview's unsubscribe link names no subscription", () => {
    expect(
      SubscriberNotificationPreview.getPreviewUnsubscribeUrl(
        "https://status.acme.com",
      ),
    ).toBe("https://status.acme.com/unsubscribe/preview");
  });
});
