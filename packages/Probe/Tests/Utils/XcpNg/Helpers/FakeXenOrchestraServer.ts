import { TestCertificate } from "./XcpNgCertificates";
import { readScrapeText } from "./XcpNgFixtures";
import http from "http";
import https from "https";
import { AddressInfo } from "net";

/*
 * A STAND-IN XEN ORCHESTRA, over HTTPS, answering as xo-server, its
 * OpenMetrics plugin (xo-server-openmetrics 1.9.4) and its REST API
 * (@xen-orchestra/rest-api) answer - read in vatesfr/xen-orchestra on 26
 * November 2026, with the REST API's own documented examples
 * (src/open-api/oa-examples) for the shapes:
 *
 *   /openmetrics/health    200 {"status":"ok"}, no secret
 *   /openmetrics/metrics   Bearer secret: none is 401 {"error":"Query is not
 *                          authenticated"}, another 401 {"error":"Query
 *                          authentication does not match server setting"};
 *                          with no pool, "# No connected hosts\n# EOF"
 *   plugin "off"           every /openmetrics/* is 500 text/plain "There was
 *                          a problem proxying this request."
 *   /rest/v0/users/me      307 to /rest/v0/users/<id> for a known token
 *   /rest/v0/users/<id>    the user (pw_hash obfuscated)
 *   .../authentication_tokens   every token of the user, ids included
 *   .../acl-privileges?fields=  the user's privileges ({action, resource, effect})
 *   /rest/v0/plugins/openmetrics  the plugin, or 404 when it is not there
 *   anything else          404 HTML (Xen Orchestra's own pages)
 *
 * The token travels as the authenticationToken cookie, as the REST API takes
 * it; a wrong or expired one is 401, as Xen Orchestra forgets an expired
 * token. Every request is recorded, so a test can say what was - and was
 * never - sent.
 */

export interface FakeXoUser {
  id: string;
  name: string;
  permission: "admin" | "user" | "none";
  privileges: Array<{ action: string; resource: string; effect?: string }>;
}

export interface FakeXoToken {
  id: string;
  userId: string;
  // ms since the epoch, as Xen Orchestra writes it.
  expiration: number;
}

export interface FakeXoSettings {
  secret: string;
  plugin: "on" | "off";
  // What /rest/v0/plugins/openmetrics says: absent is 404.
  pluginState: "loaded" | "not-loaded" | "missing";
  // The scrapes served in turn; the last one again after that.
  scrapes: Array<string>;
  noPools: boolean;
  // Serve a web page at /openmetrics/metrics, as something that is not XO.
  notXenOrchestra: boolean;
  users: Array<FakeXoUser>;
  tokens: Array<FakeXoToken>;
  // Xen Orchestra's clock, for which tokens have expired.
  nowMs: number;
}

export interface FakeXoRequest {
  method: string;
  url: string;
  authorization: string | null;
  cookie: string | null;
}

export interface FakeXenOrchestra {
  port: number;
  settings: FakeXoSettings;
  requests: Array<FakeXoRequest>;
  close: () => Promise<void>;
}

export const FAKE_XO_SECRET: string = "fake-xo-openmetrics-secret";

export const READ_ONLY_USER: FakeXoUser = {
  id: "6b017bcf-99e4-40a2-bf64-bf723d6c1994",
  name: "oneuptime-read-only",
  permission: "none",
  privileges: [
    { action: "read", resource: "pool", effect: "allow" },
    { action: "read", resource: "host", effect: "allow" },
    { action: "read", resource: "vm", effect: "allow" },
    { action: "read", resource: "sr", effect: "allow" },
    { action: "read", resource: "message", effect: "allow" },
    { action: "read", resource: "alarm", effect: "allow" },
    { action: "read", resource: "backup-log", effect: "allow" },
    { action: "read", resource: "plugin", effect: "allow" },
  ],
};

export const READ_ONLY_TOKEN: FakeXoToken = {
  id: "LB_DqCNhcmAoyiioNnajySHIYHrWfsIhYSYn3n8FfJA",
  userId: READ_ONLY_USER.id,
  // 1 December 2026 - the lab's clock is 18 November 2026 (1795000000).
  expiration: 1796083200000,
};

const OPENMETRICS_CONTENT_TYPE: string =
  "application/openmetrics-text; version=1.0.0; charset=utf-8";

function readCookieToken(cookie: string | undefined): string | null {
  if (!cookie) {
    return null;
  }

  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");

    if (name === "authenticationToken" || name === "token") {
      return rest.join("=");
    }
  }

  return null;
}

