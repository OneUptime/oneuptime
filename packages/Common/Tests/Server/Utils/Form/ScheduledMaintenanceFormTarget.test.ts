/*
 * The services' import graph reaches the native isolated-vm addon through
 * template rendering. Nothing here touches the sandbox, and the prebuilt
 * binary cannot always load in a test worker.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Form from "../../../../Models/DatabaseModels/Form";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "../../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "../../../../Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import LabelService from "../../../../Server/Services/LabelService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ScheduledMaintenanceCustomFieldService from "../../../../Server/Services/ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceInternalNoteService from "../../../../Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import TeamService from "../../../../Server/Services/TeamService";
import ProjectScopedReferenceValidator from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import { FormSubmissionContext } from "../../../../Server/Utils/Form/FormTargetHandler";
import ScheduledMaintenanceFormTarget, {
  PreparedScheduledMaintenance,
} from "../../../../Server/Utils/Form/ScheduledMaintenanceFormTarget";
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const FORM_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const EVENT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const MONITOR_OWN: string = "a1000000-0000-4000-8000-000000000001";
const MONITOR_ANSWERED: string = "a1000000-0000-4000-8000-000000000002";
const MONITOR_FOREIGN: string = "a1000000-0000-4000-8000-000000000003";
const MONITOR_DELETED: string = "a1000000-0000-4000-8000-000000000004";
const STATUS_PAGE_OWN: string = "b2000000-0000-4000-8000-000000000001";
const STATUS_PAGE_ANSWERED: string = "b2000000-0000-4000-8000-000000000002";
const LABEL_OWN: string = "c3000000-0000-4000-8000-000000000001";
const LABEL_FOREIGN: string = "c3000000-0000-4000-8000-000000000002";
const TEAM_OWN: string = "d4000000-0000-4000-8000-000000000001";
const TEAM_FOREIGN: string = "d4000000-0000-4000-8000-000000000002";
const USER_MEMBER: string = "e5000000-0000-4000-8000-000000000001";
const USER_LEFT: string = "e5000000-0000-4000-8000-000000000002";

const STARTS_AT: string = "2026-11-01T02:00:00.000Z";
const ENDS_AT: string = "2026-11-01T04:00:00.000Z";

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
    field: { id: `f-${key}`, label: label, type: type, isRequired: true },
    binding: {
      source: FormFieldSource.TargetField,
      label: label,
      definition: getFormTargetField(FormTargetType.ScheduledMaintenance, key)!,
    },
  };
}

const TITLE: FieldEntry = targetField(
  "title",
  "Title",
  PublicFormFieldType.Text,
);
const DESCRIPTION: FieldEntry = targetField(
  "description",
  "What changes",
  PublicFormFieldType.Markdown,
);
const STARTS: FieldEntry = targetField(
  "startsAt",
  "Window opens",
  PublicFormFieldType.DateTime,
);
const ENDS: FieldEntry = targetField(
  "endsAt",
  "Window closes",
  PublicFormFieldType.DateTime,
);
const MONITORS: FieldEntry = targetField(
  "monitors",
  "Affected Monitors",
  PublicFormFieldType.MultiSelectDropdown,
);
const STATUS_PAGES: FieldEntry = targetField(
  "statusPages",
  "Status Pages",
  PublicFormFieldType.MultiSelectDropdown,
);
const LABELS: FieldEntry = targetField(
  "labels",
  "Labels",
  PublicFormFieldType.MultiSelectDropdown,
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
    customFieldId: "f0000000-0000-4000-8000-000000000001",
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
const REASON: FieldEntry = {
  field: {
    id: "f-reason",
    label: "Reason",
    type: PublicFormFieldType.Text,
    isRequired: false,
  },
  binding: {
    source: FormFieldSource.Question,
    label: "Reason",
    type: CustomFieldType.Text,
  },
};

const ALL_FIELDS: Array<FieldEntry> = [
  TITLE,
  DESCRIPTION,
  STARTS,
  ENDS,
  MONITORS,
  STATUS_PAGES,
  LABELS,
  ENVIRONMENT,
  SUBMITTER_EMAIL,
  REASON,
];

function makeForm(settings?: JSONObject | undefined): Form {
  const form: Form = new Form();
  form._id = FORM_ID.toString();
  form.projectId = PROJECT_ID;
  form.name = "Change Request";
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
 * ProjectScopedReferenceValidator.isUsableInProject reads `{ _id,
 * projectId }` with findOneBy. Answer it as Postgres would from these rows:
 * a record of another project, or one that is gone, is not found.
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

const handler: ScheduledMaintenanceFormTarget =
  new ScheduledMaintenanceFormTarget();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ScheduledMaintenanceFormTarget", () => {
  test("is the scheduled maintenance target, with no default options", () => {
    expect(handler.targetType).toBe(FormTargetType.ScheduledMaintenance);
    expect(handler.getDefaultOptionValues()).toEqual({});
  });
});

describe("ScheduledMaintenanceFormTarget.getCustomFieldDefinitions", () => {
  test("reads the project's scheduled maintenance custom fields, as root, by name", async () => {
    const named: ScheduledMaintenanceCustomField =
      new ScheduledMaintenanceCustomField();
    named._id = "f0000000-0000-4000-8000-000000000001";
    named.name = "environment";
    named.description = "Where it runs";
    named.customFieldType = CustomFieldType.Dropdown;
    named.dropdownOptions = "staging, production";

    const unnamed: ScheduledMaintenanceCustomField =
      new ScheduledMaintenanceCustomField();
    unnamed._id = "f0000000-0000-4000-8000-000000000002";

    const noId: ScheduledMaintenanceCustomField =
      new ScheduledMaintenanceCustomField();
    noId.name = "orphan";

    const findBy: SpyInstance<
      typeof ScheduledMaintenanceCustomFieldService.findBy
    > = jest
      .spyOn(ScheduledMaintenanceCustomFieldService, "findBy")
      .mockResolvedValue([named, unnamed, noId]);

    const definitions: Array<FormCustomFieldDefinition> =
      await handler.getCustomFieldDefinitions(PROJECT_ID);

    expect(findBy).toHaveBeenCalledWith({
      query: { projectId: PROJECT_ID },
      select: {
        _id: true,
        name: true,
        description: true,
        customFieldType: true,
        dropdownOptions: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: { isRoot: true },
    });

    expect(definitions).toEqual([
      {
        id: "f0000000-0000-4000-8000-000000000001",
        name: "environment",
        description: "Where it runs",
        customFieldType: CustomFieldType.Dropdown,
        dropdownOptions: "staging, production",
      },
    ]);
  });
});

describe("ScheduledMaintenanceFormTarget.validateReferences", () => {
  test("checks every record the settings name against the form's project", async () => {
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
        defaultTitle: "Maintenance",
        monitorIds: [MONITOR_OWN.toUpperCase()],
        statusPageIds: [STATUS_PAGE_OWN],
        labelIds: [LABEL_OWN],
        ownerUserIds: [USER_MEMBER],
        ownerTeamIds: [TEAM_OWN],
        showOnStatusPages: true,
      },
    });

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
          expect(call[0].subject).toBe("form");
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
      { modelName: "Monitors", id: MONITOR_OWN, service: MonitorService },
      {
        modelName: "Status Pages",
        id: STATUS_PAGE_OWN,
        service: StatusPageService,
      },
      { modelName: "Labels", id: LABEL_OWN, service: LabelService },
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
        incidentSeverityId: LABEL_OWN,
        onCallDutyPolicyIds: [LABEL_OWN],
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

describe("ScheduledMaintenanceFormTarget.prepare: the window", () => {
  beforeEach(() => {
    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockResolvedValue([]);
  });

  test("reads the window from the answers", async () => {
    const prepared: PreparedScheduledMaintenance = await handler.prepare(
      buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
      }),
    );

    expect(prepared.startsAt.toISOString()).toBe(STARTS_AT);
    expect(prepared.endsAt.toISOString()).toBe(ENDS_AT);
    expect(prepared.monitorIds).toEqual([]);
    expect(prepared.statusPageIds).toEqual([]);
    expect(prepared.labelIds).toEqual([]);
    expect(prepared.ownerUserIds).toEqual([]);
    expect(prepared.ownerTeamIds).toEqual([]);
  });

  test("refuses a submission with no start, naming the field as the form asks it", async () => {
    await expect(
      handler.prepare(buildContext({ answers: { "f-endsAt": ENDS_AT } })),
    ).rejects.toThrow(new BadDataException("Window opens is required."));
  });

  test("refuses a submission with no end", async () => {
    await expect(
      handler.prepare(buildContext({ answers: { "f-startsAt": STARTS_AT } })),
    ).rejects.toThrow(new BadDataException("Window closes is required."));
  });

  test("refuses a start that is not a date", async () => {
    await expect(
      handler.prepare(
        buildContext({
          answers: { "f-startsAt": "next tuesday", "f-endsAt": ENDS_AT },
        }),
      ),
    ).rejects.toThrow(new BadDataException("Window opens is required."));
  });

  test("names the fields by their catalog titles on a form that does not ask them", async () => {
    await expect(
      handler.prepare(buildContext({ answers: {}, fields: [TITLE] })),
    ).rejects.toThrow(new BadDataException("Starts At is required."));

    await expect(
      handler.prepare(
        buildContext({
          answers: { "f-startsAt": STARTS_AT },
          fields: [TITLE, STARTS],
        }),
      ),
    ).rejects.toThrow(new BadDataException("Ends At is required."));
  });

  test("refuses an end before the start", async () => {
    await expect(
      handler.prepare(
        buildContext({
          answers: { "f-startsAt": ENDS_AT, "f-endsAt": STARTS_AT },
        }),
      ),
    ).rejects.toThrow(
      new BadDataException("Window closes must be after Window opens."),
    );
  });

  test("refuses an end equal to the start", async () => {
    await expect(
      handler.prepare(
        buildContext({
          answers: { "f-startsAt": STARTS_AT, "f-endsAt": STARTS_AT },
        }),
      ),
    ).rejects.toThrow(
      new BadDataException("Window closes must be after Window opens."),
    );
  });

  test("refuses before any record is looked up", async () => {
    const filter: SpyInstance<
      typeof ProjectScopedReferenceValidator.filterUsableInProject
    > = jest.spyOn(ProjectScopedReferenceValidator, "filterUsableInProject");

    await expect(
      handler.prepare(
        buildContext({
          answers: {},
          settings: { monitorIds: [MONITOR_OWN] },
        }),
      ),
    ).rejects.toThrow(BadDataException);

    expect(filter).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceFormTarget.prepare: records", () => {
  beforeEach(() => {
    registerRecords(MonitorService, [
      { id: MONITOR_OWN, projectId: PROJECT_ID },
      { id: MONITOR_ANSWERED, projectId: PROJECT_ID },
      { id: MONITOR_FOREIGN, projectId: OTHER_PROJECT_ID },
    ]);
    registerRecords(StatusPageService, [
      { id: STATUS_PAGE_OWN, projectId: PROJECT_ID },
    ]);
    registerRecords(LabelService, [
      { id: LABEL_OWN, projectId: PROJECT_ID },
      { id: LABEL_FOREIGN, projectId: OTHER_PROJECT_ID },
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
  });

  test("merges the answered records with the settings', keeping only the project's", async () => {
    const prepared: PreparedScheduledMaintenance = await handler.prepare(
      buildContext({
        answers: {
          "f-startsAt": STARTS_AT,
          "f-endsAt": ENDS_AT,
          "f-monitors": [MONITOR_ANSWERED, MONITOR_OWN.toUpperCase()],
          "f-statusPages": [STATUS_PAGE_ANSWERED],
          "f-labels": LABEL_OWN,
        },
        settings: {
          monitorIds: [MONITOR_OWN, MONITOR_FOREIGN, MONITOR_DELETED],
          statusPageIds: [STATUS_PAGE_OWN],
          labelIds: [LABEL_OWN, LABEL_FOREIGN],
          ownerUserIds: [USER_MEMBER, USER_LEFT],
          ownerTeamIds: [TEAM_OWN, TEAM_FOREIGN],
        },
      }),
    );

    // The answered ones first, then the settings', each once.
    expect(idsOf(prepared.monitorIds)).toEqual([MONITOR_ANSWERED, MONITOR_OWN]);
    expect(idsOf(prepared.statusPageIds)).toEqual([
      STATUS_PAGE_ANSWERED,
      STATUS_PAGE_OWN,
    ]);
    expect(idsOf(prepared.labelIds)).toEqual([LABEL_OWN]);
    expect(idsOf(prepared.ownerUserIds)).toEqual([USER_MEMBER]);
    expect(idsOf(prepared.ownerTeamIds)).toEqual([TEAM_OWN]);
  });

  test("leaves publishing off unless the settings turn it on", async () => {
    const off: PreparedScheduledMaintenance = await handler.prepare(
      buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        settings: { showOnStatusPages: "yes", notifySubscribers: 1 },
      }),
    );

    expect(off.isVisibleOnStatusPage).toBe(false);
    expect(off.notifySubscribers).toBe(false);

    const on: PreparedScheduledMaintenance = await handler.prepare(
      buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        settings: { showOnStatusPages: true, notifySubscribers: true },
      }),
    );

    expect(on.isVisibleOnStatusPage).toBe(true);
    expect(on.notifySubscribers).toBe(true);
  });

  test("goes ahead without the settings' records when they cannot be checked", async () => {
    jest.restoreAllMocks();
    jest
      .spyOn(ProjectScopedReferenceValidator, "filterUsableInProject")
      .mockRejectedValue(new Error("database down"));
    jest
      .spyOn(TeamMemberService, "getProjectMemberUserIds")
      .mockRejectedValue(new Error("database down"));
    const logged: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    const prepared: PreparedScheduledMaintenance = await handler.prepare(
      buildContext({
        answers: {
          "f-startsAt": STARTS_AT,
          "f-endsAt": ENDS_AT,
          "f-monitors": [MONITOR_ANSWERED],
        },
        settings: {
          monitorIds: [MONITOR_OWN],
          ownerUserIds: [USER_MEMBER],
        },
      }),
    );

    expect(idsOf(prepared.monitorIds)).toEqual([MONITOR_ANSWERED]);
    expect(prepared.ownerUserIds).toEqual([]);
    expect(logged).toHaveBeenCalled();
  });
});

describe("ScheduledMaintenanceFormTarget.create", () => {
  let created: Array<CreateBy<ScheduledMaintenance>> = [];

  function prepared(
    overrides?: Partial<PreparedScheduledMaintenance>,
  ): PreparedScheduledMaintenance {
    return {
      startsAt: new Date(STARTS_AT),
      endsAt: new Date(ENDS_AT),
      monitorIds: [],
      statusPageIds: [],
      labelIds: [],
      ownerUserIds: [],
      ownerTeamIds: [],
      isVisibleOnStatusPage: false,
      notifySubscribers: false,
      ...overrides,
    };
  }

  function mockCreate(result?: Partial<ScheduledMaintenance>): void {
    jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<ScheduledMaintenance>,
        ): Promise<ScheduledMaintenance> => {
          created.push(createBy);
          const event: ScheduledMaintenance = new ScheduledMaintenance();
          if (result?._id !== undefined) {
            event._id = result._id;
          }
          if (result?.scheduledMaintenanceNumber !== undefined) {
            event.scheduledMaintenanceNumber =
              result.scheduledMaintenanceNumber;
          }
          if (result?.scheduledMaintenanceNumberWithPrefix !== undefined) {
            event.scheduledMaintenanceNumberWithPrefix =
              result.scheduledMaintenanceNumberWithPrefix;
          }
          return event;
        },
      );
  }

  beforeEach(() => {
    created = [];
  });

  test("creates the event as root in the form's project from the answers", async () => {
    mockCreate({
      _id: EVENT_ID.toString(),
      scheduledMaintenanceNumber: 7,
      scheduledMaintenanceNumberWithPrefix: "SM-7",
    });

    const result: { id: ObjectID; reference?: string | undefined } =
      await handler.create({
        context: buildContext({
          answers: {
            "f-title": "Database upgrade",
            "f-description": "Postgres 17 → 18",
            "f-startsAt": STARTS_AT,
            "f-endsAt": ENDS_AT,
            "f-env": "production",
            "f-email": "jane@example.com",
            "f-reason": "Security patch",
          },
          settings: { defaultTitle: "Planned maintenance" },
        }),
        prepared: prepared({
          monitorIds: [new ObjectID(MONITOR_OWN)],
          statusPageIds: [new ObjectID(STATUS_PAGE_OWN)],
          labelIds: [new ObjectID(LABEL_OWN)],
        }),
      });

    expect(result.id.toString()).toBe(EVENT_ID.toString());
    expect(result.reference).toBe("SM-7");
    expect(created).toHaveLength(1);

    const createBy: CreateBy<ScheduledMaintenance> = created[0]!;
    const event: ScheduledMaintenance = createBy.data;

    expect(createBy.props).toEqual({ isRoot: true });
    expect(createBy.miscDataProps).toBeUndefined();
    expect(event.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(event.title).toBe("Database upgrade");
    expect(event.description).toBe("Postgres 17 → 18");
    expect(event.startsAt?.toISOString()).toBe(STARTS_AT);
    expect(event.endsAt?.toISOString()).toBe(ENDS_AT);
    expect(event.monitors![0]).toBeInstanceOf(Monitor);
    expect(stubIds(event.monitors)).toEqual([MONITOR_OWN]);
    expect(event.statusPages![0]).toBeInstanceOf(StatusPage);
    expect(stubIds(event.statusPages)).toEqual([STATUS_PAGE_OWN]);
    expect(event.labels![0]).toBeInstanceOf(Label);
    expect(stubIds(event.labels)).toEqual([LABEL_OWN]);
    // Only custom fields reach the record: not the submitter, nor questions.
    expect(event.customFields).toEqual({ environment: "production" });
    expect(event.isVisibleOnStatusPage).toBe(false);
    expect(event.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      false,
    );
    expect(
      event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    ).toBe(false);
    expect(
      event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
    ).toBe(false);
  });

  test("turns publishing on everywhere when the settings ask for it", async () => {
    mockCreate({ _id: EVENT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
      }),
      prepared: prepared({
        isVisibleOnStatusPage: true,
        notifySubscribers: true,
      }),
    });

    const event: ScheduledMaintenance = created[0]!.data;

    expect(event.isVisibleOnStatusPage).toBe(true);
    expect(event.shouldStatusPageSubscribersBeNotifiedOnEventCreated).toBe(
      true,
    );
    expect(
      event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToOngoing,
    ).toBe(true);
    expect(
      event.shouldStatusPageSubscribersBeNotifiedWhenEventChangedToEnded,
    ).toBe(true);
  });

  test("leaves out empty relations and an empty description", async () => {
    mockCreate({ _id: EVENT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: {
          "f-description": "",
          "f-startsAt": STARTS_AT,
          "f-endsAt": ENDS_AT,
        },
      }),
      prepared: prepared(),
    });

    const event: ScheduledMaintenance = created[0]!.data;

    expect(event.description).toBeUndefined();
    expect(event.monitors).toBeUndefined();
    expect(event.statusPages).toBeUndefined();
    expect(event.labels).toBeUndefined();
    expect(event.customFields).toEqual({});
  });

  test("titles an unanswered event with the default title, else the form's name", async () => {
    mockCreate({ _id: EVENT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        settings: { defaultTitle: "  Planned maintenance  " },
      }),
      prepared: prepared(),
    });

    await handler.create({
      context: buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
      }),
      prepared: prepared(),
    });

    expect(created[0]!.data.title).toBe("Planned maintenance");
    expect(created[1]!.data.title).toBe("Change Request");
  });

  test("sends the owners with the create, for the service to add", async () => {
    mockCreate({ _id: EVENT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
      }),
      prepared: prepared({
        ownerUserIds: [new ObjectID(USER_MEMBER)],
        ownerTeamIds: [new ObjectID(TEAM_OWN)],
      }),
    });

    const misc: JSONObject = created[0]!.miscDataProps!;

    expect(idsOf(misc["ownerUsers"] as unknown as Array<ObjectID>)).toEqual([
      USER_MEMBER,
    ]);
    expect(idsOf(misc["ownerTeams"] as unknown as Array<ObjectID>)).toEqual([
      TEAM_OWN,
    ]);
  });

  test("sends only the owner teams when there are no owner users", async () => {
    mockCreate({ _id: EVENT_ID.toString() });

    await handler.create({
      context: buildContext({
        answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
      }),
      prepared: prepared({ ownerTeamIds: [new ObjectID(TEAM_OWN)] }),
    });

    expect(Object.keys(created[0]!.miscDataProps!)).toEqual(["ownerTeams"]);
  });

  test("answers the number as #N when the project has no prefix", async () => {
    mockCreate({ _id: EVENT_ID.toString(), scheduledMaintenanceNumber: 12 });

    const result: { id: ObjectID; reference?: string | undefined } =
      await handler.create({
        context: buildContext({
          answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        }),
        prepared: prepared(),
      });

    expect(result.reference).toBe("#12");
  });

  test("answers no reference when the event has no number", async () => {
    mockCreate({ _id: EVENT_ID.toString() });

    const result: { id: ObjectID; reference?: string | undefined } =
      await handler.create({
        context: buildContext({
          answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        }),
        prepared: prepared(),
      });

    expect(result).toEqual({ id: EVENT_ID });
    expect(Object.prototype.hasOwnProperty.call(result, "reference")).toBe(
      false,
    );
  });

  test("fails loudly when the event comes back without an id", async () => {
    mockCreate({});

    await expect(
      handler.create({
        context: buildContext({
          answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        }),
        prepared: prepared(),
      }),
    ).rejects.toThrow(ServerException);
  });

  test("passes on a refusal from the service", async () => {
    jest
      .spyOn(ScheduledMaintenanceService, "create")
      .mockRejectedValue(new BadDataException("Not allowed"));

    await expect(
      handler.create({
        context: buildContext({
          answers: { "f-startsAt": STARTS_AT, "f-endsAt": ENDS_AT },
        }),
        prepared: prepared(),
      }),
    ).rejects.toThrow("Not allowed");
  });
});

describe("ScheduledMaintenanceFormTarget.addNote", () => {
  test("posts the note as a private note on the event, as root", async () => {
    const createNote: SpyInstance<
      typeof ScheduledMaintenanceInternalNoteService.create
    > = jest
      .spyOn(ScheduledMaintenanceInternalNoteService, "create")
      .mockImplementation(
        async (
          createBy: CreateBy<ScheduledMaintenanceInternalNote>,
        ): Promise<ScheduledMaintenanceInternalNote> => {
          return createBy.data;
        },
      );

    await handler.addNote({
      form: makeForm(),
      createdId: EVENT_ID,
      note: "Submitted through the form **Change Request**.",
    });

    expect(createNote).toHaveBeenCalledTimes(1);

    const createBy: CreateBy<ScheduledMaintenanceInternalNote> =
      createNote.mock.calls[0]![0];

    expect(createBy.props).toEqual({ isRoot: true });
    expect(createBy.data).toBeInstanceOf(ScheduledMaintenanceInternalNote);
    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.data.scheduledMaintenanceId?.toString()).toBe(
      EVENT_ID.toString(),
    );
    expect(createBy.data.note).toBe(
      "Submitted through the form **Change Request**.",
    );
  });
});
