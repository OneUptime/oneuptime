import http from "http";
import { AddressInfo } from "net";
import crypto from "crypto";
import logger from "Common/Server/Utils/Logger";
import BookStore, {
  ArchiveFetcher,
  BOOK_PAYLOAD_VERSION,
  BookPayload,
  BookUnavailableError,
  buildBookPayload,
  DefaultBookStore,
  fetchArchiveOverHttp,
  LoadedBook,
} from "../../Utils/Books/BookStore";
import { BackToMetal } from "../../Utils/Books/BookCatalog";
import { parseEpub, ParsedEpub } from "../../Utils/Books/Epub";
import { buildEpub } from "./Helpers/EpubFixture";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
    },
  };
});

/*
 * BookStore loads a book's EPUB, parses it and keeps it in memory. The
 * fetcher and the clock are injected, so every cache transition here is
 * driven explicitly; fetchArchiveOverHttp is exercised against a real local
 * HTTP server.
 */

const SLUG: string = BackToMetal.slug;
const FRESH_FOR_MS: number = 60 * 60 * 1000;
const RETRY_AFTER_MS: number = 60 * 1000;
const ETAG_PATTERN: RegExp = /^"[A-Za-z0-9_-]{32}"$/;

type FetchMock = jest.MockedFunction<ArchiveFetcher>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const deferred: <T>() => Deferred<T> = <T>(): Deferred<T> => {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (reason: unknown) => void): void => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
};

const flush: () => Promise<void> = async (): Promise<void> => {
  for (let index: number = 0; index < 5; index++) {
    await new Promise<void>((resolve: () => void): void => {
      setImmediate(resolve);
    });
  }
};

const catchRejection: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the promise to reject.");
};

const SECOND_EDITION: Buffer = buildEpub({
  metadata: { title: "Back to Metal, Second Edition" },
});

