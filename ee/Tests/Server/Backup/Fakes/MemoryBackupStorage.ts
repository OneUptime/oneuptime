import { createHash, Hash } from "crypto";
import { Readable } from "stream";
import {
  BackupDownload,
  BackupListing,
  BackupObject,
  BackupStorage,
  BackupStorageError,
  BackupUploadOptions,
  BackupUploadResult,
} from "../../../../Server/Backup/Storage/BackupStorage";

/*
 * A backup storage in memory, for the runner's suites: what the S3 and
 * Azure clients promise (BackupStorage) - an upload that only becomes a
 * file once its stream ends cleanly, a stream that errors leaving nothing,
 * listings with "folders" under a delimiter - without HTTP. Their own
 * suites hold the real clients to the storage's API (FakeBackupS3,
 * FakeBackupAzure). Not a test file itself.
 */

export interface MemoryObject {
  body: Buffer;
  contentType: string;
  lastModified: Date;
}

export default class MemoryBackupStorage implements BackupStorage {
  public readonly title: string = "The test storage";
  public readonly objects: Map<string, MemoryObject> = new Map<
    string,
    MemoryObject
  >();
  // Every call, in order: "upload <key>", "delete <key>"...
  public readonly calls: Array<string> = [];
  // Throws this from the next call of an operation.
  public failures: Map<string, Error> = new Map<string, Error>();
  // Keys whose stored bytes a test changed after they were written.
  public readonly tampered: Set<string> = new Set<string>();

  public describeKey(key: string): string {
    return `memory://backups/${key}`;
  }

  private failIfAsked(operation: string): void {
    const failure: Error | undefined = this.failures.get(operation);

    if (failure) {
      this.failures.delete(operation);
      throw failure;
    }
  }

  public async putObject(data: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    this.calls.push(`put ${data.key}`);
    this.failIfAsked("putObject");
    this.objects.set(data.key, {
      body: Buffer.from(data.body),
      contentType: data.contentType,
      lastModified: new Date(),
    });
  }

  public async upload(
    options: BackupUploadOptions,
  ): Promise<BackupUploadResult> {
    this.calls.push(`upload ${options.key}`);
    this.failIfAsked("upload");

    const hash: Hash = createHash("sha256");
    const chunks: Array<Buffer> = [];
    let size: number = 0;

    for await (const chunk of options.source) {
      if (options.signal?.aborted) {
        options.source.destroy();
        throw new BackupStorageError("The upload was cancelled.", {
          retryable: false,
        });
      }

      const buffer: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);
      hash.update(buffer);
      chunks.push(buffer);
      size += buffer.length;
      options.onProgress?.(size);
    }

    this.objects.set(options.key, {
      body: Buffer.concat(chunks),
      contentType: options.contentType,
      lastModified: new Date(),
    });

    return { sizeInBytes: size, sha256: hash.digest("hex") };
  }

  public async download(key: string): Promise<BackupDownload> {
    this.calls.push(`download ${key}`);
    this.failIfAsked("download");

    const object: MemoryObject | undefined = this.objects.get(key);

    if (!object) {
      throw new BackupStorageError(`Nothing is at ${this.describeKey(key)}.`, {
        retryable: false,
        status: 404,
      });
    }

    return {
      stream: Readable.from([Buffer.from(object.body)]),
      sizeInBytes: object.body.length,
    };
  }

  public async readSmallObject(
    key: string,
    maxBytes: number,
  ): Promise<Buffer | null> {
    this.calls.push(`read ${key}`);
    this.failIfAsked("readSmallObject");

    const object: MemoryObject | undefined = this.objects.get(key);

    if (!object) {
      return null;
    }

    if (object.body.length > maxBytes) {
      throw new BackupStorageError("The file is too large.", {
        retryable: false,
      });
    }

    return Buffer.from(object.body);
  }

  public async headObject(key: string): Promise<BackupObject | null> {
    this.calls.push(`head ${key}`);
    this.failIfAsked("headObject");

    const object: MemoryObject | undefined = this.objects.get(key);

    return object
      ? {
          key,
          sizeInBytes: object.body.length,
          lastModified: object.lastModified,
        }
      : null;
  }

  public async list(data: {
    prefix: string;
    delimiter?: string | undefined;
  }): Promise<BackupListing> {
    this.calls.push(`list ${data.prefix}`);
    this.failIfAsked("list");

    const listing: BackupListing = { objects: [], prefixes: [] };

    for (const key of Array.from(this.objects.keys()).sort()) {
      if (!key.startsWith(data.prefix)) {
        continue;
      }

      if (data.delimiter) {
        const rest: string = key.slice(data.prefix.length);
        const at: number = rest.indexOf(data.delimiter);

        if (at >= 0) {
          const prefix: string = `${data.prefix}${rest.slice(0, at + data.delimiter.length)}`;

          if (!listing.prefixes.includes(prefix)) {
            listing.prefixes.push(prefix);
          }

          continue;
        }
      }

      const object: MemoryObject = this.objects.get(key)!;
      listing.objects.push({
        key,
        sizeInBytes: object.body.length,
        lastModified: object.lastModified,
      });
    }

    return listing;
  }

  public async deleteObject(key: string): Promise<void> {
    this.calls.push(`delete ${key}`);
    this.failIfAsked("deleteObject");
    this.objects.delete(key);
  }

  // Every key under a prefix, sorted.
  public keysUnder(prefix: string): Array<string> {
    return Array.from(this.objects.keys())
      .filter((key: string): boolean => {
        return key.startsWith(prefix);
      })
      .sort();
  }

  public write(key: string, body: Buffer | string): void {
    this.objects.set(key, {
      body: Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8"),
      contentType: "application/octet-stream",
      lastModified: new Date(),
    });
  }
}
