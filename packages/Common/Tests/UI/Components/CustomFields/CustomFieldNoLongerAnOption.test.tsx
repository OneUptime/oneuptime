import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
 * A value a record holds that its dropdown field no longer offers - an
 * option taken out after the record chose it (#4564) - is still the record's
 * value. It is shown as itself, in gray, marked "no longer an option": on
 * the Custom Fields card (which used to say "No data entered" for it), in
 * the card's edit form (chosen, so saving another field keeps it) and among
 * the options a form lists. A field with no options at all marks nothing.
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
import {
  buildCustomFieldFormFields,
  CUSTOM_FIELD_NO_LONGER_AN_OPTION_COLOR,
  getCustomFieldDropdownOptions,
} from "../../../../UI/Components/CustomFields/CustomFieldFormFields";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import { getCustomFieldValuesNotOffered } from "../../../../Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const OPTIONS: string = JSON.stringify([
  { value: "Facility A", color: "#ef4444" },
  { value: "Facility C" },
]);

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  updateByIdMock.mockReset();
});

describe("getCustomFieldValuesNotOffered", () => {
  test("the values a record holds that the field does not offer, once each, as stored", () => {
    expect(
      getCustomFieldValuesNotOffered({
        dropdownOptions: OPTIONS,
        value: "Facility B",
      }),
    ).toEqual(["Facility B"]);

    expect(
      getCustomFieldValuesNotOffered({
        dropdownOptions: OPTIONS,
        value: ["Facility A", "Old Site", 5, "Old Site", "", null, { x: 1 }],
      }),
    ).toEqual(["Old Site", 5]);
  });

  test("an option the field offers, an empty value, and a field with no options report nothing", () => {
    for (const value of ["Facility A", ["Facility C"], "", null, undefined, []]) {
      expect(
        getCustomFieldValuesNotOffered({ dropdownOptions: OPTIONS, value }),
      ).toEqual([]);
    }

    expect(
      getCustomFieldValuesNotOffered({ dropdownOptions: "", value: "Anything" }),
    ).toEqual([]);
  });
});

describe("getCustomFieldDropdownOptions with the record's own value", () => {
  test("lists the field's options, then each value it holds that they are not, marked and gray", () => {
    const options: Array<DropdownOption> = getCustomFieldDropdownOptions(
      OPTIONS,
      ["Facility A", "Facility B"],
    );

    expect(
      options.map((option: DropdownOption): [string, unknown] => {
        return [option.label, option.value];
      }),
    ).toEqual([
      ["Facility A", "Facility A"],
      ["Facility C", "Facility C"],
      ["Facility B (no longer an option)", "Facility B"],
    ]);
    expect(options[2]!.color?.toString()).toBe(
      CUSTOM_FIELD_NO_LONGER_AN_OPTION_COLOR,
    );
  });

  test("keeps a number as the number it is stored as, so it stays chosen", () => {
    expect(
      getCustomFieldDropdownOptions(OPTIONS, 5).map(
        (option: DropdownOption): unknown => {
          return option.value;
        },
      ),
    ).toEqual(["Facility A", "Facility C", 5]);
  });

  test("without the record's value, only the options", () => {
    expect(getCustomFieldDropdownOptions(OPTIONS)).toHaveLength(2);
  });
});

describe("buildCustomFieldFormFields with the record's values", () => {
  test("a dropdown offers its record's value no longer offered; the others are untouched", () => {
    const fields: Array<Field<JSONObject>> = buildCustomFieldFormFields({
      definitions: [
        {
          name: "Facility",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: OPTIONS,
        },
        {
          name: "Systems",
          customFieldType: CustomFieldType.MultiSelectDropdown,
          dropdownOptions: OPTIONS,
        },
        { name: "Ticket", customFieldType: CustomFieldType.Text },
      ],
      values: {
        Facility: "Facility B",
        Systems: ["Facility A"],
        Ticket: "T-1",
      },
    });

    expect(
      (fields[0]!.dropdownOptions || []).map((option: DropdownOption) => {
        return option.label;
      }),
    ).toEqual([
      "Facility A",
      "Facility C",
      "Facility B (no longer an option)",
    ]);
    expect(fields[1]!.dropdownOptions).toHaveLength(2);
    expect(fields[2]!.dropdownOptions).toBeUndefined();
  });
});

