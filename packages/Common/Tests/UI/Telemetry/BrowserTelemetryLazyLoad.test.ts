import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import URL from "../../../Types/API/URL";

/*
 * Telemetry.init fetches the browser OpenTelemetry SDK with import(), and only
 * where it will run. An installation that has not configured browser telemetry
 * downloads none of it, and one that has does not wait for it.
 *
 * Every OpenTelemetry package here is a fake that notes when it is evaluated:
 * what jest loaded is what the browser would have fetched, and
 * SignInFirstLoadBuild.test.ts holds the bundler to the same split.
 * BrowserTelemetrySpans.test.ts runs the real SDK.
 */

const TELEMETRY_PATH: string = "../../../UI/Utils/Telemetry/Telemetry";
const SDK_FILE_PATH: string = "../../../UI/Utils/Telemetry/BrowserTelemetrySdk";
const SDK_FILE: string = "BrowserTelemetrySdk";

const OPENTELEMETRY_PACKAGES: ReadonlyArray<string> = [
  "@opentelemetry/exporter-trace-otlp-http",
  "@opentelemetry/instrumentation",
  "@opentelemetry/instrumentation-fetch",
  "@opentelemetry/instrumentation-xml-http-request",
  "@opentelemetry/resources",
  "@opentelemetry/sdk-trace-web",
  "@opentelemetry/semantic-conventions",
];

interface TelemetryConfig {
  DisableTelemetry: boolean;
  BrowserOpenTelemetryExporterOtlpEndpoint: URL | null;
  BrowserOpenTelemetryExporterOtlpIngestionKey: string;
}

interface TelemetryClass {
  init: (data: { serviceName: string }) => Promise<void>;
  setGlobalAttributes: (attributes: {
    [key: string]: string | undefined;
  }) => void;
}

interface FakeSpan {
  attributes: { [key: string]: string };
  setAttribute: (key: string, value: string) => void;
}

interface SpanProcessorLike {
  onStart: (span: FakeSpan) => void;
}

interface Recorded {
  // What was evaluated, in order: the SDK's file and each package.
  loaded: Array<string>;
  spanProcessors: Array<unknown>;
  registerCalls: number;
  instrumentationSets: Array<Array<{ kind: string }>>;
}

const CONFIGURED: TelemetryConfig = {
  DisableTelemetry: false,
  BrowserOpenTelemetryExporterOtlpEndpoint: URL.fromString(
    "https://otlp.oneuptime.com/otlp",
  ),
  BrowserOpenTelemetryExporterOtlpIngestionKey: "browser-ingestion-key",
};

const NOT_STARTED: ReadonlyArray<[string, TelemetryConfig]> = [
  ["telemetry is disabled", { ...CONFIGURED, DisableTelemetry: true }],
  [
    "no endpoint is configured",
    { ...CONFIGURED, BrowserOpenTelemetryExporterOtlpEndpoint: null },
  ],
  [
    "no browser ingestion key is configured",
    { ...CONFIGURED, BrowserOpenTelemetryExporterOtlpIngestionKey: "" },
  ],
  [
    "neither is configured",
    {
      DisableTelemetry: false,
      BrowserOpenTelemetryExporterOtlpEndpoint: null,
      BrowserOpenTelemetryExporterOtlpIngestionKey: "",
    },
  ],
];

const makeSpan: () => FakeSpan = (): FakeSpan => {
  const span: FakeSpan = {
    attributes: {},
    setAttribute: (key: string, value: string): void => {
      span.attributes[key] = value;
    },
  };

  return span;
};

interface LoadOptions {
  // The SDK's file fails to load, as one a deploy has replaced does.
  sdkFileFails?: boolean;
  // The SDK loads and then throws as it starts.
  registerThrows?: boolean;
}

