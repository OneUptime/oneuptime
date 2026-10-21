import Form from "../../../Models/DatabaseModels/Form";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import FormService, {
  FORM_SHARE_KEY_MESSAGE,
  FORM_TARGET_TYPE_MESSAGE,
} from "../../../Server/Services/FormService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import MonitorService from "../../../Server/Services/MonitorService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import BadDataException from "../../../Types/Exception/BadDataException";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
  validateFormFields,
} from "../../../Types/Form/FormField";
import { validateFormIpAllowlist } from "../../../Types/Form/FormIpAllowlist";
import FormTargetType from "../../../Types/Form/FormTargetType";
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
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";

/*
 * What FormService lets into the Form table, whoever writes it - the
 * dashboard's builder, the API, Terraform, a workflow:
 *
 *   - a new form gets a fresh link key, whatever the request carried, and
 *     the questions its target needs when it was sent none;
 *   - what a form creates is one of the targets, and its questions and
 *     settings are those a form of that target can have - checked together,
 *     on every write that changes any of them, as the form will hold them;
 *   - every record the questions offer and the settings name is the form's
 *     own project's - a custom field, a monitor, a severity, an owner;
 *   - the IP allowlist and a replaced link key are ones the public routes
 *     can use.
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
const REGION_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f1";
const DELETED_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f8";
const FOREIGN_FIELD_ID: string = "d0000000-0000-4000-8000-0000000000f9";
const MEMBER_ID: string = "e0000000-0000-4000-8000-0000000000f1";
const STRANGER_ID: string = "e0000000-0000-4000-8000-0000000000f9";
const CLIENT_KEY: string = "f0000000-0000-4000-8000-0000000000f1";

const ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: new ObjectID("5d7f3c0a-4c55-4d3e-9a3e-2d4a7d1c9f03"),
  tenantId: PROJECT_ID,
};

type OnBeforeCreate = (createBy: CreateBy<Form>) => Promise<OnCreate<Form>>;
type OnBeforeUpdate = (updateBy: UpdateBy<Form>) => Promise<OnUpdate<Form>>;

interface ValidatorCall {
  projectId: ObjectID | undefined;
  references: Array<ProjectScopedReference>;
}

type MockedFn = ReturnType<typeof jest.fn>;

let validator: MockedFn;
let formFindBy: MockedFn;
let customFieldFindBy: MockedFn;
let monitorFindBy: MockedFn;
let storedForms: Array<Form>;

const REGION_QUESTION: FormField = {
  id: "region",
  source: FormFieldSource.TargetCustomField,
  customFieldId: REGION_FIELD_ID,
  label: "Region",
  isRequired: false,
};

const MONITORS_QUESTION: FormField = {
  id: "monitors",
  source: FormFieldSource.TargetField,
  targetField: "monitors",
  label: "Affected Monitors",
  isRequired: false,
  allowedOptionIds: [MONITOR_ID],
};

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
  form.name = "Report a Problem";
  Object.assign(form, data);
  return form;
}

function storedForm(data: Partial<Form> = {}): Form {
  const form: Form = newForm(data);
  form._id = FORM_ID;

  if (!("targetType" in data)) {
    form.targetType = FormTargetType.Incident;
  }

  if (!("fields" in data)) {
    form.fields = getDefaultFormFields(
      form.targetType || FormTargetType.Incident,
    ) as unknown as JSONArray;
  }

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

  validator = jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never) as unknown as MockedFn;

  formFindBy = jest
    .spyOn(FormService, "findBy")
    .mockImplementation((async (): Promise<Array<Form>> => {
      return storedForms;
    }) as never) as unknown as MockedFn;
  // The forms a teammate's update may write: the stored ones.
  stubRowsCallerMayWriteLikeFindBy(
    FormService,
    jest.spyOn(FormService, "findBy"),
  );

  customFieldFindBy = jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockResolvedValue([
      Object.assign(new IncidentCustomField(), {
        _id: REGION_FIELD_ID,
        name: "Region",
        customFieldType: CustomFieldType.Text,
      }),
    ] as never) as unknown as MockedFn;

  monitorFindBy = jest
    .spyOn(MonitorService, "findBy")
    .mockImplementation((async (findBy: {
      query: { _id?: unknown };
    }): Promise<Array<Monitor>> => {
      // Only this project's monitor exists for it.
      return JSON.stringify(findBy.query._id).includes(MONITOR_ID)
        ? [Object.assign(new Monitor(), { _id: MONITOR_ID, name: "API" })]
        : [];
    }) as never) as unknown as MockedFn;

  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation((async (data: {
      userIds: Array<string>;
    }): Promise<Array<ObjectID>> => {
      return data.userIds
        .filter((id: string): boolean => {
          return id !== STRANGER_ID;
        })
        .map((id: string): ObjectID => {
          return new ObjectID(id);
        });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FormService.onBeforeCreate: the link key", () => {
  test("mints a fresh key for every new form", async () => {
    const first: Form = (await create(newForm())).createBy.data;
    const second: Form = (await create(newForm())).createBy.data;

    expect(ObjectID.isValidUUID(first.shareKey!.toString())).toBe(true);
    expect(first.shareKey!.toString()).not.toBe(second.shareKey!.toString());
  });

  test("replaces a key the request chose: somebody else may know it", async () => {
    const form: Form = newForm({ shareKey: new ObjectID(CLIENT_KEY) });

    expect((await create(form)).createBy.data.shareKey!.toString()).not.toBe(
      CLIENT_KEY,
    );
  });
});

describe("FormService.onBeforeCreate: what the form creates and asks", () => {
  test("creates incidents unless told otherwise", async () => {
    expect((await create(newForm())).createBy.data.targetType).toBe(
      FormTargetType.Incident,
    );
  });

  test("keeps a target it is given", async () => {
    expect(
      (
        await create(
          newForm({ targetType: FormTargetType.ScheduledMaintenance }),
        )
      ).createBy.data.targetType,
    ).toBe(FormTargetType.ScheduledMaintenance);
  });

  test.each([["Alert"], ["incident"], [7]])(
    "refuses a target that is not one (%p)",
    async (targetType: unknown) => {
      const error: Error | undefined = await refusal(
        create(newForm({ targetType: targetType as FormTargetType })),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error?.message).toBe(FORM_TARGET_TYPE_MESSAGE);
    },
  );

  test("a form sent without questions starts with its target's own", async () => {
    const incident: Form = (await create(newForm())).createBy.data;
    const maintenance: Form = (
      await create(newForm({ targetType: FormTargetType.ScheduledMaintenance }))
    ).createBy.data;

    expect(
      (incident.fields as unknown as Array<FormField>).map(
        (field: FormField) => {
          return field.targetField || field.submitterField;
        },
      ),
    ).toEqual(["title", "description", "Name", "Email"]);
    expect(
      (maintenance.fields as unknown as Array<FormField>).map(
        (field: FormField) => {
          return field.targetField || field.submitterField;
        },
      ),
    ).toEqual(["title", "description", "startsAt", "endsAt", "Name", "Email"]);
  });

  test("questions it is sent are stored exactly as sent", async () => {
    const fields: Array<FormField> = [
      {
        id: "title",
        source: FormFieldSource.TargetField,
        targetField: "title",
        label: "Was ist kaputt?",
        isRequired: true,
      },
    ];

    expect(
      (await create(newForm({ fields: fields as unknown as JSONArray })))
        .createBy.data.fields,
    ).toEqual(fields);
  });

  test("refuses questions a form of its target cannot ask, with the check's own message", async () => {
    const fields: Array<FormField> = [
      {
        id: "x",
        source: FormFieldSource.TargetField,
        targetField: "incidentSeverityId",
        label: "Severity",
        isRequired: false,
      },
    ];

    const error: Error | undefined = await refusal(
      create(
        newForm({
          targetType: FormTargetType.ScheduledMaintenance,
          fields: fields as unknown as JSONArray,
        }),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      validateFormFields({
        value: fields,
        targetType: FormTargetType.ScheduledMaintenance,
      }),
    );
  });

  test("refuses settings of the other target", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          targetType: FormTargetType.ScheduledMaintenance,
          targetSettings: { incidentSeverityId: SEVERITY_ID },
        }),
      ),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toContain(
      '"incidentSeverityId" is not a setting of forms that create a scheduled maintenance event.',
    );
  });

  test("refuses an IP allowlist the public routes could never match", async () => {
    const error: Error | undefined = await refusal(
      create(newForm({ ipWhitelist: "10.0.0.0/8\n2001:db8::/32" })),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(error?.message).toBe(
      validateFormIpAllowlist("10.0.0.0/8\n2001:db8::/32"),
    );
  });
});

describe("FormService.onBeforeCreate: the records it names are its project's", () => {
  test("the settings' records are checked against the form's project, by kind", async () => {
    await create(
      newForm({
        targetSettings: {
          incidentSeverityId: SEVERITY_ID,
          monitorIds: [MONITOR_ID],
        },
      }),
    );

    const calls: Array<ValidatorCall> = validator.mock.calls.map(
      (call: Array<unknown>): ValidatorCall => {
        return call[0] as ValidatorCall;
      },
    );

    expect(calls).toHaveLength(2);
    expect(calls[0]!.projectId).toEqual(PROJECT_ID);
    expect(
      calls[0]!.references.map((reference: ProjectScopedReference) => {
        return [reference.modelName, reference.id];
      }),
    ).toEqual([["Severity", SEVERITY_ID]]);
    expect(
      calls[1]!.references.map((reference: ProjectScopedReference) => {
        return [reference.modelName, reference.id];
      }),
    ).toEqual([["Monitors", MONITOR_ID]]);
  });

  test("a record of another project is refused", async () => {
    validator.mockRejectedValue(
      new BadDataException("Monitors must belong to this project."),
    );

    expect(
      (
        await refusal(
          create(newForm({ targetSettings: { monitorIds: [MONITOR_ID] } })),
        )
      )?.message,
    ).toBe("Monitors must belong to this project.");
  });

  test("an owner must be a member of the project", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          targetSettings: { ownerUserIds: [MEMBER_ID, STRANGER_ID] },
        }),
      ),
    );

    expect(error?.message).toBe(
      "Owner Users: every owner must be a member of this project.",
    );
    await expect(
      create(newForm({ targetSettings: { ownerUserIds: [MEMBER_ID] } })),
    ).resolves.toBeDefined();
  });

  test("a question linked to a custom field this project does not have is refused", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          fields: [
            { ...REGION_QUESTION, customFieldId: FOREIGN_FIELD_ID },
          ] as unknown as JSONArray,
        }),
      ),
    );

    expect(error?.message).toBe(
      `A question is linked to a custom field this project does not have (${FOREIGN_FIELD_ID}).`,
    );
  });

  test("a question offering another project's monitor is refused", async () => {
    const error: Error | undefined = await refusal(
      create(
        newForm({
          fields: [
            { ...MONITORS_QUESTION, allowedOptionIds: [FOREIGN_MONITOR_ID] },
          ] as unknown as JSONArray,
        }),
      ),
    );

    expect(error?.message).toBe(
      "A question offers a record that does not belong to this project. Choose from the project's own.",
    );
  });

  test("questions of the project's own records pass", async () => {
    await expect(
      create(
        newForm({
          fields: [REGION_QUESTION, MONITORS_QUESTION] as unknown as JSONArray,
        }),
      ),
    ).resolves.toBeDefined();
    expect(customFieldFindBy).toHaveBeenCalledTimes(1);
    expect(monitorFindBy).toHaveBeenCalledTimes(1);
  });

  test("reads nothing for questions that name no record", async () => {
    await create(newForm());

    expect(customFieldFindBy).not.toHaveBeenCalled();
    expect(monitorFindBy).not.toHaveBeenCalled();
    expect(validator).not.toHaveBeenCalled();
  });
});

describe("FormService.onBeforeUpdate", () => {
  test("a change to nothing it checks reads nothing", async () => {
    await update({ name: "Renamed", successMessage: "Thanks" });

    expect(formFindBy).not.toHaveBeenCalled();
  });

  test("an IP allowlist is checked when it changes", async () => {
    expect(
      await refusal(update({ ipWhitelist: "2001:db8::/32" })),
    ).toBeInstanceOf(BadDataException);
    await expect(update({ ipWhitelist: "10.0.0.0/8" })).resolves.toBeDefined();
  });

  test.each([[null], [""], ["not-a-key"], [7]])(
    "a replaced link key must be a UUID (%p)",
    async (shareKey: unknown) => {
      const error: Error | undefined = await refusal(
        update({ shareKey } as unknown as JSONObject),
      );

      expect(error?.message).toBe(FORM_SHARE_KEY_MESSAGE);
    },
  );

  test("a link key the dashboard's Reset Link generates is accepted", async () => {
    await expect(
      update({ shareKey: ObjectID.generate() }),
    ).resolves.toBeDefined();
    await expect(
      update({ shareKey: ObjectID.generate().toString() }),
    ).resolves.toBeDefined();
  });

  test("a target that is not one is refused", async () => {
    expect((await refusal(update({ targetType: "Alert" })))?.message).toBe(
      FORM_TARGET_TYPE_MESSAGE,
    );
  });

  test("new questions are checked against the form's stored target", async () => {
    storedForms = [
      storedForm({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: getDefaultFormFields(
          FormTargetType.ScheduledMaintenance,
        ) as unknown as JSONArray,
      }),
    ];

    // A maintenance form must keep asking when it starts and ends.
    const error: Error | undefined = await refusal(
      update({
        fields: getDefaultFormFields(FormTargetType.Incident) as never,
      }),
    );

    expect(error?.message).toBe(
      "A form that creates a scheduled maintenance event must ask for Starts At. A form that creates a scheduled maintenance event must ask for Ends At.",
    );
  });

  test("clearing the questions of an incident form is fine; of a maintenance form it is not", async () => {
    await expect(update({ fields: null })).resolves.toBeDefined();

    storedForms = [
      storedForm({ targetType: FormTargetType.ScheduledMaintenance }),
    ];

    expect(await refusal(update({ fields: null }))).toBeInstanceOf(
      BadDataException,
    );
  });

  test("a new target is checked against the stored questions it would ask", async () => {
    storedForms = [
      storedForm({
        fields: [
          {
            id: "severity",
            source: FormFieldSource.TargetField,
            targetField: "incidentSeverityId",
            label: "How bad?",
            isRequired: false,
          },
        ] as unknown as JSONArray,
      }),
    ];

    const error: Error | undefined = await refusal(
      update({ targetType: FormTargetType.ScheduledMaintenance }),
    );

    expect(error?.message).toContain(
      "is linked to a field a scheduled maintenance event does not have",
    );
  });

  test("a new target with its converted questions and fresh settings is accepted", async () => {
    await expect(
      update({
        targetType: FormTargetType.ScheduledMaintenance,
        fields: getDefaultFormFields(
          FormTargetType.ScheduledMaintenance,
        ) as never,
        targetSettings: {},
      }),
    ).resolves.toBeDefined();
  });

  test("a new target is checked against the stored settings too", async () => {
    storedForms = [
      storedForm({
        fields: getDefaultFormFields(
          FormTargetType.ScheduledMaintenance,
        ) as unknown as JSONArray,
        targetSettings: { incidentSeverityId: SEVERITY_ID },
      }),
    ];

    const error: Error | undefined = await refusal(
      update({ targetType: FormTargetType.ScheduledMaintenance }),
    );

    expect(error?.message).toContain(
      '"incidentSeverityId" is not a setting of forms that create a scheduled maintenance event.',
    );
  });

  test("new settings are checked against the form's stored target, and their records against its project", async () => {
    expect(
      (
        await refusal(
          update({ targetSettings: { statusPageIds: [MONITOR_ID] } }),
        )
      )?.message,
    ).toContain(
      '"statusPageIds" is not a setting of forms that create an incident.',
    );

    await update({ targetSettings: { monitorIds: [MONITOR_ID] } });

    expect(
      (validator.mock.calls[0]![0] as ValidatorCall).projectId?.toString(),
    ).toBe(PROJECT_ID.toString());
  });

  test("reads every form the update matches, as root, and checks each", async () => {
    storedForms = [
      storedForm(),
      storedForm({ targetType: FormTargetType.ScheduledMaintenance }),
    ];

    // Fine for the incident form, not for the maintenance one.
    expect(
      await refusal(
        update({
          fields: getDefaultFormFields(FormTargetType.Incident) as never,
        }),
      ),
    ).toBeInstanceOf(BadDataException);
    expect(
      (formFindBy.mock.calls[0]![0] as { props: JSONObject }).props,
    ).toEqual({ isRoot: true, ignoreHooks: true });
  });

  test("a custom field the form already asks is not checked again, even once it is deleted", async () => {
    storedForms = [
      storedForm({
        fields: [
          { ...REGION_QUESTION, id: "gone", customFieldId: DELETED_FIELD_ID },
        ] as unknown as JSONArray,
      }),
    ];

    // The admin renames the question; the field behind it was deleted.
    await expect(
      update({
        fields: [
          {
            ...REGION_QUESTION,
            id: "gone",
            customFieldId: DELETED_FIELD_ID,
            label: "Old region",
          },
        ],
      }),
    ).resolves.toBeDefined();
    expect(customFieldFindBy).not.toHaveBeenCalled();
  });

  test("a custom field added by the update is checked", async () => {
    const error: Error | undefined = await refusal(
      update({
        fields: [{ ...REGION_QUESTION, customFieldId: FOREIGN_FIELD_ID }],
      }),
    );

    expect(error?.message).toContain(
      "a custom field this project does not have",
    );
  });

  test("a monitor the form already offers is not checked again; a new one is", async () => {
    storedForms = [
      storedForm({
        fields: [
          { ...MONITORS_QUESTION, allowedOptionIds: [FOREIGN_MONITOR_ID] },
        ] as unknown as JSONArray,
      }),
    ];

    await expect(
      update({
        fields: [
          { ...MONITORS_QUESTION, allowedOptionIds: [FOREIGN_MONITOR_ID] },
        ],
      }),
    ).resolves.toBeDefined();
    expect(monitorFindBy).not.toHaveBeenCalled();

    await expect(
      update({
        fields: [
          {
            ...MONITORS_QUESTION,
            allowedOptionIds: [FOREIGN_MONITOR_ID, MONITOR_ID],
          },
        ],
      }),
    ).resolves.toBeDefined();
    expect(monitorFindBy).toHaveBeenCalledTimes(1);
  });
});
