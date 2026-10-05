import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * SubscriberIncidentEmailBuilder: the one code path that builds a status
 * page's 'incident created' and public note emails, for the subscriber jobs
 * and for "Preview notification" alike. What is pinned here:
 *
 *   - which email a page gets, and why: its custom template only with a body
 *     and the page's own SMTP server (templateChoice);
 *   - the default email's template, subject and variables per event, and
 *     the custom template's body compiled as HTML (plain values escaped) and
 *     its subject as text;
 *   - each subscriber's email differs from the page's only by their
 *     unsubscribe link, and building one changes nothing;
 *   - building an email has no side effects: only recordSending records the
 *     custom fields that went out and makes their images public, so a
 *     preview publishes nothing.
 *
 * The values builder, the Markdown renderer and the template compiler are
 * the real ones; only the template lookup, the custom field definitions and
 * the image visibility writes are faked.
 */

jest.mock("../../../../Server/Services/IncidentCustomFieldService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn() },
  };
});

jest.mock("../../../../Server/Utils/InlineImageAccessTokenSync", () => {
  return {
    __esModule: true,
    syncIsPublicForMarkdownImages: jest.fn(),
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import File from "../../../../Models/DatabaseModels/File";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriberNotificationTemplate from "../../../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import StatusPageSubscriberNotificationTemplateService from "../../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import { syncIsPublicForMarkdownImages } from "../../../../Server/Utils/InlineImageAccessTokenSync";
import {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "../../../../Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "../../../../Server/Utils/StatusPage/SubscriberIncidentEmailBuilder";
import Hostname from "../../../../Types/API/Hostname";
import Protocol from "../../../../Types/API/Protocol";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import OneUptimeDate from "../../../../Types/Date";
import EmailTemplateType from "../../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { SubscriberEmailTemplateChoiceReason } from "../../../../Types/StatusPage/SubscriberNotificationPreview";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;
const UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/unsubscribe/one`;
const OTHER_UNSUBSCRIBE_URL: string = `${STATUS_PAGE_URL}/unsubscribe/two`;

const HOST: Hostname = Hostname.fromString("oneuptime.acme.com");
const PROTOCOL: Protocol = Protocol.HTTPS;

const HOSTILE_TITLE: string =
  '<a href="https://evil.example">Reset your password</a>';
const DESCRIPTION: string = "Payments fail in **Europe**.";
const DESCRIPTION_HTML: string =
  "<p>Payments fail in <strong>Europe</strong>.</p>";

const IMAGE_URL: string =
  "https://oneuptime.acme.com/file/image/access-token/abc123";

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function incident(title: string = "Checkout requests failing"): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.projectId = PROJECT_ID;
  row.title = title;
  row.description = DESCRIPTION;
  row.customFields = {
    "Impact details": `Customers see an error. ![graph](${IMAGE_URL})`,
  };

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  row.currentIncidentState = state;

  row.labels = [];

  return row;
}

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

function statusPage(
  options: {
    smtp?: boolean;
    logo?: boolean;
    // The project the logo was uploaded in; the page's own by default.
    logoProjectId?: ObjectID | null;
    isPublic?: boolean;
  } = {},
): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID;
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = options.isPublic ?? true;
  page.showIncidentsOnStatusPage = true;

  if (options.logo) {
    // Read as getStatusPagesToSendNotification reads it: with its project.
    const logo: File = new File();
    logo._id = ObjectID.generate().toString();

    const logoProjectId: ObjectID | null =
      options.logoProjectId === undefined ? PROJECT_ID : options.logoProjectId;

    if (logoProjectId) {
      logo.projectId = logoProjectId;
    }

    page.logoFileId = new ObjectID(logo._id);
    page.logoFile = logo;
  }

  if (options.smtp) {
    (page as unknown as JSONObject)["smtpConfig"] = { _id: "smtp" };
  }

  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = "88888888-8888-4888-8888-888888888888";
  row.statusPageId = new ObjectID(STATUS_PAGE_ID);
  row.displayName = "Checkout <API>";
  return row;
}

function template(data: {
  body?: string | undefined;
  subject?: string | undefined;
  name?: string | undefined;
}): StatusPageSubscriberNotificationTemplate {
  const row: StatusPageSubscriberNotificationTemplate =
    new StatusPageSubscriberNotificationTemplate();
  row.templateName = data.name || "Acme branded";

  if (data.body !== undefined) {
    row.templateBody = data.body;
  }

  if (data.subject !== undefined) {
    row.emailSubject = data.subject;
  }

  return row;
}

let emailTemplate: StatusPageSubscriberNotificationTemplate | null = null;

interface Built {
  variables: IncidentTemplateVariables;
  pageEmail: SubscriberIncidentStatusPageEmail;
}

async function build(data: {
  event: SubscriberIncidentEmailEvent;
  incident?: Incident | undefined;
  page?: StatusPage | undefined;
  note?: { text: string; postedAt: Date | null } | undefined;
}): Promise<Built> {
  const row: Incident = data.incident || incident();
  const page: StatusPage = data.page || statusPage();

  const variables: IncidentTemplateVariables =
    await SubscriberIncidentEmailBuilder.buildTemplateVariables({
      event: data.event,
      incident: row,
      statusPages: [page],
      note: data.note,
    });

  const pageTemplateVariables: IncidentStatusPageTemplateVariables =
    variables.forStatusPage({
      statusPage: page,
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      resources: [resource()],
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
      host: HOST,
      httpProtocol: PROTOCOL,
    });

  return { variables: variables, pageEmail: pageEmail };
}

beforeEach(() => {
  jest.restoreAllMocks();
  mock(syncIsPublicForMarkdownImages).mockReset();
  mock(IncidentCustomFieldService.findBy).mockReset();

  // One Rich text field, included in subscriber notifications, with an image.
  mock(IncidentCustomFieldService.findBy).mockResolvedValue([
    {
      name: "Impact details",
      variableKey: "impact_details",
      customFieldType: CustomFieldType.Markdown,
      includeInSubscriberNotifications: true,
      sortOrder: 1,
    },
  ] as never);

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

describe("chooseTemplate", () => {
  test("no linked template: the default email", () => {
    expect(
      SubscriberIncidentEmailBuilder.chooseTemplate({
        emailTemplate: null,
        statusPage: statusPage({ smtp: true }),
      }),
    ).toEqual({
      usesCustomTemplate: false,
      reason: SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
    });
  });

  test("a template with no body: the default email, naming the template", () => {
    expect(
      SubscriberIncidentEmailBuilder.chooseTemplate({
        emailTemplate: template({ body: "", name: "Branded" }),
        statusPage: statusPage({ smtp: true }),
      }),
    ).toEqual({
      usesCustomTemplate: false,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplateIsEmpty,
      customTemplateName: "Branded",
    });
  });

  test("a template on a page with no SMTP server of its own: the default email", () => {
    expect(
      SubscriberIncidentEmailBuilder.chooseTemplate({
        emailTemplate: template({ body: "<p>Hi</p>", name: "Branded" }),
        statusPage: statusPage({ smtp: false }),
      }),
    ).toEqual({
      usesCustomTemplate: false,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
      customTemplateName: "Branded",
    });
  });

  test("a template with a body on a page with its own SMTP server: the custom template", () => {
    expect(
      SubscriberIncidentEmailBuilder.chooseTemplate({
        emailTemplate: template({ body: "<p>Hi</p>", name: "Branded" }),
        statusPage: statusPage({ smtp: true }),
      }),
    ).toEqual({
      usesCustomTemplate: true,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplate,
      customTemplateName: "Branded",
    });
  });
});

describe("the default email", () => {
  test("incident created: the created template, subject and every variable", async () => {
    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      page: statusPage({ logo: true }),
    });

    expect(pageEmail.templateChoice.reason).toBe(
      SubscriberEmailTemplateChoiceReason.NoCustomTemplate,
    );

    const email: SubscriberIncidentEmail = pageEmail.forSubscriber({
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });

    expect(email.subject).toBe("[Incident] Checkout requests failing");
    expect(email.envelope.templateType).toBe(
      EmailTemplateType.SubscriberIncidentCreated,
    );
    expect(email.envelope.subject).toBe(email.subject);
    expect(email.envelope.isSubjectLiteral).toBe(true);

    const vars: JSONObject = email.envelope.vars as JSONObject;

    expect(vars["statusPageName"]).toBe("Acme Status");
    expect(vars["statusPageUrl"]).toBe(STATUS_PAGE_URL);
    expect(vars["detailsUrl"]).toBe(DETAILS_URL);
    expect(vars["logoUrl"]).toBe(
      `https://oneuptime.acme.com/status-page-api/logo/${STATUS_PAGE_ID}`,
    );
    expect(vars["isPublicStatusPage"]).toBe("true");
    // The escaped HTML list, for the template's raw slot.
    expect(vars["resourcesAffected"]).toBe("Checkout &lt;API&gt;");
    expect(vars["incidentSeverity"]).toBe("Critical");
    expect(vars["incidentTitle"]).toBe("Checkout requests failing");
    expect(vars["incidentDescription"]).toContain(DESCRIPTION_HTML);
    expect(vars["unsubscribeUrl"]).toBe(UNSUBSCRIBE_URL);
    expect(typeof vars["subscriberEmailNotificationFooterText"]).toBe("string");
    expect(vars["note"]).toBeUndefined();

    // The included Rich text field, rendered.
    const rows: Array<JSONObject> = vars[
      "customFieldRows"
    ] as unknown as Array<JSONObject>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!["title"]).toBe("Impact details");
    expect(String(rows[0]!["renderedHtml"])).toContain(IMAGE_URL);
  });

  test("no logo: an empty logo URL", async () => {
    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      page: statusPage({ logo: false, isPublic: false }),
    });

    const vars: JSONObject = pageEmail.forSubscriber({
      unsubscribeUrl: UNSUBSCRIBE_URL,
    }).envelope.vars as JSONObject;

    expect(vars["logoUrl"]).toBe("");
    expect(vars["isPublicStatusPage"]).toBe("false");
  });

  test("a logo the page's logo route would not serve - another project's, or one with no project: no logo, not a broken one", async () => {
    for (const logoProjectId of [OTHER_PROJECT_ID, null]) {
      const { pageEmail } = await build({
        event: SubscriberIncidentEmailEvent.IncidentCreated,
        page: statusPage({ logo: true, logoProjectId: logoProjectId }),
      });

      const vars: JSONObject = pageEmail.forSubscriber({
        unsubscribeUrl: UNSUBSCRIBE_URL,
      }).envelope.vars as JSONObject;

      expect({ logoProjectId, logoUrl: vars["logoUrl"] }).toEqual({
        logoProjectId,
        logoUrl: "",
      });
    }
  });

  test("a public note: the note template and subject, with the note instead of the description", async () => {
    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      note: { text: "We are **rolling back**.", postedAt: null },
    });

    const email: SubscriberIncidentEmail = pageEmail.forSubscriber({
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });

    expect(email.subject).toBe("[Update Incident] Checkout requests failing");
    expect(email.envelope.templateType).toBe(
      EmailTemplateType.SubscriberIncidentNoteCreated,
    );

    const vars: JSONObject = email.envelope.vars as JSONObject;
    expect(vars["note"]).toContain("<strong>rolling back</strong>");
    expect(vars["incidentDescription"]).toBeUndefined();
  });

  test("an edited public note: the note updated template and subject", async () => {
    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteUpdated,
      note: { text: "Fixed.", postedAt: null },
    });

    const email: SubscriberIncidentEmail = pageEmail.forSubscriber({
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });

    expect(email.subject).toBe(
      "[Incident Note Updated] Checkout requests failing",
    );
    expect(email.envelope.templateType).toBe(
      EmailTemplateType.SubscriberIncidentNoteUpdated,
    );
  });

  test("each subscriber's email differs only by their unsubscribe link, and building one changes nothing", async () => {
    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
    });

    const first: SubscriberIncidentEmail = pageEmail.forSubscriber({
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });
    const firstCopy: string = JSON.stringify(first);
    const second: SubscriberIncidentEmail = pageEmail.forSubscriber({
      unsubscribeUrl: OTHER_UNSUBSCRIBE_URL,
    });

    expect(JSON.stringify(first)).toBe(firstCopy);
    expect((second.envelope.vars as JSONObject)["unsubscribeUrl"]).toBe(
      OTHER_UNSUBSCRIBE_URL,
    );
    expect({
      ...second,
      envelope: {
        ...second.envelope,
        vars: { ...second.envelope.vars, unsubscribeUrl: UNSUBSCRIBE_URL },
      },
    }).toEqual(first);
  });
});

