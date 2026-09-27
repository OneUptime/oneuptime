/*
 * PasswordHash reaches this suite through the notification router's imports
 * and fails ts-jest compilation on TS 5.9 (pre-existing TS2345). Nothing here
 * exercises it, so replace it before the import graph drags it in - the same
 * workaround as MailServiceTemplateCache.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import { mockRouter } from "Common/Tests/Server/API/Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import Path from "path";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Label from "Common/Models/DatabaseModels/Label";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import CommonMailService from "Common/Server/Services/MailService";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "Common/Server/Utils/StatusPage/SubscriberIncidentEmailBuilder";
import API from "Common/Utils/API";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import IncidentSubscriberAudience from "Common/Types/StatusPage/IncidentSubscriberAudience";
import {
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewResult,
} from "Common/Types/StatusPage/SubscriberNotificationPreview";

/*
 * PREVIEW HTML IS SENT HTML.
 *
 * "Preview notification" shows each status page's email before an incident
 * is declared or a public note is posted. It is only worth anything if it is
 * byte for byte what subscribers get, so this suite takes one email from
 * SubscriberIncidentEmailBuilder - the code path the subscriber jobs send
 * through (their own tests hold them to it) - and follows it both ways:
 *
 *   - PREVIEWED: the way POST /preview answers, rendered by
 *     Notification MailService.render (renderPreview);
 *   - SENT: the way a job sends it - Common MailService.sendMail, serialized
 *     over the wire to the notification API's /email/send, parsed there,
 *     and through MailService.send to the transport - with only the SMTP
 *     connection itself faked.
 *
 * and requires the two to be identical, subject and HTML, for the default
 * 'incident created' email, the default public note email, and a custom
 * template sent through the page's own SMTP server.
 */

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue("Custom SMTP"),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock(
  "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

// The wire between the worker and the notification API.
jest.mock("Common/Utils/API", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});

jest.mock("Common/Server/Middleware/ClusterKeyAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
      getClusterKeyHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: jest.fn(),
      requireUserAuthentication: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentCustomFieldService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/InlineImageAccessTokenSync", () => {
  return { __esModule: true, syncIsPublicForMarkdownImages: jest.fn() };
});

import { getGlobalSMTPConfig } from "../../FeatureSet/Notification/Config";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import "../../FeatureSet/Notification/Utils/Handlebars";
import "../../FeatureSet/Notification/API/Mail";
import { renderPreview } from "../../FeatureSet/Notification/API/SubscriberNotificationPreview";

interface CapturedMail {
  from: string;
  to: string;
  subject: string;
  html: string;
}

type SendMail = (mail: CapturedMail) => Promise<{ messageId: string }>;

