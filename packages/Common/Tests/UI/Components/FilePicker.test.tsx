import FilePicker, {
  DEFAULT_MAX_FILE_SIZE_IN_BYTES,
  formatFileSizeLimit,
  getMaxFileSizeInBytes,
} from "../../../UI/Components/FilePicker/FilePicker";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { describe, expect, beforeEach, jest } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import MimeType from "../../../Types/File/MimeType";
import ObjectID from "../../../Types/ObjectID";
import FileModel from "../../../Models/DatabaseModels/File";
import React from "react";
import { act } from "react-test-renderer";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import Faker from "../../../Utils/Faker";

const mockOnChange: MockFunction = getJestMockFunction();
const mockOnBlur: MockFunction = getJestMockFunction();
const mockOnFocus: MockFunction = getJestMockFunction();
const mockOnClick: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    create: jest.fn(),
  };
});

interface DefaultProps {
  onBlur: () => void;
  onChange: (files: FileModel[]) => void;
  mimeTypes: MimeType[];
  isOpen: boolean;
  onClose: () => void;
  initialValue?: FileModel | FileModel[];
  value?: FileModel[] | undefined;
  isMultiFilePicker?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  onFocus?: () => void;
  onClick?: () => void;
  error?: string;
  dataTestId?: string;
}

interface DataTransfer {
  dataTransfer: {
    files: File[];
    types: string[];
  };
}

type MockCreateResponseFunction = (
  file: File,
) => Promise<HTTPResponse<FileModel>>;

const mockCreateResponse: MockCreateResponseFunction = async (
  file: File,
): Promise<HTTPResponse<FileModel>> => {
  const fileModel: FileModel = new FileModel();
  fileModel.file = Buffer.from(await file.arrayBuffer());
  fileModel.name = file.name;
  fileModel.fileType = file.type as MimeType;
  fileModel.slug = file.name;
  fileModel.isPublic = true;
  return new HTTPResponse(200, fileModel as any, {});
};

type MockFileModelFunction = (file: File, id?: string) => Promise<FileModel>;

const mockFileModel: MockFileModelFunction = async (
  file: File,
  id?: string,
): Promise<FileModel> => {
  const fileModel: FileModel = new FileModel(new ObjectID(id || "123"));
  fileModel.name = file.name;
  fileModel.fileType = file.type as MimeType;
  fileModel.slug = file.name;
  fileModel.isPublic = true;
  fileModel.file = Buffer.from(await file.arrayBuffer());
  return fileModel;
};

type MockFileFunction = (name?: string) => File;

const mockFile: MockFileFunction = (name?: string): File => {
  const mockArrayBuffer: MockFunction = getJestMockFunction();
  mockArrayBuffer.mockResolvedValue(new ArrayBuffer(10)); // Mocked array buffer of size 10

  const fileName: string = name || Faker.generateRandomString() + ".png";
  const file: File = new File([Faker.generateRandomString()], fileName, {
    type: MimeType.png,
  });
  file.arrayBuffer = mockArrayBuffer;
  return file;
};

const defaultProps: DefaultProps = {
  onBlur: mockOnBlur,
  onChange: mockOnChange,
  mimeTypes: [MimeType.png],
  isOpen: true,
  onClose: jest.fn(),
};

