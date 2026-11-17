import InMemoryLruCache from "../../Infrastructure/InMemoryLruCache";
import ObjectID from "../../../Types/ObjectID";
import StatusPageOverviewCache, {
  StatusPageCacheKey,
} from "./StatusPageOverviewCache";
import { createHash } from "crypto";

/*
 * THE IMAGES A STATUS PAGE SERVES, KEPT IN MEMORY.
 *
 * A page's favicon is asked for by every view of the page, and its logo by
 * every sign-in page and every email a subscriber opens. Each was read from
 * Postgres - the image's bytes with it - on every request. Now each process
 * keeps each page's images, by name (favicon, logo, dark theme logo, cover
 * image), under the page and its project's generation
 * (StatusPageOverviewCache): a new image, or one taken off, is a write to the
 * page's settings, which starts a new generation in every process at once.
 * Anything else - an image file deleted outright, which takes it off its
 * page in the database alone - is seen when the entry runs out, within
 * TTL_MS: as long as the page's overview is kept.
 *
 * The bytes are bounded (InMemoryLruCache): at most MAX_BYTES across every
 * page, the image used least recently let go first, and no image over
 * MAX_IMAGE_BYTES is kept at all (it is served as it is read). A page with no such image is kept as
 * having none, so a page without a favicon does not read Postgres either. A
 * page that does not exist is never kept: ids nobody has cannot fill it.
 *
 * Each image carries a strong ETag of its bytes, so a browser that has it is
 * answered 304 without a byte of it - or a read of anything.
 *
 * An image is not who may read a page: these routes never asked, because a
 * private page's sign-in page shows its logo to everyone. What a cache in
 * front of OneUptime may keep is decided by the page's rules on every
 * request (StatusPageAPI.serveStatusPageImage, StatusPageAccessRules), not
 * here.
 */

// The images a status page serves, by the route each is served from.
export type StatusPageImageName =
  | "favicon"
  | "logo"
  | "dark-theme-logo"
  | "cover-image";

// An image as it is read: its bytes, what they are and its name.
export interface StatusPageImageFile {
  bytes: Buffer;
  fileType: string;
  name: string;
}

// An image as it is served: the file, and the tag of its bytes.
export interface StatusPageImage extends StatusPageImageFile {
  etag: string;
}

// What a page with no such image counts for against MAX_BYTES.
const EMPTY_ENTRY_BYTES: number = 64;

export default class StatusPageImageCache {
  // How long an image is kept, at most: as long as the page's overview.
  public static readonly TTL_MS: number = StatusPageOverviewCache.TTL_MS;

  // At most how many bytes of images this process keeps, every page's.
  public static MAX_BYTES: number = 64 * 1024 * 1024;

  // An image bigger than this is served as it is read, never kept.
  public static MAX_IMAGE_BYTES: number = 4 * 1024 * 1024;

  // At most how many images - or pages with none - this process keeps.
  public static MAX_ENTRIES: number = 10_000;

  // Each page's images, least recently used first; null for a page with none.
  private static entries: InMemoryLruCache<StatusPageImage | null> =
    new InMemoryLruCache<StatusPageImage | null>(() => {
      return {
        maxEntries: StatusPageImageCache.MAX_ENTRIES,
        maxBytes: StatusPageImageCache.MAX_BYTES,
        maxEntryBytes: StatusPageImageCache.MAX_IMAGE_BYTES,
        sizeOf: (image: StatusPageImage | null): number => {
          return image ? image.bytes.length : EMPTY_ENTRY_BYTES;
        },
      };
    });

  // Reads under way, so requests that miss together share one.
  private static inFlight: Map<string, Promise<StatusPageImage | null>> =
    new Map();

  /*
   * A page's image: the one kept for it under its project's current
   * generation, else one read now by `read` (shared with any request for it
   * that arrives meanwhile) and kept. null when the page has none. A failed
   * read is never kept. The bytes are shared between requests and must not
   * be changed.
   */
  public static async getOrRead(data: {
    statusPageId: ObjectID;
    image: StatusPageImageName;
    // The page's project; null when there is no such page.
    readProjectId: () => Promise<ObjectID | null>;
    read: () => Promise<StatusPageImageFile | null>;
  }): Promise<StatusPageImage | null> {
    const pageKey: StatusPageCacheKey =
      await StatusPageOverviewCache.getPageKey({
        statusPageId: data.statusPageId,
        readProjectId: data.readProjectId,
      });

    if (!pageKey.hasProject) {
      return this.toImage(await data.read());
    }

    const key: string = `${data.image}|${pageKey.key}`;

    const kept: StatusPageImage | null | undefined = this.entries.get(key);

    if (kept !== undefined) {
      return kept;
    }

    let reading: Promise<StatusPageImage | null> | undefined =
      this.inFlight.get(key);

    if (!reading) {
      const startedAt: number = Date.now();

      const started: Promise<StatusPageImage | null> = data
        .read()
        .then((file: StatusPageImageFile | null): StatusPageImage | null => {
          const image: StatusPageImage | null = this.toImage(file);

          this.entries.set(key, image, startedAt + this.TTL_MS - Date.now());

          return image;
        });

      reading = started;
      this.inFlight.set(key, started);

      started
        .catch(() => {
          // A failed read is never kept; the next request reads again.
        })
        .finally(() => {
          if (this.inFlight.get(key) === started) {
            this.inFlight.delete(key);
          }
        });
    }

    return await reading;
  }

  /*
   * A strong ETag of an image's bytes: the first 32 hex characters of their
   * SHA-256, quoted - the same bytes always the same tag, in every process.
   */
  public static getETag(bytes: Buffer): string {
    return `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`;
  }

  // How many images, and bytes of them, this process keeps. For tests.
  public static getSize(): { entries: number; bytes: number } {
    return this.entries.size();
  }

  // Drops everything this process keeps. For tests.
  public static clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private static toImage(
    file: StatusPageImageFile | null,
  ): StatusPageImage | null {
    if (!file) {
      return null;
    }

    return { ...file, etag: this.getETag(file.bytes) };
  }
}