describe("the custom template", () => {
  test("its body is compiled as HTML, with plain values escaped, and its subject as text", async () => {
    emailTemplate = template({
      body: '<h1>{{incidentTitle}}</h1><div>{{incidentDescription}}</div><a href="{{unsubscribeUrl}}">Unsubscribe</a>',
      subject: "{{statusPageName}}: {{incidentTitle}}",
    });

    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      incident: incident(HOSTILE_TITLE),
      page: statusPage({ smtp: true }),
    });

    expect(pageEmail.templateChoice).toEqual({
      usesCustomTemplate: true,
      reason: SubscriberEmailTemplateChoiceReason.CustomTemplate,
      customTemplateName: "Acme branded",
    });

    const email: SubscriberIncidentEmail = pageEmail.forSubscriber({
      unsubscribeUrl: UNSUBSCRIBE_URL,
    });

    expect(email.envelope.templateType).toBe(EmailTemplateType.BlankTemplate);
    expect(email.envelope.isSubjectLiteral).toBe(true);

    const body: string = String(
      (email.envelope.vars as JSONObject)["body"] || "",
    );

    // The title is text: escaped, never a live link.
    expect(body).toContain(
      "<h1>&lt;a href=&quot;https://evil.example&quot;&gt;Reset your password&lt;/a&gt;</h1>",
    );
    expect(body).not.toContain('<a href="https://evil.example">');
    // The description is HTML the renderer built, inserted as it is.
    expect(body).toContain(DESCRIPTION_HTML);
    expect(body).toContain(`<a href="${UNSUBSCRIBE_URL}">Unsubscribe</a>`);

    // The subject is text: the title as written.
    expect(email.subject).toBe(`Acme Status: ${HOSTILE_TITLE}`);
    expect(email.envelope.subject).toBe(email.subject);
  });

  test("a template with no subject falls back to the event's subject", async () => {
    emailTemplate = template({ body: "<p>{{incidentTitle}}</p>" });

    const created: Built = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      page: statusPage({ smtp: true }),
    });

    expect(
      created.pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL })
        .subject,
    ).toBe("[Incident] Checkout requests failing");

    const note: Built = await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      page: statusPage({ smtp: true }),
      note: { text: "Update", postedAt: null },
    });

    expect(
      note.pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL }).subject,
    ).toBe("[Incident Update] Checkout requests failing");
  });

  test("on a page with no SMTP server of its own, the default email is sent", async () => {
    emailTemplate = template({ body: "<p>{{incidentTitle}}</p>" });

    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      page: statusPage({ smtp: false }),
    });

    expect(pageEmail.templateChoice.reason).toBe(
      SubscriberEmailTemplateChoiceReason.CustomTemplateNeedsCustomSmtp,
    );
    expect(
      pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL }).envelope
        .templateType,
    ).toBe(EmailTemplateType.SubscriberIncidentCreated);
  });

  test("the template is looked up for the page, the event and the email channel", async () => {
    await build({ event: SubscriberIncidentEmailEvent.IncidentCreated });
    await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      note: { text: "Update", postedAt: null },
    });
    await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteUpdated,
      note: { text: "Update", postedAt: null },
    });

    const calls: Array<JSONObject> = mock(
      StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
    ).mock.calls.map((call: Array<unknown>): JSONObject => {
      return call[0] as JSONObject;
    });

    expect(
      calls.map((call: JSONObject) => {
        return [
          call["statusPageId"]?.toString(),
          call["eventType"],
          call["notificationMethod"],
        ];
      }),
    ).toEqual([
      [
        STATUS_PAGE_ID,
        StatusPageSubscriberNotificationEventType.SubscriberIncidentCreated,
        StatusPageSubscriberNotificationMethod.Email,
      ],
      [
        STATUS_PAGE_ID,
        StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteCreated,
        StatusPageSubscriberNotificationMethod.Email,
      ],
      [
        STATUS_PAGE_ID,
        StatusPageSubscriberNotificationEventType.SubscriberIncidentNoteUpdated,
        StatusPageSubscriberNotificationMethod.Email,
      ],
    ]);
  });
});

