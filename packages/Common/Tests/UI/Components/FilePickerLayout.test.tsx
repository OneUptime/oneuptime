import FilePicker from "../../../UI/Components/FilePicker/FilePicker";
import CustomFieldFileList from "../../../UI/Components/CustomFields/CustomFieldFileList";
import {
  forgetKnownFileSizes,
  rememberFileSize,
} from "../../../UI/Components/FilePicker/KnownFileSizes";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
import { CustomFieldFile } from "../../../Types/CustomField/CustomFieldFile";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import FileModel from "../../../Models/DatabaseModels/File";
import React, { ReactElement, useState } from "react";

/*
 * How the file picker looks and answers - the Custom Fields Edit dialog,
 * the Declare Incident form, a public form's file questions, note
 * attachments and logos all draw it:
 *
 *   - a click anywhere on its zone opens the file chooser, once, as the zone
 *     says it does (it used to be the link-coloured words alone), and a key
 *     opens it from the zone; nothing opens it where there is nothing to
 *     choose;
 *   - a picker of one says it takes a file, and shows its file alone, with
 *     no "Uploaded files" heading over one file;
 *   - a picker of several that holds files asks for more in a smaller zone;
 *     a full one is a note, not a place to drop files;
 *   - each file with its kind's icon and its size, as the Custom Fields card
 *     shows the same file - a stored file's size too, which its File does not
 *     hold;
 *   - a failed upload says why once, with no progress bar; Replace waits for
 *     an upload under way.
 */

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    create: jest.fn(),
  };
});

type CreateMock = jest.MockedFunction<typeof ModelAPI.create>;

const createMock: CreateMock = ModelAPI.create as CreateMock;

const ID_ONE: string = "aaaaaaaa-0000-4000-8000-000000000001";
const ID_TWO: string = "aaaaaaaa-0000-4000-8000-000000000002";

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  forgetKnownFileSizes();
});

type MakeFileFunction = (name: string, size: number, type?: string) => File;

// jsdom's File cannot read itself: each one reads the bytes it was made of.
const makeFile: MakeFileFunction = (
  name: string,
  size: number,
  type: string = MimeType.png,
): File => {
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(size).fill(0x41);
  const file: File = new File([bytes], name, { type });
  file.arrayBuffer = async (): Promise<ArrayBuffer> => {
    return bytes.slice().buffer;
  };
  return file;
};

type HeldFileFunction = (
  name: string,
  id: string,
  type?: MimeType,
) => FileModel;

// A stored file as a form hands it to the picker: its id, name and type.
const heldFile: HeldFileFunction = (
  name: string,
  id: string,
  type: MimeType = MimeType.png,
): FileModel => {
  const model: FileModel = new FileModel(new ObjectID(id));
  model.name = name;
  model.fileType = type;
  return model;
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

type CountOpensFunction = (zone: HTMLElement) => () => number;

/*
 * How many times the file chooser was opened: react-dropzone opens it by
 * clicking the input, and a label opens it by clicking the input too.
 */
const countOpens: CountOpensFunction = (zone: HTMLElement): (() => number) => {
  const input: HTMLInputElement | null =
    zone.querySelector("input[type='file']");

  expect(input).not.toBeNull();

  let opened: number = 0;

  input!.addEventListener("click", () => {
    opened++;
  });

  return (): number => {
    return opened;
  };
};

describe("the zone opens the file chooser", () => {
  test("a click anywhere on it opens the chooser - once", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        placeholder="Upload a file"
        dataTestId="picker"
      />,
    );

    const zone: HTMLElement = screen.getByTestId("picker");
    const opens: () => number = countOpens(zone);

    // The zone itself, and its help, nowhere near the link-coloured words.
    fireEvent.click(zone);
    expect(opens()).toBe(1);

    fireEvent.click(screen.getByText("Click to choose a file or drag & drop."));
    expect(opens()).toBe(2);

    /*
     * The words are the input's label, which opens the chooser by itself:
     * the zone leaves that click to the browser rather than open it twice.
     */
    fireEvent.click(screen.getByText("Upload a file"));
    expect(opens()).toBe(3);
  });

  test("a key on the zone opens it: the zone is where the keyboard stops", () => {
    render(<FilePicker mimeTypes={[MimeType.png]} dataTestId="picker" />);

    const zone: HTMLElement = screen.getByTestId("picker");
    const opens: () => number = countOpens(zone);

    expect(zone).toHaveAttribute("tabindex", "0");
    // A visible ring when the keyboard is on it.
    expect(zone.className).toContain("focus-visible:ring-2");

    fireEvent.keyDown(zone, { key: "Enter" });
    expect(opens()).toBe(1);

    fireEvent.keyDown(zone, { key: " " });
    expect(opens()).toBe(2);
  });

  test("its label is still the input's label", () => {
    const { container } = render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        placeholder="Upload a file"
        dataTestId="picker"
      />,
    );

    expect(screen.getByLabelText("Upload a file")).toBe(
      container.querySelector("input[type='file']"),
    );
  });

  test("read only, nothing opens it and the keyboard passes it by", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        readOnly={true}
        dataTestId="picker"
      />,
    );

    const zone: HTMLElement = screen.getByTestId("picker");
    const opens: () => number = countOpens(zone);

    fireEvent.click(zone);
    fireEvent.keyDown(zone, { key: "Enter" });

    expect(opens()).toBe(0);
    expect(zone).toHaveAttribute("tabindex", "-1");
    expect(zone.className).toContain("cursor-not-allowed");
  });

  test("a picker of one holding its file: its zone is out of sight and out of the tab order", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        initialValue={heldFile("contract.png", ID_ONE)}
        dataTestId="picker"
      />,
    );

    const zone: HTMLElement = screen.getByTestId("picker");

    expect(zone.className).toBe("sr-only");
    expect(zone).toHaveAttribute("tabindex", "-1");
  });
});

