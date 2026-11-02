import FilePicker from "../../../UI/Components/FilePicker/FilePicker";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import FileModel from "../../../Models/DatabaseModels/File";
import React from "react";

/*
 * What a file custom field - and a form's file question - asks of the file
 * picker: no more files than the field holds, a word when a file is not a
 * kind the field takes, files kept in the browser for a page nobody is
 * signed in to upload from, Replace on a picker of one, a sentence for what
 * it takes in place of a list of 25 types, and an input of its own on a page
 * with several pickers.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    create: jest.fn(),
  };
});

type CreateMock = jest.MockedFunction<typeof ModelAPI.create>;

const createMock: CreateMock = ModelAPI.create as CreateMock;

type MakeFileFunction = (name: string, type?: string, size?: number) => File;

// jsdom's File cannot read itself: each one reads the bytes it was made of.
const makeFile: MakeFileFunction = (
  name: string,
  type: string = MimeType.png,
  size: number = 16,
): File => {
  // Over its own ArrayBuffer, as a File's parts must be.
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(size).fill(0x41);
  const file: File = new File([bytes], name, { type });
  file.arrayBuffer = async (): Promise<ArrayBuffer> => {
    return bytes.slice().buffer;
  };
  return file;
};

type HeldFileFunction = (name: string, id: string) => FileModel;

const heldFile: HeldFileFunction = (name: string, id: string): FileModel => {
  const model: FileModel = new FileModel(new ObjectID(id));
  model.name = name;
  model.fileType = MimeType.png;
  return model;
};

type UploadedAsFunction = () => void;

// Every upload comes back as a stored File with an id of its own.
const uploadsSucceed: UploadedAsFunction = (): void => {
  let count: number = 0;

  createMock.mockImplementation((async (data: { model: FileModel }) => {
    count++;
    const stored: FileModel = new FileModel(
      new ObjectID(
        `bbbbbbbb-0000-4000-8000-${String(count).padStart(12, "0")}`,
      ),
    );
    stored.name = data.model.name!;
    stored.fileType = data.model.fileType!;
    return new HTTPResponse(200, stored as never, {});
  }) as never);
};

type DropFunction = (target: HTMLElement, files: Array<File>) => Promise<void>;

const drop: DropFunction = async (
  target: HTMLElement,
  files: Array<File>,
): Promise<void> => {
  await act(async () => {
    fireEvent.drop(target, {
      dataTransfer: { files: files, types: ["Files"] },
    });
  });
};

// The drop zone, which takes a drop whether or not it shows its prompt.
type DropZoneFunction = (testId: string) => HTMLElement;

const dropZone: DropZoneFunction = (testId: string): HTMLElement => {
  return screen.getByTestId(testId).firstElementChild as HTMLElement;
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("a picker of several files holds no more than it may", () => {
  test("a drop of more than there is room for adds what fits, and says so", async () => {
    uploadsSucceed();
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={3}
        mimeTypes={[MimeType.png]}
        initialValue={[
          heldFile("one.png", "aaaaaaaa-0000-4000-8000-000000000001"),
        ]}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("two.png"),
      makeFile("three.png"),
      makeFile("four.png"),
    ]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    // Two uploaded, the third never was.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(
      (onChange.mock.calls[0]![0] as Array<FileModel>).map(
        (file: FileModel): string => {
          return file.name!;
        },
      ),
    ).toEqual(["one.png", "two.png", "three.png"]);
    expect(screen.queryByText("four.png")).not.toBeInTheDocument();
    // Full, it says how many it holds: why the last one was left out.
    expect(screen.getByTestId("file-picker-full")).toHaveTextContent(
      "This field holds up to 3 files. Remove one to add another.",
    );
  });

  test("once full it says how to add another, in place of the prompt to drop more", async () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={2}
        mimeTypes={[MimeType.png]}
        initialValue={[
          heldFile("one.png", "aaaaaaaa-0000-4000-8000-000000000001"),
          heldFile("two.png", "aaaaaaaa-0000-4000-8000-000000000002"),
        ]}
        dataTestId="picker"
      />,
    );

    expect(screen.getByTestId("file-picker-full")).toHaveTextContent(
      "This field holds up to 2 files. Remove one to add another.",
    );
    expect(screen.queryByText("Add more files")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Remove")[0]!);

    expect(screen.queryByTestId("file-picker-full")).not.toBeInTheDocument();
    expect(screen.getByText("Add more files")).toBeInTheDocument();
  });

  test("a drop on a full picker adds nothing", async () => {
    uploadsSucceed();
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={1}
        mimeTypes={[MimeType.png]}
        initialValue={[
          heldFile("one.png", "aaaaaaaa-0000-4000-8000-000000000001"),
        ]}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [makeFile("two.png")]);

    expect(createMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("file-picker-full")).toBeInTheDocument();
    expect(screen.queryByText("two.png")).not.toBeInTheDocument();
  });

  test("a file of a kind it does not take, dropped on it full, is refused out loud", async () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={1}
        mimeTypes={[MimeType.png]}
        initialValue={[
          heldFile("one.png", "aaaaaaaa-0000-4000-8000-000000000001"),
        ]}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("setup.exe", "application/x-msdownload"),
    ]);

    expect(
      await screen.findByText(
        '"setup.exe" is not a type of file this field takes.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("file-picker-full")).toBeInTheDocument();
  });

  test("a limit that is no number, or none, leaves the picker without one", async () => {
    for (const maxFiles of [0, -1, Number.NaN, undefined]) {
      render(
        <FilePicker
          isMultiFilePicker={true}
          maxFiles={maxFiles}
          initialValue={[
            heldFile("one.png", "aaaaaaaa-0000-4000-8000-000000000001"),
            heldFile("two.png", "aaaaaaaa-0000-4000-8000-000000000002"),
          ]}
        />,
      );

      expect(screen.queryByTestId("file-picker-full")).not.toBeInTheDocument();
      expect(screen.getByText("Add more files")).toBeInTheDocument();
      cleanup();
    }
  });
});

describe("a file of a kind the field does not take", () => {
  test("is refused, by name", async () => {
    uploadsSucceed();
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        mimeTypes={[MimeType.png, MimeType.pdf]}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("setup.exe", "application/x-msdownload"),
    ]);

    expect(
      await screen.findByText(
        '"setup.exe" is not a type of file this field takes.',
      ),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("several are refused together, by name", async () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        mimeTypes={[MimeType.png]}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("a.exe", "application/x-msdownload"),
      makeFile("b.sh", "application/x-sh"),
    ]);

    expect(
      await screen.findByText(
        "These files are not a type this field takes: a.exe, b.sh.",
      ),
    ).toBeInTheDocument();
  });

  test("several files on a picker of one: one at a time", async () => {
    render(<FilePicker mimeTypes={[MimeType.png]} dataTestId="picker" />);

    await drop(dropZone("picker"), [makeFile("a.png"), makeFile("b.png")]);

    expect(
      await screen.findByText("Add one file at a time."),
    ).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe("files kept in the browser", () => {
  test("are never uploaded: each comes back with its bytes and no id", async () => {
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        isMultiFilePicker={true}
        keepFilesInBrowser={true}
        mimeTypes={[MimeType.png, MimeType.pdf]}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("screenshot.png", MimeType.png, 64),
      makeFile("report.pdf", MimeType.pdf, 128),
    ]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    expect(createMock).not.toHaveBeenCalled();

    const kept: Array<FileModel> = onChange.mock
      .calls[0]![0] as Array<FileModel>;

    expect(
      kept.map((file: FileModel) => {
        return {
          name: file.name,
          fileType: file.fileType,
          size: file.file?.byteLength,
          id: file._id,
        };
      }),
    ).toEqual([
      {
        name: "screenshot.png",
        fileType: MimeType.png,
        size: 64,
        id: undefined,
      },
      { name: "report.pdf", fileType: MimeType.pdf, size: 128, id: undefined },
    ]);
  });

  test("are listed as chosen, not as uploaded, and show no upload progress", async () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        keepFilesInBrowser={true}
        mimeTypes={[MimeType.png]}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [makeFile("screenshot.png")]);

    expect(await screen.findByText("Chosen files")).toBeInTheDocument();
    expect(screen.queryByText("Uploaded files")).not.toBeInTheDocument();
    expect(screen.queryByText("Uploading files")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload status")).not.toBeInTheDocument();
    expect(screen.getByText("screenshot.png")).toBeInTheDocument();
  });

  test("a file the browser gives no type is read by its extension", async () => {
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        keepFilesInBrowser={true}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [makeFile("db.log", "")]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect((onChange.mock.calls[0]![0] as Array<FileModel>)[0]!.fileType).toBe(
      MimeType.txt,
    );
  });

  test("still hold to the most a field takes", async () => {
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        isMultiFilePicker={true}
        keepFilesInBrowser={true}
        maxFiles={2}
        mimeTypes={[MimeType.png]}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("a.png"),
      makeFile("b.png"),
      makeFile("c.png"),
    ]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange.mock.calls[0]![0] as Array<FileModel>).toHaveLength(2);
    expect(screen.getByTestId("file-picker-full")).toHaveTextContent(
      "This field holds up to 2 files. Remove one to add another.",
    );
  });
});

describe("a picker of one file", () => {
  test("holding a file, offers Replace beside Remove, and no prompt to drop", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        placeholder="Upload a file"
        initialValue={heldFile(
          "contract.png",
          "aaaaaaaa-0000-4000-8000-000000000001",
        )}
        dataTestId="picker"
      />,
    );

    expect(screen.getByText("Replace")).toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
    expect(screen.queryByText("Upload a file")).not.toBeInTheDocument();
  });

  test("a file dropped on it takes the place of the one it holds", async () => {
    uploadsSucceed();
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        initialValue={heldFile(
          "old.png",
          "aaaaaaaa-0000-4000-8000-000000000001",
        )}
        onChange={onChange}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [makeFile("new.png")]);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(
      (onChange.mock.calls[0]![0] as Array<FileModel>).map(
        (file: FileModel): string => {
          return file.name!;
        },
      ),
    ).toEqual(["new.png"]);
    expect(screen.queryByText("old.png")).not.toBeInTheDocument();
    expect(screen.getByText("new.png")).toBeInTheDocument();
  });

  /*
   * react-dropzone's open() clicks the picker's file input, and does
   * nothing when there is none: a picker of one holding its file draws no
   * prompt, but keeps its input in the page for Replace.
   */
  test("holding a file, shows no empty drop zone, and keeps its chooser for Replace", () => {
    const click: SpyInstance<() => void> = jest
      .spyOn(HTMLInputElement.prototype, "click")
      .mockImplementation(() => {});

    try {
      const { container } = render(
        <FilePicker
          mimeTypes={[MimeType.png]}
          placeholder="Upload a file"
          initialValue={heldFile(
            "contract.png",
            "aaaaaaaa-0000-4000-8000-000000000001",
          )}
          dataTestId="picker"
        />,
      );

      // The drop zone is out of sight: no dashed box with nothing in it.
      expect(screen.getByTestId("picker").className).toBe("sr-only");
      expect(screen.getByTestId("picker").className).not.toContain(
        "border-dashed",
      );

      const input: HTMLInputElement | null =
        container.querySelector("input[type='file']");

      expect(input).not.toBeNull();

      fireEvent.click(screen.getByText("Replace"));

      expect(click).toHaveBeenCalledTimes(1);
      expect(click.mock.contexts[0]).toBe(input);
    } finally {
      click.mockRestore();
    }
  });

  test("a file chosen with Replace that it does not take is refused under the file", async () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        initialValue={heldFile(
          "contract.png",
          "aaaaaaaa-0000-4000-8000-000000000001",
        )}
        dataTestId="picker"
      />,
    );

    await drop(dropZone("picker"), [
      makeFile("notes.exe", "application/x-msdownload"),
    ]);

    expect(screen.getByTestId("file-picker-error")).toHaveTextContent(
      '"notes.exe" is not a type of file this field takes.',
    );
    // It still holds the file it had.
    expect(screen.getByText("contract.png")).toBeInTheDocument();
  });

  test("an empty picker of one shows its prompt, whose label opens the chooser", () => {
    const { container } = render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        placeholder="Upload a file"
        dataTestId="picker"
      />,
    );

    const input: HTMLInputElement | null =
      container.querySelector("input[type='file']");

    expect(screen.getByTestId("picker").className).toContain("border-dashed");
    expect(
      (screen.getByText("Upload a file").closest("label") as HTMLLabelElement)
        .htmlFor,
    ).toBe(input!.id);
  });

  test("a full picker of several has no chooser to open", () => {
    const { container } = render(
      <FilePicker
        isMultiFilePicker={true}
        maxFiles={1}
        mimeTypes={[MimeType.png]}
        initialValue={[
          heldFile("a.png", "aaaaaaaa-0000-4000-8000-000000000001"),
        ]}
      />,
    );

    expect(screen.getByTestId("file-picker-full")).toBeInTheDocument();
    expect(container.querySelector("input[type='file']")).toBeNull();
  });

  test("Remove empties it and brings the prompt back", () => {
    const onChange: Mock = jest.fn();

    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        placeholder="Upload a file"
        initialValue={heldFile(
          "contract.png",
          "aaaaaaaa-0000-4000-8000-000000000001",
        )}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("Remove"));

    expect(onChange).toHaveBeenCalledWith([]);
    expect(screen.getByText("Upload a file")).toBeInTheDocument();
    expect(screen.queryByText("Replace")).not.toBeInTheDocument();
  });

  test("read only, offers no Replace", () => {
    render(
      <FilePicker
        readOnly={true}
        initialValue={heldFile(
          "contract.png",
          "aaaaaaaa-0000-4000-8000-000000000001",
        )}
      />,
    );

    expect(screen.queryByText("Replace")).not.toBeInTheDocument();
  });

  test("a picker of several offers no Replace", () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        initialValue={[
          heldFile("a.png", "aaaaaaaa-0000-4000-8000-000000000001"),
        ]}
      />,
    );

    expect(screen.queryByText("Replace")).not.toBeInTheDocument();
    expect(screen.getByText("Remove")).toBeInTheDocument();
  });
});

