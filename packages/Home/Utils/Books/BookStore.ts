import crypto from "crypto";
import logger from "Common/Server/Utils/Logger";
import { BookDefinition, getBookBySlug } from "./BookCatalog";
import { BookSection, BookTocEntry, parseEpub, ParsedEpub } from "./Epub";

/*
 * Loads a book's full text for the in-page reader.
 *
 * The text comes from the book's official EPUB, fetched from its own website
 * and parsed on this server, so the reader always shows the current edition
 * without the site redeploying. The parsed book is cached in memory:
 *
 *  - a fresh copy is served straight from memory;
 *  - a stale copy is still served immediately while one background refresh
 *    runs, and it keeps being served if that refresh fails, because an older
 *    edition is far better than no book;
 *  - concurrent requests share one download;
 *  - with nothing cached, a failure is remembered for a short while so a
 *    broken upstream is not hammered by every page view.
 */

export const BOOK_PAYLOAD_VERSION: number = 1;

export interface BookPayload {
  version: number;
  slug: string;
  title: string;
  subtitle: string;
  author: string;
  publisher: string;
  language: string;
  modified: string;
  coverUrl: string;
  siteUrl: string;
  epubUrl: string;
  pdfUrl: string;
  license: { name: string; url: string };
  sections: Array<BookSection>;
  toc: Array<BookTocEntry>;
}

export interface LoadedBook {
  payload: BookPayload;
  // The payload, serialized once so every response reuses it.
  json: string;
  etag: string;
  loadedAt: number;
}

export type ArchiveFetcher = (
  url: string,
  options: { timeoutMs: number; maxBytes: number },
) => Promise<Buffer>;

export interface BookStoreOptions {
  fetchArchive: ArchiveFetcher;
  now: () => number;
  // How long a loaded book is served without checking for a new edition.
  freshForMs: number;
  // How long to wait before retrying after a failed load with nothing cached.
  retryAfterFailureMs: number;
  timeoutMs: number;
  maxBytes: number;
}

export class BookUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "BookUnavailableError";
  }
}

const readLimited: (
  response: Response,
  maxBytes: number,
) => Promise<Buffer> = async (
  response: Response,
  maxBytes: number,
): Promise<Buffer> => {
  const declared: number = Number(response.headers.get("content-length"));

  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new BookUnavailableError(
      `The book is ${declared} bytes, above the ${maxBytes} byte limit.`,
    );
  }

  if (!response.body) {
    return Buffer.from(await response.arrayBuffer());
  }

  const reader: ReadableStreamDefaultReader<Uint8Array> =
    response.body.getReader();
  const chunks: Array<Buffer> = [];
  let total: number = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader.cancel();
      throw new BookUnavailableError(
        `The book exceeded the ${maxBytes} byte limit while downloading.`,
      );
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
};

export const fetchArchiveOverHttp: ArchiveFetcher = async (
  url: string,
  options: { timeoutMs: number; maxBytes: number },
): Promise<Buffer> => {
  const controller: AbortController = new AbortController();
  const timer: NodeJS.Timeout = setTimeout(() => {
    controller.abort();
  }, options.timeoutMs);

  try {
    const response: Response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/epub+zip, application/octet-stream;q=0.9",
        "User-Agent": "OneUptime-Home (+https://oneuptime.com/books)",
      },
    });

    if (!response.ok) {
      throw new BookUnavailableError(
        `Fetching ${url} returned HTTP ${response.status}.`,
      );
    }

    return await readLimited(response, options.maxBytes);
  } finally {
    clearTimeout(timer);
  }
};

export const buildBookPayload: (
  book: BookDefinition,
  parsed: ParsedEpub,
) => BookPayload = (book: BookDefinition, parsed: ParsedEpub): BookPayload => {
  return {
    version: BOOK_PAYLOAD_VERSION,
    slug: book.slug,
    title: parsed.metadata.title || book.title,
    subtitle: parsed.metadata.description || book.subtitle,
    author: parsed.metadata.creator || book.author,
    publisher: parsed.metadata.publisher || book.publisher,
    language: parsed.metadata.language || book.language,
    modified: parsed.metadata.modified,
    coverUrl: book.coverPath,
    siteUrl: book.siteUrl,
    epubUrl: book.epubUrl,
    pdfUrl: book.pdfUrl,
    license: book.license,
    sections: parsed.sections,
    toc: parsed.toc,
  };
};

interface CacheEntry {
  loaded: LoadedBook | null;
  inFlight: Promise<LoadedBook> | null;
  lastFailureAt: number | null;
  lastError: Error | null;
}

