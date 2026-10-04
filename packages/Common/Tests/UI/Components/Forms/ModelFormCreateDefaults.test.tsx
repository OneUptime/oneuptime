import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * A Create form starts from the model's own column defaults
 * (Forms/Utils/CreateFormDefaults).
 *
 * A rule created from its dashboard form used to be saved switched off - its
 * Enabled switch was drawn off and sent as off - while the API, sent nothing,
 * stored the column's default of on. "Notify Owners" did the same on every
 * owner rule. A checkbox did the opposite: drawn unticked, it was saved as
 * its column's default of on. Now what the form shows before anyone touches
 * it is what the server would store if the field were left out, and what it
 * shows is what it sends.
 *
 * Through the real ModelForm and BasicForm, with only the network stubbed.
 */

let capturedModels: Array<JSONObject> = [];
let recordToEdit: JSONObject = {};

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<JSONObject> => {
        return { ...recordToEdit };
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: async (data: {
        model: JSONObject;
      }): Promise<{ data: JSONObject }> => {
        capturedModels.push(data.model);
        return { data: data.model };
      },
    },
  };
});

import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import IncidentReminderRule from "../../../../Models/DatabaseModels/IncidentReminderRule";
import IncidentSlaRule from "../../../../Models/DatabaseModels/IncidentSlaRule";
import ProjectSCIM from "../../../../Models/DatabaseModels/ProjectSCIM";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ReminderStopState from "../../../../Types/Reminder/ReminderStopState";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import DropdownUtil from "../../../../UI/Utils/Dropdown";

const RULE_ID: ObjectID = new ObjectID("00000001-0000-4000-8000-000000000001");

const NAME_FIELD: ModelField<IncidentOwnerRule> = {
  field: { name: true },
  title: "Name",
  fieldType: FormFieldSchemaType.Text,
  required: true,
  placeholder: "Rule name",
};

// Both columns default to on; inheriting owners from monitors to off.
const ENABLED_FIELD: ModelField<IncidentOwnerRule> = {
  field: { isEnabled: true },
  title: "Enabled",
  fieldType: FormFieldSchemaType.Toggle,
  required: false,
};

const NOTIFY_OWNERS_FIELD: ModelField<IncidentOwnerRule> = {
  field: { notifyOwners: true },
  title: "Notify Owners",
  fieldType: FormFieldSchemaType.Toggle,
  required: false,
};

const INHERIT_FIELD: ModelField<IncidentOwnerRule> = {
  field: { inheritOwnersFromMonitors: true },
  title: "Inherit Owners From Monitors",
  fieldType: FormFieldSchemaType.Toggle,
  required: false,
};

async function renderForm<TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  fields: Array<ModelField<TBaseModel>>;
  formType?: FormType | undefined;
  initialValues?: FormValues<TBaseModel> | undefined;
}): Promise<void> {
  const formType: FormType = data.formType ?? FormType.Create;

  await act(async (): Promise<void> => {
    render(
      <ModelForm<TBaseModel>
        modelType={data.modelType}
        id="create-defaults-form"
        name="Create Defaults"
        fields={data.fields}
        formType={formType}
        modelIdToEdit={formType === FormType.Update ? RULE_ID : undefined}
        initialValues={data.initialValues}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />,
    );
  });

  // The form is drawn once its fields have arrived.
  await screen.findByRole("button", { name: "Save" });
}

async function typeName(): Promise<void> {
  fireEvent.change(await screen.findByPlaceholderText("Rule name"), {
    target: { value: "Assign the database team" },
  });
}

async function submit(): Promise<JSONObject> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function switchNamed(name: string): HTMLElement {
  return screen.getByRole("switch", { name: name });
}

afterEach(() => {
  cleanup();
  capturedModels = [];
  recordToEdit = {};
});

