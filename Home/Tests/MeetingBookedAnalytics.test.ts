import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import path from "path";

/*
 * ---------------------------------------------------------------------------
 * The browser half of meeting_booked.
 *
 * A booking is recorded server side, by the verified Cal webhook — these
 * events are analytics evidence of the same moment, and the pages must stay
 * honest about that in two ways:
 *
 *   - Cal's bookingSuccessful detail carries `data`, which holds the
 *     attendee's name and email. Both embeds used to forward the whole object
 *     to PostHog. Nothing derived from `e.detail.data` may reach any analytics
 *     destination.
 *   - the canonical event is named `meeting_booked` on every page that books a
 *     meeting, and the page-specific legacy event is still emitted so existing
 *     PostHog dashboards keep their history.
 *
 * These assertions read the rendered templates because that is the only place
 * the inline analytics scripts exist — there is no module to unit test.
 * ---------------------------------------------------------------------------
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

type RenderDemoFunction = (enableGoogleTagManager?: boolean) => Promise<string>;

const renderDemo: RenderDemoFunction = async (
  enableGoogleTagManager: boolean = true,
): Promise<string> => {
  return render("demo.ejs", {
    support: false,
    enableGoogleTagManager: enableGoogleTagManager,
    footerCards: false,
    cta: false,
    blackLogo: true,
    requestDemoCta: false,
    reviewsList1: [],
    reviewsList2: [],
    reviewsList3: [],
    seo: seoFor("/enterprise/demo"),
    homeUrl: HOME_URL,
  });
};

type RenderSupportFunction = (
  enableGoogleTagManager?: boolean,
) => Promise<string>;

const renderSupport: RenderSupportFunction = async (
  enableGoogleTagManager: boolean = true,
): Promise<string> => {
  return render("support.ejs", {
    enableGoogleTagManager: enableGoogleTagManager,
    seo: seoFor("/support"),
    homeUrl: HOME_URL,
  });
};

type FakeWindow = {
  location: { pathname: string };
  gtag?: ((...args: Array<unknown>) => void) | undefined;
  oneUptimeTrackMeetingBooked?: (options: Record<string, unknown>) => void;
};

type TrackerHarness = {
  track: (options: Record<string, unknown>) => void;
  posthogCalls: Array<[string, Record<string, unknown>]>;
  gtagCalls: Array<Array<unknown>>;
  dataLayer: Array<Record<string, unknown>>;
};

type LoadTrackerFunction = (
  html: string,
  options?: { withPostHog?: boolean; withGtag?: boolean },
) => TrackerHarness;

/*
 * The helper only exists as an inline script in the rendered page — there is
 * no module to import. Pull that script back out and run it against stand-in
 * analytics globals, so these tests assert what the browser would actually
 * send rather than what the source happens to say.
 */
