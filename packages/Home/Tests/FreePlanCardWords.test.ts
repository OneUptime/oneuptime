import { PageSEOConfig } from "../Utils/PageSEO";
import { PricingPlan, PricingPlans } from "../Utils/Pricing";
import {
  Claim,
  RetiredClaim,
  RetiredClaims,
  RetiredPricingClaims,
  getClaim,
} from "../Utils/Claims";
import {
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
  formatPriceInUSD,
} from "Common/Types/Billing/PayAsYouGoPricing";
import fs from "fs";
import path from "path";

/*
 * WHERE "NO CREDIT CARD" STOPS, ON THE WEBSITE (#8422).
 *
 * On OneUptime Cloud's Free plan, every monitor but a Manual one is an
 * active monitor, billed as it is used, so the first website check asks for
 * a payment method. #8246 made the Dashboard say so ("No credit card
 * required to sign up."; "On the Free plan, checking a website needs a
 * payment method."), and the website still said the opposite: "Set up your
 * first monitor in under 2 minutes. No credit card required.", a free plan
 * "with no credit card required, including ... website and API monitoring".
 * A newcomer met the card at their first check.
 *
 * Now "no credit card" is said about signing up, or a paid plan's 14-day
 * trial, and where monitoring is offered the page says what needs a card.
 * The claims matrix (Utils/Claims.ts) holds the rule, and
 * ClaimsGovernance.test.ts scans every page and the page data for it.
 */

const HOME: string = path.join(__dirname, "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(HOME, relativePath), "utf8");
}

const rule: RetiredClaim = RetiredPricingClaims[0]!;

function isRetired(text: string): boolean {
  rule.pattern.lastIndex = 0;
  return rule.pattern.test(text);
}

const MONITOR_PRICE: string = formatPriceInUSD(
  ACTIVE_MONITOR_PRICE_IN_USD_PER_MONTH,
);

describe("the rule", () => {
  test("is a retired claim, scanned over every page, governed by the Free plan's claim", () => {
    expect(RetiredClaims).toContain(rule);
    expect(rule.claimId).toBe("discount-free-plan");
    expect(getClaim(rule.claimId)).not.toBeNull();
  });

  /*
   * What the site said before, word for word (the markup around it as the
   * templates had it). Each must still be caught, so none comes back.
   */
  test.each([
    [
      "the uptime monitoring page",
      "Set up your first monitor in under 2 minutes. No credit card required.",
    ],
    [
      "the home FAQ",
      "Yes. OneUptime Cloud has a free plan with no credit card required, including a status page with 100 subscribers, website and API monitoring, and basic incident management.",
    ],
    [
      "the home hero",
      '<p class="mt-5 text-[13px] text-gray-500">Free plan &middot; No credit card required &middot; Self-host anytime</p>',
    ],
    [
      "the Free plan's card",
      "For individuals and small projects. No credit card required.",
    ],
    ["the demo page", "No credit card required. Free tier available."],
    ["a comparison's button", "Start free — no credit card"],
    [
      "the pricing page's search result",
      "OneUptime pricing: start free with no credit card, paid plans from $22 per user per month, and telemetry at $0.10 per GB ingested. Compare every plan.",
    ],
    [
      "the closing call to action",
      "Create a free account, add your first monitor and invite your team. No credit card required.",
    ],
    [
      "the pricing comparison",
      "Join thousands of teams who have simplified their observability with OneUptime. Start free, no credit card required.",
    ],
    [
      "the pricing comparison's footnote",
      "Free forever plan available. No credit card required.",
    ],
    [
      "the product showcase",
      "No credit card required. Deploy on-premise or use our cloud.",
    ],
    [
      "the Cloud card",
      '<li class="flex gap-3"><svg aria-hidden="true"><path d="m4.5 12.75 6 6 9-13.5" /></svg>Free plan, no credit card required</li>',
    ],
    ["a comparison row", "Real capability without a credit card"],
    ["a card said short", "No card required."],
  ])("catches what %s said", (_where: string, text: string) => {
    expect(isRetired(text)).toBe(true);
  });

  test.each([
    ["the Accounts sign-up page", "No credit card required to sign up."],
    [
      "the pricing page",
      "Paid plans unlock additional features. Sign up free, no credit card required.",
    ],
    [
      "a trial",
      "No credit card required &middot; 14-day enterprise trial &middot; White-glove onboarding",
    ],
    ["a sign-up button", "Sign up free — no credit card"],
    ["signing up, put another way", "Signing up needs no credit card."],
    ["a sign-up with a hyphen", "Sign-up takes no credit card."],
    ["the replacement", rule.replacement],
    [
      "a page that says nothing of cards",
      "Set up your first monitor in under 2 minutes.",
    ],
    [
      "a card on a page, not a credit card",
      "Each monitor has a card on its page.",
    ],
  ])("lets %s through", (_what: string, text: string) => {
    expect(isRetired(text)).toBe(false);
  });

  test("reads one sentence at a time: sign-up in another sentence does not excuse it", () => {
    expect(
      isRetired("Sign up in seconds. Monitors run with no credit card."),
    ).toBe(true);
    expect(
      isRetired("Free plan &middot; Sign up free &middot; No credit card"),
    ).toBe(false);
  });
});

