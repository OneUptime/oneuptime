import StatusPageImageCache, {
  StatusPageImage,
  StatusPageImageFile,
  StatusPageImageName,
} from "../../../../Server/Utils/StatusPage/StatusPageImageCache";
import StatusPageOverviewCache from "../../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import ObjectID from "../../../../Types/ObjectID";
import FakeGlobalCacheStrings from "../../TestingUtils/Redis/FakeGlobalCacheStrings";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createHash } from "crypto";
import type { Mock } from "jest-mock";

jest.mock("../../../../Server/Utils/Logger");

/*
 * A status page's images kept in memory: read once per page, image and
 * project generation, served with a strong ETag of their bytes, and bounded
 * - at most MAX_BYTES of every page's images, the least recently used let
 * go first, none over MAX_IMAGE_BYTES kept at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "76000000-0000-4000-8000-000000000001",
);

const DEFAULTS: { maxBytes: number; maxImage: number; maxEntries: number } = {
  maxBytes: StatusPageImageCache.MAX_BYTES,
  maxImage: StatusPageImageCache.MAX_IMAGE_BYTES,
  maxEntries: StatusPageImageCache.MAX_ENTRIES,
};

function imageFile(text: string): StatusPageImageFile {
  return { bytes: Buffer.from(text), fileType: "image/png", name: "logo.png" };
}

// A read of a page's image, counting its calls.
function reader(
  file: StatusPageImageFile | null,
): Mock<() => Promise<StatusPageImageFile | null>> {
  return jest.fn(async (): Promise<StatusPageImageFile | null> => {
    return file;
  });
}

async function imageOf(data: {
  statusPageId: ObjectID;
  image?: StatusPageImageName;
  read: () => Promise<StatusPageImageFile | null>;
  projectId?: ObjectID | null;
}): Promise<StatusPageImage | null> {
  return await StatusPageImageCache.getOrRead({
    statusPageId: data.statusPageId,
    image: data.image || "logo",
    readProjectId: async (): Promise<ObjectID | null> => {
      return data.projectId === undefined ? PROJECT_ID : data.projectId;
    },
    read: data.read,
  });
}

function moveClock(ms: number): void {
  const now: number = Date.now() + ms;
  jest.spyOn(Date, "now").mockReturnValue(now);
}

beforeEach(() => {
  StatusPageOverviewCache.clear();
  StatusPageImageCache.clear();
  new FakeGlobalCacheStrings().install();
});

afterEach(() => {
  jest.restoreAllMocks();
  StatusPageImageCache.MAX_BYTES = DEFAULTS.maxBytes;
  StatusPageImageCache.MAX_IMAGE_BYTES = DEFAULTS.maxImage;
  StatusPageImageCache.MAX_ENTRIES = DEFAULTS.maxEntries;
  StatusPageOverviewCache.clear();
  StatusPageImageCache.clear();
});

describe("StatusPageImageCache.getETag", () => {
  test("is the quoted first 32 hex characters of the bytes' SHA-256: strong, and the same in every pod", () => {
    const bytes: Buffer = Buffer.from("logo bytes");

    expect(StatusPageImageCache.getETag(bytes)).toBe(
      `"${createHash("sha256").update(bytes).digest("hex").slice(0, 32)}"`,
    );
    expect(StatusPageImageCache.getETag(bytes).startsWith("W/")).toBe(false);
  });

  test("changes with a single byte", () => {
    expect(StatusPageImageCache.getETag(Buffer.from("logo-a"))).not.toBe(
      StatusPageImageCache.getETag(Buffer.from("logo-b")),
    );
  });
});

describe("StatusPageImageCache.getOrRead", () => {
  test("keeps a page's image: read once, served with the tag of its bytes", async () => {
    const page: ObjectID = ObjectID.generate();
    const read: Mock<() => Promise<StatusPageImageFile | null>> = reader(
      imageFile("the logo"),
    );

    const first: StatusPageImage | null = await imageOf({
      statusPageId: page,
      read,
    });
    const second: StatusPageImage | null = await imageOf({
      statusPageId: page,
      read,
    });

    expect(read).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first!.bytes.toString()).toBe("the logo");
    expect(first!.etag).toBe(
      StatusPageImageCache.getETag(Buffer.from("the logo")),
    );
  });

  test("keeps a page without the image as having none", async () => {
    const page: ObjectID = ObjectID.generate();
    const read: Mock<() => Promise<StatusPageImageFile | null>> = reader(null);

    expect(await imageOf({ statusPageId: page, read })).toBeNull();
    expect(await imageOf({ statusPageId: page, read })).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  test("never keeps a page that does not exist", async () => {
    const read: Mock<() => Promise<StatusPageImageFile | null>> = reader(null);

    for (let i: number = 0; i < 3; i++) {
      await imageOf({
        statusPageId: ObjectID.generate(),
        projectId: null,
        read,
      });
    }

    expect(read).toHaveBeenCalledTimes(3);
    expect(StatusPageImageCache.getSize().entries).toBe(0);
  });

  test("keeps each page and each image apart", async () => {
    const page: ObjectID = ObjectID.generate();
    const otherPage: ObjectID = ObjectID.generate();

    const logo: StatusPageImage | null = await imageOf({
      statusPageId: page,
      image: "logo",
      read: reader(imageFile("page logo")),
    });
    const favicon: StatusPageImage | null = await imageOf({
      statusPageId: page,
      image: "favicon",
      read: reader(imageFile("page favicon")),
    });
    const otherLogo: StatusPageImage | null = await imageOf({
      statusPageId: otherPage,
      image: "logo",
      read: reader(imageFile("other page logo")),
    });

    expect(logo!.bytes.toString()).toBe("page logo");
    expect(favicon!.bytes.toString()).toBe("page favicon");
    expect(otherLogo!.bytes.toString()).toBe("other page logo");
  });

  test("a write to the page's settings - a new logo - reads it again at once", async () => {
    const page: ObjectID = ObjectID.generate();

    await imageOf({ statusPageId: page, read: reader(imageFile("old logo")) });

    await StatusPageOverviewCache.afterUpdate({
      tableName: "StatusPage",
      rows: [{ projectId: PROJECT_ID.toString() }],
      written: { logoFileId: ObjectID.generate() },
    });

    const after: StatusPageImage | null = await imageOf({
      statusPageId: page,
      read: reader(imageFile("new logo")),
    });

    expect(after!.bytes.toString()).toBe("new logo");
  });

  test("runs out after TTL_MS", async () => {
    const page: ObjectID = ObjectID.generate();
    const read: Mock<() => Promise<StatusPageImageFile | null>> = reader(
      imageFile("the logo"),
    );

    await imageOf({ statusPageId: page, read });

    moveClock(StatusPageImageCache.TTL_MS - 100);
    await imageOf({ statusPageId: page, read });
    expect(read).toHaveBeenCalledTimes(1);

    moveClock(200);
    await imageOf({ statusPageId: page, read });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("an image over MAX_IMAGE_BYTES is served as it is read, never kept", async () => {
    StatusPageImageCache.MAX_IMAGE_BYTES = 8;

    const page: ObjectID = ObjectID.generate();
    const read: Mock<() => Promise<StatusPageImageFile | null>> = reader(
      imageFile("a big cover image"),
    );

    expect(
      (await imageOf({ statusPageId: page, read }))!.bytes.toString(),
    ).toBe("a big cover image");
    await imageOf({ statusPageId: page, read });

    expect(read).toHaveBeenCalledTimes(2);
    expect(StatusPageImageCache.getSize()).toEqual({ entries: 0, bytes: 0 });
  });

  test("keeps at most MAX_BYTES: the least recently used image is let go first", async () => {
    StatusPageImageCache.MAX_BYTES = 30;

    const pages: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ];
    const reads: Array<Mock<() => Promise<StatusPageImageFile | null>>> = [
      reader(imageFile("A".repeat(10))),
      reader(imageFile("B".repeat(10))),
      reader(imageFile("C".repeat(15))),
    ];

    await imageOf({ statusPageId: pages[0]!, read: reads[0]! });
    await imageOf({ statusPageId: pages[1]!, read: reads[1]! });

    // A is used again: B is now the least recently used.
    await imageOf({ statusPageId: pages[0]!, read: reads[0]! });

    // C needs room for 15 bytes: B goes, A stays.
    await imageOf({ statusPageId: pages[2]!, read: reads[2]! });

    expect(StatusPageImageCache.getSize().bytes).toBeLessThanOrEqual(30);

    await imageOf({ statusPageId: pages[0]!, read: reads[0]! });
    await imageOf({ statusPageId: pages[1]!, read: reads[1]! });

    expect(reads[0]).toHaveBeenCalledTimes(1);
    expect(reads[1]).toHaveBeenCalledTimes(2);
  });

  test("keeps at most MAX_ENTRIES images", async () => {
    StatusPageImageCache.MAX_ENTRIES = 3;

    for (let i: number = 0; i < 10; i++) {
      await imageOf({
        statusPageId: ObjectID.generate(),
        read: reader(imageFile(`logo ${i}`)),
      });
    }

    expect(StatusPageImageCache.getSize().entries).toBe(3);
  });

  test("lets go of images whose life is over, rather than holding their bytes until newer ones push them out", async () => {
    await imageOf({
      statusPageId: ObjectID.generate(),
      read: reader(imageFile("an old page's logo")),
    });

    expect(StatusPageImageCache.getSize().entries).toBe(1);

    moveClock(StatusPageImageCache.TTL_MS + 2_000);

    await imageOf({
      statusPageId: ObjectID.generate(),
      read: reader(imageFile("a new page's logo")),
    });

    expect(StatusPageImageCache.getSize().entries).toBe(1);
    expect(StatusPageImageCache.getSize().bytes).toBe(
      Buffer.from("a new page's logo").length,
    );
  });

  test("requests that miss together share one read; a failed read is never kept", async () => {
    const page: ObjectID = ObjectID.generate();
    const read: Mock<() => Promise<StatusPageImageFile | null>> = reader(
      imageFile("the logo"),
    );

    await Promise.all([
      imageOf({ statusPageId: page, read }),
      imageOf({ statusPageId: page, read }),
    ]);
    expect(read).toHaveBeenCalledTimes(1);

    const failingPage: ObjectID = ObjectID.generate();
    let calls: number = 0;
    const flaky: () => Promise<StatusPageImageFile | null> = async () => {
      calls++;
      if (calls === 1) {
        throw new Error("Postgres is down");
      }
      return imageFile("read the second time");
    };

    await expect(
      imageOf({ statusPageId: failingPage, read: flaky }),
    ).rejects.toThrow("Postgres is down");
    expect(
      (await imageOf({
        statusPageId: failingPage,
        read: flaky,
      }))!.bytes.toString(),
    ).toBe("read the second time");
  });
});
