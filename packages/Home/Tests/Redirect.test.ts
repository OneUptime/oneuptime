import {
  appendQueryFrom,
  redirectPreservingQuery,
  RedirectStatusCode,
} from "../Utils/Redirect";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { escapeRegExp } from "Common/Utils/RegExpEscape";
import { DEMO_PAGE_PATH, DEMO_SHORT_PATHS } from "../Utils/DemoPage";
import fs from "fs";
import path from "path";

/*
 * A paid click arrives carrying gclid, and nothing downstream can recover a
 * campaign once that parameter is gone. These assert the two halves that keep
 * it: the helper joins the query onto the target correctly, and every internal
 * redirect in the route table actually goes through the helper.
 *
 * Express is never booted here — Routes.test.ts documents why — so the routing
 * half is a source scan.
 */

interface RecordedRedirect {
  statusCode: number | null;
  url: string | null;
}

type MakeRequestFunction = (originalUrl: string) => ExpressRequest;

const makeRequest: MakeRequestFunction = (
  originalUrl: string,
): ExpressRequest => {
  return { originalUrl: originalUrl } as ExpressRequest;
};

type MakeResponseFunction = (recorded: RecordedRedirect) => ExpressResponse;

const makeResponse: MakeResponseFunction = (
  recorded: RecordedRedirect,
): ExpressResponse => {
  return {
    redirect: (first: number | string, second?: string): void => {
      if (typeof first === "number") {
        recorded.statusCode = first;
        recorded.url = second ?? null;
        return;
      }

      recorded.statusCode = null;
      recorded.url = first;
    },
  } as unknown as ExpressResponse;
};

type PermanentRedirectCallFunction = (target: string) => RegExp;

/*
 * A call to the helper that names `target` and a permanent 301, laid out the
 * way Prettier lays it out: on one line, or one argument per line once it no
 * longer fits.
 */
const permanentRedirectCall: PermanentRedirectCallFunction = (
  target: string,
): RegExp => {
  const escapedTarget: string = escapeRegExp(target);

  return new RegExp(
    `redirectPreservingQuery\\(\\s*req,\\s*res,\\s*"${escapedTarget}",\\s*301,?\\s*\\)`,
  );
};

describe("appendQueryFrom", () => {
  test("a Google Ads click keeps its gclid across the redirect", () => {
    expect(
      appendQueryFrom(
        makeRequest("/self-hosted?gclid=EAIaIQobChMI"),
        "/enterprise/self-hosted",
      ),
    ).toBe("/enterprise/self-hosted?gclid=EAIaIQobChMI");
  });

  test("the full auto-tagging suffix survives, in its original order", () => {
    const query: string =
      "utm_source=google&utm_medium=cpc&utm_campaign=123&utm_content=456&utm_term=datadog+alternative&gclid=abc";

    expect(
      appendQueryFrom(makeRequest(`/on-call?${query}`), "/product/on-call"),
    ).toBe(`/product/on-call?${query}`);
  });

  test("percent-encoding is preserved byte for byte", () => {
    /*
     * Re-serialising through URLSearchParams would turn %2B into a space and
     * reorder the keys. The attribution capture stores whatever bytes it is
     * given, so the campaign name has to arrive unchanged.
     */
    expect(
      appendQueryFrom(
        makeRequest("/security?utm_campaign=brand%20%2B%20competitor"),
        "/trust",
      ),
    ).toBe("/trust?utm_campaign=brand%20%2B%20competitor");
  });

  test("repeated parameters are not collapsed", () => {
    expect(
      appendQueryFrom(
        makeRequest("/status-page?utm_source=a&utm_source=b"),
        "/product/status-page",
      ),
    ).toBe("/product/status-page?utm_source=a&utm_source=b");
  });

  test("no query means no trailing question mark", () => {
    expect(
      appendQueryFrom(makeRequest("/on-premise"), "/enterprise/self-hosted"),
    ).toBe("/enterprise/self-hosted");
  });

  test("a bare question mark does not become a bare question mark", () => {
    expect(
      appendQueryFrom(makeRequest("/on-premise?"), "/enterprise/self-hosted"),
    ).toBe("/enterprise/self-hosted");
  });

  test("only the first question mark splits the URL", () => {
    expect(
      appendQueryFrom(makeRequest("/security?next=/a?b=c"), "/trust"),
    ).toBe("/trust?next=/a?b=c");
  });

  test("a target that already carries a query is joined with an ampersand", () => {
    expect(
      appendQueryFrom(makeRequest("/security?gclid=abc"), "/trust?ref=nav"),
    ).toBe("/trust?ref=nav&gclid=abc");
  });

  test("a missing originalUrl is survivable", () => {
    expect(appendQueryFrom({} as ExpressRequest, "/trust")).toBe("/trust");
  });
});

