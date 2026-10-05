import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE LABELS FIELD OF EVERY FORM, FOLDED UNDER ADVANCED.
 *
 * Labels group resources and decide what a team restricted to labels can
 * see; most projects never restrict a team that way. Some forty forms
 * walked a wizard step for the field - creating a host or renaming a status
 * page meant a Next for one optional field - and most of the rest showed it
 * open beside the name. Every form now asks with Dashboard
 * Utils/Form/LabelsFormField.ts's getLabelsFormField, and
 * LabelsFormFieldGuard holds the forms to it.
 *
 * Here the helper itself, then the field in the real ModelForm and
 * BasicForm, the way a create dialog and an edit dialog draw it:
 *
 *   - the field: what it saves, its words, and that it always folds;
 *   - closed Advanced header, nothing said while nothing is set, the help
 *     and the placeholder one click away;
 *   - "Configured" on the folded header once labels are there (a
 *     template's, or the record's own on Edit), still folded;
 *   - the picks saved as the real labels relation, folded or not;
 *   - a form of a name and labels walks no steps.
 */

let permissionsForTest: Array<unknown> = [];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: permissionsForTest };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
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

jest.mock("../../../UI/Utils/Translation", () => {
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

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: async (data: {
        limit: number;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        // Cross a task boundary, as a real request does.
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 0);
        });

        // eslint-disable-next-line @typescript-eslint/no-use-before-define
        const rows: Array<unknown> = labelRows();

        return { data: rows, count: rows.length, skip: 0, limit: data.limit };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      createOrUpdate: (...args: Array<unknown>) => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (err: unknown): string => {
        return (err as { message?: string })?.message || "Server Error";
      },
    },
  };
});

import {
  LABELS_FORM_FIELD_DESCRIPTION,
  getLabelsFormField,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/LabelsFormField";
import ModelForm, { FormType } from "../../../UI/Components/Forms/ModelForm";
import Field, {
  FormFieldCollapsibleSection,
} from "../../../UI/Components/Forms/Types/Field";
import Fields from "../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import {
  ADVANCED_FORM_SECTION_ID,
  MORE_FIELDS_SECTION_TITLE,
  getAdvancedFormSection,
  isFormFieldValueSet,
  isFormSectionConfigured,
} from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Label from "../../../Models/DatabaseModels/Label";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  hasSetChip,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const TEMPLATE_ID: ObjectID = new ObjectID(
  "0193c0de-0000-4aaa-8bbb-000000000100",
);
const PRODUCTION_ID: string = "0193c0de-0000-4aaa-8bbb-000000000101";
const PAYMENTS_ID: string = "0193c0de-0000-4aaa-8bbb-000000000102";

function label(id: string, name: string): Label {
  const row: Label = new Label();
  row._id = id;
  row.name = name;
  return row;
}

function labelRows(): Array<Label> {
  return [label(PRODUCTION_ID, "production"), label(PAYMENTS_ID, "payments")];
}

const NAME_FIELD: Field<IncidentTemplate> = {
  field: { templateName: true },
  title: "Template Name",
  fieldType: FormFieldSchemaType.Text,
  required: true,
  placeholder: "Template Name",
};

function nameAndLabels(): Fields<IncidentTemplate> {
  return [NAME_FIELD, getLabelsFormField<IncidentTemplate>()];
}

async function renderForm(data: {
  formType: FormType;
  initialValues?: Record<string, unknown> | undefined;
}): Promise<void> {
  const submitText: string =
    data.formType === FormType.Create ? "Create Template" : "Save Changes";

  await act(async (): Promise<void> => {
    render(
      <ModelForm<IncidentTemplate>
        modelType={IncidentTemplate}
        name="Incident Template"
        id="labels-form"
        formType={data.formType}
        submitButtonText={submitText}
        onSuccess={() => {}}
        fields={nameAndLabels()}
        initialValues={data.initialValues as never}
        modelIdToEdit={
          data.formType === FormType.Update ? TEMPLATE_ID : undefined
        }
      />,
    );
  });

  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: submitText }),
    ).toBeInTheDocument();
  });

  /*
   * The footer draws before the fields: wait for the form's own rows, the
   * name and the folded section, so nothing below races them under load.
   */
  await screen.findByPlaceholderText("Template Name");
  await screen.findByRole("button", { name: MORE_FIELDS_SECTION_TITLE });
}

function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: MORE_FIELDS_SECTION_TITLE });
}

function labelsInput(): HTMLElement {
  return screen.getByRole("combobox", { name: /^Labels/, hidden: true });
}

