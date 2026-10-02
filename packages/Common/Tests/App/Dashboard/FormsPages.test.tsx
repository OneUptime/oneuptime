import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/*
 * The Forms product's pages, wired: the list of forms (and what creating
 * one asks and does), every submission, and a form's own pages - Build,
 * On Submit, Share, Submissions and Delete. The tables, detail cards and
 * builder components are recorded rather than drawn: each has a suite of
 * its own, and what matters here is what each page hands them.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedDetailCards: Array<Record<string, unknown>> = [];
const recordedDeletes: Array<Record<string, unknown>> = [];
const recorded: Record<string, Array<Record<string, unknown>>> = {
  builder: [],
  submissions: [],
  status: [],
  shareLink: [],
  target: [],
  mapping: [],
};

let mockIpAllowlistEditable: boolean = true;
let mockStoredForm: Record<string, unknown> | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `table-${String(props["name"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedDetailCards.push(props);
      return React.createElement("div", {
        "data-testid": `card-${String(props["name"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedDeletes.push(props);
      return React.createElement("div", { "data-testid": "model-delete" });
    },
  };
});

type RecorderFunction = (
  name: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: RecorderFunction = (name: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    (
      (globalThis as unknown as { __formsPagesRecorded: Record<string, Array<unknown>> })
        .__formsPagesRecorded[name] as Array<unknown>
    ).push(props);
    return React.createElement("div", { "data-testid": `stub-${name}` });
  };
};

(globalThis as unknown as { __formsPagesRecorded: unknown }).__formsPagesRecorded =
  recorded;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Builder/FormBuilder",
  () => {
    return { __esModule: true, default: mockRecorder("builder") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Submissions/FormSubmissionsTable",
  () => {
    return { __esModule: true, default: mockRecorder("submissions") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormStatusCard",
  () => {
    return { __esModule: true, default: mockRecorder("status") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormShareLinkCard",
  () => {
    return { __esModule: true, default: mockRecorder("shareLink") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormTargetCard",
  () => {
    return { __esModule: true, default: mockRecorder("target") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/OnSubmit/FormMappingCard",
  () => {
    return { __esModule: true, default: mockRecorder("mapping") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormPlan",
  () => {
    return {
      __esModule: true,
      isFormIpAllowlistEditableOnCurrentPlan: (): boolean => {
        return mockIpAllowlistEditable;
      },
    };
  },
);

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: async (): Promise<unknown> => {
        if (!mockStoredForm) {
          return null;
        }

        const FormClass: any = (
          jest.requireActual("../../../Models/DatabaseModels/Form") as any
        ).default;
        const form: any = new FormClass();
        Object.assign(form, mockStoredForm);
        return form;
      },
    },
  };
});

import Form from "../../../Models/DatabaseModels/Form";
import Route_ from "../../../Types/API/Route";
import {
  FormField,
  FormFieldSource,
} from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { CardSelectOption } from "../../../UI/Components/CardSelect/CardSelect";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";
import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import Forms from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/Forms";
import FormsSubmissions from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/Submissions";
import FormBuild from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Build";
import FormDelete from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Delete";
import FormOnSubmit from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/OnSubmit";
import FormShare from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Share";
import FormViewSubmissions from "../../../../App/FeatureSet/Dashboard/src/Pages/Forms/View/Submissions";

const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";

const PAGE_PROPS: Record<string, unknown> = {} as never;

async function renderAt(
  element: ReactElement,
  path: string = `/dashboard/p/forms/${FORM_ID}`,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/p/forms" element={element} />
          <Route path="/dashboard/p/forms/:id" element={element} />
        </Routes>
      </MemoryRouter>,
    );
  });

  // Let a page's own read land.
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function lastTable(): Record<string, unknown> {
  expect(recordedTables.length).toBeGreaterThan(0);
  return recordedTables[recordedTables.length - 1]!;
}

function fieldsOf(table: Record<string, unknown>): Array<Field<Form>> {
  return table["formFields"] as Array<Field<Form>>;
}

beforeEach(() => {
  recordedTables.length = 0;
  recordedDetailCards.length = 0;
  recordedDeletes.length = 0;

  for (const key of Object.keys(recorded)) {
    recorded[key]!.length = 0;
  }

  mockIpAllowlistEditable = true;
  mockStoredForm = null;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the list of forms", () => {
  test("is the project's forms, in a table of its own", async () => {
    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const table: Record<string, unknown> = lastTable();

    expect(table["modelType"]).toBe(Form);
    expect(table["id"]).toBe("forms-table");
    expect(table["userPreferencesKey"]).toBe("forms-table");
    expect(table["name"]).toBe("Forms");
    expect(JSON.stringify(table["query"])).toContain(
      "11111111-1111-4111-8111-111111111111",
    );
  });

  test("creates and opens forms; editing and deleting happen on a form's own pages", async () => {
    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const table: Record<string, unknown> = lastTable();

    expect(table["isCreateable"]).toBe(true);
    expect(table["isViewable"]).toBe(true);
    expect(table["isEditable"]).toBe(false);
    expect(table["isDeleteable"]).toBe(false);
  });

  test("is the Forms card, with what forms are for, and the forms documentation", async () => {
    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const table: Record<string, unknown> = lastTable();

    expect(table["cardProps"]).toEqual({
      title: FormsCopy.productTitle,
      description: FormsCopy.listDescription,
    });
    expect(table["noItemsMessage"]).toBe(FormsCopy.listEmpty);
    expect((table["documentationLink"] as Route_).toString()).toBe(
      "/docs/forms/index",
    );
  });

  test("creating one asks a name, what it creates and a description - nothing more", async () => {
    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const fields: Array<Field<Form>> = fieldsOf(lastTable());

    expect(
      fields.map((field: Field<Form>): string => {
        return Object.keys(field.field || {})[0]!;
      }),
    ).toEqual(["name", "targetType", "description"]);

    expect(fields[0]).toMatchObject({
      title: "Name",
      required: true,
      fieldType: FormFieldSchemaType.Text,
    });
    expect(fields[1]).toMatchObject({
      title: FormsCopy.createsTitle,
      required: true,
      fieldType: FormFieldSchemaType.CardSelect,
      defaultValue: FormTargetType.Incident,
    });
    expect(
      (fields[1]!.cardSelectOptions as Array<CardSelectOption>).map(
        (option: CardSelectOption): string => {
          return `${option.value}:${option.title}`;
        },
      ),
    ).toEqual(["Incident:Incident", "ScheduledMaintenance:Scheduled Maintenance"]);
    expect(fields[2]).toMatchObject({
      title: "Description",
      required: false,
      fieldType: FormFieldSchemaType.Markdown,
      // Shown on the public page, where a private image cannot load.
      allowImageUpload: false,
    });
  });

  test("a new form starts with its target's questions, in the dashboard's language", async () => {
    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const onBeforeCreate: (item: Form) => Promise<Form> = lastTable()[
      "onBeforeCreate"
    ] as never;

    const form: Form = new Form();
    form.targetType = FormTargetType.ScheduledMaintenance;

    const created: Form = await onBeforeCreate(form);

    expect(
      (created.fields as unknown as Array<FormField>).map((field: FormField) => {
        return field.targetField || field.submitterField;
      }),
    ).toEqual(["title", "description", "startsAt", "endsAt", "Name", "Email"]);
  });

  test("a new form opens on its builder", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const onCreateSuccess: (item: Form) => Promise<Form> = lastTable()[
      "onCreateSuccess"
    ] as never;

    const form: Form = new Form();
    form._id = FORM_ID;

    await onCreateSuccess(form);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toContain(`/forms/${FORM_ID}`);
  });

  test("lists name, what it creates and whether it is accepting submissions", async () => {
    await renderAt(<Forms {...(PAGE_PROPS as never)} />, "/dashboard/p/forms");

    const columns: Array<{ field: Record<string, boolean>; title: string }> =
      lastTable()["columns"] as never;

    expect(
      columns.map((column: { field: Record<string, boolean> }): string => {
        return Object.keys(column.field)[0]!;
      }),
    ).toEqual(["name", "targetType", "isEnabled"]);
  });
});

describe("every submission", () => {
  test("is the submissions table, for every form", async () => {
    await renderAt(
      <FormsSubmissions {...(PAGE_PROPS as never)} />,
      "/dashboard/p/forms",
    );

    expect(recorded["submissions"]).toHaveLength(1);
    expect(recorded["submissions"]![0]!["formId"]).toBeUndefined();
  });
});

describe("a form's pages", () => {
  test("Build is the builder, for this form", async () => {
    await renderAt(<FormBuild {...(PAGE_PROPS as never)} />);

    expect(String(recorded["builder"]![0]!["formId"])).toBe(FORM_ID);
  });

  test("Submissions is the submissions table, for this form", async () => {
    await renderAt(<FormViewSubmissions {...(PAGE_PROPS as never)} />);

    expect(String(recorded["submissions"]![0]!["formId"])).toBe(FORM_ID);
  });

  test("On Submit reads the form, then shows what it creates and how", async () => {
    const fields: Array<FormField> = [
      {
        id: "title",
        source: FormFieldSource.TargetField,
        targetField: "title",
        label: "Title",
        isRequired: true,
      },
    ];

    mockStoredForm = {
      _id: FORM_ID,
      targetType: FormTargetType.ScheduledMaintenance,
      fields,
      targetSettings: { showOnStatusPages: true },
    };

    await renderAt(<FormOnSubmit {...(PAGE_PROPS as never)} />);

    expect(recorded["target"]![0]).toMatchObject({
      targetType: FormTargetType.ScheduledMaintenance,
      fields,
    });
    expect(recorded["mapping"]![0]).toMatchObject({
      targetType: FormTargetType.ScheduledMaintenance,
      fields,
      targetSettings: { showOnStatusPages: true },
    });
    expect(String(recorded["mapping"]![0]!["formId"])).toBe(FORM_ID);
  });

  test("On Submit says so when the form cannot be found", async () => {
    mockStoredForm = null;

    await renderAt(<FormOnSubmit {...(PAGE_PROPS as never)} />);

    expect(screen.getByText(FormsCopy.formNotFound)).toBeInTheDocument();
    expect(recorded["target"]).toHaveLength(0);
  });

  describe("Share", () => {
    test("has the status, the link, the thank-you message and the access, in that order", async () => {
      await renderAt(<FormShare {...(PAGE_PROPS as never)} />);

      expect(String(recorded["status"]![0]!["formId"])).toBe(FORM_ID);
      expect(String(recorded["shareLink"]![0]!["modelId"])).toBe(FORM_ID);
      expect(
        recordedDetailCards.map((card: Record<string, unknown>) => {
          return card["name"];
        }),
      ).toEqual(["Form > After Submitting", "Form > Access"]);
    });

    test("turning the form on or off asks the link card to read it again", async () => {
      await renderAt(<FormShare {...(PAGE_PROPS as never)} />);

      const before: unknown = recorded["shareLink"]!.at(-1)!["refresher"];

      await act(async () => {
        (recorded["status"]![0]!["onChange"] as () => void)();
      });

      expect(recorded["shareLink"]!.at(-1)!["refresher"]).toBe(!before);
    });

    test("the thank-you message is Markdown that cannot upload images", async () => {
      await renderAt(<FormShare {...(PAGE_PROPS as never)} />);

      const card: Record<string, unknown> = recordedDetailCards[0]!;
      const field: Field<Form> = (card["formFields"] as Array<Field<Form>>)[0]!;

      expect(field).toMatchObject({
        title: FormsCopy.successMessageTitle,
        fieldType: FormFieldSchemaType.Markdown,
        allowImageUpload: false,
      });
    });

    test("says nothing about the plan when it allows the IP allowlist", async () => {
      await renderAt(<FormShare {...(PAGE_PROPS as never)} />);

      expect(
        (recordedDetailCards[1]!["cardProps"] as { description: unknown })
          .description,
      ).toBe(FormsCopy.accessDescription);
    });

    test("says, on the card and in the edit form, that the IP allowlist needs the Scale plan", async () => {
      mockIpAllowlistEditable = false;

      await renderAt(<FormShare {...(PAGE_PROPS as never)} />);

      const card: Record<string, unknown> = recordedDetailCards[1]!;

      render(
        (card["cardProps"] as { description: ReactElement }).description,
      );

      expect(screen.getByTestId("form-ip-allowlist-plan-note")).toHaveTextContent(
        FormsCopy.accessPlanNote,
      );
    });

    test("shows each allowlisted address on its own line, or that any network may open it", async () => {
      await renderAt(<FormShare {...(PAGE_PROPS as never)} />);

      const getElement: (item: Form) => ReactElement = (
        (recordedDetailCards[1]!["modelDetailProps"] as {
          fields: Array<{ getElement: (item: Form) => ReactElement }>;
        }).fields[0]!.getElement
      );

      const listed: Form = new Form();
      listed.ipWhitelist = "10.0.0.0/8\n203.0.113.7";

      render(getElement(listed));

      expect(screen.getByTestId("form-ip-allowlist")).toHaveTextContent(
        "10.0.0.0/8 203.0.113.7",
      );

      cleanup();

      render(getElement(new Form()));

      expect(screen.getByText(FormsCopy.ipAllowlistEmpty)).toBeInTheDocument();
    });
  });

  test("Delete deletes this form, says what goes with it, and goes back to the list", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await renderAt(<FormDelete {...(PAGE_PROPS as never)} />);

    const deletion: Record<string, unknown> = recordedDeletes[0]!;

    expect(deletion["modelType"]).toBe(Form);
    expect(String(deletion["modelId"])).toBe(FORM_ID);

    render(deletion["confirmationContent"] as ReactElement);

    expect(screen.getByText(FormsCopy.deleteFormNote)).toBeInTheDocument();

    (deletion["onDeleteSuccess"] as () => void)();

    expect(String(navigate.mock.calls[0]![0])).toMatch(/\/forms$/);
  });
});