describe("a Create form's switches", () => {
  test("start where their columns do, and are sent that way untouched", async () => {
    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      fields: [NAME_FIELD, ENABLED_FIELD, NOTIFY_OWNERS_FIELD, INHERIT_FIELD],
    });

    // From the first paint, as the server would store them.
    expect(switchNamed("Enabled")).toHaveAttribute("aria-checked", "true");
    expect(switchNamed("Notify Owners")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(switchNamed("Inherit Owners From Monitors")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await typeName();
    const model: JSONObject = await submit();

    expect(model["isEnabled"]).toBe(true);
    expect(model["notifyOwners"]).toBe(true);
    expect(model["inheritOwnersFromMonitors"]).toBe(false);
  });

  test("can still be switched off, and are then sent off", async () => {
    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      fields: [NAME_FIELD, ENABLED_FIELD, NOTIFY_OWNERS_FIELD],
    });

    fireEvent.click(switchNamed("Notify Owners"));
    expect(switchNamed("Notify Owners")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await typeName();
    const model: JSONObject = await submit();

    expect(model["isEnabled"]).toBe(true);
    expect(model["notifyOwners"]).toBe(false);
  });

  test("keep a field's own default, off included", async () => {
    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      fields: [
        NAME_FIELD,
        { ...ENABLED_FIELD, defaultValue: false },
        {
          ...NOTIFY_OWNERS_FIELD,
          getDefaultValue: (): boolean => {
            return false;
          },
        },
        { ...INHERIT_FIELD, defaultValue: true },
      ],
    });

    expect(switchNamed("Enabled")).toHaveAttribute("aria-checked", "false");
    expect(switchNamed("Notify Owners")).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(switchNamed("Inherit Owners From Monitors")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await typeName();
    const model: JSONObject = await submit();

    expect(model["isEnabled"]).toBe(false);
    expect(model["notifyOwners"]).toBe(false);
    expect(model["inheritOwnersFromMonitors"]).toBe(true);
  });

  test("keep the values the form starts with", async () => {
    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      fields: [NAME_FIELD, ENABLED_FIELD, NOTIFY_OWNERS_FIELD],
      initialValues: { notifyOwners: false },
    });

    expect(switchNamed("Enabled")).toHaveAttribute("aria-checked", "true");
    expect(switchNamed("Notify Owners")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await typeName();
    const model: JSONObject = await submit();

    expect(model["isEnabled"]).toBe(true);
    expect(model["notifyOwners"]).toBe(false);
  });

  test("leave a field that writes no column of its own alone", async () => {
    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      fields: [
        NAME_FIELD,
        {
          overrideField: { isEnabled: true },
          overrideFieldKey: "enableAfterReview",
          title: "Enable After Review",
          fieldType: FormFieldSchemaType.Toggle,
          required: false,
        },
      ],
    });

    expect(switchNamed("Enable After Review")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("tick a checkbox whose column defaults to on - what was saved all along", async () => {
    await renderForm<ProjectSCIM>({
      modelType: ProjectSCIM,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Rule name",
        },
        {
          field: { autoProvisionUsers: true },
          title: "Auto Provision Users",
          fieldType: FormFieldSchemaType.Checkbox,
          required: false,
        },
        {
          field: { enablePushGroups: true },
          title: "Enable Push Groups",
          fieldType: FormFieldSchemaType.Checkbox,
          required: false,
        },
      ],
    });

    expect(
      screen.getByRole("checkbox", { name: /Auto Provision Users/ }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /Enable Push Groups/ }),
    ).not.toBeChecked();

    await typeName();
    const model: JSONObject = await submit();

    expect(model["autoProvisionUsers"]).toBe(true);
    // Never touched, off by its column: not sent, so the server's off stands.
    expect(model["enablePushGroups"]).toBeUndefined();
  });
});

