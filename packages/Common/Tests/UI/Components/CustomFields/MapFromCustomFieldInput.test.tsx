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
 * The "field to copy from" picker.
 *
 * The reason this is a bespoke component rather than a `fetchDropdownOptions`
 * dropdown is asserted here as behaviour: the offered list depends on ANOTHER
 * value in the same form (the field type), and BasicForm's option fetch does
 * not re-run when a value changes. Filtering on every render is what makes
 * "choose Number, then pick a source" work.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import MapFromCustomFieldInput from "../../../../UI/Components/CustomFields/MapFromCustomFieldInput";
import MonitorCustomField from "../../../../Models/DatabaseModels/MonitorCustomField";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

interface SourceFieldInput {
  name: string;
  customFieldType: CustomFieldType;
}

type ResolveSourceFieldsFunction = (fields: Array<SourceFieldInput>) => void;

const resolveSourceFields: ResolveSourceFieldsFunction = (
  fields: Array<SourceFieldInput>,
): void => {
  getListMock.mockResolvedValue({
    data: fields.map((field: SourceFieldInput) => {
      return Object.assign(new MonitorCustomField(), field);
    }),
    count: fields.length,
    skip: 0,
    limit: fields.length,
  } as never);
};

interface RenderOptions {
  targetFieldType?: CustomFieldType | undefined;
  initialValue?: string | undefined;
  offerEveryType?: boolean | undefined;
  onChange?: ((value: string) => void) | undefined;
}

// The names the settings pages give the types, as the page hands them in.
const TYPE_NAMES: Partial<Record<CustomFieldType, string>> = {
  [CustomFieldType.Text]: "Text",
  [CustomFieldType.Number]: "Number",
  [CustomFieldType.Dropdown]: "Dropdown (single select)",
};

type RenderPickerFunction = (options?: RenderOptions) => void;

const renderPicker: RenderPickerFunction = (options?: RenderOptions): void => {
  render(
    <MapFromCustomFieldInput
      projectId={PROJECT_ID}
      sourceDefinitionModelType={MonitorCustomField}
      sourceTitle="Monitor"
      targetFieldType={options?.targetFieldType}
      initialValue={options?.initialValue}
      offerEveryType={options?.offerEveryType}
      describeFieldType={(type: CustomFieldType | undefined) => {
        return type ? TYPE_NAMES[type] : undefined;
      }}
      placeholder={
        options?.offerEveryType ? "Select a monitor custom field" : undefined
      }
      noSourceFieldsMessage={
        options?.offerEveryType
          ? "There are no monitor custom fields to copy yet."
          : undefined
      }
      onChange={options?.onChange}
    />,
  );
};

type OpenPickerFunction = () => Promise<void>;

// react-select opens on ArrowDown; its options are portalled to the body.
const openPicker: OpenPickerFunction = async (): Promise<void> => {
  fireEvent.keyDown(await screen.findByRole("combobox"), {
    key: "ArrowDown",
  });
};

type PickFunction = (name: string) => Promise<void>;

const pick: PickFunction = async (name: string): Promise<void> => {
  await openPicker();
  const option: HTMLElement = screen.getByText(name);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
};

afterEach(() => {
  cleanup();
  getListMock.mockReset();
});

describe("MapFromCustomFieldInput", () => {
  test("offers the source fields of the same type", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
      { name: "Rack Units", customFieldType: CustomFieldType.Number },
    ]);

    renderPicker({ targetFieldType: CustomFieldType.Text });

    expect(
      await screen.findByText("Select a Monitor custom field"),
    ).toBeInTheDocument();
  });

  /*
   * A source of a different type would be accepted by the picker and then
   * rejected on save, which is a worse experience than never offering it.
   */
  test("says so when no source field of this type exists", async () => {
    resolveSourceFields([
      { name: "Rack Units", customFieldType: CustomFieldType.Number },
    ]);

    renderPicker({ targetFieldType: CustomFieldType.Text });

    expect(
      await screen.findByText(
        /No Monitor custom field of this type exists in this project/i,
      ),
    ).toBeInTheDocument();
  });

  test("asks for a field type first when none has been chosen", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);

    renderPicker({});

    expect(
      await screen.findByText(/Choose a field type above/i),
    ).toBeInTheDocument();
  });

  /*
   * A mapping whose source field was renamed or deleted has quietly stopped
   * resolving. Dropping the stale value from the picker would hide that; the
   * settings page is the only place anyone would find out.
   */
  test("keeps showing a configured source that no longer exists, flagged", async () => {
    resolveSourceFields([
      { name: "Supplier", customFieldType: CustomFieldType.Text },
    ]);

    renderPicker({
      targetFieldType: CustomFieldType.Text,
      initialValue: "Vendor",
    });

    expect(
      await screen.findByText(/Vendor \(no longer available on Monitor\)/i),
    ).toBeInTheDocument();
  });

  test("reads the source definitions for this project", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);

    renderPicker({ targetFieldType: CustomFieldType.Text });

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    const args: Record<string, any> = getListMock.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["modelType"]).toBe(MonitorCustomField);
    expect(args["query"]["projectId"]).toBe(PROJECT_ID);
    expect(args["select"]["name"]).toBe(true);
    expect(args["select"]["customFieldType"]).toBe(true);
  });

  test("offers only the fields of the target's type, without naming their type", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
      { name: "Rack Units", customFieldType: CustomFieldType.Number },
    ]);

    renderPicker({ targetFieldType: CustomFieldType.Text });

    await openPicker();

    expect(screen.getByText("Vendor")).toBeInTheDocument();
    expect(screen.queryByText("Rack Units")).not.toBeInTheDocument();
    // Every one of them is a Text field: nothing to tell them apart by.
    expect(screen.queryByText("Text")).not.toBeInTheDocument();
  });

  test("reports a failed read instead of rendering an empty picker", async () => {
    getListMock.mockRejectedValue(new Error("Not authorized") as never);

    renderPicker({ targetFieldType: CustomFieldType.Text });

    expect(await screen.findByText(/Not authorized/i)).toBeInTheDocument();
  });
});

