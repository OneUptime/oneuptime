jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertCustomField from "../../../../Models/DatabaseModels/AlertCustomField";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../../Models/DatabaseModels/Form";
import Label from "../../../../Models/DatabaseModels/Label";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import AlertCustomFieldService from "../../../../Server/Services/AlertCustomFieldService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import AlertStateService from "../../../../Server/Services/AlertStateService";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AlertFormTarget, {
  FORM_NO_ALERT_SEVERITY_MESSAGE,
  PreparedAlert,
} from "../../../../Server/Utils/Form/AlertFormTarget";
import { FormSubmissionContext } from "../../../../Server/Utils/Form/FormTargetHandler";
import { getFormTargetHandler } from "../../../../Server/Utils/Form/FormTargets";
import logger from "../../../../Server/Utils/Logger";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import CustomFieldType from "../../../../Types/CustomField/CustomFieldType";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ServerException from "../../../../Types/Exception/ServerException";
import {
  FormFieldSource,
  FormSubmitterField,
} from "../../../../Types/Form/FormField";
import {
  FormCustomFieldDefinition,
  FormFieldBinding,
  PublicFormField,
  PublicFormFieldType,
  ValidatedFormAnswers,
} from "../../../../Types/Form/FormPublic";
import { getFormTargetField } from "../../../../Types/Form/FormTargetCatalog";
import FormTargetType from "../../../../Types/Form/FormTargetType";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A form that creates alerts (#10760): what each submission's alert is made
 * of, and what refuses it.
 *
 * Pinned here, with the database stubbed:
 *
 *   - the records the form's settings name are checked against its project,
 *     by kind - an alert severity, an alert state, a monitor, labels,
 *     on-call policies, owner users (members) and teams;
 *   - the alert's severity is the submitter's choice, else the form's while
 *     it still exists; with neither, the submission is refused with a
 *     message the submitter can pass on, before anything is created;
 *   - its monitor is the submitter's, else the form's; its labels the
 *     submitter's with the form's added, each once and only the project's;
 *     the state it starts in the form's, else the usual starting state; its
 *     on-call policies and owners the form's, minus any deleted since or any
 *     member who left;
 *   - it is created as root in the form's project through AlertService - so
 *     its hooks, timelines, rules and notifications run as for any alert -
 *     with its owners sent with the create for the service to add, and no
 *     user recorded as having created it;
 *   - who sent it, and the other answers, go on a private note on it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const FORM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const SEVERITY_OWN: string = "a0000000-0000-4000-8000-000000000001";
const SEVERITY_ANSWERED: string = "a0000000-0000-4000-8000-000000000002";
const SEVERITY_FOREIGN: string = "a0000000-0000-4000-8000-000000000003";
const SEVERITY_DELETED: string = "a0000000-0000-4000-8000-000000000004";
const STATE_ACKNOWLEDGED: string = "b0000000-0000-4000-8000-000000000001";
const STATE_DELETED: string = "b0000000-0000-4000-8000-000000000002";
const MONITOR_OWN: string = "c0000000-0000-4000-8000-000000000001";
const MONITOR_ANSWERED: string = "c0000000-0000-4000-8000-000000000002";
const MONITOR_DELETED: string = "c0000000-0000-4000-8000-000000000003";
const LABEL_OWN: string = "d0000000-0000-4000-8000-000000000001";
const LABEL_ANSWERED: string = "d0000000-0000-4000-8000-000000000002";
const LABEL_FOREIGN: string = "d0000000-0000-4000-8000-000000000003";
const POLICY_OWN: string = "e0000000-0000-4000-8000-000000000001";
const POLICY_DELETED: string = "e0000000-0000-4000-8000-000000000002";
const TEAM_OWN: string = "f0000000-0000-4000-8000-000000000001";
const TEAM_FOREIGN: string = "f0000000-0000-4000-8000-000000000002";
const USER_MEMBER: string = "f1000000-0000-4000-8000-000000000001";
const USER_LEFT: string = "f1000000-0000-4000-8000-000000000002";
const FILE_ID: string = "f2000000-0000-4000-8000-000000000001";

const IMPACT_STARTED_AT: string = "2026-11-01T02:00:00.000Z";

interface FieldEntry {
  field: PublicFormField;
  binding: FormFieldBinding;
}

function targetField(
  key: string,
  label: string,
  type: PublicFormFieldType,
): FieldEntry {
  return {
    field: { id: `f-${key}`, label: label, type: type, isRequired: false },
    binding: {
      source: FormFieldSource.TargetField,
      label: label,
      definition: getFormTargetField(FormTargetType.Alert, key)!,
    },
  };
}

const TITLE: FieldEntry = targetField(
  "title",
  "What needs a look?",
  PublicFormFieldType.Text,
);
const DESCRIPTION: FieldEntry = targetField(
  "description",
  "Details",
  PublicFormFieldType.Markdown,
);
const SEVERITY: FieldEntry = targetField(
  "alertSeverityId",
  "Severity",
  PublicFormFieldType.Dropdown,
);
const MONITOR: FieldEntry = targetField(
  "monitor",
  "Affected Monitor",
  PublicFormFieldType.Dropdown,
);
const LABELS: FieldEntry = targetField(
  "labels",
  "Labels",
  PublicFormFieldType.MultiSelectDropdown,
);
const IMPACT: FieldEntry = targetField(
  "impactStartedAt",
  "When did it start?",
  PublicFormFieldType.DateTime,
);
const ENVIRONMENT: FieldEntry = {
  field: {
    id: "f-env",
    label: "Environment",
    type: PublicFormFieldType.Text,
    isRequired: false,
  },
  binding: {
    source: FormFieldSource.TargetCustomField,
    label: "Environment",
    customFieldId: "f3000000-0000-4000-8000-000000000001",
    customFieldName: "environment",
    customFieldType: CustomFieldType.Text,
  },
};
const SUBMITTER_EMAIL: FieldEntry = {
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
};
const WHERE: FieldEntry = {
  field: {
    id: "f-where",
    label: "Where did you see it?",
    type: PublicFormFieldType.Text,
    isRequired: false,
  },
  binding: {
    source: FormFieldSource.Question,
    label: "Where did you see it?",
    type: CustomFieldType.Text,
  },
};

const ALL_FIELDS: Array<FieldEntry> = [
  TITLE,
  DESCRIPTION,
  SEVERITY,
  MONITOR,
  LABELS,
  IMPACT,
  ENVIRONMENT,
  SUBMITTER_EMAIL,
  WHERE,
];

function makeForm(settings?: JSONObject | undefined): Form {
  const form: Form = new Form();
  form._id = FORM_ID.toString();
  form.projectId = PROJECT_ID;
  form.name = "Something Looks Wrong";
  form.targetType = FormTargetType.Alert;
  if (settings !== undefined) {
    form.targetSettings = settings;
  }
  return form;
}

function buildContext(data: {
  answers: ValidatedFormAnswers;
  settings?: JSONObject | undefined;
  fields?: Array<FieldEntry> | undefined;
}): FormSubmissionContext {
  const fields: Array<FieldEntry> = data.fields || ALL_FIELDS;
  const bindings: Record<string, FormFieldBinding> = {};

  for (const entry of fields) {
    bindings[entry.field.id] = entry.binding;
  }

  return {
    form: makeForm(data.settings),
    fields: fields.map((entry: FieldEntry): PublicFormField => {
      return entry.field;
    }),
    bindings: bindings,
    answers: data.answers,
  };
}

function idsOf(list: Array<ObjectID>): Array<string> {
  return list.map((id: ObjectID): string => {
    return id.toString();
  });
}

function stubIds(
  list: Array<{ _id?: string | undefined }> | undefined,
): Array<string> {
  return (list || []).map((item: { _id?: string | undefined }): string => {
    return String(item._id);
  });
}

/*
 * The records a project has, by service: a usable record is one found by
 * id in the form's project (ProjectScopedReferenceValidator's reads).
 */
function registerRecords(
  service: { findOneBy: unknown },
  rows: Array<{ id: string; projectId: ObjectID }>,
): void {
  jest
    .spyOn(service as never, "findOneBy" as never)
    .mockImplementation((async (findBy: {
      query: { _id: unknown; projectId: unknown };
    }): Promise<DatabaseBaseModel | null> => {
      const found: { id: string; projectId: ObjectID } | undefined = rows.find(
        (row: { id: string; projectId: ObjectID }): boolean => {
          return (
            row.id === String(findBy.query._id).toLowerCase() &&
            row.projectId.toString() === String(findBy.query.projectId)
          );
        },
      );

      if (!found) {
        return null;
      }

      const model: Label = new Label();
      model._id = found.id;
      return model;
    }) as never);
}

function registerProjectRecords(): void {
  registerRecords(AlertSeverityService, [
    { id: SEVERITY_OWN, projectId: PROJECT_ID },
    { id: SEVERITY_ANSWERED, projectId: PROJECT_ID },
    { id: SEVERITY_FOREIGN, projectId: OTHER_PROJECT_ID },
  ]);
  registerRecords(AlertStateService, [
    { id: STATE_ACKNOWLEDGED, projectId: PROJECT_ID },
  ]);
  registerRecords(MonitorService, [
    { id: MONITOR_OWN, projectId: PROJECT_ID },
    { id: MONITOR_ANSWERED, projectId: PROJECT_ID },
  ]);
  registerRecords(LabelService, [
    { id: LABEL_OWN, projectId: PROJECT_ID },
    { id: LABEL_ANSWERED, projectId: PROJECT_ID },
    { id: LABEL_FOREIGN, projectId: OTHER_PROJECT_ID },
  ]);
  registerRecords(OnCallDutyPolicyService, [
    { id: POLICY_OWN, projectId: PROJECT_ID },
  ]);
  registerRecords(TeamService, [
    { id: TEAM_OWN, projectId: PROJECT_ID },
    { id: TEAM_FOREIGN, projectId: OTHER_PROJECT_ID },
  ]);
  jest
    .spyOn(TeamMemberService, "getProjectMemberUserIds")
    .mockImplementation(
      async (data: {
        projectId: ObjectID;
        userIds: Array<ObjectID | string>;
      }): Promise<Array<ObjectID>> => {
        return data.userIds
          .map((id: ObjectID | string): string => {
            return id.toString();
          })
          .filter((id: string): boolean => {
            return id === USER_MEMBER;
          })
          .map((id: string): ObjectID => {
            return new ObjectID(id);
          });
      },
    );
}

const handler: AlertFormTarget = new AlertFormTarget();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AlertFormTarget", () => {
  test("is the alert target, and the one the forms' handlers give for it", () => {
    expect(handler.targetType).toBe(FormTargetType.Alert);
    expect(getFormTargetHandler(FormTargetType.Alert)).toBeInstanceOf(
      AlertFormTarget,
    );
  });

  test("a severity question starts on the form's own severity", () => {
    expect(
      handler.getDefaultOptionValues({
        alertSeverityId: SEVERITY_OWN.toUpperCase(),
      }),
    ).toEqual({ alertSeverityId: SEVERITY_OWN });
  });

  test("with no severity of its own, or another target's, a question starts empty", () => {
    expect(handler.getDefaultOptionValues({})).toEqual({});
    expect(
      handler.getDefaultOptionValues({ incidentSeverityId: SEVERITY_OWN }),
    ).toEqual({});
  });
});

