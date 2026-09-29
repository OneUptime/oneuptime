import { afterEach, describe, expect, test, jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import type {
  ExpressRequest,
  ExpressResponse,
} from "../../../Server/Utils/Express";

const MANAGED_KEYS: Array<string> = [
  "HOST",
  "IS_ENTERPRISE_EDITION",
  "ONEUPTIME_EDITION",
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

  /*
   * "Requested" is EnvironmentConfig's isEnterpriseEditionRequested, the
   * definition the App's boot guard uses too: an explicit
   * ONEUPTIME_EDITION=community withdraws the request. The Enterprise image
   * bakes IS_ENTERPRISE_EDITION=true, so without that exception an operator
   * running it as the Community Edition on purpose (the documented way) would
   * be told "this is the Community image, switch images".
   */
  interface RequestCase {
    label: string;
    isEnterpriseEdition: string | undefined;
    edition: string | undefined;
    enterpriseLoaded: boolean;
    requestedButNotLoaded: string;
  }

  test.each([
    {
      label: "the Enterprise image run with ONEUPTIME_EDITION=community",
      isEnterpriseEdition: "true",
      edition: "community",
      enterpriseLoaded: false,
      requestedButNotLoaded: "false",
    },
    {
      label: "ONEUPTIME_EDITION=community in any case and spacing",
      isEnterpriseEdition: "true",
      edition: "  Community \n",
      enterpriseLoaded: false,
      requestedButNotLoaded: "false",
    },
    {
      label: "the Community image with a leftover IS_ENTERPRISE_EDITION=true",
      isEnterpriseEdition: "true",
      edition: undefined,
      enterpriseLoaded: false,
      requestedButNotLoaded: "true",
    },
    {
      label:
        "IS_ENTERPRISE_EDITION=true with an explicit ONEUPTIME_EDITION=auto",
      isEnterpriseEdition: "true",
      edition: "auto",
      enterpriseLoaded: false,
      requestedButNotLoaded: "true",
    },
    {
      label: "IS_ENTERPRISE_EDITION=true with a blank ONEUPTIME_EDITION (auto)",
      isEnterpriseEdition: "true",
      edition: "   ",
      enterpriseLoaded: false,
      requestedButNotLoaded: "true",
    },
    {
      label: "ONEUPTIME_EDITION=enterprise whose module did not load",
      isEnterpriseEdition: "true",
      edition: "enterprise",
      enterpriseLoaded: false,
      requestedButNotLoaded: "true",
    },
    {
      label: "an unrecognised ONEUPTIME_EDITION does not withdraw the request",
      isEnterpriseEdition: "true",
      edition: "comunity",
      enterpriseLoaded: false,
      requestedButNotLoaded: "true",
    },
    {
      label: "IS_ENTERPRISE_EDITION=TRUE is not a request (exactly true only)",
      isEnterpriseEdition: "TRUE",
      edition: undefined,
      enterpriseLoaded: false,
      requestedButNotLoaded: "false",
    },
    {
      label: "the Enterprise image with ee loaded",
      isEnterpriseEdition: "true",
      edition: "enterprise",
      enterpriseLoaded: true,
      requestedButNotLoaded: "false",
    },
    {
      label: "ONEUPTIME_EDITION=community without IS_ENTERPRISE_EDITION",
      isEnterpriseEdition: undefined,
      edition: "community",
      enterpriseLoaded: false,
      requestedButNotLoaded: "false",
    },
  ] as Array<RequestCase>)(
    "$label: requested but not loaded = $requestedButNotLoaded",
    async (requestCase: RequestCase) => {
      const result: Awaited<ReturnType<typeof render>> = await render(
        {
          IS_ENTERPRISE_EDITION: requestCase.isEnterpriseEdition,
          ONEUPTIME_EDITION: requestCase.edition,
        },
        {},
        { enterpriseLoaded: requestCase.enterpriseLoaded },
      );

      expect(
        result.window.process?.env?.[
          "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"
        ],
      ).toBe(requestCase.requestedButNotLoaded);
      expect(result.window.process?.env?.["IS_ENTERPRISE_EDITION"]).toBe(
        requestCase.enterpriseLoaded ? "true" : "false",
      );
    },
  );

  test("the request is read on every call, not frozen at import", async () => {
    await render({ IS_ENTERPRISE_EDITION: "true" });

    const { getFrontendEnvironmentVariables } = await import(
      "../../../Server/Utils/FrontendEnvironment"
    );

    expect(
      getFrontendEnvironmentVariables()[
        "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"
      ],
    ).toBe("true");

    process.env["ONEUPTIME_EDITION"] = "community";

    expect(
      getFrontendEnvironmentVariables()[
        "ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"
      ],
    ).toBe("false");
  });

  test("uses EnvironmentConfig's shared definition, not a copy of it", () => {
    const source: string = fs
      .readFileSync(
        path.join(__dirname, "../../../Server/Utils/FrontendEnvironment.ts"),
        "utf8",
      )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    expect(source).toMatch(
      /isEnterpriseEditionRequested\(\s*process\.env,?\s*\)/,
    );
    expect(source).not.toMatch(/IS_ENTERPRISE_EDITION"\]\s*===/);
    expect(source).not.toContain("ONEUPTIME_EDITION");
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

/*
 * The shared definition itself (EnvironmentConfig), which the App's boot guard
 * (packages/App/Utils/EnterpriseLoader.ts) also uses as its default.
 */
describe("isEnterpriseEditionRequested", () => {
  type EnvironmentConfigModule =
    typeof import("../../../Server/EnvironmentConfig");

  const loadConfig: (
    overrides: Record<string, string | undefined>,
  ) => Promise<EnvironmentConfigModule> = async (
    overrides: Record<string, string | undefined>,
  ): Promise<EnvironmentConfigModule> => {
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

    return await import("../../../Server/EnvironmentConfig");
  };

  interface DefinitionCase {
    isEnterpriseEdition: string | undefined;
    edition: string | undefined;
    requested: boolean;
  }

  test.each([
    { isEnterpriseEdition: "true", edition: undefined, requested: true },
    { isEnterpriseEdition: "true", edition: "", requested: true },
    { isEnterpriseEdition: "true", edition: "auto", requested: true },
    { isEnterpriseEdition: "true", edition: "enterprise", requested: true },
    { isEnterpriseEdition: "true", edition: "not-an-edition", requested: true },
    { isEnterpriseEdition: "true", edition: "community", requested: false },
    { isEnterpriseEdition: "true", edition: " COMMUNITY ", requested: false },
    { isEnterpriseEdition: "false", edition: undefined, requested: false },
    { isEnterpriseEdition: "false", edition: "enterprise", requested: false },
    { isEnterpriseEdition: undefined, edition: undefined, requested: false },
    { isEnterpriseEdition: "", edition: "auto", requested: false },
    { isEnterpriseEdition: "TRUE", edition: undefined, requested: false },
    { isEnterpriseEdition: " true", edition: undefined, requested: false },
    { isEnterpriseEdition: "1", edition: undefined, requested: false },
  ] as Array<DefinitionCase>)(
    "IS_ENTERPRISE_EDITION=$isEnterpriseEdition, ONEUPTIME_EDITION=$edition -> $requested",
    async (definitionCase: DefinitionCase) => {
      const config: EnvironmentConfigModule = await loadConfig({
        IS_ENTERPRISE_EDITION: definitionCase.isEnterpriseEdition,
        ONEUPTIME_EDITION: definitionCase.edition,
      });

      expect(
        config.isEnterpriseEditionRequested({
          IS_ENTERPRISE_EDITION: definitionCase.isEnterpriseEdition,
          ONEUPTIME_EDITION: definitionCase.edition,
        }),
      ).toBe(definitionCase.requested);
      // The constant the loader defaults to is the same rule over process.env.
      expect(config.IsEnterpriseEditionRequested).toBe(
        definitionCase.requested,
      );
    },
  );

  test("reads only the environment it is given", async () => {
    const config: EnvironmentConfigModule = await loadConfig({
      IS_ENTERPRISE_EDITION: "true",
    });

    expect(config.IsEnterpriseEditionRequested).toBe(true);
    expect(config.isEnterpriseEditionRequested({})).toBe(false);
    expect(
      config.isEnterpriseEditionRequested({
        IS_ENTERPRISE_EDITION: "true",
        ONEUPTIME_EDITION: "community",
      }),
    ).toBe(false);
  });

  test("leaves the raw IsEnterpriseEdition flag meaning what it always meant", async () => {
    const config: EnvironmentConfigModule = await loadConfig({
      IS_ENTERPRISE_EDITION: "true",
      ONEUPTIME_EDITION: "community",
    });

    expect(config.IsEnterpriseEdition).toBe(true);
    expect(config.IsEnterpriseEditionRequested).toBe(false);
  });
});
