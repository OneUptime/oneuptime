import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * IncidentTemplateVariableBuilder: the values an incident's status page
 * subscriber messages are filled with, in each channel's format - and the
 * incident custom fields that reach subscribers, which is what this pins
 * hardest:
 *
 *   - a plain value is plain text everywhere, escaped only where it meets
 *     HTML (the email body compile, the default template's plainText=), and
 *     never escaped twice;
 *   - a Rich text (Markdown) value goes through the email Markdown renderer,
 *     which escapes raw HTML, and its images are made public when it goes
 *     out;
 *   - only fields marked "Include in Subscriber Notifications" reach the
 *     default messages and webhooks, in the fields' order; every field is
 *     offered to custom templates as {{customFields.<key>}};
 *   - Boolean, Date and Date and time values read as words, a day, and the
 *     status page's time zones.
 *
 * The Markdown renderer, the resource list and the template compiler are the
 * real ones; only the database reads and the image visibility writes are
 * faked.
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

import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageGroup from "../../../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import IncidentCustomFieldService from "../../../../Server/Services/IncidentCustomFieldService";
import { syncIsPublicForMarkdownImages } from "../../../../Server/Utils/InlineImageAccessTokenSync";
import IncidentTemplateVariableBuilder, {
  IncidentCustomFieldEmailRow,
  IncidentStatusPageTemplateVariables,
  IncidentTemplateCustomFieldDefinition,
  IncidentTemplateVariables,
} from "../../../../Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SafeHtml from "../../../../Types/SafeHtml";
import SubscriberNotificationTemplateCompiler from "../../../../Types/StatusPage/SubscriberNotificationTemplateCompiler";
import Timezone from "../../../../Types/Timezone";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const STATUS_PAGE_URL: string = "https://status.acme.com";
const DETAILS_URL: string = `${STATUS_PAGE_URL}/incidents/${INCIDENT_ID.toString()}`;

const IMAGE_URL: string =
  "https://oneuptime.acme.com/file/image/access-token/abc123";

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

function field(
  data: IncidentTemplateCustomFieldDefinition,
): IncidentTemplateCustomFieldDefinition {
  return {
    customFieldType: CustomFieldType.Text,
    includeInSubscriberNotifications: false,
    sortOrder: null,
    ...data,
  };
}

function incident(
  customFields: JSONObject = {},
  labels: Array<string> = [],
): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.projectId = PROJECT_ID;
  row.title = "Checkout requests failing";
  row.customFields = customFields;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  row.labels = labels.map((name: string): Label => {
    const label: Label = new Label();
    label.name = name;
    return label;
  });

  return row;
}

function page(data: {
  name: string;
  pageTitle?: string;
  showIncidentsOnStatusPage?: boolean;
  subscriberTimezones?: Array<Timezone>;
}): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = ObjectID.generate().toString();
  statusPage.name = data.name;

  if (data.pageTitle) {
    statusPage.pageTitle = data.pageTitle;
  }

  statusPage.showIncidentsOnStatusPage =
    data.showIncidentsOnStatusPage === undefined
      ? true
      : data.showIncidentsOnStatusPage;

  if (data.subscriberTimezones) {
    statusPage.subscriberTimezones = data.subscriberTimezones;
  }

  return statusPage;
}

function resource(displayName: string, groupName?: string): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.displayName = displayName;

  if (groupName) {
    row.statusPageGroupId = ObjectID.generate();
    const group: StatusPageGroup = new StatusPageGroup();
    group.name = groupName;
    row.statusPageGroup = group;
  }

  return row;
}

const SITE_03: StatusPage = page({
  name: "site-03",
  pageTitle: "Site 03 Status",
  subscriberTimezones: [Timezone.UTC, Timezone.AsiaKolkata],
});

async function build(data: {
  definitions: Array<IncidentTemplateCustomFieldDefinition>;
  customFields?: JSONObject;
  labels?: Array<string>;
  statusPages?: Array<StatusPage>;
  markdownVariables?: Record<string, string>;
  textVariables?: Record<string, string>;
}): Promise<IncidentTemplateVariables> {
  return IncidentTemplateVariableBuilder.build({
    incident: incident(data.customFields || {}, data.labels || []),
    statusPages: data.statusPages || [SITE_03],
    markdownVariables: data.markdownVariables,
    textVariables: data.textVariables,
    customFieldDefinitions: data.definitions,
  });
}

