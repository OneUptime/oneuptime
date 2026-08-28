import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";
import { OneUptimeLogoUrl } from "../../../Server/Utils/VendorAssets";

/*
 * The public acknowledge page, rendered.
 *
 * https://github.com/OneUptime/oneuptime/issues/3457 reported two things about
 * it: the OneUptime logo rendered as a broken image, and the page carried no
 * information about the alert at all - just its title and a button. These
 * tests render the real templates and assert on the HTML a browser is handed,
 * because both failures are only visible in the output.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const ACKNOWLEDGE_VIEW: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "Server",
  "Views",
  "AcknowledgeUserOnCallNotification.ejs",
);

const VIEW_MESSAGE_VIEW: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "Server",
  "Views",
  "ViewMessage.ejs",
);

const IDENTITY_MESSAGE_VIEW: string = path.join(
  REPOSITORY_ROOT,
  "App",
  "FeatureSet",
  "Identity",
  "Views",
  "Message.ejs",
);

type RenderFunction = (
  viewPath: string,
  variables: Record<string, unknown>,
) => string;

const render: RenderFunction = (
  viewPath: string,
  variables: Record<string, unknown>,
): string => {
  return ejs.render(fs.readFileSync(viewPath, "utf8"), variables, {
    filename: viewPath,
  });
};

const ACKNOWLEDGE_BASE: Record<string, unknown> = {
  title: "Acknowledge Alert - CPU above 90% on prod-web-1",
  message: "Do you want to acknowledge this Alert?",
  acknowledgeText: "Acknowledge Alert",
  acknowledgeUrl:
    "https://oneuptime.example.com/api/user-on-call-log-timeline/acknowledge/1",
};

const ALERT_CONTEXT: Record<string, unknown> = {
  resourceNumber: "ALT-42",
  resourceTitle: "CPU above 90% on prod-web-1",
  resourceDescription: "CPU has been pinned for fifteen minutes.",
  details: [
    { label: "Severity", value: "Critical", color: "#dc2626" },
    { label: "Current State", value: "Created", color: "#f59e0b" },
    { label: "Project", value: "Acme Production", color: "" },
    { label: "Monitor", value: "prod-web-1 CPU", color: "" },
    { label: "Raised At", value: "Jan 15, 2026, 4:30 AM EST", color: "" },
  ],
};

describe("the logo the acknowledge page loads", () => {
  /*
   * The reported broken image. `/img/...` is served by the Home container, and
   * nginx routes "/" to App on every install with billing off - which is every
   * self-hosted install - so the page asked a service that has no such route.
   * The logo now comes from the prefix Common mounts in every service.
   */
  const VIEWS_WITH_A_LOGO: Array<[string, string]> = [
    ["acknowledge page", ACKNOWLEDGE_VIEW],
    ["already-acknowledged page", VIEW_MESSAGE_VIEW],
    ["SSO message page", IDENTITY_MESSAGE_VIEW],
  ];

  test("is served from a path every service mounts", () => {
    for (const [label, viewPath] of VIEWS_WITH_A_LOGO) {
      const source: string = fs.readFileSync(viewPath, "utf8");

      expect([label, source.includes(OneUptimeLogoUrl)]).toEqual([label, true]);
    }
  });

  test("is not the Home-only path that 404'd", () => {
    for (const [label, viewPath] of VIEWS_WITH_A_LOGO) {
      const source: string = fs.readFileSync(viewPath, "utf8");

      expect([label, source.includes("/img/3-transparent.svg")]).toEqual([
        label,
        false,
      ]);
    }
  });

  test("survives into the rendered HTML", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      ...ALERT_CONTEXT,
    });

    expect(html).toContain(`src="${OneUptimeLogoUrl}"`);
    expect(html).toContain('alt="OneUptime"');
  });
});