describe("AlertFormTarget.getCustomFieldDefinitions", () => {
  test("reads the project's alert custom fields, as root, by name", async () => {
    const findBy: SpyInstance<typeof AlertCustomFieldService.findBy> = jest
      .spyOn(AlertCustomFieldService, "findBy")
      .mockResolvedValue([
        Object.assign(new AlertCustomField(), {
          _id: "f3000000-0000-4000-8000-000000000001",
          name: "environment",
          description: "Where it happened",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: "production\nstaging",
        }),
        // A field with no name cannot be asked.
        Object.assign(new AlertCustomField(), {
          _id: "f3000000-0000-4000-8000-000000000002",
        }),
      ]);

    const definitions: Array<FormCustomFieldDefinition> =
      await handler.getCustomFieldDefinitions(PROJECT_ID);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      query: { projectId: PROJECT_ID },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });
    expect(definitions).toEqual([
      {
        id: "f3000000-0000-4000-8000-000000000001",
        name: "environment",
        description: "Where it happened",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "production\nstaging",
      },
    ]);
  });
});

describe("AlertFormTarget.validateReferences", () => {
  test("checks every record the settings name against the form's project, by kind", async () => {
    const validate: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);
    const members: SpyInstance<
      typeof TeamMemberService.getProjectMemberUserIds
    > = jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockResolvedValue([new ObjectID(USER_MEMBER)]);

    await handler.validateReferences({
      projectId: PROJECT_ID,
      settings: {
        defaultTitle: "Something to check",
        alertSeverityId: SEVERITY_OWN.toUpperCase(),
        alertStateId: STATE_ACKNOWLEDGED,
        monitorId: MONITOR_OWN,
        labelIds: [LABEL_OWN],
        onCallDutyPolicyIds: [POLICY_OWN],
        ownerUserIds: [USER_MEMBER],
        ownerTeamIds: [TEAM_OWN],
      },
    });

    // Owners are members of the project.
    expect(members).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userIds: [USER_MEMBER],
    });

    const checked: Array<{ modelName: string; id: string; service: unknown }> =
      validate.mock.calls.flatMap(
        (
          call: Parameters<
            typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
          >,
        ): Array<{ modelName: string; id: string; service: unknown }> => {
          expect(call[0].projectId).toBe(PROJECT_ID);
          return call[0].references.map(
            (reference: {
              modelName: string;
              id: unknown;
              service: unknown;
            }): { modelName: string; id: string; service: unknown } => {
              return {
                modelName: reference.modelName,
                id: String(reference.id),
                service: reference.service,
              };
            },
          );
        },
      );

    expect(checked).toEqual([
      {
        modelName: "Severity",
        id: SEVERITY_OWN,
        service: AlertSeverityService,
      },
      {
        modelName: "Initial State",
        id: STATE_ACKNOWLEDGED,
        service: AlertStateService,
      },
      { modelName: "Monitor", id: MONITOR_OWN, service: MonitorService },
      { modelName: "Labels", id: LABEL_OWN, service: LabelService },
      {
        modelName: "On-Call Policies",
        id: POLICY_OWN,
        service: OnCallDutyPolicyService,
      },
      { modelName: "Owner Teams", id: TEAM_OWN, service: TeamService },
    ]);
  });

  test("ignores settings another target has", async () => {
    const validate: SpyInstance<
      typeof ProjectScopedReferenceValidator.validateReferencesBelongToProject
    > = jest
      .spyOn(
        ProjectScopedReferenceValidator,
        "validateReferencesBelongToProject",
      )
      .mockResolvedValue(undefined);

    await handler.validateReferences({
      projectId: PROJECT_ID,
      settings: {
        incidentSeverityId: SEVERITY_OWN,
        incidentTemplateId: SEVERITY_OWN,
        monitorIds: [MONITOR_OWN],
        statusPageIds: [MONITOR_OWN],
      },
    });

    expect(validate).not.toHaveBeenCalled();
  });

  test("refuses a setting naming another project's record", async () => {
    // The project's own read finds no such label.
    jest.spyOn(LabelService, "findBy").mockResolvedValue([]);

    await expect(
      handler.validateReferences({
        projectId: PROJECT_ID,
        settings: { labelIds: [LABEL_FOREIGN] },
      }),
    ).rejects.toThrow(LABEL_FOREIGN);
  });

  test("refuses an owner who is not a member of the project", async () => {
    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockResolvedValue([new ObjectID(USER_MEMBER)]);

    await expect(
      handler.validateReferences({
        projectId: PROJECT_ID,
        settings: { ownerUserIds: [USER_MEMBER, USER_LEFT] },
      }),
    ).rejects.toThrow(
      new BadDataException(
        "Owner Users: every owner must be a member of this project.",
      ),
    );
  });
});

