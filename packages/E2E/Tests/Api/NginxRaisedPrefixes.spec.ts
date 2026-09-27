import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * Deployment contract for the prefixes nginx RAISES above `location /`.
 *
 * A status page served on a customer's own domain does not talk to /api. It
 * talks to /status-page-api/, and nginx rewrites that to /api/status-page/ on
 * the way in. Same for its SSO, OIDC and identity calls, and for a public
 * dashboard's /public-dashboard-api/. Those five prefixes exist ONLY as nginx
 * location blocks with a rewrite; nothing in the app knows the public spelling.
 *
 * Nothing unit-testable covers that, and the failure mode is both silent and
 * complete. `location /` forwards everything it is given to the app, which
 * serves the SPA for an unknown path - so a prefix that stops being raised
 * does not 502 or log an error. It starts answering HTML. Every status-page
 * API call then receives a web page where it expected JSON, on every custom
 * domain at once, while the stack looks entirely healthy and /api keeps
 * working.
 *
 * It is also duplicated, which is the reason this is worth pinning: the same
 * blocks are declared three times in packages/Nginx/default.conf.template, once
 * per server block (default host, the configured HOST, and custom domains). A
 * prefix added or corrected in one and missed in another breaks exactly one
 * class of deployment.
 *
 * HOW THE ASSERTION WORKS
 *
 * Each prefix is asked for a path that is deliberately not a route. A raised
 * prefix reaches the app, which answers its own JSON 404 naming the path it
 * received AFTER the rewrite - so one request proves the prefix is mounted,
 * that it reaches the app rather than nginx answering it, and that the rewrite
 * put it at the right internal path with its suffix intact. An unraised path
 * falls through to `location /` and comes back as SPA HTML instead, which is
 * what the control test below pins - it is what makes a JSON body meaningful
 * rather than incidental.
 *
 * The probe suffix keeps this stable: these paths cannot stop being 404s
 * because no route will ever be added at them. Every expectation here,
 * including the control, was read off a running stack rather than assumed.
 */

/*
 * Not a route, and never will be - which is what makes the 404 below a
 * permanent property rather than a snapshot of today's route table.
 */
const PROBE_SUFFIX: string = "e2e-nginx-raised-prefix-probe";

const endpointFor: (path: string) => string = (path: string): string => {
  return URL.fromString(BASE_URL.toString()).addRoute(path).toString();
};

interface RaisedPrefix {
  /* What a browser on a status-page domain actually requests. */
  publicPath: string;
  /* Where nginx's rewrite must land it inside the app. */
  internalPath: string;
  /* What breaks, in one line, if this prefix stops being raised. */
  serves: string;
}

/*
 * The five rewritten prefixes, plus the two that are raised and pass through
 * unchanged. /otlp and /telemetry are in the same list because they are raised
 * for the same reason - a collector posts to them on a status-page host too -
 * and their contract is that the path arrives UNREWRITTEN.
 */
const RAISED_PREFIXES: Array<RaisedPrefix> = [
  {
    publicPath: "/status-page-api",
    internalPath: "/api/status-page",
    serves: "a status page's own API calls on a custom domain",
  },
  {
    publicPath: "/status-page-sso-api",
    internalPath: "/api/identity/status-page-sso",
    serves: "SAML SSO login to a private status page",
  },
  {
    publicPath: "/status-page-oidc-api",
    internalPath: "/api/identity/status-page-oidc",
    serves: "OIDC login to a private status page",
  },
  {
    publicPath: "/status-page-identity-api",
    internalPath: "/api/identity/status-page",
    serves: "status-page login, invites and password resets",
  },
  {
    publicPath: "/public-dashboard-api",
    internalPath: "/api/dashboard",
    serves: "a publicly shared dashboard's data reads",
  },
  {
    publicPath: "/otlp",
    internalPath: "/otlp",
    serves: "OpenTelemetry ingest (raised, and deliberately NOT rewritten)",
  },
  {
    publicPath: "/telemetry",
    internalPath: "/telemetry",
    serves: "telemetry ingest (raised, and deliberately NOT rewritten)",
  },
];

interface NotFoundBody {
  message?: string;
}

test.describe("nginx raises the status-page and dashboard API prefixes", () => {
  for (const prefix of RAISED_PREFIXES) {
    test(`${prefix.publicPath}/ reaches the app at ${prefix.internalPath}/ — ${prefix.serves}`, async ({
      page,
    }: {
      page: Page;
    }): Promise<void> => {
      page.setDefaultNavigationTimeout(120000);

      const response: APIResponse = await page.request.get(
        endpointFor(`${prefix.publicPath}/${PROBE_SUFFIX}`),
      );

      /*
       * JSON is the whole signal. The app answers unknown routes with JSON;
       * `location /` answers them with the SPA's HTML. Asserting the
       * content-type first means a prefix that stopped being raised fails
       * here, with "text/html" in the message, rather than further down on a
       * confusing JSON parse error.
       */
      const contentType: string = response.headers()["content-type"] || "";
      expect(contentType).toContain("application/json");

      expect(response.status()).toBe(404);

      /*
       * The app names the path it was given, so this is the rewrite's output
       * read back - including the suffix, which is nginx's $1 capture. A
       * rewrite that dropped the capture would answer about the prefix alone
       * and fail here.
       */
      const body: NotFoundBody = (await response.json()) as NotFoundBody;
      expect(body.message).toContain(`${prefix.internalPath}/${PROBE_SUFFIX}`);
    });
  }

  test("a path nginx does NOT raise falls through to the SPA, not the API", async ({
    page,
  }: {
    page: Page;
  }): Promise<void> => {
    /*
     * The control, and the reason every assertion above means anything. If an
     * unraised path ALSO came back as JSON, then "it answered JSON" would say
     * nothing about whether the prefix was raised, and this whole file would
     * pass with every location block deleted.
     */
    page.setDefaultNavigationTimeout(120000);

    const response: APIResponse = await page.request.get(
      endpointFor(`/${PROBE_SUFFIX}-unraised/${PROBE_SUFFIX}`),
    );

    const contentType: string = response.headers()["content-type"] || "";
    expect(contentType).toContain("text/html");
  });
});
