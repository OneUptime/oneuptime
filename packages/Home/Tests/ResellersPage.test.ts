import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import {
  Reseller,
  ResellersPageContent,
  getResellersPageContent,
} from "../Utils/Resellers";
import {
  RESELLER_INQUIRY_HONEYPOT_FIELD,
  RESELLER_INQUIRY_PATH,
  ResellerInquiryField,
  ResellerInquiryFieldOrder,
  ResellerInquiryFieldRule,
  ResellerInquiryFieldRules,
} from "../Utils/ResellerInquiry";
import { beforeAll, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import { JSDOM } from "jsdom";
import path from "path";

/*
 * THE RESELLERS PAGE, RENDERED.
 *
 * The real template with the locals Routes.ts hands it: what the page says
 * and links to, the resellers by region (and no region at all), the form's
 * fields as the server's rules have them, the hidden field only a program
 * fills in - and then the form's own script, run in jsdom against the page,
 * sending the form and showing what the server answers.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const HOME_URL: string = "https://oneuptime.com";
const INBOX: string = "partners@example.com";

type SEOForTemplate = PageSEOData & { fullCanonicalUrl: string };

function seoFor(pagePath: string): SEOForTemplate {
  const seo: PageSEOData = getPageSEO(pagePath);

  return { ...seo, fullCanonicalUrl: `${HOME_URL}${seo.canonicalPath}` };
}

async function renderPage(
  content: ResellersPageContent = getResellersPageContent({
    inquiryInbox: INBOX,
  }),
): Promise<string> {
  // Exactly the locals Routes.ts hands the page, plus homeUrl.
  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, "resellers.ejs"),
    {
      enableGoogleTagManager: false,
      seo: seoFor("/resellers"),
      resellers: content,
      homeUrl: HOME_URL,
    },
    { views: [VIEWS_ROOT] },
  )) as string;
}

function documentOf(html: string): Document {
  return new JSDOM(html).window.document;
}

function textOf(element: Element | null | undefined): string {
  return (element?.textContent || "").split(/\s+/).join(" ").trim();
}

function reseller(overrides: Partial<Reseller> = {}): Reseller {
  return {
    name: "Example Partner",
    country: "Japan",
    region: "Asia Pacific",
    websiteUrl: "https://www.example-partner.co.jp",
    summary: "Software reselling.",
    ...overrides,
  };
}

describe("the Resellers page", () => {
  let page: Document;

  beforeAll(async () => {
    page = documentOf(await renderPage());
  });

  test("writes the head from its SEO entry", () => {
    const seo: SEOForTemplate = seoFor("/resellers");

    expect(page.title).toBe(seo.title);
    expect(
      page.querySelector('meta[name="description"]')?.getAttribute("content"),
    ).toBe(seo.description);
    expect(
      page.querySelector('link[rel="canonical"]')?.getAttribute("href"),
    ).toBe(`${HOME_URL}/resellers`);
  });

  test("leads with one heading that says what the page is for", () => {
    const headings: Array<Element> = Array.from(page.querySelectorAll("h1"));

    expect(headings).toHaveLength(1);
    expect(textOf(headings[0])).toBe("Buy OneUptime from a partner near you");
  });

  test("offers the two things a visitor comes for, each pointing at its section", () => {
    const find: HTMLAnchorElement | null = page.querySelector(
      '#resellers-hero a[href="#resellers-list"]',
    );
    const become: HTMLAnchorElement | null = page.querySelector(
      '#resellers-hero a[href="#become-a-reseller"]',
    );

    expect(textOf(find)).toBe("Find a reseller");
    expect(textOf(become)).toBe("Become a reseller");
    expect(page.getElementById("resellers-list")).not.toBeNull();
    expect(page.getElementById("become-a-reseller")).not.toBeNull();
  });

  test("lists SLEXN under Asia Pacific", () => {
    const regions: Array<Element> = Array.from(
      page.querySelectorAll('[data-testid="reseller-region"]'),
    );
    const asiaPacific: Element | undefined = regions.find((region: Element) => {
      return textOf(region.querySelector("h3")) === "Asia Pacific";
    });

    expect(asiaPacific).toBeDefined();
    expect(asiaPacific!.id).toBe("region-asia-pacific");

    const names: Array<string> = Array.from(
      asiaPacific!.querySelectorAll(
        '[data-testid="reseller-card"] h4 > span:first-child',
      ),
    ).map(textOf);

    expect(names).toContain("SLEXN");
  });

  test("shows SLEXN's card: its names, where it is, what it does and its website", () => {
    const card: Element | undefined = Array.from(
      page.querySelectorAll('[data-testid="reseller-card"]'),
    ).find((element: Element) => {
      return textOf(element.querySelector("h4")).startsWith("SLEXN");
    });

    expect(card).toBeDefined();

    const localName: Element | null = card!.querySelector("h4 [lang]");

    expect(textOf(localName)).toBe("슬렉슨");
    expect(localName?.getAttribute("lang")).toBe("ko");
    expect(textOf(card!.querySelector("h4"))).toBe("SLEXN 슬렉슨");
    expect(card!.textContent).toContain("Seoul, South Korea");
    expect(card!.textContent).toContain("Software solutions and consulting.");

    const website: HTMLAnchorElement | null = card!.querySelector("a");

    expect(website?.getAttribute("href")).toBe("https://www.slexn.com");
    expect(website?.getAttribute("target")).toBe("_blank");
    expect((website?.getAttribute("rel") || "").split(" ").sort()).toEqual([
      "noopener",
      "noreferrer",
    ]);
    expect(textOf(website)).toBe(
      "slexn.com (opens SLEXN's website in a new tab)",
    );
    // A text card: no logo until SLEXN supplies one.
    expect(card!.querySelector("img")).toBeNull();
  });

  test("tells a visitor with no reseller in their country how to buy directly", () => {
    const buyDirect: Element | null = page.querySelector(
      '[data-testid="resellers-buy-direct"]',
    );

    expect(textOf(buyDirect)).toBe(
      "No reseller in your country yet? Buy directly from us: start for free or talk to our team.",
    );
    expect(
      Array.from(buyDirect!.querySelectorAll("a")).map(
        (link: HTMLAnchorElement) => {
          return link.getAttribute("href");
        },
      ),
    ).toEqual(["/accounts/register", "/enterprise/demo"]);
  });

  test("says how to buy directly after the resellers, so a phone reads the list first", () => {
    const buyDirect: Element | null = page.querySelector(
      '[data-testid="resellers-buy-direct"]',
    );
    const regions: Array<Element> = Array.from(
      page.querySelectorAll('[data-testid="reseller-region"]'),
    );
    const lastRegion: Element = regions[regions.length - 1]!;

    // In the list's own column, after its last region.
    expect(buyDirect?.parentElement).toBe(lastRegion.parentElement);
    expect(
      lastRegion.compareDocumentPosition(buyDirect!) &
        page.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The section's heading column says only what the section is.
    expect(
      textOf(page.getElementById("resellers-list-title")?.parentElement),
    ).toBe(
      "Our resellers Get in touch with a reseller to buy OneUptime in your country.",
    );
  });

  test("gives every reseller a row of its own, so a region never shows a hole", () => {
    for (const list of Array.from(
      page.querySelectorAll('[data-testid="reseller-region"] ul'),
    )) {
      expect(list.className).not.toContain("grid-cols");
      expect(list.className).toContain("space-y-4");
    }
  });

  test("shows no empty state while there are resellers", () => {
    expect(page.querySelector('[data-testid="resellers-empty"]')).toBeNull();
  });

  test("says who becoming a reseller is for, in three short points", () => {
    const section: Element | null = page.getElementById("become-a-reseller");

    expect(textOf(section?.querySelector("h2"))).toBe("Become a reseller");
    expect(
      Array.from(
        section!.querySelectorAll('[data-testid="reseller-points"] dt'),
      ).map(textOf),
    ).toEqual([
      "One platform to sell",
      "Cloud or self-hosted",
      "Terms that fit your market",
    ]);
  });

  test("names the configured inbox for people who would rather write", () => {
    const line: Element | null = page.querySelector(
      '[data-testid="reseller-inquiry-email"]',
    );

    expect(textOf(line)).toBe(`Prefer email? Write to ${INBOX}.`);
    expect(line?.querySelector("a")?.getAttribute("href")).toBe(
      `mailto:${INBOX}`,
    );
  });

  test("offers email after the form, so a phone reaches the form first", () => {
    const line: Element | null = page.querySelector(
      '[data-testid="reseller-inquiry-email"]',
    );
    const form: Element | null = page.getElementById("reseller-inquiry-form");
    const success: Element | null = page.getElementById(
      "reseller-inquiry-success",
    );

    expect(
      form!.compareDocumentPosition(line!) &
        page.defaultView!.Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Under the form's card, where it stays once the thanks replace the form.
    expect(line?.previousElementSibling?.contains(form)).toBe(true);
    expect(line?.previousElementSibling?.contains(success)).toBe(true);
    // And not beside the points, before the form.
    expect(
      page.querySelector('[data-testid="reseller-points"]')?.parentElement
        ?.textContent,
    ).not.toContain("Prefer email?");
  });
});

describe("the form", () => {
  let page: Document;
  let form: HTMLFormElement;

  beforeAll(async () => {
    page = documentOf(await renderPage());
    form = page.getElementById("reseller-inquiry-form") as HTMLFormElement;
  });

  test("posts to the inquiry route, which its script sends JSON to", () => {
    expect(form).not.toBeNull();
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe(RESELLER_INQUIRY_PATH);
    expect(form.getAttribute("data-endpoint")).toBe(RESELLER_INQUIRY_PATH);
    expect(
      page.getElementById(form.getAttribute("aria-labelledby") || "")
        ?.textContent,
    ).toBe("Tell us about your company");
  });

  test.each(
    ResellerInquiryFieldOrder.map((field: ResellerInquiryField) => {
      return [field];
    }),
  )(
    "asks for the %s with a label, as the server's rules have it",
    (field: ResellerInquiryField) => {
      const rule: ResellerInquiryFieldRule = ResellerInquiryFieldRules[field];
      const control: HTMLInputElement | HTMLTextAreaElement | null =
        form.querySelector(`[name="${field}"]`);

      expect(control).not.toBeNull();

      const label: HTMLLabelElement | null = form.querySelector(
        `label[for="${control!.id}"]`,
      );

      expect(label).not.toBeNull();
      expect(textOf(label)).toBe(
        rule.required ? rule.label : `${rule.label} Optional`,
      );
      expect(control!.hasAttribute("required")).toBe(rule.required);
      expect(control!.getAttribute("maxlength")).toBe(String(rule.maxLength));
      expect(control!.tagName).toBe(rule.multiline ? "TEXTAREA" : "INPUT");
    },
  );

  test.each(
    ResellerInquiryFieldOrder.map((field: ResellerInquiryField) => {
      return [field];
    }),
  )(
    "has a line under the %s for what to fix in it, empty and hidden",
    (field: ResellerInquiryField) => {
      const control: Element | null = form.querySelector(`[name="${field}"]`);
      const line: HTMLElement | null = page.getElementById(
        `reseller-inquiry-${field}-error`,
      );

      expect(line).not.toBeNull();
      expect(line!.hasAttribute("data-reseller-field-error")).toBe(true);
      expect(line!.hidden).toBe(true);
      expect(line!.textContent).toBe("");
      // Right under its field, in the field's own block.
      expect(line!.previousElementSibling).toBe(control);
    },
  );

  test("lets the browser help: the right input types and autofill", () => {
    const typeOf: (field: string) => string | null = (field: string) => {
      return form.querySelector(`[name="${field}"]`)!.getAttribute("type");
    };
    const autocompleteOf: (field: string) => string | null = (
      field: string,
    ) => {
      return form
        .querySelector(`[name="${field}"]`)!
        .getAttribute("autocomplete");
    };

    expect(typeOf("email")).toBe("email");
    expect(typeOf("website")).toBe("text");
    expect(
      form.querySelector('[name="website"]')!.getAttribute("inputmode"),
    ).toBe("url");
    expect(autocompleteOf("name")).toBe("name");
    expect(autocompleteOf("email")).toBe("email");
    expect(autocompleteOf("company")).toBe("organization");
    expect(autocompleteOf("website")).toBe("url");
  });

  test("hides a field from people, for programs to fill in", () => {
    const honeypot: HTMLInputElement | null = form.querySelector(
      `[name="${RESELLER_INQUIRY_HONEYPOT_FIELD}"]`,
    );

    expect(honeypot).not.toBeNull();
    expect(honeypot!.getAttribute("type")).toBe("text");
    expect(honeypot!.getAttribute("tabindex")).toBe("-1");
    expect(honeypot!.getAttribute("autocomplete")).toBe("off");
    expect(honeypot!.hasAttribute("required")).toBe(false);
    expect(honeypot!.value).toBe("");

    const wrapper: HTMLElement = honeypot!.parentElement as HTMLElement;

    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.style.position).toBe("absolute");
    expect(wrapper.style.left).toBe("-10000px");
    expect(wrapper.style.overflow).toBe("hidden");
    expect(textOf(form.querySelector(`label[for="${honeypot!.id}"]`))).toBe(
      "Leave this field empty",
    );
  });

  test("asks for nothing but the six fields and the hidden one", () => {
    const names: Array<string> = Array.from(
      form.querySelectorAll("input, textarea, select"),
    ).map((control: Element) => {
      return control.getAttribute("name") || "";
    });

    expect(names.sort()).toEqual(
      [...ResellerInquiryFieldOrder, RESELLER_INQUIRY_HONEYPOT_FIELD].sort(),
    );
  });

  test("sends with one button", () => {
    const buttons: Array<HTMLButtonElement> = Array.from(
      form.querySelectorAll("button"),
    );

    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.getAttribute("type")).toBe("submit");
    expect(textOf(buttons[0])).toBe("Send message");
  });

  test("says what the details are used for, and links the privacy policy", () => {
    const note: Element | undefined = Array.from(
      form.querySelectorAll("p"),
    ).find((paragraph: Element) => {
      return textOf(paragraph).startsWith("We use these details");
    });

    expect(textOf(note)).toBe(
      "We use these details only to reply to you. See our privacy policy.",
    );
    expect(note?.querySelector("a")?.getAttribute("href")).toBe(
      "/legal/privacy",
    );
  });

  test("has its error and success states ready, and hidden", () => {
    const error: HTMLElement | null = page.getElementById(
      "reseller-inquiry-error",
    );
    const success: HTMLElement | null = page.getElementById(
      "reseller-inquiry-success",
    );

    expect(error?.hidden).toBe(true);
    expect(error?.querySelector('[role="alert"]')).not.toBeNull();
    expect(error?.querySelector(`a[href="mailto:${INBOX}"]`)?.textContent).toBe(
      INBOX,
    );
    expect(success?.hidden).toBe(true);
    expect(textOf(success?.querySelector("h3"))).toBe(
      "Thanks, we got your message",
    );
  });

  test("tells a browser without scripts to email instead", () => {
    const noscript: Element | null = form.querySelector("noscript");

    expect(noscript?.textContent).toContain("This form needs JavaScript.");
    expect(noscript?.textContent).toContain(INBOX);
  });
});

describe("the resellers by region, drawn from other lists", () => {
  test("with no resellers at all, says so and still offers the form", async () => {
    const page: Document = documentOf(
      await renderPage(
        getResellersPageContent({ resellers: [], inquiryInbox: INBOX }),
      ),
    );

    const empty: Element | null = page.querySelector(
      '[data-testid="resellers-empty"]',
    );

    expect(textOf(empty)).toBe(
      "We are adding our first resellers Until then, buy directly from us: start for free or talk to our team.",
    );
    expect(
      Array.from(empty!.querySelectorAll("a")).map(
        (link: HTMLAnchorElement) => {
          return link.getAttribute("href");
        },
      ),
    ).toEqual(["/accounts/register", "/enterprise/demo"]);
    expect(
      page.querySelectorAll('[data-testid="reseller-region"]'),
    ).toHaveLength(0);
    expect(page.querySelectorAll('[data-testid="reseller-card"]')).toHaveLength(
      0,
    );
    expect(page.getElementById("reseller-inquiry-form")).not.toBeNull();
    // One note, not two saying the same thing.
    expect(
      page.querySelector('[data-testid="resellers-buy-direct"]'),
    ).toBeNull();
    expect(
      page.querySelectorAll('#resellers-list a[href="/accounts/register"]'),
    ).toHaveLength(1);
  });

  test("lists the regions that have resellers, in the page's order, and no other", async () => {
    const page: Document = documentOf(
      await renderPage(
        getResellersPageContent({
          inquiryInbox: INBOX,
          resellers: [
            reseller({
              name: "Nordic Partner",
              region: "Europe, Middle East and Africa",
              country: "Sweden",
            }),
            reseller({
              name: "Andes Partner",
              region: "Americas",
              country: "Chile",
            }),
          ],
        }),
      ),
    );

    expect(
      Array.from(page.querySelectorAll('[data-testid="reseller-region"]')).map(
        (region: Element) => {
          return [region.id, textOf(region.querySelector("h3"))];
        },
      ),
    ).toEqual([
      ["region-americas", "Americas"],
      [
        "region-europe-middle-east-and-africa",
        "Europe, Middle East and Africa",
      ],
    ]);
  });

  test("shows a reseller's logo once it has one", async () => {
    const page: Document = documentOf(
      await renderPage(
        getResellersPageContent({
          inquiryInbox: INBOX,
          resellers: [reseller({ logoPath: "/img/resellers/example.svg" })],
        }),
      ),
    );
    const logo: HTMLImageElement | null = page.querySelector(
      '[data-testid="reseller-card"] img',
    );

    expect(logo?.getAttribute("src")).toBe("/img/resellers/example.svg");
    expect(logo?.getAttribute("alt")).toBe("Example Partner logo");
  });

  test("shows a reseller without a city or a local name by its country alone", async () => {
    const page: Document = documentOf(
      await renderPage(
        getResellersPageContent({
          inquiryInbox: INBOX,
          resellers: [reseller()],
        }),
      ),
    );
    const card: Element | null = page.querySelector(
      '[data-testid="reseller-card"]',
    );

    expect(textOf(card?.querySelector("h4"))).toBe("Example Partner");
    expect(card?.querySelector("[lang]")).toBeNull();
    expect(card?.textContent).toContain("Japan");
  });

  test("writes every reseller's details as text", async () => {
    const hostile: string =
      '<script>window.hacked = 1</script><img src=x onerror="alert(1)">';
    const page: Document = documentOf(
      await renderPage(
        getResellersPageContent({
          inquiryInbox: INBOX,
          resellers: [
            reseller({
              name: hostile,
              localName: hostile,
              localNameLanguage: "ja",
              city: hostile,
              summary: hostile,
            }),
          ],
        }),
      ),
    );
    const card: Element | null = page.querySelector(
      '[data-testid="reseller-card"]',
    );

    expect(card?.querySelector("script")).toBeNull();
    expect(card?.querySelector("img")).toBeNull();
    expect(card?.textContent).toContain(hostile);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The form's script, in jsdom.
 * ---------------------------------------------------------------------------
 */

interface FetchCall {
  url: string;
  init: {
    method: string;
    credentials: string;
    headers: Record<string, string>;
    body: string;
  };
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

interface ScriptedPage {
  window: JSDOM["window"];
  document: Document;
  form: HTMLFormElement;
  calls: Array<FetchCall>;
  answer: (response: FakeResponse | Error) => void;
  field: (name: string) => HTMLInputElement | HTMLTextAreaElement;
  fill: (values?: Record<string, string>) => void;
  submit: () => void;
}

const FILLED: Record<string, string> = {
  name: "Jane Kim",
  email: "jane@acme.co.kr",
  company: "Acme Korea",
  website: "acme.co.kr",
  regions: "South Korea, Japan",
  message: "We resell DevOps tools.\nWe would like to add OneUptime.",
};

function jsonResponse(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status: status,
    json: (): Promise<unknown> => {
      return Promise.resolve(body);
    },
  };
}

// Lets the script's promise chain run to its end.
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 5; tick++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

let renderedPage: string = "";
let formScript: string = "";

async function scriptedPage(
  options: { withFetch?: boolean } = {},
): Promise<ScriptedPage> {
  if (!renderedPage) {
    renderedPage = await renderPage();
  }

  /*
   * The page's own scripts do not run (the nav's, analytics); the form's
   * script is run on its own, against the page, with fetch answered here.
   */
  const dom: JSDOM = new JSDOM(renderedPage, {
    runScripts: "outside-only",
    url: `${HOME_URL}/resellers`,
  });
  const document: Document = dom.window.document;

  if (!formScript) {
    formScript =
      Array.from(document.querySelectorAll("script"))
        .map((script: HTMLScriptElement) => {
          return script.textContent || "";
        })
        .find((text: string) => {
          return text.includes("reseller-inquiry-form");
        }) || "";
  }

  const calls: Array<FetchCall> = [];
  let pending: Array<(response: FakeResponse | Error) => void> = [];

  if (options.withFetch === false) {
    delete (dom.window as unknown as { fetch?: unknown }).fetch;
  } else {
    (dom.window as unknown as { fetch: unknown }).fetch = (
      url: string,
      init: FetchCall["init"],
    ): Promise<FakeResponse> => {
      calls.push({ url: url, init: init });

      return new Promise<FakeResponse>(
        (
          resolve: (response: FakeResponse) => void,
          reject: (error: Error) => void,
        ) => {
          pending.push((response: FakeResponse | Error) => {
            if (response instanceof Error) {
              reject(response);
            } else {
              resolve(response);
            }
          });
        },
      );
    };
  }

  dom.window.eval(formScript);

  const form: HTMLFormElement = document.getElementById(
    "reseller-inquiry-form",
  ) as HTMLFormElement;

  const field: (name: string) => HTMLInputElement | HTMLTextAreaElement = (
    name: string,
  ) => {
    return form.querySelector(`[name="${name}"]`) as
      | HTMLInputElement
      | HTMLTextAreaElement;
  };

  return {
    window: dom.window,
    document: document,
    form: form,
    calls: calls,
    answer: (response: FakeResponse | Error): void => {
      const waiting: Array<(response: FakeResponse | Error) => void> = pending;
      pending = [];

      for (const resolve of waiting) {
        resolve(response);
      }
    },
    field: field,
    fill: (values: Record<string, string> = FILLED): void => {
      for (const [name, value] of Object.entries(values)) {
        field(name).value = value;
      }
    },
    submit: (): void => {
      form.requestSubmit();
    },
  };
}

describe("the form's script", () => {
  test("is on the page", async () => {
    await scriptedPage();

    expect(formScript).toContain("reseller-inquiry-form");
  });

  test("sends the answers as JSON to the inquiry route, the hidden field among them", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();

    expect(page.calls).toHaveLength(1);
    expect(page.calls[0]!.url).toBe(RESELLER_INQUIRY_PATH);
    expect(page.calls[0]!.init.method).toBe("POST");
    expect(page.calls[0]!.init.credentials).toBe("same-origin");
    expect(page.calls[0]!.init.headers).toEqual({
      "Content-Type": "application/json",
      Accept: "application/json",
    });
    expect(JSON.parse(page.calls[0]!.init.body)).toEqual({
      ...FILLED,
      [RESELLER_INQUIRY_HONEYPOT_FIELD]: "",
    });
  });

  test("sends what a program typed into the hidden field, for the server to see", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill({ ...FILLED, [RESELLER_INQUIRY_HONEYPOT_FIELD]: "Mornings" });
    page.submit();

    expect(
      JSON.parse(page.calls[0]!.init.body)[RESELLER_INQUIRY_HONEYPOT_FIELD],
    ).toBe("Mornings");
  });

  test("leaves a form with a required field empty to the browser, and sends nothing", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill({ ...FILLED, company: "" });
    page.submit();

    expect(page.calls).toHaveLength(0);
  });

  test("shows it is sending, and sends once however often it is pressed", async () => {
    const page: ScriptedPage = await scriptedPage();
    const button: HTMLButtonElement = page.form.querySelector(
      "button",
    ) as HTMLButtonElement;

    page.fill();
    page.submit();
    page.form.dispatchEvent(
      new page.window.Event("submit", { cancelable: true }),
    );
    page.submit();

    expect(page.calls).toHaveLength(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.textContent).toBe("Sending…");
    expect(page.form.getAttribute("aria-busy")).toBe("true");

    page.answer(jsonResponse(502, { sent: false, message: "Try later." }));
    await settle();

    expect(button.hasAttribute("aria-disabled")).toBe(false);
    expect(button.textContent).toBe("Send message");
    expect(page.form.getAttribute("aria-busy")).toBe("false");

    // Ready to send again.
    page.submit();
    expect(page.calls).toHaveLength(2);
  });

  test("keeps the keyboard's place on the button while it sends", async () => {
    const page: ScriptedPage = await scriptedPage();
    const button: HTMLButtonElement = page.form.querySelector(
      "button",
    ) as HTMLButtonElement;

    page.fill();
    button.focus();
    page.submit();

    /*
     * A disabled button gives up the focus, and the keyboard's place on the
     * page with it; this one is only marked busy.
     */
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(page.document.activeElement).toBe(button);
    // Its look while busy comes from the mark, not from the disabled state.
    expect(button.className).toContain("aria-disabled:opacity-60");
    expect(
      button.className.split(" ").filter((name: string) => {
        return name.startsWith("disabled:");
      }),
    ).toEqual([]);
  });

  test("shows the thanks once the server has sent it, naming where the reply goes", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(jsonResponse(200, { sent: true, message: "Thanks." }));
    await settle();

    const success: HTMLElement = page.document.getElementById(
      "reseller-inquiry-success",
    ) as HTMLElement;

    expect(page.form.hidden).toBe(true);
    expect(success.hidden).toBe(false);
    expect(success.querySelector("[data-reseller-reply-to]")?.textContent).toBe(
      "jane@acme.co.kr",
    );
    expect(page.document.activeElement?.id).toBe(
      "reseller-inquiry-success-title",
    );
  });

  test("writes the reply address as text, whatever it holds", async () => {
    const page: ScriptedPage = await scriptedPage();
    const address: string = "<b>jane</b>@acme.com";

    page.fill({ ...FILLED, email: address });
    // Straight to the script: the browser's own check would stop this address.
    page.form.dispatchEvent(
      new page.window.Event("submit", { cancelable: true }),
    );
    page.answer(jsonResponse(200, { sent: true, message: "Thanks." }));
    await settle();

    const replyTo: Element | null = page.document.querySelector(
      "[data-reseller-reply-to]",
    );

    expect(replyTo?.textContent).toBe(address);
    expect(replyTo?.children).toHaveLength(0);
  });

  // The line under a field for what to fix in it.
  const fieldLine: (page: ScriptedPage, field: string) => HTMLElement = (
    page: ScriptedPage,
    field: string,
  ): HTMLElement => {
    return page.document.getElementById(
      `reseller-inquiry-${field}-error`,
    ) as HTMLElement;
  };

  test("says what to fix right under the field the server names, and moves there", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(
      jsonResponse(400, {
        sent: false,
        message: "Please enter a valid email address, like name@company.com.",
        field: "email",
      }),
    );
    await settle();

    const error: HTMLElement = page.document.getElementById(
      "reseller-inquiry-error",
    ) as HTMLElement;
    const email: HTMLInputElement = page.field("email") as HTMLInputElement;
    const line: HTMLElement = fieldLine(page, "email");

    expect(line.hidden).toBe(false);
    expect(line.textContent).toBe(
      "Please enter a valid email address, like name@company.com.",
    );
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toBe(
      "reseller-inquiry-email-error",
    );
    expect(page.document.activeElement).toBe(email);
    // The box above the button is for what is not about one field.
    expect(error.hidden).toBe(true);
    // Every other field is left as it was.
    for (const field of ResellerInquiryFieldOrder) {
      if (field !== "email") {
        expect(fieldLine(page, field).hidden).toBe(true);
        expect(page.field(field).hasAttribute("aria-invalid")).toBe(false);
      }
    }
    expect(page.form.hidden).toBe(false);
    expect(
      (page.document.getElementById("reseller-inquiry-success") as HTMLElement)
        .hidden,
    ).toBe(true);
  });

  test("stops marking the field once it is being fixed", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(
      jsonResponse(400, { sent: false, message: "Fix it.", field: "email" }),
    );
    await settle();

    const email: HTMLInputElement = page.field("email") as HTMLInputElement;
    const line: HTMLElement = fieldLine(page, "email");

    // Typing somewhere else leaves the mark alone.
    page
      .field("name")
      .dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(line.hidden).toBe(false);

    email.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(email.hasAttribute("aria-invalid")).toBe(false);
    expect(email.hasAttribute("aria-describedby")).toBe(false);
    expect(line.hidden).toBe(true);
    expect(line.textContent).toBe("");
  });

  test("moves the mark when the next answer names another field", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(
      jsonResponse(400, { sent: false, message: "Fix it.", field: "email" }),
    );
    await settle();
    page.submit();
    page.answer(
      jsonResponse(400, {
        sent: false,
        message: "And this.",
        field: "company",
      }),
    );
    await settle();

    expect(page.field("email").hasAttribute("aria-invalid")).toBe(false);
    expect(fieldLine(page, "email").hidden).toBe(true);
    expect(page.field("company").getAttribute("aria-invalid")).toBe("true");
    expect(fieldLine(page, "company").textContent).toBe("And this.");
    expect(page.document.activeElement).toBe(page.field("company"));
  });

  test("hides the last error while it sends again", async () => {
    const page: ScriptedPage = await scriptedPage();
    const error: HTMLElement = page.document.getElementById(
      "reseller-inquiry-error",
    ) as HTMLElement;

    page.fill();
    page.submit();
    page.answer(jsonResponse(502, { sent: false, message: "Try later." }));
    await settle();
    expect(error.hidden).toBe(false);

    page.submit();
    expect(error.hidden).toBe(true);
  });

  test("clears what to fix in a field while it sends again", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(
      jsonResponse(400, { sent: false, message: "Fix it.", field: "website" }),
    );
    await settle();
    expect(fieldLine(page, "website").hidden).toBe(false);

    page.submit();
    expect(fieldLine(page, "website").hidden).toBe(true);
    expect(page.field("website").hasAttribute("aria-invalid")).toBe(false);
  });

  test("writes what to fix in a field as text, whatever it holds", async () => {
    const page: ScriptedPage = await scriptedPage();
    const message: string = '<img src=x onerror="window.hacked = 1">Bad';

    page.fill();
    page.submit();
    page.answer(jsonResponse(400, { sent: false, message, field: "name" }));
    await settle();

    const line: HTMLElement = fieldLine(page, "name");

    expect(line.textContent).toBe(message);
    expect(line.children).toHaveLength(0);
    expect(
      (page.window as unknown as { hacked?: number }).hacked,
    ).toBeUndefined();
  });

  test("shows the box above the button when a field is named with nothing to say about it", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(jsonResponse(400, { sent: false, field: "email" }));
    await settle();

    const error: HTMLElement = page.document.getElementById(
      "reseller-inquiry-error",
    ) as HTMLElement;

    expect(error.hidden).toBe(false);
    expect(
      error.querySelector("[data-reseller-error-message]")?.textContent,
    ).toBe(
      "We could not send your message just now. Please try again in a few minutes.",
    );
    expect(fieldLine(page, "email").hidden).toBe(true);
    expect(page.document.activeElement).toBe(error);
  });

  test("never shows a field's line for the hidden field only a program fills in", async () => {
    const page: ScriptedPage = await scriptedPage();

    page.fill();
    page.submit();
    page.answer(
      jsonResponse(400, {
        sent: false,
        message: "Fix it.",
        field: RESELLER_INQUIRY_HONEYPOT_FIELD,
      }),
    );
    await settle();

    expect(
      (page.document.getElementById("reseller-inquiry-error") as HTMLElement)
        .hidden,
    ).toBe(false);
    expect(
      page.form.querySelector(
        `[name="${RESELLER_INQUIRY_HONEYPOT_FIELD}"][aria-invalid]`,
      ),
    ).toBeNull();
    expect(
      page.document.querySelectorAll(
        "[data-reseller-field-error]:not([hidden])",
      ),
    ).toHaveLength(0);
  });

  test.each([
    [
      "a refusal with no field",
      jsonResponse(429, {
        sent: false,
        message:
          "You have sent several messages in a short time. Please try again later.",
      }),
    ],
    [
      "a failure to send",
      jsonResponse(502, {
        sent: false,
        message:
          "We could not send your message just now. Please try again in a few minutes.",
      }),
    ],
  ])(
    "shows %s and moves the focus to it",
    async (_case: string, response: FakeResponse) => {
      const page: ScriptedPage = await scriptedPage();

      page.fill();
      page.submit();
      page.answer(response);
      await settle();

      const error: HTMLElement = page.document.getElementById(
        "reseller-inquiry-error",
      ) as HTMLElement;

      expect(error.hidden).toBe(false);
      expect(
        error.querySelector("[data-reseller-error-message]")?.textContent,
      ).toBe(((await response.json()) as { message: string }).message);
      expect(page.document.activeElement).toBe(error);
      expect(page.form.querySelector("[aria-invalid]")).toBeNull();
    },
  );

  test.each([
    [
      "an answer that is not JSON",
      {
        ok: false,
        status: 502,
        json: (): Promise<unknown> => {
          return Promise.reject(new SyntaxError("Unexpected token <"));
        },
      } as FakeResponse,
    ],
    ["a 200 that does not say it was sent", jsonResponse(200, {})],
    [
      "an answer naming a field the form does not have",
      jsonResponse(400, { sent: false, field: "phone" }),
    ],
    [
      "an answer whose message is not text",
      jsonResponse(400, { sent: false, message: { text: "x" } }),
    ],
    ["the network failing", new Error("Failed to fetch")],
  ])(
    "shows the default error for %s",
    async (_case: string, response: FakeResponse | Error) => {
      const page: ScriptedPage = await scriptedPage();
      const defaultMessage: string =
        page.document.querySelector("[data-reseller-error-message]")
          ?.textContent || "";

      page.fill();
      page.submit();
      page.answer(response);
      await settle();

      const error: HTMLElement = page.document.getElementById(
        "reseller-inquiry-error",
      ) as HTMLElement;

      expect(defaultMessage).toBe(
        "We could not send your message just now. Please try again in a few minutes.",
      );
      expect(error.hidden).toBe(false);
      expect(
        error.querySelector("[data-reseller-error-message]")?.textContent,
      ).toBe(defaultMessage);
      expect(page.document.activeElement).toBe(error);
      expect(page.form.hidden).toBe(false);
      expect(
        (page.form.querySelector("button") as HTMLButtonElement).disabled,
      ).toBe(false);
    },
  );

  test("writes the server's message as text, whatever it holds", async () => {
    const page: ScriptedPage = await scriptedPage();
    const message: string = '<img src=x onerror="window.hacked = 1">Bad';

    page.fill();
    page.submit();
    page.answer(jsonResponse(400, { sent: false, message: message }));
    await settle();

    const shown: Element | null = page.document.querySelector(
      "[data-reseller-error-message]",
    );

    expect(shown?.textContent).toBe(message);
    expect(shown?.querySelector("img")).toBeNull();
    expect(
      (page.window as unknown as { hacked?: number }).hacked,
    ).toBeUndefined();
  });

  test("leaves the form to the browser where there is no fetch", async () => {
    const page: ScriptedPage = await scriptedPage({ withFetch: false });
    const event: Event = new page.window.Event("submit", { cancelable: true });

    page.fill();
    page.form.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The way to the page: the footer and the menus.
 * ---------------------------------------------------------------------------
 */

describe("the way to the Resellers page", () => {
  let nav: Document;
  let footer: Document;

  beforeAll(async () => {
    nav = documentOf(
      (await ejs.renderFile(
        path.join(VIEWS_ROOT, "nav.ejs"),
        { homeUrl: HOME_URL },
        { views: [VIEWS_ROOT] },
      )) as string,
    );
    footer = documentOf(
      (await ejs.renderFile(
        path.join(VIEWS_ROOT, "footer.ejs"),
        { footerCards: false, cta: false, homeUrl: HOME_URL },
        { views: [VIEWS_ROOT] },
      )) as string,
    );
  });

  function linksIn(container: ParentNode | null | undefined): Array<string> {
    return Array.from(container?.querySelectorAll("a") || []).map(
      (link: HTMLAnchorElement) => {
        return `${textOf(link)} ${link.getAttribute("href") || ""}`;
      },
    );
  }

  test("is in the footer's Company column, after About Us", () => {
    const company: Element | undefined = Array.from(
      footer.querySelectorAll("h3"),
    ).find((heading: Element) => {
      return textOf(heading) === "Company";
    });
    const links: Array<string> = linksIn(company?.nextElementSibling);

    expect(links.slice(0, 2)).toEqual([
      "About Us /about",
      "Resellers /resellers",
    ]);
    expect(footer.querySelectorAll('a[href="/resellers"]')).toHaveLength(1);
  });

  test("is in the Resources menu's Company group, after About Us", () => {
    const menu: Element | null = nav.getElementById("resources-menu");
    const company: Element | undefined = Array.from(
      menu?.querySelectorAll("p") || [],
    ).find((label: Element) => {
      return textOf(label) === "Company";
    });
    const links: Array<string> = linksIn(company?.nextElementSibling);

    expect(links).toEqual([
      "About Us /about",
      "Resellers /resellers",
      "Merch Store https://shop.oneuptime.com",
    ]);
  });

  test("is in the mobile menu's links, which now fill both columns evenly", () => {
    const mobile: Element | null = nav.getElementById("mobile-menu");
    const link: Element | null =
      mobile?.querySelector('a[href="/resellers"]') || null;

    expect(textOf(link)).toBe("Resellers");

    const grid: Element | null = link?.parentElement || null;
    const gridLinks: Array<string> = linksIn(grid);

    expect(grid?.className).toContain("grid-cols-2");
    expect(gridLinks).toContain("Pricing /pricing");
    expect(gridLinks[gridLinks.length - 1]).toBe("Resellers /resellers");
    // Two columns, no empty cell beside the last link.
    expect(gridLinks.length % 2).toBe(0);
  });

  test("is linked once in each menu, and nowhere in the top bar itself", () => {
    expect(
      nav.querySelectorAll('#resources-menu a[href="/resellers"]'),
    ).toHaveLength(1);
    expect(
      nav.querySelectorAll('#mobile-menu a[href="/resellers"]'),
    ).toHaveLength(1);
    expect(nav.querySelectorAll('a[href="/resellers"]')).toHaveLength(2);
  });
});
