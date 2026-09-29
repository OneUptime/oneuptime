import FileService from "../../../Server/Services/FileService";
import File from "../../../Models/DatabaseModels/File";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import MimeType from "../../../Types/File/MimeType";
import { describe, expect, it } from "@jest/globals";

/*
 * fileType is declared as MimeType but persisted as a varchar, so the enum is
 * gone by the time a request reaches the database - POST /api/file would store
 * whatever string the client asked for, including "text/html". Response.ts
 * refuses to echo an unknown type back, but this hook is what keeps the column
 * matching the set of types we are actually willing to serve
 * (GHSA-rrqw-5vj9-m9xg).
 *
 * No database - onBeforeCreate is called directly.
 */

type OnBeforeCreateFunction = (
  createBy: CreateBy<File>,
) => Promise<OnCreate<File>>;

const onBeforeCreate: OnBeforeCreateFunction = (
  createBy: CreateBy<File>,
): Promise<OnCreate<File>> => {
  return (
    FileService as unknown as { onBeforeCreate: OnBeforeCreateFunction }
  ).onBeforeCreate(createBy);
};

function createByWithFileType(fileType: string | undefined): CreateBy<File> {
  const file: File = new File();
  file.name = "upload";
  file.file = Buffer.from("bytes");
  file.fileType = fileType as MimeType;

  return { data: file, props: { isRoot: true } } as CreateBy<File>;
}

describe("FileService.onBeforeCreate fileType validation", () => {
  it("rejects a MIME type that is not a known type", async () => {
    await expect(
      onBeforeCreate(createByWithFileType("text/html")),
    ).rejects.toThrow(BadDataException);

    await expect(
      onBeforeCreate(createByWithFileType("not-a-mime-type")),
    ).rejects.toThrow(BadDataException);
  });

  it("rejects a missing MIME type instead of storing an empty one", async () => {
    await expect(
      onBeforeCreate(createByWithFileType(undefined)),
    ).rejects.toThrow(BadDataException);
  });

  it("accepts the types the file picker actually produces", async () => {
    for (const fileType of [
      MimeType.png,
      MimeType.jpeg,
      MimeType.svg,
      MimeType.pdf,
      MimeType.txt,
    ]) {
      const result: OnCreate<File> = await onBeforeCreate(
        createByWithFileType(fileType),
      );

      expect(result.createBy.data.fileType).toBe(fileType);
    }
  });

  it("normalises casing and whitespace so the stored value is comparable", async () => {
    const result: OnCreate<File> = await onBeforeCreate(
      createByWithFileType("  IMAGE/PNG  "),
    );

    expect(result.createBy.data.fileType).toBe(MimeType.png);
  });

  it("still generates the image access token for an accepted upload", async () => {
    const result: OnCreate<File> = await onBeforeCreate(
      createByWithFileType(MimeType.png),
    );

    expect(result.createBy.data.imageAccessToken).toHaveLength(64);
  });
});