describe("the Free plan's claim", () => {
  const claim: Claim = getClaim("discount-free-plan")!;

  test("says signing up needs no card, and what does", () => {
    expect(claim.scope).toBe("cloud");
    expect(claim.category).toBe("discounts");
    expect(claim.statement).toContain("signing up needs no credit card");
    expect(claim.statement).toContain(
      `Active monitors are ${MONITOR_PRICE} each a month`,
    );
    expect(claim.sourceUrl).toBe("/pricing");
  });

  test("says what the Dashboard's Welcome page says", () => {
    const welcome: string = fs.readFileSync(
      path.join(
        HOME,
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Pages",
        "Onboarding",
        "Welcome.tsx",
      ),
      "utf8",
    );

    // "A project needs no card. On the Free plan, checking a website ..."
    const line: string | undefined = welcome.match(
      /WELCOME_CARD_LINE: string = translationKey\(\s*"([^"]+)"/,
    )?.[1];

    expect(line).toBeDefined();

    const freePlanSentence: string = line!
      .substring(line!.indexOf("On the Free plan"))
      .replace(/\.$/, "");

    expect(freePlanSentence).toBe(
      "On the Free plan, checking a website needs a payment method",
    );
    expect(claim.statement.toLowerCase()).toContain(
      freePlanSentence.toLowerCase(),
    );
  });

  test("is not itself caught by the rule", () => {
    expect(isRetired(claim.statement)).toBe(false);
  });
});

describe("where monitoring is offered, the page says what needs a card", () => {
  test("the uptime monitoring page's call to action", () => {
    const page: string = read("Views/solutions/uptime-monitoring.ejs");

    expect(page).toContain(
      `Sign up free, with no credit card, and set up your first monitor in under 2 minutes. Each active monitor is ${MONITOR_PRICE} a month and needs a payment method.`,
    );
    expect(page).not.toContain("2 minutes. No credit card required.");
  });

  test("the call to action at the foot of the pages", () => {
    expect(read("Views/cta.ejs")).toContain(
      `No credit card required to sign up; active monitors are ${MONITOR_PRICE} each a month and need a payment method.`,
    );
  });

  test("the home FAQ's free plan answer", () => {
    const faq: string = read("Views/Partials/home-faq.ejs");
    const answer: string | undefined = faq.match(
      /question: 'Is there really a free plan\?',\s*answer: '([^']+)'/,
    )?.[1];

    expect(answer).toBeDefined();
    expect(answer).toContain("signing up needs no credit card");
    expect(answer).toContain(
      "on the Free plan, checking a website needs a payment method",
    );
    expect(answer).toContain(`${MONITOR_PRICE} each a month`);
    // Website monitoring is no longer listed as included for nothing.
    expect(answer).not.toMatch(/including[^.]*website and API monitoring/);
  });

  test("the Free plan's card on the pricing page and in pricing.json", () => {
    const free: PricingPlan = PricingPlans.find((plan: PricingPlan) => {
      return plan.key === "free";
    })!;

    expect(free.description).toBe(
      "For individuals and small projects. No credit card required to sign up; active monitors and telemetry are billed as used and need a payment method.",
    );
    expect(isRetired(free.description)).toBe(false);
  });

  test("the pricing page's search result names the monitor price", () => {
    const description: string = PageSEOConfig["/pricing"]!.description;

    expect(description).toContain("sign up free with no card");
    expect(description).toContain(
      `active monitors at ${MONITOR_PRICE} a month`,
    );
    expect(description.length).toBeLessThanOrEqual(160);
  });

  test("the home hero and the Cloud card say the card is not needed to sign up", () => {
    expect(read("Views/Partials/home-hero.ejs")).toContain(
      "Free plan &middot; No credit card to sign up &middot; Self-host anytime",
    );
    expect(read("Views/Partials/home-own-it.ejs")).toContain(
      "Free plan, no credit card to sign up</li>",
    );
  });

  test("the comparison pages' buttons sign up, with no card", () => {
    for (const view of [
      "Views/compare-index.ejs",
      "Views/product-compare.ejs",
    ]) {
      const page: string = read(view);

      expect([view, page.includes("Sign up free — no credit card")]).toEqual([
        view,
        true,
      ]);
      expect([view, page.includes("Start free — no credit card")]).toEqual([
        view,
        false,
      ]);
    }
  });

  test("a paid plan's trial keeps its no-card line: it is true", () => {
    expect(read("Views/enterprise-overview.ejs")).toContain(
      "No credit card required &middot; 14-day enterprise trial",
    );
  });
});

describe("every price quoted beside a card is the monitor price OneUptime bills", () => {
  const files: Array<string> = [
    "Views/cta.ejs",
    "Views/solutions/uptime-monitoring.ejs",
    "Views/Partials/home-faq.ejs",
    "Utils/PageSEO.ts",
  ];

  const CARD: RegExp = /credit card|no card/i;
  const MONITOR: RegExp = /monitor/i;

  test.each(files)("%s", (file: string) => {
    const lines: Array<string> = read(file)
      .split("\n")
      .filter((line: string): boolean => {
        return CARD.test(line) && MONITOR.test(line);
      });

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      for (const match of line.matchAll(
        /\$(\d+(?:\.\d+)?)\s+(?:each\s+)?a\s+month/g,
      )) {
        expect(`$${match[1]}`).toBe(MONITOR_PRICE);
      }
    }
  });
});
