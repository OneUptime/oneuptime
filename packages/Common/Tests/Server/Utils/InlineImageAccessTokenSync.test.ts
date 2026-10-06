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

jest.mock("../../../Server/Services/FileService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateBy: jest.fn(),
      getRepository: jest.fn(),
    },
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

const FILE_ID: string = "11111111-1111-4111-8111-111111111111";
const SECOND_FILE_ID: string = "22222222-2222-4222-8222-222222222222";

const findBy: jest.Mock = FileService.findBy as unknown as jest.Mock;
const updateBy: jest.Mock = FileService.updateBy as unknown as jest.Mock;
const getRepository: jest.Mock =
  FileService.getRepository as unknown as jest.Mock;

// What the still-shown query answers: the tokens a record still shows.
let stillShownQuery: jest.Mock;

// The files the one lookup finds.
function filesFound(
  files: Array<{
    _id: string;
    imageAccessToken: string;
    projectId: ObjectID | null;
    isPublic: unknown;
  }>,
): void {
  findBy.mockResolvedValue(files as never);
}

// The visibility each write set, in order.
function written(): Array<unknown> {
  return updateBy.mock.calls.map((call: Array<any>) => {
    return call[0]?.data;
  });
}

beforeEach(() => {
  jest.resetAllMocks();

  findBy.mockResolvedValue([] as never);
  updateBy.mockResolvedValue(1 as never);
  stillShownQuery = jest.fn().mockResolvedValue([] as never);
  getRepository.mockReturnValue({ manager: { query: stillShownQuery } });
});

afterEach(() => {
  jest.restoreAllMocks();
});

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