const loadTracker: LoadTrackerFunction = (
  html: string,
  options: { withPostHog?: boolean; withGtag?: boolean } = {},
): TrackerHarness => {
  const start: number = html.indexOf(
    "window.oneUptimeTrackMeetingBooked = function",
  );
  const end: number = html.indexOf("</script>", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const source: string = html.slice(start, end);

  const posthogCalls: Array<[string, Record<string, unknown>]> = [];
  const gtagCalls: Array<Array<unknown>> = [];
  const dataLayer: Array<Record<string, unknown>> = [];

  const fakeWindow: FakeWindow = {
    location: { pathname: "/enterprise/demo" },
  };

  if (options.withGtag !== false) {
    fakeWindow.gtag = (...args: Array<unknown>): void => {
      gtagCalls.push(args);
    };
  }

  const posthog: unknown =
    options.withPostHog === false
      ? undefined
      : {
          capture: (
            name: string,
            properties: Record<string, unknown>,
          ): void => {
            posthogCalls.push([name, properties]);
          },
        };

  // eslint-disable-next-line no-new-func
  const build: (...args: Array<unknown>) => unknown = new Function(
    "window",
    "posthog",
    "dataLayer",
    `${source}\nreturn window.oneUptimeTrackMeetingBooked;`,
  ) as (...args: Array<unknown>) => unknown;

  const track: (options: Record<string, unknown>) => void = build(
    fakeWindow,
    posthog,
    dataLayer,
  ) as (options: Record<string, unknown>) => void;

  return {
    track: track,
    posthogCalls: posthogCalls,
    gtagCalls: gtagCalls,
    dataLayer: dataLayer,
  };
};

describe("meeting_booked analytics", () => {
  describe("the shared helper in head-basic.ejs", () => {
    let html: string = "";

    beforeAll(async () => {
      html = await renderDemo();
    });

    test("is defined on every page that includes the head partial", () => {
      expect(html).toContain("window.oneUptimeTrackMeetingBooked = function");
    });

    test("captures the canonical event with non-identifying properties", () => {
      const harness: TrackerHarness = loadTracker(html);

      harness.track({
        bookingKind: "enterprise_demo",
        calEventType: "bookingSuccessful",
        calNamespace: "default",
      });

      expect(harness.posthogCalls[0]).toEqual([
        "meeting_booked",
        {
          event_schema_version: 1,
          booking_source: "cal.com",
          booking_kind: "enterprise_demo",
          page_path: "/enterprise/demo",
          cal_event_type: "bookingSuccessful",
          cal_namespace: "default",
        },
      ]);
    });

    test("mirrors the same event to GA4 and the GTM dataLayer", () => {
      const harness: TrackerHarness = loadTracker(html);

      harness.track({ bookingKind: "enterprise_demo" });

      expect(harness.gtagCalls[0]?.[0]).toBe("event");
      expect(harness.gtagCalls[0]?.[1]).toBe("meeting_booked");
      expect(harness.dataLayer[0]).toMatchObject({
        event: "meeting_booked",
        booking_kind: "enterprise_demo",
      });
    });

    test("also emits the caller's legacy event name", () => {
      const harness: TrackerHarness = loadTracker(html);

      harness.track({
        bookingKind: "enterprise_demo",
        legacyEventName: "home/demo-booked",
      });

      expect(
        harness.posthogCalls.map((call: [string, Record<string, unknown>]) => {
          return call[0];
        }),
      ).toEqual(["meeting_booked", "home/demo-booked"]);
    });

    test("emits only the canonical event when no legacy name is given", () => {
      const harness: TrackerHarness = loadTracker(html);

      harness.track({ bookingKind: "support_call" });

      expect(harness.posthogCalls).toHaveLength(1);
    });

    /*
     * The regression this file exists for: the embeds used to forward Cal's
     * whole `e.detail.data`, which holds the attendee's name and email. The
     * helper builds its own property bag, so nothing a caller passes beyond
     * the named options can reach an analytics destination.
     */
    test("ignores anything the caller passes beyond the named options", () => {
      const harness: TrackerHarness = loadTracker(html);

      harness.track({
        bookingKind: "enterprise_demo",
        data: { attendees: [{ email: "buyer@example.com", name: "A Person" }] },
        email: "buyer@example.com",
        notes: "We run 400 services on-prem",
      });

      const serialised: string = JSON.stringify([
        harness.posthogCalls,
        harness.gtagCalls,
        harness.dataLayer,
      ]);

      expect(serialised).not.toContain("buyer@example.com");
      expect(serialised).not.toContain("A Person");
      expect(serialised).not.toContain("400 services");
    });

    test("falls back to safe defaults for missing options", () => {
      const harness: TrackerHarness = loadTracker(html);

      harness.track({});

      expect(harness.posthogCalls[0]?.[1]).toMatchObject({
        booking_kind: "unknown",
        cal_event_type: "bookingSuccessful",
        cal_namespace: "default",
      });
    });

    /*
     * gtag is only defined inside the GTM block, so an unguarded call throws a
     * ReferenceError on a page rendered without it — losing the PostHog
     * capture. Analytics must never take the page down with it either way.
     */
    test("still reports to PostHog when GTM is absent", async () => {
      const withoutGtm: string = await renderDemo(false);
      const harness: TrackerHarness = loadTracker(withoutGtm, {
        withGtag: false,
      });

      expect(withoutGtm).not.toContain("<!-- Google Tag Manager -->");
      expect(() => {
        return harness.track({ bookingKind: "enterprise_demo" });
      }).not.toThrow();
      expect(harness.posthogCalls).toHaveLength(1);
      expect(harness.gtagCalls).toHaveLength(0);
    });

    test("still reports to GA4 when PostHog never loaded", () => {
      const harness: TrackerHarness = loadTracker(html, { withPostHog: false });

      expect(() => {
        return harness.track({ bookingKind: "enterprise_demo" });
      }).not.toThrow();
      expect(harness.gtagCalls).toHaveLength(1);
      expect(harness.dataLayer).toHaveLength(1);
    });
  });

  describe.each([
    ["demo.ejs", renderDemo, "enterprise_demo", "home/demo-booked"],
    ["support.ejs", renderSupport, "support_call", "home/support-call-booked"],
  ])(
    "%s",
    (
      _name: string,
      renderPage: () => Promise<string>,
      bookingKind: string,
      legacyEventName: string,
    ) => {
      let html: string = "";

      beforeAll(async () => {
        html = await renderPage();
      });

      test("still listens for a successful Cal booking", () => {
        expect(html).toContain('action: "bookingSuccessful"');
      });

      test("reports the booking through the shared helper", () => {
        expect(html).toContain("window.oneUptimeTrackMeetingBooked({");
        expect(html).toContain(`bookingKind: '${bookingKind}'`);
      });

      test("keeps emitting the legacy event so dashboards keep their history", () => {
        expect(html).toContain(`legacyEventName: '${legacyEventName}'`);
      });

      /*
       * The regression this file exists for: `const { data } = e.detail`
       * followed by `'data': data` in the PostHog payload shipped attendee
       * names and emails to a third party on every booking.
       */
      test("never destructures the attendee-bearing Cal payload", () => {
        expect(html).not.toContain("const { data, type, namespace }");
        expect(html).not.toContain("'data': data");
      });

      test("no longer captures the legacy event with a page/data blob", () => {
        expect(html).not.toContain(`posthog.capture('${legacyEventName}', {`);
      });
    },
  );
});