export async function startFakeXenOrchestra(options: {
  certificate: TestCertificate;
  settings?: Partial<FakeXoSettings> | undefined;
}): Promise<FakeXenOrchestra> {
  const settings: FakeXoSettings = {
    secret: FAKE_XO_SECRET,
    plugin: "on",
    pluginState: "loaded",
    scrapes: [readScrapeText(1), readScrapeText(2)],
    noPools: false,
    notXenOrchestra: false,
    users: [READ_ONLY_USER],
    tokens: [READ_ONLY_TOKEN],
    // The lab's own moment: 18 November 2026.
    nowMs: 1795000000000,
    ...(options.settings || {}),
  };
  const requests: Array<FakeXoRequest> = [];
  let scrapesServed: number = 0;

  const handler: http.RequestListener = (
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): void => {
    const url: string = request.url || "/";
    requests.push({
      method: request.method || "GET",
      url: url,
      authorization: request.headers["authorization"] || null,
      cookie: request.headers["cookie"] || null,
    });

    const send: (status: number, type: string, body: string) => void = (
      status: number,
      type: string,
      body: string,
    ): void => {
      response.writeHead(status, { "Content-Type": type });
      response.end(body);
    };

    const json: (status: number, body: unknown) => void = (
      status: number,
      body: unknown,
    ): void => {
      send(status, "application/json", JSON.stringify(body));
    };

    if (url.startsWith("/openmetrics/")) {
      if (settings.plugin === "off") {
        return send(500, "text/plain", "There was a problem proxying this request.");
      }

      const pluginPath: string = url.substring("/openmetrics".length);

      if (settings.notXenOrchestra && pluginPath === "/metrics") {
        return send(200, "text/html", "<!doctype html><title>Not XO</title>");
      }

      if (pluginPath === "/health" && request.method === "GET") {
        return json(200, { status: "ok" });
      }

      const auth: string = (request.headers["authorization"] || "").trim();

      if (!auth) {
        return json(401, { error: "Query is not authenticated" });
      }

      if (auth !== `Bearer ${settings.secret}`) {
        return json(401, {
          error: "Query authentication does not match server setting",
        });
      }

      if (pluginPath === "/metrics" && request.method === "GET") {
        if (settings.noPools) {
          return send(200, OPENMETRICS_CONTENT_TYPE, "# No connected hosts\n# EOF");
        }

        const body: string =
          settings.scrapes[Math.min(scrapesServed, settings.scrapes.length - 1)]!;
        scrapesServed++;
        return send(200, OPENMETRICS_CONTENT_TYPE, body);
      }

      return json(404, { error: "Not found" });
    }

    if (url.startsWith("/rest/v0/")) {
      const tokenValue: string | null = readCookieToken(request.headers["cookie"]);
      // Xen Orchestra forgets a token once it expires: it reads as wrong.
      const token: FakeXoToken | undefined = settings.tokens.find(
        (candidate: FakeXoToken) => {
          return (
            candidate.id === tokenValue && candidate.expiration > settings.nowMs
          );
        },
      );

      if (!token) {
        return json(401, { error: "invalid credentials" });
      }

      const user: FakeXoUser | undefined = settings.users.find(
        (candidate: FakeXoUser) => {
          return candidate.id === token.userId;
        },
      );

      if (!user) {
        return json(401, { error: "invalid credentials" });
      }

      const [pathOnly, query] = url.split("?");

      if (pathOnly === "/rest/v0/users/me") {
        response.writeHead(307, { Location: `/rest/v0/users/${user.id}` });
        response.end();
        return;
      }

      if (pathOnly === `/rest/v0/users/${user.id}`) {
        return json(200, {
          email: `${user.name}@example.test`,
          permission: user.permission,
          pw_hash: "***obfuscated***",
          groups: [],
          name: user.name,
          preferences: {},
          id: user.id,
        });
      }

      if (pathOnly === `/rest/v0/users/${user.id}/authentication_tokens`) {
        return json(
          200,
          settings.tokens
            .filter((candidate: FakeXoToken) => {
              return candidate.userId === user.id;
            })
            .map((candidate: FakeXoToken) => {
              return {
                client: { id: `client-${candidate.id.slice(0, 4)}` },
                created_at: candidate.expiration - 30 * 86400 * 1000,
                description: "xo-cli@0.32.2 - oneuptime",
                user_id: candidate.userId,
                expiration: candidate.expiration,
                id: candidate.id,
              };
            }),
        );
      }

      if (pathOnly === `/rest/v0/users/${user.id}/acl-privileges`) {
        // Without fields, a list of hrefs - with them, the objects.
        if (!query || !query.includes("fields=")) {
          return json(
            200,
            user.privileges.map((_privilege: unknown, index: number) => {
              return `/rest/v0/acl-privileges/${index}`;
            }),
          );
        }

        return json(
          200,
          user.permission === "admin"
            ? []
            : user.privileges.map(
                (privilege: { action: string; resource: string; effect?: string }, index: number) => {
                  return {
                    action: privilege.action,
                    resource: privilege.resource,
                    effect: privilege.effect || "allow",
                    href: `/rest/v0/acl-privileges/${index}`,
                  };
                },
              ),
        );
      }

      if (pathOnly === "/rest/v0/plugins/openmetrics") {
        if (settings.pluginState === "missing") {
          return json(404, { error: "no such plugin openmetrics" });
        }

        return json(200, {
          id: "openmetrics",
          name: "openmetrics",
          autoload: true,
          loaded: settings.pluginState === "loaded",
          unloadable: true,
          version: "1.9.4",
          configured: true,
        });
      }

      return json(404, { error: "Not found" });
    }

    return send(404, "text/html", "<!doctype html><title>Xen Orchestra</title>");
  };

  const server: https.Server = https.createServer(
    { cert: options.certificate.cert, key: options.certificate.key },
    handler,
  );

  const port: number = await new Promise<number>(
    (resolve: (port: number) => void) => {
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as AddressInfo).port);
      });
    },
  );

  return {
    port: port,
    settings: settings,
    requests: requests,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
}
