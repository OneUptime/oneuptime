import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { describe, expect, test } from "@jest/globals";

const PARTIALS_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates/Partials",
);
const ACTION_URL: string =
  "https://account.example.com/action?item=123&view=full";
const STATUS_URL: string = "https://status.example.com";
const HOME_URL: string = "https://account.example.com";
const LOGO_URL: string = "https://assets.example.com/customer.png";
const CUSTOMER_NAME: string = "Acme & Partners — 東京";

/*
 * Use exactly the supplied context. Default fixture values would conceal the
 * missing-link and missing-branding branches exercised by these tests.
 */
function render(name: string, variables: Record<string, unknown> = {}): string {
  return Handlebars.compile(
    fs.readFileSync(Path.join(PARTIALS_DIR, `${name}.hbs`), "utf8"),
  )(variables);
}

describe("optional email navigation", () => {
  describe.each([
    ["ButtonBlock", "buttonUrl"],
    ["LinkBlock", "linkUrl"],
    ["UnsubscribeBlock", "unsubscribeUrl"],
  ])("%s", (partial: string, variable: string) => {
    test.each([undefined, null, ""])(
      "omits the entire navigation block when its destination is %s",
      (destination: unknown) => {
        expect(
          render(partial, {
            [variable]: destination,
            buttonText: "Review update",
            linkLabel: "Read the update",
          }).trim(),
        ).toBe("");
      },
    );
  });

  test.each([undefined, null, ""])(
    "owner preferences supply readable instructions without a URL (%s)",
    (notificationPreferencesUrl: unknown) => {
      const html: string = render("UnsubscribeOwnerEmail", {
        notificationPreferencesUrl,
      });

      expect(html).not.toMatch(/<a\b/i);
      expect(html).toContain(
        "OneUptime Dashboard &gt; More &gt; User Settings &gt; Notification Settings",
      );
    },
  );

  test.each([
    ["UnsubscribeBlock", "unsubscribeUrl", "Manage subscription"],
    [
      "UnsubscribeOwnerEmail",
      "notificationPreferencesUrl",
      "Manage notification preferences",
    ],
  ])(
    "%s uses a descriptive, underlined settings link",
    (partial: string, variable: string, label: string) => {
      const html: string = render(partial, { [variable]: ACTION_URL });
      const anchor: string = html.match(/<a\b[^>]*>[\s\S]*?<\/a>/i)?.[0] || "";

      expect(anchor).toContain(
        `href="${Handlebars.escapeExpression(ACTION_URL)}"`,
      );
      expect(anchor).toContain(`>${label}</a>`);
      expect(anchor).toMatch(/text-decoration:\s*underline/i);
    },
  );

  test.each([
    [
      undefined,
      undefined,
      "Or copy and paste this link into your browser:",
      ACTION_URL,
    ],
    ["Open the incident:", undefined, "Open the incident:", ACTION_URL],
    [
      "Open the incident:",
      "Incident 123",
      "Open the incident:",
      "Incident 123",
    ],
  ])(
    "fallback links support label %s and text %s independently",
    (
      linkLabel: string | undefined,
      linkText: string | undefined,
      label: string,
      text: string,
    ) => {
      const html: string = render("LinkBlock", {
        linkUrl: ACTION_URL,
        linkLabel,
        linkText,
      });

      expect(html).toContain(Handlebars.escapeExpression(label));
      expect(html).toContain(
        `href="${Handlebars.escapeExpression(ACTION_URL)}"`,
      );
      expect(html).toContain(`>${Handlebars.escapeExpression(text)}</a>`);
    },
  );
});