describe("the Custom Fields card", () => {
  function renderCard(customFields: JSONObject): void {
    const facility: IncidentCustomField = new IncidentCustomField();
    facility.name = "Facility";
    facility.customFieldType = CustomFieldType.Dropdown;
    facility.dropdownOptions = OPTIONS;

    const systems: IncidentCustomField = new IncidentCustomField();
    systems.name = "Systems";
    systems.customFieldType = CustomFieldType.MultiSelectDropdown;
    systems.dropdownOptions = OPTIONS;

    getListMock.mockResolvedValue({
      data: [facility, systems],
      count: 2,
      skip: 0,
      limit: 2,
    } as never);

    const incident: Incident = new Incident();
    incident.id = INCIDENT_ID;
    incident.customFields = customFields;
    getItemMock.mockResolvedValue(incident as never);

    render(
      <CustomFieldsDetail
        title="Custom Fields"
        description="Custom fields for this incident."
        modelType={Incident}
        customFieldType={IncidentCustomField}
        name="Incident Custom Fields"
        projectId={PROJECT_ID}
        modelId={INCIDENT_ID}
      />,
    );
  }

  test("shows a value no longer offered as itself, marked - not as 'No data entered'", async () => {
    renderCard({
      Facility: "Facility B",
      Systems: ["Facility A", "Old Site"],
    });

    expect(
      await screen.findByText("Facility B (no longer an option)"),
    ).toBeInTheDocument();
    expect(screen.queryByText("No data entered")).toBeNull();
    // The multi-select's entries: its option as it is, the other marked.
    expect(screen.getByText("Facility A")).toBeInTheDocument();
    expect(
      screen.getByText("Old Site (no longer an option)"),
    ).toBeInTheDocument();

    const badge: HTMLElement = screen
      .getByText("Facility B (no longer an option)")
      .closest('[data-dropdown-value-badge="true"]') as HTMLElement;

    expect(badge.getAttribute("data-dropdown-value-color")).toBe(
      CUSTOM_FIELD_NO_LONGER_AN_OPTION_COLOR,
    );
  });

  test("an option the field offers is shown as before, in its color", async () => {
    renderCard({ Facility: "Facility A" });

    const value: HTMLElement = await screen.findByText("Facility A");
    const badge: HTMLElement = value.closest(
      '[data-dropdown-value-badge="true"]',
    ) as HTMLElement;

    expect(badge.getAttribute("data-dropdown-value-color")).toBe("#ef4444");
    expect(screen.queryByText(/no longer an option/)).toBeNull();
  });

  test("its edit form keeps the value chosen, and saving another field keeps it", async () => {
    updateByIdMock.mockResolvedValue({} as never);

    renderCard({
      Facility: "Facility B",
      Systems: ["Facility A", "Old Site"],
      Untouched: "kept",
    });

    fireEvent.click(await screen.findByText("Edit Fields"));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    // The single select shows the value it holds, chosen.
    expect(
      within(dialog).getByText("Facility B (no longer an option)"),
    ).toBeInTheDocument();
    // So do the multi-select's chips.
    expect(
      within(dialog).getByText("Old Site (no longer an option)"),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Save"));

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(
      (
        (updateByIdMock.mock.calls[0]![0] as JSONObject)["data"] as JSONObject
      )["customFields"],
    ).toEqual({
      Facility: "Facility B",
      Systems: ["Facility A", "Old Site"],
      Untouched: "kept",
    });
  });
});