const fakeOpenTelemetry: (
  recorded: Recorded,
  options: LoadOptions,
) => { [name: string]: unknown } = (
  recorded: Recorded,
  options: LoadOptions,
): { [name: string]: unknown } => {
  return {
    "@opentelemetry/exporter-trace-otlp-http": { OTLPTraceExporter: class {} },
    "@opentelemetry/instrumentation": {
      registerInstrumentations: (registered: {
        instrumentations: Array<{ kind: string }>;
      }): void => {
        recorded.instrumentationSets.push(registered.instrumentations);
      },
    },
    "@opentelemetry/instrumentation-fetch": {
      FetchInstrumentation: class {
        public readonly kind: string = "fetch";
      },
    },
    "@opentelemetry/instrumentation-xml-http-request": {
      XMLHttpRequestInstrumentation: class {
        public readonly kind: string = "xhr";
      },
    },
    "@opentelemetry/resources": {
      resourceFromAttributes: (attributes: unknown): unknown => {
        return attributes;
      },
    },
    "@opentelemetry/sdk-trace-web": {
      BatchSpanProcessor: class {},
      WebTracerProvider: class {
        public constructor(config: { spanProcessors: Array<unknown> }) {
          recorded.spanProcessors = config.spanProcessors;
        }

        public register(): void {
          recorded.registerCalls++;

          if (options.registerThrows) {
            throw new Error("Could not register the provider");
          }
        }
      },
    },
    "@opentelemetry/semantic-conventions": {
      ATTR_SERVICE_NAME: "service.name",
    },
  };
};

const loadTelemetry: (
  config: TelemetryConfig,
  options?: LoadOptions,
) => { Telemetry: TelemetryClass; recorded: Recorded } = (
  config: TelemetryConfig,
  options: LoadOptions = {},
): { Telemetry: TelemetryClass; recorded: Recorded } => {
  const recorded: Recorded = {
    loaded: [],
    spanProcessors: [],
    registerCalls: 0,
    instrumentationSets: [],
  };

  jest.doMock("../../../UI/Config", () => {
    return { __esModule: true, ...config };
  });

  const fakes: { [name: string]: unknown } = fakeOpenTelemetry(
    recorded,
    options,
  );

  for (const name of OPENTELEMETRY_PACKAGES) {
    jest.doMock(name, () => {
      recorded.loaded.push(name);
      return fakes[name];
    });
  }

  jest.doMock(SDK_FILE_PATH, () => {
    recorded.loaded.push(SDK_FILE);

    if (options.sdkFileFails) {
      throw new TypeError("Failed to fetch dynamically imported module");
    }

    return jest.requireActual(SDK_FILE_PATH);
  });

  const Telemetry: TelemetryClass = (
    jest.requireActual(TELEMETRY_PATH) as { default: TelemetryClass }
  ).default;

  return { Telemetry, recorded };
};

const stamped: (recorded: Recorded) => { [key: string]: string } = (
  recorded: Recorded,
): { [key: string]: string } => {
  const span: FakeSpan = makeSpan();

  (recorded.spanProcessors[1] as SpanProcessorLike).onStart(span);

  return span.attributes;
};

describe("what Telemetry brings into the page", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("importing it loads nothing of the SDK, configured or not", () => {
    for (const config of [CONFIGURED, { ...CONFIGURED, DisableTelemetry: true }]) {
      jest.resetModules();

      expect(loadTelemetry(config).recorded.loaded).toEqual([]);
    }
  });

  test("the attributes it keeps need nothing of the SDK", () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    Telemetry.setGlobalAttributes({ userId: "user-1", projectId: "project-1" });

    expect(recorded.loaded).toEqual([]);
  });
});

describe("Telemetry.init where it will not start", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test.each(NOT_STARTED)(
    "loads nothing when %s",
    async (_name: string, config: TelemetryConfig) => {
      const { Telemetry, recorded } = loadTelemetry(config);

      Telemetry.setGlobalAttributes({ userId: "user-1" });

      await expect(
        Telemetry.init({ serviceName: "accounts" }),
      ).resolves.toBeUndefined();

      expect(recorded.loaded).toEqual([]);
      expect(recorded.registerCalls).toBe(0);
      expect(recorded.instrumentationSets).toEqual([]);
    },
  );
});

