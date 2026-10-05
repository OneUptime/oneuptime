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
import {
  colorOf,
  getCheckedSwatch,
  getColorField,
  getSwatch,
  typeColorCode,
} from "../ColorPicker/ColorPickerDriver";

/*
 * A colour the record cannot be saved without starts picked
 * (Forms/Utils/CreateFormDefaults, getCreateFormColorDefault).
 *
 * Settings > Labels, the state, severity and monitor status pages, Incident
 * Roles and a status page's bar colour rules each opened their Create form on
 * an empty colour picker, and Create refused to save until a colour was
 * chosen. Now the form opens with a colour already picked - one the records
 * listed beside it do not use yet - ticked among the swatches from the first
 * paint, sent as the Color it stands for when nobody touches it, and changed
 * like any other value. Edit forms show the record as it is.
 *
 * Through the real ModelForm, BasicForm and ColorPicker, with only the
 * network stubbed.
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

import Label from "../../../../Models/DatabaseModels/Label";
import Service from "../../../../Models/DatabaseModels/Service";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  Amber600,
  Green,
  Indigo500,
  Red,
  Teal600,
  Yellow,
} from "../../../../Types/BrandColors";
import Color from "../../../../Types/Color";
import ModelForm, {
  FormType,
  ModelField,
} from "../../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "../../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { areSimilarColors } from "../../../../Utils/DistinctColor";

const RECORD_ID: ObjectID = new ObjectID(
  "00000001-0000-4000-8000-0000000000c0",
);

const COLOR_PLACEHOLDER: string = "Please select color for this label.";

const NAME_FIELD: ModelField<Label> = {
  field: { name: true },
  title: "Name",
  fieldType: FormFieldSchemaType.Text,
  required: true,
  placeholder: "internal-service",
};

// As Settings > Labels writes it.
const COLOR_FIELD: ModelField<Label> = {
  field: { color: true },
  title: "Label Color",
  fieldType: FormFieldSchemaType.Color,
  required: true,
  placeholder: COLOR_PLACEHOLDER,
};

function labelWithColor(color: string | Color): Label {
  const label: Label = new Label();
  label.name = `label ${String(color)}`;
  label.color = color instanceof Color ? color : new Color(color);
  return label;
}

interface RenderedForm {
  rerender: (data: {
    fields?: Array<ModelField<BaseModel>>;
    existingItems?: Array<BaseModel>;
  }) => Promise<void>;
}

async function renderForm<TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  fields: Array<ModelField<TBaseModel>>;
  formType?: FormType | undefined;
  initialValues?: FormValues<TBaseModel> | undefined;
  existingItems?: Array<TBaseModel> | undefined;
}): Promise<RenderedForm> {
  const formType: FormType = data.formType ?? FormType.Create;

  const element: (props: {
    fields: Array<ModelField<TBaseModel>>;
    existingItems?: Array<TBaseModel> | undefined;
  }) => React.ReactElement = (props: {
    fields: Array<ModelField<TBaseModel>>;
    existingItems?: Array<TBaseModel> | undefined;
  }): React.ReactElement => {
    return (
      <ModelForm<TBaseModel>
        modelType={data.modelType}
        id="color-defaults-form"
        name="Color Defaults"
        fields={props.fields}
        formType={formType}
        modelIdToEdit={formType === FormType.Update ? RECORD_ID : undefined}
        initialValues={data.initialValues}
        existingItems={props.existingItems}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        submitButtonText="Save"
      />
    );
  };

  let rerender: (ui: React.ReactElement) => void = (): void => {
    // Set below.
  };

  await act(async (): Promise<void> => {
    rerender = render(
      element({ fields: data.fields, existingItems: data.existingItems }),
    ).rerender;
  });

  // The form is drawn once its fields have arrived.
  await screen.findByRole("button", { name: "Save" });

  return {
    rerender: async (next: {
      fields?: Array<ModelField<BaseModel>>;
      existingItems?: Array<BaseModel>;
    }): Promise<void> => {
      await act(async (): Promise<void> => {
        rerender(
          element({
            fields: (next.fields as Array<ModelField<TBaseModel>>) || [
              ...data.fields,
            ],
            existingItems: next.existingItems as Array<TBaseModel> | undefined,
          }),
        );
      });
    },
  };
}

// The form's one color field.
function colorField(): HTMLElement {
  return getColorField();
}

// What it holds: lowercase #rrggbb, "" for none.
function colorValue(): string {
  return colorOf(colorField());
}

async function typeName(): Promise<void> {
  fireEvent.change(await screen.findByPlaceholderText("internal-service"), {
    target: { value: "payments" },
  });
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

async function submitAndCapture(): Promise<JSONObject> {
  await submit();

  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

// Types a code into Custom color's box, as a person (and the E2E) does.
async function pickInPicker(hex: string): Promise<void> {
  typeColorCode(colorField(), hex);

  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  capturedModels = [];
  recordToEdit = {};
});

describe("a Create form's colour", () => {
  test("starts picked, its swatch ticked, from the first paint", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
    });

    await waitFor(() => {
      expect(colorValue()).toBe(Indigo500.toString());
    });

    // The swatch of that color is the one ticked.
    expect(getCheckedSwatch(colorField())).toHaveAccessibleName("Indigo");
    expect(getCheckedSwatch(colorField())).toHaveAttribute(
      "data-color",
      Indigo500.toString(),
    );
  });

  test("is sent untouched as the Color it stands for - Create works without touching it", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
    });

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(model["name"]).toBe("payments");
    expect(model["color"]).toBeInstanceOf(Color);
    expect(String(model["color"])).toBe(Indigo500.toString());
    expect(screen.queryByText("Label Color is required.")).toBeNull();
  });

  test("is one none of the records listed beside the form uses", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
      existingItems: [labelWithColor(Indigo500), labelWithColor("#d97706")],
    });

    await waitFor(() => {
      expect(colorValue()).toBe(Teal600.toString());
    });

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe(Teal600.toString());
  });

  test("stays clear of a near match, and of a new project's seeded states", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
      existingItems: [
        labelWithColor(Red),
        labelWithColor(Yellow),
        labelWithColor(Green),
        // indigo-600: not indigo-500, but the same colour to the eye.
        labelWithColor("#4f46e5"),
      ],
    });

    await waitFor(() => {
      expect(colorValue()).not.toBe("");
    });

    for (const used of [Red, Yellow, Green, new Color("#4f46e5")]) {
      expect(areSimilarColors(colorValue(), used)).toBe(false);
    }
  });

  test("is picked once: the fields handed again, or rows fetched again, never change it", async () => {
    const form: RenderedForm = await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
      existingItems: [],
    });

    await waitFor(() => {
      expect(colorValue()).toBe(Indigo500.toString());
    });

    // A page re-renders: a new fields array, and the table refetched its rows.
    await form.rerender({
      fields: [{ ...NAME_FIELD }, { ...COLOR_FIELD }] as Array<
        ModelField<BaseModel>
      >,
      existingItems: [labelWithColor(Indigo500), labelWithColor(Amber600)],
    });

    expect(colorValue()).toBe(Indigo500.toString());

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe(Indigo500.toString());
  });

  test("can be changed in the picker, and the change is what is sent", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
    });

    await waitFor(() => {
      expect(colorValue()).toBe(Indigo500.toString());
    });

    await pickInPicker("#0891b2");

    await waitFor(() => {
      expect(colorValue()).toBe("#0891b2");
    });

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(model["color"]).toBeInstanceOf(Color);
    expect(String(model["color"])).toBe("#0891b2");
  });

  test("cannot be emptied: a required colour has no No color, so one is always picked", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
    });

    await waitFor(() => {
      expect(colorValue()).toBe(Indigo500.toString());
    });

    expect(
      within(colorField()).queryByRole("radio", { name: "No color" }),
    ).toBeNull();
    expect(within(colorField()).getByRole("radiogroup")).toHaveAttribute(
      "aria-required",
      "true",
    );

    // Another swatch is another colour, never none.
    act(() => {
      fireEvent.click(getSwatch(colorField(), "Teal"));
    });

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe(Teal600.toString());
  });

  test("keeps a colour the form starts with", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
      initialValues: { color: new Color("#ef4444") } as FormValues<Label>,
    });

    await waitFor(() => {
      expect(colorValue()).toBe("#ef4444");
    });

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe("#ef4444");
  });

  test("leaves a colour the form starts empty on purpose empty, as BasicForm would", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, COLOR_FIELD],
      initialValues: { color: null } as unknown as FormValues<Label>,
    });

    // Nothing fills it in: the form said what it starts with.
    expect(colorValue()).toBe("");

    await typeName();
    await submit();

    expect(
      await screen.findByText("Label Color is required."),
    ).toBeInTheDocument();
    expect(capturedModels).toHaveLength(0);
  });

  test("keeps a field's own default", async () => {
    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, { ...COLOR_FIELD, defaultValue: "#ef4444" }],
    });

    await waitFor(() => {
      expect(colorValue()).toBe("#ef4444");
    });

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe("#ef4444");
    // Sent as a Color too, not as the text the field started with.
    expect(model["color"]).toBeInstanceOf(Color);
  });

  test("is left empty where the record can go without one", async () => {
    // A service's colour is optional: the server picks one when none is sent.
    await renderForm<Service>({
      modelType: Service,
      fields: [
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
          placeholder: "internal-service",
        },
        {
          field: { serviceColor: true },
          title: "Service Color",
          fieldType: FormFieldSchemaType.Color,
          required: false,
          placeholder: "No color",
        },
      ],
    });

    expect(colorValue()).toBe("");
    // An optional colour offers No color, and it is the one ticked.
    expect(getCheckedSwatch(colorField())).toHaveAccessibleName("No color");

    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(model["serviceColor"]).toBeUndefined();
  });
});

describe("an Edit form's colour", () => {
  test("is the record's, never a pick", async () => {
    recordToEdit = {
      _id: RECORD_ID.toString(),
      name: "payments",
      color: new Color("#ef4444") as unknown as JSONObject,
    };

    await renderForm<Label>({
      modelType: Label,
      formType: FormType.Update,
      fields: [NAME_FIELD, COLOR_FIELD],
      existingItems: [labelWithColor("#ef4444")],
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("internal-service")).toHaveValue(
        "payments",
      );
    });

    await waitFor(() => {
      expect(colorValue()).toBe("#ef4444");
    });

    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe("#ef4444");
  });

  test("stays empty for a record that has none", async () => {
    recordToEdit = {
      _id: RECORD_ID.toString(),
      name: "payments",
    };

    await renderForm<Label>({
      modelType: Label,
      formType: FormType.Update,
      fields: [NAME_FIELD, COLOR_FIELD],
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText("internal-service")).toHaveValue(
        "payments",
      );
    });

    expect(colorValue()).toBe("");
  });
});

describe("a picked colour folded under More fields", () => {
  test("is listed, not shown as set, until someone picks another", async () => {
    const advanced: ReturnType<typeof getAdvancedFormSection> =
      getAdvancedFormSection<Label>();

    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, { ...COLOR_FIELD, collapsibleSection: advanced }],
    });

    const header: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByTestId("folded-section-item")).toHaveTextContent(
      "Label Color",
    );
    expect(within(header).getByTestId("folded-section-item")).toHaveAttribute(
      "data-item-set",
      "false",
    );

    // Nothing to open to create: the colour is already there.
    await typeName();
    const model: JSONObject = await submitAndCapture();

    expect(String(model["color"])).toBe(Indigo500.toString());
  });

  test("shows a colour somebody picked as set", async () => {
    const advanced: ReturnType<typeof getAdvancedFormSection> =
      getAdvancedFormSection<Label>();

    await renderForm<Label>({
      modelType: Label,
      fields: [NAME_FIELD, { ...COLOR_FIELD, collapsibleSection: advanced }],
    });

    const header: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    fireEvent.click(header);
    await pickInPicker("#0891b2");
    fireEvent.click(header);

    await waitFor(() => {
      expect(within(header).getByTestId("folded-section-item")).toHaveAttribute(
        "data-item-set",
        "true",
      );
    });
  });
});
