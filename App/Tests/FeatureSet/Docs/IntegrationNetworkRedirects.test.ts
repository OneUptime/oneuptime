import DocsFeatureSet from "../../../FeatureSet/Docs/Index";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import Express, {
  ExpressApplication,
  ExpressResponse,
} from "Common/Server/Utils/Express";
import { afterAll, beforeAll, describe, expect, it, jest } from "@jest/globals";
import { AddressInfo } from "net";
import { createServer, Server } from "http";
import type * as Path from "path";
import type * as FileSystem from "fs";

/*
 * Exercise the registered routes and real docs templates without booting the
 * database-backed application. Only infrastructure outside docs is replaced.
 */
jest.mock("../../../FeatureSet/Docs/Utils/Config", () => {
  const path: typeof Path = jest.requireActual<typeof Path>("path");
  const root: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
  return {
    ContentPath: path.join(root, "Content"),
    StaticPath: path.join(root, "Static"),
    ViewsPath: path.join(root, "Views"),
  };
});
jest.mock("Common/Server/Utils/LocalFile", () => {
  const fs: typeof FileSystem = jest.requireActual<typeof FileSystem>("fs");
  return {
    __esModule: true,
    default: {
      doesFileExist: async (file: string): Promise<boolean> => {
        return fs.existsSync(file);
      },
      read: (file: string): Promise<string> => {
        return fs.promises.readFile(file, "utf8");
      },
    },
  };
});
jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendMarkdownResponse: (
        _req: unknown,
        res: ExpressResponse,
        content: string,
      ): ExpressResponse => {
        return res.type("text/markdown").send(content);
      },
    },
  };
});
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { error: jest.fn() },
  };
});
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    GoogleTagManagerEnabled: false,
  };
});
jest.mock("Common/Server/Utils/Telemetry/CaptureSpan", () => {
  return {
    __esModule: true,
    default: () => {
      return (
        _target: unknown,
        _name: string,
        descriptor: PropertyDescriptor,
      ): PropertyDescriptor => {
        return descriptor;
      };
    },
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/LlmsTxt", () => {
  return {
    __esModule: true,
    default: {},
  };
});
jest.mock("../../../FeatureSet/Docs/Utils/Placeholders", () => {
  return {
    __esModule: true,
    default: {
      render: (content: string): string => {
        return content;
      },
    },
  };
});

const GUIDES: Array<string> = [
  "github-integration",
  "sendgrid-inbound-email",
  "slack-integration",
  "microsoft-teams-integration",
  "twilio-integration",
  "push-notifications",
];

let server: Server;
let origin: string;

beforeAll(async () => {
  const app: ExpressApplication = Express.getExpressApp();
  app.set("view engine", "ejs");
  await DocsFeatureSet.init();
  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (!server) {
    return;
  }
  await new Promise<void>(
    (resolve: () => void, reject: (error: Error) => void) => {
      server.close((error?: Error) => {
        return error ? reject(error) : resolve();
      });
    },
  );
});

describe("retired integration network guide", () => {
  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "keeps HTML and markdown bookmarks usable in %s",
    async (lang: string) => {
      for (const prefix of ["/docs", "/docs/as-markdown"]) {
        const response: Response = await fetch(
          `${origin}${prefix}/${lang}/self-hosted/integration-network-access`,
          { redirect: "manual" },
        );
        const destination: string = `${prefix}/${lang}/integrations/index`;
        expect(response.status).toBe(301);
        expect(response.headers.get("location")).toBe(destination);
        const catalog: Response = await fetch(`${origin}${destination}`);
        expect(catalog.status).toBe(200);
        const content: string = await catalog.text();
        expect(content).not.toContain(
          "/self-hosted/integration-network-access",
        );
        for (const guide of GUIDES) {
          expect(content).toContain(`/self-hosted/${guide}`);
        }
      }
    },
  );

  it("chooses the browser language for a bookmark without a locale", async () => {
    const response: Response = await fetch(
      `${origin}/docs/self-hosted/integration-network-access`,
      { redirect: "manual", headers: { "Accept-Language": "fr" } },
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "/docs/fr/integrations/index",
    );
    expect(response.headers.get("vary")).toContain("Accept-Language");
  });

  it("keeps unlocalized markdown in the default language", async () => {
    const response: Response = await fetch(
      `${origin}/docs/as-markdown/self-hosted/integration-network-access`,
      { redirect: "manual", headers: { "Accept-Language": "fr" } },
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "/docs/as-markdown/en/integrations/index",
    );
  });

  it("does not redirect unsupported locales to nonexistent catalogs", async () => {
    for (const prefix of ["/docs", "/docs/as-markdown"]) {
      const response: Response = await fetch(
        `${origin}${prefix}/invalid/self-hosted/integration-network-access`,
        { redirect: "manual" },
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "renders every destination guide in %s",
    async (lang: string) => {
      for (const guide of GUIDES) {
        const response: Response = await fetch(
          `${origin}/docs/${lang}/self-hosted/${guide}`,
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('id="docs-content"');
      }
    },
  );
});