describe("redirectPreservingQuery", () => {
  test("a permanent redirect keeps its 301 and its query", () => {
    const recorded: RecordedRedirect = { statusCode: null, url: null };

    redirectPreservingQuery(
      makeRequest("/self-hosted?gclid=abc"),
      makeResponse(recorded),
      "/enterprise/self-hosted",
      301,
    );

    expect(recorded.statusCode).toBe(301);
    expect(recorded.url).toBe("/enterprise/self-hosted?gclid=abc");
  });

  test("a temporary redirect has to ask for one, and gets exactly that", () => {
    const recorded: RecordedRedirect = { statusCode: null, url: null };

    redirectPreservingQuery(
      makeRequest("/on-call?gclid=abc"),
      makeResponse(recorded),
      "/product/on-call",
      302,
    );

    expect(recorded.statusCode).toBe(302);
    expect(recorded.url).toBe("/product/on-call?gclid=abc");
  });

  test.each([[301], [302], [303], [307], [308]] as Array<[RedirectStatusCode]>)(
    "a %d reaches Express as given, never left to Express's 302 default",
    (statusCode: RedirectStatusCode) => {
      /*
       * Leaving the status out is how /on-call and /incident-management came
       * to answer with a temporary 302 for years. Express only picks its
       * default when it is handed a bare URL, so the helper must never hand it
       * one.
       */
      const recorded: RecordedRedirect = { statusCode: null, url: null };

      redirectPreservingQuery(
        makeRequest("/incident-management?utm_source=x"),
        makeResponse(recorded),
        "/product/incident-management",
        statusCode,
      );

      expect(recorded.statusCode).toBe(statusCode);
      expect(recorded.url).toBe("/product/incident-management?utm_source=x");
    },
  );
});

/*
 * The helper being correct is worth nothing if a route still calls
 * res.redirect directly, and that is exactly the regression this guards: the
 * defect was invisible for the whole life of the route table.
 */