describe("what the zone says", () => {
  test("a picker of one takes a file; a picker of several, files", () => {
    render(<FilePicker mimeTypes={[MimeType.png]} />);

    expect(
      screen.getByText("Click to choose a file or drag & drop."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Click to choose files or drag & drop."),
    ).not.toBeInTheDocument();
    cleanup();

    render(<FilePicker mimeTypes={[MimeType.png]} isMultiFilePicker={true} />);

    expect(
      screen.getByText("Click to choose files or drag & drop."),
    ).toBeInTheDocument();
  });

  test("a picker of several holding files asks for more in a smaller zone, with no illustration", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        isMultiFilePicker={true}
        dataTestId="empty"
      />,
    );

    const empty: HTMLElement = screen.getByTestId("empty");

    expect(empty.className).toContain("py-8");
    expect(empty.querySelector("svg.h-12")).not.toBeNull();
    cleanup();

    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        isMultiFilePicker={true}
        initialValue={[heldFile("a.png", ID_ONE)]}
        dataTestId="holding"
      />,
    );

    const holding: HTMLElement = screen.getByTestId("holding");

    expect(holding.className).toContain("py-4");
    expect(holding.className).not.toContain("py-8");
    expect(holding.querySelector("svg.h-12")).toBeNull();
    expect(holding).toHaveTextContent("Add more files");
    expect(holding).toHaveTextContent("Click to add more or drag & drop.");
    expect(holding.className).toContain("border-dashed");
  });

  test("a full picker is a note, not a place to drop files", () => {
    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        isMultiFilePicker={true}
        maxFiles={1}
        initialValue={[heldFile("a.png", ID_ONE)]}
        dataTestId="picker"
      />,
    );

    const zone: HTMLElement = screen.getByTestId("picker");

    expect(screen.getByTestId("file-picker-full")).toBeInTheDocument();
    expect(zone.className).not.toContain("border-dashed");
    expect(zone.className).not.toContain("cursor-pointer");
    expect(zone).toHaveAttribute("tabindex", "-1");
  });
});

