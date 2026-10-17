/*
 * The Huntress Incident Report trigger, as data: its address, the Event it
 * reads each incident report event as, the values a delivery hands the run
 * and the run hands on, and its metadata and help - which the webhook, the
 * run, the template, the Builder and the docs all read.
 *
 * Pure: no database, no network, no React.
 */

import HuntressSeverity from "../../../Types/Huntress/HuntressSeverity";
import {
  HuntressIncidentReportEvent,
  HuntressWebhookEventType,
  ParsedHuntressWebhook,
  parseHuntressWebhook,
} from "../../../Types/Huntress/HuntressWebhook";
import { JSONObject } from "../../../Types/JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import Components, { Categories } from "../../../Types/Workflow/Components";
import HuntressComponents, {
  HUNTRESS_COMPONENT_CATEGORY,
} from "../../../Types/Workflow/Components/Huntress";
import { WorkflowDocsPaths } from "../../../Types/Workflow/Documentation/DocumentationLinks";
import {
  AllHuntressTriggerEvents,
  HUNTRESS_DELIVERY_INDICATOR_COUNTS,
  HUNTRESS_INCIDENT_SEVERITY_RANK,
  HUNTRESS_INCIDENT_SEVERITY_SETTINGS,
  HUNTRESS_LABEL_WHEN_NO_ORGANIZATION,
  HUNTRESS_MAX_LABEL_NAME_LENGTH,
  HUNTRESS_RUN_EVENT_PROBLEM,
  HUNTRESS_RUN_REPORT_ID_PROBLEM,
  HUNTRESS_TRIGGER_PATH,
  HuntressRunEvent,
  HuntressTriggerEvent,
  HuntressTriggerSetting,
  HuntressTriggerValue,
  getHuntressDeliveryValues,
  getHuntressEventNote,
  getHuntressIndicatorsText,
  getHuntressOrganizationLabelName,
  getHuntressTriggerEvent,
  getHuntressTriggerUrl,
  getHuntressTriggerUrlPrefix,
  getHuntressTriggerValues,
  readHuntressRunEvent,
  readHuntressTriggerEvent,
} from "../../../Types/Workflow/HuntressTrigger";
import {
  getHuntressClosedBody,
  getHuntressCommentBody,
  getHuntressIdentityReportBody,
  getHuntressIncidentReportBody,
} from "../Huntress/HuntressWebhookFixtures";
import { WORD_JOINER } from "../../../Utils/Markdown/MarkdownEscape";
import { describe, expect, test } from "@jest/globals";

const NOW: Date = new Date("2026-10-09T10:00:00.000Z");

function eventOf(body: JSONObject): HuntressIncidentReportEvent {
  const parsed: ParsedHuntressWebhook = parseHuntressWebhook(body);

  if (parsed.kind !== "incident-report") {
    throw new Error("Not an incident report.");
  }

  return parsed.event;
}

const trigger: ComponentMetadata = HuntressComponents.find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.HuntressIncidentReport;
  },
)!;

describe("the trigger's URL", () => {
  test("is the workflow service's /huntress/<key>, whatever the base ends with", () => {
    expect(HUNTRESS_TRIGGER_PATH).toBe("/huntress");

    for (const base of [
      "https://oneuptime.com/workflow",
      "https://oneuptime.com/workflow/",
      "https://oneuptime.com/workflow//",
      // Read in one pass, however many there are.
      `https://oneuptime.com/workflow${"/".repeat(50000)}`,
    ]) {
      expect(getHuntressTriggerUrlPrefix({ workflowServiceUrl: base })).toBe(
        "https://oneuptime.com/workflow/huntress/",
      );
    }

    expect(
      getHuntressTriggerUrl({
        workflowServiceUrl: "https://status.example.com/workflow",
        secretKey: "6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b",
      }),
    ).toBe(
      "https://status.example.com/workflow/huntress/6f9b2c1e-3a4d-4e8f-9b7a-2c5d8e1f0a3b",
    );
  });

  test("encodes a key that is not URL-safe, so it stays one path segment", () => {
    expect(
      getHuntressTriggerUrl({
        workflowServiceUrl: "https://oneuptime.com/workflow",
        secretKey: "a/b?c",
      }),
    ).toBe("https://oneuptime.com/workflow/huntress/a%2Fb%3Fc");
  });
});

