import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import {
  AllHuntressIncidentReportEventTypes,
  HUNTRESS_FINISHED_REPORT_STATUSES,
  HUNTRESS_MAX_COMMENT_LENGTH,
  HUNTRESS_MAX_INDICATOR_TYPES,
  HUNTRESS_MAX_NAME_LENGTH,
  HUNTRESS_MAX_SUBJECT_LENGTH,
  HUNTRESS_MAX_SUMMARY_LENGTH,
  HUNTRESS_WEBHOOK_ROUTE,
  HuntressIncidentReportEvent,
  HuntressIncidentReportStatus,
  HuntressWebhookEventType,
  ParsedHuntressWebhook,
  isHuntressIncidentReportEventType,
  isHuntressReportFinished,
  isHuntressReportStatusFinished,
  parseHuntressWebhook,
  readHuntressId,
  readHuntressText,
} from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import {
  getHuntressAccountNoticeBody,
  getHuntressClosedBody,
  getHuntressCommentBody,
  getHuntressEscalationBody,
  getHuntressIdentityReportBody,
  getHuntressIncidentReportBody,
} from "./HuntressWebhookFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * Reading Huntress webhook bodies, in the shapes Huntress documents, into
 * the incident report events the integration acts on - and refusing what is
 * not one.
 */

function parseReport(body: unknown): HuntressIncidentReportEvent {
  const parsed: ParsedHuntressWebhook = parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error(`Expected an incident report, got ${parsed.kind}`);
  }

  return parsed.event;
}

