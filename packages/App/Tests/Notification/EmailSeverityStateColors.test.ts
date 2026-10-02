import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import { beforeAll, describe, expect, test } from "@jest/globals";

/*
 * Registers the product's real `concat` / `ifCond` / `ifNotCond` helpers as
 * an import side effect, so every template renders with what ships.
 */
import "../../FeatureSet/Notification/Utils/Handlebars";

/*
 * "In emails, we have severity and state. They should have their colours.
 * Have colours in a small circle beside them, and also text would be the
 * severity colour or a state colour."
 *
 * Every email that names a severity, a state or a monitor status now paints
 * the name the way the dashboard does: a small dot in the colour the project
 * configured, and the name in that colour - or in the nearest shade of it
 * that reads, from EmailColorUtil. The label ("Severity:") stays neutral.
 *
 * Pinned here, template by template, with the variables the senders build:
 *
 *   1. With a colour: a dot in the true colour (ringed in the text shade, so
 *      a near-white one still shows), then the escaped name in the shade.
 *   2. Without one - a legacy email, a severity that is not set - exactly
 *      today's neutral row, and no empty `color: ;` left behind.
 *   3. Inline styles only, a span with a border radius for the dot (no SVG,
 *      which Gmail strips), aria-hidden on the dot so a screen reader reads
 *      the name once.
 *   4. A name still goes through the ESCAPED slot; a colour that somehow
 *      reached a template unsanitised still cannot break out of its
 *      attribute.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "Templates",
);

function templateSource(name: string): string {
  return fs.readFileSync(Path.resolve(TEMPLATES_DIR, name), {
    encoding: "utf8",
  });
}

function partialSource(name: string): string {
  return templateSource(Path.join("Partials", `${name}.hbs`));
}

function render(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(templateSource(name))(vars);
}

function renderPartial(name: string, vars: Record<string, unknown>): string {
  return Handlebars.compile(partialSource(name))(vars);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

beforeAll(() => {
  const partialsDir: string = Path.resolve(TEMPLATES_DIR, "Partials");

  for (const filename of fs.readdirSync(partialsDir)) {
    const matches: RegExpMatchArray | null = filename.match(/^(.*)\.hbs$/u);

    if (!matches) {
      continue;
    }

    Handlebars.registerPartial(
      matches[1]!,
      fs.readFileSync(Path.resolve(partialsDir, filename), {
        encoding: "utf8",
      }),
    );
  }
});

// A pale colour, so the text shade differs from the dot and both are tested.
const PALE: string = "#facc15";
const PALE_TEXT: string = EmailColorUtil.getColorPair(PALE)!.textColor;
// A colour that already reads, so dot and text share it.
const DEEP: string = "#1e3a8a";

interface ColouredValue {
  dotStyle: string;
  textStyle: string;
}

/*
 * The dot and the coloured name for one escaped value, as they render in a
 * DetailBoxField - or null when the value is not painted.
 */
function findColouredValue(
  html: string,
  escapedName: string,
): ColouredValue | null {
  const match: RegExpMatchArray | null = html.match(
    new RegExp(
      `<span class="st-ColorDot" aria-hidden="true" style="([^"]*)"></span><span class="st-ColorText" style="([^"]*)">${escapeRegExp(
        escapedName,
      )}</span>`,
    ),
  );

  return match ? { dotStyle: match[1]!, textStyle: match[2]! } : null;
}

// The value rendered the neutral way: straight inside the value container.
function findNeutralValue(html: string, escapedName: string): boolean {
  return new RegExp(
    `<div class="st-DetailCard-value" style="margin: 0; font-size: 15px; line-height: 24px; color: #0f172a;">${escapeRegExp(
      escapedName,
    )}</div>`,
  ).test(html);
}

