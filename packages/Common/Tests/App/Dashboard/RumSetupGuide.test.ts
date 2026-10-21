import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_RUM_CLIENT,
  RUM_BROWSER_PACKAGES,
  RUM_BROWSER_SETUP_DOCS_URL,
  RUM_CLIENTS,
  RUM_EXAMPLE_APP_NAMES,
  RUM_MOBILE_SETUP_DOCS_URL,
  RUM_TROUBLESHOOTING_DOCS_URL,
  RumClient,
  getRumBrowserInstallCommand,
  getRumBrowserTelemetryFile,
  getRumIngestionKeyType,
  getRumMobileResourceAttributes,
  getRumSetupGuide,
  resolveRumClient,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Rum/RumSetupGuide";
import {
  SETUP_GUIDE_API_KEY_PLACEHOLDER,
  SetupGuideContent,
  SetupGuideOption,
  SetupGuideStep,
  SetupGuideTopic,
  getSetupGuideCodeBlocks,
  getSetupGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SetupGuide/SetupGuide";
import TelemetryIngestionKeyType from "../../../Types/Telemetry/TelemetryIngestionKeyType";
import TelemetryIngestSurface, {
  BROWSER_ALLOWED_INGEST_SURFACES,
} from "../../../Types/Telemetry/TelemetryIngestSurface";

/*
 * The RUM guide asks what is being instrumented — a browser app or a mobile
 * one — and the answer decides the key before anything else: a browser page
 * can only ever be handed a Browser key, and a mobile app cannot use one at
 * all. These tests pin, for both:
 *
 *   - which key type the picker asks for;
 *   - the snippet the reader copies, with their URL and key in it;
 *   - the attributes that make OneUptime file the telemetry as RUM rather
 *     than as a backend Service, checked against the ingest code that decides;
 *   - every warning the old single-page guide carried;
 *   - that neither option shows the other's instructions.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../../..");
const DOCS_CONTENT: string = path.join(
  REPO_ROOT,
  "packages/App/FeatureSet/Docs/Content/en",
);

const URL: string = "https://oneuptime.example.com";
const KEY: string = "tik_secret_123";

const CLIENT_KEYS: Array<RumClient> = RUM_CLIENTS.map(
  (option: SetupGuideOption<RumClient>): RumClient => {
    return option.key;
  },
);

const guideFor: (
  client: RumClient,
  overrides?: { appName?: string; apiKey?: string },
) => SetupGuideContent = (
  client: RumClient,
  overrides?: { appName?: string; apiKey?: string },
): SetupGuideContent => {
  return getRumSetupGuide({
    oneuptimeUrl: URL,
    apiKey: overrides?.apiKey ?? KEY,
    client: client,
    appName: overrides?.appName,
  });
};

const topicTitles: (
  topics: Array<SetupGuideTopic> | undefined,
) => Array<string> = (
  topics: Array<SetupGuideTopic> | undefined,
): Array<string> => {
  return (topics || []).map((topic: SetupGuideTopic): string => {
    return topic.title;
  });
};

const topicNamed: (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
) => string = (
  topics: Array<SetupGuideTopic> | undefined,
  title: string,
): string => {
  const topic: SetupGuideTopic | undefined = (topics || []).find(
    (candidate: SetupGuideTopic): boolean => {
      return candidate.title === title;
    },
  );
  if (!topic) {
    throw new Error(`No topic titled "${title}"`);
  }
  return topic.markdown;
};

const stepsText: (guide: SetupGuideContent) => string = (
  guide: SetupGuideContent,
): string => {
  return guide.steps
    .map((step: SetupGuideStep): string => {
      return `${step.title}\n${step.description || ""}\n${step.markdown || ""}`;
    })
    .join("\n");
};

const docsPageExists: (url: string) => boolean = (url: string): boolean => {
  return fs.existsSync(
    path.join(DOCS_CONTENT, `${url.replace(/^\/docs\//, "")}.md`),
  );
};

const read: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
};

describe("the client picker", () => {
  test("offers Browser first, then Mobile", () => {
    expect(CLIENT_KEYS).toEqual(["browser", "mobile"]);
    expect(
      RUM_CLIENTS.map((option: SetupGuideOption<RumClient>): string => {
        return option.label;
      }),
    ).toEqual(["Browser", "Mobile (iOS / Android)"]);
    expect(DEFAULT_RUM_CLIENT).toBe("browser");
  });

  test("every option has a one-line description", () => {
    for (const option of RUM_CLIENTS) {
      expect((option.description || "").length).toBeGreaterThan(0);
      expect(option.description).not.toContain("\n");
    }
    expect(RUM_CLIENTS[0]!.description).toContain("OpenTelemetry Web");
  });

  test("an unknown or missing client resolves to Browser", () => {
    for (const value of [undefined, null, "", "desktop", "Mobile"]) {
      expect(resolveRumClient(value)).toBe("browser");
    }
    expect(resolveRumClient("mobile")).toBe("mobile");
  });

  test("a browser is handed a Browser key, a mobile app a Server key", () => {
    expect(getRumIngestionKeyType("browser")).toBe(
      TelemetryIngestionKeyType.Browser,
    );
    expect(getRumIngestionKeyType("mobile")).toBe(
      TelemetryIngestionKeyType.Server,
    );
  });
});

describe.each(CLIENT_KEYS)("the %s guide", (client: RumClient) => {
  const guide: SetupGuideContent = guideFor(client);
  const markdown: string = getSetupGuideMarkdown(guide);
  const steps: string = stepsText(guide);

  test("step 1 shows the OTLP endpoint and says which key to use", () => {
    expect(guide.keyStep?.endpointLabel).toBe("OTLP Endpoint");
    expect(guide.keyStep?.endpointValue).toBe(`${URL}/otlp`);
    expect(guide.keyStep?.description).toContain(
      client === "mobile" ? "Server key" : "Browser key",
    );
    // Rendered as plain text.
    expect(guide.keyStep?.description).not.toMatch(/[`*[\]]/);
  });

  test("ends by checking the key and looking for the app", () => {
    const verify: SetupGuideStep = guide.steps[guide.steps.length - 1]!;
    expect(verify.title).toMatch(/and verify$/);
    expect(verify.markdown).toContain(
      `curl -i ${URL}/otlp/v1/validate \\\n  -H "x-oneuptime-token: ${KEY}"`,
    );
    expect(verify.markdown).toContain('`200` with `"valid": true`');
    expect(verify.markdown).toContain("under **Real User Monitoring**");
  });

  test("every step has a one-sentence description", () => {
    for (const step of guide.steps) {
      expect((step.description || "").length).toBeGreaterThan(0);
      expect(step.description).not.toContain("\n");
    }
  });

  test("every command carries the reader's URL and key", () => {
    const withToken: Array<string> = getSetupGuideCodeBlocks(guide).filter(
      (block: string): boolean => {
        return block.includes("x-oneuptime-token");
      },
    );
    expect(withToken.length).toBeGreaterThanOrEqual(2);
    for (const block of withToken) {
      expect(block).toContain(KEY);
      expect(block).toContain(URL);
    }
    expect(markdown).not.toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
  });

  test("lists two to four prerequisites, one line each", () => {
    const prerequisites: Array<string> = guide.prerequisites || [];
    expect(prerequisites.length).toBeGreaterThanOrEqual(2);
    expect(prerequisites.length).toBeLessThanOrEqual(4);
    for (const line of prerequisites) {
      expect(line).not.toContain("\n");
    }
  });

  test("every Advanced topic has a plain one-line summary", () => {
    expect((guide.advanced || []).length).toBeGreaterThanOrEqual(4);
    expect((guide.advanced || []).length).toBeLessThanOrEqual(8);
    for (const topic of guide.advanced || []) {
      expect(topic.summary).toBeTruthy();
      // Summaries render as plain text, so no markdown.
      expect(topic.summary).not.toMatch(/[`*_[\]#<>|]/);
      expect(topic.summary).not.toContain("\n");
    }
  });

  test("keeps labels and rules out of the first-run steps", () => {
    for (const advanced of [
      "oneuptime.label.",
      "Label Rules",
      "telemetry.sdk.language",
      "Pinned Service Name",
    ]) {
      expect(steps).not.toContain(advanced);
    }
  });

  test("links to its own setup page and the troubleshooting page, which exist", () => {
    expect(guide.links).toEqual([
      client === "mobile"
        ? { title: "Mobile setup", url: RUM_MOBILE_SETUP_DOCS_URL }
        : { title: "Browser setup", url: RUM_BROWSER_SETUP_DOCS_URL },
      { title: "RUM troubleshooting", url: RUM_TROUBLESHOOTING_DOCS_URL },
    ]);
    for (const link of guide.links || []) {
      expect(docsPageExists(link.url)).toBe(true);
    }
  });

  test("every docs link in the guide points at a page that exists", () => {
    const links: Array<string> = Array.from(
      markdown.matchAll(/\]\((\/docs\/[^)#\s]+)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const link of links) {
      expect({ link, exists: docsPageExists(link) }).toEqual({
        link,
        exists: true,
      });
    }
  });

  test("shows only its own client's instructions", () => {
    const browserOnly: Array<string> = [
      "npm install @opentelemetry/api",
      "src/telemetry.ts",
      "WebTracerProvider",
      "connect-src",
      "propagateTraceHeaderCorsUrls",
      "Never ship a Server ingestion key to a browser",
      "web_vital.lcp",
      "Setting `service.name` alone is not enough",
    ];
    const mobileOnly: Array<string> = [
      "OTEL_RESOURCE_ATTRIBUTES",
      "device.model.identifier",
      "device.manufacturer",
      "Mobile needs a Server key",
      "release train",
      "opentelemetry-swift",
    ];
    for (const text of browserOnly) {
      expect({ text, present: markdown.includes(text) }).toEqual({
        text,
        present: client === "browser",
      });
    }
    for (const text of mobileOnly) {
      expect({ text, present: markdown.includes(text) }).toEqual({
        text,
        present: client === "mobile",
      });
    }
  });
});

describe("the browser guide", () => {
  const guide: SetupGuideContent = guideFor("browser");
  const markdown: string = getSetupGuideMarkdown(guide);

  test("installs the packages, creates telemetry.ts, allows the exporter and verifies", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Install the OpenTelemetry packages",
      "Create telemetry.ts and import it first",
      "Allow OneUptime in your Content Security Policy",
      "Load a page and verify",
    ]);
  });

  test("installs every package telemetry.ts imports, and the API they all depend on", () => {
    const file: string = getRumBrowserTelemetryFile({
      oneuptimeUrl: URL,
      apiKey: KEY,
      appName: RUM_EXAMPLE_APP_NAMES.browser,
    });
    const imported: Array<string> = Array.from(
      file.matchAll(/from "(@opentelemetry\/[^"]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });
    expect(imported.length).toBe(9);
    for (const pkg of imported) {
      expect(RUM_BROWSER_PACKAGES).toContain(pkg);
    }
    expect(RUM_BROWSER_PACKAGES).toContain("@opentelemetry/api");
    // Nothing installed that the file does not use, bar the API itself.
    expect(RUM_BROWSER_PACKAGES.length).toBe(imported.length + 1);

    const install: string = guide.steps[0]!.markdown || "";
    expect(install).toContain(getRumBrowserInstallCommand());
    for (const pkg of RUM_BROWSER_PACKAGES) {
      expect(install).toContain(pkg);
    }
  });

  test("telemetry.ts exports traces to the reader's URL with their key", () => {
    const setup: string = guide.steps[1]!.markdown || "";
    expect(setup).toContain(`url: "${URL}/otlp/v1/traces",`);
    expect(setup).toContain(`headers: { "x-oneuptime-token": "${KEY}" },`);
    expect(setup).toContain(
      `[ATTR_SERVICE_NAME]: "${RUM_EXAMPLE_APP_NAMES.browser}",`,
    );
  });

  /*
   * The old single-page guide's snippet, line by line. Each line is still
   * in the file the reader copies, so moving the guide lost nothing.
   */
  test("keeps every line of the previous snippet", () => {
    const setup: string = guide.steps[1]!.markdown || "";
    for (const line of [
      'import { WebTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-web";',
      'import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";',
      'import { ZoneContextManager } from "@opentelemetry/context-zone";',
      'import { registerInstrumentations } from "@opentelemetry/instrumentation";',
      'import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";',
      'import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";',
      'import { defaultResource, detectResources, resourceFromAttributes } from "@opentelemetry/resources";',
      'import { browserDetector } from "@opentelemetry/opentelemetry-browser-detector";',
      'import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";',
      "// browserDetector supplies the browser.* attributes that make this RUM.",
      "const resource = defaultResource()",
      "  .merge(detectResources({ detectors: [browserDetector] }))",
      "const provider = new WebTracerProvider({",
      "        // This value is public. It must be a Browser ingestion key,",
      "        // never a Server one.",
      "provider.register({ contextManager: new ZoneContextManager() });",
      "    new DocumentLoadInstrumentation(),",
      "    // List only origins whose API allows the traceparent header.",
      "      propagateTraceHeaderCorsUrls: [/^https:\\/\\/api\\.example\\.com/],",
    ]) {
      expect({ line, present: setup.includes(line) }).toEqual({
        line,
        present: true,
      });
    }
  });

  test("telemetry.ts is imported first", () => {
    const setup: string = guide.steps[1]!.markdown || "";
    expect(setup).toContain('import "./telemetry";');
    expect(setup).toContain("the **first** import of your app");
  });

  test("keeps the browser detector warning next to the snippet", () => {
    expect(guide.steps[1]!.markdown).toContain(
      "> **Setting `service.name` alone is not enough.** The OpenTelemetry browser SDKs do not add `browser.*` attributes unless you enable the browser resource detector or set them yourself — without them this becomes a backend Service, not a RUM application.",
    );
  });

  test("allows the exporter in the Content Security Policy", () => {
    const csp: string = guide.steps[2]!.markdown || "";
    expect(csp).toContain(`connect-src 'self' ${URL};`);
    expect(guide.steps[2]!.description).toContain("Content-Security-Policy");
  });

  test("never lets a Server key reach a browser", () => {
    expect(guide.keyStep?.description).toContain(
      "Never put a Server key in a page",
    );
    const keys: string = topicNamed(guide.advanced, "Browser ingestion keys");
    expect(keys).toContain(
      "> **Never ship a Server ingestion key to a browser.** A Server key has full ingest access from anywhere, with no origin check.",
    );
    expect(keys).toContain(
      "it is accepted only from those origins, so a copied key does not work from anyone else's page;",
    );
    expect(keys).toContain(
      "it is rate limited per key, can be switched off in one edit, and can be given an expiry.",
    );
  });

  test("the Advanced topics", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "How OneUptime recognises a browser app",
      "Browser ingestion keys",
      "Link browser requests to your backend traces",
      "Report uncaught errors",
      "Send logs, metrics and Core Web Vitals",
      "Labels and owners",
      "What you get",
    ]);
  });

  test("links Core Web Vitals to their docs", () => {
    expect(
      topicNamed(guide.advanced, "Send logs, metrics and Core Web Vitals"),
    ).toContain("[Core Web Vitals](/docs/rum/web-vitals)");
    expect(markdown).toContain(`${URL}/otlp/v1/logs`);
    expect(markdown).toContain(`${URL}/otlp/v1/metrics`);
  });

  test("the troubleshooting topics", () => {
    expect(topicTitles(guide.troubleshooting)).toEqual([
      "No request to OneUptime in the browser's Network tab",
      "The request is blocked or refused",
      "The app shows up under Services instead of Real User Monitoring",
      "The Clients tab is empty on Safari or Firefox",
      'Core Web Vitals say "No web vitals reported yet"',
      "The application's tabs are empty",
      'Status shows "Disconnected" while the app is live',
    ]);
    expect(
      topicNamed(guide.troubleshooting, "The request is blocked or refused"),
    ).toContain(`connect-src 'self' ${URL};`);
  });
});