describe("Telemetry.init where browser telemetry is configured", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("loads the SDK and registers it", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    await Telemetry.init({ serviceName: "accounts" });

    expect(recorded.loaded[0]).toBe(SDK_FILE);
    expect([...recorded.loaded].sort()).toEqual(
      [SDK_FILE, ...OPENTELEMETRY_PACKAGES].sort(),
    );
    expect(recorded.registerCalls).toBe(1);
    expect(
      recorded.instrumentationSets.map(
        (instrumentations: Array<{ kind: string }>): Array<string> => {
          return instrumentations.map((instrumentation: { kind: string }) => {
            return instrumentation.kind;
          });
        },
      ),
    ).toEqual([["fetch", "xhr"]]);
  });

  test("the page goes on before the SDK has loaded", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    const started: Promise<void> = Telemetry.init({ serviceName: "accounts" });

    // Nothing of it yet: what a page does next runs ahead of the SDK.
    expect(recorded.loaded).toEqual([]);
    expect(recorded.registerCalls).toBe(0);

    await started;

    expect(recorded.registerCalls).toBe(1);
  });
});

describe("attributes set around the SDK's arrival", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("set before init, they are stamped on spans", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    Telemetry.setGlobalAttributes({ userId: "user-1", projectId: "project-1" });

    await Telemetry.init({ serviceName: "dashboard" });

    expect(stamped(recorded)).toEqual({
      userId: "user-1",
      projectId: "project-1",
    });
  });

  test("set right after init, as the Dashboard's Index.tsx does, they are stamped on spans", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    const started: Promise<void> = Telemetry.init({ serviceName: "dashboard" });

    // The SDK has not been evaluated yet: its file is on its way.
    Telemetry.setGlobalAttributes({ userId: "user-1", projectId: "project-1" });
    expect(recorded.loaded).toEqual([]);

    await started;

    expect(stamped(recorded)).toEqual({
      userId: "user-1",
      projectId: "project-1",
    });
  });

  test("set after it has started, they reach the next span", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    await Telemetry.init({ serviceName: "dashboard" });

    expect(stamped(recorded)).toEqual({});

    Telemetry.setGlobalAttributes({ projectId: "project-1" });
    expect(stamped(recorded)).toEqual({ projectId: "project-1" });

    // Switching project, as ProjectUtil.setCurrentProject does.
    Telemetry.setGlobalAttributes({ projectId: "project-2" });
    expect(stamped(recorded)).toEqual({ projectId: "project-2" });
  });

  test("an empty value set while it loads leaves what was there", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED);

    Telemetry.setGlobalAttributes({ userId: "user-1" });

    const started: Promise<void> = Telemetry.init({ serviceName: "dashboard" });

    Telemetry.setGlobalAttributes({ userId: "", projectId: undefined });

    await started;

    expect(stamped(recorded)).toEqual({ userId: "user-1" });
  });
});

describe("an SDK that does not arrive", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test("a file that fails to load settles quietly", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED, {
      sdkFileFails: true,
    });

    await expect(
      Telemetry.init({ serviceName: "accounts" }),
    ).resolves.toBeUndefined();

    expect(recorded.loaded).toEqual([SDK_FILE]);
    expect(recorded.registerCalls).toBe(0);
  });

  test("an SDK that throws as it starts settles quietly", async () => {
    const { Telemetry, recorded } = loadTelemetry(CONFIGURED, {
      registerThrows: true,
    });

    await expect(
      Telemetry.init({ serviceName: "accounts" }),
    ).resolves.toBeUndefined();

    expect(recorded.registerCalls).toBe(1);
    expect(recorded.instrumentationSets).toEqual([]);
  });

  test("setting attributes goes on working", async () => {
    const { Telemetry } = loadTelemetry(CONFIGURED, { sdkFileFails: true });

    await Telemetry.init({ serviceName: "accounts" });

    expect(() => {
      Telemetry.setGlobalAttributes({ userId: "user-1" });
    }).not.toThrow();
  });
});