describe("the Event an incident report event is", () => {
  test("created, comment-added and closed, in that order", () => {
    expect(AllHuntressTriggerEvents).toEqual([
      HuntressTriggerEvent.Created,
      HuntressTriggerEvent.CommentAdded,
      HuntressTriggerEvent.Closed,
    ]);
  });

  test.each([
    [HuntressWebhookEventType.IncidentReportCreated, "sent", "created"],
    [
      HuntressWebhookEventType.IncidentReportCommentAdded,
      "sent",
      "comment-added",
    ],
    [HuntressWebhookEventType.IncidentReportClosed, "closed", "closed"],
    // A report already over is closed, whichever event carried it.
    [HuntressWebhookEventType.IncidentReportCreated, "closed", "closed"],
    [HuntressWebhookEventType.IncidentReportCreated, "dismissed", "closed"],
    // A comment is a comment whatever the report's status.
    [
      HuntressWebhookEventType.IncidentReportCommentAdded,
      "closed",
      "comment-added",
    ],
  ])(
    "%s with status %s is %s",
    (eventType: HuntressWebhookEventType, status: string, expected: string) => {
      expect(getHuntressTriggerEvent({ eventType, status })).toBe(expected);
    },
  );

  test("as typed into Run Workflow: case and spaces aside, empty is created, anything else is nothing", () => {
    expect(readHuntressTriggerEvent(" Comment-Added ")).toBe(
      HuntressTriggerEvent.CommentAdded,
    );
    expect(readHuntressTriggerEvent("CLOSED")).toBe(
      HuntressTriggerEvent.Closed,
    );
    expect(readHuntressTriggerEvent("")).toBe(HuntressTriggerEvent.Created);
    expect(readHuntressTriggerEvent(undefined)).toBe(
      HuntressTriggerEvent.Created,
    );
    expect(readHuntressTriggerEvent(null)).toBe(HuntressTriggerEvent.Created);
    expect(readHuntressTriggerEvent("resolved")).toBeNull();
    expect(readHuntressTriggerEvent("comment_added")).toBeNull();
    expect(readHuntressTriggerEvent(3)).toBeNull();
  });
});

describe("a delivery, read back by the run", () => {
  test.each([
    ["a new report", getHuntressIncidentReportBody()],
    ["a comment", getHuntressCommentBody("Isolated the host.")],
    ["a close", getHuntressClosedBody()],
    ["an identity report", getHuntressIdentityReportBody()],
  ])(
    "%s reads back as the event the webhook read",
    (_name: string, body: JSONObject) => {
      const event: HuntressIncidentReportEvent = eventOf(body);
      const read: HuntressRunEvent = readHuntressRunEvent(
        getHuntressDeliveryValues({ event, receivedAt: NOW }),
        new Date("2030-01-01T00:00:00.000Z"),
      );

      expect(read.isValid).toBe(true);

      if (!read.isValid) {
        return;
      }

      expect(read.triggerEvent).toBe(getHuntressTriggerEvent(event));
      expect(read.event.reportId).toBe(event.reportId);
      expect(read.event.organization).toEqual(event.organization);
      expect(read.event.subject).toBe(event.subject);
      expect(read.event.summary).toBe(event.summary);
      expect(read.event.comment).toBe(event.comment);
      expect(read.event.platform).toBe(event.platform);
      expect(read.event.indicatorCounts).toEqual(event.indicatorCounts);
      expect(read.severity).toBe(event.severity);
      // When OneUptime received it, not when the run read it.
      expect(read.receivedAt).toEqual(NOW);
    },
  );

  test("hands the run the report's fields under the trigger's value ids, and its indicator counts", () => {
    expect(
      getHuntressDeliveryValues({
        event: eventOf(getHuntressIncidentReportBody()),
        receivedAt: NOW,
      }),
    ).toEqual({
      [HuntressTriggerValue.Event]: HuntressTriggerEvent.Created,
      [HuntressTriggerValue.ReportId]: "1234",
      [HuntressTriggerValue.Severity]: "critical",
      [HuntressTriggerValue.Status]: "sent",
      [HuntressTriggerValue.Subject]:
        "CRITICAL - Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
      [HuntressTriggerValue.Summary]:
        "Huntress detected a malicious scheduled task on this host. We recommend removing the file and scheduled task listed in the remediation steps below.",
      [HuntressTriggerValue.Organization]: "Acme Corp",
      [HuntressTriggerValue.OrganizationId]: "4",
      [HuntressTriggerValue.Platform]: "windows",
      [HuntressTriggerValue.Comment]: "",
      [HUNTRESS_DELIVERY_INDICATOR_COUNTS]: {
        footholds: 1,
        process_detections: 2,
      },
      [HuntressTriggerValue.ReceivedAt]: NOW.toISOString(),
    });
  });

  test("a severity that is none Huntress documents is high", () => {
    const read: HuntressRunEvent = readHuntressRunEvent(
      {
        [HuntressTriggerValue.ReportId]: "1",
        [HuntressTriggerValue.Severity]: "urgent",
      },
      NOW,
    );

    expect(read.isValid && read.severity).toBe(HuntressSeverity.High);
    expect(read.isValid && read.event.severity).toBeNull();
  });

  test("what cannot be a report stops the run, saying what to type", () => {
    expect(
      readHuntressRunEvent(
        {
          [HuntressTriggerValue.ReportId]: "1",
          [HuntressTriggerValue.Event]: "deleted",
        },
        NOW,
      ),
    ).toEqual({
      isValid: false,
      problem: HUNTRESS_RUN_EVENT_PROBLEM,
    });

    for (const reportId of [undefined, "", "abc", "12 34", -4, { id: 1 }]) {
      expect(
        readHuntressRunEvent(
          { [HuntressTriggerValue.ReportId]: reportId as never },
          NOW,
        ),
      ).toEqual({ isValid: false, problem: HUNTRESS_RUN_REPORT_ID_PROBLEM });
    }
  });

  test("text typed into Run Workflow is cut to the lengths a delivery is", () => {
    const read: HuntressRunEvent = readHuntressRunEvent(
      {
        [HuntressTriggerValue.ReportId]: "77",
        [HuntressTriggerValue.Organization]: "O".repeat(5000),
        [HuntressTriggerValue.Subject]: "S".repeat(5000),
      },
      NOW,
    );

    expect(read.isValid).toBe(true);

    if (read.isValid) {
      expect((read.event.organization.name || "").length).toBeLessThan(5000);
      expect((read.event.subject || "").length).toBeLessThan(5000);
    }
  });
});

