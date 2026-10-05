import {
  extractImageAccessTokens,
  mayChangeImageVisibility,
  setIsPublicForMarkdownImages,
  syncIsPublicForMarkdownImages,
} from "../../../Server/Utils/InlineImageAccessTokenSync";
import FileService from "../../../Server/Services/FileService";
import ObjectID from "../../../Types/ObjectID";
import { beforeEach, describe, expect, it } from "@jest/globals";

jest.mock("../../../Server/Services/FileService", () => {
  return {
    findOneBy: jest.fn(),
    updateOneById: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
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

const urlFor: (token: string) => string = (token: string): string => {
  return `https://example.com/file/image/access-token/${token}`;
};

// The project of the note whose markdown is synced.
const PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

describe("extractImageAccessTokens", () => {
  it("returns nothing for empty, null or undefined markdown", () => {
    expect(extractImageAccessTokens("")).toEqual([]);
    expect(extractImageAccessTokens(null)).toEqual([]);
    expect(extractImageAccessTokens(undefined)).toEqual([]);
  });

  it("returns nothing when the markdown has no inline images", () => {
    expect(extractImageAccessTokens("Just some **notes** about the outage.")) //
      .toEqual([]);
  });

  it("extracts a single token", () => {
    expect(extractImageAccessTokens(`![shot](${urlFor("abc123")})`)).toEqual([
      "abc123",
    ]);
  });

  it("extracts every distinct token in the markdown", () => {
    const markdown: string = `![a](${urlFor("aaa111")}) and ![b](${urlFor("bbb222")})`;

    expect(extractImageAccessTokens(markdown)).toEqual(["aaa111", "bbb222"]);
  });

  it("de-duplicates a token referenced more than once", () => {
    const markdown: string = `![a](${urlFor("aaa111")}) again ![a](${urlFor("aaa111")})`;

    expect(extractImageAccessTokens(markdown)).toEqual(["aaa111"]);
  });

  it("ignores urls that are not access-token image urls", () => {
    const markdown: string = `![logo](https://example.com/file/image/abc123) ![x](https://example.com/img.png)`;

    expect(extractImageAccessTokens(markdown)).toEqual([]);
  });

  it("only matches hex tokens", () => {
    expect(extractImageAccessTokens(`![a](${urlFor("zzzznothex")})`)).toEqual(
      [],
    );
  });
});

describe("setIsPublicForMarkdownImages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing when the markdown has no inline images", async () => {
    await setIsPublicForMarkdownImages("no images here", true, PROJECT_ID);

    expect(FileService.findOneBy).not.toHaveBeenCalled();
    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });

  it("flips every referenced file to public", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")}) ![b](${urlFor("bbb222")})`,
      true,
      PROJECT_ID,
    );

    expect(FileService.updateOneById).toHaveBeenCalledTimes(2);
    expect(
      (FileService.updateOneById as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toMatchObject({
      data: { isPublic: true },
    });
  });

  it("flips files back to private when told to", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(
      (FileService.updateOneById as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toMatchObject({
      data: { isPublic: false },
    });
  });

  it("skips tokens with no matching file", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue(
      null as never,
    );

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );

    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * One unreadable file must not strand the rest of the note's images in the
   * wrong visibility — a half-published note is worse than a slow one.
   */
  it("keeps going when one token fails", async () => {
    (FileService.findOneBy as unknown as jest.Mock)
      .mockRejectedValueOnce(new Error("db down") as never)
      .mockResolvedValueOnce({
        _id: "22222222-2222-2222-2222-222222222222",
      } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")}) ![b](${urlFor("bbb222")})`,
      true,
      PROJECT_ID,
    );

    expect(FileService.updateOneById).toHaveBeenCalledTimes(1);
  });

  it("reads each image's project along with it", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );

    expect(
      (FileService.findOneBy as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toMatchObject({
      query: { imageAccessToken: "aaa111" },
      select: { _id: true, projectId: true },
      props: { isRoot: true },
    });
    expect(FileService.updateOneById).toHaveBeenCalledTimes(1);
  });

  /*
   * A token travels with the markdown it is copied into: a note of one
   * project must never make another project's image readable by everyone,
   * nor private again under the status page that shows it.
   */
  it("never changes the visibility of another project's image", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: OTHER_PROJECT_ID,
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(`![a](${urlFor("aaa111")})`, true, null);

    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });

  it("changes the visibility of an image of the note's own project, in both directions", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(
      (FileService.updateOneById as unknown as jest.Mock).mock.calls.map(
        (call: Array<any>) => {
          return call[0]?.data;
        },
      ),
    ).toEqual([{ isPublic: true }, { isPublic: false }]);
  });

  /*
   * Images uploaded before files recorded their project have none, and
   * nothing says whose they are: they keep the behaviour they always had.
   */
  it("still makes public an image with no project, so reused markdown renders", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: null,
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );

    expect(
      (FileService.updateOneById as unknown as jest.Mock).mock.calls.map(
        (call: Array<any>) => {
          return call[0]?.data;
        },
      ),
    ).toEqual([{ isPublic: true }]);
  });

  /*
   * Nothing says whose page an image with no project is showing on, so no
   * record makes one private again - not even under a page that shows it.
   */
  it("never makes an image with no project private", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: null,
    } as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("mayChangeImageVisibility", () => {
  it("lets a record make its own project's images public and private", () => {
    for (const isPublic of [true, false]) {
      expect(
        mayChangeImageVisibility(
          { projectId: PROJECT_ID },
          PROJECT_ID,
          isPublic,
        ),
      ).toBe(true);
    }
  });

  it("lets an image with no project be made public, never private", () => {
    expect(mayChangeImageVisibility({}, PROJECT_ID, true)).toBe(true);
    expect(mayChangeImageVisibility({ projectId: undefined }, null, true)).toBe(
      true,
    );
    expect(mayChangeImageVisibility({}, PROJECT_ID, false)).toBe(false);
    expect(
      mayChangeImageVisibility({ projectId: null }, PROJECT_ID, false),
    ).toBe(false);
  });

  it("refuses another project's images either way, and any image for a note of no project", () => {
    for (const isPublic of [true, false]) {
      expect(
        mayChangeImageVisibility(
          { projectId: OTHER_PROJECT_ID },
          PROJECT_ID,
          isPublic,
        ),
      ).toBe(false);
      expect(
        mayChangeImageVisibility({ projectId: PROJECT_ID }, null, isPublic),
      ).toBe(false);
      expect(
        mayChangeImageVisibility(
          { projectId: PROJECT_ID },
          undefined,
          isPublic,
        ),
      ).toBe(false);
    }
  });
});

describe("syncIsPublicForMarkdownImages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("flips images public like the unwrapped call", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
    } as never);

    await syncIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      "test context",
      PROJECT_ID,
    );

    expect(
      (FileService.updateOneById as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toMatchObject({
      data: { isPublic: true },
    });
  });

  it("holds the note to its project like the unwrapped call", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: OTHER_PROJECT_ID,
    } as never);

    await syncIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      "test context",
      PROJECT_ID,
    );

    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });

  /*
   * Visibility sync is best-effort by design: publishing a note must not fail
   * because an image could not be flipped.
   */
  it("never throws, even when the markdown itself is unusable", async () => {
    await expect(
      syncIsPublicForMarkdownImages(
        123 as unknown as string,
        true,
        "test context",
        PROJECT_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it("never throws when the update itself fails", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
    } as never);
    (FileService.updateOneById as unknown as jest.Mock).mockRejectedValue(
      new Error("write failed") as never,
    );

    await expect(
      syncIsPublicForMarkdownImages(
        `![a](${urlFor("aaa111")})`,
        true,
        "test context",
        PROJECT_ID,
      ),
    ).resolves.toBeUndefined();
  });
});