function forSite03(
  variables: IncidentTemplateVariables,
  resources: Array<StatusPageResource> = [resource("Checkout API")],
): IncidentStatusPageTemplateVariables {
  return variables.forStatusPage({
    statusPage: SITE_03,
    statusPageUrl: STATUS_PAGE_URL,
    detailsUrl: DETAILS_URL,
    resources: resources,
  });
}

function htmlOf(value: string | SafeHtml | undefined): string {
  expect(SafeHtml.isSafeHtml(value)).toBe(true);
  return (value as SafeHtml).toHtml();
}

function rowTitles(rows: Array<IncidentCustomFieldEmailRow>): Array<string> {
  return rows.map((row: IncidentCustomFieldEmailRow): string => {
    return row.title;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mock(syncIsPublicForMarkdownImages).mockResolvedValue(undefined as never);
  mock(IncidentCustomFieldService.findBy).mockResolvedValue([] as never);
});

describe("IncidentTemplateVariableBuilder escaping", () => {
  const SCRIPT_VALUE: string = "<script>alert('site')</script> Site 03 & 07";
  const SCRIPT_VALUE_HTML: string =
    "&lt;script&gt;alert(&#39;site&#39;)&lt;/script&gt; Site 03 &amp; 07";

  test("'<script>' in a Text value is escaped in a custom email body, and nowhere else", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({
          name: "Affected Location",
          variableKey: "affected_location",
          includeInSubscriberNotifications: true,
        }),
      ],
      customFields: { "Affected Location": SCRIPT_VALUE },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables);

    // A plain string in the email body bag: the compile escapes it, once.
    expect(site.emailBody["customFields.affected_location"]).toBe(SCRIPT_VALUE);
    expect(
      SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate(
        "<p>{{customFields.affected_location}}</p>",
        site.emailBody,
      ),
    ).toBe(`<p>${SCRIPT_VALUE_HTML}</p>`);

    // Text channels get it as written.
    expect(site.plainText["customFields.affected_location"]).toBe(SCRIPT_VALUE);
    expect(site.markdown["customFields.affected_location"]).toBe(SCRIPT_VALUE);
    expect(
      SubscriberNotificationTemplateCompiler.compileTemplate(
        "SMS: {{customFields.affected_location}}",
        site.plainText,
      ),
    ).toBe(`SMS: ${SCRIPT_VALUE}`);

    // The default email escapes plainText= itself, so it is handed over as written.
    expect(site.customFieldRows).toEqual([
      { title: "Affected Location", plainText: SCRIPT_VALUE },
    ]);
  });

  test("raw HTML inside a Rich text value is escaped by the email Markdown renderer", async () => {
    const markdown: string =
      'Impact: **EU** <img src=x onerror="alert(1)"> <script>steal()</script> [Reset password](javascript:alert(1)) [status](https://status.acme.com)';

    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({
          name: "Impact",
          variableKey: "impact",
          customFieldType: CustomFieldType.Markdown,
          includeInSubscriberNotifications: true,
        }),
      ],
      customFields: { Impact: markdown },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables);
    const html: string = htmlOf(site.emailBody["customFields.impact"]);

    expect(html).toContain("<strong>EU</strong>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a href="https://status.acme.com">status</a>');

    // The default email gets the same rendered HTML, in its raw slot.
    expect(site.customFieldRows).toEqual([
      { title: "Impact", renderedHtml: html },
    ]);

    // Text channels: flattened for SMS and subjects, as written for chat.
    expect(site.plainText["customFields.impact"]).not.toContain("**");
    expect(site.plainText["customFields.impact"]).toContain("Impact: EU");
    expect(site.markdown["customFields.impact"]).toBe(markdown);
  });

  test("a Rich text value's HTML is not escaped a second time by the email body compile", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({
          name: "Impact",
          variableKey: "impact",
          customFieldType: CustomFieldType.Markdown,
        }),
      ],
      customFields: { Impact: "Payments & refunds **down**" },
    });

    const body: string =
      SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate(
        "<div>{{customFields.impact}}</div>",
        forSite03(variables).emailBody,
      );

    expect(body).toBe(
      "<div><p>Payments &amp; refunds <strong>down</strong></p>\n</div>",
    );
    expect(body).not.toContain("&amp;amp;");
  });

  test("a Long text value keeps its lines in HTML, each escaped", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({
          name: "Affected Users",
          variableKey: "affected_users",
          customFieldType: CustomFieldType.LongText,
          includeInSubscriberNotifications: true,
        }),
      ],
      customFields: { "Affected Users": "EU <admins>\r\nUS & CA\nAPAC" },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables);

    expect(htmlOf(site.emailBody["customFields.affected_users"])).toBe(
      "EU &lt;admins&gt;<br/>US &amp; CA<br/>APAC",
    );
    expect(site.customFieldRows).toEqual([
      {
        title: "Affected Users",
        renderedHtml: "EU &lt;admins&gt;<br/>US &amp; CA<br/>APAC",
      },
    ]);
    expect(site.plainText["customFields.affected_users"]).toBe(
      "EU <admins>\r\nUS & CA\nAPAC",
    );
  });

  test("the only HTML in the email body bag is what the builder produced", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({ name: "Site", variableKey: "site" }),
        field({
          name: "Impact",
          variableKey: "impact",
          customFieldType: CustomFieldType.Markdown,
        }),
      ],
      customFields: { Site: "<b>03</b>", Impact: "x" },
      labels: ["<i>eu</i>"],
      markdownVariables: { incidentDescription: "Card payments fail." },
      textVariables: { incidentState: "<em>Resolved</em>" },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables);

    const htmlNames: Array<string> = Object.entries(site.emailBody)
      .filter(([, value]: [string, string | SafeHtml]): boolean => {
        return SafeHtml.isSafeHtml(value);
      })
      .map(([name]: [string, string | SafeHtml]): string => {
        return name;
      })
      .sort();

    expect(htmlNames).toEqual([
      "customFields.impact",
      "incidentDescription",
      "resourcesAffected",
    ]);
    expect(site.emailBody["customFields.site"]).toBe("<b>03</b>");
    expect(site.emailBody["incidentLabels"]).toBe("<i>eu</i>");
    expect(site.emailBody["incidentState"]).toBe("<em>Resolved</em>");
  });
});

