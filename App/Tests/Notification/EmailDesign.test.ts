import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import StatusPageSubscriberNotificationEventType from "Common/Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { getDefaultSubscriberNotificationTemplate } from "../../FeatureSet/Dashboard/src/Utils/SubscriberNotificationTemplateDefaults";
import { beforeAll, describe, expect, test } from "@jest/globals";

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const handlebars: typeof Handlebars = Handlebars.create();
const HOME_URL: string = "https://oneuptime.example.com";
const STATUS_URL: string = "https://status.example.com";
const LOGO_URL: string = "https://status.example.com/customer-logo.png";
const ACTION_URL: string =
  'https://oneuptime.example.com/action?token=abc123&label="Email action"';
const PREFERENCES_URL: string = `${HOME_URL}/dashboard/project/user-settings/notification-settings`;
const SUBSCRIPTION_URL: string = `${STATUS_URL}/manage-subscription/subscriber`;

function readTemplate(name: string): string {
  return fs.readFileSync(Path.join(TEMPLATES_DIR, name), "utf8");
}

// Discover files as well as checking the enum so new and legacy templates are
// included automatically. BlankTemplate is the deliberate customer-HTML escape
// hatch and is tested separately instead of imposing our layout on it.
const catalog: Array<string> = fs
  .readdirSync(TEMPLATES_DIR)
  .filter((name: string): boolean => {
    return name.endsWith(".hbs") && name !== EmailTemplateType.BlankTemplate;
  })
  .sort();
const customLogoTemplates: Array<string> = catalog.filter(
  (name: string): boolean => {
    return readTemplate(name).includes("{{> CustomLogo");
  },
);

function templateVariables(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    homeURL: HOME_URL,
    year: "2026",
    statusPageName: "Acme Status",
    statusPageUrl: STATUS_URL,
    logoUrl: LOGO_URL,
    title: "Your service update",
    subject: "Your service update",
    emailTitle: "Your service update",
    rollupTitle: "Your notification summary",
    projectName: "Acme Production",
    incidentTitle: "Checkout unavailable",
    incidentNumber: "INC-123",
    alertTitle: "High checkout latency",
    alertNumber: "ALT-123",
    episodeTitle: "Checkout disruption",
    incidentEpisodeTitle: "Checkout disruption",
    alertEpisodeTitle: "Checkout disruption",
    episodeNumber: "EP-123",
    monitorName: "Checkout API",
    monitorDestination: "https://api.example.com/checkout",
    monitorType: "API",
    requestType: "GET",
    scheduleName: "Primary support",
    onCallPolicyName: "Checkout support",
    remainingText: "30 minutes",
    currentState: "Investigating",
    incidentSeverity: "Critical",
    resourcesAffected: "Checkout API",
    incidentDescription: "<p>Our team is investigating.</p>",
    notificationPreferencesUrl: PREFERENCES_URL,
    unsubscribeUrl: SUBSCRIPTION_URL,
    hasResources: "true",
    report: {
      reportPeriodName: "August 2026",
      averageUptimePercent: "99.95%",
      reportStartDate: "Aug 1, 2026",
      reportEndDate: "Aug 31, 2026",
      reportTimezone: "UTC",
      totalDowntimeInHoursAndMinutes: "22 minutes",
      totalIncidents: 1,
      totalResources: 1,
      hasGroups: true,
      rows: [
        {
          isGroup: true,
          indentInPixels: 0,
          name: "Checkout services",
          totalResources: 1,
          uptimePercentAsString: "99.95%",
          downtimeInHoursAndMinutes: "22 minutes",
          totalIncidentCount: 1,
        },
        {
          isGroup: false,
          indentInPixels: 16,
          name: "Checkout API",
          uptimePercentAsString: "99.95%",
          downtimeInHoursAndMinutes: "22 minutes",
          totalIncidentCount: 1,
        },
      ],
    },
    rows: [
      {
        isSectionStart: "true",
        sectionLabel: "Incidents",
        sectionCount: "1 update",
        title: "Checkout unavailable",
        hasLink: "true",
        link: `${HOME_URL}/dashboard/project/incidents/incident`,
        metaLabel: "12:30 UTC",
        rowBackground: "#ffffff",
      },
    ],
    ...overrides,
  };
}