describe("the values the run hands on", () => {
  test("are exactly the trigger's return values", () => {
    const values: JSONObject = getHuntressTriggerValues({
      event: eventOf(getHuntressIncidentReportBody()),
      triggerEvent: HuntressTriggerEvent.Created,
      severity: HuntressSeverity.Critical,
      receivedAt: NOW,
    });

    expect(Object.keys(values).sort()).toEqual(
      trigger.returnValues
        .map((value: ReturnValue): string => {
          return value.id;
        })
        .sort(),
    );
  });

  test("text for an incident and its notes, written so nothing in the report acts", () => {
    const values: JSONObject = getHuntressTriggerValues({
      event: eventOf(
        getHuntressIncidentReportBody({
          summary: "See ![x](https://tracker.example/p.png) <!channel> @here",
        }),
      ),
      triggerEvent: HuntressTriggerEvent.Created,
      severity: HuntressSeverity.Critical,
      receivedAt: NOW,
    });

    const description: string = String(
      values[HuntressTriggerValue.IncidentDescription],
    );

    expect(values[HuntressTriggerValue.IncidentTitle]).toBe(
      "Huntress: Incident on DESKTOP-ARL0EQ1 (Acme Corp)",
    );
    // Reads as Huntress wrote it, with invisible breaks where it would act.
    expect(description.split(WORD_JOINER).join("")).toContain(
      "See ![x](https://tracker.example/p.png) <!channel> @here",
    );
    expect(description).not.toContain("![x](");
    expect(description).not.toContain("<!channel>");
    // The summary as Huntress wrote it is still there, raw, for a step that wants it.
    expect(values[HuntressTriggerValue.Summary]).toContain("<!channel>");
    // Worked out on the server, from the project's records.
    expect(values[HuntressTriggerValue.IncidentSeverityId]).toBe("");
    expect(values[HuntressTriggerValue.OrganizationLabelId]).toBe("");
  });

  test("a comment's note holds the comment; a close's says so; a new report has none", () => {
    const comment: HuntressIncidentReportEvent = eventOf(
      getHuntressCommentBody("Reimaged the laptop."),
    );

    expect(
      getHuntressEventNote({
        event: comment,
        triggerEvent: HuntressTriggerEvent.CommentAdded,
      }),
    ).toContain("Reimaged the laptop.");
    expect(
      getHuntressEventNote({
        event: eventOf(getHuntressClosedBody()),
        triggerEvent: HuntressTriggerEvent.Closed,
      }),
    ).toBe("Huntress closed incident report 1234 (status: closed).");
    expect(
      getHuntressEventNote({
        event: eventOf(getHuntressIncidentReportBody()),
        triggerEvent: HuntressTriggerEvent.Created,
      }),
    ).toBe("");
  });

  test("indicators read as Huntress names them, with how many of each", () => {
    expect(
      getHuntressIndicatorsText([
        { type: "footholds", count: 1 },
        { type: "process_detections", count: 2 },
      ]),
    ).toBe("Footholds (1), Process detections (2)");
    expect(getHuntressIndicatorsText([])).toBe("");
  });

  test("the organization's label is named after it, or Huntress, and is a label's length", () => {
    expect(
      getHuntressOrganizationLabelName({
        organization: { id: "4", name: "Acme Corp" },
      }),
    ).toBe("Acme Corp");
    expect(
      getHuntressOrganizationLabelName({
        organization: { id: null, name: null },
      }),
    ).toBe(HUNTRESS_LABEL_WHEN_NO_ORGANIZATION);
    expect(
      getHuntressOrganizationLabelName({
        organization: { id: "4", name: "A".repeat(300) },
      }),
    ).toHaveLength(HUNTRESS_MAX_LABEL_NAME_LENGTH);
  });
});