const transportSendMail: ReturnType<typeof jest.fn<SendMail>> =
  jest.fn<SendMail>();

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";
const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/unsubscribe/5555-token`;
const SUBSCRIBER_EMAIL: string = "customer@example.com";

const GLOBAL_SMTP: EmailServer = {
  host: Hostname.fromString("smtp.oneuptime.test"),
  port: new Port(587),
  secure: true,
  username: undefined,
  password: undefined,
  fromName: "OneUptime",
  fromEmail: new Email("notifications@oneuptime.test"),
};

const PAGE_SMTP: EmailServer = {
  id: new ObjectID("f0000000-0000-4000-8000-000000000001"),
  host: Hostname.fromString("smtp.acme.test"),
  port: new Port(587),
  secure: true,
  username: "status",
  password: "secret",
  fromName: "Acme Status",
  fromEmail: new Email("status@acme.test"),
};

let emailTemplate: StatusPageSubscriberNotificationTemplate | null = null;

function incident(): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.projectId = PROJECT_ID;
  // A title that must be escaped, and a "{{" that must stay text.
  row.title = 'Checkout <b>failing</b> for "{{ .Values.region }}"';
  row.description =
    "Payments fail in **Europe**. See [the runbook](https://runbook.acme.com).";
  row.customFields = {
    "Affected location": "Frankfurt & Paris",
    "Impact details": "Only **card** payments.",
  };

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  row.currentIncidentState = state;

  const label: Label = new Label();
  label.name = "Payments";
  row.labels = [label];

  return row;
}

function statusPage(withSmtp: boolean): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID;
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme <Status>";
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage = true;
  page.logoFileId = ObjectID.generate();

  if (withSmtp) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }

  return page;
}

function resources(): Array<StatusPageResource> {
  const group: StatusPageGroup = new StatusPageGroup();
  group.name = "Europe & UK";

  const resource: StatusPageResource = new StatusPageResource();
  resource._id = "88888888-8888-4888-8888-888888888888";
  resource.statusPageId = new ObjectID(STATUS_PAGE_ID);
  resource.displayName = "Checkout <API>";
  resource.statusPageGroupId = ObjectID.generate();
  resource.statusPageGroup = group;

  return [resource];
}

// One page's email, built the way the jobs and the preview both build it.
async function buildEmail(data: {
  event: SubscriberIncidentEmailEvent;
  withSmtp: boolean;
}): Promise<{
  page: StatusPage;
  pageEmail: SubscriberIncidentStatusPageEmail;
  email: SubscriberIncidentEmail;
}> {
  const row: Incident = incident();
  const page: StatusPage = statusPage(data.withSmtp);

  const variables: IncidentTemplateVariables =
    await SubscriberIncidentEmailBuilder.buildTemplateVariables({
      event: data.event,
      incident: row,
      statusPages: [page],
      note: {
        text: "Traffic moved to the **standby** region.",
        postedAt: new Date("2026-09-27T10:30:00.000Z"),
      },
    });

  const pageTemplateVariables: IncidentStatusPageTemplateVariables =
    variables.forStatusPage({
      statusPage: page,
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      resources: resources(),
    });

  const pageEmail: SubscriberIncidentStatusPageEmail =
    await SubscriberIncidentEmailBuilder.forStatusPage({
      event: data.event,
      incident: row,
      incidentTemplateVariables: variables,
      statusPage: page,
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      pageTemplateVariables: pageTemplateVariables,
      host: Hostname.fromString("oneuptime.acme.com"),
      httpProtocol: Protocol.HTTPS,
    });

  return {
    page: page,
    pageEmail: pageEmail,
    email: pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL }),
  };
}

// What POST /preview answers for the page.
async function previewed(data: {
  page: StatusPage;
  pageEmail: SubscriberIncidentStatusPageEmail;
  email: SubscriberIncidentEmail;
}): Promise<{ subject: string; html: string }> {
  const counts: ReturnType<typeof IncidentSubscriberAudience.getEmptyCounts> = {
    ...IncidentSubscriberAudience.getEmptyCounts(),
    email: 1,
  };

  const result: SubscriberNotificationPreviewResult = await renderPreview({
    event: SubscriberNotificationPreviewEvent.IncidentCreated,
    nothingSentReason: null,
    audience: {
      hasMonitors: true,
      isScoped: false,
      isHiddenFromStatusPages: false,
      statusPages: [
        {
          statusPageId: STATUS_PAGE_ID,
          name: "Acme",
          subscriberCounts: counts,
        },
      ],
      hiddenStatusPageCount: 0,
      excludedStatusPages: [],
      selectedStatusPagesNotListingMonitors: [],
    },
    statusPages: [
      {
        statusPage: data.page,
        statusPageId: STATUS_PAGE_ID,
        name: "Acme",
        subscriberCounts: counts,
        templateChoice: data.pageEmail.templateChoice,
        email: data.email,
      },
    ],
  });

  return {
    subject: result.statusPages[0]!.subject,
    html: result.statusPages[0]!.html,
  };
}

/*
 * What the subscriber receives: sent as the jobs send it, through the wire
 * to the notification API's /email/send, and out of the transport.
 */
async function sent(data: {
  email: SubscriberIncidentEmail;
  mailServer?: EmailServer | undefined;
}): Promise<CapturedMail> {
  const apiPost: jest.Mock = API.post as unknown as jest.Mock;
  apiPost.mockClear();
  transportSendMail.mockClear();

  await CommonMailService.sendMail(
    {
      toEmail: new Email(SUBSCRIBER_EMAIL),
      ...data.email.envelope,
    },
    {
      mailServer: data.mailServer,
      projectId: PROJECT_ID,
      statusPageId: new ObjectID(STATUS_PAGE_ID),
      incidentId: INCIDENT_ID,
    },
  );

  expect(apiPost).toHaveBeenCalledTimes(1);

  // Over the wire as JSON, as the notification API's body parser reads it.
  const body: JSONObject = JSON.parse(
    JSON.stringify((apiPost.mock.calls[0]![0] as { data: JSONObject }).data),
  ) as JSONObject;

  const next: jest.Mock = jest.fn() as unknown as jest.Mock;

  await mockRouter
    .match("post", "/send")
    .handlerFunction(
      { body: body, headers: {} } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  expect(next).not.toHaveBeenCalled();
  expect(transportSendMail).toHaveBeenCalledTimes(1);

  return transportSendMail.mock.calls[0]![0];
}

beforeAll(async () => {
  const partialNames: Array<string> = fs
    .readdirSync(
      Path.resolve(
        __dirname,
        "../../FeatureSet/Notification/Templates/Partials",
      ),
    )
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  // The production initializer registers the partials asynchronously.
  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Production email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.clearAllMocks();

  transportSendMail.mockResolvedValue({ messageId: "delivered" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail: transportSendMail,
    close: jest.fn(),
  } as unknown as Transporter);
  jest.mocked(getGlobalSMTPConfig).mockResolvedValue(GLOBAL_SMTP as never);
  (API.post as unknown as jest.Mock).mockResolvedValue({} as never);

  // Two included fields: one plain (escaped), one Rich text (rendered).
  (IncidentCustomFieldService.findBy as unknown as jest.Mock).mockResolvedValue(
    [
      {
        name: "Affected location",
        variableKey: "affected_location",
        customFieldType: CustomFieldType.Text,
        includeInSubscriberNotifications: true,
        sortOrder: 1,
      },
      {
        name: "Impact details",
        variableKey: "impact_details",
        customFieldType: CustomFieldType.Markdown,
        includeInSubscriberNotifications: true,
        sortOrder: 2,
      },
    ] as never,
  );

  emailTemplate = null;
  jest
    .spyOn(
      StatusPageSubscriberNotificationTemplateService,
      "getTemplateForStatusPage",
    )
    .mockImplementation((async () => {
      return emailTemplate;
    }) as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("the previewed email is the sent email", () => {
  test("the default 'incident created' email", async () => {
    const built: Awaited<ReturnType<typeof buildEmail>> = await buildEmail({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      withSmtp: false,
    });

    const preview: { subject: string; html: string } = await previewed(built);
    const delivered: CapturedMail = await sent({ email: built.email });

    expect(delivered.to).toBe(SUBSCRIBER_EMAIL);
    expect(delivered.subject).toBe(preview.subject);
    expect(delivered.html).toBe(preview.html);

    // And it is a real email, with everything in it.
    expect(preview.html).toContain("<!DOCTYPE html>");
    expect(preview.subject).toBe(
      '[Incident] Checkout <b>failing</b> for "{{ .Values.region }}"',
    );
    expect(preview.html).toContain(
      "Checkout &lt;b&gt;failing&lt;/b&gt; for &quot;{{ .Values.region }}&quot;",
    );
    expect(preview.html).not.toContain("<b>failing</b>");
    expect(preview.html).toContain("<strong>Europe</strong>");
    expect(preview.html).toContain("Frankfurt &amp; Paris");
    expect(preview.html).toContain("<strong>card</strong>");
    expect(preview.html).toContain("Checkout &lt;API&gt;");
    expect(preview.html).toContain(UNSUBSCRIBE_URL);
  });

  test("the default public note email", async () => {
    const built: Awaited<ReturnType<typeof buildEmail>> = await buildEmail({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      withSmtp: false,
    });

    const preview: { subject: string; html: string } = await previewed(built);
    const delivered: CapturedMail = await sent({ email: built.email });

    expect(delivered.subject).toBe(preview.subject);
    expect(delivered.html).toBe(preview.html);
    expect(preview.html).toContain("<strong>standby</strong>");
  });

  test("a custom template, sent through the page's own SMTP server", async () => {
    emailTemplate = Object.assign(
      new StatusPageSubscriberNotificationTemplate(),
      {
        templateName: "Acme branded",
        templateBody:
          '<div class="acme"><h1>{{incidentTitle}}</h1>{{incidentDescription}}<p>{{customFields.affected_location}}</p>{{customFields.impact_details}}<p>{{incidentLabels}}</p><a href="{{unsubscribeUrl}}">Unsubscribe</a></div>',
        emailSubject: "{{statusPageName}}: {{incidentTitle}}",
      },
    );

    const built: Awaited<ReturnType<typeof buildEmail>> = await buildEmail({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      withSmtp: true,
    });

    expect(built.pageEmail.templateChoice.usesCustomTemplate).toBe(true);

    const preview: { subject: string; html: string } = await previewed(built);
    const delivered: CapturedMail = await sent({
      email: built.email,
      mailServer: PAGE_SMTP,
    });

    expect(delivered.from).toBe("Acme Status <status@acme.test>");
    expect(delivered.subject).toBe(preview.subject);
    expect(delivered.html).toBe(preview.html);

    expect(preview.subject).toBe(
      'Acme <Status>: Checkout <b>failing</b> for "{{ .Values.region }}"',
    );
    expect(preview.html).toContain(
      "<h1>Checkout &lt;b&gt;failing&lt;/b&gt; for &quot;{{ .Values.region }}&quot;</h1>",
    );
    expect(preview.html).toContain("<p>Frankfurt &amp; Paris</p>");
    expect(preview.html).toContain("<p>Payments</p>");
    expect(preview.html).toContain(
      `<a href="${UNSUBSCRIBE_URL}">Unsubscribe</a>`,
    );
  });
});

describe("MailService.render", () => {
  test("changes nothing about the email it renders", async () => {
    const built: Awaited<ReturnType<typeof buildEmail>> = await buildEmail({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      withSmtp: false,
    });
    const before: string = JSON.stringify(built.email.envelope);

    await MailService.render(built.email.envelope);

    expect(JSON.stringify(built.email.envelope)).toBe(before);
  });

  test("a subject that is not literal is compiled with the email's variables; a literal one is left as it is", async () => {
    expect(
      (
        await MailService.render({
          subject: "Hello {{name}}",
          vars: { name: "Alice" },
          body: "<p>{{name}}</p>",
        })
      ).subject,
    ).toBe("Hello Alice");

    const literal: { subject: string; body: string } = await MailService.render(
      {
        subject: "Hello {{name}}",
        isSubjectLiteral: true,
        vars: { name: "Alice" },
        body: "<p>{{name}} {{year}}</p>",
      },
    );

    expect(literal.subject).toBe("Hello {{name}}");
    // A body with no template is compiled too, with the defaults every email gets.
    expect(literal.body).toBe(
      `<p>Alice ${new Date().getFullYear().toString()}</p>`,
    );
  });
});