function render(name: string, overrides: Record<string, unknown> = {}): string {
  return handlebars.compile(readTemplate(name))(templateVariables(overrides));
}

beforeAll(() => {
  const partialsDir: string = Path.join(TEMPLATES_DIR, "Partials");

  for (const name of fs.readdirSync(partialsDir)) {
    if (name.endsWith(".hbs")) {
      handlebars.registerPartial(
        name.slice(0, -4),
        fs.readFileSync(Path.join(partialsDir, name), "utf8"),
      );
    }
  }

  // Match the production helper contract, including concat's variadic form.
  handlebars.registerHelper("concat", (...args: Array<unknown>): string => {
    return args
      .slice(0, -1)
      .map((value: unknown): string => {
        return value === undefined || value === null ? "" : String(value);
      })
      .join("");
  });
  handlebars.registerHelper(
    "ifCond",
    function (
      this: unknown,
      first: unknown,
      second: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return first === second ? options.fn(this) : options.inverse(this);
    },
  );
  handlebars.registerHelper(
    "ifNotCond",
    function (
      this: unknown,
      first: unknown,
      second: unknown,
      options: Handlebars.HelperOptions,
    ): string {
      return first !== second ? options.fn(this) : options.inverse(this);
    },
  );
});

describe("the complete built-in email design", () => {
  test("covers every registered template, including the custom HTML template", () => {
    for (const name of Object.values(EmailTemplateType)) {
      expect([...catalog, EmailTemplateType.BlankTemplate]).toContain(name);
    }
  });

  test.each(catalog)(
    "%s renders a complete, fluid document with one main heading",
    (name: string) => {
      const html: string = render(name);
      const shell: string | undefined = html.match(
        /<table\b[^>]*\bclass="[^"]*\bst-Wrapper\b[^>]*>/i,
      )?.[0];

      expect(html).toMatch(/<html\b[^>]*\blang="en"/i);
      expect(html).toMatch(/<meta\b[^>]*name="viewport"[^>]*>/i);
      expect(html).toContain("</body>");
      expect(html).toContain("</html>");
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/<h1\b[^>]*>\s*<\/h1>/i);
      expect(shell).toBeDefined();
      expect(shell).toContain('width="100%"');
      expect(shell).toMatch(/max-width:\s*640px/i);
      // A fixed minimum in even one nested table forces horizontal scrolling
      // on mobile, regardless of whether the outer shell is responsive.
      expect(html).not.toMatch(/min-width:\s*[4-9]\d{2}px/i);
      expect(html).not.toMatch(/<table\b[^>]*\bwidth="600"/i);
      expect(html).not.toContain("{{");
    },
  );

  test("has mobile gutters without resetting authored rich-content spacing", () => {
    const html: string = render(EmailTemplateType.AcknowledgeIncident);

    expect(html).toMatch(/@media[^{}]*max-width:\s*(600|640)px/i);
    expect(html).toMatch(/st-Spacer--gutter[^{}]*\{[^{}]*24px/i);

    const css: string =
      html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || "";

    for (const rule of css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors: Array<string> = rule[1]!.split(",");
      const resetsAuthoredContent: boolean = selectors.some(
        (selector: string): boolean => {
          return ["a", "span", "div"].includes(selector.trim());
        },
      );

      if (resetsAuthoredContent) {
        expect(rule[2]).not.toMatch(
          /(?:border|margin|padding):\s*0\s*!important/i,
        );
      }
    }
  });

  test("leaves a full custom email document byte-for-byte unchanged", () => {
    const body: string =
      '<!doctype html><html><head><style>.custom { margin: 18px; }</style></head><body><h1>Customer email</h1><p class="custom">A &amp; B</p><a href="https://status.example.com">Open status</a></body></html>';

    expect(render(EmailTemplateType.BlankTemplate, { body })).toBe(body);
  });
});