describe("getLabelsFormField", () => {
  test("asks for the labels relation with the Label dropdown, never required", () => {
    const field: Field<IncidentTemplate> =
      getLabelsFormField<IncidentTemplate>();

    expect(field.field).toEqual({ labels: true });
    expect(field.title).toBe("Labels");
    expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(field.dropdownModal).toEqual({
      type: Label,
      labelField: "name",
      valueField: "_id",
    });
    expect(field.required).toBe(false);
    expect(field.placeholder).toBe("Select labels");
    // A real column, so ModelForm saves the join rows: no override key.
    expect(field.overrideFieldKey).toBeUndefined();
    expect(field.stepId).toBeUndefined();
  });

  test("says what labels do, in one sentence every form shares", () => {
    expect(getLabelsFormField<IncidentTemplate>().description).toBe(
      LABELS_FORM_FIELD_DESCRIPTION,
    );
    expect(LABELS_FORM_FIELD_DESCRIPTION).toBe(
      "Labels group related resources so you can filter by them. A team whose permissions are restricted to labels only sees resources that carry one of its labels.",
    );
    // The old help, which the folded section now says by itself.
    expect(LABELS_FORM_FIELD_DESCRIPTION).not.toContain("optional");
    expect(LABELS_FORM_FIELD_DESCRIPTION).not.toContain("advanced");
  });

  test("folds under a More fields section of its own, closed even on Edit", () => {
    const section: FormFieldCollapsibleSection<IncidentTemplate> | undefined =
      getLabelsFormField<IncidentTemplate>().collapsibleSection;

    expect(section).toEqual(getAdvancedFormSection<IncidentTemplate>());
    expect(section?.id).toBe(ADVANCED_FORM_SECTION_ID);
    expect(section?.title).toBe(MORE_FIELDS_SECTION_TITLE);
    expect(section?.openWhenConfigured).toBe(false);
    // Folded, its header names the labels field, and how many are picked.
    expect(section?.listFieldsWhileFolded).toBe(true);
  });

  test("folds into the form's own Advanced section when handed one, as that very section", () => {
    const advanced: FormFieldCollapsibleSection<IncidentTemplate> =
      getAdvancedFormSection<IncidentTemplate>();

    expect(
      getLabelsFormField<IncidentTemplate>({ collapsibleSection: advanced })
        .collapsibleSection,
    ).toBe(advanced);
  });

  test("keeps what the form says about where and when the field shows", () => {
    const showIf: (values: FormValues<IncidentTemplate>) => boolean = (
      values: FormValues<IncidentTemplate>,
    ): boolean => {
      return Boolean(values.templateName);
    };
    const field: Field<IncidentTemplate> = getLabelsFormField<IncidentTemplate>(
      {
        stepId: "incident-details",
        description:
          "Incidents declared from this template start with these labels.",
        showIf: showIf,
        doNotShowWhenEditing: true,
      },
    );

    expect(field.stepId).toBe("incident-details");
    expect(field.description).toBe(
      "Incidents declared from this template start with these labels.",
    );
    expect(field.showIf).toBe(showIf);
    expect(field.doNotShowWhenEditing).toBe(true);
  });

  test("its options type rules out an open field, another column and a required one", () => {
    /*
     * Checked by the compiler (npm run compile-tests): each line must stay
     * an error, or the directive above it is reported as unused.
     */
    const unsetSection: { collapsibleSection: undefined } = {
      collapsibleSection: undefined,
    };
    const anotherColumn: { field: { name: true } } = { field: { name: true } };
    const required: { required: true } = { required: true };

    const attempts: Array<() => Field<IncidentTemplate>> = [
      () => {
        // @ts-expect-error - the section can be handed over, never unset.
        return getLabelsFormField<IncidentTemplate>(unsetSection);
      },
      () => {
        // @ts-expect-error - the field always saves the labels relation.
        return getLabelsFormField<IncidentTemplate>(anotherColumn);
      },
      () => {
        // @ts-expect-error - and labels are never required.
        return getLabelsFormField<IncidentTemplate>(required);
      },
    ];

    for (const attempt of attempts) {
      // At run time an explicit undefined section still folds.
      expect(attempt().collapsibleSection?.id).toBe(ADVANCED_FORM_SECTION_ID);
      expect(attempt().required).toBe(false);
    }
  });

  test("never lets a caller change what the field saves or how it asks", () => {
    // Ruled out by its options type; checked at run time as well.
    const field: Field<IncidentTemplate> = getLabelsFormField<IncidentTemplate>(
      {
        field: { name: true },
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "Pick",
        title: "Tags",
      } as never,
    );

    expect(field.field).toEqual({ labels: true });
    expect(field.fieldType).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(field.required).toBe(false);
    expect(field.placeholder).toBe("Select labels");
    expect(field.title).toBe("Labels");
  });

  test("makes the section say Configured exactly when labels are picked", () => {
    const field: Field<IncidentTemplate> =
      getLabelsFormField<IncidentTemplate>();
    const configured: (values: FormValues<IncidentTemplate>) => boolean = (
      values: FormValues<IncidentTemplate>,
    ): boolean => {
      return isFormSectionConfigured<IncidentTemplate>({
        section: field.collapsibleSection!,
        fields: [field],
        values: values,
      });
    };

    expect(configured({})).toBe(false);
    expect(configured({ labels: [] } as never)).toBe(false);
    expect(configured({ labels: [PRODUCTION_ID] } as never)).toBe(true);
    expect(
      isFormFieldValueSet<IncidentTemplate>(field, {
        labels: [{ label: "production", value: PRODUCTION_ID }],
      } as never),
    ).toBe(true);
  });
});

