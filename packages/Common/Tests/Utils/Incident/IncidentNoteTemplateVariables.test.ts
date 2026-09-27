/** @timezone UTC */

import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import SubscriberNotificationTemplateCompiler from "../../../Types/StatusPage/SubscriberNotificationTemplateCompiler";
import {
  buildIncidentNoteTemplateVariables,
  fillNoteTemplate,
  formatCustomFieldValueForNote,
  INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX,
  INCIDENT_NOTE_TEMPLATE_VARIABLES,
  IncidentNoteTemplateCustomField,
  IncidentNoteTemplateSource,
  IncidentNoteTemplateVariableInfo,
  NoteTemplateVariables,
} from "../../../Utils/Incident/IncidentNoteTemplateVariables";
import { describe, expect, test } from "@jest/globals";

/*
 * Note template placeholders. IncidentNoteTemplate's example has shown
 * "**Incident**: {{incident.title}}" and "{{incident.startedAt}}" all along;
 * this fills them - and the others - from one incident, for the composer to
 * show before the note is posted.
 *
 * What is pinned: the names; that a known placeholder is filled and an unknown
 * one stays as written; custom fields by their template key, with each type
 * written the way it reads; labels and status pages as lists; and that no
 * value can become a link, an image or HTML once the note is rendered.
 */

const formatDateTime: (date: Date) => string = (date: Date): string => {
  return `AT ${date.toISOString()}`;
};

const DEFINITIONS: Array<IncidentNoteTemplateCustomField> = [
  {
    name: "Impact",
    variableKey: "impact",
    customFieldType: CustomFieldType.Dropdown,
  },
  {
    name: "Estimated Duration",
    variableKey: "estimated_duration",
    customFieldType: CustomFieldType.Number,
  },
  {
    name: "Acknowledgement",
    variableKey: "acknowledgement",
    customFieldType: CustomFieldType.Boolean,
  },
  {
    name: "Expected Resolution",
    variableKey: "expected_resolution",
    customFieldType: CustomFieldType.DateTime,
  },
  {
    name: "Go-live Date",
    variableKey: "go_live_date",
    customFieldType: CustomFieldType.Date,
  },
  {
    name: "Affected Users",
    variableKey: "affected_users",
    customFieldType: CustomFieldType.MultiSelectDropdown,
  },
  {
    name: "Additional Information",
    variableKey: "additional_information",
    customFieldType: CustomFieldType.LongText,
  },
  {
    name: "Customer Message",
    variableKey: "customer_message",
    customFieldType: CustomFieldType.Markdown,
  },
  {
    name: "Ticket",
    variableKey: "ticket",
    customFieldType: CustomFieldType.Text,
  },
];

function source(
  overrides: Partial<IncidentNoteTemplateSource> = {},
): IncidentNoteTemplateSource {
  return {
    title: "Payments are failing",
    incidentNumber: 42,
    incidentNumberWithPrefix: "INC-42",
    severityName: "Critical",
    stateName: "Investigating",
    declaredAt: new Date("2026-09-27T09:30:00.000Z"),
    labelNames: ["Region East", "Payments"],
    affectedStatusPageNames: ["Site 03", "Site 07"],
    customFields: {
      Impact: "High",
      "Estimated Duration": 0,
      Acknowledgement: false,
      "Expected Resolution": "2026-09-27T12:00:00.000Z",
      "Go-live Date": "2026-10-01",
      "Affected Users": ["Staff", "Visitors"],
      "Additional Information": "Line one\nLine two",
      "Customer Message":
        "**Please** use the [backup site](https://backup.example).",
      Ticket: "OPS-7",
    },
    customFieldDefinitions: DEFINITIONS,
    formatDateTime: formatDateTime,
    ...overrides,
  };
}