describe("what it says it takes", () => {
  test("a hint takes the place of the list of types", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png, MimeType.pdf, MimeType.zip]}
        hint="PDF, pictures or ZIP, up to 10 MB."
      />,
    );

    expect(
      screen.getByText("PDF, pictures or ZIP, up to 10 MB."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Types:/)).not.toBeInTheDocument();
  });

  test("without one, the list of types as before", () => {
    render(<FilePicker mimeTypes={[MimeType.png, MimeType.pdf]} />);

    expect(
      screen.getByText("Types: PNG, PDF. Max 10MB each."),
    ).toBeInTheDocument();
  });
});

describe("each file it lists", () => {
  /*
   * Under its name, a file's type as people read it - "DOCX", not the
   * 71-letter MIME type of a Word document - and its size when the picker
   * has its bytes.
   */
  test("names its type by its short name, never its MIME type", () => {
    const word: FileModel = new FileModel(
      new ObjectID("aaaaaaaa-0000-4000-8000-000000000001"),
    );
    word.name = "change-request.docx";
    word.fileType = MimeType.docx;

    const capture: FileModel = new FileModel(
      new ObjectID("aaaaaaaa-0000-4000-8000-000000000002"),
    );
    capture.name = "capture.pcap";
    capture.fileType = MimeType.pcap;
    capture.file = Buffer.from(new Uint8Array(2048));

    render(
      <FilePicker isMultiFilePicker={true} initialValue={[word, capture]} />,
    );

    expect(screen.getByText("DOCX")).toBeInTheDocument();
    // Its size as the Custom Fields card says it: "2 KB", never "2.0 KB".
    expect(screen.getByText("PCAP • 2 KB")).toBeInTheDocument();
    expect(screen.queryByText(MimeType.docx)).not.toBeInTheDocument();
    expect(
      screen.queryByText(MimeType.pcap, { exact: false }),
    ).not.toBeInTheDocument();
  });

  test("a long name wraps in its row, beside its buttons", () => {
    const long: FileModel = new FileModel(
      new ObjectID("aaaaaaaa-0000-4000-8000-000000000003"),
    );
    long.name = "quarterly-capacity-review-".repeat(6) + "final.pdf";
    long.fileType = MimeType.pdf;

    render(<FilePicker initialValue={long} />);

    const name: HTMLElement = screen.getByText(long.name);

    expect(name.className).toContain("[overflow-wrap:anywhere]");
    // Its column and its row may grow narrower than the name.
    expect((name.parentElement as HTMLElement).className).toContain("min-w-0");
    expect(
      (name.parentElement!.parentElement as HTMLElement).className,
    ).toContain("min-w-0");
  });
});

describe("several pickers on one page", () => {
  test("each input has an id of its own", () => {
    const { container } = render(
      <>
        <FilePicker mimeTypes={[MimeType.png]} />
        <FilePicker mimeTypes={[MimeType.pdf]} />
      </>,
    );

    const ids: Array<string> = Array.from(
      container.querySelectorAll("input[type='file']"),
    ).map((input: Element): string => {
      return input.getAttribute("id") || "";
    });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe("");
    expect(new Set(ids).size).toBe(2);
  });
});
