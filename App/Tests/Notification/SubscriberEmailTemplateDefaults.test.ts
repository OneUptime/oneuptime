import { describe, expect, jest, test } from "@jest/globals";
import Handlebars from "handlebars";
import { Service as SubscriberTemplateService } from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  DefaultSubscriberNotificationTemplate,
  getDefaultSubscriberNotificationTemplate,
} from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";

/*
 * Exercise the same substitution method that subscriber workers use for custom
 * email starters. Database dependencies are irrelevant to this pure method;
 * the report follows its separate production path through real Handlebars.
 */
jest.mock("Common/Server/Services/DatabaseService", () => {
  return { __esModule: true, default: class DatabaseServiceMock {} };
});
jest.mock(
  "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate",
  () => {
    return { __esModule: true, default: class SubscriberTemplateModelMock {} };
  },
);
jest.mock(
  "Common/Server/Services/StatusPageSubscriberNotificationTemplateStatusPageService",
  () => {
    return { __esModule: true, default: {} };
  },
);

const Event: typeof StatusPageSubscriberNotificationEventType =
  StatusPageSubscriberNotificationEventType;
const Method: typeof StatusPageSubscriberNotificationMethod =
  StatusPageSubscriberNotificationMethod;
const STATUS_URL: string = "https://status.example.com/customer-services";
const DETAILS_URL: string =
  "https://status.example.com/incidents/event-123?view=details&locale=en";
const UNSUBSCRIBE_URL: string =
  "https://status.example.com/subscriptions/unsubscribe?token=unsubscribe-123";
const MANAGE_URL: string =
  "https://status.example.com/subscriptions/manage?token=manage-456";
const CONFIRM_URL: string =
  "https://status.example.com/subscriptions/confirm?token=confirm-789";

const VARIABLES: Record<string, string> = {
  statusPageName: "Customer Services",
  statusPageUrl: STATUS_URL,
  detailsUrl: DETAILS_URL,
  unsubscribeUrl: UNSUBSCRIBE_URL,
  manageSubscriptionUrl: MANAGE_URL,
  confirmationUrl: CONFIRM_URL,
  incidentTitle: "Checkout requests failing",
  incidentSeverity: "Critical",
  incidentState: "Monitoring",
  incidentDescription: "Payment requests fail in Europe.",
  episodeTitle: "Regional network interruption",
  episodeSeverity: "Major",
  episodeState: "Investigating",
  episodeDescription: "Several network incidents are being investigated.",
  resourcesAffected: "Checkout API, Search API",
  note: "A replacement router is now receiving traffic.",
  postmortemNote: "A failed routing update caused the interruption.",
  announcementTitle: "New support hours",
  announcementDescription: "Support is now available every day.",
  scheduledMaintenanceTitle: "Database engine upgrade",
  scheduledMaintenanceDescription: "The database engine will be upgraded.",
  scheduledMaintenanceState: "In Progress",
  scheduledStartTime: "September 12, 2026 at 22:00 UTC",
  scheduledEndTime: "September 13, 2026 at 00:00 UTC",
  postedAt: "September 7, 2026 at 12:30 UTC",
};

interface EventCase {
  event: StatusPageSubscriberNotificationEventType;
  heading: string;
  subject: string;
  fields: Array<[string, string]>;
  action: string;
  sms: string;
}