describe("the placeholders a note template can use", () => {
  test("include the ones IncidentNoteTemplate's example has always shown", () => {
    const names: Array<string> = INCIDENT_NOTE_TEMPLATE_VARIABLES.map(
      (variable: IncidentNoteTemplateVariableInfo) => {
        return variable.name;
      },
    );

    expect(names).toEqual([
      "incident.title",
      "incident.number",
      "incident.severity",
      "incident.state",
      "incident.startedAt",
      "incident.labels",
      "incident.affectedStatusPages",
      "customFields.<key>",
    ]);
  });

  test("every listed name except the custom field pattern is one the compiler fills", () => {
    for (const variable of INCIDENT_NOTE_TEMPLATE_VARIABLES) {
      if (
        variable.name.startsWith(INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX)
      ) {
        continue;
      }

      expect(
        SubscriberNotificationTemplateCompiler.isPlaceholderName(variable.name),
      ).toBe(true);
    }
  });

  test("every one is built for an incident", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    for (const variable of INCIDENT_NOTE_TEMPLATE_VARIABLES) {
      if (
        variable.name.startsWith(INCIDENT_NOTE_CUSTOM_FIELD_VARIABLE_PREFIX)
      ) {
        continue;
      }

      expect(variables).toHaveProperty([variable.name]);
    }
  });
});

describe("buildIncidentNoteTemplateVariables: the incident's own values", () => {
  test("title, number, severity, state and when it was declared", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    expect(variables["incident.title"]).toBe("Payments are failing");
    expect(variables["incident.number"]).toBe("INC-42");
    expect(variables["incident.severity"]).toBe("Critical");
    expect(variables["incident.state"]).toBe("Investigating");
    expect(variables["incident.startedAt"]).toBe("AT 2026-09-27T09:30:00.000Z");
  });

  test("the number without a project prefix reads #42", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ incidentNumberWithPrefix: undefined }),
    );

    expect(variables["incident.number"]).toBe("#42");
  });

  test("a declared-at string is read as a date", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ declaredAt: "2026-09-27T09:30:00.000Z" }),
    );

    expect(variables["incident.startedAt"]).toBe("AT 2026-09-27T09:30:00.000Z");
  });

  test("by default the time is written in the author's zone, with the zone named", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ formatDateTime: undefined }),
    );

    // The test environment runs in UTC, which the zone names as UTC or GMT.
    expect(variables["incident.startedAt"]).toMatch(
      /^Sep 27 2026, \S.* (UTC|GMT)$/,
    );
  });

  test("labels and affected status pages are comma-separated lists", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    expect(variables["incident.labels"]).toBe("Region East, Payments");
    expect(variables["incident.affectedStatusPages"]).toBe("Site 03, Site 07");
  });

  test("an incident with no labels fills the placeholder with nothing", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ labelNames: [], affectedStatusPageNames: [] }),
    );

    expect(variables["incident.labels"]).toBe("");
    expect(variables["incident.affectedStatusPages"]).toBe("");
  });

  test("blank names are left out of a list", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ labelNames: ["", "  ", "Payments"] }),
    );

    expect(variables["incident.labels"]).toBe("Payments");
  });

  test("what could not be read is left out, so its placeholder stays as written", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      {
        title: "Payments are failing",
        formatDateTime: formatDateTime,
      },
    );

    expect(Object.keys(variables)).toEqual(["incident.title"]);
  });
});

describe("buildIncidentNoteTemplateVariables: custom fields", () => {
  test("each field is filled by its template key", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    expect(variables).toMatchObject({
      "customFields.impact": "High",
      "customFields.ticket": "OPS-7",
      "customFields.affected_users": "Staff, Visitors",
      "customFields.expected_resolution": "AT 2026-09-27T12:00:00.000Z",
      "customFields.go_live_date": "2026-10-01",
    });
  });

  test("0 and false are answers, not blanks", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    expect(variables["customFields.estimated_duration"]).toBe("0");
    expect(variables["customFields.acknowledgement"]).toBe("No");
  });

  test("a ticked yes/no field reads Yes", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ customFields: { Acknowledgement: true } }),
    );

    expect(variables["customFields.acknowledgement"]).toBe("Yes");
  });

  test("long text keeps its lines", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    expect(variables["customFields.additional_information"]).toBe(
      "Line one\nLine two",
    );
  });

  test("rich text is placed as the Markdown it is", () => {
    const variables: NoteTemplateVariables =
      buildIncidentNoteTemplateVariables(source());

    expect(variables["customFields.customer_message"]).toBe(
      "**Please** use the [backup site](https://backup.example).",
    );
  });

  test("a field with no value on this incident fills with nothing", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ customFields: {} }),
    );

    expect(variables["customFields.impact"]).toBe("");
  });

  test("the value is read by the field's current name, whatever its key", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({
        customFields: { "Business Impact": "Low" },
        customFieldDefinitions: [
          {
            name: "Business Impact",
            // Made from its first name; a rename never changes it.
            variableKey: "impact",
            customFieldType: CustomFieldType.Text,
          },
        ],
      }),
    );

    expect(variables["customFields.impact"]).toBe("Low");
  });

  test("a field without a key, or with one the compiler would not fill, is not offered", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({
        customFieldDefinitions: [
          { name: "Impact", customFieldType: CustomFieldType.Text },
          {
            name: "Ticket",
            variableKey: "has-hyphen",
            customFieldType: CustomFieldType.Text,
          },
        ],
      }),
    );

    expect(
      Object.keys(variables).filter((name: string) => {
        return name.startsWith("customFields.");
      }),
    ).toEqual([]);
  });

  test("without the field definitions, no custom field placeholder is filled", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ customFieldDefinitions: undefined }),
    );

    expect(
      Object.keys(variables).some((name: string) => {
        return name.startsWith("customFields.");
      }),
    ).toBe(false);
  });

  test("a value with no definition is not offered", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ customFields: { "Deleted Field": "x" } }),
    );

    expect(variables).not.toHaveProperty(["customFields.deleted_field"]);
  });
});

