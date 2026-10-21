import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";

/*
 * The incident custom fields in the default subscriber emails: the
 * IncidentCustomFieldRows partial, used by the incident created, state
 * changed, note posted, note updated and postmortem templates.
 *
 * The rows are built by the real IncidentTemplateVariableBuilder, with the
 * real email Markdown renderer, and rendered through the real templates and
 * partials - so what is checked here is what a subscriber reads:
 *
 *   - only fields marked "Include in Subscriber Notifications" appear, in
 *     their order, and fields with no value are left out;
 *   - a plain value is escaped by the template (plainText=), a Rich text
 *     value is the renderer's HTML with its raw HTML escaped, and neither is
 *     escaped twice;
 *   - an email with no rows renders as one without the variable.
 *
 * Only the database read of the project's fields and the image visibility
 * write are faked.
 */

jest.mock("Common/Server/Services/IncidentCustomFieldService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

jest.mock("Common/Server/Utils/InlineImageAccessTokenSync", () => {
  return { __esModule: true, syncIsPublicForMarkdownImages: jest.fn() };
});

import Incident from "Common/Models/DatabaseModels/Incident";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import IncidentTemplateVariableBuilder, {
  IncidentCustomFieldEmailRow,
  IncidentTemplateCustomFieldDefinition,
  IncidentTemplateVariables,
} from "Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder";
import { syncIsPublicForMarkdownImages } from "Common/Server/Utils/InlineImageAccessTokenSync";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);

const INCIDENT_TEMPLATES: Array<string> = [
  "SubscriberIncidentCreated.hbs",
  "SubscriberIncidentStateChanged.hbs",
  "SubscriberIncidentNoteCreated.hbs",
  "SubscriberIncidentNoteUpdated.hbs",
  "SubscriberIncidentPostmortemCreated.hbs",
];

const handlebars: typeof Handlebars = Handlebars.create();

function templateSource(filename: string): string {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, filename), "utf8");
}

function render(filename: string, variables: JSONObject): string {
  return handlebars.compile(templateSource(filename))(variables);
}

const BASE_VARIABLES: JSONObject = {
  year: "2026",
  statusPageName: "Acme Status",
  statusPageUrl: "https://status.acme.com",
  detailsUrl: "https://status.acme.com/incidents/1",
  unsubscribeUrl: "https://status.acme.com/unsubscribe/1",
  logoUrl: "",
  isPublicStatusPage: "true",
  emailTitle: "Incident on Checkout API is Identified",
  incidentTitle: "Checkout requests failing",
  incidentSeverity: "Critical",
  incidentState: "Identified",
  resourcesAffected: "Checkout API",
  incidentDescription: "<p>Card payments fail.</p>",
  note: "<p>Rolling back.</p>",
  postmortemNote: "<p>A bad deploy.</p>",
  subscriberEmailNotificationFooterText: "Footer",
};

const DEFINITIONS: Array<IncidentTemplateCustomFieldDefinition> = [
  {
    name: "Internal Ticket",
    variableKey: "internal_ticket",
    customFieldType: CustomFieldType.Text,
    includeInSubscriberNotifications: false,
    sortOrder: 1,
  },
  {
    name: "Impact <Details>",
    variableKey: "impact_details",
    customFieldType: CustomFieldType.Markdown,
    includeInSubscriberNotifications: true,
    sortOrder: 3,
  },
  {
    name: "Affected Location",
    variableKey: "affected_location",
    customFieldType: CustomFieldType.Text,
    includeInSubscriberNotifications: true,
    sortOrder: 2,
  },
  {
    name: "Acknowledgement",
    variableKey: "acknowledgement",
    customFieldType: CustomFieldType.Boolean,
    includeInSubscriberNotifications: true,
    sortOrder: 4,
  },
  {
    name: "Workaround",
    variableKey: "workaround",
    customFieldType: CustomFieldType.LongText,
    includeInSubscriberNotifications: true,
    sortOrder: 5,
  },
  {
    name: "Left Empty",
    variableKey: "left_empty",
    customFieldType: CustomFieldType.Text,
    includeInSubscriberNotifications: true,
    sortOrder: 6,
  },
];

const VALUES: JSONObject = {
  "Internal Ticket": "OPS-4411",
  "Impact <Details>":
    'Card payments **fail** <img src=x onerror="alert(1)"> [Reset](javascript:alert(1))',
  "Affected Location": "<script>alert('site')</script> Site 03 & 07",
  Acknowledgement: false,
  Workaround: "Retry <later>\nor pay by invoice",
  "Left Empty": "",
};

