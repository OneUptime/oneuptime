import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import URL from "../../../../Types/API/URL";

/*
 * Browser telemetry bootstrap. `init` reads three values from UI/Config that
 * are computed at module load, so every test builds a fresh module registry
 * with its own Config mock. All OpenTelemetry packages are replaced with
 * recording fakes: nothing here should register a real global tracer, patch
 * fetch/XHR, or try to export spans over the network.
 */

interface TelemetryConfig {
  DisableTelemetry: boolean;
  BrowserOpenTelemetryExporterOtlpEndpoint: URL | null;
  BrowserOpenTelemetryExporterOtlpIngestionKey: string;
}

interface FakeSpan {
  attributes: { [key: string]: string };
  setAttribute: (key: string, value: string) => FakeSpan;
}

interface SpanProcessorLike {
  onStart: (span: FakeSpan) => void;
  onEnd: () => void;
  forceFlush: () => Promise<void>;
  shutdown: () => Promise<void>;
}

interface TelemetryClass {
  init: (data: { serviceName: string }) => void;
  setGlobalAttributes: (attributes: {
    [key: string]: string | undefined;
  }) => void;
}

interface Recorded {
  exporterOptions: Array<{ url: string; headers: { [key: string]: string } }>;
  batchProcessorExporters: Array<unknown>;
  providerConfigs: Array<{
    resource: unknown;
    spanProcessors: Array<unknown>;
  }>;
  registerCalls: Array<{ contextManager: unknown }>;
  resourceAttributes: Array<{ [key: string]: string }>;
  instrumentations: Array<{ instrumentations: Array<unknown> }>;
  zoneContextManagers: number;
  fetchInstrumentations: number;
  xhrInstrumentations: number;
}

const SERVICE_NAME_KEY: string = "service.name";

const makeSpan: () => FakeSpan = (): FakeSpan => {
  const span: FakeSpan = {
    attributes: {},
    setAttribute: (key: string, value: string): FakeSpan => {
      span.attributes[key] = value;
      return span;
    },
  };
  return span;
};

const loadTelemetry: (config: TelemetryConfig) => {
  Telemetry: TelemetryClass;
  recorded: Recorded;
} = (
  config: TelemetryConfig,
): { Telemetry: TelemetryClass; recorded: Recorded } => {
  const recorded: Recorded = {
    exporterOptions: [],
    batchProcessorExporters: [],
    providerConfigs: [],
    registerCalls: [],
    resourceAttributes: [],
    instrumentations: [],
    zoneContextManagers: 0,
    fetchInstrumentations: 0,
    xhrInstrumentations: 0,
  };

  let Telemetry: TelemetryClass | undefined;

  jest.isolateModules(() => {
    jest.doMock("../../../../UI/Config", () => {
      return {
        __esModule: true,
        DisableTelemetry: config.DisableTelemetry,
        BrowserOpenTelemetryExporterOtlpEndpoint:
          config.BrowserOpenTelemetryExporterOtlpEndpoint,
        BrowserOpenTelemetryExporterOtlpIngestionKey:
          config.BrowserOpenTelemetryExporterOtlpIngestionKey,
      };
    });

    jest.doMock("@opentelemetry/context-zone", () => {
      return {
        ZoneContextManager: class {
          public readonly kind: string = "zone";
          public constructor() {
            recorded.zoneContextManagers++;
          }
        },
      };
    });

    jest.doMock("@opentelemetry/exporter-trace-otlp-http", () => {
      return {
        OTLPTraceExporter: class {
          public readonly kind: string = "otlp-exporter";
          public constructor(options: {
            url: string;
            headers: { [key: string]: string };
          }) {
            recorded.exporterOptions.push(options);
          }
        },
      };
    });

    jest.doMock("@opentelemetry/instrumentation", () => {
      return {
        registerInstrumentations: (options: {
          instrumentations: Array<unknown>;
        }): void => {
          recorded.instrumentations.push(options);
        },
      };
    });

    jest.doMock("@opentelemetry/instrumentation-fetch", () => {
      return {
        FetchInstrumentation: class {
          public readonly kind: string = "fetch";
          public constructor() {
            recorded.fetchInstrumentations++;
          }
        },
      };
    });

    jest.doMock("@opentelemetry/instrumentation-xml-http-request", () => {
      return {
        XMLHttpRequestInstrumentation: class {
          public readonly kind: string = "xhr";
          public constructor() {
            recorded.xhrInstrumentations++;
          }
        },
      };
    });

    jest.doMock("@opentelemetry/resources", () => {
      return {
        resourceFromAttributes: (attributes: { [key: string]: string }) => {
          recorded.resourceAttributes.push(attributes);
          return { kind: "resource", attributes };
        },
      };
    });

    jest.doMock("@opentelemetry/semantic-conventions", () => {
      return { ATTR_SERVICE_NAME: SERVICE_NAME_KEY };
    });

    jest.doMock("@opentelemetry/sdk-trace-web", () => {
      return {
        BatchSpanProcessor: class {
          public readonly kind: string = "batch";
          public readonly exporter: unknown;
          public constructor(exporter: unknown) {
            this.exporter = exporter;
            recorded.batchProcessorExporters.push(exporter);
          }
        },
        WebTracerProvider: class {
          public constructor(providerConfig: {
            resource: unknown;
            spanProcessors: Array<unknown>;
          }) {
            recorded.providerConfigs.push(providerConfig);
          }

          public register(options: { contextManager: unknown }): void {
            recorded.registerCalls.push(options);
          }
        },
      };
    });

    /*
     * requireActual loads Telemetry unmocked while its own imports resolve
     * through the doMock'd fakes in this isolated registry.
     */
    Telemetry = (
      jest.requireActual("../../../../UI/Utils/Telemetry/Telemetry") as {
        default: TelemetryClass;
      }
    ).default;
  });

  return { Telemetry: Telemetry as TelemetryClass, recorded };
};

