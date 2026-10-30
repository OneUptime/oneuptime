import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A record's File and Multiple files custom fields on its Custom Fields
 * card. Each file is a row - its name, its size - that downloads it through
 * the route that serves it to people who may read the record; the edit form
 * lists the files the field holds in its file picker, and saving hands each
 * file back as the file it names, for the server to write as the file says
 * it is.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<string> } => {
        return { globalPermissions: ["ProjectOwner"] };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

import CustomFieldsDetail from "../../../../UI/Components/CustomFields/CustomFieldsDetail";
import { APP_API_URL } from "../../../../UI/Config";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import URL from "../../../../Types/API/URL";
import { CustomFieldFile } from "../../../../Types/CustomField/CustomFieldFile";
import { getCustomFieldFileDownloadPath } from "../../../../Types/CustomField/CustomFieldRecordKinds";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import MimeType from "../../../../Types/File/MimeType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECORD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

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
  size: 2 * 1024 * 1024,
};

const LOG: CustomFieldFile = {
  fileId: "aaaaaaaa-0000-4000-8000-000000000003",
  name: "db.log",
  fileType: MimeType.txt,
  size: 640,
};

function definition<T extends BaseModel>(
  modelType: { new (): T },
  name: string,
  type: CustomFieldType,
): T {
  const field: T = new modelType();
  field.setValue("name", name);
  field.setValue("description", "");
  field.setValue("customFieldType", type);
  return field;
}

function record<T extends BaseModel>(
  modelType: { new (): T },
  customFields: JSONObject,
): T {
  const item: T = new modelType();
  item.id = RECORD_ID;
  item.setValue("customFields", customFields);
  return item;
}

