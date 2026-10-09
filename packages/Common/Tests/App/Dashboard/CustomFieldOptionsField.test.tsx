import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Dropdown Options field every custom field settings page uses (#4564),
 * and the two table hooks it needs on Edit:
 *
 *   - it is shown for a dropdown type - from the form's own Field Type on
 *     Create, and on Edit, where the form cannot read the type (nobody may
 *     change it), from the row the table's Edit button was pressed on;
 *   - it refuses two options of the same name;
 *   - on Edit it is the option editor with counts, asked of
 *     /<definition route>/:id/option-usage; on Create a plain list;
 *   - the renames of the open edit - and only of it - go with the save.
 */

const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): JSONObject => {
        return { tenantid: "project-1" };
      },
    },
  };
});

import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import {
  CustomFieldOptionUsage,
  CustomFieldRecordName,
} from "../../../Types/CustomField/CustomFieldOptionEdit";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  CUSTOM_FIELD_DUPLICATE_OPTION_MESSAGE,
  CustomFieldOptionsFormField,
  getDuplicateOptionProblem,
  isDropdownCustomFieldType,
  useCustomFieldOptionsFormField,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldOptionsField";
import { fetchCustomFieldOptionUsage } from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldOptionUsage";
import {
  CUSTOM_FIELD_RECORD_NAMES,
  CustomFieldFormCopy,
  getCustomFieldRecordName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";

const FIELD_ID: string = "33333333-3333-4333-8333-333333333333";

const USAGE: JSONObject = {
  values: [{ value: "Facility A", count: 12 }],
  copiedBy: [],
};

beforeEach(() => {
  apiPostMock
    .mockReset()
    .mockResolvedValue(new HTTPResponse(200, USAGE, {}) as never);
});

afterEach(() => {
  cleanup();
});

function hook(
  modelType: { new (): BaseModel } = IncidentCustomField,
): CustomFieldOptionsFormField<BaseModel> {
  return renderHook(() => {
    return useCustomFieldOptionsFormField<BaseModel>({
      modelType: modelType,
    });
  }).result.current;
}

function values(data: JSONObject): FormValues<BaseModel> {
  return data as FormValues<BaseModel>;
}

describe("isDropdownCustomFieldType and getDuplicateOptionProblem", () => {
  test("a dropdown is a single or multi-select, nothing else", () => {
    expect(isDropdownCustomFieldType(CustomFieldType.Dropdown)).toBe(true);
    expect(isDropdownCustomFieldType(CustomFieldType.MultiSelectDropdown)).toBe(
      true,
    );

    for (const type of [CustomFieldType.Text, "Dropdown ", undefined, null]) {
      expect(isDropdownCustomFieldType(type)).toBe(false);
    }
  });

  test("an option list naming one option twice is refused, naming it", () => {
    expect(getDuplicateOptionProblem("Low\nHigh\n Low")).toBe(
      'Each option needs its own name: "Low" is listed more than once.',
    );
    expect(
      getDuplicateOptionProblem(
        JSON.stringify([{ value: "Red", color: "#ef4444" }, { value: "Red " }]),
      ),
    ).toBe('Each option needs its own name: "Red" is listed more than once.');
    expect(CUSTOM_FIELD_DUPLICATE_OPTION_MESSAGE).toContain("{{option}}");
  });

  test("a list of different options, or none, is fine", () => {
    for (const list of ["Low\nHigh", "", undefined, "low\nLow"]) {
      expect(getDuplicateOptionProblem(list)).toBeNull();
    }
  });
});

describe("the Dropdown Options field", () => {
  test("is the options column, as a custom component, with the editor's description", () => {
    const field: ModelField<BaseModel> = hook().formField;

    expect(field.field).toEqual({ dropdownOptions: true });
    expect(field.title).toBe("Dropdown Options");
    expect(field.description).toBe(
      CustomFieldFormCopy.dropdownOptionsDescription,
    );
    expect(field.fieldType).toBe(FormFieldSchemaType.CustomComponent);
  });

  test("on Create, is shown and required under a dropdown type the form holds", () => {
    const field: ModelField<BaseModel> = hook().formField;
    const showIf: (item: FormValues<BaseModel>) => boolean = field.showIf!;
    const required: (item: FormValues<BaseModel>) => boolean =
      field.required as (item: FormValues<BaseModel>) => boolean;

    for (const type of [
      CustomFieldType.Dropdown,
      CustomFieldType.MultiSelectDropdown,
    ]) {
      expect(showIf(values({ customFieldType: type }))).toBe(true);
      expect(required(values({ customFieldType: type }))).toBe(true);
    }

    expect(showIf(values({ customFieldType: CustomFieldType.Text }))).toBe(
      false,
    );
    expect(showIf(values({}))).toBe(false);
    expect(required(values({}))).toBe(false);
  });

  test("on Edit, where the form cannot read the type, the row the Edit button was pressed on says it", async () => {
    const options: CustomFieldOptionsFormField<BaseModel> = hook();
    const showIf: (item: FormValues<BaseModel>) => boolean =
      options.formField.showIf!;

    // Before the row has said anything, the form has nothing to go on.
    expect(showIf(values({ _id: FIELD_ID }))).toBe(false);

    await options.onBeforeEdit(
      Object.assign(new IncidentCustomField(), {
        _id: FIELD_ID,
        customFieldType: CustomFieldType.MultiSelectDropdown,
      }),
    );

    expect(showIf(values({ _id: FIELD_ID }))).toBe(true);
    expect(showIf(values({ _id: new ObjectID(FIELD_ID) }))).toBe(true);
    // Another field's form is not this one.
    expect(
      showIf(values({ _id: "44444444-4444-4444-8444-444444444444" })),
    ).toBe(false);

    await options.onBeforeEdit(
      Object.assign(new IncidentCustomField(), {
        _id: "55555555-5555-4555-8555-555555555555",
        customFieldType: CustomFieldType.Number,
      }),
    );

    expect(
      showIf(values({ _id: "55555555-5555-4555-8555-555555555555" })),
    ).toBe(false);
  });

  test("refuses two options of the same name - for a dropdown only", () => {
    const validate: (item: FormValues<BaseModel>) => string | null =
      hook().formField.customValidation!;

    expect(
      validate(
        values({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nLow",
        }),
      ),
    ).toBe('Each option needs its own name: "Low" is listed more than once.');

    expect(
      validate(
        values({
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "Low\nHigh",
        }),
      ),
    ).toBeNull();

    // A field switched away from a dropdown on Create keeps no options to check.
    expect(
      validate(
        values({
          customFieldType: CustomFieldType.Text,
          dropdownOptions: "Low\nLow",
        }),
      ),
    ).toBeNull();
  });

  test("on Create it is a plain list, and asks for no counts", () => {
    const field: ModelField<BaseModel> = hook().formField;

    render(
      field.getCustomElement!(values({}), {
        initialValue: "Low\nHigh",
        onChange: jest.fn(),
      }) as ReactElement,
    );

    expect(
      (screen.getByTestId("dropdown-option-value-1") as HTMLInputElement).value,
    ).toBe("High");
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  test("on Edit it asks how many records hold each value, and the renames go with the save", async () => {
    const options: CustomFieldOptionsFormField<BaseModel> = hook();

    await options.onBeforeEdit(
      Object.assign(new IncidentCustomField(), {
        _id: FIELD_ID,
        customFieldType: CustomFieldType.Dropdown,
      }),
    );

    const onChange: MockFunction = getJestMockFunction();

    render(
      options.formField.getCustomElement!(values({ _id: FIELD_ID }), {
        initialValue: "Facility A\nFacility B",
        onChange: onChange as never,
      }) as ReactElement,
    );

    // Nothing renamed yet.
    expect(screen.queryByTestId("dropdown-option-renamed-0")).toBeNull();

    // The counts are asked of this field's route, once.
    await waitFor(() => {
      expect(apiPostMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(screen.getByTestId("dropdown-option-value-0"), {
      target: { value: "Facility Alpha" },
    });

    expect(
      await screen.findByText(
        'Renamed from "Facility A": 12 incidents will show the new name.',
      ),
    ).toBeVisible();

    const miscDataProps: JSONObject = {};
    const item: BaseModel = new IncidentCustomField();

    expect(await options.onBeforeUpdate(item, miscDataProps, {})).toBe(item);
    expect(miscDataProps).toEqual({
      renamedDropdownOptions: [{ from: "Facility A", to: "Facility Alpha" }],
    });
  });

  test("a new edit starts with no renames: an earlier edit's are never sent", async () => {
    const options: CustomFieldOptionsFormField<BaseModel> = hook();

    await options.onBeforeEdit(
      Object.assign(new IncidentCustomField(), {
        _id: FIELD_ID,
        customFieldType: CustomFieldType.Dropdown,
      }),
    );

    render(
      options.formField.getCustomElement!(values({ _id: FIELD_ID }), {
        initialValue: "Facility A",
        onChange: jest.fn(),
      }) as ReactElement,
    );

    fireEvent.change(screen.getByTestId("dropdown-option-value-0"), {
      target: { value: "Facility Alpha" },
    });

    await screen.findByTestId("dropdown-option-renamed-0");

    // The edit is closed without saving; another opens.
    await options.onBeforeEdit(
      Object.assign(new IncidentCustomField(), {
        _id: "55555555-5555-4555-8555-555555555555",
        customFieldType: CustomFieldType.Dropdown,
      }),
    );

    const miscDataProps: JSONObject = {};
    await options.onBeforeUpdate(new IncidentCustomField(), miscDataProps, {});

    expect(miscDataProps).toEqual({});
  });
});

describe("fetchCustomFieldOptionUsage", () => {
  test("asks the definition's route for the field, with the tenant header", async () => {
    const usage: CustomFieldOptionUsage = await fetchCustomFieldOptionUsage({
      modelType: MonitorCustomField,
      fieldId: new ObjectID(FIELD_ID),
    });

    expect(usage).toEqual(USAGE);

    const request: {
      url: { toString: () => string };
      headers: JSONObject;
      data: JSONObject;
    } = apiPostMock.mock.calls[0]![0] as {
      url: { toString: () => string };
      headers: JSONObject;
      data: JSONObject;
    };

    expect(request.url.toString()).toMatch(
      new RegExp(`/monitor-custom-field/${FIELD_ID}/option-usage$`),
    );
    expect(request.headers).toEqual({ tenantid: "project-1" });
    expect(request.data).toEqual({});
  });

  test("a refused request is thrown, for the editor to do without counts", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      403,
      { message: "No" },
      {},
    );
    apiPostMock.mockReset().mockResolvedValue(refusal as never);

    await expect(
      fetchCustomFieldOptionUsage({
        modelType: IncidentCustomField,
        fieldId: new ObjectID(FIELD_ID),
      }),
    ).rejects.toBe(refusal);
  });

  test("a malformed answer is read as no counts, not trusted", async () => {
    apiPostMock
      .mockReset()
      .mockResolvedValue(
        new HTTPResponse(200, { values: "lots", copiedBy: null }, {}) as never,
      );

    expect(
      await fetchCustomFieldOptionUsage({
        modelType: IncidentCustomField,
        fieldId: new ObjectID(FIELD_ID),
      }),
    ).toEqual({ values: [], copiedBy: [] });
  });
});

describe("what each resource's records are called", () => {
  test("every custom field definition table has its records' names", () => {
    const expected: Array<[{ new (): BaseModel }, CustomFieldRecordName]> = [
      [IncidentCustomField, { singular: "Incident", plural: "Incidents" }],
      [AlertCustomField, { singular: "Alert", plural: "Alerts" }],
      [MonitorCustomField, { singular: "Monitor", plural: "Monitors" }],
      [
        ScheduledMaintenanceCustomField,
        {
          singular: "Scheduled Maintenance Event",
          plural: "Scheduled Maintenance Events",
        },
      ],
      [
        StatusPageCustomField,
        { singular: "Status Page", plural: "Status Pages" },
      ],
      [
        OnCallDutyPolicyCustomField,
        { singular: "On-Call Policy", plural: "On-Call Policies" },
      ],
      [TeamCustomField, { singular: "Team", plural: "Teams" }],
      [
        TeamMemberCustomField,
        { singular: "Team Member", plural: "Team Members" },
      ],
      [
        InventoryItemCustomField,
        { singular: "Inventory Item", plural: "Inventory Items" },
      ],
    ];

    for (const [modelType, name] of expected) {
      expect(getCustomFieldRecordName(new modelType().tableName!)).toEqual(
        name,
      );
    }

    expect(Object.keys(CUSTOM_FIELD_RECORD_NAMES)).toHaveLength(
      expected.length,
    );
  });

  test("anything else has none", () => {
    expect(getCustomFieldRecordName("Incident")).toBeUndefined();
    expect(getCustomFieldRecordName("constructor")).toBeUndefined();
    expect(getCustomFieldRecordName(undefined)).toBeUndefined();
  });
});
