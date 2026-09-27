import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * The Custom Fields card and the incident-only field settings:
 *
 *   - incident fields are listed in their order (sortOrder), fields without
 *     one last - on the card and in its edit form;
 *   - the order column is asked for only from a definition model that has
 *     it, since a select of a missing column fails the whole read;
 *   - the edit form keeps every field optional, "Required on create"
 *     included: fixing one field mid-outage must not demand the others;
 *   - Long text and Rich text fields get their own inputs.
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
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorCustomField from "../../../../Models/DatabaseModels/MonitorCustomField";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RECORD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface IncidentFieldInput {
  name: string;
  customFieldType?: CustomFieldType;
  sortOrder?: number | undefined;
  isRequiredOnCreate?: boolean;
  showOnCreate?: boolean;
}

function incidentFields(
  fields: Array<IncidentFieldInput>,
): Array<IncidentCustomField> {
  return fields.map((input: IncidentFieldInput) => {
    const item: IncidentCustomField = new IncidentCustomField();
    item.name = input.name;
    item.customFieldType = input.customFieldType || CustomFieldType.Text;

    if (input.sortOrder !== undefined) {
      item.sortOrder = input.sortOrder;
    }

    item.isRequiredOnCreate = Boolean(input.isRequiredOnCreate);
    item.showOnCreate = Boolean(input.showOnCreate);

    return item;
  });
}

function resolveListWith(data: Array<BaseModel>): void {
  getListMock.mockResolvedValue({
    data: data,
    count: data.length,
    skip: 0,
    limit: data.length,
  } as never);
}

function resolveRecordWith(
  modelType: DatabaseBaseModelType,
  customFields: JSONObject,
): void {
  const record: BaseModel = new modelType();
  record.id = RECORD_ID;
  (record as unknown as JSONObject)["customFields"] = customFields;
  getItemMock.mockResolvedValue(record as never);
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

type TitlesInOrderFunction = (titles: Array<string>) => Array<string>;

// The given titles, in the order they appear in the document.
const titlesInOrder: TitlesInOrderFunction = (
  titles: Array<string>,
): Array<string> => {
  const text: string = document.body.textContent || "";

  return [...titles].sort((a: string, b: string) => {
    return text.indexOf(a) - text.indexOf(b);
  });
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

describe("CustomFieldsDetail - the order of incident fields", () => {
  test("asks for the order, sorted by it", async () => {
    resolveListWith(incidentFields([{ name: "Impact" }]));
    resolveRecordWith(Incident, {});

    renderCard();

    await screen.findByText("Impact");

    const listArgs: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;

    expect((listArgs["select"] as JSONObject)["sortOrder"]).toBe(true);
    expect(listArgs["sort"]).toEqual({ sortOrder: SortOrder.Ascending });
  });

  test("lists the fields by their order, fields without one last", async () => {
    // The server's order, which the card must not trust for the nulls.
    resolveListWith(
      incidentFields([
        { name: "Unordered Field" },
        { name: "Third Field", sortOrder: 30 },
        { name: "First Field", sortOrder: 1 },
        { name: "Second Field", sortOrder: 2 },
      ]),
    );
    resolveRecordWith(Incident, {});

    renderCard();

    await screen.findByText("First Field");

    expect(
      titlesInOrder([
        "Unordered Field",
        "Third Field",
        "First Field",
        "Second Field",
      ]),
    ).toEqual([
      "First Field",
      "Second Field",
      "Third Field",
      "Unordered Field",
    ]);
  });

  test("the edit form uses the same order", async () => {
    resolveListWith(
      incidentFields([
        { name: "Later Field", sortOrder: 5 },
        { name: "Earlier Field", sortOrder: 1 },
      ]),
    );
    resolveRecordWith(Incident, {});

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    const dialog: HTMLElement = await screen.findByRole("dialog");
    const text: string = dialog.textContent || "";

    expect(text.indexOf("Earlier Field")).toBeGreaterThan(-1);
    expect(text.indexOf("Earlier Field")).toBeLessThan(
      text.indexOf("Later Field"),
    );
  });

  test("a resource without an order column is read as before", async () => {
    const field: MonitorCustomField = new MonitorCustomField();
    field.name = "Vendor";
    field.customFieldType = CustomFieldType.Text;
    resolveListWith([field]);
    resolveRecordWith(Monitor, { Vendor: "Acme" });

    renderCard(Monitor, MonitorCustomField);

    await screen.findByText("Acme");

    const listArgs: JSONObject = getListMock.mock.calls[0]![0] as JSONObject;

    expect(
      Object.prototype.hasOwnProperty.call(listArgs["select"], "sortOrder"),
    ).toBe(false);
    expect(listArgs["sort"]).toEqual({});
  });
});

describe("CustomFieldsDetail - editing stays optional", () => {
  test("a field required on create is optional on the card", async () => {
    resolveListWith(
      incidentFields([
        {
          name: "Impact",
          isRequiredOnCreate: true,
          showOnCreate: true,
          sortOrder: 1,
        },
        {
          name: "Acknowledgement",
          customFieldType: CustomFieldType.Boolean,
          isRequiredOnCreate: true,
          showOnCreate: true,
          sortOrder: 2,
        },
        { name: "Notes", sortOrder: 3 },
      ]),
    );
    resolveRecordWith(Incident, { Notes: "Paged the network team" });
    updateByIdMock.mockResolvedValue(undefined as never);

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    const notes: HTMLInputElement = (await screen.findByDisplayValue(
      "Paged the network team",
    )) as HTMLInputElement;
    fireEvent.change(notes, { target: { value: "Paged the vendor too" } });
    fireEvent.click(screen.getByText("Save"));

    // Impact is empty and Acknowledgement unticked, and the save still goes out.
    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalled();
    });

    const data: JSONObject = (updateByIdMock.mock.calls[0]![0] as JSONObject)[
      "data"
    ] as JSONObject;

    expect((data["customFields"] as JSONObject)["Notes"]).toBe(
      "Paged the vendor too",
    );
    expect(screen.queryByText(/is required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/must be checked/i)).not.toBeInTheDocument();
  });
});

describe("CustomFieldsDetail - long and rich text", () => {
  test("a Long text field is edited in a text area", async () => {
    resolveListWith(
      incidentFields([
        {
          name: "Additional Information",
          customFieldType: CustomFieldType.LongText,
        },
      ]),
    );
    resolveRecordWith(Incident, {
      "Additional Information": "First line\nSecond line",
    });

    renderCard();

    fireEvent.click(await screen.findByText("Edit Fields"));

    const input: HTMLElement = await screen.findByDisplayValue(/First line/);

    expect(input.tagName).toBe("TEXTAREA");
  });

  test("a Rich text field shows its Markdown on the card", async () => {
    resolveListWith(
      incidentFields([
        {
          name: "Incident Details",
          customFieldType: CustomFieldType.Markdown,
        },
      ]),
    );
    resolveRecordWith(Incident, { "Incident Details": "Checkout is down" });

    renderCard();

    expect(await screen.findByText("Incident Details")).toBeInTheDocument();
    expect(await screen.findByText(/Checkout is down/)).toBeInTheDocument();
  });
});