describe("the incident severity each Huntress severity opens at", () => {
  test("has a setting of its own, and a rank to fall back on: most severe first", () => {
    expect(HUNTRESS_INCIDENT_SEVERITY_SETTINGS).toEqual({
      [HuntressSeverity.Critical]:
        HuntressTriggerSetting.CriticalIncidentSeverity,
      [HuntressSeverity.High]: HuntressTriggerSetting.HighIncidentSeverity,
      [HuntressSeverity.Low]: HuntressTriggerSetting.LowIncidentSeverity,
    });
    expect(HUNTRESS_INCIDENT_SEVERITY_RANK).toEqual({
      [HuntressSeverity.Critical]: 0,
      [HuntressSeverity.High]: 1,
      [HuntressSeverity.Low]: 2,
    });
  });
});

describe("the trigger's metadata", () => {
  test("is a trigger in the Huntress category, which the Add Trigger panel lists", () => {
    expect(trigger.componentType).toBe(ComponentType.Trigger);
    expect(trigger.title).toBe("Huntress Incident Report");
    expect(trigger.category).toBe(HUNTRESS_COMPONENT_CATEGORY);
    expect(
      Components.filter((component: ComponentMetadata): boolean => {
        return component.id === ComponentID.HuntressIncidentReport;
      }),
    ).toHaveLength(1);
    expect(
      Categories.map((category: { name: string }): string => {
        return category.name;
      }),
    ).toContain(HUNTRESS_COMPONENT_CATEGORY);
    expect(
      trigger.outPorts.map((port: { id: string }): string => {
        return port.id;
      }),
    ).toEqual(["out"]);
    expect(trigger.inPorts).toEqual([]);
  });

  test("its settings are the four the run reads, all optional and folded away", () => {
    expect(
      trigger.arguments.map((argument: Argument): string => {
        return argument.id;
      }),
    ).toEqual([
      HuntressTriggerSetting.Organizations,
      HuntressTriggerSetting.CriticalIncidentSeverity,
      HuntressTriggerSetting.HighIncidentSeverity,
      HuntressTriggerSetting.LowIncidentSeverity,
    ]);

    for (const argument of trigger.arguments) {
      expect({
        id: argument.id,
        required: argument.required,
        advanced: argument.isAdvanced,
      }).toEqual({
        id: argument.id,
        required: false,
        advanced: true,
      });
    }

    // The three severities are picked from the project's incident severities.
    expect(
      trigger.arguments.slice(1).map((argument: Argument) => {
        return argument.type;
      }),
    ).toEqual([
      ComponentInputType.IncidentSeveritySelect,
      ComponentInputType.IncidentSeveritySelect,
      ComponentInputType.IncidentSeveritySelect,
    ]);
  });

  test("its values are every value the trigger names, in the order the docs list them", () => {
    expect(
      trigger.returnValues.map((value: ReturnValue): string => {
        return value.id;
      }),
    ).toEqual(Object.values(HuntressTriggerValue));
  });

  test("Run Workflow asks for what most steps read, the Report ID required", () => {
    expect(
      (trigger.runWorkflowManuallyArguments || []).map((argument: Argument) => {
        return [argument.id, argument.required];
      }),
    ).toEqual([
      [HuntressTriggerValue.Event, false],
      [HuntressTriggerValue.ReportId, true],
      [HuntressTriggerValue.Severity, false],
      [HuntressTriggerValue.Organization, false],
      [HuntressTriggerValue.Subject, false],
      [HuntressTriggerValue.Comment, false],
    ]);
  });

  test("its help links the Huntress guide", () => {
    expect(WorkflowDocsPaths.huntress).toBe("/integrations/huntress");
  });
});