describe("parseHuntressWebhook: incident report events", () => {
  test("reads every field of an incident_report.created event", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIncidentReportBody(),
    );

    expect(event).toEqual({
      eventType: HuntressWebhookEventType.IncidentReportCreated,
      reportId: "1234",
      account: { id: "5", name: "Example MSP" },
      organization: { id: "4", name: "Acme Corp" },
      agentId: "12",
      severity: HuntressSeverity.Critical,
      status: "sent",
      subject: "CRITICAL - Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
      summary:
        "Huntress detected a malicious scheduled task on this host. We recommend removing the file and scheduled task listed in the remediation steps below.",
      platform: "windows",
      // Zero counts are not indicators of this report.
      indicatorCounts: [
        { type: "footholds", count: 1 },
        { type: "process_detections", count: 2 },
      ],
      createdAt: new Date("2026-10-09T03:00:00Z"),
      closedAt: null,
      comment: null,
    });
  });

  test("reads an incident_report.closed event with its closing time", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressClosedBody(),
    );

    expect(event.eventType).toBe(HuntressWebhookEventType.IncidentReportClosed);
    expect(event.status).toBe("closed");
    expect(event.closedAt).toEqual(new Date("2026-10-09T05:00:00Z"));
  });

  test("reads the comment of an incident_report.comment_added event", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressCommentBody("We isolated the host."),
    );

    expect(event.eventType).toBe(
      HuntressWebhookEventType.IncidentReportCommentAdded,
    );
    expect(event.comment).toBe("We isolated the host.");
  });

  test("reads an identity (Microsoft 365) report", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIdentityReportBody(),
    );

    expect(event.reportId).toBe("5678");
    expect(event.platform).toBe("microsoft_365");
    expect(event.severity).toBe(HuntressSeverity.High);
    expect(event.indicatorCounts).toEqual([
      { type: "managed_identity", count: 1 },
    ]);
  });

  test("falls back to the deprecated account_id and organization_id", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIncidentReportBody({
        account: null,
        organization: { name: "Acme Corp" },
        account_id: 77,
        organization_id: "88",
      }),
    );

    expect(event.account).toEqual({ id: "77", name: null });
    expect(event.organization).toEqual({ id: "88", name: "Acme Corp" });
  });

  test("an event that names no account or organization reads them as empty", () => {
    const body: JSONObject = getHuntressIncidentReportBody();
    delete body["account"];
    delete body["account_id"];
    delete body["organization"];
    delete body["organization_id"];

    const event: HuntressIncidentReportEvent = parseReport(body);

    expect(event.account).toEqual({ id: null, name: null });
    expect(event.organization).toEqual({ id: null, name: null });
  });

  test("severity is read case-insensitively, and an undocumented one is null", () => {
    expect(
      parseReport(getHuntressIncidentReportBody({ severity: " HIGH " }))
        .severity,
    ).toBe(HuntressSeverity.High);
    expect(
      parseReport(getHuntressIncidentReportBody({ severity: "medium" }))
        .severity,
    ).toBeNull();
    expect(
      parseReport(getHuntressIncidentReportBody({ severity: null })).severity,
    ).toBeNull();
  });

  test("the status is kept lower-cased", () => {
    expect(
      parseReport(getHuntressIncidentReportBody({ status: "Dismissed" }))
        .status,
    ).toBe("dismissed");
  });

  test("an id sent as text is read like a number", () => {
    expect(
      parseReport(getHuntressIncidentReportBody({ id: "1234" })).reportId,
    ).toBe("1234");
  });

  test("dates that cannot be read are null", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIncidentReportBody({
        created_at: "not a date",
        closed_at: 42,
      }),
    );

    expect(event.createdAt).toBeNull();
    expect(event.closedAt).toBeNull();
  });

  test("text fields are trimmed and cut to their limits", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIncidentReportBody({
        subject: `  ${"s".repeat(HUNTRESS_MAX_SUBJECT_LENGTH * 3)}  `,
        summary: "y".repeat(HUNTRESS_MAX_SUMMARY_LENGTH + 10),
        organization: {
          id: 4,
          name: "n".repeat(HUNTRESS_MAX_NAME_LENGTH + 50),
        },
      }),
    );

    expect(event.subject!.length).toBe(HUNTRESS_MAX_SUBJECT_LENGTH);
    expect(event.subject!.endsWith("…")).toBe(true);
    expect(event.summary!.length).toBe(HUNTRESS_MAX_SUMMARY_LENGTH);
    expect(event.organization.name!.length).toBe(HUNTRESS_MAX_NAME_LENGTH);
  });

  test("a comment is cut to its limit", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressCommentBody("c".repeat(HUNTRESS_MAX_COMMENT_LENGTH * 2)),
    );

    expect(event.comment!.length).toBe(HUNTRESS_MAX_COMMENT_LENGTH);
  });

  test("a megabyte-long subject is cut without running a pattern over it", () => {
    const started: number = Date.now();
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIncidentReportBody({ subject: "(".repeat(3 * 1024 * 1024) }),
    );

    expect(event.subject!.length).toBe(HUNTRESS_MAX_SUBJECT_LENGTH);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("indicator counts keep only well-formed, positive whole counts", () => {
    const event: HuntressIncidentReportEvent = parseReport(
      getHuntressIncidentReportBody({
        indicator_counts: {
          footholds: 2,
          "Not A Type": 3,
          ["x".repeat(65)]: 1,
          negative: -1,
          fraction: 1.5,
          text: "3",
          zero: 0,
          process_detections: 1,
        },
      }),
    );

    expect(event.indicatorCounts).toEqual([
      { type: "footholds", count: 2 },
      { type: "process_detections", count: 1 },
    ]);
  });

  test("indicator counts that are not an object read as none", () => {
    expect(
      parseReport(getHuntressIncidentReportBody({ indicator_counts: [1, 2] }))
        .indicatorCounts,
    ).toEqual([]);
  });

  test(`at most ${HUNTRESS_MAX_INDICATOR_TYPES} indicator types are kept`, () => {
    const counts: JSONObject = {};

    for (let index: number = 0; index < 50; index++) {
      counts[`type_${index}`] = 1;
    }

    expect(
      parseReport(getHuntressIncidentReportBody({ indicator_counts: counts }))
        .indicatorCounts.length,
    ).toBe(HUNTRESS_MAX_INDICATOR_TYPES);
  });
});