function expectPainted(
  value: ColouredValue | null,
  color: string,
  textColor: string,
): void {
  expect(value).not.toBeNull();
  expect(value!.dotStyle).toContain(`background-color: ${color};`);
  expect(value!.dotStyle).toContain(`border: 1px solid ${textColor};`);
  expect(value!.dotStyle).toContain("border-radius: 9999px;");
  expect(value!.dotStyle).toContain("display: inline-block;");
  expect(value!.dotStyle).toContain("width: 8px;");
  expect(value!.dotStyle).toContain("height: 8px;");
  expect(value!.textStyle).toContain(`color: ${textColor};`);
}

/*
 * EVERY DETAIL ROW THAT NAMES A SEVERITY, STATE OR STATUS, by template. A
 * hand-written list on purpose: it is the statement of which emails must be
 * coloured, so a template that loses its colour fails here by name.
 */
interface ColouredRow {
  template: string;
  label: string;
  variable: string;
}

const COLOURED_ROWS: Array<ColouredRow> = [
  // On-call page-outs.
  {
    template: "AcknowledgeAlert.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AcknowledgeAlert.hbs",
    label: "Severity:",
    variable: "alertSeverity",
  },
  {
    template: "AcknowledgeIncident.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AcknowledgeIncident.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "AcknowledgeAlertEpisode.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AcknowledgeAlertEpisode.hbs",
    label: "Severity:",
    variable: "alertEpisodeSeverity",
  },
  {
    template: "AcknowledgeIncidentEpisode.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AcknowledgeIncidentEpisode.hbs",
    label: "Severity:",
    variable: "incidentEpisodeSeverity",
  },
  // Incident owners and members.
  {
    template: "IncidentOwnerAdded.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentOwnerAdded.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "IncidentOwnerNotePosted.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentOwnerNotePosted.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "IncidentOwnerResourceCreated.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentOwnerResourceCreated.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "IncidentOwnerStateChanged.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "IncidentOwnerUnresolvedReminder.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentOwnerUnresolvedReminder.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "IncidentMemberAdded.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentMemberAdded.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  // Alert owners.
  {
    template: "AlertOwnerAdded.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertOwnerAdded.hbs",
    label: "Severity:",
    variable: "alertSeverity",
  },
  {
    template: "AlertOwnerNotePosted.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertOwnerNotePosted.hbs",
    label: "Severity:",
    variable: "alertSeverity",
  },
  {
    template: "AlertOwnerResourceCreated.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertOwnerResourceCreated.hbs",
    label: "Severity:",
    variable: "alertSeverity",
  },
  {
    template: "AlertOwnerStateChanged.hbs",
    label: "Severity:",
    variable: "alertSeverity",
  },
  {
    template: "AlertOwnerUnresolvedReminder.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertOwnerUnresolvedReminder.hbs",
    label: "Severity:",
    variable: "alertSeverity",
  },
  // Alert episode owners.
  {
    template: "AlertEpisodeOwnerAdded.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertEpisodeOwnerAdded.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "AlertEpisodeOwnerNotePosted.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertEpisodeOwnerNotePosted.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "AlertEpisodeOwnerResourceCreated.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "AlertEpisodeOwnerResourceCreated.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "AlertEpisodeOwnerStateChanged.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "AlertEpisodeOwnerAlertAdded.hbs",
    label: "Current Episode State:",
    variable: "currentState",
  },
  // Incident episode owners.
  {
    template: "IncidentEpisodeOwnerAdded.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentEpisodeOwnerAdded.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "IncidentEpisodeOwnerNotePosted.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentEpisodeOwnerNotePosted.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "IncidentEpisodeOwnerResourceCreated.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "IncidentEpisodeOwnerResourceCreated.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "IncidentEpisodeOwnerStateChanged.hbs",
    label: "Severity:",
    variable: "episodeSeverity",
  },
  {
    template: "IncidentEpisodeOwnerIncidentAdded.hbs",
    label: "Current Episode State:",
    variable: "currentState",
  },
  // Scheduled maintenance owners.
  {
    template: "ScheduledMaintenanceOwnerAdded.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "ScheduledMaintenanceOwnerNotePosted.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "ScheduledMaintenanceOwnerResourceCreated.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  {
    template: "ScheduledMaintenanceOwnerUnresolvedReminder.hbs",
    label: "Current State:",
    variable: "currentState",
  },
  // Monitor owners.
  {
    template: "MonitorOwnerAdded.hbs",
    label: "Current Status:",
    variable: "currentStatus",
  },
  {
    template: "MonitorOwnerResourceCreated.hbs",
    label: "Current Status:",
    variable: "currentStatus",
  },
  // Status page subscribers.
  {
    template: "SubscriberIncidentCreated.hbs",
    label: "Severity",
    variable: "incidentSeverity",
  },
  {
    template: "SubscriberIncidentNoteCreated.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "SubscriberIncidentNoteUpdated.hbs",
    label: "Severity:",
    variable: "incidentSeverity",
  },
  {
    template: "SubscriberIncidentPostmortemCreated.hbs",
    label: "Severity",
    variable: "incidentSeverity",
  },
  {
    template: "SubscriberIncidentStateChanged.hbs",
    label: "Current State",
    variable: "incidentState",
  },
  {
    template: "SubscriberIncidentStateChanged.hbs",
    label: "Severity",
    variable: "incidentSeverity",
  },
  {
    template: "SubscriberEpisodeCreated.hbs",
    label: "Severity",
    variable: "episodeSeverity",
  },
  {
    template: "SubscriberEpisodeNoteCreated.hbs",
    label: "Severity",
    variable: "episodeSeverity",
  },
  {
    template: "SubscriberEpisodeNoteUpdated.hbs",
    label: "Severity",
    variable: "episodeSeverity",
  },
  {
    template: "SubscriberEpisodeStateChanged.hbs",
    label: "Current State",
    variable: "episodeState",
  },
  {
    template: "SubscriberEpisodeStateChanged.hbs",
    label: "Severity",
    variable: "episodeSeverity",
  },
  {
    template: "SubscriberScheduledMaintenanceEventStateChanged.hbs",
    label: "Event State:",
    variable: "eventState",
  },
];

// A name every escape touches, so a raw slot would show up as a live tag.
const NAME: string = 'Sev & <b>"1"</b>';
const ESCAPED_NAME: string = Handlebars.escapeExpression(NAME);

describe.each(COLOURED_ROWS)(
  "$template paints its $variable row",
  (row: ColouredRow) => {
    test("with a dot in the true colour and the name in its readable shade", () => {
      const html: string = render(row.template, {
        [row.variable]: NAME,
        ...EmailColorUtil.getTemplateVariables(row.variable, PALE),
      });

      expectPainted(findColouredValue(html, ESCAPED_NAME), PALE, PALE_TEXT);
    });

    test("and a colour that already reads paints dot and name alike", () => {
      const html: string = render(row.template, {
        [row.variable]: NAME,
        ...EmailColorUtil.getTemplateVariables(row.variable, DEEP),
      });

      expectPainted(findColouredValue(html, ESCAPED_NAME), DEEP, DEEP);
    });

    test("keeps the label neutral", () => {
      const html: string = render(row.template, {
        [row.variable]: NAME,
        ...EmailColorUtil.getTemplateVariables(row.variable, PALE),
      });
      const label: RegExpMatchArray | null = html.match(
        new RegExp(
          `<p class="st-DetailCard-label" style="([^"]*)">${escapeRegExp(
            row.label,
          )}\\s*</p>`,
        ),
      );

      expect(label).not.toBeNull();
      expect(label![1]).toContain("color: #64748b;");
      expect(label![1]).not.toContain(PALE);
      expect(label![1]).not.toContain(PALE_TEXT);
    });

    test("escapes the name and never renders it as markup", () => {
      const html: string = render(row.template, {
        [row.variable]: NAME,
        ...EmailColorUtil.getTemplateVariables(row.variable, PALE),
      });

      expect(html).toContain(ESCAPED_NAME);
      expect(html).not.toContain('<b>"1"</b>');
    });

    test("without a colour, renders today's neutral row and no dot", () => {
      const html: string = render(row.template, { [row.variable]: NAME });

      expect(findColouredValue(html, ESCAPED_NAME)).toBeNull();
      expect(findNeutralValue(html, ESCAPED_NAME)).toBe(true);
      expect(html).not.toContain("st-ColorDot");
      expect(html).not.toMatch(/color: ;/);
      expect(html).not.toMatch(/solid ;/);
    });

    test("the template passes the colour pair to the escaped slot", () => {
      expect(templateSource(row.template)).toContain(
        `plainText=${row.variable} color=${row.variable}Color textColor=${row.variable}TextColor`,
      );
    });
  },
);

describe("every severity, state and status row in every template is coloured", () => {
  const NAME_VARIABLES: Array<string> = [
    "currentState",
    "incidentSeverity",
    "alertSeverity",
    "episodeSeverity",
    "alertEpisodeSeverity",
    "incidentEpisodeSeverity",
    "incidentState",
    "episodeState",
    "eventState",
  ];

  const templates: Array<string> = fs
    .readdirSync(TEMPLATES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    });

  /*
   * A ratchet for templates written after this one: a DetailBoxField that
   * shows a severity or state name must go through the escaped slot with its
   * colour. currentStatus is left out: MonitorProbesStatus.hbs reuses that
   * name for a probe's connection status, which has no configured colour.
   */
  test.each(templates)("%s", (template: string) => {
    const source: string = templateSource(template);

    for (const match of source.matchAll(/\{\{> DetailBoxField ([^}]*)\}\}/g)) {
      const call: string = match[1]!;

      for (const variable of NAME_VARIABLES) {
        if (
          !new RegExp(`\\b(?:text|plainText|blockText)=${variable}\\b`).test(
            call,
          )
        ) {
          continue;
        }

        expect(call).toContain(`plainText=${variable} `);
        expect(call).toContain(`color=${variable}Color`);
        expect(call).toContain(`textColor=${variable}TextColor`);
      }
    }
  });

  test("the hand-written list covers every coloured row the templates have", () => {
    const found: Array<string> = [];

    for (const template of templates) {
      for (const match of templateSource(template).matchAll(
        /plainText=(\w+) color=\1Color textColor=\1TextColor/g,
      )) {
        found.push(`${template}:${match[1]}`);
      }
    }

    expect(found.sort()).toEqual(
      COLOURED_ROWS.map((row: ColouredRow): string => {
        return `${row.template}:${row.variable}`;
      }).sort(),
    );
  });

  test("the probe status rows are left uncoloured", () => {
    expect(templateSource("MonitorProbesStatus.hbs")).not.toContain(
      "currentStatusColor",
    );
  });
});

