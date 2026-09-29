import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import { BookDefinition, getBookBySlug } from "./BookCatalog";
import BookStore, {
  BookUnavailableError,
  DefaultBookStore,
  LoadedBook,
} from "./BookStore";

/*
 * GET /books/:slug/content.json (registered in Routes.ts) - the full text of
 * a book for the in-page reader. The body is the payload BookStore builds
 * from the book's EPUB.
 */

const etagMatches: (header: string | undefined, etag: string) => boolean = (
  header: string | undefined,
  etag: string,
): boolean => {
  if (!header) {
    return false;
  }

  return header
    .split(",")
    .map((candidate: string): string => {
      return candidate.trim().replace(/^W\//, "");
    })
    .some((candidate: string): boolean => {
      return candidate === "*" || candidate === etag;
    });
};

const sendError: (
  res: ExpressResponse,
  status: number,
  body: Record<string, string>,
) => void = (
  res: ExpressResponse,
  status: number,
  body: Record<string, string>,
): void => {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.send(JSON.stringify(body));
};

export const createBookContentHandler: (
  store: BookStore,
) => (req: ExpressRequest, res: ExpressResponse) => Promise<void> = (
  store: BookStore,
): ((req: ExpressRequest, res: ExpressResponse) => Promise<void>) => {
  return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
    const slug: string = String(req.params["slug"] || "");
    const book: BookDefinition | undefined = getBookBySlug(slug);

    if (!book) {
      return sendError(res, 404, { error: "No book with that name." });
    }

    let loaded: LoadedBook | null;

    try {
      loaded = await store.getBook(slug);
    } catch (error) {
      res.setHeader("Retry-After", "60");
      return sendError(res, 503, {
        error:
          error instanceof BookUnavailableError
            ? `${book.title} is temporarily unavailable here.`
            : "The book could not be loaded.",
        readOnlineUrl: book.siteUrl,
      });
    }

    if (!loaded) {
      return sendError(res, 404, { error: "No book with that name." });
    }

    res.setHeader("ETag", loaded.etag);
    res.setHeader(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=86400",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");

    if (etagMatches(req.headers["if-none-match"], loaded.etag)) {
      res.status(304);
      res.end();
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.send(loaded.json);
  };
};

export const handleBookContent: (
  req: ExpressRequest,
  res: ExpressResponse,
) => Promise<void> = createBookContentHandler(DefaultBookStore);
