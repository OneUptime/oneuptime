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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../../Models/DatabaseModels/MonitorTemplate";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import ModelForm, { FormType } from "../../../../UI/Components/Forms/ModelForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";

interface SaveRequest {
  model: BaseModel;
  modelType: { new (): BaseModel };
  formType: FormType;
}

let savedRequests: Array<SaveRequest> = [];
let loadedModel: BaseModel | null = null;

/*
 * Keep the real form, input, validation, model metadata and serialization.
 * Only the network boundary and signed-in user's environment are replaced.
 */
jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<BaseModel | null> => {
        return loadedModel;
      },
      createOrUpdate: async (
        request: SaveRequest,
      ): Promise<{ data: JSONObject }> => {
        savedRequests.push(request);
        return { data: {} };
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: [Permission.ProjectOwner] };
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

interface FormSubject {
  label: string;
  modelType: { new (): BaseModel };
  descriptionField: string;
  descriptionTitle: string;
  nameField: string;
  nameTitle: string;
}

const SUBJECTS: Array<FormSubject> = [
  {
    label: "Monitor.description",
    modelType: Monitor,
    descriptionField: "description",
    descriptionTitle: "Description",
    nameField: "name",
    nameTitle: "Name",
  },
  {
    label: "MonitorTemplate.monitorDescription",
    modelType: MonitorTemplate,
    descriptionField: "monitorDescription",
    descriptionTitle: "Default Monitor Description",
    nameField: "monitorName",
    nameTitle: "Monitor Name",
  },
];

const FORM_TYPES: Array<{ label: string; formType: FormType }> = [
  { label: "create", formType: FormType.Create },
  { label: "edit", formType: FormType.Update },
];

const MODEL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const LARGE_DESCRIPTION: string =
  "  ## CPU saturation — 調査手順 🛠️\n\n" +
  "- Inspect **requests / limits** and café latency.\n```sh\nkubectl top pods\n```\n".repeat(
    2000,
  ) +
  "\n[Runbook](https://example.com/runbooks/cpu)\n最後の行 ✅  ";

interface RenderFormOptions {
  description?: string | null | undefined;
  includeTemplateDescription?: boolean | undefined;
}

async function renderDescriptionForm(
  subject: FormSubject,
  formType: FormType,
  options: RenderFormOptions = {},
): Promise<HTMLTextAreaElement> {
  const values: JSONObject = {
    [subject.nameField]: "Pod CPU Saturating Container Limit",
  };

  if (options.description !== undefined) {
    values[subject.descriptionField] = options.description;
  }

  /*
   * These are the LongText fields used by the dashboard's monitor create /
   * details and monitor-template create / defaults forms. ModelForm must
   * obtain the length rules from the actual model, as it does on those pages.
   */
  const fields: Fields<BaseModel> = [
    {
      field: { [subject.nameField]: true },
      title: subject.nameTitle,
      fieldType: FormFieldSchemaType.Text,
      required: subject.modelType === Monitor,
      validation: { minLength: 2 },
      dataTestId: "monitor-name",
    },
    {
      field: { [subject.descriptionField]: true },
      title: subject.descriptionTitle,
      fieldType: FormFieldSchemaType.LongText,
      required: false,
      dataTestId: "monitor-description",
    },
  ];

  if (options.includeTemplateDescription) {
    values["templateDescription"] = "Template purpose";
    fields.push({
      field: {
        templateDescription: true,
      } as Fields<MonitorTemplate>[number]["field"],
      title: "Template Description",
      fieldType: FormFieldSchemaType.LongText,
      required: true,
      validation: { minLength: 2 },
      dataTestId: "template-description",
    });
  }

  if (formType === FormType.Update) {
    loadedModel = new subject.modelType();
    loadedModel.id = MODEL_ID;
    for (const key of Object.keys(values)) {
      loadedModel.setColumnValue(key, values[key]!);
    }
  }

  await act(async (): Promise<void> => {
    render(
      <ModelForm<BaseModel>
        id="monitor-description-form"
        modelType={subject.modelType}
        formType={formType}
        modelIdToEdit={formType === FormType.Update ? MODEL_ID : undefined}
        initialValues={
          formType === FormType.Create
            ? (values as FormValues<BaseModel>)
            : undefined
        }
        fields={fields}
        submitButtonText="Save"
      />,
    );
  });

  return (await screen.findByTestId(
    "monitor-description",
  )) as HTMLTextAreaElement;
}

async function changeValue(input: HTMLElement, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    // One input event also covers a user pasting a runbook into the textarea.
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  });
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
}

