import Form from "../../../Models/DatabaseModels/Form";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import FormService from "../../../Server/Services/FormService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceCustomFieldService from "../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
} from "../../../Types/Form/FormField";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { FORM_MAX_TEMPLATES } from "../../../Types/Form/FormTemplate";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What FormService lets into a form's templates (Form.templates), whoever
 * writes them - the dashboard's Templates page, the API, Terraform:
 *
 *   - their shape: ids, names unique within the form, one default, answers
 *     keyed by question (validateFormTemplates);
 *   - every answer of every template, against the question it answers, as
 *     the form will ask it once the write is applied - an option it offers,
 *     a record of the form's own project it offers, text that fits, hidden
 *     questions too (validateFormTemplateAnswers);
 *   - and only when templates are written: a change to the questions alone
 *     never re-judges the templates, whose stale answers are simply not
 *     offered.
 *
 * The database is stubbed; the checks run for real.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f01",
);
const FORM_ID: string = "a1b2c3d4-0000-4000-8000-0000000000f1";
const SEVERITY_ID: string = "b0000000-0000-4000-8000-0000000000f1";
const MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000f1";
const FOREIGN_MONITOR_ID: string = "c1000000-0000-4000-8000-0000000000f9";
const TYPE_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const IMPACT_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f2";

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03"),
  tenantId: PROJECT_ID,
};

type OnBeforeCreate = (createBy: CreateBy<Form>) => Promise<OnCreate<Form>>;
type OnBeforeUpdate = (updateBy: UpdateBy<Form>) => Promise<OnUpdate<Form>>;
type MockedFn = ReturnType<typeof jest.fn>;

// A department's incident form: the description is hidden, set by templates.
const FIELDS: Array<FormField> = [
  {
    id: "title",
    source: FormFieldSource.TargetField,
    targetField: "title",
    label: "Title",
    isRequired: true,
  },
  {
    id: "description",
    source: FormFieldSource.TargetField,
    targetField: "description",
    label: "Description",
    isRequired: false,
    isHidden: true,
  },
  {
    id: "severity",
    source: FormFieldSource.TargetField,
    targetField: "incidentSeverityId",
    label: "Severity",
    isRequired: false,
  },
  {
    id: "monitors",
    source: FormFieldSource.TargetField,
    targetField: "monitors",
    label: "Affected Monitors",
    isRequired: false,
    allowedOptionIds: [MONITOR_ID],
  },
  {
    id: "type",
    source: FormFieldSource.TargetCustomField,
    customFieldId: TYPE_FIELD_ID,
    label: "Notification Type",
    isRequired: false,
    isHidden: true,
  },
  {
    id: "impact",
    source: FormFieldSource.TargetCustomField,
    customFieldId: IMPACT_FIELD_ID,
    label: "Users Affected",
    isRequired: false,
  },
  {
    id: "office",
    source: FormFieldSource.Question,
    type: CustomFieldType.Dropdown,
    dropdownOptions: "Berlin\nLondon",
    label: "Office",
    isRequired: false,
  },
];

const OUTAGE: JSONObject = {
  id: "outage",
  name: "Application Outage",
  answers: {
    title: "The application is down",
    description: "We are aware of an outage.",
    severity: SEVERITY_ID,
    monitors: [MONITOR_ID],
    type: "Outage",
    impact: 1200,
    office: "Berlin",
  },
};

const RESTORED: JSONObject = {
  id: "restored",
  name: "Service Restored",
  isDefault: true,
  answers: { title: "Service restored", type: "Restored" },
};

let storedForms: Array<Form>;
let customFieldFindBy: MockedFn;
let monitorFindBy: MockedFn;
let buildPublicFormFor: MockedFn;

function create(
  data: Form,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<OnCreate<Form>> {
  return (
    FormService as unknown as { onBeforeCreate: OnBeforeCreate }
  ).onBeforeCreate({ data, props });
}

function update(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = ADMIN_PROPS,
): Promise<OnUpdate<Form>> {
  return (
    FormService as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate({
    query: { _id: FORM_ID },
    data: data as never,
    props,
  } as never);
}

function newForm(data: Partial<Form> = {}): Form {
  const form: Form = new Form();
  form.projectId = PROJECT_ID;
  form.name = "Department A";
  form.fields = FIELDS as unknown as JSONArray;
  Object.assign(form, data);
  return form;
}

function storedForm(data: Partial<Form> = {}): Form {
  const form: Form = newForm(data);
  form._id = FORM_ID;
  form.targetType = data.targetType || FormTargetType.Incident;
  return form;
}

async function refusal(promise: Promise<unknown>): Promise<Error | undefined> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }

  return undefined;
}