describe("IncidentTemplateVariableBuilder which fields reach subscribers", () => {
  const DEFINITIONS: Array<IncidentTemplateCustomFieldDefinition> = [
    field({
      name: "Affected Location",
      variableKey: "affected_location",
      customFieldType: CustomFieldType.Dropdown,
      includeInSubscriberNotifications: true,
    }),
    field({
      name: "Internal Ticket",
      variableKey: "internal_ticket",
      includeInSubscriberNotifications: false,
    }),
    field({
      name: "Customer Impact",
      variableKey: "customer_impact",
      customFieldType: CustomFieldType.Number,
      includeInSubscriberNotifications: true,
    }),
  ];

  const VALUES: JSONObject = {
    "Affected Location": "Site 03",
    "Internal Ticket": "OPS-4411",
    "Customer Impact": 0,
  };

  test("only fields marked Include in Subscriber Notifications reach the default email", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({ definitions: DEFINITIONS, customFields: VALUES }),
    );

    expect(site.customFieldRows).toEqual([
      { title: "Affected Location", plainText: "Site 03" },
      // 0 is a value, not an empty field.
      { title: "Customer Impact", plainText: "0" },
    ]);
  });

  test("and the default Slack and Teams lines", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({ definitions: DEFINITIONS, customFields: VALUES }),
    );

    expect(site.customFieldsMarkdownLines).toEqual([
      "**Affected Location:** Site 03",
      "**Customer Impact:** 0",
    ]);
  });

  test("and webhooks, by key, with each value as stored", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        ...DEFINITIONS,
        field({
          name: "Sites",
          variableKey: "sites",
          customFieldType: CustomFieldType.MultiSelectDropdown,
          includeInSubscriberNotifications: true,
        }),
        field({
          name: "Workaround",
          variableKey: "workaround",
          includeInSubscriberNotifications: true,
        }),
      ],
      customFields: { ...VALUES, Sites: ["Site 03", "Site 07"] },
    });

    expect(variables.getWebhookCustomFields()).toEqual({
      affected_location: {
        name: "Affected Location",
        type: CustomFieldType.Dropdown,
        value: "Site 03",
      },
      customer_impact: {
        name: "Customer Impact",
        type: CustomFieldType.Number,
        value: 0,
      },
      sites: {
        name: "Sites",
        type: CustomFieldType.MultiSelectDropdown,
        value: ["Site 03", "Site 07"],
      },
      // An included field with no value is still there, as null.
      workaround: {
        name: "Workaround",
        type: CustomFieldType.Text,
        value: null,
      },
    });
  });

  test("every field, included or not, is offered to custom templates as customFields.<key>", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({ definitions: DEFINITIONS, customFields: VALUES }),
    );

    for (const bag of [site.emailBody, site.plainText, site.markdown]) {
      expect(bag["customFields.affected_location"]).toBe("Site 03");
      expect(bag["customFields.internal_ticket"]).toBe("OPS-4411");
      expect(bag["customFields.customer_impact"]).toBe("0");
    }
  });

  test("a field with no value is an empty string for templates, and left out of the default messages", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: DEFINITIONS,
        customFields: { "Affected Location": "", "Customer Impact": null },
      }),
    );

    expect(site.customFieldRows).toEqual([]);
    expect(site.customFieldsMarkdownLines).toEqual([]);
    expect(site.plainText["customFields.affected_location"]).toBe("");
    expect(site.plainText["customFields.internal_ticket"]).toBe("");
    expect(site.emailBody["customFields.customer_impact"]).toBe("");
    expect(
      SubscriberNotificationTemplateCompiler.compileTemplate(
        "[{{customFields.internal_ticket}}]",
        site.plainText,
      ),
    ).toBe("[]");
  });

  test("an empty multi-select is no value", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Sites",
            variableKey: "sites",
            customFieldType: CustomFieldType.MultiSelectDropdown,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Sites: [] },
      }),
    );

    expect(site.customFieldRows).toEqual([]);
  });

  test("an answer of only spaces is no value, not an empty row", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({
          name: "Impact",
          variableKey: "impact",
          customFieldType: CustomFieldType.Markdown,
          includeInSubscriberNotifications: true,
        }),
        field({
          name: "Site",
          variableKey: "site",
          includeInSubscriberNotifications: true,
        }),
      ],
      customFields: { Impact: "  \n ", Site: "   " },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables);

    expect(site.customFieldRows).toEqual([]);
    expect(site.customFieldsMarkdownLines).toEqual([]);
    expect(site.plainText["customFields.site"]).toBe("");
    expect(variables.getWebhookCustomFields()).toEqual({
      impact: { name: "Impact", type: CustomFieldType.Markdown, value: null },
      site: { name: "Site", type: CustomFieldType.Text, value: null },
    });
  });

  test("an incident with no custom field values at all still fills every placeholder", async () => {
    const variables: IncidentTemplateVariables =
      await IncidentTemplateVariableBuilder.build({
        incident: (() => {
          const row: Incident = incident();
          row.customFields = undefined;
          return row;
        })(),
        statusPages: [SITE_03],
        customFieldDefinitions: DEFINITIONS,
      });

    expect(forSite03(variables).plainText).toEqual(
      expect.objectContaining({
        "customFields.affected_location": "",
        "customFields.internal_ticket": "",
        "customFields.customer_impact": "",
      }),
    );
  });

  test("a field without a usable key reaches the default messages but no placeholder", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Legacy",
            variableKey: null,
            includeInSubscriberNotifications: true,
          }),
          field({
            name: "Odd",
            variableKey: "Not-A-Key",
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Legacy: "kept", Odd: "also kept" },
      }),
    );

    expect(rowTitles(site.customFieldRows)).toEqual(["Legacy", "Odd"]);
    expect(
      Object.keys(site.plainText).filter((name: string): boolean => {
        return name.startsWith("customFields.");
      }),
    ).toEqual([]);
  });

  test("values are read by the field's current name", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Region",
            variableKey: "location",
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Region: "EU", Location: "stale" },
      }),
    );

    expect(site.plainText["customFields.location"]).toBe("EU");
  });
});