describe("DetailBoxField's colour slot", () => {
  test("paints the escaped value and marks the dot decorative", () => {
    const html: string = renderPartial("DetailBoxField", {
      title: "Severity:",
      plainText: "High <script>",
      color: "#ef4444",
      textColor: "#da1818",
    });

    expectPainted(
      findColouredValue(html, "High &lt;script&gt;"),
      "#ef4444",
      "#da1818",
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<script>");
  });

  test("the name is semi-bold so a coloured word still has weight", () => {
    const html: string = renderPartial("DetailBoxField", {
      plainText: "High",
      color: "#ef4444",
      textColor: "#da1818",
    });

    expect(findColouredValue(html, "High")!.textStyle).toContain(
      "font-weight: 600;",
    );
  });

  test("a colour with no text colour paints the name in the colour itself", () => {
    const html: string = renderPartial("DetailBoxField", {
      plainText: "High",
      color: "#1e3a8a",
    });

    expectPainted(findColouredValue(html, "High"), "#1e3a8a", "#1e3a8a");
    expect(html).not.toMatch(/color: ;|solid ;/);
  });

  test.each([undefined, null, ""])(
    "renders byte-identically to before when color is %p",
    (color: unknown) => {
      const withColourSlot: string = renderPartial("DetailBoxField", {
        title: "Severity:",
        plainText: "High",
        color: color,
        textColor: "#da1818",
      });
      const legacy: string = renderPartial("DetailBoxField", {
        title: "Severity:",
        plainText: "High",
      });

      expect(withColourSlot).toBe(legacy);
    },
  );

  test("only plainText takes a colour: the raw HTML slots are unchanged", () => {
    const html: string = renderPartial("DetailBoxField", {
      text: "<em>raw</em>",
      blockText: "<p>block</p>",
      color: "#ef4444",
      textColor: "#da1818",
    });

    expect(html).not.toContain("st-ColorDot");
    expect(html).toContain("<em>raw</em>");
    expect(html).toContain("<p>block</p>");
  });

  test("a colour that reached the template unsanitised cannot leave its attribute", () => {
    const html: string = renderPartial("DetailBoxField", {
      plainText: "High",
      color: '#fff" onmouseover="alert(1)',
      textColor: '#000"><img src=x onerror=alert(1)>',
    });

    expect(html).not.toMatch(/<img/i);
    expect(html).not.toContain('" onmouseover="');
    expect(html).toContain("&quot;");
  });
});

describe.each([
  ["StateTransition", "previousState", "currentState"],
  ["StatusTransition", "previousStatus", "currentStatus"],
])("%s", (partial: string, previousKey: string, currentKey: string) => {
  function transitionVars(
    previousColor: string | undefined,
    currentColor: string | undefined,
  ): Record<string, unknown> {
    return {
      [previousKey]: "Investigating",
      [currentKey]: "Resolved",
      ...EmailColorUtil.getTemplateVariables(previousKey, previousColor),
      ...EmailColorUtil.getTemplateVariables(currentKey, currentColor),
    };
  }

  function stylesFor(html: string, name: string): ColouredValue | null {
    const match: RegExpMatchArray | null = html.match(
      new RegExp(
        `<span\\s+class="st-ColorDot"\\s+aria-hidden="true"\\s+style="([^"]*)"\\s*></span>\\s*<span\\s+class="st-ColorText"\\s+style="([^"]*)"\\s*>${name}</span>`,
      ),
    );

    return match ? { dotStyle: match[1]!, textStyle: match[2]! } : null;
  }

  test("paints both sides: a circle in the true colour and the name in its shade", () => {
    const html: string = renderPartial(
      partial,
      transitionVars("#ef4444", "#22c55e"),
    );
    const previous: ColouredValue | null = stylesFor(html, "Investigating");
    const current: ColouredValue | null = stylesFor(html, "Resolved");

    for (const [value, color] of [
      [previous, "#ef4444"],
      [current, "#22c55e"],
    ] as Array<[ColouredValue | null, string]>) {
      const textColor: string = EmailColorUtil.getColorPair(color)!.textColor;

      expect(value).not.toBeNull();
      expect(value!.dotStyle).toContain(`background-color: ${color};`);
      expect(value!.dotStyle).toContain(`border: 1px solid ${textColor};`);
      expect(value!.dotStyle).toContain("border-radius: 9999px;");
      expect(value!.textStyle).toContain(`color: ${textColor};`);
    }
  });

  test("a pale colour gets a darker name than its dot", () => {
    const html: string = renderPartial(partial, transitionVars(PALE, PALE));

    expect(stylesFor(html, "Resolved")!.textStyle).toContain(
      `color: ${PALE_TEXT};`,
    );
    expect(stylesFor(html, "Resolved")!.dotStyle).toContain(
      `background-color: ${PALE};`,
    );
  });

  test("without colours: no dots, and the names keep the neutral text colour", () => {
    const html: string = renderPartial(
      partial,
      transitionVars(undefined, undefined),
    );

    expect(html).not.toContain("st-ColorDot");
    expect(html).not.toContain("background-color: ;");
    expect(html).toContain("Investigating");
    expect(html).toContain("Resolved");
    expect(html).toMatch(/font-weight: 600; color: #0f172a;/);
  });

  test("a caller that sends only the colour still gets a coloured name", () => {
    const html: string = renderPartial(partial, {
      [previousKey]: "Investigating",
      [currentKey]: "Resolved",
      [`${currentKey}Color`]: "#4f46e5",
    });

    expect(stylesFor(html, "Resolved")!.textStyle).toContain("color: #4f46e5;");
    expect(stylesFor(html, "Resolved")!.dotStyle).toContain(
      "border: 1px solid #4f46e5;",
    );
  });

  test("one side coloured and one not", () => {
    const html: string = renderPartial(
      partial,
      transitionVars(undefined, "#22c55e"),
    );

    expect(stylesFor(html, "Resolved")).not.toBeNull();
    expect(stylesFor(html, "Investigating")).toBeNull();
    expect(html.match(/st-ColorDot/g)).toHaveLength(1);
  });
});

describe.each([
  ["IncidentOwnerStateChanged.hbs", "currentState", "previousState"],
  ["AlertOwnerStateChanged.hbs", "currentState", "previousState"],
  ["AlertEpisodeOwnerStateChanged.hbs", "currentState", "previousState"],
  ["IncidentEpisodeOwnerStateChanged.hbs", "currentState", "previousState"],
  [
    "ScheduledMaintenanceOwnerStateChanged.hbs",
    "currentState",
    "previousState",
  ],
  ["MonitorOwnerStatusChanged.hbs", "currentStatus", "previousStatus"],
])(
  "%s's transition",
  (template: string, currentKey: string, previousKey: string) => {
    test("paints both states with the colours the sender built", () => {
      const html: string = render(template, {
        [previousKey]: "Identified",
        [currentKey]: "Resolved",
        ...EmailColorUtil.getTemplateVariables(previousKey, "#ef4444"),
        ...EmailColorUtil.getTemplateVariables(currentKey, PALE),
      });

      expect(html).toContain("background-color: #ef4444;");
      expect(html).toContain(`background-color: ${PALE};`);
      expect(html).toContain(`color: ${PALE_TEXT};`);
      expect(html.match(/class="st-ColorDot"/g)).toHaveLength(2);
    });
  },
);

describe("the alert-created severity badge", () => {
  test("has a dot in the severity's colour, an outline in it and the name in its shade", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", {
      severityBadgeText: "Low",
      severityColor: PALE,
      severityTextColor: PALE_TEXT,
    });
    const badge: RegExpMatchArray | null = html.match(
      /<span\s+style="(display:inline-block;padding:6px 14px;[^"]*)"\s*><span class="st-ColorDot" aria-hidden="true" style="([^"]*)"><\/span><span style="vertical-align:middle;">Low<\/span><\/span>/,
    );

    expect(badge).not.toBeNull();
    expect(badge![1]).toContain(`color:${PALE_TEXT};`);
    expect(badge![1]).toContain(`border:1px solid ${PALE};`);
    expect(badge![2]).toContain(`background-color:${PALE};`);
    expect(badge![2]).toContain("border-radius:9999px;");
  });

  test("still renders no badge at all without a severity", () => {
    const html: string = render("AlertOwnerResourceCreated.hbs", {});

    expect(html).not.toContain("padding:6px 14px");
  });
});