beforeEach(() => {
  storedForms = [storedForm()];

  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);

  jest.spyOn(FormService, "findBy").mockImplementation((async (): Promise<
    Array<Form>
  > => {
    return storedForms;
  }) as never);

  buildPublicFormFor = jest.spyOn(
    FormService,
    "buildPublicFormFor",
  ) as unknown as MockedFn;

  customFieldFindBy = jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([
      Object.assign(new IncidentCustomField(), {
        _id: TYPE_FIELD_ID,
        name: "Notification Type",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "Outage\nDegradation\nRestored",
      }),
      Object.assign(new IncidentCustomField(), {
        _id: IMPACT_FIELD_ID,
        name: "Users Affected",
        customFieldType: CustomFieldType.Number,
      }),
    ] as never) as unknown as MockedFn;

  jest.spyOn(IncidentSeverityService, "findBy").mockResolvedValue([
    Object.assign(new IncidentSeverity(), {
      _id: SEVERITY_ID,
      name: "Critical",
    }),
  ] as never);

  monitorFindBy = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation((async (findBy: {
      query: { _id?: unknown; projectId?: unknown };
    }): Promise<Array<Monitor>> => {
      // Only the form's own project has this monitor.
      return String(findBy.query.projectId) === PROJECT_ID.toString() &&
        JSON.stringify(findBy.query._id).includes(MONITOR_ID)
        ? [Object.assign(new Monitor(), { _id: MONITOR_ID, name: "API" })]
        : [];
    }) as never) as unknown as MockedFn;

  jest
    .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("creating a form with templates", () => {
  test("accepts templates whose every answer suits its question, and stores them exactly as sent", async () => {
    const templates: JSONArray = [OUTAGE, RESTORED] as unknown as JSONArray;

    const created: Form = (await create(newForm({ templates }))).createBy.data;

    expect(created.templates).toBe(templates);
    expect(created.templates).toEqual([OUTAGE, RESTORED]);
  });

  test("a form created without templates is not built just to check none", async () => {
    await create(newForm());
    await create(newForm({ templates: [] as unknown as JSONArray }));

    expect(buildPublicFormFor).not.toHaveBeenCalled();
  });

  test("refuses templates of the wrong shape before anything is read", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          templates: [
            OUTAGE,
            { ...RESTORED, name: "application outage" },
          ] as unknown as JSONArray,
        }),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      'Template 2 ("application outage") has the same name as another template.',
    );
    expect(buildPublicFormFor).not.toHaveBeenCalled();
  });

  test("refuses more than one default", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          templates: [
            { ...OUTAGE, isDefault: true },
            RESTORED,
          ] as unknown as JSONArray,
        }),
      ),
    );

    expect(error?.message).toBe("Only one template can be the default.");
  });

  test("refuses more templates than a form may have", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          templates: Array.from(
            { length: FORM_MAX_TEMPLATES + 1 },
            (_value: unknown, index: number): JSONObject => {
              return { id: `t${index}`, name: `T${index}`, answers: {} };
            },
          ) as unknown as JSONArray,
        }),
      ),
    );

    expect(error?.message).toBe(
      `A form cannot have more than ${FORM_MAX_TEMPLATES} templates.`,
    );
  });

  test.each([
    [
      "an answer to a question the form does not ask",
      { removed: "x" },
      'Template 1 ("Application Outage") answers a question the form does not ask (removed).',
    ],
    [
      "an option the question does not offer",
      { office: "Paris" },
      'Template 1 ("Application Outage"): Office must be one of the options the form lists.',
    ],
    [
      "a hidden custom field's option it does not have",
      { type: "Panic" },
      'Template 1 ("Application Outage"): Notification Type must be one of the options the form lists.',
    ],
    [
      "a severity the project does not have",
      { severity: "b0000000-0000-4000-8000-0000000000ff" },
      'Template 1 ("Application Outage"): Severity must be one of the options the form lists.',
    ],
  ])(
    "refuses %s",
    async (_label: string, answers: JSONObject, message: string) => {
      const error: Error | undefined = await refusal(
        create(
          newForm({
            templates: [
              { id: "outage", name: "Application Outage", answers },
            ] as unknown as JSONArray,
          }),
        ),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(message);
    },
  );

  test("refuses a number custom field answered with text", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          templates: [
            { id: "a", name: "A", answers: { impact: "many" } },
          ] as unknown as JSONArray,
        }),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain('Template 1 ("A"):');
  });

  test("refuses a monitor of another project: a template can only name the form's own", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          templates: [
            {
              id: "a",
              name: "A",
              answers: { monitors: [FOREIGN_MONITOR_ID] },
            },
          ] as unknown as JSONArray,
        }),
      ),
    );

    expect(error?.message).toBe(
      'Template 1 ("A"): Affected Monitors must be chosen from the options the form lists.',
    );

    // Every monitor read was a read of the form's own project.
    for (const call of monitorFindBy.mock.calls) {
      expect(
        String((call[0] as { query: { projectId: unknown } }).query.projectId),
      ).toBe(PROJECT_ID.toString());
    }
  });

  test("checks the templates against the questions being created with them", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          fields: getDefaultFormFields(
            FormTargetType.Incident,
          ) as unknown as JSONArray,
          templates: [OUTAGE] as unknown as JSONArray,
        }),
      ),
    );

    // The default questions have other ids: OUTAGE answers none of them.
    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain("answers a question the form does not ask");
  });

  test("checks the project of the request, whatever the body says", async () => {
    await create(
      newForm({
        projectId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f99"),
        templates: [OUTAGE] as unknown as JSONArray,
      }),
    );

    const built: Form = buildPublicFormFor.mock.calls[0]![0] as Form;

    expect(built.projectId?.toString()).toBe(PROJECT_ID.toString());
  });
});