describe("IncidentTemplateVariableBuilder field order", () => {
  test("fields come in their order, lowest first, then those without one in creation order", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({ name: "No order A", includeInSubscriberNotifications: true }),
          field({
            name: "Third",
            sortOrder: 30,
            includeInSubscriberNotifications: true,
          }),
          field({
            name: "First",
            sortOrder: 1,
            includeInSubscriberNotifications: true,
          }),
          field({ name: "No order B", includeInSubscriberNotifications: true }),
          field({
            name: "Second",
            sortOrder: 2,
            includeInSubscriberNotifications: true,
          }),
          field({
            name: "Also second",
            sortOrder: 2,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: {
          "No order A": "a",
          Third: "3",
          First: "1",
          "No order B": "b",
          Second: "2",
          "Also second": "2b",
        },
      }),
    );

    expect(rowTitles(site.customFieldRows)).toEqual([
      "First",
      "Second",
      "Also second",
      "Third",
      "No order A",
      "No order B",
    ]);
    expect(site.customFieldsMarkdownLines[0]).toBe("**First:** 1");
  });

  test("the project's fields are read in creation order, for the order to break ties by", async () => {
    mock(IncidentCustomFieldService.findBy).mockResolvedValue([
      field({
        name: "Later",
        sortOrder: 5,
        includeInSubscriberNotifications: true,
      }),
      field({
        name: "Earlier",
        sortOrder: 1,
        includeInSubscriberNotifications: true,
      }),
    ] as never);

    const variables: IncidentTemplateVariables =
      await IncidentTemplateVariableBuilder.build({
        incident: incident({ Later: "l", Earlier: "e" }),
        statusPages: [SITE_03],
      });

    expect(rowTitles(forSite03(variables).customFieldRows)).toEqual([
      "Earlier",
      "Later",
    ]);

    const query: JSONObject = mock(IncidentCustomFieldService.findBy).mock
      .calls[0]![0] as JSONObject;

    expect(query["query"]).toEqual({ projectId: PROJECT_ID });
    expect(query["sort"]).toEqual({ createdAt: "ASC" });
    expect(query["props"]).toEqual({ isRoot: true });
    expect(query["select"]).toEqual(
      expect.objectContaining({
        name: true,
        variableKey: true,
        customFieldType: true,
        includeInSubscriberNotifications: true,
        sortOrder: true,
      }),
    );
  });
});