describe("route table wiring", () => {
  const routesSource: string = fs.readFileSync(
    path.join(__dirname, "..", "Routes.ts"),
    "utf-8",
  );

  test("no internal redirect calls res.redirect with a literal path", () => {
    const internalRedirects: RegExpMatchArray | null = routesSource.match(
      /res\.redirect\((?:\d{3},\s*)?"\//g,
    );

    expect(internalRedirects).toBeNull();
  });

  test("the only remaining res.redirect call is the infrastructure agent installer", () => {
    const remaining: RegExpMatchArray | null =
      routesSource.match(/res\.redirect\(/g);

    expect(remaining).toHaveLength(1);
    /*
     * The OneUptime installer is served from the image, never redirected to
     * raw GitHub (under any path the script has lived at).
     */
    expect(routesSource).not.toMatch(
      /raw\.githubusercontent\.com\/OneUptime\/oneuptime\/[^"]*Home\/Scripts\/Install\.sh/,
    );
  });

  test("/install.sh serves the installer shipped in the image", () => {
    const configSource: string = fs.readFileSync(
      path.join(__dirname, "..", "Utils", "Config.ts"),
      "utf-8",
    );
    const dockerfileTemplate: string = fs.readFileSync(
      path.join(__dirname, "..", "Dockerfile.tpl"),
      "utf-8",
    );

    expect(routesSource).toContain("res.sendFile(InstallScriptPath)");
    expect(configSource).toContain(
      'export const InstallScriptPath: string = "/usr/src/app/Scripts/Install.sh";',
    );
    // The image puts the Home package at /usr/src/app, so the script ships there.
    expect(dockerfileTemplate).toMatch(
      /^COPY\s+(?:--chown=\S+\s+)?\.\/(?:\S+\/)?Home \/usr\/src\/app$/m,
    );
    expect(
      fs.existsSync(path.join(__dirname, "..", "Scripts", "Install.sh")),
    ).toBe(true);

    /*
     * What the E2E (Tests/Home/InstallScript.spec.ts) reads from the body
     * /install.sh serves: a bash shebang and the installer saying what it
     * installs. Held here on every commit, so a rewrite of the script
     * updates the E2E with it instead of failing only when a release is cut.
     */
    const installer: string = fs.readFileSync(
      path.join(__dirname, "..", "Scripts", "Install.sh"),
      "utf-8",
    );

    expect(installer).toMatch(/^#!(?:\/usr\/bin\/env bash|\/bin\/bash)\n/);
    expect(installer).toContain("Installs OneUptime with Docker Compose");
  });

  test.each([
    ["/self-hosted", "/enterprise/self-hosted"],
    ["/self-hosting", "/enterprise/self-hosted"],
    ["/on-premise", "/enterprise/self-hosted"],
    ["/security", "/trust"],
    ["/security-center", "/trust"],
    ["/trust-center", "/trust"],
    ["/status-page", "/product/status-page"],
    ["/logs-management", "/product/logs-management"],
    ["/workflows", "/product/workflows"],
    ["/runbooks", "/product/runbooks"],
    ["/on-call", "/product/on-call"],
    ["/scheduled-maintenance", "/product/scheduled-maintenance"],
    ["/incident-management", "/product/incident-management"],
    ["/ai-agent", "/product/ai-agent"],
    // oneuptime.com/demo and the demo page's other short addresses.
    ...DEMO_SHORT_PATHS.map((shortPath: string): [string, string] => {
      return [shortPath, DEMO_PAGE_PATH];
    }),
  ])(
    "%s redirects permanently through the query-preserving helper",
    (routePath: string, target: string) => {
      const declaration: number = routesSource.indexOf(
        `app.get("${routePath}"`,
      );
      const multiLine: number = routesSource.indexOf(
        `app.get(\n      "${routePath}",`,
      );
      const start: number = declaration === -1 ? multiLine : declaration;

      expect(start).toBeGreaterThan(-1);

      const rest: string = routesSource.slice(start);
      const nextRoute: number = rest.indexOf("app.get(", 1);
      const body: string = nextRoute === -1 ? rest : rest.slice(0, nextRoute);

      expect(body).toMatch(permanentRedirectCall(target));
      expect(body).not.toContain("_req");
    },
  );

  test("every redirect in the route table is a permanent 301", () => {
    /*
     * Each of these is an alias for a page that has moved for good. A new
     * one that genuinely is temporary should be argued for here, not slip in.
     */
    const calls: number = (
      routesSource.match(/redirectPreservingQuery\(/g) || []
    ).length;
    const permanentCalls: number = (
      routesSource.match(
        /redirectPreservingQuery\(\s*req,\s*res,\s*"[^"]+",\s*301,?\s*\)/g,
      ) || []
    ).length;

    expect(calls).toBeGreaterThanOrEqual(14);
    expect(permanentCalls).toBe(calls);
  });

  test("the infrastructure agent installer stays a temporary redirect", () => {
    /*
     * Deliberately not a 301. It points at a file on a branch of the
     * repository, which is where the script happens to live today; a 301 is
     * cached by browsers and proxies for good, so a client that once saw one
     * would keep fetching that address after the script moved or came to be
     * served from this image, as /install.sh now is. It is not a page, so no
     * search ranking rides on it either.
     */
    expect(routesSource).toMatch(
      /app\.get\(\s*"\/infrastructure-agent\/install\.sh",[\s\S]{0,400}?res\.redirect\(\s*"https:\/\/raw\.githubusercontent\.com\/OneUptime\/oneuptime\/release\//,
    );
  });
});

describe("blog route wiring", () => {
  const blogApiSource: string = fs.readFileSync(
    path.join(__dirname, "..", "API", "BlogAPI.ts"),
    "utf-8",
  );

  test("an old blog post address moves permanently to the post", () => {
    const start: number = blogApiSource.indexOf('"/blog/post/:file",');

    expect(start).toBeGreaterThan(-1);

    const rest: string = blogApiSource.slice(start);
    const body: string = rest.slice(0, rest.indexOf("app.get("));

    /*
     * The post's own address is /view and always will be. Common's
     * Response.redirect sends Express's default 302, which kept the old
     * address in search results in place of the post's.
     */
    expect(body).toMatch(
      /redirectPreservingQuery\(\s*req,\s*res,\s*`\/blog\/post\/\$\{encodeURIComponent\(fileName\)\}\/view`,\s*301,?\s*\)/,
    );
  });

  /*
   * Every redirect the blog sends names its status. A res.redirect whose first
   * argument is not a status code is Express's temporary 302 default. The
   * pagination and tag-feed redirects call res.redirect(301, ...) directly
   * rather than redirectPreservingQuery, because they drop the page and
   * pageSize parameters the helper would carry over.
   */
  test("the blog serves no redirect through Express's 302 default", () => {
    expect(blogApiSource).not.toContain("Response.redirect(");
    expect(blogApiSource).not.toMatch(/res\.redirect\((?!\s*30[1-8]\b)/);
  });
});