describe("the files it lists", () => {
  test("a picker of several heads its list; a picker of one shows its file alone", () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        initialValue={[heldFile("a.png", ID_ONE), heldFile("b.png", ID_TWO)]}
      />,
    );

    expect(screen.getByText("Uploaded files")).toBeInTheDocument();
    cleanup();

    render(<FilePicker initialValue={heldFile("contract.png", ID_ONE)} />);

    expect(screen.getByText("contract.png")).toBeInTheDocument();
    expect(screen.queryByText("Uploaded files")).not.toBeInTheDocument();
    expect(screen.queryByText("Chosen files")).not.toBeInTheDocument();
    cleanup();

    // Kept in the browser, several are "chosen", not "uploaded".
    render(
      <FilePicker
        isMultiFilePicker={true}
        keepFilesInBrowser={true}
        initialValue={[heldFile("a.png", ID_ONE)]}
      />,
    );

    expect(screen.getByText("Chosen files")).toBeInTheDocument();
  });

  test("its rows sit close together, a list rather than a column of cards", () => {
    render(
      <FilePicker
        isMultiFilePicker={true}
        initialValue={[heldFile("a.png", ID_ONE), heldFile("b.png", ID_TWO)]}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("file-picker-file");

    expect(rows).toHaveLength(2);
    expect((rows[0]!.parentElement as HTMLElement).className).toContain(
      "gap-2",
    );
    expect((rows[0]!.parentElement as HTMLElement).className).not.toContain(
      "gap-4",
    );
  });

  test("each file has its kind's icon, the icon the Custom Fields card draws it with", () => {
    const kinds: Array<{ name: string; type: MimeType; id: string }> = [
      {
        name: "outage.png",
        type: MimeType.png,
        id: "aaaaaaaa-0000-4000-8000-000000000011",
      },
      {
        name: "errors.csv",
        type: MimeType.csv,
        id: "aaaaaaaa-0000-4000-8000-000000000012",
      },
      {
        name: "capture.pcap",
        type: MimeType.pcap,
        id: "aaaaaaaa-0000-4000-8000-000000000013",
      },
      {
        name: "runbook.pdf",
        type: MimeType.pdf,
        id: "aaaaaaaa-0000-4000-8000-000000000014",
      },
    ];

    const iconOf: (row: HTMLElement) => string = (row: HTMLElement): string => {
      const path: Element | null = row.querySelector("svg path");
      expect(path).not.toBeNull();
      return path!.getAttribute("d") || "";
    };

    render(
      <FilePicker
        isMultiFilePicker={true}
        initialValue={kinds.map(
          (kind: { name: string; type: MimeType; id: string }) => {
            return heldFile(kind.name, kind.id, kind.type);
          },
        )}
      />,
    );

    const pickerIcons: Array<string> = screen
      .getAllByTestId("file-picker-file")
      .map(iconOf);
    cleanup();

    render(
      <CustomFieldFileList
        files={kinds.map(
          (kind: {
            name: string;
            type: MimeType;
            id: string;
          }): CustomFieldFile => {
            return {
              fileId: kind.id,
              name: kind.name,
              fileType: kind.type,
              size: 1,
            };
          },
        )}
      />,
    );

    const cardIcons: Array<string> = screen
      .getAllByTestId("custom-field-file")
      .map(iconOf);

    expect(pickerIcons).toEqual(cardIcons);
    // Four kinds, four icons: a picture, a table, an archive, a document.
    expect(new Set(pickerIcons).size).toBe(4);
  });

  test("a file it holds the bytes of: its type and its size as the card says it", () => {
    const chosen: FileModel = new FileModel();
    chosen.name = "notes.txt";
    chosen.fileType = MimeType.txt;
    chosen.file = Buffer.from(new Uint8Array(100));

    render(<FilePicker initialValue={chosen} />);

    // Never "0.1 KB".
    expect(screen.getByText("TXT • 100 B")).toBeInTheDocument();
  });

  test("a stored file, which comes without its bytes: its size as the page was told it", () => {
    rememberFileSize(ID_ONE, 48213);

    render(
      <FilePicker
        isMultiFilePicker={true}
        initialValue={[
          heldFile("contract.pdf", ID_ONE, MimeType.pdf),
          heldFile("photo.png", ID_TWO),
        ]}
      />,
    );

    expect(screen.getByText("PDF • 47 KB")).toBeInTheDocument();
    // One it was not told the size of says its type alone.
    expect(screen.getByText("PNG")).toBeInTheDocument();
  });

  test("an uploaded file keeps its size once the form hands it back without its bytes", async () => {
    createMock.mockImplementation((async (data: { model: FileModel }) => {
      const stored: FileModel = new FileModel(new ObjectID(ID_TWO));
      stored.name = data.model.name!;
      stored.fileType = data.model.fileType!;
      return new HTTPResponse(200, stored as never, {});
    }) as never);

    // As a form does: each file it hands back is its id, name and type.
    const Form: () => ReactElement = (): ReactElement => {
      const [value, setValue] = useState<Array<FileModel>>([]);

      return (
        <FilePicker
          isMultiFilePicker={true}
          mimeTypes={[MimeType.png]}
          dataTestId="picker"
          value={value}
          onChange={(files: Array<FileModel>) => {
            setValue(
              files.map((file: FileModel): FileModel => {
                return heldFile(file.name!, file._id!, file.fileType!);
              }),
            );
          }}
        />
      );
    };

    render(<Form />);

    await drop(screen.getByTestId("picker"), [makeFile("latency.png", 2048)]);

    await waitFor(() => {
      expect(screen.getByText("latency.png")).toBeInTheDocument();
    });
    expect(screen.getByText("PNG • 2 KB")).toBeInTheDocument();
  });
});

describe("an upload", () => {
  test("that fails says why once, in its own row, with no progress bar", async () => {
    createMock.mockRejectedValue(
      new Error("This file type is not supported.") as never,
    );

    const { container } = render(
      <FilePicker
        isMultiFilePicker={true}
        mimeTypes={[MimeType.png]}
        dataTestId="picker"
      />,
    );

    await drop(screen.getByTestId("picker"), [makeFile("notes.png", 16)]);

    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
    });
    expect(
      screen.getAllByText("This file type is not supported."),
    ).toHaveLength(1);
    expect(container.querySelector(".bg-red-400")).toBeNull();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  test("under way, Replace waits for it", async () => {
    // An upload that is still being sent.
    createMock.mockImplementation((() => {
      return new Promise(() => {});
    }) as never);

    render(
      <FilePicker
        mimeTypes={[MimeType.png]}
        initialValue={heldFile("contract.png", ID_ONE)}
        dataTestId="picker"
      />,
    );

    expect(screen.getByText("Replace")).toBeEnabled();

    await drop(screen.getByTestId("picker"), [makeFile("new.png", 16)]);

    await waitFor(() => {
      expect(screen.getByText("Replace")).toBeDisabled();
    });
  });
});
