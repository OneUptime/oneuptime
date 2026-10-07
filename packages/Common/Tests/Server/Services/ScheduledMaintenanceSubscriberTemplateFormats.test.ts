import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import SmsService from "../../../Server/Services/SmsService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Markdown from "../../../Server/Types/Markdown";
import SlackUtil from "../../../Server/Utils/Workspace/Slack/Slack";
import StatusPageSubscriberWebhookUtil from "../../../Server/Utils/StatusPageSubscriberWebhook";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import OneUptimeDate from "../../../Types/Date";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import SubscriberNotificationTemplateVariables from "../../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import SafeHtml from "../../../Types/SafeHtml";
import { escapeMarkdownValue } from "../../../Utils/Markdown/MarkdownEscape";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A custom email body for a newly scheduled maintenance is HTML: it is
 * wrapped only by BlankTemplate, so nothing converts Markdown in it later.
 * The subject is plain text, SMS is plain text, and Slack renders Markdown.
 *
 * notififySubscribersOnEventScheduled used to hand the custom email body
 * (and subject) the description exactly as the author wrote it, in
 * Markdown, so `**bold**` and line breaks reached subscribers verbatim.
 * This suite pins the format each channel's template now receives.
 *
 * Everything the service talks to is a `jest.spyOn`; compileTemplate is the
 * real one, spied on so the variables each template got can be read back.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const EVENT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const MONITOR_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

