import { generatePricingMarkdown } from "../Utils/AIDiscovery";
import Pricing from "../Utils/Pricing";
import ejs from "ejs";
import path from "path";

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");

function textContent(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("Rendered notification pricing", () => {
  let html: string = "";
  let notifications: string = "";

  beforeAll(async () => {
    html = (await ejs.renderFile(
      path.join(VIEWS_ROOT, "pricing.ejs"),
      {
        pricing: Pricing,
        enableGoogleTagManager: false,
        homeUrl: "https://oneuptime.com",
      },
      { views: [VIEWS_ROOT] },
    )) as string;

    notifications =
      html.match(
        /<div\b[^>]*id="content-notifications"[\s\S]*?(?=<div\b[^>]*id="content-telemetry")/,
      )?.[0] || "";
  });

  test("the Notifications tab opens the matching pricing panel", () => {
    const tab: string =
      (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) || []).find(
        (button: string) => {
          return textContent(button) === "Notifications";
        },
      ) || "";

    expect(tab).toContain('id="tab-notifications"');
    expect(tab).toContain("switchPayAsYouGoTab('notifications')");
    expect(notifications).toMatch(/<h4\b[^>]*>Notifications<\/h4>/);
    expect(html).not.toContain("SMS & Call Alerts");
  });

  test("shows each paid channel with its billing unit", () => {
    const text: string = textContent(notifications);

    expect(text).toContain("SMS Pricing $0.10 per SMS sent");
    expect(text).toContain("Call Pricing $0.10 per minute per call");
    expect(text).toContain("WhatsApp Pricing $0.10 per message sent");
  });

  test("explicitly identifies every free notification channel", () => {
    const items: Array<string> = (
      notifications.match(/<li\b[^>]*>[\s\S]*?<\/li>/g) || []
    ).map(textContent);

    expect(items).toEqual(
      expect.arrayContaining([
        "Push notifications are free",
        "App alerts are free",
        "Email alerts are free",
        "Webhooks are free",
      ]),
    );
  });

  test.each([
    ["WhatsApp Alerts", "$0.10/message"],
    ["Push Notifications", "Free"],
    ["App Alerts", "Free"],
    ["Email Alerts", "Free"],
    ["Webhook Alerts", "Free"],
  ])(
    "%s keeps the same rate in comparison tables and pricing markdown",
    (name: string, rate: string) => {
      const rows: Array<string> = (
        html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) || []
      ).filter((row: string) => {
        return (
          textContent(row.match(/<th\b[^>]*>[\s\S]*?<\/th>/)?.[0] || "") ===
          name
        );
      });

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cells: Array<string> = (
          row.match(/<td\b[^>]*>[\s\S]*?<\/td>/g) || []
        ).map(textContent);

        expect(cells.length).toBeGreaterThan(0);
        for (const cell of cells) {
          expect(cell).toBe(rate);
        }
      }

      expect(generatePricingMarkdown("https://oneuptime.com")).toContain(
        `| ${name} | ${rate} | ${rate} | ${rate} | ${rate} |`,
      );
    },
  );
});