function listOf(data: Array<BaseModel>): void {
  getListMock.mockResolvedValue({
    data: data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as never);
}

function renderCard(
  modelType: DatabaseBaseModelType = Incident,
  customFieldType: DatabaseBaseModelType = IncidentCustomField,
): void {
  render(
    <CustomFieldsDetail
      title="Custom Fields"
      description="Custom fields for this record."
      modelType={modelType}
      customFieldType={customFieldType}
      name="Custom Fields"
      projectId={PROJECT_ID}
      modelId={RECORD_ID}
    />,
  );
}

function downloadUrl(recordTableName: string, file: CustomFieldFile): string {
  return URL.fromURL(APP_API_URL)
    .addRoute(
      getCustomFieldFileDownloadPath({
        recordTableName: recordTableName,
        projectId: PROJECT_ID,
        recordId: RECORD_ID,
        fileId: file.fileId,
      })!,
    )
    .toString();
}

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

describe("a file field on the Custom Fields card", () => {
  test("shows each file by name and size, each a download of the record's file", async () => {
    listOf([
      definition(IncidentCustomField, "Contract", CustomFieldType.File),
      definition(IncidentCustomField, "Photos", CustomFieldType.MultipleFiles),
    ]);
    getItemMock.mockResolvedValue(
      record(Incident, {
        Contract: CONTRACT as never,
        Photos: [PHOTO, LOG] as never,
      }) as never,
    );

    renderCard();

    const contract: HTMLElement = await screen.findByTestId(
      "custom-field-files-Contract",
    );
    const contractRows: Array<HTMLElement> =
      within(contract).getAllByTestId("custom-field-file");

    expect(contractRows).toHaveLength(1);
    expect(contractRows[0]).toHaveTextContent("signed-contract.pdf");
    expect(contractRows[0]).toHaveTextContent("47 KB");
    expect(contractRows[0]).toHaveAttribute(
      "href",
      downloadUrl("Incident", CONTRACT),
    );
    expect(contractRows[0]).toHaveAttribute("target", "_blank");
    expect(contractRows[0]).toHaveAttribute("rel", "noopener noreferrer");

    const photos: Array<HTMLElement> = within(
      screen.getByTestId("custom-field-files-Photos"),
    ).getAllByTestId("custom-field-file");

    expect(
      photos.map((row: HTMLElement): string | null => {
        return row.getAttribute("href");
      }),
    ).toEqual([downloadUrl("Incident", PHOTO), downloadUrl("Incident", LOG)]);
    expect(photos[0]).toHaveTextContent("2 MB");
    expect(photos[1]).toHaveTextContent("640 B");
  });

  test("links to the right kind of record: an alert's file downloads through the alert", async () => {
    listOf([definition(AlertCustomField, "Runbook", CustomFieldType.File)]);
    getItemMock.mockResolvedValue(
      record(Alert, { Runbook: CONTRACT as never }) as never,
    );

    renderCard(Alert, AlertCustomField);

    const row: HTMLElement = within(
      await screen.findByTestId("custom-field-files-Runbook"),
    ).getByTestId("custom-field-file");

    expect(row).toHaveAttribute("href", downloadUrl("Alert", CONTRACT));
    expect(row.getAttribute("href")).toContain("/custom-field-file/");
    expect(row.getAttribute("href")).toContain("/alert/");
  });

  test("a field with no file says so, as any empty field does", async () => {
    listOf([definition(IncidentCustomField, "Contract", CustomFieldType.File)]);
    getItemMock.mockResolvedValue(record(Incident, {}) as never);

    renderCard();

    expect(
      await screen.findByTestId("custom-field-files-Contract"),
    ).toHaveTextContent("No data entered");
  });

  test("a value that is no file is not drawn as one", async () => {
    listOf([definition(IncidentCustomField, "Contract", CustomFieldType.File)]);
    getItemMock.mockResolvedValue(
      record(Incident, { Contract: "not a file" }) as never,
    );

    renderCard();

    const field: HTMLElement = await screen.findByTestId(
      "custom-field-files-Contract",
    );

    expect(within(field).queryByTestId("custom-field-file")).toBeNull();
    expect(field).toHaveTextContent("No data entered");
  });

  test("names each row's download for a screen reader", async () => {
    listOf([definition(IncidentCustomField, "Contract", CustomFieldType.File)]);
    getItemMock.mockResolvedValue(
      record(Incident, { Contract: CONTRACT as never }) as never,
    );

    renderCard();

    const row: HTMLElement = within(
      await screen.findByTestId("custom-field-files-Contract"),
    ).getByTestId("custom-field-file");

    expect(row).toHaveAttribute("title", "Download signed-contract.pdf");
  });
});

describe("editing a file field", () => {
  test("the file picker lists the files the field holds", async () => {
    listOf([
      definition(IncidentCustomField, "Photos", CustomFieldType.MultipleFiles),
    ]);
    getItemMock.mockResolvedValue(
      record(Incident, { Photos: [PHOTO, LOG] as never }) as never,
    );

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    expect(await screen.findByText("Uploaded files")).toBeInTheDocument();
    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(within(dialog).getByText("rack.png")).toBeInTheDocument();
    expect(within(dialog).getByText("db.log")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Up to 10 files of 10 MB each: PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP.",
      ),
    ).toBeInTheDocument();
  });

  test("saving sends each file as the file it names, and the other values as they were", async () => {
    listOf([
      definition(IncidentCustomField, "Contract", CustomFieldType.File),
      definition(IncidentCustomField, "Photos", CustomFieldType.MultipleFiles),
      definition(IncidentCustomField, "Ticket", CustomFieldType.Text),
    ]);
    getItemMock.mockResolvedValue(
      record(Incident, {
        Contract: CONTRACT as never,
        Photos: [PHOTO, LOG] as never,
        Ticket: "OPS-1",
      }) as never,
    );
    updateByIdMock.mockResolvedValue({} as never);

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));
    fireEvent.click(await screen.findByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    // The card reads the record again once it is saved.
    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();

    const sent: JSONObject = (
      (updateByIdMock.mock.calls[0]![0] as JSONObject)["data"] as JSONObject
    )["customFields"] as JSONObject;

    expect(sent).toEqual({
      Contract: {
        fileId: CONTRACT.fileId,
        name: CONTRACT.name,
        fileType: CONTRACT.fileType,
      },
      Photos: [
        { fileId: PHOTO.fileId, name: PHOTO.name, fileType: PHOTO.fileType },
        { fileId: LOG.fileId, name: LOG.name, fileType: LOG.fileType },
      ],
      Ticket: "OPS-1",
    });
  });

  test("a file taken out in the picker is left out of what is saved", async () => {
    listOf([
      definition(IncidentCustomField, "Photos", CustomFieldType.MultipleFiles),
    ]);
    getItemMock.mockResolvedValue(
      record(Incident, { Photos: [PHOTO, LOG] as never }) as never,
    );
    updateByIdMock.mockResolvedValue({} as never);

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    const dialog: HTMLElement = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getAllByText("Remove")[0]!);
    fireEvent.click(within(dialog).getByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Edit Fields")).toBeInTheDocument();

    expect(
      ((updateByIdMock.mock.calls[0]![0] as JSONObject)["data"] as JSONObject)[
        "customFields"
      ],
    ).toEqual({
      Photos: [{ fileId: LOG.fileId, name: LOG.name, fileType: LOG.fileType }],
    });
  });

  test("a File field's picker offers one file and says what it takes", async () => {
    listOf([definition(IncidentCustomField, "Contract", CustomFieldType.File)]);
    getItemMock.mockResolvedValue(record(Incident, {}) as never);

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Upload a file")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "PDF, Office and OpenDocument files, pictures, text, CSV, JSON, ZIP or PCAP, up to 10 MB.",
      ),
    ).toBeInTheDocument();
  });
});
