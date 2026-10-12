/*
 * The handlers' import graph reaches the native isolated-vm addon through
 * the incident services' template rendering. Nothing here touches the
 * sandbox, and the prebuilt binary cannot always load in a test worker.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../../Models/DatabaseModels/Form";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import {
  FormReferenceServiceFunction,
  FormSubmissionContext,
  FormTargetHelpers,
  SortedFormAnswers,
} from "../../../../Server/Utils/Form/FormTargetHandler";
import { getFormTargetHandler } from "../../../../Server/Utils/Form/FormTargets";
import IncidentFormTarget from "../../../../Server/Utils/Form/IncidentFormTarget";
import ScheduledMaintenanceFormTarget from "../../../../Server/Utils/Form/ScheduledMaintenanceFormTarget";
import { FormNoteAnswerFormat } from "../../../../Server/Utils/Form/FormSubmissionNote";
import logger from "../../../../Server/Utils/Logger";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  FormFieldSource,
  FormSubmitterField,
} from "../../../../Types/Form/FormField";
import {
  FormFieldBinding,
  PublicFormField,
  PublicFormFieldType,
  ValidatedFormAnswers,
} from "../../../../Types/Form/FormPublic";
import { getFormTargetField } from "../../../../Types/Form/FormTargetCatalog";
import { FormTargetSettingReferenceModel } from "../../../../Types/Form/FormTargetSettings";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const FORM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const ID_A: string = "3a4b5c6d-7e8f-4a0b-8c1d-2e3f4a5b6c7d";
const ID_B: string = "4b5c6d7e-8f9a-4b1c-9d2e-3f4a5b6c7d8e";
const ID_C: string = "5c6d7e8f-9a0b-4c2d-8e3f-4a5b6c7d8e9f";

function makeForm(data?: { name?: string | undefined }): Form {
  const form: Form = new Form();
  form._id = FORM_ID.toString();
  form.projectId = PROJECT_ID;
  if (data?.name !== undefined) {
    form.name = data.name;
  }
  return form;
}

function targetField(
  id: string,
  key: string,
  label: string,
  type: PublicFormFieldType,
): { field: PublicFormField; binding: FormFieldBinding } {
  return {
    field: { id: id, label: label, type: type, isRequired: false },
    binding: {
      source: FormFieldSource.TargetField,
      label: label,
      definition: getFormTargetField(FormTargetType.ScheduledMaintenance, key)!,
    },
  };
}

function buildContext(
  entries: Array<{ field: PublicFormField; binding?: FormFieldBinding }>,
  answers: ValidatedFormAnswers,
): FormSubmissionContext {
  const bindings: Record<string, FormFieldBinding> = {};

  for (const entry of entries) {
    if (entry.binding) {
      bindings[entry.field.id] = entry.binding;
    }
  }

  return {
    form: makeForm({ name: "Change Request" }),
    fields: entries.map(
      (entry: {
        field: PublicFormField;
        binding?: FormFieldBinding;
      }): PublicFormField => {
        return entry.field;
      },
    ),
    bindings: bindings,
    answers: answers,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("FormTargetHelpers.sortAnswers", () => {
  test("sorts every answer to where it goes", () => {
    const context: FormSubmissionContext = buildContext(
      [
        targetField("f-title", "title", "Summary", PublicFormFieldType.Text),
        {
          field: {
            id: "f-env",
            label: "Environment",
            type: PublicFormFieldType.Text,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.TargetCustomField,
            label: "Environment",
            customFieldId: ID_A,
            customFieldName: "environment",
            customFieldType: CustomFieldType.Text,
          },
        },
        {
          field: {
            id: "f-name",
            label: "Your Name",
            type: PublicFormFieldType.Text,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.Submitter,
            label: "Your Name",
            submitterField: FormSubmitterField.Name,
          },
        },
        {
          field: {
            id: "f-email",
            label: "Your Email",
            type: PublicFormFieldType.Email,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.Submitter,
            label: "Your Email",
            submitterField: FormSubmitterField.Email,
          },
        },
        {
          field: {
            id: "f-why",
            label: "Why?",
            type: PublicFormFieldType.LongText,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.Question,
            label: "Why?",
            type: CustomFieldType.LongText,
          },
        },
      ],
      {
        "f-title": "Upgrade the database",
        "f-env": "production",
        "f-name": "Jane",
        "f-email": "jane@example.com",
        "f-why": "Security patch\nneeded",
      },
    );

    const sorted: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    expect(sorted.targetFields).toEqual({ title: "Upgrade the database" });
    expect(sorted.targetFieldLabels).toEqual({ title: "Summary" });
    expect(sorted.customFields).toEqual({ environment: "production" });
    expect(sorted.submitterName).toBe("Jane");
    expect(sorted.submitterEmail).toBe("jane@example.com");
    expect(sorted.questions).toEqual([
      {
        label: "Why?",
        displayValue: "Security patch\nneeded",
        format: FormNoteAnswerFormat.MultiLine,
      },
    ]);
  });

  test("keeps the label of a built-in field left unanswered, for refusals", () => {
    const context: FormSubmissionContext = buildContext(
      [
        targetField(
          "f-start",
          "startsAt",
          "Maintenance begins",
          PublicFormFieldType.DateTime,
        ),
      ],
      {},
    );

    const sorted: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    expect(sorted.targetFields).toEqual({});
    expect(sorted.targetFieldLabels).toEqual({
      startsAt: "Maintenance begins",
    });
  });

  test("skips a field with no binding and leaves out an empty submitter answer", () => {
    const context: FormSubmissionContext = buildContext(
      [
        {
          field: {
            id: "f-orphan",
            label: "Orphan",
            type: PublicFormFieldType.Text,
            isRequired: false,
          },
        },
        {
          field: {
            id: "f-name",
            label: "Name",
            type: PublicFormFieldType.Text,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.Submitter,
            label: "Name",
            submitterField: FormSubmitterField.Name,
          },
        },
      ],
      { "f-orphan": "ignored", "f-name": "" },
    );

    const sorted: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    expect(sorted.targetFields).toEqual({});
    expect(sorted.questions).toEqual([]);
    expect(sorted.submitterName).toBeUndefined();
    expect(sorted.submitterEmail).toBeUndefined();
  });

  test("defines a custom field named __proto__ as an own value, not the prototype", () => {
    const context: FormSubmissionContext = buildContext(
      [
        {
          field: {
            id: "f-proto",
            label: "Proto",
            type: PublicFormFieldType.Text,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.TargetCustomField,
            label: "Proto",
            customFieldId: ID_A,
            customFieldName: "__proto__",
            customFieldType: CustomFieldType.Text,
          },
        },
      ],
      { "f-proto": "value" },
    );

    const sorted: SortedFormAnswers = FormTargetHelpers.sortAnswers(context);

    expect(
      Object.prototype.hasOwnProperty.call(sorted.customFields, "__proto__"),
    ).toBe(true);
    expect(Object.getPrototypeOf(sorted.customFields)).toBe(Object.prototype);
    expect(Object.keys(sorted.customFields)).toEqual(["__proto__"]);
  });

  test("formats each question for the note by its type, with option labels", () => {
    const context: FormSubmissionContext = buildContext(
      [
        {
          field: {
            id: "q-md",
            label: "Details",
            type: PublicFormFieldType.Markdown,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.Question,
            label: "Details",
            type: CustomFieldType.Markdown,
          },
        },
        {
          field: {
            id: "q-bool",
            label: "Urgent",
            type: PublicFormFieldType.Boolean,
            isRequired: false,
          },
          binding: {
            source: FormFieldSource.Question,
            label: "Urgent",
            type: CustomFieldType.Boolean,
          },
        },
        {
          field: {
            id: "q-pick",
            label: "Region",
            type: PublicFormFieldType.MultiSelectDropdown,
            isRequired: false,
            options: [
              { value: "eu", label: "Europe" },
              { value: "us", label: "United States" },
            ],
          },
          binding: {
            source: FormFieldSource.Question,
            label: "Region",
            type: CustomFieldType.MultiSelectDropdown,
          },
        },
      ],
      { "q-md": "**bold**", "q-bool": true, "q-pick": ["eu", "us"] },
    );

    expect(FormTargetHelpers.sortAnswers(context).questions).toEqual([
      {
        label: "Details",
        displayValue: "**bold**",
        format: FormNoteAnswerFormat.Markdown,
      },
      {
        label: "Urgent",
        displayValue: "Yes",
        format: FormNoteAnswerFormat.SingleLine,
      },
      {
        label: "Region",
        displayValue: "Europe, United States",
        format: FormNoteAnswerFormat.SingleLine,
      },
    ]);
  });
});

describe("FormTargetHelpers.getTitle", () => {
  test("prefers the submitter's answer", () => {
    expect(
      FormTargetHelpers.getTitle({
        answered: "Answered",
        defaultTitle: "Default",
        form: makeForm({ name: "Form" }),
      }),
    ).toBe("Answered");
  });

  test("falls back to the default title, then the form's name, then a fixed text", () => {
    expect(
      FormTargetHelpers.getTitle({
        answered: "",
        defaultTitle: "Default",
        form: makeForm({ name: "Form" }),
      }),
    ).toBe("Default");

    expect(
      FormTargetHelpers.getTitle({
        answered: 42,
        defaultTitle: undefined,
        form: makeForm({ name: "Form" }),
      }),
    ).toBe("Form");

    expect(
      FormTargetHelpers.getTitle({
        answered: undefined,
        defaultTitle: undefined,
        form: makeForm(),
      }),
    ).toBe("Form submission");
  });
});

describe("FormTargetHelpers.readIds / mergeIds", () => {
  test("reads one id or a list, lowercased, each once, dropping what is not an id", () => {
    expect(FormTargetHelpers.readIds(ID_A.toUpperCase())).toEqual([ID_A]);
    expect(
      FormTargetHelpers.readIds([
        ` ${ID_A} `,
        ID_B,
        ID_A.toUpperCase(),
        "not-an-id",
        7,
        null,
      ]),
    ).toEqual([ID_A, ID_B]);
    expect(FormTargetHelpers.readIds(undefined)).toEqual([]);
    expect(FormTargetHelpers.readIds(null)).toEqual([]);
    expect(FormTargetHelpers.readIds(true)).toEqual([]);
  });

  test("merges lists in order, each id once, ignoring invalid ids", () => {
    const merged: Array<ObjectID> = FormTargetHelpers.mergeIds(
      [ID_B, ID_A],
      [new ObjectID(ID_A.toUpperCase()), ID_C, "bogus"],
    );

    expect(
      merged.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([ID_B, ID_A, ID_C]);
    expect(FormTargetHelpers.mergeIds()).toEqual([]);
  });
});

describe("FormTargetHelpers.readDate", () => {
  test("reads an ISO string or a timestamp", () => {
    expect(
      FormTargetHelpers.readDate("2026-10-11T08:00:00.000Z")?.toISOString(),
    ).toBe("2026-10-11T08:00:00.000Z");
    expect(FormTargetHelpers.readDate(0)?.toISOString()).toBe(
      "1970-01-01T00:00:00.000Z",
    );
  });

  test("answers undefined for no answer or one that is not a date", () => {
    expect(FormTargetHelpers.readDate(undefined)).toBeUndefined();
    expect(FormTargetHelpers.readDate(null)).toBeUndefined();
    expect(FormTargetHelpers.readDate(true)).toBeUndefined();
    expect(FormTargetHelpers.readDate("tomorrow-ish")).toBeUndefined();
    expect(FormTargetHelpers.readDate({} as JSONObject)).toBeUndefined();
  });
});

describe("FormTargetHelpers.toStubs", () => {
  test("builds models carrying only the id", () => {
    const stubs: Array<Label> = FormTargetHelpers.toStubs(Label, [
      new ObjectID(ID_A),
      new ObjectID(ID_B),
    ]);

    expect(stubs).toHaveLength(2);
    expect(stubs[0]).toBeInstanceOf(Label);
    expect(stubs[0]!._id).toBe(ID_A);
    expect(stubs[1]!._id).toBe(ID_B);
    expect(stubs[0]!.name).toBeUndefined();
  });
});

describe("FormTargetHelpers.getUsableIds", () => {
  test("asks nothing for no ids", async () => {
    const filter: SpyInstance<
      typeof ProjectScopedReferenceValidator.filterUsableInProject
    > = jest.spyOn(ProjectScopedReferenceValidator, "filterUsableInProject");

    expect(
      await FormTargetHelpers.getUsableIds({
        projectId: PROJECT_ID,
        ids: [],
        service:
          MonitorService as unknown as DatabaseService<DatabaseBaseModel>,
        form: makeForm(),
      }),
    ).toEqual([]);
    expect(
      await FormTargetHelpers.getUsableIds({
        projectId: PROJECT_ID,
        ids: undefined,
        service:
          MonitorService as unknown as DatabaseService<DatabaseBaseModel>,
        form: makeForm(),
      }),
    ).toEqual([]);
    expect(filter).not.toHaveBeenCalled();
  });

  test("keeps only the records the project's own lookup finds", async () => {
    jest.spyOn(MonitorService, "findOneBy").mockImplementation((async (findBy: {
      query: { _id: string; projectId: ObjectID };
    }): Promise<Monitor | null> => {
      if (
        findBy.query._id === ID_A &&
        findBy.query.projectId.toString() === PROJECT_ID.toString()
      ) {
        const monitor: Monitor = new Monitor();
        monitor._id = ID_A;
        return monitor;
      }
      return null;
    }) as never);

    const usable: Array<ObjectID> = await FormTargetHelpers.getUsableIds({
      projectId: PROJECT_ID,
      ids: [ID_A, ID_B],
      service: MonitorService as unknown as DatabaseService<DatabaseBaseModel>,
      form: makeForm(),
    });

    expect(
      usable.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([ID_A]);
  });

  test("never throws: a lookup that fails leaves the records out and is logged", async () => {
    jest
      .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
      .mockRejectedValue(new Error("database down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    expect(
      await FormTargetHelpers.getUsableIds({
        projectId: PROJECT_ID,
        ids: [ID_A],
        service: LabelService as unknown as DatabaseService<DatabaseBaseModel>,
        form: makeForm(),
      }),
    ).toEqual([]);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(
        `could not check the records form ${FORM_ID.toString()} names`,
      ),
      { projectId: PROJECT_ID.toString(), formId: FORM_ID.toString() },
    );
  });
});

describe("FormTargetHelpers.getUsableOwnerUserIds", () => {
  test("keeps only the project's members", async () => {
    const members: SpyInstance<
      typeof TeamMemberService.getProjectMemberUserIds
    > = jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockResolvedValue([new ObjectID(ID_B)]);

    const usable: Array<ObjectID> =
      await FormTargetHelpers.getUsableOwnerUserIds({
        projectId: PROJECT_ID,
        ids: [ID_A, ID_B],
        form: makeForm(),
      });

    expect(members).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userIds: [ID_A, ID_B],
    });
    expect(usable[0]!.toString()).toBe(ID_B);
  });

  test("asks nothing for no owners, and never throws", async () => {
    const members: SpyInstance<
      typeof TeamMemberService.getProjectMemberUserIds
    > = jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockRejectedValue(new Error("database down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    expect(
      await FormTargetHelpers.getUsableOwnerUserIds({
        projectId: PROJECT_ID,
        ids: [],
        form: makeForm(),
      }),
    ).toEqual([]);
    expect(members).not.toHaveBeenCalled();

    expect(
      await FormTargetHelpers.getUsableOwnerUserIds({
        projectId: PROJECT_ID,
        ids: [ID_A],
        form: makeForm(),
      }),
    ).toEqual([]);
    expect(members).toHaveBeenCalledTimes(1);
  });
});

describe("FormTargetHelpers.validateSettingReferences", () => {
  const getService: FormReferenceServiceFunction = (
    model: FormTargetSettingReferenceModel,
  ): DatabaseService<DatabaseBaseModel> | null => {
    return model === FormTargetSettingReferenceModel.Label
      ? (LabelService as unknown as DatabaseService<DatabaseBaseModel>)
      : null;
  };

  test("checks a setting's records against the form's project", async () => {
    const validate: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);

    await FormTargetHelpers.validateSettingReferences({
      projectId: PROJECT_ID,
      references: [
        {
          title: "Labels",
          model: FormTargetSettingReferenceModel.Label,
          ids: [ID_A, ID_B],
        },
      ],
      getService: getService,
    });

    expect(validate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      subject: "form",
      references: [
        { modelName: "Labels", id: ID_A, service: LabelService },
        { modelName: "Labels", id: ID_B, service: LabelService },
      ],
    });
  });

  test("passes on the refusal for a record of another project", async () => {
    jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockRejectedValue(new BadDataException("Labels is not in this project"));

    await expect(
      FormTargetHelpers.validateSettingReferences({
        projectId: PROJECT_ID,
        references: [
          {
            title: "Labels",
            model: FormTargetSettingReferenceModel.Label,
            ids: [ID_A],
          },
        ],
        getService: getService,
      }),
    ).rejects.toThrow("Labels is not in this project");
  });

  test("refuses owners who are not all members of the project", async () => {
    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockResolvedValue([new ObjectID(ID_A)]);

    await expect(
      FormTargetHelpers.validateSettingReferences({
        projectId: PROJECT_ID,
        references: [
          {
            title: "Owner Users",
            model: FormTargetSettingReferenceModel.User,
            ids: [ID_A, ID_B],
          },
        ],
        getService: getService,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Owner Users: every owner must be a member of this project.",
      ),
    );
  });

  test("accepts owners who are all members, without a record lookup", async () => {
    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockResolvedValue([new ObjectID(ID_A), new ObjectID(ID_B)]);
    const validate: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest.spyOn(
      ProjectScopedReferenceValidator,
      "validateReferencesBelongToProject",
    );

    await FormTargetHelpers.validateSettingReferences({
      projectId: PROJECT_ID,
      references: [
        {
          title: "Owner Users",
          model: FormTargetSettingReferenceModel.User,
          ids: [ID_A, ID_B],
        },
      ],
      getService: getService,
    });

    expect(validate).not.toHaveBeenCalled();
  });

  test("refuses a kind of record it has no service to check", async () => {
    await expect(
      FormTargetHelpers.validateSettingReferences({
        projectId: PROJECT_ID,
        references: [
          {
            title: "On-Call Policies",
            model: FormTargetSettingReferenceModel.OnCallDutyPolicy,
            ids: [ID_A],
          },
        ],
        getService: getService,
      }),
    ).rejects.toThrow(
      new BadDataException(
        "On-Call Policies cannot be checked against this project.",
      ),
    );
  });
});

describe("FormTargetHelpers.getLogAttributes", () => {
  test("names the form and its project", () => {
    expect(FormTargetHelpers.getLogAttributes(makeForm())).toEqual({
      projectId: PROJECT_ID.toString(),
      formId: FORM_ID.toString(),
    });
  });
});

describe("getFormTargetHandler", () => {
  test("answers the handler for each target", () => {
    const maintenance: unknown = getFormTargetHandler(
      FormTargetType.ScheduledMaintenance,
    );
    const incident: unknown = getFormTargetHandler(FormTargetType.Incident);

    expect(maintenance).toBeInstanceOf(ScheduledMaintenanceFormTarget);
    expect((maintenance as ScheduledMaintenanceFormTarget).targetType).toBe(
      FormTargetType.ScheduledMaintenance,
    );
    expect(incident).toBeInstanceOf(IncidentFormTarget);
    expect((incident as IncidentFormTarget).targetType).toBe(
      FormTargetType.Incident,
    );
  });

  test("answers the incident handler for an unknown target", () => {
    expect(
      getFormTargetHandler("Unknown" as unknown as FormTargetType),
    ).toBeInstanceOf(IncidentFormTarget);
  });
});