describe("BookStore", () => {
  let time: number;
  let fetchArchive: FetchMock;
  let store: BookStore;

  const now: () => number = (): number => {
    return time;
  };

  beforeEach(() => {
    time = 1_000_000;
    fetchArchive = jest.fn() as FetchMock;
    fetchArchive.mockResolvedValue(buildEpub());
    store = new BookStore({
      fetchArchive,
      now,
      freshForMs: FRESH_FOR_MS,
      retryAfterFailureMs: RETRY_AFTER_MS,
      timeoutMs: 1234,
      maxBytes: 5678,
    });
    jest.mocked(logger.error).mockClear();
  });

  describe("loading", () => {
    test("resolves the parsed book as a payload, its JSON and an ETag", async () => {
      const loaded: LoadedBook | null = await store.getBook(SLUG);
      const parsed: ParsedEpub = parseEpub(buildEpub());

      expect(loaded).not.toBeNull();
      expect(loaded!.payload).toEqual(buildBookPayload(BackToMetal, parsed));
      expect(loaded!.json).toBe(JSON.stringify(loaded!.payload));
      expect(loaded!.etag).toMatch(ETAG_PATTERN);
      expect(loaded!.etag).toBe(
        `"${crypto.createHash("sha256").update(loaded!.json).digest("base64url").slice(0, 32)}"`,
      );
      expect(loaded!.loadedAt).toBe(time);
    });

    test("asks the fetcher for the catalog's EPUB with the configured limits", async () => {
      await store.getBook(SLUG);

      expect(fetchArchive).toHaveBeenCalledTimes(1);
      expect(fetchArchive).toHaveBeenCalledWith(BackToMetal.epubUrl, {
        timeoutMs: 1234,
        maxBytes: 5678,
      });
    });

    test("the payload carries the sections and table of contents the reader needs", async () => {
      const payload: BookPayload = (await store.getBook(SLUG))!.payload;

      expect(payload.sections.length).toBeGreaterThan(5);
      expect(payload.toc.length).toBeGreaterThan(3);
      expect(payload).toMatchObject({
        version: BOOK_PAYLOAD_VERSION,
        slug: "back-to-metal",
        title: "Back to Metal",
        subtitle: "How a company leaves the cloud, one move at a time",
        author: "Nawaz Dhandala",
        publisher: "HackerBay, Inc.",
        language: "en",
        modified: "2026-09-14T15:33:10Z",
        coverUrl: BackToMetal.coverPath,
        siteUrl: BackToMetal.siteUrl,
        epubUrl: BackToMetal.epubUrl,
        pdfUrl: BackToMetal.pdfUrl,
        license: BackToMetal.license,
      });
    });

    test("an unknown book resolves null without fetching anything", async () => {
      await expect(store.getBook("not-a-book")).resolves.toBeNull();
      await expect(store.getBook("")).resolves.toBeNull();
      expect(fetchArchive).not.toHaveBeenCalled();
    });

    test("concurrent requests share one download", async () => {
      const download: Deferred<Buffer> = deferred<Buffer>();
      fetchArchive.mockReturnValueOnce(download.promise);

      const first: Promise<LoadedBook | null> = store.getBook(SLUG);
      const second: Promise<LoadedBook | null> = store.getBook(SLUG);
      const third: Promise<LoadedBook | null> = store.getBook(SLUG);

      download.resolve(buildEpub());

      const results: Array<LoadedBook | null> = await Promise.all([
        first,
        second,
        third,
      ]);

      expect(fetchArchive).toHaveBeenCalledTimes(1);
      expect(results[1]).toBe(results[0]);
      expect(results[2]).toBe(results[0]);
    });

    test("identical editions have identical ETags; a new edition gets a new one", async () => {
      const other: BookStore = new BookStore({ fetchArchive, now });
      const first: LoadedBook = (await store.getBook(SLUG))!;
      const same: LoadedBook = (await other.getBook(SLUG))!;

      fetchArchive.mockResolvedValue(SECOND_EDITION);
      const third: BookStore = new BookStore({ fetchArchive, now });
      const changed: LoadedBook = (await third.getBook(SLUG))!;

      expect(same.etag).toBe(first.etag);
      expect(changed.etag).not.toBe(first.etag);
      expect(changed.payload.title).toBe("Back to Metal, Second Edition");
    });
  });

  describe("caching", () => {
    test("a fresh copy is served from memory", async () => {
      const first: LoadedBook = (await store.getBook(SLUG))!;

      time += FRESH_FOR_MS - 1;

      await expect(store.getBook(SLUG)).resolves.toBe(first);
      await expect(store.getBook(SLUG)).resolves.toBe(first);
      expect(fetchArchive).toHaveBeenCalledTimes(1);
    });

    test("a stale copy is served at once while exactly one refresh runs", async () => {
      const first: LoadedBook = (await store.getBook(SLUG))!;
      const refresh: Deferred<Buffer> = deferred<Buffer>();
      fetchArchive.mockReturnValueOnce(refresh.promise);

      time += FRESH_FOR_MS;

      await expect(store.getBook(SLUG)).resolves.toBe(first);
      await expect(store.getBook(SLUG)).resolves.toBe(first);
      await expect(store.getBook(SLUG)).resolves.toBe(first);
      expect(fetchArchive).toHaveBeenCalledTimes(2);

      refresh.resolve(SECOND_EDITION);
      await flush();

      const refreshed: LoadedBook = (await store.getBook(SLUG))!;

      expect(refreshed).not.toBe(first);
      expect(refreshed.payload.title).toBe("Back to Metal, Second Edition");
      expect(refreshed.loadedAt).toBe(time);
      expect(store.peek(SLUG)).toBe(refreshed);
      expect(fetchArchive).toHaveBeenCalledTimes(2);
    });

    test("the refreshed copy is fresh again for another freshForMs", async () => {
      await store.getBook(SLUG);
      time += FRESH_FOR_MS;
      await store.getBook(SLUG);
      await flush();

      time += FRESH_FOR_MS - 1;
      await store.getBook(SLUG);
      await flush();

      expect(fetchArchive).toHaveBeenCalledTimes(2);
    });

    test("a failed refresh keeps the stale copy in service", async () => {
      const first: LoadedBook = (await store.getBook(SLUG))!;
      fetchArchive.mockRejectedValueOnce(new Error("upstream is down"));

      time += FRESH_FOR_MS;

      await expect(store.getBook(SLUG)).resolves.toBe(first);
      await flush();

      await expect(store.getBook(SLUG)).resolves.toBe(first);
      expect(store.peek(SLUG)).toBe(first);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("upstream is down"),
        expect.anything(),
      );
    });

    test("after a failed refresh, the next refresh waits for retryAfterFailureMs", async () => {
      await store.getBook(SLUG);
      fetchArchive.mockRejectedValueOnce(new Error("upstream is down"));
      time += FRESH_FOR_MS;
      await store.getBook(SLUG);
      await flush();
      expect(fetchArchive).toHaveBeenCalledTimes(2);

      time += RETRY_AFTER_MS - 1;
      await store.getBook(SLUG);
      await flush();
      expect(fetchArchive).toHaveBeenCalledTimes(2);

      time += 1;
      fetchArchive.mockResolvedValueOnce(SECOND_EDITION);
      await store.getBook(SLUG);
      await flush();
      expect(fetchArchive).toHaveBeenCalledTimes(3);
      expect(store.peek(SLUG)!.payload.title).toBe(
        "Back to Metal, Second Edition",
      );
    });

    test("peek never loads", async () => {
      expect(store.peek(SLUG)).toBeNull();
      expect(store.peek("not-a-book")).toBeNull();
      expect(fetchArchive).not.toHaveBeenCalled();

      const loaded: LoadedBook = (await store.getBook(SLUG))!;

      expect(store.peek(SLUG)).toBe(loaded);
    });

    test("clear forgets every book", async () => {
      await store.getBook(SLUG);
      store.clear();

      expect(store.peek(SLUG)).toBeNull();
      await store.getBook(SLUG);
      expect(fetchArchive).toHaveBeenCalledTimes(2);
    });
  });

  describe("failures with nothing cached", () => {
    test("reject with BookUnavailableError and are logged", async () => {
      fetchArchive.mockRejectedValueOnce(new Error("connection refused"));

      const error: unknown = await catchRejection(store.getBook(SLUG));

      expect(error).toBeInstanceOf(BookUnavailableError);
      expect((error as Error).message).toContain("connection refused");
      expect((error as Error).message).toContain(BackToMetal.title);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(jest.mocked(logger.error).mock.calls[0]![0]).toContain(SLUG);
      expect(store.peek(SLUG)).toBeNull();
    });

    test("a BookUnavailableError from the fetcher is passed through unchanged", async () => {
      const original: BookUnavailableError = new BookUnavailableError(
        "Fetching x returned HTTP 502.",
      );
      fetchArchive.mockRejectedValueOnce(original);

      await expect(store.getBook(SLUG)).rejects.toBe(original);
    });

    test("non-Error rejections are wrapped", async () => {
      fetchArchive.mockRejectedValueOnce("socket hang up");

      const error: unknown = await catchRejection(store.getBook(SLUG));

      expect(error).toBeInstanceOf(BookUnavailableError);
      expect((error as Error).message).toContain("socket hang up");
    });

    test("an archive that does not parse becomes BookUnavailableError", async () => {
      fetchArchive.mockResolvedValueOnce(
        Buffer.from("<html>502 Bad Gateway</html>"),
      );

      const error: unknown = await catchRejection(store.getBook(SLUG));

      expect(error).toBeInstanceOf(BookUnavailableError);
      expect((error as Error).message).toContain("Not a ZIP archive");
    });

    test("an EPUB that is not a book becomes BookUnavailableError", async () => {
      fetchArchive.mockResolvedValueOnce(buildEpub({ container: null }));

      const error: unknown = await catchRejection(store.getBook(SLUG));

      expect(error).toBeInstanceOf(BookUnavailableError);
      expect((error as Error).message).toContain("container.xml");
    });

    test("every caller of a failing download gets BookUnavailableError", async () => {
      const download: Deferred<Buffer> = deferred<Buffer>();
      fetchArchive.mockReturnValueOnce(download.promise);

      const first: Promise<unknown> = catchRejection(store.getBook(SLUG));
      const second: Promise<unknown> = catchRejection(store.getBook(SLUG));

      download.resolve(Buffer.from("not an archive"));

      expect(await first).toBeInstanceOf(BookUnavailableError);
      expect(await second).toBeInstanceOf(BookUnavailableError);
      expect(fetchArchive).toHaveBeenCalledTimes(1);
    });

    test("are remembered for retryAfterFailureMs, then retried", async () => {
      fetchArchive.mockRejectedValueOnce(new Error("connection refused"));
      await catchRejection(store.getBook(SLUG));

      time += RETRY_AFTER_MS - 1;

      const remembered: unknown = await catchRejection(store.getBook(SLUG));

      expect(remembered).toBeInstanceOf(BookUnavailableError);
      expect((remembered as Error).message).toContain(
        "temporarily unavailable",
      );
      expect((remembered as Error).message).toContain("connection refused");
      expect(fetchArchive).toHaveBeenCalledTimes(1);

      time += 1;

      const loaded: LoadedBook | null = await store.getBook(SLUG);

      expect(loaded).not.toBeNull();
      expect(fetchArchive).toHaveBeenCalledTimes(2);
    });

    test("a success clears the remembered failure", async () => {
      fetchArchive.mockRejectedValueOnce(new Error("connection refused"));
      await catchRejection(store.getBook(SLUG));
      time += RETRY_AFTER_MS;
      await store.getBook(SLUG);

      time += FRESH_FOR_MS;
      await store.getBook(SLUG);
      await flush();

      expect(fetchArchive).toHaveBeenCalledTimes(3);
    });
  });

  describe("warm", () => {
    test("starts a load without waiting for it", async () => {
      store.warm(SLUG);

      expect(fetchArchive).toHaveBeenCalledTimes(1);
      await flush();
      expect(store.peek(SLUG)).not.toBeNull();
    });

    test("never throws and never leaves an unhandled rejection", async () => {
      const unhandled: jest.Mock = jest.fn();
      process.on("unhandledRejection", unhandled);

      try {
        fetchArchive.mockRejectedValueOnce(new Error("boom"));

        expect(() => {
          store.warm(SLUG);
          store.warm("not-a-book");
        }).not.toThrow();
        await flush();

        expect(unhandled).not.toHaveBeenCalled();
        expect(store.peek(SLUG)).toBeNull();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });

    test("does not start a second download while one is running", async () => {
      store.warm(SLUG);
      store.warm(SLUG);
      await store.getBook(SLUG);

      expect(fetchArchive).toHaveBeenCalledTimes(1);
    });
  });

  test("the site's store starts empty and uses the default options", () => {
    expect(DefaultBookStore).toBeInstanceOf(BookStore);
    expect(DefaultBookStore.peek(SLUG)).toBeNull();
  });
});