const ENABLED_CONFIG: TelemetryConfig = {
  DisableTelemetry: false,
  BrowserOpenTelemetryExporterOtlpEndpoint: URL.fromString(
    "https://otlp.oneuptime.com/otlp",
  ),
  BrowserOpenTelemetryExporterOtlpIngestionKey: "browser-ingestion-key",
};

const getGlobalAttributeProcessor: (recorded: Recorded) => SpanProcessorLike = (
  recorded: Recorded,
): SpanProcessorLike => {
  expect(recorded.providerConfigs).toHaveLength(1);
  const processors: Array<unknown> = recorded.providerConfigs[0]!
    .spanProcessors as Array<unknown>;
  expect(processors).toHaveLength(2);
  return processors[1] as SpanProcessorLike;
};

describe("UI Telemetry", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  describe("init gating", () => {
    it("does nothing when telemetry is disabled, even if fully configured", () => {
      const { Telemetry, recorded } = loadTelemetry({
        ...ENABLED_CONFIG,
        DisableTelemetry: true,
      });

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.exporterOptions).toHaveLength(0);
      expect(recorded.providerConfigs).toHaveLength(0);
      expect(recorded.registerCalls).toHaveLength(0);
      expect(recorded.instrumentations).toHaveLength(0);
    });

    it("does nothing when no endpoint is configured", () => {
      const { Telemetry, recorded } = loadTelemetry({
        ...ENABLED_CONFIG,
        BrowserOpenTelemetryExporterOtlpEndpoint: null,
      });

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.exporterOptions).toHaveLength(0);
      expect(recorded.providerConfigs).toHaveLength(0);
      expect(recorded.instrumentations).toHaveLength(0);
    });

    it("does nothing when the browser ingestion key is missing", () => {
      const { Telemetry, recorded } = loadTelemetry({
        ...ENABLED_CONFIG,
        BrowserOpenTelemetryExporterOtlpIngestionKey: "",
      });

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.exporterOptions).toHaveLength(0);
      expect(recorded.providerConfigs).toHaveLength(0);
      expect(recorded.instrumentations).toHaveLength(0);
    });
  });

  describe("init when enabled", () => {
    it("exports to <endpoint>/v1/traces with the browser ingestion key header", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.exporterOptions).toEqual([
        {
          url: "https://otlp.oneuptime.com/otlp/v1/traces",
          headers: { "x-oneuptime-token": "browser-ingestion-key" },
        },
      ]);
    });

    it("builds the traces URL from an endpoint without a path", () => {
      const { Telemetry, recorded } = loadTelemetry({
        ...ENABLED_CONFIG,
        BrowserOpenTelemetryExporterOtlpEndpoint: URL.fromString(
          "http://localhost:4318",
        ),
      });

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.exporterOptions[0]!.url).toBe(
        "http://localhost:4318/v1/traces",
      );
    });

    it("tags the resource with the given service name", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);

      Telemetry.init({ serviceName: "status-page" });

      expect(recorded.resourceAttributes).toEqual([
        { [SERVICE_NAME_KEY]: "status-page" },
      ]);
      expect(recorded.providerConfigs[0]!.resource).toEqual({
        kind: "resource",
        attributes: { [SERVICE_NAME_KEY]: "status-page" },
      });
    });

    it("wires a batch processor around the exporter followed by the global attribute processor", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);

      Telemetry.init({ serviceName: "dashboard" });

      const processors: Array<unknown> =
        recorded.providerConfigs[0]!.spanProcessors;
      expect(processors).toHaveLength(2);
      expect((processors[0] as { kind: string }).kind).toBe("batch");
      expect(
        (processors[0] as { exporter: { kind: string } }).exporter.kind,
      ).toBe("otlp-exporter");

      const globalProcessor: SpanProcessorLike =
        processors[1] as SpanProcessorLike;
      expect(typeof globalProcessor.onStart).toBe("function");
      expect(typeof globalProcessor.onEnd).toBe("function");
      expect(typeof globalProcessor.forceFlush).toBe("function");
      expect(typeof globalProcessor.shutdown).toBe("function");
    });

    it("registers the provider with a Zone context manager", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.registerCalls).toHaveLength(1);
      expect(recorded.zoneContextManagers).toBe(1);
      expect(
        (recorded.registerCalls[0]!.contextManager as { kind: string }).kind,
      ).toBe("zone");
    });

    it("instruments fetch and XMLHttpRequest", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);

      Telemetry.init({ serviceName: "dashboard" });

      expect(recorded.instrumentations).toHaveLength(1);
      expect(
        recorded.instrumentations[0]!.instrumentations.map((i: unknown) => {
          return (i as { kind: string }).kind;
        }),
      ).toEqual(["fetch", "xhr"]);
      expect(recorded.fetchInstrumentations).toBe(1);
      expect(recorded.xhrInstrumentations).toBe(1);
    });
  });

  describe("global RUM attributes", () => {
    it("stamps nothing onto spans when no attributes have been set", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });

      const span: FakeSpan = makeSpan();
      getGlobalAttributeProcessor(recorded).onStart(span);

      expect(span.attributes).toEqual({});
    });

    it("stamps attributes set BEFORE init onto every new span", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);

      Telemetry.setGlobalAttributes({ userId: "user-1", projectId: "proj-1" });
      Telemetry.init({ serviceName: "dashboard" });

      const processor: SpanProcessorLike =
        getGlobalAttributeProcessor(recorded);
      const first: FakeSpan = makeSpan();
      const second: FakeSpan = makeSpan();
      processor.onStart(first);
      processor.onStart(second);

      expect(first.attributes).toEqual({
        userId: "user-1",
        projectId: "proj-1",
      });
      expect(second.attributes).toEqual({
        userId: "user-1",
        projectId: "proj-1",
      });
    });

    it("stamps attributes set AFTER init onto spans started afterwards", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });
      const processor: SpanProcessorLike =
        getGlobalAttributeProcessor(recorded);

      const before: FakeSpan = makeSpan();
      processor.onStart(before);

      Telemetry.setGlobalAttributes({ userId: "user-2" });

      const after: FakeSpan = makeSpan();
      processor.onStart(after);

      expect(before.attributes).toEqual({});
      expect(after.attributes).toEqual({ userId: "user-2" });
    });

    it("supports arbitrary extra keys", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });

      Telemetry.setGlobalAttributes({ statusPageId: "sp-1", tenant: "acme" });

      const span: FakeSpan = makeSpan();
      getGlobalAttributeProcessor(recorded).onStart(span);

      expect(span.attributes).toEqual({ statusPageId: "sp-1", tenant: "acme" });
    });

    it("ignores empty and undefined values", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });

      Telemetry.setGlobalAttributes({
        userId: "",
        projectId: undefined,
        other: "kept",
      });

      const span: FakeSpan = makeSpan();
      getGlobalAttributeProcessor(recorded).onStart(span);

      expect(span.attributes).toEqual({ other: "kept" });
    });

    it("merges successive calls and overwrites a key with a new non-empty value", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });

      Telemetry.setGlobalAttributes({ userId: "user-1", projectId: "proj-1" });
      Telemetry.setGlobalAttributes({ projectId: "proj-2" });

      const span: FakeSpan = makeSpan();
      getGlobalAttributeProcessor(recorded).onStart(span);

      expect(span.attributes).toEqual({
        userId: "user-1",
        projectId: "proj-2",
      });
    });

    it("cannot clear a previously set attribute: empty values keep the stale one", () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });

      Telemetry.setGlobalAttributes({ userId: "user-1", projectId: "proj-1" });
      // e.g. logout / leaving a project
      Telemetry.setGlobalAttributes({ userId: "", projectId: undefined });

      const span: FakeSpan = makeSpan();
      getGlobalAttributeProcessor(recorded).onStart(span);

      expect(span.attributes).toEqual({
        userId: "user-1",
        projectId: "proj-1",
      });
    });

    it("accepts attributes without throwing when telemetry is disabled", () => {
      const { Telemetry, recorded } = loadTelemetry({
        ...ENABLED_CONFIG,
        DisableTelemetry: true,
      });

      expect(() => {
        Telemetry.setGlobalAttributes({ userId: "user-1" });
        Telemetry.init({ serviceName: "dashboard" });
      }).not.toThrow();
      expect(recorded.providerConfigs).toHaveLength(0);
    });

    it("processor lifecycle hooks are inert and resolve immediately", async () => {
      const { Telemetry, recorded } = loadTelemetry(ENABLED_CONFIG);
      Telemetry.init({ serviceName: "dashboard" });
      const processor: SpanProcessorLike =
        getGlobalAttributeProcessor(recorded);

      expect(processor.onEnd()).toBeUndefined();
      await expect(processor.forceFlush()).resolves.toBeUndefined();
      await expect(processor.shutdown()).resolves.toBeUndefined();
    });
  });
});
