import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

/*
 * The subscriber notification template editor's live preview: the template
 * as it is typed, filled in with sample values by the compiler the jobs use.
 * An email shows in a frame that runs nothing and cannot reach the
 * dashboard; the other channels show the text they would send.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import SubscriberTemplateLivePreview from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberTemplateLivePreview";
import SubscriberNotificationPreviewCopy from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationPreviewCopy";
import { getEmailPreviewDocument } from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/EmailPreviewFrame";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import SubscriberNotificationTemplatePreview from "../../../Types/StatusPage/SubscriberNotificationTemplatePreview";

const INCIDENT_CREATED: StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated;

afterEach(() => {
  cleanup();
});

describe("SubscriberTemplateLivePreview", () => {
  test("an email: the subject and the body filled with sample values, in a sandboxed frame", () => {
    const body: string =
      "<h1>{{incidentTitle}}</h1>{{incidentDescription}}<script>alert(1)</script>";

    render(
      <SubscriberTemplateLivePreview
        eventType={INCIDENT_CREATED}
        notificationMethod={StatusPageSubscriberNotificationMethod.Email}
        templateBody={body}
        emailSubject="{{statusPageName}}: {{incidentTitle}}"
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-subject"),
    ).toHaveTextContent("Acme Status: Checkout requests are failing");

    const frame: HTMLIFrameElement = screen.getByTestId(
      "subscriber-template-preview-frame",
    ) as HTMLIFrameElement;

    // The same compile the jobs fill the template with.
    expect(frame.getAttribute("srcdoc")).toBe(
      getEmailPreviewDocument(
        SubscriberNotificationTemplatePreview.render({
          eventType: INCIDENT_CREATED,
          notificationMethod: StatusPageSubscriberNotificationMethod.Email,
          templateBody: body,
          emailSubject: "",
        }).body,
      ),
    );
    expect(frame.getAttribute("srcdoc")).toContain(
      "<h1>Checkout requests are failing</h1><p>Customers in <strong>Europe</strong>",
    );

    const sandbox: Array<string> = (frame.getAttribute("sandbox") || "").split(
      /\s+/,
    );
    expect(frame.hasAttribute("sandbox")).toBe(true);
    expect(sandbox).not.toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
  });

  test("updates as the template is typed", () => {
    const { rerender } = render(
      <SubscriberTemplateLivePreview
        eventType={INCIDENT_CREATED}
        notificationMethod={StatusPageSubscriberNotificationMethod.SMS}
        templateBody="{{incidentTitle}}"
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-text"),
    ).toHaveTextContent("Checkout requests are failing");

    rerender(
      <SubscriberTemplateLivePreview
        eventType={INCIDENT_CREATED}
        notificationMethod={StatusPageSubscriberNotificationMethod.SMS}
        templateBody="{{incidentTitle}} ({{incidentSeverity}})"
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-text"),
    ).toHaveTextContent("Checkout requests are failing (Major)");
  });

  test("an email with no subject says the default subject is used", () => {
    render(
      <SubscriberTemplateLivePreview
        eventType={INCIDENT_CREATED}
        notificationMethod={StatusPageSubscriberNotificationMethod.Email}
        templateBody="<p>{{incidentTitle}}</p>"
        emailSubject=""
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-subject"),
    ).toHaveTextContent(SubscriberNotificationPreviewCopy.livePreviewNoSubject);
  });

  test("Slack shows the Markdown it would send, and lists placeholders the event does not offer", () => {
    render(
      <SubscriberTemplateLivePreview
        eventType={INCIDENT_CREATED}
        notificationMethod={StatusPageSubscriberNotificationMethod.Slack}
        templateBody="**{{incidentTitle}}** {{incidentStat}}"
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-text"),
    ).toHaveTextContent("**Checkout requests are failing** {{incidentStat}}");
    expect(
      screen.getByTestId("subscriber-template-preview-unknown-placeholders"),
    ).toHaveTextContent(
      "Not variables of this event, so sent as written: {{incidentStat}}",
    );
    expect(
      screen.queryByTestId("subscriber-template-preview-frame"),
    ).toBeNull();
  });

  test("before an event type is picked, or while the body is empty, it says what to do", () => {
    const { rerender } = render(
      <SubscriberTemplateLivePreview
        eventType={undefined}
        notificationMethod={StatusPageSubscriberNotificationMethod.Email}
        templateBody="<p>x</p>"
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-empty"),
    ).toHaveTextContent(
      SubscriberNotificationPreviewCopy.livePreviewPickEventType,
    );

    rerender(
      <SubscriberTemplateLivePreview
        eventType={INCIDENT_CREATED}
        notificationMethod={StatusPageSubscriberNotificationMethod.Email}
        templateBody="   "
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-empty"),
    ).toHaveTextContent(
      SubscriberNotificationPreviewCopy.livePreviewEmptyTemplate,
    );
  });

  test("a report template has no preview", () => {
    render(
      <SubscriberTemplateLivePreview
        eventType={StatusPageSubscriberNotificationEventType.SubscriberReport}
        notificationMethod={StatusPageSubscriberNotificationMethod.Email}
        templateBody="{{report.reportDates}}"
      />,
    );

    expect(
      screen.getByTestId("subscriber-template-preview-unavailable"),
    ).toHaveTextContent(
      SubscriberNotificationPreviewCopy.livePreviewReportUnavailable,
    );
  });
});