describe("the acknowledge page's alert context", () => {
  test("shows the severity, state, project, monitor and time it was raised", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      ...ALERT_CONTEXT,
    });

    expect(html).toContain("Severity");
    expect(html).toContain("Critical");
    expect(html).toContain("Current State");
    expect(html).toContain("Created");
    expect(html).toContain("Project");
    expect(html).toContain("Acme Production");
    expect(html).toContain("Monitor");
    expect(html).toContain("prod-web-1 CPU");
    expect(html).toContain("Raised At");
    expect(html).toContain("Jan 15, 2026, 4:30 AM EST");
  });

  test("shows the description and the resource number", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      ...ALERT_CONTEXT,
    });

    expect(html).toContain("CPU has been pinned for fifteen minutes.");
    expect(html).toContain("ALT-42");
  });

  test("still renders the acknowledge button and its link", () => {
    /*
     * The context is an addition, not a replacement. Whatever else the page
     * shows, the reason the engineer opened it must still be there.
     */
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      ...ALERT_CONTEXT,
    });

    expect(html).toContain("Acknowledge Alert");
    expect(html).toContain(
      'href="https://oneuptime.example.com/api/user-on-call-log-timeline/acknowledge/1"',
    );
  });

  test("draws a swatch for a colour and none for a row without one", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      ...ALERT_CONTEXT,
    });

    expect(html).toContain("background-color: #dc2626");
    expect(html).toContain("background-color: #f59e0b");
    expect((html.match(/background-color:/g) || []).length).toBe(2);
  });
});

describe("the acknowledge page without any context", () => {
  /*
   * Reachable whenever the resource the notification pointed at has since been
   * deleted. Losing the description must never cost the engineer the button.
   */
  test("renders from the same locals it always took", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, ACKNOWLEDGE_BASE);

    expect(html).toContain("Do you want to acknowledge this Alert?");
    expect(html).toContain("Acknowledge Alert");
    expect(html).toContain(`src="${OneUptimeLogoUrl}"`);
  });

  test("renders with the context locals present but empty", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      resourceNumber: "",
      resourceTitle: "",
      resourceDescription: "",
      details: [],
    });

    expect(html).toContain("Acknowledge Alert");
    expect(html).not.toContain("<dl");
  });

  test("shows the title alone when only the title survived", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      resourceNumber: "",
      resourceTitle: "CPU above 90% on prod-web-1",
      resourceDescription: "",
      details: [],
    });

    expect(html).toContain("CPU above 90% on prod-web-1");
    expect(html).not.toContain("<dl");
  });
});

describe("the acknowledge page escapes what the project typed", () => {
  test("escapes markup in the title and description", () => {
    /*
     * An alert title is whatever a monitor template produced, and a
     * description is free text somebody typed. Neither is markup.
     */
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      resourceNumber: "",
      resourceTitle: "<script>alert(1)</script>",
      resourceDescription: "<img src=x onerror=alert(2)>",
      details: [],
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(2)>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("escapes markup in a detail label and value", () => {
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      resourceNumber: "",
      resourceTitle: "Alert",
      resourceDescription: "",
      details: [
        {
          label: "<b>Severity</b>",
          value: "<i>Critical</i>",
          color: "",
        },
      ],
    });

    expect(html).not.toContain("<b>Severity</b>");
    expect(html).not.toContain("<i>Critical</i>");
    expect(html).toContain("&lt;b&gt;Severity&lt;/b&gt;");
  });

  test("cannot be made to break out of the swatch's style attribute", () => {
    /*
     * The builder drops anything that is not a hex colour before it reaches
     * here; this is the second line of defence in the template itself.
     */
    const html: string = render(ACKNOWLEDGE_VIEW, {
      ...ACKNOWLEDGE_BASE,
      resourceNumber: "",
      resourceTitle: "Alert",
      resourceDescription: "",
      details: [
        {
          label: "Severity",
          value: "Critical",
          color: '#fff" onmouseover="alert(1)',
        },
      ],
    });

    expect(html).not.toContain('onmouseover="alert(1)"');
    expect(html).toContain("&#34;");
  });
});

describe("the already-acknowledged page", () => {
  test("shows the same context so a second visit is not a blank page", () => {
    const html: string = render(VIEW_MESSAGE_VIEW, {
      title: "Notification Already Acknowledged - CPU above 90% on prod-web-1",
      message: "This notification has already been acknowledged.",
      viewDetailsText: "View Alert",
      viewDetailsUrl: "https://oneuptime.example.com/dashboard/1/alerts/2",
      ...ALERT_CONTEXT,
    });

    expect(html).toContain("Critical");
    expect(html).toContain("Acme Production");
    expect(html).toContain("prod-web-1 CPU");
    expect(html).toContain("View Alert");
    expect(html).toContain(
      'href="https://oneuptime.example.com/dashboard/1/alerts/2"',
    );
  });

  test("still renders with only the locals it always took", () => {
    const html: string = render(VIEW_MESSAGE_VIEW, {
      title: "Notification Already Acknowledged",
      message: "This notification has already been acknowledged.",
      viewDetailsText: "View Incident",
      viewDetailsUrl: "https://oneuptime.example.com/dashboard/1/incidents/2",
    });

    expect(html).toContain("View Incident");
    expect(html).not.toContain("<dl");
  });
});

