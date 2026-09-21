import fs from "fs";
import path from "path";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { createBookContentHandler } from "../../Utils/Books/BookContentRoute";
import BookStore, {
  BookPayload,
  BookUnavailableError,
  LoadedBook,
} from "../../Utils/Books/BookStore";
import { BackToMetal } from "../../Utils/Books/BookCatalog";

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
 * GET /books/:slug/content.json. The handler is driven with a fake store and
 * a recording response, so every status, header and body is asserted exactly.
 */

interface RecordedResponse {
  statusCode: number | null;
  headers: Record<string, string>;
  body: string | undefined;
  ended: boolean;
}

interface ResponseFixture {
  res: ExpressResponse;
  recorded: RecordedResponse;
}

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

const createResponse: () => ResponseFixture = (): ResponseFixture => {
  const recorded: RecordedResponse = {
    statusCode: null,
    headers: {},
    body: undefined,
    ended: false,
  };
  const res: Record<string, unknown> = {};

  res["status"] = (code: number): Record<string, unknown> => {
    recorded.statusCode = code;
    return res;
  };
  res["setHeader"] = (
    name: string,
    value: string | number,
  ): Record<string, unknown> => {
    recorded.headers[name.toLowerCase()] = String(value);
    return res;
  };
  res["send"] = (body: string): Record<string, unknown> => {
    recorded.body = body;
    recorded.ended = true;
    return res;
  };
  res["end"] = (): Record<string, unknown> => {
    recorded.ended = true;
    return res;
  };

  return { res: res as unknown as ExpressResponse, recorded };
};

const createRequest: (
  slug: string | undefined,
  headers?: Record<string, string>,
) => ExpressRequest = (
  slug: string | undefined,
  headers: Record<string, string> = {},
): ExpressRequest => {
  return {
    params: slug === undefined ? {} : { slug },
    headers,
  } as unknown as ExpressRequest;
};

const LOADED: LoadedBook = {
  payload: { slug: BackToMetal.slug, title: "Back to Metal" } as BookPayload,
  json: '{"slug":"back-to-metal","title":"Back to Metal"}',
  etag: '"abc123etag"',
  loadedAt: 42,
};

const createStore: (result: () => Promise<LoadedBook | null>) => {
  store: BookStore;
  getBook: jest.Mock;
} = (
  result: () => Promise<LoadedBook | null>,
): { store: BookStore; getBook: jest.Mock } => {
  const getBook: jest.Mock = jest.fn(result);
  return { store: { getBook } as unknown as BookStore, getBook };
};

const run: (
  store: BookStore,
  slug: string | undefined,
  headers?: Record<string, string>,
) => Promise<RecordedResponse> = async (
  store: BookStore,
  slug: string | undefined,
  headers: Record<string, string> = {},
): Promise<RecordedResponse> => {
  const handler: Handler = createBookContentHandler(store);
  const { res, recorded } = createResponse();

  await handler(createRequest(slug, headers), res);

  return recorded;
};