describe("buildBookPayload", () => {
  test("prefers the EPUB's own metadata", () => {
    const parsed: ParsedEpub = parseEpub(
      buildEpub({
        metadata: {
          title: "A Different Title",
          creator: "Someone Else",
          publisher: "Another Press",
          language: "en-GB",
          description: "Another subtitle",
          modified: "2027-01-01T00:00:00Z",
        },
      }),
    );
    const payload: BookPayload = buildBookPayload(BackToMetal, parsed);

    expect(payload).toMatchObject({
      version: BOOK_PAYLOAD_VERSION,
      slug: BackToMetal.slug,
      title: "A Different Title",
      subtitle: "Another subtitle",
      author: "Someone Else",
      publisher: "Another Press",
      language: "en-GB",
      modified: "2027-01-01T00:00:00Z",
    });
    expect(payload.sections).toBe(parsed.sections);
    expect(payload.toc).toBe(parsed.toc);
  });

  test("falls back to the catalog when the EPUB's metadata is empty", () => {
    const parsed: ParsedEpub = parseEpub(
      buildEpub({
        metadata: {
          title: "",
          creator: "",
          publisher: "",
          language: "",
          description: "",
          modified: "",
        },
      }),
    );

    expect(buildBookPayload(BackToMetal, parsed)).toMatchObject({
      title: BackToMetal.title,
      subtitle: BackToMetal.subtitle,
      author: BackToMetal.author,
      publisher: BackToMetal.publisher,
      language: BackToMetal.language,
      modified: "",
    });
  });

  test("links, cover and licence always come from the catalog", () => {
    const payload: BookPayload = buildBookPayload(
      BackToMetal,
      parseEpub(buildEpub()),
    );

    expect(payload.coverUrl).toBe(BackToMetal.coverPath);
    expect(payload.siteUrl).toBe(BackToMetal.siteUrl);
    expect(payload.epubUrl).toBe(BackToMetal.epubUrl);
    expect(payload.pdfUrl).toBe(BackToMetal.pdfUrl);
    expect(payload.license).toEqual(BackToMetal.license);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "author",
        "coverUrl",
        "epubUrl",
        "language",
        "license",
        "modified",
        "pdfUrl",
        "publisher",
        "sections",
        "siteUrl",
        "slug",
        "subtitle",
        "title",
        "toc",
        "version",
      ].sort(),
    );
  });
});