describe("FilePicker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete defaultProps.isMultiFilePicker;
    delete defaultProps.initialValue;
    delete defaultProps.value;
    delete defaultProps.readOnly;
    delete defaultProps.placeholder;
    delete defaultProps.onFocus;
    delete defaultProps.onClick;
    delete defaultProps.error;
    delete defaultProps.dataTestId;
  });

  // Basic rendering tests
  it("should render without crashing", () => {
    render(<FilePicker {...defaultProps} />);
    expect(screen.getByText("Upload files")).toBeInTheDocument();
  });

  it("should render with custom placeholder text", () => {
    defaultProps.placeholder = "Drop your files here";
    render(<FilePicker {...defaultProps} />);
    expect(screen.getByText("Drop your files here")).toBeInTheDocument();
  });

  it("should display allowed mime types", () => {
    render(<FilePicker {...defaultProps} />);
    expect(screen.getByText(/PNG/)).toBeInTheDocument();
  });

  it("should display max file size message", () => {
    render(<FilePicker {...defaultProps} />);
    expect(screen.getByText(/Max 10MB each/)).toBeInTheDocument();
  });

  /*
   * A picker for something smaller than any upload - a form's logo takes
   * 512 KB, its favicon 128 KB - says its own limit, and refuses a larger
   * file before it is uploaded, so it never promises more than the field
   * keeps.
   */
  describe("a limit of its own", () => {
    const ONE_MB: number = 1024 * 1024;

    it("says its own limit, with the types it takes", () => {
      render(<FilePicker {...defaultProps} maxFileSizeInBytes={ONE_MB} />);

      expect(
        screen.getByText("Types: PNG. Max 1 MB each."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Max 10MB each/)).not.toBeInTheDocument();
    });

    it("says a limit under a megabyte in kilobytes", () => {
      render(<FilePicker {...defaultProps} maxFileSizeInBytes={512 * 1024} />);

      expect(
        screen.getByText("Types: PNG. Max 512 KB each."),
      ).toBeInTheDocument();
    });

    it("says its own limit without types too", () => {
      render(
        <FilePicker
          {...defaultProps}
          mimeTypes={[]}
          maxFileSizeInBytes={128 * 1024}
        />,
      );

      expect(screen.getByText("Max 128 KB each.")).toBeInTheDocument();
    });

    it("refuses a larger file before uploading it, and says why", async () => {
      const big: File = new File([new Uint8Array(ONE_MB + 1)], "big.png", {
        type: MimeType.png,
      });

      render(<FilePicker {...defaultProps} maxFileSizeInBytes={ONE_MB} />);

      await act(async () => {
        fireEvent.drop(screen.getByText("Upload files"), {
          dataTransfer: { files: [big], types: ["Files"] },
        });
      });

      await waitFor(() => {
        expect(
          screen.getByText('"big.png" exceeds the 1 MB limit.'),
        ).toBeInTheDocument();
      });
      expect(ModelAPI.create).not.toHaveBeenCalled();
      expect(mockOnChange).not.toHaveBeenCalled();
    });

    it("refuses a file one byte over a kilobyte limit", async () => {
      const big: File = new File(
        [new Uint8Array(128 * 1024 + 1)],
        "favicon.png",
        { type: MimeType.png },
      );

      render(<FilePicker {...defaultProps} maxFileSizeInBytes={128 * 1024} />);

      await act(async () => {
        fireEvent.drop(screen.getByText("Upload files"), {
          dataTransfer: { files: [big], types: ["Files"] },
        });
      });

      await waitFor(() => {
        expect(
          screen.getByText('"favicon.png" exceeds the 128 KB limit.'),
        ).toBeInTheDocument();
      });
      expect(ModelAPI.create).not.toHaveBeenCalled();
    });

    it("takes a file of exactly its limit", async () => {
      const exact: File = new File([new Uint8Array(ONE_MB)], "exact.png", {
        type: MimeType.png,
      });
      // jsdom's File cannot read itself; the upload reads these bytes.
      exact.arrayBuffer = async (): Promise<ArrayBuffer> => {
        return new ArrayBuffer(ONE_MB);
      };
      (
        ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
      ).mockResolvedValue(await mockCreateResponse(exact));

      render(<FilePicker {...defaultProps} maxFileSizeInBytes={ONE_MB} />);

      await act(async () => {
        fireEvent.drop(screen.getByText("Upload files"), {
          dataTransfer: { files: [exact], types: ["Files"] },
        });
      });

      await waitFor(() => {
        expect(ModelAPI.create).toHaveBeenCalledTimes(1);
      });
    });

    it("is never more than the 10 MB every upload is held to", () => {
      expect(DEFAULT_MAX_FILE_SIZE_IN_BYTES).toBe(10 * ONE_MB);

      for (const value of [
        undefined,
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        10 * ONE_MB,
        50 * ONE_MB,
      ]) {
        expect(getMaxFileSizeInBytes(value)).toBe(10 * ONE_MB);
      }

      expect(getMaxFileSizeInBytes(ONE_MB)).toBe(ONE_MB);
      expect(getMaxFileSizeInBytes(128 * 1024)).toBe(128 * 1024);
    });

    it("keeps the everyday wording at the everyday limit", () => {
      render(<FilePicker {...defaultProps} maxFileSizeInBytes={10 * ONE_MB} />);

      expect(screen.getByText(/Max 10MB each/)).toBeInTheDocument();
    });

    it("words a limit as people read it", () => {
      expect(formatFileSizeLimit(128 * 1024)).toBe("128 KB");
      expect(formatFileSizeLimit(512 * 1024)).toBe("512 KB");
      expect(formatFileSizeLimit(ONE_MB)).toBe("1 MB");
      expect(formatFileSizeLimit(1.5 * ONE_MB)).toBe("1.5 MB");
      expect(formatFileSizeLimit(10 * ONE_MB)).toBe("10 MB");
      // Never "0 KB".
      expect(formatFileSizeLimit(100)).toBe("1 KB");
    });
  });

  /*
   * A picker that takes ICO - a form's favicon - takes it however the
   * browser names it: "image/x-icon", or "image/vnd.microsoft.icon" (Linux,
   * Firefox), and stores it as image/x-icon either way.
   */
  describe("ICO", () => {
    type UploadIcoFunction = (type: string) => Promise<FileModel>;

    const uploadIco: UploadIcoFunction = async (
      type: string,
    ): Promise<FileModel> => {
      const icon: File = new File(
        [new Uint8Array([0, 0, 1, 0])],
        "favicon.ico",
        { type },
      );
      icon.arrayBuffer = async (): Promise<ArrayBuffer> => {
        return new Uint8Array([0, 0, 1, 0]).buffer;
      };
      (
        ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
      ).mockResolvedValue(await mockCreateResponse(icon));

      render(
        <FilePicker
          {...defaultProps}
          mimeTypes={[MimeType.png, MimeType.ico]}
        />,
      );

      await act(async () => {
        fireEvent.drop(screen.getByText("Upload files"), {
          dataTransfer: { files: [icon], types: ["Files"] },
        });
      });

      await waitFor(() => {
        expect(ModelAPI.create).toHaveBeenCalledTimes(1);
      });

      return (
        (ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>).mock
          .calls[0]![0] as unknown as { model: FileModel }
      ).model;
    };

    it("as image/x-icon", async () => {
      expect((await uploadIco(MimeType.ico)).fileType).toBe(MimeType.ico);
    });

    it("leaving whether the file is public to the server: every upload starts private", async () => {
      expect((await uploadIco(MimeType.ico)).isPublic).toBeUndefined();
    });

    it("as image/vnd.microsoft.icon, stored as image/x-icon", async () => {
      expect((await uploadIco("image/vnd.microsoft.icon")).fileType).toBe(
        MimeType.ico,
      );
    });

    it("says ICO among the types it takes", () => {
      render(
        <FilePicker
          {...defaultProps}
          mimeTypes={[MimeType.png, MimeType.ico]}
          maxFileSizeInBytes={128 * 1024}
        />,
      );

      expect(
        screen.getByText("Types: PNG, ICO. Max 128 KB each."),
      ).toBeInTheDocument();
    });
  });

  // Initial value tests - NEW TESTS replacing skipped ones
  it("should render with initial value and display file name", async () => {
    const file: File = mockFile("test-document.png");
    defaultProps.initialValue = await mockFileModel(file);
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("test-document.png")).toBeInTheDocument();
    expect(screen.getByText("Uploaded files")).toBeInTheDocument();
  });

  it("should render with initial value and show Remove button", async () => {
    const file: File = mockFile("my-file.png");
    defaultProps.initialValue = await mockFileModel(file);
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("Remove")).toBeInTheDocument();
  });

  it("should render with initial value as array and display all file names", async () => {
    const file1: File = mockFile("first-file.png");
    const file2: File = mockFile("second-file.png");
    defaultProps.initialValue = [
      await mockFileModel(file1, "id1"),
      await mockFileModel(file2, "id2"),
    ];
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("first-file.png")).toBeInTheDocument();
    expect(screen.getByText("second-file.png")).toBeInTheDocument();
    expect(screen.getAllByText("Remove")).toHaveLength(2);
  });

  it("should render with initial value array and show Uploaded files section", async () => {
    const file1: File = mockFile("doc1.png");
    const file2: File = mockFile("doc2.png");
    defaultProps.initialValue = [
      await mockFileModel(file1, "id1"),
      await mockFileModel(file2, "id2"),
    ];
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("Uploaded files")).toBeInTheDocument();
  });

  // Value prop tests - NEW TESTS replacing skipped ones
  it("should render with value array containing one element", async () => {
    const file: File = mockFile("single-file.png");
    defaultProps.value = [await mockFileModel(file)];
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("single-file.png")).toBeInTheDocument();
    expect(screen.getByText("Uploaded files")).toBeInTheDocument();
  });

  it("should render with value array containing multiple elements", async () => {
    const file1: File = mockFile("file-a.png");
    const file2: File = mockFile("file-b.png");
    const file3: File = mockFile("file-c.png");
    defaultProps.value = [
      await mockFileModel(file1, "a"),
      await mockFileModel(file2, "b"),
      await mockFileModel(file3, "c"),
    ];
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("file-a.png")).toBeInTheDocument();
    expect(screen.getByText("file-b.png")).toBeInTheDocument();
    expect(screen.getByText("file-c.png")).toBeInTheDocument();
    expect(screen.getAllByText("Remove")).toHaveLength(3);
  });

  // Upload tests - NEW TESTS replacing skipped ones
  it("should upload a file when dropped and display its name", async () => {
    const file: File = mockFile("uploaded-doc.png");
    const data: DataTransfer = {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    };

    const createResponse: HTTPResponse<FileModel> =
      await mockCreateResponse(file);
    (
      ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
    ).mockResolvedValue(createResponse);

    render(<FilePicker {...defaultProps} />);

    const dropzone: HTMLElement = screen.getByText("Upload files");
    await act(async () => {
      fireEvent.drop(dropzone, data);
    });

    await waitFor(() => {
      expect(screen.getByText("uploaded-doc.png")).toBeInTheDocument();
    });
  });

  it("should call onChange callback after successful upload", async () => {
    const file: File = mockFile("callback-test.png");
    const data: DataTransfer = {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    };

    const createResponse: HTTPResponse<FileModel> =
      await mockCreateResponse(file);
    (
      ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
    ).mockResolvedValue(createResponse);

    render(<FilePicker {...defaultProps} />);

    const dropzone: HTMLElement = screen.getByText("Upload files");
    await act(async () => {
      fireEvent.drop(dropzone, data);
    });

    await waitFor(() => {
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  it("should call onBlur callback after successful upload", async () => {
    const file: File = mockFile("blur-test.png");
    const data: DataTransfer = {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    };

    const createResponse: HTTPResponse<FileModel> =
      await mockCreateResponse(file);
    (
      ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
    ).mockResolvedValue(createResponse);

    render(<FilePicker {...defaultProps} />);

    const dropzone: HTMLElement = screen.getByText("Upload files");
    await act(async () => {
      fireEvent.drop(dropzone, data);
    });

    await waitFor(() => {
      expect(mockOnBlur).toHaveBeenCalled();
    });
  });

  it("should display Uploaded files section after upload", async () => {
    const file: File = mockFile("section-test.png");
    const data: DataTransfer = {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    };

    const createResponse: HTTPResponse<FileModel> =
      await mockCreateResponse(file);
    (
      ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
    ).mockResolvedValue(createResponse);

    render(<FilePicker {...defaultProps} />);

    const dropzone: HTMLElement = screen.getByText("Upload files");
    await act(async () => {
      fireEvent.drop(dropzone, data);
    });

    await waitFor(() => {
      expect(screen.getByText("Uploaded files")).toBeInTheDocument();
    });
  });

  // Delete file tests - NEW TESTS replacing skipped ones
  it("should remove file when Remove button is clicked", async () => {
    const file: File = mockFile("removable-file.png");
    defaultProps.initialValue = await mockFileModel(file);
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("removable-file.png")).toBeInTheDocument();

    const removeButton: HTMLElement = screen.getByText("Remove");
    await act(async () => {
      fireEvent.click(removeButton);
    });

    expect(screen.queryByText("removable-file.png")).not.toBeInTheDocument();
  });

  it("should call onChange with empty array when last file is removed", async () => {
    const file: File = mockFile("last-file.png");
    defaultProps.initialValue = await mockFileModel(file);
    render(<FilePicker {...defaultProps} />);

    const removeButton: HTMLElement = screen.getByText("Remove");
    await act(async () => {
      fireEvent.click(removeButton);
    });

    expect(mockOnChange).toHaveBeenCalledWith([]);
  });

  // ReadOnly tests
  it("should not upload file when dropped and readOnly is true", async () => {
    defaultProps.readOnly = true;

    const file: File = mockFile("readonly-test.png");
    const data: DataTransfer = {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    };

    (
      ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
    ).mockResolvedValue(await mockCreateResponse(file));

    render(<FilePicker {...defaultProps} />);

    const dropzone: HTMLElement = screen.getByLabelText("Upload files");
    fireEvent.drop(dropzone, data);

    await waitFor(() => {
      expect(ModelAPI.create).not.toHaveBeenCalled();
    });
  });

  it("should render in read-only mode without errors", () => {
    defaultProps.readOnly = true;
    render(<FilePicker {...defaultProps} />);

    // Component should still render in read-only mode
    expect(screen.getByText("Upload files")).toBeInTheDocument();
  });

  // Error handling tests
  it("should display error prop when provided", () => {
    defaultProps.error = "Something went wrong";
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByTestId("error-message")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("should not display error message when error prop is not provided", () => {
    render(<FilePicker {...defaultProps} />);

    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
  });

  // Callback tests
  it("should call onFocus when dropzone is clicked", () => {
    defaultProps.onFocus = mockOnFocus;
    render(<FilePicker {...defaultProps} />);

    const container: HTMLElement = screen
      .getByText("Upload files")
      .closest("div")!.parentElement!.parentElement!;
    fireEvent.click(container);

    expect(mockOnFocus).toHaveBeenCalled();
  });

  it("should call onClick when dropzone is clicked", () => {
    defaultProps.onClick = mockOnClick;
    render(<FilePicker {...defaultProps} />);

    const container: HTMLElement = screen
      .getByText("Upload files")
      .closest("div")!.parentElement!.parentElement!;
    fireEvent.click(container);

    expect(mockOnClick).toHaveBeenCalled();
  });

  // Data test id
  it("should render with custom data-testid", () => {
    defaultProps.dataTestId = "custom-file-picker";
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByTestId("custom-file-picker")).toBeInTheDocument();
  });

  // Multi-file picker tests
  it("should show Add more files text when files exist and isMultiFilePicker is true", async () => {
    defaultProps.isMultiFilePicker = true;
    const file: File = mockFile("existing.png");
    defaultProps.initialValue = await mockFileModel(file);
    render(<FilePicker {...defaultProps} />);

    expect(screen.getByText("Add more files")).toBeInTheDocument();
  });

  // File without file attribute test
  it("should not render if file is missing the file attribute", async () => {
    const file: FileModel = await mockFileModel(mockFile("no-buffer.png"));
    delete file.file;
    defaultProps.initialValue = file;
    render(<FilePicker {...defaultProps} />);

    // File name should still be shown but file size won't be available
    expect(screen.getByText("no-buffer.png")).toBeInTheDocument();
  });

  // Error on arrayBuffer test
  it("should handle error when file arrayBuffer fails", async () => {
    const file: File = mockFile("error-file.png");
    file.arrayBuffer = getJestMockFunction().mockRejectedValue(
      new Error("File too large"),
    );
    const data: DataTransfer = {
      dataTransfer: {
        files: [file],
        types: ["Files"],
      },
    };

    render(<FilePicker {...defaultProps} />);

    const dropzone: HTMLElement = screen.getByLabelText("Upload files");
    fireEvent.drop(dropzone, data);

    await waitFor(() => {
      expect(screen.queryByText("error-file.png")).not.toBeInTheDocument();
    });
  });
});