// The secret in the subscriber's unsubscribe link, as its row carries it.
const UNSUBSCRIBE_TOKEN: string = "5e".repeat(32);
const STATUS_PAGE_URL: string = "https://status.example.com";
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/unsubscribe/${SUBSCRIBER_ID.toString()}-${UNSUBSCRIBE_TOKEN}`;
const MANAGE_URL: string = `${STATUS_PAGE_URL}/update-subscription/${SUBSCRIBER_ID.toString()}`;

const STARTS_AT: Date = new Date("2024-03-04T06:08:00.000Z");
const TITLE: string = "Quarterly database failover drill";
const DESCRIPTION: string = "Failing over the **primary**.";
const DESCRIPTION_HTML: string =
  "<p>Failing over the <strong>primary</strong>.</p>";
const DESCRIPTION_TEXT: string = "Failing over the primary.";

// One template per channel; each echoes the description.
const CUSTOM_BODIES: Record<string, string> = {
  [StatusPageSubscriberNotificationMethod.Email]:
    "<div>{{scheduledMaintenanceDescription}}</div>",
  [StatusPageSubscriberNotificationMethod.SMS]:
    "SMS {{scheduledMaintenanceDescription}}",
  [StatusPageSubscriberNotificationMethod.Slack]:
    "Slack {{scheduledMaintenanceDescription}}",
};
const CUSTOM_SUBJECT: string =
  "{{scheduledMaintenanceTitle}}: {{scheduledMaintenanceDescription}}";

// The email-only variables are HTML in the body; the subject gets them as text.
const LEGACY_SUBJECT: string = "{{eventDescription}} at {{scheduledAt}}";

function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function scheduledEvent(id: ObjectID = EVENT_ID): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();

  event._id = id.toString();
  event.projectId = PROJECT_ID;
  event.title = TITLE;
  event.description = DESCRIPTION;
  event.startsAt = STARTS_AT;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  event.monitors = [monitor];

  const statusPage: StatusPage = new StatusPage();
  statusPage._id = STATUS_PAGE_ID.toString();
  event.statusPages = [statusPage];

  return event;
}

function statusPage(options: { withCustomProviders: boolean }): StatusPage {
  const page: StatusPage = new StatusPage();

  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme Status";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showScheduledMaintenanceEventsOnStatusPage = true;
  page.subscriberTimezones = [];

  if (options.withCustomProviders) {
    const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
    smtpConfig._id = "55555555-5555-4555-8555-555555555555";
    page.smtpConfig = smtpConfig;

    const callSmsConfig: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    callSmsConfig._id = "66666666-6666-4666-8666-666666666666";
    page.callSmsConfig = callSmsConfig;
  }

  return page;
}

function resource(displayName: string): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = displayName;
  return row;
}

function subscriber(id: ObjectID = SUBSCRIBER_ID): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();

  row._id = id.toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.isUnsubscribed = false;
  row.isSubscribedToAllResources = true;
  row.isSubscribedToAllEventTypes = true;
  row.subscriberEmail = new Email("subscriber@example.com");
  row.subscriberPhone = new Phone("+15558675309");
  row.slackIncomingWebhookUrl = URL.fromString(
    "https://hooks.slack.com/services/T/B/X",
  );
  row.subscriberWebhook = URL.fromString(
    "https://hooks.example.com/subscriber",
  );
  row.unsubscribeToken = UNSUBSCRIBE_TOKEN;

  return row;
}

function useCustomTemplates(subject: string): void {
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockImplementation(
      async (data: {
        notificationMethod: StatusPageSubscriberNotificationMethod;
      }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
        const body: string | undefined = CUSTOM_BODIES[data.notificationMethod];

        if (!body) {
          return null;
        }

        const template: StatusPageSubscriberNotificationTemplate =
          new StatusPageSubscriberNotificationTemplate();
        template.templateBody = body;
        template.notificationMethod = data.notificationMethod;

        if (
          data.notificationMethod ===
          StatusPageSubscriberNotificationMethod.Email
        ) {
          template.emailSubject = subject;
        }

        return template;
      },
    );
}

function sentMail(): Array<{
  templateType: EmailTemplateType;
  subject: string;
  vars: Record<string, string>;
}> {
  return mock(MailService.sendMail).mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      templateType: EmailTemplateType;
      subject: string;
      vars: Record<string, string>;
    };
  });
}

function sentSms(): Array<string> {
  return mock(SmsService.sendSms).mock.calls.map(
    (call: Array<unknown>): string => {
      return (call[0] as { message: string }).message;
    },
  );
}

function sentSlack(): Array<string> {
  return mock(SlackUtil.convertMarkdownToSlackRichText).mock.calls.map(
    (call: Array<unknown>): string => {
      return call[0] as string;
    },
  );
}

function sentWebhookData(): Record<string, string> {
  const call: Array<unknown> = mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mock.calls[0]!;

  return (call[0] as { payload: { data: Record<string, string> } }).payload
    .data;
}

/*
 * The variables the service handed to the compile of this template, as it
 * passed them. The email body goes through compileEmailBodyTemplate, where
 * HTML values are SafeHtml; everything else through compileTemplate.
 */
function rawVariablesCompiledInto(
  template: string,
): Record<string, string | SafeHtml> {
  const calls: Array<Array<unknown>> = [
    ...mock(
      StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
    ).mock.calls,
    ...mock(
      StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
    ).mock.calls,
  ].filter((call: Array<unknown>): boolean => {
    return call[0] === template;
  });

  expect(calls).toHaveLength(1);
  return calls[0]![1] as Record<string, string | SafeHtml>;
}

// The same, with every SafeHtml value as its HTML.
function variablesCompiledInto(template: string): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const [name, value] of Object.entries(
    rawVariablesCompiledInto(template),
  )) {
    variables[name] = SafeHtml.isSafeHtml(value) ? value.toHtml() : value;
  }

  return variables;
}

describe("scheduled maintenance subscriber notifications: template formats", () => {
  beforeEach(() => {
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);

    jest
      .spyOn(StatusPageResourceService, "findByMonitors")
      .mockResolvedValue([resource("Primary database"), resource("Replica")]);

    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([statusPage({ withCustomProviders: true })]);
    jest
      .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
      .mockResolvedValue([subscriber()]);

    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.example.com");

    useCustomTemplates(CUSTOM_SUBJECT);

    jest
      .spyOn(ProjectSmtpConfigService, "toEmailServer")
      .mockReturnValue(undefined);
    jest
      .spyOn(ProjectCallSMSConfigService, "toTwilioConfig")
      .mockReturnValue(undefined);

    jest.spyOn(Markdown, "convertToHTML").mockResolvedValue(DESCRIPTION_HTML);
    jest
      .spyOn(Markdown, "convertToPlainText")
      .mockReturnValue(DESCRIPTION_TEXT);

    jest.spyOn(
      StatusPageSubscriberNotificationTemplateServiceClass,
      "compileTemplate",
    );
    jest.spyOn(
      StatusPageSubscriberNotificationTemplateServiceClass,
      "compileEmailBodyTemplate",
    );

    jest.spyOn(MailService, "sendMail").mockResolvedValue(accepted());
    jest.spyOn(SmsService, "sendSms").mockResolvedValue(accepted());
    jest
      .spyOn(SlackUtil, "sendMessageToChannelViaIncomingWebhook")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(SlackUtil, "convertMarkdownToSlackRichText")
      .mockImplementation((markdown: string): string => {
        return markdown;
      });
    jest
      .spyOn(StatusPageSubscriberWebhookUtil, "sendWebhookNotification")
      .mockResolvedValue(accepted());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("renders HTML in a custom email body, plain text in the subject and SMS, and Markdown in Slack", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]!.templateType).toBe(EmailTemplateType.BlankTemplate);
    expect(sentMail()[0]!.vars).toEqual({
      body: `<div>${DESCRIPTION_HTML}</div>`,
    });
    expect(sentMail()[0]!.subject).toBe(`${TITLE}: ${DESCRIPTION_TEXT}`);
    expect(sentSms()).toEqual([`SMS ${DESCRIPTION_TEXT}`]);
    expect(sentSlack()).toEqual([`Slack ${DESCRIPTION}`]);
  });

  test("hands each channel's template the description in that channel's format", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    const emailBody: Record<string, string> = variablesCompiledInto(
      CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!,
    );
    const emailSubject: Record<string, string> =
      variablesCompiledInto(CUSTOM_SUBJECT);
    const sms: Record<string, string> = variablesCompiledInto(
      CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]!,
    );
    const slack: Record<string, string> = variablesCompiledInto(
      CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Slack]!,
    );

    expect(emailBody["scheduledMaintenanceDescription"]).toBe(DESCRIPTION_HTML);
    expect(emailBody["eventDescription"]).toBe(DESCRIPTION_HTML);
    expect(emailSubject["scheduledMaintenanceDescription"]).toBe(
      DESCRIPTION_TEXT,
    );
    expect(emailSubject["eventDescription"]).toBe(DESCRIPTION_TEXT);
    expect(sms["scheduledMaintenanceDescription"]).toBe(DESCRIPTION_TEXT);
    expect(slack["scheduledMaintenanceDescription"]).toBe(DESCRIPTION);

    // Everything else is shared, so no channel lost a variable.
    const shared: Record<string, unknown> = {
      statusPageName: "Acme Status",
      statusPageUrl: "https://status.example.com",
      detailsUrl: `https://status.example.com/scheduled-events/${EVENT_ID.toString()}`,
      scheduledMaintenanceTitle: TITLE,
      scheduledStartTime:
        OneUptimeDate.getDateAsUserFriendlyFormattedString(STARTS_AT),
      scheduledEndTime: "",
      resourcesAffected: "Primary database, Replica",
    };

    /*
     * Every message links to the subscriber's unsubscribe page, token and
     * all - except an SMS from this public page, which keeps the shorter
     * manage link (see StatusPageSubscriberUnsubscribe.buildSmsLink).
     */
    expect(sms).toEqual({
      ...shared,
      scheduledMaintenanceDescription: DESCRIPTION_TEXT,
      unsubscribeUrl: MANAGE_URL,
    });
    expect(slack).toEqual({
      ...shared,
      scheduledMaintenanceDescription: DESCRIPTION,
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    expect(emailBody).toEqual(
      expect.objectContaining({ ...shared, unsubscribeUrl: UNSUBSCRIBE_URL }),
    );
    expect(emailSubject).toEqual(
      expect.objectContaining({ ...shared, unsubscribeUrl: UNSUBSCRIBE_URL }),
    );
    expect(Object.keys(emailSubject).sort()).toEqual(
      Object.keys(emailBody).sort(),
    );
  });

  test("gives the subject the email-only variables as one line of text", async () => {
    useCustomTemplates(LEGACY_SUBJECT);

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    const scheduledAt: string =
      OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
        date: STARTS_AT,
        timezones: [],
        use12HourFormat: true,
      }).join(", ");

    // Guards the fixture: the body's version of this is several HTML lines.
    expect(
      OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
        date: STARTS_AT,
        timezones: [],
        use12HourFormat: true,
      }),
    ).toContain("<br/>");

    expect(sentMail()[0]!.subject).toBe(
      `${DESCRIPTION_TEXT} at ${scheduledAt}`,
    );
    expect(sentMail()[0]!.subject).not.toContain("<");
  });

  test("keeps the Markdown description in the webhook payload", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    expect(sentWebhookData()["scheduledMaintenanceDescription"]).toBe(
      DESCRIPTION,
    );
  });

  test("still gives the default email template the HTML description", async () => {
    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockResolvedValue(null);

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
    ]);

    expect(sentMail()[0]!.templateType).toBe(
      EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
    );
    expect(sentMail()[0]!.vars["eventDescription"]).toBe(DESCRIPTION_HTML);
    expect(sentMail()[0]!.subject).toBe(`[Scheduled Maintenance] ${TITLE}`);
  });

  test("converts the description once per event, not once per subscriber", async () => {
    jest
      .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
      .mockResolvedValue([
        subscriber(),
        subscriber(new ObjectID("88888888-8888-4888-8888-888888888888")),
        subscriber(new ObjectID("99999999-9999-4999-8999-999999999999")),
      ]);

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent(),
      scheduledEvent(new ObjectID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")),
    ]);

    expect(sentMail()).toHaveLength(6);
    expect(Markdown.convertToHTML).toHaveBeenCalledTimes(2);
    expect(Markdown.convertToPlainText).toHaveBeenCalledTimes(2);
  });

  /*
   * The subject is finished text once compileTemplate has filled it, so the
   * mail is marked literal. The mailer used to compile it again, and a
   * description quoting template syntax either stopped the email or lost the
   * quoted words.
   */
  test.each([
    "Deploy blocked on {{ x }}",
    "Helm upgrade failed: {{ .Values.image.tag }} was empty",
    "Config parser stopped at {{ on line 3",
  ])(
    "sends a subject quoting template syntax as written: %s",
    async (text: string) => {
      jest.spyOn(Markdown, "convertToPlainText").mockReturnValue(text);
      useCustomTemplates("{{scheduledMaintenanceTitle}}: {{eventDescription}}");

      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        scheduledEvent(),
      ]);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]).toEqual(
        expect.objectContaining({
          subject: `${TITLE}: ${text}`,
          isSubjectLiteral: true,
        }),
      );
    },
  );

  test("sends the default subject of a title quoting template syntax as written", async () => {
    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockResolvedValue(null);
    const event: ScheduledMaintenance = scheduledEvent();
    event.title = "Rollout of {{ .Values.image.tag }}";

    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      event,
    ]);

    expect(sentMail()).toHaveLength(1);
    expect(sentMail()[0]).toEqual(
      expect.objectContaining({
        subject: "[Scheduled Maintenance] Rollout of {{ .Values.image.tag }}",
        isSubjectLiteral: true,
      }),
    );
  });
  describe("the unsubscribe link", () => {
    beforeEach(() => {
      jest
        .spyOn(
          StatusPageSubscriberNotificationTemplateService,
          "getTemplateForStatusPage",
        )
        .mockResolvedValue(null);
    });

    test("the default email, Slack and webhook carry the token link; a public page's SMS the manage link", async () => {
      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        scheduledEvent(),
      ]);

      expect(sentMail()[0]!.vars["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
      expect(sentSlack()[0]).toContain(`[Unsubscribe](${UNSUBSCRIBE_URL})`);
      expect(
        (
          mock(StatusPageSubscriberWebhookUtil.sendWebhookNotification).mock
            .calls[0]![0] as { payload: { unsubscribeUrl: string } }
        ).payload.unsubscribeUrl,
      ).toBe(UNSUBSCRIBE_URL);
      expect(sentSms()[0]).toContain(`Unsub: ${MANAGE_URL}`);
      expect(sentSms()[0]).not.toContain(UNSUBSCRIBE_TOKEN);
    });

    test("a private page's SMS carries the token link: its manage page needs a signed-in visitor", async () => {
      const privatePage: StatusPage = statusPage({ withCustomProviders: true });
      privatePage.isPublicStatusPage = false;

      jest
        .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
        .mockResolvedValue([privatePage]);

      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        scheduledEvent(),
      ]);

      expect(sentSms()[0]).toContain(`Unsub: ${UNSUBSCRIBE_URL}`);
      expect(sentMail()[0]!.vars["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
    });

    test("a private page's custom SMS template gets the token link as {{unsubscribeUrl}}", async () => {
      const privatePage: StatusPage = statusPage({ withCustomProviders: true });
      privatePage.isPublicStatusPage = false;

      jest
        .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
        .mockResolvedValue([privatePage]);
      useCustomTemplates(CUSTOM_SUBJECT);

      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        scheduledEvent(),
      ]);

      expect(
        variablesCompiledInto(
          CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.SMS]!,
        )["unsubscribeUrl"],
      ).toBe(UNSUBSCRIBE_URL);
    });
  });

  /*
   * Escaping. The maintenance title, the status page's name and the names of
   * its resources are plain text a project member typed. In an email body
   * they must read as those characters; the description and the scheduled
   * time are HTML the service rendered, and stay HTML. The subject, SMS,
   * Slack and webhooks show text as written.
   */
  describe("escaping", () => {
    const HOSTILE_TITLE: string = "<script>alert('x')</script> Failover";
    const HOSTILE_TITLE_HTML: string =
      "&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; Failover";
    const HOSTILE_PAGE_NAME: string = '<a href="https://evil.example">Acme</a>';
    const HOSTILE_PAGE_NAME_HTML: string =
      "&lt;a href=&quot;https://evil.example&quot;&gt;Acme&lt;/a&gt;";
    const HOSTILE_RESOURCE: string = '<img src=x onerror="alert(1)"> & DB';
    const HOSTILE_RESOURCE_HTML: string =
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; DB";

    const ESCAPING_EMAIL_BODY: string =
      "<h1>{{scheduledMaintenanceTitle}}</h1><p>{{statusPageName}}</p><div>{{resourcesAffected}}</div><div>{{scheduledMaintenanceDescription}}</div>";
    const ESCAPING_TEXT: string =
      "{{scheduledMaintenanceTitle}} on {{statusPageName}}: {{resourcesAffected}}";

    function hostileEvent(): ScheduledMaintenance {
      const event: ScheduledMaintenance = scheduledEvent();
      event.title = HOSTILE_TITLE;
      return event;
    }

    function hostilePage(withCustomProviders: boolean): StatusPage {
      const page: StatusPage = statusPage({
        withCustomProviders: withCustomProviders,
      });
      page.pageTitle = HOSTILE_PAGE_NAME;
      return page;
    }

    beforeEach(() => {
      // The service reads resources without their groups: a list of names.
      jest
        .spyOn(StatusPageResourceService, "findByMonitors")
        .mockResolvedValue([resource(HOSTILE_RESOURCE), resource("Replica")]);
    });

    test("a custom email body escapes the title, the page name and the resource names", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
        .mockResolvedValue([hostilePage(true)]);
      jest
        .spyOn(
          StatusPageSubscriberNotificationTemplateService,
          "getTemplateForStatusPage",
        )
        .mockImplementation(
          async (data: {
            notificationMethod: StatusPageSubscriberNotificationMethod;
          }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
            const template: StatusPageSubscriberNotificationTemplate =
              new StatusPageSubscriberNotificationTemplate();
            template.notificationMethod = data.notificationMethod;
            if (
              data.notificationMethod ===
              StatusPageSubscriberNotificationMethod.Email
            ) {
              template.templateBody = ESCAPING_EMAIL_BODY;
              template.emailSubject = ESCAPING_TEXT;
            } else {
              template.templateBody = `${data.notificationMethod}: ${ESCAPING_TEXT}`;
            }
            return template;
          },
        );

      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        hostileEvent(),
      ]);

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!.vars).toEqual({
        body: `<h1>${HOSTILE_TITLE_HTML}</h1><p>${HOSTILE_PAGE_NAME_HTML}</p><div>${HOSTILE_RESOURCE_HTML}, Replica</div><div>${DESCRIPTION_HTML}</div>`,
      });

      const text: string = `${HOSTILE_TITLE} on ${HOSTILE_PAGE_NAME}: ${HOSTILE_RESOURCE}, Replica`;
      expect(sentMail()[0]!.subject).toBe(text);
      expect(sentSms()).toEqual([
        `${StatusPageSubscriberNotificationMethod.SMS}: ${text}`,
      ]);
      /*
       * Slack's message is Markdown: each plain value is escaped for it, so
       * it reads as typed and is no link, image, HTML or mention there.
       */
      expect(sentSlack()).toEqual([
        `${StatusPageSubscriberNotificationMethod.Slack}: ${escapeMarkdownValue(HOSTILE_TITLE)} on ${escapeMarkdownValue(HOSTILE_PAGE_NAME)}: ${escapeMarkdownValue(`${HOSTILE_RESOURCE}, Replica`)}`,
      ]);
      expect(sentWebhookData()["scheduledMaintenanceTitle"]).toBe(
        HOSTILE_TITLE,
      );
      expect(sentWebhookData()["resourcesAffected"]).toBe(
        `${HOSTILE_RESOURCE}, Replica`,
      );
    });

    /*
     * Only the advertised HTML variables, and the email-only HTML ones the
     * default template also receives (the multi-timezone time, the rendered
     * description under its old name, and the footer the page's admins
     * wrote), go into the body as HTML.
     */
    test("only HTML values reach the email body as HTML", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
        .mockResolvedValue([hostilePage(true)]);

      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        hostileEvent(),
      ]);

      const variables: Record<string, string | SafeHtml> =
        rawVariablesCompiledInto(
          CUSTOM_BODIES[StatusPageSubscriberNotificationMethod.Email]!,
        );
      const html: Array<string> = Object.keys(variables)
        .filter((name: string): boolean => {
          return SafeHtml.isSafeHtml(variables[name]);
        })
        .sort();

      expect(html).toEqual(
        [
          ...SubscriberNotificationTemplateVariables.getEmailBodyHtmlVariableNamesForEventType(
            StatusPageSubscriberNotificationEventType.SubscriberScheduledMaintenanceCreated,
          ),
          "eventDescription",
          "scheduledAt",
          "subscriberEmailNotificationFooterText",
        ].sort(),
      );
      expect(variables["scheduledMaintenanceTitle"]).toBe(HOSTILE_TITLE);
      expect(variables["statusPageName"]).toBe(HOSTILE_PAGE_NAME);
    });

    test("the default email gets the resource names escaped for HTML, SMS gets them as written, and Slack escaped for Markdown", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
        .mockResolvedValue([hostilePage(false)]);
      jest
        .spyOn(
          StatusPageSubscriberNotificationTemplateService,
          "getTemplateForStatusPage",
        )
        .mockResolvedValue(null);

      await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
        hostileEvent(),
      ]);

      expect(sentMail()[0]!.templateType).toBe(
        EmailTemplateType.SubscriberScheduledMaintenanceEventCreated,
      );
      expect(sentMail()[0]!.vars["resourcesAffected"]).toBe(
        `${HOSTILE_RESOURCE_HTML}, Replica`,
      );
      expect(sentMail()[0]!.vars["eventTitle"]).toBe(HOSTILE_TITLE);
      expect(sentSms()[0]).toContain(`Impact: ${HOSTILE_RESOURCE}, Replica.`);
      expect(sentSlack()[0]).toContain(
        `## 🔧 Scheduled Maintenance - ${escapeMarkdownValue(HOSTILE_TITLE)}`,
      );
      expect(sentSlack()[0]).toContain(
        `**Resources Affected:** ${escapeMarkdownValue(`${HOSTILE_RESOURCE}, Replica`)}`,
      );
      for (const message of [...sentSms(), ...sentSlack()]) {
        expect(message).not.toMatch(/&(?:amp|lt|gt|quot|#39);/);
      }
    });
  });
});