describe("the mobile guide", () => {
  const guide: SetupGuideContent = guideFor("mobile");

  test("configures the exporter, then verifies", () => {
    expect(
      guide.steps.map((step: SetupGuideStep): string => {
        return step.title;
      }),
    ).toEqual([
      "Point the SDK's exporter at OneUptime",
      "Launch the app and verify",
    ]);
  });

  test("sets the endpoint, the key, the app's name and its device attributes", () => {
    const configure: string = guide.steps[0]!.markdown || "";
    expect(configure).toContain(
      [
        `OTEL_EXPORTER_OTLP_ENDPOINT="${URL}/otlp"`,
        `OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${KEY}"`,
        'OTEL_RESOURCE_ATTRIBUTES="service.name=storefront-mobile,device.manufacturer=Acme,device.model.identifier=AC-100"',
      ].join("\n"),
    );
    expect(configure).toContain(
      "Most mobile SDKs set the `device.*` attributes for you — verify it, and set them explicitly as above if the application is filed under Services instead.",
    );
    expect(configure).toContain(`[Mobile Setup](${RUM_MOBILE_SETUP_DOCS_URL})`);
  });

  test("keeps the warning that a mobile app needs a Server key", () => {
    expect(guide.keyStep?.description).toContain(
      "a Browser key is checked against the Origin header, which mobile SDKs do not send",
    );
    expect(
      topicNamed(guide.advanced, "Protect the key shipped in your app"),
    ).toContain(
      "> **Mobile needs a Server key, and a mobile bundle can be unpacked.** A Browser key is enforced against the `Origin` header, which a mobile SDK does not send, so it cannot be used here.",
    );
    expect((guide.prerequisites || []).join("\n")).toContain(
      "**Server** ingestion key",
    );
  });

  test("keeps the device.manufacturer caveat", () => {
    const caveat: string =
      "`device.manufacturer` also marks a batch as mobile, but only on a resource that carries no `host.name` or `host.id`";
    expect(
      topicNamed(guide.advanced, "How OneUptime recognises a mobile app"),
    ).toContain(caveat);
    expect(
      topicNamed(
        guide.troubleshooting,
        "The app shows up under Services instead of Real User Monitoring",
      ),
    ).toContain(caveat);
  });

  test("the Advanced topics", () => {
    expect(topicTitles(guide.advanced)).toEqual([
      "How OneUptime recognises a mobile app",
      "Protect the key shipped in your app",
      "SDK notes for Android, iOS and React Native",
      "Labels and owners",
      "What you get",
    ]);
  });

  test("React Native is told it still needs a Server key", () => {
    expect(
      topicNamed(guide.advanced, "SDK notes for Android, iOS and React Native"),
    ).toContain("It still sends with a **Server** key");
  });

  test("the troubleshooting topics", () => {
    expect(topicTitles(guide.troubleshooting)).toEqual([
      "The key check returns 401, or the key is refused",
      "The app shows up under Services instead of Real User Monitoring",
      "The Clients tab is empty",
      "The application's tabs are empty",
      'Status shows "Disconnected" while the app is live',
    ]);
  });
});

