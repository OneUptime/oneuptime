import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * Consent and attribution have to behave the same on every origin that loads
 * the Google Tag Manager container.
 *
 * They did not. Consent Mode v2 and the attribution capture lived only in
 * Home/Views/head-basic.ejs, so the marketing site denied storage by default
 * and asked, while /accounts and /dashboard loaded the same container with no
 * consent signal and captured nothing. A visitor who pressed "Reject all" was
 * tracked anyway on the signup page — which is precisely where the conversion
 * fires — and an ad pointed at /accounts/register?gclid=... stored no click id,
 * so that signup could never be attributed to the campaign that bought it.
 *
 * These render each origin the way Express does and assert the invariants that
 * were being violated. They are deliberately about ORDER and SAMENESS: a
 * consent default that arrives after the container has read the dataLayer is
 * not a consent default, and three copies of the storage contract is how the
 * copies stop agreeing.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "..", "..", "..", "..");

const PARTIAL_PATH: string = path.join(
  REPOSITORY_ROOT,
  "Common",
  "Server",
  "Views",
  "Partials",
  "AnalyticsConsent.ejs",
);

interface Origin {
  label: string;
  viewPath: string;
}

/*
 * Every OneUptime-owned origin that loads GTM-PKQD5WH. Status pages and public
 * dashboards deliberately are not here: they render on customer-owned custom
 * domains, where the answer is to remove the tag rather than to ask the
 * customer's visitors for consent on OneUptime's behalf.
 */
const ORIGINS: Array<Origin> = [
  {
    label: "marketing site",
    viewPath: path.join(REPOSITORY_ROOT, "Home", "Views", "head-basic.ejs"),
  },
  {
    label: "accounts (signup)",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "Accounts",
      "views",
      "index.ejs",
    ),
  },
  {
    label: "dashboard",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "Dashboard",
      "views",
      "index.ejs",
    ),
  },
  {
    label: "admin dashboard",
    viewPath: path.join(
      REPOSITORY_ROOT,
      "App",
      "FeatureSet",
      "AdminDashboard",
      "views",
      "index.ejs",
    ),
  },
];

type RenderOriginFunction = (
  origin: Origin,
  enableGoogleTagManager: boolean,
) => string;

const renderOrigin: RenderOriginFunction = (
  origin: Origin,
  enableGoogleTagManager: boolean,
): string => {
  return ejs.render(
    fs.readFileSync(origin.viewPath, "utf-8"),
    { enableGoogleTagManager: enableGoogleTagManager },
    { filename: origin.viewPath },
  );
};

const GTM_SCRIPT: string = "googletagmanager.com/gtm.js";
const CONSENT_DEFAULT: string = "pushConsentSignal('default', true)";

describe("the shared analytics consent partial", () => {
  test("exists in Common, so every origin can reach it", () => {
    expect(fs.existsSync(PARTIAL_PATH)).toBe(true);
  });

  test("does not carry Home-only concerns", () => {
    const source: string = fs.readFileSync(PARTIAL_PATH, "utf-8");

    /*
     * The PostHog loader carries Home's own project key, and the home/-prefixed
     * event names are the marketing site's. Moving either here would start the
     * product reporting into Home's funnel. Reporting is handed back to the
     * page through window.oneUptimeOnAttributionCaptured instead.
     */
    expect(source).not.toContain("posthog.init(");
    // The prose may mention them; no code here may emit one.
    expect(source).not.toContain("capture('home/");
    expect(source).toContain("window.oneUptimeOnAttributionCaptured");
  });
});

