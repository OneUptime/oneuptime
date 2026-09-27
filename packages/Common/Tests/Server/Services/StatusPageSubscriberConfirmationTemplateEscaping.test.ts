import ProjectSmtpConfig from "../../../Models/DatabaseModels/ProjectSmtpConfig";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ProjectSmtpConfigService from "../../../Server/Services/ProjectSmtpConfigService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The subscription confirmation and "you have subscribed" emails can use a
 * status page's custom email template. Its body is HTML, so the status
 * page's name - which a project member typed - and the links are escaped
 * into it; the subject is plain text and keeps them as written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "30000000-0000-4000-8000-000000000003",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const HOSTILE_PAGE_NAME: string =
  '<a href="https://evil.example/login">Acme</a> & "Status"';
const HOSTILE_PAGE_NAME_HTML: string =
  "&lt;a href=&quot;https://evil.example/login&quot;&gt;Acme&lt;/a&gt; &amp; &quot;Status&quot;";

const BODY: string =
  '<h1>{{statusPageName}}</h1><a href="{{statusPageUrl}}">Open</a>';
const SUBJECT: string = "Welcome to {{statusPageName}}";

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function subscriber(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID.toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.projectId = PROJECT_ID;
  row.subscriberEmail = new Email("subscriber@example.com");
  row.subscriptionConfirmationToken = "123456";
  row.unsubscribeToken = "a".repeat(64);
  return row;
}

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "acme-internal";
  page.pageTitle = HOSTILE_PAGE_NAME;
  page.isPublicStatusPage = true;
  const smtpConfig: ProjectSmtpConfig = new ProjectSmtpConfig();
  smtpConfig._id = "50000000-0000-4000-8000-000000000005";
  page.smtpConfig = smtpConfig;
  return page;
}

function sentMail(): Array<{
  templateType: EmailTemplateType;
  subject: string;
  vars: JSONObject;
}> {
  return mock(MailService.sendMail).mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      templateType: EmailTemplateType;
      subject: string;
      vars: JSONObject;
    };
  });
}

describe("status page subscription emails with a custom email template", () => {
  beforeEach(() => {
    jest
      .spyOn(StatusPageSubscriberService, "findOneBy")
      .mockResolvedValue(subscriber());
    jest.spyOn(StatusPageService, "findOneBy").mockResolvedValue(statusPage());
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue(STATUS_PAGE_URL);
    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    jest
      .spyOn(ProjectSmtpConfigService, "toEmailServer")
      .mockReturnValue(undefined);
    jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}));
    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockImplementation(
        async (data: {
          eventType: StatusPageSubscriberNotificationEventType;
          notificationMethod: StatusPageSubscriberNotificationMethod;
        }): Promise<StatusPageSubscriberNotificationTemplate | null> => {
          const template: StatusPageSubscriberNotificationTemplate =
            new StatusPageSubscriberNotificationTemplate();
          template.eventType = data.eventType;
          template.notificationMethod = data.notificationMethod;
          template.templateBody = BODY;
          template.emailSubject = SUBJECT;
          return template;
        },
      );
    jest.spyOn(
      StatusPageSubscriberNotificationTemplateServiceClass,
      "compileEmailBodyTemplate",
    );
    jest.spyOn(
      StatusPageSubscriberNotificationTemplateServiceClass,
      "compileTemplate",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each([
    {
      name: "the confirmation email",
      send: (): Promise<void> => {
        return StatusPageSubscriberService.sendConfirmSubscriptionEmail({
          subscriberId: SUBSCRIBER_ID,
        });
      },
    },
    {
      name: "the you-have-subscribed email",
      send: (): Promise<void> => {
        return StatusPageSubscriberService.sendYouHaveSubscribedEmail({
          subscriberId: SUBSCRIBER_ID,
        });
      },
    },
  ])(
    "$name escapes the page name in the body and keeps it as written in the subject",
    async ({ send }: { send: () => Promise<void> }) => {
      await send();

      expect(sentMail()).toHaveLength(1);
      expect(sentMail()[0]!.templateType).toBe(EmailTemplateType.BlankTemplate);
      expect(sentMail()[0]!.vars["body"]).toBe(
        `<h1>${HOSTILE_PAGE_NAME_HTML}</h1><a href="${STATUS_PAGE_URL}">Open</a>`,
      );
      expect(sentMail()[0]!.subject).toBe(`Welcome to ${HOSTILE_PAGE_NAME}`);

      // The body went through the HTML compile, the subject through the text one.
      expect(
        mock(
          StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate,
        ).mock.calls.map((call: Array<unknown>): unknown => {
          return call[0];
        }),
      ).toEqual([BODY]);
      expect(
        mock(
          StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate,
        ).mock.calls.map((call: Array<unknown>): unknown => {
          return call[0];
        }),
      ).toEqual([SUBJECT]);
    },
  );
});