describe.each([
  ["AlertEpisodeOwnerAlertAdded.hbs", "alerts", "alertSeverity", "alertTitle"],
  [
    "IncidentEpisodeOwnerIncidentAdded.hbs",
    "incidents",
    "incidentSeverity",
    "incidentTitle",
  ],
])(
  "%s member list",
  (
    template: string,
    listKey: string,
    severityKey: string,
    titleKey: string,
  ) => {
    function memberSeverity(html: string, name: string): ColouredValue | null {
      const match: RegExpMatchArray | null = html.match(
        new RegExp(
          `<strong style="font-weight: 600;">Severity:</strong> <span class="st-ColorDot" aria-hidden="true" style="([^"]*)"></span><span class="st-ColorText" style="([^"]*)">${escapeRegExp(
            name,
          )}</span>`,
        ),
      );

      return match ? { dotStyle: match[1]!, textStyle: match[2]! } : null;
    }

    const html: () => string = (): string => {
      return render(template, {
        currentState: "Investigating",
        ...EmailColorUtil.getTemplateVariables("currentState", "#3b82f6"),
        [listKey]: [
          {
            [titleKey]: "Coloured member",
            [severityKey]: "Critical",
            ...EmailColorUtil.getTemplateVariables(severityKey, "#dc2626"),
          },
          {
            [titleKey]: "Pale member",
            [severityKey]: "Low",
            ...EmailColorUtil.getTemplateVariables(severityKey, PALE),
          },
          {
            [titleKey]: "Member without a colour",
            [severityKey]: "Not Set",
          },
        ],
      });
    };

    test("each member's severity has its own dot and colour", () => {
      const rendered: string = html();
      const critical: ColouredValue | null = memberSeverity(
        rendered,
        "Critical",
      );
      const low: ColouredValue | null = memberSeverity(rendered, "Low");
      const criticalText: string =
        EmailColorUtil.getColorPair("#dc2626")!.textColor;

      expect(critical!.dotStyle).toContain("background-color: #dc2626;");
      expect(critical!.textStyle).toContain(`color: ${criticalText};`);
      expect(low!.dotStyle).toContain(`background-color: ${PALE};`);
      expect(low!.textStyle).toContain(`color: ${PALE_TEXT};`);
    });

    test("a member without a colour keeps the plain severity", () => {
      const rendered: string = html();

      expect(memberSeverity(rendered, "Not Set")).toBeNull();
      expect(rendered).toContain(
        '<strong style="font-weight: 600;">Severity:</strong> Not Set</p>',
      );
    });

    test("the episode's own state is painted too", () => {
      expectPainted(
        findColouredValue(html(), "Investigating"),
        "#3b82f6",
        EmailColorUtil.getColorPair("#3b82f6")!.textColor,
      );
    });
  },
);