describe("IncidentTemplateVariableBuilder value formats", () => {
  test.each([
    [true, "Yes"],
    [false, "No"],
    ["true", "Yes"],
    ["false", "No"],
  ])("a Boolean %p reads as %s", async (value: unknown, text: string) => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Acknowledged",
            variableKey: "acknowledged",
            customFieldType: CustomFieldType.Boolean,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Acknowledged: value as JSONObject[string] },
      }),
    );

    expect(site.customFieldRows).toEqual([
      { title: "Acknowledged", plainText: text },
    ]);
    expect(site.emailBody["customFields.acknowledged"]).toBe(text);
    expect(site.plainText["customFields.acknowledged"]).toBe(text);
  });

  test("a Date is the day that was picked, never shifted by a time zone", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Expected Resolution",
            variableKey: "expected_resolution",
            customFieldType: CustomFieldType.Date,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { "Expected Resolution": "2026-09-27T00:00:00.000Z" },
      }),
    );

    expect(site.customFieldRows).toEqual([
      { title: "Expected Resolution", plainText: "2026-09-27" },
    ]);
    expect(site.markdown["customFields.expected_resolution"]).toBe(
      "2026-09-27",
    );
  });

  test("a Date and time reads in the status page's subscriber time zones", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Started",
            variableKey: "started",
            customFieldType: CustomFieldType.DateTime,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Started: "2026-09-27T14:05:00.000Z" },
      }),
    );

    // One line per zone in HTML, commas in text.
    expect(site.customFieldRows).toEqual([
      {
        title: "Started",
        renderedHtml: "Sep 27 2026, 02:05 PM UTC<br/>Sep 27 2026, 07:35 PM IST",
      },
    ]);
    expect(site.plainText["customFields.started"]).toBe(
      "Sep 27 2026, 02:05 PM UTC, Sep 27 2026, 07:35 PM IST",
    );
    expect(htmlOf(site.emailBody["customFields.started"])).toBe(
      "Sep 27 2026, 02:05 PM UTC<br/>Sep 27 2026, 07:35 PM IST",
    );
  });

  test("a Date and time on a page with no subscriber time zones uses the usual ones", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [
        field({
          name: "Started",
          variableKey: "started",
          customFieldType: CustomFieldType.DateTime,
        }),
      ],
      customFields: { Started: "2026-09-27T14:05:00.000Z" },
    });

    const site: IncidentStatusPageTemplateVariables = variables.forStatusPage({
      statusPage: page({ name: "No zones" }),
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      resources: [],
    });

    expect(site.plainText["customFields.started"]).toContain(
      "Sep 27 2026, 02:05 PM UTC",
    );
    expect(site.plainText["customFields.started"]).toContain("AEST");
  });

  test("a Date and time that is not a date reads as stored", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Started",
            variableKey: "started",
            customFieldType: CustomFieldType.DateTime,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Started: "<soon>" },
      }),
    );

    expect(site.customFieldRows).toEqual([
      { title: "Started", plainText: "<soon>" },
    ]);
  });

  test("a multi-select lists its options with commas", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Sites",
            variableKey: "sites",
            customFieldType: CustomFieldType.MultiSelectDropdown,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Sites: ["Site 03", "", "Site 07"] },
      }),
    );

    expect(site.customFieldRows).toEqual([
      { title: "Sites", plainText: "Site 03, Site 07" },
    ]);
  });

  test("Rich text and Long text go on their own lines in chat", async () => {
    const site: IncidentStatusPageTemplateVariables = forSite03(
      await build({
        definitions: [
          field({
            name: "Impact",
            customFieldType: CustomFieldType.Markdown,
            includeInSubscriberNotifications: true,
          }),
          field({
            name: "Notes",
            customFieldType: CustomFieldType.LongText,
            includeInSubscriberNotifications: true,
          }),
        ],
        customFields: { Impact: "- EU\n- US", Notes: "line 1\nline 2" },
      }),
    );

    expect(site.customFieldsMarkdownLines).toEqual([
      "**Impact:**\n- EU\n- US",
      "**Notes:**\nline 1\nline 2",
    ]);
  });
});