describe("building has no side effects; sending does", () => {
  test("a default email makes the included fields' images public only on recordSending", async () => {
    const { pageEmail, variables } = await build({
      event: SubscriberIncidentEmailEvent.IncidentCreated,
    });

    pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL });
    pageEmail.forSubscriber({ unsubscribeUrl: OTHER_UNSUBSCRIBE_URL });

    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
    expect(variables.getSentCustomFieldsMarkdown()).toBe("");

    await pageEmail.recordSending();

    expect(syncIsPublicForMarkdownImages).toHaveBeenCalledTimes(1);
    expect(mock(syncIsPublicForMarkdownImages).mock.calls[0]![0]).toContain(
      IMAGE_URL,
    );
    expect(variables.getSentCustomFieldsMarkdown()).toContain("Impact details");
  });

  /*
   * {{incident.customFields.<key>}} is the documented name; a template saved
   * with the older {{customFields.<key>}} still places the field.
   */
  test.each([
    [
      "the documented name",
      "<div>{{incident.customFields.impact_details}}</div>",
    ],
    ["the older name", "<div>{{customFields.impact_details}}</div>"],
  ])(
    "a custom template records only the fields it places, on recordSending (%s)",
    async (_name: string, templateBody: string) => {
      emailTemplate = template({
        body: templateBody,
        subject: "{{incidentTitle}}",
      });

      const { pageEmail, variables } = await build({
        event: SubscriberIncidentEmailEvent.IncidentCreated,
        page: statusPage({ smtp: true }),
      });

      const recordFieldsUsedBy: Mock<() => Promise<void>> = jest.fn(
        async (): Promise<void> => {
          return undefined;
        },
      );
      const recordIncludedFieldsSent: Mock<() => Promise<void>> = jest.fn(
        async (): Promise<void> => {
          return undefined;
        },
      );
      jest
        .spyOn(variables, "recordFieldsUsedBy")
        .mockImplementation(recordFieldsUsedBy as never);
      jest
        .spyOn(variables, "recordIncludedFieldsSent")
        .mockImplementation(recordIncludedFieldsSent as never);

      const body: string = String(
        (
          pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL }).envelope
            .vars as JSONObject
        )["body"],
      );
      expect(body).toContain(IMAGE_URL);
      expect(recordFieldsUsedBy).not.toHaveBeenCalled();

      await pageEmail.recordSending();

      expect(recordFieldsUsedBy).toHaveBeenCalledWith([
        templateBody,
        "{{incidentTitle}}",
      ]);
      expect(recordIncludedFieldsSent).not.toHaveBeenCalled();
    },
  );
});