export default class BookStore {
  private readonly options: BookStoreOptions;
  private readonly cache: Map<string, CacheEntry> = new Map<
    string,
    CacheEntry
  >();

  public constructor(options: Partial<BookStoreOptions> = {}) {
    this.options = {
      fetchArchive: fetchArchiveOverHttp,
      now: Date.now,
      freshForMs: 60 * 60 * 1000,
      retryAfterFailureMs: 60 * 1000,
      timeoutMs: 20 * 1000,
      maxBytes: 20 * 1024 * 1024,
      ...options,
    };
  }

  // The cached book, if any, without triggering a load.
  public peek(slug: string): LoadedBook | null {
    return this.cache.get(slug)?.loaded || null;
  }

  /*
   * Resolves with the book, loading it if needed. Resolves null for a slug
   * that is not in the catalog; rejects with BookUnavailableError when the
   * book cannot be loaded and there is no earlier copy to fall back on.
   */
  public async getBook(slug: string): Promise<LoadedBook | null> {
    const book: BookDefinition | undefined = getBookBySlug(slug);

    if (!book) {
      return null;
    }

    const entry: CacheEntry = this.entryFor(slug);
    const now: number = this.options.now();

    if (entry.loaded) {
      if (now - entry.loaded.loadedAt >= this.options.freshForMs) {
        this.refreshInBackground(book, entry);
      }

      return entry.loaded;
    }

    if (entry.inFlight) {
      return entry.inFlight;
    }

    if (
      entry.lastFailureAt !== null &&
      now - entry.lastFailureAt < this.options.retryAfterFailureMs
    ) {
      throw new BookUnavailableError(
        `${book.title} is temporarily unavailable: ${entry.lastError?.message || "the last load failed"}`,
      );
    }

    return this.load(book, entry);
  }

  // Starts loading a book without waiting for it, e.g. when /books is viewed.
  public warm(slug: string): void {
    this.getBook(slug).catch(() => {
      // Already logged by load(); warming never surfaces an error.
    });
  }

  public clear(): void {
    this.cache.clear();
  }

  private entryFor(slug: string): CacheEntry {
    let entry: CacheEntry | undefined = this.cache.get(slug);

    if (!entry) {
      entry = {
        loaded: null,
        inFlight: null,
        lastFailureAt: null,
        lastError: null,
      };
      this.cache.set(slug, entry);
    }

    return entry;
  }

  private refreshInBackground(book: BookDefinition, entry: CacheEntry): void {
    const now: number = this.options.now();

    if (
      entry.inFlight ||
      (entry.lastFailureAt !== null &&
        now - entry.lastFailureAt < this.options.retryAfterFailureMs)
    ) {
      return;
    }

    this.load(book, entry).catch(() => {
      // The stale copy stays in service; the failure was logged.
    });
  }

  private load(book: BookDefinition, entry: CacheEntry): Promise<LoadedBook> {
    const loading: Promise<LoadedBook> = (async (): Promise<LoadedBook> => {
      const archive: Buffer = await this.options.fetchArchive(book.epubUrl, {
        timeoutMs: this.options.timeoutMs,
        maxBytes: this.options.maxBytes,
      });
      const payload: BookPayload = buildBookPayload(book, parseEpub(archive));
      const json: string = JSON.stringify(payload);

      return {
        payload,
        json,
        etag: `"${crypto.createHash("sha256").update(json).digest("base64url").slice(0, 32)}"`,
        loadedAt: this.options.now(),
      };
    })();

    const settled: Promise<LoadedBook> = loading.then(
      (loaded: LoadedBook): LoadedBook => {
        entry.loaded = loaded;
        entry.inFlight = null;
        entry.lastFailureAt = null;
        entry.lastError = null;
        return loaded;
      },
      (error: unknown): never => {
        const failure: Error =
          error instanceof Error ? error : new Error(String(error));

        entry.inFlight = null;
        entry.lastFailureAt = this.options.now();
        entry.lastError = failure;

        logger.error(`Books: could not load ${book.slug}: ${failure.message}`, {
          service: "home",
        });

        throw failure instanceof BookUnavailableError
          ? failure
          : new BookUnavailableError(
              `${book.title} could not be loaded: ${failure.message}`,
            );
      },
    );

    // Concurrent callers share the settled promise, so they see the same error type.
    entry.inFlight = settled;
    return settled;
  }
}

// The store the site uses; tests construct their own.
export const DefaultBookStore: BookStore = new BookStore();
