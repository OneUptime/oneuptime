import { getSelfHostedContent } from "../Utils/SelfHosted";
import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import fs from "fs";
import path from "path";

/*
 * Which conversation a booked meeting is, on the server-verified record.
 *
 * All three Cal embeds book the same event type (oneuptimehq/demo). The
 * browser event has carried booking_kind since the embeds were instrumented,
 * but the webhook — the signature-verified record, the one that survives ad
 * blockers and consent refusal, and the only one a receiver should count —
 * could not tell a free user's support call from a net-new enterprise demo.
 *
 * These assert the writing half: each embed hands Cal its own kind, in the
 * bracketed shape Cal actually accepts. The reading half is covered in
 * App/Tests/API/CalWebhook.test.ts.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

type RenderFunction = (
  templateFileName: string,
  locals: Record<string, unknown>,
) => Promise<string>;

const render: RenderFunction = async (
  templateFileName: string,
  locals: Record<string, unknown>,
): Promise<string> => {
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, templateFileName),
    locals,
    { views: [VIEWS_ROOT] },
  )) as string;
};

type SeoForFunction = (
  pagePath: string,
) => PageSEOData & { fullCanonicalUrl: string };

const seoFor: SeoForFunction = (
  pagePath: string,
): PageSEOData & { fullCanonicalUrl: string } => {
  const seo: PageSEOData = getPageSEO(pagePath);
  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
};

interface BookingPage {
  template: string;
  seoPath: string;
  bookingKind: string;
  extraLocals: Record<string, unknown>;
}

const BOOKING_PAGES: Array<BookingPage> = [
  {
    template: "demo.ejs",
    seoPath: "/enterprise/demo",
    bookingKind: "enterprise_demo",
    extraLocals: { reviewsList1: [], reviewsList2: [], reviewsList3: [] },
  },
  {
    template: "support.ejs",
    seoPath: "/support",
    bookingKind: "support_call",
    extraLocals: {},
  },
  {
    template: "self-hosted.ejs",
    seoPath: "/enterprise/self-hosted",
    bookingKind: "architecture_assessment",
    extraLocals: { selfHosted: getSelfHostedContent() },
  },
];

for (const page of BOOKING_PAGES) {
  describe(page.template, () => {
    let html: string = "";

    beforeAll(async () => {
      html = await render(page.template, {
        support: false,
        footerCards: true,
        enableGoogleTagManager: false,
        cta: false,
        blackLogo: false,
        requestDemoCta: false,
        seo: seoFor(page.seoPath),
        homeUrl: HOME_URL,
        ...page.extraLocals,
      });
    });

    test(`tells the embed it books a ${page.bookingKind}`, () => {
      expect(html).toContain(
        `window.oneUptimeCalAttributionMetadata('${page.bookingKind}')`,
      );
    });

    test("does not fall back to an untyped booking", () => {
      /*
       * A bare call still produces valid metadata, so this would fail silently
       * in production: bookings keep arriving, they just arrive as `unknown`.
       */
      expect(html).not.toContain("window.oneUptimeCalAttributionMetadata()");
    });

    test("the browser event and the embed agree on the kind", () => {
      /*
       * The two halves are written in different places on the page. If they
       * drift, the browser funnel and the webhook disagree about what the same
       * booking was, which is worse than either being wrong alone.
       */
      expect(html).toContain(`bookingKind: '${page.bookingKind}'`);
    });
  });
}

describe("the shared Cal metadata helper", () => {
  const partial: string = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "Common",
      "Server",
      "Views",
      "Partials",
      "AnalyticsConsent.ejs",
    ),
    "utf-8",
  );

  test("sends the kind under the key the webhook reads", () => {
    expect(partial).toContain("config['metadata[ou_booking_kind]']");
  });

  test("sends it bracketed, like every other Cal metadata key", () => {
    /*
     * Cal serialises each config value into a query parameter, so a nested
     * metadata object becomes "[object Object]" and every key inside it is
     * lost — silently.
     */
    expect(partial).not.toContain("config['ou_booking_kind']");
  });

  test("sends the kind even when there is no attribution to send", () => {
    /*
     * The attribution keys describe the visitor and are absent when there is
     * nothing to say. The booking kind describes the embed, which always knows
     * what it is, so it is written outside the attribution guards - a visitor
     * who refused attribution storage still books a demo that knows it is one.
     */
    const helperStart: number = partial.indexOf(
      "window.oneUptimeCalAttributionMetadata = function (bookingKind)",
    );
    const helperEnd: number = partial.indexOf("return config;", helperStart);

    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);

    const body: string = partial.slice(helperStart, helperEnd);

    // The kind is written with a plain `if (bookingKind)`, not via put().
    expect(body).toContain("if (bookingKind) {");
  });
});