describe("the application name", () => {
  test("a product page suggests a name and says to replace it", () => {
    for (const client of CLIENT_KEYS) {
      const steps: string = stepsText(guideFor(client));
      expect(steps).toContain(
        `Replace \`${RUM_EXAMPLE_APP_NAMES[client]}\` with your application's name`,
      );
      expect(steps).toContain("a new name registers a new application");
    }
  });

  test("an application's own tab uses its identifier and says to keep it", () => {
    const browser: string = stepsText(
      guideFor("browser", { appName: "checkout-web" }),
    );
    expect(browser).toContain('[ATTR_SERVICE_NAME]: "checkout-web",');
    expect(browser).toContain("`service.name` is **`checkout-web`**");
    expect(browser).not.toContain("Replace `");

    const mobile: string = stepsText(
      guideFor("mobile", { appName: "checkout-ios" }),
    );
    expect(mobile).toContain(
      'OTEL_RESOURCE_ATTRIBUTES="service.name=checkout-ios,device.manufacturer=Acme,device.model.identifier=AC-100"',
    );
    expect(mobile).toContain("`service.name` is **`checkout-ios`**");
    expect(mobile).not.toContain("storefront-mobile");
  });

  test("a name is escaped for where it goes: a JS string, or a percent-encoded attribute", () => {
    const name: string = 'shop "web", v2';
    expect(
      getRumBrowserTelemetryFile({
        oneuptimeUrl: URL,
        apiKey: KEY,
        appName: name,
      }),
    ).toContain('[ATTR_SERVICE_NAME]: "shop \\"web\\", v2",');

    const attributes: string = getRumMobileResourceAttributes(name);
    const pairs: Array<string> = attributes.split(",");
    expect(pairs).toHaveLength(3);
    expect(decodeURIComponent(pairs[0]!.replace("service.name=", ""))).toBe(
      name,
    );
    expect(attributes).not.toContain('"');
    expect(stepsText(guideFor("mobile", { appName: name }))).toContain(
      "percent-encoded",
    );
    expect(stepsText(guideFor("browser", { appName: name }))).not.toContain(
      "percent-encoded",
    );
  });

  test("a blank name counts as unknown", () => {
    expect(stepsText(guideFor("browser", { appName: "  " }))).toContain(
      `[ATTR_SERVICE_NAME]: "${RUM_EXAMPLE_APP_NAMES.browser}",`,
    );
  });
});

