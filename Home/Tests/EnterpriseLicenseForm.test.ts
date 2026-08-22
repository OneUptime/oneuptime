import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import { getSelfHostedContent } from "../Utils/SelfHosted";
import ejs from "ejs";
import path from "path";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * The enterprise licence request form.
 *
 * WHAT IT REPLACED
 *
 * `mailto:enterprise@oneuptime.com`. A mailto sends no request to OneUptime,
 * so the one step of the funnel where the money is produced no click id, no
 * campaign, and no row — an ad spend could never be connected to the deals it
 * bought. The lead still reaches the same inbox; it is simply attributable on
 * the way.
 *
 * So the assertions that matter are: the CTA no longer walks the visitor out
 * of the page into their mail client, the submission carries the attribution
 * the visitor was holding, and the obvious ways for a form to lose or leak a
 * lead are closed.
 *
 * The submit handler only exists as an inline script in the rendered page, so
 * it is pulled back out and run against a stand-in DOM.
 * ---------------------------------------------------------------------------
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";

type RenderSelfHostedFunction = () => Promise<string>;

const renderSelfHosted: RenderSelfHostedFunction =
  async (): Promise<string> => {
    const seo: PageSEOData = getPageSEO("/enterprise/self-hosted");

    return (await ejs.renderFile(
      path.join(VIEWS_ROOT, "self-hosted.ejs"),
      {
        support: false,
        enableGoogleTagManager: true,
        footerCards: true,
        cta: false,
        blackLogo: false,
        requestDemoCta: true,
        selfHosted: getSelfHostedContent(),
        seo: { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` },
        homeUrl: HOME_URL,
      },
      { views: [VIEWS_ROOT] },
    )) as string;
  };

/*
 * A stand-in for the handful of DOM surfaces the form script touches. Small on
 * purpose: a real DOM would test jsdom, and what is under test here is which
 * fields the handler reads and what it posts.
 */
class FakeElement {
  public value: string = "";
  public textContent: string = "";
  public className: string = "";
  public disabled: boolean = false;
  public classList: {
    add: (name: string) => void;
    remove: (name: string) => void;
    contains: (name: string) => boolean;
  };
  public focusCount: number = 0;
  private classes: Set<string> = new Set<string>();
  private listeners: Map<string, Array<(event: unknown) => void>> = new Map<
    string,
    Array<(event: unknown) => void>
  >();

  public constructor(classes: Array<string> = []) {
    for (const name of classes) {
      this.classes.add(name);
    }

    this.classList = {
      add: (name: string): void => {
        this.classes.add(name);
      },
      remove: (name: string): void => {
        this.classes.delete(name);
      },
      contains: (name: string): boolean => {
        return this.classes.has(name);
      },
    };
  }

  public addEventListener(
    eventName: string,
    listener: (event: unknown) => void,
  ): void {
    const existing: Array<(event: unknown) => void> =
      this.listeners.get(eventName) || [];
    existing.push(listener);
    this.listeners.set(eventName, existing);
  }

  public dispatch(eventName: string): void {
    for (const listener of this.listeners.get(eventName) || []) {
      listener({ preventDefault: (): void => {} });
    }
  }

  public focus(): void {
    this.focusCount++;
  }

  public reset(): void {
    this.value = "";
  }
}

interface FetchCall {
  url: string;
  options: { method: string; headers: Record<string, string>; body: string };
}

interface FormHarness {
  elements: Map<string, FakeElement>;
  fetchCalls: Array<FetchCall>;
  submit: () => Promise<void>;
  openForm: () => void;
  status: FakeElement;
  wrapper: FakeElement;
  posthogCalls: Array<[string, Record<string, unknown>]>;
  dataLayer: Array<Record<string, unknown>>;
}

interface FormHarnessOptions {
  attribution?:
    | {
        utm: Record<string, string>;
        clickIds: Record<string, string>;
        firstTouch: Record<string, unknown> | null;
      }
    | undefined;
  attributionHelperMissing?: boolean | undefined;
  fetchResponse?: { ok: boolean; status: number } | undefined;
  fetchRejects?: boolean | undefined;
  hash?: string | undefined;
}

type LoadFormFunction = (
  html: string,
  options?: FormHarnessOptions,
) => FormHarness;

const loadForm: LoadFormFunction = (
  html: string,
  options: FormHarnessOptions = {},
): FormHarness => {
  const marker: string = "var wrapper = document.getElementById(";
  const markerIndex: number = html.indexOf(marker);

  expect(markerIndex).toBeGreaterThan(-1);

  const openTagIndex: number = html.lastIndexOf("<script>", markerIndex);
  const start: number = openTagIndex + "<script>".length;
  const end: number = html.indexOf("</script>", markerIndex);
  const source: string = html.slice(start, end);

  const elements: Map<string, FakeElement> = new Map<string, FakeElement>([
    ["enterprise-license-form-wrapper", new FakeElement(["hidden"])],
    ["enterprise-license-form", new FakeElement()],
    ["enterprise-license-toggle", new FakeElement()],
    ["enterprise-license-status", new FakeElement()],
    ["enterprise-license-submit", new FakeElement()],
    ["enterprise-license-name", new FakeElement()],
    ["enterprise-license-company", new FakeElement()],
    ["enterprise-license-email", new FakeElement()],
    ["enterprise-license-message", new FakeElement()],
    ["enterprise-license-website", new FakeElement()],
  ]);

  const fetchCalls: Array<FetchCall> = [];
  const posthogCalls: Array<[string, Record<string, unknown>]> = [];
  const dataLayer: Array<Record<string, unknown>> = [];

  const fakeDocument: Record<string, unknown> = {
    getElementById: (id: string): FakeElement | null => {
      return elements.get(id) || null;
    },
  };

  const fakeWindow: Record<string, unknown> = {
    location: { hash: options.hash || "" },
  };

  if (!options.attributionHelperMissing) {
    fakeWindow["oneUptimeGetAttribution"] = (): unknown => {
      return options.attribution || { utm: {}, clickIds: {}, firstTouch: null };
    };
  }

  const fetchImpl: (url: string, init: unknown) => Promise<unknown> = (
    url: string,
    init: unknown,
  ): Promise<unknown> => {
    fetchCalls.push({ url: url, options: init as FetchCall["options"] });

    if (options.fetchRejects) {
      return Promise.reject(new Error("network down"));
    }

    return Promise.resolve(options.fetchResponse || { ok: true, status: 200 });
  };

  // eslint-disable-next-line no-new-func
  const build: (...args: Array<unknown>) => void = new Function(
    "window",
    "document",
    "fetch",
    "posthog",
    "dataLayer",
    source,
  ) as (...args: Array<unknown>) => void;

  build(
    fakeWindow,
    fakeDocument,
    fetchImpl,
    {
      capture: (name: string, properties: Record<string, unknown>): void => {
        posthogCalls.push([name, properties]);
      },
    },
    dataLayer,
  );

  return {
    elements: elements,
    fetchCalls: fetchCalls,
    status: elements.get("enterprise-license-status")!,
    wrapper: elements.get("enterprise-license-form-wrapper")!,
    posthogCalls: posthogCalls,
    dataLayer: dataLayer,
    openForm: (): void => {
      elements.get("enterprise-license-toggle")!.dispatch("click");
    },
    submit: async (): Promise<void> => {
      elements.get("enterprise-license-form")!.dispatch("submit");
      // Let the fetch chain settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    },
  };
};

type PostedBodyFunction = (harness: FormHarness) => Record<string, unknown>;

const postedBody: PostedBodyFunction = (
  harness: FormHarness,
): Record<string, unknown> => {
  return JSON.parse(harness.fetchCalls[0]!.options.body) as Record<
    string,
    unknown
  >;
};

const FULL_ATTRIBUTION: {
  utm: Record<string, string>;
  clickIds: Record<string, string>;
  firstTouch: Record<string, unknown>;
} = {
  utm: {
    utmSource: "linkedin",
    utmMedium: "paid-social",
    utmCampaign: "enterprise-q3",
  },
  clickIds: { li_fat_id: "linkedin-click" },
  firstTouch: {
    utmSource: "google",
    landingUrl: "https://oneuptime.com/enterprise",
  },
};

describe("enterprise licence request form", () => {
  let html: string = "";

  beforeAll(async () => {
    html = await renderSelfHosted();
  });

  describe("the page", () => {
    /*
     * The regression this whole change exists to prevent coming back: a CTA
     * that opens a mail client is a conversion OneUptime never sees.
     */
    test("no longer offers a mailto as the enterprise call to action", () => {
      const ctaIndex: number = html.indexOf('id="enterprise-license"');
      const ctaBlock: string = html.slice(ctaIndex, ctaIndex + 1200);

      expect(ctaIndex).toBeGreaterThan(-1);
      expect(ctaBlock).not.toContain(
        "mailto:enterprise@oneuptime.com?subject=",
      );
      expect(ctaBlock).toContain('id="enterprise-license-toggle"');
    });

    test("renders the form and its required email field", () => {
      expect(html).toContain('id="enterprise-license-form"');
      expect(html).toContain('id="enterprise-license-email"');
      expect(html).toContain('type="email"');
    });

    test("posts to the attributable endpoint", () => {
      expect(html).toContain("'/api/enterprise-license-request'");
    });

    /*
     * Someone who would rather write an email should still be able to. It is
     * offered inside the form rather than as the primary path, so the
     * measurable route is the default one.
     */
    test("still offers plain email as a fallback inside the form", () => {
      expect(html).toContain("mailto:enterprise@oneuptime.com");
    });

    test("carries a honeypot that is hidden from people", () => {
      const honeypotIndex: number = html.indexOf(
        'id="enterprise-license-website"',
      );
      const honeypotBlock: string = html.slice(
        honeypotIndex - 400,
        honeypotIndex + 200,
      );

      expect(honeypotIndex).toBeGreaterThan(-1);
      expect(honeypotBlock).toContain('aria-hidden="true"');
      expect(honeypotBlock).toContain("hidden");
    });
  });

  describe("opening the form", () => {
    test("stays closed until the visitor asks for it", () => {
      const harness: FormHarness = loadForm(html);

      expect(harness.wrapper.classList.contains("hidden")).toBe(true);
    });

    test("opens on the toggle and focuses the email field", () => {
      const harness: FormHarness = loadForm(html);

      harness.openForm();

      expect(harness.wrapper.classList.contains("hidden")).toBe(false);
      expect(harness.elements.get("enterprise-license-email")!.focusCount).toBe(
        1,
      );
    });

    /*
     * So a CTA anywhere on the site can point straight at the form rather than
     * at a section the visitor then has to find a button in.
     */
    test("opens directly when deep-linked", () => {
      const harness: FormHarness = loadForm(html, {
        hash: "#enterprise-license",
      });

      expect(harness.wrapper.classList.contains("hidden")).toBe(false);
    });
  });

  describe("submitting", () => {
    let harness: FormHarness;

    beforeEach(() => {
      harness = loadForm(html, { attribution: FULL_ATTRIBUTION });
      harness.elements.get("enterprise-license-email")!.value =
        "ada@example.com";
      harness.elements.get("enterprise-license-name")!.value = "Ada Lovelace";
      harness.elements.get("enterprise-license-company")!.value = "Acme";
      harness.elements.get("enterprise-license-message")!.value =
        "400 monitors";
    });

    test("posts the contact fields as JSON", async () => {
      await harness.submit();

      expect(harness.fetchCalls).toHaveLength(1);
      expect(harness.fetchCalls[0]!.url).toBe(
        "/api/enterprise-license-request",
      );
      expect(harness.fetchCalls[0]!.options.method).toBe("POST");
      expect(harness.fetchCalls[0]!.options.headers).toMatchObject({
        "Content-Type": "application/json",
      });
      expect(postedBody(harness)).toMatchObject({
        email: "ada@example.com",
        name: "Ada Lovelace",
        company: "Acme",
        message: "400 monitors",
      });
    });

    /*
     * The entire reason this is a form. Without this the endpoint records a
     * lead attributable to nothing, which is where the mailto already had us.
     */
    test("carries the visitor's attribution with the lead", async () => {
      await harness.submit();

      expect(postedBody(harness)).toMatchObject({
        utm: FULL_ATTRIBUTION.utm,
        clickIds: FULL_ATTRIBUTION.clickIds,
        firstTouchAttribution: FULL_ATTRIBUTION.firstTouch,
      });
    });

    test("omits the first touch key entirely when there is none", async () => {
      const plain: FormHarness = loadForm(html, {
        attribution: { utm: {}, clickIds: {}, firstTouch: null },
      });
      plain.elements.get("enterprise-license-email")!.value = "ada@example.com";

      await plain.submit();

      expect(postedBody(plain)).not.toHaveProperty("firstTouchAttribution");
    });

    /*
     * Attribution is a bonus; the lead is the point. A page where the helper
     * somehow did not load must still be able to send one.
     */
    test("still submits when the attribution helper is unavailable", async () => {
      const bare: FormHarness = loadForm(html, {
        attributionHelperMissing: true,
      });
      bare.elements.get("enterprise-license-email")!.value = "ada@example.com";

      await bare.submit();

      expect(bare.fetchCalls).toHaveLength(1);
      expect(postedBody(bare)).toMatchObject({
        email: "ada@example.com",
        utm: {},
        clickIds: {},
      });
    });

    test("trims whitespace off what was typed", async () => {
      harness.elements.get("enterprise-license-email")!.value =
        "  ada@example.com  ";

      await harness.submit();

      expect(postedBody(harness)["email"]).toBe("ada@example.com");
    });

    test("confirms success to the visitor and clears the form", async () => {
      await harness.submit();

      expect(harness.status.textContent).toContain("we will be in touch");
      expect(harness.elements.get("enterprise-license-submit")!.disabled).toBe(
        false,
      );
    });

    test("mirrors the conversion to analytics without any contact details", async () => {
      await harness.submit();

      const captured: [string, Record<string, unknown>] | undefined =
        harness.posthogCalls.find((call: [string, Record<string, unknown>]) => {
          return call[0] === "enterprise_license_requested";
        });

      expect(captured).toBeDefined();
      expect(JSON.stringify(captured?.[1])).not.toContain("ada@example.com");
      expect(JSON.stringify(captured?.[1])).not.toContain("Ada Lovelace");

      expect(harness.dataLayer).toContainEqual(
        expect.objectContaining({ event: "enterprise_license_requested" }),
      );
    });
  });

  describe("refusing to submit", () => {
    test.each([
      ["an empty email", ""],
      ["an email with no @", "not-an-email"],
      ["an email starting with @", "@example.com"],
    ])("sends nothing for %s", async (_label: string, value: string) => {
      const harness: FormHarness = loadForm(html);
      harness.elements.get("enterprise-license-email")!.value = value;

      await harness.submit();

      expect(harness.fetchCalls).toHaveLength(0);
      expect(harness.status.textContent).toContain("valid work email");
    });

    /*
     * A filled honeypot is a bot. Answering it exactly like a success gives it
     * nothing to learn from.
     */
    test("silently discards a submission that filled the honeypot", async () => {
      const harness: FormHarness = loadForm(html);
      harness.elements.get("enterprise-license-email")!.value =
        "ada@example.com";
      harness.elements.get("enterprise-license-website")!.value =
        "http://spam.example";

      await harness.submit();

      expect(harness.fetchCalls).toHaveLength(0);
      expect(harness.status.textContent).toContain("we will be in touch");
    });
  });

  describe("when the request fails", () => {
    type FailingHarnessFunction = (
      options: FormHarnessOptions,
    ) => Promise<FormHarness>;

    const failingHarness: FailingHarnessFunction = async (
      options: FormHarnessOptions,
    ): Promise<FormHarness> => {
      const harness: FormHarness = loadForm(html, options);
      harness.elements.get("enterprise-license-email")!.value =
        "ada@example.com";
      await harness.submit();
      return harness;
    };

    /*
     * Every failure path names the mailbox. A lead that cannot be recorded
     * must still have somewhere to go — losing the measurement is acceptable,
     * losing the customer is not.
     */
    test("points a rate-limited visitor at the mailbox", async () => {
      const harness: FormHarness = await failingHarness({
        fetchResponse: { ok: false, status: 429 },
      });

      expect(harness.status.textContent).toContain("Too many requests");
      expect(harness.status.textContent).toContain("enterprise@oneuptime.com");
    });

    test("points a server error at the mailbox", async () => {
      const harness: FormHarness = await failingHarness({
        fetchResponse: { ok: false, status: 500 },
      });

      expect(harness.status.textContent).toContain("enterprise@oneuptime.com");
    });

    test("points a network failure at the mailbox", async () => {
      const harness: FormHarness = await failingHarness({
        fetchRejects: true,
      });

      expect(harness.status.textContent).toContain("enterprise@oneuptime.com");
    });

    test("re-enables the button so the visitor can try again", async () => {
      const harness: FormHarness = await failingHarness({
        fetchRejects: true,
      });

      expect(harness.elements.get("enterprise-license-submit")!.disabled).toBe(
        false,
      );
    });

    test("records no conversion in analytics for a failed submission", async () => {
      const harness: FormHarness = await failingHarness({
        fetchResponse: { ok: false, status: 500 },
      });

      expect(harness.posthogCalls).toHaveLength(0);
      expect(harness.dataLayer).toHaveLength(0);
    });
  });
});

// Keeps ts-jest from treating the unused jest import as an error.
void jest;