describe("the Labels field in a real form", () => {
  beforeEach(() => {
    permissionsForTest = [Permission.ProjectOwner];
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockImplementation(async () => {
      return { data: new IncidentTemplate(), miscData: {} };
    });
  });

  afterEach(() => {
    cleanup();
  });

  test("waits, folded and quiet, under a closed Advanced header", async () => {
    await renderForm({ formType: FormType.Create });

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader())).toEqual([]);
    expect(labelsInput()).not.toBeVisible();
    expect(screen.getByText(LABELS_FORM_FIELD_DESCRIPTION)).not.toBeVisible();

    // A name and the labels: one page, so no steps and no Next.
    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Next" }),
    ).not.toBeInTheDocument();
  });

  test("opens on one click, with its help and its placeholder", async () => {
    await renderForm({ formType: FormType.Create });

    fireEvent.click(advancedHeader());

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "true");
    expect(labelsInput()).toBeVisible();
    expect(screen.getByText(LABELS_FORM_FIELD_DESCRIPTION)).toBeVisible();
    expect(labelsInput()).toHaveAttribute("placeholder", "Select labels");
  });

  test("says Configured, still folded, when the form starts with labels (a template's)", async () => {
    await renderForm({
      formType: FormType.Create,
      initialValues: { labels: [PRODUCTION_ID] },
    });

    await waitFor(() => {
      expect(hasSetChip(advancedHeader())).toBe(true);
    });
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(labelsInput()).not.toBeVisible();
  });

  test("saves folded labels as the labels relation", async () => {
    await renderForm({
      formType: FormType.Create,
      initialValues: { labels: [PRODUCTION_ID, PAYMENTS_ID] },
    });

    fireEvent.change(screen.getByPlaceholderText("Template Name"), {
      target: { value: "Database outage" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Create Template" }));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: {
      model: IncidentTemplate;
      miscDataProps: Record<string, unknown>;
    } = createOrUpdateMock.mock.calls[0]![0] as never;

    expect(request.model.templateName).toBe("Database outage");
    expect(
      (request.model.labels || []).map((saved: Label): string => {
        return saved.id!.toString();
      }),
    ).toEqual([PRODUCTION_ID, PAYMENTS_ID]);
    // A column of the model, so it is never sent as misc data.
    expect(request.miscDataProps["labels"]).toBeUndefined();
  });

  test("creates with no labels when none are picked", async () => {
    await renderForm({ formType: FormType.Create });

    fireEvent.change(screen.getByPlaceholderText("Template Name"), {
      target: { value: "Database outage" },
    });

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: "Create Template" }));
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const request: { model: IncidentTemplate } = createOrUpdateMock.mock
      .calls[0]![0] as never;

    expect(request.model.labels || []).toEqual([]);
  });

  test("on Edit, a record with labels reads Configured and stays folded", async () => {
    getItemMock.mockImplementation(async () => {
      return BaseModel.fromJSON(
        {
          _id: TEMPLATE_ID.toString(),
          templateName: "Database outage",
          labels: [{ _id: PRODUCTION_ID, name: "production" }],
        },
        IncidentTemplate,
      );
    });

    await renderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Template Name")).toHaveValue(
        "Database outage",
      );
    });
    await waitFor(() => {
      expect(hasSetChip(advancedHeader())).toBe(true);
    });
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
  });

  test("on Edit, a record without labels says nothing on the header", async () => {
    getItemMock.mockImplementation(async () => {
      return BaseModel.fromJSON(
        {
          _id: TEMPLATE_ID.toString(),
          templateName: "Database outage",
          labels: [],
        },
        IncidentTemplate,
      );
    });

    await renderForm({ formType: FormType.Update });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Template Name")).toHaveValue(
        "Database outage",
      );
    });
    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(advancedHeader())).toEqual([]);
  });
});
