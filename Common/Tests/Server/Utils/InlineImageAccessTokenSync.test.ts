import {
  extractImageAccessTokens,
  setIsPublicForMarkdownImages,
  syncIsPublicForMarkdownImages,
} from "../../../Server/Utils/InlineImageAccessTokenSync";
import FileService from "../../../Server/Services/FileService";
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
    await setIsPublicForMarkdownImages("no images here", true);

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
    } as never);

    await setIsPublicForMarkdownImages(`![a](${urlFor("aaa111")})`, false);

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

    await setIsPublicForMarkdownImages(`![a](${urlFor("aaa111")})`, true);

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
    );

    expect(FileService.updateOneById).toHaveBeenCalledTimes(1);
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
    );

    expect(
      (FileService.updateOneById as unknown as jest.Mock).mock.calls[0]?.[0],
    ).toMatchObject({
      data: { isPublic: true },
    });
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
      ),
    ).resolves.toBeUndefined();
  });
});
