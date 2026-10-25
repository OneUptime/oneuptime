import { createHash, Hash } from "crypto";
import { Readable } from "stream";
import { BackupStorageError } from "./BackupStorage";

/*
 * A stream of any size uploaded as parts of one size (S3's multipart
 * upload, Azure's blocks), without ever holding more than a few parts:
 * the stream is read only as fast as parts go out, so pg_dump waits on a
 * slow storage instead of the worker's memory filling up.
 *
 * Every part but the last has the same size - Cloudflare R2 takes nothing
 * else - chosen up front from about how big the file will be, so it fits
 * the storage's part limit. The SHA-256 of every byte is taken on the way.
 */

const MEBIBYTE: number = 1024 * 1024;

// The smallest part: well above S3's 5 MiB floor, few enough requests for a large dump.
export const MIN_BACKUP_PART_SIZE_IN_BYTES: number = 16 * MEBIBYTE;

// Parts in flight at once: memory is (this + 1) parts.
export const BACKUP_PART_CONCURRENCY: number = 2;

/*
 * The part size for a file of about this size: the smallest that leaves
 * twice the room under the part limit (a dump grows while it is written,
 * and the estimate is a database's size, not the dump's), in whole MiB.
 */
export function chooseBackupPartSize(data: {
  expectedSizeInBytes?: number | undefined;
  maxParts: number;
  minPartSizeInBytes?: number | undefined;
}): number {
  const minimum: number =
    data.minPartSizeInBytes || MIN_BACKUP_PART_SIZE_IN_BYTES;
  const expected: number =
    data.expectedSizeInBytes && data.expectedSizeInBytes > 0
      ? data.expectedSizeInBytes
      : 0;
  const needed: number = Math.ceil((expected * 2) / data.maxParts);
  const roundedUp: number = Math.ceil(needed / MEBIBYTE) * MEBIBYTE;

  return Math.max(minimum, roundedUp);
}

export interface UploadedPart {
  partNumber: number;
  // What the storage answered for it: an S3 ETag, an Azure block id.
  token: string;
}

export interface PartUploadResult {
  parts: Array<UploadedPart>;
  sizeInBytes: number;
  sha256: string;
  // The whole file fitted one part and went up in one request.
  isSinglePut: boolean;
}

export class BackupUploadCancelledError extends Error {
  public constructor() {
    super("The upload was cancelled.");
    this.name = "BackupUploadCancelledError";
  }
}

export async function uploadInParts(data: {
  source: Readable;
  partSizeInBytes: number;
  maxParts: number;
  serviceTitle: string;
  concurrency?: number | undefined;
  // Uploads one part (numbered from 1) and answers its token.
  uploadPart: (partNumber: number, body: Buffer) => Promise<string>;
  // A file that fits one part is written in one request instead.
  putWhole: (body: Buffer) => Promise<void>;
  onProgress?: ((uploadedBytes: number) => void) | undefined;
  signal?: AbortSignal | undefined;
}): Promise<PartUploadResult> {
  const concurrency: number = Math.max(
    1,
    data.concurrency || BACKUP_PART_CONCURRENCY,
  );
  const hash: Hash = createHash("sha256");
  const parts: Array<UploadedPart> = [];
  const inFlight: Set<Promise<void>> = new Set<Promise<void>>();
  let pending: Array<Buffer> = [];
  let pendingBytes: number = 0;
  let totalBytes: number = 0;
  let uploadedBytes: number = 0;
  let nextPartNumber: number = 1;
  let failure: unknown = null;

  const assertNotCancelled: () => void = (): void => {
    if (data.signal?.aborted) {
      throw new BackupUploadCancelledError();
    }
  };

  const takePart: (size: number) => Buffer = (size: number): Buffer => {
    const all: Buffer =
      pending.length === 1 ? pending[0]! : Buffer.concat(pending, pendingBytes);
    const part: Buffer = all.subarray(0, size);
    const rest: Buffer = all.subarray(size);

    pending = rest.length > 0 ? [rest] : [];
    pendingBytes = rest.length;

    return part;
  };

  const startPart: (body: Buffer) => Promise<void> = async (
    body: Buffer,
  ): Promise<void> => {
    const partNumber: number = nextPartNumber++;

    if (partNumber > data.maxParts) {
      throw new BackupStorageError(
        `The file is larger than ${data.serviceTitle} takes in one upload (${data.maxParts} parts of ${Math.round(data.partSizeInBytes / MEBIBYTE)} MiB).`,
        { retryable: false },
      );
    }

    // Copied: the part must not change under a retry while the stream goes on.
    const copy: Buffer = Buffer.from(body);

    const upload: Promise<void> = (async (): Promise<void> => {
      const token: string = await data.uploadPart(partNumber, copy);
      parts.push({ partNumber, token });
      uploadedBytes += copy.length;
      data.onProgress?.(uploadedBytes);
    })().catch((error: unknown) => {
      failure = failure || error;
    });

    inFlight.add(upload);

    void upload.finally(() => {
      inFlight.delete(upload);
    });

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }

    if (failure) {
      throw failure;
    }
  };

  try {
    for await (const chunk of data.source) {
      assertNotCancelled();

      if (failure) {
        throw failure;
      }

      const buffer: Buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as string);

      hash.update(buffer);
      totalBytes += buffer.length;
      pending.push(buffer);
      pendingBytes += buffer.length;

      while (pendingBytes >= data.partSizeInBytes) {
        await startPart(takePart(data.partSizeInBytes));
      }
    }

    assertNotCancelled();

    if (nextPartNumber === 1) {
      // Never reached a whole part: one request holds it all.
      const whole: Buffer = takePart(pendingBytes);
      await data.putWhole(whole);
      data.onProgress?.(whole.length);

      return {
        parts: [],
        sizeInBytes: totalBytes,
        sha256: hash.digest("hex"),
        isSinglePut: true,
      };
    }

    if (pendingBytes > 0) {
      await startPart(takePart(pendingBytes));
    }

    await Promise.all(Array.from(inFlight));

    if (failure) {
      throw failure;
    }

    assertNotCancelled();
  } catch (error) {
    // Let parts in flight settle before the caller abandons the upload.
    await Promise.allSettled(Array.from(inFlight));
    data.source.destroy();
    throw error;
  }

  parts.sort((a: UploadedPart, b: UploadedPart): number => {
    return a.partNumber - b.partNumber;
  });

  return {
    parts,
    sizeInBytes: totalBytes,
    sha256: hash.digest("hex"),
    isSinglePut: false,
  };
}