async function expectSavedDescription(
  subject: FormSubject,
  formType: FormType,
  description: string | null | undefined,
): Promise<void> {
  await waitFor(() => {
    expect(savedRequests).toHaveLength(1);
  });

  const request: SaveRequest = savedRequests[0]!;
  expect(request.model).toBeInstanceOf(subject.modelType);
  expect(request.modelType).toBe(subject.modelType);
  expect(request.formType).toBe(formType);
  expect(
    (request.model as unknown as JSONObject)[subject.descriptionField],
  ).toBe(description);
  if (formType === FormType.Update) {
    expect(request.model.id).toEqual(MODEL_ID);
  }
  expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
}

beforeEach(() => {
  savedRequests = [];
  loadedModel = null;
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe.each(SUBJECTS)("$label form", (subject: FormSubject) => {
  describe.each(FORM_TYPES)(
    "$label",
    ({ formType }: { label: string; formType: FormType }) => {
      test.each([
        { label: "500-character boundary", description: "a".repeat(500) },
        { label: "501-character regression", description: "a".repeat(501) },
        {
          label: "large Unicode Markdown runbook",
          description: LARGE_DESCRIPTION,
        },
      ])(
        "submits the complete $label",
        async ({ description }: { label: string; description: string }) => {
          const textarea: HTMLTextAreaElement = await renderDescriptionForm(
            subject,
            formType,
          );

          expect(textarea).not.toHaveAttribute("maxlength");
          await changeValue(textarea, description);
          expect(textarea).toHaveValue(description);
          await submit();

          await expectSavedDescription(subject, formType, description);
        },
      );

      test("allows an optional description to remain blank", async () => {
        const description: null | undefined =
          formType === FormType.Update ? null : undefined;
        const textarea: HTMLTextAreaElement = await renderDescriptionForm(
          subject,
          formType,
          { description },
        );

        expect(textarea).toHaveValue("");
        await submit();

        await expectSavedDescription(subject, formType, description);
      });

      test("clears a previously populated long description", async () => {
        const textarea: HTMLTextAreaElement = await renderDescriptionForm(
          subject,
          formType,
          { description: LARGE_DESCRIPTION },
        );

        expect(textarea).toHaveValue(LARGE_DESCRIPTION);
        await changeValue(textarea, "");
        await submit();

        await expectSavedDescription(subject, formType, "");
      });

      test("still validates the name and preserves a long description while the name is corrected", async () => {
        const textarea: HTMLTextAreaElement = await renderDescriptionForm(
          subject,
          formType,
        );
        await changeValue(textarea, LARGE_DESCRIPTION);
        await changeValue(screen.getByTestId("monitor-name"), "n".repeat(101));
        await submit();

        expect(savedRequests).toHaveLength(0);
        expect(
          await screen.findByText(
            `${subject.nameTitle} cannot be more than 100 characters.`,
          ),
        ).toBeInTheDocument();
        expect(textarea).toHaveValue(LARGE_DESCRIPTION);

        await changeValue(screen.getByTestId("monitor-name"), "n".repeat(100));
        await submit();

        await expectSavedDescription(subject, formType, LARGE_DESCRIPTION);
      });
    },
  );

  test("loads and resubmits an existing long description unchanged", async () => {
    const textarea: HTMLTextAreaElement = await renderDescriptionForm(
      subject,
      FormType.Update,
      { description: LARGE_DESCRIPTION },
    );

    expect(textarea).toHaveValue(LARGE_DESCRIPTION);
    await submit();

    await expectSavedDescription(subject, FormType.Update, LARGE_DESCRIPTION);
  });
});

describe.each(FORM_TYPES)(
  "template purpose description on $label",
  ({ formType }: { label: string; formType: FormType }) => {
    test("retains its own 500-character limit without limiting the monitor default", async () => {
      const subject: FormSubject = SUBJECTS[1]!;
      await renderDescriptionForm(subject, formType, {
        description: LARGE_DESCRIPTION,
        includeTemplateDescription: true,
      });
      await changeValue(
        screen.getByTestId("template-description"),
        "t".repeat(501),
      );
      await submit();

      expect(savedRequests).toHaveLength(0);
      expect(
        await screen.findByText(
          "Template Description cannot be more than 500 characters.",
        ),
      ).toBeInTheDocument();

      await changeValue(
        screen.getByTestId("template-description"),
        "t".repeat(500),
      );
      await submit();

      await expectSavedDescription(subject, formType, LARGE_DESCRIPTION);
      expect(
        (savedRequests[0]!.model as MonitorTemplate).templateDescription,
      ).toBe("t".repeat(500));
    });
  },
);
