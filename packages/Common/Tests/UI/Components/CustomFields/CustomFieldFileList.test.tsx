import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import CustomFieldFileList, {
  getCustomFieldFileIcon,
  readCustomFieldFileEntries,
} from "../../../../UI/Components/CustomFields/CustomFieldFileList";
import { CustomFieldValueSummary } from "../../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import Detail from "../../../../UI/Components/Detail/Detail";
import {
  CustomFieldDefinition,
  getCustomFieldColumns,
  renderCustomFieldValue,
} from "../../../../UI/Components/ModelTable/CustomFieldColumns";
import FieldType from "../../../../UI/Components/Types/FieldType";
import FileModel from "../../../../Models/DatabaseModels/File";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { CustomFieldFile } from "../../../../Types/CustomField/CustomFieldFile";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";
import IconProp from "../../../../Types/Icon/IconProp";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * The files a File or Multiple files custom field holds, as people see them:
 * a row a file - its kind, its name, its size - that downloads it where the
 * reader may have it; a table cell's first name and how many more; a form's
 * review step's names, before anything is saved; and an export's names,
 * never ids or JSON.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const GERMAN_FILE: Record<string, string> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "de.json"), "utf8"),
) as Record<string, string>;

const GERMAN_KEYS: Array<string> = [
  "Download {{name}}",
  "{{count}} files",
  "{{count}} files_one",
  "+{{count}} more",
  "+{{count}} more_one",
];

const german: i18n = createInstance();