describe("formatCustomFieldValueForNote", () => {
  test.each([
    [CustomFieldType.Text, "Down", "Down"],
    [CustomFieldType.Number, "3.5", "3.5"],
    [CustomFieldType.Number, 0, "0"],
    [CustomFieldType.Boolean, "true", "Yes"],
    [CustomFieldType.Boolean, "false", "No"],
    [CustomFieldType.Dropdown, "High", "High"],
    [CustomFieldType.MultiSelectDropdown, ["a", "", "b"], "a, b"],
    [CustomFieldType.MultiSelectDropdown, "single", "single"],
    [CustomFieldType.Date, "2026-10-01T00:00:00.000Z", "2026-10-01"],
    [CustomFieldType.DateTime, "not a date", "not a date"],
  ])(
    "%s %j reads %j",
    (type: CustomFieldType, value: unknown, expected: string) => {
      expect(
        formatCustomFieldValueForNote({
          customFieldType: type,
          value: value,
          formatDateTime: formatDateTime,
        }),
      ).toBe(expected);
    },
  );

  test.each([undefined, null, "", []])(
    "an empty value %j reads as nothing",
    (value: unknown) => {
      expect(
        formatCustomFieldValueForNote({
          customFieldType: CustomFieldType.Text,
          value: value,
        }),
      ).toBe("");
    },
  );

  test("a value of no known type is written as text", () => {
    expect(
      formatCustomFieldValueForNote({ customFieldType: undefined, value: 7 }),
    ).toBe("7");
  });
});

describe("fillNoteTemplate", () => {
  const TEMPLATE: string =
    "## Root Cause Analysis\n\n**Incident**: {{incident.title}}\n\n**Start Time**: {{incident.startedAt}}\n\n**Impact**: {{customFields.impact}}\n\n**Owner**: {{incident.owner}}";

  test("fills the known placeholders and leaves the unknown ones as written", () => {
    expect(
      fillNoteTemplate(TEMPLATE, buildIncidentNoteTemplateVariables(source())),
    ).toBe(
      "## Root Cause Analysis\n\n**Incident**: Payments are failing\n\n**Start Time**: AT 2026-09-27T09:30:00.000Z\n\n**Impact**: High\n\n**Owner**: {{incident.owner}}",
    );
  });

  test("a placeholder whose value could not be read stays as written", () => {
    expect(
      fillNoteTemplate(
        "Pages: {{incident.affectedStatusPages}}",
        buildIncidentNoteTemplateVariables(
          source({ affectedStatusPageNames: undefined }),
        ),
      ),
    ).toBe("Pages: {{incident.affectedStatusPages}}");
  });

  test("spaces inside the braces are allowed", () => {
    expect(
      fillNoteTemplate("{{ incident.title }}", {
        "incident.title": "Payments",
      }),
    ).toBe("Payments");
  });

  test("with no variables the template is returned untouched", () => {
    expect(fillNoteTemplate(TEMPLATE, undefined)).toBe(TEMPLATE);
    expect(fillNoteTemplate(TEMPLATE, {})).toBe(TEMPLATE);
  });

  test("a value is never expanded again, and $ patterns are text", () => {
    const variables: NoteTemplateVariables = buildIncidentNoteTemplateVariables(
      source({ title: "Costs $& {{incident.severity}}" }),
    );

    expect(fillNoteTemplate("{{incident.title}}", variables)).toBe(
      "Costs $& {{incident.severity}}",
    );
  });
});

