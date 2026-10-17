import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Where the App sends the requests it makes to its own API, for the servers
 * that render a public page:
 *
 *   - StatusPageApiInternalUrl: the status page API. Before a status page's
 *     HTML is sent, its /seo gives the page's title, description, search
 *     engine indexing and theme - a dark page is sent dark, and one that
 *     follows each visitor's device is sent as one, before any script runs.
 *     Its RSS feed and llms.txt read it too.
 *   - DashboardApiInternalUrl: the public dashboard API, for the same on a
 *     public dashboard.
 *
 * Both are the App's internal address, SERVER_APP_HOSTNAME:APP_PORT over
 * plain HTTP - the address Nginx proxies /api to, which the App's other
 * server-to-server calls use (MailService, the MCP server's tools, ...) -
 * whatever HOST and HTTP_PROTOCOL say. They used to be the public address,
 * HTTP_PROTOCOL + HOST, out through Nginx and back in. With HOST=localhost -
 * a local install, and the e2e stack - that is the App container itself,
 * where nothing listens on port 80: every lookup failed, and every status
 * page was sent as the placeholder, the light page titled "Status Page",
 * whatever its own theme. StatusPagePublic.spec.ts caught it: a page that
 * follows each visitor's device was sent with data-status-page-theme="light".
 *
 * EnvironmentConfig reads process.env at module load, so every case sets the
 * environment, resets the module registry and imports afresh.
 */

interface UrlShape {
  toString: () => string;
}

interface EnvironmentConfigShape {
  StatusPageApiInternalUrl: UrlShape;
  DashboardApiInternalUrl: UrlShape;
  StatusPageApiClientUrl: UrlShape;
  AppApiClientUrl: UrlShape;
}

interface UrlModuleShape {
  default: {
    fromString: (url: string) => { addRoute: (route: string) => UrlShape };
  };
}

const MANAGED_KEYS: Array<string> = [
  "HOST",
  "HTTP_PROTOCOL",
  "SERVER_APP_HOSTNAME",
  "APP_PORT",
];

// The e2e stack, and a Docker Compose install that keeps config.example.env's HOST.
const LOCAL_STACK: Record<string, string> = {
  HOST: "localhost",
  HTTP_PROTOCOL: "http",
  SERVER_APP_HOSTNAME: "app",
  APP_PORT: "3002",
};

// A Kubernetes install served over HTTPS on its own domain.
const CLUSTER: Record<string, string> = {
  HOST: "oneuptime.acme.example",
  HTTP_PROTOCOL: "https",
  SERVER_APP_HOSTNAME: "oneuptime-app.oneuptime.svc.cluster.local",
  APP_PORT: "3002",
};

const PAGE_ID: string = "5e000000-0000-4000-8000-000000000001";

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function load(
  environment: Record<string, string>,
): Promise<EnvironmentConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(environment)) {
    process.env[key] = value;
  }

  jest.resetModules();

  return (await import(
    "../../Server/EnvironmentConfig"
  )) as unknown as EnvironmentConfigShape;
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("the App's own API, as the servers that render a public page reach it", () => {
  it("is the App's internal address on the e2e stack, not localhost:80 inside the App container", async () => {
    const config: EnvironmentConfigShape = await load(LOCAL_STACK);

    expect(config.StatusPageApiInternalUrl.toString()).toBe(
      "http://app:3002/api/status-page",
    );
    expect(config.DashboardApiInternalUrl.toString()).toBe(
      "http://app:3002/api/dashboard",
    );
  });

  it("is plain HTTP to the App's service, whatever public address and protocol visitors use", async () => {
    const config: EnvironmentConfigShape = await load(CLUSTER);

    expect(config.StatusPageApiInternalUrl.toString()).toBe(
      "http://oneuptime-app.oneuptime.svc.cluster.local:3002/api/status-page",
    );
    expect(config.DashboardApiInternalUrl.toString()).toBe(
      "http://oneuptime-app.oneuptime.svc.cluster.local:3002/api/dashboard",
    );
  });

  it("takes a lookup's path under the API, as the page servers build it, and stays as it was", async () => {
    const config: EnvironmentConfigShape = await load(LOCAL_STACK);

    const URL: UrlModuleShape["default"] = (
      (await import("../../Types/API/URL")) as unknown as UrlModuleShape
    ).default;

    expect(
      URL.fromString(config.StatusPageApiInternalUrl.toString())
        .addRoute(`/seo/${PAGE_ID}`)
        .toString(),
    ).toBe(`http://app:3002/api/status-page/seo/${PAGE_ID}`);

    expect(config.StatusPageApiInternalUrl.toString()).toBe(
      "http://app:3002/api/status-page",
    );
  });

  it("leaves what visitors are sent on the public address", async () => {
    const config: EnvironmentConfigShape = await load(CLUSTER);

    expect(config.AppApiClientUrl.toString()).toBe(
      "https://oneuptime.acme.example/api",
    );
    expect(config.StatusPageApiClientUrl.toString()).toBe(
      "https://oneuptime.acme.example/status-page-api",
    );
  });
});
