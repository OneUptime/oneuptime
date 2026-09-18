import { afterEach, describe, expect, test, jest } from "@jest/globals";
import type {
  ExpressRequest,
  ExpressResponse,
} from "../../../Server/Utils/Express";

const MANAGED_KEYS: Array<string> = [
  "HOST",
  "IS_ENTERPRISE_EDITION",
  "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED",
  "PUBLIC_TEST_SETTING",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT",
  "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
  "PUBLIC_OTEL_EXPORTER_OTLP_HEADERS",
];

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

interface BrowserWindow {
  process?: {
    env?: Record<string, unknown>;
  };
}

interface RenderOptions {
  // Register a fake enterprise module before serializing (the EE image).
  enterpriseLoaded?: boolean;
}

async function render(
  overrides: Record<string, string | undefined>,
  initialWindow: BrowserWindow = {},
  options: RenderOptions = {},
): Promise<{ script: string; window: BrowserWindow }> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "undefined") {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();
  const { getFrontendEnvironmentScript } = await import(
    "../../../Server/Utils/FrontendEnvironment"
  );

  /*
   * Imported from the same fresh module registry as the serializer, so the
   * fake is registered on the very EnterpriseEdition instance it reads.
   */
  const enterpriseKit: typeof import("../Enterprise/FakeEnterpriseModule") =
    await import("../Enterprise/FakeEnterpriseModule");

  if (options.enterpriseLoaded) {
    enterpriseKit.installFakeEnterpriseModule();
  } else {
    enterpriseKit.uninstallEnterpriseModule();
  }

  const script: string = getFrontendEnvironmentScript();

  new Function("window", script)(initialWindow);

  return { script, window: initialWindow };
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("frontend environment script serialization", () => {
  test("creates window.process and window.process.env when neither exists", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render({
      HOST: "oneuptime.example.com",
    });

    expect(result.window.process?.env).toMatchObject({
      HOST: "oneuptime.example.com",
    });
  });

  test("replaces a stale pre-existing environment snapshot", async () => {
    const initialWindow: BrowserWindow = {
      process: { env: { STALE_SECRET: "must-disappear" } },
    };
    const result: Awaited<ReturnType<typeof render>> = await render(
      { HOST: "fresh.example.com" },
      initialWindow,
    );

    expect(result.window.process?.env).toMatchObject({
      HOST: "fresh.example.com",
    });
    expect(result.window.process?.env).not.toHaveProperty("STALE_SECRET");
  });

  test("does not reflect a backend bearer token in either script bytes or runtime values", async () => {
    const sentinel: string =
      'super-secret-\\"token\\nwith-special-characters-and-123456';
    const result: Awaited<ReturnType<typeof render>> = await render({
      OPENTELEMETRY_EXPORTER_OTLP_HEADERS: `authorization=Bearer ${sentinel}`,
    });

    expect(result.script).not.toContain("authorization");
    expect(result.script).not.toContain("super-secret");
    expect(JSON.stringify(result.window.process?.env)).not.toContain(
      "super-secret",
    );
  });

  test("does not reflect a backend endpoint that may contain URL credentials", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render({
      OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://server-user:server-password@collector.internal:4318",
    });

    expect(result.script).not.toContain("server-user");
    expect(result.script).not.toContain("server-password");
  });

  test("does not serialize a PUBLIC_-prefixed standard OTLP header alias", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render({
      PUBLIC_OTEL_EXPORTER_OTLP_HEADERS:
        "authorization=Bearer public-alias-secret",
    });

    expect(result.script).not.toContain("public-alias-secret");
    expect(result.window.process?.env).not.toHaveProperty(
      "PUBLIC_OTEL_EXPORTER_OTLP_HEADERS",
    );
  });

  test("serializes the public browser endpoint and origin-bound Browser key", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://ingest.example.com:4318",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:
        "public-browser-key",
    });

    expect(result.window.process?.env).toMatchObject({
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT:
        "https://ingest.example.com:4318",
      PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY:
        "public-browser-key",
    });
  });

  test("serializes hostile-looking public text as data without breaking the script", async () => {
    const unusualPublicValue: string = '</script>";window.pwned=true;//';
    const result: Awaited<ReturnType<typeof render>> = await render({
      PUBLIC_TEST_SETTING: unusualPublicValue,
    });

    expect(result.window.process?.env?.["PUBLIC_TEST_SETTING"]).toBe(
      unusualPublicValue,
    );
    expect((result.window as BrowserWindow & { pwned?: boolean }).pwned).toBe(
      undefined,
    );
  });

  test("emits a valid empty telemetry configuration when all telemetry values are unset", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render({});

    expect(result.window.process?.env).not.toHaveProperty(
      "OPENTELEMETRY_EXPORTER_OTLP_HEADERS",
    );
    expect(result.window.process?.env).not.toHaveProperty(
      "PUBLIC_OPENTELEMETRY_EXPORTER_OTLP_BROWSER_INGESTION_KEY",
    );
  });

  test("marks the complete environment response private and non-cacheable", async () => {
    jest.resetModules();
    const {
      FRONTEND_ENVIRONMENT_CACHE_CONTROL,
      sendFrontendEnvironmentResponse,
    } = await import("../../../Server/Utils/FrontendEnvironment");
    const setHeader: ReturnType<typeof jest.fn> = jest.fn();
    const writeHead: ReturnType<typeof jest.fn> = jest.fn();
    const end: ReturnType<typeof jest.fn> = jest.fn();
    const response: ExpressResponse = {
      setHeader,
      writeHead,
      end,
    } as unknown as ExpressResponse;

    sendFrontendEnvironmentResponse({} as unknown as ExpressRequest, response);

    expect(setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      FRONTEND_ENVIRONMENT_CACHE_CONTROL,
    );
    expect(FRONTEND_ENVIRONMENT_CACHE_CONTROL).toContain("private");
    expect(FRONTEND_ENVIRONMENT_CACHE_CONTROL).toContain("no-store");
    expect(setHeader).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(setHeader).toHaveBeenCalledWith("Expires", "0");
    expect(writeHead).toHaveBeenCalledWith(200, {
      "Content-Type": "text/javascript",
    });
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("frontend environment edition flags", () => {
  interface EditionCase {
    rawValue: string | undefined;
    enterpriseLoaded: boolean;
    effective: string;
    requestedButNotLoaded: string;
  }

  test.each([
    {
      rawValue: undefined,
      enterpriseLoaded: false,
      effective: "false",
      requestedButNotLoaded: "false",
    },
    {
      rawValue: "false",
      enterpriseLoaded: false,
      effective: "false",
      requestedButNotLoaded: "false",
    },
    {
      rawValue: "true",
      enterpriseLoaded: false,
      effective: "false",
      requestedButNotLoaded: "true",
    },
    {
      rawValue: "true",
      enterpriseLoaded: true,
      effective: "true",
      requestedButNotLoaded: "false",
    },
    {
      rawValue: undefined,
      enterpriseLoaded: true,
      effective: "true",
      requestedButNotLoaded: "false",
    },
    {
      rawValue: "false",
      enterpriseLoaded: true,
      effective: "true",
      requestedButNotLoaded: "false",
    },
  ] as Array<EditionCase>)(
    "IS_ENTERPRISE_EDITION=$rawValue with ee loaded=$enterpriseLoaded serializes the effective edition $effective",
    async (editionCase: EditionCase) => {
      const result: Awaited<ReturnType<typeof render>> = await render(
        { IS_ENTERPRISE_EDITION: editionCase.rawValue },
        {},
        { enterpriseLoaded: editionCase.enterpriseLoaded },
      );

      expect(result.window.process?.env?.["IS_ENTERPRISE_EDITION"]).toBe(
        editionCase.effective,
      );
      expect(
        result.window.process?.env?.[
          "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"
        ],
      ).toBe(editionCase.requestedButNotLoaded);
    },
  );

  test("a client-supplied ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED cannot leak through", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render(
      {
        ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED: "true",
        PUBLIC_TEST_SETTING: "kept",
      },
      {},
      { enterpriseLoaded: true },
    );

    expect(
      result.window.process?.env?.[
        "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"
      ],
    ).toBe("false");
    expect(result.window.process?.env?.["PUBLIC_TEST_SETTING"]).toBe("kept");
  });

  test("the effective flags are the only edition values in the script", async () => {
    const result: Awaited<ReturnType<typeof render>> = await render(
      { IS_ENTERPRISE_EDITION: "true" },
      {},
      { enterpriseLoaded: false },
    );

    expect(result.script.match(/IS_ENTERPRISE_EDITION/g)?.length).toBe(1);
    expect(result.script).toContain('"IS_ENTERPRISE_EDITION":"false"');
  });
});