/*
 * A NEW mapped field ("Create Mapped Custom Field") has no type yet: it
 * takes the type - and a dropdown's options - of the field it copies. So the
 * picker offers every field of the source, each with its type under its
 * name, and says which type the new field will have once one is picked.
 */
describe("MapFromCustomFieldInput for a new mapped field", () => {
  test("offers every field of the source, whatever its type, each with its type", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
      { name: "Rack Units", customFieldType: CustomFieldType.Number },
      { name: "Region", customFieldType: CustomFieldType.Dropdown },
    ]);

    renderPicker({ offerEveryType: true });

    expect(
      await screen.findByText("Select a monitor custom field"),
    ).toBeInTheDocument();

    await openPicker();

    for (const [name, type] of [
      ["Vendor", "Text"],
      ["Rack Units", "Number"],
      ["Region", "Dropdown (single select)"],
    ]) {
      expect(screen.getByText(name!)).toBeInTheDocument();
      expect(screen.getByText(type!)).toBeInTheDocument();
    }
  });

  test("never asks for a type first: the new field takes the copied one's", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);

    renderPicker({ offerEveryType: true });

    expect(
      await screen.findByText("Select a monitor custom field"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Choose a field type above/i)).toBeNull();
  });

  test("ignores a target type it is handed", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
      { name: "Rack Units", customFieldType: CustomFieldType.Number },
    ]);

    renderPicker({
      offerEveryType: true,
      targetFieldType: CustomFieldType.Text,
    });

    await openPicker();

    expect(screen.getByText("Rack Units")).toBeInTheDocument();
  });

  test("says which type the new field will have once one is picked", async () => {
    const onChange: MockFunction = getJestMockFunction();

    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
      { name: "Region", customFieldType: CustomFieldType.Dropdown },
    ]);

    renderPicker({ offerEveryType: true, onChange: onChange });

    expect(
      await screen.findByText("Select a monitor custom field"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("map-from-selected-field-type")).toBeNull();

    await pick("Region");

    expect(onChange).toHaveBeenCalledWith("Region");
    expect(screen.getByTestId("map-from-selected-field-type").textContent).toBe(
      "Field Type: Dropdown (single select)",
    );
  });

  test("shows the type of a field that is already picked", async () => {
    resolveSourceFields([
      { name: "Vendor", customFieldType: CustomFieldType.Text },
    ]);

    renderPicker({ offerEveryType: true, initialValue: "Vendor" });

    expect(
      (await screen.findByTestId("map-from-selected-field-type")).textContent,
    ).toBe("Field Type: Text");
  });

  test("says how to get a field to copy when the source has none", async () => {
    resolveSourceFields([]);

    renderPicker({ offerEveryType: true });

    expect(
      await screen.findByText(
        "There are no monitor custom fields to copy yet.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("has a sentence of its own when the page gives none", async () => {
    resolveSourceFields([]);

    render(
      <MapFromCustomFieldInput
        projectId={PROJECT_ID}
        sourceDefinitionModelType={MonitorCustomField}
        sourceTitle="Monitor"
        offerEveryType={true}
      />,
    );

    expect(
      await screen.findByText(
        "No Monitor custom field exists in this project yet. Create one first.",
      ),
    ).toBeInTheDocument();
  });
});
