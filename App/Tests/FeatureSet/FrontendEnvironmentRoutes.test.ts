import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

const REPO_ROOT: string = path.resolve(__dirname, "../../..");
const APP_ROOT: string = path.join(REPO_ROOT, "App");
const COMMON_ROOT: string = path.join(REPO_ROOT, "Common");

const FRONTENDS: Array<{ name: string; route: string; view: string }> = [
  { name: "accounts", route: "/accounts", view: "Accounts" },
  { name: "dashboard", route: "/dashboard", view: "Dashboard" },
  { name: "admin", route: "/admin", view: "AdminDashboard" },
  { name: "status-page", route: "/status-page", view: "StatusPage" },
  {
    name: "public-dashboard",
    route: "/public-dashboard",
    view: "PublicDashboard",
  },
];

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

const combinedServerSource: string = withoutComments(
  read(path.join(APP_ROOT, "FeatureSet", "Frontend", "Index.ts")),
);
const standaloneServerSource: string = withoutComments(
  read(path.join(COMMON_ROOT, "Server", "Utils", "StartServer.ts")),
);
const sharedEnvironmentResponseSource: string = withoutComments(
  read(path.join(COMMON_ROOT, "Server", "Utils", "FrontendEnvironment.ts")),
);

describe("all frontend env.js routes use the hardened serializer", () => {
  test("the combined server registers exactly the five shipped frontend prefixes", () => {
    const configuredPrefixes: Array<string> = [
      ...combinedServerSource.matchAll(/routePrefix:\s*"([^"]+)"/g),
    ].map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(configuredPrefixes.sort()).toEqual(
      FRONTENDS.map((frontend: { route: string }): string => {
        return frontend.route;
      }).sort(),
    );
  });

  test("the combined server derives every env.js route from its registered prefix", () => {
    expect(combinedServerSource).toContain(
      "`${frontendConfig.routePrefix}/env.js`",
    );
    expect(combinedServerSource.match(/registerFrontendApp\(/g)?.length).toBe(
      FRONTENDS.length,
    );
  });

  test("the combined server sends only the shared hardened script", () => {
    expect(combinedServerSource).toContain(
      "sendFrontendEnvironmentResponse(req, res)",
    );
    expect(combinedServerSource).not.toContain("getFrontendEnvVars");
    expect(combinedServerSource).not.toContain("JSON.stringify(env)");
  });

  test("the standalone server exposes both supported env.js aliases through the same serializer", () => {
    expect(standaloneServerSource).toContain(
      '[`/${appName}/env.js`, "/env.js"]',
    );
    expect(standaloneServerSource).toContain(
      "sendFrontendEnvironmentResponse(req, res)",
    );
    expect(standaloneServerSource).not.toContain("getFrontendEnvVars");
    expect(standaloneServerSource).not.toContain("JSON.stringify(env)");
  });

  test("the one response helper makes every env.js route private and non-cacheable", () => {
    expect(sharedEnvironmentResponseSource).toContain(
      '"private, no-store, no-cache, must-revalidate"',
    );
    expect(sharedEnvironmentResponseSource).toContain(
      "Response.setNoCacheHeaders(res)",
    );
    expect(sharedEnvironmentResponseSource).toContain(
      "Response.sendJavaScriptResponse(req, res, getFrontendEnvironmentScript())",
    );
  });

  test.each(FRONTENDS)(
    "$name standalone server opts into frontend routes with the expected app name",
    (frontend: { name: string; route: string; view: string }) => {
      const source: string = withoutComments(
        read(path.join(APP_ROOT, "FeatureSet", frontend.view, "Serve.ts")),
      );

      expect(source).toContain(`APP_NAME: string = "${frontend.name}"`);
      expect(source).toContain("isFrontendApp: true");
    },
  );

  test.each(FRONTENDS)(
    "$route index page loads only its own env.js route",
    (frontend: { name: string; route: string; view: string }) => {
      const template: string = read(
        path.join(APP_ROOT, "FeatureSet", frontend.view, "views", "index.ejs"),
      );
      const envScripts: Array<string> = [
        ...template.matchAll(/<script\s+src="([^"]*env\.js)"/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect(envScripts).toEqual([`${frontend.route}/env.js`]);
    },
  );

  test("neither route implementation contains backend OTLP environment names", () => {
    for (const source of [combinedServerSource, standaloneServerSource]) {
      expect(source).not.toContain("OPENTELEMETRY_EXPORTER_OTLP_HEADERS");
      expect(source).not.toContain("OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT");
    }
  });
});
