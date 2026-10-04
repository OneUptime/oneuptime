import FilePicker, {
  DEFAULT_MAX_FILE_SIZE_IN_MEGABYTES,
  getMaxFileSizeInMegabytes,
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
   * 1 MB - says its own limit, and refuses a larger file before it is
   * uploaded, so it never promises more than the field keeps.
   */
  describe("a limit of its own", () => {
    it("says its own limit, with the types it takes", () => {
      render(<FilePicker {...defaultProps} maxFileSizeInMegabytes={1} />);

      expect(
        screen.getByText("Types: PNG. Max 1 MB each."),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Max 10MB each/)).not.toBeInTheDocument();
    });

    it("says its own limit without types too", () => {
      render(
        <FilePicker
          {...defaultProps}
          mimeTypes={[]}
          maxFileSizeInMegabytes={1}
        />,
      );

      expect(screen.getByText("Max 1 MB each.")).toBeInTheDocument();
    });

    it("refuses a larger file before uploading it, and says why", async () => {
      const big: File = new File([new Uint8Array(1024 * 1024 + 1)], "big.png", {
        type: MimeType.png,
      });

      render(<FilePicker {...defaultProps} maxFileSizeInMegabytes={1} />);

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

    it("takes a file of exactly its limit", async () => {
      const exact: File = new File([new Uint8Array(1024 * 1024)], "exact.png", {
        type: MimeType.png,
      });
      // jsdom's File cannot read itself; the upload reads these bytes.
      exact.arrayBuffer = async (): Promise<ArrayBuffer> => {
        return new ArrayBuffer(1024 * 1024);
      };
      (
        ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
      ).mockResolvedValue(await mockCreateResponse(exact));

      render(<FilePicker {...defaultProps} maxFileSizeInMegabytes={1} />);

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
      expect(DEFAULT_MAX_FILE_SIZE_IN_MEGABYTES).toBe(10);

      for (const value of [undefined, 0, -1, Number.NaN, 10, 50]) {
        expect(getMaxFileSizeInMegabytes(value)).toBe(10);
      }

      expect(getMaxFileSizeInMegabytes(1)).toBe(1);
      expect(getMaxFileSizeInMegabytes(0.5)).toBe(0.5);
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