describe("AlertFormTarget.prepare: the severity", () => {
  beforeEach(() => {
    registerProjectRecords();
  });

  test("is the one the submitter chose", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: { "f-alertSeverityId": SEVERITY_ANSWERED },
        settings: { alertSeverityId: SEVERITY_OWN },
      }),
    );

    expect(prepared.alertSeverityId.toString()).toBe(SEVERITY_ANSWERED);
  });

  test("else the form's own, while it is still the project's", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: { alertSeverityId: SEVERITY_OWN },
      }),
    );

    expect(prepared.alertSeverityId.toString()).toBe(SEVERITY_OWN);
  });

  test("with neither, the submission is refused with a message the submitter can pass on", async () => {
    await expect(
      handler.prepare(buildContext({ answers: {}, settings: {} })),
    ).rejects.toThrow(new BadDataException(FORM_NO_ALERT_SEVERITY_MESSAGE));
    expect(FORM_NO_ALERT_SEVERITY_MESSAGE).toBe(
      "This form cannot create an alert because it has no severity. Please let the team that shared it know.",
    );
  });

  test.each([
    ["deleted since it was chosen", SEVERITY_DELETED],
    ["of another project", SEVERITY_FOREIGN],
  ])(
    "a form's severity %s is no severity",
    async (_why: string, severityId: string) => {
      await expect(
        handler.prepare(
          buildContext({
            answers: {},
            settings: { alertSeverityId: severityId },
          }),
        ),
      ).rejects.toThrow(new BadDataException(FORM_NO_ALERT_SEVERITY_MESSAGE));
    },
  );

  test("an incident severity in the settings is not an alert's", async () => {
    await expect(
      handler.prepare(
        buildContext({
          answers: {},
          settings: { incidentSeverityId: SEVERITY_OWN },
        }),
      ),
    ).rejects.toThrow(new BadDataException(FORM_NO_ALERT_SEVERITY_MESSAGE));
  });

  test("a refused submission creates nothing", async () => {
    const create: SpyInstance<typeof AlertService.create> = jest.spyOn(
      AlertService,
      "create",
    );

    await expect(
      handler.prepare(buildContext({ answers: {}, settings: {} })),
    ).rejects.toThrow(FORM_NO_ALERT_SEVERITY_MESSAGE);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("AlertFormTarget.prepare: records", () => {
  beforeEach(() => {
    registerProjectRecords();
  });

  test("the monitor is the one the submitter chose, else the form's", async () => {
    const answered: PreparedAlert = await handler.prepare(
      buildContext({
        answers: { "f-monitor": MONITOR_ANSWERED },
        settings: { alertSeverityId: SEVERITY_OWN, monitorId: MONITOR_OWN },
      }),
    );
    const unanswered: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: { alertSeverityId: SEVERITY_OWN, monitorId: MONITOR_OWN },
      }),
    );

    expect(answered.monitorId?.toString()).toBe(MONITOR_ANSWERED);
    expect(unanswered.monitorId?.toString()).toBe(MONITOR_OWN);
  });

  test("a form's monitor deleted since leaves the alert without one", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: {
          alertSeverityId: SEVERITY_OWN,
          monitorId: MONITOR_DELETED,
        },
      }),
    );

    expect(prepared.monitorId).toBeUndefined();
    expect("monitorId" in prepared).toBe(false);
  });

  test("labels are the submitter's, then the form's, each once and only the project's", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: { "f-labels": [LABEL_ANSWERED, LABEL_OWN.toUpperCase()] },
        settings: {
          alertSeverityId: SEVERITY_OWN,
          labelIds: [LABEL_OWN, LABEL_FOREIGN],
        },
      }),
    );

    expect(idsOf(prepared.labelIds)).toEqual([LABEL_ANSWERED, LABEL_OWN]);
  });

  test("the state it starts in is the form's, while it is still the project's", async () => {
    const acknowledged: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: {
          alertSeverityId: SEVERITY_OWN,
          alertStateId: STATE_ACKNOWLEDGED,
        },
      }),
    );
    const deleted: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: {
          alertSeverityId: SEVERITY_OWN,
          alertStateId: STATE_DELETED,
        },
      }),
    );

    expect(acknowledged.alertStateId?.toString()).toBe(STATE_ACKNOWLEDGED);
    // The usual starting state: AlertService's own, as for any alert.
    expect(deleted.alertStateId).toBeUndefined();
    expect("alertStateId" in deleted).toBe(false);
  });

  test("on-call policies and owners are the form's, less any deleted since or any member who left", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: {
          alertSeverityId: SEVERITY_OWN,
          onCallDutyPolicyIds: [POLICY_OWN, POLICY_DELETED],
          ownerUserIds: [USER_MEMBER, USER_LEFT],
          ownerTeamIds: [TEAM_OWN, TEAM_FOREIGN],
        },
      }),
    );

    expect(idsOf(prepared.onCallDutyPolicyIds)).toEqual([POLICY_OWN]);
    expect(idsOf(prepared.ownerUserIds)).toEqual([USER_MEMBER]);
    expect(idsOf(prepared.ownerTeamIds)).toEqual([TEAM_OWN]);
  });

  test("the impact start is the submitter's answer", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: { "f-impactStartedAt": IMPACT_STARTED_AT },
        settings: { alertSeverityId: SEVERITY_OWN },
      }),
    );

    expect(prepared.impactStartedAt?.toISOString()).toBe(IMPACT_STARTED_AT);
  });

  test("a form that sets nothing but a severity prepares an alert with nothing else", async () => {
    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: { alertSeverityId: SEVERITY_OWN },
      }),
    );

    expect(prepared).toEqual({
      alertSeverityId: new ObjectID(SEVERITY_OWN),
      labelIds: [],
      onCallDutyPolicyIds: [],
      ownerUserIds: [],
      ownerTeamIds: [],
    });
  });

  test("goes ahead without the settings' records when they cannot be checked", async () => {
    jest
      .spyOn(LabelService, "findOneBy")
      .mockRejectedValue(new Error("The database is not answering."));
    const errors: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((() => {
        // quiet
      }) as never);

    const prepared: PreparedAlert = await handler.prepare(
      buildContext({
        answers: {},
        settings: { alertSeverityId: SEVERITY_OWN, labelIds: [LABEL_OWN] },
      }),
    );

    expect(prepared.labelIds).toEqual([]);
    expect(prepared.alertSeverityId.toString()).toBe(SEVERITY_OWN);
    expect(errors).toHaveBeenCalled();
  });
});