describe("setIsPublicForMarkdownImages: the markdown's images, through PublishedImages", () => {
  it("does nothing when the markdown has no inline images", async () => {
    const setImagesVisibility: jest.SpyInstance = jest.spyOn(
      PublishedImages,
      "setImagesVisibility",
    );

    await setIsPublicForMarkdownImages("no images here", true, PROJECT_ID);

    expect(setImagesVisibility).not.toHaveBeenCalled();
    expect(findBy).not.toHaveBeenCalled();
  });

  it("asks for every image of the markdown public, or private, for the record's project", async () => {
    const setImagesVisibility: jest.SpyInstance = jest
      .spyOn(PublishedImages, "setImagesVisibility")
      .mockResolvedValue(undefined as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")}) ![b](${urlFor("bbb222")})`,
      true,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(setImagesVisibility.mock.calls).toEqual([
      [{ projectId: PROJECT_ID, publish: ["aaa111", "bbb222"], unpublish: [] }],
      [{ projectId: PROJECT_ID, publish: [], unpublish: ["aaa111"] }],
    ]);
  });

  it("flips every image of the record's own project public, in one lookup and one write", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: false,
      },
      {
        _id: SECOND_FILE_ID,
        imageAccessToken: "bbb222",
        projectId: PROJECT_ID,
        isPublic: false,
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")}) ![b](${urlFor("bbb222")})`,
      true,
      PROJECT_ID,
    );

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]?.[0]).toMatchObject({
      select: { _id: true, projectId: true, isPublic: true },
      props: { isRoot: true },
    });
    expect(written()).toEqual([{ isPublic: true }]);
  });

  it("flips an image back to private once nothing of the project shows it", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: true,
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(stillShownQuery).toHaveBeenCalledTimes(1);
    expect(stillShownQuery.mock.calls[0]?.[1]).toEqual([
      PROJECT_ID.toString(),
      ["%/file/image/access-token/aaa111%"],
      ["aaa111"],
    ]);
    expect(written()).toEqual([{ isPublic: false }]);
  });

  /*
   * An image is copied with the markdown it sits in - a template's image is
   * in every incident made from it - so one record that stops showing it
   * leaves it public while another of the project still shows it.
   */
  it("keeps an image public while another record of the project still shows it", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: true,
      },
    ]);
    stillShownQuery.mockResolvedValue([{ token: "aaa111" }] as never);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(updateBy).not.toHaveBeenCalled();
  });

  it("writes nothing for an image that already is as it should be", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: true,
      },
      {
        _id: SECOND_FILE_ID,
        imageAccessToken: "bbb222",
        projectId: PROJECT_ID,
        isPublic: false,
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(
      `![b](${urlFor("bbb222")})`,
      false,
      PROJECT_ID,
    );

    expect(updateBy).not.toHaveBeenCalled();
    // A private image needs no look for who else shows it.
    expect(stillShownQuery).not.toHaveBeenCalled();
  });

  /*
   * isPublic is read strictly: only a real `true` is public, so an image
   * stored with anything else is made public when a record shows it.
   */
  it("treats anything but a real true as private", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: "true",
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );

    expect(written()).toEqual([{ isPublic: true }]);
  });

  it("skips tokens with no matching file", async () => {
    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );

    expect(updateBy).not.toHaveBeenCalled();
  });

  /*
   * A token travels with the markdown it is copied into: a note of one
   * project must never make another project's image readable by everyone,
   * nor private again under the status page that shows it.
   */
  it("never changes the visibility of another project's image", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: OTHER_PROJECT_ID,
        isPublic: false,
      },
      {
        _id: SECOND_FILE_ID,
        imageAccessToken: "bbb222",
        projectId: OTHER_PROJECT_ID,
        isPublic: true,
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(
      `![b](${urlFor("bbb222")})`,
      false,
      PROJECT_ID,
    );
    await setIsPublicForMarkdownImages(`![a](${urlFor("aaa111")})`, true, null);

    expect(updateBy).not.toHaveBeenCalled();
  });

  it("changes the visibility of an image of the note's own project, in both directions, in any case of id", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
        isPublic: false,
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      PROJECT_ID,
    );

    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: new ObjectID(PROJECT_ID.toString().toUpperCase()),
        isPublic: true,
      },
    ]);

    await setIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      false,
      PROJECT_ID,
    );

    expect(written()).toEqual([{ isPublic: true }, { isPublic: false }]);
  });

  /*
   * An image with no project is nobody's to flip: not public - so a token
   * pasted from elsewhere cannot open it to everyone - and not private.
   */
  it("never changes the visibility of an image with no project", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: null,
        isPublic: true,
      },
    ]);

    for (const isPublic of [true, false]) {
      await setIsPublicForMarkdownImages(
        `![a](${urlFor("aaa111")})`,
        isPublic,
        PROJECT_ID,
      );
    }

    expect(updateBy).not.toHaveBeenCalled();
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
  it("flips images public like the unwrapped call", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: false,
      },
    ]);

    await syncIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      "test context",
      PROJECT_ID,
    );

    expect(written()).toEqual([{ isPublic: true }]);
  });

  it("holds the note to its project like the unwrapped call", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: OTHER_PROJECT_ID,
        isPublic: false,
      },
    ]);

    await syncIsPublicForMarkdownImages(
      `![a](${urlFor("aaa111")})`,
      true,
      "test context",
      PROJECT_ID,
    );

    expect(updateBy).not.toHaveBeenCalled();
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

  it("never throws when the lookup or the update itself fails", async () => {
    filesFound([
      {
        _id: FILE_ID,
        imageAccessToken: "aaa111",
        projectId: PROJECT_ID,
        isPublic: false,
      },
    ]);
    updateBy.mockRejectedValue(new Error("write failed") as never);

    await expect(
      syncIsPublicForMarkdownImages(
        `![a](${urlFor("aaa111")})`,
        true,
        "test context",
        PROJECT_ID,
      ),
    ).resolves.toBeUndefined();

    findBy.mockRejectedValue(new Error("read failed") as never);

    await expect(
      syncIsPublicForMarkdownImages(
        `![a](${urlFor("aaa111")})`,
        true,
        "test context",
        PROJECT_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it("never throws when PublishedImages itself does", async () => {
    jest
      .spyOn(PublishedImages, "setImagesVisibility")
      .mockRejectedValue(new Error("unexpected") as never);

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