async function customFieldRows(
  values: JSONObject = VALUES,
): Promise<Array<IncidentCustomFieldEmailRow>> {
  const incident: Incident = new Incident();
  incident._id = ObjectID.generate().toString();
  incident.title = "Checkout requests failing";
  incident.customFields = values;

  const statusPage: StatusPage = new StatusPage();
  statusPage._id = ObjectID.generate().toString();
  statusPage.name = "Acme";

  const variables: IncidentTemplateVariables =
    await IncidentTemplateVariableBuilder.build({
      incident: incident,
      statusPages: [statusPage],
      customFieldDefinitions: DEFINITIONS,
    });

  return variables.forStatusPage({
    statusPage: statusPage,
    statusPageUrl: "https://status.acme.com",
    detailsUrl: "https://status.acme.com/incidents/1",
    resources: [],
  }).customFieldRows;
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    if (filename.endsWith(".hbs")) {
      handlebars.registerPartial(
        filename.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, filename), "utf8"),
      );
    }
  }

  // Same semantics as App/FeatureSet/Notification/Utils/Handlebars.ts.
  handlebars.registerHelper("concat", (...args: Array<unknown>): string => {
    return args
      .slice(0, -1)
      .map((value: unknown): string => {
        return value === null || value === undefined ? "" : String(value);
      })
      .join("");
  });

  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      v1: unknown,
      v2: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return v1 === v2 ? options.fn(this) : options.inverse(this);
    },
  );
});

beforeEach(() => {
  (syncIsPublicForMarkdownImages as unknown as jest.Mock).mockResolvedValue(
    undefined as never,
  );
});

describe("the incident custom fields in the default subscriber emails", () => {
  test.each(INCIDENT_TEMPLATES)(
    "%s shows only the included fields that hold a value, in their order",
    async (filename: string) => {
      const html: string = render(filename, {
        ...BASE_VARIABLES,
        customFieldRows: (await customFieldRows()) as unknown as JSONObject,
      });

      // The field left out of subscriber notifications stays out.
      expect(html).not.toContain("Internal Ticket");
      expect(html).not.toContain("OPS-4411");
      // An included field with no value is left out, title and all.
      expect(html).not.toContain("Left Empty");

      const order: Array<number> = [
        "Affected Location",
        "Impact &lt;Details&gt;",
        "Acknowledgement",
        "Workaround",
      ].map((title: string): number => {
        return html.indexOf(`>${title}</p>`);
      });

      for (const position of order) {
        expect(position).toBeGreaterThan(-1);
      }
      expect(
        [...order].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(order);
    },
  );

  test.each(INCIDENT_TEMPLATES)(
    "%s escapes a plain value once, and shows a Rich text value as its safe HTML",
    async (filename: string) => {
      const html: string = render(filename, {
        ...BASE_VARIABLES,
        customFieldRows: (await customFieldRows()) as unknown as JSONObject,
      });

      // A plain value: escaped by the template's plainText=, once.
      expect(html).toContain(
        "&lt;script&gt;alert(&#x27;site&#x27;)&lt;/script&gt; Site 03 &amp; 07",
      );
      expect(html).not.toContain("<script>alert");
      expect(html).not.toContain("&amp;lt;");

      // A Boolean reads as a word.
      expect(html).toMatch(/>No<\/div>/);

      // Rich text: rendered, its raw HTML escaped and its unsafe link dropped.
      expect(html).toContain("<strong>fail</strong>");
      expect(html).not.toContain("<img src=x");
      expect(html).not.toContain("javascript:");

      // Long text: its lines kept, each escaped.
      expect(html).toContain("Retry &lt;later&gt;<br/>or pay by invoice");

      // A field's name is escaped too.
      expect(html).not.toContain("Impact <Details>");
    },
  );

  test.each(INCIDENT_TEMPLATES)(
    "%s renders the same with no rows as without the variable",
    async (filename: string) => {
      const withoutRows: string = render(filename, BASE_VARIABLES);

      expect(
        render(filename, {
          ...BASE_VARIABLES,
          customFieldRows: (await customFieldRows({})) as unknown as JSONObject,
        }),
      ).toBe(withoutRows);
      expect(
        render(filename, {
          ...BASE_VARIABLES,
          customFieldRows: [] as unknown as JSONObject,
        }),
      ).toBe(withoutRows);
    },
  );

  test("every incident template includes the rows, and no other template does", () => {
    const templates: Array<string> = fs
      .readdirSync(TEMPLATES_DIR)
      .filter((filename: string): boolean => {
        return (
          filename.endsWith(".hbs") &&
          templateSource(filename).includes("IncidentCustomFieldRows")
        );
      })
      .sort();

    expect(templates).toEqual([...INCIDENT_TEMPLATES].sort());
  });

  /*
   * The partial's one raw slot carries renderedHtml, which only the builder
   * fills (with rendered Markdown, escaped lines or date HTML). Everything
   * else it reads goes through escaped output.
   */
  test("the partial puts only the builder's rendered HTML in a raw slot", () => {
    const source: string = templateSource(
      "Partials/IncidentCustomFieldRows.hbs",
    );

    const rawSlots: Array<string> = Array.from(
      source.matchAll(/\b(?:text|blockText|info)=([\w.]+)/g),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(rawSlots).toEqual(["renderedHtml"]);
    expect(source).not.toMatch(/{{{/);
  });

  test("a row carries either text for the template to escape or the builder's safe HTML, never both", async () => {
    const rows: Array<IncidentCustomFieldEmailRow> = await customFieldRows();

    for (const row of rows) {
      if (row["renderedHtml"] !== undefined) {
        expect(row["plainText"]).toBeUndefined();
        expect(String(row["renderedHtml"])).not.toContain("<script");
        expect(String(row["renderedHtml"])).not.toContain("<img src=x");
      }
    }
  });
});
