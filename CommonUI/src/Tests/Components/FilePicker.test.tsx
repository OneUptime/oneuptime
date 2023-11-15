import React from 'react';
import { act } from 'react-test-renderer';

import { faker } from '@faker-js/faker';
import {
    render,
    fireEvent,
    screen,
    waitFor,
    queryByAttribute,
    queryAllByAttribute,
    queryByTestId,
} from '@testing-library/react';
import '@testing-library/jest-dom/extend-expect';

import MimeType from 'Common/Types/File/MimeType';
import FileModel from 'Model/Models/File';
import ModelAPI from '../../Utils/ModelAPI/ModelAPI';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import ObjectID from 'Common/Types/ObjectID';

import FilePicker from '../../Components/FilePicker/FilePicker';

const mockOnChange: jest.Mock = jest.fn();
const mockOnBlur: jest.Mock = jest.fn();

jest.mock('../../Utils/ModelAPI/ModelAPI', () => {
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
}

interface DataTransfer {
    dataTransfer: {
        files: File[];
        types: string[];
    };
}

const mockCreateResponse: Function = async (
    file: File
): Promise<HTTPResponse<FileModel>> => {
    return new HTTPResponse(
        200,
        {
            file: (await file.arrayBuffer()) as Buffer,
            name: file.name,
            type: file.type,
            slug: file.name,
            isPublic: true,
        },
        {}
    );
};

const mockFileModel: Function = async (file: File): Promise<FileModel> => {
    const fileModel: FileModel = new FileModel(new ObjectID('123'));
    fileModel.name = file.name;
    fileModel.type = file.type as MimeType;
    fileModel.slug = file.name;
    fileModel.isPublic = true;
    fileModel.file = (await file.arrayBuffer()) as Buffer;
    return fileModel;
};

const mockFile: Function = (): File => {
    const mockArrayBuffer: jest.Mock = jest.fn();
    mockArrayBuffer.mockResolvedValue(new ArrayBuffer(10)); // Mocked array buffer of size 10

    const file: File = new File(
        [faker.datatype.string()],
        faker.system.commonFileName(MimeType.png),
        { type: MimeType.png }
    );
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

describe('FilePicker', () => {
    const MOCK_FILE_URL: string = 'https://mock-file-url';

    beforeAll(() => {
        global.URL.createObjectURL = jest.fn(() => {
            return MOCK_FILE_URL;
        });
    });

    afterAll(() => {
        (
            global.URL.createObjectURL as jest.MockedFunction<
                typeof global.URL.createObjectURL
            >
        ).mockRestore();
    });

    beforeEach(() => {
        delete defaultProps.isMultiFilePicker;
        delete defaultProps.initialValue;
        delete defaultProps.value;
        delete defaultProps.readOnly;
    });

    it('should render without crashing', () => {
        render(<FilePicker {...defaultProps} />);
        expect(screen.getByText('Upload a file')).toBeInTheDocument();
        expect(screen.getByRole('complementary')).toBeInTheDocument(); // aside element
    });

    it('should render with initial value', async () => {
        defaultProps.initialValue = await mockFileModel(mockFile());
        const { container } = render(<FilePicker {...defaultProps} />);
        expect(
            queryByAttribute('src', container, MOCK_FILE_URL)
        ).toBeInTheDocument();
    });

    it('should not render if file is missing the `file` attribute', async () => {
        const file: FileModel = await mockFileModel(mockFile());
        delete file.file;
        defaultProps.initialValue = file;
        const { container } = render(<FilePicker {...defaultProps} />);
        expect(
            queryByAttribute('src', container, MOCK_FILE_URL)
        ).not.toBeInTheDocument();
    });

    it('should render with initial value as array', async () => {
        defaultProps.initialValue = [
            await mockFileModel(mockFile()),
            await mockFileModel(mockFile()),
        ];
        render(<FilePicker {...defaultProps} />);
        const { container } = render(<FilePicker {...defaultProps} />);
        expect(
            queryAllByAttribute('src', container, MOCK_FILE_URL)
        ).toHaveLength(2);
    });

    it('should render with value array with one element', async () => {
        defaultProps.value = [await mockFileModel(mockFile())];
        const { container } = render(<FilePicker {...defaultProps} />);
        expect(
            queryByAttribute('src', container, MOCK_FILE_URL)
        ).toBeInTheDocument();
    });

    it('should render with value array with more than one element', async () => {
        defaultProps.value = [
            await mockFileModel(mockFile()),
            await mockFileModel(mockFile()),
        ];
        render(<FilePicker {...defaultProps} />);
        const { container } = render(<FilePicker {...defaultProps} />);
        expect(
            queryAllByAttribute('src', container, MOCK_FILE_URL)
        ).toHaveLength(2);
    });

    it('should not upload file when dropped and readOnly is true', async () => {
        defaultProps.readOnly = true;

        const file: File = mockFile();
        const data: DataTransfer = {
            dataTransfer: {
                files: [file],
                types: ['Files'],
            },
        };

        const createResponse: HTTPResponse<FileModel> =
            await mockCreateResponse(file);
        (
            ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
        ).mockResolvedValue(createResponse);

        const { container } = render(<FilePicker {...defaultProps} />);

        const dropzone: HTMLElement = screen.getByLabelText('Upload a file');
        fireEvent.drop(dropzone, data);

        await waitFor(() => {
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).not.toBeInTheDocument();
        });
    });

    it('should throw an "File too large" when uploading a file that fails on arrayBuffer()', async () => {
        const file: File = mockFile();
        file.arrayBuffer = jest
            .fn()
            .mockRejectedValue(new Error('File too large'));
        const data: DataTransfer = {
            dataTransfer: {
                files: [file],
                types: ['Files'],
            },
        };

        const { container } = render(<FilePicker {...defaultProps} />);

        const dropzone: HTMLElement = screen.getByLabelText('Upload a file');
        fireEvent.drop(dropzone, data);

        await waitFor(() => {
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).not.toBeInTheDocument();
        });
    });

    it('should upload a file when dropped', async () => {
        const file: File = mockFile();
        const data: DataTransfer = {
            dataTransfer: {
                files: [file],
                types: ['Files'],
            },
        };

        const createResponse: HTTPResponse<FileModel> =
            await mockCreateResponse(file);
        (
            ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
        ).mockResolvedValue(createResponse);

        const { container } = render(<FilePicker {...defaultProps} />);

        const dropzone: HTMLElement = screen.getByLabelText('Upload a file');
        await act(async () => {
            fireEvent.drop(dropzone, data);
        });

        await waitFor(() => {
            expect(mockOnChange).toHaveBeenCalledWith([createResponse.data]);
            expect(mockOnBlur).toHaveBeenCalled();
            expect(mockOnBlur).toHaveBeenCalled();
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).toBeInTheDocument();
        });
    });

    it('should upload a file when dropped', async () => {
        const file: File = mockFile();
        const data: DataTransfer = {
            dataTransfer: {
                files: [file],
                types: ['Files'],
            },
        };

        const createResponse: HTTPResponse<FileModel> =
            await mockCreateResponse(file);
        (
            ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
        ).mockResolvedValue(createResponse);

        const { container } = render(<FilePicker {...defaultProps} />);

        const dropzone: HTMLElement = screen.getByLabelText('Upload a file');
        await act(async () => {
            fireEvent.drop(dropzone, data);
        });

        await waitFor(() => {
            expect(mockOnChange).toHaveBeenCalledWith([createResponse.data]);
            expect(mockOnBlur).toHaveBeenCalled();
            expect(mockOnBlur).toHaveBeenCalled();
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).toBeInTheDocument();
        });
    });

    it('should show loader a file when files are being uploaded', async () => {
        const uploadPromise: Promise<unknown> = new Promise((resolve: any) => {
            (global as any).mockUploadResolve = resolve; // Store resolve function globally or in a scope accessible outside the test
        });

        (
            ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
        ).mockImplementation((): any => {
            return uploadPromise;
        });

        const file: File = mockFile();
        const data: DataTransfer = {
            dataTransfer: {
                files: [file],
                types: ['Files'],
            },
        };

        const createResponse: HTTPResponse<FileModel> =
            await mockCreateResponse(file);

        const { container } = render(<FilePicker {...defaultProps} />);

        const dropzone: HTMLElement = screen.getByLabelText('Upload a file');
        await act(async () => {
            fireEvent.drop(dropzone, data);
        });

        expect(queryByTestId(container, 'loader')).toBeInTheDocument();

        (global as any).mockUploadResolve(createResponse);

        await waitFor(() => {
            expect(mockOnChange).toHaveBeenCalledWith([createResponse.data]);
            expect(mockOnBlur).toHaveBeenCalled();
            expect(mockOnBlur).toHaveBeenCalled();
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).toBeInTheDocument();
        });
    });

    it('should delete an uploaded file when clicking on it', async () => {
        const file: File = mockFile();
        const data: DataTransfer = {
            dataTransfer: {
                files: [file],
                types: ['Files'],
            },
        };

        const createResponse: HTTPResponse<FileModel> =
            await mockCreateResponse(file);
        (
            ModelAPI.create as jest.MockedFunction<typeof ModelAPI.create>
        ).mockResolvedValue(createResponse);

        const { container } = render(<FilePicker {...defaultProps} />);

        const dropzone: HTMLElement = screen.getByLabelText('Upload a file');
        await act(async () => {
            fireEvent.drop(dropzone, data);
        });

        await waitFor(() => {
            // file should be in the dropzone
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).toBeInTheDocument();
        });

        const deleteIcon: ChildNode = screen
            .getByRole('icon')
            .childNodes.item(0); // svg item
        // remove file by clicking on it
        if (deleteIcon) {
            await act(async () => {
                fireEvent.click(deleteIcon.childNodes.item(0), data);
            });
        }

        await waitFor(() => {
            // file should have been removed
            expect(mockOnChange).toHaveBeenCalledWith([createResponse.data]);
            expect(
                queryByAttribute('src', container, MOCK_FILE_URL)
            ).not.toBeInTheDocument();
        });
    });
});