describe("IncidentTemplateVariableBuilder shared values", () => {
  test("every bag carries the incident, the page, the event's values and the new incident variables", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [],
      labels: ["payments", "EU", "api"],
      statusPages: [
        SITE_03,
        page({ name: "site-07" }),
        page({ name: "site-09", showIncidentsOnStatusPage: false }),
      ],
      markdownVariables: { note: "We are **rolling back**." },
      textVariables: { incidentState: "Identified", postedAt: "Sep 27" },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables, [
      resource("Checkout API", "Europe"),
      resource("Payments API", "Americas"),
    ]);

    const shared: Record<string, string> = {
      statusPageName: "Site 03 Status",
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      incidentTitle: "Checkout requests failing",
      incidentSeverity: "Critical",
      // Alphabetical, whatever order the join returned them in.
      incidentLabels: "api, EU, payments",
      // Pages that show the incident, by the name subscribers know them by.
      affectedStatusPages: "Site 03 Status, site-07",
      incidentState: "Identified",
      postedAt: "Sep 27",
    };

    expect(site.plainText).toEqual({
      ...shared,
      resourcesAffected: "Europe: Checkout API; Americas: Payments API",
      note: "We are rolling back.",
    });
    expect(site.markdown).toEqual({
      ...shared,
      resourcesAffected: "Europe: Checkout API; Americas: Payments API",
      note: "We are **rolling back**.",
    });
    expect(Object.keys(site.emailBody).sort()).toEqual(
      Object.keys(site.plainText).sort(),
    );
    expect(htmlOf(site.emailBody["resourcesAffected"])).toBe(
      "Europe: Checkout API<br/>Americas: Payments API",
    );
    expect(htmlOf(site.emailBody["note"])).toBe(
      "<p>We are <strong>rolling back</strong>.</p>\n",
    );
    expect(variables.getMarkdownVariable("note").html).toBe(
      "<p>We are <strong>rolling back</strong>.</p>\n",
    );
    expect(site.resourcesAffectedHtml).toBe(
      "Europe: Checkout API<br/>Americas: Payments API",
    );
    expect(site.resourcesAffectedPlainText).toBe(
      "Europe: Checkout API; Americas: Payments API",
    );
  });

  test("a page that lists no resource reads the given text in templates, and nothing in the default messages", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [],
    });

    const site: IncidentStatusPageTemplateVariables = variables.forStatusPage({
      statusPage: SITE_03,
      statusPageUrl: STATUS_PAGE_URL,
      detailsUrl: DETAILS_URL,
      resources: [],
      noResourcesText: "None",
    });

    expect(site.plainText["resourcesAffected"]).toBe("None");
    expect(htmlOf(site.emailBody["resourcesAffected"])).toBe("None");
    expect(site.resourcesAffectedPlainText).toBe("");
    expect(site.resourcesAffectedHtml).toBe("");
  });

  test("an incident with no severity reads ' - '", async () => {
    const row: Incident = incident();
    row.incidentSeverity = undefined;

    const variables: IncidentTemplateVariables =
      await IncidentTemplateVariableBuilder.build({
        incident: row,
        statusPages: [SITE_03],
        customFieldDefinitions: [],
      });

    expect(forSite03(variables).plainText["incidentSeverity"]).toBe(" - ");
  });

  test("a missing Markdown value is empty in every form", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: [],
      markdownVariables: { incidentDescription: "" },
    });

    const site: IncidentStatusPageTemplateVariables = forSite03(variables);

    expect(site.plainText["incidentDescription"]).toBe("");
    expect(site.markdown["incidentDescription"]).toBe("");
    expect(variables.getMarkdownVariable("missing")).toEqual({
      source: "",
      html: "",
      plainText: "",
    });
  });
});

