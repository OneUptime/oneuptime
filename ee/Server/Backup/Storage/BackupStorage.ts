import { Readable } from "stream";

/*
 * What the backup runner asks of the storage a backup goes to, whichever it
 * is: write a file from a stream of any size without holding it (the
 * storage's multipart upload), read one back as a stream, look one up,
 * list a folder, delete. Keys are full object keys - the folder included.
 *
 * Two implementations: S3BackupStorage (Amazon S3, every S3-compatible
 * storage, Google Cloud Storage's XML API) and AzureBackupStorage.
 */

export interface BackupObject {
  key: string;
  sizeInBytes: number;
  lastModified?: Date | undefined;
}

export interface BackupListing {
  objects: Array<BackupObject>;
  // The "folders" right under the prefix, with the delimiter: "<prefix><name>/".
  prefixes: Array<string>;
}

export interface BackupUploadResult {
  sizeInBytes: number;
  // Of every byte the source gave, as it was uploaded.
  sha256: string;
}

export interface BackupDownload {
  stream: Readable;
  sizeInBytes: number | null;
}

export interface BackupUploadOptions {
  key: string;
  source: Readable;
  contentType: string;
  /*
   * About how big the file will be, when the runner knows (a database's
   * size): the upload picks a part size that fits it in the storage's part
   * limit. A file larger than parts allow fails with a sentence saying so.
   */
  expectedSizeInBytes?: number | undefined;
  onProgress?: ((uploadedBytes: number) => void) | undefined;
  // Stops the upload (a cancelled backup): the parts are abandoned.
  signal?: AbortSignal | undefined;
}

export interface BackupStorage {
  // How the storage is named in sentences: "Amazon S3".
  readonly title: string;

  // Where a key is, in words: s3://bucket/key.
  describeKey(key: string): string;

  putObject(data: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void>;

  upload(options: BackupUploadOptions): Promise<BackupUploadResult>;

  // A file read back as a stream; throws BackupStorageError when it is not there.
  download(key: string): Promise<BackupDownload>;

  // A small file read whole (a manifest), or null when there is none.
  readSmallObject(key: string, maxBytes: number): Promise<Buffer | null>;

  headObject(key: string): Promise<BackupObject | null>;

  // Every object (and, with a delimiter, folder) under a prefix, all pages.
  list(data: {
    prefix: string;
    delimiter?: string | undefined;
  }): Promise<BackupListing>;

  deleteObject(key: string): Promise<void>;
}

/*
 * A storage request that did not do what it was asked. `retryable` says
 * whether trying again soon can help - no answer, a timeout, a 5xx, a rate
 * limit - rather than a setting someone has to change (a refused key, a
 * bucket that does not exist). The message says what is wrong and what to
 * change, and never holds a secret.
 */
export class BackupStorageError extends Error {
  public readonly retryable: boolean;
  public readonly status: number | null;
  // The storage's own code, such as NoSuchKey or ContainerNotFound.
  public readonly code: string;

  public constructor(
    message: string,
    options: {
      retryable: boolean;
      status?: number | null | undefined;
      code?: string | undefined;
    },
  ) {
    super(message);
    this.name = "BackupStorageError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.code = options.code || "";
  }
}

// A file asked for that is not at the destination.
export function isNotFoundError(error: unknown): boolean {
  return error instanceof BackupStorageError && error.status === 404;
}

/*
 * Deletes every object under a prefix (one backup's folder), a few at a
 * time, and says how many went. A folder that is already gone deletes
 * nothing and is no error.
 */
export async function deleteBackupPrefix(data: {
  storage: BackupStorage;
  prefix: string;
  concurrency?: number | undefined;
  onProgress?: ((deleted: number) => void) | undefined;
}): Promise<number> {
  const listing: BackupListing = await data.storage.list({
    prefix: data.prefix,
  });
  const keys: Array<string> = listing.objects.map(
    (object: BackupObject): string => {
      return object.key;
    },
  );
  const concurrency: number = Math.max(1, data.concurrency || 8);
  let next: number = 0;
  let deleted: number = 0;

  const worker: () => Promise<void> = async (): Promise<void> => {
    while (next < keys.length) {
      const key: string = keys[next++]!;

      try {
        await data.storage.deleteObject(key);
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      deleted++;
      data.onProgress?.(deleted);
    }
  };

  const workers: Array<Promise<void>> = [];

  for (let index: number = 0; index < Math.min(concurrency, keys.length); index++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  return deleted;
}
