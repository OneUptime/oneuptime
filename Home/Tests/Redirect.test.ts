import { appendQueryFrom, redirectPreservingQuery } from "../Utils/Redirect";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
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

  test("a temporary redirect passes no status code, so Express defaults to 302", () => {
    const recorded: RecordedRedirect = { statusCode: null, url: null };

    redirectPreservingQuery(
      makeRequest("/on-call?gclid=abc"),
      makeResponse(recorded),
      "/product/on-call",
    );

    expect(recorded.statusCode).toBeNull();
    expect(recorded.url).toBe("/product/on-call?gclid=abc");
  });
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

  test("the only remaining res.redirect calls are the external install scripts", () => {
    const remaining: RegExpMatchArray | null =
      routesSource.match(/res\.redirect\(/g);

    expect(remaining).toHaveLength(2);
    expect(routesSource).toContain(
      "https://raw.githubusercontent.com/OneUptime/oneuptime/release/Home/Scripts/Install.sh",
    );
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
  ])(
    "%s redirects through the query-preserving helper",
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

      expect(body).toContain(`redirectPreservingQuery(req, res, "${target}"`);
      expect(body).not.toContain("_req");
    },
  );
});