describe("before a key is picked", () => {
  test.each(CLIENT_KEYS)(
    "%s shows the placeholder and says where to pick a key",
    (client: RumClient) => {
      const guide: SetupGuideContent = guideFor(client, {
        apiKey: SETUP_GUIDE_API_KEY_PLACEHOLDER,
      });
      const configure: string =
        guide.steps[client === "mobile" ? 0 : 1]!.markdown!;
      expect(configure).toContain(SETUP_GUIDE_API_KEY_PLACEHOLDER);
      expect(configure).toContain(
        `Pick an ingestion key in step 1 to fill in \`${SETUP_GUIDE_API_KEY_PLACEHOLDER}\`.`,
      );
    },
  );

  test("the note goes away once a key is picked", () => {
    for (const client of CLIENT_KEYS) {
      expect(getSetupGuideMarkdown(guideFor(client))).not.toContain(
        "Pick an ingestion key in step 1",
      );
    }
  });
});

/*
 * The guide explains how OneUptime decides telemetry is RUM and what a
 * Browser key may do. Each of these reads the code that decides it, so the
 * explanation cannot outlive a change to it.
 */
describe("what the guide says matches the product", () => {
  test("the classification attributes are the ones ingest reads", () => {
    const ingest: string = read(
      "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
    );
    const start: number = ingest.indexOf("protected static getRumClientType(");
    const end: number = ingest.indexOf(
      "protected static async autoDiscoverRum(",
    );
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const classify: string = ingest.slice(start, end);
    for (const attribute of [
      "browser.platform",
      "browser.language",
      "browser.brands",
      "device.id",
      "device.model.identifier",
      "device.manufacturer",
      "host.id",
    ]) {
      expect(classify).toContain(`"${attribute}"`);
    }

    const browser: string = getSetupGuideMarkdown(guideFor("browser"));
    for (const attribute of [
      "browser.platform",
      "browser.language",
      "browser.brands",
    ]) {
      expect(browser).toContain(`\`${attribute}\``);
    }
    const mobile: string = getSetupGuideMarkdown(guideFor("mobile"));
    for (const attribute of [
      "device.id",
      "device.model.identifier",
      "device.manufacturer",
      "host.id",
    ]) {
      expect(mobile).toContain(`\`${attribute}\``);
    }
  });

  test("an application is named after service.name, and the Clients tab after the platform or model", () => {
    const ingest: string = read(
      "packages/App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts",
    );
    const discovery: string = ingest.slice(
      ingest.indexOf("protected static async autoDiscoverRum("),
      ingest.indexOf(
        "protected static async promoteOneuptimeLabelsToRumApplication(",
      ),
    );
    expect(discovery).toContain('"service.name"');
    expect(discovery).toMatch(
      /clientName[\s\S]*?"browser\.platform"[\s\S]*?"device\.model\.identifier"/,
    );
    expect(discovery).toContain('"telemetry.sdk.language"');
    expect(discovery).toContain('"telemetry.sdk.version"');
  });

  test("a Browser key can write exactly traces, logs, metrics and session replays", () => {
    expect(Array.from(BROWSER_ALLOWED_INGEST_SURFACES).sort()).toEqual(
      [
        TelemetryIngestSurface.OtelTraces,
        TelemetryIngestSurface.OtelLogs,
        TelemetryIngestSurface.OtelMetrics,
        TelemetryIngestSurface.SessionReplay,
      ].sort(),
    );
    expect(
      topicNamed(guideFor("browser").advanced, "Browser ingestion keys"),
    ).toContain(
      "it can only write traces, logs, metrics and session replays — not profiles, source maps, syslog, Fluent, Pyroscope or security events;",
    );
  });

  test("the refusals the troubleshooting quotes are the ones ingest sends", () => {
    const middleware: string = read(
      "packages/Common/Server/Middleware/TelemetryIngest.ts",
    );
    expect(middleware).toContain(
      "is not allowed for this browser ingestion key.",
    );
    expect(middleware).toContain(
      "This telemetry ingestion key has been disabled.",
    );
    // What makes a Browser key useless from a mobile app.
    expect(middleware).toContain("This request did not send an Origin header");

    const refused: string = topicNamed(
      guideFor("browser").troubleshooting,
      "The request is blocked or refused",
    );
    expect(refused).toContain("is not allowed for this browser ingestion key");
    expect(refused).toContain("This telemetry ingestion key has been disabled");
  });

  test("the key controls the mobile guide names exist on a key", () => {
    const model: string = read(
      "packages/Common/Models/DatabaseModels/TelemetryIngestionKey.ts",
    );
    for (const title of [
      'title: "Pinned Service Name"',
      'title: "Requests Per Minute Limit"',
      'title: "Expires At"',
    ]) {
      expect(model).toContain(title);
    }
  });

  test("the overview opens on the past hour, as the troubleshooting says", () => {
    expect(
      read("packages/App/FeatureSet/Dashboard/src/Pages/Rum/View/Overview.tsx"),
    ).toContain("range: TimeRange.PAST_ONE_HOUR");
  });

  test("label and owner rules exist under Real User Monitoring settings", () => {
    const menu: string = read(
      "packages/App/FeatureSet/Dashboard/src/Pages/Rum/SideMenu.tsx",
    );
    expect(menu).toContain('title: "Real User Monitoring"');
    expect(menu).toContain('title: "Label Rules"');
    expect(menu).toContain('title: "Owner Rules"');
  });
});
