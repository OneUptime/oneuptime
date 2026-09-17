import ObjectID from "../../../Types/ObjectID";
import File from "../../../Models/DatabaseModels/File";

/*
 * FileService reaches Postgres, so it is faked. The behaviour worth pinning is
 * the util's own bookkeeping: it de-duplicates ids before querying, but then
 * renders from the ORIGINAL id list, so a duplicated id renders twice. The
 * tests below state that explicitly rather than leaving it to be discovered.
 */
const findByMock: jest.Mock = jest.fn();

jest.mock("../../../Server/Services/FileService", () => {
  return {
    __esModule: true,
    default: {
      findBy: (...args: Array<unknown>) => {
        return findByMock(...args);
      },
    },
  };
});

import FileAttachmentMarkdownUtil from "../../../Server/Utils/FileAttachmentMarkdownUtil";

type MakeFileFunction = (data: { id: string; name?: string }) => File;

const makeFile: MakeFileFunction = (data: {
  id: string;
  name?: string;
}): File => {
  const file: File = new File();
  file._id = data.id;

  if (data.name !== undefined) {
    file.name = data.name;
  }

  return file;
};

describe("FileAttachmentMarkdownUtil.buildAttachmentMarkdown", () => {
  const modelId: ObjectID = ObjectID.generate();
  const attachmentApiPath: string = "/incident/attachment";

  beforeEach(() => {
    findByMock.mockReset();
  });

  test("should return an empty string when there are no attachment ids", async () => {
    expect(
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [],
        attachmentApiPath,
      }),
    ).toEqual("");

    expect(findByMock).not.toHaveBeenCalled();
  });

  test("should return an empty string when there is no model id", async () => {
    expect(
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId: undefined as unknown as ObjectID,
        attachmentIds: [ObjectID.generate()],
        attachmentApiPath,
      }),
    ).toEqual("");

    expect(findByMock).not.toHaveBeenCalled();
  });

  test("should return an empty string when no files are found", async () => {
    findByMock.mockResolvedValue([]);

    expect(
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [ObjectID.generate()],
        attachmentApiPath,
      }),
    ).toEqual("");
  });

  test("should render a markdown link per file", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValue([
      makeFile({ id: first.toString(), name: "runbook.pdf" }),
      makeFile({ id: second.toString(), name: "screenshot.png" }),
    ]);

    const markdown: string =
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [first, second],
        attachmentApiPath,
      });

    expect(markdown).toContain("**Attachments:**");
    expect(markdown).toContain(`[runbook.pdf](`);
    expect(markdown).toContain(`[screenshot.png](`);
    expect(markdown).toContain(`${modelId.toString()}/${first.toString()}`);
    expect(markdown).toContain(`${modelId.toString()}/${second.toString()}`);
  });

  test("should render links in the order the ids were given, not the order they were found", async () => {
    const first: ObjectID = ObjectID.generate();
    const second: ObjectID = ObjectID.generate();

    // The database returns them the other way round.
    findByMock.mockResolvedValue([
      makeFile({ id: second.toString(), name: "second.txt" }),
      makeFile({ id: first.toString(), name: "first.txt" }),
    ]);

    const markdown: string =
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [first, second],
        attachmentApiPath,
      });

    expect(markdown.indexOf("first.txt")).toBeLessThan(
      markdown.indexOf("second.txt"),
    );
  });

  test("should skip ids that have no matching file", async () => {
    const found: ObjectID = ObjectID.generate();
    const missing: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValue([
      makeFile({ id: found.toString(), name: "found.txt" }),
    ]);

    const markdown: string =
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [found, missing],
        attachmentApiPath,
      });

    expect(markdown).toContain("found.txt");
    expect(markdown).not.toContain(missing.toString());
    expect(markdown.split("\n- ").length - 1).toEqual(1);
  });

  test("should query each distinct id only once", async () => {
    const id: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValue([
      makeFile({ id: id.toString(), name: "a.txt" }),
    ]);

    await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
      modelId,
      attachmentIds: [id, id, id],
      attachmentApiPath,
    });

    const query: Record<string, unknown> = (
      findByMock.mock.calls[0]![0] as Record<string, Record<string, unknown>>
    )["query"]!;

    expect(JSON.stringify(query)).toContain(id.toString());
    // De-duplicated: the id must appear exactly once in the query.
    expect(JSON.stringify(query).split(id.toString()).length - 1).toEqual(1);
  });

  test("should still render a duplicated id once per occurrence", async () => {
    /*
     * De-duplication happens for the lookup only; rendering walks the original
     * attachmentIds array. Pinning current behaviour so a change here is a
     * deliberate one.
     */
    const id: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValue([
      makeFile({ id: id.toString(), name: "a.txt" }),
    ]);

    const markdown: string =
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [id, id],
        attachmentApiPath,
      });

    expect(markdown.split("a.txt").length - 1).toEqual(2);
  });

  test("should fall back to 'Attachment' when a file has no name", async () => {
    const id: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValue([makeFile({ id: id.toString() })]);

    const markdown: string =
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [id],
        attachmentApiPath,
      });

    expect(markdown).toContain("[Attachment](");
  });

  test("should build the route from the given api path", async () => {
    const id: ObjectID = ObjectID.generate();

    findByMock.mockResolvedValue([
      makeFile({ id: id.toString(), name: "a.txt" }),
    ]);

    const markdown: string =
      await FileAttachmentMarkdownUtil.buildAttachmentMarkdown({
        modelId,
        attachmentIds: [id],
        attachmentApiPath: "/alert/attachment",
      });

    expect(markdown).toContain("/alert/attachment/");
  });
});