describe("buildTemplateVariables", () => {
  test("a public note offers its state and when it says it was posted", async () => {
    const postedAt: Date = OneUptimeDate.fromString("2026-09-27T10:30:00.000Z");

    const { pageEmail } = await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      page: statusPage({ smtp: true }),
      note: { text: "Rolling back.", postedAt: postedAt },
    });

    // Nothing linked: the default note email, which shows the note.
    expect(
      String(
        (
          pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL }).envelope
            .vars as JSONObject
        )["note"],
      ),
    ).toContain("Rolling back.");

    emailTemplate = template({
      body: "<p>{{incidentState}} at {{postedAt}}</p>",
    });

    const custom: Built = await build({
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      page: statusPage({ smtp: true }),
      note: { text: "Rolling back.", postedAt: postedAt },
    });

    const body: string = String(
      (
        custom.pageEmail.forSubscriber({ unsubscribeUrl: UNSUBSCRIBE_URL })
          .envelope.vars as JSONObject
      )["body"],
    );

    expect(body).toBe(
      `<p>Identified at ${OneUptimeDate.getDateAsUserFriendlyFormattedString(postedAt)}</p>`,
    );
  });
});

describe("helpers", () => {
  test("getDetailsUrl: the incident on the page, or the page for an incident with no id yet", () => {
    expect(
      SubscriberIncidentEmailBuilder.getDetailsUrl({
        statusPageUrl: STATUS_PAGE_URL,
        incidentId: INCIDENT_ID,
      }),
    ).toBe(DETAILS_URL);

    expect(
      SubscriberIncidentEmailBuilder.getDetailsUrl({
        statusPageUrl: STATUS_PAGE_URL,
        incidentId: undefined,
      }),
    ).toBe(STATUS_PAGE_URL);
  });

  test("a page with no id is refused rather than looked up", async () => {
    const page: StatusPage = statusPage();
    delete (page as unknown as JSONObject)["_id"];

    await expect(
      build({
        event: SubscriberIncidentEmailEvent.IncidentCreated,
        page: page,
      }),
    ).rejects.toThrow("without its id");
  });
});