describe("fetchArchiveOverHttp", () => {
  const BODY: Buffer = Buffer.from("PK fake epub bytes ".repeat(20));
  const received: Array<http.IncomingHttpHeaders> = [];
  const hanging: Array<http.ServerResponse> = [];
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        received.push(request.headers);

        switch (request.url) {
          case "/book.epub":
            response.writeHead(200, {
              "content-type": "application/epub+zip",
              "content-length": String(BODY.length),
            });
            response.end(BODY);
            return;
          case "/missing.epub":
            response.writeHead(404, { "content-type": "text/plain" });
            response.end("not found");
            return;
          case "/server-error.epub":
            response.writeHead(503);
            response.end();
            return;
          case "/declared-large.epub":
            response.writeHead(200, { "content-length": "1000" });
            response.end(Buffer.alloc(1000, 1));
            return;
          case "/streamed-large.epub": {
            response.writeHead(200, { "content-type": "application/epub+zip" });
            let sent: number = 0;
            const writeChunk: () => void = (): void => {
              if (sent >= 10) {
                response.end();
                return;
              }

              sent++;
              response.write(Buffer.alloc(100, 2));
              setTimeout(writeChunk, 5);
            };
            writeChunk();
            return;
          }
          case "/redirect.epub":
            response.writeHead(302, { location: "/book.epub" });
            response.end();
            return;
          case "/hang.epub":
            hanging.push(response);
            return;
          default:
            response.writeHead(500);
            response.end();
        }
      },
    );

    await new Promise<void>((resolve: () => void): void => {
      server.listen(0, "127.0.0.1", resolve);
    });

    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const response of hanging) {
      response.destroy();
    }

    server.closeAllConnections();
    await new Promise<void>((resolve: () => void): void => {
      server.close((): void => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    received.length = 0;
  });

  test("returns the body as a Buffer", async () => {
    const body: Buffer = await fetchArchiveOverHttp(`${base}/book.epub`, {
      timeoutMs: 5000,
      maxBytes: 10000,
    });

    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.equals(BODY)).toBe(true);
  });

  test("identifies itself and asks for an EPUB", async () => {
    await fetchArchiveOverHttp(`${base}/book.epub`, {
      timeoutMs: 5000,
      maxBytes: 10000,
    });

    expect(received).toHaveLength(1);
    expect(received[0]!["user-agent"]).toContain("OneUptime-Home");
    expect(received[0]!["accept"]).toContain("application/epub+zip");
  });

  test("a body exactly at the limit is accepted", async () => {
    await expect(
      fetchArchiveOverHttp(`${base}/book.epub`, {
        timeoutMs: 5000,
        maxBytes: BODY.length,
      }),
    ).resolves.toHaveLength(BODY.length);
  });

  test.each([
    ["/missing.epub", 404],
    ["/server-error.epub", 503],
  ])(
    "an HTTP error (%s) is a BookUnavailableError naming the status",
    async (route: string, status: number) => {
      const error: unknown = await catchRejection(
        fetchArchiveOverHttp(`${base}${route}`, {
          timeoutMs: 5000,
          maxBytes: 10000,
        }),
      );

      expect(error).toBeInstanceOf(BookUnavailableError);
      expect((error as Error).message).toContain(`HTTP ${status}`);
      expect((error as Error).message).toContain(route);
    },
  );

  test("a declared size above the limit is refused before reading the body", async () => {
    const error: unknown = await catchRejection(
      fetchArchiveOverHttp(`${base}/declared-large.epub`, {
        timeoutMs: 5000,
        maxBytes: 100,
      }),
    );

    expect(error).toBeInstanceOf(BookUnavailableError);
    expect((error as Error).message).toContain("1000 bytes");
    expect((error as Error).message).toContain("100 byte limit");
  });

  test("a streamed body that grows past the limit is cut off", async () => {
    const error: unknown = await catchRejection(
      fetchArchiveOverHttp(`${base}/streamed-large.epub`, {
        timeoutMs: 5000,
        maxBytes: 250,
      }),
    );

    expect(error).toBeInstanceOf(BookUnavailableError);
    expect((error as Error).message).toContain("while downloading");
  });

  test("a streamed body within the limit is returned whole", async () => {
    const body: Buffer = await fetchArchiveOverHttp(
      `${base}/streamed-large.epub`,
      { timeoutMs: 5000, maxBytes: 1000 },
    );

    expect(body).toHaveLength(1000);
  });

  test("redirects are followed", async () => {
    const body: Buffer = await fetchArchiveOverHttp(`${base}/redirect.epub`, {
      timeoutMs: 5000,
      maxBytes: 10000,
    });

    expect(body.equals(BODY)).toBe(true);
  });

  test("a server that never answers is abandoned after timeoutMs", async () => {
    const started: number = Date.now();
    const error: unknown = await catchRejection(
      fetchArchiveOverHttp(`${base}/hang.epub`, {
        timeoutMs: 150,
        maxBytes: 10000,
      }),
    );

    // fetch rejects with a DOMException from Node's realm, so check its name.
    expect((error as { name: string }).name).toBe("AbortError");
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