describe("brand identity with incomplete optional settings", () => {
  test.each([
    [{ homeURL: HOME_URL, homeUrl: STATUS_URL }, HOME_URL],
    [{ homeUrl: STATUS_URL }, STATUS_URL],
    [{}, undefined],
  ])(
    "OneUptime branding resolves its destination from %j",
    (variables: Record<string, unknown>, destination: string | undefined) => {
      const html: string = render("Logo", variables);

      expect(html).toContain('alt="OneUptime"');
      expect(html).toContain(">OneUptime</td>");
      if (destination) {
        expect(html.match(/<a\b/g)).toHaveLength(1);
        expect(html).toContain(`href="${destination}"`);
      } else {
        expect(html).not.toMatch(/<a\b/i);
      }
    },
  );

  describe.each([
    [{ homeURL: HOME_URL, statusPageUrl: STATUS_URL }, HOME_URL],
    [{ statusPageUrl: STATUS_URL }, STATUS_URL],
    [{}, undefined],
  ])(
    "customer branding with %j",
    (
      destinations: Record<string, unknown>,
      destination: string | undefined,
    ) => {
      test.each([LOGO_URL, undefined, ""])(
        "retains an accessible identity when logoUrl is %s",
        (logoUrl: string | undefined) => {
          const html: string = render("CustomLogo", {
            ...destinations,
            statusPageName: CUSTOMER_NAME,
            logoUrl,
          });

          if (logoUrl) {
            expect(html).toContain(`src="${LOGO_URL}"`);
            expect(html).toContain(
              `alt="${Handlebars.escapeExpression(CUSTOMER_NAME)}"`,
            );
          } else {
            expect(html).not.toMatch(/<img\b/i);
            expect(html).toContain(Handlebars.escapeExpression(CUSTOMER_NAME));
          }

          if (destination) {
            expect(html.match(/<a\b/g)).toHaveLength(1);
            expect(html.match(/<\/a>/g)).toHaveLength(1);
            expect(html).toContain(`href="${destination}"`);
          } else {
            expect(html).not.toMatch(/<a\b/i);
          }
        },
      );
    },
  );

  test("a missing customer name still supplies logo alt text", () => {
    expect(render("CustomLogo", { logoUrl: LOGO_URL })).toContain(
      'alt="Status page"',
    );
  });

  test("missing customer name and logo still identify the message", () => {
    const html: string = render("CustomLogo");

    expect(html).toContain("Status update");
    expect(html).not.toMatch(/<(?:a|img)\b/i);
  });
});

describe("independent rich-content slots", () => {
  test.each(["text", "blockText"])(
    "%s keeps paragraphs, lists and tables inside the detail value container",
    (slot: string) => {
      const content: string =
        "<p>Current progress</p><ul><li>Checking Tokyo</li></ul><table><tr><td>API</td><td>12 ms</td></tr></table>";
      const html: string = render("DetailBoxField", { [slot]: content });

      expect(html).toMatch(
        /<div\b[^>]*class="st-DetailCard-value st-Rich"[^>]*>/,
      );
      expect(html).toContain(`>${content}</div>`);
      expect(html).not.toMatch(/<p\b[^>]*>\s*<p>/i);
      expect(html).not.toContain("st-DetailCard-label");
    },
  );

  test("all three detail slots can coexist without dropping or duplicating content", () => {
    const html: string = render("DetailBoxField", {
      title: "Support & reliability",
      blockText: "<p>Investigating the API</p>",
      text: "12:30 UTC<br/>13:30 BST",
      plainText: "Latency < 25 ms & stable",
    });

    for (const value of [
      "Support &amp; reliability",
      "<p>Investigating the API</p>",
      "12:30 UTC<br/>13:30 BST",
      "Latency &lt; 25 ms &amp; stable",
    ]) {
      expect(html.split(value)).toHaveLength(2);
    }
  });

  test("a title-only field does not create empty value containers", () => {
    const html: string = render("DetailBoxField", { title: "Deployment" });

    expect(html).toContain("Deployment");
    expect(html).not.toContain("st-DetailCard-value");
  });

  test("plain and rich information can coexist", () => {
    const html: string = render("InfoBlock", {
      plainInfo: "Latency < 25 ms & stable",
      info: '<p>Read <a href="https://status.example.com/update">the update</a>.</p>',
    });

    expect(html).toContain("Latency &lt; 25 ms &amp; stable");
    expect(html).toContain(
      '<p>Read <a href="https://status.example.com/update">the update</a>.</p>',
    );
  });
});

describe.each([
  ["StateTransition", "previousState", "currentState", "STATE CHANGE"],
  ["StatusTransition", "previousStatus", "currentStatus", "STATUS CHANGE"],
])(
  "%s communicates a transition in words",
  (partial: string, previousKey: string, currentKey: string, label: string) => {
    test("keeps both labels in reading order even without status colors", () => {
      const html: string = render(partial, {
        [previousKey]: "Investigating & triaging",
        [currentKey]: "Resolved — 復旧済み",
      });

      expect(html).toContain(label);
      expect(html).toContain("Investigating &amp; triaging");
      expect(html).toContain("Resolved — 復旧済み");
      expect(html).toContain("→");
      expect(html.indexOf("Investigating &amp; triaging")).toBeLessThan(
        html.indexOf("→"),
      );
      expect(html.indexOf("→")).toBeLessThan(
        html.indexOf("Resolved — 復旧済み"),
      );
    });

    test.each([undefined, null, ""])(
      "omits the old-state column and arrow when the previous value is %s",
      (previous: unknown) => {
        const html: string = render(partial, {
          [previousKey]: previous,
          [currentKey]: "Operational",
        });

        expect(html).toContain("Operational");
        expect(html).not.toContain("→");
        expect(html.match(/class="st-Transition-cell"/g)).toHaveLength(1);
      },
    );
  },
);