const EVENT_CASES: Array<EventCase> = [
  {
    event: Event.SubscriberIncidentCreated,
    heading: "New Incident: Checkout requests failing",
    subject: "New Incident: Checkout requests failing",
    fields: [
      ["Incident", "Checkout requests failing"],
      ["Severity", "Critical"],
      ["Affected Resources", "Checkout API, Search API"],
      ["Description", "Payment requests fail in Europe."],
    ],
    action: "View Incident Details",
    sms: `Incident Checkout requests failing (Critical) on Customer Services. Impact: Checkout API, Search API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberIncidentStateChanged,
    heading: "Checkout requests failing",
    subject: "Checkout requests failing - Monitoring",
    fields: [
      ["Incident", "Checkout requests failing"],
      ["Current State", "Monitoring"],
      ["Severity", "Critical"],
      ["Affected Resources", "Checkout API, Search API"],
    ],
    action: "View Incident Details",
    sms: `Incident Checkout requests failing on Customer Services is Monitoring. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberIncidentNoteCreated,
    heading: "Incident: Checkout requests failing",
    subject: "Incident: Checkout requests failing",
    fields: [
      ["Incident Title", "Checkout requests failing"],
      ["Resources Affected", "Checkout API, Search API"],
      ["Severity", "Critical"],
      ["Note", "A replacement router is now receiving traffic."],
    ],
    action: "View Incident Details",
    sms: `Incident update: Checkout requests failing on Customer Services. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberIncidentPostmortemPublished,
    heading: "Postmortem Published: Checkout requests failing",
    subject: "Postmortem Published: Checkout requests failing",
    fields: [
      ["Incident", "Checkout requests failing"],
      ["Severity", "Critical"],
      ["Affected Resources", "Checkout API, Search API"],
      [
        "Postmortem Summary",
        "A failed routing update caused the interruption.",
      ],
    ],
    action: "Read Full Postmortem",
    sms: `Postmortem: Checkout requests failing (Critical) on Customer Services. Impact: Checkout API, Search API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberEpisodeCreated,
    heading: "New Incident: Regional network interruption",
    subject: "New Incident: Regional network interruption",
    fields: [
      ["Incident", "Regional network interruption"],
      ["Severity", "Major"],
      ["Affected Resources", "Checkout API, Search API"],
      ["Description", "Several network incidents are being investigated."],
    ],
    action: "View Incident Details",
    sms: `Incident Regional network interruption (Major) on Customer Services. Impact: Checkout API, Search API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberEpisodeStateChanged,
    heading: "Regional network interruption",
    subject: "Regional network interruption - Investigating",
    fields: [
      ["Incident", "Regional network interruption"],
      ["Current State", "Investigating"],
      ["Severity", "Major"],
      ["Affected Resources", "Checkout API, Search API"],
    ],
    action: "View Incident Details",
    sms: `Incident Regional network interruption on Customer Services is Investigating. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberEpisodeNoteCreated,
    heading: "Incident: Regional network interruption",
    subject: "Incident: Regional network interruption",
    fields: [
      ["Incident Title", "Regional network interruption"],
      ["Resources Affected", "Checkout API, Search API"],
      ["Severity", "Major"],
      ["Note", "A replacement router is now receiving traffic."],
    ],
    action: "View Incident Details",
    sms: `Incident update: Regional network interruption on Customer Services. A new note is posted. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberAnnouncementCreated,
    heading: "📢 Announcement: New support hours",
    subject: "📢 Announcement: New support hours",
    fields: [
      ["Announcement", "New support hours"],
      ["Details", "Support is now available every day."],
    ],
    action: "View Announcement",
    sms: `Announcement New support hours on Customer Services. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberScheduledMaintenanceCreated,
    heading: "Scheduled Maintenance: Database engine upgrade",
    subject: "Scheduled Maintenance: Database engine upgrade",
    fields: [
      ["Maintenance Event", "Database engine upgrade"],
      ["Status", "Scheduled"],
      ["Scheduled Start", "September 12, 2026 at 22:00 UTC"],
      ["Scheduled End", "September 13, 2026 at 00:00 UTC"],
      ["Affected Resources", "Checkout API, Search API"],
      ["Description", "The database engine will be upgraded."],
    ],
    action: "View Maintenance Details",
    sms: `Scheduled Maintenance: Database engine upgrade on Customer Services. Impact: Checkout API, Search API. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberScheduledMaintenanceStateChanged,
    heading: "Scheduled Maintenance: Database engine upgrade",
    subject: "Scheduled Maintenance: Database engine upgrade - In Progress",
    fields: [
      ["Event Title", "Database engine upgrade"],
      ["Event State", "In Progress"],
      ["Resources Affected", "Checkout API, Search API"],
    ],
    action: "View Maintenance Details",
    sms: `Maintenance Database engine upgrade on Customer Services is In Progress. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
  {
    event: Event.SubscriberScheduledMaintenanceNoteCreated,
    heading: "Scheduled Maintenance: Database engine upgrade",
    subject: "Scheduled Maintenance: Database engine upgrade",
    fields: [
      ["Event Title", "Database engine upgrade"],
      ["Event Description", "The database engine will be upgraded."],
      ["Resources Affected", "Checkout API, Search API"],
      ["Note", "A replacement router is now receiving traffic."],
    ],
    action: "View Maintenance Details",
    sms: `Maintenance update: Database engine upgrade on Customer Services. Details: ${DETAILS_URL}. Unsub: ${UNSUBSCRIBE_URL}`,
  },
];

function getTemplate(
  event: StatusPageSubscriberNotificationEventType,
  method: StatusPageSubscriberNotificationMethod = Method.Email,
): DefaultSubscriberNotificationTemplate {
  const template: DefaultSubscriberNotificationTemplate | null =
    getDefaultSubscriberNotificationTemplate(event, method);

  expect(template).not.toBeNull();
  return template!;
}

function render(
  event: StatusPageSubscriberNotificationEventType,
  overrides: Record<string, string> = {},
  method: StatusPageSubscriberNotificationMethod = Method.Email,
): { body: string; subject: string } {
  const template: DefaultSubscriberNotificationTemplate = getTemplate(
    event,
    method,
  );
  const variables: Record<string, string> = { ...VARIABLES, ...overrides };

  return {
    body: SubscriberTemplateService.compileTemplate(template.body, variables),
    subject: SubscriberTemplateService.compileTemplate(
      template.subject || "",
      variables,
    ),
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectAction(html: string, label: string, destination: string): void {
  expect(html).toMatch(
    new RegExp(
      `<a\\b[^>]*href="${escapeRegExp(destination)}"[^>]*>${escapeRegExp(label)}</a>`,
    ),
  );
}

function fieldsIn(html: string): Array<[string, string]> {
  return Array.from(
    html.matchAll(
      /<div\b[^>]*>\s*<p\b[^>]*>([^<]*)<\/p>\s*<p\b[^>]*>([^<]*)<\/p>\s*<\/div>/g,
    ),
    (match: RegExpMatchArray): [string, string] => {
      return [match[1]!, match[2]!];
    },
  );
}

describe("subscriber email event content through the worker's real compiler", () => {
  test.each(EVENT_CASES)(
    "$event retains its subject, ordered detail fields and actions",
    (data: EventCase) => {
      const { body, subject } = render(data.event);

      expect(subject).toBe(data.subject);
      expect(body).toMatch(
        new RegExp(`<h1\\b[^>]*>${escapeRegExp(data.heading)}</h1>`),
      );
      expect(fieldsIn(body)).toEqual(data.fields);
      expectAction(body, data.action, DETAILS_URL);
      expectAction(body, "unsubscribe", UNSUBSCRIBE_URL);
      expect(body).not.toContain(MANAGE_URL);
      expect(body).not.toContain(CONFIRM_URL);
      expect(body).not.toContain("{{");
    },
  );

  test.each(EVENT_CASES)(
    "$event accepts the status-page destination resolved by its worker",
    (data: EventCase) => {
      /*
       * Workers resolve detailsUrl before rendering custom starters. These
       * starters must also work when that resolved destination is the page root.
       */
      const { body } = render(data.event, { detailsUrl: STATUS_URL });

      expectAction(body, data.action, STATUS_URL);
      expect(body).not.toContain(DETAILS_URL);
      expectAction(body, "unsubscribe", UNSUBSCRIBE_URL);
    },
  );

  test.each([
    [Event.SubscriberIncidentCreated, "incidentDescription"],
    [Event.SubscriberIncidentNoteCreated, "note"],
    [Event.SubscriberIncidentPostmortemPublished, "postmortemNote"],
    [Event.SubscriberEpisodeCreated, "episodeDescription"],
    [Event.SubscriberEpisodeNoteCreated, "note"],
    [Event.SubscriberAnnouncementCreated, "announcementDescription"],
    [
      Event.SubscriberScheduledMaintenanceCreated,
      "scheduledMaintenanceDescription",
    ],
    [
      Event.SubscriberScheduledMaintenanceNoteCreated,
      "scheduledMaintenanceDescription",
    ],
    [Event.SubscriberScheduledMaintenanceNoteCreated, "note"],
  ] as Array<[StatusPageSubscriberNotificationEventType, string]>)(
    "%s preserves prepared rich HTML in %s",
    (event: StatusPageSubscriberNotificationEventType, field: string) => {
      const richContent: string =
        '<p>Progress: <strong>traffic restored</strong>.</p><ul><li>Database healthy</li><li>Monitoring continues</li></ul><a href="https://status.example.com/updates/42">Read the update</a>';
      const { body } = render(event, { [field]: richContent });

      expect(body.split(richContent)).toHaveLength(2);
      expect(body).not.toContain("&lt;p&gt;");
      expect(body).not.toContain(`{{${field}}}`);
      expectAction(body, "unsubscribe", UNSUBSCRIBE_URL);
    },
  );
});

describe("subscriber lifecycle email destinations", () => {
  test("confirmation distinguishes its confirmation token from management and unsubscribe", () => {
    const { body, subject } = render(Event.SubscriberSubscriptionConfirmation);

    expect(subject).toBe(
      "Customer Services - Please confirm your subscription",
    );
    expectAction(body, "Confirm Subscription", CONFIRM_URL);
    expectAction(body, STATUS_URL, STATUS_URL);
    expectAction(body, "unsubscribe", UNSUBSCRIBE_URL);
    expect(body).not.toContain(MANAGE_URL);
    expect(body).not.toContain(DETAILS_URL);
  });

  test("the subscribed email opens the status page without asking for confirmation again", () => {
    const { body, subject } = render(Event.SubscriberSubscribed);

    expect(subject).toBe("You have been subscribed to Customer Services");
    expectAction(body, "Go to Status Page", STATUS_URL);
    expectAction(body, STATUS_URL, STATUS_URL);
    expectAction(body, "unsubscribe", UNSUBSCRIBE_URL);
    expect(body).not.toContain(CONFIRM_URL);
    expect(body).not.toContain("Confirm Subscription");
    expect(body).not.toContain(MANAGE_URL);
  });

  test("management uses its dedicated token and does not add a one-click unsubscribe action", () => {
    const { body, subject } = render(Event.SubscriberManageSubscription);

    expect(subject).toBe("Manage your Subscription for Customer Services");
    expectAction(body, "Manage Subscription", MANAGE_URL);
    expectAction(body, STATUS_URL, STATUS_URL);
    expect(body).not.toContain(UNSUBSCRIBE_URL);
    expect(body).not.toContain(CONFIRM_URL);
  });
});

const REPORT: Record<string, unknown> = {
  reportPeriodName: "August 2026",
  reportDates: "August 1 - August 31",
  reportStartDate: "August 1, 2026",
  reportEndDate: "August 31, 2026",
  reportTimezone: "Europe/London",
  averageUptimePercent: "99.90%",
  totalDowntimeInHoursAndMinutes: "43 minutes",
  totalIncidents: 3,
  totalResources: 2,
  hasGroups: true,
  rows: [
    {
      isGroup: true,
      name: "Europe",
      indentInPixels: 0,
      uptimePercentAsString: "99.90%",
      downtimeInHoursAndMinutes: "43 minutes",
      totalIncidentCount: 3,
    },
    {
      isGroup: false,
      name: "Checkout API",
      indentInPixels: 16,
      uptimePercentAsString: "99.80%",
      downtimeInHoursAndMinutes: "86 minutes",
      totalIncidentCount: 3,
    },
    {
      isGroup: false,
      name: "Search API",
      indentInPixels: 16,
      uptimePercentAsString: "100%",
      downtimeInHoursAndMinutes: "0 minutes",
      totalIncidentCount: 0,
    },
  ],
};

function renderReport(
  report: Record<string, unknown> = REPORT,
  overrides: Record<string, unknown> = {},
): string {
  const template: DefaultSubscriberNotificationTemplate = getTemplate(
    Event.SubscriberReport,
  );
  const engine: typeof Handlebars = Handlebars.create();

  return engine.compile(template.body)({ ...VARIABLES, report, ...overrides });
}

function reportCells(html: string): Array<Array<string>> {
  const table: string =
    html.match(
      /<table\b[^>]*aria-label="Uptime by resource"[^>]*>([\s\S]*?)<\/table>/,
    )?.[1] || "";

  return Array.from(
    table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g),
    (row: RegExpMatchArray): Array<string> => {
      return Array.from(
        row[1]!.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/g),
        (cell: RegExpMatchArray): string => {
          return cell[1]!.replace(/<[^>]*>/g, "").trim();
        },
      );
    },
  );
}

describe("standalone report content and optional sections", () => {
  test("keeps each resource's metrics associated with the right row, including zero incidents", () => {
    const html: string = renderReport();

    expect(reportCells(html)).toEqual([
      ["Group / Resource", "Uptime", "Downtime", "Incidents"],
      ["Europe", "99.90%", "43 minutes", "3"],
      ["Checkout API", "99.80%", "86 minutes", "3"],
      ["Search API", "100%", "0 minutes", "0"],
    ]);
    expect(html).toContain(
      "August 1, 2026 &ndash; August 31, 2026 (Europe/London)",
    );
    expect(html).toContain("Breakdown by group");
    expectAction(
      html,
      "View Full Status Page",
      Handlebars.escapeExpression(DETAILS_URL),
    );
  });

  test("renders an ungrouped resource without introducing a group header or blank group row", () => {
    const html: string = renderReport({
      ...REPORT,
      hasGroups: false,
      totalResources: 1,
      rows: [
        {
          isGroup: false,
          name: "Standalone monitor",
          indentInPixels: 0,
          uptimePercentAsString: "100%",
          downtimeInHoursAndMinutes: "0 minutes",
          totalIncidentCount: 0,
        },
      ],
    });

    expect(reportCells(html)).toEqual([
      ["Resource", "Uptime", "Downtime", "Incidents"],
      ["Standalone monitor", "100%", "0 minutes", "0"],
    ]);
    expect(html).toContain("Per-resource breakdown");
    expect(html).not.toContain("Breakdown by group");
  });

  test("an empty report hides stale metrics and resource rows but keeps subscription navigation", () => {
    const html: string = renderReport({ ...REPORT, totalResources: 0 });

    expect(html).toContain(
      "No resources have been added to this status page yet",
    );
    expect(reportCells(html)).toEqual([]);
    expect(html).not.toContain("Average Uptime</p>");
    expect(html).not.toContain("99.90%");
    expect(html).not.toContain("Checkout API");
    expectAction(
      html,
      "View Full Status Page",
      Handlebars.escapeExpression(DETAILS_URL),
    );
    expectAction(
      html,
      "unsubscribe",
      Handlebars.escapeExpression(UNSUBSCRIBE_URL),
    );
  });

  test.each([undefined, ""])(
    "omits the unsubscribe paragraph when its URL is %s",
    (unsubscribeUrl: string | undefined) => {
      const html: string = renderReport(REPORT, { unsubscribeUrl });

      expect(html).not.toContain(
        "If you no longer wish to receive these notifications",
      );
      expect(html).not.toContain('href=""');
      expectAction(
        html,
        "View Full Status Page",
        Handlebars.escapeExpression(DETAILS_URL),
      );
    },
  );

  test("prints the optional footer as escaped text exactly once", () => {
    const footer: string = "Questions? Contact <support> & our team.";
    const html: string = renderReport(REPORT, {
      subscriberEmailNotificationFooterText: footer,
    });

    expect(html.split(Handlebars.escapeExpression(footer))).toHaveLength(2);
    expect(html).not.toContain(footer);
    expect(renderReport()).not.toContain("Questions? Contact");
  });

  test("retains a caller-resolved status-page fallback URL in the report action", () => {
    const html: string = renderReport(REPORT, { detailsUrl: STATUS_URL });

    expectAction(html, "View Full Status Page", STATUS_URL);
    expect(html).not.toContain(Handlebars.escapeExpression(DETAILS_URL));
  });
});

describe("non-email defaults remain independent of email presentation", () => {
  test.each(EVENT_CASES)(
    "$event retains its plain SMS wording and URLs",
    (data: EventCase) => {
      const { body, subject } = render(data.event, {}, Method.SMS);

      expect(body).toBe(data.sms);
      expect(subject).toBe("");
      expect(body).not.toMatch(/<(?:style|table|a)\b/);
    },
  );

  test("subscription-management SMS keeps the management token", () => {
    expect(
      render(Event.SubscriberManageSubscription, {}, Method.SMS).body,
    ).toBe(
      `You have selected to manage your subscription for the status page: Customer Services. You can manage your subscription here: ${MANAGE_URL}`,
    );
  });

  test.each([
    Event.SubscriberSubscriptionConfirmation,
    Event.SubscriberSubscribed,
  ])(
    "%s does not gain unsupported SMS or webhook templates",
    (event: StatusPageSubscriberNotificationEventType) => {
      expect(
        getDefaultSubscriberNotificationTemplate(event, Method.SMS),
      ).toBeNull();
      expect(
        getDefaultSubscriberNotificationTemplate(event, Method.Webhook),
      ).toBeNull();
    },
  );

  test("report SMS retains metrics and the public status page destination", () => {
    const body: string = Handlebars.create().compile(
      getTemplate(Event.SubscriberReport, Method.SMS).body,
    )({ ...VARIABLES, report: REPORT });

    expect(body).toBe(
      `Customer Services uptime report for August 2026 (August 1 - August 31): 99.90% average uptime, 3 incidents, 43 minutes downtime. ${STATUS_URL}`,
    );
  });

  test.each([
    [
      Event.SubscriberIncidentCreated,
      "incident.created",
      "incident",
      {
        title: VARIABLES["incidentTitle"],
        description: VARIABLES["incidentDescription"],
        severity: "Critical",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberIncidentStateChanged,
      "incident.stateChanged",
      "incident",
      {
        title: VARIABLES["incidentTitle"],
        description: VARIABLES["incidentDescription"],
        severity: "Critical",
        state: "Monitoring",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberIncidentPostmortemPublished,
      "incident.postmortemPublished",
      "incident",
      {
        title: VARIABLES["incidentTitle"],
        severity: "Critical",
        resourcesAffected: VARIABLES["resourcesAffected"],
        postmortemNote: VARIABLES["postmortemNote"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberEpisodeCreated,
      "episode.created",
      "episode",
      {
        title: VARIABLES["episodeTitle"],
        description: VARIABLES["episodeDescription"],
        severity: "Major",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberEpisodeStateChanged,
      "episode.stateChanged",
      "episode",
      {
        title: VARIABLES["episodeTitle"],
        severity: "Major",
        state: "Investigating",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberAnnouncementCreated,
      "announcement.created",
      "announcement",
      {
        title: VARIABLES["announcementTitle"],
        description: VARIABLES["announcementDescription"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberScheduledMaintenanceCreated,
      "scheduledMaintenance.created",
      "scheduledMaintenance",
      {
        title: VARIABLES["scheduledMaintenanceTitle"],
        description: VARIABLES["scheduledMaintenanceDescription"],
        scheduledStartTime: VARIABLES["scheduledStartTime"],
        scheduledEndTime: VARIABLES["scheduledEndTime"],
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
    ],
    [
      Event.SubscriberScheduledMaintenanceStateChanged,
      "scheduledMaintenance.stateChanged",
      "scheduledMaintenance",
      {
        title: VARIABLES["scheduledMaintenanceTitle"],
        description: VARIABLES["scheduledMaintenanceDescription"],
        state: "In Progress",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
    ],
  ] as Array<
    [
      StatusPageSubscriberNotificationEventType,
      string,
      string,
      Record<string, unknown>,
    ]
  >)(
    "%s keeps its structured webhook event and resource payload",
    (
      event: StatusPageSubscriberNotificationEventType,
      eventName: string,
      resourceKey: string,
      resource: Record<string, unknown>,
    ) => {
      const payload: Record<string, unknown> = JSON.parse(
        render(event, {}, Method.Webhook).body,
      ) as Record<string, unknown>;

      expect(payload).toEqual({
        event: eventName,
        statusPage: "Customer Services",
        statusPageUrl: STATUS_URL,
        [resourceKey]: resource,
        unsubscribeUrl: UNSUBSCRIBE_URL,
      });
    },
  );

  test.each([
    [
      Event.SubscriberIncidentNoteCreated,
      "incident.noteCreated",
      "incident",
      {
        title: VARIABLES["incidentTitle"],
        severity: "Critical",
        state: "Monitoring",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
      true,
    ],
    [
      Event.SubscriberEpisodeNoteCreated,
      "episode.noteCreated",
      "episode",
      {
        title: VARIABLES["episodeTitle"],
        severity: "Major",
        resourcesAffected: VARIABLES["resourcesAffected"],
        detailsUrl: DETAILS_URL,
      },
      false,
    ],
    [
      Event.SubscriberScheduledMaintenanceNoteCreated,
      "scheduledMaintenance.noteCreated",
      "scheduledMaintenance",
      {
        title: VARIABLES["scheduledMaintenanceTitle"],
        description: VARIABLES["scheduledMaintenanceDescription"],
        state: "In Progress",
        detailsUrl: DETAILS_URL,
      },
      true,
    ],
  ] as Array<
    [
      StatusPageSubscriberNotificationEventType,
      string,
      string,
      Record<string, unknown>,
      boolean,
    ]
  >)(
    "%s keeps the note separate from its webhook resource",
    (
      event: StatusPageSubscriberNotificationEventType,
      eventName: string,
      resourceKey: string,
      resource: Record<string, unknown>,
      hasPostedAt: boolean,
    ) => {
      const payload: Record<string, unknown> = JSON.parse(
        render(event, {}, Method.Webhook).body,
      ) as Record<string, unknown>;

      expect(payload).toEqual({
        event: eventName,
        statusPage: "Customer Services",
        statusPageUrl: STATUS_URL,
        [resourceKey]: resource,
        note: VARIABLES["note"],
        ...(hasPostedAt ? { postedAt: VARIABLES["postedAt"] } : {}),
        unsubscribeUrl: UNSUBSCRIBE_URL,
      });
    },
  );

  test("report webhook keeps its stable nested metric names and string values", () => {
    const body: string = Handlebars.create().compile(
      getTemplate(Event.SubscriberReport, Method.Webhook).body,
    )({
      ...VARIABLES,
      unsubscribeUrl: "https://status.example.com/unsubscribe/123",
      report: REPORT,
    });
    const payload: Record<string, unknown> = JSON.parse(body) as Record<
      string,
      unknown
    >;

    expect(payload).toEqual({
      event: "subscriber.report",
      statusPage: "Customer Services",
      statusPageUrl: STATUS_URL,
      report: {
        reportDates: "August 1 - August 31",
        reportPeriodName: "August 2026",
        reportStartDate: "August 1, 2026",
        reportEndDate: "August 31, 2026",
        reportTimezone: "Europe/London",
        averageUptimePercent: "99.90%",
        totalDowntimeInHoursAndMinutes: "43 minutes",
        totalIncidents: "3",
        totalResources: "2",
      },
      unsubscribeUrl: "https://status.example.com/unsubscribe/123",
    });
  });
});
