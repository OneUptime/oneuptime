import { generatePricingMarkdown } from "../Utils/AIDiscovery";
import Pricing, {
  getWatchedTablePricingContent,
  WatchedTablePricingContent,
} from "../Utils/Pricing";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import { markupAsSpaces } from "../../Common/Tests/Helpers/HtmlText";
import {
  DEFAULT_WATCHED_TABLE_PRICING,
  getWatchedTablesCostInUSD,
  WatchedTablePricing,
} from "Common/Types/Billing/PayAsYouGoPricing";
import { beforeAll, describe, expect, jest, test } from "@jest/globals";
import ejs, { IncluderResult } from "ejs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

// The pricing page is long: rendering it and running it in jsdom takes time.
jest.setTimeout(60000);

/*
 * The pricing page's Data Observability panel and its calculator. Both come from
 * the rates the install bills at, so a price set in the Helm chart is the price
 * the page shows, and the calculator adds up what the bill adds up.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

function textContent(html: string): string {
  return markupAsSpaces(html).replace(/\s+/g, " ").trim();
}

function pageLocals(
  watchedTables: WatchedTablePricingContent,
): Record<string, unknown> {
  const seo: PageSEOData = getPageSEO("/pricing");

  return {
    pricing: Pricing,
    watchedTables,
    enableGoogleTagManager: false,
    seo: { ...seo, fullCanonicalUrl: `${HOME_URL}/pricing` },
    homeUrl: HOME_URL,
  };
}

async function openPage(rates: WatchedTablePricing): Promise<JSDOM> {
  const html: string = (await ejs.renderFile(
    path.join(VIEWS_ROOT, "pricing.ejs"),
    pageLocals(getWatchedTablePricingContent(rates)),
    {
      views: [VIEWS_ROOT],
      includer: (included: string): IncluderResult => {
        return { template: `<!-- ${included} -->` };
      },
    },
  )) as string;

  return new JSDOM(html, {
    url: `${HOME_URL}/pricing`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole(),
    beforeParse: (window: DOMWindow): void => {
      // The cookie banner's, from a partial left out.
      (window as unknown as { checkCookies: () => void }).checkCookies =
        (): void => {};
    },
  });
}

function calculate(
  dom: JSDOM,
  tableCount: number,
): { price: string; description: string } {
  const document: Document = dom.window.document;
  const range: HTMLInputElement = document.getElementById(
    "watched-tables-range",
  ) as HTMLInputElement;

  range.value = String(tableCount);
  range.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

  return {
    price:
      document.getElementById("total-watched-tables-price")?.textContent || "",
    description:
      document.getElementById("total-watched-tables-price-description")
        ?.textContent || "",
  };
}

describe("The rendered Data Observability pricing", () => {
  let dom: JSDOM;

  beforeAll(async () => {
    dom = await openPage(DEFAULT_WATCHED_TABLE_PRICING);
  });

  test("the tab opens the panel, with the rates and what is free", () => {
    const document: Document = dom.window.document;
    const panel: HTMLElement = document.getElementById(
      "content-data-observability",
    ) as HTMLElement;

    (document.getElementById("tab-data-observability") as HTMLElement).click();

    expect(panel.classList.contains("hidden")).toBe(false);
    expect(textContent(panel.outerHTML)).toContain(
      "First 100 tables free, then $1 per table a month, $0.25 above 1,000.",
    );
    expect(textContent(panel.outerHTML)).toContain("Views are free");
    expect(textContent(panel.outerHTML)).toContain(
      "A check with an alert is billed as an active monitor.",
    );
  });

  test.each([60, 100, 500, 1000, 5000])(
    "the calculator asks for %i tables what the bill would charge",
    (tableCount: number) => {
      const answer: { price: string; description: string } = calculate(
        dom,
        tableCount,
      );

      expect(answer.price).toBe(
        `$${getWatchedTablesCostInUSD(
          tableCount,
          DEFAULT_WATCHED_TABLE_PRICING,
        ).toLocaleString("en-US")}`,
      );
      expect(answer.description).toBe(
        `a month for ${tableCount.toLocaleString("en-US")} tables`,
      );
    },
  );

  test("the free plan says how many tables it watches free", () => {
    expect(textContent(dom.serialize())).toContain(
      "First 100 Watched Tables Free",
    );
  });

  test("the FAQ says how it is priced", () => {
    expect(textContent(dom.serialize())).toContain(
      "How is Data Observability priced?",
    );
  });

  test("an install's own rates are what the page says and adds up", async () => {
    const rates: WatchedTablePricing = {
      includedTables: 50,
      pricePerTableInUSD: 2,
      volumeThresholdInTables: 500,
      volumePricePerTableInUSD: 0.5,
    };
    const ownDom: JSDOM = await openPage(rates);

    expect(
      textContent(
        (
          ownDom.window.document.getElementById(
            "watched-tables-rates",
          ) as HTMLElement
        ).outerHTML,
      ),
    ).toBe("First 50 tables free, then $2 per table a month, $0.50 above 500.");
    expect(calculate(ownDom, 600).price).toBe("$950");
  });
});

describe("The machine-readable Data Observability pricing", () => {
  test("the markdown says the rates, and the matrix lists them", () => {
    const markdown: string = generatePricingMarkdown(HOME_URL);

    expect(markdown).toContain(
      "Data Observability: First 100 tables free, then $1 per table a month, $0.25 above 1,000. Views are free.",
    );
    expect(markdown).toContain("### Data Observability");
  });
});