/*
 * The links in rendered HTML, with the text each one shows. A bare address in
 * a value is still turned into a link by the renderer (as it is when someone
 * types one into a note), but such a link shows its own address. What must
 * never happen is a link whose text hides where it goes.
 */
function linksIn(html: string): Array<{ href: string; text: string }> {
  const links: Array<{ href: string; text: string }> = [];
  const pattern: RegExp = /<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null = pattern.exec(html);

  while (match) {
    links.push({ href: match[1]!, text: match[2]! });
    match = pattern.exec(html);
  }

  return links;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function expectOnlyLinksShowingTheirOwnAddress(html: string): void {
  for (const link of linksIn(html)) {
    expect(decodeEntities(link.text)).toBe(decodeURIComponent(link.href));
  }
}

describe("a filled note cannot carry a link, an image or HTML it was not written with", () => {
  const HOSTILE_TITLES: Array<string> = [
    "[Reset your password](https://evil.example/reset)",
    "![](https://tracker.example/pixel.png)",
    "<img src=x onerror=alert(1)>",
    '<a href="https://evil.example">Click</a>',
    "<https://evil.example/autolink>",
    "\\[x](https://evil.example/backslash)",
    "Checkout](https://evil.example/close) [click",
  ];

  test.each(HOSTILE_TITLES)(
    "a title of %j renders as text in a subscriber email",
    async (title: string) => {
      const filled: string = fillNoteTemplate(
        "**Incident**: {{incident.title}}",
        buildIncidentNoteTemplateVariables(source({ title: title })),
      );

      const html: string = await Markdown.convertToHTML(
        filled,
        MarkdownContentType.Email,
      );

      expectOnlyLinksShowingTheirOwnAddress(html);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toMatch(/<script/i);
      // The title's own markup reads as text.
      expect(html).not.toMatch(/>(Reset your password|Click|x|more)<\/a>/);
    },
  );

  test("a hostile value cannot end a link the template itself makes", async () => {
    const filled: string = fillNoteTemplate(
      "[{{incident.title}}](https://status.example/incidents/42)",
      buildIncidentNoteTemplateVariables(
        source({ title: "Payments](https://evil.example) [more" }),
      ),
    );

    const html: string = await Markdown.convertToHTML(
      filled,
      MarkdownContentType.Email,
    );

    // The template's link survives, with the whole title as its text.
    expect(linksIn(html)[0]).toEqual({
      href: "https://status.example/incidents/42",
      text: "Payments](https://evil.example) [more",
    });
    expect(linksIn(html)).toHaveLength(1);
  });

  test("a custom field value is escaped the same way", async () => {
    const filled: string = fillNoteTemplate(
      "**Ticket**: {{customFields.ticket}}",
      buildIncidentNoteTemplateVariables(
        source({
          customFields: { Ticket: "[OPS-7](https://evil.example)" },
        }),
      ),
    );

    const html: string = await Markdown.convertToHTML(
      filled,
      MarkdownContentType.Email,
    );

    expectOnlyLinksShowingTheirOwnAddress(html);
    expect(html).toContain("[OPS-7](");
    expect(html).not.toMatch(/>OPS-7<\/a>/);
  });

  test("rich text keeps its links, but the renderer still drops unsafe ones and raw HTML", async () => {
    const filled: string = fillNoteTemplate(
      "{{customFields.customer_message}}",
      buildIncidentNoteTemplateVariables(
        source({
          customFields: {
            "Customer Message":
              "See [the backup](https://backup.example) or [this](javascript:alert(1)) <script>alert(1)</script>",
          },
        }),
      ),
    );

    const html: string = await Markdown.convertToHTML(
      filled,
      MarkdownContentType.Email,
    );

    expect(html).toContain('href="https://backup.example"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<script>");
  });

  test("the escapes read back as the title that was typed", async () => {
    const title: string = "Site [03] <EU> - payments";

    const filled: string = fillNoteTemplate(
      "{{incident.title}}",
      buildIncidentNoteTemplateVariables(source({ title: title })),
    );

    const html: string = await Markdown.convertToHTML(
      filled,
      MarkdownContentType.Email,
    );

    expect(html).toContain("Site [03] &lt;EU&gt; - payments");
  });
});