describe("IncidentTemplateVariableBuilder inline images", () => {
  const RICH_TEXT_WITH_IMAGE: string = `See ![screenshot](${IMAGE_URL})`;

  function definitions(
    includeInSubscriberNotifications: boolean,
  ): Array<IncidentTemplateCustomFieldDefinition> {
    return [
      field({
        name: "Impact",
        variableKey: "impact",
        customFieldType: CustomFieldType.Markdown,
        includeInSubscriberNotifications: includeInSubscriberNotifications,
      }),
    ];
  }

  test("an included Rich text field's images are made public, as a public note's are", async () => {
    await build({
      definitions: definitions(true),
      customFields: { Impact: RICH_TEXT_WITH_IMAGE },
    });

    expect(syncIsPublicForMarkdownImages).toHaveBeenCalledTimes(1);
    expect(
      mock(syncIsPublicForMarkdownImages).mock.calls[0]!.slice(0, 2),
    ).toEqual([RICH_TEXT_WITH_IMAGE, true]);
  });

  test("a field that does not go out keeps its images private", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: definitions(false),
      customFields: { Impact: RICH_TEXT_WITH_IMAGE },
    });

    await variables.publishImagesUsedBy([
      "<p>{{incidentTitle}}</p>",
      null,
      undefined,
    ]);

    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
  });

  test("a custom template that places the field makes its images public, once", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: definitions(false),
      customFields: { Impact: RICH_TEXT_WITH_IMAGE },
    });

    await variables.publishImagesUsedBy([
      "<div>{{ customFields.impact }}</div>",
    ]);
    await variables.publishImagesUsedBy(["{{customFields.impact}}"]);

    expect(syncIsPublicForMarkdownImages).toHaveBeenCalledTimes(1);
    expect(mock(syncIsPublicForMarkdownImages).mock.calls[0]![0]).toBe(
      RICH_TEXT_WITH_IMAGE,
    );
  });

  test("a plain field is never looked at for images", async () => {
    await build({
      definitions: [
        field({
          name: "Link",
          variableKey: "link",
          includeInSubscriberNotifications: true,
        }),
      ],
      customFields: { Link: IMAGE_URL },
    });

    expect(syncIsPublicForMarkdownImages).not.toHaveBeenCalled();
  });
});