for (const origin of ORIGINS) {
  describe(origin.label, () => {
    test("defines the consent state machine", () => {
      expect(renderOrigin(origin, true)).toContain(
        "window.oneUptimeConsent = (function",
      );
    });

    test("captures ad click identifiers", () => {
      const html: string = renderOrigin(origin, true);

      expect(html).toContain("window.oneUptimeGetAttribution");
      expect(html).toContain("gclid");
      expect(html).toContain("wbraid");
      expect(html).toContain("gbraid");
    });

    test("reads and writes the same consent storage key as every other origin", () => {
      /*
       * These origins share one hostname on OneUptime Cloud, so they share one
       * localStorage. A different key here would mean the banner answer given
       * on the marketing site simply did not apply in the product.
       */
      expect(renderOrigin(origin, true)).toContain("'cookiesAccepted'");
    });

    test("pushes the Consent Mode defaults before the container loads", () => {
      const html: string = renderOrigin(origin, true);

      const consentIndex: number = html.indexOf(CONSENT_DEFAULT);
      const containerIndex: number = html.indexOf(GTM_SCRIPT);

      expect(consentIndex).toBeGreaterThan(-1);
      expect(containerIndex).toBeGreaterThan(-1);

      /*
       * The whole point. Consent Mode defaults are only read once, when the
       * container boots; arriving afterwards is the same as never arriving.
       */
      expect(consentIndex).toBeLessThan(containerIndex);
    });

    /*
     * Granted by default, on every origin, without asking. This is the
     * deliberate posture (see the top of the partial); the assertion exists so
     * that reverting to a denied default has to be a decision rather than an
     * accident, and so that the four origins cannot drift apart on it.
     *
     * Note what this default asserts to Google: that consent WAS collected.
     * That is a claim about the visitor, not merely a choice about OneUptime's
     * own storage.
     */
    test("grants ad and analytics storage by default, without asking", () => {
      const html: string = renderOrigin(origin, true);

      expect(html).toContain("ad_storage");
      expect(html).toContain("ad_user_data");
      expect(html).toContain("ad_personalization");
      expect(html).toContain("analytics_storage");
      expect(html).toContain(CONSENT_DEFAULT);
      expect(html).not.toContain("pushConsentSignal('default', false)");
    });

    /*
     * And no update is pushed on either answer, so "Reject all" does not send
     * a denial. Without this, re-adding a single pushConsentSignal('update', …)
     * in set() would quietly re-gate the Google tag while every other test
     * here stayed green.
     */
    test("pushes no consent update when the banner is answered", () => {
      const html: string = renderOrigin(origin, true);

      expect(html).not.toContain("pushConsentSignal('update'");
    });

    test("loads no Google tag at all when analytics are switched off", () => {
      const html: string = renderOrigin(origin, false);

      expect(html).not.toContain(GTM_SCRIPT);
    });
  });
}

describe("consent can be withdrawn", () => {
  const bannerPath: string = path.join(
    REPOSITORY_ROOT,
    "Home",
    "Views",
    "cookie-banner.ejs",
  );
  const footerPath: string = path.join(
    REPOSITORY_ROOT,
    "Home",
    "Views",
    "footer.ejs",
  );
  const cookiePolicyPath: string = path.join(
    REPOSITORY_ROOT,
    "Home",
    "Views",
    "cookies.ejs",
  );

  test("the banner exposes a way to reopen itself", () => {
    expect(fs.readFileSync(bannerPath, "utf-8")).toContain(
      "window.oneUptimeShowCookieSettings",
    );
  });

  test("the footer carries the settings link the policy promises", () => {
    /*
     * The Cookie Policy has always told visitors to use "the cookie settings
     * link in the footer". There was no such link, so a decision could be made
     * once and never revisited - the most commonly enforced banner defect
     * there is.
     */
    const footer: string = fs.readFileSync(footerPath, "utf-8");

    expect(footer).toContain("Cookie settings");
    expect(footer).toContain("window.oneUptimeShowCookieSettings");
  });

  test("the cookie policy no longer denies using marketing cookies in the product", () => {
    /*
     * It said "We do not use marketing cookies inside the product" while the
     * product loaded the same container - and therefore the same advertising
     * tags - as the marketing site.
     */
    const policy: string = fs.readFileSync(cookiePolicyPath, "utf-8");

    expect(policy).not.toContain(
      "We do not use marketing cookies inside the product",
    );
    expect(policy).toContain(
      "the same analytics and advertising tags as the rest of the Website",
    );
  });

  /*
   * And it must not promise a choice the code stopped honouring.
   *
   * The policy used to say the product's tags were "governed by the same
   * consent choice" and that rejecting meant "they are not set in the product
   * either". Measurement is no longer gated on the banner, so both sentences
   * became false statements to visitors in a published policy — the kind of
   * defect that is invisible in code review because the code and the prose
   * live in different files.
   */
  test("the cookie policy does not promise a consent choice the code ignores", () => {
    const policy: string = fs.readFileSync(cookiePolicyPath, "utf-8");

    expect(policy).not.toContain("governed by the same consent choice");
    expect(policy).not.toContain("they are not set in the product either");
    expect(policy).toContain("regardless of the answer given on the cookie banner");
  });
});