describe("AlertFormTarget.create", () => {
  let created: Array<CreateBy<Alert>> = [];

  function prepared(overrides?: Partial<PreparedAlert>): PreparedAlert {
    return {
      alertSeverityId: new ObjectID(SEVERITY_OWN),
      labelIds: [],
      onCallDutyPolicyIds: [],
      ownerUserIds: [],
      ownerTeamIds: [],
      ...overrides,
    };
  }

  function mockCreate(result?: Partial<Alert>): void {
    jest
      .spyOn(AlertService, "create")
      .mockImplementation(async (createBy: CreateBy<Alert>): Promise<Alert> => {
        created.push(createBy);
        const alert: Alert = new Alert();
        if (result?._id !== undefined) {
          alert._id = result._id;
        }
        if (result?.alertNumber !== undefined) {
          alert.alertNumber = result.alertNumber;
        }
        if (result?.alertNumberWithPrefix !== undefined) {
          alert.alertNumberWithPrefix = result.alertNumberWithPrefix;
        }
        return alert;
      });
  }

  beforeEach(() => {
    created = [];
  });

  test("creates the alert as root in the form's project, with every option", async () => {
    mockCreate({
      _id: ALERT_ID.toString(),
      alertNumber: 7,
      alertNumberWithPrefix: "ALT-7",
    });

    const result: { id: ObjectID; reference?: string | undefined } =
      await handler.create({
        context: buildContext({
          answers: {
            "f-title": "Checkout is slow",
            "f-description": "Since **noon**, from the EU.",
            "f-env": "production",
            "f-email": "someone@example.com",
            "f-where": "On the checkout page",
          },
          settings: { alertSeverityId: SEVERITY_OWN },
        }),
        prepared: prepared({
          alertStateId: new ObjectID(STATE_ACKNOWLEDGED),
          monitorId: new ObjectID(MONITOR_OWN),
          impactStartedAt: new Date(IMPACT_STARTED_AT),
          labelIds: [new ObjectID(LABEL_ANSWERED), new ObjectID(LABEL_OWN)],
          onCallDutyPolicyIds: [new ObjectID(POLICY_OWN)],
        }),
      });

    expect(created).toHaveLength(1);

    const createBy: CreateBy<Alert> = created[0]!;
    const alert: Alert = createBy.data;

    // As root: the form's settings were checked when they were saved.
    expect(createBy.props).toEqual({ isRoot: true });
    expect(alert).toBeInstanceOf(Alert);
    expect(alert.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(alert.title).toBe("Checkout is slow");
    expect(alert.description).toBe("Since **noon**, from the EU.");
    expect(alert.alertSeverityId?.toString()).toBe(SEVERITY_OWN);
    expect(alert.currentAlertStateId?.toString()).toBe(STATE_ACKNOWLEDGED);
    expect(alert.monitorId?.toString()).toBe(MONITOR_OWN);
    expect(alert.impactStartedAt?.toISOString()).toBe(IMPACT_STARTED_AT);
    expect(stubIds(alert.labels as never)).toEqual([LABEL_ANSWERED, LABEL_OWN]);
    expect(stubIds(alert.onCallDutyPolicies as never)).toEqual([POLICY_OWN]);
    // A custom field question writes its field; the others are the note's.
    expect(alert.customFields).toEqual({ environment: "production" });
    // Nobody signed in to send it, and nothing makes it private here.
    expect(alert.createdByUserId).toBeUndefined();
    expect(alert.isPrivate).toBeUndefined();
    expect(createBy.miscDataProps).toBeUndefined();

    expect(result.id.toString()).toBe(ALERT_ID.toString());
    expect(result.reference).toBe("ALT-7");
  });

  test("leaves out an unset state, monitor and impact start, empty lists and an empty description", async () => {
    mockCreate({ _id: ALERT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: { "f-title": "Checkout is slow", "f-description": "" },
      }),
      prepared: prepared(),
    });

    const alert: Alert = created[0]!.data;

    // AlertService then starts it as any alert: in the usual starting state.
    expect(alert.currentAlertStateId).toBeUndefined();
    expect(alert.monitorId).toBeUndefined();
    expect(alert.impactStartedAt).toBeUndefined();
    expect(alert.description).toBeUndefined();
    expect(alert.labels).toBeUndefined();
    expect(alert.onCallDutyPolicies).toBeUndefined();
  });

  test("titles an unanswered alert with the default title, else the form's name", async () => {
    mockCreate({ _id: ALERT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: {},
        settings: { defaultTitle: "Reported from the status page" },
      }),
      prepared: prepared(),
    });
    await handler.create({
      context: buildContext({ answers: {} }),
      prepared: prepared(),
    });

    expect(created[0]!.data.title).toBe("Reported from the status page");
    expect(created[1]!.data.title).toBe("Something Looks Wrong");
  });

  test("sends the owners with the create, for the service to add once the alert exists", async () => {
    mockCreate({ _id: ALERT_ID.toString() });

    await handler.create({
      context: buildContext({ answers: { "f-title": "Checkout is slow" } }),
      prepared: prepared({
        ownerUserIds: [new ObjectID(USER_MEMBER)],
        ownerTeamIds: [new ObjectID(TEAM_OWN)],
      }),
    });

    const misc: JSONObject = created[0]!.miscDataProps as JSONObject;

    expect(idsOf(misc["ownerUsers"] as unknown as Array<ObjectID>)).toEqual([
      USER_MEMBER,
    ]);
    expect(idsOf(misc["ownerTeams"] as unknown as Array<ObjectID>)).toEqual([
      TEAM_OWN,
    ]);
  });

  test("sends only the owner teams when there are no owner users", async () => {
    mockCreate({ _id: ALERT_ID.toString() });

    await handler.create({
      context: buildContext({ answers: { "f-title": "Checkout is slow" } }),
      prepared: prepared({ ownerTeamIds: [new ObjectID(TEAM_OWN)] }),
    });

    expect(Object.keys(created[0]!.miscDataProps as JSONObject)).toEqual([
      "ownerTeams",
    ]);
  });

  test("answers the number as #N when the project has no prefix", async () => {
    mockCreate({ _id: ALERT_ID.toString(), alertNumber: 12 });

    const result: { id: ObjectID; reference?: string | undefined } =
      await handler.create({
        context: buildContext({ answers: { "f-title": "Checkout is slow" } }),
        prepared: prepared(),
      });

    expect(result.reference).toBe("#12");
  });

  test("answers no reference when the alert has no number", async () => {
    mockCreate({ _id: ALERT_ID.toString() });

    const result: { id: ObjectID; reference?: string | undefined } =
      await handler.create({
        context: buildContext({ answers: { "f-title": "Checkout is slow" } }),
        prepared: prepared(),
      });

    expect(result).toEqual({ id: ALERT_ID });
    expect("reference" in result).toBe(false);
  });

  test("fails loudly when the alert comes back without an id", async () => {
    mockCreate({});

    await expect(
      handler.create({
        context: buildContext({ answers: { "f-title": "Checkout is slow" } }),
        prepared: prepared(),
      }),
    ).rejects.toThrow(ServerException);
  });

  test("passes on a refusal from the service", async () => {
    jest
      .spyOn(AlertService, "create")
      .mockRejectedValue(new BadDataException("Alert severity is required."));

    await expect(
      handler.create({
        context: buildContext({ answers: { "f-title": "Checkout is slow" } }),
        prepared: prepared(),
      }),
    ).rejects.toThrow("Alert severity is required.");
  });
});

