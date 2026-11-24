import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OutboundFetch from "Common/Server/Utils/OutboundFetch";
import {
  LocalHttpServer,
  PROXY_HOST_NAME,
  ProxyCredentials,
  PLAIN_CREDENTIALS,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
  watchLookups,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import { fetchArchiveOverHttp } from "../Utils/Books/BookStore";
import {
  INDEXNOW_ENDPOINT,
  getIndexNowRequests,
  sendIndexNowRequest,
} from "../Utils/IndexNow";

/*
 * THE MARKETING SITE'S REQUESTS GO THROUGH THE OUTBOUND PROXY, AS EVERY
 * REQUEST OF THE SERVER DOES (issue #10720).
 *
 * The site ships with every install. Its book reader downloads each book's
 * EPUB, and oneuptime.com's tells IndexNow of the blog's changes, each with
 * Node's fetch, which reads no HTTPS_PROXY. Both go through OutboundFetch
 * now. These send through each one's code to a proxy and servers on this
 * machine (OutboundProxyFixture); nothing leaves it.
 */

clearOutboundProxyEnvironmentForEachTest();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(async () => {
  await OutboundFetch.destroySharedDispatchers();
  jest.restoreAllMocks();
});

const INDEXNOW_HOST: string = new URL(INDEXNOW_ENDPOINT).host;
const LIMITS: { timeoutMs: number; maxBytes: number } = {
  timeoutMs: 5000,
  maxBytes: 1024 * 1024,
};

async function failureOf(sending: Promise<unknown>): Promise<Error> {
  try {
    await sending;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The request went through.");
}

function notifyIndexNow(): Promise<number> {
  return sendIndexNowRequest(
    getIndexNowRequests("oneuptime.com", [
      "https://oneuptime.com/blog/post/a-post/view",
    ])[0]!,
  );
}

describe.each([
  {
    kind: "with @, : and % in it",
    credentials: RESERVED_CHARACTER_CREDENTIALS,
  },
  { kind: "with no character a URL reserves", credentials: PLAIN_CREDENTIALS },
])(
  "behind a proxy that checks a password $kind",
  (data: { kind: string; credentials: ProxyCredentials }) => {
    test("a notice to IndexNow goes through it, and IndexNow's host is not looked up here", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );
      const lookups: Array<string> = watchLookups([INDEXNOW_HOST]);

      await failureOf(notifyIndexNow());

      expect(proxy.connects).toEqual([`${INDEXNOW_HOST}:443`]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
      expect(lookups).not.toContain(INDEXNOW_HOST);
    });

    test("a book's EPUB over http: the proxy is sent the whole URL, signed in with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );

      const archive: Buffer = await fetchArchiveOverHttp(
        "http://books.example.test/book.epub",
        LIMITS,
      );

      expect(JSON.parse(archive.toString("utf8"))).toEqual({
        answeredBy: "proxy",
      });
      expect(
        proxy.requests.map((seen: { url: string }): string => {
          return seen.url;
        }),
      ).toEqual(["http://books.example.test/book.epub"]);
      expect(proxy.requestCredentials).toEqual([signedInAs(data.credentials)]);
    });

    test("a book's EPUB over https: the CONNECT is signed in with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        data.credentials,
      );

      await failureOf(
        fetchArchiveOverHttp("https://books.example.test/book.epub", LIMITS),
      );

      expect(proxy.connects).toEqual(["books.example.test:443"]);
      expect(proxy.connectCredentials).toEqual([signedInAs(data.credentials)]);
    });
  },
);

describe("a request the proxy refuses", () => {
  test("is said as the proxy's refusal, never naming the proxy", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(notifyIndexNow());

    expect(failure.message).toBe(
      `The outbound proxy did not open a connection to ${INDEXNOW_HOST}:443: it answered 403 Forbidden. The request was not sent. Ask whoever runs this OneUptime server to let the proxy reach that host.`,
    );
    expect(failure.message).not.toContain(PROXY_HOST_NAME);
    expect(failure.message).not.toContain(String(proxy.port));
  });

  test("a 407 is the proxy not taking OneUptime's user name and password", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    proxy.connectStatusLine = "HTTP/1.1 407 Proxy Authentication Required";
    process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );

    const failure: Error = await failureOf(
      fetchArchiveOverHttp("https://books.example.test/book.epub", LIMITS),
    );

    expect(failure.message).toBe(
      "The outbound proxy answered 407 Proxy Authentication Required: it did not take OneUptime's user name and password, so the request to books.example.test:443 was not sent. Ask whoever runs this OneUptime server to check the user name and password in HTTPS_PROXY, HTTP_PROXY or ALL_PROXY.",
    );
  });
});

describe("going directly", () => {
  test("a host in NO_PROXY is sent to directly, and the proxy is never asked", async () => {
    const proxy: LocalHttpServer = await serve({ name: "proxy" });
    const books: LocalHttpServer = await serve({ name: "books" });
    process.env["HTTP_PROXY"] = proxyUrlWithCredentials(
      proxy.port,
      RESERVED_CHARACTER_CREDENTIALS,
    );
    process.env["HTTPS_PROXY"] = process.env["HTTP_PROXY"];
    process.env["NO_PROXY"] = `127.0.0.1, ${INDEXNOW_HOST}`;
    const lookups: Array<string> = watchLookups([INDEXNOW_HOST]);

    const archive: Buffer = await fetchArchiveOverHttp(
      books.url("/book.epub"),
      LIMITS,
    );
    await failureOf(notifyIndexNow());

    expect(JSON.parse(archive.toString("utf8"))).toEqual({
      answeredBy: "books",
    });
    expect(lookups).toContain(INDEXNOW_HOST);
    expect(proxy.isUntouched).toBe(true);
  });

  test("with no proxy at all, each is sent directly", async () => {
    const books: LocalHttpServer = await serve({ name: "books" });
    const lookups: Array<string> = watchLookups([INDEXNOW_HOST]);

    const archive: Buffer = await fetchArchiveOverHttp(
      books.url("/book.epub"),
      LIMITS,
    );
    await failureOf(notifyIndexNow());

    expect(archive.length).toBeGreaterThan(0);
    expect(books.requestCredentials).toEqual([""]);
    expect(lookups).toContain(INDEXNOW_HOST);
  });
});
