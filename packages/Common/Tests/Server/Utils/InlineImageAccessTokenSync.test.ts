import {
  extractImageAccessTokens,
  mayChangeImageVisibility,
  setIsPublicForMarkdownImages,
  syncIsPublicForMarkdownImages,
} from "../../../Server/Utils/InlineImageAccessTokenSync";
import FileService from "../../../Server/Services/FileService";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

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
  // Whether another record of the project still shows the image.
  let isStillShown: SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    isStillShown = jest
      .spyOn(PublishedImages, "isStillShown")
      .mockResolvedValue(false) as unknown as SpyInstance;
  });

  afterEach(() => {
    isStillShown.mockRestore();
  });

  it("does nothing when the markdown has no inline images", async () => {
    await setIsPublicForMarkdownImages("no images here", true, PROJECT_ID);

    expect(FileService.findOneBy).not.toHaveBeenCalled();
    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });

  it("flips every referenced file to public", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
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
      isPublic: true,
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
    expect(isStillShown).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      token: "aaa111",
    });
  });

  /*
   * An image is copied with the markdown it sits in - a template's image is
   * in every incident made from it - so one record that stops showing it
   * leaves it public while another of the project still shows it.
   */
  it("keeps an image public while another record of the project still shows it", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
      isPublic: true,
    } as never);
    isStillShown.mockResolvedValue(true);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(isStillShown).toHaveBeenCalledTimes(1);
    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });

  it("writes nothing for an image that already is as it should be", async () => {
    (FileService.findOneBy as unknown as jest.Mock)
      .mockResolvedValueOnce({
        _id: "11111111-1111-1111-1111-111111111111",
        projectId: PROJECT_ID,
        isPublic: true,
      } as never)
      .mockResolvedValueOnce({
        _id: "11111111-1111-1111-1111-111111111111",
        projectId: PROJECT_ID,
        isPublic: false,
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

    expect(FileService.updateOneById).not.toHaveBeenCalled();
    // A private image needs no look for who else shows it.
    expect(isStillShown).not.toHaveBeenCalled();
  });

  /*
   * isPublic is read strictly: only a real `true` is public, so an image
   * stored with anything else is made public when a record shows it.
   */
  it("treats anything but a real true as private", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
      isPublic: "true",
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
        projectId: PROJECT_ID,
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
      select: { _id: true, projectId: true, isPublic: true },
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
    (FileService.findOneBy as unknown as jest.Mock)
      .mockResolvedValueOnce({
        _id: "11111111-1111-1111-1111-111111111111",
        projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
        isPublic: false,
      } as never)
      .mockResolvedValueOnce({
        _id: "11111111-1111-1111-1111-111111111111",
        projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
        isPublic: true,
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
  /*
   * An image with no project is nobody's to flip: not public - so a token
   * pasted from elsewhere cannot open it to everyone - and not private.
   */
  it("never changes the visibility of an image with no project", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: null,
      isPublic: true,
    } as never);

    for (const isPublic of [true, false]) {
      await setIsPublicForMarkdownImages(
        `![a](${urlFor("aaa111")})`,
        isPublic,
        PROJECT_ID,
      );
    }

    expect(FileService.updateOneById).not.toHaveBeenCalled();
  });
});

describe("mayChangeImageVisibility", () => {
  it("lets a record change its own project's images, in any case of id", () => {
    expect(
      mayChangeImageVisibility({ projectId: PROJECT_ID }, PROJECT_ID),
    ).toBe(true);
    expect(
      mayChangeImageVisibility(
        { projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()) },
        PROJECT_ID,
      ),
    ).toBe(true);
  });

  it("refuses another project's images, images with no project, and any image for a note of no project", () => {
    expect(
      mayChangeImageVisibility({ projectId: OTHER_PROJECT_ID }, PROJECT_ID),
    ).toBe(false);
    expect(mayChangeImageVisibility({}, PROJECT_ID)).toBe(false);
    expect(mayChangeImageVisibility({ projectId: null }, PROJECT_ID)).toBe(
      false,
    );
    expect(mayChangeImageVisibility({ projectId: PROJECT_ID }, null)).toBe(
      false,
    );
    expect(mayChangeImageVisibility({ projectId: PROJECT_ID }, undefined)).toBe(
      false,
    );
  });
});

describe("syncIsPublicForMarkdownImages", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("flips images public like the unwrapped call", async () => {
    (FileService.findOneBy as unknown as jest.Mock).mockResolvedValue({
      _id: "11111111-1111-1111-1111-111111111111",
      projectId: PROJECT_ID,
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
      projectId: PROJECT_ID,
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