describe("AlertFormTarget.addNote", () => {
  function mockNote(): SpyInstance<typeof AlertInternalNoteService.create> {
    return jest
      .spyOn(AlertInternalNoteService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<AlertInternalNote>,
        ): Promise<AlertInternalNote> => {
          return createBy.data;
        },
      );
  }

  test("posts the note as a private note on the alert, as root", async () => {
    const createNote: SpyInstance<typeof AlertInternalNoteService.create> =
      mockNote();

    await handler.addNote({
      form: makeForm(),
      createdId: ALERT_ID,
      note: "Submitted through the form **Something Looks Wrong**.",
    });

    expect(createNote).toHaveBeenCalledTimes(1);

    const createBy: CreateBy<AlertInternalNote> = createNote.mock.calls[0]![0];

    expect(createBy.props).toEqual({ isRoot: true });
    expect(createBy.data).toBeInstanceOf(AlertInternalNote);
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.data.alertId?.toString()).toBe(ALERT_ID.toString());
    expect(createBy.data.note).toBe(
      "Submitted through the form **Something Looks Wrong**.",
    );
    expect(createBy.data.attachments).toBeUndefined();
  });

  test("attaches the files the submitter chose for the form's own file questions", async () => {
    const createNote: SpyInstance<typeof AlertInternalNoteService.create> =
      mockNote();

    await handler.addNote({
      form: makeForm(),
      createdId: ALERT_ID,
      note: "Submitted through the form.",
      attachments: [
        {
          fileId: FILE_ID,
          name: "screenshot.png",
          fileType: "image/png",
          size: 1024,
        },
      ],
    });

    expect(
      stubIds(createNote.mock.calls[0]![0].data.attachments as never),
    ).toEqual([FILE_ID]);
  });
});