describe("a Create form's choices and numbers", () => {
  const stopField: ModelField<IncidentReminderRule> = {
    field: { stopRemindersOnState: true },
    title: "Stop Reminders When",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: DropdownUtil.getDropdownOptionsFromEnum(ReminderStopState),
    required: false,
    placeholder: "Pick a state",
  };

  test("start a dropdown on its column's choice", async () => {
    await renderForm<IncidentReminderRule>({
      modelType: IncidentReminderRule,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Rule name",
        },
        stopField,
      ],
    });

    expect(screen.queryByText("Pick a state")).not.toBeInTheDocument();
    expect(screen.getByText(ReminderStopState.Resolved)).toBeInTheDocument();

    await typeName();
    const model: JSONObject = await submit();

    expect(model["stopRemindersOnState"]).toBe(ReminderStopState.Resolved);
  });

  test("leave a dropdown empty when its options do not hold the default", async () => {
    await renderForm<IncidentReminderRule>({
      modelType: IncidentReminderRule,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Rule name",
        },
        {
          ...stopField,
          dropdownOptions: [
            {
              label: ReminderStopState.Acknowledged,
              value: ReminderStopState.Acknowledged,
            },
          ],
        },
      ],
    });

    expect(screen.getByText("Pick a state")).toBeInTheDocument();

    await typeName();
    const model: JSONObject = await submit();

    expect(model["stopRemindersOnState"]).toBeUndefined();
  });

  test("start a number box on its column's number", async () => {
    await renderForm<IncidentSlaRule>({
      modelType: IncidentSlaRule,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Rule name",
        },
        {
          field: { atRiskThresholdInPercentage: true },
          title: "At Risk Threshold (%)",
          fieldType: FormFieldSchemaType.Number,
          required: false,
          placeholder: "Threshold",
        },
      ],
    });

    expect(screen.getByPlaceholderText("Threshold")).toHaveValue(80);

    await typeName();
    const model: JSONObject = await submit();

    expect(Number(model["atRiskThresholdInPercentage"])).toBe(80);
  });
});

describe("an Edit form", () => {
  test("shows the record as it is, never the column defaults", async () => {
    recordToEdit = {
      _id: RULE_ID.toString(),
      name: "Assign the database team",
      isEnabled: false,
    };

    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      formType: FormType.Update,
      fields: [NAME_FIELD, ENABLED_FIELD, NOTIFY_OWNERS_FIELD],
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Rule name")).toHaveValue(
        "Assign the database team",
      );
    });

    // Stored off: off. Not in the record at all: off, not the column's on.
    expect(switchNamed("Enabled")).toHaveAttribute("aria-checked", "false");
    expect(switchNamed("Notify Owners")).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("a folded More fields section", () => {
  test("does not show a switch nobody changed as set, and does once someone does", async () => {
    const advanced: ReturnType<typeof getAdvancedFormSection> =
      getAdvancedFormSection<IncidentOwnerRule>();

    await renderForm<IncidentOwnerRule>({
      modelType: IncidentOwnerRule,
      fields: [
        NAME_FIELD,
        { ...NOTIFY_OWNERS_FIELD, collapsibleSection: advanced },
      ],
    });

    const header: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    expect(header).toHaveAttribute("aria-expanded", "false");
    // Named on the header, not set: it is at the column's default.
    expect(
      within(header).getByTestId("folded-section-item"),
    ).toHaveAttribute("data-item-set", "false");
    expect(screen.queryByText("Configured")).not.toBeInTheDocument();

    // Open, switch it off, fold it again: now something is set.
    fireEvent.click(header);
    expect(switchNamed("Notify Owners")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(switchNamed("Notify Owners"));
    fireEvent.click(header);

    await waitFor(() => {
      expect(within(header).getByTestId("folded-section-item")).toHaveTextContent(
        "Notify Owners: Off",
      );
    });
    expect(within(header).getByTestId("folded-section-item")).toHaveAttribute(
      "data-item-set",
      "true",
    );
  });
});

describe("a reminder rule created without its Enabled switch", () => {
  /*
   * A reminder rule keeps whether it is on inside its criteria, and shows old
   * API pods a rule that is off (RuleCriteriaModelForm's safety shadow). Its
   * create form leaves the Enabled switch out, so the form has no value for
   * it at all: the rule must still start on.
   */
  test("starts on, inside its criteria too", async () => {
    await renderForm<IncidentReminderRule>({
      modelType: IncidentReminderRule,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "Rule name",
        },
        {
          field: { labels: true },
          title: "Labels",
          stepId: "match-criteria",
          fieldType: FormFieldSchemaType.MultiSelectDropdown,
          required: false,
        },
      ],
      initialValues: {
        criteria: {
          schemaVersion: 1,
          filterCondition: "All",
          filters: [],
        },
      } as FormValues<IncidentReminderRule>,
    });

    await typeName();
    const model: JSONObject = await submit();

    expect(model["criteria"]).toMatchObject({ isEnabled: true });
    // What old API pods read: off, so they leave the rule alone.
    expect(model["isEnabled"]).toBe(false);
  });
});