describe("parseHuntressWebhook: what is not an incident report", () => {
  test.each([
    ["escalation.created", getHuntressEscalationBody("escalation.created")],
    ["escalation.closed", getHuntressEscalationBody("escalation.closed")],
    ["escalation.overdue", getHuntressEscalationBody("escalation.overdue")],
    [
      "platform_action.created",
      getHuntressEscalationBody("platform_action.created"),
    ],
    ["account_notice.notification", getHuntressAccountNoticeBody()],
  ])(
    "%s is acknowledged as another kind of event",
    (eventType: string, body: JSONObject) => {
      expect(parseHuntressWebhook(body)).toEqual({
        kind: "not-an-incident-report",
        eventType,
      });
    },
  );

  test.each([
    ["a JSON array", [1, 2]],
    ["null", null],
    ["a string", "incident_report.created"],
  ])("%s is not a Huntress event", (_name: string, body: unknown) => {
    expect(parseHuntressWebhook(body)).toEqual({
      kind: "invalid",
      reason: "The request body is not a JSON object.",
    });
  });

  test("an object without event_type is not a Huntress event", () => {
    expect(parseHuntressWebhook({ id: 1 })).toEqual({
      kind: "invalid",
      reason: "The request body has no event_type.",
    });
    expect(parseHuntressWebhook({ event_type: "  " })).toEqual({
      kind: "invalid",
      reason: "The request body has no event_type.",
    });
  });

  test.each([
    ["missing", undefined],
    ["zero", 0],
    ["negative", -4],
    ["a fraction", 1.5],
    ["a word", "abc"],
    ["leading zeros", "0123"],
    ["too long", "1".repeat(20)],
    ["an object", { id: 1 }],
  ])(
    "an incident report whose id is %s is refused",
    (_name: string, id: unknown) => {
      const body: JSONObject = getHuntressIncidentReportBody();

      if (id === undefined) {
        delete body["id"];
      } else {
        body["id"] = id as JSONObject;
      }

      expect(parseHuntressWebhook(body)).toEqual({
        kind: "invalid",
        reason: "The incident_report.created event has no incident report id.",
      });
    },
  );
});

describe("readHuntressId and readHuntressText", () => {
  test("ids are positive integers, as text", () => {
    expect(readHuntressId(1)).toBe("1");
    expect(readHuntressId(" 42 ")).toBe("42");
    expect(readHuntressId(Number.MAX_SAFE_INTEGER)).toBe(
      String(Number.MAX_SAFE_INTEGER),
    );
    expect(readHuntressId(Number.MAX_SAFE_INTEGER + 2)).toBeNull();
    expect(readHuntressId("9223372036854775807")).toBe("9223372036854775807");
    expect(readHuntressId(true)).toBeNull();
    expect(readHuntressId(null)).toBeNull();
  });

  test("text is trimmed, empty text is none, long text ends in an ellipsis", () => {
    expect(readHuntressText("  a  ", 10)).toBe("a");
    expect(readHuntressText("   ", 10)).toBeNull();
    expect(readHuntressText(5, 10)).toBeNull();
    expect(readHuntressText("abcdefghijkl", 5)).toBe("abcd…");
  });
});

describe("incident report event types and statuses", () => {
  test("the three incident report event types are the documented ones", () => {
    expect(AllHuntressIncidentReportEventTypes).toEqual([
      "incident_report.created",
      "incident_report.closed",
      "incident_report.comment_added",
    ]);
    expect(isHuntressIncidentReportEventType("incident_report.closed")).toBe(
      true,
    );
    expect(isHuntressIncidentReportEventType("escalation.closed")).toBe(false);
  });

  test("closed, dismissed, partner_dismissed and deleting reports are finished", () => {
    expect(HUNTRESS_FINISHED_REPORT_STATUSES).toEqual([
      HuntressIncidentReportStatus.Closed,
      HuntressIncidentReportStatus.Dismissed,
      HuntressIncidentReportStatus.PartnerDismissed,
      HuntressIncidentReportStatus.Deleting,
    ]);

    for (const status of HUNTRESS_FINISHED_REPORT_STATUSES) {
      expect(isHuntressReportStatusFinished(status)).toBe(true);
    }

    expect(isHuntressReportStatusFinished(" CLOSED ")).toBe(true);
    expect(isHuntressReportStatusFinished("sent")).toBe(false);
    expect(isHuntressReportStatusFinished("auto_remediating")).toBe(false);
    expect(isHuntressReportStatusFinished("draft")).toBe(false);
    expect(isHuntressReportStatusFinished(null)).toBe(false);
  });

  test("a report is finished by a closed event or a finished status on any event", () => {
    expect(isHuntressReportFinished(parseReport(getHuntressClosedBody()))).toBe(
      true,
    );
    // A closed event whose status Huntress left out still closes.
    expect(
      isHuntressReportFinished(
        parseReport(getHuntressClosedBody({ status: null })),
      ),
    ).toBe(true);
    expect(
      isHuntressReportFinished(
        parseReport(
          getHuntressCommentBody("Dismissed as a false positive.", {
            status: "dismissed",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      isHuntressReportFinished(parseReport(getHuntressIncidentReportBody())),
    ).toBe(false);
  });

  test("the webhook is received under /huntress/webhook", () => {
    expect(HUNTRESS_WEBHOOK_ROUTE).toBe("/huntress/webhook");
  });
});