describe("IncidentTemplateVariableBuilder feed record", () => {
  const DEFINITIONS: Array<IncidentTemplateCustomFieldDefinition> = [
    field({
      name: "Affected Location",
      variableKey: "affected_location",
      customFieldType: CustomFieldType.Dropdown,
      includeInSubscriberNotifications: true,
      sortOrder: 1,
    }),
    field({
      name: "Acknowledged",
      variableKey: "acknowledged",
      customFieldType: CustomFieldType.Boolean,
      includeInSubscriberNotifications: true,
      sortOrder: 2,
    }),
    field({
      name: "Started",
      variableKey: "started",
      customFieldType: CustomFieldType.DateTime,
      includeInSubscriberNotifications: true,
      sortOrder: 3,
    }),
    field({
      name: "Impact",
      variableKey: "impact",
      customFieldType: CustomFieldType.Markdown,
      includeInSubscriberNotifications: true,
      sortOrder: 4,
    }),
    field({
      name: "Internal [ticket]",
      variableKey: "internal_ticket",
      sortOrder: 5,
    }),
    field({
      name: "Empty",
      variableKey: "empty",
      includeInSubscriberNotifications: true,
      sortOrder: 6,
    }),
  ];

  const VALUES: JSONObject = {
    "Affected Location": "Site 03 *EU*",
    Acknowledged: false,
    Started: "2026-09-27T14:05:00.000Z",
    Impact: "Card payments **fail** in the EU.",
    "Internal [ticket]": "OPS-4411",
    Empty: "",
  };

  test("nothing sent, nothing recorded", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: DEFINITIONS,
      customFields: VALUES,
    });

    expect(variables.getSentCustomFieldsMarkdown()).toBe("");
  });

  test("a default message records the included fields that hold a value", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: DEFINITIONS,
      customFields: VALUES,
    });

    variables.recordIncludedFieldsSent();

    expect(variables.getSentCustomFieldsMarkdown()).toBe(
      [
        "**Custom fields sent:**",
        "",
        "- **Affected Location:** Site 03 \\*EU\\*",
        "- **Acknowledged:** No",
        "- **Started:** Sep 27 2026, 02:05 PM UTC",
        "",
        "**Impact:**",
        "",
        "Card payments **fail** in the EU.",
      ].join("\n"),
    );
  });

  test("a custom template records the fields it placed, included or not", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: DEFINITIONS,
      customFields: VALUES,
    });

    variables.recordFieldsUsedBy([
      "Ticket {{customFields.internal_ticket}} at {{customFields.empty}} {{customFields.unknown}}",
      undefined,
    ]);

    expect(variables.getSentCustomFieldsMarkdown()).toBe(
      [
        "**Custom fields sent:**",
        "",
        "- **Internal \\[ticket\\]:** OPS\\-4411",
      ].join("\n"),
    );
  });

  test("both together list each field once, in the fields' order", async () => {
    const variables: IncidentTemplateVariables = await build({
      definitions: DEFINITIONS,
      customFields: VALUES,
    });

    variables.recordFieldsUsedBy(["{{customFields.internal_ticket}}"]);
    variables.recordFieldsUsedBy(["{{customFields.affected_location}}"]);
    variables.recordIncludedFieldsSent();
    variables.recordIncludedFieldsSent();

    const markdown: string = variables.getSentCustomFieldsMarkdown();

    expect(markdown.match(/Affected Location/g)).toHaveLength(1);
    expect(markdown.indexOf("Affected Location")).toBeLessThan(
      markdown.indexOf("Internal"),
    );
    expect(markdown).not.toContain("Empty");
  });
});