describe("email actions", () => {
  test.each([
    [EmailTemplateType.ForgotPassword, "tokenVerifyUrl", "Reset Password"],
    [
      EmailTemplateType.CompleteRegistration,
      "registrationLink",
      "Complete Registration",
    ],
    [EmailTemplateType.EmailChanged, "tokenVerifyUrl", "Verify Email"],
    [
      EmailTemplateType.AcknowledgeIncident,
      "acknowledgeIncidentLink",
      "Acknowledge Incident",
    ],
    [
      EmailTemplateType.AcknowledgeAlert,
      "acknowledgeAlertLink",
      "Acknowledge Alert",
    ],
    [
      EmailTemplateType.ConfirmStatusPageSubscription,
      "confirmationUrl",
      "Confirm Subscription",
    ],
    [EmailTemplateType.Invoice, "invoicePdfUrl", "View Invoice PDF"],
    [
      EmailTemplateType.UserOnCallShiftReminder,
      "scheduleViewLink",
      "View on Dashboard",
    ],
  ])(
    "%s retains its action destination and label",
    (name: string, key: string, label: string) => {
      const html: string = render(name, { [key]: ACTION_URL });

      expect(html).toContain(
        `href="${Handlebars.escapeExpression(ACTION_URL)}"`,
      );
      expect(html).toContain(label);
      expect(html).not.toContain("&amp;quot;");
    },
  );

  test("a long action label can wrap inside its padded click target", () => {
    const label: string = "Review the incident and acknowledge your response";
    const html: string = render("Partials/ButtonBlock.hbs", {
      buttonUrl: ACTION_URL,
      buttonText: label,
    });
    const anchor: string =
      html.match(/<a\b[^>]*class="[^"]*st-Button-link[^>]*>/i)?.[0] || "";

    expect(anchor).toMatch(/padding:\s*[1-9]\d*px/i);
    expect(html).not.toMatch(/white-space:\s*nowrap/i);
    expect(anchor).not.toMatch(/(?:^|[;\s])height:\s*\d+px/i);
    expect(html).toContain(label);
  });

  test("subscriber actions fall back to the status page when a details link is absent", () => {
    const withDetails: string = render(
      EmailTemplateType.SubscriberIncidentCreated,
      {
        detailsUrl: ACTION_URL,
      },
    );
    const withoutDetails: string = render(
      EmailTemplateType.SubscriberIncidentCreated,
    );

    expect(withDetails).toContain(
      `href="${Handlebars.escapeExpression(ACTION_URL)}"`,
    );
    expect(withDetails).toContain("View Incident Details");
    expect(withoutDetails).toContain(`href="${STATUS_URL}"`);
    expect(withoutDetails).toContain("View Status Page");
    expect(withoutDetails).not.toContain("View Incident Details");
  });

  test("optional invoice actions appear only when their destinations exist", () => {
    const withoutLinks: string = render(EmailTemplateType.Invoice);
    const withLinks: string = render(EmailTemplateType.Invoice, {
      invoicePdfUrl: ACTION_URL,
      dashboardLink: `${HOME_URL}/billing`,
    });

    expect(withoutLinks).not.toContain("View Invoice PDF");
    expect(withoutLinks).not.toContain("View Billing Dashboard");
    expect(withLinks).toContain("View Invoice PDF");
    expect(withLinks).toContain("View Billing Dashboard");
    expect(withLinks).toContain(`href="${HOME_URL}/billing"`);
  });

  test("the copyable fallback is also a working, escaped link", () => {
    const html: string = render(EmailTemplateType.CompleteRegistration, {
      registrationLink: ACTION_URL,
    });
    const escapedUrl: string = Handlebars.escapeExpression(ACTION_URL);

    expect(html.split(`href="${escapedUrl}"`)).toHaveLength(3);
    expect(html).toContain(`>${escapedUrl}</a>`);
  });
});