describe("changing a form's templates", () => {
  test("accepts templates that suit the questions the form has", async () => {
    await expect(
      update({ templates: [OUTAGE, RESTORED] as unknown as JSONArray }),
    ).resolves.toBeDefined();
  });

  test("refuses one that does not, naming the template and the answer", async () => {
    const error: Error | undefined = await refusal(
      update({
        templates: [
          OUTAGE,
          { id: "b", name: "Maintenance", answers: { office: "Paris" } },
        ] as unknown as JSONArray,
      }),
    );

    expect(error?.message).toBe(
      'Template 2 ("Maintenance"): Office must be one of the options the form lists.',
    );
  });

  test("refuses templates of the wrong shape", async () => {
    const error: Error | undefined = await refusal(
      update({ templates: "outage" as unknown as JSONArray }),
    );

    expect(error?.message).toBe("Templates must be a list.");
  });

  test("clearing the templates is always allowed", async () => {
    await expect(update({ templates: null as unknown as JSONArray })).resolves
      .toBeDefined();
    await expect(update({ templates: [] })).resolves.toBeDefined();
    expect(buildPublicFormFor).not.toHaveBeenCalled();
  });

  test("checks them against the questions the same write sets", async () => {
    const fields: Array<FormField> = FIELDS.filter((field: FormField): boolean => {
      return field.id !== "office";
    });

    const error: Error | undefined = await refusal(
      update({
        fields: fields as unknown as JSONArray,
        templates: [OUTAGE] as unknown as JSONArray,
      }),
    );

    expect(error?.message).toBe(
      'Template 1 ("Application Outage") answers a question the form does not ask (office).',
    );
  });

  test("a change to the questions alone never re-judges the templates", async () => {
    storedForms = [
      storedForm({
        templates: [
          { id: "old", name: "Old", answers: { office: "Paris", gone: "x" } },
        ] as unknown as JSONArray,
      }),
    ];

    await expect(
      update({
        fields: FIELDS.filter((field: FormField): boolean => {
          return field.id !== "office";
        }) as unknown as JSONArray,
      }),
    ).resolves.toBeDefined();

    expect(buildPublicFormFor).not.toHaveBeenCalled();
  });

  test("an update that touches none of the questions, settings or templates reads nothing", async () => {
    await update({ name: "Department B" });

    expect(FormService.findBy).not.toHaveBeenCalled();
    expect(customFieldFindBy).not.toHaveBeenCalled();
  });

  test("checks them against the target the form will have", async () => {
    storedForms = [
      storedForm({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: getDefaultFormFields(
          FormTargetType.ScheduledMaintenance,
        ) as unknown as JSONArray,
      }),
    ];

    const fields: Array<FormField> = storedForms[0]!.fields as unknown as Array<FormField>;
    const title: FormField = fields.find((field: FormField): boolean => {
      return field.targetField === "title";
    })!;

    // A maintenance title is at most 100 characters.
    const error: Error | undefined = await refusal(
      update({
        templates: [
          { id: "a", name: "A", answers: { [title.id]: "x".repeat(101) } },
        ] as unknown as JSONArray,
      }),
    );

    expect(error?.message).toBe(
      `Template 1 ("A"): ${title.label} cannot be more than 100 characters.`,
    );
  });
});