describe("GET /books/:slug/content.json", () => {
  describe("when the book loads", () => {
    let store: BookStore;
    let getBook: jest.Mock;

    beforeEach(() => {
      ({ store, getBook } = createStore(async () => {
        return LOADED;
      }));
    });

    test("responds 200 with the serialized payload", async () => {
      const response: RecordedResponse = await run(store, BackToMetal.slug);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(LOADED.json);
      expect(getBook).toHaveBeenCalledWith(BackToMetal.slug);
    });

    test("sends JSON with validators and a short shared cache", async () => {
      const response: RecordedResponse = await run(store, BackToMetal.slug);

      expect(response.headers).toEqual({
        "content-type": "application/json; charset=utf-8",
        etag: LOADED.etag,
        "cache-control": "public, max-age=300, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
      });
    });

    test.each([
      ["an exact match", '"abc123etag"'],
      ["a weak validator", 'W/"abc123etag"'],
      ["a list containing it", '"old", "abc123etag"'],
      ["a list of weak validators", 'W/"old", W/"abc123etag"'],
      ["a wildcard", "*"],
    ])(
      "answers 304 without a body for %s",
      async (_description: string, ifNoneMatch: string) => {
        const response: RecordedResponse = await run(store, BackToMetal.slug, {
          "if-none-match": ifNoneMatch,
        });

        expect(response.statusCode).toBe(304);
        expect(response.body).toBeUndefined();
        expect(response.ended).toBe(true);
        expect(response.headers["etag"]).toBe(LOADED.etag);
        expect(response.headers["cache-control"]).toBe(
          "public, max-age=300, stale-while-revalidate=86400",
        );
      },
    );

    test.each([
      ["a different ETag", '"something-else"'],
      ["a prefix of the ETag", '"abc123"'],
      ["an unquoted ETag", "abc123etag"],
      ["an empty header", ""],
    ])(
      "answers 200 for %s",
      async (_description: string, ifNoneMatch: string) => {
        const response: RecordedResponse = await run(store, BackToMetal.slug, {
          "if-none-match": ifNoneMatch,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toBe(LOADED.json);
      },
    );
  });

  describe("errors", () => {
    test("an unknown book is a 404 and never reaches the store", async () => {
      const { store, getBook } = createStore(async () => {
        return LOADED;
      });

      for (const slug of ["not-a-book", "", "../etc", "BACK-TO-METAL"]) {
        const response: RecordedResponse = await run(store, slug);

        expect(response.statusCode).toBe(404);
        expect(JSON.parse(response.body!)).toEqual({
          error: "No book with that name.",
        });
        expect(response.headers["content-type"]).toBe(
          "application/json; charset=utf-8",
        );
        expect(response.headers["cache-control"]).toBe("no-store");
      }

      const missing: RecordedResponse = await run(store, undefined);

      expect(missing.statusCode).toBe(404);
      expect(getBook).not.toHaveBeenCalled();
    });

    test("a catalog book the store does not know is a 404", async () => {
      const { store } = createStore(async () => {
        return null;
      });
      const response: RecordedResponse = await run(store, BackToMetal.slug);

      expect(response.statusCode).toBe(404);
      expect(JSON.parse(response.body!)).toEqual({
        error: "No book with that name.",
      });
    });

    test("an unavailable book is a 503 that points readers at the book's website", async () => {
      const { store } = createStore(async () => {
        throw new BookUnavailableError("upstream is down");
      });
      const response: RecordedResponse = await run(store, BackToMetal.slug);

      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body!)).toEqual({
        error: `${BackToMetal.title} is temporarily unavailable here.`,
        readOnlineUrl: BackToMetal.siteUrl,
      });
      expect(response.headers).toEqual({
        "retry-after": "60",
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
    });

    test("an unexpected error is a 503 with a generic message", async () => {
      const { store } = createStore(async () => {
        throw new Error("secret internal detail");
      });
      const response: RecordedResponse = await run(store, BackToMetal.slug);

      expect(response.statusCode).toBe(503);
      expect(response.body).not.toContain("secret internal detail");
      expect(JSON.parse(response.body!)).toEqual({
        error: "The book could not be loaded.",
        readOnlineUrl: BackToMetal.siteUrl,
      });
      expect(response.headers["retry-after"]).toBe("60");
    });

    test("error responses never carry an ETag", async () => {
      const { store } = createStore(async () => {
        throw new BookUnavailableError("down");
      });
      const response: RecordedResponse = await run(store, BackToMetal.slug, {
        "if-none-match": "*",
      });

      expect(response.statusCode).toBe(503);
      expect(response.headers["etag"]).toBeUndefined();
    });
  });
});

describe("Routes.ts wiring for the reader", () => {
  const routesSource: string = fs.readFileSync(
    path.join(__dirname, "..", "..", "Routes.ts"),
    "utf-8",
  );
  const CONTENT_ROUTE: string =
    'app.get("/books/:slug/content.json", handleBookContent)';

  const booksRouteBody: () => string = (): string => {
    const start: number = routesSource.indexOf('app.get("/books",');
    const end: number = routesSource.indexOf("app.get(", start + 1);

    expect(start).toBeGreaterThanOrEqual(0);
    return routesSource.slice(start, end);
  };

  test("registers the content route exactly once", () => {
    expect(routesSource.split(CONTENT_ROUTE)).toHaveLength(2);
  });

  test("imports the handler, the catalog, the store and the asset versions", () => {
    expect(routesSource).toContain(
      'import { handleBookContent } from "./Utils/Books/BookContentRoute";',
    );
    expect(routesSource).toContain(
      'import { BackToMetal } from "./Utils/Books/BookCatalog";',
    );
    expect(routesSource).toContain(
      'import { DefaultBookStore } from "./Utils/Books/BookStore";',
    );
    expect(routesSource).toContain(
      'import { getBookPageAssets } from "./Utils/StaticAssets";',
    );
  });

  test("the content route comes before the static files and the catch-all 404", () => {
    const route: number = routesSource.indexOf(CONTENT_ROUTE);
    const staticFiles: number = routesSource.indexOf(
      "ExpressStatic(StaticPath",
    );
    const catchAll: number = routesSource.indexOf('app.get("/*"');

    expect(route).toBeGreaterThan(0);
    expect(staticFiles).toBeGreaterThan(route);
    expect(catchAll).toBeGreaterThan(route);
  });

  test("viewing /books warms the store for the featured book", () => {
    expect(booksRouteBody()).toContain(
      "DefaultBookStore.warm(BackToMetal.slug);",
    );
  });

  test("/books renders the catalog book with content-versioned assets", () => {
    const body: string = booksRouteBody();

    expect(body).toContain("`${ViewsPath}/books.ejs`");
    expect(body).toContain("book: BackToMetal,");
    expect(body).toContain("bookAssets: getBookPageAssets(),");
    expect(body).toContain("seo,");
  });
});
