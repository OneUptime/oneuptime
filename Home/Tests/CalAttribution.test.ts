import ejs from "ejs";
import path from "path";

const PARTIAL_PATH: string = path.join(
  __dirname,
  "..",
  "Views",
  "Partials",
  "cal-attribution.ejs",
);

const ALL_ATTRIBUTION: Record<string, string> = {
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "enterprise-q3",
  utm_term: "observability",
  utm_content: "comparison-ad",
  utm_id: "campaign-123",
  utm_source_platform: "google_ads",
  utm_creative_format: "text",
  utm_marketing_tactic: "prospecting",
  gclid: "google-click",
  gbraid: "google-app-click",
  wbraid: "google-web-click",
};

type FakeLink = {
  href: string;
  getAttribute: (name: string) => string | null;
  setAttribute: (name: string, value: string) => void;
};

type Harness = {
  inlineOptions: Record<string, unknown>;
  links: Array<FakeLink>;
};

async function loadHarness(
  attribution: Record<string, string> = ALL_ATTRIBUTION,
): Promise<Harness> {
  const html: string = (await ejs.renderFile(PARTIAL_PATH, {})) as string;
  const source: string = html.slice(
    html.indexOf("(function ()"),
    html.lastIndexOf("</script>"),
  );
  const search: string = `?${new URLSearchParams(attribution).toString()}`;
  const links: Array<FakeLink> = [
    makeLink("/enterprise/demo"),
    makeLink("/enterprise/demo?utm_source=partner#book-demo"),
    makeLink("/pricing"),
    makeLink("https://example.com/enterprise/demo"),
  ];
  let onDomReady: (() => void) | null = null;
  const fakeWindow: Record<string, unknown> = {
    location: {
      href: `https://oneuptime.com/${search}`,
      origin: "https://oneuptime.com",
      search,
    },
  };
  const fakeDocument: Record<string, unknown> = {
    addEventListener: (name: string, callback: () => void): void => {
      if (name === "DOMContentLoaded") {
        onDomReady = callback;
      }
    },
    querySelectorAll: (): Array<FakeLink> => {
      return links;
    },
  };

  // eslint-disable-next-line no-new-func
  const install: (...args: Array<unknown>) => void = new Function(
    "window",
    "document",
    "URL",
    "URLSearchParams",
    source,
  ) as (...args: Array<unknown>) => void;
  install(fakeWindow, fakeDocument, URL, URLSearchParams);

  const calls: Array<Array<unknown>> = [];
  fakeWindow["Cal"] = function (...args: Array<unknown>): void {
    calls.push(args);
  };

  (fakeWindow["Cal"] as (...args: Array<unknown>) => void)("inline", {
    elementOrSelector: "#my-cal-inline",
    calLink: "oneuptimehq/demo",
    config: { theme: "light" },
  });
  const dispatchDomReady: (() => void) | null = onDomReady;
  if (dispatchDomReady) {
    dispatchDomReady();
  }

  return {
    inlineOptions: calls[0]?.[1] as Record<string, unknown>,
    links,
  };
}

function makeLink(href: string): FakeLink {
  return {
    href,
    getAttribute(name: string): string | null {
      return name === "href" ? this.href : null;
    },
    setAttribute(name: string, value: string): void {
      if (name === "href") {
        this.href = value;
      }
    },
  };
}

describe("Cal booking attribution", () => {
  test("passes every supported UTM and Google click id into Cal metadata", async () => {
    const harness: Harness = await loadHarness();
    const config: Record<string, string> = harness.inlineOptions[
      "config"
    ] as Record<string, string>;

    for (const [key, value] of Object.entries(ALL_ATTRIBUTION)) {
      expect(config[`metadata[${key}]`]).toBe(value);
    }
  });

  test("also uses Cal's first-class UTM config fields", async () => {
    const harness: Harness = await loadHarness();
    const config: Record<string, string> = harness.inlineOptions[
      "config"
    ] as Record<string, string>;

    for (const [key, value] of Object.entries(ALL_ATTRIBUTION)) {
      if (key.startsWith("utm_")) {
        expect(config[key]).toBe(value);
      }
    }
    expect(config["gclid"]).toBeUndefined();
    expect(config["theme"]).toBe("light");
  });

  test("preserves attribution on homepage links to the demo page", async () => {
    const harness: Harness = await loadHarness();
    const firstDestination: URL = new URL(
      harness.links[0]!.href,
      "https://oneuptime.com",
    );

    for (const [key, value] of Object.entries(ALL_ATTRIBUTION)) {
      expect(firstDestination.searchParams.get(key)).toBe(value);
    }
  });

  test("does not overwrite destination attribution or decorate unrelated links", async () => {
    const harness: Harness = await loadHarness();
    const attributedDestination: URL = new URL(
      harness.links[1]!.href,
      "https://oneuptime.com",
    );

    expect(attributedDestination.searchParams.get("utm_source")).toBe("partner");
    expect(attributedDestination.searchParams.get("gclid")).toBe("google-click");
    expect(attributedDestination.hash).toBe("#book-demo");
    expect(harness.links[2]!.href).toBe("/pricing");
    expect(harness.links[3]!.href).toBe(
      "https://example.com/enterprise/demo",
    );
  });

  test("does not add empty attribution values", async () => {
    const harness: Harness = await loadHarness({
      utm_source: "google",
      gclid: "",
    });
    const config: Record<string, string> = harness.inlineOptions[
      "config"
    ] as Record<string, string>;

    expect(config["metadata[utm_source]"]).toBe("google");
    expect(config["metadata[gclid]"]).toBeUndefined();
  });
});