describe("email-client safety of the coloured markup", () => {
  const SOURCES: Array<[string, string]> = [
    ["DetailBoxField", partialSource("DetailBoxField")],
    ["StateTransition", partialSource("StateTransition")],
    ["StatusTransition", partialSource("StatusTransition")],
    ["SeverityBadge", partialSource("SeverityBadge")],
    ["NotificationRollup", templateSource("NotificationRollup.hbs")],
    [
      "AlertEpisodeOwnerAlertAdded",
      templateSource("AlertEpisodeOwnerAlertAdded.hbs"),
    ],
    [
      "IncidentEpisodeOwnerIncidentAdded",
      templateSource("IncidentEpisodeOwnerIncidentAdded.hbs"),
    ],
  ];

  test.each(SOURCES)(
    "%s draws its dot with a styled span, never SVG or a stylesheet",
    (_name: string, source: string) => {
      expect(source).toContain("st-ColorDot");
      expect(source).not.toMatch(/<svg|<style|class="[^"]*\bdot\b/i);

      for (const dot of source.matchAll(
        /<span[^>]*class="st-ColorDot"[^>]*style="([^"]*)"/g,
      )) {
        expect(dot[1]).toMatch(/border-radius:\s?9999px;/);
        expect(dot[1]).toMatch(/display:\s?inline-block;/);
        expect(dot[1]).toMatch(/background-color:\s?\{\{/);
      }
    },
  );

  test.each(SOURCES)(
    "%s puts every colour in a double stash, never a triple one",
    (_name: string, source: string) => {
      expect(source).not.toMatch(/\{\{\{[^}]*Color[^}]*\}\}\}/);
    },
  );

  test.each(SOURCES)(
    "%s hides every dot from screen readers",
    (_name: string, source: string) => {
      for (const dot of source.matchAll(
        /<span[^>]*class="st-ColorDot"[^>]*>/g,
      )) {
        expect(dot[0]).toContain('aria-hidden="true"');
      }
    },
  );
});
