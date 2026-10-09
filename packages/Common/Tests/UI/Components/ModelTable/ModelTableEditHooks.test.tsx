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
 * The two hooks a page has around a row's Edit form: onBeforeEdit, run on
 * the row before the form opens, and onBeforeUpdate, run by the form just
 * before it saves, with the misc data the request carries. A custom field's
 * settings page uses both (#4564): the first tells the form the field's type
 * - which the form cannot read, nobody may change it - and the second sends
 * the renames of the field's options with the save.
 *
 * The real ModelTable is rendered, with its API layer injected and its form
 * modal recorded, as ModelTableCreateAfterEdit does.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectAdmin"];
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

type RecordedModalProps = {
  title: string;
  modelIdToEdit?: unknown;
  onBeforeUpdate?: unknown;
  onBeforeCreate?: unknown;
  formProps: {
    formType: unknown;
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

import ModelTable from "../../../../UI/Components/ModelTable/ModelTable";
import { FormType } from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "../../../../UI/Components/Types/FieldType";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import ModelAPI from "../../../../UI/Utils/ModelAPI/ModelAPI";
import IncidentCustomField from "../../../../Models/DatabaseModels/IncidentCustomField";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";

const ROWS: Array<Record<string, string>> = [
  {
    _id: "11111111-1111-4111-8111-111111111111",
    name: "Facility",
    customFieldType: CustomFieldType.Dropdown,
  },
];

function makeModelAPI(): typeof ModelAPI {
  return {
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<IncidentCustomField>> => {
      return {
        data: ROWS.map((row: Record<string, string>) => {
          return Object.assign(new IncidentCustomField(), row);
        }),
        count: ROWS.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    getItem: async (): Promise<null> => {
      return null;
    },
  } as unknown as typeof ModelAPI;
}

type OnBeforeEdit = (item: IncidentCustomField) => Promise<IncidentCustomField>;
type OnBeforeUpdate = (
  item: IncidentCustomField,
  miscDataProps: JSONObject,
  formValues: JSONObject,
) => Promise<IncidentCustomField>;

function renderTable(hooks: {
  onBeforeEdit?: OnBeforeEdit;
  onBeforeUpdate?: OnBeforeUpdate;
}): void {
  render(
    <ModelTable<IncidentCustomField>
      modelType={IncidentCustomField}
      modelAPI={makeModelAPI()}
      id="incident-custom-fields-edit-hooks"
      name="Incident Custom Fields"
      singularName="Incident Custom Field"
      pluralName="Incident Custom Fields"
      userPreferencesKey="incident-custom-fields-edit-hooks"
      isCreateable={true}
      isEditable={true}
      isDeleteable={false}
      isViewable={false}
      cardProps={{ title: "Incident Custom Fields", description: "Fields" }}
      filters={[]}
      columns={[
        {
          field: { name: true },
          title: "Field Name",
          type: FieldType.Text,
        },
      ]}
      formFields={[
        {
          field: { name: true },
          title: "Field Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
      {...(hooks.onBeforeEdit ? { onBeforeEdit: hooks.onBeforeEdit } : {})}
      {...(hooks.onBeforeUpdate ? { onBeforeUpdate: hooks.onBeforeUpdate } : {})}
    />,
  );
}

function buttons(label: string): Array<HTMLButtonElement> {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button: HTMLButtonElement) => {
    return (button.textContent || "").trim().startsWith(label);
  });
}

function lastModal(): RecordedModalProps {
  return recordedModalProps[
    recordedModalProps.length - 1
  ] as RecordedModalProps;
}

beforeEach(() => {
  recordedModalProps = [];
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(
    window.history.state,
    "",
    "/dashboard/incident-custom-fields",
  );
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a row's Edit form", () => {
  test("runs onBeforeEdit on the row before it opens, and hands the form onBeforeUpdate", async () => {
    const seen: Array<IncidentCustomField> = [];
    const onBeforeEdit: OnBeforeEdit = async (
      item: IncidentCustomField,
    ): Promise<IncidentCustomField> => {
      seen.push(item);
      return item;
    };
    const onBeforeUpdate: OnBeforeUpdate = async (
      item: IncidentCustomField,
    ): Promise<IncidentCustomField> => {
      return item;
    };

    renderTable({ onBeforeEdit, onBeforeUpdate });

    await waitFor(() => {
      expect(buttons("Edit").length).toBeGreaterThan(0);
    });

    fireEvent.click(buttons("Edit")[0]!);

    await waitFor(() => {
      expect(recordedModalProps.length).toBeGreaterThan(0);
    });

    // The row it was pressed on, with the type the form cannot read.
    expect(seen).toHaveLength(1);
    expect(seen[0]!._id).toBe(ROWS[0]!["_id"]);
    expect(seen[0]!.customFieldType).toBe(CustomFieldType.Dropdown);

    const modal: RecordedModalProps = lastModal();

    expect(modal.formProps.formType).toBe(FormType.Update);
    expect(modal.onBeforeUpdate).toBe(onBeforeUpdate);
  });

  test("a Create form opens as before: ModelForm runs the update hook on an Edit form's save only", async () => {
    const onBeforeUpdate: OnBeforeUpdate = async (
      item: IncidentCustomField,
    ): Promise<IncidentCustomField> => {
      return item;
    };

    renderTable({ onBeforeUpdate });

    await waitFor(() => {
      expect(buttons("Create").length).toBeGreaterThan(0);
    });

    fireEvent.click(buttons("Create")[0]!);

    await waitFor(() => {
      expect(recordedModalProps.length).toBeGreaterThan(0);
    });

    const modal: RecordedModalProps = lastModal();

    expect(modal.formProps.formType).toBe(FormType.Create);
    expect(typeof modal.onBeforeCreate).toBe("function");
    expect(modal.modelIdToEdit).toBeUndefined();
  });

  test("a table without the hooks opens its Edit form as before", async () => {
    renderTable({});

    await waitFor(() => {
      expect(buttons("Edit").length).toBeGreaterThan(0);
    });

    fireEvent.click(buttons("Edit")[0]!);

    await waitFor(() => {
      expect(recordedModalProps.length).toBeGreaterThan(0);
    });

    expect(lastModal().formProps.formType).toBe(FormType.Update);
    expect(lastModal().onBeforeUpdate).toBeUndefined();
  });
});