beforeAll(async () => {
  const translation: Record<string, string> = {};

  for (const key of GERMAN_KEYS) {
    translation[key] = GERMAN_FILE[key] as string;
  }

  await german.init({
    lng: "de",
    resources: { de: { translation } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

const CONTRACT: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000001",
  name: "signed-contract.pdf",
  fileType: MimeType.pdf,
  size: 48213,
};

const PHOTO: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000002",
  name: "rack.png",
  fileType: MimeType.png,
  size: 1572864,
};

const SHEET: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "inventory.xlsx",
  fileType: MimeType.xlsx,
  size: 0,
};

type DownloadOfFunction = (file: CustomFieldFile) => string;

const downloadOf: DownloadOfFunction = (file: CustomFieldFile): string => {
  return `https://oneuptime.example/api/custom-field-file/p/incident/r/${file.fileId}`;
};

describe("the list of a field's files", () => {
  test("a row a file: its name and size, each row its file's download in a new tab", () => {
    render(
      <CustomFieldFileList
        files={[CONTRACT, PHOTO]}
        getDownloadUrl={downloadOf}
        dataTestId="files"
      />,
    );

    const list: HTMLElement = screen.getByTestId("files");
    const rows: Array<HTMLElement> =
      within(list).getAllByTestId("custom-field-file");

    expect(list.tagName).toBe("UL");
    expect(list).toHaveAttribute("aria-label", "2 files");
    expect(
      rows.map((row: HTMLElement): string => {
        return row.tagName;
      }),
    ).toEqual(["A", "A"]);
    expect(rows[0]).toHaveTextContent("signed-contract.pdf");
    expect(rows[0]).toHaveTextContent("47 KB");
    expect(rows[0]).toHaveAttribute("href", downloadOf(CONTRACT));
    expect(rows[0]).toHaveAttribute("title", "Download signed-contract.pdf");
    expect(rows[0]).toHaveAttribute("target", "_blank");
    expect(rows[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(rows[1]).toHaveTextContent("1.5 MB");
  });

  test("one file is one file, to a screen reader too", () => {
    render(<CustomFieldFileList files={[CONTRACT]} dataTestId="files" />);

    expect(screen.getByTestId("files")).toHaveAttribute("aria-label", "1 file");
  });

  test("with no download to give, a row is the file's name and nothing to click", () => {
    render(
      <CustomFieldFileList
        files={[CONTRACT]}
        getDownloadUrl={(): null => {
          return null;
        }}
      />,
    );

    const row: HTMLElement = screen.getByTestId("custom-field-file");

    expect(row.tagName).toBe("DIV");
    expect(row).not.toHaveAttribute("href");
    expect(screen.queryByRole("link")).toBeNull();
    expect(row).toHaveTextContent("signed-contract.pdf");
  });

  test("a file of no known size shows no size", () => {
    render(<CustomFieldFileList files={[SHEET]} />);

    expect(screen.getByTestId("custom-field-file").textContent).toBe(
      "inventory.xlsx",
    );
  });

  test("no file is the field's empty text, or a dash", () => {
    render(
      <CustomFieldFileList
        files={[]}
        emptyText="No data entered"
        dataTestId="empty"
      />,
    );

    expect(screen.getByTestId("empty")).toHaveTextContent("No data entered");
    cleanup();

    render(<CustomFieldFileList files={[]} dataTestId="empty" />);

    expect(screen.getByTestId("empty")).toHaveTextContent("-");
  });

  test("in the reader's language", () => {
    render(
      <I18nextProvider i18n={german}>
        <CustomFieldFileList
          files={[CONTRACT]}
          getDownloadUrl={downloadOf}
          dataTestId="files"
        />
      </I18nextProvider>,
    );

    const download: string = GERMAN_FILE["Download {{name}}"] as string;

    expect(download).toBeTruthy();
    expect(download).not.toBe("Download {{name}}");
    expect(screen.getByTestId("custom-field-file")).toHaveAttribute(
      "title",
      download.replace("{{name}}", "signed-contract.pdf"),
    );
    expect(screen.getByTestId("files")).toHaveAttribute(
      "aria-label",
      (GERMAN_FILE["{{count}} files_one"] as string).replace("{{count}}", "1"),
    );
  });
});

describe("the list in a table cell", () => {
  test("the first file's name and how many more, every name on hover, never a link", () => {
    render(
      <CustomFieldFileList
        files={[CONTRACT, PHOTO, SHEET]}
        getDownloadUrl={downloadOf}
        isCompact={true}
        dataTestId="cell"
      />,
    );

    const cell: HTMLElement = screen.getByTestId("cell");

    expect(cell).toHaveTextContent("signed-contract.pdf");
    expect(cell).toHaveTextContent("+2 more");
    expect(cell).toHaveAttribute(
      "title",
      "signed-contract.pdf\nrack.png\ninventory.xlsx",
    );
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("one file is its name alone", () => {
    render(
      <CustomFieldFileList
        files={[CONTRACT]}
        isCompact={true}
        dataTestId="cell"
      />,
    );

    expect(screen.getByTestId("cell").textContent).toBe("signed-contract.pdf");
  });

  test("how many more, in the reader's language", () => {
    render(
      <I18nextProvider i18n={german}>
        <CustomFieldFileList
          files={[CONTRACT, PHOTO]}
          isCompact={true}
          dataTestId="cell"
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("cell")).toHaveTextContent(
      (GERMAN_FILE["+{{count}} more_one"] as string).replace("{{count}}", "1"),
    );
  });
});

describe("getCustomFieldFileIcon", () => {
  test.each([
    [MimeType.png, IconProp.Photo],
    [MimeType.jpeg, IconProp.Photo],
    ["IMAGE/WEBP", IconProp.Photo],
    [MimeType.csv, IconProp.TableCells],
    [MimeType.xls, IconProp.TableCells],
    [MimeType.xlsx, IconProp.TableCells],
    [MimeType.ods, IconProp.TableCells],
    [MimeType.zip, IconProp.Archive],
    [MimeType.pcap, IconProp.Archive],
    [MimeType.pdf, IconProp.DocumentText],
    [MimeType.txt, IconProp.DocumentText],
    ["", IconProp.DocumentText],
  ])("%s is drawn as %s", (fileType: string, icon: IconProp) => {
    expect(getCustomFieldFileIcon(fileType)).toBe(icon);
  });
});

describe("readCustomFieldFileEntries", () => {
  test("a stored value's references, each file once", () => {
    expect(readCustomFieldFileEntries([CONTRACT, PHOTO, CONTRACT])).toEqual([
      CONTRACT,
      PHOTO,
    ]);
    expect(readCustomFieldFileEntries(CONTRACT)).toEqual([CONTRACT]);
  });

  test("what a file picker holds: its File models, with their bytes' size", () => {
    const uploaded: FileModel = new FileModel(new ObjectID(CONTRACT.fileId));
    uploaded.name = "signed-contract.pdf";
    uploaded.fileType = MimeType.pdf;

    const chosen: FileModel = new FileModel();
    chosen.name = "screenshot.png";
    chosen.fileType = MimeType.png;
    chosen.file = Buffer.alloc(2048);

    expect(readCustomFieldFileEntries([uploaded, chosen])).toEqual([
      {
        fileId: CONTRACT.fileId,
        name: "signed-contract.pdf",
        fileType: MimeType.pdf,
        size: 0,
      },
      {
        fileId: "",
        name: "screenshot.png",
        fileType: MimeType.png,
        size: 2048,
      },
    ]);
  });

  test("anything that is no file is nothing to show", () => {
    for (const value of [
      null,
      undefined,
      "",
      "a.pdf",
      7,
      true,
      [],
      [{}],
      [1],
    ]) {
      expect(readCustomFieldFileEntries(value)).toEqual([]);
    }
  });
});

describe("a detail field of files", () => {
  test("a File or Multiple files field shows its files by name, with no link of its own", () => {
    render(
      <Detail<JSONObject>
        item={{ contract: CONTRACT as never, photos: [PHOTO, SHEET] as never }}
        showRecordLine={false}
        fields={[
          { key: "contract", title: "Contract", fieldType: FieldType.File },
          {
            key: "photos",
            title: "Photos",
            fieldType: FieldType.MultipleFiles,
          },
        ]}
      />,
    );

    const rows: Array<HTMLElement> = screen.getAllByTestId("custom-field-file");

    expect(
      rows.map((row: HTMLElement): string | null => {
        return row.textContent;
      }),
    ).toEqual(["signed-contract.pdf47 KB", "rack.png1.5 MB", "inventory.xlsx"]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  test("an empty one says the field's empty text", () => {
    render(
      <Detail<JSONObject>
        item={{ contract: null }}
        showRecordLine={false}
        fields={[
          {
            key: "contract",
            title: "Contract",
            fieldType: FieldType.File,
            placeholder: "No data entered",
          },
        ]}
      />,
    );

    expect(screen.getByText("No data entered")).toBeInTheDocument();
    expect(screen.queryByTestId("custom-field-file")).toBeNull();
  });

  test("a form's review step names the files its picker holds, before anything is saved", () => {
    const chosen: FileModel = new FileModel(new ObjectID(PHOTO.fileId));
    chosen.name = "rack.png";
    chosen.fileType = MimeType.png;

    render(
      <CustomFieldValueSummary
        definition={{
          name: "Photos",
          customFieldType: CustomFieldType.MultipleFiles,
        }}
        value={[chosen]}
      />,
    );

    expect(screen.getByTestId("custom-field-file")).toHaveTextContent(
      "rack.png",
    );
  });

  test("a review step's file field left empty says so", () => {
    render(
      <CustomFieldValueSummary
        definition={{ name: "Contract", customFieldType: CustomFieldType.File }}
        value={[]}
      />,
    );

    expect(screen.getByText("No data entered")).toBeInTheDocument();
  });
});

describe("a file field in a table", () => {
  const FILE_FIELD: CustomFieldDefinition = {
    name: "Contract",
    customFieldType: CustomFieldType.File,
  };

  const FILES_FIELD: CustomFieldDefinition = {
    name: "Photos",
    customFieldType: CustomFieldType.MultipleFiles,
  };

  test("a cell is the first file's name and how many more", () => {
    const { container } = render(
      <>
        {renderCustomFieldValue({
          value: [PHOTO, SHEET],
          definition: FILES_FIELD,
        })}
      </>,
    );

    expect(container).toHaveTextContent("rack.png+1 more");
    expect(container.querySelector("a")).toBeNull();
  });

  test("a cell whose value holds no file is the empty mark, not a file", () => {
    for (const value of ["not a file", { fileId: "nope" }, [], null]) {
      const { container } = render(
        <>
          {renderCustomFieldValue({
            value: value,
            definition: FILE_FIELD,
            noValueMessage: "-",
          })}
        </>,
      );

      expect(container.textContent).toBe("-");
      cleanup();
    }
  });

  test("an export holds the files' names, never their ids or JSON", () => {
    const columns: ReturnType<typeof getCustomFieldColumns<Monitor>> =
      getCustomFieldColumns<Monitor>({
        definitions: [FILE_FIELD, FILES_FIELD],
      });
    const monitor: Monitor = new Monitor();
    monitor.customFields = {
      Contract: CONTRACT as never,
      Photos: [PHOTO, SHEET] as never,
    };

    expect(columns[0]!.getExportValue!(monitor)).toBe("signed-contract.pdf");
    expect(columns[1]!.getExportValue!(monitor)).toBe(
      "rack.png, inventory.xlsx",
    );

    const empty: Monitor = new Monitor();
    empty.customFields = { Contract: "junk" };

    expect(columns[0]!.getExportValue!(empty)).toBe("");
  });
});