describe("episode item cards", () => {
  test.each([
    [EmailTemplateType.AcknowledgeAlertEpisode, "alerts", "Alerts"],
    [EmailTemplateType.AcknowledgeIncidentEpisode, "incidents", "Incidents"],
  ])(
    "%s preserves the generated list and hides the section when empty",
    (name: string, collection: string, label: string) => {
      const list: string =
        '<table role="presentation" width="100%"><tr><td><a href="https://oneuptime.example.com/item">Checkout API</a></td></tr></table>';
      const html: string = render(name, {
        [`${collection}List`]: list,
        [`${collection}Count`]: "1",
      });

      expect(html).toContain(`${label} in this Episode (1)`);
      expect(html).toContain(list);
      expect(html).not.toContain("&lt;table");
      expect(render(name)).not.toContain(`${label} in this Episode`);
    },
  );

  test.each([
    [EmailTemplateType.AlertEpisodeOwnerAlertAdded, "alerts", "alert"],
    [
      EmailTemplateType.IncidentEpisodeOwnerIncidentAdded,
      "incidents",
      "incident",
    ],
  ])(
    "%s keeps each item's link, severity, time, and remainder",
    (name: string, collection: string, item: string) => {
      const title: string = 'Checkout <strong>API</strong> & "Payments"';
      const items: Array<Record<string, string>> = [
        {
          [`${item}Number`]: "1234",
          [`${item}Title`]: title,
          [`${item}Severity`]: "Critical",
          [`${item}ViewLink`]: ACTION_URL,
          addedAt: "12:30 UTC<br/>13:30 BST",
        },
        {
          [`${item}Number`]: "1235",
          [`${item}Title`]: "Another checkout update",
          [`${item}Severity`]: "Warning",
          [`${item}ViewLink`]: `${HOME_URL}/second-update`,
          addedAt: "12:45 UTC<br/>13:45 BST",
        },
      ];
      const vars: Record<string, unknown> = {
        [collection]: items,
        hasMore: "true",
        remainingCount: "7",
        episodeViewLink: `${HOME_URL}/episode`,
      };
      const html: string = render(name, vars);

      expect(html).toContain(Handlebars.escapeExpression(title));
      expect(html).not.toContain(title);
      expect(html).toContain(
        `href="${Handlebars.escapeExpression(ACTION_URL)}"`,
      );
      expect(html).toContain(`href="${HOME_URL}/second-update"`);
      expect(html).toContain("Critical");
      expect(html).toContain("Warning");
      expect(html).toContain("12:30 UTC<br/>13:30 BST");
      expect(html).toContain("12:45 UTC<br/>13:45 BST");
      expect(html).toContain("...and 7 more.");
      expect(render(name, { ...vars, hasMore: "false" })).not.toContain(
        "...and 7 more.",
      );
    },
  );
});

describe("customer branding and subscription navigation", () => {
  test.each(customLogoTemplates)(
    "%s remains branded when a customer has no logo",
    (name: string) => {
      for (const logoUrl of [undefined, ""]) {
        const html: string = render(name, { logoUrl });

        expect(html).not.toMatch(/<img\b[^>]*src="\s*"/i);
        expect(html).toContain("Acme Status");
      }
    },
  );

  test("custom logos use customer alt text and the status-page destination", () => {
    const html: string = render("Partials/CustomLogo.hbs", {
      homeURL: undefined,
    });

    expect(html).toContain(`src="${LOGO_URL}"`);
    expect(html).toContain('alt="Acme Status"');
    expect(html).toContain(`href="${STATUS_URL}"`);
    expect(html).not.toContain('href=""');
  });

  test("a custom logo without either optional destination is an image without a dead link", () => {
    const html: string = render("Partials/CustomLogo.hbs", {
      homeURL: undefined,
      homeUrl: undefined,
      statusPageUrl: undefined,
    });

    expect(html).toContain(`src="${LOGO_URL}"`);
    expect(html).not.toMatch(/<a\b/i);
  });

  test("owner settings and subscriber settings retain their separate destinations", () => {
    const owner: string = render(EmailTemplateType.IncidentOwnerAdded);
    const subscriber: string = render(
      EmailTemplateType.SubscriberIncidentCreated,
      {
        subscriberEmailNotificationFooterText:
          "<p>Updates from our support team.</p>",
      },
    );

    expect(owner).toContain(`href="${PREFERENCES_URL}"`);
    expect(owner).toContain("Manage notification preferences");
    expect(owner).not.toContain(SUBSCRIPTION_URL);
    expect(subscriber).toContain(`href="${SUBSCRIPTION_URL}"`);
    expect(subscriber).toContain("Manage subscription");
    expect(subscriber).not.toContain(PREFERENCES_URL);
    expect(subscriber).toContain("<p>Updates from our support team.</p>");
  });

  test("the uptime report keeps its populated and empty states navigable", () => {
    const populated: string = render(
      EmailTemplateType.StatusPageSubscriberReport,
    );
    const empty: string = render(EmailTemplateType.StatusPageSubscriberReport, {
      hasResources: "false",
    });

    expect(populated).toContain("Breakdown by group");
    expect(populated).toContain("Checkout services");
    expect(populated).toContain("Checkout API");
    expect(empty).toContain("No resources have been added");
    expect(empty).not.toContain("Breakdown by group");

    for (const html of [populated, empty]) {
      expect(html).toContain("View Full Status Page");
      expect(html).toContain(`href="${STATUS_URL}"`);
      expect(html).toContain(`href="${SUBSCRIPTION_URL}"`);
    }
  });
});

