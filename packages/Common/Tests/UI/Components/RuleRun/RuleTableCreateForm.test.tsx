import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Every rule starts on. A rule's create form leaves its Enabled switch out -
 * the rule is saved with its column's default of on, as the API saves it -
 * and its edit form keeps the switch, so a rule can still be turned off.
 *
 * The real RuleTable and ModelTable are rendered, with the API layer injected
 * through the modelAPI prop and the form dialog recorded: the assertion is
 * about which fields each dialog is handed.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [Permission.ProjectAdmin];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
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

type RecordedFormField = {
  title?: string | undefined;
  doNotShowWhenCreating?: boolean | undefined;
};

type RecordedModalProps = {
  formProps: {
    formType: unknown;
    fields: Array<RecordedFormField>;
  };
};

let recordedModalProps: Array<RecordedModalProps> = [];

jest.mock("../../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: RecordedModalProps): React.ReactElement => {
      recordedModalProps.push(props);
      return <div data-testid="model-form-modal" />;
    },
  };
});

import Permission from "../../../../Types/Permission";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import IncidentOnCallRule from "../../../../Models/DatabaseModels/IncidentOnCallRule";
import IncidentOwnerRule from "../../../../Models/DatabaseModels/IncidentOwnerRule";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import RuleTable from "../../../../UI/Components/RuleRun/RuleTable";
import LabelRuleTable from "../../../../UI/Components/LabelRule/LabelRuleTable";
import FieldType from "../../../../UI/Components/Types/FieldType";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import MonitorLabelRule from "../../../../Models/DatabaseModels/MonitorLabelRule";

const ROWS: Array<Record<string, unknown>> = [
  { _id: "rule-1", name: "Database incidents", isEnabled: true },
];

function makeModelAPI(): typeof ModelAPI {
  return {
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<IncidentOwnerRule>> => {
      return {
        data: ROWS as unknown as Array<IncidentOwnerRule>,
        count: ROWS.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    getItem: async (): Promise<null> => {
      return null;
    },
  } as unknown as typeof ModelAPI;
}

const FORM_FIELDS: Array<Record<string, unknown>> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
  },
  {
    field: { isEnabled: true },
    title: "Enabled",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    description: "Enable or disable this rule.",
  },
  {
    field: { notifyOwners: true },
    title: "Notify Owners",
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
  },
];

function tableProps(): Record<string, unknown> {
  return {
    modelAPI: makeModelAPI(),
    id: "owner-rules-create-form",
    name: "Settings > Owner Rules",
    singularName: "Owner Rule",
    pluralName: "Owner Rules",
    userPreferencesKey: "owner-rules-create-form",
    isCreateable: true,
    isEditable: true,
    isDeleteable: false,
    isViewable: false,
    cardProps: { title: "Owner Rules", description: "Rules" },
    filters: [],
    columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
    formFields: FORM_FIELDS,
  };
}

function buttonsStartingWith(label: string): Array<HTMLButtonElement> {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button: HTMLButtonElement): boolean => {
    return (button.textContent || "").trim().startsWith(label);
  });
}

function lastModal(): RecordedModalProps {
  return recordedModalProps[recordedModalProps.length - 1]!;
}

function fieldTitles(modal: RecordedModalProps): Array<string> {
  return modal.formProps.fields.map((field: RecordedFormField): string => {
    return field.title || "";
  });
}

async function openCreate(label: string): Promise<RecordedModalProps> {
  await waitFor(() => {
    expect(buttonsStartingWith(label).length).toBeGreaterThan(0);
  });

  fireEvent.click(buttonsStartingWith(label)[0]!);

  await waitFor(() => {
    expect(recordedModalProps.length).toBeGreaterThan(0);
  });

  return lastModal();
}

async function openEdit(): Promise<RecordedModalProps> {
  await waitFor(() => {
    expect(buttonsStartingWith("Edit").length).toBeGreaterThan(0);
  });

  fireEvent.click(buttonsStartingWith("Edit")[0]!);

  await waitFor(() => {
    expect(recordedModalProps.length).toBeGreaterThan(0);
  });

  return lastModal();
}

describe("a rule table's create form", () => {
  beforeEach(() => {
    recordedModalProps = [];
    PermissionGate.clearPermissionPropsCache();
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/settings/owner-rules",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("does not ask whether the rule is on: it starts on", async () => {
    render(
      <RuleTable<IncidentOwnerRule>
        {...(tableProps() as any)}
        modelType={IncidentOwnerRule}
      />,
    );

    const modal: RecordedModalProps = await openCreate("Create Owner Rule");

    expect(modal.formProps.formType).toBe(FormType.Create);
    expect(fieldTitles(modal)).toEqual(["Name", "Notify Owners"]);
  });

  test("keeps the switch on the edit form, so a rule can be turned off", async () => {
    /*
     * A rule that cannot be run, so Edit is the row's one action rather than
     * an item of its More menu.
     */
    render(
      <RuleTable<IncidentOnCallRule>
        {...(tableProps() as any)}
        modelType={IncidentOnCallRule}
        formFields={[
          FORM_FIELDS[0],
          FORM_FIELDS[1],
          {
            field: { description: true },
            title: "Description",
            fieldType: FormFieldSchemaType.LongText,
            required: false,
          },
        ]}
      />,
    );

    const modal: RecordedModalProps = await openEdit();

    expect(modal.formProps.formType).toBe(FormType.Update);
    expect(fieldTitles(modal)).toEqual(["Name", "Enabled", "Description"]);

    // And its create form, the same as every other rule's.
    cleanup();
    recordedModalProps = [];
    TableFilterUrlState.resetClaimedKeys();

    render(
      <RuleTable<IncidentOnCallRule>
        {...(tableProps() as any)}
        modelType={IncidentOnCallRule}
        formFields={[FORM_FIELDS[0], FORM_FIELDS[1]]}
      />,
    );

    expect(fieldTitles(await openCreate("Create Owner Rule"))).toEqual([
      "Name",
    ]);
  });

  test("does the same for a label rule table, which is built on it", async () => {
    render(
      <LabelRuleTable<MonitorLabelRule>
        {...(tableProps() as any)}
        modelType={MonitorLabelRule}
        singularName="Label Rule"
      />,
    );

    const modal: RecordedModalProps = await openCreate("Create Label Rule");

    expect(fieldTitles(modal)).not.toContain("Enabled");
  });
});