describe("every resource type reaches the page intact", () => {
  /*
   * The issue was filed about an alert. The same page is what an incident, an
   * alert episode and an incident episode all page people through, and each
   * one carries a different set of rows.
   */
  const CASES: Array<{
    label: string;
    variables: Record<string, unknown>;
    expected: Array<string>;
  }> = [
    {
      label: "Alert",
      variables: {
        title: "Acknowledge Alert - CPU above 90%",
        message: "Do you want to acknowledge this Alert?",
        acknowledgeText: "Acknowledge Alert",
        acknowledgeUrl: "https://oneuptime.example.com/api/ack/1",
        resourceNumber: "ALT-42",
        resourceTitle: "CPU above 90%",
        resourceDescription: "",
        details: [
          { label: "Severity", value: "Critical", color: "#dc2626" },
          { label: "Monitor", value: "prod-web-1 CPU", color: "" },
        ],
      },
      expected: ["Acknowledge Alert", "ALT-42", "Critical", "prod-web-1 CPU"],
    },
    {
      label: "Incident",
      variables: {
        title: "Acknowledge Incident - Checkout is down",
        message: "Do you want to acknowledge this Incident?",
        acknowledgeText: "Acknowledge Incident",
        acknowledgeUrl: "https://oneuptime.example.com/api/ack/2",
        resourceNumber: "INC-7",
        resourceTitle: "Checkout is down",
        resourceDescription: "Customers cannot complete payment.",
        details: [
          { label: "Severity", value: "SEV1", color: "#b91c1c" },
          { label: "Monitors", value: "Checkout API", color: "" },
          {
            label: "Declared At",
            value: "Jan 15, 2026, 9:30 AM UTC",
            color: "",
          },
        ],
      },
      expected: [
        "Acknowledge Incident",
        "INC-7",
        "SEV1",
        "Checkout API",
        "Declared At",
        "Customers cannot complete payment.",
      ],
    },
    {
      label: "Alert Episode",
      variables: {
        title: "Acknowledge Alert Episode - Elevated error rate",
        message: "Do you want to acknowledge this Alert Episode?",
        acknowledgeText: "Acknowledge Alert Episode",
        acknowledgeUrl: "https://oneuptime.example.com/api/ack/3",
        resourceNumber: "AEP-3",
        resourceTitle: "Elevated error rate",
        resourceDescription: "",
        details: [
          { label: "Severity", value: "High", color: "#ea580c" },
          { label: "Alerts In Episode", value: "5", color: "" },
        ],
      },
      expected: [
        "Acknowledge Alert Episode",
        "AEP-3",
        "Alerts In Episode",
        "Elevated error rate",
      ],
    },
    {
      label: "Incident Episode",
      variables: {
        title: "Acknowledge Incident Episode - Payments degradation",
        message: "Do you want to acknowledge this Incident Episode?",
        acknowledgeText: "Acknowledge Incident Episode",
        acknowledgeUrl: "https://oneuptime.example.com/api/ack/4",
        resourceNumber: "IEP-9",
        resourceTitle: "Payments degradation",
        resourceDescription: "",
        details: [
          { label: "Severity", value: "SEV2", color: "#d97706" },
          { label: "Incidents In Episode", value: "2", color: "" },
        ],
      },
      expected: [
        "Acknowledge Incident Episode",
        "IEP-9",
        "Incidents In Episode",
        "Payments degradation",
      ],
    },
  ];

  for (const testCase of CASES) {
    test(`renders a(n) ${testCase.label} notification`, () => {
      const html: string = render(ACKNOWLEDGE_VIEW, testCase.variables);

      for (const expected of testCase.expected) {
        expect([testCase.label, expected, html.includes(expected)]).toEqual([
          testCase.label,
          expected,
          true,
        ]);
      }
    });
  }
});