describe("the rich-content contract survives the design refresh", () => {
  test("plain fields and headings are escaped once while block HTML stays intact", () => {
    const title: string = 'Checkout <strong>API</strong> & "Payments"';
    const description: string =
      "<p>Current progress:</p><ul><li>Investigating <strong>checkout</strong>.</li></ul><table><tbody><tr><td>eu-west</td><td>12 ms</td></tr></tbody></table>";
    const html: string = render(EmailTemplateType.AcknowledgeIncident, {
      incidentTitle: title,
      projectName: title,
      incidentDescription: description,
    });

    expect(html).toContain(Handlebars.escapeExpression(title));
    expect(html).not.toContain(title);
    expect(html).not.toContain("&amp;lt;");
    expect(html).toContain(description);
    expect(html).not.toContain("&lt;ul&gt;");
    expect(html).toMatch(
      /<div\b[^>]*class="[^"]*st-DetailCard-value[^>]*>\s*<p>Current progress:/i,
    );
    expect(html).not.toMatch(/<p\b[^>]*>\s*<p>Current progress:/i);
  });

  test("inline date markup and explicitly trusted info markup are preserved", () => {
    const date: string = "12:30 UTC<br/>13:30 BST";
    const info: string =
      '<p>Read the <a href="https://status.example.com/update">latest update</a>.</p>';

    expect(render("Partials/DetailBoxField.hbs", { text: date })).toContain(
      date,
    );
    expect(render("Partials/InfoBlock.hbs", { info })).toContain(info);
    expect(
      render("Partials/InfoBlock.hbs", { plainInfo: "<strong>Plain</strong>" }),
    ).toContain("&lt;strong&gt;Plain&lt;/strong&gt;");
  });
});

describe("the email starter templates offered to status-page customers", () => {
  test.each(Object.values(StatusPageSubscriberNotificationEventType))(
    "%s renders independently with responsive sizing and working navigation",
    (event: StatusPageSubscriberNotificationEventType) => {
      const defaults: ReturnType<
        typeof getDefaultSubscriberNotificationTemplate
      > = getDefaultSubscriberNotificationTemplate(
        event,
        StatusPageSubscriberNotificationMethod.Email,
      );

      expect(defaults?.body).toBeTruthy();

      // A fresh engine proves these HTML starters do not depend on the
      // application's private partial registration or custom helpers.
      const standaloneHandlebars: typeof Handlebars = Handlebars.create();
      const html: string = standaloneHandlebars.compile(defaults!.body)(
        templateVariables({
          confirmationUrl: ACTION_URL,
          manageSubscriptionUrl: ACTION_URL,
          detailsUrl: ACTION_URL,
        }),
      );

      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/<h1\b[^>]*>\s*<\/h1>/i);
      expect(html).toMatch(/width:\s*100%/i);
      expect(html).toMatch(/max-width:\s*(600|640)px/i);
      expect(html).toMatch(/overflow-wrap:\s*anywhere/i);
      expect(html).not.toMatch(/min-width:\s*\d+px/i);
      expect(html).not.toContain("{{");
      expect(html).not.toContain('href=""');

      const destination: string =
        event === StatusPageSubscriberNotificationEventType.SubscriberSubscribed
          ? STATUS_URL
          : ACTION_URL;

      expect(html).toContain(
        `href="${Handlebars.escapeExpression(destination)}"`,
      );

      if (
        event !==
        StatusPageSubscriberNotificationEventType.SubscriberManageSubscription
      ) {
        expect(html).toContain(`href="${SUBSCRIPTION_URL}"`);
      }

      expect(render(EmailTemplateType.BlankTemplate, { body: html })).toBe(
        html,
      );
    },
  );
});
