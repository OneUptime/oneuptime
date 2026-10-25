import { describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import { Readable } from "stream";
import {
  BACKUP_PART_CONCURRENCY,
  BackupUploadCancelledError,
  chooseBackupPartSize,
  MIN_BACKUP_PART_SIZE_IN_BYTES,
  PartUploadResult,
  uploadInParts,
} from "../../../Server/Backup/Storage/PartUploader";
import { BackupStorageError } from "../../../Server/Backup/Storage/BackupStorage";

/*
 * A stream of any size up as parts of one size, never holding more than a
 * few: a dump of hundreds of gigabytes goes to the storage with the
 * worker's memory flat, pg_dump waiting on a slow storage rather than the
 * memory filling up. Every part but the last the same size (Cloudflare R2
 * takes nothing else), the SHA-256 of every byte taken on the way.
 */

const MIB: number = 1024 * 1024;

function bytes(length: number, seed: number = 1): Buffer {
  const buffer: Buffer = Buffer.alloc(length);

  for (let index: number = 0; index < length; index++) {
    buffer[index] = (index * 31 + seed) % 251;
  }

  return buffer;
}

// A stream that hands out `total` bytes in chunks of `chunk`, and counts how far it was read.
class CountingSource extends Readable {
  public produced: number = 0;
  private readonly total: number;
  private readonly chunk: number;
  private readonly data: Buffer;

  public constructor(data: Buffer, chunk: number) {
    super({ highWaterMark: chunk });
    this.data = data;
    this.total = data.length;
    this.chunk = chunk;
  }

  public override _read(): void {
    if (this.produced >= this.total) {
      this.push(null);
      return;
    }

    const next: Buffer = this.data.subarray(
      this.produced,
      Math.min(this.total, this.produced + this.chunk),
    );
    this.produced += next.length;
    this.push(next);
  }
}

describe("chooseBackupPartSize", () => {
  test("is 16 MiB for anything that fits the part limit twice over at that size", () => {
    expect(MIN_BACKUP_PART_SIZE_IN_BYTES).toBe(16 * MIB);
    expect(chooseBackupPartSize({ maxParts: 10000 })).toBe(16 * MIB);
    expect(
      chooseBackupPartSize({
        expectedSizeInBytes: 50 * 1024 * MIB,
        maxParts: 10000,
      }),
    ).toBe(16 * MIB);
  });

  test("grows, in whole MiB, so a large database leaves twice the room under S3's 10,000 parts", () => {
    const oneTebibyte: number = 1024 * 1024 * MIB;
    const size: number = chooseBackupPartSize({
      expectedSizeInBytes: oneTebibyte,
      maxParts: 10000,
    });

    expect(size % MIB).toBe(0);
    expect(size * 10000).toBeGreaterThanOrEqual(oneTebibyte * 2);
    expect((size - MIB) * 10000).toBeLessThan(oneTebibyte * 2);
  });

  test("Azure's 50,000 blocks need smaller parts for the same database", () => {
    const fiveTebibytes: number = 5 * 1024 * 1024 * MIB;

    expect(
      chooseBackupPartSize({
        expectedSizeInBytes: fiveTebibytes,
        maxParts: 50000,
      }),
    ).toBeLessThan(
      chooseBackupPartSize({
        expectedSizeInBytes: fiveTebibytes,
        maxParts: 10000,
      }),
    );
  });
});

describe("uploadInParts", () => {
  test("a stream larger than a part goes up as equal parts and a smaller last one, in order, every byte once", async () => {
    const data: Buffer = bytes(10 * 1024 + 123);
    const parts: Map<number, Buffer> = new Map<number, Buffer>();

    const result: PartUploadResult = await uploadInParts({
      source: new CountingSource(data, 700),
      partSizeInBytes: 1024,
      maxParts: 100,
      serviceTitle: "The test storage",
      uploadPart: async (partNumber: number, body: Buffer): Promise<string> => {
        parts.set(partNumber, body);
        return `etag-${partNumber}`;
      },
      putWhole: async (): Promise<void> => {
        throw new Error("Not a single put.");
      },
    });

    expect(result.isSinglePut).toBe(false);
    expect(result.sizeInBytes).toBe(data.length);
    expect(result.sha256).toBe(createHash("sha256").update(data).digest("hex"));
    expect(
      result.parts.map((part: { partNumber: number }): number => {
        return part.partNumber;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(result.parts[0]!.token).toBe("etag-1");

    const sizes: Array<number> = Array.from(parts.keys())
      .sort((a: number, b: number): number => {
        return a - b;
      })
      .map((key: number): number => {
        return parts.get(key)!.length;
      });

    expect(
      sizes.slice(0, -1).every((size: number): boolean => {
        return size === 1024;
      }),
    ).toBe(true);
    expect(sizes[sizes.length - 1]).toBe(123);
    expect(
      Buffer.concat(
        Array.from(parts.keys())
          .sort((a: number, b: number): number => {
            return a - b;
          })
          .map((key: number): Buffer => {
            return parts.get(key)!;
          }),
      ).equals(data),
    ).toBe(true);
  });

  test("a stream exactly a whole number of parts ends without an empty part", async () => {
    const parts: Array<number> = [];

    const result: PartUploadResult = await uploadInParts({
      source: Readable.from([bytes(2048)]),
      partSizeInBytes: 1024,
      maxParts: 100,
      serviceTitle: "The test storage",
      uploadPart: async (partNumber: number, body: Buffer): Promise<string> => {
        parts.push(body.length);
        return String(partNumber);
      },
      putWhole: async (): Promise<void> => {
        throw new Error("Not a single put.");
      },
    });

    expect(parts).toEqual([1024, 1024]);
    expect(result.parts).toHaveLength(2);
  });

  test("a stream smaller than a part goes up in one request, as a whole file", async () => {
    const data: Buffer = bytes(500);
    const wholes: Array<Buffer> = [];

    const result: PartUploadResult = await uploadInParts({
      source: Readable.from([data.subarray(0, 200), data.subarray(200)]),
      partSizeInBytes: 1024,
      maxParts: 100,
      serviceTitle: "The test storage",
      uploadPart: async (): Promise<string> => {
        throw new Error("Not a multipart upload.");
      },
      putWhole: async (body: Buffer): Promise<void> => {
        wholes.push(body);
      },
    });

    expect(result).toEqual({
      parts: [],
      sizeInBytes: 500,
      sha256: createHash("sha256").update(data).digest("hex"),
      isSinglePut: true,
    });
    expect(wholes).toHaveLength(1);
    expect(wholes[0]!.equals(data)).toBe(true);
  });

  test("an empty stream is an empty file", async () => {
    const wholes: Array<Buffer> = [];

    const result: PartUploadResult = await uploadInParts({
      source: Readable.from([]),
      partSizeInBytes: 1024,
      maxParts: 100,
      serviceTitle: "The test storage",
      uploadPart: async (): Promise<string> => {
        throw new Error("Not a multipart upload.");
      },
      putWhole: async (body: Buffer): Promise<void> => {
        wholes.push(body);
      },
    });

    expect(result.sizeInBytes).toBe(0);
    expect(
      wholes.map((body: Buffer): number => {
        return body.length;
      }),
    ).toEqual([0]);
  });

  test("never more than two parts in flight, and the stream read only as fast as parts go out", async () => {
    const partSize: number = 64 * 1024;
    const source: CountingSource = new CountingSource(
      bytes(40 * partSize),
      16 * 1024,
    );
    let inFlight: number = 0;
    let mostInFlight: number = 0;
    let mostReadAhead: number = 0;
    let uploaded: number = 0;

    await uploadInParts({
      source,
      partSizeInBytes: partSize,
      maxParts: 1000,
      serviceTitle: "The test storage",
      uploadPart: async (
        _partNumber: number,
        body: Buffer,
      ): Promise<string> => {
        inFlight++;
        mostInFlight = Math.max(mostInFlight, inFlight);
        // A slow storage.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 2);
        });
        mostReadAhead = Math.max(mostReadAhead, source.produced - uploaded);
        uploaded += body.length;
        inFlight--;
        return "etag";
      },
      putWhole: async (): Promise<void> => {
        throw new Error("Not a single put.");
      },
    });

    expect(BACKUP_PART_CONCURRENCY).toBe(2);
    expect(mostInFlight).toBeLessThanOrEqual(2);
    // The parts in flight, the one being gathered and the stream's own buffer: never the whole file.
    expect(mostReadAhead).toBeLessThan(6 * partSize);
  });

  test("reports how many bytes are up as each part lands", async () => {
    const progress: Array<number> = [];

    await uploadInParts({
      source: Readable.from([bytes(3000)]),
      partSizeInBytes: 1024,
      maxParts: 100,
      serviceTitle: "The test storage",
      concurrency: 1,
      onProgress: (uploadedBytes: number): void => {
        progress.push(uploadedBytes);
      },
      uploadPart: async (): Promise<string> => {
        return "etag";
      },
      putWhole: async (): Promise<void> => {
        throw new Error("Not a single put.");
      },
    });

    expect(progress).toEqual([1024, 2048, 3000]);
  });

  test("a part the storage refuses fails the upload with the storage's error, and stops reading the stream", async () => {
    const source: CountingSource = new CountingSource(bytes(100 * 1024), 1024);

    await expect(
      uploadInParts({
        source,
        partSizeInBytes: 1024,
        maxParts: 1000,
        serviceTitle: "The test storage",
        uploadPart: async (partNumber: number): Promise<string> => {
          if (partNumber === 3) {
            throw new BackupStorageError("The storage refused part 3.", {
              retryable: false,
            });
          }

          return "etag";
        },
        putWhole: async (): Promise<void> => {
          throw new Error("Not a single put.");
        },
      }),
    ).rejects.toThrow("The storage refused part 3.");

    expect(source.destroyed).toBe(true);
    expect(source.produced).toBeLessThan(100 * 1024);
  });

  test("a stream that fails (pg_dump stopping) fails the upload with its error", async () => {
    const source: Readable = new Readable({
      read(): void {
        this.push(bytes(1500));
        this.destroy(new Error("pg_dump failed: connection lost."));
      },
    });

    await expect(
      uploadInParts({
        source,
        partSizeInBytes: 1024,
        maxParts: 100,
        serviceTitle: "The test storage",
        uploadPart: async (): Promise<string> => {
          return "etag";
        },
        putWhole: async (): Promise<void> => {
          return undefined;
        },
      }),
    ).rejects.toThrow("pg_dump failed: connection lost.");
  });

  test("a file larger than the storage's parts allow fails with a sentence saying so", async () => {
    await expect(
      uploadInParts({
        source: Readable.from([bytes(5 * 1024)]),
        partSizeInBytes: 1024,
        maxParts: 3,
        serviceTitle: "Amazon S3",
        uploadPart: async (): Promise<string> => {
          return "etag";
        },
        putWhole: async (): Promise<void> => {
          return undefined;
        },
      }),
    ).rejects.toThrow(
      "The file is larger than Amazon S3 takes in one upload (3 parts of 0 MiB).",
    );
  });

  test("a cancelled upload stops, and says so", async () => {
    const controller: AbortController = new AbortController();
    const source: CountingSource = new CountingSource(bytes(50 * 1024), 1024);

    await expect(
      uploadInParts({
        source,
        partSizeInBytes: 1024,
        maxParts: 1000,
        serviceTitle: "The test storage",
        signal: controller.signal,
        uploadPart: async (partNumber: number): Promise<string> => {
          if (partNumber === 2) {
            controller.abort();
          }

          return "etag";
        },
        putWhole: async (): Promise<void> => {
          return undefined;
        },
      }),
    ).rejects.toBeInstanceOf(BackupUploadCancelledError);

    expect(source.destroyed).toBe(true);
  });

  test("a part is copied before it goes: the stream reusing its buffer cannot change a part in flight", async () => {
    const shared: Buffer = Buffer.alloc(1024, 1);
    let calls: number = 0;
    const received: Array<number> = [];

    const source: Readable = new Readable({
      read(): void {
        calls++;

        if (calls > 3) {
          this.push(null);
          return;
        }

        shared.fill(calls);
        this.push(shared);
      },
    });

    await uploadInParts({
      source,
      partSizeInBytes: 1024,
      maxParts: 100,
      serviceTitle: "The test storage",
      concurrency: 2,
      uploadPart: async (
        _partNumber: number,
        body: Buffer,
      ): Promise<string> => {
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 5);
        });
        received.push(body[0]!);
        return "etag";
      },
      putWhole: async (): Promise<void> => {
        return undefined;
      },
    });

    expect(received.sort()).toEqual([1, 2, 3]);
  });
});
