import { BASE_URL, IS_BILLING_ENABLED } from "../../Config";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Eight cards on the website's industries and solutions pages linked a
 * category's own docs address (/docs/compliance, /docs/rbac, /docs/api,
 * ...), which the docs answered with a 404. Deployed, each card's link is
 * followed here through the real routing to the page it now names. Home's
 * Tests/DocsLinks and App's Tests/FeatureSet/Docs/WebsiteDocsLinks hold
 * every website link into the docs; this is what a reader clicking one of
 * these gets. Like the other Home specs it runs only where the marketing
 * site is deployed (IS_BILLING_ENABLED).
 */

interface CardLink {
  page: string;
  label: string;
  href: string;
  // Where the link lands, through every redirect.
  landing: string;
}

const CARD_LINKS: Array<CardLink> = [
  {
    page: "/industries/government",
    label: "Compliance Docs",
    href: "/trust#certifications",
    landing: "/trust",
  },
  {
    page: "/industries/healthcare",
    label: "Compliance Docs",
    href: "/trust#certifications",
    landing: "/trust",
  },
  {
    page: "/industries/fintech",
    label: "Compliance Docs",
    href: "/trust#certifications",
    landing: "/trust",
  },
  {
    page: "/industries/ecommerce",
    label: "Monitor Payment Providers",
    href: "/docs/monitor/external-status-page-monitor",
    landing: "/docs/en/monitor/external-status-page-monitor",
  },
  {
    page: "/solutions/devops",
    label: "Terraform Provider",
    href: "/docs/terraform/index",
    landing: "/docs/en/terraform/index",
  },
  {
    page: "/solutions/platform",
    label: "RBAC Documentation",
    href: "/docs/permissions/index",
    landing: "/docs/en/permissions/index",
  },
  {
    page: "/solutions/developers",
    label: "API Documentation",
    href: "/docs/api-reference/api-reference",
    landing: "/docs/en/api-reference/api-reference",
  },
  {
    page: "/solutions/sre",
    label: "Incident Docs",
    href: "/docs/incidents/index",
    landing: "/docs/en/incidents/index",
  },
];

function urlFor(path: string): string {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
}

test.describe("Home: cards that link into the docs", () => {
  test("each opens the page it names, through the real routing", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return; // Home marketing site is only deployed in the SaaS stack.
    }

    page.setDefaultNavigationTimeout(120000);

    for (const card of CARD_LINKS) {
      await page.goto(urlFor(card.page));

      const link: Locator = page
        .locator("main a")
        .filter({ hasText: card.label });

      await expect(link, card.page).toHaveAttribute("href", card.href);

      // The anchor stays in the browser: the server is asked for the page.
      const response: APIResponse = await page.request.get(
        urlFor(card.href.split("#")[0] as string),
      );

      expect([card.page, response.status()]).toEqual([card.page, 200]);
      expect([card.page, new globalThis.URL(response.url()).pathname]).toEqual(
        [card.page, card.landing],
      );
    }
  });

  test("the compliance cards land on the trust center's certifications", async ({
    page,
  }: {
    page: Page;
  }) => {
    if (!IS_BILLING_ENABLED) {
      return;
    }

    page.setDefaultNavigationTimeout(120000);

    await page.goto(urlFor("/trust#certifications"));

    await expect(page.locator("#certifications h2")).toHaveText(
      "Certifications and attestations",
    );
  });
});
