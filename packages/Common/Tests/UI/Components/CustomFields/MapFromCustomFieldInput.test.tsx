import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
}

type RenderPickerFunction = (options?: RenderOptions) => void;

const renderPicker: RenderPickerFunction = (options?: RenderOptions): void => {
  render(
    <MapFromCustomFieldInput
      projectId={PROJECT_ID}
      sourceDefinitionModelType={MonitorCustomField}
      sourceTitle="Monitor"
      targetFieldType={options?.targetFieldType}
      initialValue={options?.initialValue}
    />,
  );
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

  test("reports a failed read instead of rendering an empty picker", async () => {
    getListMock.mockRejectedValue(new Error("Not authorized") as never);

    renderPicker({ targetFieldType: CustomFieldType.Text });

    expect(await screen.findByText(/Not authorized/i)).toBeInTheDocument();
  });
});
